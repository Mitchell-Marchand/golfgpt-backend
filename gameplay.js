const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const authenticateUser = require('./authMiddleware');
require('dotenv').config();
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const router = express.Router();

const mariadbPool = mysql.createPool({
    host: 'ec2-18-232-136-96.compute-1.amazonaws.com',
    user: 'golfuser',
    password: process.env.DB_PASS,
    database: 'golfpicks',
    waitForConnections: true,
    connectionLimit: 10,
});

router.post("/update", authenticateUser, async (req, res) => {
    try {
        const { threadId, holeResults, matchId, oldResults } = req.body;

        const currentHoleNumber = holeResults[Object.keys(holeResults)[0]].holeNumber;
        const filePath = path.join(__dirname, "temp_old_results.json");
        fs.writeFileSync(filePath, JSON.stringify(oldResults));

        const uploadedFile = await openai.files.create({
            purpose: "assistants",
            file: fs.createReadStream(filePath),
        });

        const prompt = `
You are a golf scoring assistant.

The match history is uploaded as a file attached to this thread. It contains the state of the match before hole ${currentHoleNumber}.

Here are the results for hole ${currentHoleNumber}:
${JSON.stringify(holeResults, null, 2)}

Instructions:
- Load the uploaded file to access prior results.
- Merge the new hole results into the match.
- Return updated match results as JSON.
- DO NOT return explanations — only the updated results.
`;

        await openai.beta.threads.messages.create(threadId, {
            role: "user",
            content: prompt,
        });

        const run = await openai.beta.threads.runs.create(threadId, {
            assistant_id: process.env.OPENAI_ASSISTANT_ID,
            tool_resources: {
                code_interpreter: {
                    file_ids: [uploadedFile.id], // ✅ attach files here
                },
            },
        });

        console.log("Polling for run to complete...");

        let result;
        while (true) {
            result = await openai.beta.threads.runs.retrieve(threadId, run.id);
            if (result.status === "completed") break;
            if (result.status === "failed" || result.status === "cancelled") {
                console.error("Run failed:", result);
                return res.status(500).json({ error: "GPT Assistant run failed." });
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        console.log("Run completed");

        const messages = await openai.beta.threads.messages.list(threadId);
        const last = messages.data.find((m) => m.role === "assistant");
        const content = last?.content?.[0]?.text?.value || "{}";

        let updatedResults;

        try {
            const cleaned = content
                .replace(/^```json\s*/i, '')
                .replace(/```$/, '')
                .trim();

            updatedResults = JSON.parse(cleaned);
        } catch (err) {
            console.error("Failed to parse updated match results:", content);
            return res.status(400).json({ error: "Invalid JSON returned from GPT." });
        }

        // Save updated results to DB
        await mariadbPool.query(
            `UPDATE Matches SET results = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
            [JSON.stringify(updatedResults), matchId]
        );

        res.json({ updatedResults });
    } catch (err) {
        console.error("Error in /update:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.post("/start", authenticateUser, async (req, res) => {
    try {
      const { matchData, rules } = req.body;
      const createdBy = req.user.id;
      matchData.createdBy = createdBy;
  
      const courseId = matchData?.course?.CourseID;
      const courseName = matchData?.course?.FullName;
      const scorecards = JSON.stringify(matchData?.scorecards);
  
      // Ensure course exists
      const [existing] = await mariadbPool.query(
        "SELECT * FROM Courses WHERE courseId = ?",
        [courseId]
      );
  
      if (existing.length === 0) {
        console.log("Creating course", courseId);
        await mariadbPool.query(
          `INSERT INTO Courses (courseId, courseName, scorecards) VALUES (?, ?, ?)`,
          [courseId, courseName, scorecards]
        );
      }
  
      // Build the prompt
      const messages = [
        {
          role: "system",
          content: `You are a golf scoring assistant. You understand common formats like:

- **Scotch/Umbrella/Bridge**: Two-player teams. Point for net best ball, combined net team score, birdies or better,  and for *proximity* (closest to the hole in regulation). if a team get's all 4 points, it doubled. each additional birdie from a winning team doubles the hole again. an eagle is worth two birdies. birdies on the other team cancel out other birdies. Additional doubles or presses on top of anything automatic may occur.
- **Nassau**: 3 bets per round (front, back, overall), match play. Presses allowed.
- **Skins**: Player wins hole if best score, must beat all others. Ties carry over. Optional bonuses: greenies, sandies, birdies.

When a user describes a format like "Scotch" or "Bridge" or "Umbrella", automatically include post-hole questions like:
- “Who had proximity (closest to the hole in regulation)?”

You are expected to:
- Infer implied scoring mechanics (e.g. proximity)
- Never ask about automatic rules (like auto-doubles)
- Always return JSON with confirmation and \`additionalInputs\`

All questions must be **past tense** and represent hole-completion data.

Respond only with JSON:`
        },
        {
          role: "user",
          content: `
  Here is the match data as JSON:
  ${JSON.stringify(matchData, null, 2)}
  
  Here is the user's description of the game rules.:
  "${rules}"
  
  Return ONLY a valid JSON object with the following structure:
  
  {
    "gameName": string,
    "confirmation": string,
    "additionalInputs": [
      {
        "question": string,
        "answers": string[]
      }
    ],
    "scorecard": [
      {
        "playerName": string,
        "tees": string,
        "chancesOfWinning": number,
        "winLossBalance": number,
        "holes": [
          {
            "holeNumber": number,
            "par": number,
            "yardage": number,
            "courseHandicap": number,
            "score": null,
            "strokes": number,
            "netScore": null,
            "moneyWonLost": null
          }
        ]
      }
    ]
  }
  `
        }
      ];
  
      const startTime = Date.now();
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        temperature: 0.7
      });
      const duration = Date.now() - startTime;
      console.log(`GPT response time: ${duration}ms`);
  
      const responseText = completion.choices[0]?.message?.content || "{}";
  
      let parsed;
      try {
        const cleaned = responseText
          .replace(/^```json\s*/i, '')
          .replace(/```$/, '')
          .trim();
        parsed = JSON.parse(cleaned);
      } catch (err) {
        console.error("Failed to parse GPT response:", responseText);
        return res.status(400).json({ error: "Invalid JSON returned from GPT" });
      }
  
      const matchId = uuidv4();
      await mariadbPool.query(
        `INSERT INTO Matches 
        (id, createdBy, golfers, courseId, isPublic, displayName, teeTime, results, additionalInputs) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          matchId,
          matchData.createdBy,
          JSON.stringify(matchData.selectedTees),
          courseId,
          matchData.isPublic ?? true,
          parsed.gameName ?? "Untitled Match",
          new Date(matchData.teeTime).toISOString().slice(0, 19).replace('T', ' '),
          JSON.stringify(parsed.scorecard ?? []),
          JSON.stringify(parsed.additionalInputs ?? [])
        ]
      );
  
      const [matches] = await mariadbPool.query('SELECT * FROM Matches WHERE id = ?', [matchId]);
      res.json({ match: matches[0], confirmation: parsed.confirmation });
    } catch (err) {
      console.error("Error in /start:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });  

module.exports = router;
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

- **Scotch/Umbrella/Bridge**: Two-player teams. Point for net best ball, combined net team score, birdies, proximity, etc. If one team gets all points, the hole is doubled. Extra birdies can cause further doubling. Birdies on the losing team cancel. Players may press or double the bet manually.
- **Nassau**: Match play with bets on front, back, and overall. Presses common.
- **Skins**: Best score wins hole. Bonuses for birdies, proximity, etc.

You must always extract **all possible post-hole decisions** that affect scoring, such as:
- Proximity (if implied)
- Presses, doubles, or quadruples that players may call themselves

If a rule or format allows players to **manually increase stakes**, add a question like:
- “Did any player double or quadruple the bet on this hole?”

Only ask questions about user decisions, not automatic rules.

All questions must be **past tense** and should only cover things that happen **during or after a hole** is played.

Respond only with JSON:`
        },
        {
          role: "user",
          content: `
  Here is the match data as JSON. it includes the golfers who are playing, what tees and course they're playing from, and the data about the different tees on the course:
  ${JSON.stringify(matchData, null, 2)}
  
  Here is the user's description of the game rules.:
  "${rules}"
  
  Return ONLY a valid JSON object with the following structure:
  
  {
    "gameName": string, //Generate this yourself based on the rules of the game, make it fun
    "confirmation": string, //Your own words confirming your understanding of the game
    "additionalInputs": [ //Additional questions you will need to ask the user 
      {
        "question": string,
        "answers": string[]
      }
    ],
    "scorecards": [ //Add of these objects in this array for each golfer that is playing
      {
        "playerName": string,
        "tees": string,
        "chancesOfWinning": number, //Generate this based on the results of the match so far and the format
        "winLossBalance": number, //How much the golfer is up/down on money overall in the match
        "holes": [ //Add one of these for each hole
          {
            "holeNumber": number,
            "par": number,  // Pulled from the "Par" field of the hole given which tees the golfer is playing
            "yardage": number, // Pulled from the "Length" field of the hole given the tees the golfer is playing
            "courseHandicap": number, // Pulled from the "Allocation" field of the hole given which tees the golfer is playing
            "score": null, //This will be filled in by the user as the round is played
            "strokes": number, //Set this if the rules indicated that certain players have handicaps or need strokes/pops
            "netScore": null, //Score minus strokes
            "moneyWonLost": null //Money won/lost for this golfer on this hole based on the rules and the scores of everyone else - you will update this as the user uploads the scores hole by hole
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
          JSON.stringify(parsed.scorecards ?? []),
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
const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const authenticateUser = require('./authMiddleware');
require('dotenv').config();
const OpenAI = require("openai");
const { Readable } = require("stream");

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const router = express.Router();

const mariadbPool = mysql.createPool({
    host: 'ec2-54-205-4-218.compute-1.amazonaws.com',
    user: 'golfuser',
    password: process.env.DB_PASS,
    database: 'golfpicks',
    waitForConnections: true,
    connectionLimit: 10,
});

router.post("/update", authenticateUser, async (req, res) => {
    try {
        const { threadId, holeResults, matchId, oldResults } = req.body;

        const file = await openai.files.create({
            purpose: "assistants",
            file: Readable.from([JSON.stringify(oldResults)]),
            name: "old_results.json",
        });

        const prompt = `
You are a golf scoring assistant.

The user just submitted results for hole ${currentHoleNumber}.
Here is the hole result data:
${JSON.stringify(holeResults, null, 2)}

The previous results are available in the file 'old_results.json'.

Update the match results using the new hole data.

Requirements:
- Update each golfer's score, strokes, netScore, and moneyWonLost for that hole.
- Update their winLossBalance and chancesOfWinning across the full match.
- If the hole has already been filled out, overwrite the values with the new results.
- Only return valid JSON with the updated full match results in the same format as the file.
- Do not explain anything or include extra commentary.
`;

        await openai.beta.threads.messages.create(threadId, {
            role: "user",
            content: prompt,
            file_ids: [file.id],
        });

        const run = await openai.beta.threads.runs.create(threadId, {
            assistant_id: process.env.OPENAI_ASSISTANT_ID,
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

        // Insert course if not in DB
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
        } else {
            console.log("Course already created", courseId);
        }

        // Create GPT thread
        const thread = await openai.beta.threads.create();
        console.log("Thread created", thread.id);

        const fullPrompt = `
You are a golf scoring assistant.

Here is the match data as JSON:
${JSON.stringify(matchData, null, 2)}

Here is the user's description of the game rules:
"${rules}"

You will help calculate results for each golfer on every hole.

Return ONLY a valid JSON object with the following structure:

{
  "gameName": string, // a fun, descriptive name for the match
  "confirmation": string, // a confirmation that explains your understanding of the format and rules in detail
  "additionalInputs": [
    {
      "question": string, // a question that needs to be asked after each hole
      "answers": string[] // possible answers
    }
  ],
  "scorecard": [
    {
      "playerName": string,
      "tees": string,
      "chancesOfWinning": 50 // percent chance of the player winning the match based on how things have gone so far
      "winLossBalance": 0, //amount the user has won/lost in the match. updated as results are given.
      "holes": [
        {
          "holeNumber": number,
          "par": number,
          "yardage": number,
          "courseHandicap": number, // the index of the hole (1-18) based on the tee set being played
          "score": null,
          "strokes": number,
          "netScore": null,
          "moneyWonLost": null, //Amount of money the golfer won/lost on that hole, which will be updated as scores are posted
        }
      ]
    }
  ]
}

Instructions:
- Use the matchData.selectedTees to determine which tee each golfer is playing.
- Use matchData.scorecards to find the correct tee set and extract:
  - hole yardage,
  - par,
  - and allocation (courseHandicap) for each hole.
- Set courseHandicap = allocation value from the matching tee set hole.

**Requirements**:
- Calculate strokes per hole based on each golfer's course handicap and tee selection.
- Even if the user has not provided handicaps, return the rest of the structure with \`strokes: 0\`.
- All holes should be populated using data from the selected course and tees.
- Do not explain or include anything outside the JSON.
`;


        await openai.beta.threads.messages.create(thread.id, {
            role: "user",
            content: fullPrompt,
        });

        console.log("Prompt sent");

        // Start Assistant Run (✅ fix applied here)
        const run = await openai.beta.threads.runs.create(thread.id, {
            assistant_id: process.env.OPENAI_ASSISTANT_ID,
        });

        console.log("Polling for completion...");

        // Poll until run completes
        let result;
        while (true) {
            result = await openai.beta.threads.runs.retrieve(thread.id, run.id);
            if (result.status === "completed") break;
            if (result.status === "failed" || result.status === "cancelled") {
                console.error("Run failed:", result);
                return res.status(500).json({ error: "Assistant run failed." });
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        console.log("Run completed");

        const messages = await openai.beta.threads.messages.list(thread.id);
        const last = messages.data.find((m) => m.role === "assistant");
        const content = last?.content?.[0]?.text?.value || "{}";

        let gameName = 'Untitled Match';
        let confirmation = '';
        let additionalInputs = [];
        let scorecard = [];

        try {
            const cleaned = content
                .replace(/^```json\s*/i, '')
                .replace(/```$/, '')
                .trim();

            const parsed = JSON.parse(cleaned);
            gameName = parsed.gameName ?? gameName;
            confirmation = parsed.confirmation ?? '';
            additionalInputs = parsed.additionalInputs ?? [];
            scorecard = parsed.scorecard ?? [];
        } catch (err) {
            console.error('Failed to parse GPT response:', content);
        }

        // Save match to DB
        const matchId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Matches 
            (id, threadId, createdBy, golfers, courseId, isPublic, displayName, teeTime, results, additionalInputs) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                matchId,
                thread.id,
                matchData.createdBy,
                JSON.stringify(matchData.selectedTees),
                courseId,
                matchData.isPublic ?? true,
                gameName,
                new Date(matchData.teeTime).toISOString().slice(0, 19).replace('T', ' '),
                JSON.stringify(scorecard),
                JSON.stringify(additionalInputs)
            ]
        );

        const [matches] = await mariadbPool.query('SELECT * FROM Matches WHERE id = ?', [matchId]);
        res.json({ match: matches[0], confirmation });
    } catch (err) {
        console.error("Error in /start:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;
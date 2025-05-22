const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const authenticateUser = require('./authMiddleware');
require('dotenv').config();
const OpenAI = require("openai");

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

You are provided with structured match data as a JSON object. This includes:
- Golfers and selected tees
- Course and hole details
- Tee time
- Whether the match is public
- A natural-language description of the game rules written by the user

---

Here is the match data:
${JSON.stringify(matchData, null, 2)}

Here is the user's description of the rules:
"${rules}"

---

Your job is to:
1. Understand the game and rules.
2. Identify **any additional questions** the user must answer **after each hole** in order to calculate correct results.
3. Return a structured JSON object with the information below.

🏌️ Special Instructions:
- Some game types have *expected behaviors*. If the user mentions "Scotch", "Nassau", "Greenies", "Skins", etc., you should **assume proximity (closest to the pin in regulation)** and include a question about it unless told otherwise.
- Do not ask about things you can determine from the score (e.g. team scores, who won the hole).
- Do not ask about automatic game rules — just apply them.
- If a bet can be doubled or quadrupled, collapse that into one question: “Was the bet increased?” with answers like: "No", "Doubled", "Quadrupled".

All questions must be written in **past tense**, as they are being asked *after* the hole has been played.

---

Return this JSON ONLY (do not include explanation or commentary):

\`\`\`json
{
  "gameName": string,          // a short, fun name for the game
  "confirmation": string,      // a clear explanation of the rules as understood
  "additionalInputs": [        // questions for the user after each hole
    {
      "question": string,
      "answers": string[]
    }
  ]
}
\`\`\`
`;

        await openai.beta.threads.messages.create(thread.id, {
            role: "user",
            content: fullPrompt,
        });

        console.log("Prompt sent");
        console.log("assistant ID", process.env.OPENAI_ASSISTANT_ID);

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

        try {
            const cleaned = content
                .replace(/^```json\s*/i, '')
                .replace(/```$/, '')
                .trim();

            const parsed = JSON.parse(cleaned);
            gameName = parsed.gameName ?? gameName;
            confirmation = parsed.confirmation ?? '';
            additionalInputs = parsed.additionalInputs ?? [];
        } catch (err) {
            console.error('Failed to parse GPT response:', content);
        }

        // Save match to DB
        const matchId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Matches 
            (id, threadId, createdBy, golfers, courseId, isPublic, displayName, teeTime, results) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                matchId,
                thread.id,
                matchData.createdBy,
                JSON.stringify(matchData.selectedTees),
                courseId,
                matchData.isPublic ?? true,
                gameName,
                new Date(matchData.teeTime).toISOString().slice(0, 19).replace('T', ' '),
                null,
            ]
        );

        res.json({ inputs: additionalInputs, gameName, confirmation, matchId });

    } catch (err) {
        console.error("Error in /start:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;
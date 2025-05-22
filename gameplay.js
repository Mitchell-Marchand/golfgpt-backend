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

You are provided with structured match data as a JSON object. This includes the golfers, the course and tee information, tee time, and selected tees per golfer. The user has also written a free-form description of the game rules.

Your job is to understand how scoring should be handled on each hole based on this data.

---

Here is the match data:
${JSON.stringify(matchData, null, 2)}

Here is the user's description of the rules:
"${rules}"

---

❗️You will assist the user by evaluating scoring after each hole. In addition to collecting gross scores per golfer, you must also determine what other data should be collected after each hole in order to accurately compute results according to the rules of the game.

🔁 Return a JSON object in the following format, and **nothing else**:

\`\`\`json
{
  "gameName": string, // A fun, clear name for the game
  "confirmation": string, // A detailed summary of the rules and format that shows you understand how scoring should be done
  "additionalInputs": [
    {
      "question": string, // A past-tense question to ask the user after each hole
      "answers": string[] // Possible responses
    },
    ...
  ]
}
\`\`\`

Guidelines:
- Use **past tense** in the questions (e.g. "Was the bet doubled?" not "Would you like to double?").
- Only include additional questions that are **relevant to scoring** based on the rules.
- If the game includes things like presses, automatic doubles, greenies, sandies, or team-based formats, ask about those.
- Be concise but accurate in the confirmation.
- Do NOT include any explanation or commentary outside the JSON block.
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
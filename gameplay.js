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
- The list of golfers
- Selected tees
- Course and hole information
- Tee time
- Whether the match is public
- A free-form description of the game rules written by the user

---

Here is the match data:
${JSON.stringify(matchData, null, 2)}

Here is the user's description of the rules:
"${rules}"

---

You will calculate results after each hole is played.

Before scoring can occur, identify **any additional information that must be collected after each hole** based on the rules. These are questions the user will be prompted to answer **after** the hole is complete.

❗️Be smart: if a rule like automatic doubling is described, it should be enforced internally based on the game state — do **not** ask the user to confirm it.

If a hole cannot be both doubled and quadrupled, collapse those into a single multiple-choice question:  
"Was the bet increased on this hole?" → with answers like "No", "Doubled", "Quadrupled".

If the game includes proximity, greenies, or side games, include past-tense questions like:  
"Who had closest to the pin on this hole?"

---

Return a single JSON object only (nothing else), in the format:

\`\`\`json
{
  "gameName": string,          // a fun name for the match
  "confirmation": string,      // confirmation that you understand how scoring works
  "additionalInputs": [        // questions to ask the user after each hole
    {
      "question": string,      // past-tense question
      "answers": string[]      // multiple choice options
    }
  ]
}
\`\`\`

Rules:
- Use **past-tense** in all questions.
- Do **not** include explanation outside the JSON block.
- Only include questions that the user **must answer manually** in order to score the hole correctly.
- If something is deterministic from data (e.g., team assignments or auto-doubles), just apply it — don’t ask the user.
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
const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const authenticateUser = require('./authMiddleware');
require('dotenv').config();
const OpenAI = require("openai");

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

router.post("/begin", authenticateUser, async (req, res) => {
    const { golfers, course } = req.body;
    const userId = req.user.id;

    if (!golfers || !Array.isArray(golfers) || !course || !course.CourseID) {
        return res.status(400).json({ error: "Missing or invalid golfers or course." });
    }

    try {
        // Ensure course exists
        const [existing] = await mariadbPool.query("SELECT courseId FROM Courses WHERE courseId = ?", [course.CourseID]);
        if (existing.length === 0) {
            await mariadbPool.query(
                "INSERT INTO Courses (courseId, courseName, scorecards) VALUES (?, ?, ?)",
                [course.CourseID, course.FullName, JSON.stringify([])]
            );
        }

        // Start OpenAI thread
        const thread = await openai.beta.threads.create();

        // Send intro message
        const intro = `I'm playing a golf match today. Here are the golfers and course details. More to come.\n\nGolfers:\n${JSON.stringify(golfers, null, 2)}\n\nCourse:\n${JSON.stringify(course, null, 2)}`;
        await openai.beta.threads.messages.create(thread.id, {
            role: "user",
            content: intro,
        });

        // Insert match record
        const matchId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Matches (id, threadId, createdBy, golfers, courseId) VALUES (?, ?, ?, ?, ?)`,
            [
                matchId,
                thread.id,
                userId,
                JSON.stringify(golfers),
                course.CourseID
            ]
        );

        res.json({ success: true, matchId, threadId: thread.id });
    } catch (err) {
        console.error("Error in /begin:", err);
        res.status(500).json({ error: "Failed to initialize match." });
    }
});

router.post("/tees", authenticateUser, async (req, res) => {
    const { matchId, scorecards, teesByGolfer } = req.body;

    if (!matchId || !scorecards || !teesByGolfer) {
        return res.status(400).json({ error: "Missing required data." });
    }

    try {
        // Look up threadId for match
        const [rows] = await mariadbPool.query("SELECT threadId, courseId FROM Matches WHERE id = ?", [matchId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        } else {
            const courseId = rows[0].courseId;
            await mariadbPool.query("UPDATE Courses set scorecards = ? WHERE courseId = ?", [JSON.stringify(scorecards), courseId]);
        }

        const threadId = rows[0].threadId;

        // Compose message content
        const message = `Here is the full scorecard for the course, and which tees each golfer is playing:\n\nScorecard:\n${JSON.stringify(scorecards, null, 2)}\n\nTees per golfer:\n${JSON.stringify(teesByGolfer, null, 2)}`;

        // Send to OpenAI thread
        await openai.beta.threads.messages.create(threadId, {
            role: "user",
            content: message,
        });

        res.json({ success: true });
    } catch (err) {
        console.error("Error in /tees:", err);
        res.status(500).json({ error: "Failed to send tee info to thread." });
    }
});

function formatDateForSQL(isoString) {
    const date = new Date(isoString)
    return date.toISOString().slice(0, 19).replace('T', ' ')
}

router.post("/create", authenticateUser, async (req, res) => {
    const { matchId, teeTime, isPublic, rules } = req.body;

    if (!matchId || !teeTime || typeof isPublic === 'undefined' || !rules) {
        return res.status(400).json({ error: "Missing required data." });
    }

    try {
        console.log("[/create] Querying threadId...");
        const [rows] = await mariadbPool.query("SELECT threadId FROM Matches WHERE id = ?", [matchId]);
        console.log("[/create] threadId retrieved");

        if (rows.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const threadId = rows[0].threadId;
        const formattedTeeTime = formatDateForSQL(teeTime);

        console.log("[/create] Updating teeTime and isPublic...");
        await mariadbPool.query(
            "UPDATE Matches SET teeTime = ?, isPublic = ? WHERE id = ?",
            [formattedTeeTime, isPublic ? 1 : 0, matchId]
        );
        console.log("[/create] Update complete");

        const prompt = `
        You already know the golfers, their tees, and the full scorecard.

        Additional golf lingo: hammer/bridge/soup/roll means to double the bet (2x). "re-hammer" or "resoup" to "bowl it" means to hammer a hammer (4x). press means to start an additional match. These are options in certain games.
        
        Based only on the rules below, return a JSON object with:
        - "displayName": a creative game title based on format and players
        - "scorecards": one per golfer, with name, tees, handicap (if unknown put 0), and 18 holes. Each hole includes: holeNumber, par, yardage, and allocation
        - "questions" (array): list of all additional questions to ask per hole (past tense) required to accurately score the match based on the rules (don't do {question} on hole 1, {question} on hole 2, etc. - just the question you'll repeat). Include proximity (closest to the hole not just on par 3s) if relevant for formats like Scotch. Include 2x, 3x, 4x, 5x as options for increasing the bet if in a format that allows for it (like Scotch). Don't ask questions that you can get from the actual scores, like who won or who was lowest, or if there were any carryovers, as these will be provided. also, don't ask questions about anything that is not a mandatory aspect of scoring (unless the rules and/or game format specify otherwise)
        Format each question as: 
          {
            "question": "string",
            "options": ["array", "of", "choices"]
          }
        
        Rules:
        ${rules}
        
        ONLY respond with raw valid JSON. No commentary, labels, or formatting.
        `.trim();

        console.log("[/create] Sending prompt to thread...");
        await openai.beta.threads.messages.create(threadId, {
            role: "user",
            content: prompt,
        });
        console.log("[/create] Prompt sent");

        console.log("[/create] Creating run...");
        const run = await openai.beta.threads.runs.create(threadId, {
            assistant_id: process.env.OPENAI_ASSISTANT_ID,
        });
        console.log("[/create] Run created:", run.id);

        let completed = false;
        const maxAttempts = 10;
        for (let i = 0; i < maxAttempts; i++) {
            console.log(`[/create] Polling run status... attempt ${i + 1}`);
            await new Promise((r) => setTimeout(r, 6000));
            const status = await openai.beta.threads.runs.retrieve(threadId, run.id);
            console.log("[/create] Run status:", status.status);
            if (status.status === "completed") {
                completed = true;
                break;
            } else if (["failed", "cancelled", "expired"].includes(status.status)) {
                throw new Error(`Run failed with status: ${status.status}`);
            }
        }

        if (!completed) {
            return res.status(500).json({ error: "Assistant took too long to respond." });
        }

        console.log("[/create] Fetching message from thread...");
        const messages = await openai.beta.threads.messages.list(threadId, { limit: 1 });
        console.log("[/create] Message fetched");

        const assistantMessage = messages.data.find(m => m.role === "assistant");

        let parsed = null;
        if (assistantMessage?.content?.[0]?.type === "text") {
            const raw = assistantMessage.content[0].text.value;
            console.log("[/create] Raw response:", raw);
            try {
                const cleaned = raw.trim().replace(/^```(?:json)?\s*/, '').replace(/```$/, '');
                parsed = JSON.parse(cleaned);
            } catch (e) {
                console.warn("[/create] Failed to parse JSON:", raw);
                return res.status(500).json({ error: "Assistant response was not valid JSON." });
            }
        }

        //Create the filled out results, add to the database

        res.json({ success: true, ...parsed });
    } catch (err) {
        console.error("Error in /create:", err);
        res.status(500).json({ error: "Failed to finalize match setup." });
    }
});

module.exports = router;
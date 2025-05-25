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
            `INSERT INTO Matches (id, threadId, createdBy, golfers, courseId, status) VALUES (?, ?, ?, ?, ?, ?)`,
            [
                matchId,
                thread.id,
                userId,
                JSON.stringify(golfers),
                course.CourseID,
                "COURSE_PROVIDED"
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

        console.log("[/tees] Updating match status...");
        await mariadbPool.query(
            "UPDATE Matches SET status = ? WHERE id = ?",
            ["TEES_PROVIDED", matchId]
        );
        console.log("[/tees] Update complete");

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
            "UPDATE Matches SET teeTime = ?, isPublic = ?, status = ? WHERE id = ?",
            [formattedTeeTime, isPublic ? 1 : 0, "RULES_PROVIDED", matchId]
        );
        console.log("[/create] Update complete");

        const prompt = `Based on the following match rules, generate a JSON object with:
        - "displayName": creative title
        - "scorecards": one per golfer, including name, tees, handicap (0 if unknown), and for each hole: holeNumber, par, yardage, allocation
        - "questions": array of additional questions needed per hole, formatted as:
        { "question": "string", "options": ["array", "of", "choices"] }

        Rules:
        ${rules}

        Respond ONLY with valid raw JSON.`.trim();

        const messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
            [
                messageId,
                threadId,
                "user",
                prompt,
            ]
        );

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

        res.json({ success: true, runId: run.id, threadId });
    } catch (err) {
        console.error("Error in /create:", err);
        res.status(500).json({ error: "Failed to finalize match setup." });
    }
});

router.get("/status", authenticateUser, async (req, res) => {
    try {
        //Get thread and run id
        const threadId = req.query.threadId;
        const runId = req.query.runId;
        const matchId = req.query.matchId;
        const status = await openai.beta.threads.runs.retrieve(threadId, runId);

        //TODO: Verify matchId and threadId

        console.log("[/status] Run status:", status.status);
        let completed = false;

        if (status.status === "completed") {
            completed = true;
        } else if (["failed", "cancelled", "expired"].includes(status.status)) {
            throw new Error(`Run failed with status: ${status.status}`);
        }

        if (!completed) {
            return res.status(200).json({ success: false, error: "Not completed" });
        }

        console.log("[/status] Fetching message from thread...");
        const messages = await openai.beta.threads.messages.list(threadId, { limit: 1 });
        console.log("[/status] Message fetched");

        const assistantMessage = messages.data.find(m => m.role === "assistant");

        let parsed = null;
        if (assistantMessage?.content?.[0]?.type === "text") {
            const raw = assistantMessage.content[0].text.value;
            //console.log("[/status] Raw response:", raw);
            try {
                const cleaned = raw.trim().replace(/^```(?:json)?\s*/, '').replace(/```$/, '');
                parsed = JSON.parse(cleaned);
                console.log("[/status] Parsed the response");
            } catch (e) {
                console.warn("[/status] Failed to parse JSON:", raw);
                return res.status(500).json({ error: "Assistant response was not valid JSON." });
            }
        }

        console.log("[/status] Updating questions, displayName, scorecards...");
        await mariadbPool.query(
            "UPDATE Matches SET displayName = ?, questions = ?, scorecards = ?, status = ? WHERE id = ?",
            [parsed?.displayName, JSON.stringify(parsed?.questions), JSON.stringify(parsed?.scorecards), "GENERATED", matchId]
        );
        console.log("[/status] Update complete");

        const messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
            [
                messageId,
                threadId,
                "system",
                JSON.stringify(parsed),
            ]
        );

        res.status(201).json({ success: true, ...parsed });
    } catch (err) {
        console.error("Error in /status:", err);
        res.status(500).json({ error: "Failed to finalize match setup." });
    }
});

router.post("/update", authenticateUser, async (req, res) => {
    const { matchId, newRules } = req.body;

    if (!matchId || !newRules) {
        return res.status(400).json({ error: "Missing matchId or newRules." });
    }

    try {
        console.log("[/update] Starting update process for matchId:", matchId);

        // Step 1: Fetch threadId
        console.log("[/update] Querying database for threadId...");
        const [rows] = await mariadbPool.query("SELECT threadId, questions, scorecards, displayName FROM Matches WHERE id = ?", [matchId]);
        if (rows.length === 0) {
            console.warn("[/update] No match found for matchId:", matchId);
            return res.status(404).json({ error: "Match not found." });
        }
        const threadId = rows[0].threadId;
        const questions = rows[0].questions;
        const scorecards = rows[0].scorecards;
        const displayName = rows[0]?.displayName;
        const promptObj = JSON.stringify({
            questions, scorecards, displayName
        })
        console.log("[/update] threadId found:", threadId);

        // Step 2: Send updated rule clarification
        const message = `New input from the user:
        ${newRules}

        Update the JSON object you created earlier in this thread to reflect these changes.

        Remember: only return valid raw JSON, no extra commentary.`.trim();

        console.log("[/update] Sending updated rules to thread...");
        await openai.beta.threads.messages.create(threadId, {
            role: "user",
            content: message,
        });
        console.log("[/update] Message sent to thread.");

        let messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
            [
                messageId,
                threadId,
                "user",
                message,
            ]
        );

        // Step 3: Start assistant run
        console.log("[/update] Starting assistant run...");
        const run = await openai.beta.threads.runs.create(threadId, {
            assistant_id: process.env.PROV2KEY,
        });
        console.log("[/update] Assistant run started. runId:", run.id);

        // Step 4: Poll for completion
        let status;
        const maxAttempts = 10;
        console.log("[/update] Polling run status...");
        for (let i = 0; i < maxAttempts; i++) {
            console.log(`[/update] Poll attempt ${i + 1}...`);
            await new Promise((r) => setTimeout(r, 6000));
            const runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
            status = runStatus.status;
            console.log(`[/update] Run status: ${status}`);

            if (status === "completed") break;
            if (["failed", "cancelled", "expired"].includes(status)) {
                throw new Error(`Run failed with status: ${status}`);
            }
        }

        if (status !== "completed") {
            console.error("[/update] Run did not complete within polling window.");
            return res.status(500).json({ error: "Assistant run did not complete in time." });
        }

        // Step 5: Parse assistant response
        console.log("[/update] Fetching assistant message from thread...");
        const messages = await openai.beta.threads.messages.list(threadId, { limit: 1 });
        const assistantMessage = messages.data.find(m => m.role === "assistant");

        let parsed = null;
        if (assistantMessage?.content?.[0]?.type === "text") {
            const raw = assistantMessage.content[0].text.value;
            console.log("[/update] Raw response from assistant:", raw.slice(0, 200) + "...");
            try {
                const cleaned = raw.trim().replace(/^```(?:json)?\s*/, '').replace(/```$/, '');
                parsed = JSON.parse(cleaned);
                console.log("[/update] Assistant response parsed successfully.");
            } catch (e) {
                console.warn("[/update] Failed to parse JSON:", raw);
                return res.status(500).json({ error: "Assistant response was not valid JSON." });
            }
        }

        console.log("[/update] Updating questions, displayName, scorecards...");
        await mariadbPool.query(
            "UPDATE Matches SET displayName = ?, questions = ?, scorecards = ? WHERE id = ?",
            [parsed?.displayName, JSON.stringify(parsed?.questions), JSON.stringify(parsed?.scorecards), matchId]
        );
        console.log("[/update] Update complete");

        messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
            [
                messageId,
                threadId,
                "system",
                JSON.stringify(parsed),
            ]
        );

        res.json({ success: true, ...parsed });
    } catch (err) {
        console.error("Error in /update:", err);
        res.status(500).json({ error: "Failed to update match rules." });
    }
});

router.post("/confirm", authenticateUser, async (req, res) => {
    const { matchId, threadId } = req.body;

    console.log("[/confirm] Updating match status...");
    await mariadbPool.query(
        "UPDATE Matches SET status = ? WHERE id = ?",
        ["CONFIRMED", matchId]
    );
    console.log("[/confirm] Update complete");

    const prompt = "This looks great. We're beginning the match. Be ready to receive player scores, answers to the questions, and potentially rules input as we play. Your task will be to keep everyone's scores, money, and likihood of winning.";
    console.log("[/confirm] Confirming setup on thread...");
    await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: prompt,
    });
    console.log("[/confirm] Message sent to thread.");

    const messageId = uuidv4();
    await mariadbPool.query(
        `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
        [
            messageId,
            threadId,
            "user",
            prompt,
        ]
    );

    res.json({ success: true });
});

module.exports = router;
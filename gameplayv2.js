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

function formatDateForSQL(isoString) {
    const date = new Date(isoString);
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

function filterMaleScorecardsBySelectedTees(teesByGolfer, scorecards) {
    const selectedTees = new Set(Object.values(teesByGolfer));
    return scorecards.filter(
        (card) => card.Gender === 'Male' && selectedTees.has(card.TeeSetRatingName)
    );
}

router.post("/begin", authenticateUser, async (req, res) => {
    const { golfers, course } = req.body;
    const userId = req.user.id;

    if (!golfers || !Array.isArray(golfers) || !course || !course.CourseID) {
        return res.status(400).json({ error: "Missing or invalid golfers or course." });
    }

    try {
        const [existing] = await mariadbPool.query("SELECT courseId FROM Courses WHERE courseId = ?", [course.CourseID]);
        if (existing.length === 0) {
            await mariadbPool.query(
                "INSERT INTO Courses (courseId, courseName, scorecards) VALUES (?, ?, ?)",
                [course.CourseID, course.FullName, JSON.stringify([])]
            );
        }

        const matchId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Matches (id, createdBy, golfers, courseId, status) VALUES (?, ?, ?, ?, ?)`,
            [matchId, userId, JSON.stringify(golfers), course.CourseID, "COURSE_PROVIDED"]
        );

        const messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
            [messageId, matchId, "user", `Golfers: ${JSON.stringify(golfers)} | Course: ${course.FullName}`]
        );

        res.json({ success: true, matchId });
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
        const [rows] = await mariadbPool.query("SELECT courseId FROM Matches WHERE id = ?", [matchId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const courseId = rows[0].courseId;
        await mariadbPool.query("UPDATE Courses SET scorecards = ? WHERE courseId = ?", [JSON.stringify(scorecards), courseId]);

        const filtered = filterMaleScorecardsBySelectedTees(teesByGolfer, scorecards);

        await mariadbPool.query("UPDATE Matches SET status = ? WHERE id = ?", ["TEES_PROVIDED", matchId]);

        const messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
            [messageId, matchId, "user", `Filtered scorecards: ${JSON.stringify(filtered)} | Tees by golfer: ${JSON.stringify(teesByGolfer)}`]
        );

        res.json({ success: true });
    } catch (err) {
        console.error("Error in /tees:", err);
        res.status(500).json({ error: "Failed to save tee info." });
    }
});

router.post("/create", authenticateUser, async (req, res) => {
    const { matchId, teeTime, isPublic, rules } = req.body;

    if (!matchId || !teeTime || typeof isPublic === 'undefined' || !rules) {
        return res.status(400).json({ error: "Missing required data." });
    }

    try {
        const [rows] = await mariadbPool.query("SELECT golfers, courseId FROM Matches WHERE id = ?", [matchId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const golfers = JSON.parse(rows[0].golfers);
        const formattedTeeTime = formatDateForSQL(teeTime);

        await mariadbPool.query(
            "UPDATE Matches SET teeTime = ?, isPublic = ?, status = ? WHERE id = ?",
            [formattedTeeTime, isPublic ? 1 : 0, "RULES_PROVIDED", matchId]
        );

        const allMessages = await mariadbPool.query("SELECT content FROM Messages WHERE threadId = ? ORDER BY createdAt ASC", [matchId]);
        const pastMessages = allMessages[0].map(m => ({ role: "user", content: m.content }));

        const prompt = `Based on the following match rules, generate a JSON object with:\n- \"displayName\": creative title\n- \"scorecards\": one per golfer, including name, tees, handicap (0 if unknown), and for each hole: holeNumber, par, yardage, allocation\n- \"questions\": array of additional questions needed per hole, formatted as { \"question\": \"string\", \"options\": [\"array\", \"of\", \"choices\"] }\n\nRules:\n${rules}\n\nRespond ONLY with valid raw JSON.`;

        const messages = [
            { role: "system", content: "You are a golf scoring assistant that returns only valid JSON." },
            ...pastMessages,
            { role: "user", content: prompt }
        ];

        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages,
            temperature: 0
        });

        const raw = completion.choices[0].message.content.trim();
        let parsed;
        try {
            const cleaned = raw.replace(/^```(?:json)?\s*/, '').replace(/```$/, '');
            parsed = JSON.parse(cleaned);
        } catch (err) {
            console.error("Failed to parse JSON:", raw);
            return res.status(500).json({ error: "Model response was not valid JSON." });
        }

        await mariadbPool.query(
            "UPDATE Matches SET displayName = ?, questions = ?, scorecards = ?, status = ? WHERE id = ?",
            [parsed.displayName, JSON.stringify(parsed.questions), JSON.stringify(parsed.scorecards), "GENERATED", matchId]
        );

        const messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
            [messageId, matchId, "system", JSON.stringify(parsed)]
        );

        res.status(201).json({ success: true, threadId: matchId, ...parsed });
    } catch (err) {
        console.error("Error in /create:", err);
        res.status(500).json({ error: "Failed to generate match setup." });
    }
});

router.post("/update", authenticateUser, async (req, res) => {
    const { matchId, newRules } = req.body;

    if (!matchId || !newRules) {
        return res.status(400).json({ error: "Missing matchId or newRules." });
    }

    try {
        const [rows] = await mariadbPool.query("SELECT questions, scorecards, displayName FROM Matches WHERE id = ?", [matchId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const allMessages = await mariadbPool.query("SELECT content FROM Messages WHERE threadId = ? ORDER BY createdAt ASC", [matchId]);
        const pastMessages = allMessages[0].map(m => ({ role: "user", content: m.content }));

        const prompt = `Here is the current match data:\nDisplay Name: ${rows[0].displayName}\nQuestions: ${rows[0].questions}\nScorecards: ${rows[0].scorecards}\n\nNew user input:\n${newRules}\n\nUpdate the JSON object accordingly and return only valid raw JSON.`;

        const messages = [
            { role: "system", content: "You are a golf scoring assistant that updates and returns only valid JSON." },
            ...pastMessages,
            { role: "user", content: prompt }
        ];

        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages,
            temperature: 0
        });

        const raw = completion.choices[0].message.content.trim();
        let parsed;
        try {
            const cleaned = raw.replace(/^```(?:json)?\s*/, '').replace(/```$/, '');
            parsed = JSON.parse(cleaned);
        } catch (err) {
            console.error("Failed to parse JSON:", raw);
            return res.status(500).json({ error: "Model response was not valid JSON." });
        }

        await mariadbPool.query(
            "UPDATE Matches SET displayName = ?, questions = ?, scorecards = ? WHERE id = ?",
            [parsed.displayName, JSON.stringify(parsed.questions), JSON.stringify(parsed.scorecards), matchId]
        );

        const messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
            [messageId, matchId, "system", JSON.stringify(parsed)]
        );

        res.json({ success: true, ...parsed });
    } catch (err) {
        console.error("Error in /update:", err);
        res.status(500).json({ error: "Failed to update match." });
    }
});

router.post("/confirm", authenticateUser, async (req, res) => {
    const { matchId } = req.body;

    try {
        const [rows] = await mariadbPool.query("SELECT scorecards FROM Matches WHERE id = ?", [matchId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const scorecards = JSON.parse(rows[0].scorecards);
        for (let i = 0; i < scorecards.length; i++) {
            scorecards[i].plusMinus = 0;
            scorecards[i].winPercent = 0.5;
            for (let j = 0; j < scorecards[i].holes.length; j++) {
                scorecards[i].holes[j].plusMinus = 0;
                scorecards[i].holes[j].score = 0;
            }
        }

        await mariadbPool.query(
            "UPDATE Matches SET status = ?, scorecards = ? WHERE id = ?",
            ["CONFIRMED", JSON.stringify(scorecards), matchId]
        );

        res.json({ success: true, scorecards });
    } catch (err) {
        console.error("Error in /confirm:", err);
        res.status(500).json({ error: "Failed to confirm match." });
    }
});

module.exports = router;
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

function buildScorecards(scorecards, playerTees, strokes) {
    const builtScorecards = [];

    for (const playerName in playerTees) {
        const teeName = playerTees[playerName];

        // Find the matching scorecard (by TeeSetRatingName)
        const scorecard = scorecards.find(sc => sc.TeeSetRatingName === teeName);
        if (!scorecard) {
            console.warn(`No scorecard found for tee: ${teeName}`);
            continue;
        }

        // Find the strokes data for this player
        const playerStrokes = strokes.find(s => s.name === playerName);
        if (!playerStrokes) {
            console.warn(`No strokes data found for player: ${playerName}`);
            continue;
        }

        // Build the holes array
        const holes = scorecard.Holes.map(hole => {
            // Find matching pop (based on allocation)
            const pop = playerStrokes.pops.find(p => p.allocation === hole.Allocation);
            return {
                holeNumber: hole.Number,
                allocation: hole.Allocation,
                yardage: hole.Length,
                par: hole.Par,
                plusMinus: 0,
                strokes: pop ? pop.strokes : 0
            };
        });

        // Sum total strokes (handicap)
        const handicap = playerStrokes.pops.reduce((sum, p) => sum + p.strokes, 0);

        builtScorecards.push({
            name: playerName,
            tees: teeName,
            handicap,
            plusMinus: 0,
            winPercent: 0.5,
            holes
        });
    }

    return builtScorecards;
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
            `INSERT INTO Matches (id, createdBy, golfers, courseId, status, threadId) VALUES (?, ?, ?, ?, ?, ?)`,
            [matchId, userId, JSON.stringify(golfers), course.CourseID, "COURSE_PROVIDED", matchId]
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

    if (!matchId || !teesByGolfer) {
        return res.status(400).json({ error: "Missing required data." });
    }

    try {
        const [rows] = await mariadbPool.query("SELECT courseId, scorecards FROM Matches WHERE id = ?", [matchId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        } else {
            const courseId = rows[0].courseId;
            const hasScorecards = rows[0].scorecards;
            if (!hasScorecards) {
                await mariadbPool.query("UPDATE Courses SET scorecards = ? WHERE courseId = ?", [JSON.stringify(scorecards), courseId]);
            }
        }

        await mariadbPool.query("UPDATE Matches SET status = ?, tees = ? WHERE id = ?", ["TEES_PROVIDED", JSON.stringify(teesByGolfer), matchId]);

        const messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
            [messageId, matchId, "user", `Tees by golfer: ${JSON.stringify(teesByGolfer)}`]
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
        const [rows1] = await mariadbPool.query("SELECT courseId, tees FROM Matches WHERE id = ?", [matchId]);
        if (rows1.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const courseId = rows1[0].courseId;
        const playerTees = JSON.parse(rows1[0].tees);
        const [rows2] = await mariadbPool.query("SELECT scorecards FROM Courses WHERE courseId = ?", [courseId]);
        if (rows2.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const scorecards = JSON.parse(rows2[0].scorecards);
        const allMessages = await mariadbPool.query("SELECT content FROM Messages WHERE threadId = ? ORDER BY createdAt ASC", [matchId]);
        const pastMessages = allMessages[0].map(m => ({ role: "user", content: m.content }));

        const prompt = `Based on the following match rules, generate a JSON object with:\n- \"displayName\": creative title\n- \"questions\": array of additional questions needed per hole, formatted as { \"question\": \"string\", \"options\": [\"array\", \"of\", \"choices\"] } (don't ever ask questions about player's scores or strokes)\n\"strokes\": array with golferName and pops as an array of strokes the golfer gets each hole based on their handicap and the hole handicap/allocation, e.g. {"name": "Mitch", "pops": [{"allocation": 1, "strokes": 1}, {"alloaction": 2, "strokes": 1}, ..., {"allocation": 18, "strokes": 0}] \n\nRules:\n${rules}\n\nRespond ONLY with valid raw JSON.`;

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

        const builtScorecards = buildScorecards(scorecards, playerTees, parsed?.strokes);

        console.log("Built a scorecard?", builtScorecards);

        if (buildScorecards?.length === 0) {
            return res.status(500).json({ error: "Couldn't build scorecard" });
        }

        const formattedTeeTime = formatDateForSQL(teeTime);

        await mariadbPool.query(
            "UPDATE Matches SET strokes = ?, teeTime = ?, isPublic = ?, displayName = ?, questions = ?, scorecards = ?, status = ? WHERE id = ?",
            [JSON.stringify(parsed?.strokes), formattedTeeTime, isPublic ? 1 : 0, parsed?.displayName, JSON.stringify(parsed?.questions), JSON.stringify(builtScorecards), "RULES_PROVIDED", matchId]
        );

        const messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
            [messageId, matchId, "system", JSON.stringify(parsed)]
        );

        res.status(201).json({ success: true, threadId: matchId, ...parsed, scorecards: builtScorecards });
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
        const [rows] = await mariadbPool.query("SELECT questions, strokes, displayName, scorecards FROM Matches WHERE id = ?", [matchId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const allMessages = await mariadbPool.query("SELECT content FROM Messages WHERE threadId = ? ORDER BY createdAt ASC", [matchId]);
        const pastMessages = allMessages[0].map(m => ({ role: "user", content: m.content }));

        const prompt = `Here is the current match data:\nDisplay Name: ${rows[0].displayName}\nQuestions: ${rows[0].questions}\nStrokes: ${rows[0].strokes}\n\nNew user input:\n${newRules}\n\nUpdate the JSON object accordingly and return only valid raw JSON.`;

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

        const builtScorecards = buildScorecards(scorecards, playerTees, parsed?.strokes);

        await mariadbPool.query(
            "UPDATE Matches SET displayName = ?, questions = ?, strokes = ?, scorecards = ? WHERE id = ?",
            [parsed.displayName, JSON.stringify(parsed.questions), JSON.stringify(parsed?.strokes), JSON.stringify(builtScorecards), matchId]
        );

        const messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
            [messageId, matchId, "system", JSON.stringify(parsed)]
        );

        res.json({ success: true, ...parsed, scorecards: builtScorecards });
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

        const messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
            [messageId, matchId, "user", "Everything looks good, get ready to track the results of the match"]
        );

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

router.post("/score/post", authenticateUser, async (req, res) => {

});

module.exports = router;
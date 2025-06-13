const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const authenticateUser = require('./authMiddleware');
const OpenAI = require("openai");
const { encoding_for_model } = require("tiktoken");
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const router = express.Router();

const model = "gpt-3.5-turbo"
//const model = "ft:gpt-3.5-turbo-1106:personal:golf-gpt-v3:BaGb45nx";
//const model = "ft:gpt-4o-2024-08-06:personal:golf-gpt-v2:BaG7XCTi";

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

function countTokensForMessages(messages) {
    const enc = encoding_for_model(model);
    let totalTokens = 0;

    for (const message of messages) {
        totalTokens += enc.encode(message.role).length;
        totalTokens += enc.encode(message.content).length;
        // Add ~4 tokens per message (OpenAI overhead estimate)
        totalTokens += 4;
    }
    // Add priming tokens (per OpenAI docs)
    totalTokens += 2;
    enc.free();
    return totalTokens;
}

function buildScorecards(scorecards, playerTees, strokes = [], holes) {
    const builtScorecards = [];

    for (const playerName in playerTees) {
        const teeName = playerTees[playerName];

        // Find the matching scorecard (by TeeSetRatingName)
        const scorecard = scorecards.find(sc => sc.TeeSetRatingName === teeName);
        if (!scorecard) {
            console.warn(`No scorecard found for tee: ${teeName}`);
            continue;
        }

        const isFront = teeName.includes("(Front 9)");
        const isBack = teeName.includes("(Back 9)");

        let filteredHoles = scorecard.Holes;

        if (holes === 9) {
            if (isFront) {
                filteredHoles = scorecard.Holes.filter(h => h.Number >= 1 && h.Number <= 9);
            } else if (isBack) {
                filteredHoles = scorecard.Holes.filter(h => h.Number >= 10 && h.Number <= 18);
            } else {
                console.warn(`Tee name "${teeName}" missing "(Front 9)" or "(Back 9)" label on 9-hole course.`);
                filteredHoles = []; // or default to front9/back9
            }
        }

        const playerStrokes = strokes.find(s => s.name === playerName) || { pops: [] };

        const holeObjects = filteredHoles.map(hole => {
            const pop = playerStrokes.pops.find(p => p.allocation === hole.Allocation || p.hole === hole.Number);
            return {
                holeNumber: hole.Number,
                allocation: hole.Allocation,
                yardage: hole.Length,
                par: hole.Par,
                plusMinus: 0,
                strokes: pop ? pop.strokes : 0,
                score: 0,
                point: 0
            };
        });

        const handicap = playerStrokes.pops.reduce((sum, p) => sum + (p.strokes || 0), 0);

        builtScorecards.push({
            name: playerName,
            tees: teeName,
            handicap,
            plusMinus: 0,
            winPercent: 0.5,
            holes: holeObjects
        });
    }

    return builtScorecards;
}

function generateSummary(scorecards) {
    if (!Array.isArray(scorecards) || scorecards.length === 0) return ""

    // 1. Count total holes played (i.e., at least one golfer has non-zero score)
    const holesPlayed = scorecards[0].holes.filter(hole =>
        scorecards.some(g => {
            const h = g.holes.find(x => x.holeNumber === hole.holeNumber)
            return h?.score && h.score !== 0
        })
    ).length

    if (holesPlayed === 0) return ""

    // 2. Check plusMinus standings
    const maxPlusMinus = Math.max(...scorecards.map(g => g.plusMinus))
    const leaders = scorecards.filter(g => g.plusMinus === maxPlusMinus)

    if (maxPlusMinus !== 0 && leaders.length < scorecards.length) {
        const names = leaders.map(g => g.name)
        const joined = names.length === 1
            ? names[0]
            : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]
        return `${joined} ${names.length === 1 ? "is" : "are"} up $${maxPlusMinus} through ${holesPlayed}`
    }

    // 3. Check points if money is tied
    const maxPoints = Math.max(...scorecards.map(g =>
        g.holes.reduce((sum, h) => sum + (h.point || 0), 0)
    ))

    if (maxPoints > 0) {
        const pointLeaders = scorecards.filter(g =>
            g.holes.reduce((sum, h) => sum + (h.point || 0), 0) === maxPoints
        )

        const names = pointLeaders.map(g => g.name)
        const joined = names.length === 1
            ? names[0]
            : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]

        return `${joined} ${names.length === 1 ? "is" : "are"} up ${maxPoints} through ${holesPlayed}`
    }

    // 4. Everything tied
    return `Tied through ${holesPlayed}`
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
            `INSERT INTO Messages (id, threadId, role, type, content) VALUES (?, ?, ?, ?, ?)`,
            [messageId, matchId, "user", "setup", `I'm playing a golf match and want you to keep score. Golfers: ${JSON.stringify(golfers)} | Course: ${course.FullName}`]
        );

        res.json({ success: true, matchId });
    } catch (err) {
        console.error("Error in /begin:", err);
        res.status(500).json({ error: "Failed to initialize match." });
    }
});

router.post("/tees", authenticateUser, async (req, res) => {
    const { matchId, scorecards, teesByGolfer, holes } = req.body;

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

        await mariadbPool.query("UPDATE Matches SET status = ?, tees = ?, holeCount = ? WHERE id = ?", ["TEES_PROVIDED", JSON.stringify(teesByGolfer), holes, matchId]);

        const messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, type, content) VALUES (?, ?, ?, ?, ?)`,
            [messageId, matchId, "user", "setup", `Tees by golfer: ${JSON.stringify(teesByGolfer)}`]
        );

        res.json({ success: true });
    } catch (err) {
        console.error("Error in /tees:", err);
        res.status(500).json({ error: "Failed to save tee info." });
    }
});

router.post("/create", authenticateUser, async (req, res) => {
    const { matchId, teeTime, isPublic, rules, expected } = req.body;

    if (!matchId || !teeTime || typeof isPublic === 'undefined') {
        return res.status(400).json({ error: "Missing required data." });
    }

    try {
        const [rows1] = await mariadbPool.query("SELECT courseId, tees, holeCount FROM Matches WHERE id = ?", [matchId]);
        if (rows1.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const courseId = rows1[0].courseId;
        const playerTees = JSON.parse(rows1[0].tees);
        const holes = rows1[0].holeCount;
        const [rows2] = await mariadbPool.query("SELECT scorecards FROM Courses WHERE courseId = ?", [courseId]);
        if (rows2.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const scorecards = JSON.parse(rows2[0].scorecards);
        const allMessages = await mariadbPool.query("SELECT content FROM Messages WHERE threadId = ? and role = 'user' ORDER BY createdAt ASC", [matchId]);
        const pastMessages = allMessages[0].map(m => ({ role: "user", content: m.content }));

        const prompt = `Based on the following description of the golf match we're playing, generate a JSON object with the questions and stroke holes needed to score it.\n\nRules:\n${rules || "No rules just a regular game"}\n\nRespond ONLY with valid raw JSON.`;

        const messages = [
            { role: "system", content: "You are a golf scoring assistant that returns only valid JSON." },
            ...pastMessages,
            { role: "user", content: prompt }
        ];

        let messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, type, content) VALUES (?, ?, ?, ?, ?)`,
            [messageId, matchId, "user", "setup", prompt]
        );

        const tokenCount = countTokensForMessages(messages);
        console.log(`Sending ${tokenCount} tokens to OpenAI.`);

        let parsed;
        if (!expected) {
            const completion = await openai.chat.completions.create({
                model,
                messages,
                temperature: 0
            });

            const raw = completion.choices[0].message.content.trim();

            try {
                const cleaned = raw.replace(/^```(?:json)?\s*/, '').replace(/```$/, '');
                parsed = JSON.parse(cleaned);
            } catch (err) {
                console.error("Failed to parse JSON:", raw);
                return res.status(500).json({ error: "Model response was not valid JSON." });
            }

            console.log("Expected", JSON.stringify(expected));
        } else {
            parsed = expected;
        }

        const builtScorecards = buildScorecards(scorecards, playerTees, parsed?.strokes, holes);

        console.log("Built a scorecard");

        if (builtScorecards?.length === 0) {
            return res.status(500).json({ error: "Couldn't build scorecard" });
        }

        const formattedTeeTime = formatDateForSQL(teeTime);

        await mariadbPool.query(
            "UPDATE Matches SET strokes = ?, teeTime = ?, isPublic = ?, displayName = ?, questions = ?, scorecards = ?, status = ? WHERE id = ?",
            [JSON.stringify(parsed?.strokes), formattedTeeTime, isPublic ? 1 : 0, parsed?.displayName, JSON.stringify(parsed?.questions), JSON.stringify(builtScorecards), "RULES_PROVIDED", matchId]
        );

        messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, type, content) VALUES (?, ?, ?, ?, ?)`,
            [messageId, matchId, "assistant", "json", JSON.stringify(parsed, null, 2)]
        );

        res.status(201).json({ success: true, ...parsed, scorecards: builtScorecards });
    } catch (err) {
        console.error("Error in /create:", err);
        res.status(500).json({ error: "Failed to generate match setup." });
    }
});

router.post("/update", authenticateUser, async (req, res) => {
    const { matchId, newRules, expected } = req.body;

    if (!matchId || !newRules) {
        return res.status(400).json({ error: "Missing matchId or newRules." });
    }

    try {
        const [rows1] = await mariadbPool.query("SELECT courseId, tees, displayName, questions, strokes, holeCount FROM Matches WHERE id = ?", [matchId]);
        if (rows1.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const courseId = rows1[0]?.courseId;
        const playerTees = JSON.parse(rows1[0]?.tees);
        const holes = rows1[0].holeCount;

        const allMessages = await mariadbPool.query("SELECT content FROM Messages WHERE threadId = ? and role = 'user' ORDER BY createdAt ASC", [matchId]);
        const pastMessages = allMessages[0].map(m => ({ role: "user", content: m.content }));

        const [rows2] = await mariadbPool.query("SELECT scorecards FROM Courses WHERE courseId = ?", [courseId]);
        if (rows2.length === 0) {
            return res.status(404).json({ error: "Course not found." });
        }

        const prompt = `New user input:\n${newRules}\n\nUpdate the questions stroke holes accordingly and return only valid raw JSON.`;

        const messages = [
            { role: "system", content: "You are a golf scoring assistant that updates and returns only valid JSON." },
            ...pastMessages,
            { role: "user", content: prompt }
        ];

        let messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, type, content) VALUES (?, ?, ?, ?, ?)`,
            [messageId, matchId, "user", "setup", newRules]
        );

        const tokenCount = countTokensForMessages(messages);
        console.log(`Sending ${tokenCount} tokens to OpenAI.`);

        let parsed;
        if (!expected) {
            const completion = await openai.chat.completions.create({
                model,
                messages,
                temperature: 0
            });

            const raw = completion.choices[0].message.content.trim();

            try {
                const cleaned = raw.replace(/^```(?:json)?\s*/, '').replace(/```$/, '');
                parsed = JSON.parse(cleaned);
            } catch (err) {
                console.error("Failed to parse JSON:", raw);
                return res.status(500).json({ error: "Model response was not valid JSON." });
            }
        } else {
            parsed = expected;
        }

        const scorecards = JSON.parse(rows2[0].scorecards);
        const builtScorecards = buildScorecards(scorecards, playerTees, parsed?.strokes, holes);

        console.log("Updated a scorecard");

        if (builtScorecards?.length === 0) {
            return res.status(500).json({ error: "Couldn't build scorecard" });
        }

        await mariadbPool.query(
            "UPDATE Matches SET displayName = ?, questions = ?, strokes = ?, scorecards = ? WHERE id = ?",
            [parsed.displayName, JSON.stringify(parsed.questions), JSON.stringify(parsed?.strokes), JSON.stringify(builtScorecards), matchId]
        );

        messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, type, content) VALUES (?, ?, ?, ?, ?)`,
            [messageId, matchId, "assistant", "json", JSON.stringify(parsed, null, 2)]
        );

        res.status(201).json({ success: true, ...parsed, scorecards: builtScorecards });
    } catch (err) {
        console.error("Error in /update:", err);
        res.status(500).json({ error: "Failed to update match." });
    }
});

router.post("/confirm", authenticateUser, async (req, res) => {
    const { matchId } = req.body;

    try {
        const [rows] = await mariadbPool.query("SELECT scorecards, status FROM Matches WHERE id = ?", [matchId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const scorecards = JSON.parse(rows[0]?.scorecards);

        if (rows[0]?.status === "RULES_PROVIDED") {
            const prompt = `Everything looks good, get ready to track the results of the match.`;

            const messageId = uuidv4();
            await mariadbPool.query(
                `INSERT INTO Messages (id, threadId, role, type, content) VALUES (?, ?, ?, ?, ?)`,
                [messageId, matchId, "user", "setup", prompt]
            );
        }

        await mariadbPool.query(
            "UPDATE Matches SET status = ? WHERE id = ?",
            ["READY_TO_START", matchId]
        );

        res.json({ success: true, scorecards });
    } catch (err) {
        console.error("Error in /confirm:", err);
        res.status(500).json({ error: "Failed to confirm match." });
    }
});

router.post("/score/submit", authenticateUser, async (req, res) => {
    const { matchId, holeNumber, scores, answeredQuestions, expected } = req.body;

    if (!matchId || !holeNumber || !scores) {
        return res.status(400).json({ error: "Missing required fields." });
    }

    try {
        const [rows] = await mariadbPool.query("SELECT scorecards, setup FROM Matches WHERE id = ?", [matchId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const scorecards = JSON.parse(rows[0].scorecards);
        let summaryResponse = rows[0].setup;
        let prompt = `Here are the hole results for hole ${holeNumber}\nScores: ${JSON.stringify(scores, null, 2)}\nQuestion Answers: ${JSON.stringify(answeredQuestions, null, 2)}\nRespond with the data for this hole and any other hole this score affects.`;

        let playedHole = false;
        for (let i = 0; i < scorecards?.length; i++) {
            for (let j = 0; j < scorecards[i]?.holes?.length; j++) {
                if (scorecards[i]?.holes[j]?.holeNumber === holeNumber && scorecards[i]?.holes[j]?.score > 0) {
                    playedHole = true;
                    break;
                }
            }

            if (playedHole) {
                break;
            }
        }

        if (playedHole) {
            prompt = `I've updated results for hole ${holeNumber}\nScores: ${JSON.stringify(scores, null, 2)}\nQuestion Answers: ${JSON.stringify(answeredQuestions, null, 2)}\nRespond with the data for this hole and any other hole this update affects.`;
        }

        const [allMessages] = await mariadbPool.query(
            "SELECT type, content FROM Messages WHERE threadId = ? AND role = 'user' ORDER BY createdAt ASC",
            [matchId]
        );

        const setupContent = allMessages
            .filter(msg => msg.type === 'setup')
            .map(msg => ({ role: "user", content: msg.content }));

        const scoreContent = allMessages
            .filter(msg => msg.type === 'score')
            .map(msg => ({ role: "user", content: msg.content }));

        if (!summaryResponse) {
            summaryResponse = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: `You're assisting in summarizing a golf match setup for a scoring assistant. Return a single concise paragraph describing who is playing, any strokes given, and any provided rules of the golf match.`
                    },
                    ...setupContent,
                    { role: "user", content: "Summarize this match setup clearly and concisely." }
                ],
                temperature: 0.2,
            });

            await mariadbPool.query(
                "UPDATE Matches SET setup = ? WHERE id = ?",
                [summaryResponse, matchId]
            );
        }

        const messages = [
            {
                role: "system",
                content:
                    "You are a golf scoring assistant that updates scorecards based on hole-by-hole results and your understanding of the rules. Always respond ONLY with valid raw JSON."
            },
            {
                role: "system",
                content: summaryResponse.choices[0].message.content || "No summary available."
            },
            ...scoreContent,
            { role: "user", content: prompt }
        ];

        const tokenCount = countTokensForMessages(messages);
        console.log(`Sending ${tokenCount} tokens to OpenAI.`);

        let messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, type, content) VALUES (?, ?, ?, ?, ?)`,
            [messageId, matchId, "user", "score", prompt]
        );

        let parsed;
        if (!expected) {
            const completion = await openai.chat.completions.create({
                model,
                messages,
                temperature: 0
            });

            const raw = completion.choices[0].message.content.trim();

            try {
                const cleaned = raw.replace(/^```(?:json)?\s*/, '').replace(/```$/, '');
                parsed = JSON.parse(cleaned);
            } catch (err) {
                console.error("Failed to parse JSON:", raw);
                return res.status(500).json({ error: "Model response was not valid JSON." });
            }
        } else {
            parsed = expected;
        }

        //Use the plusMinus info and posted scores to populate the scorecards and return it (update in the db)
        for (let i = 0; i < scorecards?.length; i++) {
            let scorecard = scorecards[i];

            for (let m = 0; m < parsed?.length; m++) {
                for (let j = 0; j < parsed[m]?.results?.length; j++) {
                    if (parsed[m]?.results[j].name === scorecard.name) {
                        for (let k = 0; k < scorecard.holes.length; k++) {
                            if (scorecard.holes[k].holeNumber === holeNumber) {
                                scorecard.holes[k].plusMinus = parsed[m]?.results[j].plusMinus;
                                scorecard.holes[k].score = parsed[m]?.results[j].score;
                                scorecard.holes[k].point = parsed[m]?.results[j].point;
                                break;
                            }
                        }

                        break;
                    }
                }
            }

            scorecards[i] = scorecard;
        }

        //Loop through scorecards and update plusMinus and handicap
        let allHolesPlayed = true;
        for (i = 0; i < scorecards.length; i++) {
            let plusMinus = 0;
            let handicap = 0;
            let points = 0;
            let golferPlayedAllHoles = true;

            for (j = 0; j < scorecards[i].holes.length; j++) {
                plusMinus += scorecards[i].holes[j].plusMinus;
                handicap += scorecards[i].holes[j].strokes;
                points += scorecards[i].holes[j].point;

                if (scorecards[i].holes[j].score === 0) {
                    golferPlayedAllHoles = false;
                }
            }

            scorecards[i].plusMinus = plusMinus;
            scorecards[i].handicap = handicap;
            scorecards[i].points = points;

            if (allHolesPlayed && !golferPlayedAllHoles) {
                allHolesPlayed = false;
            }
        }

        console.log("[score/submit] scorecard updated");

        let status = "IN_PROGRESS";
        if (allHolesPlayed) {
            status = "COMPLETED";
        }

        const summary = generateSummary(scorecards);

        await mariadbPool.query(
            "UPDATE Matches SET scorecards = ?, summary = ?, status = ? WHERE id = ?",
            [JSON.stringify(scorecards), summary, status, matchId]
        );

        messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, type, content) VALUES (?, ?, ?, ?, ?)`,
            [messageId, matchId, "assistant", "json", JSON.stringify(parsed, null, 2)]
        );

        res.json({ success: true, scorecards, status: summary });
    } catch (err) {
        console.error("Error in /score/submit:", err);
        res.status(500).json({ error: "Failed to submit scores" });
    }
});

router.get("/matches", authenticateUser, async (req, res) => {
    const userId = req.user.id;

    try {
        const [rows] = await mariadbPool.query(
            `SELECT m.id, m.displayName, m.golfers, m.status, m.isPublic, m.questions, m.strokes, m.summary, m.teeTime, m.scorecards, m.updatedAt, m.courseId,
                    c.courseId AS courseId, c.courseName AS courseName
             FROM Matches m
             LEFT JOIN Courses c ON m.courseId = c.courseId
             WHERE m.createdBy = ? 
               AND m.status IN ('RULES_PROVIDED', 'READY_TO_START', 'IN_PROGRESS', 'COMPLETED') 
             ORDER BY m.updatedAt DESC`,
            [userId]
        );

        const parsedMatches = rows.map(match => ({
            id: match.id,
            displayName: match.displayName,
            golfers: match.golfers ? JSON.parse(match.golfers) : [],
            scorecards: match.scorecards ? JSON.parse(match.scorecards) : [],
            questions: match.questions ? JSON.parse(match.questions) : [],
            strokes: match.strokes ? JSON.parse(match.strokes) : [],
            isPublic: match.isPublic,
            summary: match.summary,
            status: match.status,
            teeTime: match.teeTime,
            updatedAt: match.updatedAt,
            course: match.courseId ? {
                courseId: match.courseId,
                courseName: match.courseName
            } : null
        }));

        res.json({ success: true, matches: parsedMatches });
    } catch (err) {
        console.error("Error in /matches:", err);
        res.status(500).json({ error: "Failed to fetch user matches." });
    }
});

router.get("/golfers", authenticateUser, async (req, res) => {
    const userId = req.user.id;

    try {
        const [rows] = await mariadbPool.query(
            `SELECT golfers from Matches where createdBy = ? 
             ORDER BY updatedAt DESC LIMIT 10`,
            [userId]
        );

        let golfers = [];
        for (let i = 0; i < rows.length; i++) {
            let matchGs = JSON.parse(rows[i].golfers);
            for (let j = 0; j < matchGs.length; j++) {
                if (!golfers.includes(matchGs[j])) {
                    golfers.push(matchGs[j]);
                }
            }
        }

        res.json({ success: true, golfers });
    } catch (err) {
        console.error("Error in /matches:", err);
        res.status(500).json({ error: "Failed to fetch user matches." });
    }
});

router.get("/courses", authenticateUser, async (req, res) => {
    const userId = req.user.id;

    try {
        const [rows] = await mariadbPool.query(
            `SELECT c.*
                FROM Courses c
                JOIN (
                    SELECT DISTINCT courseId
                    FROM Matches
                    WHERE createdBy = ?
                    ORDER BY updatedAt DESC
                    LIMIT 10
                ) m ON c.courseId = m.courseId;`,
            [userId]
        );

        let courses = [];
        for (let i = 0; i < rows?.length; i++) {
            courses.push(rows[i]);
        }

        console.log(courses);

        res.json({ success: true, courses });
    } catch (err) {
        console.error("Error in /matches:", err);
        res.status(500).json({ error: "Failed to fetch user matches." });
    }
});

module.exports = router;
const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const authenticateUser = require('./authMiddleware');
const OpenAI = require("openai");
const { encoding_for_model } = require("tiktoken");
require('dotenv').config();
const { buildScorecards, blankAnswers, deepEqual } = require('./train/utils')

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const router = express.Router();

const model = "ft:gpt-3.5-turbo-1106:personal:golfgpt-v5:Bkdjw4gp";
//const model = "gpt-3.5-turbo"
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
    const enc = encoding_for_model("gpt-3.5-turbo-1106")
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

async function canUserAccessMatch(matchId, userId) {
    const sql = `
      SELECT 1 FROM Matches
      WHERE id = ?
        AND (
          createdBy = ?
          OR JSON_CONTAINS(golferIds, JSON_QUOTE(?))
        )
      LIMIT 1
    `;

    try {
        const result = await mariadbPool.query(sql, [matchId, userId, userId]);
        return result.length > 0;
    } catch (err) {
        console.error('Error checking match access:', err);
        throw err;
    }
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
        g.holes.reduce((sum, h) => sum + (h.points || 0), 0)
    ))

    if (maxPoints > 0) {
        const pointLeaders = scorecards.filter(g =>
            g.holes.reduce((sum, h) => sum + (h.points || 0), 0) === maxPoints
        )

        const names = pointLeaders.map(g => g.name)
        const joined = names.length === 1
            ? names[0]
            : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]

        return `${joined} ${names.length === 1 ? "is" : "are"} up ${maxPoints} through ${holesPlayed}`
    }

    // 4. Everything tied
    return `Tied through ${holesPlayed}`;
}

router.post("/begin", authenticateUser, async (req, res) => {
    const { golfers, golferIds, course } = req.body;
    const userId = req.user.id;

    if (!golfers || !Array.isArray(golfers) || !course || !course.CourseID) {
        return res.status(400).json({ error: "Missing or invalid golfers or course." });
    }

    try {
        const [existing] = await mariadbPool.query("SELECT courseId FROM Courses WHERE courseId = ?", [course.CourseID]);
        if (existing.length === 0) {
            await mariadbPool.query(
                "INSERT INTO Courses (courseId, courseName, scorecards, nineScorecards) VALUES (?, ?, ?, ?)",
                [course.CourseID, course.FullName, JSON.stringify([]), JSON.stringify([])]
            );
        }

        const matchId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Matches (id, createdBy, golfers, golferIds, courseId, status) VALUES (?, ?, ?, ?, ?, ?)`,
            [matchId, userId, JSON.stringify(golfers), JSON.stringify(golferIds), course.CourseID, "COURSE_PROVIDED"]
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
        if (!(await canUserAccessMatch(matchId, req.user.id))) {
            return res.status(404).json({ error: "Not authorized to update match." });
        }

        const [rows] = await mariadbPool.query("SELECT courseId FROM Matches WHERE id = ?", [matchId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        } else {
            const courseId = rows[0].courseId;
            const [rows2] = await mariadbPool.query("SELECT scorecards, nineScorecards FROM Courses WHERE courseId = ?", [courseId]);
            const fullScorecards = rows2[0].scorecards;
            const nineScorecards = rows2[0].nineScorecards;

            if (fullScorecards === "[]" && holes === 18) {
                await mariadbPool.query("UPDATE Courses SET scorecards = ? WHERE courseId = ?", [JSON.stringify(scorecards), courseId]);
            } else if (nineScorecards === "[]" && holes === 9) {
                await mariadbPool.query("UPDATE Courses SET nineScorecards = ? WHERE courseId = ?", [JSON.stringify(scorecards), courseId]);
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
        if (!(await canUserAccessMatch(matchId, req.user.id))) {
            return res.status(404).json({ error: "Not authorized to update match." });
        }

        const [rows1] = await mariadbPool.query("SELECT courseId, tees, holeCount, golfers, golferIds FROM Matches WHERE id = ?", [matchId]);
        if (rows1.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const courseId = rows1[0].courseId;
        const playerTees = JSON.parse(rows1[0].tees);
        const holes = rows1[0].holeCount;
        const golfers = JSON.parse(rows1[0].golfers);
        const golferIds = JSON.parse(rows1[0].golferIds);

        const [rows2] = await mariadbPool.query("SELECT scorecards, nineScorecards FROM Courses WHERE courseId = ?", [courseId]);
        if (rows2.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const scorecards = JSON.parse(rows2[0].scorecards);
        const nineScorecards = JSON.parse(rows2[0].nineScorecards);
        const allMessages = await mariadbPool.query("SELECT content FROM Messages WHERE threadId = ? and role = 'user' ORDER BY createdAt ASC", [matchId]);
        const pastMessages = allMessages[0].map(m => ({ role: "user", content: m.content }));

        if (golferIds?.includes(req.user.id)) {
            pastMessages.unshift({ role: "system", content: `The golfer creating the match is named ${golfers[golferIds.indexOf(req.user.id)]}. They might refer to themselves a "Me" or "I".` });
        }

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
                temperature: 0.2
            });

            const raw = completion.choices[0].message.content.trim();

            console.log("raw:", raw);

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

        const builtScorecards = buildScorecards(holes === 18 ? scorecards : nineScorecards, playerTees, parsed?.strokes, holes);

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
        if (!(await canUserAccessMatch(matchId, req.user.id))) {
            return res.status(404).json({ error: "Not authorized to update match." });
        }

        const [rows1] = await mariadbPool.query("SELECT courseId, tees, displayName, golfers, golferIds, questions, strokes, holeCount FROM Matches WHERE id = ?", [matchId]);
        if (rows1.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const courseId = rows1[0]?.courseId;
        const playerTees = JSON.parse(rows1[0]?.tees);
        const holes = rows1[0].holeCount;
        const golfers = JSON.parse(rows1[0].golfers);
        const golferIds = JSON.parse(rows1[0].golferIds);

        const allMessages = await mariadbPool.query("SELECT content FROM Messages WHERE threadId = ? and role = 'user' ORDER BY createdAt ASC", [matchId]);
        const pastMessages = allMessages[0].map(m => ({ role: "user", content: m.content }));

        const [rows2] = await mariadbPool.query("SELECT scorecards, nineScorecards FROM Courses WHERE courseId = ?", [courseId]);
        if (rows2.length === 0) {
            return res.status(404).json({ error: "Course not found." });
        }

        if (golferIds?.includes(req.user.id)) {
            pastMessages.unshift({ role: "system", content: `The golfer creating the match is named "${golfers[golferIds.indexOf(req.user.id)]}". They might refer to themselves a "Me" or "I".` });
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
                temperature: 0.0
            });

            const raw = completion.choices[0].message.content.trim();

            console.log("raw update:", raw);

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
        const nineScorecards = JSON.parse(rows2[0].nineScorecards);
        const builtScorecards = buildScorecards(holes === 18 ? scorecards : nineScorecards, playerTees, parsed?.strokes, holes);

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
        if (!(await canUserAccessMatch(matchId, req.user.id))) {
            return res.status(404).json({ error: "Not authorized to update match." });
        }

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
            "UPDATE Matches SET status = ?, answers = ? WHERE id = ?",
            ["READY_TO_START", blankAnswers(scorecards), matchId]
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
        if (!(await canUserAccessMatch(matchId, req.user.id))) {
            return res.status(404).json({ error: "Not authorized to update match." });
        }

        const [rows] = await mariadbPool.query("SELECT scorecards, setup, golfers, golferIds, answers FROM Matches WHERE id = ?", [matchId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const scorecards = JSON.parse(rows[0].scorecards);
        const answers = JSON.parse(rows[0].answers);
        const golfers = JSON.parse(rows[0].golfers);
        const golferIds = JSON.parse(rows[0].golferIds);

        let summaryResponse = rows[0].setup;
        let prompt = `Here are the hole results for hole ${holeNumber}\nScores: ${JSON.stringify(scores, null, 2)}\nQuestion Answers: ${JSON.stringify(answeredQuestions, null, 2)}\nRespond with a JSON array containing the points, plusMinus, holeNumber, score, and name for each golfer on this hole and any other hole this score affects.`;

        let playedHole = false;
        let hasUpdate = false;
        for (let i = 0; i < scorecards?.length; i++) {
            for (let j = 0; j < scorecards[i]?.holes?.length; j++) {
                if (scorecards[i]?.holes[j]?.holeNumber === holeNumber && scorecards[i]?.holes[j]?.score > 0) {
                    playedHole = true;

                    for (let k = 0; k < scores.length; k++) {
                        if (scorecards[i]?.name === scores[k].name && scorecards[i]?.holes[j]?.score !== scores[k].score) {
                            hasUpdate = true;
                        }
                    }

                    break;
                }
            }
        }

        if (!hasUpdate && playedHole) {
            for (let i = 0; i < answers?.length; i++) {
                if (answers[i].hole === holeNumber && !deepEqual(answers[i].answers, answeredQuestions)) {
                    hasUpdate = true;
                    break;
                }
            }

            if (!hasUpdate) {
                console.log("Nothing to update", scores);
                res.json({ success: true, scorecards, status: generateSummary(scorecards), answers });
                return;
            }
        }

        if (playedHole) {
            prompt = `I've updated results for hole ${holeNumber}\nScores: ${JSON.stringify(scores, null, 2)}\nQuestion Answers: ${JSON.stringify(answeredQuestions, null, 2)}\nRespond with a JSON array containing the points, plusMinus, holeNumber, score, and name for each golfer on this hole and any other hole this score affects.`;
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
            if (golferIds?.includes(req.user.id)) {
                setupContent.unshift({ role: "system", content: `The golfer creating the match is named "${golfers[golferIds.indexOf(req.user.id)]}". They might refer to themselves a "Me" or "I". Use their full name when generating the summary.` });
            }

            summaryResponse = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: `You're assisting in summarizing a golf match setup for a scoring assistant. Return a single concise paragraph describing who is playing, any strokes given, and any provided rules and dollar values of the golf match.`
                    },
                    ...setupContent,
                    { role: "user", content: "Summarize this match setup clearly and concisely." }
                ],
                temperature: 0.2,
            });

            if (summaryResponse.choices[0].message.content) {
                await mariadbPool.query(
                    "UPDATE Matches SET setup = ? WHERE id = ?",
                    [summaryResponse.choices[0].message.content, matchId]
                );

                summaryResponse = summaryResponse.choices[0].message.content;
            } else {
                summaryResponse = "No summary available.";
            }
        }

        const messages = [
            {
                role: "system",
                content:
                    "You are a golf scoring assistant that updates scorecards based on hole-by-hole results and your understanding of the rules. Always respond ONLY with valid raw JSON."
            },
            {
                role: "system",
                content: summaryResponse || "No summary available."
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
                temperature: 0.0
            });

            const raw = completion.choices[0].message.content.trim();
            console.log("raw:", raw);

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
                if (parsed[m].name === scorecard.name) {
                    for (let k = 0; k < scorecard.holes.length; k++) {
                        if (scorecard.holes[k].holeNumber === parsed[m].holeNumber) {
                            scorecard.holes[k].plusMinus = parsed[m].plusMinus;
                            scorecard.holes[k].score = parsed[m].score;
                            scorecard.holes[k].points = parsed[m].points;
                            break;
                        }
                    }

                    break;
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
                points += scorecards[i].holes[j].points;

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

        for (let i = 0; i < answers?.length; i++) {
            if (answers[i].hole === holeNumber) {
                answers[i].answers = answeredQuestions;
            }
        }

        let status = "IN_PROGRESS";
        if (allHolesPlayed) {
            status = "COMPLETED";
        }

        const summary = generateSummary(scorecards);

        await mariadbPool.query(
            "UPDATE Matches SET scorecards = ?, summary = ?, answers = ?, status = ? WHERE id = ?",
            [JSON.stringify(scorecards), summary, JSON.stringify(answers), status, matchId]
        );

        messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, type, content) VALUES (?, ?, ?, ?, ?)`,
            [messageId, matchId, "assistant", "json", JSON.stringify(parsed, null, 2)]
        );

        res.json({ success: true, scorecards, status: summary, answers });
    } catch (err) {
        console.error("Error in /score/submit:", err);
        res.status(500).json({ error: "Failed to submit scores" });
    }
});

router.get("/matches", authenticateUser, async (req, res) => {
    const userId = req.user.id;

    try {
        const [rows] = await mariadbPool.query(
            `SELECT m.id, m.displayName, m.golfers, m.golferIds, m.status, m.isPublic, m.questions, m.answers, m.strokes, m.summary, m.teeTime, m.scorecards, m.updatedAt, m.courseId,
                    c.courseId AS courseId, c.courseName AS courseName
             FROM Matches m
             LEFT JOIN Courses c ON m.courseId = c.courseId
             WHERE (
                createdBy = ?
                OR JSON_CONTAINS(golferIds, JSON_QUOTE(?))
            )
               AND m.status IN ('RULES_PROVIDED', 'READY_TO_START', 'IN_PROGRESS', 'COMPLETED') 
             ORDER BY m.updatedAt DESC, m.serial DESC 
             LIMIT 10`,
            [userId, userId]
        );

        const parsedMatches = rows.map(match => ({
            id: match.id,
            displayName: match.displayName,
            golfers: match.golfers ? JSON.parse(match.golfers) : [],
            golferIds: match.golferIds ? JSON.parse(match.golferIds) : [],
            scorecards: match.scorecards ? JSON.parse(match.scorecards) : [],
            questions: match.questions ? JSON.parse(match.questions) : [],
            answers: match.answers ? JSON.parse(match.answers) : [],
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
            `SELECT golfers, golferIds FROM Matches 
         WHERE createdBy = ? 
         ORDER BY updatedAt DESC LIMIT 6`,
            [userId]
        );

        const uniqueGolfers = new Map(); // Key: name + id
        const idLookup = new Set();      // Collect non-guest IDs

        for (const row of rows) {
            const names = JSON.parse(row.golfers);     // array of names
            const ids = JSON.parse(row.golferIds);     // array of ids

            for (let i = 0; i < names.length; i++) {
                const name = names[i].replace(/\s?\((You|G|[1-5])\)/g, '').trim();
                const id = ids[i];
                const key = `${name}:${id}`;

                if (!uniqueGolfers.has(key)) {
                    uniqueGolfers.set(key, { name, id });
                    if (id !== "Guest") {
                        idLookup.add(id);
                    }
                }
            }
        }

        // Get names for all real users (non-guests)
        const idArray = Array.from(idLookup);
        let userNames = {};

        if (idArray.length > 0) {
            const [users] = await mariadbPool.query(
                `SELECT id, firstName, lastName FROM Users WHERE id IN (?)`,
                [idArray]
            );

            userNames = users.reduce((acc, user) => {
                acc[user.id] = `${user.firstName} ${user.lastName}`;
                return acc;
            }, {});
        }

        const golfers = Array.from(uniqueGolfers.values()).map(g => ({
            name: userNames[g.id] || g.name,
            id: g.id
        }));

        res.json({ success: true, golfers });
    } catch (err) {
        console.error("Error in /golfers:", err);
        res.status(500).json({ error: "Failed to fetch user golfers." });
    }
});

router.post("/golfers/update", authenticateUser, async (req, res) => {
    const userId = req.user.id;
    const { matchId, golferIds } = req.body;

    try {
        if (!(await canUserAccessMatch(matchId, userId))) {
            return res.status(404).json({ error: "Not authorized to update match." });
        }

        await mariadbPool.query(
            "UPDATE Matches SET golferIds = ? WHERE id = ?",
            [JSON.stringify(golferIds), matchId]
        );
    
        res.json({ success: true, golferIds });
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

        res.json({ success: true, courses });
    } catch (err) {
        console.error("Error in /matches:", err);
        res.status(500).json({ error: "Failed to fetch user matches." });
    }
});

router.get("/members", authenticateUser, async (req, res) => {
    const query = (req.query.q || "").trim();
    if (!query || query.length < 2) return res.status(400).json({ error: "Missing or too short query." });

    try {
        const [rows] = await mariadbPool.query(`
        SELECT id, firstName, lastName, homeClub
        FROM Users
        WHERE CONCAT(firstName, ' ', lastName) LIKE ?
        ORDER BY lastName ASC
        LIMIT 10
      `, [`%${query}%`]);

        const users = rows.map(u => ({
            id: u.id,
            name: `${u.firstName} ${u.lastName}`,
            homeClub: u.homeClub || ""
        }));

        res.json({ success: true, users });
    } catch (err) {
        console.error("Error in /members:", err);
        res.status(500).json({ error: "Failed to search members." });
    }
});

router.delete("/delete/:matchId", authenticateUser, async (req, res) => {
    const matchId = req.params.matchId;
    const userId = req.user.id;

    if (!matchId) {
        return res.status(400).json({ error: "Missing matchId." });
    }

    try {
        const [rows] = await mariadbPool.query(
            "SELECT createdBy FROM Matches WHERE id = ?",
            [matchId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        if (rows[0].createdBy !== userId) {
            return res.status(403).json({ error: "You are not authorized to delete this match." });
        }

        await mariadbPool.query("DELETE FROM Messages WHERE threadId = ?", [matchId]);
        await mariadbPool.query("DELETE FROM Matches WHERE id = ?", [matchId]);

        res.json({ success: true, message: "Match and related messages deleted." });
    } catch (err) {
        console.error("Error in /delete/:matchId:", err);
        res.status(500).json({ error: "Failed to delete match." });
    }
});

module.exports = router;
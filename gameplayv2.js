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
                strokes: pop ? pop.strokes : 0,
                score: 0
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
    const { matchId, teeTime, isPublic, rules, expected } = req.body;

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

        const prompt = `Based on the following match rules, generate a JSON object with:\n- \"displayName\": creative title\n- \"questions\": array of additional questions needed per hole, formatted as { \"question\": \"string\", \"options\": [\"array\", \"of\", \"choices\"] } - don't ever ask questions about anything that isn't crucial to scoring the match or tracking money, and all questions should be asked in the past tense\n\"strokes\": array with golferName and pops as an array of strokes the golfer gets each hole based on their handicap and/or other input from the user (if unknown at this point, put 0 for all) and the hole handicap/allocation, e.g. {"name": "Mitch", "pops": [{"allocation": 1, "strokes": #}, {"alloaction": 2, "strokes": #}, ..., {"allocation": 18, "strokes": #}] \n\nRules:\n${rules}\n\nRespond ONLY with valid raw JSON.`;

        const messages = [
            { role: "system", content: "You are a golf scoring assistant that returns only valid JSON." },
            ...pastMessages,
            { role: "user", content: prompt }
        ];

        let messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
            [messageId, matchId, "user", prompt]
        );

        const completion = await openai.chat.completions.create({
            model: "ft:gpt-3.5-turbo-1106:personal:golf-gpt-v3:BaGb45nx",
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

        console.log("Built a scorecard");

        if (builtScorecards?.length === 0) {
            return res.status(500).json({ error: "Couldn't build scorecard" });
        }

        const formattedTeeTime = formatDateForSQL(teeTime);

        await mariadbPool.query(
            "UPDATE Matches SET strokes = ?, teeTime = ?, isPublic = ?, displayName = ?, questions = ?, scorecards = ?, status = ? WHERE id = ?",
            [JSON.stringify(parsed?.strokes), formattedTeeTime, isPublic ? 1 : 0, parsed?.displayName, JSON.stringify(parsed?.questions), JSON.stringify(builtScorecards), "RULES_PROVIDED", matchId]
        );

        if (expected) {
            messageId = uuidv4();
            await mariadbPool.query(
                `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
                [messageId, matchId, "assistant", JSON.stringify(expected, null, 2)]
            );

            const correctScorecards = buildScorecards(scorecards, playerTees, expected?.strokes);

            res.status(201).json({ success: true, threadId: matchId, ...expected, scorecards: correctScorecards });
        } else {
            res.status(201).json({ success: true, threadId: matchId, ...parsed, scorecards: builtScorecards });
        }
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
        const [rows1] = await mariadbPool.query("SELECT courseId, tees, displayName, questions, strokes FROM Matches WHERE id = ?", [matchId]);
        if (rows1.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const courseId = rows1[0]?.courseId;
        const playerTees = JSON.parse(rows1[0]?.tees);
        const allMessages = await mariadbPool.query("SELECT content FROM Messages WHERE threadId = ? ORDER BY createdAt ASC", [matchId]);
        const pastMessages = allMessages[0].map(m => ({ role: "user", content: m.content }));

        const prompt = `Here is the current match data:\nDisplay Name: ${rows1[0].displayName}\nQuestions: ${JSON.stringify(rows1[0].questions, null, 2)}\nStrokes: ${JSON.stringify(rows1[0].strokes, null, 2)}\n\nNew user input:\n${newRules}\n\nUpdate the JSON object accordingly and return only valid raw JSON.`;

        const messages = [
            { role: "system", content: "You are a golf scoring assistant that updates and returns only valid JSON." },
            ...pastMessages,
            { role: "user", content: prompt }
        ];

        let messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
            [messageId, matchId, "user", newRules]
        );

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

        const [rows2] = await mariadbPool.query("SELECT scorecards FROM Courses WHERE courseId = ?", [courseId]);
        if (rows2.length === 0) {
            return res.status(404).json({ error: "Course not found." });
        }

        const scorecards = JSON.parse(rows2[0].scorecards);
        const builtScorecards = buildScorecards(scorecards, playerTees, parsed?.strokes);

        console.log("Updated a scorecard", raw);

        if (builtScorecards?.length === 0) {
            return res.status(500).json({ error: "Couldn't build scorecard" });
        }

        await mariadbPool.query(
            "UPDATE Matches SET displayName = ?, questions = ?, strokes = ?, scorecards = ? WHERE id = ?",
            [parsed.displayName, JSON.stringify(parsed.questions), JSON.stringify(parsed?.strokes), JSON.stringify(builtScorecards), matchId]
        );

        if (expected) {
            messageId = uuidv4();
            await mariadbPool.query(
                `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
                [messageId, matchId, "assistant", JSON.stringify(expected, null, 2)]
            );

            const correctScorecards = buildScorecards(scorecards, playerTees, expected?.strokes);

            res.status(201).json({ success: true, threadId: matchId, ...expected, scorecards: correctScorecards });
        } else {
            res.status(201).json({ success: true, threadId: matchId, ...parsed, scorecards: builtScorecards });
        }

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

        const scorecards = JSON.parse(rows[0]?.scorecards);
        const prompt = `Everything looks good, get ready to track the results of the match. Here is the scorecard: ${JSON.stringify(scorecards, null, 2)}`;

        const messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
            [messageId, matchId, "user", prompt]
        );

        res.json({ success: true, scorecards });
    } catch (err) {
        console.error("Error in /confirm:", err);
        res.status(500).json({ error: "Failed to confirm match." });
    }
});

router.post("/score/submit", authenticateUser, async (req, res) => {
    const { matchId, holeNumber, par, scores, questionAnswers, expected } = req.body;

    if (!matchId || !holeNumber || !scores) {
        return res.status(400).json({ error: "Missing required fields." });
    }

    try {
        const [rows] = await mariadbPool.query("SELECT scorecards FROM Matches WHERE id = ?", [matchId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const scorecards = JSON.parse(rows[0].scorecards);

        //If 
        const allMessages = await mariadbPool.query("SELECT content FROM Messages WHERE threadId = ? ORDER BY createdAt ASC", [matchId]);
        const pastMessages = allMessages[0].map(m => ({ role: "user", content: m.content }));

        //TODO: Better prompt
        const prompt = `Here are the hole results:\nHole Number: ${holeNumber}\nPar: ${par}\nScores: ${JSON.stringify(scores, null, 2)}\nQuestion Answers: ${JSON.stringify(questionAnswers, null, 2)}\n\nPlease use this information, the rules of the game, and the holes played so far to return ONLY a valid JSON object as follows: "status" describing the status of the match, e.g. Player A and Player B are 1 up, or Player C is up $10 of player D, and "results" as an array containing the following data for each player: "name" as the name of the player, "score" for the score of the player on that hole, "wonHole" as true/false, "plusMinus" as a number for the dollar amount that the player won or lost on that hole, positive for wins, negative for losses. The sum of the plusMinus of all golfers combined NEEDs to be 0 on every hole.`;

        const messages = [
            { role: "system", content: "You are a golf scoring assistant that updates scorecards based on hole-by-hole results. Always respond ONLY with valid raw JSON." },
            ...pastMessages,
            { role: "user", content: prompt }
        ];

        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages,
            temperature: 0
        });

        let messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
            [messageId, matchId, "user", prompt]
        );

        const raw = completion.choices[0].message.content.trim();
        let parsed;
        try {
            const cleaned = raw.replace(/^```(?:json)?\s*/, '').replace(/```$/, '');
            parsed = JSON.parse(cleaned);
        } catch (err) {
            console.error("Failed to parse JSON:", raw);
            return res.status(500).json({ error: "Model response was not valid JSON." });
        }

        if (expected) {
            parsed = expected;
        }

        //Use the plusMinus info and posted scores to populate the scorecards and return it (update in the db)
        for (let i = 0; i < scorecards?.length; i++) {
            let scorecard = scorecards[i];
            let plusMinus = scorecard.plusMinus;

            for (let j = 0; j < parsed?.results?.length; j++) {
                if (parsed?.results[j].name === scorecard.name) {
                    plusMinus += parsed?.results[j].plusMinus;
                    for (let k = 0; k < scorecard.holes.length; k++) {
                        if (scorecard.holes[k].holeNumber === holeNumber) {
                            scorecard.holes[k].plusMinus = parsed?.results[j].plusMinus;
                            scorecard.holes[k].score = parsed?.results[j].score;
                            break;
                        }
                    }

                    break;
                }
            }

            scorecard.plusMinus = plusMinus;
            scorecards[i] = scorecard;
        }

        console.log("[score/submit] parsed", parsed);

        await mariadbPool.query(
            "UPDATE Matches SET scorecards = ?, summary = ? WHERE id = ?",
            [JSON.stringify(scorecards), parsed?.status, matchId]
        );

        if (expected) {
            messageId = uuidv4();
            await mariadbPool.query(
                `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
                [messageId, matchId, "assistant", JSON.stringify(expected, null, 2)]
            );
        } 

        res.json({ success: true, scorecards });
    } catch (err) {
        console.error("Error in /score/submit:", err);
        res.status(500).json({ error: "Failed to submit scores" });
    }
});

router.post("/score/feedback", authenticateUser, async (req, res) => {
    const { matchId, feedback, holeNumber, expected } = req.body;

    if (!matchId || !feedback) {
        return res.status(400).json({ error: "Missing matchId or feedback." });
    }

    try {
        const [rows] = await mariadbPool.query("SELECT scorecards FROM Matches WHERE id = ?", [matchId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const scorecards = JSON.parse(rows[0].scorecards);
        const allMessages = await mariadbPool.query("SELECT content FROM Messages WHERE threadId = ? ORDER BY createdAt ASC", [matchId]);
        const pastMessages = allMessages[0].map(m => ({ role: "user", content: m.content }));

        let holesToAdjust = [];
        for (let i = 0; i < scorecards.length; i++) {
            for (let j = 0; j < scorecards[i].holes.length; j++) {
                if (scorecards[i].holes[j].holeNumber === holeNumber) {
                    holesToAdjust.push({
                        name: scorecards[i].name,
                        hole: scorecards[i].holes[j]
                    });
                }
            }
        }

        //TODO: Better prompt. 
        //Generate new strokes (if applicable) and ask for a new plusMinus for each golfer on each played hole based on new input
        const prompt = `User provided the following feedback about the current match results on holeNumber ${holeNumber}:\n"${feedback}"\n\nPlease use this feedback to correct or improve the current results for each golfer on this hole:\nHole Info: ${JSON.stringify(holesToAdjust, null, 2)}. ONLY respond with a valid JSON object containing the updated "status" and a results array containing the updated hole info {"name", "plusMinus"}.`;

        const messages = [
            { role: "system", content: "You are a golf scoring assistant that updates scorecards based on user feedback. Always respond ONLY with valid raw JSON." },
            ...pastMessages,
            { role: "user", content: prompt }
        ];

        let messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
            [messageId, matchId, "user", feedback]
        );

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

        if (expected) {
            parsed = expected;
        }

        console.log("[score/feedback] parsed", parsed);

        for (let i = 0; i < scorecards?.length; i++) {
            let scorecard = scorecards[i];

            for (let j = 0; j < parsed?.results?.length; j++) {
                if (parsed?.results[j].name === scorecard.name) {
                    for (let k = 0; k < scorecard.holes.length; k++) {
                        if (scorecard.holes[k].holeNumber === holeNumber) {
                            scorecard.holes[k].plusMinus = parsed?.results[j].plusMinus;
                            break;
                        }
                    }

                    break;
                }
            }

            scorecards[i] = scorecard;
        }

        //Update the overall plusMinus and handicap for each golfer
        for (i = 0; i < scorecards.length; i++) {
            let plusMinus = 0;
            let handicap = 0;
            for (j = 0; j < scorecards[i].holes.length; j++) {
                plusMinus += scorecards[i].holes[j].plusMinus;
                handicap += scorecards[i].holes[j].strokes;
            }

            scorecards[i].plusMinus = plusMinus;
            scorecards[i].handicap = handicap;
        }

        await mariadbPool.query(
            "UPDATE Matches SET scorecards = ?, summary = ? WHERE id = ?",
            [JSON.stringify(scorecards), parsed?.status, matchId]
        );

        if (expected) {
            messageId = uuidv4();
            await mariadbPool.query(
                `INSERT INTO Messages (id, threadId, role, content) VALUES (?, ?, ?, ?)`,
                [messageId, matchId, "assistant", JSON.stringify(expected, null, 2)]
            );
        } 

        res.json({ success: true, scorecards });
    } catch (err) {
        console.error("Error in /score/feedback:", err);
        res.status(500).json({ error: "Failed to process feedback." });
    }
});

module.exports = router;
const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const authenticateUser = require('./authMiddleware');
require('dotenv').config();
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

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

router.post("/update", authenticateUser, async (req, res) => {
    try {
        const { threadId, holeResults, matchId, oldResults } = req.body;

        const currentHoleNumber = holeResults[Object.keys(holeResults)[0]].holeNumber;
        const filePath = path.join(__dirname, "temp_old_results.json");
        fs.writeFileSync(filePath, JSON.stringify(oldResults));

        const uploadedFile = await openai.files.create({
            purpose: "assistants",
            file: fs.createReadStream(filePath),
        });

        const prompt = `
You are a golf scoring assistant.

The match history is uploaded as a file attached to this thread. It contains the state of the match before hole ${currentHoleNumber}.

Here are the results for hole ${currentHoleNumber}:
${JSON.stringify(holeResults, null, 2)}

Instructions:
- Load the uploaded file to access prior results.
- Merge the new hole results into the match.
- Return updated match results as JSON.
- DO NOT return explanations — only the updated results.
`;

        await openai.beta.threads.messages.create(threadId, {
            role: "user",
            content: prompt,
        });

        const run = await openai.beta.threads.runs.create(threadId, {
            assistant_id: process.env.OPENAI_ASSISTANT_ID,
            tool_resources: {
                code_interpreter: {
                    file_ids: [uploadedFile.id], // ✅ attach files here
                },
            },
        });

        console.log("Polling for run to complete...");

        let result;
        while (true) {
            result = await openai.beta.threads.runs.retrieve(threadId, run.id);
            if (result.status === "completed") break;
            if (result.status === "failed" || result.status === "cancelled") {
                console.error("Run failed:", result);
                return res.status(500).json({ error: "GPT Assistant run failed." });
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        console.log("Run completed");

        const messages = await openai.beta.threads.messages.list(threadId);
        const last = messages.data.find((m) => m.role === "assistant");
        const content = last?.content?.[0]?.text?.value || "{}";

        let updatedResults;

        try {
            const cleaned = content
                .replace(/^```json\s*/i, '')
                .replace(/```$/, '')
                .trim();

            updatedResults = JSON.parse(cleaned);
        } catch (err) {
            console.error("Failed to parse updated match results:", content);
            return res.status(400).json({ error: "Invalid JSON returned from GPT." });
        }

        // Save updated results to DB
        await mariadbPool.query(
            `UPDATE Matches SET results = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
            [JSON.stringify(updatedResults), matchId]
        );

        res.json({ updatedResults });
    } catch (err) {
        console.error("Error in /update:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.post("/start", authenticateUser, async (req, res) => {
    try {
        const { matchData, rules } = req.body;
        const createdBy = req.user.id;
        matchData.createdBy = createdBy;

        const courseId = matchData?.course?.CourseID;
        const courseName = matchData?.course?.FullName;
        const scorecards = JSON.stringify(matchData?.scorecards);

        // Ensure course exists
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
        }

        const slimScorecards = {};
        for (const [playerId, teeName] of Object.entries(matchData.selectedTees)) {
            slimScorecards[teeName] = matchData.scorecards[teeName];
        }

        const trimmedMatchData = {
            ...matchData,
            scorecards: slimScorecards
        };

        const messages = [
            {
                role: "system",
                content: `You are a golf scoring assistant and money keeper. The user will provide a JSON object 
                containing the golfers who are playing, the course they're playing, the tees they're playing, and
                the hole data for each tee on each hole at that course. The user will also provide a description of
                the rules of the game and how the money is won/lost throughout the match. This description will most
                likely contain the name of the game, but not all of the rules. It is up to you to infer the rules and
                scoring and money logic based on the game if it is not otherwise stated. In every game, a golfer will
                have a score they make on a hole, but some games require additional information. If the game requires
                more information that just the score a player made on a hole (closest to the pin, proximity in regulation, 
                changing the teams in a game like wolf, changing the dollar value, etc.) you'll need to come up with multiple
                choice questions that the user can answer after each hole to give you that information.`
            },
            {
                role: "user",
                content: `Here's a JSON object containing the information you're expecting: ${JSON.stringify(trimmedMatchData)}.
                Additionally, here are rules about the game we're playing (name of the game, dollar values, special 
                rules, handicaps, etc.): "${rules}". Return a JSON object that contains two arrays: one with a list of additionalInputs,
                each of which contains a question and a list of multiple choice options. the other array should be called
                scorecards, and should contain an object for each player with the following properties: playerName, tees, chances of
                winning, winLossBalance, and holes - holes should be an array containing the following information for each hole the
                golfer is going to play: holeNumber, par, yardage, handicap, strokes (if the rules say the player gets strokes on
                certain holes), grossScore, and moneyWonLost. Return it as a clean JSON object with no further detail.`
            }
        ];

        const startTime = Date.now();
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages,
            temperature: 0.7
        });
        const duration = Date.now() - startTime;
        console.log(`GPT response time: ${duration}ms`);

        const responseText = completion.choices[0]?.message?.content || "{}";

        let parsed;
        try {
            const cleaned = responseText
                .replace(/^```json\s*/i, '')
                .replace(/```$/, '')
                .trim();
            parsed = JSON.parse(cleaned);
        } catch (err) {
            console.error("Failed to parse GPT response:", responseText);
            return res.status(400).json({ error: "Invalid JSON returned from GPT" });
        }

        const matchId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Matches 
        (id, createdBy, golfers, courseId, isPublic, displayName, teeTime, results, additionalInputs) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                matchId,
                matchData.createdBy,
                JSON.stringify(matchData.selectedTees),
                courseId,
                matchData.isPublic ?? true,
                parsed.gameName ?? "Untitled Match",
                new Date(matchData.teeTime).toISOString().slice(0, 19).replace('T', ' '),
                JSON.stringify(parsed.scorecards ?? []),
                JSON.stringify(parsed.additionalInputs ?? [])
            ]
        );

        const [matches] = await mariadbPool.query('SELECT * FROM Matches WHERE id = ?', [matchId]);
        res.json({ match: matches[0], confirmation: parsed.confirmation });
    } catch (err) {
        console.error("Error in /start:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;
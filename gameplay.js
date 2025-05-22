const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const authenticateUser = require('./authMiddleware');
const OpenAI = require("openai");
require('dotenv').config();

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const mariadbPool = mysql.createPool({
    host: 'ec2-54-205-4-218.compute-1.amazonaws.com',
    user: 'golfuser',
    password: process.env.DB_PASS,
    database: 'golfpicks',
    waitForConnections: true,
    connectionLimit: 10,
});

async function getMatchMessages(matchId) {
    const [rows] = await mariadbPool.query(
        'SELECT * FROM Messages WHERE matchId = ? ORDER BY createdAt ASC',
        [matchId]
    );
    return rows.map((row, idx) => ({
        role: idx % 2 === 0 ? 'user' : 'assistant',
        content: row.message,
    }));
}

async function storeMessage(matchId, content) {
    const id = uuidv4();
    await mariadbPool.query(
        'INSERT INTO Messages (id, matchId, message) VALUES (?, ?, ?)',
        [id, matchId, content]
    );
}

router.post("/start", authenticateUser, async (req, res) => {
    try {
        const { matchData, rules } = req.body;
        const createdBy = req.user.id;
        matchData.createdBy = createdBy;

        const courseId = matchData?.course?.CourseID;
        const courseName = matchData?.course?.FullName;
        const scorecards = JSON.stringify(matchData?.scorecards);

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

        const matchId = uuidv4();

        const systemPrompt =
            'You are a golf scoring assistant. Respond only with valid JSON. No explanations.';

        const userPrompt = `Here is the match data:
${JSON.stringify(matchData, null, 2)}

Here are the rules:
"${rules}"

You will help calculate results for each golfer on every hole.

Return ONLY a valid JSON object with the following structure:

{
  "gameName": string,
  "confirmation": string,
  "additionalInputs": [
    {
      "question": string,
      "answers": string[]
    }
  ],
  "scorecard": [
    {
      "playerName": string,
      "tees": string,
      "chancesOfWinning": number,
      "winLossBalance": number,
      "holes": [
        {
          "holeNumber": number,
          "par": number,
          "yardage": number,
          "courseHandicap": number,
          "score": null,
          "strokes": number,
          "netScore": null,
          "moneyWonLost": null
        }
      ]
    }
  ]
}

Instructions:
- Use matchData.selectedTees to determine which tee each golfer is playing.
- Use matchData.scorecards to get tee-specific hole yardage, par, and allocation.
- Set courseHandicap to allocation value for each hole.
- If handicaps are not provided, use strokes = 0.
- DO NOT return any explanation — JSON only.`;

        console.log("prompts generated");

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            temperature: 0,
            max_tokens: 4000,
        });

        console.log("chat completions sent");

        const reply = response.choices[0].message.content;
        await storeMessage(matchId, userPrompt);
        await storeMessage(matchId, reply);

        console.log("messages stored");

        let parsed = {};
        try {
            parsed = JSON.parse(reply.replace(/^```json\s*/, '').replace(/```$/, '').trim());
        } catch (err) {
            return res.status(400).json({ error: 'Invalid JSON from GPT', raw: reply });
        }

        console.log("got response", parsed);

        await mariadbPool.query(
            `INSERT INTO Matches 
            (id, createdBy, golfers, courseId, isPublic, displayName, teeTime, results, additionalInputs) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                matchId,
                createdBy,
                JSON.stringify(matchData.selectedTees),
                courseId,
                matchData.isPublic ?? true,
                parsed.gameName ?? 'Untitled Match',
                new Date(matchData.teeTime).toISOString().slice(0, 19).replace('T', ' '),
                JSON.stringify(parsed.scorecard ?? []),
                JSON.stringify(parsed.additionalInputs ?? [])
            ]
        );

        console.log("created match");

        const [match] = await mariadbPool.query('SELECT * FROM Matches WHERE id = ?', [matchId]);
        res.json({ match: match[0], confirmation: parsed.confirmation });
    } catch (err) {
        console.error("Error in /start:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.post("/update", authenticateUser, async (req, res) => {
    try {
        const { matchId, holeResults, oldResults } = req.body;
        const currentHoleNumber = holeResults[Object.keys(holeResults)[0]].holeNumber;

        const fullResults = oldResults;

        const userPrompt = `You are a golf scoring assistant.

Here are the full match results before hole ${currentHoleNumber}:
${JSON.stringify(fullResults, null, 2)}

Here are the hole results for hole ${currentHoleNumber}:
${JSON.stringify(holeResults, null, 2)}

Instructions:
- Merge the new hole results into the previous results.
- Update scores, net scores, moneyWonLost, chancesOfWinning, and winLossBalance.
- Return the full updated match results as valid JSON only. DO NOT explain.`;

        const history = await getMatchMessages(matchId);
        history.push({ role: 'user', content: userPrompt });

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: history,
            temperature: 0,
            max_tokens: 4000,
        });

        const reply = response.choices[0].message.content;
        await storeMessage(matchId, userPrompt);
        await storeMessage(matchId, reply);

        let updatedResults;
        try {
            updatedResults = JSON.parse(reply.replace(/^```json\s*/i, '').replace(/```$/, '').trim());
        } catch (err) {
            return res.status(400).json({ error: 'Invalid JSON returned', raw: reply });
        }

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

module.exports = router;

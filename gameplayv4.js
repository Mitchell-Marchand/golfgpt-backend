const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const authenticateUser = require('./authMiddleware');
const OpenAI = require("openai");
require('dotenv').config();
const { buildScorecards, blankAnswers, extractJsonBlock, calculateWinPercents, capitalizeWords } = require('./train/utils')
const { scotchConfig, junkConfig, vegasConfig, wolfConfig, lrmoConfig, ninePointConfig, universalConfig, stablefordConfig } = require("./games/config");
const { scotch, junk, vegas, wolf, leftRight, ninePoint, banker, universalMatchScorer, stableford } = require("./games/scoring");
const { applyConfigToScorecards, getQuestionsFromConfig } = require('./train/questionUtils');

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
        const names = leaders.map(g => {
            const parts = g.name.trim().split(" ");
            return parts.length === 1
                ? parts[0]
                : `${parts[0]} ${parts[1][0]}`;
        });

        const joined = names.length === 1
            ? names[0]
            : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];

        return `${joined} ${names.length === 1 ? "is" : "are"} up $${maxPlusMinus} through ${holesPlayed}`;
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

async function upsertResults({ matchId, scorecards, golfers, golferIds, mariadbPool }) {
    try {
        for (let i = 0; i < golferIds.length; i++) {
            const golferId = golferIds[i];
            if (golferId === 'Guest') continue;

            const golferName = golfers[i];
            const scorecard = scorecards.find(s => s.name === golferName);
            if (!scorecard) {
                console.warn(`No scorecard found for golfer ${golferName}`);
                continue;
            }

            const { plusMinus = 0, points = 0 } = scorecard;

            let won = false, lost = false, tied = false;
            if (plusMinus > 0) won = true;
            else if (plusMinus < 0) lost = true;
            else tied = true;

            const [existing] = await mariadbPool.query(
                'SELECT id FROM Results WHERE matchId = ? AND userId = ?',
                [matchId, golferId]
            );

            if (existing.length > 0) {
                await mariadbPool.query(
                    `UPDATE Results 
             SET plusMinus = ?, points = ?, won = ?, lost = ?, tied = ?, updatedAt = CURRENT_TIMESTAMP
             WHERE matchId = ? AND userId = ?`,
                    [plusMinus, points, won, lost, tied, matchId, golferId]
                );
            } else {
                const id = uuidv4();
                await mariadbPool.query(
                    `INSERT INTO Results (id, matchId, userId, plusMinus, points, won, lost, tied)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, matchId, golferId, plusMinus, points, won, lost, tied]
                );
            }
        }
    } catch (error) {
        console.error('Error upserting results:', error);
        throw error;
    }
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

        for (const golferId of golferIds) {
            await mariadbPool.query(
                'INSERT INTO MatchPlayers (matchId, userId) VALUES (?, ?)',
                [matchId, golferId]
            );
        }

        await mariadbPool.query(
            'INSERT INTO MatchPlayers (matchId, userId) VALUES (?, ?)',
            [matchId, userId]
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

        res.json({ success: true });
    } catch (err) {
        console.error("Error in /tees:", err);
        res.status(500).json({ error: "Failed to save tee info." });
    }
});

router.post("/create", authenticateUser, async (req, res) => {
    const { matchId, teeTime, isPublic, rules, strokes } = req.body;

    if (!matchId || !teeTime || typeof isPublic === 'undefined') {
        return res.status(400).json({ error: "Missing required data." });
    }

    try {
        if (!(await canUserAccessMatch(matchId, req.user.id))) {
            return res.status(404).json({ error: "Not authorized to update match." });
        }

        const [rows1] = await mariadbPool.query("SELECT courseId, displayName, tees, holeCount, golfers, golferIds FROM Matches WHERE id = ?", [matchId]);
        if (rows1.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const courseId = rows1[0].courseId;
        const playerTees = JSON.parse(rows1[0].tees);
        const holes = rows1[0].holeCount;
        const golfers = JSON.parse(rows1[0].golfers);

        const [rows2] = await mariadbPool.query("SELECT scorecards, nineScorecards FROM Courses WHERE courseId = ?", [courseId]);
        if (rows2.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        const scorecards = JSON.parse(rows2[0].scorecards);
        const nineScorecards = JSON.parse(rows2[0].nineScorecards);

        //Generate config & questions from gpt-4o
        //Step 1: Determine game type
        const options = [
            "scotch", "bridge", "umbrella", "wolf", "flip wolf", "vegas", "daytona", "banker", "left-right",
            "middle-outside", "king of the hill", "match play", "stroke play", "stableford", "quota", "nine point",
            "scramble", "shamble", "bramble", "chapman", "alt shot"
        ];

        const gameType = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: "You are an expert in determining which golf game a user is playing based on their description of it. You are to choose from a list of options and ONLY return ONE of those options and NOTHING else. You must return an option from the list."
                },
                {
                    role: "user",
                    content: `Return which type of golf match I am playing from the following options. If you're not sure, default to "match play" if teams are provided and "stroke play" if not: ${JSON.stringify(options)}. Here's a description of the game: ${rules}`
                }
            ],
            temperature: 0.0
        });

        const raw = gameType.choices[0].message.content.trim().replaceAll(`"`, ``);
        let config;
        let sideConfig;

        console.log("Type:", raw);

        if (raw === "scotch" || raw === "bridge" || raw === "umbrella") {
            const prompt = `Based on the following rules of a ${raw} match in golf, fill out and return the JSON template below with the correct values. Return ONLY the valid JSON object with no explanation. For names, ONLY include the following: ${JSON.stringify(golfers)}\n\nRules: ${rules}\n\nJSON Object: ${scotchConfig}`;
            const rawConfig = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert in understanding the rules of golf matches and filling out the values for a JSON object with specific keys. Return ONLY the valid JSON object."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.0
            });

            try {
                config = JSON.parse(extractJsonBlock(rawConfig.choices[0].message.content.trim()));
            } catch (err) {
                return res.status(500).json({ error: "Error building match, please try again." });
            }
        } else if (raw === "vegas" || raw === "daytona") {
            const prompt = `Based on the following rules of a vegas match in golf, fill out and return the JSON template below with the correct values. Return ONLY the valid JSON object with no explanation. For names, ONLY include the following: ${JSON.stringify(golfers)}\n\nRules: ${rules}\n\nJSON Object: ${vegasConfig}`;
            const rawConfig = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert in understanding the rules of golf matches and filling out the values for a JSON object with specific keys. Return ONLY the valid JSON object."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.0
            });

            try {
                config = JSON.parse(extractJsonBlock(rawConfig.choices[0].message.content.trim()));
            } catch (err) {
                return res.status(500).json({ error: "Error building match, please try again." });
            }
        } else if (raw === "wolf") {
            const prompt = `Based on the following rules of a wolf match in golf, fill out and return the JSON template below with the correct values. Return ONLY the valid JSON object with no explanation. For names, ONLY include the following: ${JSON.stringify(golfers)}\n\nRules: ${rules}\n\nJSON Object: ${wolfConfig}`;
            const rawConfig = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert in understanding the rules of golf matches and filling out the values for a JSON object with specific keys. Return ONLY the valid JSON object."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.0
            });

            try {
                config = JSON.parse(extractJsonBlock(rawConfig.choices[0].message.content.trim()));
            } catch (err) {
                return res.status(500).json({ error: "Error building match, please try again." });
            }
        } else if (raw === "left-right" || raw === "middle-outside" || raw === "flip wolf" || raw === "king of the hill") {
            const prompt = `Based on the following rules of a ${raw} match in golf, fill out and return the JSON template below with the correct values. Return ONLY the valid JSON object with no explanation. For names, ONLY include the following: ${JSON.stringify(golfers)}\n\nRules: ${rules}\n\nJSON Object: ${lrmoConfig}`;
            const rawConfig = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert in understanding the rules of golf matches and filling out the values for a JSON object with specific keys. Return ONLY the valid JSON object."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.0
            });

            try {
                config = JSON.parse(extractJsonBlock(rawConfig.choices[0].message.content.trim()));
            } catch (err) {
                return res.status(500).json({ error: "Error building match, please try again." });
            }
        } else if (raw === "nine point") {
            const prompt = `Based on the following rules of a ${raw} match in golf, fill out and return the JSON template below with the correct values. Return ONLY the valid JSON object with no explanation. For names, ONLY include the following: ${JSON.stringify(golfers)}\n\nRules: ${rules}\n\nJSON Object: ${ninePointConfig}`;
            const rawConfig = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert in understanding the rules of golf matches and filling out the values for a JSON object with specific keys. Return ONLY the valid JSON object."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.0
            });

            try {
                config = JSON.parse(extractJsonBlock(rawConfig.choices[0].message.content.trim()));
            } catch (err) {
                return res.status(500).json({ error: "Error building match, please try again." });
            }
        } else if (raw === "banker") {
            config = {};
        } else if (["match play", "stroke play", "scramble", "shamble", "bramble", "chapman", "alt shot"].includes(raw)) {
            const prompt = `Based on the following rules of a ${raw} match in golf, fill out and return the JSON template below with the correct values. Return ONLY the valid JSON object with no explanation. For names, ONLY include the following: ${JSON.stringify(golfers)}\n\nRules: ${rules}\n\nJSON Object: ${universalConfig}`;
            const rawConfig = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert in understanding the rules of golf matches and filling out the values for a JSON object with specific keys. Return ONLY the valid JSON object."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.0
            });

            try {
                config = JSON.parse(extractJsonBlock(rawConfig.choices[0].message.content.trim()));
            } catch (err) {
                return res.status(500).json({ error: "Error building match, please try again." });
            }
        } else if (raw === "stableford" || raw === "quota") {
            const prompt = `Based on the following rules of a stableford match in golf, fill out and return the JSON template below with the correct values. Return ONLY the valid JSON object with no explanation. For names, ONLY include the following: ${JSON.stringify(golfers)}\n\nRules: ${rules}\n\nJSON Object: ${stablefordConfig}`;
            const rawConfig = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert in understanding the rules of golf matches and filling out the values for a JSON object with specific keys. Return ONLY the valid JSON object."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.0
            });

            try {
                config = JSON.parse(extractJsonBlock(rawConfig.choices[0].message.content.trim()));
            } catch (err) {
                return res.status(500).json({ error: "Error building match, please try again." });
            }
        }

        if (!config) {
            return res.status(500).json({ error: "Sorry, I don't know how to score that kind of golf match yet." });
        } else {
            console.log("Config:", JSON.stringify(config, null, 2))
        }

        //Get side action
        const prompt = `Based on the details for my golf match, fill out and return the JSON template below with the correct values. Return ONLY the valid JSON object with no explanation.\n\nDetails: ${rules}\n\nJSON Object: ${junkConfig}`;
        const rawConfig = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: "You are an expert in understanding the rules of side games/junk in golf matches and filling out the values for a JSON object with specific keys. Return ONLY the valid JSON object."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.0
        });

        try {
            sideConfig = JSON.parse(extractJsonBlock(rawConfig.choices[0].message.content.trim()));
        } catch (err) {
            return res.status(500).json({ error: "Error building match, please try again." });
        }

        const strippedJunk = Object.fromEntries(
            Object.entries(sideConfig).filter(([_, value]) => value.valid)
        );

        console.log("stripped junk", JSON.stringify(strippedJunk, null, 2))

        const questions = getQuestionsFromConfig(raw, config, sideConfig, golfers);
        const builtScorecards = buildScorecards(holes === 18 ? scorecards : nineScorecards, playerTees, strokes, holes);
        
        if (builtScorecards?.length === 0) {
            return res.status(500).json({ error: "Couldn't build scorecard" });
        }

        const formattedTeeTime = formatDateForSQL(teeTime);

        //Get creative displayName from AI.
        /*let displayName = "Golf Match";
        const displayNameResponse = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: `You're an assistant who can return a creative but not cheesy display name for a golf match. Your job is to generate short, clear display names.`
                },
                { role: "user", content: `Based on these the type of match and stakes, generate a display name. Limit it to 6 words or fewer: ${rules}` }
            ],
            temperature: 0.2
        });

        if (displayNameResponse.choices[0].message.content) {
            displayName = displayNameResponse.choices[0].message.content?.trim()?.replaceAll('"', '');
        }*/

        const displayName = capitalizeWords(raw);

        await mariadbPool.query(
            "UPDATE Matches SET strokes = ?, config = ?, configType = ?, strippedJunk = ?, setup = ?, displayName = ?, teeTime = ?, isPublic = ?, questions = ?, scorecards = ?, status = ? WHERE id = ?",
            [JSON.stringify(strokes), JSON.stringify(config), raw, JSON.stringify(strippedJunk), rules, displayName, formattedTeeTime, isPublic ? 1 : 0, JSON.stringify(questions), JSON.stringify(builtScorecards), "RULES_PROVIDED", matchId]
        );

        res.status(201).json({ success: true, questions, scorecards: builtScorecards, displayName, config, junkConfig: strippedJunk, configType: raw });
    } catch (err) {
        console.error("Error in /create:", err);
        res.status(500).json({ error: "Failed to generate match setup." });
    }
});

router.post("/confirm", authenticateUser, async (req, res) => {
    const { matchId, displayName } = req.body;

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
            await mariadbPool.query(
                "UPDATE Matches SET status = ?, answers = ?, displayName = ? WHERE id = ?",
                ["READY_TO_START", blankAnswers(scorecards), displayName, matchId]
            );
        }

        res.json({ success: true, scorecards });
    } catch (err) {
        console.error("Error in /confirm:", err);
        res.status(500).json({ error: "Failed to confirm match." });
    }
});

router.post("/score/submit", authenticateUser, async (req, res) => {
    const { matchId, holeNumber, scores, answeredQuestions } = req.body;

    if (!matchId || !holeNumber || !scores) {
        return res.status(400).json({ error: "Missing required fields." });
    }

    try {
        if (!(await canUserAccessMatch(matchId, req.user.id))) {
            return res.status(404).json({ error: "Not authorized to update match." });
        }

        const [rows] = await mariadbPool.query("SELECT scorecards, config, configType, strippedJunk, golfers, golferIds, answers FROM Matches WHERE id = ?", [matchId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        }

        let scorecards = JSON.parse(rows[0].scorecards);
        let answers = JSON.parse(rows[0].answers);
        const golfers = JSON.parse(rows[0].golfers);
        const golferIds = JSON.parse(rows[0].golferIds);
        const config = JSON.parse(rows[0].config);
        const strippedJunk = JSON.parse(rows[0].strippedJunk);
        const configType = rows[0].configType;

        //Update scorecards with config, scores, questionAnswers
        for (let i = 0; i < answers?.length; i++) {
            if (answers[i].hole === holeNumber) {
                answers[i].answers = answeredQuestions;
            }
        }

        if (configType === "scotch" || configType === "umbrella" || configType === "bridge") {
            scorecards = scotch(
                scorecards,
                answers,
                scores,
                config.teams,
                config.teams.map(team => team.split(' & ')),
                config.pointVal,
                config.points,
                config.autoDoubles,
                config.autoDoubleAfterNineTrigger,
                config.autoDoubleMoneyTrigger,
                config.autoDoubleWhileTiedTrigger,
                config.autoDoubleValue,
                config.autoDoubleStays,
                config.miracle,
                config.onlyGrossBirdies
            );
        } else if (configType === "vegas" || configType === "daytona") {
            scorecards = vegas(
                scorecards,
                scores,
                config,
                answers
            );
        } else if (configType === "wolf") {
            scorecards = wolf(
                scorecards,
                scores,
                config,
                answers
            )
        } else if (["left-right", "middle-outside", "flip wolf", "king of the hill"].includes(configType)) {
            scorecards = leftRight(
                scorecards,
                scores,
                config,
                answers
            )
        } else if (configType === "nine point") {
            scorecards = ninePoint(
                scorecards,
                scores,
                config
            )
        } else if (configType === "banker") {
            scorecards = banker(
                scorecards,
                scores,
                answers
            )
        } else if (["match play", "stroke play", "scramble", "shamble", "bramble", "chapman", "alt shot"].includes(configType)) {
            scorecards = universalMatchScorer(
                scorecards,
                scores,
                config,
                answers
            );
        } else if (["stableford", "quota"].includes(configType)) {
            scorecards = stableford(
                scorecards,
                scores,
                config,
                answers
            )
        }

        scorecards = junk(scorecards, answers, strippedJunk, golfers, config.teams || false);
        scorecards = calculateWinPercents(scorecards);

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

        let status = "IN_PROGRESS";
        if (allHolesPlayed) {
            status = "COMPLETED";
        }

        const summary = generateSummary(scorecards);

        await mariadbPool.query(
            "UPDATE Matches SET scorecards = ?, summary = ?, answers = ?, status = ? WHERE id = ?",
            [JSON.stringify(scorecards), summary, JSON.stringify(answers), status, matchId]
        );

        //If all holes played, updated in results table
        if (allHolesPlayed) {
            await upsertResults({
                matchId,
                scorecards,
                golfers,
                golferIds,
                mariadbPool,
            });
        }

        res.json({ success: true, scorecards, status: summary, answers });
    } catch (err) {
        console.error("Error in /score/submit:", err);
        res.status(500).json({ error: "Failed to submit scores" });
    }
});

router.get("/match", authenticateUser, async (req, res) => {
    //TODO: Pull all details for a match so the user can play it
    const userId = req.user.id;
    const matchId = req.query.id;

    try {
        const [rows] = await mariadbPool.query(
            `SELECT m.*
             FROM Matches m
             LEFT JOIN Courses c ON m.courseId = c.courseId
             WHERE (
                createdBy = ?
                OR JSON_CONTAINS(golferIds, JSON_QUOTE(?))
            )
               AND m.id = ?`,
            [userId, userId, matchId]
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
            configType: match.configType,
            config: match.config ? JSON.parse(match.config) : {},
            junkConfig: match.strippedJunk ? JSON.parse(match.strippedJunk) : {},
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

        res.json({ success: true, match: parsedMatches[0] });
    } catch (err) {
        console.error("Error in /matches:", err);
        res.status(500).json({ error: "Failed to fetch user matches." });
    }
}),

router.get("/matches", authenticateUser, async (req, res) => {
    const userId = req.user.id;

    try {
        const [rows] = await mariadbPool.query(
            `SELECT m.id, m.displayName, m.golfers, m.status, m.summary, m.teeTime, m.courseId,
                    c.courseId AS courseId, c.courseName AS courseName
             FROM Matches m
             LEFT JOIN Courses c ON m.courseId = c.courseId
             WHERE (
                createdBy = ?
                OR JSON_CONTAINS(golferIds, JSON_QUOTE(?))
            )
               AND m.status IN ('READY_TO_START', 'IN_PROGRESS', 'COMPLETED') 
             ORDER BY m.updatedAt DESC, m.serial DESC`,
            [userId, userId]
        );

        const parsedMatches = rows.map(match => ({
            id: match.id,
            displayName: match.displayName,
            golfers: match.golfers ? JSON.parse(match.golfers) : [],
            //golferIds: match.golferIds ? JSON.parse(match.golferIds) : [],
            //scorecards: match.scorecards ? JSON.parse(match.scorecards) : [],
            //questions: match.questions ? JSON.parse(match.questions) : [],
            //answers: match.answers ? JSON.parse(match.answers) : [],
            //strokes: match.strokes ? JSON.parse(match.strokes) : [],
            //configType: match.configType,
            //config: match.config ? JSON.parse(match.config) : {},
            //junkConfig: match.strippedJunk ? JSON.parse(match.strippedJunk) : {},
            //isPublic: match.isPublic,
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
         ORDER BY updatedAt DESC LIMIT 5`,
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

        // Clear existing MatchPlayers for this match
        await mariadbPool.query("DELETE FROM MatchPlayers WHERE matchId = ?", [matchId]);

        // Insert updated golferIds
        for (const golferId of golferIds) {
            await mariadbPool.query(
                'INSERT INTO MatchPlayers (matchId, userId) VALUES (?, ?)',
                [matchId, golferId]
            );
        }

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
    const userId = req.user.id;

    if (!query || query.length < 2) {
        return res.status(400).json({ error: "Missing or too short query." });
    }

    try {
        const [rows] = await mariadbPool.query(
            `
        SELECT u.id, u.firstName, u.lastName, u.homeClub
        FROM Users u
        LEFT JOIN Follows f
          ON f.followerId = ? AND f.followedId = u.id AND f.status = 'rejected'
        WHERE f.followedId IS NULL
          AND CONCAT(u.firstName, ' ', u.lastName) LIKE ?
          AND u.id != ? -- exclude self
        ORDER BY u.lastName ASC
        LIMIT 10
        `,
            [userId, `%${query}%`, userId]
        );

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

router.get("/matches/recent", authenticateUser, async (req, res) => {
    const userId = req.user.id;

    try {
        const [rows] = await mariadbPool.query(
            `SELECT id, displayName, teeTime, golfers
             FROM Matches
             WHERE (createdBy = ?
                OR JSON_CONTAINS(golferIds, JSON_QUOTE(?)))
                AND setup != ''
             ORDER BY updatedAt DESC, serial DESC
             LIMIT 20`,
            [userId, userId]
        );

        const matches = rows.map(match => ({
            id: match.id,
            displayName: match.displayName,
            teeTime: match.teeTime,
            golfers: match.golfers ? JSON.parse(match.golfers) : []
        }));

        res.json({ success: true, matches });
    } catch (err) {
        console.error("Error in /matches/recent:", err);
        res.status(500).json({ error: "Failed to fetch recent matches." });
    }
});

router.post("/matches/copy-setup", authenticateUser, async (req, res) => {
    const { matchToEditId, matchToCopyId } = req.body;
    const userId = req.user.id;

    if (!matchToEditId || !matchToCopyId) {
        return res.status(400).json({ error: "Missing match IDs." });
    }

    try {
        // Validate access to matchToEdit
        const [editRows] = await mariadbPool.query(
            `SELECT golfers FROM Matches WHERE id = ? AND (createdBy = ? OR JSON_CONTAINS(golferIds, JSON_QUOTE(?)))`,
            [matchToEditId, userId, userId]
        );

        if (editRows.length === 0) {
            return res.status(403).json({ error: "Unauthorized to edit this match." });
        }

        const golfers = JSON.parse(editRows[0].golfers);

        // Pull summary from match to copy
        const [copyRows] = await mariadbPool.query(
            `SELECT setup, golfers FROM Matches WHERE id = ?`,
            [matchToCopyId]
        );

        if (copyRows.length === 0 || !copyRows[0].setup) {
            return res.status(404).json({ error: "Original match setup not found." });
        }

        const oldSummary = copyRows[0].setup;
        const oldGolfers = copyRows[0].golfers;

        //TODO: If golfers are the same, just copy the config
        const prompt = `Here is a list of golfers who are playing a match. Update this prompt with the names of the golfers playing in this new match. NEVER use "Me" - only EXACT golfer names from the list. Old Golfers: ${JSON.stringify(oldGolfers)}. New Golfers: ${JSON.stringify(golfers)}\nPrompt: ${oldSummary}\n\nIf the original prompt didn't include any of the old golfer names, just return the original prompt.`
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: "You are an expert in changing prompts to swap in and out names. Swap the names in this prompt and return the new prompt and ONLY the new prompt."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.3
        });

        const newSummary = completion.choices[0].message.content.trim();
        res.json({ success: true, setup: newSummary });
    } catch (err) {
        console.error("Error in /matches/copy-setup:", err);
        res.status(500).json({ error: "Failed to generate new setup." });
    }
});

router.put("/settings", authenticateUser, async (req, res) => {
    let { matchId, config, junkConfig } = req.body;
    const userId = req.user.id;

    if (!matchId) {
        return res.status(400).json({ error: "Missing match IDs." });
    }

    try {
        // Validate access to matchToEdit
        const [editRows] = await mariadbPool.query(
            `SELECT answers, configType, scorecards, golfers FROM Matches WHERE id = ? AND (createdBy = ? OR JSON_CONTAINS(golferIds, JSON_QUOTE(?)))`,
            [matchId, userId, userId]
        );

        if (editRows.length === 0) {
            return res.status(403).json({ error: "Unauthorized to edit this match." });
        }

        const configType = editRows[0].configType;
        let answers = JSON.parse(editRows[0].answers);
        let scorecards = JSON.parse(editRows[0].scorecards);
        let golfers = JSON.parse(editRows[0].golfers);

        //Determine if any new questions are needed from gametype, update scorecard
        const newQuestions = getQuestionsFromConfig(configType, config, junkConfig, golfers);
        for (let i = 0; i < answers?.length; i++) {
            answers[i].answers = answers[i].answers.filter(q =>
                newQuestions.find(nq => nq.question === q.question)
            );
        }

        const strippedJunk = Object.fromEntries(
            Object.entries(junkConfig).filter(([_, value]) => value.valid)
        );

        const scores = scorecards.map(sc => {
            return {
                name: sc.name,
                strokes: sc.holes[0].strokes,
                score: sc.holes[0].score,
                holeNumber: sc.holes[0].holeNumber
            }
        })

        const newScorecards = applyConfigToScorecards(scorecards, configType, config, strippedJunk, answers, golfers, scores)

        if (newScorecards?.length > 1 && scorecards.length > 1 && newScorecards[0].holes?.length === scorecards[0].holes.length) {
            scorecards = newScorecards;
        } else {
            return res.status(403).json({ error: "Error applying settings update" });
        }

        const summary = generateSummary(scorecards);

        await mariadbPool.query(
            "UPDATE Matches SET summary = ?, config = ?, strippedJunk = ?, questions = ?, answers = ?, scorecards = ? WHERE id = ?",
            [summary, JSON.stringify(config), JSON.stringify(strippedJunk), JSON.stringify(newQuestions), JSON.stringify(answers), JSON.stringify(scorecards), matchId]
        );

        res.json({ success: true, scorecards, questions: newQuestions, answers, summary });
    } catch (err) {
        console.error("Error in put /settings:", err);
        res.status(500).json({ error: "Failed to generate new setup." });
    }
});

router.get('/results/summary', authenticateUser, async (req, res) => {
    const after = req.query.after;

    if (!after || isNaN(new Date(after).getTime())) {
        return res.status(400).json({ error: 'Invalid or missing "after" date (YYYY-MM-DD).' });
    }

    try {
        const sql = `
        SELECT
            COUNT(*)                     AS totalGames,
            SUM(won)                     AS totalWins,
            SUM(lost)                    AS totalLosses,
            SUM(tied)                    AS totalTies,
            COALESCE(SUM(plusMinus), 0)  AS totalPlusMinus
            FROM Results
            WHERE userId = ?
            AND createdAt >= ?
        `;

        const [rows] = await mariadbPool.query(sql, [req.user.id, after]);
        const summary = rows[0] || {
            totalGames: 0,
            totalWins: 0,
            totalLosses: 0,
            totalTies: 0,
            totalPlusMinus: 0,
        };

        res.json(summary);
    } catch (err) {
        console.error('Results summary error:', err);
        res.status(500).json({ error: 'Server error fetching results summary.' });
    }
});

module.exports = router;
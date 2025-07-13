const { getCourse } = require('../course');
const { getPlayerNames } = require('../players');
const { getTees } = require('../tees');
const { cleanScorecard, buildScorecards, getRandomInt, pickTeam, blankAnswers } = require('../utils');
const { getStrokes } = require('../strokes');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const mysql = require('mysql2/promise');
const OpenAI = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const mariadbPool = mysql.createPool({
    host: 'ec2-18-232-136-96.compute-1.amazonaws.com',
    user: 'golfuser',
    password: process.env.DB_PASS,
    database: 'golfpicks',
    waitForConnections: true,
    connectionLimit: 10,
});

async function runScotchGame() {
    const holeCount = getRandomInt(3) === 1 ? 9 : 18;
    const names = getPlayerNames(4);
    const course = await getCourse(mariadbPool);
    const allScorecards = JSON.parse(holeCount === 9 ? course.nineScorecards : course.scorecards);
    const tees = getTees(names, allScorecards);
    const scorecards = buildScorecards(allScorecards, tees, [], holeCount);
    const userId = "5c4ebd6d-b36d-44d9-acc5-824b4f14c9f1";
    const isPublic = false;
    let holes = [];

    if (scorecards?.length > 0) {
        for (let i = 0; i < scorecards[0].holes?.length; i++) {
            holes.push({
                holeNumber: scorecards[0].holes[i]?.holeNumber,
                allocation: scorecards[0].holes[i]?.allocation
            })
        }
    } else {
        console.log("Error building holes", holeCount);
        return;
    }

    let strokeObject = getStrokes(names, holes);
    let strokes = strokeObject.strokes;

    let strokePrompt = strokeObject.prompt;
    if (getRandomInt(1) === 1) {
        strokePrompt = "";
        strokes = names.map(name => ({
            name,
            pops: []
        }));
    }

    const teams = pickTeam(names, 2);
    const pointIndex = getRandomInt(10) + 3;
    const points = pointIndex % 2 === 0 ? 4 : pointIndex % 3 === 0 ? 8 : 6;
    const pointVal = getRandomInt(6);
    const doubles = getRandomInt(3) !== 1;
    const redoubles = doubles && getRandomInt(3) !== 1;
    const autoDoubleValue = pointVal * (getRandomInt(2) + 1);
    const autoDoubleMoneyTrigger = getRandomInt(2) === 1 ? (getRandomInt(5) + 10) * 5 : false;
    const autoDoubleAfterNineTrigger = holeCount > 9 && getRandomInt(2) === 1;
    const autoDoubleWhileTiedTrigger = getRandomInt(3) === 1;
    const autoDoubles = autoDoubleMoneyTrigger || autoDoubleAfterNineTrigger || autoDoubleWhileTiedTrigger;
    const prox = "proximity";

    const questions = [{
        question: `Who got the point for ${prox}?`,
        answers: names,
        numberOfAnswers: 2,
        holes: "all"
    }];

    if (points === 8) {
        questions.push({
            question: `Who had the longest drive?`,
            answers: names,
            numberOfAnswers: 2,
            holes: "all"
        })
        questions.push({
            question: `Which team had the fewest putts?`,
            answers: teams,
            numberOfAnswers: 1,
            holes: "all"
        })
    }

    if (doubles) {
        if (redoubles) {
            questions.push({
                question: `Was there a press or double press?`,
                answers: ["Press", "Double Press"],
                numberOfAnswers: 1,
                holes: "all"
            })
        } else {
            questions.push({
                question: `Was there a press?`,
                answers: ["No", "Yes"],
                numberOfAnswers: 1,
                holes: "all"
            })
        }
    }

    let gameName = "scotch";
    let prompt = ``;
    let gameIndex = getRandomInt(6);
    let promptIndex = getRandomInt(4);
    let teamString = teams?.join(getRandomInt(2) === 1 ? " vs " : getRandomInt(2) === 1 ? " against " : " taking on ");

    if (getRandomInt(3) === 1) {
        const teamCopy = [...teams];
        const firstTeam = teams[0].split(" & ");
        firstTeam[0] = "Me";
        teamCopy[0] = firstTeam.join(" & ");
        teamString = teamCopy?.join(getRandomInt(2) === 1 ? " vs " : getRandomInt(2) === 1 ? " against " : " taking on ");
    }

    if (gameIndex === 1) {
        gameName = "bridge";
    } else if (gameIndex === 2) {
        gameName = "umbrella"
    }

    if (points === 4 && getRandomInt(4) === 1) {
        prompt = `${teams?.join(getRandomInt(2) === 1 ? " vs " : " against ")} in ${gameName}. `
    } else if (promptIndex === 1) {
        prompt = `${teams?.join(getRandomInt(2) === 1 ? " vs " : " against ")} in ${gameName}, ${points} point game. `
    } else if (promptIndex === 2) {
        prompt = `${points} point ${gameName} game, ${teamString}. `
    } else if (promptIndex === 3) {
        prompt = `${points} point ${gameName}, ${teamString}. `
    } else if (promptIndex === 4) {
        prompt = `${points} point ${gameName}, teams are ${teamString}. `
    }

    if (getRandomInt(8) === 1) {
        if (points === 4) {
            prompt += `1 point for low team, 1 point for low individual, 1 point for proximity, 1 point for birdies. `
        } else if (points === 6) {
            prompt += `2 points for low team, 2 points for low individual, 1 point for proximity, 1 point for birdies. `
        } else if (points === 8) {
            prompt += `2 points for low team, 2 points for low individual, 1 point for proximity, 1 point for birdies, 1 point for longest drive, and 1 point for team fewest putts. `
        }
    }

    promptIndex = getRandomInt(3);
    if (promptIndex === 1) {
        prompt += `$${pointVal}/point`
    } else if (promptIndex === 2) {
        prompt += `$${pointVal} per point`
    } else if (promptIndex === 3) {
        prompt += `$${pointVal} each point`
    }

    let autoDoubleStays = false;
    if (autoDoubles) {
        promptIndex = getRandomInt(3);
        autoDoubleStays = getRandomInt(3) !== 1;

        let after = ``;
        if (autoDoubleMoneyTrigger) {
            if (autoDoubleStays) {
                after = ` once someone goes down $${autoDoubleMoneyTrigger}`
            } else {
                after = ` while someone is down $${autoDoubleMoneyTrigger}`
            }
        }

        if (autoDoubleAfterNineTrigger) {
            if (autoDoubleMoneyTrigger) {
                after += ` or after the front 9`
            } else {
                after = ` after the front 9`
            }
        }

        if (autoDoubleWhileTiedTrigger) {
            if (autoDoubleAfterNineTrigger || autoDoubleMoneyTrigger) {
                after += ` or while the match is tied`
            } else {
                after += ` while the match is tied`
            }
        }

        if (promptIndex === 1) {
            prompt += `, goes to $${autoDoubleValue}${after}.`
        } else if (promptIndex === 2) {
            prompt += `, points go to $${autoDoubleValue}${after}.`
        } else if (promptIndex === 3) {
            prompt += `, but ups to $${autoDoubleValue}${after}.`
        }
    } else {
        prompt += `.`;
    }

    //Presses
    if (doubles) {
        const pressIndex = getRandomInt(10);
        if (pressIndex === 1) {
            if (redoubles) {
                prompt += ` Cups and bowls of soup`
            } else {
                prompt += ` Cups of soup`
            }

            if (getRandomInt(2) === 1) {
                prompt += ` allowed each hole.`;
            } else {
                prompt += ` allowed.`;
            }
        } else if (pressIndex === 2) {
            if (redoubles) {
                prompt += ` Bridges and rebridges`
            } else {
                prompt += ` Bridges`
            }

            if (getRandomInt(2) === 1) {
                prompt += ` allowed each hole.`;
            } else {
                prompt += ` allowed.`;
            }
        } else {
            const pressWord = getRandomInt(2) === 1 ? 'Presses' : 'Hammers';
            prompt += ` ${pressWord}`;
            if (redoubles) {
                prompt += ` and double ${pressWord.toLocaleLowerCase()}`
            }

            if (getRandomInt(2) === 1) {
                prompt += ` allowed each hole.`;
            } else {
                prompt += ` allowed.`;
            }
        }
    }

    let miracle = true;
    if (getRandomInt(5) === 1) {
        miracle = false;
        if (getRandomInt(3) === 1) {
            prompt += ` No miracles.`
        } else {
            prompt += ` Extra birdies don't double.`
        }
    } else if (getRandomInt(3) === 1) {
        if (getRandomInt(3) === 1) {
            prompt += ` Miracles in play.`
        } else if (getRandomInt(2) === 1) {
            prompt += ` Extra birdies double.`
        }
    }

    if (strokePrompt) {
        prompt += ` ${strokePrompt}`;
    }

    console.log("Prompt:", prompt);

    //Create the game...
    const matchId = uuidv4();
    await mariadbPool.query(
        `INSERT INTO Matches (id, createdBy, golfers, courseId, status) VALUES (?, ?, ?, ?, ?)`,
        [matchId, userId, JSON.stringify(names), course.courseId, "COURSE_PROVIDED"]
    );

    let messageId = uuidv4();
    const setupPrompt = `I'm playing a golf match and want you to keep score.\n\nGolfers: ${names.join(", ")}\n\nHere are the rules of the game: ${prompt}\n\nGenerate a JSON object with the questions and stroke holes needed to score it. Respond ONLY with valid raw JSON.`;
    await mariadbPool.query(
        `INSERT INTO Messages (id, threadId, role, type, training) VALUES (?, ?, ?, ?, ?)`,
        [messageId, matchId, "user", "setup", 1]
    );
    await mariadbPool.query(
        `INSERT INTO MessageContents (messageId, content) VALUES (?, ?)`,
        [messageId, setupPrompt]
    );

    await mariadbPool.query("UPDATE Matches SET status = ?, tees = ?, holeCount = ? WHERE id = ?", ["TEES_PROVIDED", JSON.stringify(tees), holeCount, matchId]);

    /*messageId = uuidv4();
    await mariadbPool.query(
        `INSERT INTO Messages (id, threadId, role, type, training, content) VALUES (?, ?, ?, ?, ?, ?)`,
        [messageId, matchId, "user", "setup", 1, `Tees by golfer: ${JSON.stringify(tees)}`]
    );

    const setupPrompt = `Based on the following description of the golf match we're playing, generate a JSON object with the questions and stroke holes needed to score it.\nRules:\n${prompt || "No rules just a regular game"}\nRespond ONLY with valid raw JSON.`;
    messageId = uuidv4();
    await mariadbPool.query(
        `INSERT INTO Messages (id, threadId, role, type, training, content) VALUES (?, ?, ?, ?, ?, ?)`,
        [messageId, matchId, "user", "setup", 1, setupPrompt]
    );*/

    const parsed = {
        strokes,
        questions
    }

    //console.log("parsed", JSON.stringify(parsed));

    const builtScorecards = buildScorecards(allScorecards, tees, parsed?.strokes, holeCount);

    await mariadbPool.query(
        "UPDATE Matches SET strokes = ?, isPublic = ?, displayName = ?, questions = ?, scorecards = ?, status = ? WHERE id = ?",
        [JSON.stringify(parsed?.strokes), isPublic ? 1 : 0, `${points} Point Scotch ($${pointVal})`, JSON.stringify(parsed?.questions), JSON.stringify(builtScorecards), "RULES_PROVIDED", matchId]
    );

    /*let explanation = `These are the correct questions because the user is playing ${points} point scotch, which means`;
    if (points === 4 || points === 6) {
        explanation += ` the points are for proximity, low individual${points === 6 ? " (worth 2)" : ""}, low team${points === 6 ? " (worth 2)" : ""}, and birdies. We ask who had proximity because it can't be deduced from the score alone, and since two players on the same team can each get a point for it, we allow up to 2 answers.`;
    } else {
        explanation += ` the points are for proximity, longest drive, lowest team putts, low individual, low team, and birdies. We ask who had proximity, longest drive, and fewest team putts because it can't be deduced from the score alone. Since two players on the same team can each get a point for proximity and longest drive, we allow up to 2 answers. Fewest team putts is combined for each team, so the available options are the two teams, not individuals.`;
    }

    if (doubles) {
        if (redoubles) {
            explanation += ` Additionally, the user indicated that the point value could be doubled and then redoubled on each hole, so we have to ask if that happened.`
        } else {
            explanation += ` Additionally, the user indicated that the point value could be doubled on each hole, so we have to ask if that happened.`
        }
    }*/

    messageId = uuidv4();
    await mariadbPool.query(
        `INSERT INTO Messages (id, threadId, role, type, training) VALUES (?, ?, ?, ?, ?)`,
        [messageId, matchId, "assistant", "setup", 1]
    );
    await mariadbPool.query(
        `INSERT INTO MessageContents (messageId, content) VALUES (?, ?)`,
        [messageId, JSON.stringify(parsed)]
    );

    /*prompt = `Everything looks good, get ready to track the results of the match.`;
    messageId = uuidv4();
    await mariadbPool.query(
        `INSERT INTO Messages (id, threadId, role, type, content) VALUES (?, ?, ?, ?, ?)`,
        [messageId, matchId, "user", "setup", prompt]
    );*/

    const summary = `I'm playing a golf match and want you to keep score.\n\nGolfers: ${names.join(", ")}\n\nHere are the rules of the game: ${prompt}`;
    const answers = blankAnswers(scorecards);

    await mariadbPool.query(
        "UPDATE Matches SET status = ?, answers = ?, setup = ? WHERE id = ?",
        ["READY_TO_START", answers, summary, matchId]
    );

    /*messageId = uuidv4();
    await mariadbPool.query(
        `INSERT INTO Messages (id, threadId, role, type, training, content) VALUES (?, ?, ?, ?, ?, ?)`,
        [messageId, matchId, "user", "score", 1, summary]
    );*/

    await simulateGame(matchId, mariadbPool, summary, builtScorecards, questions, JSON.parse(answers), teams, pointVal, points, autoDoubles, autoDoubleAfterNineTrigger, autoDoubleMoneyTrigger, autoDoubleWhileTiedTrigger, autoDoubleValue, autoDoubleStays, miracle);
}

async function simulateGame(matchId, mariadbPool, summary, builtScorecards, allQuestions, allAnswers, nameTeams, pointVal, points, autoDoubles, autoDoubleAfterNineTrigger, autoDoubleMoneyTrigger, autoDoubleWhileTiedTrigger, autoDoubleValue, autoDoubleStays, miracle) {
    let currentScorecard = [...builtScorecards];
    const teams = nameTeams.map(team => team.split(' & '));

    //TODO: Sometimes repeat a hole after match is complete (this will happen often)
    let scoredHoles = [];
    while (scoredHoles.length < currentScorecard[0].holes.length) {
        //Sometimes repeat a hole
        let holeToScore = currentScorecard[0].holes[scoredHoles.length].holeNumber;
        if (getRandomInt(currentScorecard[0].holes.length) <= currentScorecard[0].holes.length / 4) {
            //Update an existing hole
            holeToScore = currentScorecard[0].holes[getRandomInt(scoredHoles.length) - 1].holeNumber;
        }

        let scores = [];
        let questions = [];
        let holePar = 4;

        for (let i = 0; i < currentScorecard.length; i++) {
            const hole = currentScorecard[i].holes.find(h => h.holeNumber === holeToScore);
            if (!hole) {
                continue;
            }

            holePar = hole.par;

            scores.push({
                name: currentScorecard[i].name,
                score: 0,
                holeNumber: holeToScore,
                par: hole.par,
                strokes: hole.strokes
            })
        }

        for (let j = 0; j < allQuestions.length; j++) {
            const normalizedHoles = (allQuestions[j].holes || "").toLowerCase().replace(/\s+/g, "")

            let shouldAsk = false
            if (normalizedHoles === "all") {
                shouldAsk = true
            } else if (normalizedHoles === "par3s" && holePar === 3) {
                shouldAsk = true
            } else if (normalizedHoles === "par4s" && holePar === 4) {
                shouldAsk = true
            } else if (normalizedHoles === "par5s" && holePar === 5) {
                shouldAsk = true
            } else if (/^\d+\+$/.test(normalizedHoles)) {
                const minHole = parseInt(normalizedHoles)
                shouldAsk = holeToScore >= minHole
            } else if (/^(\d+,)*\d+$/.test(normalizedHoles)) {
                const allowed = normalizedHoles.split(",").map(Number)
                shouldAsk = allowed.includes(holeToScore)
            }

            if (shouldAsk) {
                questions.push(allQuestions[j]);
            }
        }

        scores = getScoresForHole(scores);
        const answeredQuestions = getAnswersForQuestions(questions, nameTeams);

        for (let k = 0; k < allAnswers.length; k++) {
            if (allAnswers[k].hole === holeToScore) {
                allAnswers[k].answers = answeredQuestions;
                break;
            }
        }

        const promptScorecard = cleanScorecard(currentScorecard);

        //Generate plusMinus and points for any holes that this score effects
        const results = getUpdatedHoles(currentScorecard, allAnswers, scores, nameTeams, teams, pointVal, points, autoDoubles, autoDoubleAfterNineTrigger, autoDoubleMoneyTrigger, autoDoubleWhileTiedTrigger, autoDoubleValue, autoDoubleStays, miracle);
        const parsed = results.expected;
        let explanation = results.explanation;
        currentScorecard = results.scorecards;

        if (parsed.length > teams.flat().length) {
            explanation += " I've returned the updated plusMinus for multiple holes because this score update changes their values.";
        } else {
            explanation += '.';
        }

        let prompt = "";
        const scoresToPrompt = scores.map(({ holeNumber, ...rest }) => rest);

        if (!scoredHoles.includes(holeToScore)) {
            //Generate prompt for new hole result
            prompt = `Hole ${holeToScore} results:\n\nScores: ${JSON.stringify(scoresToPrompt)}\nQuestion Answers: ${JSON.stringify(answeredQuestions)}`
            scoredHoles.push(holeToScore);
        } else {
            //Generate prompt for updated hole result
            prompt = `Updated hole ${holeToScore} results:\n\nScores: ${JSON.stringify(scoresToPrompt)}\nQuestion Answers: ${JSON.stringify(answeredQuestions)}`;
        }

        let scoreId = uuidv4();
        let messageId = uuidv4();
        const scorePrompt = `${summary}\n\nHere's the current scorecard: ${JSON.stringify(cleanScorecard(promptScorecard))}\n\n${prompt}`
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, type, training, scoreId) VALUES (?, ?, ?, ?, ?, ?)`,
            [messageId, matchId, "user", "score", 1, scoreId]
        );
        await mariadbPool.query(
            `INSERT INTO MessageContents (messageId, content) VALUES (?, ?)`,
            [messageId, scorePrompt]
        );

        //Separate into individual messages for results of each golfer
        const golferNames = teams.flat();
        const golferMap = new Map();

        // Preprocess parsed results by golfer name
        for (const result of parsed) {
            if (!golferMap.has(result.name)) {
                golferMap.set(result.name, []);
            }
            golferMap.get(result.name).push([
                `Hole ${result.holeNumber}`,
                result.plusMinus,
                result.points
            ]);
        }

        for (const golfer of golferNames) {
            const assistantJSONResponse = golferMap.get(golfer) || [];
            const assistantResponse = `EXPLANATION: ${filterGolferResultsInText(explanation, golfer)}\n\nJSON OUTPUT: ${JSON.stringify(assistantJSONResponse)}`

            const userMessageId = uuidv4();
            const assistantMessageId = uuidv4();

            await mariadbPool.query(`
                INSERT INTO Messages (id, threadId, role, type, training, scoreId)
                VALUES (?, ?, 'user', 'score', 1, ?), (?, ?, 'assistant', 'score', 1, ?)
            `, [
                userMessageId, matchId, scoreId,
                assistantMessageId, matchId, scoreId
            ]);

            await mariadbPool.query(`
                INSERT INTO MessageContents (messageId, content)
                VALUES (?, ?), (?, ?)
            `, [
                userMessageId, `What are the updated plusMinus and points for ${golfer}?`,
                assistantMessageId, assistantResponse
            ]);

            console.log(`ORIGINAL STRING: ${explanation}\nRETURNED (for ${golfer} as name): ${filterGolferResultsInText(explanation, golfer)}\n\n`)
        }

        /*messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, type, training, scoreId, content) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [messageId, matchId, "user", "score", 1, scoreId, `Current scorecard:\n${JSON.stringify(cleanScorecard(builtScorecards))}`]
        );

        messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, type, training, scoreId, content) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [messageId, matchId, "user", "score", 1, scoreId, prompt]
        );*/

        /*const assistantResponse = `Reasoning: ${explanation}\n\nJSON Output: ${JSON.stringify(parsed)}`;

        messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, type, training, scoreId) VALUES (?, ?, ?, ?, ?, ?)`,
            [messageId, matchId, "assistant", "score", 1, scoreId]
        );
        await mariadbPool.query(
            `INSERT INTO MessageContents (messageId, content) VALUES (?, ?)`,
            [messageId, assistantResponse]
        );*/

        let status = "IN_PROGRESS";
        if (scoredHoles.length === currentScorecard[0].holes.length) {
            status = "COMPLETED";
        }

        await mariadbPool.query(
            "UPDATE Matches SET scorecards = ?, answers = ?, status = ? WHERE id = ?",
            [JSON.stringify(currentScorecard), JSON.stringify(allAnswers), status, matchId]
        );
    }
}

function getUpdatedHoles(currentScorecard, allAnswers, scores, nameTeams, teams, pointVal, points, autoDoubles, autoDoubleAfterNineTrigger, autoDoubleMoneyTrigger, autoDoubleWhileTiedTrigger, autoDoubleValue, autoDoubleStays, miracle) {
    const originalScorecard = structuredClone(currentScorecard);
    let expected = [];
    let holeExplanations = [];

    //Add scores to currentScorecard
    for (let i = 0; i < currentScorecard.length; i++) {
        currentScorecard[i].plusMinus = 0;
        currentScorecard[i].points = 0;

        for (let j = 0; j < currentScorecard[i].holes.length; j++) {
            if (currentScorecard[i].holes[j].holeNumber === scores[0].holeNumber) {
                for (let k = 0; k < scores.length; k++) {
                    if (scores[k].name === currentScorecard[i].name) {
                        currentScorecard[i].holes[j].score = scores[k].score;
                        break;
                    }
                }

                break;
            }
        }
    }

    //Populate currentScorecard with new values based on scores
    let pointWorth = pointVal;
    let isDoubled = false;
    for (let i = 0; i < currentScorecard[0].holes.length; i++) {
        let firstTeamPoints = 0;
        let secondTeamPoints = 0;
        let firstTeamMoney = 0;
        let secondTeamMoney = 0;
        let explanationPieces = [];
        let doublePieces = [];
        let doubleString = '';

        if (autoDoubleWhileTiedTrigger) {
            let needsToDouble = true;
            for (let j = 0; j < currentScorecard.length; j++) {
                if (currentScorecard[j].plusMinus !== 0) {
                    needsToDouble = false;
                    break;
                }
            }

            if (needsToDouble && !isDoubled) {
                doublePieces.push(`the rules state the money goes to $${autoDoubleValue} while the match tied, and it was at the start of this hole`)
                isDoubled = true;
                pointWorth = autoDoubleValue;
            } else if (isDoubled && !needsToDouble) {
                //explanationPieces.push(`the rules state the money goes to $${autoDoubleValue} while the match tied, but it was not at the start of this hole`)
                isDoubled = false;
                pointWorth = pointVal;
            }
        }

        //Determine if we're ay autodouble somehow and apply
        if (autoDoubles && !isDoubled) {
            if (autoDoubleAfterNineTrigger && currentScorecard[0].holes[i].holeNumber > 9) {
                doublePieces.push(`the rules state the money goes to $${autoDoubleValue} when we get to the back 9, and this hole is on the back 9`)
                pointWorth = autoDoubleValue;
                isDoubled = true;
            } else if (autoDoubleMoneyTrigger > 0) {
                //Check if any golfer is above the trigger
                let triggerName = '';
                let triggerVal = '';
                for (let j = 0; j < currentScorecard.length; j++) {
                    if (Math.abs(currentScorecard[j].plusMinus) >= autoDoubleMoneyTrigger) {
                        pointWorth = autoDoubleValue;
                        triggerName = currentScorecard[j].name;
                        triggerVal = currentScorecard[j].plusMinus;
                        isDoubled = true;
                        break;
                    }
                }

                if (isDoubled) {
                    doublePieces.push(`the rules state the money goes to $${autoDoubleValue} when someone goes down $${autoDoubleMoneyTrigger}, and ${triggerName} was down $${Math.abs(triggerVal)} at the start of this hole`)
                }
            }
        } else if (autoDoubles && isDoubled && !autoDoubleStays) {
            //Check if no longer needed from trigger or match tied
            if (autoDoubleMoneyTrigger > 0 || autoDoubleWhileTiedTrigger) {
                let change = true;
                let changeDueToString = ` but since no one was down $${autoDoubleMoneyTrigger} or more the money per point did is not increased for this hole`;

                if (autoDoubleMoneyTrigger > 0) {
                    ;
                    for (let j = 0; j < currentScorecard.length; j++) {
                        if (Math.abs(currentScorecard[j].plusMinus) >= autoDoubleMoneyTrigger) {
                            change = false;
                            break;
                        }
                    }
                }

                if (change && autoDoubleWhileTiedTrigger) {
                    change = false;
                    for (let j = 0; j < currentScorecard.length; j++) {
                        if (currentScorecard[j].plusMinus !== 0) {
                            change = true;
                            changeDueToString = ` but since the match is no longer tied the money per point did is not increased for this hole`;
                            break;
                        }
                    }
                }

                if (change) {
                    doublePieces.push(`money per point was incresed on the last hole${changeDueToString}`)
                    pointWorth = pointVal;
                    isDoubled = false;
                }
            }
        }

        if (doublePieces.length > 0) {
            doubleString = doublePieces.join(", also ");
        }

        const teamScores = getTeamScoresOnHole(teams, currentScorecard, i);

        if (teamScores[0].includes(0) || teamScores[1].includes(0)) {
            break;
        }

        const answers = allAnswers[i].answers;
        let pointsNeededToSweep = points;

        if (points === 4) {
            if (getLowScoreWinners(teamScores).team1Wins) {
                explanationPieces.push(`${nameTeams[0]} both got 1 point for low individual because they're a team and it's worth one point in 4 point scotch and one or both of them had the lowest score`)
                firstTeamPoints++;
            } else if (getLowScoreWinners(teamScores).team2Wins) {
                explanationPieces.push(`${nameTeams[1]} both got the point for low individual because they're a team and it's worth one point in 4 point scotch and one or both of them had the lowest score`)
                secondTeamPoints++;
            } else {
                explanationPieces.push(`No one got a point for low individual because there was a tie between the lowest score of the two teams`)
            }

            if (getTeamTotals(teamScores[0]) < getTeamTotals(teamScores[1])) {
                firstTeamPoints++;
                explanationPieces.push(`${nameTeams[0]} both got 1 point for low team because it's worth one point in 4 point scotch and their combined score is lower than the combined score of ${nameTeams[1]}`)
            } else if (getTeamTotals(teamScores[0]) > getTeamTotals(teamScores[1])) {
                secondTeamPoints++;
                explanationPieces.push(`${nameTeams[1]} both got 1 point for low team because it's worth one point in 4 point scotch and their combined score is lower than the combined score of ${nameTeams[0]}`)
            } else {
                explanationPieces.push(`No one got a point for low team because there was a tie between the combined scores of the two teams`);
            }
        } else {
            if (getLowScoreWinners(teamScores).team1Wins) {
                firstTeamPoints += 2;
                explanationPieces.push(`${nameTeams[0]} both got 2 points for low individual because they're a team and it's worth two points in ${points} point scotch and one or both of them had the lowest score`)
            } else if (getLowScoreWinners(teamScores).team2Wins) {
                secondTeamPoints += 2;
                explanationPieces.push(`${nameTeams[1]} both got 2 points for low individual because they're a team and it's worth two points in ${points} point scotch and one or both of them had the lowest score`)
            } else {
                explanationPieces.push(`No one got any points for low individual because there was a tie between the lowest score of the two teams`)
            }

            if (getTeamTotals(teamScores[0]) < getTeamTotals(teamScores[1])) {
                firstTeamPoints += 2;
                explanationPieces.push(`${nameTeams[0]} got 2 points for low team because it's worth two points in 6 point scotch and their combined score is lower than the combined score of ${nameTeams[1]}`)
            } else if (getTeamTotals(teamScores[0]) > getTeamTotals(teamScores[1])) {
                secondTeamPoints += 2;
                explanationPieces.push(`${nameTeams[1]} got 2 points for low team because it's worth two points in 6 point scotch and their combined score is lower than the combined score of ${nameTeams[0]}`)
            } else {
                explanationPieces.push(`No one got any points for low team because there was a tie between the combined scores of the two teams`);
            }
        }

        let firstTeamBirdieCount = 0;
        let secondTeamBirdieCount = 0;

        if (teamScores[0][0] < currentScorecard[0].holes[i].par) {
            firstTeamBirdieCount += currentScorecard[0].holes[i].par - teamScores[0][0];
        }

        if (teamScores[0][1] < currentScorecard[0].holes[i].par) {
            firstTeamBirdieCount += currentScorecard[0].holes[i].par - teamScores[0][1];
        }

        if (teamScores[1][0] < currentScorecard[0].holes[i].par) {
            secondTeamBirdieCount += currentScorecard[0].holes[i].par - teamScores[1][0];
        }

        if (teamScores[1][1] < currentScorecard[0].holes[i].par) {
            secondTeamBirdieCount += currentScorecard[0].holes[i].par - teamScores[1][1];
        }

        if (firstTeamBirdieCount > 0) {
            if (secondTeamPoints > 0 || !miracle) {
                firstTeamPoints += firstTeamBirdieCount;
                explanationPieces.push(`${nameTeams[0]} each got ${firstTeamBirdieCount} point${firstTeamBirdieCount > 1 ? "s" : ""} for birdies because their scores that were under par were a combined ${firstTeamBirdieCount} under${miracle ? " and the other team got at least one point" : " and miracles aren't allowed so extra birdies don't double"}`)
            } else {
                firstTeamPoints++;
                let explanation = `${nameTeams[0]} each got 1 point for the birdie`;

                if (miracle && secondTeamPoints === 0 && firstTeamBirdieCount > 1) {
                    explanation += ` and the extra birdies don't count as individual points because each extra birdie just doubles the points`
                }

                explanationPieces.push(explanation);
            }
        }

        if (secondTeamBirdieCount > 0) {
            if (firstTeamPoints > 0) {
                secondTeamPoints += secondTeamBirdieCount;
                explanationPieces.push(`${nameTeams[1]} each got ${secondTeamBirdieCount} point${secondTeamBirdieCount > 1 ? "s" : ""} for birdies because their scores that were under par were a combined ${secondTeamBirdieCount} under${miracle ? " and the other team got at least one point" : " and miracles aren't allowed so extra birdies don't double"}`)
            } else {
                secondTeamPoints++;
                let explanation = `${nameTeams[1]} each got 1 point for the birdie`;

                if (miracle && firstTeamPoints === 0 && secondTeamBirdieCount > 1) {
                    explanation += ` and the extra birdies don't count as individual points because each extra birdie just doubles the points`
                }

                explanationPieces.push(explanation);
            }
        }

        let doubleValue = 1
        for (let j = 0; j < answers.length; j++) {
            if (answers[j].question === "Was there a press or double press?") {
                if (answers[j].answers.includes("Double Press")) {
                    doubleValue = 3;
                    explanationPieces.push(`points are doubled and then doubled again because there was a double press on the hole`);
                } else if (answers[j].answers.includes("Press")) {
                    doubleValue = 2;
                    explanationPieces.push(`points are doubled because there was a press on the hole`);
                }
            } else if (answers[j].question === "Was there a press?") {
                if (answers[j].answers.includes("Yes")) {
                    doubleValue = 2;
                    explanationPieces.push(`points are doubled because there was a press on the hole`);
                }
            } else if (answers[j].question === "Which team had the fewest putts?") {
                if (answers[j].answers.includes(nameTeams[0])) {
                    firstTeamPoints++;
                    explanationPieces.push(`${nameTeams[0]} got a point because they had the lowest combined putts`)
                } else if (answers[j].answers.includes(nameTeams[1])) {
                    secondTeamPoints++;
                    explanationPieces.push(`${nameTeams[1]} got a point because they had the lowest combined putts`)
                } else {
                    explanationPieces.push(`No one got a point for the lowest number of putts`)
                }
            } else if (answers[j].answers.includes(teams[0][0]) && answers[j].answers.includes(teams[0][1])) {
                firstTeamPoints += 2;
                explanationPieces.push(`${nameTeams[0]} each got 2 points because they both had a point for ${answers[j].question?.includes("proximity") ? "proximity" : "longest drive"}`)
                pointsNeededToSweep++;
            } else if (answers[j].answers.includes(teams[1][0]) && answers[j].answers.includes(teams[1][1])) {
                secondTeamPoints += 2;
                explanationPieces.push(`${nameTeams[1]} each got 2 points because they both had a point for ${answers[j].question?.includes("proximity") ? "proximity" : "longest drive"}`)
                pointsNeededToSweep++;
            } else if (answers[j].answers.includes(teams[0][0])) {
                firstTeamPoints++;
                explanationPieces.push(`${nameTeams[0]} each got 1 point because ${teams[0][0]} had the point for ${answers[j].question?.includes("proximity") ? "proximity" : "longest drive"}`)
            } else if (answers[j].answers.includes(teams[0][1])) {
                firstTeamPoints++;
                explanationPieces.push(`${nameTeams[0]} each got 1 point because ${teams[0][1]} had the point for ${answers[j].question?.includes("proximity") ? "proximity" : "longest drive"}`)
            } else if (answers[j].answers.includes(teams[1][0])) {
                secondTeamPoints++;
                explanationPieces.push(`${nameTeams[1]} each got 1 point because ${teams[1][0]} had the point for ${answers[j].question?.includes("proximity") ? "proximity" : "longest drive"}`)
            } else if (answers[j].answers.includes(teams[1][1])) {
                secondTeamPoints++;
                explanationPieces.push(`${nameTeams[1]} each got 1 point because ${teams[1][1]} had the point for ${answers[j].question?.includes("proximity") ? "proximity" : "longest drive"}`)
            }
        }

        /*console.log("**HOLE:", i + 1);
        console.log("Name Teams:", nameTeams);
        console.log("Array Teams:", teams);
        console.log("Team Scores:", teamScores);
        console.log("Team 1 Totals:", getTeamTotals(teamScores[0]));
        console.log("Team 2 Totals:", getTeamTotals(teamScores[1]));
        console.log("Answers:", JSON.stringify(answers, null, 2));
        console.log("First team points", firstTeamPoints);
        console.log("Second team points", secondTeamPoints);
        console.log("First team birdies", firstTeamBirdieCount);
        console.log("Second team birdies", secondTeamBirdieCount);
        console.log("First team money", firstTeamBirdieCount);
        console.log("Second team money", secondTeamBirdieCount);
        console.log("Point value:", pointVal);
        console.log("Point worth:", pointWorth);
        console.log("Points needed to sweep:", pointsNeededToSweep);*/

        let swept = false;
        if (secondTeamPoints === 0 && firstTeamPoints >= pointsNeededToSweep) {
            firstTeamPoints = firstTeamPoints * 2;
            swept = true;
        } else if (firstTeamPoints === 0 && secondTeamPoints >= pointsNeededToSweep) {
            secondTeamPoints = secondTeamPoints * 2;
            swept = true;
        }

        if (miracle && swept) {
            if (firstTeamBirdieCount > 1 && secondTeamBirdieCount === 0) {
                for (let j = 0; j < firstTeamBirdieCount - 1; j++) {
                    firstTeamPoints = firstTeamPoints * 2;
                }
            } else if (firstTeamBirdieCount === 0 && secondTeamBirdieCount > 1) {
                for (let j = 0; j < secondTeamBirdieCount - 1; j++) {
                    secondTeamPoints = secondTeamPoints * 2;
                }
            }

            explanationPieces.push(`one of the teams got 0 points so the points double`);
        }

        for (let j = 0; j < doubleValue - 1; j++) {
            firstTeamPoints = firstTeamPoints * 2;
            secondTeamPoints = secondTeamPoints * 2;
        }

        firstTeamMoney = (firstTeamPoints - secondTeamPoints) * pointWorth;
        secondTeamMoney = (secondTeamPoints - firstTeamPoints) * pointWorth;

        for (let j = 0; j < currentScorecard.length; j++) {
            if (teams[0].includes(currentScorecard[j].name)) {
                currentScorecard[j].plusMinus += firstTeamMoney;
                currentScorecard[j].points += firstTeamPoints;
                currentScorecard[j].holes[i].plusMinus = firstTeamMoney;
                currentScorecard[j].holes[i].points = firstTeamPoints;
            } else if (teams[1].includes(currentScorecard[j].name)) {
                currentScorecard[j].plusMinus += secondTeamMoney;
                currentScorecard[j].points += secondTeamPoints;
                currentScorecard[j].holes[i].plusMinus = secondTeamMoney;
                currentScorecard[j].holes[i].points = secondTeamPoints;
            }
        }

        let explanationString = `${explanationPieces.join(", also ")}${doubleString ?  `, also ${doubleString}` : ""}. So doing the math of the point value on this hole ($${pointVal}) and total points for each golfer, ${nameTeams[0]} each got ${firstTeamPoints} point${firstTeamPoints !== 1 ? "s" : ""} and ${firstTeamMoney} plusMinus (money won or lost), and ${nameTeams[1]} each got ${secondTeamPoints} point${secondTeamPoints !== 1 ? "s" : ""} and ${secondTeamMoney} plusMinus (money won or lost)`;
        holeExplanations.push({
            holeNumber: currentScorecard[0].holes[i].holeNumber,
            explanation: explanationString
        })
    }

    //Build expected array based on differences between currentScorecard and originalScorecard
    let updatedExplanations = [];
    for (let i = 0; i < currentScorecard[0].holes.length; i++) {
        let hasChange = false;

        for (let j = 0; j < currentScorecard.length; j++) {
            if (currentScorecard[j].holes[i].plusMinus !== originalScorecard[j].holes[i].plusMinus || currentScorecard[j].holes[i].points !== originalScorecard[j].holes[i].points || currentScorecard[j].holes[i].score !== originalScorecard[j].holes[i].score) {
                hasChange = true;
                break;
            }
        }

        if (hasChange) {
            let expectedUpdate = [];

            for (let j = 0; j < currentScorecard.length; j++) {
                expectedUpdate.push({
                    name: currentScorecard[j].name,
                    points: currentScorecard[j].holes[i].points,
                    score: currentScorecard[j].holes[i].score,
                    plusMinus: currentScorecard[j].holes[i].plusMinus,
                    holeNumber: currentScorecard[j].holes[i].holeNumber,
                })
            }

            for (let j = 0; j < holeExplanations.length; j++) {
                if (holeExplanations[j].holeNumber === currentScorecard[0].holes[i].holeNumber) {
                    if (holeExplanations[j].holeNumber === scores[0].holeNumber) {
                        updatedExplanations.push(`HOLE ${holeExplanations[j].holeNumber}: ${holeExplanations[j].explanation}`);
                    } else {
                        updatedExplanations.push(`HOLE ${holeExplanations[j].holeNumber} (Changed due to update): ${holeExplanations[j].explanation}`);
                    }

                    break;
                }
            }

            expected.push(...expectedUpdate);
        }
    }

    return {
        scorecards: currentScorecard,
        expected,
        explanation: updatedExplanations.join(". ")
    }
}

function filterGolferResultsInText(fullString, golferName) {
    const mathRegex = /So doing the math of the point value on this hole\s*(\(\$\d+\))\s*and total points for each golfer,([\s\S]*?)(?=(HOLE \d+:|$))/g;
    let result = fullString;

    result = result.replace(mathRegex, (_, dollarAmount, pointsText) => {
        const resultRegex = /([A-Za-z\s&]+?) (?:each|both) got (\d+) point(?:s|points)? and (-?\d+) plusMinus \(money won or lost\)/gi;
        const matches = [...pointsText.matchAll(resultRegex)];
        const matchingLines = [];

        for (const match of matches) {
            const [_, namesStr, points, plusMinus] = match;
            const names = namesStr.split('&').map(n => n.trim());
            if (names.includes(golferName)) {
                matchingLines.push(`${golferName} got ${points} points and ${plusMinus} plusMinus (money won or lost).`);
            }
        }

        const insert = matchingLines.length > 0
            ? matchingLines.join(' ')
            : `${golferName} had no result on this hole.`;

        return `So doing the math of the point value on this hole ${dollarAmount} ${insert}`;
    });

    return result;
}

function getTeamTotals(teamScores) {
    return teamScores.reduce((sum, num) => sum + num, 0);
}

function getLowScoreWinners(teamScores) {
    const [team1Scores, team2Scores] = teamScores;

    const team1Wins = team1Scores.some(score1 =>
        team2Scores.every(score2 => score1 < score2)
    );

    const team2Wins = team2Scores.some(score2 =>
        team1Scores.every(score1 => score2 < score1)
    );

    return { team1Wins, team2Wins };
}

function getTeamScoresOnHole(teams, currentScorecard, i) {
    const result = teams.map(team => {
        return team.map(playerName => {
            const playerCard = currentScorecard.find(p => p.name === playerName);
            if (!playerCard) return null;
            const hole = playerCard.holes[i];
            return hole?.score ?? null;
        });
    });

    return result;
}

function getAnswersForQuestions(questions, teams) {
    let answeredQuestions = [];
    for (let i = 0; i < questions.length; i++) {
        let answers = [];
        let answerIndex = getRandomInt(questions[i].answers.length) - 1;
        let doubleAnswer = questions[i].numberOfAnswers > 1 && getRandomInt(4) === 1;

        if (getRandomInt(4) > 1) {
            answers.push(questions[i].answers[answerIndex]);
            if (doubleAnswer) {
                const player1 = questions[i].answers[answerIndex];
                for (let j = 0; j < teams.length; j++) {
                    if (teams[j].includes(player1)) {
                        const players = teams[j].split(" & ");
                        if (!answers.includes(players[0])) {
                            answers.push(players[0]);
                        } else {
                            answers.push(players[1]);
                        }

                        break;
                    }
                }
            }
        }

        answeredQuestions.push({
            question: questions[i].question,
            answers
        })
    }

    return answeredQuestions;
}

function getScoresForHole(holes) {
    for (let i = 0; i < holes?.length; i++) {
        const toParIndex = getRandomInt(15);
        let toPar = 0;
        if (toParIndex === 1) {
            toPar = -2;
        } else if (toParIndex <= 3) {
            toPar = -1;
        } else if (toParIndex <= 6) {
            toPar = 1;
        } else if (toParIndex <= 8) {
            toPar = 2;
        } else if (toParIndex === 9) {
            toPar = 3;
        }

        holes[i].score = holes[i].par + toPar;
    }

    return holes;
}

async function runSimulations(count) {
    for (let i = 0; i < count; i++) {
        await runScotchGame();
    }

    await mariadbPool.end();
}

runSimulations(process.argv[2]);
const { getCourse } = require('../course');
const { getPlayerNames } = require('../players');
const { getTees } = require('../tees');
const { buildScorecards, getRandomInt, pickTeam, blankAnswers } = require('../utils');
const { getStrokes } = require('../strokes');

const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

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

    //const strokes = getStrokes(names, holes);
    const strokes = names.map(name => ({
        name,
        pops: []
    }));

    const teams = pickTeam(names, 2);
    const pointIndex = getRandomInt(40) + 4;
    const points = pointIndex % 2 === 0 ? 4 : pointIndex % 3 === 0 ? 6 : 8;
    const pointVal = getRandomInt(6);
    const doubles = getRandomInt(3) !== 1;
    const redoubles = doubles && getRandomInt(3) !== 1;
    const autoDoubles = getRandomInt(2) !== 1;
    const autoDoubleValue = pointVal * (getRandomInt(2) + 1);
    const autoDoubleMoneyTrigger = getRandomInt(2) === 1 ? (getRandomInt(5) + 10) * 5 : false;
    const autoDoubleAfterNineTrigger = getRandomInt(2) === 1;
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
        prompt = `${points} point ${gameName} game, ${teams?.join(getRandomInt(2) === 1 ? " vs " : " against ")}. `
    } else if (promptIndex === 3) {
        prompt = `${points} point ${gameName}, ${teams?.join(getRandomInt(2) === 1 ? " vs " : " against ")}. `
    } else if (promptIndex === 4) {
        prompt = `${points} point ${gameName}, teams are ${teams?.join(getRandomInt(2) === 1 ? " vs " : " against ")}. `
    }

    promptIndex = getRandomInt(3);
    if (pointVal === 2 && getRandomInt(4) === 1) {
        prompt += ``;
    } else if (promptIndex === 1) {
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

    //TODO: miracle/double birdies
    let mircale = true;
    if (getRandomInt(5) === 1) {
        mircale = false;
        if (getRandomInt(3) === 1) {
            prompt += ` No miracles.`
        } else {
            prompt += ` Extra birdies don't double.`
        }
    } else if (getRandomInt(3) === 1) {
        if (getRandomInt(3) === 1) {
            prompt += ` Miracles in play.`
        } else {
            prompt += ` Extra birdies double.`
        }
    }

    //If strokes.prompt, add it to prompt here

    //Create the game...
    const matchId = uuidv4();
    await mariadbPool.query(
        `INSERT INTO Matches (id, createdBy, golfers, courseId, status) VALUES (?, ?, ?, ?, ?)`,
        [matchId, userId, JSON.stringify(names), course.CourseID, "COURSE_PROVIDED"]
    );

    let messageId = uuidv4();
    await mariadbPool.query(
        `INSERT INTO Messages (id, threadId, role, type, content) VALUES (?, ?, ?, ?, ?)`,
        [messageId, matchId, "user", "setup", `I'm playing a golf match and want you to keep score. Golfers: ${JSON.stringify(names)} | Course: ${course.FullName}`]
    );

    await mariadbPool.query("UPDATE Matches SET status = ?, tees = ?, holeCount = ? WHERE id = ?", ["TEES_PROVIDED", JSON.stringify(tees), holeCount, matchId]);

    messageId = uuidv4();
    await mariadbPool.query(
        `INSERT INTO Messages (id, threadId, role, type, content) VALUES (?, ?, ?, ?, ?)`,
        [messageId, matchId, "user", "setup", `Tees by golfer: ${JSON.stringify(tees)}`]
    );

    const setupPrompt = `Based on the following description of the golf match we're playing, generate a JSON object with the questions and stroke holes needed to score it.\n\nRules:\n${prompt || "No rules just a regular game"}\n\nRespond ONLY with valid raw JSON.`;
    messageId = uuidv4();
    await mariadbPool.query(
        `INSERT INTO Messages (id, threadId, role, type, content) VALUES (?, ?, ?, ?, ?)`,
        [messageId, matchId, "user", "setup", setupPrompt]
    );

    const parsed = {
        strokes,
        questions
    }

    const builtScorecards = buildScorecards(scorecards, tees, parsed?.strokes, holeCount);

    await mariadbPool.query(
        "UPDATE Matches SET strokes = ?, isPublic = ?, displayName = ?, questions = ?, scorecards = ?, status = ? WHERE id = ?",
        [JSON.stringify(parsed?.strokes), isPublic ? 1 : 0, parsed?.displayName, JSON.stringify(parsed?.questions), JSON.stringify(builtScorecards), "RULES_PROVIDED", matchId]
    );

    messageId = uuidv4();
    await mariadbPool.query(
        `INSERT INTO Messages (id, threadId, role, type, content) VALUES (?, ?, ?, ?, ?)`,
        [messageId, matchId, "assistant", "json", JSON.stringify(parsed, null, 2)]
    );

    prompt = `Everything looks good, get ready to track the results of the match.`;
    messageId = uuidv4();
    await mariadbPool.query(
        `INSERT INTO Messages (id, threadId, role, type, content) VALUES (?, ?, ?, ?, ?)`,
        [messageId, matchId, "user", "setup", prompt]
    );

    const answers = blankAnswers(scorecards);
    await mariadbPool.query(
        "UPDATE Matches SET status = ?, answers = ? WHERE id = ?",
        ["READY_TO_START", answers, matchId]
    );

    simulateGame(matchId, mariadbPool, builtScorecards, questions, answers, teams, pointVal, points, doubles, redoubles, autoDoubles, autoDoubleAfterNineTrigger, autoDoubleMoneyTrigger, autoDoubleValue, autoDoubleStays, mircale);
}

async function simulateGame(matchId, mariadbPool, builtScorecards, allQuestions, allAnswers, teams, pointVal, points, doubles, redoubles, autoDoubles, autoDoubleAfterNineTrigger, autoDoubleMoneyTrigger, autoDoubleValue, autoDoubleStays, miracle) {
    let currentScorecard = builtScorecards;
    teams = teams.map(team => team.split(' & '));

    let scoredHoles = [];
    while (scoredHoles.length < currentScorecard[0].holes.length) {
        //Sometimes repeat a hole
        let holeToScore = getRandomInt(currentScorecard[0].holes.length) === 1 ? getRandomInt(scoredHoles.length) : scoredHoles.length;
        let scores = [];
        let questions = [];
        let holePar = 4;

        for (let i = 0; i < currentScorecard.length; i++) {
            const hole = currentScorecard[i].holes.find(h => h.holeNumber === holeToScore);
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
        const answeredQuestions = getAnswersForQuestions(questions);

        //TODO: Update existing answers for hole or add them
        for (let i = 0; i < allAnswers.length; i++) {
            if (allAnswers[i].hole === holeToScore) {
                allAnswers[i].answers = answeredQuestions;
                break;
            }
        }

        //Generate plusMinus and points for any holes that this score effects
        const results = getUpdatedHoles(currentScorecard, allAnswers, scores, teams, pointVal, points, doubles, redoubles, autoDoubles, autoDoubleAfterNineTrigger, autoDoubleMoneyTrigger, autoDoubleValue, autoDoubleStays, miracle);
        const parsed = results.expected;
        currentScorecard = results.scorecards;

        let prompt = "";
        if (!scoredHoles.includes(holeToScore)) {
            //Generate prompt for new hole result
            prompt = `Here are the hole results for hole ${holeToScore}\nScores: ${JSON.stringify(scores, null, 2)}\nQuestion Answers: ${JSON.stringify(answeredQuestions, null, 2)}\nRespond with the data for this hole and any other hole this score affects.`
            scoredHoles.push(holeToScore);
        } else {
            //Generate prompt for updated hole result
            prompt = `I've updated results for hole ${holeToScore}\nScores: ${JSON.stringify(scores, null, 2)}\nQuestion Answers: ${JSON.stringify(answeredQuestions, null, 2)}\nRespond with the data for this hole and any other hole this update affects.`;
        }

        let messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, type, content) VALUES (?, ?, ?, ?, ?)`,
            [messageId, matchId, "user", "score", prompt]
        );

        messageId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Messages (id, threadId, role, type, content) VALUES (?, ?, ?, ?, ?)`,
            [messageId, matchId, "assistant", "json", JSON.stringify(parsed, null, 2)]
        );

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

function getUpdatedHoles(currentScorecard, allAnswers, scores, teams, pointVal, points, doubles, redoubles, autoDoubles, autoDoubleAfterNineTrigger, autoDoubleMoneyTrigger, autoDoubleValue, autoDoubleStays, miracle) {
    const originalScorecard = currentScorecard;
    let expected = [];

    //Populate currentScorecard with new values based on scores

    //Build expected array based on differences between currentScorecard and originalScorecard
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

            expected.push(expectedUpdate);
        }
    }
   
    return {
        scorecards: currentScorecard,
        expected
    }
}

function getAnswersForQuestions(questions, teams) {
    let answeredQuestions = [];
    for (let i = 0; i < questions.length; i++) {
        let answers = [];
        let answerIndex = getRandomInt(questions[i].answers.length + 1) - 1;

        if (answerIndex < questions[i].answers.length) {
            answers.push(questions[i].answers[answerIndex]);
            if (questions[i].numberOfAnswers > 1 && getRandomInt(5) === 1) {
                //Add team member
                const player1 = questions[i].answers[answerIndex];
                for (let j = 0; j < teams.length; j++) {
                    if (teams[j].includes(player1)) {
                        answers = teams[j];
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

//TODO: Do this on a loop
runScotchGame();
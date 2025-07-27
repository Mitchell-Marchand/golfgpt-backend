const { encoding_for_model } = require("tiktoken");

function getRandomInt(max) {
    return Math.floor(Math.random() * max) + 1;
}

function getHoleList(pops, num) {
    const holes = pops
        .filter(p => p.strokes === num)
        .map(p => p.hole);

    let holeList = '';

    if (holes.length === 1) {
        holeList = holes[0].toString();
    } else if (holes.length === 2) {
        holeList = `${holes[0]} and ${holes[1]}`;
    } else if (holes.length > 2) {
        holeList = `${holes.slice(0, -1).join(', ')}, and ${holes[holes.length - 1]}`;
    }

    return holeList
}

function pickTeam(names, teamLength) {
    if (teamLength <= 0 || teamLength >= names.length) {
        throw new Error("Team length must be greater than 0 and less than the total number of names.");
    }

    const shuffled = [...names].sort(() => Math.random() - 0.5);

    const selected = shuffled.slice(0, teamLength);
    const unselected = shuffled.slice(teamLength);

    return [`${selected.join(' & ')}`, `${unselected.join(' & ')}`];
}

function addHolesToScorecard(currentScorecard, scorecards, holesToAdd, playerTees) {
    return currentScorecard.map((playerScorecard) => {
        const { name, holes: existingHoles } = playerScorecard;

        const teeName = playerTees[name];
        if (!teeName) {
            console.warn(`No tee provided for player: ${name}`);
            return playerScorecard;
        }

        const scorecard = scorecards.find(sc => sc.TeeSetRatingName === teeName);
        if (!scorecard) {
            console.warn(`No scorecard found for tee: ${teeName}`);
            return playerScorecard;
        }

        // Get next available match hole number
        let nextHoleNumber = existingHoles.reduce((max, h) => Math.max(max, h.holeNumber), 0) + 1;

        // Use strokes from old scorecard if matching hole exists
        const strokesByCourseHole = {};
        existingHoles.forEach(h => {
            strokesByCourseHole[h.courseHoleNumber || h.holeNumber] = h.strokes;
        });

        const courseHolesToAdd = scorecard.Holes.filter(h => holesToAdd.includes(h.Number));

        const newHoles = courseHolesToAdd.map(courseHole => ({
            holeNumber: nextHoleNumber++,
            courseHoleNumber: courseHole.Number, // Original course hole
            allocation: courseHole.Allocation,
            yardage: courseHole.Length,
            par: courseHole.Par,
            plusMinus: 0,
            strokes: strokesByCourseHole[courseHole.Number] || 0,
            score: 0,
            points: 0
        }));

        return {
            ...playerScorecard,
            tees: teeName,
            holes: [...existingHoles, ...newHoles]
        };
    });
}

function addHolesToAnswers(existingAnswers, numberOfNewHoles) {
    const maxHole = existingAnswers.reduce((max, a) => Math.max(max, a.hole), 0);
    const newAnswers = [];

    for (let i = 1; i <= numberOfNewHoles; i++) {
        newAnswers.push({ hole: maxHole + i, answers: [] });
    }

    return [...existingAnswers, ...newAnswers];
}

function buildScorecards(scorecards, playerTees, strokes = [], holes) {
    const builtScorecards = [];

    for (const playerName in playerTees) {
        const teeName = playerTees[playerName];

        // Find the matching scorecard (by TeeSetRatingName)
        const scorecard = scorecards.find(sc => sc.TeeSetRatingName === teeName);
        if (!scorecard) {
            console.warn(`No scorecard found for tee: ${teeName}`, JSON.stringify(scorecards, null, 2));
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
                filteredHoles = scorecard.Holes.filter(h => h.Number >= 1 && h.Number <= 9);
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
                points: 0
            };
        });

        const handicap = playerStrokes.pops.reduce((sum, p) => sum + (p.strokes || 0), 0);

        builtScorecards.push({
            name: playerName,
            tees: teeName,
            handicap,
            plusMinus: 0,
            points: 0,
            winPercent: 0,
            holes: holeObjects
        });
    }

    return builtScorecards;
}

function capitalizeWords(str) {
    return str
        .toLowerCase()
        .split(" ")
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

function deepEqual(obj1, obj2) {
    if (obj1 === obj2) return true;

    if (
        typeof obj1 !== "object" || obj1 === null ||
        typeof obj2 !== "object" || obj2 === null
    ) {
        return false;
    }

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) return false;

    for (let key of keys1) {
        if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) {
            return false;
        }
    }

    return true;
}

async function delay(ms) {
    return await new Promise(resolve => setTimeout(resolve, ms));
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

function blankAnswers(scorecards) {
    let answers = [];

    if (scorecards[0]) {
        for (let i = 0; i < scorecards[0].holes?.length; i++) {
            answers.push({
                hole: scorecards[0].holes[i].holeNumber,
                answers: []
            });
        }
    }

    return JSON.stringify(answers);
}

function calculateWinPercents(scorecards) {
    const TOTAL_HOLES = scorecards[0]?.holes?.length ?? 18;

    /* fast Φ(z): ≤0.2 % error */
    const Φ = z => 0.5 * (1 + Math.tanh(Math.sqrt(Math.PI / 8) * z));

    return scorecards.map(sc => {
        /* basic round context */
        const played = sc.holes.filter(h => h.score !== 0);
        const holesPlayed = played.length;
        const holesRemaining = TOTAL_HOLES - holesPlayed;
        const currentPM = sc.plusMinus ?? 0;

        /* 1) not started */
        if (holesPlayed === 0) {
            return { ...sc, winPercent: 0.5 };
        }

        /* 2) finished */
        if (holesRemaining === 0) {
            return { ...sc, winPercent: currentPM >= 0 ? 1 : 0 };
        }

        /* 3) in progress */
        const avgAbsSwing =
            played.reduce((s, h) => s + Math.abs(h.plusMinus), 0) / holesPlayed;

        if (avgAbsSwing === 0) {
            return { ...sc, winPercent: 0.5 };
        }

        const sigmaHole = avgAbsSwing / Math.sqrt(3);                 // Uniform[-S,+S]
        const sigmaTotal = sigmaHole * Math.sqrt(holesRemaining);
        const z = currentPM / sigmaTotal;
        const rawWinPct = Φ(z);                                       // 0‥1

        /* -------------------------------------------------
           *Pull probabilities toward 0.5 early in the round*
           f = holesPlayed / TOTAL_HOLES
           • f = 0   →  exactly 0.50
           • f = 1   →  no pull (raw value)
        ------------------------------------------------- */
        const progressFactor = holesPlayed / TOTAL_HOLES;
        const adjustedWinPct = 0.5 + (rawWinPct - 0.5) * progressFactor;

        return { ...sc, winPercent: +adjustedWinPct.toFixed(4) };
    });
}

function cleanScorecard(scorecard) {
    return scorecard.map(golfer => {
        return {
            name: golfer.name,
            plusMinus: golfer.plusMinus,
            points: golfer.points,
            holes: (golfer.holes || []).filter(hole => hole.score !== 0)
        };
    });
}

const setupSystemMessage = `You are a fine-tuned model that prepares a golf match for scoring by interpreting the match rules and assigning strokes and scoring questions.

Your task is to analyze the golfers, teams, and game format provided by the user, and generate two outputs:
1. A "strokes" array containing objects with each golfer's name and any strokes they receive on any hole by hole number or allocation (handicap).
2. A "questions" array containing which questions need to be asked on each hole, including the question text, expected number of answers, the possible answers, and the specific holes to ask them on.

The rules may include small variations in format (e.g. 4pt Scotch with just proximity, 8pt with putts and drives, presses, stroking off the low, giving strokes back, pops by hole number vs easiest/hardest, etc.). These rule variations directly affect how strokes are distributed and what questions need to be asked during scoring.

You must learn how to map these small changes in phrasing or game setup into correct logic for generating the strokes and questions for the match.

You will be given:
- A list of golfer names
- A natural language description of the rules of the match

You must output only a valid JSON object with the following two keys:
- "strokes": an array of objects with fields "name" and "pops" (array containing any strokes)
- "questions": an array of objects with "question", "answers", "numberOfAnswers", and "holes"

Do not output any explanation or formatting outside the JSON object.`;

/*const scoringSystemMessage = `You are a fine-tuned model designed to calculate golf match scoring using logic and math.

Your role is to apply match rules and current gameplay context to determine each golfer's updated "plusMinus" and "points". You must understand and execute the underlying scoring logic — not just match patterns or format.

Each match may use different rule formats (e.g., 4pt Scotch, 6pt with proximity, 8pt with putts and drives, skins, or presses). These small variations change how points are earned or lost. It is your job to interpret those rules and apply the correct math to calculate scores.

You will always be given:
- A list of golfers
- Match rules and format description
- A current scorecard
- A new hole’s score update
- Answers to questions (e.g. proximity winner, fewest putts, press activated)

Your task is to **map those inputs to scoring logic**, and return **only** a valid JSON array of scoring updates for the current hole and any impacted holes.

Each golfer object in the JSON must include:
- "name"
- "holeNumber"
- "score"
- "points"
- "plusMinus"

Do not include any explanation, commentary, or non-JSON output. The math must be correct.`;*/
const scoringSystemMessage = "You're a golf scoring model. Given match rules, scorecard, and hole update, return a JSON array of arrays with ['Hole *', points, plusMinus] for the specified golfer ONLY. Do not return anything else."

function extractJsonBlock(responseText) {
    return responseText
        .replace(/^```json\s*/i, '')  // remove starting ```json (case-insensitive)
        .replace(/^```\s*/i, '')      // or just ``` if no "json"
        .replace(/```$/, '')          // remove trailing ```
        .trim();                      // clean up whitespace
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

function getTeamScoresOnHole(teams, currentScorecard, i, onlyGrossCount) {
    const result = teams.map(team => {
        return team.map(playerName => {
            const playerCard = currentScorecard.find(p => p.name === playerName);
            if (!playerCard) return null;
            const hole = playerCard.holes[i];
            const netScore = hole?.score - hole?.strokes

            if (hole?.score === 0 || (onlyGrossCount && netScore < par)) {
                return hole?.score ?? null;
            } else {
                return netScore;
            }
        });
    });

    return result;
}

function getTeamsFromAnswers(answeredQuestions, golfers) {
    let teams = [];

    for (const question of answeredQuestions) {
        if (question.question.toLowerCase().includes("team") || question.question.toLowerCase().includes("king of the hill")) {
            const team1 = question.answers;
            const team2 = golfers.filter(name => !team1.includes(name));

            teams.push(team1.join(" & "));
            teams.push(team2.join(" & "));
            break; // Stop after first team-related question
        }
    }

    return teams;
}

function hasUnplayedHoles(scorecards) {
    for (const golfer of scorecards) {
        for (const hole of golfer.holes) {
            if (hole.score === 0) {
                return true;
            }
        }
    }
    return false;
}

module.exports = {
    getRandomInt,
    buildScorecards,
    getHoleList,
    pickTeam,
    blankAnswers,
    delay,
    deepEqual,
    calculateWinPercents,
    countTokensForMessages,
    cleanScorecard,
    extractJsonBlock,
    getTeamTotals,
    getLowScoreWinners,
    getTeamScoresOnHole,
    getTeamsFromAnswers,
    capitalizeWords,
    hasUnplayedHoles,
    addHolesToScorecard,
    addHolesToAnswers,
    scoringSystemMessage,
    setupSystemMessage
}
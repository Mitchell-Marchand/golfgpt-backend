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
    const enc = encoding_for_model("gpt-4o")
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

function getPlusMinusSumUpToHole(scorecard, holeNumber) {
    if (!scorecard || !Array.isArray(scorecard.holes)) return 0;

    return scorecard.holes
        .filter(hole => hole.holeNumber < holeNumber)
        .reduce((sum, hole) => sum + (hole.plusMinus || 0), 0);
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

function getPointWorthForHole({
    holeNumber,
    currentScorecard,
    pointVal,
    autoDoubleValue,
    autoDoubles,
    autoDoubleWhileTiedTrigger,
    autoDoubleAfterNineTrigger,
    autoDoubleMoneyTrigger,
    autoDoubleStays
}) {
    if (!autoDoubles) {
        return pointVal;
    }

    // 1. Auto double if match is tied at this hole
    const isMatchTied = autoDoubleWhileTiedTrigger &&
        currentScorecard.every(golfer =>
            getPlusMinusSumUpToHole(golfer, holeNumber) === 0
        );

    if (isMatchTied) {
        return autoDoubleValue;
    }

    // 2. Auto double if after 9 and setting is true
    if (autoDoubleAfterNineTrigger && holeNumber > 9) {
        return autoDoubleValue;
    }

    // 3. Auto double if money trigger is hit at this hole
    const isMoneyTriggerHitThisHole =
        autoDoubleMoneyTrigger > 0 &&
        currentScorecard.some(golfer =>
            Math.abs(getPlusMinusSumUpToHole(golfer, holeNumber)) >= autoDoubleMoneyTrigger
        );

    if (isMoneyTriggerHitThisHole) {
        return autoDoubleValue;
    }

    // 4. Auto double if money trigger was hit on *any prior* hole and stays is enabled
    if (autoDoubleStays && autoDoubleMoneyTrigger > 0) {
        for (let h = 1; h < holeNumber; h++) {
            const moneyTriggerHitPreviously = currentScorecard.some(golfer =>
                Math.abs(getPlusMinusSumUpToHole(golfer, h)) >= autoDoubleMoneyTrigger
            );
            if (moneyTriggerHitPreviously) {
                return autoDoubleValue;
            }
        }
    }

    // 5. Default case: no auto double
    return pointVal;
}

function generateSummary(scorecards, configType, config) {
    if (!Array.isArray(scorecards) || scorecards.length === 0) return "";

    // Holes with at least one entered score
    const playedHoles = scorecards[0].holes
        .filter(h => scorecards.some(g => g.holes.find(x => x.holeNumber === h.holeNumber && x?.score && x.score !== 0)))
        .map(h => h.holeNumber);

    const holesPlayed = playedHoles.length;
    if (holesPlayed === 0) return "";

    const throughWord = holesPlayed === scorecards[0].holes.length ? "after" : "through";

    const formatNames = golfers => golfers
        .map(g => {
            const parts = g.name.trim().split(" ");
            return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[1][0]}`;
        })
        .join(golfers.length === 2 ? " and " : ", ");

    const getTotal = (g, key) =>
        g.holes.reduce((sum, h) => sum + (h[key] || 0), 0);

    const parseTeams = () =>
        (config.teams?.map(t => t.split(" & ").map(n => n.trim())) || scorecards.map(g => [g.name]));

    const formatTeam = (teamArr) => {
        const golfers = teamArr.map(n => scorecards.find(g => g.name === n)).filter(Boolean);
        return formatNames(golfers);
    };

    const isTied = (a, b) => Math.abs(a - b) < 0.001;

    const dollar = amt => {
        const abs = Math.abs(amt);
        return abs % 1 === 0 ? `$${abs}` : `$${abs.toFixed(2)}`;
    };

    const formatStat = val => (val % 1 === 0 ? val : val.toFixed(1));

    // NEW: If allMatches exists, use match-play style summary
    const matches = scorecards?.[0]?.allMatches;
    if (Array.isArray(matches) && matches.length > 0) {
        // Prefer "Overall" original match if present, else first active, else first
        const match =
            matches.find(m => m.original && (m.name?.toLowerCase?.() === "overall")) ||
            matches.find(m => m.active) ||
            matches[0];

        // Map only the holes that actually have scores entered
        const holesInMatch = (match.endingHole - match.startingHole + 1);
        const playedInThisMatch = (match.holeByHole || [])
            .filter(h => playedHoles.includes(h.hole));

        const holesPlayedInMatch = playedInThisMatch.length;
        const throughWordMatch = holesPlayedInMatch === holesInMatch ? "after" : "through";

        // lead > 0 => first team leads; lead < 0 => second team leads
        // Treat any positive points as a hole to Team 1, negative as a hole to Team 2, zero as halved
        let lead = 0;
        for (const h of playedInThisMatch) {
            if (h.points > 0) lead += 1;
            else if (h.points < 0) lead -= 1;
            // 0 => halved, no change
        }

        const teams = parseTeams();
        // Fallback if teams are not provided; use first two scorecards as teams of one
        const team1 = teams[0] || [scorecards[0].name];
        const team2 = teams[1] || [scorecards[1]?.name].filter(Boolean);

        // If still no team2 (weird edge case), bail to generic tied text
        if (!team2.length) return `Tied ${throughWord} ${holesPlayed}`;

        const holesRemaining = holesInMatch - holesPlayedInMatch;
        if (lead === 0) {
            return `All square ${throughWordMatch} ${holesPlayedInMatch}`;
        } else {
            const leaderTeam = lead > 0 ? team1 : team2;
            const leadAbs = Math.abs(lead);

            // Early finish if a side is up by more than holes remaining
            if (leadAbs > holesRemaining) {
                if (holesRemaining === 0) {
                  return `${formatTeam(leaderTeam)} won ${leadAbs} up`;
                } else {
                  return `${formatTeam(leaderTeam)} won ${leadAbs} & ${holesRemaining}`;
                }
              }
        }
    }

    // === Existing logic (money/points/stroke/etc.) ===
    const moneyGames = ["scotch", "umbrella", "bridge", "vegas", "daytona", "wolf", "left-right", "middle-outside", "flip wolf", "king of the hill", "banker"];
    if (moneyGames.includes(configType)) {
        const maxMoney = Math.max(...scorecards.map(g => getTotal(g, "plusMinus")));
        const leaders = scorecards.filter(g => getTotal(g, "plusMinus") === maxMoney);
        if (maxMoney !== 0 && leaders.length < scorecards.length) {
            return `${formatNames(leaders)} ${leaders.length === 1 ? "is" : "are"} up ${dollar(maxMoney)} ${throughWord} ${holesPlayed}`;
        } else {
            return `Tied ${throughWord} ${holesPlayed}`;
        }
    }

    if (["nine point", "stableford", "quota"].includes(configType)) {
        const pointVal = config.pointVal || config.perPointValue || 0;
        const byMoney = pointVal > 0;
        const stat = byMoney ? "plusMinus" : "points";
        const maxStat = Math.max(...scorecards.map(g => getTotal(g, stat)));
        const leaders = scorecards.filter(g => getTotal(g, stat) === maxStat);
        if (maxStat !== 0 && leaders.length < scorecards.length) {
            const display = byMoney ? dollar(maxStat) : `${formatStat(maxStat)} pts`;
            return `${formatNames(leaders)} ${leaders.length === 1 ? "is" : "are"} up ${display} ${throughWord} ${holesPlayed}`;
        } else {
            return `Tied ${throughWord} ${holesPlayed}`;
        }
    }

    if (["match play", "stroke play", "best ball", "scramble", "shamble", "bramble", "chapman", "alt shot"].includes(configType)) {
        const type = config.type || "match";
        const isMatch = config.perHoleOrMatch === "match";
        const teams = parseTeams();

        if (isMatch && teams.length === 2) {
            let team1 = teams[0];
            let team2 = teams[1];
            let t1Points = 0;
            let t2Points = 0;

            for (let i = 0; i < holesPlayed; i++) {
                const scores = scorecards.map(g => {
                    const h = g.holes[i];
                    return {
                        name: g.name,
                        score: h?.score || 0,
                        strokes: h?.strokes || 0
                    };
                });

                const teamScore = team =>
                    team.map(name => {
                        const s = scores.find(s => s.name === name);
                        return (s?.score || 0) - (s?.strokes || 0);
                    });

                const t1 = teamScore(team1);
                const t2 = teamScore(team2);

                const v1 = type === "stroke" ? t1.reduce((a, b) => a + b, 0) : Math.min(...t1);
                const v2 = type === "stroke" ? t2.reduce((a, b) => a + b, 0) : Math.min(...t2);

                if (v1 < v2) t1Points += type === "stroke" ? v2 - v1 : 1;
                else if (v2 < v1) t2Points += type === "stroke" ? v1 - v2 : 1;
                else t1Points += 0.5, t2Points += 0.5;
            }

            if (!isTied(t1Points, t2Points)) {
                const lead = t1Points > t2Points ? team1 : team2;
                const diff = Math.abs(t1Points - t2Points);
                return `${formatTeam(lead)} ${lead.length === 1 ? "is" : "are"} up ${formatStat(diff)}${type === "stroke" ? " (strokes)" : ""} ${throughWord} ${holesPlayed}`;
            } else {
                return `Tied ${throughWord} ${holesPlayed}`;
            }
        }

        if (configType === "stroke play" && !config.perMatchValue && !config.perHoleValue) {
            const netScores = scorecards.map(g => ({
                name: g.name,
                net: g.holes.reduce((sum, h) => sum + ((h.score || 0) - (h.strokes || 0)), 0),
                handicap: g.handicap || 0
            }));

            const minNet = Math.min(...netScores.map(n => n.net));
            const netLeaders = netScores.filter(n => n.net === minNet);
            if (netLeaders.length < scorecards.length) {
                const label = netLeaders.some(n => n.handicap > 0) ? " (net)" : "";
                const names = netLeaders.map(n => {
                    const parts = n.name.trim().split(" ");
                    return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[1][0]}`;
                });
                return `${names.join(" and ")} ${names.length === 1 ? "is" : "are"} up${label} ${throughWord} ${holesPlayed}`;
            }
        }

        if (config.perHoleOrMatch === "hole") {
            const maxMoney = Math.max(...scorecards.map(g => getTotal(g, "plusMinus")));
            const leaders = scorecards.filter(g => getTotal(g, "plusMinus") === maxMoney);
            if (maxMoney !== 0 && leaders.length < scorecards.length) {
                return `${formatNames(leaders)} ${leaders.length === 1 ? "is" : "are"} up ${dollar(maxMoney)} ${throughWord} ${holesPlayed}`;
            } else {
                return `Tied ${throughWord} ${holesPlayed}`;
            }
        }
    }

    // Fallback: lowest net leader(s)
    const netScores = scorecards.map(g => ({
        name: g.name,
        net: g.holes.reduce((sum, h) => sum + ((h.score || 0) - (h.strokes || 0)), 0),
        handicap: g.handicap || 0
    }));

    const minNet = Math.min(...netScores.map(n => n.net));
    const netLeaders = netScores.filter(n => n.net === minNet);

    if (netLeaders.length < scorecards.length) {
        const label = netLeaders.some(n => n.handicap > 0) ? " (net)" : "";
        const names = netLeaders.map(n => {
            const parts = n.name.trim().split(" ");
            return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[1][0]}`;
        });
        return `${names.join(" and ")} ${names.length === 1 ? "is" : "are"} up${label} through ${holesPlayed}`;
    }

    return `Tied through ${holesPlayed}`;
}

function tallyPlusMinus(scorecards) {
    let allHolesPlayed = true;
    for (i = 0; i < scorecards.length; i++) {
        let plusMinus = 0;
        let handicap = 0;
        let points = 0;
        let golferPlayedAllHoles = true;

        for (j = 0; j < scorecards[i].holes.length; j++) {
            if (scorecards[i].holes[j].score === 0) {
                scorecards[i].holes[j].plusMinus = 0;
                scorecards[i].holes[j].points = 0;
                golferPlayedAllHoles = false;
            }

            plusMinus += scorecards[i].holes[j].plusMinus;
            handicap += scorecards[i].holes[j].strokes;
            points += scorecards[i].holes[j].points;
        }

        scorecards[i].plusMinus = plusMinus;
        scorecards[i].handicap = handicap;
        scorecards[i].points = points;

        if (allHolesPlayed && !golferPlayedAllHoles) {
            allHolesPlayed = false;
        }
    }

    return { allHolesPlayed, scorecards }
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
    getPlusMinusSumUpToHole,
    getPointWorthForHole,
    generateSummary,
    tallyPlusMinus,
    scoringSystemMessage,
    setupSystemMessage
}
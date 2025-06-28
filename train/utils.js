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

module.exports = {
    getRandomInt,
    buildScorecards,
    getHoleList,
    pickTeam,
    blankAnswers,
    delay,
    deepEqual,
    calculateWinPercents
}
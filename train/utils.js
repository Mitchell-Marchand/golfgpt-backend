export function getRandomInt(max) {
    return Math.floor(Math.random() * max) + 1;
}

export function getHoleList(pops, num) {
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

export function buildScorecards(scorecards, playerTees, strokes = [], holes) {
    const builtScorecards = [];

    for (const playerName in playerTees) {
        const teeName = playerTees[playerName];

        // Find the matching scorecard (by TeeSetRatingName)
        const scorecard = scorecards.find(sc => sc.TeeSetRatingName === teeName);
        if (!scorecard) {
            console.warn(`No scorecard found for tee: ${teeName}`);
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
                point: 0
            };
        });

        const handicap = playerStrokes.pops.reduce((sum, p) => sum + (p.strokes || 0), 0);

        builtScorecards.push({
            name: playerName,
            tees: teeName,
            handicap,
            plusMinus: 0,
            points: 0,
            winPercent: 0.5,
            holes: holeObjects
        });
    }

    return builtScorecards;
}
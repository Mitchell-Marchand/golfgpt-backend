export function getTees(golfers, allScorecards, holes) {
    const unique = new Map();
    allScorecards.forEach(tee => {
        if (tee.Gender !== 'Female' && !unique.has(tee.TeeSetRatingName)) {
            unique.set(tee.TeeSetRatingName, tee);
        }
    });

    let sortedTees = Array.from(unique.values()).sort(
        (a, b) => b.TotalYardage - a.TotalYardage
    );

    const options = sortedTees.slice(0, 3);
    const baseTee =
        options.length > 0
            ? options[Math.floor(Math.random() * options.length)]
            : sortedTees[0];

    let finalTeeName = baseTee ? baseTee.TeeSetRatingName : '';

    if (holes === 9) {
        const nineType = Math.random() < 0.5 ? 'Front 9' : 'Back 9';
        finalTeeName += ` (${nineType})`;
    }

    const teesByGolfer = {};
    golfers.forEach(golfer => {
        teesByGolfer[golfer] = finalTeeName;
    });

    return teesByGolfer;
}
function getTees(golfers, allScorecards) {
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

    const finalTeeName = baseTee ? baseTee.TeeSetRatingName : '';

    const teesByGolfer = {};
    golfers.forEach(golfer => {
        teesByGolfer[golfer] = finalTeeName;
    });

    return teesByGolfer;
}

module.exports = {
    getTees
}
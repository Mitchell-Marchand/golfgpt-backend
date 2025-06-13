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
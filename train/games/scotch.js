const { getCourse } = require('../course');
const { getPlayerNames } = require('../players');
const { getTees } = require('../tees');
const { buildScorecards, getRandomInt } = require('../utils');
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
    const allScorecards = JSON.parse(course.scorecards);
    const tees = getTees(names, allScorecards, holeCount);

    console.log("building scorecards", allScorecards, tees, [], holeCount);

    const scorecards = buildScorecards(allScorecards, tees, [], holeCount);

    let holes = [];

    if (scorecards?.length > 0) {
        for (let i = 0; i < scorecards[0].holes?.length; i++) {
            holes.push({
                holeNumber: scorecards[0].holes[i]?.holeNumber,
                allocation: scorecards[0].holes[i]?.allocation
            })
        } 
    } else {
        console.log("Error building scorecards");
        return;
    }
    
    const strokes = getStrokes(names, holes);
    console.log("Prompt:", strokes.prompt);
    console.log("Strokes:", JSON.stringify(strokes.strokes, null, 2));
}

//TODO: Do this on a loop
runScotchGame();
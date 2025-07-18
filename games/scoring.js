const { getTeamTotals, getLowScoreWinners, getTeamScoresOnHole, getTeamsFromAnswers } = require('../train/utils');

function tallyStandardJunk(scorecards, question, holeNumber, teamsWithAnds, golfers, value, isTeam) {
    if (isTeam && teamsWithAnds.length > 0) {
        //Add plusMinus for team scores
        const teamNames = teamsWithAnds.map(team => team.split(' & '))
        for (let k = 0; k < question.answers?.length; k++) {
            let winningTeam = teamNames[0];
            let losingTeam = teamNames[1];

            if (losingTeam.includes(question.answers[k])) {
                winningTeam = teamNames[1];
                losingTeam = teamNames[0]
            }

            const totalPot = losingTeam.length * value || 0;

            if (totalPot !== 0) {
                const winnersEachGet = Math.round(totalPot / winningTeam.length * 100) / 100;
                for (let m = 0; m < winningTeam.length; m++) {
                    const golferCard = scorecards.find(g => g.name === winningTeam[m]);
                    const hole = golferCard.holes.find(h => h.holeNumber === holeNumber);
                    hole.plusMinus += winnersEachGet;
                }

                for (let m = 0; m < losingTeam.length; m++) {
                    const golferCard = scorecards.find(g => g.name === losingTeam[m]);
                    const hole = golferCard.holes.find(h => h.holeNumber === holeNumber);
                    hole.plusMinus -= value || 0;
                }
            }
        }
    } else {
        //Add plusMinus for just this golfer
        for (let k = 0; k < question.answers?.length; k++) {
            const opponents = golfers.length - 1;
            const won = opponents * value || 0
            const golferCard = scorecards.find(g => g.name === question.answers[k]);
            const hole = golferCard.holes.find(h => h.holeNumber === holeNumber);
            hole.plusMinus += won;

            for (let m = 0; m < golfers.length; m++) {
                if (question.answers[k] !== golfers[m]) {
                    const golferCard = scorecards.find(g => g.name === golfers[m]);
                    const hole = golferCard.holes.find(h => h.holeNumber === holeNumber);
                    hole.plusMinus -= value || 0;
                }
            }
        }
    }

    return scorecards;
}

function trackSnake(scorecards, answers, teams, snakeConfig, golfers) {
    let lastToThreePutt = false;
    let lastHole = 0;
    let pot = 0;
    for (let i = 0; i < answers.length; i++) {
        const questions = answers[i];
        for (let j = 0; j < questions?.answers?.length; j++) {
            const question = questions.answers[j];
            if (question.question?.includes("three-putt") && question.answers?.length > 0) {
                lastToThreePutt = question.answers[0];
                lastHole = questions.hole;
                pot += Math.abs(snakeConfig.value);
            }
        }
    }

    if (lastToThreePutt) {
        //Determine if team pentalty, and whether shared or full pot per opponent
        if (snakeConfig?.teams) {
            //team snake
            const teamsWithAnds = teams || getTeamsFromAnswers(answers.find(h => h.hole === lastHole).answers, golfers);
            const teamNames = teamsWithAnds.map(team => team.split(' & '))
            let winningTeam = teamNames[0];
            let losingTeam = teamNames[1];

            if (winningTeam.includes(lastToThreePutt)) {
                winningTeam = teamNames[1];
                losingTeam = teamNames[0]
            }

            let penalty = pot;
            if (snakeConfig.sharedPenalty) {
                penalty = Math.round(pot / (winningTeam.length - 1) * 100) / 100;
            }

            const winnersEachGet = penalty;
            const losersEachPay = (penalty * winningTeam.length) / losingTeam.length;

            for (let i = 0; i < golfers.length; i++) {
                const golferCard = scorecards.find(g => g.name === golfers[i]);
                const hole = golferCard.holes.find(h => h.holeNumber === lastHole);
                if (winningTeam.includes(golfers[i])) {
                    hole.plusMinus += winnersEachGet || 0;
                } else {
                    hole.plusMinus -= losersEachPay || 0;
                }
            }
        } else {
            let penalty = pot;
            if (snakeConfig.sharedPenalty) {
                penalty = Math.round(pot / (golfers.length - 1) * 100) / 100;
            }

            const golferCard = scorecards.find(g => g.name === lastToThreePutt);
            const hole = golferCard.holes.find(h => h.holeNumber === lastHole);
            hole.plusMinus -= Math.round((penalty * (golfers.length - 1)) * 100) / 100 || 0;

            for (let i = 0; i < golfers.length; i++) {
                if (golfers[i] !== lastToThreePutt) {
                    const golferCard = scorecards.find(g => g.name === golfers[i]);
                    const hole = golferCard.holes.find(h => h.holeNumber === lastHole);
                    hole.plusMinus += penalty || 0;
                }
            }
        }
    }

    return scorecards;
}

function trackSkins(scorecards, skinsConfig, golfers) {
    let skins = [];
    let pot = 0;
    if (skinsConfig.fromPot) {
        pot = golfers.length * skinsConfig.potValue || 0;
    }

    for (let i = 0; i < scorecards[0].holes.length; i++) {
        let skin = false;
        let scoreToBeat = false;
        for (let j = 0; j < golfers.length; j++) {
            const scorecard = scorecards.find(card => card.name === golfers[j]);
            const hole = scorecard.holes[i];
            if (hole.score > 0 && (!skin || skin?.score > hole.score) && (!scoreToBeat || hole.score < scoreToBeat)) {
                scoreToBeat = hole.score;
                skin = { name: golfers[j], score: hole.score, holeNumber: hole.holeNumber }
            } else if (skin && hole.score === skin.score) {
                skin = false;
            }
        }

        if (skin && skinsConfig.validation && i < scorecards[0].holes.length - 1) {
            //Determine if skin was proven
            const scorecard = scorecards.find(card => card.name === skin.name);
            const holeToProve = scorecard.holes[i + 1];
            if (holeToProve.score > holeToProve.par) {
                skin = false;
            }
        }

        if (skin) {
            skins.push(skin);
            if (!skinsConfig.fromPot) {
                pot += (skinsConfig.value * golfers.length) || 0
            }
        }
    }

    if (skins.length > 0) {
        const skinValue = Math.round(pot / skins.length * 100) / 100;
        const perGolferValue = Math.round(skinValue / golfers.length * 100) / 100;

        for (let i = 0; i < skins.length; i++) {
            const skin = skins[i];
            const scorecard = scorecards.find(card => card.name === skin.name);
            const hole = scorecard.holes.find(hole => hole.holeNumber === skin.holeNumber)
            hole.plusMinus += skinValue;

            for (let j = 0; j < golfers.length; j++) {
                const scorecard = scorecards.find(card => card.name === golfers[j]);
                const hole = scorecard.holes.find(hole => hole.holeNumber === skin.holeNumber)
                hole.plusMinus -= perGolferValue;
            }
        }
    }

    return scorecards;
}

function junk(scorecards, answers, strippedJunk, golfers, teams) {
    for (let i = 0; i < scorecards[0].holes.length; i++) {
        const teamsWithAnds = teams || getTeamsFromAnswers(answers[i].answers, golfers);
        const questions = answers.find(obj => obj.hole === scorecards[0].holes[i].holeNumber);

        for (let j = 0; j < questions?.answers?.length; j++) {
            const question = questions.answers[j];
            if (strippedJunk.chipIns?.valid && question.question?.includes("chip in") && question.answers?.length > 0) {
                scorecards = tallyStandardJunk(scorecards, question, questions.hole, teamsWithAnds, golfers, strippedJunk.chipIns?.value, strippedJunk.chipIns?.teams);
            }

            if (strippedJunk.greenies?.valid && question.question?.includes("closest to the pin") && question.answers?.length > 0) {
                scorecards = tallyStandardJunk(scorecards, question, questions.hole, teamsWithAnds, golfers, strippedJunk.greenies?.value, strippedJunk.greenies?.teams);
            }

            if (strippedJunk.sandies?.valid && question.question?.includes("sandie") && question.answers?.length > 0) {
                scorecards = tallyStandardJunk(scorecards, question, questions.hole, teamsWithAnds, golfers, strippedJunk.sandies?.value, strippedJunk.sandies?.teams);
            }

            if (strippedJunk.polies?.valid && question.question?.includes("polie") && question.answers?.length > 0) {
                scorecards = tallyStandardJunk(scorecards, question, questions.hole, teamsWithAnds, golfers, strippedJunk.polies?.value, strippedJunk.polies?.teams);
            }

            if (strippedJunk.barkies?.valid && question.question?.includes("barkie") && question.answers?.length > 0) {
                scorecards = tallyStandardJunk(scorecards, question, questions.hole, teamsWithAnds, golfers, strippedJunk.barkies?.value, strippedJunk.barkies?.teams);
            }

            if (strippedJunk.arnies?.valid && question.question?.includes("Arnie") && question.answers?.length > 0) {
                scorecards = tallyStandardJunk(scorecards, question, questions.hole, teamsWithAnds, golfers, strippedJunk.arnies?.value, strippedJunk.arnies?.teams);
            }

            if (strippedJunk.oozle?.valid && question.question?.includes("first to hole out") && question.answers?.length > 0) {
                scorecards = tallyStandardJunk(scorecards, question, questions.hole, teamsWithAnds, golfers, strippedJunk.oozle?.value, strippedJunk.oozle?.teams);
            }

            if (strippedJunk.fish?.valid && question.question?.includes("a water hazard") && question.answers?.length > 0) {
                scorecards = tallyStandardJunk(scorecards, question, questions.hole, teamsWithAnds, golfers, strippedJunk.fish?.value * -1, strippedJunk.fish?.teams);
            }
        }
    }

    if (strippedJunk.snake?.valid) {
        scorecards = trackSnake(scorecards, answers, teams, strippedJunk.snake, golfers);
    }

    if (strippedJunk.skins?.valid) {
        scorecards = trackSkins(scorecards, strippedJunk.skins, golfers);
    }

    //TODO: streaks

    return scorecards;
}

function scotch(currentScorecard, allAnswers, scores, nameTeams, teams, pointVal, points, autoDoubles, autoDoubleAfterNineTrigger, autoDoubleMoneyTrigger, autoDoubleWhileTiedTrigger, autoDoubleValue, autoDoubleStays, miracle, onlyGrossBirdies) {
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

        const teamScores = getTeamScoresOnHole(teams, currentScorecard, i, onlyGrossBirdies);
        if (teamScores[0].includes(0) || teamScores[1].includes(0)) {
            continue;
        }

        if (autoDoubleWhileTiedTrigger) {
            let needsToDouble = true;
            for (let j = 0; j < currentScorecard.length; j++) {
                if (currentScorecard[j].plusMinus !== 0) {
                    needsToDouble = false;
                    break;
                }
            }

            if (needsToDouble && !isDoubled) {
                isDoubled = true;
                pointWorth = autoDoubleValue;
            } else if (isDoubled && !needsToDouble) {
                isDoubled = false;
                pointWorth = pointVal;
            }
        }

        //Determine if we're ay autodouble somehow and apply
        if (autoDoubles && !isDoubled) {
            if (autoDoubleAfterNineTrigger && currentScorecard[0].holes[i].holeNumber > 9) {
                pointWorth = autoDoubleValue;
                isDoubled = true;
            } else if (autoDoubleMoneyTrigger > 0) {
                //Check if any golfer is above the trigger
                for (let j = 0; j < currentScorecard.length; j++) {
                    if (Math.abs(currentScorecard[j].plusMinus) >= autoDoubleMoneyTrigger) {
                        pointWorth = autoDoubleValue;
                        isDoubled = true;
                        break;
                    }
                }
            }
        } else if (autoDoubles && isDoubled && !autoDoubleStays) {
            //Check if no longer needed from trigger or match tied
            if (autoDoubleMoneyTrigger > 0 || autoDoubleWhileTiedTrigger) {
                let change = true;

                if (autoDoubleMoneyTrigger > 0) {
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
                            break;
                        }
                    }
                }

                if (change) {
                    pointWorth = pointVal;
                    isDoubled = false;
                }
            }
        }

        const answers = allAnswers[i].answers;
        let pointsNeededToSweep = points;

        if (points === 4) {
            if (getLowScoreWinners(teamScores).team1Wins) {
                firstTeamPoints++;
            } else if (getLowScoreWinners(teamScores).team2Wins) {
                secondTeamPoints++;
            }

            if (getTeamTotals(teamScores[0]) < getTeamTotals(teamScores[1])) {
                firstTeamPoints++;
            } else if (getTeamTotals(teamScores[0]) > getTeamTotals(teamScores[1])) {
                secondTeamPoints++;
            }
        } else {
            if (getLowScoreWinners(teamScores).team1Wins) {
                firstTeamPoints += 2;
            } else if (getLowScoreWinners(teamScores).team2Wins) {
                secondTeamPoints += 2;
            }

            if (getTeamTotals(teamScores[0]) < getTeamTotals(teamScores[1])) {
                firstTeamPoints += 2;
            } else if (getTeamTotals(teamScores[0]) > getTeamTotals(teamScores[1])) {
                secondTeamPoints += 2;
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
            } else {
                firstTeamPoints++;
            }
        }

        if (secondTeamBirdieCount > 0) {
            if (firstTeamPoints > 0) {
                secondTeamPoints += secondTeamBirdieCount;
            } else {
                secondTeamPoints++;
            }
        }

        let doubleValue = 1
        for (let j = 0; j < answers.length; j++) {
            if (answers[j].question === "Was there a press or a double press?") {
                if (answers[j].answers.includes("Double Press")) {
                    doubleValue = 3;
                } else if (answers[j].answers.includes("Press")) {
                    doubleValue = 2;
                }
            } else if (answers[j].question === "Was there a press?") {
                if (answers[j].answers.includes("Yes")) {
                    doubleValue = 2;
                }
            } else if (answers[j].question === "Which team had the fewest putts?") {
                if (answers[j].answers.includes(nameTeams[0])) {
                    firstTeamPoints++;
                } else if (answers[j].answers.includes(nameTeams[1])) {
                    secondTeamPoints++;
                }
            } else if (answers[j].question === "Who got the point for proximity?" || answers[j].question === "Who had the longest drive?") {
                if (answers[j].answers.includes(teams[0][0]) && answers[j].answers.includes(teams[0][1])) {
                    firstTeamPoints += 2;
                    pointsNeededToSweep++;
                } else if (answers[j].answers.includes(teams[1][0]) && answers[j].answers.includes(teams[1][1])) {
                    secondTeamPoints += 2;
                    pointsNeededToSweep++;
                } else if (answers[j].answers.includes(teams[0][0])) {
                    firstTeamPoints++;
                } else if (answers[j].answers.includes(teams[0][1])) {
                    firstTeamPoints++;
                } else if (answers[j].answers.includes(teams[1][0])) {
                    secondTeamPoints++;
                } else if (answers[j].answers.includes(teams[1][1])) {
                    secondTeamPoints++;
                }
            }
        }

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
        }

        for (let j = 0; j < doubleValue - 1; j++) {
            firstTeamPoints = firstTeamPoints * 2;
            secondTeamPoints = secondTeamPoints * 2;
        }

        firstTeamMoney = (firstTeamPoints - secondTeamPoints) * pointWorth;
        secondTeamMoney = (secondTeamPoints - firstTeamPoints) * pointWorth;

        for (let j = 0; j < currentScorecard.length; j++) {
            if (teams[0].includes(currentScorecard[j].name)) {
                //currentScorecard[j].plusMinus += firstTeamMoney;
                //currentScorecard[j].points += firstTeamPoints;
                currentScorecard[j].holes[i].plusMinus = firstTeamMoney;
                currentScorecard[j].holes[i].points = firstTeamPoints;
            } else if (teams[1].includes(currentScorecard[j].name)) {
                //currentScorecard[j].plusMinus += secondTeamMoney;
                //currentScorecard[j].points += secondTeamPoints;
                currentScorecard[j].holes[i].plusMinus = secondTeamMoney;
                currentScorecard[j].holes[i].points = secondTeamPoints;
            }
        }
    }

    return currentScorecard;
}

function vegas(scorecards, scores, config, answers) {
    const {
        teams,
        pointVal = 1,
        autoDoubles = false,
        autoDoubleAfterNineTrigger = false,
        autoDoubleMoneyTrigger = 0,
        autoDoubleWhileTiedTrigger = false,
        autoDoubleValue = 2,
        autoDoubleStays = false,
        birdiesFlip = true,
        additionalBirdiesDouble = true,
        onlyGrossBirdies = false,
    } = config;

    const teamArray = teams.map(team => team.split(" & ").map(name => name.trim()));

    const currentHole = scores[0]?.holeNumber;
    if (!currentHole) return scorecards;

    const holeIndex = scorecards[0].holes.findIndex(h => h.holeNumber === currentHole);
    if (holeIndex === -1) return scorecards;

    const par = scores[0].par;

    // STEP 1: Update scorecards
    for (const golfer of scorecards) {
        const scoreEntry = scores.find(s => s.name === golfer.name);
        if (scoreEntry) {
            const hole = golfer.holes[holeIndex];
            hole.score = scoreEntry.score;
            hole.strokes = scoreEntry.strokes || 0;
        }
    }

    // STEP 2: Collect team scores
    const teamScores = teamArray.map(teamNames => {
        return teamNames.map(name => {
            const golfer = scorecards.find(g => g.name === name);
            if (!golfer) throw new Error(`Golfer "${name}" not found in scorecards`);
            const hole = golfer.holes[holeIndex];
            const gross = hole.score;
            const net = gross - (hole.strokes || 0);
            return { name, gross, net };
        });
    });

    // STEP 3: Count birdie equivalents
    const birdieCounts = teamScores.map(players =>
        players.reduce((sum, { gross, net }) => {
            const usedScore = onlyGrossBirdies ? gross : net;
            const diff = par - usedScore;
            return diff > 0 ? sum + diff : sum;
        }, 0)
    );

    // STEP 4: Calculate vegas values
    const vegasValues = teamScores.map(players => {
        const [a, b] = players.map(p => p.net);
        const [low, high] = a <= b ? [a, b] : [b, a];
        return parseInt(`${low}${high}`);
    });

    // STEP 5: Birdie flip
    if (birdiesFlip && birdieCounts[0] !== birdieCounts[1]) {
        const teamToFlip = birdieCounts[0] > birdieCounts[1] ? 1 : 0;
        vegasValues[teamToFlip] = parseInt(vegasValues[teamToFlip].toString().split('').reverse().join(''));
    }

    // STEP 6: Determine point difference
    const diff = Math.abs(vegasValues[0] - vegasValues[1]);
    let team1Points = 0;
    let team2Points = 0;

    if (vegasValues[0] < vegasValues[1]) {
        team1Points = diff;
    } else if (vegasValues[1] < vegasValues[0]) {
        team2Points = diff;
    }

    // STEP 7: Additional birdies
    if (additionalBirdiesDouble) {
        if (team1Points && birdieCounts[0] > 1) {
            team1Points *= Math.pow(2, birdieCounts[0] - 1);
        }
        if (team2Points && birdieCounts[1] > 1) {
            team2Points *= Math.pow(2, birdieCounts[1] - 1);
        }
    }

    // STEP 8: Autodoubles
    let pointWorth = pointVal;
    let isDoubled = false;
    const matchTied = scorecards.every(p => p.plusMinus === 0);
    const someoneDownEnough = scorecards.some(p => Math.abs(p.plusMinus) >= autoDoubleMoneyTrigger);

    if (autoDoubles) {
        if (autoDoubleAfterNineTrigger && currentHole > 9) {
            isDoubled = true;
        } else if (autoDoubleWhileTiedTrigger && matchTied) {
            isDoubled = true;
        } else if (autoDoubleMoneyTrigger && someoneDownEnough) {
            isDoubled = true;
        }

        if (isDoubled || autoDoubleStays) {
            pointWorth = autoDoubleValue;
        }
    }

    const holeAnswers = answers?.find(a => a.hole === currentHole)?.answers || [];
    let pressMultiplier = 1;

    for (const ans of holeAnswers) {
        if (ans.question === "Was there a press?" && ans.answers.includes("Yes")) {
            pressMultiplier *= 2;
        }
        if (ans.question === "Was there a press or a double press?") {
            if (ans.answers.includes("Double Press")) {
                pressMultiplier *= 4;
            } else if (ans.answers.includes("Press")) {
                pressMultiplier *= 2;
            }
        }
    }

    team1Points *= pressMultiplier;
    team2Points *= pressMultiplier;

    const team1Money = (team1Points - team2Points) * pointWorth;
    const team2Money = (team2Points - team1Points) * pointWorth;

    // STEP 9: Apply points/money to each player (correctly)
    for (const golfer of scorecards) {
        const hole = golfer.holes[holeIndex];
        if (teamArray[0].includes(golfer.name)) {
            hole.points = team1Points;
            hole.plusMinus = team1Money;
        } else if (teamArray[1].includes(golfer.name)) {
            hole.points = team2Points;
            hole.plusMinus = team2Money;
        } else {
            // Debug log
            console.warn(`Golfer "${golfer.name}" not found on either team! No points assigned.`);
            hole.points = 0;
            hole.plusMinus = 0;
        }
    }

    return scorecards;
}

function wolf(scorecards, scores, config, answers) {
    const {
        holeValue: defaultHoleValue = 5,
        birdiesDouble = false,
        carryovers = false,
        birdiesDoubleCarryovers = false,
        blindWolfAllowed = true,
        crybaby = true,
        crybabyHole = 16,
        autoDoubles = false,
        autoDoubleAfterNineTrigger = false,
        autoDoubleMoneyTrigger = 0,
        autoDoubleWhileTiedTrigger = false,
        autoDoubleValue = 1,
        autoDoubleStays = false,
    } = config;

    const golfers = scorecards.map(g => g.name);
    let isDoubled = false;
    let carryoverPoints = 0;

    const findPlayer = (name) => scorecards.find(p => p.name === name);

    // Record scores into scorecard
    for (const score of scores) {
        const golfer = findPlayer(score.name);
        const hole = golfer?.holes.find(h => h.holeNumber === score.holeNumber);
        if (hole) {
            hole.score = score.score;
            hole.strokes = score.strokes || 0;
        }
    }

    const getAnswer = (holeNumber, questionText) => {
        const holeAnswers = answers.find(a => a.hole === holeNumber)?.answers || [];
        return holeAnswers.find(q => q.question === questionText)?.answers || null;
    };

    const getPreviousWolves = () => {
        const wolves = [];
        for (const h of scorecards[0].holes.map(h => h.holeNumber)) {
            const who = getAnswer(h, "Who was the wolf?");
            if (who?.[0]) wolves.push(who[0]);
        }
        return wolves;
    };

    const getNextWolf = () => {
        const prevWolves = getPreviousWolves();
        const unused = golfers.filter(g => !prevWolves.includes(g));
        if (unused.length) return unused[0];
        const lastWolf = prevWolves[prevWolves.length - 1];
        const lastWolfIndex = golfers.indexOf(lastWolf);
        return golfers[(lastWolfIndex + 1) % golfers.length];
    };

    for (const hole of scorecards[0].holes) {
        const holeNumber = hole.holeNumber;
        const holeIndex = scorecards[0].holes.findIndex(h => h.holeNumber === holeNumber);

        // 🐺 Who was the wolf?
        const wolfAnswer = getAnswer(holeNumber, "Who was the wolf?");
        const wolf = wolfAnswer?.[0] || getNextWolf();

        // 🐺 Solo logic
        const soloAnswer = getAnswer(holeNumber, "Did the wolf go solo?");
        const isSolo = soloAnswer?.[0]?.startsWith("Yes") ?? false;
        const wentAfterTee = soloAnswer?.[0]?.includes("After Their") ?? false;
        const wentBlind = soloAnswer?.[0]?.includes("Before Their") ?? false;

        // 🧑‍🤝‍🧑 Partner
        const partnerAnswer = getAnswer(holeNumber, "Who was their partner?");
        const partner = (!isSolo && partnerAnswer?.[0]) ? partnerAnswer[0] : null;

        // 😢 Crybaby override
        let baseHoleValue = defaultHoleValue;
        const crybabyAnswer = getAnswer(holeNumber, "Did the bet change? If so, enter the new dollar value:");
        if (crybaby && holeNumber >= crybabyHole && crybabyAnswer?.[0]) {
            const match = crybabyAnswer[0].match(/(\d+(\.\d+)?)/);
            if (match) baseHoleValue = parseFloat(match[1]);
        }

        // 💰 Auto-double logic
        const matchTied = scorecards.every(p => p.plusMinus === 0);
        const someoneDown = scorecards.some(p => Math.abs(p.plusMinus) >= autoDoubleMoneyTrigger);
        let thisHoleDoubled = false;

        if (autoDoubles) {
            if (autoDoubleAfterNineTrigger && holeNumber > 9) thisHoleDoubled = true;
            else if (autoDoubleWhileTiedTrigger && matchTied) thisHoleDoubled = true;
            else if (autoDoubleMoneyTrigger && someoneDown) thisHoleDoubled = true;
        }

        if (thisHoleDoubled && autoDoubleStays) isDoubled = true;
        const effectiveHoleValue = (thisHoleDoubled || isDoubled) ? autoDoubleValue : baseHoleValue;

        // 🧑‍🤝‍🧑 Teams
        const wolfTeam = [wolf];
        if (!isSolo && partner) wolfTeam.push(partner);
        const oppTeam = scorecards.filter(g => !wolfTeam.includes(g.name));

        const par = hole.par;

        const wolfTeamScore = isSolo
            ? findPlayer(wolf)?.holes[holeIndex].score ?? 999
            : Math.min(
                findPlayer(wolf)?.holes[holeIndex].score ?? 999,
                findPlayer(partner)?.holes[holeIndex].score ?? 999
            );

        const opponentBest = Math.min(...oppTeam.map(g => g.holes[holeIndex].score));
        const wolfWins = wolfTeamScore < opponentBest;
        const oppWins = wolfTeamScore > opponentBest;

        // 🧮 Multiplier
        let basePoints = 1;
        if (wentAfterTee) {
            basePoints *= 2;
        } else if (wentBlind) {
            basePoints *= 3;
        }

        if ((wolfTeamScore < par || opponentBest < par) && birdiesDouble && !(carryovers && birdiesDoubleCarryovers)) basePoints *= 2;

        // Carryover logic
        const thisHolePoints = basePoints;
        const totalPoints = carryovers ? thisHolePoints + carryoverPoints : thisHolePoints;

        const perOpponent = totalPoints * effectiveHoleValue;
        const biggestTeam = oppTeam.length > wolfTeam.length ? oppTeam.length : wolfTeam.length
        const wolfTotal = perOpponent * biggestTeam;

        if (wolfWins) {
            carryoverPoints = 0;

            wolfTeam.forEach(name => {
                const p = findPlayer(name);
                if (p) {
                    const hole = p.holes[holeIndex];
                    if (hole) {
                        hole.points = 0;//totalPoints;
                        hole.plusMinus = Math.round(wolfTotal / wolfTeam.length * 100) / 100;
                    }
                }
            });

            oppTeam.forEach(p => {
                const hole = p.holes[holeIndex];
                if (hole) {
                    hole.points = 0;
                    hole.plusMinus = -perOpponent;
                }
            });
        } else if (oppWins) {
            carryoverPoints = 0;

            wolfTeam.forEach(name => {
                const p = findPlayer(name);
                if (p) {
                    const hole = p.holes[holeIndex];
                    if (hole) {
                        hole.points = 0;
                        hole.plusMinus = -1 * (wolfTotal / wolfTeam.length);
                    }
                }
            });

            oppTeam.forEach(p => {
                const hole = p.holes[holeIndex];
                if (hole) {
                    hole.points = 0;//totalPoints;
                    hole.plusMinus = perOpponent;
                }
            });
        } else {
            carryoverPoints = totalPoints;

            scorecards.forEach(p => {
                const hole = p.holes[holeIndex];
                if (hole) {
                    hole.points = 0;
                    hole.plusMinus = 0;
                }
            })
        }

        // If birdie on win & carryover && birdiesDoubleCarryovers
        if ((wolfTeamScore < par || opponentBest < par) && carryovers && birdiesDoubleCarryovers) {
            for (const player of scorecards) {
                const hole = player.holes[holeIndex];
                hole.plusMinus *= 2;
            }
        }
    }

    return scorecards;
}

module.exports = {
    scotch,
    junk,
    vegas,
    wolf
}
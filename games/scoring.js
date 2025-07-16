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
            if (totalPot > 0) {
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
            const teamsWithAnds = teams || getTeamsFromAnswers(answers.find(h => h.hole === lastHole), golfers);
            const teamNames = teamsWithAnds.map(team => team.split(' & '))
            let winningTeam = teamNames[0];
            let losingTeam = teamNames[1];

            if (winningTeam.includes(question.answers[k])) {
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
                    hole.plusMinus += losersEachPay || 0;
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
        const teamsWithAnds = teams || getTeamsFromAnswers(answers[i], golfers);
        const questions = answers.find(obj => obj.hole === scorecards[0].holes[i].holeNumber);

        for (let j = 0; j < questions?.answers?.length; j++) {
            const question = questions.answers[j];
            if (strippedJunk.chipIns?.valid && question.question?.includes("chip in") && question.answers?.length > 0) {
                scorecards = tallyStandardJunk(scorecards, question, questions.hole, teamsWithAnds, golfers, strippedJunk.chipIns?.value, strippedJunk.chipIns?.team);
            }

            if (strippedJunk.greenies?.valid && question.question?.includes("greenie") && question.answers?.length > 0) {
                scorecards = tallyStandardJunk(scorecards, question, questions.hole, teamsWithAnds, golfers, strippedJunk.greenies?.value, strippedJunk.greenies?.team);
            }

            if (strippedJunk.sandies?.valid && question.question?.includes("sandie") && question.answers?.length > 0) {
                scorecards = tallyStandardJunk(scorecards, question, questions.hole, teamsWithAnds, golfers, strippedJunk.sandies?.value, strippedJunk.sandies?.team);
            }

            if (strippedJunk.polies?.valid && question.question?.includes("polie") && question.answers?.length > 0) {
                scorecards = tallyStandardJunk(scorecards, question, questions.hole, teamsWithAnds, golfers, strippedJunk.polies?.value, strippedJunk.polies?.team);
            }

            if (strippedJunk.barkies?.valid && question.question?.includes("barkie") && question.answers?.length > 0) {
                scorecards = tallyStandardJunk(scorecards, question, questions.hole, teamsWithAnds, golfers, strippedJunk.barkies?.value, strippedJunk.barkies?.team);
            }

            if (strippedJunk.arnies?.valid && question.question?.includes("Arnie") && question.answers?.length > 0) {
                scorecards = tallyStandardJunk(scorecards, question, questions.hole, teamsWithAnds, golfers, strippedJunk.arnies?.value, strippedJunk.arnies?.team);
            }

            if (strippedJunk.oozle?.valid && question.question?.includes("first to hole out") && question.answers?.length > 0) {
                scorecards = tallyStandardJunk(scorecards, question, questions.hole, teamsWithAnds, golfers, strippedJunk.oozle?.value, strippedJunk.oozle?.team);
            }

            if (strippedJunk.fish?.valid && question.question?.includes("a water hazard") && question.answers?.length > 0) {
                scorecards = tallyStandardJunk(scorecards, question, questions.hole, teamsWithAnds, golfers, strippedJunk.fish?.value * -1, strippedJunk.fish?.team);
            }
        }
    }

    if (strippedJunk.snake?.valid) {
        scorecards = trackSnake(scorecards, answers, teams, strippedJunk.snake, golfers);
    }

    if (strippedJunk.skins?.valid) {
        scorecards = trackSkins(scorecards, strippedJunk.skins, golfers);
    }

    return scorecards;
}

function scotch(currentScorecard, allAnswers, scores, nameTeams, teams, pointVal, points, autoDoubles, autoDoubleAfterNineTrigger, autoDoubleMoneyTrigger, autoDoubleWhileTiedTrigger, autoDoubleValue, autoDoubleStays, miracle) {
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

        const teamScores = getTeamScoresOnHole(teams, currentScorecard, i);

        if (teamScores[0].includes(0) || teamScores[1].includes(0)) {
            break;
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

module.exports = {
    scotch,
    junk
}
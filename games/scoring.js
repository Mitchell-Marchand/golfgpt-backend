const { getTeamTotals, getLowScoreWinners, getTeamScoresOnHole, getTeamsFromAnswers } = require('../train/utils');

function junk(scorecards, answers, strippedJunk, golfers) {
    for (let i = 0; i < scorecards[0].holes.length; i++) {
        const teams = getTeamsFromAnswers(answers[i], golfers);
        const questions = answers.find(obj => obj.hole === scorecards[0].holes[i].holeNumber);

        for (let j = 0; j < questions?.answers?.length; j++) {
            const question = questions.answers[j];
            if (strippedJunk.chipIns?.valid && question.question?.includes("chip in") && question.answers?.length > 0) {
                if (strippedJunk.chipIns?.team) {
                    //TODO: Add plusMinus for team scores
                    
                } else {
                    //Add plusMinus for just this golfer
                    for (let k = 0; k < question.answers?.length; k++) {
                        const opponents = golfers.length - 1;
                        const won = opponents * strippedJunk.chipIns?.value || 0
                        const golferCard = scorecards.find(g => g.name === question.answers[k]);
                        const hole = golferCard.holes.find(h => h.holeNumber === questions.hole);
                        hole.plusMinus += won;
                    }

                    for (let k = 0; k < golfers.length; k++) {
                        if (!question.answers.includes(golfers[k])) {
                            const golferCard = scorecards.find(g => g.name === golfers[k]);
                            const hole = golferCard.holes.find(h => h.holeNumber === questions.hole);
                            hole.plusMinus -= strippedJunk.chipIns?.value || 0;
                        }
                    }
                }
            }

        }
    }
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
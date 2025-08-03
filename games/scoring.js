const { getTeamTotals, getLowScoreWinners, getTeamScoresOnHole, getTeamsFromAnswers, hasUnplayedHoles } = require('../train/utils');

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
        pot = golfers.length * (skinsConfig.potValue || 0);
    }

    for (let i = 0; i < scorecards[0].holes.length; i++) {
        let skin = false;
        let scoreToBeat = Infinity;
        let contenders = [];

        for (let j = 0; j < golfers.length; j++) {
            const scorecard = scorecards.find(card => card.name === golfers[j]);
            const hole = scorecard.holes[i];
            if (!hole || hole.score <= 0) continue;

            const gross = hole.score;
            const net = gross - (hole.strokes || 0);

            let comparisonScore;
            switch (skinsConfig.type) {
                case "net":
                case "canadian":
                    comparisonScore = net;
                    break;
                case "gross":
                default:
                    comparisonScore = gross;
                    break;
            }

            if (comparisonScore < scoreToBeat) {
                scoreToBeat = comparisonScore;
                contenders = [{ name: golfers[j], gross, net, holeNumber: hole.holeNumber }];
            } else if (comparisonScore === scoreToBeat) {
                contenders.push({ name: golfers[j], gross, net, holeNumber: hole.holeNumber });
            }
        }

        if (contenders.length === 1) {
            skin = contenders[0];
        } else if (skinsConfig.type === "canadian" && contenders.length > 1) {
            // Check if any net ties match a gross
            const lowestNet = contenders[0].net;
            const grossWinners = contenders.filter(p => p.gross === lowestNet);
            if (grossWinners.length === 1) {
                skin = grossWinners[0];
            }
        }

        // Optional validation (e.g., must "prove" skin)
        if (skin && skinsConfig.validation && i < scorecards[0].holes.length - 1) {
            const scorecard = scorecards.find(card => card.name === skin.name);
            const holeToProve = scorecard.holes[i + 1];
            if (holeToProve.score > holeToProve.par) {
                skin = false;
            }
        }

        if (skin) {
            skins.push(skin);
            if (!skinsConfig.fromPot) {
                pot += (skinsConfig.value * golfers.length) || 0;
            }
        }
    }

    // Award skins
    if (skins.length > 0) {
        const skinValue = Math.round(pot / skins.length * 100) / 100;
        const perGolferValue = Math.round(skinValue / golfers.length * 100) / 100;

        for (const skin of skins) {
            const scorecard = scorecards.find(card => card.name === skin.name);
            const hole = scorecard.holes.find(hole => hole.holeNumber === skin.holeNumber);
            hole.plusMinus += skinValue;

            for (const golfer of golfers) {
                const sc = scorecards.find(card => card.name === golfer);
                const h = sc.holes.find(hole => hole.holeNumber === skin.holeNumber);
                h.plusMinus -= perGolferValue;
            }
        }
    }

    return scorecards;
}

function trackStreaks(scorecards, config, toPar) {
    for (const golfer of scorecards) {
        let streak = 0;

        for (let i = 0; i < golfer.holes.length; i++) {
            const hole = golfer.holes[i];
            const diff = hole.score - hole.par;

            // Check if the current hole meets the streak criteria
            const isValid =
                (toPar === -1 && diff < 0) || // Birdie or better
                (toPar === 0 && diff === 0) || // Par
                (toPar === 1 && diff > 0); // Bogey or worse

            if (isValid) {
                streak++;
            } else {
                streak = 0;
            }

            // Apply reward/penalty on the hole where the streak is hit
            if (streak === config.streak) {
                if (toPar === -1 || toPar === 0) {
                    hole.plusMinus = (hole.plusMinus || 0) + config.value;
                } else if (toPar === 1) {
                    hole.plusMinus = (hole.plusMinus || 0) - config.value;
                }

                if (!config.canOverlap) {
                    streak = 0;
                }
            }
        }
    }
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

            if (strippedJunk.bingoBangoBongo?.valid && (question.question?.includes("first on the green") || question.question?.includes("CTP once all balls") || question.question?.includes("first to hole out")) && question.answers?.length > 0) {
                scorecards = tallyStandardJunk(scorecards, question, questions.hole, teamsWithAnds, golfers, strippedJunk.bingoBangoBongo?.value, strippedJunk.bingoBangoBongo?.teams);
            }
        }
    }

    if (strippedJunk.snake?.valid) {
        scorecards = trackSnake(scorecards, answers, teams, strippedJunk.snake, golfers);
    }

    if (strippedJunk.skins?.valid) {
        scorecards = trackSkins(scorecards, strippedJunk.skins, golfers);
    }

    if (strippedJunk.birdieStreak?.valid) {
        scorecards = trackStreaks(scorecards, strippedJunk.birdieStreak, -1)
    }

    if (strippedJunk.parStreak?.valid) {
        scorecards = trackStreaks(scorecards, strippedJunk.parStreak, 0)
    }

    if (strippedJunk.parStreak?.valid) {
        scorecards = trackStreaks(scorecards, strippedJunk.bogeyStreak, 0)
    }

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

    const updateScorecard = (name, holeNumber, update) => {
        const golfer = scorecards.find(g => g.name === name);
        const hole = golfer?.holes.find(h => h.holeNumber === holeNumber);
        if (hole) Object.assign(hole, update);
    };

    // Step 1: update scores
    for (const s of scores) {
        updateScorecard(s.name, s.holeNumber, {
            score: s.score,
            strokes: s.strokes || 0,
        });
    }

    let doubledFromMoney = false;

    for (let i = 0; i < scorecards[0].holes?.length; i++) {
        const holeNumber = i + 1;
        const holeIndex = scorecards[0].holes.findIndex(h => h.holeNumber === holeNumber);
        if (holeIndex === -1) continue;

        const par = scorecards[0].holes[holeIndex].par;
        if (!par) continue;

        if (scorecards[0].holes[holeIndex].score === 0) {
            continue;
        }

        // STEP 2: Gather team scores
        const teamScores = teamArray.map(teamNames => {
            return teamNames.map(name => {
                const golfer = scorecards.find(g => g.name === name);
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

        // STEP 4: Vegas values
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

        // STEP 6: Point diff
        const diff = Math.abs(vegasValues[0] - vegasValues[1]);
        let team1Points = 0, team2Points = 0;
        if (vegasValues[0] < vegasValues[1]) team1Points = diff;
        else if (vegasValues[1] < vegasValues[0]) team2Points = diff;

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
        const getPriorPlusMinus = (player) =>
            player.holes
                .filter(h => h.holeNumber < holeNumber)
                .reduce((sum, h) => sum + (h.plusMinus || 0), 0);

        const priorTotals = scorecards.map(p => ({
            name: p.name,
            total: getPriorPlusMinus(p),
        }));

        const matchTied = priorTotals.reduce((sum, p) => sum + p.total, 0) === 0;
        const someoneDown = priorTotals.some(p => p.total <= autoDoubleMoneyTrigger * -1);

        let thisHoleDoubled = false;
        if (autoDoubles) {
            if (autoDoubleAfterNineTrigger && holeNumber > 9) thisHoleDoubled = true;
            if (autoDoubleWhileTiedTrigger && matchTied) thisHoleDoubled = true;
            if (autoDoubleMoneyTrigger && someoneDown) {
                thisHoleDoubled = true;
                doubledFromMoney = true;
            }
        }

        if (thisHoleDoubled || (doubledFromMoney && autoDoubleStays)) {
            pointWorth = autoDoubleValue;
        }

        // STEP 9: Presses
        const holeAnswers = answers?.find(a => a.hole === holeNumber)?.answers || [];
        let pressMultiplier = 1;
        for (const ans of holeAnswers) {
            if (ans.question === "Was there a press?" && ans.answers.includes("Yes")) pressMultiplier *= 2;
            if (ans.question === "Was there a press or a double press?") {
                if (ans.answers.includes("Double Press")) pressMultiplier *= 4;
                else if (ans.answers.includes("Press")) pressMultiplier *= 2;
            }
        }

        team1Points *= pressMultiplier;
        team2Points *= pressMultiplier;

        const team1Money = (team1Points - team2Points) * pointWorth;
        const team2Money = (team2Points - team1Points) * pointWorth;

        // STEP 10: Apply to scorecards
        for (const golfer of scorecards) {
            const hole = golfer.holes[holeIndex];
            if (teamArray[0].includes(golfer.name)) {
                hole.points = team1Points;
                hole.plusMinus = team1Money;
            } else if (teamArray[1].includes(golfer.name)) {
                hole.points = team2Points;
                hole.plusMinus = team2Money;
            } else {
                hole.points = 0;
                hole.plusMinus = 0;
            }
        }
    }

    return scorecards;
}

function wolf(scorecards, scores, config, answers) {
    const {
        holeValue: defaultHoleValue = 5,
        birdiesDouble = false,
        eaglesMultiply = false,
        eaglesFactor = 5,
        carryovers = false,
        birdiesDoubleCarryovers = false,
        crybaby = true,
        crybabyHole = 16,
        autoDoubles = false,
        autoDoubleAfterNineTrigger = false,
        autoDoubleMoneyTrigger = 0,
        autoDoubleWhileTiedTrigger = false,
        autoDoubleValue = 1,
        autoDoubleStays = false,
        onlyGrossBirdies = false,
        combinedScore = false
    } = config;

    const golfers = scorecards.map(g => g.name);
    let isDoubled = false;
    let doubledFromMoney = false;
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
        if (hole.score === 0) {
            continue;
        }

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
        //Factor this in for holes played up to currentHole
        const getPriorPlusMinus = (player, currentHoleNumber) =>
            player.holes
                .filter(h => h.holeNumber < currentHoleNumber)
                .reduce((sum, h) => sum + (h.plusMinus || 0), 0);

        const priorTotals = scorecards.map(p => ({
            name: p.name,
            total: getPriorPlusMinus(p, currentHole),
        }));

        const matchTied = priorTotals.reduce((sum, p) => sum + p.total, 0) === 0;
        const someoneDown = priorTotals.some(p => p.total <= autoDoubleMoneyTrigger * -1);
        let thisHoleDoubled = false;

        if (autoDoubles) {
            if (autoDoubleAfterNineTrigger && holeNumber > 9) thisHoleDoubled = true;
            if (autoDoubleWhileTiedTrigger && matchTied) thisHoleDoubled = true;
            if (autoDoubleMoneyTrigger && someoneDown) {
                thisHoleDoubled = true;
                doubledFromMoney = true;
            }
            if (autoDoubleStays && doubledFromMoney) {
                thisHoleDoubled = true;
            }
        }

        if (thisHoleDoubled) {
            isDoubled = true;
        }

        const effectiveHoleValue = (thisHoleDoubled || isDoubled) ? autoDoubleValue : baseHoleValue;

        // 🧑‍🤝‍🧑 Teams
        const wolfTeam = [wolf];
        if (!isSolo && partner) wolfTeam.push(partner);
        const oppTeam = scorecards.filter(g => !wolfTeam.includes(g.name));
        const wolfScorecards = scorecards.filter(g => wolfTeam.includes(g.name));

        const par = hole.par;

        /*const wolfTeamScore = isSolo
            ? findPlayer(wolf)?.holes[holeIndex].score ?? 999
            : Math.min(
                findPlayer(wolf)?.holes[holeIndex].score ?? 999,
                findPlayer(partner)?.holes[holeIndex].score ?? 999
            );*/

        const wolfBest = !combinedScore ? Math.min(...wolfScorecards.map(g => g.holes[holeIndex].score)) : Math.sum(...wolfScorecards.map(g => g.holes[holeIndex].score - g.holes[holeIndex].par));
        const wolfBestNet = Math.min(...wolfScorecards.map(g => g.holes[holeIndex].score - g.holes[holeIndex].strokes));
        const opponentBest = !combinedScore ? Math.min(...oppTeam.map(g => g.holes[holeIndex].score)) : Math.sum(...oppTeam.map(g => g.holes[holeIndex].score - g.holes[holeIndex].par));
        const opponentBestNet = Math.min(...oppTeam.map(g => g.holes[holeIndex].score - g.holes[holeIndex].strokes));
        const wolfBirdieLow = onlyGrossBirdies ? wolfBest : wolfBestNet
        const opponentBirdieLow = onlyGrossBirdies ? opponentBest : opponentBestNet
        const wolfWins = wolfBestNet < opponentBestNet;
        const oppWins = wolfBestNet > opponentBestNet;

        // 🧮 Multiplier
        let basePoints = 1;
        if (wentAfterTee) {
            basePoints *= 2;
        } else if (wentBlind) {
            basePoints *= 3;
        }

        if ((wolfBirdieLow === par - 1 || opponentBirdieLow === par - 1) && birdiesDouble && !(carryovers && birdiesDoubleCarryovers)) basePoints *= 2;
        if ((wolfBirdieLow <= par - 2 || opponentBirdieLow <= par - 2) && eaglesMultiply && !(carryovers && birdiesDoubleCarryovers)) basePoints *= eaglesFactor;

        // Carryover logic
        const thisHolePoints = basePoints;
        let totalPoints = carryovers ? thisHolePoints + carryoverPoints : thisHolePoints;

        if ((wolfBirdieLow === par - 1 || opponentBirdieLow === par - 1) && birdiesDouble && carryovers && birdiesDoubleCarryovers) totalPoints *= 2;
        if ((wolfBirdieLow <= par - 2 || opponentBirdieLow <= par - 2) && eaglesMultiply && carryovers && birdiesDoubleCarryovers) totalPoints *= eaglesFactor;

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
        /*if ((wolfBirdieLow < par || opponentBirdieLow < par) && carryovers && birdiesDoubleCarryovers) {
            let factor = 2;
            if (eaglesMultiply && eaglesFactor && (wolfBirdieLow <= par - 2 || opponentBirdieLow <= par - 2)) {
                factor = eaglesFactor
            }

            for (const player of scorecards) {
                const hole = player.holes[holeIndex];
                hole.plusMinus *= factor;
            }

            carryoverPoints *= factor;
        }*/
    }

    return scorecards;
}

// Scoring function for Left/Right or Middle/Outside match play game
function leftRight(scorecards, scores, config, answers) {
    const {
        permanentTeams = false,
        holeValue = 5,
        birdiesDouble = false,
        eaglesMultiply = false,
        eaglesFactor = 5,
        carryovers = false,
        birdiesDoubleCarryovers = false,
        crybaby = false,
        crybabyHole = 16,
        autoDoubles = false,
        autoDoubleAfterNineTrigger = false,
        autoDoubleMoneyTrigger = 0,
        autoDoubleWhileTiedTrigger = false,
        autoDoubleValue = 1,
        autoDoubleStays = false,
        onlyGrossBirdies = false,
        soloMultiple = 2,
        combinedScore = false,
        teamsChangeEverySix = false,
        teamsChangeEveryThree = false
    } = config;

    const golfers = scorecards.map(g => g.name);
    let carryoverPoints = 0;
    let isDoubled = false;
    let doubledFromMoney = false;
    let mostRecentTeam = false;

    // Record scores
    for (const s of scores) {
        const p = scorecards.find(g => g.name === s.name);
        const h = p?.holes.find(h => h.holeNumber === s.holeNumber);
        if (h) {
            h.score = s.score;
            h.strokes = s.strokes || 0;
        }
    }

    const getAnswer = (holeNumber, questionText) => {
        const holeAnswers = answers.find(a => a.hole === holeNumber)?.answers || [];
        return holeAnswers.find(q => q.question === questionText)?.answers || null;
    };

    for (const hole of scorecards[0].holes) {
        if (hole.score === 0) continue;

        const holeNumber = hole.holeNumber;
        const holeIndex = scorecards[0].holes.findIndex(h => h.holeNumber === holeNumber);
        const par = hole.par;

        // Get teams
        const holeAnswers = answers.find(h => h.hole === holeNumber)?.answers || [];
        let teamsWithAnds = permanentTeams || getTeamsFromAnswers(holeAnswers, golfers);

        if (teamsChangeEverySix || teamsChangeEveryThree) {
            if ((teams.length < 2 || teams[0][0] === "" || teams[1][0] === "") && mostRecentTeam) {
                teamsWithAnds = mostRecentTeam;
            } else {
                mostRecentTeam = teamsWithAnds;
            }
        }

        let teams = teamsWithAnds.map(team => team.split(' & '));
        let everyManForOne = 1;

        // Fallback logic if one of the teams is empty
        if (teams.length < 2 || teams[0][0] === "" || teams[1][0] === "") {
            const everyone = golfers.map(name => {
                const golfer = scorecards.find(g => g.name === name);
                const h = golfer.holes[holeIndex];
                return {
                    name,
                    gross: h.score,
                    net: h.score - (h.strokes || 0),
                };
            });

            const lowNet = Math.min(...everyone.map(g => g.net));
            const lowScorers = everyone.filter(g => g.net === lowNet);
            everyManForOne = soloMultiple;

            if (lowScorers.length === 1) {
                // One winner vs rest
                const winner = lowScorers[0];
                const rest = everyone.filter(g => g.name !== winner.name);
                teams = [[winner.name], rest.map(g => g.name)];
            } else {
                // Tie: split low scorers across two teams
                const [first, ...rest] = lowScorers;
                const others = everyone.filter(g => !lowScorers.some(l => l.name === g.name));
                teams = [[first.name, ...others.map(g => g.name)], rest.map(g => g.name)];
            }
        }

        const [team1, team2] = teams.map(team => team.map(name => {
            const player = scorecards.find(g => g.name === name);
            const h = player.holes[holeIndex];
            return {
                name,
                gross: h.score,
                net: h.score - (h.strokes || 0)
            };
        }));

        const team1Best = !combinedScore ? Math.min(...team1.map(p => p.net)) : Math.sum(...team1.map(p => p.net - p.par));
        const team2Best = !combinedScore ? Math.min(...team2.map(p => p.net)) : Math.sum(...team2.map(p => p.net - p.par));

        const team1BirdieLow = onlyGrossBirdies ? Math.min(...team1.map(p => p.gross)) : Math.min(...team1.map(p => p.net));
        const team2BirdieLow = onlyGrossBirdies ? Math.min(...team2.map(p => p.gross)) : Math.min(...team2.map(p => p.net));

        const team1Wins = team1Best < team2Best;
        const team2Wins = team2Best < team1Best;

        // Determine autodouble state
        const getPriorPlusMinus = (player, currentHoleNumber) =>
            player.holes
                .filter(h => h.holeNumber < currentHoleNumber)
                .reduce((sum, h) => sum + (h.plusMinus || 0), 0);

        const priorTotals = scorecards.map(p => ({
            name: p.name,
            total: getPriorPlusMinus(p, holeNumber)
        }));

        const matchTied = priorTotals.reduce((sum, p) => sum + p.total, 0) === 0;
        const someoneDown = priorTotals.some(p => p.total <= autoDoubleMoneyTrigger * -1);

        let thisHoleDoubled = false;
        if (autoDoubles) {
            if (autoDoubleAfterNineTrigger && holeNumber > 9) thisHoleDoubled = true;
            if (autoDoubleWhileTiedTrigger && matchTied) thisHoleDoubled = true;
            if (autoDoubleMoneyTrigger && someoneDown) {
                thisHoleDoubled = true;
                doubledFromMoney = true;
            }
            if (autoDoubleStays && doubledFromMoney) {
                thisHoleDoubled = true;
            }
        }
        if (thisHoleDoubled) isDoubled = true;

        let value = (thisHoleDoubled || isDoubled) ? autoDoubleValue : holeValue;
        value *= Math.max(1, everyManForOne);

        let pressMultiplier = 1;
        for (const ans of holeAnswers) {
            if (ans.question === "Was there a press?" && ans.answers.includes("Yes")) pressMultiplier *= 2;
            if (ans.question === "Was there a press or a double press?") {
                if (ans.answers.includes("Double Press")) pressMultiplier *= 4;
                else if (ans.answers.includes("Press")) pressMultiplier *= 2;
            }
        }

        value *= pressMultiplier;

        // Handle crybaby override
        const crybabyAnswer = getAnswer(holeNumber, "Did the bet change? If so, enter the new dollar value:");
        if (crybaby && holeNumber >= crybabyHole && crybabyAnswer?.[0]) {
            const match = crybabyAnswer[0].match(/\d+(\.\d+)?/);
            if (match) value = parseFloat(match[0]);
        }

        // Apply streak modifiers
        if ((team1BirdieLow === par - 1 || team2BirdieLow === par - 1) && birdiesDouble && !(carryovers && birdiesDoubleCarryovers)) value *= 2;
        if ((team1BirdieLow <= par - 2 || team2BirdieLow <= par - 2) && eaglesMultiply && !(carryovers && birdiesDoubleCarryovers)) value *= eaglesFactor;

        let totalValue = carryovers ? value + carryoverPoints : value;

        if ((team1BirdieLow === par - 1 || team2BirdieLow === par - 1) && birdiesDouble && carryovers && birdiesDoubleCarryovers) totalValue *= 2;
        if ((team1BirdieLow <= par - 2 || team2BirdieLow <= par - 2) && eaglesMultiply && carryovers && birdiesDoubleCarryovers) totalValue *= eaglesFactor;

        if (team1Wins || team2Wins) {
            carryoverPoints = 0;
            const winners = team1Wins ? team1 : team2;
            const losers = team1Wins ? team2 : team1;

            const teamSize = Math.max(team1.length, team2.length);
            const pot = teamSize * totalValue;
            const perWinner = Math.round((pot / winners.length) * 100) / 100;
            const perLoser = Math.round((pot / losers.length) * 100) / 100;

            for (const p of winners) {
                const golfer = scorecards.find(g => g.name === p.name);
                golfer.holes[holeIndex].plusMinus = perWinner;
            }
            for (const p of losers) {
                const golfer = scorecards.find(g => g.name === p.name);
                golfer.holes[holeIndex].plusMinus = -perLoser;
            }
        } else {
            carryoverPoints = totalValue;
            for (const p of [...team1, ...team2]) {
                const golfer = scorecards.find(g => g.name === p.name);
                golfer.holes[holeIndex].plusMinus = 0;
            }
        }
    }

    return scorecards;
}

function ninePoint(scorecards, scores, config) {
    const {
        pointVal = 1,
        extraForBirdies = 0,
        extraForEagles = 0,
        onlyGrossBirdies = false,
    } = config;

    // First update scores in scorecards
    for (const s of scores) {
        const p = scorecards.find(g => g.name === s.name);
        const h = p?.holes.find(h => h.holeNumber === s.holeNumber);
        if (h) {
            h.score = s.score;
            h.strokes = s.strokes || 0;
            h.plusMinus = 0;
            h.points = 0;
        }
    }

    const currentHole = scores[0]?.holeNumber;
    const holeIndex = scorecards[0].holes.findIndex(h => h.holeNumber === currentHole);
    if (holeIndex === -1) return scorecards;

    const par = scorecards[0].holes[holeIndex].par;
    const golfers = scorecards.map(g => {
        const hole = g.holes[holeIndex];
        const gross = hole.score;
        const net = gross - (hole.strokes || 0);
        return {
            name: g.name,
            gross,
            net,
            par,
            score: net,
            original: g
        };
    });

    // Sort lowest to highest by net or gross
    const ranked = golfers
        .filter(g => g.score > 0)
        .sort((a, b) => a.score - b.score)
        .slice(0, 3); // only score lowest 3 golfers

    // Handle tie logic
    const scoresOnly = ranked.map(g => g.score);
    const points = new Array(ranked.length).fill(0);

    if (scoresOnly[0] === scoresOnly[1] && scoresOnly[1] === scoresOnly[2]) {
        points.fill(3);
    } else if (scoresOnly[0] === scoresOnly[1]) {
        points[0] = 4;
        points[1] = 4;
        points[2] = 1;
    } else if (scoresOnly[1] === scoresOnly[2]) {
        points[0] = 5;
        points[1] = 2;
        points[2] = 2;
    } else {
        points[0] = 5;
        points[1] = 3;
        points[2] = 1;
    }

    // Apply extra points for birdies/eagles
    for (let i = 0; i < ranked.length; i++) {
        const g = ranked[i];
        const usedScore = onlyGrossBirdies ? g.gross : g.net;
        const diff = g.par - usedScore;

        if (diff === 1 && extraForBirdies > points[i]) {
            points[i] = extraForBirdies;
        } else if (diff >= 2 && extraForEagles > points[i]) {
            points[i] = extraForEagles;
        }
    }

    // Apply points and plusMinus
    for (let i = 0; i < ranked.length; i++) {
        const g = ranked[i];
        const hole = g.original.holes[holeIndex];
        hole.points = points[i];
    }

    // Now handle plusMinus based on differences in points
    const allGolfers = scorecards.map(g => ({
        name: g.name,
        hole: g.holes[holeIndex],
    }));

    for (let i = 0; i < allGolfers.length; i++) {
        for (let j = 0; j < allGolfers.length; j++) {
            if (i === j) continue;
            const p1 = allGolfers[i];
            const p2 = allGolfers[j];
            const diff = (p1.hole.points || 0) - (p2.hole.points || 0);
            if (diff > 0) {
                p1.hole.plusMinus = (p1.hole.plusMinus || 0) + diff * pointVal;
                p2.hole.plusMinus = (p2.hole.plusMinus || 0) - diff * pointVal;
            }
        }
    }

    return scorecards;
}

function banker(scorecards, scores, answers) {
    // Update scorecards with scores
    for (const score of scores) {
        const player = scorecards.find(g => g.name === score.name);
        const hole = player?.holes.find(h => h.holeNumber === score.holeNumber);
        if (hole) {
            hole.score = score.score;
            hole.strokes = score.strokes || 0;
            hole.plusMinus = 0;
        }
    }

    const currentHole = scores[0]?.holeNumber;
    const holeIndex = scorecards[0].holes.findIndex(h => h.holeNumber === currentHole);
    if (holeIndex === -1) return scorecards;

    const golfers = scorecards.map(g => g.name);
    const par = scorecards[0].holes[holeIndex].par;

    const holeAnswers = answers.find(h => h.hole === currentHole)?.answers || [];

    const bankerAnswer = holeAnswers.find(q => q.question.includes("banker"));
    const banker = (bankerAnswer?.answers?.[0]) || golfers[0];

    const getScore = (name) => {
        const g = scorecards.find(p => p.name === name);
        const h = g.holes[holeIndex];
        return h.score;
    };

    const applyMatchResult = (winner, loser, amount) => {
        const winnerCard = scorecards.find(g => g.name === winner);
        const loserCard = scorecards.find(g => g.name === loser);
        const winnerHole = winnerCard.holes[holeIndex];
        const loserHole = loserCard.holes[holeIndex];
        winnerHole.plusMinus += amount;
        loserHole.plusMinus -= amount;
    };

    for (const player of golfers) {
        if (player === banker) continue;

        // find the question for this matchup
        const matchQuestion = holeAnswers.find(q => q.question.includes(`with ${player}`));
        let rawVal = matchQuestion?.answers?.[0] || "0";
        rawVal = rawVal.replace(/\$/g, '').trim();

        let value = 0;
        let bonusBirdie = 0;

        if (rawVal.includes("/")) {
            const parts = rawVal.split("/").map(v => parseFloat(v));
            value = parts[0] || 0;
            bonusBirdie = parts[1] || value;
        } else {
            const match = rawVal.match(/(\d+(\.\d+)?)/);
            if (match) value = parseFloat(match[1]);
        }

        const bankerScore = getScore(banker);
        const playerScore = getScore(player);

        if (!bankerScore || !playerScore || bankerScore <= 0 || playerScore <= 0) continue;

        if (bankerScore < playerScore) {
            const diff = par - bankerScore;
            const payout = diff === 1 ? bonusBirdie || value : value;
            applyMatchResult(banker, player, payout);
        } else if (bankerScore > playerScore) {
            const diff = par - playerScore;
            const payout = diff === 1 ? bonusBirdie || value : value;
            applyMatchResult(player, banker, payout);
        }
        // no payout if tied
    }

    return scorecards;
}

function universalMatchScorer(scorecards, scores, config, answers) {
    const {
        teams = [],
        type = "stroke",
        perHoleOrMatch = "match",
        perHoleValue = 0,
        perMatchValue = 0,
        perStrokeValue = 0,
        carryovers = false,
        birdiesDoubleCarryovers = false,
        combinedScore = false,
        birdiesDouble = false,
        eaglesMultiply = false,
        eaglesFactor = 5,
        autoPresses = false,
        autoPressTrigger = 2,
        extraBirdieValue = 0,
        extraEagleValue = 0,
        extraBirdieTeam = false,
        nassau = false,
        sixSixSix = false,
        threeThreeThree = false,
        sixSixSixOverallValue = 0,
        threeThreeThreeOverallValue = 0,
        sweepValue = 0,
        onlyGrossBirdies = false,
        teamsChangeEverySix = false,
        teamsChangeEveryThree = false,
        stableford = false,
        stablefordQuota = false,
        stablefordPoints = {
            double: 0,
            bogey: 1,
            par: 2,
            birdie: 4,
            eagle: 6,
            albatross: 8
        }
    } = config;

    for (const golfer of scorecards) {
        for (const hole of golfer.holes) {
            hole.plusMinus = 0;
            hole.points = 0;
        }
    }

    for (const score of scores) {
        const player = scorecards.find(g => g.name === score.name);
        const hole = player?.holes.find(h => h.holeNumber === score.holeNumber);
        if (hole) {
            hole.score = score.score;
            hole.strokes = score.strokes || 0;
        }
    }

    if (perHoleOrMatch === "hole" || (teams.length !== 2 && !teamsChangeEveryThree && !teamsChangeEverySix)) {
        //Score just like a leftRight or whatever
        if (teams.length === 2 && !(type === "stroke" && perStrokeValue > 0)) {
            scorecards = leftRight(scorecards, scores, {
                permanentTeams: teams,
                holeValue: perHoleValue,
                birdiesDouble,
                eaglesMultiply,
                eaglesFactor,
                carryovers,
                birdiesDoubleCarryovers,
                onlyGrossBirdies,
                combinedScore,
                teamsChangeEverySix,
                teamsChangeEveryThree
            }, answers);
        } else if (!stableford && type === "stroke" && perStrokeValue > 0) {
            //Tally up the plusMinus based on their score relative to eachother each hole and the perStrokeValue
            const currentHole = scores[0]?.holeNumber;
            const holeIndex = scorecards[0].holes.findIndex(h => h.holeNumber === currentHole);
            if (holeIndex === -1) return scorecards;

            // Now handle plusMinus based on differences in points
            const allGolfers = scorecards.map(g => ({
                name: g.name,
                hole: g.holes[holeIndex],
            }));

            for (let i = 0; i < allGolfers.length; i++) {
                for (let j = 0; j < allGolfers.length; j++) {
                    if (i === j) continue;
                    const p1 = allGolfers[i];
                    const p2 = allGolfers[j];
                    const diff = (p1.hole.score - p1.hole.strokes || 0) - (p2.hole.score - p2.hole.strokes || 0);
                    if (diff > 0) {
                        p1.hole.plusMinus = (p1.hole.plusMinus || 0) - diff * perStrokeValue;
                        p2.hole.plusMinus = (p2.hole.plusMinus || 0) + diff * perStrokeValue;
                    }
                }
            }
        } else if (stableford) {
            //Stableford individual
            //Set points based on scores
            for (let j = 0; j < scorecards.length; j++) {
                for (let i = 0; i < scorecards[j].holes.length; i++) {
                    const playerHole = scorecards[j].holes.find(h => h.holeNumber === scorecards[j].holes[i].holeNumber);
                    const toPar = playerHole.score - playerHole.strokes - playerHole.par;

                    if (playerHole.score > 0) {
                        let points = stablefordPoints.par;

                        if (toPar === -1) {
                            points = stablefordPoints.birdie;
                        } else if (toPar === -2) {
                            points = stablefordPoints.eagle;
                        } else if (toPar <= -3) {
                            points = stablefordPoints.albatross;
                        } else if (toPar === 1) {
                            points = stablefordPoints.bogey;
                        } else if (toPar >= 2) {
                            points = stablefordPoints.double;
                        }

                        playerHole.points = points;
                    }
                }
            }

            if (stablefordQuota) {
                //Everyone pay everyone on last hole relative to quota if all holes have been played
                if (!hasUnplayedHoles(scorecards)) {
                    const quotaPoints = [];

                    for (let i = 0; i < scorecards?.length; i++) {
                        let totalPoints = (scorecards[i].holes.length * 2) - scorecards[i].handicap;

                        for (let j = 0; j < scorecards[i].holes.length; j++) {
                            totalPoints += (36 - scorecards[i].holes[j].points);
                        }

                        quotaPoints.push({
                            name: scorecards[i].name,
                            points: quotaPoints
                        });
                    }

                    for (let i = 0; i < scorecards.length; i++) {
                        for (let j = 0; j < scorecards.length; j++) {
                            if (i === j) continue;
                            const p1 = quotaPoints.find(qp => qp.name === scorecards[i].name);
                            const p2 = quotaPoints.find(qp => qp.name === scorecards[j].name);
                            const diff = (p1.hole.points) - (p2.hole.points);
                            if (diff > 0) {
                                const p1Hole = scorecards[i].holes[holes.length - 1];
                                const p2Hole = scorecards[j].holes[holes.length - 1];
                                p1Hole.hole.plusMinus = (p1Hole.hole.plusMinus || 0) + diff * perStrokeValue;
                                p2Hole.hole.plusMinus = (p2Hole.hole.plusMinus || 0) - diff * perStrokeValue;
                            }
                        }
                    }
                }
            } else {
                const currentHole = scores[0]?.holeNumber;
                const holeIndex = scorecards[0].holes.findIndex(h => h.holeNumber === currentHole);
                if (holeIndex === -1) return scorecards;

                // Now handle plusMinus based on differences in points
                const allGolfers = scorecards.map(g => ({
                    name: g.name,
                    hole: g.holes[holeIndex],
                }));

                for (let i = 0; i < allGolfers.length; i++) {
                    for (let j = 0; j < allGolfers.length; j++) {
                        if (i === j) continue;
                        const p1 = allGolfers[i];
                        const p2 = allGolfers[j];
                        const diff = (p1.hole.points) - (p2.hole.points);
                        if (diff > 0) {
                            p1.hole.plusMinus = (p1.hole.plusMinus || 0) + diff * perStrokeValue;
                            p2.hole.plusMinus = (p2.hole.plusMinus || 0) - diff * perStrokeValue;
                        }
                    }
                }
            }
        }
    } else {
        //Playing matches of "match" play, either by total strokes or match points
        let allMatches = [];

        if (nassau) {
            allMatches.push({
                active: true,
                startingHole: scorecards[0].holes[0].holeNumber,
                endingHole: scorecards[0].holes[scorecards[0].holes.length - 1].holeNumber,
                value: perMatchValue,
                original: true
            })

            if (scorecards[0].holes.length === 18) {
                allMatches.push({
                    active: true,
                    startingHole: 1,
                    endingHole: 9,
                    value: perMatchValue,
                    original: true
                })
                allMatches.push({
                    active: true,
                    startingHole: 10,
                    endingHole: 18,
                    value: perMatchValue,
                    original: true
                })
            }
        } else if (sixSixSix) {
            if (sixSixSixOverallValue > 0) {
                allMatches.push({
                    active: true,
                    startingHole: 1,
                    endingHole: scorecards[0].holes[scorecards[0].holes.length - 1].holeNumber,
                    value: sixSixSixOverallValue,
                    original: true
                })
            }

            for (let i = 0; i < Math.floor(scorecards[0].holes.length / 6); i++) {
                allMatches.push({
                    active: true,
                    startingHole: (i * 6) + 1,
                    endingHole: ((i + 1) * 6),
                    value: perMatchValue,
                    original: true
                })
            }
        } else if (threeThreeThree) {
            if (threeThreeThreeOverallValue > 0) {
                allMatches.push({
                    active: true,
                    startingHole: 1,
                    endingHole: scorecards[0].holes[scorecards[0].holes.length - 1].holeNumber,
                    value: threeThreeThreeOverallValue,
                    original: true
                })
            }

            for (let i = 0; i < Math.floor(scorecards[0].holes.length / 3); i++) {
                allMatches.push({
                    active: true,
                    startingHole: (i * 3) + 1,
                    endingHole: ((i + 1) * 3),
                    value: perMatchValue,
                    original: true
                })
            }
        } else {
            allMatches.push({
                active: true,
                startingHole: scorecards[0].holes[0].holeNumber,
                endingHole: scorecards[0].holes[scorecards[0].holes.length - 1].holeNumber,
                value: perMatchValue,
                original: true
            })
        }

        scorecards = trackMatchStatuses(scorecards, answers, teams, allMatches, perMatchValue, carryovers, type, combinedScore, autoPresses, autoPressTrigger, sweepValue, teamsChangeEveryThree, teamsChangeEverySix, stableford, stablefordPoints, stablefordQuota);
    }

    if (extraBirdieValue > 0 || extraEagleValue > 0) {
        for (let i = 0; i < scorecards[0].holes.length; i++) {
            const holeIndex = i;

            for (const scorer of scorecards) {
                const hole = scorer.holes[holeIndex];
                if (!hole || hole.score <= 0 || hole.par <= 0) continue;

                const strokes = hole.score;
                const par = hole.par;
                const diff = par - strokes;

                let bonusValue = 0;
                if (diff === 1) bonusValue = extraBirdieValue;
                else if (diff >= 2) bonusValue = extraEagleValue;

                if (bonusValue <= 0) continue;

                const scorerName = scorer.name;
                const scorerTeam = extraBirdieTeam ? findTeamFromTeams(scorerName, teams) : [scorerName];
                const teammates = scorerTeam; // includes scorer
                const nonTeammates = scorecards
                    .map(p => p.name)
                    .filter(name => !scorerTeam.includes(name));

                const totalPot = bonusValue * nonTeammates.length;
                const payoutPerTeammate = Math.round((totalPot / teammates.length) * 100) / 100;

                // Award to each teammate
                for (const name of teammates) {
                    const player = scorecards.find(p => p.name === name);
                    const playerHole = player?.holes?.[holeIndex];
                    if (playerHole) {
                        playerHole.plusMinus = (playerHole.plusMinus || 0) + payoutPerTeammate;
                    }
                }

                // Deduct from each non-teammate
                for (const name of nonTeammates) {
                    const player = scorecards.find(p => p.name === name);
                    const playerHole = player?.holes?.[holeIndex];
                    if (playerHole) {
                        playerHole.plusMinus = (playerHole.plusMinus || 0) - bonusValue;
                    }
                }
            }
        }
    }

    return scorecards;
}

// 🧠 Helper: return array of teammates including the scorer
function findTeamFromTeams(name, teams) {
    for (const team of teams) {
        const members = team.split(" & ").map(p => p.trim());
        if (members.includes(name)) return members;
    }
    return [name];
}

function trackMatchStatuses(scorecards, answers, teams, matches, matchValue, carryovers, type, combinedScore, autoPresses, autoPressTrigger, sweepValue, teamsChangeEveryThree, teamsChangeEverySix, stableford, stablefordPoints, stablefordQuota) {
    const allMatches = [...matches];
    let foundNewPress = true;

    while (foundNewPress) {
        foundNewPress = false;

        for (let j = allMatches.length - 1; j >= 0; j--) {
            if (teamsChangeEveryThree || teamsChangeEverySix) {
                //Get teams somehow
                const differentTeams = getTeamsFromAnswers(answers.find(h => h.hole === allMatches[j].startingHole).answers, teams.map(team => team.split(' & ')).flat());
                if (differentTeams.length === 2) {
                    teams = [...differentTeams];
                }
            }

            const { firstTeamDown, holesRemaining } = getFirstTeamDownInMatch(
                teams,
                scorecards,
                allMatches[j].startingHole,
                allMatches[j].endingHole,
                type,
                combinedScore,
                stableford,
                stablefordPoints,
                stablefordQuota
            );

            //Determine any auto presses
            if (type === "match" && autoPresses && Math.abs(firstTeamDown) >= autoPressTrigger) {
                const press = {
                    active: true,
                    startingHole: allMatches[j].endingHole - holesRemaining,
                    endingHole: allMatches[j].endingHole,
                    value: matchValue,
                    original: false
                };

                const alreadyExists = allMatches.some(p =>
                    p.startingHole === press.startingHole &&
                    p.value === press.value &&
                    !p.original
                );

                if (!alreadyExists) {
                    allMatches.push(press)
                    foundNewPress = true;
                }
            }
        }
    }

    //Loop through answers to see which holes there were presses on
    for (let i = 0; i < answers.length; i++) {
        const holeNumber = answers[i].hole;
        const questions = answers[i].answers;
        for (let j = 0; j < questions.length; j++) {
            if (questions[j].question.includes("start a new press") && questions[j].answers.includes("Yes")) {
                allMatches.push({
                    active: true,
                    startingHole: holeNumber,
                    endingHole: answers[answers.length - 1].hole,
                    value: matchValue,
                    original: false
                })
            }
        }
    }

    //Loop through all presses to determine winners and losers
    let carryoverValue = 0;
    let firstTeamGotSwept = true;
    let firstTeamSwept = true;
    const teamsArrays = teams.map(team => team.split(' & '));

    //console.log("matches length", allMatches.length);

    for (let i = 0; i < allMatches.length; i++) {
        if (teamsChangeEveryThree || teamsChangeEverySix) {
            //Get teams somehow
            const differentTeams = getTeamsFromAnswers(answers.find(h => h.hole === allMatches[i].startingHole).answers, teams.map(team => team.split(' & ')).flat());
            if (differentTeams.length === 2) {
                teams = [...differentTeams];
            }
        }

        const { firstTeamDown, holesRemaining } = getFirstTeamDownInMatch(
            teams,
            scorecards,
            allMatches[i].startingHole,
            allMatches[i].endingHole,
            type,
            combinedScore,
            stableford,
            stablefordPoints,
            stablefordQuota
        );

        //console.log("Match", JSON.stringify(allMatches[i], null, 2));
        //console.log(`First team: Up ${firstTeamDown} with ${holesRemaining} to go`);

        if ((type === "match" && Math.abs(firstTeamDown) >= holesRemaining) || (type === "stroke" && holesRemaining === 0)) {
            if (firstTeamDown >= 0) {
                if (allMatches[i].original) {
                    firstTeamGotSwept = false;
                }

                if (firstTeamDown > 0) {
                    //First team wins the hole
                    const holeEnded = allMatches[i].endingHole - holesRemaining;
                    let largerTeam = teamsArrays[0].length;
                    if (teamsArrays[1].length > teamsArrays[0].length) {
                        largerTeam = teamsArrays[1].length;
                    }

                    const teamPot = (allMatches[i].value + (carryovers && allMatches[i].original ? carryoverValue : 0)) * largerTeam;

                    for (let j = 0; j < scorecards.length; j++) {
                        const hole = scorecards[j].holes.find(h => h.holeNumber === holeEnded);

                        if (teamsArrays[0].includes(scorecards[j].name)) {
                            hole.plusMinus += teamPot / teamsArrays[0].length;
                        } else {
                            hole.plusMinus -= teamPot / teamsArrays[1].length;
                        }
                    }

                    if (allMatches[i].original) {
                        carryoverValue = 0;
                    }
                } else if (carryovers && allMatches[i].original) {
                    carryoverValue += allMatches[i].value
                }
            } else {
                if (allMatches[i].original) {
                    firstTeamSwept = false;
                }

                //First team loses the hole
                const holeEnded = allMatches[i].endingHole - holesRemaining;
                let largerTeam = teamsArrays[0].length;
                if (teamsArrays[1].length > teamsArrays[0].length) {
                    largerTeam = teamsArrays[1].length;
                }

                const teamPot = (allMatches[i].value + (carryovers && allMatches[i].original ? carryoverValue : 0)) * largerTeam;

                for (let j = 0; j < scorecards.length; j++) {
                    const hole = scorecards[j].holes.find(h => h.holeNumber === holeEnded);

                    if (teamsArrays[0].includes(scorecards[j].name)) {
                        hole.plusMinus -= teamPot / teamsArrays[0].length;
                    } else {
                        hole.plusMinus += teamPot / teamsArrays[1].length;
                    }

                }

                if (allMatches[i].original) {
                    carryoverValue = 0;
                }
            }
        } else if (allMatches[i].original) {
            firstTeamGotSwept = false;
            firstTeamSwept = false;
        }
    }

    //Use original to determine sweep
    if (sweepValue > 0) {
        if (firstTeamGotSwept) {
            const holeEnded = scorecards[0].holes[scorecards[0].holes.length - 1].holeNumber;
            let largerTeam = teamsArrays[0].length;
            if (teamsArrays[1].length > teamsArrays[0].length) {
                largerTeam = teamsArrays[1].length;
            }

            const teamPot = sweepValue * largerTeam;

            for (let j = 0; j < scorecards.length; j++) {
                const hole = scorecards[j].holes.find(h => h.holeNumber === holeEnded);

                if (teamsArrays[0].includes(scorecards[j].name)) {
                    hole.plusMinus -= teamPot / teamsArrays[0].length;
                } else {
                    hole.plusMinus += teamPot / teamsArrays[1].length;
                }
            }
        } else if (firstTeamSwept) {
            const holeEnded = scorecards[0].holes[scorecards[0].holes.length - 1].holeNumber;
            let largerTeam = teamsArrays[0].length;
            if (teamsArrays[1].length > teamsArrays[0].length) {
                largerTeam = teamsArrays[1].length;
            }

            const teamPot = sweepValue * largerTeam;

            for (let j = 0; j < scorecards.length; j++) {
                const hole = scorecards[j].holes.find(h => h.holeNumber === holeEnded);

                if (teamsArrays[0].includes(scorecards[j].name)) {
                    hole.plusMinus += teamPot / teamsArrays[0].length;
                } else {
                    hole.plusMinus -= teamPot / teamsArrays[1].length;
                }
            }
        }
    }

    return scorecards;
}

function getFirstTeamDownInMatch(teams, scorecards, startingHole, endingHole, type, combinedScore, stableford, stablefordPoints, stablefordQuota) {
    const teamsArrays = teams.map(team => team.split(' & '));
    let firstTeamPoints = 0;
    let holesRemaining = endingHole - startingHole + 1;

    for (let i = startingHole; i <= endingHole; i++) {
        const firstTeamScores = [];
        const secondTeamScores = [];

        for (let j = 0; j < scorecards.length; j++) {
            const playerHole = scorecards[j].holes.find(h => h.holeNumber === i);
            const netScore = playerHole.score - playerHole.strokes;
            const toPar = playerHole.score - playerHole.strokes - playerHole.par;

            if (playerHole.score > 0) {
                if (!stableford) {
                    if (teamsArrays[0].includes(scorecards[j].name)) {
                        firstTeamScores.push(combinedScore ? toPar : netScore);
                    } else {
                        secondTeamScores.push(combinedScore ? toPar : netScore);
                    }
                } else {
                    let points = stablefordPoints.par;
                    if (toPar === -1) {
                        points = stablefordPoints.birdie;
                    } else if (toPar === -2) {
                        points = stablefordPoints.eagle;
                    } else if (toPar <= -3) {
                        points = stablefordPoints.albatross;
                    } else if (toPar === 1) {
                        points = stablefordPoints.bogey;
                    } else if (toPar >= 2) {
                        points = stablefordPoints.double;
                    }

                    playerHole.points = points;
                    if (teamsArrays[0].includes(scorecards[j].name)) {
                        firstTeamScores.push(points * -1);
                    } else {
                        secondTeamScores.push(points * -1);
                    }
                }
            }
        }

        if (firstTeamScores.length === 0 || secondTeamScores.length === 0) {
            continue;
        } else {
            holesRemaining--;
        }

        let firstTeamScore = combinedScore ? Math.sum(...firstTeamScores) : Math.min(...firstTeamScores);
        let secondTeamScore = combinedScore ? Math.sum(...secondTeamScores) : Math.min(...secondTeamScores);

        if (!stablefordQuota) {
            if (firstTeamScore < secondTeamScore) {
                type === "match" ? firstTeamPoints++ : firstTeamPoints += (secondTeamScore - firstTeamScore);
            } else if (firstTeamScore > secondTeamScore) {
                type === "match" ? firstTeamPoints-- : firstTeamPoints -= (firstTeamScore - secondTeamScore);
            }
        }

        if (type === "match" && Math.abs(firstTeamPoints) > holesRemaining) {
            break;
        }
    }

    if (stablefordQuota) {
        let firstTeamQuotaPoints = 0;
        let secondTeamQuotaPoints = 0;

        for (let i = 0; i < scorecards?.length; i++) {
            let isFirstTeam = true;
            if (teamsArrays[0].includes(scorecards[i].name)) {
                firstTeamQuotaPoints += ((scorecards[i].holes.length * 2) - scorecards[i].handicap);
            } else {
                isFirstTeam = false;
                secondTeamQuotaPoints += ((scorecards[i].holes.length * 2) - scorecards[i].handicap);
            }

            for (let j = startingHole; j <= endingHole; j++) {
                if (isFirstTeam) {
                    firstTeamQuotaPoints += (36 - scorecards[i].holes[j].points);
                } else {
                    secondTeamQuotaPoints += (36 - scorecards[i].holes[j].points);
                }
            }
        }

        firstTeamPoints = 0;
        if (firstTeamQuotaPoints > secondTeamQuotaPoints) {
            firstTeamPoints = 1;
        } else if (secondTeamQuotaPoints > firstTeamQuotaPoints) {
            firstTeamPoints = -1;
        }
    }

    return { firstTeamDown: firstTeamPoints, holesRemaining }
}

function stableford(scorecards, scores, config, answers) {
    const {
        teams = [],
        type = "stroke",
        perHoleValue = 0,
        perMatchValue = 0,
        perPointValue = 0,
        carryovers = false,
        combinedScore = false,
        autoPresses = false,
        autoPressTrigger = 2,
        extraBirdieValue = 0,
        extraEagleValue = 0,
        extraBirdieTeam = false,
        nassau = false,
        sixSixSix = false,
        threeThreeThree = false,
        sixSixSixOverallValue = 0,
        threeThreeThreeOverallValue = 0,
        sweepValue = 0,
        onlyGrossBirdies = false,
        teamsChangeEverySix = false,
        teamsChangeEveryThree = false,
        doublePoints = 0,
        bogeyPoints = 1,
        parPoints = 2,
        birdiePoints = 4,
        eaglePoints = 6,
        albatrossPoints = 8,
        quota = false
    } = config;

    return universalMatchScorer(scorecards, scores, {
        teams,
        type,
        perHoleValue,
        perMatchValue,
        perStrokeValue: perPointValue,
        carryovers,
        combinedScore,
        autoPresses,
        autoPressTrigger,
        extraBirdieValue,
        extraEagleValue,
        extraBirdieTeam,
        nassau,
        sixSixSix,
        threeThreeThree,
        sixSixSixOverallValue,
        threeThreeThreeOverallValue,
        sweepValue,
        onlyGrossBirdies,
        teamsChangeEverySix,
        teamsChangeEveryThree,
        stableford: true,
        stablefordQuota: quota,
        stablefordPoints: {
            double: doublePoints,
            bogey: bogeyPoints,
            par: parPoints,
            birdie: birdiePoints,
            eagle: eaglePoints,
            albatross: albatrossPoints
        }
    }, answers);
}

module.exports = {
    scotch,
    junk,
    vegas,
    wolf,
    leftRight,
    ninePoint,
    banker,
    universalMatchScorer,
    stableford
}
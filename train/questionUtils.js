const { scotch, junk, vegas, wolf, leftRight, ninePoint, banker, universalMatchScorer, stableford } = require("../games/scoring");
const { calculateWinPercents } = require("./utils");

function getQuestionsFromConfig(raw, config, sideConfig, golfers) {
    let questions = [];

    if (raw === "scotch" || raw === "bridge" || raw === "umbrella") {
        questions.push({
            question: `Who got the point for proximity?`,
            answers: golfers,
            numberOfAnswers: 2,
            holes: "all"
        });

        if (config.points === 8) {
            questions.push({
                question: `Who had the longest drive?`,
                answers: golfers,
                numberOfAnswers: 2,
                holes: "all"
            })
            questions.push({
                question: `Which team had the fewest putts?`,
                answers: config.teams,
                numberOfAnswers: 1,
                holes: "all"
            })
        }

        if (config.presses) {
            if (config.doublePresses) {
                questions.push({
                    question: `Was there a press or a double press?`,
                    answers: ["Press", "Double Press"],
                    numberOfAnswers: 1,
                    holes: "all"
                })
            } else {
                questions.push({
                    question: `Was there a press?`,
                    answers: ["No", "Yes"],
                    numberOfAnswers: 1,
                    holes: "all"
                })
            }
        }
    } else if (raw === "vegas" || raw === "daytona") {
        if (config.presses) {
            if (config.doublePresses) {
                questions.push({
                    question: `Was there a press or a double press?`,
                    answers: ["Press", "Double Press"],
                    numberOfAnswers: 1,
                    holes: "all"
                })
            } else {
                questions.push({
                    question: `Was there a press?`,
                    answers: ["No", "Yes"],
                    numberOfAnswers: 1,
                    holes: "all"
                })
            }
        }
    } else if (raw === "wolf") {
        questions.push({
            question: `Who was the wolf?`,
            answers: golfers,
            numberOfAnswers: 1,
            holes: "all"
        })

        if (config.blindWolfAllowed) {
            questions.push({
                question: `Did the wolf go solo?`,
                answers: ["No", "Yes, Before Their Tee Shot", "Yes, After Their Tee Shot", "Yes, After Everyone's Tee Shot"],
                numberOfAnswers: 1,
                holes: "all"
            })
        } else {
            questions.push({
                question: `Did the wolf go solo?`,
                answers: ["No", "Yes, After Their Tee Shot", "Yes, After Everyone's Tee Shot"],
                numberOfAnswers: 1,
                holes: "all"
            })
        }

        questions.push({
            question: `Who was their partner?`,
            answers: golfers,
            numberOfAnswers: 1,
            holes: "all"
        })

        if (config.crybaby) {
            questions.push({
                question: `Did the bet change? If so, enter the new dollar value:`,
                answers: [""],
                numberOfAnswers: 1,
                holes: `${config.crybabyHole || 16}+`
            })
        }
    } else if (raw === "left-right" || raw === "middle-outside" || raw === "flip wolf" || raw === "king of the hill") {
        if (raw === "left-right") {
            questions.push({
                question: `Who was on the left team?`,
                answers: golfers,
                numberOfAnswers: golfers.length,
                holes: "all"
            })
        } else if (raw === "middle-outside") {
            questions.push({
                question: `Who was on the middle team?`,
                answers: golfers,
                numberOfAnswers: golfers.length,
                holes: "all"
            })
        } else if (raw === "flip wolf") {
            questions.push({
                question: `Who was on the heads team?`,
                answers: golfers,
                numberOfAnswers: golfers.length,
                holes: "all"
            })
        } else {
            config.soloMultiple = 1;
            questions.push({
                question: `Who was king of the hill?`,
                answers: golfers,
                numberOfAnswers: 1,
                holes: "all"
            })
        }

        if (config.presses) {
            if (config.doublePresses) {
                questions.push({
                    question: `Was there a press or a double press?`,
                    answers: ["Press", "Double Press"],
                    numberOfAnswers: 1,
                    holes: "all"
                })
            } else {
                questions.push({
                    question: `Was there a press?`,
                    answers: ["No", "Yes"],
                    numberOfAnswers: 1,
                    holes: "all"
                })
            }
        }

        if (config.crybaby) {
            questions.push({
                question: `Did the bet change? If so, enter the new dollar value:`,
                answers: [""],
                numberOfAnswers: 1,
                holes: `${config.crybabyHole || 16}+`
            })
        }
    } else if (["match play", "stroke play", "scramble", "shamble", "bramble", "chapman", "alt shot"].includes(raw)) {
        if (config.teamsChangeEveryThree) {
            questions.push({
                question: `Select the golfers on one team for this three hole match:`,
                answers: golfers,
                numberOfAnswers: golfers.length,
                holes: "1,4,7"
            })
        } else if (config.teamsChangeEverySix) {
            questions.push({
                question: `Select the golfers on one team for this six hole match:`,
                answers: golfers,
                numberOfAnswers: golfers.length,
                holes: "1,7,13"
            })
        }

        if (config.presses) {
            if (config.perHoleOrMatch === "hole") {
                if (config.doublePresses) {
                    questions.push({
                        question: `Was there a press or a double press?`,
                        answers: ["Press", "Double Press"],
                        numberOfAnswers: 1,
                        holes: "all"
                    })
                } else {
                    questions.push({
                        question: `Was there a press?`,
                        answers: ["No", "Yes"],
                        numberOfAnswers: 1,
                        holes: "all"
                    })
                }
            } else if (!config.teamsChangeEveryThree && !config.teamsChangeEverySix) {
                if (config.autoPresses) {
                    questions.push({
                        question: `Did someone start a new press that is not an autopress?`,
                        answers: ["No", "Yes"],
                        numberOfAnswers: 1,
                        holes: "all"
                    })
                } else {
                    questions.push({
                        question: `Did someone start a new press on the teebox?`,
                        answers: ["No", "Yes"],
                        numberOfAnswers: 1,
                        holes: "all"
                    })
                }
            }
        }
    } else if (raw === "stableford" || raw === "quota") {
        if (config.presses) {
            if (config.doublePresses) {
                questions.push({
                    question: `Was there a press or a double press?`,
                    answers: ["Press", "Double Press"],
                    numberOfAnswers: 1,
                    holes: "all"
                })
            } else {
                questions.push({
                    question: `Was there a press?`,
                    answers: ["No", "Yes"],
                    numberOfAnswers: 1,
                    holes: "all"
                })
            }
        }
    }

    if (!config) {
        return res.status(500).json({ error: "Sorry, I don't know how to score that kind of golf match yet." });
    } else {
        console.log("Config:", JSON.stringify(config, null, 2))
    }


    if (sideConfig.greenies?.valid) {
        questions.push({
            question: `Who got closest to the pin?`,
            answers: golfers,
            numberOfAnswers: sideConfig.greenies?.teams ? 2 : 1,
            holes: "par 3s"
        });
    }

    if (sideConfig.chipIns?.valid) {
        questions.push({
            question: `Did anyone chip in?`,
            answers: golfers,
            numberOfAnswers: 4,
            holes: "all"
        });
    }

    if (sideConfig.sandies?.valid) {
        questions.push({
            question: `Did anyone get a sandie?`,
            answers: golfers,
            numberOfAnswers: 4,
            holes: "all"
        });
    }

    if (sideConfig.polies?.valid) {
        questions.push({
            question: `Did anyone get a polie?`,
            answers: golfers,
            numberOfAnswers: 4,
            holes: "all"
        });
    }

    if (sideConfig.barkies?.valid) {
        questions.push({
            question: `Did anyone get a barkie?`,
            answers: golfers,
            numberOfAnswers: 4,
            holes: "all"
        });
    }

    if (sideConfig.arnies?.valid) {
        questions.push({
            question: `Did anyone get an Arnie?`,
            answers: golfers,
            numberOfAnswers: 4,
            holes: "all"
        });
    }

    if (sideConfig.oozle?.valid || sideConfig.bingoBangoBongo?.valid) {
        if (sideConfig.bingoBangoBongo?.valid) {
            questions.push({
                question: `Who was the first on the green?`,
                answers: golfers,
                numberOfAnswers: 1,
                holes: "all"
            });

            questions.push({
                question: `Who was CTP once all balls were on the green?`,
                answers: golfers,
                numberOfAnswers: 1,
                holes: "all"
            });
        }

        questions.push({
            question: `Who was the first to hole out?`,
            answers: golfers,
            numberOfAnswers: 1,
            holes: "all"
        });
    }

    if (sideConfig.fish?.valid) {
        questions.push({
            question: `Did anyone hit into a water hazard?`,
            answers: golfers,
            numberOfAnswers: 4,
            holes: "all"
        });
    }

    if (sideConfig.snake?.valid) {
        questions.push({
            question: `Did anyone three-putt or worse?`,
            answers: golfers,
            numberOfAnswers: 1,
            holes: "all"
        });
    }

    return questions;
}

function applyConfigToScorecards(scorecards, configType, config, strippedJunk, answers, golfers, scores) {
    console.log(configType, config);
    
    if (configType === "scotch" || configType === "umbrella" || configType === "bridge") {
        scorecards = scotch(
            scorecards,
            answers,
            scores,
            config.teams,
            config.teams.map(team => team.split(' & ')),
            config.pointVal,
            config.points,
            config.autoDoubles,
            config.autoDoubleAfterNineTrigger,
            config.autoDoubleMoneyTrigger,
            config.autoDoubleWhileTiedTrigger,
            config.autoDoubleValue,
            config.autoDoubleStays,
            config.miracle,
            config.onlyGrossBirdies
        );
    } else if (configType === "vegas" || configType === "daytona") {
        scorecards = vegas(
            scorecards,
            scores,
            config,
            answers
        );
    } else if (configType === "wolf") {
        scorecards = wolf(
            scorecards,
            scores,
            config,
            answers
        )
    } else if (["left-right", "middle-outside", "flip wolf", "king of the hill"].includes(configType)) {
        scorecards = leftRight(
            scorecards,
            scores,
            config,
            answers
        )
    } else if (configType === "nine point") {
        scorecards = ninePoint(
            scorecards,
            scores,
            config
        )
    } else if (configType === "banker") {
        scorecards = banker(
            scorecards,
            scores,
            answers
        )
    } else if (["match play", "stroke play", "scramble", "shamble", "bramble", "chapman", "alt shot"].includes(configType)) {
        scorecards = universalMatchScorer(
            scorecards,
            scores,
            config,
            answers
        );
    } else if (["stableford", "quota"].includes(configType)) {
        scorecards = stableford(
            scorecards,
            scores,
            config,
            answers
        )
    }

    scorecards = junk(scorecards, answers, strippedJunk, golfers, config.teams || false);
    scorecards = calculateWinPercents(scorecards);

    let allHolesPlayed = true;
    for (i = 0; i < scorecards.length; i++) {
        let plusMinus = 0;
        let handicap = 0;
        let points = 0;
        let golferPlayedAllHoles = true;

        for (j = 0; j < scorecards[i].holes.length; j++) {
            plusMinus += scorecards[i].holes[j].plusMinus;
            handicap += scorecards[i].holes[j].strokes;
            points += scorecards[i].holes[j].points;

            if (scorecards[i].holes[j].score === 0) {
                golferPlayedAllHoles = false;
            }
        }

        scorecards[i].plusMinus = plusMinus;
        scorecards[i].handicap = handicap;
        scorecards[i].points = points;

        if (allHolesPlayed && !golferPlayedAllHoles) {
            allHolesPlayed = false;
        }
    }

    return scorecards;
}

module.exports = {
    applyConfigToScorecards,
    getQuestionsFromConfig
}
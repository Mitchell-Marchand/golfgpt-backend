const { getRandomInt, getHoleList } = require('./utils');

function getStrokes(names, holes) {
    const strokeType = getRandomInt(6);
    const verbeage = getRandomInt(13);

    let popStroke = "stroke";
    if (verbeage > 7 && verbeage <= 10) {
        popStroke = "pop";
    } else if (verbeage === 11) {
        popStroke = "dot";
    } else if (verbeage === 12) {
        popStroke = "shot"
    } else if (verbeage === 13) {
        popStroke = "bump";
    }

    const strokes = names.map(name => ({
        name,
        pops: []
    }));

    //x a side, x on front y on back
    if (holes?.length === 18 && getRandomInt(10) === 1) {
        let prompts = [];

        for (let i = 0; i < strokes?.length; i++) {
            let pops = strokes[i].pops;
            let front = getRandomInt(5) - 1;
            let back = front + (getRandomInt(3) - 2);

            for (let j = 0; j < holes?.length; j++) {
                if (holes[j].holeNumber <= 9 && holes[j].allocation <= front * 2) {
                    pops.push({
                        hole: null,
                        allocation: holes[j].allocation,
                        strokes: 1
                    });
                } else if (holes[j].holeNumber > 9 && holes[j].allocation <= back * 2) {
                    pops.push({
                        hole: null,
                        allocation: holes[j].allocation,
                        strokes: 1
                    });
                }
            }

            const idx = getRandomInt(2);
            if (idx === 1) {
                if (front === back) {
                    prompts.push(`${strokes[i].name} gets ${front} a side`);
                } else {
                    prompts.push(`${strokes[i].name} gets ${front} on the front and ${back} on the back`);
                }
            } else if (idx === 2) {
                if (front === back) {
                    prompts.push(`${strokes[i].name} gets ${front} ${popStroke}${front === 1 ? "" : "s"} a side`);
                } else {
                    prompts.push(`${strokes[i].name} gets ${front} ${popStroke}${front === 1 ? "" : "s"} on the front and ${back} ${popStroke}${back === 1 ? "" : "s"} on the back`);
                }
            }

            strokes[i].pops = pops;
        }

        const delineator = getRandomInt(3);
        return {
            strokes,
            prompt: prompts?.length > 0 ? prompts.join(delineator === 1 ? ". " : delineator === 2 ? ", " : " and ") : ""
        };
    }

    if (strokeType <= 2) {
        //No strokes for anyone or empty
        const pType = getRandomInt(10);
        let prompt = "";

        if (pType === 6) {
            prompt = `No ${popStroke}s for anyone`;
        } else if (pType === 7) {
            prompt = `No ${popStroke}s`;
        } else if (pType === 8) {
            prompt = `No one gets any ${popStroke}s`;
        } else if (pType >= 9) {
            prompt = `Gross game`;
        }

        return {
            strokes,
            prompt
        };
    } else if (strokeType <= 4) {
        //Randomly generate strokes for each golfer by hole number and generate prompt
        let prompts = [];

        for (let i = 0; i < strokes?.length; i++) {
            let pops = strokes[i].pops;
            let type = getRandomInt(10);
            let gotStroke = false;

            for (let j = 0; j < holes?.length; j++) {
                if (type === 1) {
                    //Stick, giving some back
                    if (getRandomInt(holes?.length) <= 3) {
                        gotStroke = true;
                        pops.push({
                            hole: holes[j].holeNumber,
                            allocation: null,
                            strokes: -1
                        });
                    }
                } else if (type <= 7) {
                    //Different probability of strokes
                    if (getRandomInt(holes?.length) <= type - 1) {
                        gotStroke = true;
                        pops.push({
                            hole: holes[j].holeNumber,
                            allocation: null,
                            strokes: 1
                        });
                    }
                } else if (type === 8) {
                    //Multiple strokes
                    if (getRandomInt(holes?.length) <= 3) {
                        gotStroke = true;
                        pops.push({
                            hole: holes[j].holeNumber,
                            allocation: null,
                            strokes: 2
                        });
                    } else if (getRandomInt(holes?.length) <= 15) {
                        gotStroke = true;
                        pops.push({
                            hole: holes[j].holeNumber,
                            allocation: null,
                            strokes: 1
                        });
                    }
                } else if (type === 9) {
                    //Half stroke on certain holes
                    if (getRandomInt(holes?.length) <= 6) {
                        gotStroke = true;
                        pops.push({
                            hole: holes[j].holeNumber,
                            allocation: null,
                            strokes: 0.5
                        });
                    }
                } else if (type === 10) {
                    //Combo of full and half
                    if (getRandomInt(holes?.length) <= 3) {
                        gotStroke = true;
                        pops.push({
                            hole: holes[j].holeNumber,
                            allocation: null,
                            strokes: 0.5
                        });
                    } else if (getRandomInt(holes?.length) <= 3) {
                        gotStroke = true;
                        pops.push({
                            hole: holes[j].holeNumber,
                            allocation: null,
                            strokes: 1
                        });
                    }
                }
            }

            if (gotStroke) {
                pops.sort((a, b) => {
                    if (b.strokes !== a.strokes) {
                        return b.strokes - a.strokes;
                    }
                    return a.hole - b.hole;
                });

                let prompt = ``;

                const idx = getRandomInt(50);
                const halfPops = pops.filter(p => p.strokes === 0.5).length;
                const fullPops = pops.filter(p => p.strokes === 1).length;
                const doublePops = pops.filter(p => p.strokes === 2).length;
                const negPops = pops.filter(p => p.strokes === -1).length;

                if (negPops > 0) {
                    if (idx <= 5) {
                        prompt = `${strokes[i].name} gives one back on holes ${getHoleList(pops, -1)}`;
                    } else if (idx < 10) {
                        prompt = `${strokes[i].name} gives a ${popStroke} back on holes ${getHoleList(pops, -1)}`;
                    } else if (idx <= 15) {
                        prompt = `${strokes[i].name} loses a ${popStroke} on holes ${getHoleList(pops, -1)}`;
                    } else if (idx <= 20) {
                        prompt = `${strokes[i].name} loses one on holes ${getHoleList(pops, -1)}`;
                    } else if (idx <= 25) {
                        prompt = `${strokes[i].name} gives one back on ${getHoleList(pops, -1)}`;
                    } else if (idx < 30) {
                        prompt = `${strokes[i].name} gives a ${popStroke} back on ${getHoleList(pops, -1)}`;
                    } else if (idx <= 35) {
                        prompt = `${strokes[i].name} loses a ${popStroke} on ${getHoleList(pops, -1)}`;
                    } else if (idx <= 40) {
                        prompt = `${strokes[i].name} loses one on ${getHoleList(pops, -1)}`;
                    } else if (idx <= 45) {
                        prompt = `-1 ${popStroke}s for ${strokes[i].name} on ${getHoleList(pops, -1)}`;
                    } else if (idx <= 50) {
                        prompt = `-1 ${popStroke}s for ${strokes[i].name} on holes ${getHoleList(pops, -1)}`;
                    }
                } else {
                    if (fullPops > 0) {
                        if (idx <= 5) {
                            prompt = `${strokes[i].name} gets one on holes ${getHoleList(pops, 1)}`;
                        } else if (idx < 10) {
                            prompt = `${strokes[i].name} gets a ${popStroke} on holes ${getHoleList(pops, 1)}`;
                        } else if (idx <= 15) {
                            prompt = `${strokes[i].name} ${popStroke}s on holes ${getHoleList(pops, 1)}`;
                        } else if (idx <= 20) {
                            prompt = `${strokes[i].name} needs a ${popStroke} on holes ${getHoleList(pops, 1)}`;
                        } else if (idx <= 25) {
                            prompt = `${strokes[i].name} gets one on ${getHoleList(pops, 1)}`;
                        } else if (idx < 30) {
                            prompt = `${strokes[i].name} gets a ${popStroke} on ${getHoleList(pops, 1)}`;
                        } else if (idx <= 35) {
                            prompt = `${strokes[i].name} ${popStroke}s on ${getHoleList(pops, 1)}`;
                        } else if (idx <= 40) {
                            prompt = `${strokes[i].name} needs a ${popStroke} on ${getHoleList(pops, 1)}`;
                        } else if (idx <= 45) {
                            prompt = `${popStroke}s for ${strokes[i].name} on ${getHoleList(pops, 1)}`;
                        } else if (idx <= 50) {
                            prompt = `${popStroke}s for ${strokes[i].name} on holes ${getHoleList(pops, 1)}`;
                        }
                    }

                    if (doublePops > 0) {
                        if (!prompt) {
                            if (idx <= 5) {
                                prompt = `${strokes[i].name} gets two on holes ${getHoleList(pops, 2)}`;
                            } else if (idx < 10) {
                                prompt = `${strokes[i].name} gets two ${popStroke}s on holes ${getHoleList(pops, 2)}`;
                            } else if (idx <= 15) {
                                prompt = `${strokes[i].name} double ${popStroke}s on holes ${getHoleList(pops, 2)}`;
                            } else if (idx <= 20) {
                                prompt = `${strokes[i].name} needs two ${popStroke} on holes ${getHoleList(pops, 2)}`;
                            } else if (idx <= 25) {
                                prompt = `${strokes[i].name} gets two on ${getHoleList(pops, 2)}`;
                            } else if (idx < 30) {
                                prompt = `${strokes[i].name} gets two ${popStroke}s on ${getHoleList(pops, 2)}`;
                            } else if (idx <= 35) {
                                prompt = `${strokes[i].name} double ${popStroke}s on ${getHoleList(pops, 2)}`;
                            } else if (idx <= 40) {
                                prompt = `${strokes[i].name} needs two ${popStroke} on ${getHoleList(pops, 2)}`;
                            } else if (idx <= 45) {
                                prompt = `2 ${popStroke}s for ${strokes[i].name} on ${getHoleList(pops, 2)}`;
                            } else if (idx <= 50) {
                                prompt = `2 ${popStroke}s for ${strokes[i].name} on holes ${getHoleList(pops, 2)}`;
                            }
                        } else {
                            if (idx <= 25) {
                                prompt += ` and two on holes ${getHoleList(pops, 2)}`;
                            } else {
                                prompt += ` and two on ${getHoleList(pops, 2)}`;
                            }
                        }
                    }

                    if (halfPops > 0) {
                        if (!prompt) {
                            if (idx <= 5) {
                                prompt = `${strokes[i].name} gets a half ${popStroke} on holes ${getHoleList(pops, 0.5)}`;
                            } else if (idx < 10) {
                                prompt = `${strokes[i].name} gets half a ${popStroke} on holes ${getHoleList(pops, 0.5)}`;
                            } else if (idx <= 15) {
                                prompt = `${strokes[i].name} half ${popStroke}s on holes ${getHoleList(pops, 0.5)}`;
                            } else if (idx <= 20) {
                                prompt = `${strokes[i].name} needs half a ${popStroke} on holes ${getHoleList(pops, 0.5)}`;
                            } else if (idx <= 25) {
                                prompt = `${strokes[i].name} gets a half on ${getHoleList(pops, 0.5)}`;
                            } else if (idx < 30) {
                                prompt = `${strokes[i].name} gets half a ${popStroke} on ${getHoleList(pops, 0.5)}`;
                            } else if (idx <= 35) {
                                prompt = `${strokes[i].name} half ${popStroke}s on ${getHoleList(pops, 0.5)}`;
                            } else if (idx <= 40) {
                                prompt = `${strokes[i].name} needs half a ${popStroke} on ${getHoleList(pops, 0.5)}`;
                            } else if (idx <= 45) {
                                prompt = `1/2 ${popStroke} for ${strokes[i].name} on ${getHoleList(pops, 0.5)}`;
                            } else if (idx <= 50) {
                                prompt = `1/2 ${popStroke} for ${strokes[i].name} on holes ${getHoleList(pops, 0.5)}`;
                            }
                        } else {
                            if (idx <= 10) {
                                prompt += ` and a half on holes ${getHoleList(pops, 0.5)}`;
                            } else if (idx <= 20) {
                                prompt += ` and 1/2 on ${getHoleList(pops, 0.5)}`;
                            } else if (idx <= 30) {
                                prompt += ` and a half ${popStroke} on ${getHoleList(pops, 0.5)}`;
                            } else if (idx <= 40) {
                                prompt += ` and 1/2 a ${popStroke} on ${getHoleList(pops, 0.5)}`;
                            } else {
                                prompt += ` and half ${popStroke}s on ${getHoleList(pops, 0.5)}`;
                            }
                        }
                    }
                }

                if (prompt) {
                    prompts.push(prompt);
                }
            }

            strokes[i].pops = pops;
        }

        //Generate the prompt...
        const delineator = getRandomInt(3);
        return {
            strokes,
            prompt: prompts?.length > 0 ? prompts.join(delineator === 1 ? ". " : delineator === 2 ? ", " : " and ") : ""
        };
    } else if (strokeType <= 8) {
        let prompts = [];

        for (let i = 0; i < strokes?.length; i++) {
            let pops = strokes[i].pops;
            let type = getRandomInt(11);
            let prompt = ``;

            if (type <= 3) {
                //giving back
                let index = getRandomInt(5);

                for (let j = 0; j < holes?.length; j++) {
                    if (type === 3 && holes[j].allocation <= index * (holes?.length === 18 ? 1 : 2)) {
                        pops.push({
                            hole: null,
                            allocation: holes[j].allocation,
                            strokes: -1
                        });
                    } else if (type !== 3 && holes[j].allocation > holes?.length - (index * (holes?.length === 18 ? 1 : 2))) {
                        pops.push({
                            hole: null,
                            allocation: holes[j].allocation,
                            strokes: -1
                        });
                    }
                }

                let idx = getRandomInt(2);

                if (type === 1) {
                    if (idx === 1) {
                        prompt = `${strokes[i].name} gives ${index} back`;
                    } else if (idx === 2) {
                        prompt = `${strokes[i].name} gives ${index} ${index === 1 ? popStroke : `${popStroke}s`} back`;
                    }
                } else if (type === 2) {
                    if (idx === 1) {
                        prompt = `${strokes[i].name} gives one back on the${index === 1 ? " " : ` ${index} `}easiest hole${index === 1 ? "" : "s"}`;
                    } else if (idx === 2) {
                        prompt = `${strokes[i].name} gives a ${popStroke} back on the${index === 1 ? " " : ` ${index} `}easiest hole${index === 1 ? "" : "s"}`;
                    }
                } else if (type === 3) {
                    if (idx === 1) {
                        prompt = `${strokes[i].name} gives one back on the${index === 1 ? " " : ` ${index} `}hardest hole${index === 1 ? "" : "s"}`;
                    } else if (idx === 2) {
                        prompt = `${strokes[i].name} gives a ${popStroke} back on the${index === 1 ? " " : ` ${index} `}hardest hole${index === 1 ? "" : "s"}`;
                    }
                }
            } else if (type <= 9) {
                // regular strokes
                let index = holes?.length === 18 ? getRandomInt(14) : getRandomInt(8);

                for (let j = 0; j < holes?.length; j++) {
                    if (type === 4 && holes[j].allocation > holes?.length - (index * (holes?.length === 18 ? 1 : 2))) {
                        pops.push({
                            hole: null,
                            allocation: holes[j].allocation,
                            strokes: 1
                        });
                    } else if (type !== 4 && holes[j].allocation <= index * (holes?.length === 18 ? 1 : 2)) {
                        pops.push({
                            hole: null,
                            allocation: holes[j].allocation,
                            strokes: 1
                        });
                    }
                }

                let idx = getRandomInt(2);

                if (type === 4) {
                    if (idx === 1) {
                        prompt = `${strokes[i].name} gets one on the${index === 1 ? " " : ` ${index} `}easiest hole${index === 1 ? "" : "s"}`;
                    } else if (idx === 2) {
                        prompt = `${strokes[i].name} gets a ${popStroke} on the${index === 1 ? " " : ` ${index} `}easiest hole${index === 1 ? "" : "s"}`;
                    }
                } else if (type <= 5) {
                    if (idx === 1) {
                        prompt = `${strokes[i].name} gets one on the${index === 1 ? " " : ` ${index} `}hardest hole${index === 1 ? "" : "s"}`;
                    } else if (idx === 2) {
                        prompt = `${strokes[i].name} gets a ${popStroke} on the${index === 1 ? " " : ` ${index} `}hardest hole${index === 1 ? "" : "s"}`;
                    }
                } else {
                    if (idx === 1) {
                        prompt = `${strokes[i].name} gets ${index}`;
                    } else if (idx === 2) {
                        prompt = `${strokes[i].name} gets ${index} ${index === 1 ? popStroke : `${popStroke}s`}`;
                    }
                }
            } else if (type === 10) {
                //Stroke a hole, half a hole, 2 a hole etc.
                const idx = getRandomInt(4);
                let strks = idx === 1 ? 1 : idx === 2 ? 0.5 : idx === 3 ? -1 : 2;
                for (let j = 0; j < holes?.length; j++) {
                    pops.push({
                        hole: null,
                        allocation: holes[j].allocation,
                        strokes: strks
                    });
                }

                if (idx === 1) {
                    if (getRandomInt(2) === 1) {
                        prompt = `${strokes[i].name} gets a ${popStroke} a hole`;
                    } else {
                        prompt = `${strokes[i].name} gets one a hole`;
                    }
                } else if (idx === 2) {
                    if (getRandomInt(2) === 1) {
                        prompt = `${strokes[i].name} gets half a ${popStroke} a hole`;
                    } else {
                        prompt = `${strokes[i].name} gets a half a hole`;
                    }
                } else if (idx === 3) {
                    if (getRandomInt(2) === 1) {
                        prompt = `${strokes[i].name} gives one ${popStroke} a hole`;
                    } else {
                        prompt = `${strokes[i].name} loses one ${popStroke} a hole`;
                    }
                } else if (idx === 4) {
                    if (getRandomInt(2) === 1) {
                        prompt = `${strokes[i].name} gets 2 ${popStroke}s a hole`;
                    } else {
                        prompt = `${strokes[i].name} gets a two a hole`;
                    }
                }
            } else {
                //Wraparound to double pops
                const index = getRandomInt(6);
                for (let j = 0; j < holes?.length; j++) {
                    if (holes[j].allocation <= index * (holes?.length === 18 ? 1 : 2)) {
                        pops.push({
                            hole: null,
                            allocation: holes[j].allocation,
                            strokes: 2
                        });
                    } else {
                        pops.push({
                            hole: null,
                            allocation: holes[j].allocation,
                            strokes: 1
                        });
                    }
                }

                const idx = getRandomInt(3);
                if (idx === 1) {
                    prompt = `${strokes[i].name} is a ${index + 18}`;
                } else if (idx === 2) {
                    prompt = `${strokes[i].name} gets ${index + 18}`;
                } else if (idx === 3) {
                    prompt = `${strokes[i].name} gets ${index + 18} ${popStroke}s`;
                }
            }

            if (prompt) {
                prompts.push(prompt);
            }

            strokes[i].pops = pops;
        }

        const delineator = getRandomInt(3);
        return {
            strokes,
            prompt: prompts?.length > 0 ? prompts.join(delineator === 1 ? ". " : delineator === 2 ? ", " : " and ") : ""
        };
    } else if (strokeType === 9) {
        //Off the low or straight index
        let prompts = [];
        let idxs = [];
        let low;
        let lowName = "";
        let offLow = getRandomInt(2) === 1;

        for (let i = 0; i < strokes?.length; i++) {
            const idx = getRandomInt(14);
            idxs.push(idx);

            if (!low || idx < low) {
                low = idx;
                lowName = strokes[i].name;
            }
        }

        for (let i = 0; i < strokes?.length; i++) {
            let pops = strokes[i].pops;
            let handicap = offLow ? idxs[i] - low : idxs[i];

            for (let j = 0; j < holes?.length; j++) {
                if (holes[j].allocation <= handicap) {
                    pops.push({
                        hole: null,
                        allocation: holes[j].allocation,
                        strokes: 1
                    });
                }
            }

            const type = getRandomInt(3);
            let prompt = ``;
            if (type === 1) {
                prompt = `${strokes[i].name} is a ${idxs[i]}`;
            } else if (type === 2) {
                prompt = `${strokes[i].name} is a ${idxs[i]} handicap`;
            } else if (type === 3) {
                prompt = `${strokes[i].name} is a ${idxs[i]} index`;
            }

            prompts.push(prompt);
            strokes[i].pops = pops;
        }

        let pString = prompts?.length > 0 ? prompts.join(delineator === 1 ? ". " : delineator === 2 ? ", " : " and ") : "";
        let type = getRandomInt(4);

        if (pString !== "" && offLow) {
            if (type === 1) {
                pString += ". Playing off the low";
            } else if (type === 2) {
                pString += `. Playing off of ${lowName}`;
            } else if (type === 3) {
                pString += ". Playing off the low handicap";
            } else {
                pString += ". Playing off the low index"
            }
        }

        const delineator = getRandomInt(3);
        return {
            strokes,
            prompt: pString
        };
    }

    return {
        strokes,
        prompt: ""
    }
}

module.exports = {
    getStrokes
}
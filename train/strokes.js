import { getRandomInt } from "./utils";
import { getHoleList } from "./utils";

export function getStrokes(names, holes) {
    const type = getRandomInt(6);
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

    if (type < 4) {
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
    } else if (type === 4) {
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

                const idx = getRandomInt(20);
                const halfPops = pops.filter(p => p.strokes === 0.5).length;
                const fullPops = pops.filter(p => p.strokes === 1).length;
                const doublePops = pops.filter(p => p.strokes === 2).length;
                const negPops = pops.filter(p => p.strokes === -1).length;

                if (negPops > 0) {
                    if (idx <= 5) {
                        prompt += `${strokes[i].name} gives one back on holes ${getHoleList(pops, -1)}`;
                    } else if (idx < 10) {
                        prompt += `${strokes[i].name} gives a ${popStroke} back on holes ${getHoleList(pops, -1)}`;
                    } else if (idx < 15) {
                        prompt += `${strokes[i].name} loses a ${popStroke} on holes ${getHoleList(pops, -1)}`;
                    } else {
                        prompt += `${strokes[i].name} loses one on holes ${getHoleList(pops, -1)}`;
                    }
                } else if (doublePops > 0) {

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
            prompt: prompts.join(delineator === 1 ? ". " : delineator === 2 ? ", " : " and ")
        };
    }

    //2. By hole
    //Giving one back
    //Half stroke
    //Regular stroke
    //3. By allocation
    //Giving one back
    //Half stroke
    //Regular stroke
    //Easiest
    //Hardest
    //4. By total handicap
    //All strokes
    //Off the low


    //Prompts
    /*
        player a gets x strokes/pops on holes x and y
        player a gets x strokes/pops on x and y handicap
        player a gets x strokes/pops
        player a gets x strokes/pops on the y hardest holes
        player a gets x strokes/pops on the y easiest holes
        player a gets strokes/pops a hole
        player a gets a half stroke/pop a hole
        gives x back
        gives x back on the y easiest holes
        gives x back on the y hardest holes
        player a is a x, player b is a y
        (no input)
    */
}
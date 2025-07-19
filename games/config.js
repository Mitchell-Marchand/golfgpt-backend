const junkConfig = `{
    chipIns: {
        valid //true or false (default false) if chip ins are worth extra money
        value //number (default 0) defining the dollar value for a chip in
        teams //true or false (default false) whether or not chip ins are for the whole team
    },
    greenies: {
        valid //true or false (default false) if "greenies" or closest to the pin or CTPs are worth extra money on par 3s
        value //number (default 0) defining the dollar value for a "greenie" or closest to the pin or CTP
        teams //true or false (default false) whether or not the "greenie" or closest to the pin or CTP is for the whole team
    },
    sandies: {
        valid //true or false (default false) if "sandies" or up and downs from the sand/bunker are worth extra money
        value //number (default 0) defining the dollar value for a "sandies" or up and down from the sand/bunker
        teams //true or false (default false) whether or not "sandies" or up and downs from the sand/bunker are for the whole team
    },
    snake: {
        valid //true or false (default false) if the user is playing a game called snake, which causes the last person to 3 putt to pay something to the rest of the group
        value //number (default 0) defining the dollar value for the pot each time someone three puts or becomes the snake
        teams //true or false (default false) whether or not the snake is for the whole team
        sharedPenalty //true or false (default false) whether the user pays each golfer the pot amount or distributes the amount amongst everyone
    },
    skins: {
        valid //true or false (default false) if the user says that skins have a monetary value
        value //number (default 0) the value of a skin
        fromPot //true or false (default true) - true if each golfer is in for a fixed amount that is then split amongst the skins, or false if each skin is just worth a certain dollar amount from each golfer
        potValue //number (default 0) the amount that each golfer puts in the pot or "buys in" for skins
        validation //true or false (default false) whether or not a skin needs to be "validated" or "proven" with a par on the next hole
        type //string of either "gross", "net", or "canadian" (default "net")
    },
    polies: {
        valid //true or false (default false) if the user says that "polies", or making a putt longer than the flagstick length, are worth extra money
        value //number (default 0) defining the dollar value for a "polie" or someone making a putt longer than the flagstick length
        teams //true or false (default false) whether or not "polies" or making a putt longer than the flagstick are for the whole team 
    },
    barkies: {
        valid //true or false (default false) if the user says that "barkies", or making par or better after hitting a tree, are worth extra money
        value //number (default 0) defining the dollar value for a "barkie" or someone making par or better after hitting a tree
        teams //true or false (default false) whether or not "barkies" or making par or better after hitting a tree are for the whole team 
    },
    arnies: {
        valid //true or false (default false) if the user says that "arnies", or making par or better without hitting the fairway OR the green in regulation, are worth extra money
        value //number (default 0) defining the dollar value for a "arnie" or someone making par or better without hitting the fairway OR the green in regulation
        teams //true or false (default false) whether or not "arnies" or making par or better without hitting the fairway OR the green in regulation are for the whole team 
    },
    oozle: {
        valid //true or false (default false) if the user says that "oozles" or "uzzels" or "zozzles" or being the first to hole out is worth extra money
        value //number (default 0) defining the dollar value for an "oozle" or "uzzel" or "zozzle" or being the first to hole out
        teams //true or false (default false) whether or not "oozles" or "uzzels" or "zozzles" or being the first to hole out is worth extra money are for the whole team 
    },
    fish: {
        valid //true or false (default false) if the user says that "fish", or hitting it in the water hazard, means that player owes money
        value //number (default 0) defining the dollar value owed by someone who makes a "fish", or hits it in the water
        teams //true or false (default false) whether or not "fish", or hitting it in the water hazard, is for the whole team 
    },
    birdieStreak: {
        valid //true or false (default false) if the user says that making a certain number of birdies in a row is worth money
        streak //number (default 3) number of birdies in a row necessary to earn money
        value //number (default 0) dollar value of making the birdie streak
        team ///true or false (default false) whether or not birdie streaks are for the team
        canOverlap //true or false (default true) whether or not birdie streaks can overlap
    },
    parStreak: {
        valid //true or false (default false) if the user says that making a certain number of pars in a row is worth money
        streak //number (default 3) number of pars in a row necessary to earn money
        value //number (default 0) dollar value of making the par streak
        team //true or false (default false) whether or not par streaks are for the team
        canOverlap //true or false (default true) whether or not par streaks can overlap
    },
    bogeyStreak: {
        valid //true or false (default false) if the user says that making a certain number of bogeys in a means a player owes money
        streak //number (default 3) number of bogeys in a row necessary to owe money
        value //number (default 0) dollar value to pay for making the bogey streak
        team ///true or false (default false) whether or not bogey streaks are for the team
        canOverlap //true or false (default true) whether or not bogey streaks can overlap
    },
    bingoBangoBongo: {
        valid //true or false (default false) if the user says they're playing bingo bango bongo
        value //number (default 1) dollar value for a bingo, bango, or bongo
        team //true or false (default false) whether or not bingo bango bongo points are for the team
    }
}`;

const scotchConfig = `{
    teams //an array consisting of the teams, always with each team as one string with player names separared by '&', e.g. ["Player A & Player B", "Player C & "Player D"]. ONLY use the exact names of the golfers provided. If no teams are provided, generate them yourself with the available names. Do NOT ever use "Me" -> only use the EXACT golfer names provided.
    pointVal //number (default is 1). dollar value of points in the match
    points //options are 4, 6, and 8 (default is 4). defines the type of scotch/bridge/umbrella game being played, e.g. 6 point scotch
    autoDoubles //true or false (default is false). whether or not the money increases automatically at any point in the match
    autoDoubleAfterNineTrigger //true or false (default is false). whether or not the money automatically increases after nine holes
    autoDoubleMoneyTrigger //number (default is 0). how much money someone has to be down for the bet to automatically increase
    autoDoubleWhileTiedTrigger //true or false (default is false). whether or not the money automatically increases while the match is tied
    autoDoubleValue //number (default is 1). the amount of money that the bet is increased to if the money automatically increases automatically at any point
    autoDoubleStays //true or false (default is false) whether or not the increase in point value stays permanently after it's automaticaly increased due to someone going down by a certain amount. words like "while" vs "when"/"once" are key here
    miracle //true or false (default is true) whether or not extra birdies double (these are also called miracles)
    presses //true or false (default is true) whether or not presses/cups/rolls/bridges/hammers are allowed
    doublePresses //true or false (default is true) whether or not double presses/bowls/rolls/bridges/hammers are allowed
    onlyGrossBirdies //true or false (default is false) whether or not only gross birdies count
}`;

const vegasConfig = `{
    teams //an array consisting of the teams, always with each team as one string with player names separared by '&', e.g. ["Player A & Player B", "Player C & "Player D"]. ONLY use the exact names of the golfers provided. If no teams are provided, generate them yourself with the available names. Do NOT ever use "Me" -> only use the EXACT golfer names provided.
    pointVal //number (default is 1). dollar value of points in the match
    autoDoubles //true or false (default is false). whether or not the money increases automatically at any point in the match
    autoDoubleAfterNineTrigger //true or false (default is false). whether or not the money automatically increases after nine holes
    autoDoubleMoneyTrigger //number (default is 0). how much money someone has to be down for the bet to automatically increase
    autoDoubleWhileTiedTrigger //true or false (default is false). whether or not the money automatically increases while the match is tied
    autoDoubleValue //number (default is 1). the amount of money that the bet is increased to if the money automatically increases automatically at any point
    autoDoubleStays //true or false (default is false) whether or not the increase in point value stays permanently after it's automaticaly increased due to someone going down by a certain amount. words like "while" vs "when"/"once" are key here
    birdiesFlip //true or false (default is true) whether or not gross birdies flip the scores of the other team
    additionalBirdiesDouble //true or false (default is true) whether or not addidional birdies double the points
    presses //true or false (default is true) whether or not presses/cups/rolls/bridges/hammers are allowed
    doublePresses //true or false (default is true) whether or not double presses/bowls/rolls/bridges/hammers are allowed
    onlyGrossBirdies //true or false (default is false) whether or not only gross birdies double or flip
}`;

const wolfConfig = `{
    holeValue //number (default 5) dollar value that everyone is in for on each hole
    birdiesDouble //true or false (default false) whether or not birdies double the points for the hole. NOTE: something like 10/20 means $20 for a win with birdie and $10 otherwise, so this would be true
    eaglesMultiply //true or false (default false) whether or not eagles multiply the points for the hole. NOTE: something like 10/20/50 means $50 for a win with eagle, $20 with birdie, and $10 otherwise, so this would be true
    eaglesFactor //number (default 5) the amount that eagles multiply by, e.g. 10/20/50 would be 5 because the base value is 10 and 50 for eagle is 5x that, while 5/10/50 would be 10 because the base value is 5 and 50 for eagle which is 10x that
    carryovers //true or false (default false) whether or not money played for on the hole carrys over to the next
    birdiesDoubleCarryovers //true or false (default false) whether or not birdies double the entire value of the carryover or just the hole
    blindWolfAllowed //true or false (default true) whether or not the wolf can go "blind" or declare they are along before teeing off
    crybaby //true or false (default true) whether or not the golfer who is down the most can change the bet after a certain hole
    crybabyHole //number (default 16) the first hole where the "crybaby", the golfer who is down the most, can change the bet
    autoDoubles //true or false (default is false). whether or not the money increases automatically at any point in the match
    autoDoubleAfterNineTrigger //true or false (default is false). whether or not the money automatically increases after nine holes
    autoDoubleMoneyTrigger //number (default is 0). how much money someone has to be down for the bet to automatically increase
    autoDoubleWhileTiedTrigger //true or false (default is false). whether or not the money automatically increases while the match is tied
    autoDoubleValue //number (default is 1). the amount of money that the bet is increased to if the money automatically increases automatically at any point
    autoDoubleStays //true or false (default is false) whether or not the increase in point value stays permanently after it's automaticaly increased due to someone going down by a certain amount. words like "while" vs "when"/"once" are key here
    onlyGrossBirdies //true or false (default is false) whether or not only gross birdies double
    combinedScore //true or false (default is false) true if the teams' scores to par are added up or false if it's best ball
}`

const lrmoConfig = `{
    holeValue //number (default 5) dollar value that everyone is in for on each hole
    birdiesDouble //true or false (default false) whether or not birdies double the points for the hole. NOTE: something like 10/20 means $20 for a win with birdie and $10 otherwise, so this would be true
    eaglesMultiply //true or false (default false) whether or not eagles multiply the points for the hole. NOTE: something like 10/20/50 means $50 for a win with eagle, $20 with birdie, and $10 otherwise, so this would be true
    eaglesFactor //number (default 5) the amount that eagles multiply by, e.g. 10/20/50 would be 5 because the base value is 10 and 50 for eagle is 5x that, while 5/10/50 would be 10 because the base value is 5 and 50 for eagle which is 10x that
    carryovers //true or false (default false) whether or not money played for on the hole carrys over to the next
    birdiesDoubleCarryovers //true or false (default false) whether or not birdies double the entire value of the carryover or just the hole
    crybaby //true or false (default false) whether or not the golfer who is down the most can change the bet after a certain hole
    crybabyHole //number (default 16) the first hole where the "crybaby", the golfer who is down the most, can change the bet
    autoDoubles //true or false (default is false). whether or not the money increases automatically at any point in the match
    autoDoubleAfterNineTrigger //true or false (default is false). whether or not the money automatically increases after nine holes
    autoDoubleMoneyTrigger //number (default is 0). how much money someone has to be down for the bet to automatically increase
    autoDoubleWhileTiedTrigger //true or false (default is false). whether or not the money automatically increases while the match is tied
    autoDoubleValue //number (default is 5). the amount of money that the bet is increased to if the money automatically increases automatically at any point
    autoDoubleStays //true or false (default is false) whether or not the increase in point value stays permanently after it's automaticaly increased due to someone going down by a certain amount. words like "while" vs "when"/"once" are key here
    onlyGrossBirdies //true or false (default is false) whether or not only gross birdies double
    soloMultiple //number (default 2) the factor the bet increases by if everyone goes solo
    combinedScore //true or false (default is false) true if the teams' scores to par are added up or false if it's best ball
    presses //true or false (default is false) whether or not presses/cups/rolls/bridges/hammers are allowed
    doublePresses //true or false (default is false) whether or not double presses/bowls/rolls/bridges/hammers are allowed
}`

const ninePointConfig = `{
    pointVal //number (default is 0) dollar value of points in the match
    extraForBirdies //number (default is 0) number of points for a birdie
    extraForEagles //number (default is 0) number of points for an eagle
    onlyGrossBirdies //true or false (default is false) whether or not only gross birdies or eagles are worth the extra points
}`

const universalConfig = `{
    teams //an array consisting of the teams, always with each team as one string with player names separared by '&', e.g. ["Player A & Player B", "Player C & "Player D"]. ONLY use the exact names of the golfers provided. If no teams are provided, generate them yourself with the available names. Do NOT ever use "Me" -> only use the EXACT golfer names provided. If no teams are provided, the every golfer is on their own team, , e.g. ["Player A", "Player B", "Player C", "Player D"].
    type //string of either "match" or "stroke" (default "match") for match or stroke play
    perHoleOrMatch //string of either "hole" or "match" (default "match") for whether or not the bet is per hole or match play
    perHoleValue //number (default 0) dollar value per hole if perHoleOrMatch is "hole"
    perMatchValue //number (default 0) dollar value per match if perHoleOrMatch is "match"
    perStrokeValue //number (default 0) dollar value per stroke that is paid for losing a hole/match
    carryovers //true or false (default false) whether or not money from tied holes or matches carrys over to the next
    birdiesDoubleCarryovers //true or false (default false) whether or not birdies double the entire value of the carryover or just the hole
    presses //true or false (default is true) whether or not presses/cups/rolls/bridges/hammers are allowed
    doublePresses //true or false (default is true) whether or not double presses/bowls/rolls/bridges/hammers are allowed
    combinedScore //true or default (default false) whether or not the scores for each team are combined net to par (true) or best ball (false)
    birdiesDouble //true or false (default false) whether or not birdies double the points for the hole. NOTE: something like 10/20 means $20 for a win with birdie and $10 otherwise, so this would be true
    eaglesMultiply //true or false (default false) whether or not eagles multiply the points for the hole. NOTE: something like 10/20/50 means $50 for a win with eagle, $20 with birdie, and $10 otherwise, so this would be true
    eaglesFactor //number (default 5) the amount that eagles multiply by, e.g. 10/20/50 would be 5 because the base value is 10 and 50 for eagle is 5x that, while 5/10/50 would be 10 because the base value is 5 and 50 for eagle which is 10x that
    autoPresses //true or false (default false) whether or not "presses", or new matches, automatically start at any point
    autoPressTrigger //number (default 2) how many holes/points a team has to down down by before another match or "press" automatically starts
    extraBirdieValue //number (default 0) dollar value for how much a birdie is worth in addition to the results of the match, i.e. "extra $10/man for birdies" would make this 10
    extraEagleValue //number (default 0) dollar value for how much an eagle is worth in addition to the results of the match, i.e. "extra $25/man for eagles" would make this 25
    extraBirdieTeam //true or false (default false) whether or not the extra birdie or eagle value is for the team
    nassau //true or false (default false) whether or not there is a nassau or match for front back overall
    sixSixSix //true or false (default false) whether or not the user has said this is a 666 match, or there are three separate 6 hole matches
    threeThreeThree //true or false (default false) whether or not the user has said this is a 33 match, or there are three separate 3 hole matches
    sixSixSixOverallValue //number (default 0) if the user is playing three 6 hole matches and there is an additional match for the overall, this is the dollar value
    threeThreeThreeOverallValue //number (default 0) if the user is playing three 3 hole matches and there is an additional match for the overall, this is the dollar value
    sweepValue //number (default 0) the amount a team gets if they sweep, or win all of the matches/points in the match
    onlyGrossBirdies //true or false (default is false) whether or not only gross birdies or eagles are worth anything extra
    teamsChangeEverySix //true or false (default is false) whether or not teams change every 6 holes
    teamsChangeEveryThree //true or false (default is false) whether or not teams change every 3 holes
}`

module.exports = {
    scotchConfig,
    junkConfig,
    vegasConfig,
    wolfConfig,
    lrmoConfig,
    ninePointConfig,
    universalConfig
}
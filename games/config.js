const scotchConfig = `{
    teams //an array consisting of the teams, always with each team as one string with player names separared by '&', e.g. ["Player A & Player B", "Player C & "Player D"]. ONLY use the exact names of the golfers provided. If no teams are provided, generate them yourself with the available names
    pointVal //number (default is 1). dollar value of points in the match
    points //options are 4, 6, and 8 (default is 4). defines the type of scotch/bridge/umbrella game being played, e.g. 6 point scotch
    autoDoubles //true or false (default is false). whether or not the money increases automatically at any point in the match
    autoDoubleAfterNineTrigger //true or false (default is false). whether or not the money automatically increases after nine holes
    autoDoubleMoneyTrigger //true or false (default is false). whether or not the money automatically increases after someone goes down by a certain amount
    autoDoubleWhileTiedTrigger //true or false (default is false). whether or not the money automatically increases while the match is tied
    autoDoubleValue //number (default is 1). the amount of money that the bet is increased to if the money automatically increases automatically at any point
    autoDoubleStays //true or false (default is false) whether or not the increase in point value stays permanently after it's automaticaly increased due to either the match being tied, or someone going down by a certain amount. words like "while" vs "when"/"once" are key here
    miracle //true or false (default is true) whether or not extra birdies double (these are also called miracles)
}`;

module.exports = {
    scotchConfig
}
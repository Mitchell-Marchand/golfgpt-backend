export function getPlayerNames(count) {
    const playerNames = [
      "Mitch", "Tommy", "Mark", "Kyle", "Steve", "Joe", "Aaron", "Kasey",
      "Myles", "Max", "Scottie", "Viktor", "Ali", "David", "Jordan"
    ];
  
    if (count > playerNames.length) {
      throw new Error(`Requested ${count} names, but only ${playerNames.length} available.`);
    }
  
    // Shuffle the array using Fisher-Yates
    const shuffled = [...playerNames].sort(() => Math.random() - 0.5);
  
    // Return the first `count` names
    return shuffled.slice(0, count);
  }
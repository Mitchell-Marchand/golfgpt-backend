// db.js
const Database = require('better-sqlite3');
const db = new Database('users.db');

db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE
  )
`).run();

module.exports = db;


const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { countTokensForMessages } = require('./utils');

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const mariadbPool = mysql.createPool({
  host: "ec2-18-232-136-96.compute-1.amazonaws.com",
  user: "golfuser",
  password: process.env.DB_PASS,
  database: "golfpicks",
  waitForConnections: true,
  connectionLimit: 10,
});

const OUTPUT_TRAIN_FILE = path.join(__dirname, "finetunes/finetune-data.jsonl");
const OUTPUT_VALIDATION_FILE = path.join(__dirname, "finetunes/finetune-validation.jsonl");

function shuffleArray(array) {
  return array
    .map((val) => ({ val, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ val }) => val);
}

async function main() {
  const [rows] = await mariadbPool.query(`
    SELECT threadId, scoreId, role, content, createdAt, serial, type
    FROM Messages
    WHERE training = 1
    ORDER BY type, scoreId, threadId, createdAt, serial
  `);

  const conversations = new Map();

  for (const row of rows) {
    let key;
    if (row.type === "score") {
      key = `score__${row.scoreId}`;
    } else {
      key = `setup__${row.threadId}`;
    }

    if (!conversations.has(key)) {
      conversations.set(key, []);
    }

    conversations.get(key).push({
      role: row.role,
      content: row.content,
      type: row.type,
    });
  }

  // Separate into score and setup buckets
  const scoreConvos = [];
  const setupConvos = [];

  for (const [key, messages] of conversations.entries()) {
    const validMessages = messages.filter(m => m.role === "user" || m.role === "assistant");
    if (validMessages.length >= 2 && validMessages[0].role === "user") {
      const type = messages[0].type;
      const simplifiedMessages = validMessages.map(({ role, content }) => ({ role, content }));
      if (type === "score") scoreConvos.push({ key, messages: simplifiedMessages });
      else if (type === "setup") setupConvos.push({ key, messages: simplifiedMessages });
    }
  }

  // Select validation samples
  const validationScore = shuffleArray(scoreConvos).slice(0, 30);
  const validationSetup = shuffleArray(setupConvos).slice(0, 5);
  const validationKeys = new Set([...validationScore, ...validationSetup].map(c => c.key));

  const outputTrain = fs.createWriteStream(OUTPUT_TRAIN_FILE, { flags: "w" });
  const outputVal = fs.createWriteStream(OUTPUT_VALIDATION_FILE, { flags: "w" });

  // Write to files
  for (const { key, messages } of [...scoreConvos, ...setupConvos]) {
    const out = validationKeys.has(key) ? outputVal : outputTrain;
    console.log(`[${validationKeys.has(key) ? "VALID" : "TRAIN"}] ${key}: Tokens =`, countTokensForMessages(messages));
    out.write(JSON.stringify({ messages }) + "\n");
  }

  outputTrain.end();
  outputVal.end();
  await mariadbPool.end();
  console.log(`✅ Training JSONL: ${OUTPUT_TRAIN_FILE}`);
  console.log(`✅ Validation JSONL: ${OUTPUT_VALIDATION_FILE}`);
}

main().catch(console.error);
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

  const setupConvos = [];
  const scoreConvos = [];

  const grouped = new Map();

  for (const row of rows) {
    const key = row.type === "score" ? `score__${row.scoreId}` : `setup__${row.threadId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({
      role: row.role,
      content: row.content,
      type: row.type,
    });
  }

  for (const [key, messages] of grouped.entries()) {
    const simplified = messages
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(({ role, content }) => ({ role, content }));

    if (simplified.length >= 2) {
      if (key.startsWith("score__")) {
        scoreConvos.push({ key, messages: simplified });
      } else if (key.startsWith("setup__")) {
        setupConvos.push({ key, messages: simplified });
      }
    }
  }

  const validationScore = shuffleArray(scoreConvos).slice(0, Math.round(scoreConvos.length / 10));
  const validationSetup = shuffleArray(setupConvos).slice(0, Math.round(setupConvos.length / 20));
  const validationKeys = new Set([...validationScore, ...validationSetup].map(c => c.key));

  const outputTrain = fs.createWriteStream(OUTPUT_TRAIN_FILE, { flags: "w" });
  const outputVal = fs.createWriteStream(OUTPUT_VALIDATION_FILE, { flags: "w" });

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
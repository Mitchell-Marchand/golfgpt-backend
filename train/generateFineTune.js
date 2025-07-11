const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { countTokensForMessages, scoringSystemMessage, setupSystemMessage } = require('./utils');

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const mariadbPool = mysql.createPool({
  host: "ec2-18-232-136-96.compute-1.amazonaws.com",
  user: "golfuser",
  password: process.env.DB_PASS,
  database: "golfpicks",
  waitForConnections: true,
  connectionLimit: 10,
});

function shuffleArray(array) {
  return array
    .map((val) => ({ val, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ val }) => val);
}

async function main() {
  const [messages] = await mariadbPool.query(`
    SELECT 
      m.id,
      m.threadId,
      m.scoreId,
      m.role,
      m.createdAt,
      m.serial,
      m.type
    FROM Messages m
    WHERE m.training = 1
    ORDER BY m.type, m.scoreId, m.threadId, m.createdAt, m.serial
  `);

  // Step 2: Fetch content only for relevant messageIds
  const messageIds = messages.map(m => m.id);

  let contents = [];
  if (messageIds.length > 0) {
    [contents] = await mariadbPool.query(
      `SELECT messageId, content FROM MessageContents WHERE messageId IN (?)`,
      [messageIds]
    );
  }

  // Step 3: Merge content into messages
  const contentMap = new Map(contents.map(c => [c.messageId, c.content]));
  for (let m of messages) {
    m.content = contentMap.get(m.id) || null;
  }

  const setupConvos = [];
  const scoreConvos = [];

  const grouped = new Map();

  for (const row of messages) {
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
      if (key.startsWith("score__") && scoreConvos.length < 1000) {
        scoreConvos.push({ key, messages: simplified });
      } else if (key.startsWith("setup__") && setupConvos.length < 1000) {
        setupConvos.push({ key, messages: simplified });
      }
    }
  }

  const numValidationScore = Math.floor(scoreConvos.length * 0.10);
  const numValidationSetup = Math.floor(setupConvos.length * 0.10);

  const validationScore = shuffleArray(scoreConvos).slice(0, numValidationScore);
  const validationSetup = shuffleArray(setupConvos).slice(0, numValidationSetup);
  const validationKeys = new Set([...validationScore, ...validationSetup].map(c => c.key));

  // Output paths
  const OUTPUT_DIR = path.join(__dirname, "finetunes");
  const files = {
    scoreTrain: fs.createWriteStream(path.join(OUTPUT_DIR, "finetune-data-score.jsonl"), { flags: "w" }),
    scoreVal: fs.createWriteStream(path.join(OUTPUT_DIR, "finetune-validation-score.jsonl"), { flags: "w" }),
    setupTrain: fs.createWriteStream(path.join(OUTPUT_DIR, "finetune-data-setup.jsonl"), { flags: "w" }),
    setupVal: fs.createWriteStream(path.join(OUTPUT_DIR, "finetune-validation-setup.jsonl"), { flags: "w" }),
  };

  for (const { key, messages } of scoreConvos) {
    const out = validationKeys.has(key) ? files.scoreVal : files.scoreTrain;
  
    // Inject scoring system message at the beginning
    const updatedMessages = [{ role: "system", content: scoringSystemMessage }, ...messages];
  
    console.log(`[SCORE ${validationKeys.has(key) ? "VALID" : "TRAIN"}] ${key}: Tokens =`, countTokensForMessages(updatedMessages));
    out.write(JSON.stringify({ messages: updatedMessages }) + "\n");
  }

  for (const { key, messages } of setupConvos) {
    const out = validationKeys.has(key) ? files.setupVal : files.setupTrain;

    // Inject scoring system message at the beginning
    const updatedMessages = [{ role: "system", content: setupSystemMessage }, ...messages];

    console.log(`[SCORE ${validationKeys.has(key) ? "VALID" : "TRAIN"}] ${key}: Tokens =`, countTokensForMessages(updatedMessages));
    out.write(JSON.stringify({ messages: updatedMessages }) + "\n");
  }

  // Close all file streams
  Object.values(files).forEach(stream => stream.end());
  await mariadbPool.end();

  console.log("✅ All four JSONL files written:");
  console.log("  • finetune-data-score.jsonl");
  console.log("  • finetune-validation-score.jsonl");
  console.log("  • finetune-data-setup.jsonl");
  console.log("  • finetune-validation-setup.jsonl");
}

main().catch(console.error);
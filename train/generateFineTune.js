const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const mariadbPool = mysql.createPool({
  host: "ec2-18-232-136-96.compute-1.amazonaws.com",
  user: "golfuser",
  password: process.env.DB_PASS,
  database: "golfpicks",
  waitForConnections: true,
  connectionLimit: 10,
});

const OUTPUT_FILE = path.join(__dirname, "finetune.jsonl");

async function main() {
  const [rows] = await mariadbPool.query(`
    SELECT threadId, role, content, createdAt, serial, type
    FROM Messages
    ORDER BY threadId, type, createdAt, serial
  `);

  const conversations = new Map();

  for (const row of rows) {
    const key = `${row.threadId}__${row.type}`;
    if (!conversations.has(key)) {
      conversations.set(key, []);
    }
    conversations.get(key).push({
      role: row.role,
      content: row.content,
    });
  }

  const output = fs.createWriteStream(OUTPUT_FILE, { flags: "w" });

  for (const [key, messages] of conversations.entries()) {
    const validMessages = messages.filter(
      (m) => m.role === "user" || m.role === "assistant"
    );

    if (validMessages.length >= 2 && validMessages[0].role === "user") {
      output.write(
        JSON.stringify({
          messages: validMessages,
          metadata: { type: key.split("__")[1] },
        }) + "\n"
      );
    }
  }

  output.end();
  await mariadbPool.end();
  console.log(`✅ JSONL file generated at ${OUTPUT_FILE}`);
}

main().catch(console.error);
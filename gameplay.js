const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const authenticateUser = require('./authMiddleware')
require('dotenv').config();
const OpenAI = require("openai")

// You'll want to set this securely in an .env file
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const router = express.Router();

const mariadbPool = mysql.createPool({
    host: 'ec2-54-205-4-218.compute-1.amazonaws.com',
    user: 'golfuser',
    password: process.env.DB_PASS,
    database: 'golfpicks',
    waitForConnections: true,
    connectionLimit: 10,
});

router.post("/start", authenticateUser, async (req, res) => {
    const { matchData, rules } = req.body

    const createdBy = req.user
    matchData.createdBy = createdBy

    const courseId = matchData?.course?.CourseID
    const courseName = matchData?.course?.FullName
    const scorecards = JSON.stringify(matchData?.scorecards)

    // Insert course if not in DB
    const [existing] = await mariadbPool.query(
        "SELECT * FROM Courses WHERE courseId = ?",
        [courseId]
    )

    if (existing.length === 0) {
        await mariadbPool.query(
            `INSERT INTO Courses (courseId, courseName, scorecards) VALUES (?, ?, ?)`,
            [courseId, courseName, scorecards]
        )
    }

    // Create GPT thread
    const thread = await openai.beta.threads.create()

    const fullPrompt = `
  You are a golf scoring assistant.
  
  Here is the match data as JSON:
  ${JSON.stringify(matchData, null, 2)}
  
  Here is the user's description of the game rules:
  "${rules}"
  
  You will help calculate results for each golfer on every hole.
  
  First, please respond ONLY with a JSON object using this format:
  {
    "gameName": string,
    "confirmation": string
  }
  
  Do not include any explanation outside the JSON.
    `

    await openai.beta.threads.messages.create(thread.id, {
        role: "user",
        content: fullPrompt,
    })

    // Run GPT assistant
    const run = await openai.beta.threads.runs.create(thread.id, {
        assistant_id: process.env.ASSISTANT_ID, // ⬅️ you set this in your OpenAI dashboard
    })

    // Poll for completion
    let result
    while (true) {
        result = await openai.beta.threads.runs.retrieve(thread.id, run.id)
        if (result.status === "completed") break
        await new Promise((r) => setTimeout(r, 1000))
    }

    const messages = await openai.beta.threads.messages.list(thread.id)
    const last = messages.data.find((m) => m.role === "assistant")
    const content = last?.content?.[0]?.text?.value || "{}"

    let gameName = "Untitled Match"
    let confirmation = ""
    try {
        const parsed = JSON.parse(content)
        gameName = parsed.gameName || gameName
        confirmation = parsed.confirmation || ""
    } catch (err) {
        console.error("Failed to parse GPT response:", content)
    }

    // Save match to DB
    const matchId = uuidv4();
    await mariadbPool.query(
        `INSERT INTO Matches 
       (id, threadId, createdBy, golfers, courseId, isPublic, displayName, teeTime, results) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            matchId,
            thread.id,
            matchData.createdBy,
            JSON.stringify(matchData.selectedTees),
            courseId,
            matchData.isPublic ?? true,
            gameName,
            matchData.teeTime,
            null,
        ]
    )

    res.json({ threadId: thread.id, gameName, confirmation, matchId })
})

module.exports = router;
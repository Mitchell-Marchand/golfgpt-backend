const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const authenticateUser = require('./authMiddleware');
require('dotenv').config();
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const router = express.Router();

const mariadbPool = mysql.createPool({
    host: 'ec2-18-232-136-96.compute-1.amazonaws.com',
    user: 'golfuser',
    password: process.env.DB_PASS,
    database: 'golfpicks',
    waitForConnections: true,
    connectionLimit: 10,
});

router.post("/begin", authenticateUser, async (req, res) => {
    const { golfers, course } = req.body;
    const userId = req.user.id;

    if (!golfers || !Array.isArray(golfers) || !course || !course.CourseID) {
        return res.status(400).json({ error: "Missing or invalid golfers or course." });
    }

    try {
        // Ensure course exists
        const [existing] = await mariadbPool.query("SELECT courseId FROM Courses WHERE courseId = ?", [course.CourseID]);
        if (existing.length === 0) {
            await mariadbPool.query(
                "INSERT INTO Courses (courseId, courseName, scorecards) VALUES (?, ?, ?)",
                [course.CourseID, course.FullName, JSON.stringify([])]
            );
        }

        // Start OpenAI thread
        const thread = await openai.beta.threads.create();

        // Send intro message
        const intro = `I'm playing a golf match today. Here are the golfers and course details. More to come.\n\nGolfers:\n${JSON.stringify(golfers, null, 2)}\n\nCourse:\n${JSON.stringify(course, null, 2)}`;
        await openai.beta.threads.messages.create(thread.id, {
            role: "user",
            content: intro,
        });

        // Insert match record
        const matchId = uuidv4();
        await mariadbPool.query(
            `INSERT INTO Matches (id, threadId, createdBy, golfers, courseId) VALUES (?, ?, ?, ?, ?)`,
            [
                matchId,
                thread.id,
                userId,
                JSON.stringify(golfers),
                course.CourseID
            ]
        );

        res.json({ success: true, matchId, threadId: thread.id });
    } catch (err) {
        console.error("Error in /begin:", err);
        res.status(500).json({ error: "Failed to initialize match." });
    }
});

router.post("/tees", authenticateUser, async (req, res) => {
    const { matchId, scorecards, teesByGolfer } = req.body;

    if (!matchId || !scorecards || !teesByGolfer) {
        return res.status(400).json({ error: "Missing required data." });
    }

    try {
        // Look up threadId for match
        const [rows] = await mariadbPool.query("SELECT threadId, courseId FROM Matches WHERE id = ?", [matchId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Match not found." });
        } else {
            const courseId = rows[0].courseId;
            await mariadbPool.query("UPDATE Courses set scorecards = ? WHERE courseId = ?", [JSON.stringify(scorecards), courseId]);
        }

        const threadId = rows[0].threadId;

        // Compose message content
        const message = `Here is the full scorecard for the course, and which tees each golfer is playing:\n\nScorecard:\n${JSON.stringify(scorecards, null, 2)}\n\nTees per golfer:\n${JSON.stringify(teesByGolfer, null, 2)}`;

        // Send to OpenAI thread
        await openai.beta.threads.messages.create(threadId, {
            role: "user",
            content: message,
        });

        res.json({ success: true });
    } catch (err) {
        console.error("Error in /tees:", err);
        res.status(500).json({ error: "Failed to send tee info to thread." });
    }
});

router.post("/create", authenticateUser, async (req, res) => {
    const { matchId, teeTime, isPublic, rules } = req.body;
  
    if (!matchId || !teeTime || typeof isPublic === 'undefined' || !rules) {
      return res.status(400).json({ error: "Missing required data." });
    }
  
    try {
      // Get threadId
      const [rows] = await mariadbPool.query("SELECT threadId FROM Matches WHERE id = ?", [matchId]);
      if (rows.length === 0) {
        return res.status(404).json({ error: "Match not found." });
      }
  
      const threadId = rows[0].threadId;

      // Update match with teeTime and isPublic
      await mariadbPool.query(
        "UPDATE Matches SET teeTime = ?, isPublic = ? WHERE id = ?",
        [teeTime, isPublic ? 1 : 0, matchId]
      );
  
      // Send rules message to thread
      const rulesMessage = `Here is a description of the golf game we're playing:\n\n${rules}\n\nPlease reply with a JSON array of any questions you need to ask before you can begin scoring this match. If you have no questions, reply with an empty array.`;
  
      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: rulesMessage,
      });
  
      // Run the assistant
      const run = await openai.beta.threads.runs.create(threadId, {
        assistant_id: process.env.OPENAI_ASSISTANT_ID,
      });
  
      // Poll for completion
      let completed = false;
      let result;
      const maxAttempts = 10;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const status = await openai.beta.threads.runs.retrieve(threadId, run.id);
        if (status.status === "completed") {
          completed = true;
          break;
        } else if (status.status === "failed" || status.status === "cancelled" || status.status === "expired") {
          throw new Error(`Run failed with status: ${status.status}`);
        }
      }
  
      if (!completed) {
        return res.status(500).json({ error: "Assistant took too long to respond." });
      }
  
      // Get last assistant message
      const messages = await openai.beta.threads.messages.list(threadId, { limit: 1 });
      const assistantMessage = messages.data.find(m => m.role === "assistant");
  
      let questions = [];
      if (assistantMessage?.content?.[0]?.type === "text") {
        const raw = assistantMessage.content[0].text.value;
        try {
          questions = JSON.parse(raw);
        } catch (e) {
          console.warn("Assistant reply was not valid JSON:", raw);
        }
      }
  
      res.json({ success: true, questions });
  
    } catch (err) {
      console.error("Error in /create:", err);
      res.status(500).json({ error: "Failed to finalize match setup." });
    }
  });

module.exports = router;
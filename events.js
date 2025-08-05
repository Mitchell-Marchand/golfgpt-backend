const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const mariadbPool = mysql.createPool({
    host: 'ec2-18-232-136-96.compute-1.amazonaws.com',
    user: 'golfuser',
    password: process.env.DB_PASS,
    database: 'golfpicks',
    waitForConnections: true,
    connectionLimit: 10,
});

router.post('/track', async (req, res) => {
    const {
        eventName,
        userId = null,
        anonymousId,
        screenName = null,
        properties = {},
    } = req.body;

    // Basic validation
    if (!eventName || (!userId && !anonymousId)) {
        return res.status(400).json({ error: 'Missing required fields: eventName and user/anonymousId' });
    }

    try {
        await mariadbPool.query(
            `
      INSERT INTO Events (id, eventName, userId, anonymousId, screenName, properties)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
            [
                uuidv4(),
                eventName,
                userId,
                anonymousId,
                screenName,
                JSON.stringify(properties),
            ]
        );

        console.log("Event tracked", eventName, screenName, properties);

        return res.status(201).json({ success: true });
    } catch (err) {
        console.error('Error inserting event:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;

const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const twilio = require('twilio');
const axios = require('axios');
const authenticateUser = require('./authMiddleware');
require('dotenv').config();

const router = express.Router();

const mariadbPool = mysql.createPool({
    host: 'ec2-18-232-136-96.compute-1.amazonaws.com',
    user: 'golfuser',
    password: process.env.DB_PASS,
    database: 'golfpicks',
    waitForConnections: true,
    connectionLimit: 10,
});

router.get('/matches/feed', authenticateUser, async (req, res) => {
    const userId = req.user.id;

    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;

    try {
        // Step 1: Get followed user IDs (include self)
        const [followsRows] = await mariadbPool.query(
            `SELECT followedId FROM Follows WHERE followerId = ? AND status = 'accepted'`,
            [userId]
        );

        const followedIds = followsRows.map(row => row.followedId);
        followedIds.push(userId); // include self
        if (followedIds.length === 0) {
            return res.json({ page, pageSize, total: 0, totalPages: 0, matches: [] });
        }

        const placeholders = followedIds.map(() => '?').join(',');

        // Step 2: Get paginated matches
        const [matches] = await mariadbPool.query(
            `
        SELECT DISTINCT m.*
        FROM Matches m
        LEFT JOIN MatchPlayers mp ON mp.matchId = m.id
        WHERE m.createdBy IN (${placeholders})
           OR mp.userId IN (${placeholders})
        ORDER BY m.updatedAt DESC
        LIMIT ? OFFSET ?
        `,
            [...followedIds, ...followedIds, pageSize, offset]
        );

        // Step 3: Get total count for pagination
        const [countRows] = await mariadbPool.query(
            `
        SELECT COUNT(DISTINCT m.id) AS total
        FROM Matches m
        LEFT JOIN MatchPlayers mp ON mp.matchId = m.id
        WHERE m.createdBy IN (${placeholders})
           OR mp.userId IN (${placeholders})
        `,
            [...followedIds, ...followedIds]
        );

        const total = countRows[0].total || 0;

        res.json({
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
            matches,
        });
    } catch (err) {
        console.error('Error fetching matches feed:', err);
        res.status(500).json({ error: 'Failed to fetch matches' });
    }
});

module.exports = router;
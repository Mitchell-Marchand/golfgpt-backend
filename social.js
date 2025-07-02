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

        res.json({
            page,
            pageSize,
            matches,
        });
    } catch (err) {
        console.error('Error fetching matches feed:', err);
        res.status(500).json({ error: 'Failed to fetch matches' });
    }
});

router.post('/follow/request', authenticateUser, async (req, res) => {
    const followerId = req.user.id;
    const { userId: followedId } = req.body;

    if (!followedId || followedId === followerId) {
        return res.status(400).json({ error: 'Invalid target user ID.' });
    }

    try {
        const [rows] = await mariadbPool.query('SELECT isPublic FROM Users WHERE id = ?', [followedId]);
        if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });

        const { isPublic, expoPushToken } = rows[0];
        const status = isPublic ? 'accepted' : 'pending';

        await mariadbPool.query(
            `INSERT INTO Follows (followerId, followedId, status)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status)`,
            [followerId, followedId, status]
        );

        if (expoPushToken) {
            const [[follower]] = await mariadbPool.query(
                `SELECT firstName, lastName FROM Users WHERE id = ?`,
                [followerId]
            );

            const body = {
                to: expoPushToken,
                sound: 'default',
                title: 'New Follow Request',
                body: `${follower.firstName} ${follower.lastName} ${status === 'pending' ? "wants to follow you." : "started following you."}`,
            };

            await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        }

        res.json({ success: true, status });
    } catch (err) {
        console.error('Error submitting follow request:', err);
        res.status(500).json({ error: 'Failed to submit follow request.' });
    }
});

router.post('/follow/accept', authenticateUser, async (req, res) => {
    const followedId = req.user.id;
    const { userId: followerId } = req.body;

    if (!followerId) {
        return res.status(400).json({ error: 'Missing follower user ID.' });
    }

    try {
        const [result] = await mariadbPool.query(
            `UPDATE Follows SET status = 'accepted'
         WHERE followerId = ? AND followedId = ? AND status = 'pending'`,
            [followerId, followedId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'No pending follow request found.' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error accepting follow request:', err);
        res.status(500).json({ error: 'Failed to accept follow request.' });
    }
});

router.post('/follow/unfollow', authenticateUser, async (req, res) => {
    const followerId = req.user.id;
    const { userId: followedId } = req.body;

    if (!followedId) {
        return res.status(400).json({ error: 'Missing followed user ID.' });
    }

    try {
        await mariadbPool.query(
            `DELETE FROM Follows WHERE followerId = ? AND followedId = ?`,
            [followerId, followedId]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Error unfollowing user:', err);
        res.status(500).json({ error: 'Failed to unfollow user.' });
    }
});

router.post('/follow/unblock', authenticateUser, async (req, res) => {
    const followedId = req.user.id;
    const { followerId } = req.body;

    console.log("Follower, Followed", followerId, followedId)

    if (!followerId) {
        return res.status(400).json({ error: 'Missing follower user ID.' });
    }

    try {
        const [result] = await mariadbPool.query(
            `DELETE FROM Follows
         WHERE followerId = ? AND followedId = ? AND status = 'rejected'`,
            [followerId, followedId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'No blocked relationship found.' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error unblocking user:', err);
        res.status(500).json({ error: 'Failed to unblock user.' });
    }
});

router.post('/follow/block', authenticateUser, async (req, res) => {
    const followedId = req.user.id;
    const { userId: followerId } = req.body;

    if (!followerId) {
        return res.status(400).json({ error: 'Missing follower user ID.' });
    }

    try {
        await mariadbPool.query(
            `INSERT INTO Follows (followerId, followedId, status)
         VALUES (?, ?, 'rejected')
         ON DUPLICATE KEY UPDATE status = 'rejected'`,
            [followerId, followedId]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Error blocking user:', err);
        res.status(500).json({ error: 'Failed to block user.' });
    }
});

router.get('/follow/counts/:userId', authenticateUser, async (req, res) => {
    const { userId } = req.params;

    try {
        const [[{ followers }]] = await mariadbPool.query(
            `SELECT COUNT(*) AS followers
         FROM Follows
         WHERE followedId = ? AND status = 'accepted'`,
            [userId]
        );

        const [[{ requests }]] = await mariadbPool.query(
            `SELECT COUNT(*) AS requests
         FROM Follows
         WHERE followedId = ? AND status = 'pending'`,
            [userId]
        );

        const [[{ following }]] = await mariadbPool.query(
            `SELECT COUNT(*) AS following
         FROM Follows
         WHERE followerId = ? AND status = 'accepted'`,
            [userId]
        );

        const [[{ matches }]] = await mariadbPool.query(
            `SELECT COUNT(*) AS matches
         FROM Matches
         WHERE (
                createdBy = ?
                OR JSON_CONTAINS(golferIds, JSON_QUOTE(?))
            )`,
            [userId, userId]
        );

        res.json({ followers, following, matches, requests });
    } catch (err) {
        console.error('Error fetching follow counts:', err);
        res.status(500).json({ error: 'Failed to fetch follow counts.' });
    }
});

router.get('/follow/followers/:userId', authenticateUser, async (req, res) => {
    const { userId } = req.params;

    try {
        const [rows] = await mariadbPool.query(
            `SELECT u.id, u.firstName, u.lastName, u.homeClub, u.isPublic
         FROM Follows f
         JOIN Users u ON u.id = f.followerId
         WHERE f.followedId = ? AND f.status = 'accepted'`,
            [userId]
        );

        const [requests] = await mariadbPool.query(
            `SELECT u.id, u.firstName, u.lastName, u.homeClub, u.isPublic
         FROM Follows f
         JOIN Users u ON u.id = f.followerId
         WHERE f.followedId = ? AND f.status = 'pending'`,
            [userId]
        );

        res.json({ success: true, users: rows, requests });
    } catch (err) {
        console.error('Error fetching followers:', err);
        res.status(500).json({ error: 'Failed to fetch followers.' });
    }
});

router.get('/follow/following/:userId', authenticateUser, async (req, res) => {
    const { userId } = req.params;

    try {
        const [rows] = await mariadbPool.query(
            `SELECT u.id, u.firstName, u.lastName, u.homeClub, u.isPublic
         FROM Follows f
         JOIN Users u ON u.id = f.followedId
         WHERE f.followerId = ? AND f.status = 'accepted'`,
            [userId]
        );

        res.json({ success: true, users: rows });
    } catch (err) {
        console.error('Error fetching following:', err);
        res.status(500).json({ error: 'Failed to fetch following.' });
    }
});

router.get('/follow/requests/:userId', authenticateUser, async (req, res) => {
    const { userId } = req.params;

    try {
        const [rows] = await mariadbPool.query(
            `SELECT u.id, u.firstName, u.lastName, u.homeClub, u.isPublic
         FROM Follows f
         JOIN Users u ON u.id = f.followedId
         WHERE f.followerId = ? AND f.status = 'pending'`,
            [userId]
        );

        res.json({ success: true, users: rows });
    } catch (err) {
        console.error('Error fetching following:', err);
        res.status(500).json({ error: 'Failed to fetch following.' });
    }
});

router.get('/follow/blocked', authenticateUser, async (req, res) => {
    const followedId = req.user.id;

    try {
        const [rows] = await mariadbPool.query(
            `
        SELECT u.id, u.firstName, u.lastName, u.homeClub, u.isPublic
        FROM Follows f
        JOIN Users u ON u.id = f.followerId
        WHERE f.followedId = ? AND f.status = 'rejected'
        `,
            [followedId]
        );

        res.json({ success: true, users: rows });
    } catch (err) {
        console.error('Error fetching blocked users:', err);
        res.status(500).json({ error: 'Failed to fetch blocked users.' });
    }
});

router.get('/match/:matchId/messages', authenticateUser, async (req, res) => {
    const userId = req.user.id;
    const matchId = req.params.matchId;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    try {
        const [rows] = await mariadbPool.query(
            `
            SELECT
                m.id,
                m.message,
                m.userId,
                m.createdAt,
                m.handshakes,
                m.replyToId,
                r.id AS replyId,
                r.message AS replyMessage,
                r.userId AS replyUserId
            FROM MatchMessages m
            LEFT JOIN MatchMessages r ON m.replyToId = r.id
            WHERE m.matchId = ?
            ORDER BY m.createdAt ASC
            LIMIT ? OFFSET ?
            `,
            [matchId, limit, offset]
        );

        const messages = rows.map(row => ({
            id: row.id,
            message: row.message,
            userId: row.userId,
            isCurrentUser: row.userId === userId,
            handshakes: JSON.parse(row.handshakes || '[]'),
            createdAt: row.createdAt,
            replyTo: row.replyId
                ? {
                    id: row.replyId,
                    message: row.replyMessage,
                    userId: row.replyUserId,
                }
                : null,
        }));

        res.json({
            page,
            limit,
            messages,
        });
    } catch (err) {
        console.error('Error fetching match messages:', err);
        res.status(500).json({ error: 'Failed to fetch match messages.' });
    }
});

router.post('/match/:matchId/messages', authenticateUser, async (req, res) => {
    const matchId = req.params.matchId;
    const userId = req.user.id;
    const { message, replyToId } = req.body;

    if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Message is required and must be a string.' });
    }

    const id = require('uuid').v4();
    const createdAt = new Date();

    try {
        await mariadbPool.query(
            `
            INSERT INTO MatchMessages (id, matchId, userId, message, replyToId, handshakes, createdAt)
            VALUES (?, ?, ?, ?, ?, JSON_ARRAY(), ?)
            `,
            [id, matchId, userId, message, replyToId || null, createdAt]
        );

        // Optional: also return the parent message preview if this is a reply
        let replyTo = null;
        if (replyToId) {
            const [replyRows] = await mariadbPool.query(
                `SELECT id, message, userId FROM MatchMessages WHERE id = ? LIMIT 1`,
                [replyToId]
            );
            if (replyRows.length > 0) {
                replyTo = {
                    id: replyRows[0].id,
                    message: replyRows[0].message,
                    userId: replyRows[0].userId,
                };
            }
        }

        res.status(201).json({
            id,
            matchId,
            userId,
            message,
            replyTo,
            handshakes: [],
            createdAt,
            isCurrentUser: true
        });
    } catch (err) {
        console.error('Error saving match message:', err);
        res.status(500).json({ error: 'Failed to save message.' });
    }
});

router.post('/match/:matchId/messages/:messageId/handshake', authenticateUser, async (req, res) => {
    const userId = req.user.id;
    const { matchId, messageId } = req.params;

    try {
        // Get current handshakes
        const [rows] = await mariadbPool.query(
            `SELECT handshakes FROM MatchMessages WHERE id = ? AND matchId = ?`,
            [messageId, matchId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Message not found.' });
        }

        let handshakes = JSON.parse(rows[0].handshakes || '[]');
        if (handshakes.includes(userId)) {
            return res.status(400).json({ error: 'You’ve already handshook this message.' });
        }

        handshakes.push(userId);

        await mariadbPool.query(
            `UPDATE MatchMessages SET handshakes = ? WHERE id = ?`,
            [JSON.stringify(handshakes), messageId]
        );

        res.status(200).json({ success: true, handshakes });
    } catch (err) {
        console.error('Error applying handshake:', err);
        res.status(500).json({ error: 'Failed to apply handshake.' });
    }
});

module.exports = router;
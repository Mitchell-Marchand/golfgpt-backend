// golfgpt.js
const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const router = express.Router();

const mariadbPool = mysql.createPool({
  host: 'ec2-54-205-4-218.compute-1.amazonaws.com',
  user: 'golfuser',
  password: 'GolfGPTPass1234++!',
  database: 'golfpicks',
  waitForConnections: true,
  connectionLimit: 10,
});

function formatAndValidatePhone(input) {
  if (!input) return null;
  const digits = input.replace(/\D/g, '');
  const normalized = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return /^\d{10}$/.test(normalized) ? normalized : null;
}

router.post('/api/register', async (req, res) => {
  const { phone, firstName, lastName } = req.body;
  const formattedPhone = formatAndValidatePhone(phone);
  if (!formattedPhone || !firstName || !lastName) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    const [existing] = await mariadbPool.query('SELECT * FROM Users WHERE phone = ?', [formattedPhone]);
    if (existing.length) {
      return res.status(409).json({ success: false, message: 'User already exists' });
    }

    const id = uuidv4();
    const accessToken = jwt.sign({ id, phone: formattedPhone }, process.env.JWT_SECRET || 'insecure-dev-secret', { expiresIn: '30d' });

    await mariadbPool.query(
      `INSERT INTO Users (id, phone, firstName, lastName, accessToken) VALUES (?, ?, ?, ?, ?)`,
      [id, formattedPhone, firstName, lastName, accessToken]
    );

    const [newUser] = await mariadbPool.query('SELECT * FROM Users WHERE id = ?', [id]);
    res.status(201).json({ success: true, user: newUser[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
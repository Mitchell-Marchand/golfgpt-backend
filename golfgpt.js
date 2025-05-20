const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const router = express.Router();

const mariadbPool = mysql.createPool({
  host: 'ec2-54-205-4-218.compute-1.amazonaws.com',
  user: 'golfuser',
  password: process.env.DB_PASS,
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

router.get('/gpt/getCode', async (req, res) => {
  const { phone } = req.body;
  const formattedPhone = formatAndValidatePhone(phone);
  if (!formattedPhone) {
    return res.status(400).json({ success: false, message: 'Phone number invalid' });
  }

  try {
    const verification = await client.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verifications.create({ to: `+1${formattedPhone}`, channel: 'sms' });

    res.status(200).json({ success: true, status: verification.status });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.post('/gpt/signIn', async (req, res) => {
  const { phone, code } = req.body;
  const formattedPhone = formatAndValidatePhone(phone);
  if (!formattedPhone || !code) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    const [existing] = await mariadbPool.query('SELECT * FROM Users WHERE phone = ?', [formattedPhone]);
    if (!existing.length) {
      return res.status(409).json({ success: false, message: 'User does not exist' });
    }

    const verificationCheck = await client.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verificationChecks.create({ to: `+1${formattedPhone}`, code });

    if (verificationCheck.status === 'approved') {
      const [users] = await mariadbPool.query('SELECT * FROM Users WHERE phone = ?', [formattedPhone]);
      res.status(201).json({ success: true, user: users[0] });
    } else {
      res.status(200).json({ success: false, message: 'Invalid code' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
})

router.post('/gpt/register', async (req, res) => {
  const { phone, firstName, lastName, code } = req.body;
  const formattedPhone = formatAndValidatePhone(phone);
  if (!formattedPhone || !firstName || !lastName) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    const [existing] = await mariadbPool.query('SELECT * FROM Users WHERE phone = ?', [formattedPhone]);
    if (existing.length) {
      return res.status(409).json({ success: false, message: 'User already exists' });
    }

    const verificationCheck = await client.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verificationChecks.create({ to: `+1${formattedPhone}`, code });

    if (verificationCheck.status === 'approved') {
      const id = uuidv4();
      const accessToken = jwt.sign({ id, phone: formattedPhone }, process.env.JWT_SECRET || 'insecure-dev-secret', { expiresIn: '30d' });

      await mariadbPool.query(
        `INSERT INTO Users (id, phone, firstName, lastName, accessToken) VALUES (?, ?, ?, ?, ?)`,
        [id, formattedPhone, firstName, lastName, accessToken]
      );

      const [newUser] = await mariadbPool.query('SELECT * FROM Users WHERE id = ?', [id]);
      res.status(201).json({ success: true, user: newUser[0] });
    } else {
      res.status(200).json({ success: false, message: 'Invalid code' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
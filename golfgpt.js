const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const twilio = require('twilio');
const axios = require('axios');
require('dotenv').config();

const router = express.Router();
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

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
  const phone = req.query.phone;
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

let cachedToken = null;
let tokenFetchedAt = null;
const TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

const GHIN_EMAIL = process.env.GHIN_EMAIL;
const GHIN_PASSWORD = process.env.GHIN_PASSWORD;

async function getGhinToken() {
  // reuse if token is recent
  if (cachedToken && Date.now() - tokenFetchedAt < TOKEN_TTL_MS) {
    return cachedToken;
  }

  try {
    const loginRes = await axios.post(
      "https://api2.ghin.com/api/v1/golfer_login.json",
      {
        email_or_ghin: GHIN_EMAIL,
        password: GHIN_PASSWORD,
        source: "ghincom",
        token: ""
      },
      {
        headers: {
          "Content-Type": "application/json",
          Origin: "https://www.ghin.com",
          Referer: "https://www.ghin.com/",
        },
      }
    );

    const token = loginRes.data.golfer_user_token;
    cachedToken = token;
    tokenFetchedAt = Date.now();
    return token;
  } catch (err) {
    console.error("GHIN login failed:", err.response?.data || err.message);
    throw new Error("Login to GHIN failed.");
  }
}

router.get("/gpt/ghin/courses", async (req, res) => {
  const { query } = req.query;
  if (!query) {
    return res.status(400).json({ success: false, message: "Missing query" });
  }

  try {
    const token = await getGhinToken();

    const response = await axios.get(
      "https://api2.ghin.com/api/v1/crsCourseMethods.asmx/SearchCourses.json",
      {
        params: { name: query, source: "GHINcom" },
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Origin: "https://www.ghin.com",
          Referer: "https://www.ghin.com/",
        },
      }
    );

    res.status(200).json({ success: true, results: response.data });
  } catch (error) {
    console.error("GHIN course search error:", error?.response?.data || error.message);
    res.status(500).json({ success: false, message: error?.response?.data });
  }
});

module.exports = router;
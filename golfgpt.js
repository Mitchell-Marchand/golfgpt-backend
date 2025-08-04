const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const twilio = require('twilio');
const axios = require('axios');
const authenticateUser = require('./authMiddleware');
require('dotenv').config();

const router = express.Router();
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

const mariadbPool = mysql.createPool({
  host: 'ec2-18-232-136-96.compute-1.amazonaws.com',
  user: 'golfuser',
  password: process.env.DB_PASS,
  database: 'golfpicks',
  waitForConnections: true,
  connectionLimit: 10,
});

const testAccounts = ["1234567890", "1234567001"];

function formatAndValidatePhone(input) {
  if (!input) return null;
  const digits = input.replace(/\D/g, '');
  const normalized = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return /^\d{10}$/.test(normalized) ? normalized : null;
}

function sanitizeForJson(input) {
  if (typeof input !== 'string') return '';

  return input
    .replace(/[\r\n]+/g, ' ')     // Replace newlines and carriage returns with space
    .replace(/["']/g, '')         // Remove double and single quotes
    .replace(/,/g, '')            // Remove commas
    .replace(/\s*&\s*/g, ' ')     // Remove " & " and similar (e.g. " &", "& ", etc.)
    .trim();                      // Trim whitespace from ends
}

router.get('/getCode', async (req, res) => {
  const phone = req.query.phone;
  const formattedPhone = formatAndValidatePhone(phone);
  if (!formattedPhone) {
    return res.status(400).json({ success: false, message: 'Phone number invalid' });
  }

  try {
    let phone = formattedPhone;
    if (testAccounts.includes(formattedPhone)) {
      res.status(200).json({ success: true, status: "OK" });
      return;
    }

    const verification = await client.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verifications.create({ to: `+1${phone}`, channel: 'sms' });

    res.status(200).json({ success: true, status: verification.status });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.post('/signIn', async (req, res) => {
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

    if (testAccounts.includes(formattedPhone)) {
      if (code === "334677") {
        const [ids] = await mariadbPool.query('SELECT id, firstName, lastName FROM Users WHERE phone = ?', [formattedPhone]);

        const accessToken = jwt.sign({ id: ids[0].id, phone: formattedPhone, firstName: ids[0].firstName, lastName: ids[0].lastName }, process.env.JWT_SECRET || 'insecure-dev-secret', { expiresIn: '365d' });
        await mariadbPool.query(
          'UPDATE Users SET accessToken = ? WHERE phone = ?',
          [accessToken, formattedPhone]
        );

        const [users] = await mariadbPool.query('SELECT * FROM Users WHERE phone = ?', [formattedPhone]);

        res.status(201).json({ success: true, user: users[0] });
      } else {
        res.status(200).json({ success: false, message: 'Invalid code' });
      }

      return;
    }

    const verificationCheck = await client.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verificationChecks.create({ to: `+1${formattedPhone}`, code });

    if (verificationCheck.status === 'approved') {
      const [ids] = await mariadbPool.query('SELECT id, firstName, lastName FROM Users WHERE phone = ?', [formattedPhone]);

      const accessToken = jwt.sign({ id: ids[0].id, phone: formattedPhone, firstName: ids[0].firstName, lastName: ids[0].lastName }, process.env.JWT_SECRET || 'insecure-dev-secret', { expiresIn: '365d' });
      await mariadbPool.query(
        'UPDATE Users SET accessToken = ? WHERE phone = ?',
        [accessToken, formattedPhone]
      );

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

router.post('/register', async (req, res) => {
  const { phone, firstName, lastName, homeClub, code } = req.body;
  const formattedPhone = formatAndValidatePhone(phone);
  const formattedFirst = sanitizeForJson(firstName);
  const formattedLast = sanitizeForJson(lastName);

  if (!formattedPhone || !formattedFirst || !formattedLast) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    const [existing] = await mariadbPool.query('SELECT * FROM Users WHERE phone = ?', [formattedPhone]);
    if (existing.length) {
      return res.status(409).json({ success: false, message: 'User already exists' });
    }

    if (testAccounts.includes(formattedPhone)) {
      if (code === "334677") {
        const id = uuidv4();
        const accessToken = jwt.sign({ id, phone: formattedPhone, firstName: formattedFirst, lastName: formattedLast }, process.env.JWT_SECRET || 'insecure-dev-secret', { expiresIn: '365d' });

        await mariadbPool.query(
          `INSERT INTO Users (id, phone, firstName, lastName, homeClub, accessToken) VALUES (?, ?, ?, ?, ?, ?)`,
          [id, formattedPhone, formattedFirst, formattedLast, homeClub?.trim() || "", accessToken]
        );

        const [newUser] = await mariadbPool.query('SELECT * FROM Users WHERE id = ?', [id]);
        res.status(201).json({ success: true, user: newUser[0] });
      } else {
        res.status(200).json({ success: false, message: 'Invalid code' });
      }

      return;
    }

    const verificationCheck = await client.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verificationChecks.create({ to: `+1${formattedPhone}`, code });

    if (verificationCheck.status === 'approved') {
      const id = uuidv4();
      const accessToken = jwt.sign({ id, phone: formattedPhone, firstName: formattedFirst, lastName: formattedLast }, process.env.JWT_SECRET || 'insecure-dev-secret', { expiresIn: '365d' });

      await mariadbPool.query(
        `INSERT INTO Users (id, phone, firstName, lastName, homeClub, accessToken) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, formattedPhone, formattedFirst, formattedLast, homeClub?.trim() || "", accessToken]
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
        user: {
          password: GHIN_PASSWORD,
          remember_me: true,
          email_or_ghin: GHIN_EMAIL,
        },
        password: GHIN_PASSWORD,
        source: "GHINcom",
        token: uuidv4()
      },
      {
        headers: {
          "Content-Type": "application/json",
          Origin: "https://www.ghin.com",
          Referer: "https://www.ghin.com/",
        },
      }
    );

    const token = loginRes.data.golfer_user.golfer_user_token;
    cachedToken = token;
    tokenFetchedAt = Date.now();
    return token;
  } catch (err) {
    console.error("GHIN login failed:", err.response?.data || err.message);
    throw new Error("Login to GHIN failed.");
  }
}

router.get("/ghin/courses", async (req, res) => {
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

router.get("/ghin/course-details", async (req, res) => {
  const { courseId } = req.query;
  if (!courseId) {
    return res.status(400).json({ success: false, message: "Missing courseId" });
  }

  try {
    const token = await getGhinToken();

    const ghResponse = await axios.get(
      "https://api2.ghin.com/api/v1/crsCourseMethods.asmx/GetCourseDetails.json",
      {
        params: {
          courseId,
          include_altered_tees: false,
          source: "GHINcom",
        },
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Origin: "https://www.ghin.com",
          Referer: "https://www.ghin.com/",
        },
      }
    );

    res.status(200).json({ success: true, results: ghResponse.data });
  } catch (err) {
    console.error("GHIN course details error:", err.response?.data || err.message);
    res.status(500).json({ success: false, message: "Failed to fetch course details" });
  }
});

router.put('/user/update', authenticateUser, async (req, res) => {
  const { firstName, lastName, homeClub, isPublic } = req.body;
  const userId = req.user?.id;
  const formattedFirst = sanitizeForJson(firstName);
  const formattedLast = sanitizeForJson(lastName);

  if (!formattedFirst || !formattedLast) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    await mariadbPool.query(
      'UPDATE Users SET firstName = ?, lastName = ?, homeClub = ?, isPublic = ? WHERE id = ?',
      [formattedFirst, formattedLast, homeClub?.trim() || '', isPublic, userId]
    );

    const [updatedUser] = await mariadbPool.query('SELECT * FROM Users WHERE id = ?', [userId]);
    res.status(200).json({ success: true, user: updatedUser[0] });
  } catch (err) {
    console.error("User update error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

router.put('/user/epn', authenticateUser, async (req, res) => {
  const { expoPushToken } = req.body;
  const userId = req.user?.id;

  try {
    if (expoPushToken) {
      await mariadbPool.query(
        'UPDATE Users SET expoPushToken = ? WHERE id = ?',
        [expoPushToken, userId]
      );
    }

    const [updatedUser] = await mariadbPool.query('SELECT * FROM Users WHERE id = ?', [userId]);
    res.status(200).json({ success: true, user: updatedUser[0] });
  } catch (err) {
    console.error("User update error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

module.exports = router;
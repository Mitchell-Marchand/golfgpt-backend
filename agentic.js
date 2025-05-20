const express = require('express');
const db = require('./db');
const twilio = require('twilio');

const router = express.Router();
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

function formatAndValidatePhone(input) {
  if (!input) return null;
  const digits = input.replace(/\D/g, '');
  const normalized = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return /^\d{10}$/.test(normalized) ? normalized : null;
}

router.post('/start-verification', async (req, res) => {
  const { phone } = req.body;
  const formattedPhone = formatAndValidatePhone(phone);
  if (!formattedPhone) {
    return res.status(200).json({ success: false, message: "Please provide your full phone number." });
  }

  try {
    const existing = db.prepare('SELECT * FROM users WHERE phone = ?').get(formattedPhone);
    if (existing) {
      return res.status(200).json({ success: false, message: "This number is already on the list." });
    }

    const verification = await client.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verifications.create({ to: `+1${formattedPhone}`, channel: 'sms' });

    res.status(200).json({ success: true, status: verification.status });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/check-verification', async (req, res) => {
  const { phone, code } = req.body;
  const formattedPhone = formatAndValidatePhone(phone);
  if (!formattedPhone) {
    return res.status(200).json({ success: false, message: "Please provide your full phone number." });
  }

  try {
    const verificationCheck = await client.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verificationChecks.create({ to: `+1${formattedPhone}`, code });

    if (verificationCheck.status === 'approved') {
      const existing = db.prepare('SELECT * FROM users WHERE phone = ?').get(formattedPhone);
      if (!existing) {
        db.prepare('INSERT INTO users (phone) VALUES (?)').run(formattedPhone);
      } else {
        return res.status(400).json({ success: false, message: 'This phone number has already been verified.' });
      }

      res.status(200).json({ success: true, message: 'Phone verified!' });
    } else {
      res.status(200).json({ success: false, message: 'Invalid code' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

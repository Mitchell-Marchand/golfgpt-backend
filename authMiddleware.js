// authMiddleware.js
const jwt = require('jsonwebtoken')

async function authenticateUser(req, res, next) {
  const authHeader = req.headers['authorization']

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' })
  }

  const token = authHeader.split(' ')[1]

  try {
    const user = jwt.verify(token, process.env.JWT_SECRET)
    req.user = user // Attach user to request
    console.log("user authenticated", user);
    next()
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' })
  }
}

module.exports = authenticateUser

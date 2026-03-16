const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'hr-system-dev-secret-change-in-production';

function requireAuth(req, res, next) {
  try {
    // Accept token from Authorization header or cookie
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.startsWith('Bearer '))
      ? authHeader.slice(7)
      : req.cookies?.hr_token;

    if (!token) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth, JWT_SECRET };

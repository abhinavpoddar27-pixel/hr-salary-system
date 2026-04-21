const jwt = require('jsonwebtoken');
const { getDb } = require('../database/db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('[auth] JWT_SECRET env var is required and must not be empty');
}

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

    // Fetch allowed_companies from DB and attach to request
    try {
      const db = getDb();
      const user = db.prepare('SELECT allowed_companies FROM users WHERE id = ?').get(payload.id);
      const ac = user?.allowed_companies || '*';
      if (ac === '*') {
        req.user.allowedCompanies = null; // null = all companies
      } else {
        req.user.allowedCompanies = ac.split(',').map(c => c.trim()).filter(Boolean);
      }
    } catch (e) {
      // If DB not ready or column missing, allow all
      req.user.allowedCompanies = null;
    }

    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

/**
 * Helper: Get company filter SQL clause based on user's allowed companies
 * Returns { clause: string, params: array } to inject into queries
 * @param {Object} req - Express request with req.user.allowedCompanies
 * @param {string} alias - Table alias for company column (e.g., 'sc', 'ap', 'e')
 * @param {string} companyParam - Explicit company filter from query/body (overrides if allowed)
 */
function getCompanyFilter(req, alias = '', companyParam = '') {
  const col = alias ? `${alias}.company` : 'company';

  // If explicit company param provided, use it (RBAC check: user must have access)
  if (companyParam) {
    if (req.user.allowedCompanies && !req.user.allowedCompanies.includes(companyParam)) {
      return { allowed: false };
    }
    return { allowed: true, clause: `AND ${col} = ?`, params: [companyParam] };
  }

  // If user has restricted access, filter to their companies
  if (req.user.allowedCompanies && req.user.allowedCompanies.length > 0) {
    const placeholders = req.user.allowedCompanies.map(() => '?').join(', ');
    return { allowed: true, clause: `AND ${col} IN (${placeholders})`, params: [...req.user.allowedCompanies] };
  }

  // No restriction
  return { allowed: true, clause: '', params: [] };
}

module.exports = { requireAuth, JWT_SECRET, getCompanyFilter };

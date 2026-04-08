const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../database/db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

const TOKEN_EXPIRY = '2h';
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

// Canonical roles accepted by the permission layer. Anything outside this
// set is coerced to 'viewer' so a typo at user creation can never silently
// lock a user out (or worse, accidentally escalate them).
const VALID_ROLES = new Set(['admin', 'hr', 'finance', 'supervisor', 'viewer', 'employee']);

/**
 * Normalize a role field to its canonical lowercase form.
 * Handles: whitespace, case variations, empty/null, and unknown values.
 * Returns 'viewer' as a safe fallback for anything we don't recognise.
 */
function normalizeRole(raw) {
  const trimmed = String(raw || '').trim().toLowerCase();
  if (!trimmed) return 'viewer';
  // Tolerate "Finance Team" / "HR Manager" by matching on known tokens
  for (const r of VALID_ROLES) {
    if (trimmed === r || trimmed.split(/[\s_-]+/).includes(r)) return r;
  }
  return 'viewer';
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password required' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username.trim().toLowerCase());

  if (!user) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  // Normalize role on-the-fly AND write it back to the DB so a legacy
  // "Finance" / "FINANCE " row gets cleaned up the next time the user
  // logs in. Self-healing migration.
  const normalizedRole = normalizeRole(user.role);
  if (normalizedRole !== user.role) {
    try {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(normalizedRole, user.id);
    } catch (e) { /* best-effort */ }
  }

  // Update last login + last active
  db.prepare("UPDATE users SET last_login = datetime('now'), last_active = datetime('now') WHERE id = ?").run(user.id);

  const token = jwt.sign(
    { id: user.id, username: user.username, role: normalizedRole, employee_code: user.employee_code || null },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );

  // Set httpOnly cookie for extra security (optional, frontend also uses Bearer)
  res.cookie('hr_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000 // 12h
  });

  // Parse allowed companies
  const ac = user.allowed_companies || '*';
  const allowedCompanies = ac === '*' ? ['*'] : ac.split(',').map(c => c.trim()).filter(Boolean);

  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      role: normalizedRole,
      allowedCompanies
    }
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('hr_token');
  res.json({ success: true });
});

// GET /api/auth/me  (protected)
router.get('/me', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, username, role, last_login, allowed_companies, onboarding_completed FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  // Always return a canonical role — protects the frontend from any
  // legacy rows that haven't self-healed via a login yet.
  user.role = normalizeRole(user.role);
  const ac = user.allowed_companies || '*';
  user.allowedCompanies = ac === '*' ? ['*'] : ac.split(',').map(c => c.trim()).filter(Boolean);

  res.json({ success: true, user });
});

// POST /api/auth/heartbeat — refresh token if user is still active
router.post('/heartbeat', requireAuth, (req, res) => {
  try {
    const db = getDb();
    // Update last_active timestamp
    db.prepare("UPDATE users SET last_active = datetime('now') WHERE id = ?").run(req.user.id);

    // Issue a fresh token (sliding window) — normalize role defensively
    // in case the JWT was issued before the normalization landed.
    const token = jwt.sign(
      { id: req.user.id, username: req.user.username, role: normalizeRole(req.user.role) },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );

    res.cookie('hr_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 2 * 60 * 60 * 1000 // 2h
    });

    res.json({ success: true, token, expiresIn: TOKEN_EXPIRY });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Heartbeat failed' });
  }
});

// GET /api/auth/session-status — check if user should be considered active
router.get('/session-status', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT last_active FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const lastActive = user.last_active ? new Date(user.last_active + 'Z').getTime() : 0;
  const now = Date.now();
  const inactive = (now - lastActive) > INACTIVITY_TIMEOUT_MS;

  res.json({ success: true, active: !inactive, lastActive: user.last_active, timeoutMs: INACTIVITY_TIMEOUT_MS });
});

// POST /api/auth/change-password  (protected)
router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'Both current and new password required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ success: false, error: 'Current password is incorrect' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ success: true, message: 'Password updated successfully' });
});

// GET /api/auth/permissions
router.get('/permissions', requireAuth, (req, res) => {
  const { getPermissions } = require('../config/permissions');
  const role = normalizeRole(req.user.role);
  const perms = getPermissions(role);
  res.json({ success: true, role, permissions: perms });
});

// PATCH /api/auth/onboarding-complete
router.patch('/onboarding-complete', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE users SET onboarding_completed = 1 WHERE id = ?').run(req.user.id);
  res.json({ success: true });
});

// GET /api/auth/users  (admin only)
router.get('/users', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  const db = getDb();
  const users = db.prepare('SELECT id, username, role, is_active, allowed_companies, created_at, last_login FROM users ORDER BY created_at').all();
  // Parse allowed_companies for each user
  for (const u of users) {
    const ac = u.allowed_companies || '*';
    u.allowedCompanies = ac === '*' ? ['*'] : ac.split(',').map(c => c.trim()).filter(Boolean);
  }
  res.json({ success: true, data: users });
});

// POST /api/auth/users  (admin only — create new user)
router.post('/users', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  const { username, password, role, allowedCompanies } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password required' });
  }
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim().toLowerCase());
  if (existing) return res.status(400).json({ success: false, error: 'Username already exists' });

  // Format allowed_companies: array → comma-separated string, or '*'
  let ac = '*';
  if (allowedCompanies && Array.isArray(allowedCompanies)) {
    if (allowedCompanies.includes('*')) ac = '*';
    else ac = allowedCompanies.join(',');
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password_hash, role, allowed_companies) VALUES (?, ?, ?, ?)').run(
    username.trim().toLowerCase(), hash, normalizeRole(role), ac
  );
  res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /api/auth/users/:id  (admin only — update user)
router.put('/users/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const db = getDb();
  const { id } = req.params;
  const { role, is_active, allowedCompanies, password } = req.body;

  const updates = [];
  const values = [];

  if (role !== undefined) { updates.push('role = ?'); values.push(normalizeRole(role)); }
  if (is_active !== undefined) { updates.push('is_active = ?'); values.push(is_active ? 1 : 0); }
  if (allowedCompanies !== undefined) {
    let ac = '*';
    if (Array.isArray(allowedCompanies)) {
      ac = allowedCompanies.includes('*') ? '*' : allowedCompanies.join(',');
    } else if (typeof allowedCompanies === 'string') {
      ac = allowedCompanies;
    }
    updates.push('allowed_companies = ?');
    values.push(ac);
  }
  if (password) {
    updates.push('password_hash = ?');
    values.push(bcrypt.hashSync(password, 10));
  }

  if (updates.length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });

  values.push(id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ success: true, message: 'User updated' });
});

module.exports = router;
module.exports.normalizeRole = normalizeRole;

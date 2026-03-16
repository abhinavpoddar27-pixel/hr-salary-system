const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../database/db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

const TOKEN_EXPIRY = '12h';

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

  // Update last login
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
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

  res.json({
    success: true,
    token,
    user: { id: user.id, username: user.username, role: user.role }
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
  const user = db.prepare('SELECT id, username, role, last_login FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, user });
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

// GET /api/auth/users  (admin only)
router.get('/users', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  const db = getDb();
  const users = db.prepare('SELECT id, username, role, is_active, created_at, last_login FROM users ORDER BY created_at').all();
  res.json({ success: true, data: users });
});

// POST /api/auth/users  (admin only — create new user)
router.post('/users', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password required' });
  }
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim().toLowerCase());
  if (existing) return res.status(400).json({ success: false, error: 'Username already exists' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
    username.trim().toLowerCase(), hash, role || 'viewer'
  );
  res.json({ success: true, id: result.lastInsertRowid });
});

module.exports = router;

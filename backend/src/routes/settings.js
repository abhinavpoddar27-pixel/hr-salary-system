const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');

// ─── Admin-only middleware ───────────────────────────────
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}

// ─── SHIFTS ───────────────────────────────────────────────

router.get('/shifts', (req, res) => {
  const db = getDb();
  res.json({ success: true, data: db.prepare('SELECT * FROM shifts ORDER BY id').all() });
});

router.post('/shifts', requireAdmin, (req, res) => {
  const db = getDb();
  const { name, code, startTime, endTime, graceMinutes, breakMinutes, minHoursFullDay, minHoursHalfDay } = req.body;
  // Auto-detect overnight from start/end times (start > end means it crosses midnight)
  const [sh] = (startTime || '').split(':').map(Number);
  const [eh] = (endTime || '').split(':').map(Number);
  const autoOvernight = (!isNaN(sh) && !isNaN(eh) && sh > eh) ? 1 : 0;
  const result = db.prepare('INSERT INTO shifts (name, code, start_time, end_time, grace_minutes, is_overnight, break_minutes, min_hours_full_day, min_hours_half_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(name, code, startTime, endTime, graceMinutes || 30, autoOvernight, breakMinutes || 0, minHoursFullDay || 10, minHoursHalfDay || 4);
  res.json({ success: true, id: result.lastInsertRowid });
});

router.put('/shifts/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const { name, startTime, endTime, graceMinutes, breakMinutes, minHoursFullDay, minHoursHalfDay } = req.body;
  // Auto-detect overnight from start/end times
  const [sh2] = (startTime || '').split(':').map(Number);
  const [eh2] = (endTime || '').split(':').map(Number);
  const autoOvernight2 = (!isNaN(sh2) && !isNaN(eh2) && sh2 > eh2) ? 1 : 0;
  db.prepare('UPDATE shifts SET name=?, start_time=?, end_time=?, grace_minutes=?, is_overnight=?, break_minutes=?, min_hours_full_day=?, min_hours_half_day=? WHERE id=?')
    .run(name, startTime, endTime, graceMinutes, autoOvernight2, breakMinutes || 0, minHoursFullDay, minHoursHalfDay, req.params.id);
  res.json({ success: true });
});

// ─── HOLIDAYS ─────────────────────────────────────────────

router.get('/holidays', (req, res) => {
  const db = getDb();
  const { year } = req.query;
  let query = 'SELECT * FROM holidays';
  const params = [];
  if (year) { query += ' WHERE date LIKE ?'; params.push(`${year}-%`); }
  query += ' ORDER BY date';
  res.json({ success: true, data: db.prepare(query).all(...params) });
});

router.post('/holidays', requireAdmin, (req, res) => {
  const db = getDb();
  const { date, name, type, isRecurring, applicableTo } = req.body;
  const result = db.prepare('INSERT INTO holidays (date, name, type, is_recurring, applicable_to) VALUES (?, ?, ?, ?, ?)')
    .run(date, name, type || 'National', isRecurring ? 1 : 0, applicableTo || 'All');
  res.json({ success: true, id: result.lastInsertRowid });
});

router.delete('/holidays/:id', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM holidays WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── POLICY CONFIG ────────────────────────────────────────

router.get('/policy', (req, res) => {
  const db = getDb();
  const policies = db.prepare('SELECT * FROM policy_config ORDER BY key').all();
  // Convert to key-value object
  const config = {};
  for (const p of policies) config[p.key] = p.value;
  res.json({ success: true, data: config, raw: policies });
});

router.put('/policy', requireAdmin, (req, res) => {
  const db = getDb();
  const updates = req.body; // { key: value, ... }
  const stmt = db.prepare("INSERT INTO policy_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')");
  const txn = db.transaction(() => {
    for (const [key, value] of Object.entries(updates)) {
      stmt.run(key, String(value));
    }
  });
  txn();
  res.json({ success: true });
});

// ─── COMPLIANCE ITEMS ─────────────────────────────────────

router.get('/compliance', (req, res) => {
  const db = getDb();
  const { year } = req.query;
  const data = db.prepare(`SELECT * FROM compliance_items WHERE year = ? ORDER BY due_date`).all(year || new Date().getFullYear());
  res.json({ success: true, data });
});

router.put('/compliance/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const { status, challanNumber, filingDate, amount, remarks } = req.body;
  db.prepare('UPDATE compliance_items SET status=?, challan_number=?, filing_date=?, amount=?, remarks=? WHERE id=?')
    .run(status, challanNumber, filingDate, amount, remarks, req.params.id);
  res.json({ success: true });
});

// Auto-generate compliance calendar for a year
router.post('/compliance/generate/:year', requireAdmin, (req, res) => {
  const db = getDb();
  const year = parseInt(req.params.year);

  const items = [];
  for (let m = 1; m <= 12; m++) {
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? year + 1 : year;
    const dueDate = `${nextY}-${String(nextM).padStart(2,'0')}-15`;

    items.push({ type: 'PF', month: m, year, due_date: dueDate });
    items.push({ type: 'ESI', month: m, year, due_date: dueDate });
  }

  const insert = db.prepare('INSERT OR IGNORE INTO compliance_items (type, month, year, due_date) VALUES (?, ?, ?, ?)');
  const txn = db.transaction(() => {
    for (const item of items) insert.run(item.type, item.month, item.year, item.due_date);
  });
  txn();

  res.json({ success: true, created: items.length });
});

// ─── COMPANIES ───────────────────────────────────────────

router.get('/companies', (req, res) => {
  const db = getDb();

  // Auto-seed from existing data if empty
  db.exec(`CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  const count = db.prepare('SELECT COUNT(*) as cnt FROM companies').get();
  if (count.cnt === 0) {
    const insert = db.prepare('INSERT OR IGNORE INTO companies (name, display_name) VALUES (?, ?)');
    // Seed from employees
    const empCompanies = db.prepare('SELECT DISTINCT company FROM employees WHERE company IS NOT NULL AND company != ""').all();
    for (const c of empCompanies) insert.run(c.company, c.company);
    // Seed from attendance
    try {
      const attCompanies = db.prepare('SELECT DISTINCT company FROM attendance_raw WHERE company IS NOT NULL AND company != ""').all();
      for (const c of attCompanies) insert.run(c.company, c.company);
    } catch {}
  }

  const companies = db.prepare('SELECT * FROM companies WHERE is_active = 1 ORDER BY name').all();
  res.json({ success: true, data: companies });
});

router.post('/companies', requireAdmin, (req, res) => {
  const db = getDb();
  const { name, display_name } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'name required' });
  db.prepare('INSERT INTO companies (name, display_name) VALUES (?, ?)').run(name, display_name || name);
  res.json({ success: true });
});

router.patch('/companies/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const { display_name, is_active } = req.body;
  if (display_name !== undefined) db.prepare('UPDATE companies SET display_name = ? WHERE id = ?').run(display_name, req.params.id);
  if (is_active !== undefined) db.prepare('UPDATE companies SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, req.params.id);
  res.json({ success: true });
});

module.exports = router;

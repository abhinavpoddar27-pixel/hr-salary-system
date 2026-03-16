const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');

// ─── SHIFTS ───────────────────────────────────────────────

router.get('/shifts', (req, res) => {
  const db = getDb();
  res.json({ success: true, data: db.prepare('SELECT * FROM shifts ORDER BY id').all() });
});

router.post('/shifts', (req, res) => {
  const db = getDb();
  const { name, code, startTime, endTime, graceMinutes, isOvernight, breakMinutes, minHoursFullDay, minHoursHalfDay } = req.body;
  const result = db.prepare('INSERT INTO shifts (name, code, start_time, end_time, grace_minutes, is_overnight, break_minutes, min_hours_full_day, min_hours_half_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(name, code, startTime, endTime, graceMinutes || 30, isOvernight ? 1 : 0, breakMinutes || 0, minHoursFullDay || 10, minHoursHalfDay || 4);
  res.json({ success: true, id: result.lastInsertRowid });
});

router.put('/shifts/:id', (req, res) => {
  const db = getDb();
  const { name, startTime, endTime, graceMinutes, isOvernight, breakMinutes, minHoursFullDay, minHoursHalfDay } = req.body;
  db.prepare('UPDATE shifts SET name=?, start_time=?, end_time=?, grace_minutes=?, is_overnight=?, break_minutes=?, min_hours_full_day=?, min_hours_half_day=? WHERE id=?')
    .run(name, startTime, endTime, graceMinutes, isOvernight ? 1 : 0, breakMinutes || 0, minHoursFullDay, minHoursHalfDay, req.params.id);
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

router.post('/holidays', (req, res) => {
  const db = getDb();
  const { date, name, type, isRecurring, applicableTo } = req.body;
  const result = db.prepare('INSERT INTO holidays (date, name, type, is_recurring, applicable_to) VALUES (?, ?, ?, ?, ?)')
    .run(date, name, type || 'National', isRecurring ? 1 : 0, applicableTo || 'All');
  res.json({ success: true, id: result.lastInsertRowid });
});

router.delete('/holidays/:id', (req, res) => {
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

router.put('/policy', (req, res) => {
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

router.put('/compliance/:id', (req, res) => {
  const db = getDb();
  const { status, challanNumber, filingDate, amount, remarks } = req.body;
  db.prepare('UPDATE compliance_items SET status=?, challan_number=?, filing_date=?, amount=?, remarks=? WHERE id=?')
    .run(status, challanNumber, filingDate, amount, remarks, req.params.id);
  res.json({ success: true });
});

// Auto-generate compliance calendar for a year
router.post('/compliance/generate/:year', (req, res) => {
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

module.exports = router;

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
  const { year, includeInactive } = req.query;
  let query = 'SELECT * FROM holidays WHERE 1=1';
  const params = [];
  if (!includeInactive) { query += ' AND (is_active IS NULL OR is_active = 1)'; }
  if (year) { query += ' AND date LIKE ?'; params.push(`${year}-%`); }
  query += ' ORDER BY date';
  res.json({ success: true, data: db.prepare(query).all(...params) });
});

router.post('/holidays', requireAdmin, (req, res) => {
  const db = getDb();
  const { date, name, type, isRecurring, applicableTo, addedBy } = req.body;
  const result = db.prepare('INSERT INTO holidays (date, name, type, is_recurring, applicable_to, added_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(date, name, type || 'National', isRecurring ? 1 : 0, applicableTo || 'All', addedBy || req.user?.username || 'HR');

  // Audit log
  try {
    const m = parseInt(date.split('-')[1]), y = parseInt(date.split('-')[0]);
    db.prepare('INSERT INTO holiday_audit_log (holiday_id, action, holiday_date, holiday_name, new_values, changed_by, affects_months) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(result.lastInsertRowid, 'ADD', date, name, JSON.stringify({ date, name, type }), req.user?.username || 'HR', JSON.stringify([{ month: m, year: y }]));
  } catch {}

  // Check if salary already computed for this month
  let warning = null;
  try {
    const [y, m] = date.split('-');
    const sc = db.prepare('SELECT COUNT(*) as cnt FROM salary_computations WHERE month = ? AND year = ?').get(parseInt(m), parseInt(y));
    if (sc?.cnt > 0) warning = `Salary already computed for this month. Re-run Day Calculation and Salary Computation.`;
  } catch {}

  res.json({ success: true, id: result.lastInsertRowid, warning });
});

router.delete('/holidays/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const holiday = db.prepare('SELECT * FROM holidays WHERE id = ?').get(req.params.id);
  if (!holiday) return res.status(404).json({ success: false, error: 'Holiday not found' });

  const { reason } = req.body || {};
  if (holiday.type === 'National' && !reason) {
    return res.status(400).json({ success: false, error: 'Reason required to delete a national holiday' });
  }

  // Soft delete
  db.prepare('UPDATE holidays SET is_active = 0 WHERE id = ?').run(req.params.id);

  // Audit
  try {
    db.prepare('INSERT INTO holiday_audit_log (holiday_id, action, holiday_date, holiday_name, old_values, changed_by, reason) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(req.params.id, 'DELETE', holiday.date, holiday.name, JSON.stringify(holiday), req.user?.username || 'HR', reason || '');
  } catch {}

  res.json({ success: true });
});

router.put('/holidays/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const old = db.prepare('SELECT * FROM holidays WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ success: false, error: 'Holiday not found' });

  const { date, name, type, applicableTo, reason } = req.body;
  db.prepare('UPDATE holidays SET date=?, name=?, type=?, applicable_to=? WHERE id=?')
    .run(date || old.date, name || old.name, type || old.type, applicableTo || old.applicable_to, req.params.id);

  try {
    db.prepare('INSERT INTO holiday_audit_log (holiday_id, action, holiday_date, holiday_name, old_values, new_values, changed_by, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.params.id, 'MODIFY', date || old.date, name || old.name, JSON.stringify(old), JSON.stringify({ date, name, type }), req.user?.username || 'HR', reason || '');
  } catch {}

  res.json({ success: true });
});

router.get('/holidays/audit-log', (req, res) => {
  const db = getDb();
  const { page, limit, reviewed } = req.query;
  const pageNum = parseInt(page) || 1;
  const pageSize = parseInt(limit) || 20;
  let where = 'WHERE 1=1';
  const params = [];
  if (reviewed === 'false') { where += ' AND finance_reviewed = 0'; }
  if (reviewed === 'true') { where += ' AND finance_reviewed = 1'; }

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM holiday_audit_log ${where}`).get(...params)?.cnt || 0;
  const data = db.prepare(`SELECT * FROM holiday_audit_log ${where} ORDER BY changed_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (pageNum - 1) * pageSize);
  const unreviewed = db.prepare('SELECT COUNT(*) as cnt FROM holiday_audit_log WHERE finance_reviewed = 0').get()?.cnt || 0;

  res.json({ success: true, data, total, unreviewed, page: pageNum, pageSize });
});

router.put('/holidays/audit-log/:id/review', (req, res) => {
  const db = getDb();
  const { reviewed_by, notes } = req.body;
  db.prepare("UPDATE holiday_audit_log SET finance_reviewed = 1, finance_reviewed_by = ?, finance_reviewed_at = datetime('now'), finance_review_notes = ? WHERE id = ?")
    .run(reviewed_by || req.user?.username || 'finance', notes || '', req.params.id);
  res.json({ success: true });
});

router.post('/holidays/bulk-seed', requireAdmin, (req, res) => {
  const db = getDb();
  const { year, holidays, addedBy } = req.body;
  if (!year || !holidays?.length) return res.status(400).json({ success: false, error: 'year and holidays required' });

  // Soft-delete existing for the year
  db.prepare("UPDATE holidays SET is_active = 0 WHERE date LIKE ?").run(`${year}-%`);

  const ins = db.prepare("INSERT INTO holidays (date, name, type, is_recurring, applicable_to, added_by) VALUES (?, ?, ?, 0, 'All', ?)");
  const txn = db.transaction(() => {
    for (const h of holidays) {
      ins.run(h.date, h.name, h.type || 'National', addedBy || req.user?.username || 'HR');
    }
  });
  txn();

  try {
    db.prepare('INSERT INTO holiday_audit_log (action, holiday_name, new_values, changed_by, reason) VALUES (?, ?, ?, ?, ?)')
      .run('BULK_SEED', `${year} holidays`, JSON.stringify(holidays), addedBy || req.user?.username || 'HR', `Seeded ${holidays.length} holidays for ${year}`);
  } catch {}

  res.json({ success: true, count: holidays.length });
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
    const empCompanies = db.prepare("SELECT DISTINCT company FROM employees WHERE company IS NOT NULL AND company != ''").all();
    for (const c of empCompanies) insert.run(c.company, c.company);
    // Seed from attendance
    try {
      const attCompanies = db.prepare("SELECT DISTINCT company FROM attendance_raw WHERE company IS NOT NULL AND company != ''").all();
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

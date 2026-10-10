/**
 * Attendance Review API (PR-1) — mounted at /api/analytics/attendance-review. ADMIN ONLY.
 * Read-only on every payroll table; writes only attendance_review_config / attendance_review_runs / audit_log.
 * Results carry names and indicative ₹ — never expose to non-admin roles.
 */
const express = require('express');
const router = express.Router();
const { getDb, logAudit } = require('../database/db');
const { requireAdmin } = require('../middleware/roles');
const svc = require('../services/attendanceReviewService');
const exportsSvc = require('../services/attendanceReviewExports');

router.use(requireAdmin);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function parseMonth(src) {
  const month = parseInt(src.month, 10); const year = parseInt(src.year, 10);
  if (!(month >= 1 && month <= 12) || !(year >= 2020 && year <= 2100)) return null;
  return { month, year };
}
function parseReleaseDays(v, month, year) {
  let list = v;
  if (typeof v === 'string') list = v.split(',').map((s) => s.trim()).filter(Boolean);
  if (list === undefined || list === null) return { list: [] };
  if (!Array.isArray(list)) return { error: 'releaseDays must be a list of YYYY-MM-DD dates' };
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  for (const d of list) if (typeof d !== 'string' || !ISO.test(d) || d.slice(0, 7) !== ym) return { error: `release day ${d} is not a date in ${ym}` };
  return { list: [...new Set(list)].sort() };
}
const user = (req) => req.user?.username || 'admin';

/** Release days of last month = the finalised (else draft) run's confirmed list; [] if no run exists. */
function prevReleaseDays(db, month, year) {
  const p = svc.prevMonth(month, year);
  const r = db.prepare("SELECT release_days FROM attendance_review_runs WHERE month = ? AND year = ?").get(p.month, p.year);
  try { return r ? JSON.parse(r.release_days) : []; } catch { return []; }
}

function runSummary(r) {
  return { id: r.id, month: r.month, year: r.year, status: r.status, generated_by: r.generated_by, generated_at: r.generated_at,
    finalised_by: r.finalised_by, finalised_at: r.finalised_at, release_days: JSON.parse(r.release_days || '[]'), overrides: JSON.parse(r.overrides || '[]') };
}

// GET /?month&year[&releaseDays=a,b][&overrides=<JSON list>] — preview, nothing saved
router.get('/', (req, res) => {
  const my = parseMonth(req.query); if (!my) return res.status(400).json({ success: false, error: 'month and year required' });
  const rd = parseReleaseDays(req.query.releaseDays, my.month, my.year); if (rd.error) return res.status(400).json({ success: false, error: rd.error });
  let overrides = [];
  if (req.query.overrides) {
    try { overrides = JSON.parse(req.query.overrides); } catch { return res.status(400).json({ success: false, error: 'overrides must be a JSON list' }); }
    const oerr = svc.validateOverrides(overrides);
    if (oerr.length) return res.status(400).json({ success: false, error: 'Invalid overrides', details: oerr });
    overrides = overrides.map((o) => ({ code: String(o.code).trim(), action: o.action, reason: String(o.reason).trim() }));
  }
  try {
    const db = getDb();
    const { config, source } = svc.loadConfig(db, `${my.year}-${String(my.month).padStart(2, '0')}`);
    const data = svc.computeAttendanceReview(db, { ...my, config, releaseDays: rd.list, prevReleaseDays: prevReleaseDays(db, my.month, my.year), overrides });
    res.json({ success: true, data: { ...data, configSource: source } });
  } catch (err) {
    console.error('Attendance review preview error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute attendance review: ' + err.message });
  }
});

// GET /config[?month&year] — effective config (defaults merged) + stored history
router.get('/config', (req, res) => {
  const db = getDb();
  const my = parseMonth(req.query);
  const ym = my ? `${my.year}-${String(my.month).padStart(2, '0')}` : '9999-12';
  const { config, source } = svc.loadConfig(db, ym);
  const history = db.prepare('SELECT id, effective_from, updated_by, updated_at FROM attendance_review_config ORDER BY effective_from DESC, id DESC LIMIT 20').all();
  res.json({ success: true, data: { config, source, defaults: svc.DEFAULT_CONFIG, history } });
});

// PUT /config { effective_from:'YYYY-MM', config:{…} } — stores a new version (admin-entered lists)
router.put('/config', (req, res) => {
  const { effective_from: ef, config } = req.body || {};
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ef || '')) return res.status(400).json({ success: false, error: 'effective_from must be YYYY-MM' });
  const errs = svc.validateConfig(config);
  if (errs.length) return res.status(400).json({ success: false, error: 'Invalid config', details: errs });
  const db = getDb();
  const prev = svc.loadConfig(db, ef);
  const json = JSON.stringify(config);
  const info = db.prepare('INSERT INTO attendance_review_config (effective_from, config_json, updated_by) VALUES (?, ?, ?)').run(ef, json, user(req));
  logAudit('attendance_review_config', info.lastInsertRowid, 'config_json', prev.source ? `v${prev.source.id}` : 'defaults', json, 'ATTENDANCE_REVIEW_CONFIG', `effective ${ef}`, user(req));
  res.json({ success: true, data: { id: info.lastInsertRowid, effective_from: ef } });
});

// POST /runs { month, year, releaseDays[], overrides[] } — create or regenerate the month's DRAFT
router.post('/runs', (req, res) => {
  const body = req.body || {};
  const my = parseMonth(body); if (!my) return res.status(400).json({ success: false, error: 'month and year required' });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM attendance_review_runs WHERE month = ? AND year = ?').get(my.month, my.year);
  if (existing && existing.status === 'final') return res.status(409).json({ success: false, error: 'This month is finalised and locked; it cannot be regenerated' });
  // Omitted releaseDays / overrides on a regenerate keep the draft's saved values; an explicit [] clears them.
  const rd = body.releaseDays === undefined && existing ? { list: JSON.parse(existing.release_days || '[]') } : parseReleaseDays(body.releaseDays, my.month, my.year);
  if (rd.error) return res.status(400).json({ success: false, error: rd.error });
  const ovIn = body.overrides === undefined && existing ? JSON.parse(existing.overrides || '[]') : body.overrides;
  const oerr = svc.validateOverrides(ovIn);
  if (oerr.length) return res.status(400).json({ success: false, error: 'Invalid overrides', details: oerr });
  const overrides = (ovIn || []).map((o) => ({ code: String(o.code).trim(), action: o.action, reason: String(o.reason).trim() }));
  try {
    const { config, source } = svc.loadConfig(db, `${my.year}-${String(my.month).padStart(2, '0')}`);
    const result = svc.computeAttendanceReview(db, { ...my, config, releaseDays: rd.list, prevReleaseDays: prevReleaseDays(db, my.month, my.year), overrides });
    result.configSource = source;
    const snap = JSON.stringify(config); const rel = JSON.stringify(rd.list); const ov = JSON.stringify(overrides); const out = JSON.stringify(result);
    let id;
    if (existing) {
      db.prepare(`UPDATE attendance_review_runs SET config_snapshot = ?, release_days = ?, overrides = ?, result_json = ?, generated_by = ?,
        generated_at = datetime('now') WHERE id = ? AND status = 'draft'`).run(snap, rel, ov, out, user(req), existing.id);
      id = existing.id;
    } else {
      id = db.prepare(`INSERT INTO attendance_review_runs (month, year, status, config_snapshot, release_days, overrides, result_json, generated_by)
        VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)`).run(my.month, my.year, snap, rel, ov, out, user(req)).lastInsertRowid;
    }
    logAudit('attendance_review_runs', id, 'status', existing ? 'draft' : '', 'draft', 'ATTENDANCE_REVIEW_RUN',
      `${existing ? 'regenerated' : 'generated'} ${my.year}-${my.month}; release days ${rel}; ${overrides.length} override(s)`, user(req));
    const row = db.prepare('SELECT * FROM attendance_review_runs WHERE id = ?').get(id);
    res.status(existing ? 200 : 201).json({ success: true, data: { ...runSummary(row), result } });
  } catch (err) {
    console.error('Attendance review run error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate attendance review: ' + err.message });
  }
});

// GET /runs — list (no result payload)
router.get('/runs', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM attendance_review_runs ORDER BY year DESC, month DESC').all();
  res.json({ success: true, data: rows.map(runSummary) });
});

// GET /runs/:id — one run with its stored result
router.get('/runs/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = Number.isInteger(id) ? getDb().prepare('SELECT * FROM attendance_review_runs WHERE id = ?').get(id) : null;
  if (!row) return res.status(404).json({ success: false, error: 'Run not found' });
  res.json({ success: true, data: { ...runSummary(row), config_snapshot: JSON.parse(row.config_snapshot), result: JSON.parse(row.result_json) } });
});

// GET /runs/:id/export.xlsx | /runs/:id/export.docx — files built from the STORED result (what was reviewed/finalised)
function loadRunForExport(req, res) {
  const id = parseInt(req.params.id, 10);
  const row = Number.isInteger(id) ? getDb().prepare('SELECT * FROM attendance_review_runs WHERE id = ?').get(id) : null;
  if (!row) { res.status(404).json({ success: false, error: 'Run not found' }); return null; }
  return { row, result: JSON.parse(row.result_json) };
}
router.get('/runs/:id/export.xlsx', (req, res) => {
  const r = loadRunForExport(req, res); if (!r) return;
  try {
    const buf = exportsSvc.buildWorkbook(r.result, r.row);
    const name = `Attendance_Review_${exportsSvc.fileStem(r.result)}${r.row.status === 'final' ? '' : '_DRAFT'}.xlsx`;
    logAudit('attendance_review_runs', r.row.id, 'export', '', 'xlsx', 'ATTENDANCE_REVIEW_EXPORT', name, user(req));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (err) {
    console.error('Attendance review xlsx export error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to build the workbook: ' + err.message });
  }
});
router.get('/runs/:id/export.docx', async (req, res) => {
  const r = loadRunForExport(req, res); if (!r) return;
  try {
    const buf = await exportsSvc.buildDocx(r.result, r.row);
    const name = `${exportsSvc.fileStem(r.result)}_Late_Early_Action_Notes${r.row.status === 'final' ? '' : '_DRAFT'}.docx`;
    logAudit('attendance_review_runs', r.row.id, 'export', '', 'docx', 'ATTENDANCE_REVIEW_EXPORT', name, user(req));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (err) {
    console.error('Attendance review docx export error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to build the Word file: ' + err.message });
  }
});

// PUT /runs/:id/finalise — lock a draft
router.put('/runs/:id/finalise', (req, res) => {
  const id = parseInt(req.params.id, 10); const db = getDb();
  const row = Number.isInteger(id) ? db.prepare('SELECT * FROM attendance_review_runs WHERE id = ?').get(id) : null;
  if (!row) return res.status(404).json({ success: false, error: 'Run not found' });
  if (row.status === 'final') return res.status(409).json({ success: false, error: 'Run is already final' });
  const info = db.prepare("UPDATE attendance_review_runs SET status = 'final', finalised_by = ?, finalised_at = datetime('now') WHERE id = ? AND status = 'draft'").run(user(req), id);
  if (!info.changes) return res.status(409).json({ success: false, error: 'Run changed meanwhile; reload' });
  logAudit('attendance_review_runs', id, 'status', 'draft', 'final', 'ATTENDANCE_REVIEW_RUN', `finalised ${row.year}-${row.month}`, user(req));
  res.json({ success: true, data: runSummary(db.prepare('SELECT * FROM attendance_review_runs WHERE id = ?').get(id)) });
});

module.exports = router;

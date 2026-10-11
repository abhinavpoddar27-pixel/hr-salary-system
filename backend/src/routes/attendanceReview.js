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

// GET /trends?from=YYYY-MM&to=YYYY-MM[&live=0] — one row per month (≤ 12) for the Trends charts. Each month comes from its
// FINAL run, else its DRAFT, else (unless live=0) a live computation with that month's rules, release days as detected and
// no overrides — labelled by source so the screen can say which is which. Months with no attendance are left out. Read only.
const TREND_MAX = 12;
function parseYm(v) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v || ''));
  return m ? parseMonth({ year: m[1], month: m[2] }) : null;
}
router.get('/trends', (req, res) => {
  const from = parseYm(req.query.from); const to = parseYm(req.query.to);
  if (!from || !to) return res.status(400).json({ success: false, error: 'from and to are required as YYYY-MM' });
  const months = svc.monthRange(from, to);
  if (!months.length) return res.status(400).json({ success: false, error: 'from must not be after to' });
  if (months.length > TREND_MAX) return res.status(400).json({ success: false, error: `At most ${TREND_MAX} months at a time` });
  const allowLive = req.query.live !== '0';
  try {
    const db = getDb();
    const runQ = db.prepare('SELECT id, status, result_json FROM attendance_review_runs WHERE month = ? AND year = ?');
    const hasData = db.prepare('SELECT 1 FROM attendance_processed WHERE month = ? AND year = ? LIMIT 1');
    const rows = []; const skipped = [];
    for (const { month, year } of months) {
      const ym = `${year}-${String(month).padStart(2, '0')}`;
      const run = runQ.get(month, year);
      if (run) {
        let result; try { result = JSON.parse(run.result_json); } catch { result = null; }
        if (result) { rows.push(svc.trendRow(result, { month, year, source: run.status, run_id: run.id })); continue; }
      }
      if (!hasData.get(month, year)) { skipped.push({ ym, reason: 'no attendance' }); continue; }
      if (!allowLive) { skipped.push({ ym, reason: 'no review run' }); continue; }
      const { config } = svc.loadConfig(db, ym);
      const cfg = svc.mergeConfig(config);
      const rd = svc.detectReleaseDays(db, month, year, cfg).map((d) => d.date);
      const result = svc.computeAttendanceReview(db, { month, year, config, releaseDays: rd, prevReleaseDays: prevReleaseDays(db, month, year) });
      if (!result.meta.people_assessed) { skipped.push({ ym, reason: 'no one assessed' }); continue; }
      rows.push(svc.trendRow(result, { month, year, source: 'live' }));
    }
    res.json({ success: true, data: { from: months[0], to: months[months.length - 1], months: rows, skipped, repeaters: svc.repeaters(rows) } });
  } catch (err) {
    console.error('Attendance review trends error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute trends: ' + err.message });
  }
});

// ── notice board (PR-5) ──────────────────────────────────────────────────────────────────────────
// GET  /board?month&year&to=YYYY-MM-DD[&company][&skipDays=a,b] — the board as it would print + this month's print history
// POST /board/prints { month, year, to, company?, skipDays? } — recomputes, records the print (audit_log), returns what to print
const BOARD_TABLE = 'attendance_review_board';
function parseBoard(src) {
  const my = parseMonth(src); if (!my) return { error: 'month and year required' };
  const ym = `${my.year}-${String(my.month).padStart(2, '0')}`;
  const to = src.to || `${ym}-15`;
  if (typeof to !== 'string' || !ISO.test(to) || to.slice(0, 7) !== ym || to.slice(8) < '01' || to.slice(8) > String(svc.daysInMonth(my.month, my.year))) {
    return { error: `to must be a date in ${ym}` };
  }
  const sd = parseReleaseDays(src.skipDays, my.month, my.year); if (sd.error) return { error: sd.error.replace('release day', 'skip day') };
  const company = src.company && String(src.company).trim() ? String(src.company).trim() : null;
  return { ...my, ym, to, company, skipDays: sd.list };
}
function boardPrints(db, month, year) {
  return db.prepare(`SELECT id, changed_by, changed_at, new_value, remark FROM audit_log
    WHERE table_name = ? AND record_id = ? AND stage = 'ATTENDANCE_REVIEW_BOARD_PRINT' ORDER BY id DESC`).all(BOARD_TABLE, year * 100 + month)
    .map((r) => { let s = {}; try { s = JSON.parse(r.new_value); } catch { s = {}; }
      return { id: r.id, printed_by: r.changed_by, printed_at: r.changed_at, to: s.to, covered_to: s.covered_to, company: s.company || null,
        listed: (s.listed || []).length, spotless: (s.spotless || []).length }; });
}
function buildBoard(db, b) {
  const { config } = svc.loadConfig(db, b.ym);
  return svc.noticeBoard(db, { month: b.month, year: b.year, to: b.to, config, company: b.company, skipDays: b.skipDays });
}
router.get('/board', (req, res) => {
  const b = parseBoard(req.query); if (b.error) return res.status(400).json({ success: false, error: b.error });
  try {
    const db = getDb();
    res.json({ success: true, data: { ...buildBoard(db, b), prints: boardPrints(db, b.month, b.year) } });
  } catch (err) {
    console.error('Attendance review board error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to build the notice board: ' + err.message });
  }
});
router.post('/board/prints', (req, res) => {
  const b = parseBoard(req.body || {}); if (b.error) return res.status(400).json({ success: false, error: b.error });
  try {
    const db = getDb();
    const board = buildBoard(db, b);
    if (!board.meta.last_data_date) return res.status(409).json({ success: false, error: 'No attendance for this period yet — nothing to print' });
    const snap = JSON.stringify(svc.boardSnapshot(board));
    const remark = `Notice board ${board.meta.from}..${board.meta.covered_to}${board.meta.company ? ` (${board.meta.company})` : ''}: ${board.counts.listed} named, ${board.counts.spotless} on time every day`;
    // direct insert (not logAudit, which swallows errors): a print that was not recorded must not be printed
    const info = db.prepare(`INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark)
      VALUES (?, ?, 'board_print', '', ?, ?, 'ATTENDANCE_REVIEW_BOARD_PRINT', ?)`).run(BOARD_TABLE, b.year * 100 + b.month, snap, user(req), remark);
    const row = db.prepare('SELECT changed_at FROM audit_log WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ success: true, data: { print_id: info.lastInsertRowid, printed_at: row.changed_at, printed_by: user(req),
      number: boardPrints(db, b.month, b.year).length, board } });
  } catch (err) {
    console.error('Attendance review board print error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to record the print: ' + err.message });
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
  const json = JSON.stringify(svc.toStoredConfig(config));   // older code / department lists are kept as standing rules
  const info = db.prepare('INSERT INTO attendance_review_config (effective_from, config_json, updated_by) VALUES (?, ?, ?)').run(ef, json, user(req));
  logAudit('attendance_review_config', info.lastInsertRowid, 'config_json', prev.source ? `v${prev.source.id}` : 'defaults', json, 'ATTENDANCE_REVIEW_CONFIG', `effective ${ef}`, user(req));
  res.json({ success: true, data: { id: info.lastInsertRowid, effective_from: ef } });
});

// POST /suggestions { month, year, accept:[key], dismiss:[key], releaseDays?, overrides? }
// Applies the month's suggestions as ONE new rules version effective that month. Refused (409) when a later-effective version
// exists, so a change for September never silently loses to (or overrides) an October version. Nothing payroll is written.
router.post('/suggestions', (req, res) => {
  const body = req.body || {};
  const my = parseMonth(body); if (!my) return res.status(400).json({ success: false, error: 'month and year required' });
  const accept = Array.isArray(body.accept) ? body.accept.map(String) : [];
  const dismiss = Array.isArray(body.dismiss) ? body.dismiss.map(String) : [];
  if (!accept.length && !dismiss.length) return res.status(400).json({ success: false, error: 'Nothing to apply — tick a suggestion first' });
  const both = accept.filter((k) => dismiss.includes(k));
  if (both.length) return res.status(400).json({ success: false, error: `Accepted and dismissed at once: ${both.join(', ')}` });
  const rd = parseReleaseDays(body.releaseDays, my.month, my.year); if (rd.error) return res.status(400).json({ success: false, error: rd.error });
  const db = getDb();
  const ym = `${my.year}-${String(my.month).padStart(2, '0')}`;
  const later = db.prepare('SELECT id, effective_from FROM attendance_review_config WHERE effective_from > ? ORDER BY effective_from LIMIT 1').get(ym);
  if (later) return res.status(409).json({ success: false, error: `A later rules version (v${later.id}, effective ${later.effective_from}) exists — open that month to apply suggestions` });
  try {
    const row = db.prepare('SELECT id, config_json FROM attendance_review_config WHERE effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1').get(ym);
    let stored = {}; if (row) { try { stored = JSON.parse(row.config_json); } catch { stored = {}; } }
    const { config } = svc.loadConfig(db, ym);
    const result = svc.computeAttendanceReview(db, { ...my, config, releaseDays: rd.list, prevReleaseDays: prevReleaseDays(db, my.month, my.year), overrides: [] });
    const out = svc.applySuggestions(stored, result.suggestions, { accept, dismiss, by: user(req) });
    if (out.unknown.length) return res.status(409).json({ success: false, error: 'Some suggestions are no longer shown (already applied or changed) — refresh and try again', details: out.unknown });
    const errs = svc.validateConfig(out.config);
    if (errs.length) return res.status(400).json({ success: false, error: 'Invalid config', details: errs });
    const json = JSON.stringify(out.config);
    const info = db.prepare('INSERT INTO attendance_review_config (effective_from, config_json, updated_by) VALUES (?, ?, ?)').run(ym, json, user(req));
    logAudit('attendance_review_config', info.lastInsertRowid, 'config_json', row ? `v${row.id}` : 'defaults', json, 'ATTENDANCE_REVIEW_SUGGESTIONS',
      `effective ${ym}; accepted ${accept.join(', ') || '-'}; dismissed ${dismiss.join(', ') || '-'}`, user(req));
    res.json({ success: true, data: { id: info.lastInsertRowid, effective_from: ym, accepted: accept.length, dismissed: dismiss.length } });
  } catch (err) {
    console.error('Attendance review suggestions error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to apply suggestions: ' + err.message });
  }
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

// POST /runs/:id/send-to-finance — FINAL runs only. Writes one PENDING late_coming_deductions row per deduction on the
// action list (finance approves it in the usual queue; Stage 7 applies approved rows). Never overwrites: a person who already
// has a pending or approved row for that month is skipped and listed. A second click creates nothing. Audited.
router.post('/runs/:id/send-to-finance', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();
  const run = Number.isInteger(id) ? db.prepare('SELECT * FROM attendance_review_runs WHERE id = ?').get(id) : null;
  if (!run) return res.status(404).json({ success: false, error: 'Run not found' });
  if (run.status !== 'final') return res.status(409).json({ success: false, error: 'Finalise the review first — only a final review can be sent to finance' });
  try {
    const plan = svc.financeSendPlan(db, run);
    const ins = db.prepare(`INSERT INTO late_coming_deductions
      (employee_code, employee_id, month, year, company, late_count, deduction_days, remark, applied_by, finance_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`);
    const created = [];
    db.transaction(() => {
      for (const c of plan.create) {
        const info = ins.run(c.code, c.employee_id, run.month, run.year, c.company, c.late_count, c.deduction_days, c.remark, user(req));
        created.push({ ...c, id: info.lastInsertRowid });
        logAudit('late_coming_deductions', info.lastInsertRowid, 'deduction_applied', '', `${c.deduction_days} days`, 'ATTENDANCE_REVIEW_SEND',
          `Sent from Attendance Review run ${run.id} (${run.year}-${run.month}) — pending finance review`, user(req));
      }
    })();
    res.json({ success: true, data: { created: created.map(({ code, name, deduction_days, contractor, id: rowId }) => ({ code, name, deduction_days, contractor, id: rowId })),
      skipped: plan.skipped, status: svc.financeStatus(db, run) } });
  } catch (err) {
    console.error('Attendance review send-to-finance error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to send to finance: ' + err.message });
  }
});

// GET /runs/:id/finance — where the run's deductions are (pending / approved / rejected / in salary) + rows entered outside it
router.get('/runs/:id/finance', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();
  const run = Number.isInteger(id) ? db.prepare('SELECT * FROM attendance_review_runs WHERE id = ?').get(id) : null;
  if (!run) return res.status(404).json({ success: false, error: 'Run not found' });
  res.json({ success: true, data: { ...svc.financeStatus(db, run), preview: run.status === 'final' ? svc.financeSendPlan(db, run) : null } });
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

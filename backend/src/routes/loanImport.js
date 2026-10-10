/**
 * Loans PR-10 — import of the loans run outside the app (accounts Excel).
 * Mounted in server.js BEFORE /api/loans as
 *   app.use('/api/loans/import', requireAuth, require('./src/routes/loanImport'));
 * Engine: services/loans/importer.js. Roles (SPEC §7 last row, re-checked by
 * the engine): HR or finance upload; HR confirms each name match; finance
 * confirms each balance; the admin approves the batch (never one they
 * uploaded or confirmed rows in). Viewers read. Allowed while the disbursement
 * gate is '0' — an import pays nothing out (coordinator ruling Q1).
 */
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { getDb } = require('../database/db');
const { normalizeRole } = require('./auth');
const L = require('../services/loans');

const READ_ROLES = ['admin', 'hr', 'finance', 'viewer'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls)$/i.test(file.originalname || '');
    cb(ok ? null : new Error('Only .xlsx or .xls files are accepted'), ok);
  },
});

const STATUS_403 = new Set(['ACTOR_REQUIRED', 'ROLE_NOT_ALLOWED', 'SELF_APPROVAL', 'NOT_UPLOADER', 'COMPANY_NOT_ALLOWED', 'ADMIN_CANNOT_UPLOAD']);
const STATUS_409 = new Set(['CONCURRENT_CHANGE', 'IMPORT_FILE_ALREADY_UPLOADED', 'BATCH_NOT_IN_REVIEW']);
const httpStatus = (code) => (STATUS_403.has(code) ? 403 : STATUS_409.has(code) ? 409 : /_NOT_FOUND$/.test(code) ? 404 : 400);

function refuse(res, r) {
  const body = { success: false, code: r.code, error: r.message || r.error || r.code };
  for (const k of ['blockers', 'batchId', 'earliest', 'payroll', 'errors', 'rowNo', 'headers', 'mapping', 'autoMapping', 'fields', 'balanceColumns']) if (r[k] !== undefined) body[k] = r[k];
  return res.status(httpStatus(r.code)).json(body);
}

function reply(res, r, status = 200) {
  if (!r || r.ok === false) return refuse(res, r || { code: 'UNKNOWN', message: 'no result' });
  const { ok: _ok, ...data } = r;
  return res.status(status).json({ success: true, data });
}

const handle = (fn) => (req, res) => {
  try {
    return fn(req, res);
  } catch (e) {
    console.error(`[loan-import] ${req.method} ${req.originalUrl} failed:`, e.message);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', error: 'the import request could not be completed' });
  }
};

function allow(roles, { adminUpload = false } = {}) {
  return (req, res, next) => {
    const role = normalizeRole(req.user && req.user.role);
    const username = String((req.user && req.user.username) || '').trim();
    if (adminUpload && role === 'admin') {
      return res.status(403).json({ success: false, code: 'ADMIN_CANNOT_UPLOAD', error: 'HR or finance uploads the import; the admin approves it' });
    }
    if (!username || !roles.includes(role)) return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', error: `${role} cannot do this` });
    req.actor = { username, role };
    return next();
  };
}

const companies = (req) => (req.user && Array.isArray(req.user.allowedCompanies) && req.user.allowedCompanies.length ? req.user.allowedCompanies : null);
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/** multer wrapper that turns its errors into a 400 instead of Express's HTML error page. */
const fileUpload = (req, res, next) => upload.single('file')(req, res, (err) => {
  if (err) return res.status(400).json({ success: false, code: 'FILE_INVALID', error: err.message });
  return next();
});

function bodyMapping(req) {
  const m = req.body && req.body.mapping;
  if (!m) return { ok: true, mapping: null };
  if (typeof m === 'object') return { ok: true, mapping: m };
  try { return { ok: true, mapping: JSON.parse(m) }; } catch (e) { return { ok: false, code: 'MAPPING_INVALID', message: 'mapping must be JSON' }; }
}

function notify(db, roleTarget, type, message, link = '/loans?tab=import') {
  try {
    db.prepare('INSERT INTO notifications (role_target, type, title, message, link, action_url) VALUES (?, ?, ?, ?, ?, ?)')
      .run(roleTarget, type, message, message, link, link);
  } catch (e) {
    console.warn('[loan-import] notification failed:', e.message);
  }
}

/** After a confirmation: when the batch has no blocker left, tell the admin once (best effort). */
function notifyIfReady(db, batchId) {
  try {
    const d = L.batchDetail(db, batchId);
    if (d.ok && d.approval.canApprove) {
      const already = db.prepare("SELECT 1 FROM notifications WHERE type = 'LOAN_IMPORT_READY' AND message LIKE ?").get(`Loan import batch #${batchId} %`);
      if (!already) notify(db, 'admin', 'LOAN_IMPORT_READY', `Loan import batch #${batchId} is ready for approval (${d.approval.totals.loans} loans, ₹${d.approval.totals.outstanding})`);
    }
  } catch (e) { /* best effort */ }
}

// ── routes ───────────────────────────────────────────────────────────────────

router.get('/template', allow(['hr', 'finance', 'admin']), handle((req, res) => {
  const buf = L.buildImportTemplate();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="loan_import_template.xlsx"');
  return res.send(buf);
}));

router.post('/parse', allow(['hr', 'finance'], { adminUpload: true }), fileUpload, handle((req, res) => {
  if (!req.file) return refuse(res, { code: 'FILE_REQUIRED', message: 'an .xlsx file is required (field "file")' });
  const m = bodyMapping(req);
  if (!m.ok) return refuse(res, m);
  return reply(res, L.previewImport(getDb(), { buffer: req.file.buffer, mapping: m.mapping, defaultCompany: req.body.defaultCompany || null }));
}));

router.post('/batches', allow(['hr', 'finance'], { adminUpload: true }), fileUpload, handle((req, res) => {
  const db = getDb();
  if (!req.file) return refuse(res, { code: 'FILE_REQUIRED', message: 'an .xlsx file is required (field "file")' });
  const m = bodyMapping(req);
  if (!m.ok) return refuse(res, m);
  const r = L.createBatch(db, { fileName: req.file.originalname, buffer: req.file.buffer, mapping: m.mapping, defaultCompany: req.body.defaultCompany || null },
    req.actor, { companies: companies(req) });
  if (r.ok) {
    const msg = `Loan import batch #${r.batchId} uploaded by ${req.actor.username}: ${r.counts.rows} rows to review (HR confirms names, finance confirms balances)`;
    notify(db, 'hr', 'LOAN_IMPORT_UPLOADED', msg);
    notify(db, 'finance', 'LOAN_IMPORT_UPLOADED', msg);
  }
  return reply(res, r, 201);
}));

/**
 * Per-payroll cutover months from a body / query: plantCutoverMonth/Year and
 * salesCutoverMonth/Year; a single cutoverMonth/Year applies to both.
 */
function cutoverFrom(src = {}) {
  const m = (k) => {
    const month = posInt(src[`${k}Month`]); const year = posInt(src[`${k}Year`]);
    return month && year ? { month, year } : null;
  };
  return L.pickCutover({ plant: m('plantCutover'), sales: m('salesCutover'), both: m('cutover') });
}

router.get('/batches', allow(READ_ROLES), handle((req, res) => reply(res, L.listBatches(getDb(), { companies: companies(req) }))));

router.get('/batches/:id', allow(READ_ROLES), handle((req, res) => {
  const id = posInt(req.params.id);
  if (!id) return refuse(res, { code: 'BATCH_NOT_FOUND', message: 'batch not found' });
  return reply(res, L.batchDetail(getDb(), id, { companies: companies(req), cutover: cutoverFrom(req.query) }));
}));

router.post('/batches/:id/rows/:rid/match', allow(['hr']), handle((req, res) => {
  const db = getDb();
  const b = req.body || {};
  const r = L.confirmMatch(db, { batchId: posInt(req.params.id), rowId: posInt(req.params.rid), borrowerType: b.borrowerType, employeeCode: b.employeeCode, company: b.company, note: b.note },
    req.actor, { companies: companies(req) });
  if (r.ok) notifyIfReady(db, posInt(req.params.id));
  return reply(res, r);
}));

router.post('/batches/:id/rows/:rid/exclude', allow(['hr']), handle((req, res) => {
  const db = getDb();
  const r = L.excludeRow(db, { batchId: posInt(req.params.id), rowId: posInt(req.params.rid), reason: (req.body || {}).reason }, req.actor, { companies: companies(req) });
  if (r.ok) notifyIfReady(db, posInt(req.params.id));
  return reply(res, r);
}));

router.post('/batches/:id/rows/:rid/balance', allow(['finance']), handle((req, res) => {
  const db = getDb();
  const b = req.body || {};
  const r = L.confirmBalance(db, { batchId: posInt(req.params.id), rowId: posInt(req.params.rid), outstanding: b.outstanding, emi: b.emi, note: b.note },
    req.actor, { companies: companies(req) });
  if (r.ok) notifyIfReady(db, posInt(req.params.id));
  return reply(res, r);
}));

/** Re-choose the outstanding / EMI columns of a batch in review (uploader or admin); resets finance confirmations. */
router.post('/batches/:id/columns', allow(['hr', 'finance', 'admin']), handle((req, res) => {
  const b = req.body || {};
  return reply(res, L.remapColumns(getDb(), { batchId: posInt(req.params.id), outstanding: b.outstanding, emi: b.emi }, req.actor, { companies: companies(req) }));
}));

router.post('/batches/:id/approve', allow(['admin']), handle((req, res) => {
  const db = getDb();
  const b = req.body || {};
  const r = L.approveBatch(db, { batchId: posInt(req.params.id), cutover: cutoverFrom(b), note: b.note }, req.actor, { companies: companies(req) });
  if (r.ok) {
    const s7 = r.stage7Computed.length ? ` Re-run Stage 7 / sales compute for ${r.stage7Computed.length} borrower(s) before the bank file.` : '';
    const msg = `Loan import batch #${r.batchId} approved: ${r.loans.length} loans imported, first EMI ${L.cutoverLabel(r.cutover)}.${s7}`;
    notify(db, 'hr', 'LOAN_IMPORT_APPROVED', msg);
    notify(db, 'finance', 'LOAN_IMPORT_APPROVED', msg);
  }
  return reply(res, r, 201);
}));

router.post('/batches/:id/discard', allow(['hr', 'finance', 'admin']), handle((req, res) => (
  reply(res, L.discardBatch(getDb(), { batchId: posInt(req.params.id), reason: (req.body || {}).reason }, req.actor, { companies: companies(req) }))
)));

router.get('/batches/:id/cutover-check', allow(READ_ROLES), handle((req, res) => {
  const q = req.query;
  const c = cutoverFrom({ plantCutoverMonth: q.plantMonth, plantCutoverYear: q.plantYear, salesCutoverMonth: q.salesMonth, salesCutoverYear: q.salesYear });
  const r = L.cutoverCheck(getDb(), posInt(req.params.id), { month: posInt(q.month), year: posInt(q.year), plant: c.plant, sales: c.sales, companies: companies(req) });
  if (r.ok && req.query.format === 'xlsx') {
    const tag = ['plant', 'sales'].filter((p) => r.months[p]).map((p) => `${p}-${r.months[p].year}-${String(r.months[p].month).padStart(2, '0')}`).join('_') || 'none';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="loan_import_${r.batchId}_cutover_${tag}.xlsx"`);
    return res.send(L.cutoverCheckXlsx(r));
  }
  return reply(res, r);
}));

module.exports = router;

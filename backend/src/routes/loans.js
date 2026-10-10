/**
 * Loans API (Loans PR-3) — rebuilt on the engine in services/loans/.
 * Spec: docs/loans/SPEC.md §7 (roles), §5.2; rulings in docs/loans/PROGRESS.md.
 *
 * Mounted in server.js as `app.use('/api/loans', requireAuth, …)`. Every route
 * below has its own role guard, and the engine re-checks the actor
 * (checkActor) — the server enforces every cell of the §7 matrix:
 *
 *   HR / finance raise loans and change requests. The admin approves every
 *   loan, defer, restructure and write-off and never their own — and, with no
 *   backup approver, the admin cannot RAISE either (ADMIN_CANNOT_RAISE,
 *   coordinator ruling B). Finance (or admin) records disbursements and
 *   receipts. Viewers read. Supervisors and employees get nothing here.
 *
 * Disbursement is gated by policy_config.loans_disbursement_enabled ('0' until
 * Stage 7 + the loan close can recover the money — ruling A); PUT /policy can
 * never change that key.
 *
 * The engine is given {username, role: normalizeRole(...)}. normalizeRole can
 * never return 'system', so a user cannot act as the engine's automatic actor.
 */
const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { normalizeRole } = require('./auth');
const L = require('../services/loans');
const { toPaise, toRupees } = require('../services/loans/money');
const { todayIst } = require('../services/loans/months');
const { runLoanDryRun, rehearsalPack } = require('../services/loans/dryRun');

const READ_ROLES = ['admin', 'hr', 'finance', 'viewer'];
const RAISE_ROLES = ['hr', 'finance'];
const DECIDE_ROLES = ['admin'];
const PAY_ROLES = ['finance', 'admin'];

const ADMIN_CANNOT_RAISE = { code: 'ADMIN_CANNOT_RAISE', error: 'HR raises loans; admin approves' };

// ── helpers ──────────────────────────────────────────────────────────────────

const STATUS_403 = new Set(['ACTOR_REQUIRED', 'ROLE_NOT_ALLOWED', 'SELF_APPROVAL', 'SELF_DISBURSEMENT',
  'NOT_REQUESTER', 'ADMIN_CANNOT_RAISE', 'COMPANY_NOT_ALLOWED']);
const STATUS_409 = new Set(['CONCURRENT_CHANGE', 'REQUEST_ALREADY_PENDING', 'REQUEST_NOT_PENDING', 'DISBURSEMENT_DISABLED', 'ALREADY_CLOSED']);

function httpStatus(code) {
  if (STATUS_403.has(code)) return 403;
  if (STATUS_409.has(code)) return 409;
  if (/_NOT_FOUND$/.test(code)) return 404;
  return 400;
}

function refuse(res, r) {
  const body = { success: false, code: r.code, error: r.message || r.error || r.code };
  if (r.refusals) body.refusals = r.refusals;
  if (r.warnings) body.warnings = r.warnings;
  return res.status(httpStatus(r.code)).json(body);
}

function reply(res, r, status = 200) {
  if (!r || r.ok === false) return refuse(res, r || { code: 'UNKNOWN', message: 'no result' });
  const { ok: _ok, ...data } = r;
  return res.status(status).json({ success: true, data });
}

/** Wraps a handler: unexpected exceptions → 500 with a generic message (no SQL text). */
const handle = (fn) => (req, res) => {
  try {
    return fn(req, res);
  } catch (e) {
    console.error(`[loans] ${req.method} ${req.originalUrl} failed:`, e.message);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', error: 'the loan request could not be completed' });
  }
};

/** Role guard. Sets req.actor for the engine. */
function allow(roles, { adminRaise = false } = {}) {
  return (req, res, next) => {
    const role = normalizeRole(req.user && req.user.role);
    const username = String((req.user && req.user.username) || '').trim();
    if (adminRaise && role === 'admin') return res.status(403).json({ success: false, ...ADMIN_CANNOT_RAISE });
    if (!username || !roles.includes(role)) {
      return res.status(403).json({ success: false, code: 'ROLE_NOT_ALLOWED', error: `${role} cannot do this` });
    }
    req.actor = { username, role };
    return next();
  };
}

const allowedCompanies = (req) => (req.user && Array.isArray(req.user.allowedCompanies) && req.user.allowedCompanies.length
  ? req.user.allowedCompanies : null);

function companyAllowed(req, company) {
  const ac = allowedCompanies(req);
  return !ac || ac.includes(company);
}

/** SQL fragment restricting loans (alias l) to the user's companies. */
function companyClause(req, alias = 'l') {
  const ac = allowedCompanies(req);
  if (!ac) return { sql: '', args: [] };
  return { sql: ` AND ${alias}.company IN (${ac.map(() => '?').join(',')})`, args: ac };
}

const posInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

function text(v) { return String(v == null ? '' : v).trim(); }

const notAllowedCompany = { code: 'COMPANY_NOT_ALLOWED', message: 'you do not have access to this company' };

/** Loads loan :id, 404 / 403 handled. Returns the row, or null when a response was sent. */
function loadLoan(req, res, db) {
  const id = posInt(req.params.id);
  const loan = id && L.getLoan(db, id);
  if (!loan) { refuse(res, { code: 'LOAN_NOT_FOUND', message: `loan ${req.params.id} not found` }); return null; }
  if (!companyAllowed(req, loan.company)) { refuse(res, notAllowedCompany); return null; }
  return loan;
}

/** Signed-agreement reference (ruling Q4): free text, 3–200 characters. No upload in PR-3. */
function checkAgreementRef(v) {
  const s = text(v);
  if (!s) return { ok: false, code: 'AGREEMENT_REQUIRED', message: 'give the signed agreement reference before disbursement' };
  if (s.length < 3 || s.length > 200) return { ok: false, code: 'AGREEMENT_REF_INVALID', message: 'the agreement reference must be 3–200 characters' };
  return { ok: true, value: s };
}

/**
 * Best-effort notification after the change is committed; never fails the route.
 * Written directly (not monthEndScheduler.createNotification): that helper
 * de-duplicates on type + message per day across ALL roles, so the same
 * message to finance and to hr would reach only the first.
 */
function notify(db, roleTarget, type, message, link = '/loans') {
  try {
    db.prepare('INSERT INTO notifications (role_target, type, title, message, link, action_url) VALUES (?, ?, ?, ?, ?, ?)')
      .run(roleTarget, type, message, message, link, link);
  } catch (e) {
    console.warn('[loans] notification failed:', e.message);
  }
}

const rs = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

function borrowerName(db, loan) {
  try {
    const r = loan.borrower_type === 'sales'
      ? db.prepare('SELECT name FROM sales_employees WHERE code = ? AND company = ?').get(loan.employee_code, loan.company)
      : db.prepare('SELECT name, department FROM employees WHERE code = ?').get(loan.employee_code);
    return r || {};
  } catch (e) {
    return {};
  }
}

const LIST_SQL = `
  SELECT l.*,
         CASE WHEN l.borrower_type = 'sales'
              THEN (SELECT s.name FROM sales_employees s WHERE s.code = l.employee_code AND s.company = l.company)
              ELSE (SELECT e.name FROM employees e WHERE e.code = l.employee_code) END AS employee_name,
         CASE WHEN l.borrower_type = 'plant'
              THEN (SELECT e.department FROM employees e WHERE e.code = l.employee_code) END AS department,
         CAST(julianday('now') - julianday(l.requested_at) AS INTEGER) AS waiting_days,
         (SELECT r.kind FROM loan_requests r WHERE r.loan_id = l.id AND r.status = 'pending') AS pending_request
    FROM loans l
   WHERE 1 = 1`;

function istMonth() {
  const [y, m] = todayIst().split('-').map(Number);
  return { month: m, year: y };
}

const daysSince = (ts) => Math.floor((Date.now() - new Date(`${String(ts).replace(' ', 'T')}Z`).getTime()) / 86400000);

// ── retired endpoints (410 Gone, like P3). Declared before /:id. ─────────────

function retired(replacement) {
  return (req, res) => res.status(410).json({
    success: false,
    code: 'ENDPOINT_RETIRED',
    error: `This endpoint has been retired (Loans PR-3). ${replacement}`,
  });
}
router.all('/process-deductions', retired('Loan EMIs are deducted by Stage 7 and posted at the monthly loan close.'));
router.all('/deductions', retired('Use GET /api/loans/due?month=&year=.'));
router.all('/monthly-recovery/:month/:year', retired('Use GET /api/loans/due?month=&year=.'));
router.all('/:id/recover', retired('Record a numbered cash receipt: POST /api/loans/:id/receipts.'));
router.all('/:id/skip', retired('Raise a defer request: POST /api/loans/:id/requests with kind "defer".'));
router.all('/:id/close', retired('Raise a write-off request: POST /api/loans/:id/requests with kind "write_off".'));

// ── reads ────────────────────────────────────────────────────────────────────

router.get('/', allow(READ_ROLES), handle((req, res) => {
  const db = getDb();
  const where = [];
  const args = [];
  for (const [param, col] of [['status', 'status'], ['company', 'company'], ['employeeCode', 'employee_code'], ['borrowerType', 'borrower_type']]) {
    if (text(req.query[param])) { where.push(` AND l.${col} = ?`); args.push(text(req.query[param])); }
  }
  const cc = companyClause(req);
  const rows = db.prepare(`${LIST_SQL}${where.join('')}${cc.sql} ORDER BY l.requested_at DESC, l.id DESC`).all(...args, ...cc.args);
  res.json({ success: true, data: rows });
}));

router.get('/stats', allow(READ_ROLES), handle((req, res) => {
  const db = getDb();
  const cc = companyClause(req);
  const companyFilter = text(req.query.company) ? { sql: ' AND l.company = ?', args: [text(req.query.company)] } : { sql: '', args: [] };
  const m = posInt(req.query.month) && posInt(req.query.year) ? { month: posInt(req.query.month), year: posInt(req.query.year) } : istMonth();
  const scope = `${companyFilter.sql}${cc.sql}`;
  const scopeArgs = [...companyFilter.args, ...cc.args];
  const byStatus = Object.fromEntries(db.prepare(`SELECT l.status, COUNT(*) AS n FROM loans l WHERE 1 = 1${scope} GROUP BY l.status`)
    .all(...scopeArgs).map((r) => [r.status, r.n]));
  const outstanding = db.prepare(`SELECT COALESCE(SUM(l.remaining_balance), 0) AS v FROM loans l WHERE l.status IN ('active','recover_at_exit')${scope}`).get(...scopeArgs).v;
  const inst = (sqlWhere, extra = []) => db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(i.amount_due), 0) AS amount
      FROM loan_instalments i JOIN loans l ON l.id = i.loan_id
     WHERE l.status IN ('active','recover_at_exit') AND ${sqlWhere}${scope}`).get(...extra, ...scopeArgs);
  const due = inst("i.due_month = ? AND i.due_year = ? AND i.status IN ('scheduled','provisional')", [m.month, m.year]);
  const provisional = inst("i.status = 'provisional'");
  const deferred = inst("i.status = 'deferred'");
  const pendingChanges = db.prepare(`SELECT COUNT(*) AS n FROM loan_requests r JOIN loans l ON l.id = r.loan_id WHERE r.status = 'pending'${scope}`).get(...scopeArgs).n;
  res.json({
    success: true,
    data: {
      byStatus,
      outstanding: toRupees(toPaise(outstanding)),
      dueThisMonth: { month: m.month, year: m.year, count: due.n, amount: toRupees(toPaise(due.amount)) },
      provisional: { count: provisional.n, amount: toRupees(toPaise(provisional.amount)) },
      deferred: { count: deferred.n },
      pendingApprovals: { loans: byStatus.requested || 0, changes: pendingChanges },
      disbursementEnabled: L.disbursementEnabled(db),
    },
  });
}));

router.get('/types', allow(READ_ROLES), handle((req, res) => {
  res.json({ success: true, data: L.readLoanPolicy(getDb()).loanTypes });
}));

router.get('/policy', allow(READ_ROLES), handle((req, res) => {
  const db = getDb();
  const { warnings, ...values } = L.readLoanPolicy(db);
  const raw = Object.fromEntries(db.prepare("SELECT key, value FROM policy_config WHERE key LIKE 'loan%'").all().map((r) => [r.key, r.value]));
  res.json({
    success: true,
    data: { values, warnings, raw, editableKeys: L.POLICY_KEYS.map((k) => k.key), disbursementEnabled: L.disbursementEnabled(db) },
  });
}));

router.put('/policy', allow(DECIDE_ROLES), handle((req, res) => {
  const db = getDb();
  const values = req.body && req.body.values;
  const reason = text(req.body && req.body.reason);
  if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.keys(values).length) {
    return refuse(res, { code: 'VALUES_REQUIRED', message: 'give {values: {key: value}}' });
  }
  if (!reason) return refuse(res, { code: 'REASON_REQUIRED', message: 'a reason is required to change loan policy' });
  const checked = [];
  for (const [key, value] of Object.entries(values)) {
    if (key === L.DISBURSEMENT_GATE_KEY) {
      return refuse(res, { code: 'POLICY_KEY_LOCKED', message: `${key} is switched on at cutover only, not from the settings screen` });
    }
    const v = L.validatePolicyValue(key, value);
    if (!v.ok) return refuse(res, v);
    checked.push(v);
  }
  const changed = [];
  db.transaction(() => {
    for (const v of checked) {
      const old = db.prepare('SELECT value FROM policy_config WHERE key = ?').get(v.key);
      if (old && old.value === v.value) continue;
      if (old) db.prepare("UPDATE policy_config SET value = ?, updated_at = datetime('now') WHERE key = ?").run(v.value, v.key);
      else db.prepare('INSERT INTO policy_config (key, value) VALUES (?, ?)').run(v.key, v.value);
      db.prepare(`INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, action_type)
                  VALUES ('policy_config', NULL, ?, ?, ?, ?, 'loans', ?, 'loan_policy_change')`)
        .run(v.key, old ? old.value : '', v.value, req.actor.username, reason);
      changed.push({ key: v.key, from: old ? old.value : null, to: v.value });
    }
  })();
  return res.json({ success: true, data: { changed, warnings: L.readLoanPolicy(db).warnings } });
}));

router.get('/queue', allow(READ_ROLES), handle((req, res) => {
  const db = getDb();
  const cc = companyClause(req);
  const loans = db.prepare(`${LIST_SQL} AND l.status = 'requested'${cc.sql}
    ORDER BY CASE WHEN l.loan_type = ? THEN 0 ELSE 1 END, l.requested_at, l.id`).all(...cc.args, L.EMERGENCY_LOAN_TYPE)
    .map((l) => ({ ...l, urgent: l.loan_type === L.EMERGENCY_LOAN_TYPE }));
  const changes = L.listRequests(db, { status: 'pending' })
    .filter((r) => companyAllowed(req, r.company))
    .map((r) => ({ ...r, waiting_days: daysSince(r.requested_at) }));
  res.json({ success: true, data: { loans, changes } });
}));

router.get('/due', allow(READ_ROLES), handle((req, res) => {
  const month = posInt(req.query.month);
  const year = posInt(req.query.year);
  if (!month || month > 12 || !year) return refuse(res, { code: 'MONTH_REQUIRED', message: 'month (1–12) and year are required' });
  const db = getDb();
  const cc = companyClause(req);
  const rows = db.prepare(`
    SELECT i.id AS instalment_id, i.loan_id, i.sequence, i.due_month, i.due_year, i.amount_due, i.status, i.origin,
           l.borrower_type, l.employee_code, l.company, l.loan_type, l.status AS loan_status
      FROM loan_instalments i JOIN loans l ON l.id = i.loan_id
     WHERE i.due_month = ? AND i.due_year = ? AND l.status IN ('active','recover_at_exit')
       AND i.status IN ('scheduled','provisional','posted')${cc.sql}
     ORDER BY l.company, l.employee_code, i.sequence`).all(month, year, ...cc.args);
  const totalOpen = rows.filter((r) => r.status !== 'posted').reduce((s, r) => s + toPaise(r.amount_due), 0);
  return res.json({ success: true, data: rows, totalOpen: toRupees(totalOpen) });
}));

/**
 * Request body → engine input. Loans PR-8: sales borrowers are enabled; a sales
 * borrower is code + company (sales_employees is unique on both), so the company
 * is required up front.
 */
function loanInput(body = {}) {
  const borrowerType = text(body.borrowerType) || 'plant';
  if (borrowerType === 'sales' && !text(body.company)) {
    return { ok: false, code: 'COMPANY_REQUIRED', message: 'a sales borrower is identified by code and company; give the company' };
  }
  return {
    ok: true,
    input: {
      borrowerType, employeeCode: text(body.employeeCode), company: text(body.company), loanType: text(body.loanType),
      principal: body.principal, tenure: body.tenure, reason: body.reason, remarks: body.remarks,
    },
  };
}

router.post('/eligibility', allow(['hr', 'finance', 'admin']), handle((req, res) => {
  const db = getDb();
  const p = loanInput(req.body || {});
  if (!p.ok) return refuse(res, p);
  if (p.input.company && !companyAllowed(req, p.input.company)) return refuse(res, notAllowedCompany);
  const facts = L.loadBorrowerFacts(db, { ...p.input, asOf: todayIst() });
  const verdict = L.evaluateEligibility(facts, { ...p.input, asOf: todayIst() }, L.readLoanPolicy(db));
  const { emiPaise: _e, ...data } = verdict;
  return res.json({ success: true, data: { ...data, history: facts.history || null } });
}));

/**
 * One borrower search across both masters (SPEC §7 screen 2; Loans PR-8). Lives
 * here, not under /api/sales, because finance raises loans and cannot reach the
 * sales routes. Active only. Plant rows typed "Sales" are left out: a loan on one
 * would be deducted nowhere (SPEC §8.3) — the sales-master row is the borrower.
 */
router.get('/borrowers', allow(['hr', 'finance', 'admin']), handle((req, res) => {
  const db = getDb();
  const q = text(req.query.q);
  if (q.length < 2) return res.json({ success: true, data: [] });
  const like = `%${q}%`;
  const plant = db.prepare(`SELECT code, name, company, department, employment_type FROM employees
                             WHERE status = 'Active' AND (code LIKE ? OR name LIKE ?)
                               AND LOWER(TRIM(COALESCE(employment_type, ''))) <> 'sales'
                             ORDER BY name LIMIT 15`).all(like, like)
    .map((e) => ({ borrowerType: 'plant', code: e.code, name: e.name, company: e.company || null, department: e.department || null, employmentType: e.employment_type || null }));
  const ac = allowedCompanies(req);
  const sales = db.prepare(`SELECT code, name, company, designation, headquarters FROM sales_employees
                             WHERE status = 'Active' AND (code LIKE ? OR name LIKE ?)${ac ? ` AND company IN (${ac.map(() => '?').join(',')})` : ''}
                             ORDER BY name LIMIT 15`).all(like, like, ...(ac || []))
    .map((e) => ({ borrowerType: 'sales', code: e.code, name: e.name, company: e.company, designation: e.designation || null, headquarters: e.headquarters || null, employmentType: 'Sales' }));
  res.json({ success: true, data: [...plant, ...sales] });
}));

router.get('/employee/:code', allow(READ_ROLES), handle((req, res) => {
  const db = getDb();
  const borrowerType = text(req.query.borrowerType) || 'plant';
  const cc = companyClause(req);
  // Loans PR-8: a sales borrower is code + company — ?company narrows to one person.
  const co = text(req.query.company) ? { sql: ' AND l.company = ?', args: [text(req.query.company)] } : { sql: '', args: [] };
  const loans = db.prepare(`${LIST_SQL} AND l.employee_code = ? AND l.borrower_type = ?${co.sql}${cc.sql} ORDER BY l.requested_at DESC, l.id DESC`)
    .all(text(req.params.code), borrowerType, ...co.args, ...cc.args);
  for (const l of loans) {
    // Recovered = posted payroll deductions + cash receipts (D12: the old tab ignored cash).
    const paid = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status = 'posted' THEN posted_amount ELSE 0 END), 0) AS posted
                               FROM loan_instalments WHERE loan_id = ? AND status IN ('posted','paid_in_cash')`).get(l.id);
    const cash = db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM loan_receipts WHERE loan_id = ?').get(l.id).v;
    l.paidEmis = paid.n;
    l.recoveredByPayroll = toRupees(toPaise(paid.posted));
    l.recoveredByCash = toRupees(toPaise(cash));
    l.totalRecovered = toRupees(toPaise(paid.posted) + toPaise(cash));
    l.remainingEmis = db.prepare("SELECT COUNT(*) AS n FROM loan_instalments WHERE loan_id = ? AND status IN ('scheduled','provisional')").get(l.id).n;
  }
  res.json({ success: true, data: loans });
}));

router.get('/requests', allow(READ_ROLES), handle((req, res) => {
  const db = getDb();
  const rows = L.listRequests(db, { status: text(req.query.status) || null, loanId: posInt(req.query.loanId) })
    .filter((r) => companyAllowed(req, r.company));
  res.json({ success: true, data: rows });
}));

// ── monthly loan close (Loans PR-6). Declared before /:id. ──────────────────
// The close covers every company together (SPEC §5.2 r6), so a user limited to
// some companies cannot run it or see its per-employee preview.

const monthYear = (src) => {
  const month = posInt(src.month);
  const year = posInt(src.year);
  return month && month <= 12 && year ? { month, year } : null;
};
const unrestricted = (req, res) => {
  if (allowedCompanies(req)) { refuse(res, { code: 'COMPANY_NOT_ALLOWED', message: 'the loan close covers every company; a company-restricted user cannot run or preview it' }); return false; }
  return true;
};
const payrollOf = (v) => text(v || 'plant').toLowerCase();

router.get('/closes', allow(READ_ROLES), handle((req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM loan_closes ORDER BY year DESC, month DESC, payroll').all()
    .map((r) => ({ ...r, notes: (() => { try { return r.notes ? JSON.parse(r.notes) : null; } catch { return r.notes; } })() }));
  res.json({ success: true, data: rows });
}));

router.get('/close/preview', allow(READ_ROLES), handle((req, res) => {
  if (!unrestricted(req, res)) return undefined;
  const my = monthYear(req.query);
  if (!my) return refuse(res, { code: 'MONTH_REQUIRED', message: 'month (1–12) and year are required' });
  return reply(res, L.previewClose(getDb(), { payroll: payrollOf(req.query.payroll), ...my }));
}));

router.post('/close', allow(PAY_ROLES), handle((req, res) => {
  if (!unrestricted(req, res)) return undefined;
  const my = monthYear(req.body || {});
  if (!my) return refuse(res, { code: 'MONTH_REQUIRED', message: 'month (1–12) and year are required' });
  const r = L.runLoanClose(getDb(), { payroll: payrollOf((req.body || {}).payroll), ...my, trigger: 'manual', actor: req.actor });
  return reply(res, r, 201);
}));

// ── exit recovery (Loans PR-7). Declared before /:id. ────────────────────────

/** Exit residuals (receipt or write-off) and loans still waiting for their final payroll. */
router.get('/exit-residuals', allow(READ_ROLES), handle((req, res) => {
  const data = L.listExitResiduals(getDb(), { companies: allowedCompanies(req) });
  res.json({ success: true, data });
}));

/** Write-offs for TDS (ruling Q-A): by write-off month (IST); basis=final lists by the final payroll month. */
router.get('/write-offs', allow(READ_ROLES), handle((req, res) => {
  const my = monthYear(req.query);
  if (!my) return refuse(res, { code: 'MONTH_REQUIRED', message: 'month (1–12) and year are required' });
  const basis = text(req.query.basis || 'writeoff').toLowerCase();
  if (!['writeoff', 'final'].includes(basis)) return refuse(res, { code: 'BASIS_INVALID', message: 'basis must be writeoff or final' });
  const rows = L.writeOffsForTds(getDb(), { ...my, basis }).filter((r) => companyAllowed(req, r.company));
  const total = rows.reduce((s, r) => s + toPaise(r.amount), 0);
  if (wantsXlsx(req)) {   // Loans PR-9: Excel of the same rows
    const tag = `${my.year}-${String(my.month).padStart(2, '0')}`;
    return sendXlsx(res, `Loans_write-offs_${basis}_${tag}.xlsx`, L.reportSheets('write-offs', { rows, total: toRupees(total) }));
  }
  return res.json({ success: true, data: rows, basis, total: toRupees(total) });
}));

// ── reports and the payslip balance line (Loans PR-9). Declared before /:id. ─
// Read roles; a company-restricted user sees only their companies' loans.

const wantsXlsx = (req) => text(req.query.format).toLowerCase() === 'xlsx';
function sendXlsx(res, filename, sheets) {
  const buf = L.toXlsx(sheets);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buf);
}
/** {month, year} from ?<prefix>Month & ?<prefix>Year, null when absent; false when malformed. */
function monthParam(q, prefix) {
  const rawM = q[`${prefix}Month`]; const rawY = q[`${prefix}Year`];
  if ((rawM === undefined || rawM === '') && (rawY === undefined || rawY === '')) return null;
  const month = posInt(rawM); const year = posInt(rawY);
  return month && month <= 12 && year >= 1900 ? { month, year } : false;
}

router.get('/reports/:name', allow(READ_ROLES), handle((req, res) => {
  const name = text(req.params.name).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(L.REPORTS, name)) {
    return refuse(res, { code: 'REPORT_NOT_FOUND', message: `unknown report ${name}; one of ${Object.keys(L.REPORTS).join(', ')}` });
  }
  // ?company= (the screen's company filter) narrows within the user's companies.
  const ac = allowedCompanies(req);
  const one = text(req.query.company);
  const opts = { companies: one ? (ac ? ac.filter((c) => c === one) : [one]) : ac };
  for (const [prefix, key] of [['from', 'from'], ['to', 'to']]) {
    const m = monthParam(req.query, prefix);
    if (m === false) return refuse(res, { code: 'MONTH_INVALID', message: `${prefix}Month (1–12) and ${prefix}Year are required together` });
    if (m) opts[key] = m;
  }
  if (req.query.months !== undefined) opts.months = posInt(req.query.months) || 12;
  const { ok: _ok, ...data } = L.REPORTS[name](getDb(), opts);
  if (wantsXlsx(req)) return sendXlsx(res, `Loans_${name}_${todayIst()}.xlsx`, L.reportSheets(name, data));
  return res.json({ success: true, data });
}));

/**
 * "Loan outstanding after this month's EMI" for a payslip (SPEC §7 screens 8).
 * A separate read, so the payslip itself (payroll.js / sales.js) is untouched;
 * a non-borrower gets {show:false} and the payslip shows nothing extra.
 */
router.get('/payslip-balance', allow(READ_ROLES), handle((req, res) => {
  const payroll = payrollOf(req.query.payroll);
  if (!['plant', 'sales'].includes(payroll)) return refuse(res, { code: 'PAYROLL_INVALID', message: 'payroll must be plant or sales' });
  const my = monthYear(req.query);
  if (!my) return refuse(res, { code: 'MONTH_REQUIRED', message: 'month (1–12) and year are required' });
  const employeeCode = text(req.query.employeeCode);
  if (!employeeCode) return refuse(res, { code: 'EMPLOYEE_REQUIRED', message: 'employeeCode is required' });
  const company = text(req.query.company) || null;
  if (payroll === 'sales' && !company) return refuse(res, { code: 'COMPANY_REQUIRED', message: 'a sales borrower is identified by code and company; give the company' });
  if (company && !companyAllowed(req, company)) return refuse(res, notAllowedCompany);
  const r = L.payslipLoanBalance(getDb(), { payroll, employeeCode, company, ...my });
  // A plant payslip is keyed by code only: keep the loans of the user's companies.
  const loans = r.loans.filter((l) => companyAllowed(req, L.getLoan(getDb(), l.loanId).company));
  const total = toRupees(loans.reduce((s, l) => s + toPaise(l.outstandingAfter), 0));
  const { ok: _ok, ...data } = r;
  return res.json({ success: true, data: { ...data, loans, total, show: loans.length > 0 } });
}));

// ── production dry run (Loans PR-11). Declared before /:id. ─────────────────
// Admin only, and only an admin not limited to some companies (the close it runs
// covers every company). Runs the real engine on the live database inside one
// transaction that is always rolled back; the only write that survives is one
// audit_log row ('loan_dry_run'). See services/loans/dryRun.js.

router.post('/dry-run', allow(DECIDE_ROLES), handle((req, res) => {
  if (!unrestricted(req, res)) return undefined;
  const r = runLoanDryRun(getDb(), req.body || {}, req.actor);
  if (r.ok) {
    const { ok: _ok, ...data } = r;
    return res.json({ success: true, data });
  }
  const { ok: _ok, status, code, message, ...rest } = r;
  return res.status(status || httpStatus(code)).json({ success: false, code, error: message, ...rest });
}));

router.get('/dry-run/pack', allow(DECIDE_ROLES), handle((req, res) => {
  if (!unrestricted(req, res)) return undefined;
  const month = posInt(req.query.month);
  const year = posInt(req.query.year);
  return reply(res, rehearsalPack(getDb(), { payroll: payrollOf(req.query.payroll), month, year }));
}));

router.post('/deductions/:did/reverse', allow(DECIDE_ROLES), handle((req, res) => {
  const db = getDb();
  const id = posInt(req.params.did);
  const row = id && db.prepare('SELECT d.id, l.company FROM loan_deductions d JOIN loans l ON l.id = d.loan_id WHERE d.id = ?').get(id);
  if (!row) return refuse(res, { code: 'DEDUCTION_NOT_FOUND', message: `deduction ${req.params.did} not found` });
  if (!companyAllowed(req, row.company)) return refuse(res, notAllowedCompany);
  return reply(res, L.reverseDeduction(db, { deductionId: id, reason: (req.body || {}).reason }, req.actor));
}));

router.get('/:id', allow(READ_ROLES), handle((req, res) => {
  const db = getDb();
  const loan = loadLoan(req, res, db);
  if (!loan) return undefined;
  const who = borrowerName(db, loan);
  const data = {
    ...loan,
    employee_name: who.name || null,
    department: who.department || null,
    urgent: loan.loan_type === L.EMERGENCY_LOAN_TYPE,
    instalments: db.prepare('SELECT * FROM loan_instalments WHERE loan_id = ? ORDER BY sequence').all(loan.id),
    receipts: db.prepare('SELECT * FROM loan_receipts WHERE loan_id = ? ORDER BY id').all(loan.id),
    events: db.prepare('SELECT * FROM loan_events WHERE loan_id = ? ORDER BY id').all(loan.id),
    requests: L.listRequests(db, { loanId: loan.id }),
    reconciliation: loan.disbursed_amount !== null ? L.reconcileLoan(db, loan.id) : null,
    approvalCheck: null,
    deductions: [],
    adjustments: [],
  };
  // Loans PR-6b (read-only): payroll deductions with their opposite entries, so the
  // admin can pick one to reverse. Effective posted = amount − Σ adjustments.
  const hasAdj = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'loan_adjustments'").get();
  data.adjustments = hasAdj ? db.prepare('SELECT * FROM loan_adjustments WHERE loan_id = ? ORDER BY id').all(loan.id) : [];
  data.deductions = db.prepare('SELECT * FROM loan_deductions WHERE loan_id = ? ORDER BY year, month, id').all(loan.id).map((d) => {
    const adj = data.adjustments.filter((a) => a.deduction_id === d.id).reduce((s, a) => s + toPaise(a.amount), 0);
    return { ...d, adjusted: toRupees(adj), effective_posted: d.state === 'posted' ? toRupees(toPaise(d.amount) - adj) : 0 };
  });
  if (loan.status === 'requested') {
    // The admin's approval screen: eligibility re-run, last 3 months of deductions, warnings.
    const facts = L.loadBorrowerFacts(db, { borrowerType: loan.borrower_type, employeeCode: loan.employee_code, company: loan.company, excludeLoanId: loan.id });
    const verdict = L.evaluateEligibility(facts, {
      borrowerType: loan.borrower_type, company: loan.company, loanType: loan.loan_type,
      principal: loan.principal_amount, tenure: loan.tenure_months, asOf: todayIst(),
    }, L.readLoanPolicy(db));
    const { emiPaise: _e, ...v } = verdict;
    data.approvalCheck = { ...v, exitFlagged: loan.exit_flag === 1, history: facts.history || null };
  }
  return res.json({ success: true, data });
}));

router.get('/:id/statement', allow(READ_ROLES), handle((req, res) => {
  const db = getDb();
  const loan = loadLoan(req, res, db);
  if (!loan) return undefined;
  return reply(res, L.loanStatement(db, loan.id));
}));

// ── writes: loans ────────────────────────────────────────────────────────────

router.post('/', allow(RAISE_ROLES, { adminRaise: true }), handle((req, res) => {
  const db = getDb();
  const p = loanInput(req.body || {});
  if (!p.ok) return refuse(res, p);
  if (p.input.company && !companyAllowed(req, p.input.company)) return refuse(res, notAllowedCompany);
  const r = L.requestLoan(db, p.input, req.actor);
  if (r.ok) {
    const urgent = r.urgent ? 'URGENT: ' : '';
    notify(db, 'admin', 'LOAN_REQUESTED', `${urgent}Loan #${r.loanId} for ${p.input.employeeCode} (${rs(p.input.principal)}, ${p.input.loanType}) awaits approval`);
  }
  return reply(res, r, 201);
}));

router.put('/:id/approve', allow(DECIDE_ROLES), handle((req, res) => {
  const db = getDb();
  const loan = loadLoan(req, res, db);
  if (!loan) return undefined;
  const r = L.approveLoan(db, loan.id, req.actor, { reason: req.body && req.body.reason });
  if (r.ok) {
    const msg = `Loan #${loan.id} for ${loan.employee_code} approved — record the disbursement with the signed agreement`;
    notify(db, 'finance', 'LOAN_APPROVED', msg);
    notify(db, 'hr', 'LOAN_APPROVED', msg);
  }
  return reply(res, r);
}));

router.put('/:id/reject', allow(DECIDE_ROLES), handle((req, res) => {
  const db = getDb();
  const loan = loadLoan(req, res, db);
  if (!loan) return undefined;
  const r = L.rejectLoan(db, loan.id, req.actor, { reason: req.body && req.body.reason });
  if (r.ok) notify(db, 'hr', 'LOAN_REJECTED', `Loan #${loan.id} for ${loan.employee_code} rejected`);
  return reply(res, r);
}));

router.post('/:id/cancel', allow(DECIDE_ROLES), handle((req, res) => {
  const db = getDb();
  const loan = loadLoan(req, res, db);
  if (!loan) return undefined;
  const r = L.cancelLoan(db, loan.id, req.actor, { reason: req.body && req.body.reason });
  if (r.ok) {
    const msg = `Loan #${loan.id} for ${loan.employee_code} cancelled before disbursement`;
    notify(db, 'hr', 'LOAN_CANCELLED', msg);
    notify(db, 'finance', 'LOAN_CANCELLED', msg);
  }
  return reply(res, r);
}));

router.post('/:id/disburse', allow(PAY_ROLES), handle((req, res) => {
  const db = getDb();
  const loan = loadLoan(req, res, db);
  if (!loan) return undefined;
  const b = req.body || {};
  // Role / self checks first (same answer whether or not the gate is on), then the gate, then the payload.
  const gate = L.checkActor('disburse', req.actor, { requestedBy: loan.requested_by });
  if (!gate.ok) return refuse(res, gate);
  if (!L.disbursementEnabled(db)) {
    return refuse(res, { code: 'DISBURSEMENT_DISABLED', message: 'loan disbursement is switched off until payroll recovery (Loans PR-5/PR-6) is live' });
  }
  const ag = checkAgreementRef(b.agreementRef);
  if (!ag.ok) return refuse(res, ag);
  const r = L.disburseLoan(db, loan.id, req.actor, {
    mode: b.mode, reference: b.reference, disbursedOn: b.disbursedOn, amount: b.amount,
    agreementFilePath: ag.value, firstEmiMonth: b.firstEmiMonth || null,
  });
  return reply(res, r);
}));

router.post('/:id/receipts', allow(PAY_ROLES), handle((req, res) => {
  const db = getDb();
  const loan = loadLoan(req, res, db);
  if (!loan) return undefined;
  const b = req.body || {};
  // allowProvisional is deliberately never passed (ruling Q13): PR-6 decides it.
  const r = L.recordReceipt(db, loan.id, req.actor, {
    amount: b.amount, mode: b.mode, reference: b.reference, receiptDate: b.receiptDate, remarks: b.remarks,
  });
  return reply(res, r, 201);
}));

// ── writes: change requests (defer / restructure / write-off) ────────────────

const KIND_LABEL = { defer: 'Defer', restructure: 'Restructure', write_off: 'Write-off' };

router.post('/:id/requests', allow(RAISE_ROLES, { adminRaise: true }), handle((req, res) => {
  const db = getDb();
  const loan = loadLoan(req, res, db);
  if (!loan) return undefined;
  const b = req.body || {};
  const r = L.requestChange(db, {
    loanId: loan.id, kind: b.kind, reason: b.reason,
    instalmentId: b.instalmentId, newTenure: b.newTenure, newEmi: b.newEmi, topupAmount: b.topupAmount,
  }, req.actor);
  if (r.ok) notify(db, 'admin', 'LOAN_CHANGE_REQUESTED', `${KIND_LABEL[r.kind]} request #${r.requestId} on loan #${loan.id} (${loan.employee_code}) awaits approval`);
  return reply(res, r, 201);
}));

/** Loads request :rid (404 / 403 handled) with its loan, or null when a response was sent. */
function loadRequest(req, res, db) {
  const id = posInt(req.params.rid);
  const r = id && L.getRequest(db, id);
  if (!r) { refuse(res, { code: 'REQUEST_NOT_FOUND', message: `request ${req.params.rid} not found` }); return null; }
  const loan = L.getLoan(db, r.loan_id);
  if (!companyAllowed(req, loan.company)) { refuse(res, notAllowedCompany); return null; }
  return { request: r, loan };
}

router.post('/requests/:rid/approve', allow(DECIDE_ROLES), handle((req, res) => {
  const db = getDb();
  const x = loadRequest(req, res, db);
  if (!x) return undefined;
  const b = req.body || {};
  let topup = null;
  if (x.request.kind === 'restructure' && x.request.payload.topupAmount) {
    // A top-up is a disbursement: role / self check, then the gate, then the payout details.
    const pre = L.checkActor('approve_change', req.actor, { requestedBy: x.request.requested_by });
    if (!pre.ok) return refuse(res, pre);
    if (!L.disbursementEnabled(db)) {
      return refuse(res, { code: 'DISBURSEMENT_DISABLED', message: 'loan disbursement is switched off until payroll recovery (Loans PR-5/PR-6) is live; a top-up cannot be paid' });
    }
    const ag = checkAgreementRef(b.agreementRef);
    if (!ag.ok) return refuse(res, { ...ag, message: `top-up: ${ag.message}` });
    topup = { mode: b.mode, reference: b.reference, disbursedOn: b.disbursedOn, agreementFilePath: ag.value };
  }
  const r = L.approveChange(db, x.request.id, req.actor, { topup, reason: b.reason });
  if (r.ok) {
    const msg = `${KIND_LABEL[r.kind]} request #${r.requestId} on loan #${x.loan.id} (${x.loan.employee_code}) approved`;
    notify(db, 'hr', 'LOAN_CHANGE_APPROVED', msg);
    notify(db, 'finance', 'LOAN_CHANGE_APPROVED', msg);
  }
  return reply(res, r);
}));

router.post('/requests/:rid/reject', allow(DECIDE_ROLES), handle((req, res) => {
  const db = getDb();
  const x = loadRequest(req, res, db);
  if (!x) return undefined;
  const r = L.rejectChange(db, x.request.id, req.actor, { reason: req.body && req.body.reason });
  if (r.ok) {
    const msg = `${KIND_LABEL[r.kind]} request #${r.requestId} on loan #${x.loan.id} (${x.loan.employee_code}) rejected`;
    notify(db, 'hr', 'LOAN_CHANGE_REJECTED', msg);
    notify(db, 'finance', 'LOAN_CHANGE_REJECTED', msg);
  }
  return reply(res, r);
}));

router.post('/requests/:rid/withdraw', allow(RAISE_ROLES), handle((req, res) => {
  const db = getDb();
  const x = loadRequest(req, res, db);
  if (!x) return undefined;
  return reply(res, L.withdrawChange(db, x.request.id, req.actor, { reason: req.body && req.body.reason }));
}));

module.exports = router;

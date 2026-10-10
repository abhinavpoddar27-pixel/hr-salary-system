/**
 * Loans PR-11 — production dry run (a rehearsal with a guaranteed rollback).
 *
 * The pre-pilot gate wants a dress rehearsal on production data, and the
 * production database cannot be downloaded. So the admin runs the REAL loan
 * engine on the LIVE database inside ONE transaction that is ALWAYS rolled
 * back, and gets a report of what would have happened:
 *
 *   A  snapshot   the scenario employees' stored salary rows for month M
 *   B  baseline   Stage 7 re-run for them with NO new loan (how far today's data
 *                 is from the stored row — production Sep 2026 has every
 *                 day_calculations row salary_stale = 1, so this is not zero)
 *   C  loans      raise → approve → disburse each scenario (synthetic dry-run
 *                 actors), then the Mark Left toggles (loan side only)
 *   D  stage7     Stage 7 re-run WITH the loans, then the hold toggles
 *   E  close      the real loan close of M (trigger 'dry_run'); M+1 too when its
 *                 payroll data exists
 *   F  collect    statements, reconciliation, residuals, reports, drift checks
 *   →  ROLLBACK, unconditionally (also on any error, and on the step budget).
 *
 * Proof in every run: a fingerprint (row count of every table + SHA-256 of the
 * full contents of the tables this path can touch) is taken before BEGIN and
 * after the ROLLBACK; the report carries rollbackVerified. The ONLY deliberate
 * write is one audit_log row ('loan_dry_run'), written after the rollback and
 * after the second fingerprint (owner ruling Q1, 10 Oct 2026).
 *
 * Side effects on this path (enumerated in the PR-11 plan): loan events, audit
 * rows, engine/close notifications and salaryComputation's logAudit() all write
 * to the same db handle (in production getDb() IS this handle) → rolled back.
 * Route notifications never run (the engine is called, not the routes). No leave
 * trigger, job-queue call or timer is reachable from recompute.js, the salary
 * services or services/loans/*. The disbursement gate is read only by the
 * routes, so policy_config is never touched.
 *
 * Synchronous throughout: while it runs nothing else in the process can, so the
 * only concurrent writer possible is a transaction already open on the shared
 * handle (the SQL Console Phase 2 keeps one open up to 60 s) → refused DB_BUSY.
 */
const crypto = require('crypto');
const L = require('./index');
const { toPaise, toRupees } = require('./money');
const { addMonths, compareMonth, isValidMonth, todayIst, dateToMonth, salesCycleMonthOf, daysInMonth, parseDate } = require('./months');
const { loansReady } = require('./stage7');
const { recomputeSalary } = require('../recompute');
const { computeSalesEmployee, saveSalesSalaryComputation } = require('../salesSalaryComputation');
const { deriveCycle } = require('../cycleUtil');

const MAX_SCENARIOS = 10;
const STEP_BUDGET_MS = 15000;
const STEPS = Object.freeze(['baseline', 'loans', 'stage7', 'close', 'collect']);

const ACTORS = Object.freeze({
  hr: { username: 'dry-run-hr', role: 'hr' },
  admin: { username: 'dry-run-admin', role: 'admin' },
  finance: { username: 'dry-run-finance', role: 'finance' },
  system: { username: 'system', role: 'system' },
});

const SENTINEL = Object.freeze({ loansDryRunRollback: true });
const text = (v) => String(v == null ? '' : v).trim();
const pad = (n) => String(n).padStart(2, '0');
const label = (m) => `${m.month}/${m.year}`;
const R = (paise) => toRupees(paise);

function refuse(code, message, status = 400, extra = {}) {
  return { ok: false, code, message, status, ...extra };
}

// ── fingerprint ─────────────────────────────────────────────────────────────

/** Tables this path can write; their full contents are hashed. */
const DIGEST_TABLES = Object.freeze([
  'salary_computations', 'sales_salary_computations', 'day_calculations', 'employees', 'sales_employees',
  'loans', 'loan_instalments', 'loan_deductions', 'loan_receipts', 'loan_closes', 'loan_events', 'loan_requests', 'loan_adjustments',
  'notifications', 'monthly_imports', 'sales_uploads', 'late_coming_deductions', 'early_exit_deductions',
  'salary_advances', 'salary_manual_flags', 'policy_config', 'sqlite_sequence',
]);

const qi = (name) => `"${String(name).replace(/"/g, '""')}"`;

/**
 * Row count of every table + SHA-256 of DIGEST_TABLES' contents (ordered by
 * rowid) + MAX(id) of audit_log. Read-only.
 */
function fingerprint(db) {
  const t0 = Date.now();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_stat%' ORDER BY name").all().map((r) => r.name);
  const counts = {};
  for (const t of tables) counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${qi(t)}`).get().n;
  const digests = {};
  const present = new Set(tables);
  for (const t of DIGEST_TABLES) {
    if (!present.has(t)) continue;
    const h = crypto.createHash('sha256');
    for (const row of db.prepare(`SELECT * FROM ${qi(t)} ORDER BY rowid`).raw().iterate()) {
      h.update(JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? v.toString() : (Buffer.isBuffer(v) ? v.toString('hex') : v))));
      h.update('\n');
    }
    digests[t] = h.digest('hex');
  }
  const auditMax = present.has('audit_log') ? db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM audit_log').get().m : null;
  return { counts, digests, auditMax, tables: tables.length, ms: Date.now() - t0 };
}

/** Tables whose count or digest differ between two fingerprints. */
function compareFingerprints(a, b) {
  const diff = [];
  const names = new Set([...Object.keys(a.counts), ...Object.keys(b.counts)]);
  for (const t of names) if (a.counts[t] !== b.counts[t]) diff.push({ table: t, kind: 'count', before: a.counts[t], after: b.counts[t] });
  for (const t of new Set([...Object.keys(a.digests), ...Object.keys(b.digests)])) {
    if (a.digests[t] !== b.digests[t]) diff.push({ table: t, kind: 'content' });
  }
  if (a.auditMax !== b.auditMax) diff.push({ table: 'audit_log', kind: 'max_id', before: a.auditMax, after: b.auditMax });
  return diff;
}

/** A short combined hash for the report. */
const fpHash = (fp) => crypto.createHash('sha256').update(JSON.stringify([fp.counts, fp.digests, fp.auditMax])).digest('hex').slice(0, 16);

// ── input ───────────────────────────────────────────────────────────────────

function currentIstMonth(now) {
  const [y, m] = todayIst(now).split('-').map(Number);
  return { month: m, year: y };
}

/** Last day of month M for plant; the 25th (last day of the cycle) for sales. */
function defaultExitDate(payroll, m) {
  return `${m.year}-${pad(m.month)}-${payroll === 'sales' ? 25 : pad(daysInMonth(m.year, m.month))}`;
}

function validate(db, input, now) {
  const payroll = text(input && input.payroll).toLowerCase() || 'plant';
  if (!['plant', 'sales'].includes(payroll)) return refuse('PAYROLL_INVALID', 'payroll must be plant or sales');
  const m = { month: Number(input && input.month), year: Number(input && input.year) };
  if (!isValidMonth(m)) return refuse('MONTH_INVALID', 'month (1–12) and year are required');
  if (compareMonth(m, currentIstMonth(now)) >= 0) {
    return refuse('MONTH_NOT_ENDED', `${label(m)} has not ended yet (IST): the loan close of a month can only run after it ends — pick an earlier, computed month`);
  }
  const raw = Array.isArray(input && input.scenarios) ? input.scenarios : [];
  if (raw.length < 1 || raw.length > MAX_SCENARIOS) return refuse('SCENARIOS_INVALID', `give 1–${MAX_SCENARIOS} scenarios`);
  const scenarios = [];
  const seen = new Set();
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i] || {};
    const employeeCode = text(s.employeeCode);
    if (!employeeCode) return refuse('SCENARIO_INVALID', `scenario ${i + 1}: employeeCode is required`);
    let company = text(s.company);
    if (payroll === 'sales' && !company) return refuse('COMPANY_REQUIRED', `scenario ${i + 1}: a sales borrower is code + company; give the company`);
    if (payroll === 'plant' && !company) {
      const e = db.prepare('SELECT company FROM employees WHERE code = ?').get(employeeCode);
      company = text(e && e.company);
    }
    const key = payroll === 'sales' ? `${employeeCode}|${company}` : employeeCode;
    if (seen.has(key)) return refuse('SCENARIO_DUPLICATE', `scenario ${i + 1}: ${employeeCode} appears twice; one scenario per borrower`);
    seen.add(key);
    const offset = s.disburseMonthOffset === undefined || s.disburseMonthOffset === null || s.disburseMonthOffset === '' ? -1 : Number(s.disburseMonthOffset);
    if (![-1, 0].includes(offset)) {
      return refuse('OFFSET_INVALID', `scenario ${i + 1}: disburseMonthOffset must be -1 (paid out in the month before, first EMI in ${label(m)}) or 0 (paid out in ${label(m)}, first EMI the month after)`);
    }
    let exitDate = null;
    if (s.markLeft) {
      exitDate = text(s.exitDate) || defaultExitDate(payroll, m);
      const em = parseDate(exitDate) ? (payroll === 'sales' ? salesCycleMonthOf(exitDate) : dateToMonth(exitDate)) : null;
      if (!em || compareMonth(em, m) !== 0) {
        return refuse('EXIT_DATE_INVALID', `scenario ${i + 1}: the exit date must fall in ${payroll === 'sales' ? 'the sales cycle of ' : ''}${label(m)} (YYYY-MM-DD)`);
      }
    }
    scenarios.push({
      index: i + 1, employeeCode, company, borrowerType: payroll,
      loanType: text(s.loanType) || 'Personal', principal: s.principal, tenure: s.tenure,
      disburseMonthOffset: offset, markLeft: !!s.markLeft, exitDate, hold: !!s.hold,
    });
  }
  const includeNextMonth = input.includeNextMonth !== false;
  return { ok: true, payroll, m, scenarios, includeNextMonth };
}

// ── Stage 7 runners (scenario employees only) ───────────────────────────────

/**
 * Plant: the real recomputeSalary — the loop the Compute Salary route, the job
 * queue and the reimport use — limited to the scenario employees, grouped by
 * the company on their day_calculations row (as the route passes the selected
 * company). stampStage:false — the dry run never stamps stage_7_done.
 */
function plantStage7(db, { m, codes, runId }) {
  const out = { computed: [], excluded: [], held: [], errors: [], noDayCalc: [] };
  if (!codes.length) return out;
  const rows = db.prepare(`SELECT employee_code, company FROM day_calculations WHERE month = ? AND year = ?
                            AND employee_code IN (${codes.map(() => '?').join(',')})`).all(m.month, m.year, ...codes);
  const byCompany = new Map();
  for (const r of rows) {
    const k = r.company == null ? '' : String(r.company);
    if (!byCompany.has(k)) byCompany.set(k, new Set());
    byCompany.get(k).add(r.employee_code);
  }
  const found = new Set(rows.map((r) => r.employee_code));
  out.noDayCalc = codes.filter((c) => !found.has(c));
  for (const [company, set] of byCompany) {
    const r = recomputeSalary(db, { company: company || undefined, month: m.month, year: m.year, employeeCodes: [...set], requestId: runId, stampStage: false });
    out.computed.push(...r.results.map((x) => x.employeeCode));
    out.excluded.push(...r.excluded);
    out.held.push(...r.held);
    out.errors.push(...r.errors);
  }
  return out;
}

/**
 * Sales: the per-employee loop of POST /api/sales/compute
 * (routes/sales.js L2779–L2837, Loans PR-8) for the scenario employees only —
 * duplicated here on purpose (owner ruling Q3, 10 Oct 2026; extracting it from
 * sales.js is a later PR). If that loop changes, change this too. Deliberately
 * NOT repeated: clearSalesNotComputed (it would reverse other people's rows) and
 * the upload stamp (L2859).
 */
function salesStage7(db, { m, scenarios, runId, user }) {
  const out = { computed: [], excluded: [], held: [], errors: [], noUpload: [], notInUpload: [] };
  if (!scenarios.length) return out;
  const cyc = deriveCycle(m.month, m.year);
  const uploadOf = db.prepare('SELECT * FROM sales_uploads WHERE month = ? AND year = ? AND company = ? AND is_active = 1 LIMIT 1');
  const inputOf = db.prepare(`SELECT i.*, e.id AS sales_employee_id FROM sales_monthly_input i
                                LEFT JOIN sales_employees e ON e.code = i.employee_code AND e.company = i.company
                               WHERE i.upload_id = ? AND i.employee_code = ?`);
  for (const s of scenarios) {
    const upload = uploadOf.get(m.month, m.year, s.company);
    if (!upload) { out.noUpload.push({ employeeCode: s.employeeCode, company: s.company }); continue; }
    const row = inputOf.get(upload.id, s.employeeCode);
    if (!row) { out.notInUpload.push({ employeeCode: s.employeeCode, company: s.company }); continue; }
    if (!row.sales_employee_id) { out.excluded.push({ code: s.employeeCode, reason: 'employee_not_found' }); continue; }
    const salesEmployee = db.prepare('SELECT * FROM sales_employees WHERE id = ?').get(row.sales_employee_id);
    try {
      db.transaction(() => {
        const comp = computeSalesEmployee(db, {
          salesEmployee, monthlyInputRow: row, cycleStart: cyc.start, cycleEnd: cyc.end,
          month: m.month, year: m.year, company: s.company, requestId: runId, user,
        });
        if (!comp.success) {
          if (comp.excluded) out.excluded.push({ code: s.employeeCode, reason: comp.reason });
          else out.errors.push({ employeeCode: s.employeeCode, error: comp.error });
          return;
        }
        saveSalesSalaryComputation(db, comp, { runId });
        out.computed.push(s.employeeCode);
        if (comp.status === 'hold') out.held.push({ code: s.employeeCode });
      })();
    } catch (e) {
      out.errors.push({ employeeCode: s.employeeCode, error: e.message });
    }
  }
  return out;
}

const PLANT_COLS = ['net_salary', 'gross_earned', 'total_deductions', 'loan_recovery', 'salary_held', 'hold_reason'];
const SALES_COLS = ['net_salary', 'gross_earned', 'total_deductions', 'loan_recovery', 'status', 'diwali_bonus', 'incentive_amount'];

function salaryRow(db, payroll, s, m) {
  if (payroll === 'sales') {
    return db.prepare('SELECT * FROM sales_salary_computations WHERE employee_code = ? AND month = ? AND year = ? AND company = ?')
      .get(s.employeeCode, m.month, m.year, s.company) || null;
  }
  return db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ? ORDER BY id LIMIT 1')
    .get(s.employeeCode, m.month, m.year) || null;
}

function pick(row, payroll) {
  if (!row) return null;
  const cols = payroll === 'sales' ? SALES_COLS : PLANT_COLS;
  return Object.fromEntries(cols.map((c) => [c, row[c] === undefined ? null : row[c]]));
}

const num = (v) => Number(v || 0);
const delta = (a, b, f) => (a && b ? Math.round((num(b[f]) - num(a[f])) * 100) / 100 : null);

function runStage7(db, payroll, { m, scenarios, runId, user }) {
  return payroll === 'sales'
    ? salesStage7(db, { m, scenarios, runId, user })
    : plantStage7(db, { m, codes: scenarios.map((s) => s.employeeCode), runId });
}

/** Does M+1 have payroll data for any scenario? */
function hasPayroll(db, payroll, scenarios, m) {
  if (payroll === 'sales') {
    return scenarios.some((s) => db.prepare('SELECT 1 FROM sales_uploads WHERE month = ? AND year = ? AND company = ? AND is_active = 1').get(m.month, m.year, s.company));
  }
  const codes = scenarios.map((s) => s.employeeCode);
  return !!db.prepare(`SELECT 1 FROM day_calculations WHERE month = ? AND year = ? AND employee_code IN (${codes.map(() => '?').join(',')}) LIMIT 1`)
    .get(m.month, m.year, ...codes);
}

// ── checks on the rows the run touched ─────────────────────────────────────

function touchedChecks(db, payroll, scenarios, months) {
  const out = { drift: [], componentShort: [], payslipLedger: [] };
  for (const m of months) {
    for (const s of scenarios) {
      const row = salaryRow(db, payroll, s, m);
      if (!row) continue;
      const extra = payroll === 'sales' ? num(row.diwali_bonus) + num(row.incentive_amount) : 0;
      const expectNet = num(row.gross_earned) + extra - num(row.total_deductions);
      if (Math.abs(num(row.net_salary) - expectNet) > 1) {
        out.drift.push({ employeeCode: s.employeeCode, month: m.month, year: m.year, net: row.net_salary, expected: Math.round(expectNet * 100) / 100 });
      }
      const comps = payroll === 'sales'
        ? ['pf_employee', 'esi_employee', 'professional_tax', 'tds', 'advance_recovery', 'loan_recovery', 'other_deductions']
        : ['pf_employee', 'esi_employee', 'professional_tax', 'tds', 'advance_recovery', 'lop_deduction', 'other_deductions', 'loan_recovery', 'late_coming_deduction', 'early_exit_deduction'];
      const sum = comps.reduce((a, c) => a + num(row[c]), 0);
      if (Math.abs(num(row.total_deductions) - sum) > 1) {
        out.componentShort.push({ employeeCode: s.employeeCode, month: m.month, year: m.year, totalDeductions: row.total_deductions, components: Math.round(sum * 100) / 100 });
      }
    }
    const chk = L.checkPayslipLedger(db, { payroll, month: m.month, year: m.year });
    const ours = new Set(scenarios.map((s) => s.employeeCode));
    out.payslipLedger.push(...chk.mismatches.filter((x) => ours.has(String(x.employeeCode))).map((x) => ({ ...x, month: m.month, year: m.year })));
  }
  out.ok = out.drift.length === 0 && out.componentShort.length === 0 && out.payslipLedger.length === 0;
  return out;
}

// ── the run ─────────────────────────────────────────────────────────────────

/**
 * @param {object} db
 * @param {object} input {month, year, payroll, includeNextMonth?, scenarios[]}
 * @param {{username, role}} actor the admin (route-checked)
 * @param {object} [opts] now (tests), budgetMs, hooks {<step>: fn} (tests: inject a failure)
 * @returns {{ok:true, …report} | {ok:false, code, message, status, …}}
 */
function runLoanDryRun(db, input, actor, { now = new Date(), budgetMs = STEP_BUDGET_MS, hooks = {} } = {}) {
  if (!actor || actor.role !== 'admin') return refuse('ROLE_NOT_ALLOWED', 'only the admin can run a loan dry run', 403);
  if (!loansReady(db)) return refuse('NOT_MIGRATED', 'loan tables are not migrated');
  if (db.inTransaction) {
    return refuse('DB_BUSY', 'another write transaction is open on the database (for example an SQL Console write preview); try again when it has finished', 409);
  }
  const v = validate(db, input || {}, now);
  if (!v.ok) return v;
  const { payroll, m, scenarios, includeNextMonth } = v;
  if (payroll === 'plant') {
    const n = db.prepare('SELECT COUNT(*) AS n FROM salary_computations WHERE month = ? AND year = ?').get(m.month, m.year).n;
    if (n === 0) return refuse('PAYROLL_NOT_COMPUTED', `plant Stage 7 has no salary rows for ${label(m)}`);
  } else {
    const missing = [...new Set(scenarios.map((s) => s.company))]
      .filter((c) => !db.prepare('SELECT 1 FROM sales_uploads WHERE month = ? AND year = ? AND company = ? AND is_active = 1').get(m.month, m.year, c));
    if (missing.length) return refuse('PAYROLL_NOT_COMPUTED', `no active sales upload for ${label(m)} for ${missing.join(', ')}`);
  }

  const dryRunId = `dry-run-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
  const runId = dryRunId;
  console.log(`[loans-dry-run] ${dryRunId} START by ${actor.username}: ${payroll} ${label(m)}, ${scenarios.length} scenario(s) — every write below is rolled back`);

  const fpBefore = fingerprint(db);
  const started = Date.now();
  let step = 'begin';
  let partial = { scenarios: scenarios.map((s) => ({ index: s.index, employeeCode: s.employeeCode, company: s.company })) };
  let report = null;
  let failure = null;
  let guaranteeLost = false;
  let lockMs = 0;

  const enter = (name) => {
    if (!db.inTransaction) { guaranteeLost = true; throw new Error('ROLLBACK_GUARANTEE_LOST: the transaction ended on its own'); }
    if (Date.now() - started > budgetMs) throw new Error(`STEP_BUDGET_EXCEEDED: the dry run took longer than ${Math.round(budgetMs / 1000)} s and was stopped`);
    step = name;
    if (typeof hooks[name] === 'function') hooks[name]({ db, partial });
  };

  const body = () => {
    const nextM = addMonths(m, 1);
    const rows = new Map(scenarios.map((s) => [s.index, { stored: pick(salaryRow(db, payroll, s, m), payroll) }]));

    // B — baseline Stage 7 (no new loan)
    enter('baseline');
    const baseline = runStage7(db, payroll, { m, scenarios, runId: `${runId}-baseline`, user: actor.username });
    for (const s of scenarios) rows.get(s.index).baseline = pick(salaryRow(db, payroll, s, m), payroll);
    partial.baseline = baseline;

    // C — raise → approve → disburse; Mark Left
    enter('loans');
    const today = todayIst(now);
    const loanOut = new Map();
    for (const s of scenarios) {
      const o = { refusal: null, loanId: null };
      loanOut.set(s.index, o);
      const facts = L.loadBorrowerFacts(db, { borrowerType: payroll, employeeCode: s.employeeCode, company: s.company, asOf: today });
      o.eligibility = L.evaluateEligibility(facts, { borrowerType: payroll, company: s.company, loanType: s.loanType, principal: s.principal, tenure: s.tenure, asOf: today }, L.readLoanPolicy(db));
      delete o.eligibility.emiPaise;
      const req = L.requestLoan(db, {
        borrowerType: payroll, employeeCode: s.employeeCode, company: s.company, loanType: s.loanType,
        principal: s.principal, tenure: s.tenure, reason: `Dry run ${dryRunId}`,
      }, ACTORS.hr, { asOf: today });
      if (!req.ok) { o.refusal = { stage: 'request', code: req.code, message: req.message, refusals: req.refusals || null }; continue; }
      o.loanId = req.loanId;
      const ap = L.approveLoan(db, req.loanId, ACTORS.admin, { reason: 'dry run', asOf: today });
      if (!ap.ok) { o.refusal = { stage: 'approve', code: ap.code, message: ap.message, refusals: ap.refusals || null }; continue; }
      const dm = addMonths(m, s.disburseMonthOffset);
      const disbursedOn = `${dm.year}-${pad(dm.month)}-15`;
      const d = L.disburseLoan(db, req.loanId, ACTORS.finance, {
        mode: 'Bank transfer', reference: `DRY-RUN ${dryRunId}`, disbursedOn, agreementFilePath: 'DRY-RUN (not a real agreement)',
      }, { asOf: today });
      if (!d.ok) { o.refusal = { stage: 'disburse', code: d.code, message: d.message }; continue; }
      o.disbursedOn = disbursedOn;
      o.firstEmiMonth = d.firstEmiMonth;
      o.emi = d.emi;
      o.scheduleAtDisbursement = d.schedule;
    }
    const exits = [];
    for (const s of scenarios.filter((x) => x.markLeft)) {
      const o = loanOut.get(s.index);
      if (!o.loanId || o.refusal) continue;
      let r;
      try {
        r = payroll === 'sales'
          ? L.flagSalesBorrowerForExit(db, { employeeCode: s.employeeCode, company: s.company, exitDate: s.exitDate, reason: `Dry run ${dryRunId}` }, ACTORS.system)
          : L.flagForExit(db, o.loanId, ACTORS.system, { exitDate: s.exitDate, reason: `Dry run ${dryRunId}: borrower marked Left` });
      } catch (e) {
        r = { ok: false, code: 'EXIT_FLAG_FAILED', message: e.message };   // the sales helper throws on a refusal
      }
      if (r.ok === false) { o.exitRefusal = { code: r.code, message: r.message }; continue; }
      o.exit = { exitDate: s.exitDate, ...(payroll === 'sales' ? (r.loans || []).find((x) => x.loanId === o.loanId) || {} : r.exit || {}) };
      exits.push(s.employeeCode);
    }
    partial.loans = [...loanOut.entries()].map(([index, o]) => ({ index, loanId: o.loanId, refusal: o.refusal }));

    // D — Stage 7 with the loans; hold toggles
    enter('stage7');
    const withLoan = runStage7(db, payroll, { m, scenarios, runId: `${runId}-stage7`, user: actor.username });
    const holds = [];
    for (const s of scenarios) {
      rows.get(s.index).withLoan = pick(salaryRow(db, payroll, s, m), payroll);
      if (!s.hold) continue;
      const r = payroll === 'sales'
        ? db.prepare("UPDATE sales_salary_computations SET status = 'hold' WHERE employee_code = ? AND month = ? AND year = ? AND company = ?").run(s.employeeCode, m.month, m.year, s.company)
        : db.prepare("UPDATE salary_computations SET salary_held = 1, hold_reason = '[dry run] hold' WHERE employee_code = ? AND month = ? AND year = ?").run(s.employeeCode, m.month, m.year);
      holds.push({ employeeCode: s.employeeCode, applied: r.changes > 0 });
      rows.get(s.index).heldAtClose = r.changes > 0;
    }
    partial.stage7 = withLoan;

    // E — the close of M (and M+1)
    enter('close');
    const preview = L.previewClose(db, { payroll, month: m.month, year: m.year, now });
    const close = L.runLoanClose(db, { payroll, month: m.month, year: m.year, trigger: 'dry_run', actor: ACTORS.finance, now });
    let next = null;
    if (!includeNextMonth) next = { month: nextM.month, year: nextM.year, skipped: true, reason: 'not asked for' };
    else if (!hasPayroll(db, payroll, scenarios, nextM)) next = { month: nextM.month, year: nextM.year, skipped: true, reason: `${label(nextM)} has no payroll data yet` };
    else {
      const st = runStage7(db, payroll, { m: nextM, scenarios, runId: `${runId}-next`, user: actor.username });
      const cl = L.runLoanClose(db, { payroll, month: nextM.month, year: nextM.year, trigger: 'dry_run', actor: ACTORS.finance, now });
      next = {
        month: nextM.month, year: nextM.year, skipped: false, stage7: st, close: cl,
        salary: scenarios.map((s) => ({ index: s.index, employeeCode: s.employeeCode, row: pick(salaryRow(db, payroll, s, nextM), payroll) })),
      };
    }
    partial.close = close;

    // F — collect
    enter('collect');
    const capPct = L.readLoanPolicy(db).deductionCapPct;
    const loanIds = [];
    const out = scenarios.map((s) => {
      const o = loanOut.get(s.index);
      const r = rows.get(s.index);
      const withRow = salaryRow(db, payroll, s, m);
      const item = {
        index: s.index, employeeCode: s.employeeCode, company: s.company, loanType: s.loanType,
        principal: s.principal, tenure: s.tenure, disburseMonthOffset: s.disburseMonthOffset,
        markLeft: s.markLeft, exitDate: s.exitDate, hold: s.hold,
        eligibility: o.eligibility, refusal: o.refusal, loanId: o.loanId,
        salary: {
          stored: r.stored, rerunNoLoan: r.baseline, rerunWithLoan: r.withLoan,
          staleNetDifference: delta(r.stored, r.baseline, 'net_salary'),
          loanEffectOnNet: delta(r.baseline, r.withLoan, 'net_salary'),
          heldAtClose: !!r.heldAtClose,
        },
      };
      if (withRow) {
        const base = L.earnedBase(withRow, payroll);
        const prior = L.priorDeductions(withRow, payroll);
        item.headroom = { capPct, earnedBase: R(base), priorDeductions: R(prior), headroom: R(L.computeHeadroom({ earnedBasePaise: base, capPct, priorDeductionsPaise: prior })) };
      }
      if (o.loanId && !o.refusal) {
        loanIds.push(o.loanId);
        const loan = L.getLoan(db, o.loanId);
        const due = db.prepare(`SELECT COALESCE(SUM(amount_due), 0) AS v FROM loan_instalments WHERE loan_id = ? AND due_month = ? AND due_year = ?
                                   AND status <> 'cancelled' AND origin IN ('schedule','exit')`).get(o.loanId, m.month, m.year).v;
        const ded = db.prepare('SELECT month, year, amount, state FROM loan_deductions WHERE loan_id = ? ORDER BY year, month, id').all(o.loanId);
        Object.assign(item, {
          disbursedOn: o.disbursedOn, firstEmiMonth: o.firstEmiMonth, emi: o.emi, scheduleAtDisbursement: o.scheduleAtDisbursement,
          exit: o.exit || null, exitRefusal: o.exitRefusal || null,
          dueInMonth: due, deductedInMonth: (ded.find((d) => d.month === m.month && d.year === m.year) || {}).amount || 0,
          deductions: ded,
          loanAfter: { status: loan.status, remainingBalance: loan.remaining_balance, emi: loan.emi_amount },
          scheduleAfter: db.prepare('SELECT * FROM loan_instalments WHERE loan_id = ? ORDER BY sequence').all(o.loanId)
            .map((i) => ({ sequence: i.sequence, month: i.due_month, year: i.due_year, amountDue: i.amount_due, status: i.status, origin: i.origin, posted: i.posted_amount })),
          reconciliation: L.reconcileLoan(db, o.loanId),
          statement: L.loanStatement(db, o.loanId),
          payslipLine: L.payslipLoanBalance(db, { payroll, employeeCode: s.employeeCode, company: s.company, month: m.month, year: m.year }),
        });
      }
      return item;
    });
    const ids = new Set(loanIds);
    const residuals = L.listExitResiduals(db);
    const outstanding = L.outstandingRegister(db);
    const exceptions = L.exceptionsList(db);
    const months = [m, ...(next && !next.skipped ? [nextM] : [])];
    return {
      payroll, month: m.month, year: m.year, scenarios: out,
      stage7: { baseline, withLoan, holds, exits },
      close: { preview, result: close },
      nextMonth: next,
      exitResiduals: {
        residuals: residuals.residuals.filter((r) => ids.has(r.loanId)),
        awaitingFinalPayroll: residuals.awaitingFinalPayroll.filter((r) => ids.has(r.loanId)),
      },
      totals: {
        loansCreated: loanIds.length,
        refused: out.filter((x) => x.refusal).length,
        disbursed: R(out.reduce((a, x) => a + (x.loanId && !x.refusal ? toPaise(x.principal) : 0), 0)),
        dueInMonth: R(out.reduce((a, x) => a + toPaise(x.dueInMonth || 0), 0)),
        deductedInMonth: R(out.reduce((a, x) => a + toPaise(x.deductedInMonth || 0), 0)),
        outstandingAfter: outstanding.totals,
        reconcileProblems: outstanding.reconcileProblems,
        exceptions: exceptions.summary,
        staleRows: out.filter((x) => x.salary.staleNetDifference !== null && Math.abs(x.salary.staleNetDifference) > 1).length,
      },
      checks: touchedChecks(db, payroll, scenarios, months),
    };
  };

  try {
    db.transaction(() => {
      try {
        report = body();
      } catch (e) {
        failure = { step, error: e };
      }
      lockMs = Date.now() - started;
      throw SENTINEL;   // ALWAYS roll back
    }).immediate();
  } catch (e) {
    if (e !== SENTINEL) failure = failure || { step, error: e };
  } finally {
    if (db.inTransaction) {
      try { db.exec('ROLLBACK'); } catch (re) { console.error(`[loans-dry-run] ${dryRunId} explicit ROLLBACK failed: ${re.message}`); }
    }
  }
  if (!lockMs) lockMs = Date.now() - started;

  const fpAfter = fingerprint(db);
  const diff = compareFingerprints(fpBefore, fpAfter);
  const rollbackVerified = diff.length === 0 && !guaranteeLost;
  const timings = { lockMs, fingerprintBeforeMs: fpBefore.ms, fingerprintAfterMs: fpAfter.ms, totalMs: Date.now() - started + fpBefore.ms };
  const verification = { rollbackVerified, before: fpHash(fpBefore), after: fpHash(fpAfter), tablesChecked: fpBefore.tables, differences: diff };

  const busy = failure && failure.step === 'begin' && /SQLITE_BUSY|database is locked/i.test(String(failure.error && failure.error.message));
  const summary = {
    dryRunId, payroll, month: m.month, year: m.year,
    scenarios: scenarios.map((s) => ({ employeeCode: s.employeeCode, company: s.company, principal: s.principal, tenure: s.tenure, loanType: s.loanType, markLeft: s.markLeft, hold: s.hold, offset: s.disburseMonthOffset })),
    ok: !failure, failedAt: failure ? failure.step : null, error: failure ? String(failure.error && failure.error.message) : null,
    rollbackVerified, timings,
    result: report ? { loansCreated: report.totals.loansCreated, refused: report.totals.refused, deducted: report.totals.deductedInMonth, closePosted: report.close.result && report.close.result.posted } : null,
  };
  // The ONLY deliberate write (owner ruling Q1): after the rollback and after the second fingerprint.
  try {
    db.prepare(`INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type)
                VALUES ('loans', 0, 'dry_run', '', ?, ?, 'loans', ?, NULL, 'loan_dry_run')`)
      .run(rollbackVerified ? 'rolled back (verified)' : 'ROLLBACK NOT VERIFIED', actor.username, JSON.stringify(summary).slice(0, 8000));
  } catch (e) {
    console.error(`[loans-dry-run] ${dryRunId} audit row failed: ${e.message}`);
  }
  if (!rollbackVerified) {
    console.error(`[loans-dry-run] ${dryRunId} ROLLBACK NOT VERIFIED: ${JSON.stringify(diff).slice(0, 2000)}`);
    try {
      db.prepare('INSERT INTO notifications (role_target, type, title, message, link, action_url) VALUES (?, ?, ?, ?, ?, ?)')
        .run('admin', 'LOAN_DRY_RUN_NOT_VERIFIED', 'Loan dry run: rollback not verified',
          `Loan dry run ${dryRunId}: the database after the rollback does not match the snapshot taken before it (${diff.map((d) => d.table).join(', ') || 'transaction ended early'}). Check the server log.`,
          '/loans?tab=dry-run', '/loans?tab=dry-run');
    } catch (e) { /* best effort */ }
  }
  console.log(`[loans-dry-run] ${dryRunId} END: ${failure ? `failed at ${failure.step}` : 'completed'}; ROLLED BACK, ${rollbackVerified ? 'verified' : 'NOT VERIFIED'} (in transaction ${lockMs} ms)`);

  if (busy) return refuse('DB_BUSY', 'the database is busy with another write; try again in a moment', 409, { dryRunId, verification, timings });
  if (!rollbackVerified) {
    return refuse(guaranteeLost ? 'ROLLBACK_GUARANTEE_LOST' : 'ROLLBACK_NOT_VERIFIED',
      'the dry run could not prove that nothing was saved — see differences; the admin has been notified', 500,
      { dryRunId, verification, timings, failedAt: failure ? failure.step : null });
  }
  if (failure) {
    return {
      ok: false, code: 'DRY_RUN_FAILED', status: 200, failedAt: failure.step,
      message: `the dry run stopped at step "${failure.step}": ${failure.error && failure.error.message}`,
      dryRunId, nothingSaved: true, verification, timings, partial: safePartial(partial),
    };
  }
  return { ok: true, dryRunId, nothingSaved: true, verification, timings, ...report };
}

/** The partial report of a failed run, made JSON-safe. */
function safePartial(p) {
  try { return JSON.parse(JSON.stringify(p)); } catch (e) { return null; }
}

// ── rehearsal pack (read-only) ──────────────────────────────────────────────

/** Latest month with computed payroll, before the current IST month. */
function latestComputedMonth(db, payroll, now) {
  const cur = currentIstMonth(now);
  if (payroll === 'sales') {
    const rows = db.prepare("SELECT month, year, company FROM sales_uploads WHERE is_active = 1 AND status = 'computed' ORDER BY year DESC, month DESC").all();
    const r = rows.find((x) => compareMonth(x, cur) < 0);
    return r ? { month: r.month, year: r.year } : null;
  }
  const rows = db.prepare('SELECT month, year FROM salary_computations GROUP BY year, month ORDER BY year DESC, month DESC').all();
  for (const r of rows) {
    if (compareMonth(r, cur) >= 0) continue;
    const mi = db.prepare('SELECT COUNT(*) AS t, COALESCE(SUM(CASE WHEN stage_7_done = 1 THEN 1 ELSE 0 END), 0) AS d FROM monthly_imports WHERE month = ? AND year = ?').get(r.month, r.year);
    if (mi.t === 0 || mi.d === mi.t) return { month: r.month, year: r.year };
  }
  return null;
}

/** A loan this borrower can take today: the largest round amount, the shortest tenure under the EMI ceiling. */
function sizeLoan(facts, policy, payroll, company, asOf) {
  const probe = L.evaluateEligibility(facts, { borrowerType: payroll, company, loanType: 'Personal', principal: 1000, tenure: 1, asOf }, policy);
  const maxAmt = Number(probe.limits && probe.limits.maxAmount);
  const maxEmi = Number(probe.limits && probe.limits.maxEmi);
  if (!(maxAmt >= 1000) || !(maxEmi > 0)) return null;
  const principal = Math.floor(maxAmt / 1000) * 1000;
  for (let tenure = Math.max(1, Math.ceil(principal / maxEmi)); tenure <= policy.maxTenureMonths; tenure++) {
    const v = L.evaluateEligibility(facts, { borrowerType: payroll, company, loanType: 'Personal', principal, tenure, asOf }, policy);
    if (v.eligible) return { principal, tenure, emi: v.emi };
  }
  return null;
}

/**
 * Suggests real, eligible borrowers for a rehearsal of the latest computed month.
 * plant (3): highest headroom · a shortfall (EMI above headroom) · a held salary
 *   (a really held one if eligible, otherwise the hold toggle).
 * sales (2): highest headroom · a leaver (Mark Left).
 * Read-only.
 */
function rehearsalPack(db, { payroll = 'plant', month = null, year = null, now = new Date() } = {}) {
  if (!['plant', 'sales'].includes(payroll)) return refuse('PAYROLL_INVALID', 'payroll must be plant or sales');
  const m = month && year ? { month: Number(month), year: Number(year) } : latestComputedMonth(db, payroll, now);
  if (!m || !isValidMonth(m)) return refuse('NO_COMPUTED_MONTH', `no computed ${payroll} month found before the current month`);
  const asOf = todayIst(now);
  const policy = L.readLoanPolicy(db);
  const rows = payroll === 'sales'
    ? db.prepare(`SELECT sc.*, e.name AS employee_name FROM sales_salary_computations sc
                    JOIN sales_employees e ON e.code = sc.employee_code AND e.company = sc.company
                    JOIN sales_uploads u ON u.month = sc.month AND u.year = sc.year AND u.company = sc.company AND u.is_active = 1
                   WHERE sc.month = ? AND sc.year = ? AND e.status = 'Active' ORDER BY sc.employee_code, sc.company`).all(m.month, m.year)
    : db.prepare(`SELECT sc.*, e.name AS employee_name, e.company AS master_company FROM salary_computations sc
                    JOIN employees e ON e.code = sc.employee_code
                   WHERE sc.month = ? AND sc.year = ? AND e.status = 'Active' ORDER BY sc.employee_code`).all(m.month, m.year);
  const candidates = [];
  let refused = 0;
  for (const r of rows) {
    const company = payroll === 'sales' ? r.company : text(r.master_company || r.company);
    const facts = L.loadBorrowerFacts(db, { borrowerType: payroll, employeeCode: r.employee_code, company, asOf });
    const loan = sizeLoan(facts, policy, payroll, company, asOf);
    if (!loan) { refused += 1; continue; }
    const headroomPaise = L.computeHeadroom({ earnedBasePaise: L.earnedBase(r, payroll), capPct: policy.deductionCapPct, priorDeductionsPaise: L.priorDeductions(r, payroll) });
    candidates.push({
      employeeCode: r.employee_code, employeeName: r.employee_name || null, company, ...loan,
      headroom: R(headroomPaise), headroomPaise, held: payroll === 'sales' ? r.status === 'hold' : r.salary_held === 1,
    });
  }
  const used = new Set();
  const take = (c, scenario, why) => { used.add(c.employeeCode); return { ...scenario, why, name: c.employeeName, headroom: c.headroom, emi: c.emi, reallyHeld: c.held }; };
  const base = (c) => ({ employeeCode: c.employeeCode, company: c.company, loanType: 'Personal', principal: c.principal, tenure: c.tenure, disburseMonthOffset: -1, markLeft: false, hold: false });
  const free = () => candidates.filter((c) => !used.has(c.employeeCode));
  const byHeadroomDesc = (a, b) => b.headroomPaise - a.headroomPaise;
  const picks = [];
  const warnings = [];
  const high = free().filter((c) => !c.held && c.headroomPaise >= toPaise(c.emi)).sort(byHeadroomDesc)[0] || free().sort(byHeadroomDesc)[0];
  if (high) picks.push(take(high, base(high), `highest headroom (₹${high.headroom}) — the EMI of ₹${high.emi} should be deducted in full`));
  if (payroll === 'plant') {
    const short = free().filter((c) => c.headroomPaise > 0 && c.headroomPaise < toPaise(c.emi)).sort((a, b) => a.headroomPaise - b.headroomPaise)[0]
      || free().sort((a, b) => a.headroomPaise - b.headroomPaise)[0];
    if (short) picks.push(take(short, base(short), `low headroom (₹${short.headroom}) against an EMI of ₹${short.emi} — expect a shortfall moved to the end`));
    const realHeld = free().find((c) => c.held);
    const rest = free().sort(byHeadroomDesc);
    const heldPick = realHeld || rest[Math.floor(rest.length / 2)];
    if (heldPick) {
      picks.push(take(heldPick, { ...base(heldPick), hold: true }, realHeld
        ? `salary really held in ${label(m)} — the close should leave the EMI provisional (the hold toggle keeps it held after the re-run)`
        : `no eligible employee has a held salary in ${label(m)}; the hold toggle is set — the close should leave the EMI provisional`));
    }
  } else {
    const rest = free().sort(byHeadroomDesc);
    const leaver = rest[0];
    if (leaver) picks.push(take(leaver, { ...base(leaver), markLeft: true, exitDate: defaultExitDate('sales', m) }, `leaver scenario — Mark Left in ${label(m)}: the whole loan falls due in the final payroll; what the headroom cannot take is the exit residual`));
  }
  const want = payroll === 'plant' ? 3 : 2;
  if (picks.length < want) warnings.push(`only ${picks.length} of ${want} eligible borrowers found for ${label(m)}`);
  return { ok: true, payroll, month: m.month, year: m.year, candidates: candidates.length, ineligible: refused, scenarios: picks, warnings };
}

module.exports = { runLoanDryRun, rehearsalPack, fingerprint, compareFingerprints, latestComputedMonth, DRY_RUN_STEPS: STEPS, DRY_RUN_ACTORS: ACTORS, MAX_SCENARIOS };

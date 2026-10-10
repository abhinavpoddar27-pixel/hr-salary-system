#!/usr/bin/env node
/**
 * Loans PR-11 — dry run simulation on a production-shaped FILE database (WAL,
 * the real getDb() handle, so logAudit() and the dry run share one connection
 * exactly as on Railway).
 *
 *   node backend/scripts/loans-dry-run-simulation.js [--keep <dir>]
 *
 * Builds a synthetic Aug + Sep 2026: ~600 plant employees (day_calculations,
 * attendance tail, ~10% advances, a few held, late-coming deductions) and ~230
 * sales reps on one company's computed upload. Stores Stage 7 for both months,
 * then marks every Sep day_calculations row salary_stale = 1 and perturbs some
 * (as production on 10 Oct 2026). Then:
 *   1  plant rehearsal pack for Sep → dry run
 *   2  sales rehearsal pack for Sep → dry run
 *   3  ten plant scenarios at once, mixed toggles, Aug with Sep as M+1
 *   4  a throw inside the close of a run
 *   5  a REAL loan already on the books (disbursed Jul, first EMI Aug, Aug closed
 *      for real), then a dry run for Sep: the real loan's Sep EMI rides along in
 *      the rehearsal close and is rolled back with it
 * After each run: an INDEPENDENT full-content hash of every table (not the
 * service's fingerprint) must equal the one before, except exactly one new
 * 'loan_dry_run' audit row; plus rollbackVerified, lockMs and fingerprint ms.
 * Exit 0 = every check passed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const KEEP = (() => { const i = args.indexOf('--keep'); return i >= 0 ? args[i + 1] : null; })();
const dir = KEEP || fs.mkdtempSync(path.join(os.tmpdir(), 'loans-dry-run-sim-'));
fs.mkdirSync(dir, { recursive: true });
for (const f of ['hr_system.db', 'hr_system.db-wal', 'hr_system.db-shm']) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* none */ } }
process.env.DATA_DIR = dir;

function silently(fn) {
  const { log, error, warn } = console;
  console.log = () => {}; console.error = () => {}; console.warn = () => {};
  try { return fn(); } finally { console.log = log; console.error = error; console.warn = warn; }
}

const db = silently(() => require('../src/database/db').getDb());
const L = require('../src/services/loans');
const D = require('../src/services/loans/dryRun');
const { recomputeSalary } = require('../src/services/recompute');
const SF = require('../src/__tests__/helpers/salesLoanFixture');

const IND = 'Indriyan Beverages Pvt Ltd';
const ALI = 'Asian Lakto Ind Ltd';
const ADMIN = { username: 'boss', role: 'admin' };
const NOW = new Date(Date.UTC(2026, 9, 10, 6, 0, 0));

let checks = 0; let failures = 0;
const check = (ok, msg) => { checks += 1; if (!ok) { failures += 1; console.error(`  FAIL ${msg}`); } };

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = rng(1101);

// ── build ───────────────────────────────────────────────────────────────────
const plantCodes = [];
silently(() => db.transaction(() => {
  const emp = db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, is_contractor, gross_salary)
                          VALUES (?, ?, 'PRODUCTION', ?, ?, 'Active', ?, ?, ?)`);
  const dc = db.prepare(`INSERT INTO day_calculations (employee_code, month, year, company, days_present, total_payable_days, paid_sundays, days_absent)
                         VALUES (?, ?, 2026, ?, ?, ?, 4, ?)`);
  const att = db.prepare("INSERT OR IGNORE INTO attendance_processed (employee_code, date, status_original, status_final, company, month, year) VALUES (?, ?, 'P', 'P', ?, ?, 2026)");
  const adv = db.prepare(`INSERT INTO salary_advances (employee_code, month, year, is_eligible, advance_amount, paid, recovered, recovery_month, recovery_year)
                          VALUES (?, 8, 2026, 1, ?, 1, 0, 9, 2026)`);
  const late = db.prepare(`INSERT INTO late_coming_deductions (employee_code, month, year, company, late_count, deduction_days, remark, applied_by, finance_status)
                           VALUES (?, 9, 2026, ?, 3, 0.5, 'late', 'hr1', 'approved')`);
  for (let i = 0; i < 600; i++) {
    const code = `SIM${String(i).padStart(4, '0')}`;
    const company = i % 3 === 0 ? ALI : IND;
    const type = i % 7 === 0 ? 'Contract' : (i % 11 === 0 ? 'SILP' : 'Permanent');
    const gross = 9000 + Math.floor(rand() * 30) * 1000;
    const doj = i % 9 === 0 ? '2026-06-01' : '2023-04-01';
    emp.run(code, `SIM EMP ${i}`, company, type, doj, type === 'Contract' ? 1 : 0, gross);
    for (const m of [8, 9]) {
      const days = 18 + Math.floor(rand() * 9);
      dc.run(code, m, company, days, days, 26 - days);
      const last = m === 8 ? 31 : 30;
      if (i % 40 !== 7) for (let d = last - 7; d <= last; d++) att.run(code, `2026-${String(m).padStart(2, '0')}-${d}`, company, m);
    }
    if (i % 10 === 3) adv.run(code, Math.floor(gross * 0.4));
    if (i % 50 === 5) late.run(code, company);
    plantCodes.push(code);
  }
})());
// LWF (#70): a quarter of the plant employees are flagged, so Stage 7 rows carry lwf_employee.
db.prepare("UPDATE employees SET lwf_applicable = 1 WHERE CAST(SUBSTR(code, 4) AS INTEGER) % 4 = 1").run();
for (const m of [8, 9]) {
  for (const co of [IND, ALI]) silently(() => recomputeSalary(db, { month: m, year: 2026, company: co, requestId: `stored-${m}` }));
}
// Production on 10 Oct 2026: every Sep day_calculations row is salary_stale = 1; some changed after Stage 7.
db.prepare('UPDATE day_calculations SET salary_stale = 1 WHERE month = 9 AND year = 2026').run();
db.prepare("UPDATE day_calculations SET total_payable_days = total_payable_days - 2, days_present = days_present - 2 WHERE month = 9 AND year = 2026 AND CAST(SUBSTR(employee_code, 4) AS INTEGER) % 13 = 0").run();

const reps = [];
silently(() => {
  for (let i = 0; i < 230; i++) reps.push(SF.addRep(db, { code: `SR${String(i).padStart(4, '0')}`, gross: 15000 + (i % 20) * 1000, hra: 2000 }));
  for (const m of [8, 9]) {
    SF.setUpload(db, { month: m, year: 2026, rows: reps.map((r, i) => ({ code: r.code, days: 20 + (i % 7) })) });
    SF.computeSalesMonth(db, { month: m, year: 2026 });
  }
  db.prepare("UPDATE sales_salary_computations SET status = 'hold' WHERE month = 9 AND year = 2026 AND CAST(SUBSTR(employee_code, 3) AS INTEGER) % 15 = 0").run();
});

// ── helpers ─────────────────────────────────────────────────────────────────
function dumpAll(auditMax) {
  const out = {};
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()) {
    const where = name === 'audit_log' ? ` WHERE id <= ${Number(auditMax)}` : name === 'sqlite_sequence' ? " WHERE name <> 'audit_log'" : '';
    const h = crypto.createHash('sha256');
    for (const row of db.prepare(`SELECT * FROM "${name}"${where} ORDER BY rowid`).raw().iterate()) h.update(JSON.stringify(row));
    out[name] = h.digest('hex');
  }
  return out;
}
const auditMax = () => db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM audit_log').get().m;

function dryRun(title, input, opts = {}) {
  const m = auditMax();
  const before = dumpAll(m);
  const r = silently(() => D.runLoanDryRun(db, input, ADMIN, { now: NOW, ...opts }));
  const after = dumpAll(m);
  const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
  const added = db.prepare('SELECT action_type FROM audit_log WHERE id > ?').all(m);
  check(changed.length === 0, `${title}: tables changed after the dry run: ${changed.join(', ')}`);
  check(added.length === 1 && added[0].action_type === 'loan_dry_run', `${title}: expected exactly one loan_dry_run audit row, got ${JSON.stringify(added)}`);
  check(r.verification && r.verification.rollbackVerified === true, `${title}: rollbackVerified`);
  check(!db.inTransaction, `${title}: no transaction left open`);
  const t = r.timings || {};
  console.log(`${title}: ok=${r.ok}${r.failedAt ? ` failedAt=${r.failedAt}` : ''} — in transaction ${t.lockMs} ms, fingerprints ${t.fingerprintBeforeMs} + ${t.fingerprintAfterMs} ms; tables unchanged ${changed.length === 0 ? 'YES' : 'NO'}`);
  return r;
}

function scenarioLine(s) {
  return `   #${s.index} ${s.employeeCode}: ${s.refusal ? `refused at ${s.refusal.stage} (${s.refusal.code})` : `due ₹${s.dueInMonth}, deducted ₹${s.deductedInMonth}, headroom ₹${s.headroom ? s.headroom.headroom : '—'}, stale Δnet ${s.salary.staleNetDifference}, loan Δnet ${s.salary.loanEffectOnNet}, balance ₹${s.loanAfter.remainingBalance}, reconciles ${s.reconciliation.ok}`}`;
}

// ── 1 plant pack ────────────────────────────────────────────────────────────
const pp = silently(() => D.rehearsalPack(db, { payroll: 'plant', now: NOW }));
check(pp.ok && pp.scenarios.length === 3, 'plant pack has 3 picks');
console.log(`plant pack ${pp.month}/${pp.year}: ${pp.candidates} eligible candidates, ${pp.ineligible} ineligible; picks ${pp.scenarios.map((s) => `${s.employeeCode}${s.hold ? ' (hold)' : ''}`).join(', ')}`);
const r1 = dryRun('1 plant pack', { month: pp.month, year: pp.year, payroll: 'plant', scenarios: pp.scenarios });
check(r1.ok, '1 completed');
if (r1.ok) {
  r1.scenarios.forEach((s) => console.log(scenarioLine(s)));
  check(r1.checks.ok, `1 drift/component/payslip checks: ${JSON.stringify(r1.checks)}`);
  check(r1.close.result.ok === true, `1 close ran: ${r1.close.result.code || ''}`);
  check(r1.close.result.held >= 1, '1 the hold pick is held at the close');
  check(r1.scenarios.every((s) => s.refusal || s.reconciliation.ok), '1 every loan reconciles');
  check(r1.scenarios.every((s) => s.refusal || s.salary.loanEffectOnNet === -s.deductedInMonth), '1 loan effect on net = −deduction');
}

// ── 2 sales pack ────────────────────────────────────────────────────────────
const sp = silently(() => D.rehearsalPack(db, { payroll: 'sales', now: NOW }));
check(sp.ok && sp.scenarios.length === 2, 'sales pack has 2 picks');
const r2 = dryRun('2 sales pack', { month: sp.month, year: sp.year, payroll: 'sales', scenarios: sp.scenarios });
check(r2.ok, '2 completed');
if (r2.ok) {
  r2.scenarios.forEach((s) => console.log(scenarioLine(s)));
  check(r2.checks.ok, '2 checks');
  check(r2.close.result.ok === true, '2 sales close ran');
  check(r2.exitResiduals.residuals.length + r2.exitResiduals.awaitingFinalPayroll.length >= 1, '2 the leaver appears in exit residuals');
}

// ── 3 ten scenarios, Aug with Sep as M+1 ────────────────────────────────────
const ten = plantCodes.filter((c, i) => i % 7 !== 0 && i % 9 !== 0).slice(0, 10).map((code, i) => ({
  employeeCode: code, principal: 6000, tenure: 3, disburseMonthOffset: i % 2 ? -1 : 0, hold: i === 3, markLeft: i === 5,
}));
const r3 = dryRun('3 ten scenarios, Aug + Sep', { month: 8, year: 2026, payroll: 'plant', scenarios: ten });
check(r3.ok, '3 completed');
if (r3.ok) {
  check(r3.nextMonth && r3.nextMonth.skipped === false, '3 Sep ran as M+1');
  check(r3.close.result.ok === true && r3.nextMonth.close.ok === true, `3 both closes ran (${r3.close.result.code || 'ok'}, ${r3.nextMonth.close && (r3.nextMonth.close.code || 'ok')})`);
  check(r3.checks.ok, `3 checks ${JSON.stringify(r3.checks).slice(0, 300)}`);
  console.log(`   10 scenarios: created ${r3.totals.loansCreated}, refused ${r3.totals.refused}, deducted Aug ₹${r3.totals.deductedInMonth}, Sep close posted ${r3.nextMonth.close.posted}`);
}

// ── 4 throw inside the close ────────────────────────────────────────────────
const orig = L.runLoanClose;
L.runLoanClose = () => { throw new Error('simulated close failure'); };
const r4 = dryRun('4 throw in close', { month: 9, year: 2026, payroll: 'plant', scenarios: pp.scenarios });
L.runLoanClose = orig;
check(r4.ok === false && r4.failedAt === 'close', '4 reported failedAt close');

// ── 5 a real loan already on the books ──────────────────────────────────────
const realCode = plantCodes[1];
silently(() => {
  const asOf = '2026-07-20';
  const rq = L.requestLoan(db, { borrowerType: 'plant', employeeCode: realCode, company: ALI === db.prepare('SELECT company FROM employees WHERE code = ?').get(realCode).company ? ALI : IND, loanType: 'Personal', principal: 9000, tenure: 3, reason: 'real' }, { username: 'hr1', role: 'hr' }, { asOf });
  if (!rq.ok) throw new Error(`real loan request: ${rq.code} ${rq.message}`);
  L.approveLoan(db, rq.loanId, { username: 'boss', role: 'admin' }, { asOf });
  const d = L.disburseLoan(db, rq.loanId, { username: 'fin1', role: 'finance' }, { mode: 'NEFT', reference: 'UTR', disbursedOn: '2026-07-15', agreementFilePath: 'a' }, { asOf });
  if (!d.ok) throw new Error(`real disburse: ${d.code}`);
  recomputeSalary(db, { month: 8, year: 2026, employeeCodes: [realCode], requestId: 'real-aug' });
  const c = L.runLoanClose(db, { payroll: 'plant', month: 8, year: 2026, trigger: 'manual', actor: { username: 'fin1', role: 'finance' }, now: NOW });
  if (!c.ok) throw new Error(`real Aug close: ${c.code} ${c.message}`);
  recomputeSalary(db, { month: 9, year: 2026, employeeCodes: [realCode], requestId: 'real-sep' });
});
check(db.prepare('SELECT COUNT(*) AS n FROM salary_computations WHERE month = 9 AND year = 2026 AND lwf_employee > 0').get().n > 0, 'LWF present on Sep rows (component check includes it)');
const realBefore = JSON.stringify(db.prepare('SELECT * FROM loan_deductions ORDER BY id').all());
const r5 = dryRun('5 with a real loan on the books', { month: 9, year: 2026, payroll: 'plant', scenarios: pp.scenarios });
check(r5.ok && r5.close.result.ok === true, `5 rehearsal close ran alongside the real loan (${r5.close && r5.close.result.code})`);
check(r5.ok && r5.close.result.posted >= 1, '5 posted');
check(JSON.stringify(db.prepare('SELECT * FROM loan_deductions ORDER BY id').all()) === realBefore, '5 the real loan’s ledger is untouched');
check(db.prepare("SELECT COUNT(*) AS n FROM loan_closes WHERE month = 9 AND year = 2026").get().n === 0, '5 no Sep close row survives');

console.log(`\n${checks - failures}/${checks} checks passed${KEEP ? `; database kept in ${dir}` : ''}`);
try { db.close(); } catch { /* closed */ }
if (!KEEP) fs.rmSync(dir, { recursive: true, force: true });
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/**
 * Loans PR-6 — loan close simulation over 4 payroll months (docs/loans/SPEC.md
 * §5.1, §5.2 r6–r8 and r13, D-5, D-10, D-14, D-19; K2, K5, K6, K19, K27–K29, K33, K34).
 *
 *   node backend/scripts/loans-close-simulation.js           # 7 loans, Nov 2026 – Feb 2027
 *   node backend/scripts/loans-close-simulation.js --empty   # no loans: the daily job writes nothing
 *
 * In-memory database built by the real initSchema(); real engine, real
 * recomputeSalary, real runDailyLoanJobs driven by an injected clock — every
 * day from 1 Nov 2026 to 30 Apr 2027 at 06:15 IST, plus two "server restarts".
 * Stage 7 for month M runs (twice) on the 5th of M+1, before the close on the
 * 13th; December is also reimported (salary rows deleted, recomputed).
 *
 * Loans (disbursed 5 Oct 2026, first EMI Nov 2026):
 *   normal     ₹10,000 / 3                      → completes at the Jan close
 *   shortfall  ₹12,000 / 6, no room any month   → 3 shortfall months, then the limit alert
 *   held-rel   held in Nov, released 19 Dec     → posted by the sweep, not by the close
 *   held-60    held in Dec, never released      → moved to the end on day 60 after the
 *                                                  Jan 13 close; release refused until re-run
 *   no-salary  no Stage 6 row in Dec            → Dec instalment moved to the end
 *   reversal   Nov posted, admin reverses 20 Dec → amount back on the schedule; Nov re-run = ₹0
 *   unborne    Nov posted; Nov re-run on 2 Jan with a big advance → opposite entry
 * Checks every day: every loan reconciles to the paisa; drift 0; component-short 0;
 * payslip = ledger except in the two documented windows. Exit 0 only if all pass.
 */
const Database = require('better-sqlite3');
const { initSchema } = require('../src/database/schema');
const { recomputeSalary } = require('../src/services/recompute');

const EMPTY = process.argv.includes('--empty');
const COMPANY = 'Indriyan Beverages Pvt Ltd';
const MONTHS = [[11, 2026], [12, 2026], [1, 2027], [2, 2027]];

function silently(fn) {
  const { log, error, warn } = console;
  console.log = () => {}; console.error = () => {}; console.warn = () => {};
  try { return fn(); } finally { console.log = log; console.error = error; console.warn = warn; }
}

const db = new Database(':memory:');
silently(() => initSchema(db));
const L = require('../src/services/loans');
const C = require('../src/services/loans/close');
const { startLoanCloseScheduler } = require('../src/services/loans/closeScheduler');

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };
const at = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 0, 45, 0));   // 06:15 IST
const key = (d) => d.toISOString().slice(0, 10);
const lastDay = (m, y) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// ── employees, Stage 6 rows, punches ─────────────────────────────────────────
const N = 30;
const emps = [];
const insEmp = db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, is_contractor, weekly_off_day, gross_salary)
                           VALUES (?, ?, 'PRODUCTION', ?, 'Permanent', 'Active', '2024-04-01', 0, 0, ?)`);
for (let i = 0; i < N; i++) {
  const code = `SIM${String(i + 1).padStart(3, '0')}`;
  insEmp.run(code, `SIM EMPLOYEE ${i + 1}`, COMPANY, 15000 + (i % 10) * 1000);
  emps.push(code);
}
const ROLE = { normal: emps[0], shortfall: emps[1], heldRel: emps[2], held60: emps[3], noSalary: emps[4], reversal: emps[5], unborne: emps[6] };
// heldRel is held in Nov, held60 in Dec; noSalary has no Dec row
const payable = (code, m) => ((code === ROLE.heldRel && m === 11) || (code === ROLE.held60 && m === 12) ? 2 : 26);

const insDc = db.prepare(`INSERT INTO day_calculations (employee_code, month, year, company, days_present, days_half_present, days_wop,
                            cl_used, el_used, sl_used, od_days, lop_days, total_payable_days, paid_sundays, paid_holidays, days_absent)
                          VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, ?, 0, 0, 0)`);
const insAtt = db.prepare(`INSERT OR IGNORE INTO attendance_processed (employee_code, date, status_original, status_final, company, month, year)
                           VALUES (?, ?, 'P', 'P', ?, ?, ?)`);
const insAdv = db.prepare(`INSERT INTO salary_advances (employee_code, month, year, is_eligible, advance_amount, paid, recovered, recovery_month, recovery_year)
                           VALUES (?, ?, ?, 1, ?, 1, 0, ?, ?)`);
function buildMonth(m, y) {
  for (const code of emps) {
    if (!EMPTY && code === ROLE.noSalary && m === 12) continue;
    const p = payable(code, m);
    insDc.run(code, m, y, COMPANY, p, p);
    if (p >= 5) for (let d = lastDay(m, y) - 7; d <= lastDay(m, y); d++) insAtt.run(code, `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, COMPANY, m, y);
  }
  // No room left a month for the shortfall borrower (gross 16,000 → cap 8,000, advance 7,900 + PF/ESI)
  if (!EMPTY) insAdv.run(ROLE.shortfall, m === 1 ? 12 : m - 1, m === 1 ? y - 1 : y, 7900, m, y);
}
for (const [m, y] of MONTHS) buildMonth(m, y);

const stage7 = (m, y, rid, opts = {}) => silently(() => recomputeSalary(db, { month: m, year: y, company: COMPANY, requestId: rid, ...opts }));
const salaryRows = (m, y) => db.prepare('SELECT * FROM salary_computations WHERE month = ? AND year = ? ORDER BY employee_code').all(m, y)
  .map((r) => {
    // id: a reimport re-inserts. hold_reason / finance_remark: the first Stage 7 after a finance
    // release rewrites them (P1, #48) — text only, unrelated to loans.
    const x = { ...r }; for (const k of ['id', 'computed_at', 'created_at', 'updated_at', 'hold_reason', 'finance_remark']) delete x[k]; return x;
  });
const drift = () => db.prepare('SELECT COUNT(*) AS n FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1').get().n;
const componentShort = () => db.prepare(`SELECT COUNT(*) AS n FROM salary_computations
  WHERE ABS(total_deductions - (COALESCE(pf_employee,0) + COALESCE(esi_employee,0) + COALESCE(professional_tax,0) + COALESCE(tds,0)
    + COALESCE(advance_recovery,0) + COALESCE(lop_deduction,0) + COALESCE(other_deductions,0) + COALESCE(loan_recovery,0)
    + COALESCE(late_coming_deduction,0) + COALESCE(early_exit_deduction,0))) > 1`).get().n;
const tableCounts = () => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n]));
const daily = (now, trigger = 'auto') => silently(() => C.runDailyLoanJobs(db, { now, trigger }));
const cronStub = { schedule: () => ({}) };
const boot = (now) => silently(() => startLoanCloseScheduler(db, { cronLib: cronStub, now }));

function eachDay(from, to, fn) {
  for (let t = from.getTime(); t <= to.getTime(); t += 86400000) fn(new Date(t));
}

// ── --empty: no loans; the daily job across six months + two boots writes nothing ──
if (EMPTY) {
  for (const [m, y] of MONTHS) { stage7(m, y, `e-${m}`); stage7(m, y, `e2-${m}`); }
  const before = tableCounts();
  let runs = 0;
  boot(at(2026, 11, 1));
  eachDay(at(2026, 11, 1), at(2027, 4, 30), (now) => { const r = daily(now); runs += 1; check(r.errors.length === 0, `${key(now)}: ${r.errors}`); });
  boot(at(2027, 2, 13)); boot(at(2027, 2, 13));
  const after = tableCounts();
  const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
  check(changed.length === 0, `tables changed: ${changed.map((t) => `${t} ${before[t]}→${after[t]}`).join(', ')}`);
  check(after.loan_closes === 0 && after.loans === 0 && after.loan_deductions === 0 && after.loan_adjustments === 0, 'loan tables not empty');
  check(drift() === 0 && componentShort() === 0, `drift ${drift()} component-short ${componentShort()}`);
  console.log(`--empty: ${Object.keys(before).length} tables, ${runs} daily runs + 3 boots, salary rows ${before.salary_computations}, `
    + `notifications ${after.notifications}, audit_log ${after.audit_log}, loan_closes ${after.loan_closes}; tables changed: ${changed.length}; `
    + `drift ${drift()}; component-short ${componentShort()}`);
  if (failures.length) { console.error(`FAIL (${failures.length})\n- ${failures.join('\n- ')}`); process.exit(1); }
  console.log('PASS');
  process.exit(0);
}

// ── loans ────────────────────────────────────────────────────────────────────
const HR = { username: 'hr1', role: 'hr' };
const FIN = { username: 'fin1', role: 'finance' };
const ADMIN = { username: 'admin1', role: 'admin' };
const loans = {};
for (const [name, principal, tenure] of [['normal', 10000, 3], ['shortfall', 12000, 6], ['heldRel', 6000, 3], ['held60', 6000, 3],
  ['noSalary', 6000, 3], ['reversal', 6000, 3], ['unborne', 6000, 3]]) {
  const asOf = '2026-10-09';
  const r = L.requestLoan(db, { borrowerType: 'plant', employeeCode: ROLE[name], company: COMPANY, loanType: 'Personal', principal, tenure, reason: 'sim' }, HR, { asOf });
  if (!r.ok) throw new Error(`${name}: ${r.code} ${r.message}`);
  L.approveLoan(db, r.loanId, ADMIN, { asOf });
  const d = L.disburseLoan(db, r.loanId, FIN, { mode: 'NEFT', reference: `UTR-${name}`, disbursedOn: '2026-10-05', agreementFilePath: 'a.pdf' }, { asOf });
  if (!d.ok) throw new Error(`${name}: ${d.code} ${d.message}`);
  loans[name] = r.loanId;
}
const loanIds = Object.values(loans);
const loan = (name) => db.prepare('SELECT * FROM loans WHERE id = ?').get(loans[name]);
const deds = (name) => db.prepare('SELECT * FROM loan_deductions WHERE loan_id = ? ORDER BY year, month').all(loans[name]);
const salary = (code, m, y) => db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?').get(code, m, y);

const expectedMismatch = new Set();   // 'code|m|y' allowed to disagree on a given day
let closesOn = [];
const log = [];

const events = {
  // Stage 7 for month M on the 5th of M+1 (twice: identical rows); Dec also reimported.
  '2026-12-05': () => { stage7(11, 2026, 'nov-a'); const a = salaryRows(11, 2026); stage7(11, 2026, 'nov-b'); check(JSON.stringify(a) === JSON.stringify(salaryRows(11, 2026)), 'Nov: Stage 7 re-run changed salary rows'); },
  '2026-12-19': () => {   // finance releases the November hold (what PUT /payroll/salary/:code/hold-release writes)
    check(C.loanHoldReleaseCheck(db, ROLE.heldRel, 11, 2026).ok, 'heldRel: release refused');
    db.prepare(`INSERT INTO salary_hold_releases (employee_code, month, year, company, hold_reason, hold_amount, released_by, release_notes)
                VALUES (?, 11, 2026, ?, 'sim', 0, 'fin1', 'paper ref')`).run(ROLE.heldRel, COMPANY);
    db.prepare("UPDATE salary_computations SET salary_held = 0, hold_released = 1, hold_released_by = 'fin1' WHERE employee_code = ? AND month = 11 AND year = 2026").run(ROLE.heldRel);
  },
  '2026-12-20': () => {   // admin reverses the November deduction of the reversal loan, then Nov is re-run for that employee
    const d = deds('reversal').find((x) => x.month === 11);
    const r = silently(() => C.reverseDeduction(db, { deductionId: d.id, reason: 'November salary was not paid' }, ADMIN));
    check(r.ok && r.added && r.added.origin === 'reversal', `reversal failed: ${JSON.stringify(r).slice(0, 200)}`);
    expectedMismatch.add(`${ROLE.reversal}|11|2026`);
    check(!C.checkPayslipLedger(db, { month: 11, year: 2026, employeeCode: ROLE.reversal }).ok, 'reversal: payslip should disagree until the re-run');
    stage7(11, 2026, 'nov-rev', { employeeCodes: [ROLE.reversal] });
    expectedMismatch.delete(`${ROLE.reversal}|11|2026`);
    check(salary(ROLE.reversal, 11, 2026).loan_recovery === 0, 'reversal: Nov re-run should deduct ₹0');
  },
  '2027-01-02': () => {   // unborne: Nov re-run for one employee after a large late advance shows up
    insAdv.run(ROLE.unborne, 10, 2026, 9000, 11, 2026);
    const before = deds('unborne').find((x) => x.month === 11);
    stage7(11, 2026, 'nov-unborne', { employeeCodes: [ROLE.unborne] });
    const adj = db.prepare("SELECT * FROM loan_adjustments WHERE loan_id = ? AND kind = 'unborne'").all(loans.unborne);
    check(adj.length === 1, `unborne: expected 1 opposite entry, got ${adj.length}`);
    check(JSON.stringify(deds('unborne').find((x) => x.month === 11)) === JSON.stringify(before), 'unborne: posted row was edited');
    check(Math.abs(salary(ROLE.unborne, 11, 2026).loan_recovery - (before.amount - (adj[0] ? adj[0].amount : 0))) < 0.005, 'unborne: payslip ≠ effective posted');
    stage7(11, 2026, 'nov-unborne-2', { employeeCodes: [ROLE.unborne] });
    check(db.prepare('SELECT COUNT(*) AS n FROM loan_adjustments WHERE loan_id = ?').get(loans.unborne).n === 1, 'unborne: second re-run wrote again');
  },
  '2027-01-05': () => {
    stage7(12, 2026, 'dec-a'); stage7(12, 2026, 'dec-b');
    const a = salaryRows(12, 2026);
    db.prepare('DELETE FROM salary_computations WHERE month = 12 AND year = 2026').run();   // reimport
    stage7(12, 2026, 'dec-reimport');
    check(JSON.stringify(a) === JSON.stringify(salaryRows(12, 2026)), 'Dec: reimport changed salary rows');
  },
  '2027-01-14': () => {   // after the Dec close: frozen re-run of Nov and Dec for everyone
    const nov = salaryRows(11, 2026); const dec = salaryRows(12, 2026); const l = loanIds.map((id) => db.prepare('SELECT * FROM loans WHERE id = ?').get(id));
    stage7(11, 2026, 'nov-frozen'); stage7(12, 2026, 'dec-frozen');
    const nov2 = salaryRows(11, 2026);
    if (JSON.stringify(nov) !== JSON.stringify(nov2)) {
      const diff = [];
      nov.forEach((r, i) => { for (const k of Object.keys(r)) if (JSON.stringify(r[k]) !== JSON.stringify(nov2[i][k])) diff.push(`${r.employee_code}.${k}: ${r[k]} → ${nov2[i][k]}`); });
      check(false, `Nov frozen re-run changed salary rows: ${diff.slice(0, 8).join('; ')}`);
    }
    check(JSON.stringify(dec) === JSON.stringify(salaryRows(12, 2026)), 'Dec frozen re-run changed salary rows');
    check(JSON.stringify(l) === JSON.stringify(loanIds.map((id) => db.prepare('SELECT * FROM loans WHERE id = ?').get(id))), 'frozen re-run moved a balance');
  },
  '2027-02-05': () => { stage7(1, 2027, 'jan-a'); stage7(1, 2027, 'jan-b'); },
  '2027-02-13': 'restart',
  '2027-03-05': () => { stage7(2, 2027, 'feb-a'); stage7(2, 2027, 'feb-b'); },
  '2027-03-14': () => {   // day 60 after the Dec close: the sweep (this morning) moved the held60 instalment
    const d = deds('held60').find((x) => x.month === 12);
    check(d && d.state === 'reversed' && d.reversal_reason === L.HELD_MOVE_REVERSAL_REASON, `held60: expected the loan-side stale marker, got ${d && d.state}`);
    check(!C.loanHoldReleaseCheck(db, ROLE.held60, 12, 2026).ok, 'held60: release should be refused before the re-run');
    expectedMismatch.add(`${ROLE.held60}|12|2026`);
    check(db.prepare('SELECT salary_stale FROM day_calculations WHERE employee_code = ? AND month = 12 AND year = 2026').get(ROLE.held60).salary_stale === 0, 'held60: salary_stale was touched');
    stage7(12, 2026, 'dec-held60', { employeeCodes: [ROLE.held60] });
    expectedMismatch.delete(`${ROLE.held60}|12|2026`);
    check(C.loanHoldReleaseCheck(db, ROLE.held60, 12, 2026).ok, 'held60: release should be allowed after the re-run');
  },
};

function dailyChecks(now) {
  for (const id of loanIds) {
    const r = L.reconcileLoan(db, id);
    if (!r.ok) check(false, `${key(now)}: loan ${id} does not reconcile: ${r.problems.join('; ')}`);
  }
  check(drift() === 0, `${key(now)}: drift ${drift()}`);
  check(componentShort() === 0, `${key(now)}: component-short ${componentShort()}`);
  for (const [m, y] of MONTHS) {
    for (const x of C.checkPayslipLedger(db, { month: m, year: y }).mismatches) {
      if (!expectedMismatch.has(`${x.employeeCode}|${m}|${y}`)) check(false, `${key(now)}: payslip ≠ ledger ${x.employeeCode} ${m}/${y}: ${x.payslip} vs ${x.ledger}`);
    }
  }
}

const bootOut = boot(at(2026, 11, 1));
check(bootOut && bootOut.errors.length === 0, 'first boot failed');
eachDay(at(2026, 11, 1), at(2027, 4, 30), (now) => {
  const ev = events[key(now)];
  const before = db.prepare('SELECT COUNT(*) AS n FROM loan_closes').get().n;
  const r = daily(now);
  if (ev === 'restart') { boot(now); boot(now); }   // two restarts after the cron ran: nothing more may close
  check(r.errors.length === 0, `${key(now)}: daily job errors ${r.errors}`);
  if (typeof ev === 'function') ev();
  const after = db.prepare('SELECT COUNT(*) AS n FROM loan_closes').get().n;
  if (after > before) {
    closesOn.push(key(now));
    const c = db.prepare('SELECT * FROM loan_closes ORDER BY id DESC LIMIT 1').get();
    log.push(`${key(now)} close ${c.month}/${c.year}: posted ${c.posted_count} (₹${c.posted_amount}), held ${c.held_count}, shortfall ${c.shortfall_count}, no salary ${c.no_salary_count}, recon ${c.reconciliation_ok}`);
  }
  if (r.sweep && (r.sweep.posted || r.sweep.moved)) log.push(`${key(now)} sweep: posted ${r.sweep.posted}, moved ${r.sweep.moved}`);
  dailyChecks(now);
});

// ── end-state checks ─────────────────────────────────────────────────────────
const closes = db.prepare('SELECT * FROM loan_closes ORDER BY id').all();
check(JSON.stringify(closes.map((c) => [c.month, c.year, c.payroll])) === JSON.stringify(MONTHS.map(([m, y]) => [m, y, 'plant'])), `closes: ${JSON.stringify(closes.map((c) => [c.month, c.year]))}`);
check(JSON.stringify(closesOn) === JSON.stringify(['2026-12-13', '2027-01-13', '2027-02-13', '2027-03-13']), `close days: ${closesOn}`);
check(closes.every((c) => c.trigger_kind === 'auto' && c.reconciliation_ok === 1), 'a close was not auto or did not reconcile');
check(loan('normal').status === 'completed', `normal: ${loan('normal').status}`);
check(deds('heldRel').find((x) => x.month === 11).state === 'posted', 'heldRel: Nov not posted by the sweep');
check(closes[0].held_count === 1 && closes[1].held_count === 1, 'held counts at Nov / Dec closes');
const sf = db.prepare('SELECT * FROM loan_instalments WHERE loan_id = ? ORDER BY sequence').all(loans.shortfall);
check(sf.filter((i) => i.origin === 'shortfall').length === 3, `shortfall: ${sf.filter((i) => i.origin === 'shortfall').length} shortfall instalments`);
check(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'LOAN_EXTENSION_LIMIT_REACHED'").get().n >= 1, 'shortfall: no limit alert');
check(db.prepare('SELECT COUNT(*) AS n FROM loan_instalments WHERE loan_id = ? AND origin = ?').get(loans.noSalary, 'no_salary').n === 1, 'noSalary: Dec not moved');
check(db.prepare('SELECT COUNT(*) AS n FROM loan_instalments WHERE loan_id = ? AND origin = ?').get(loans.held60, 'held').n === 1, 'held60: not moved');
check(db.prepare("SELECT COUNT(*) AS n FROM loan_deductions WHERE state = 'provisional'").get().n === 0, 'provisional rows left at the end');
const noDouble = db.prepare('SELECT loan_id, month, year, COUNT(*) AS n FROM loan_deductions GROUP BY 1, 2, 3 HAVING n > 1').all();
check(noDouble.length === 0, 'a loan-month has two deduction rows');

for (const l of log) console.log(l);
for (const [name, id] of Object.entries(loans)) {
  const r = L.reconcileLoan(db, id);
  console.log(`${name.padEnd(9)} loan ${id}: ${loan(name).status.padEnd(9)} disbursed ₹${r.disbursed} posted ₹${r.posted} adjusted ₹${r.adjusted} balance ₹${r.balance} uncovered ₹${r.uncovered} ${r.ok ? 'reconciles' : 'MISMATCH'}`);
}
console.log(`closes ${closes.length} on ${closesOn.join(', ')}; drift ${drift()}; component-short ${componentShort()}; notifications ${tableCounts().notifications}`);
if (failures.length) { console.error(`FAIL (${failures.length})\n- ${failures.slice(0, 40).join('\n- ')}`); process.exit(1); }
console.log('PASS');

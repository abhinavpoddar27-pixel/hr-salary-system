#!/usr/bin/env node
/**
 * Loans PR-7 — exit recovery simulation (docs/loans/SPEC.md §5.2 r11, §5.4,
 * D-7, D-14, D-15, D-21; K9, K20, K32, K35; planner rulings Q-A … Q-D).
 *
 *   node backend/scripts/loans-exit-simulation.js           # 5 leavers, Nov 2026 – Mar 2027
 *   node backend/scripts/loans-exit-simulation.js --empty   # no loans: the daily job writes nothing
 *   node backend/scripts/loans-exit-simulation.js --keep db.sqlite   # also write the final database (Loans PR-9 reports sim)
 *
 * In-memory database built by the real initSchema(); real engine, real
 * recomputeSalary, real runDailyLoanJobs on an injected clock — every day from
 * 1 Nov 2026 to 31 Mar 2027 at 06:15 IST. Stage 7 for month M runs (twice) on
 * the 5th of M+1; the loan close runs on the 13th. Mark Left is the engine
 * path the Mark Left route uses (flag + consolidateForExit) plus status 'Left'.
 *
 * Loans disbursed 5 Oct 2026, first EMI Nov 2026; Nov is posted normally for all.
 *   A  ₹12,000/6  exit 15 Dec, Mark Left 16 Dec  → Dec final payroll partly recovers within the cap;
 *                                                  13 Jan close → residual alert; receipt 20 Jan → settled_at_exit
 *   B  ₹12,000/6  same shape                       → residual → HR write-off request 21 Jan → admin approves
 *                                                  → settled_at_exit; in the TDS list (Jan by write-off, Dec by basis=final)
 *   C  ₹6,000/3   exit 30 Nov, Mark Left 20 Dec    → the Nov close already ran: residual at once; still open at the end
 *   D  ₹6,000/3   exit 10 Dec, final salary held, never released → held at the Jan close; day 60 → residual
 *   E  ₹3,000/3   exit 28 Dec, Mark Left 29 Dec    → fully recovered in the final payroll → settled_at_exit at the close
 * Checks every day: every loan reconciles to the paisa; drift 0; component-short 0;
 * payslip = ledger; no open instalment after an exit loan's final month; exit loans
 * never use an extension month. Exit 0 only if all pass.
 */
const Database = require('better-sqlite3');
const { initSchema } = require('../src/database/schema');
const { recomputeSalary } = require('../src/services/recompute');

const EMPTY = process.argv.includes('--empty');
const KEEP = (() => { const i = process.argv.indexOf('--keep'); return i >= 0 ? process.argv[i + 1] : null; })();
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
const common = require('../src/services/loans/common');
const { startLoanCloseScheduler } = require('../src/services/loans/closeScheduler');

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };
const at = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 0, 45, 0));   // 06:15 IST
const key = (d) => d.toISOString().slice(0, 10);
const lastDay = (m, y) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const mi = (m, y) => y * 12 + m;

// ── employees, Stage 6 rows, punches ─────────────────────────────────────────
const N = 20;
const emps = [];
const insEmp = db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, is_contractor, weekly_off_day, gross_salary)
                           VALUES (?, ?, 'PRODUCTION', ?, 'Permanent', 'Active', '2024-04-01', 0, 0, ?)`);
for (let i = 0; i < N; i++) {
  const code = `EXS${String(i + 1).padStart(3, '0')}`;
  insEmp.run(code, `EXIT SIM ${i + 1}`, COMPANY, 16000 + (i % 5) * 1000);
  emps.push(code);
}
const ROLE = { A: emps[0], B: emps[1], C: emps[2], D: emps[3], E: emps[4] };
// Final month (Dec) payable days of the leavers; C has left in Nov (no Dec row) and nobody leaver works after Dec.
const DEC_PAYABLE = { [ROLE.A]: 13, [ROLE.B]: 13, [ROLE.D]: 2, [ROLE.E]: 24 };
const leaver = new Set(EMPTY ? [] : Object.values(ROLE));

const insDc = db.prepare(`INSERT INTO day_calculations (employee_code, month, year, company, days_present, days_half_present, days_wop,
                            cl_used, el_used, sl_used, od_days, lop_days, total_payable_days, paid_sundays, paid_holidays, days_absent)
                          VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, ?, 0, 0, 0)`);
const insAtt = db.prepare(`INSERT OR IGNORE INTO attendance_processed (employee_code, date, status_original, status_final, company, month, year)
                           VALUES (?, ?, 'P', 'P', ?, ?, ?)`);
function buildMonth(m, y) {
  for (const code of emps) {
    let p = 26;
    if (leaver.has(code)) {
      if (mi(m, y) > mi(12, 2026)) continue;                      // gone after December
      if (m === 12 && code === ROLE.C) continue;                   // C left in November
      if (m === 12) p = DEC_PAYABLE[code];
    }
    insDc.run(code, m, y, COMPANY, p, p);
    if (p >= 5) for (let d = lastDay(m, y) - 7; d <= lastDay(m, y); d++) insAtt.run(code, `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, COMPANY, m, y);
  }
}
for (const [m, y] of MONTHS) buildMonth(m, y);
// A and B: a running salary advance leaves little room in the final payroll.
const insAdv = db.prepare(`INSERT INTO salary_advances (employee_code, month, year, is_eligible, advance_amount, paid, recovered, recovery_month, recovery_year)
                           VALUES (?, 11, 2026, 1, ?, 1, 0, 12, 2026)`);
if (!EMPTY) { insAdv.run(ROLE.A, 2500); insAdv.run(ROLE.B, 2500); }

const stage7 = (m, y, rid) => silently(() => recomputeSalary(db, { month: m, year: y, company: COMPANY, requestId: rid }));
const drift = () => db.prepare('SELECT COUNT(*) AS n FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1').get().n;
const componentShort = () => db.prepare(`SELECT COUNT(*) AS n FROM salary_computations
  WHERE ABS(total_deductions - (COALESCE(pf_employee,0) + COALESCE(esi_employee,0) + COALESCE(professional_tax,0) + COALESCE(tds,0)
    + COALESCE(advance_recovery,0) + COALESCE(lop_deduction,0) + COALESCE(other_deductions,0) + COALESCE(loan_recovery,0)
    + COALESCE(late_coming_deduction,0) + COALESCE(early_exit_deduction,0))) > 1`).get().n;
const tableCounts = () => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n]));
const daily = (now) => silently(() => C.runDailyLoanJobs(db, { now, trigger: 'auto' }));
const boot = (now) => silently(() => startLoanCloseScheduler(db, { cronLib: { schedule: () => ({}) }, now }));
function eachDay(from, to, fn) { for (let t = from.getTime(); t <= to.getTime(); t += 86400000) fn(new Date(t)); }

// ── --empty: no loans; Stage 7 twice a month, Mark Left of a leaver, the daily job — nothing loan-side is written ──
if (EMPTY) {
  for (const [m, y] of MONTHS) { stage7(m, y, `e-${m}`); stage7(m, y, `e2-${m}`); }
  const before = tableCounts();
  let runs = 0;
  boot(at(2026, 11, 1));
  eachDay(at(2026, 11, 1), at(2027, 3, 31), (now) => { const r = daily(now); runs += 1; check(r.errors.length === 0, `${key(now)}: ${r.errors}`); });
  const after = tableCounts();
  const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
  check(changed.length === 0, `tables changed: ${changed.map((t) => `${t} ${before[t]}→${after[t]}`).join(', ')}`);
  check(after.loan_closes === 0 && after.loans === 0 && after.loan_deductions === 0, 'loan tables not empty');
  const ex = L.listExitResiduals(db);
  check(ex.residuals.length === 0 && ex.awaitingFinalPayroll.length === 0, 'exit list not empty');
  check(drift() === 0 && componentShort() === 0, `drift ${drift()} component-short ${componentShort()}`);
  console.log(`--empty: ${Object.keys(before).length} tables, ${runs} daily runs + 1 boot, salary rows ${before.salary_computations}; tables changed: ${changed.length}; `
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
for (const [name, principal, tenure] of [['A', 12000, 6], ['B', 12000, 6], ['C', 6000, 3], ['D', 6000, 3], ['E', 3000, 3]]) {
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
const recon = (name) => L.reconcileLoan(db, loans[name]);
const salary = (code, m, y) => db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?').get(code, m, y);
const notes = (type, loanId) => db.prepare('SELECT * FROM notifications WHERE type = ? AND message LIKE ? ORDER BY id').all(type, `Loan ${loanId} %`);
const log = [];
const seen = {};

let today = null;
function markLeft(name, exitDate) {
  const r = L.flagForExit(db, loans[name], HR, { exitDate, reason: 'resigned' });
  check(r.ok && r.status === 'recover_at_exit', `${name}: flag failed ${JSON.stringify(r).slice(0, 160)}`);
  db.prepare("UPDATE employees SET status = 'Left', date_of_exit = ? WHERE code = ?").run(exitDate, ROLE[name]);
  silently(() => require('../src/services/loans/notify').notifyAlerts(db, r.alerts));
  log.push(`${key(today)} Mark Left ${name} (exit ${exitDate}): final month ${common.finalMonthOf(loan(name)).month}/${common.finalMonthOf(loan(name)).year}`
    + `${r.exit.finalMonthPast ? ' (already closed)' : ''}, due in final payroll ₹${r.exit.dueInFinalPayroll}, residual ₹${r.exit.residual}`);
  return r;
}

const events = {
  '2026-12-05': () => { stage7(11, 2026, 'nov-a'); stage7(11, 2026, 'nov-b'); },
  '2026-12-12': () => markLeft('D', '2026-12-10'),
  '2026-12-16': () => { markLeft('A', '2026-12-15'); markLeft('B', '2026-12-15'); },
  '2026-12-20': () => {
    const r = markLeft('C', '2026-11-30');   // the Nov close ran on 13 Dec
    check(r.exit.finalMonthPast && r.exit.residual === 4000, `C: expected residual ₹4000 at Mark Left, got ${JSON.stringify(r.exit)}`);
    check(notes('LOAN_EXIT_RESIDUAL', loans.C).length === 1, 'C: no residual alert at Mark Left');
  },
  '2026-12-29': () => markLeft('E', '2026-12-28'),
  '2027-01-05': () => {
    stage7(12, 2026, 'dec-a');
    const a = db.prepare('SELECT * FROM loan_deductions ORDER BY id').all();
    stage7(12, 2026, 'dec-b');
    const b = db.prepare('SELECT * FROM loan_deductions ORDER BY id').all();
    check(JSON.stringify(a.map((x) => [x.id, x.amount, x.state])) === JSON.stringify(b.map((x) => [x.id, x.amount, x.state])), 'Dec: Stage 7 re-run changed the ledger');
    for (const n of ['A', 'B', 'E', 'D']) seen[n] = salary(ROLE[n], 12, 2026);
    check(seen.D.salary_held === 1, 'D: final salary should be held');
    for (const n of ['A', 'B']) check(seen[n].loan_recovery > 0 && seen[n].loan_recovery < loan(n).remaining_balance, `${n}: final payroll should recover part (₹${seen[n].loan_recovery} of ₹${loan(n).remaining_balance})`);
    check(seen.E.loan_recovery === loan('E').remaining_balance, `E: final payroll should recover all (₹${seen.E.loan_recovery} of ₹${loan('E').remaining_balance})`);
    const w = C.closeReadiness(db, { month: 12, year: 2026, now: at(2027, 1, 13) });
    check(w.ok && w.warnings.filter((x) => x.code === 'EXIT_FINAL_PAYROLL_SHORT').map((x) => x.loanId).sort().join() === [loans.A, loans.B, loans.D].sort().join(),
      `readiness: EXIT_FINAL_PAYROLL_SHORT for A, B, D expected, got ${JSON.stringify(w.warnings)}`);
  },
  '2027-01-10': () => {   // finance releases the final-salary holds it has settled (F&F) — not D's
    for (const n of ['A', 'B', 'E']) db.prepare("UPDATE salary_computations SET salary_held = 0, hold_released = 1, hold_released_by = 'fin1' WHERE employee_code = ? AND month = 12 AND year = 2026 AND salary_held = 1").run(ROLE[n]);
  },
  '2027-01-13': () => {   // the Dec close ran this morning
    for (const n of ['A', 'B']) {
      const r = recon(n);
      check(loan(n).status === 'recover_at_exit' && r.uncovered > 0 && r.openInstalments === 0, `${n}: expected an exit residual, got ${loan(n).status} ${JSON.stringify(r)}`);
      check(notes('LOAN_EXIT_RESIDUAL', loans[n]).length === 1, `${n}: residual alert missing`);
    }
    check(loan('E').status === 'settled_at_exit', `E: ${loan('E').status}`);
    check(notes('LOAN_EXIT_FINAL_HELD', loans.D).length === 1, 'D: held final salary alert missing');
    const c = db.prepare('SELECT * FROM loan_closes WHERE month = 12 AND year = 2026').get();
    const ex = JSON.parse(c.notes).exitResiduals;
    check(ex.map((x) => x.loanId).sort().join() === [loans.A, loans.B, loans.D].sort().join(), `Dec close exitResiduals: ${JSON.stringify(ex)}`);
    const list = L.listExitResiduals(db);
    const d = list.residuals.find((x) => x.loanId === loans.D);
    check(d && d.stage === 'held_pending' && d.heldPending > 0, `D: expected held_pending in the list, got ${JSON.stringify(d)}`);
  },
  '2027-01-20': () => {
    const res = recon('A').uncovered;
    const r = L.recordReceipt(db, loans.A, FIN, { amount: res, mode: 'Cash', reference: 'F&F', receiptDate: '2027-01-20' }, { asOf: '2027-01-20' });
    check(r.ok && r.loanStatus === 'settled_at_exit', `A: receipt ${JSON.stringify(r).slice(0, 200)}`);
    seen.receiptA = res;
  },
  '2027-01-21': () => {
    const q = L.requestChange(db, { loanId: loans.B, kind: 'write_off', reason: 'left; nothing left in final dues' }, HR);
    check(q.ok, `B: write-off request ${q.code}`);
    seen.writeOffB = loan('B').remaining_balance;
    const a = L.approveChange(db, q.requestId, ADMIN, { reason: 'approved' });
    check(a.ok && loan('B').status === 'settled_at_exit', `B: approve ${JSON.stringify(a).slice(0, 200)}`);
  },
  '2027-02-05': () => { stage7(1, 2027, 'jan-a'); },
  '2027-03-05': () => { stage7(2, 2027, 'feb-a'); },
  '2027-03-14': () => {   // day 60 after the 13 Jan close: this morning's sweep turned D's held final month into residual
    check(recon('D').uncovered === 4000 && recon('D').openInstalments === 0, `D: expected residual ₹4000, got ${JSON.stringify(recon('D'))}`);
    check(notes('LOAN_EXIT_RESIDUAL', loans.D).length === 1, 'D: residual alert missing');
    check(db.prepare("SELECT status FROM loan_instalments WHERE loan_id = ? AND due_month = 12").get(loans.D).status === 'cancelled', 'D: Dec instalment should be cancelled');
    // K28 (PR-6): the held salary row still shows the deduction until Stage 7 is re-run; release is refused meanwhile.
    check(!C.loanHoldReleaseCheck(db, ROLE.D, 12, 2026).ok, 'D: release should be refused before the re-run');
    silently(() => recomputeSalary(db, { month: 12, year: 2026, company: COMPANY, requestId: 'dec-D', employeeCodes: [ROLE.D] }));
    check(salary(ROLE.D, 12, 2026).loan_recovery === 0, `D: Dec re-run should deduct ₹0, got ${salary(ROLE.D, 12, 2026).loan_recovery}`);
    check(C.loanHoldReleaseCheck(db, ROLE.D, 12, 2026).ok, 'D: release should be allowed after the re-run');
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
    for (const x of C.checkPayslipLedger(db, { month: m, year: y }).mismatches) check(false, `${key(now)}: payslip ≠ ledger ${x.employeeCode} ${m}/${y}: ${x.payslip} vs ${x.ledger}`);
  }
  for (const l of db.prepare("SELECT * FROM loans WHERE exit_flag = 1 AND status IN ('recover_at_exit','settled_at_exit')").all()) {
    const F = common.finalMonthOf(l);
    const late = db.prepare("SELECT COUNT(*) AS n FROM loan_instalments WHERE loan_id = ? AND status IN ('scheduled','provisional') AND (due_year * 12 + due_month) > ?").get(l.id, mi(F.month, F.year)).n;
    check(late === 0, `${key(now)}: loan ${l.id} has ${late} open instalment(s) after its final month`);
    check(common.extensionMonthsUsed(db.prepare('SELECT * FROM loan_instalments WHERE loan_id = ?').all(l.id)) <= 0
      || db.prepare("SELECT MAX(id) AS m FROM loan_instalments WHERE loan_id = ? AND origin IN ('shortfall','no_salary','held')").get(l.id).m
         < db.prepare("SELECT MIN(id) AS m FROM loan_events WHERE loan_id = ? AND event = 'borrower_left'").get(l.id).m,
    `${key(now)}: exit loan ${l.id} used an extension month after Mark Left`);
  }
}

boot(at(2026, 11, 1));
eachDay(at(2026, 11, 1), at(2027, 3, 31), (now) => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM loan_closes').get().n;
  const r = daily(now);
  check(r.errors.length === 0, `${key(now)}: daily job errors ${r.errors}`);
  const ev = events[key(now)];
  today = now;
  if (ev) ev();
  if (db.prepare('SELECT COUNT(*) AS n FROM loan_closes').get().n > before) {
    const c = db.prepare('SELECT * FROM loan_closes ORDER BY id DESC LIMIT 1').get();
    const ex = (JSON.parse(c.notes).exitResiduals || []).map((x) => `${x.loanId}: residual ₹${x.residual}, held ₹${x.heldPending}`).join('; ');
    log.push(`${key(now)} close ${c.month}/${c.year}: posted ${c.posted_count} (₹${c.posted_amount}), held ${c.held_count}, shortfall ${c.shortfall_count}, no salary ${c.no_salary_count}, recon ${c.reconciliation_ok}${ex ? `; exit [${ex}]` : ''}`);
  }
  if (r.sweep && (r.sweep.posted || r.sweep.moved)) log.push(`${key(now)} sweep: posted ${r.sweep.posted}, moved ${r.sweep.moved}`);
  dailyChecks(now);
});

// ── end state ────────────────────────────────────────────────────────────────
check(loan('A').status === 'settled_at_exit' && db.prepare('SELECT COUNT(*) AS n FROM loan_receipts WHERE loan_id = ?').get(loans.A).n === 1, 'A: not settled by one receipt');
check(loan('B').status === 'settled_at_exit' && loan('B').written_off_amount === seen.writeOffB, `B: write-off ₹${loan('B').written_off_amount}`);
// written_off_at is the real clock (datetime('now')), not the simulated day: list by that month.
const woAt = new Date(`${loan('B').written_off_at.replace(' ', 'T')}Z`);
const woIst = new Date(woAt.getTime() + 330 * 60000);
const tdsJan = L.writeOffsForTds(db, { month: woIst.getUTCMonth() + 1, year: woIst.getUTCFullYear() });
const tdsDecFinal = L.writeOffsForTds(db, { month: 12, year: 2026, basis: 'final' });
check(tdsJan.length === 1 && tdsJan[0].loanId === loans.B && tdsJan[0].amount === seen.writeOffB && tdsJan[0].finalMonth.month === 12, `TDS Jan: ${JSON.stringify(tdsJan)}`);
check(tdsDecFinal.length === 1 && tdsDecFinal[0].loanId === loans.B, `TDS Dec (final): ${JSON.stringify(tdsDecFinal)}`);
check(loan('C').status === 'recover_at_exit' && recon('C').uncovered === 4000, `C: ${loan('C').status} ${recon('C').uncovered}`);
check(loan('D').status === 'recover_at_exit' && recon('D').uncovered === 4000, `D: ${loan('D').status}`);
check(loan('E').status === 'settled_at_exit' && loan('E').written_off_amount === 0, `E: ${loan('E').status}`);
const list = L.listExitResiduals(db);
check(list.residuals.map((x) => x.loanId).sort().join() === [loans.C, loans.D].sort().join() && list.residuals.every((x) => x.stage === 'residual' && x.residual === 4000),
  `final exit list: ${JSON.stringify(list.residuals)}`);
check(db.prepare("SELECT COUNT(*) AS n FROM loan_events WHERE event = 'extension_limit_reached'").get().n === 0, 'an extension-limit event was written');
check(db.prepare("SELECT COUNT(*) AS n FROM loan_deductions WHERE state = 'provisional'").get().n === 0, 'provisional rows left at the end');

for (const l of log) console.log(l);
for (const name of Object.keys(loans)) {
  const r = recon(name);
  console.log(`${name} loan ${loans[name]}: ${loan(name).status.padEnd(15)} disbursed ₹${r.disbursed} posted ₹${r.posted} receipts ₹${r.receipts} written off ₹${r.writtenOff} balance ₹${r.balance} residual ₹${r.uncovered} ${r.ok ? 'reconciles' : 'MISMATCH'}`);
}
console.log(`final payroll (Dec) loan recovery: A ₹${seen.A.loan_recovery}, B ₹${seen.B.loan_recovery}, D ₹${seen.D.loan_recovery} (held), E ₹${seen.E.loan_recovery}; A receipt ₹${seen.receiptA}; B write-off ₹${seen.writeOffB}`);
console.log(`TDS: by write-off month ${woIst.getUTCMonth() + 1}/${woIst.getUTCFullYear()} (real clock) → ${tdsJan.map((x) => `loan ${x.loanId} ₹${x.amount}`).join(', ')}; Dec 2026 by final month → ${tdsDecFinal.map((x) => `loan ${x.loanId}`).join(', ')}`);
console.log(`drift ${drift()}; component-short ${componentShort()}; notifications ${tableCounts().notifications}`);
// Loans PR-9: --keep <file> writes the final database for loans-reports-simulation.js.
if (KEEP) require('fs').writeFileSync(KEEP, db.serialize());
if (failures.length) { console.error(`FAIL (${failures.length})\n- ${failures.slice(0, 40).join('\n- ')}`); process.exit(1); }
console.log('PASS');

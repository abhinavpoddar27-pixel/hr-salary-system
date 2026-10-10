#!/usr/bin/env node
/**
 * Loans PR-9 — reports simulation: every report and the payslip balance line,
 * checked against the loan ledger TO THE PAISA, on the final databases of the
 * PR-6 / PR-7 / PR-8 simulations (real Stage 7, real closes, real sales
 * compute, synthetic data):
 *
 *   node backend/scripts/loans-close-simulation.js --keep /tmp/x/close.db
 *   node backend/scripts/loans-exit-simulation.js  --keep /tmp/x/exit.db
 *   node backend/scripts/loans-sales-simulation.js --keep /tmp/x/sales.db
 *   node backend/scripts/loans-reports-simulation.js /tmp/x/close.db /tmp/x/exit.db /tmp/x/sales.db
 *
 * Per database:
 *   register   total = Σ live remaining_balance; groups and companies sum to it;
 *              disbursed − recovered − cash − written off = balance per loan
 *   forecast   overdue + months + later + unscheduled = outstanding, for several starts
 *   exceptions = an independent SQL sum of open exception instalments + uncovered
 *   leavers    residual total = Σ (balance − open instalments) of past-final exit loans
 *   perquisite listed ⇔ peak > threshold; at threshold 0 the month-end closings of
 *              the last month sum to the ledger; at a huge threshold nobody is listed
 *   payslip    every borrower-month with a deduction: outstanding after this month's
 *              EMI = an INDEPENDENT ledger replay (SQL) to month M, less the
 *              provisional EMI; posted months = the statement's closing
 *   drift      plant drift (check 1), component check 2, sales drift = 0 rows
 *   flags      detectRedFlags / readiness overdue run without error on every month
 * The policy edits for the perquisite thresholds are made on the scratch file and
 * put back. Exit 0 = every check passed.
 */
const Database = require('better-sqlite3');
const L = require('../src/services/loans');
const { toPaise, toRupees } = require('../src/services/loans/money');
const { payrollMonthOf, monthIndex, fromIndex, monthLabel } = require('../src/services/loans/months');
const { detectRedFlags } = require('../src/services/financeRedFlags');

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: loans-reports-simulation.js <db> [<db> …]'); process.exit(2); }

let failures = 0;
let checks = 0;
const check = (ok, msg) => { checks += 1; if (!ok) { failures += 1; console.error(`  FAIL ${msg}`); } };

const DRIFT = 'SELECT COUNT(*) AS n FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1';
const COMPONENTS = `SELECT COUNT(*) AS n FROM salary_computations WHERE ABS(total_deductions - (COALESCE(pf_employee,0) + COALESCE(esi_employee,0)
  + COALESCE(professional_tax,0) + COALESCE(tds,0) + COALESCE(advance_recovery,0) + COALESCE(lop_deduction,0) + COALESCE(other_deductions,0)
  + COALESCE(loan_recovery,0) + COALESCE(late_coming_deduction,0) + COALESCE(early_exit_deduction,0))) > 1`;
const SALES_DRIFT = `SELECT COUNT(*) AS n FROM sales_salary_computations
  WHERE ABS(net_salary - (gross_earned + COALESCE(diwali_bonus,0) + COALESCE(incentive_amount,0) - total_deductions)) > 1`;

/** IST date of a UTC SQLite timestamp. */
const istDate = (ts) => new Date(new Date(`${String(ts).replace(' ', 'T')}Z`).getTime() + 330 * 60000).toISOString().slice(0, 10);

/**
 * Independent replay of one loan's balance at the end of payroll month M (paise),
 * straight from the ledger tables — NOT through loanStatement.
 */
function replayBalance(db, loan, M) {
  const k = monthIndex(M);
  const pm = (d) => payrollMonthOf(d, loan.borrower_type);
  const le = (m) => !!m && monthIndex(m) <= k;
  let bal = 0;
  if (loan.disbursed_on && le(pm(loan.disbursed_on))) bal += toPaise(loan.principal_amount);
  for (const t of db.prepare("SELECT amount, reason, created_at FROM loan_events WHERE loan_id = ? AND event = 'topup_disbursed'").all(loan.id)) {
    const on = /\[disbursed_on=(\d{4}-\d{2}-\d{2})\]/.exec(t.reason || '');
    if (le(pm(on ? on[1] : istDate(t.created_at)))) bal += toPaise(t.amount);
  }
  for (const d of db.prepare("SELECT id, amount, month, year FROM loan_deductions WHERE loan_id = ? AND state = 'posted'").all(loan.id)) {
    if (monthIndex(d) <= k) bal -= toPaise(d.amount);
  }
  for (const a of db.prepare('SELECT a.amount, d.month, d.year FROM loan_adjustments a JOIN loan_deductions d ON d.id = a.deduction_id WHERE a.loan_id = ?').all(loan.id)) {
    if (monthIndex(a) <= k) bal += toPaise(a.amount);
  }
  for (const r of db.prepare('SELECT amount, receipt_date FROM loan_receipts WHERE loan_id = ?').all(loan.id)) {
    if (le(pm(r.receipt_date))) bal -= toPaise(r.amount);
  }
  if (toPaise(loan.written_off_amount || 0) > 0 && le(pm(istDate(loan.written_off_at)))) bal -= toPaise(loan.written_off_amount);
  return bal;
}

function run(file) {
  const db = new Database(file);
  const liveSql = "SELECT * FROM loans WHERE status IN ('active','recover_at_exit')";
  const live = db.prepare(liveSql).all();
  const liveTotal = live.reduce((s, l) => s + toPaise(l.remaining_balance), 0);
  const stats = { loans: db.prepare('SELECT COUNT(*) AS n FROM loans').get().n, live: live.length, deductions: db.prepare('SELECT COUNT(*) AS n FROM loan_deductions').get().n };

  // ── register
  const reg = L.outstandingRegister(db);
  check(toPaise(reg.totals.balance) === liveTotal, `${file}: register total ${reg.totals.balance} ≠ live balances ${toRupees(liveTotal)}`);
  check(reg.groups.reduce((s, g) => s + toPaise(g.balance), 0) === liveTotal, `${file}: groups do not sum to the total`);
  check(reg.byCompany.reduce((s, g) => s + toPaise(g.balance), 0) === liveTotal, `${file}: companies do not sum to the total`);
  for (const r of reg.rows) {
    check(toPaise(r.disbursed) - toPaise(r.recovered) - toPaise(r.cash) - toPaise(r.writtenOff) === toPaise(r.balance), `${file}: loan ${r.loanId} columns do not reconcile`);
    check(r.reconciles, `${file}: loan ${r.loanId} does not reconcile: ${(r.problems || []).join('; ')}`);
  }

  // ── forecast, several starts
  const months = db.prepare('SELECT DISTINCT due_month AS month, due_year AS year FROM loan_instalments ORDER BY due_year, due_month').all();
  const starts = [{ month: 10, year: 2026 }, ...(months.length ? [months[0], months[Math.floor(months.length / 2)], months[months.length - 1]] : []), null];
  for (const from of starts) {
    const f = L.recoveryForecast(db, { from });
    check(f.reconciles && toPaise(f.total) === liveTotal, `${file}: forecast from ${from ? monthLabel(from) : 'today'} total ${f.total} ≠ outstanding ${toRupees(liveTotal)}`);
  }

  // ── exceptions (independent SQL)
  const ex = L.exceptionsList(db);
  const openEx = db.prepare(`SELECT COALESCE(SUM(i.amount_due), 0) AS v FROM loan_instalments i JOIN loans l ON l.id = i.loan_id
                              WHERE l.status IN ('active','recover_at_exit') AND i.status IN ('scheduled','provisional')
                                AND i.origin IN ('shortfall','no_salary','held','deferred','reversal')`).get().v;
  const uncovered = live.reduce((s, l) => {
    const open = db.prepare("SELECT COALESCE(SUM(amount_due), 0) AS v FROM loan_instalments WHERE loan_id = ? AND status IN ('scheduled','provisional')").get(l.id).v;
    return s + Math.max(0, toPaise(l.remaining_balance) - toPaise(open));
  }, 0);
  check(toPaise(ex.total) === toPaise(openEx) + uncovered, `${file}: exceptions total ${ex.total} ≠ SQL ${toRupees(toPaise(openEx) + uncovered)}`);

  // ── leavers
  const lv = L.leaversWithBalance(db);
  const exitLive = db.prepare("SELECT COALESCE(SUM(remaining_balance), 0) AS v FROM loans WHERE status = 'recover_at_exit'").get().v;
  check(toPaise(lv.totals.balance) === toPaise(exitLive), `${file}: leavers balance ${lv.totals.balance} ≠ recover_at_exit balances ${exitLive}`);

  // ── perquisite
  const lastMonth = (() => {
    const m = db.prepare('SELECT MAX(year * 12 + month - 1) AS k FROM loan_deductions').get().k;
    return m === null ? { month: 3, year: 2027 } : fromIndex(m + 3);
  })();
  const first = { month: 4, year: 2026 };
  const p = L.perquisiteList(db, { from: first, to: lastMonth });
  const threshold = toPaise(p.threshold);
  for (const m of p.months) for (const b of m.borrowers) check(toPaise(b.peak) > threshold, `${file}: ${m.label} ${b.employeeCode} listed at peak ${b.peak} ≤ threshold`);
  const keepVal = db.prepare("SELECT value FROM policy_config WHERE key = 'loan_perquisite_threshold'").get();
  const setT = (v) => db.prepare("UPDATE policy_config SET value = ? WHERE key = 'loan_perquisite_threshold'").run(v);
  try {
    setT('0');
    const all = L.perquisiteList(db, { from: first, to: lastMonth });
    for (const m of p.months) {
      const allM = all.months.find((x) => x.label === m.label);
      const expected = allM.borrowers.filter((b) => toPaise(b.peak) > threshold).map((b) => `${b.payroll}|${b.employeeCode}|${b.company}`).sort();
      check(JSON.stringify(m.borrowers.map((b) => `${b.payroll}|${b.employeeCode}|${b.company}`).sort()) === JSON.stringify(expected), `${file}: ${m.label} listed set ≠ (peak > threshold)`);
    }
    const lastAll = all.months[all.months.length - 1];
    const disbursedTotal = db.prepare('SELECT COALESCE(SUM(remaining_balance), 0) AS v FROM loans WHERE disbursed_amount IS NOT NULL').get().v;
    check(lastAll.borrowers.reduce((s, b) => s + toPaise(b.closing), 0) === toPaise(disbursedTotal), `${file}: month-end closings at ${lastAll.label} ≠ ledger balances ${disbursedTotal}`);
    // A lower threshold lists real borrowers: still exactly the peak > threshold set.
    setT('5000');
    const low = L.perquisiteList(db, { from: first, to: lastMonth });
    let listedLow = 0;
    for (const m of low.months) {
      const allM = all.months.find((x) => x.label === m.label);
      const expected = allM.borrowers.filter((b) => toPaise(b.peak) > 500000).map((b) => `${b.payroll}|${b.employeeCode}|${b.company}`).sort();
      check(JSON.stringify(m.borrowers.map((b) => `${b.payroll}|${b.employeeCode}|${b.company}`).sort()) === JSON.stringify(expected), `${file}: ${m.label} at ₹5,000 listed set ≠ (peak > 5,000)`);
      listedLow += m.borrowers.length;
    }
    check(stats.deductions === 0 || listedLow > 0, `${file}: nobody listed at ₹5,000`);
    stats.perqListedAt5000 = listedLow;
    setT('100000000');
    check(L.perquisiteList(db, { from: first, to: lastMonth }).months.every((m) => m.borrowers.length === 0), `${file}: a huge threshold still lists borrowers`);
  } finally {
    setT(keepVal ? keepVal.value : '20000');
  }

  // ── payslip balance line vs an independent replay
  let payslipChecks = 0;
  const rows = db.prepare('SELECT DISTINCT loan_id, payroll, month, year, employee_code, company FROM loan_deductions').all();
  for (const r of rows) {
    const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(r.loan_id);
    const b = L.payslipLoanBalance(db, { payroll: r.payroll, employeeCode: r.employee_code, company: r.payroll === 'sales' ? loan.company : null, month: r.month, year: r.year });
    const line = b.loans.find((x) => x.loanId === r.loan_id);
    const replay = replayBalance(db, loan, { month: r.month, year: r.year });
    const ded = db.prepare('SELECT * FROM loan_deductions WHERE loan_id = ? AND month = ? AND year = ? AND payroll = ?').get(r.loan_id, r.month, r.year, r.payroll);
    const provisional = ded && ded.state === 'provisional' ? toPaise(ded.amount) : 0;
    const expectShown = replay + (ded && ded.state === 'posted' ? toPaise(ded.amount) : provisional) > 0 || replay > 0;
    if (!line) { check(!expectShown, `${file}: no payslip line for loan ${r.loan_id} ${r.month}/${r.year} (replay ${toRupees(replay)})`); continue; }
    payslipChecks += 1;
    check(toPaise(line.outstandingAfter) === replay - provisional, `${file}: payslip loan ${r.loan_id} ${r.month}/${r.year}: ${line.outstandingAfter} ≠ replay ${toRupees(replay)} − provisional ${toRupees(provisional)}`);
    if (ded && ded.state === 'posted') {
      // Statement rows run from the first to the last movement; after the last one the closing carries.
      const stmt = L.loanStatement(db, r.loan_id);
      const row = stmt.rows.find((x) => x.month === monthLabel(r));
      const closing = row ? row.closing : (stmt.rows.length && monthLabel(r) > stmt.rows[stmt.rows.length - 1].month ? stmt.closing : null);
      check(closing !== null && toPaise(closing) === toPaise(line.outstandingAfter), `${file}: payslip loan ${r.loan_id} ${r.month}/${r.year} ≠ statement closing`);
    }
  }

  // ── drift and flags
  const drift = db.prepare(DRIFT).get().n;
  const comp = db.prepare(COMPONENTS).get().n;
  const sdrift = db.prepare(SALES_DRIFT).get().n;
  check(drift === 0, `${file}: plant drift ${drift}`);
  check(comp === 0, `${file}: component-short ${comp}`);
  check(sdrift === 0, `${file}: sales drift ${sdrift}`);
  let flagCount = 0;
  for (const m of db.prepare('SELECT DISTINCT month, year FROM salary_computations').all()) {
    const flags = detectRedFlags(db, m.month, m.year).filter((f) => f.type.startsWith('loan_'));
    const pct = L.readLoanPolicy(db).emiNetFlagPct;
    const emiSql = db.prepare('SELECT COUNT(*) AS n FROM salary_computations WHERE month = ? AND year = ? AND COALESCE(loan_recovery,0) > 0 AND (net_salary <= 0 OR loan_recovery * 100 > net_salary * ?)').get(m.month, m.year, pct).n;
    check(flags.filter((f) => f.type === 'loan_emi_high_vs_net').length === emiSql, `${file}: ${m.month}/${m.year} EMI flags ≠ SQL ${emiSql}`);
    flagCount += flags.length;
    L.overdueCloses(db, { month: m.month, year: m.year });
  }
  db.close();
  console.log(`${file}: loans ${stats.loans} (live ${stats.live}), deductions ${stats.deductions}; outstanding ₹${toRupees(liveTotal)}; payslip lines checked ${payslipChecks}; `
    + `perquisite months ${p.months.length} (listed ${p.months.reduce((s, m) => s + m.borrowers.length, 0)}; at ₹5,000: ${stats.perqListedAt5000}); exceptions ₹${ex.total}; loan red flags ${flagCount}; drift ${drift}; component-short ${comp}; sales drift ${sdrift}`);
}

for (const f of files) run(f);
console.log(`${checks - failures}/${checks} checks passed`);
if (failures) { console.log('FAIL'); process.exit(1); }
console.log('PASS');

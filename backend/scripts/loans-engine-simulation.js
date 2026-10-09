#!/usr/bin/env node
/**
 * Loans PR-2 — 12-month engine simulation (docs/loans/SPEC.md §9.2 PR-2, §9.3 gate A → B).
 *
 *   node backend/scripts/loans-engine-simulation.js           # summary
 *   node backend/scripts/loans-engine-simulation.js --verbose # + every schedule and event trail
 *
 * In-memory database built by the real initSchema(); nothing touches a file.
 * Runs Nov 2026 → Oct 2027 with one loan per scenario (normal, re-run,
 * shortfall, held, no salary, receipt, defer, restructure, exit, write-off,
 * extension limit, sales borrower). Each month: "Stage 7" records provisional
 * deductions (twice for the re-run loan), then the "loan close" posts them,
 * moves no-salary months to the end, and the held sweep posts released
 * salaries / moves ones held past the wait. The Stage 7 and close loops here are
 * stand-ins for PR-5 / PR-6 — they only call the engine's building blocks.
 *
 * After every month: disbursed − posted − receipts − written off = balance for
 * every loan, to the paisa, and every statement's closing equals it.
 * Exit code 0 = all reconciled and every scenario ended as expected; 1 otherwise.
 */
const Database = require('better-sqlite3');
const { initSchema } = require('../src/database/schema');
const L = require('../src/services/loans');
const { toPaise, toRupees } = L.money;
const { monthIndex, addMonths, monthLabel } = L.months;

const VERBOSE = process.argv.includes('--verbose');
const COMPANY = 'Indriyan Beverages Pvt Ltd';
const HR = { username: 'hr1', role: 'hr' };
const FIN = { username: 'fin1', role: 'finance' };
const ADMIN = { username: 'admin1', role: 'admin' };
const SYS = { username: 'system', role: 'system' };

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };
const must = (r, what) => {
  if (!r || !r.ok) {
    console.error(`FAILED: ${what}:`, r);
    process.exit(1);
  }
  return r;
};

// ── database ────────────────────────────────────────────────────────────────
const db = new Database(':memory:');
{
  const log = console.log; const err = console.error; const warn = console.warn;
  console.log = () => {}; console.error = () => {}; console.warn = () => {};
  try { initSchema(db); } finally { console.log = log; console.error = err; console.warn = warn; }
}

function plant(code, over = {}) {
  db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, is_contractor, gross_salary)
              VALUES (?, 'SIM', 'PRODUCTION', ?, ?, 'Active', ?, ?, ?)`)
    .run(code, COMPANY, over.type || 'Permanent', over.doj === undefined ? '2025-01-01' : over.doj, over.contractor || 0, over.gross ?? 20000);
  return code;
}
function salesEmp(code) {
  db.prepare("INSERT INTO sales_employees (code, name, company, status, doj, gross_salary) VALUES (?, 'SIM SALES', ?, 'Active', '2025-01-01', 20000)").run(code, COMPANY);
  return code;
}

// ── eligibility refusals (printed, not loans) ───────────────────────────────
console.log('== Eligibility refusals ==');
const refusalCases = [
  ['contract worker', plant('X-CON', { type: 'Contract' }), 'plant', 'CONTRACT_NOT_ELIGIBLE'],
  ['plant row typed Sales', plant('X-SAL', { type: 'Sales' }), 'plant', 'SALES_USE_SALES_MASTER'],
  ['joined 2 months ago', plant('X-NEW', { doj: '2026-08-01' }), 'plant', 'MIN_SERVICE_NOT_MET'],
  ['no date of joining', plant('X-DOJ', { doj: null }), 'plant', 'SERVICE_UNKNOWN'],
  ['over 2× gross', plant('X-AMT'), 'plant', 'AMOUNT_OVER_LIMIT', { principal: 40001, tenure: 12 }],
];
for (const [label, code, bt, expected, over] of refusalCases) {
  const r = L.requestLoan(db, { borrowerType: bt, employeeCode: code, company: COMPANY, loanType: 'Personal', principal: 6000, tenure: 3, reason: 'sim', ...over }, HR, { asOf: '2026-10-09' });
  const codes = (r.refusals || []).map((x) => x.code);
  console.log(`  ${label.padEnd(22)} → ${r.ok ? 'ACCEPTED' : codes.join(', ')}`);
  check(!r.ok && codes.includes(expected), `refusal ${label}: expected ${expected}, got ${r.ok ? 'ok' : codes}`);
}

// ── loans ───────────────────────────────────────────────────────────────────
const START = { month: 11, year: 2026 };
const mi = (m) => monthIndex(m) - monthIndex(START); // 0 = Nov 2026
const S = {}; // scenario key → { loanId, payroll, ... }

function open(key, { principal, tenure, borrowerType = 'plant', code, loanType = 'Personal' }) {
  const emp = code || (borrowerType === 'sales' ? salesEmp(`S-${key}`) : plant(`P-${key}`));
  const r = must(L.requestLoan(db, { borrowerType, employeeCode: emp, company: COMPANY, loanType, principal, tenure, reason: `sim ${key}` }, HR, { asOf: '2026-10-09' }), `request ${key}`);
  must(L.approveLoan(db, r.loanId, ADMIN, { asOf: '2026-10-09' }), `approve ${key}`);
  must(L.disburseLoan(db, r.loanId, FIN, { mode: 'NEFT', reference: `UTR-${key}`, disbursedOn: '2026-10-05', agreementFilePath: `agreements/${key}.pdf` }, { asOf: '2026-10-09' }), `disburse ${key}`);
  S[key] = { loanId: r.loanId, payroll: borrowerType, emp };
}

open('normal', { principal: 12000, tenure: 6 });
open('rerun', { principal: 9000, tenure: 3 });
open('shortfall', { principal: 15000, tenure: 3 });
open('held', { principal: 6000, tenure: 3 });
open('nosalary', { principal: 8000, tenure: 4 });
open('receipt', { principal: 12000, tenure: 6 });
open('defer', { principal: 9000, tenure: 3 });
open('restructure', { principal: 12000, tenure: 4 });
open('exit', { principal: 12000, tenure: 6 });
open('writeoff', { principal: 6000, tenure: 6 });
open('extension', { principal: 12000, tenure: 12 });
open('sales', { principal: 6000, tenure: 3, borrowerType: 'sales' });
open('emergency', { principal: 60000, tenure: 12, loanType: 'Emergency / medical' }); // 3× gross

/** Per scenario, per month index: salary situation. Default: salary, not held, room ₹10,000. */
function situation(key, m) {
  const s = { salary: true, room: 10000, heldThrough: null };
  if (key === 'shortfall' && m <= 1) s.room = 3000;             // ₹5,000 EMI vs ₹3,000 room
  if (key === 'held' && m === 0) s.heldThrough = 1;              // Nov held, released before Dec close
  if (key === 'held' && m === 2) s.heldThrough = 99;             // Jan held and never released
  if (key === 'nosalary' && m === 1) s.salary = false;           // no salary row in Dec
  if (key === 'extension' && m <= 3) s.room = m === 3 ? 400 : 0; // 3 empty months then ₹400
  if (key === 'exit' && m === 3) s.room = 2000;                   // final payroll after Mark Left
  return s;
}
const keyOf = (loanId) => Object.keys(S).find((k) => S[k].loanId === loanId);
const closeDate = (m) => { const n = addMonths(m, 1); return new Date(Date.UTC(n.year, n.month - 1, 13)); };
const simDate = (m, day = 20) => `${m.year}-${String(m.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const alerts = [];
const counters = { provisional: 0, posted: 0, shortfalls: 0, noSalary: 0, heldWaiting: 0, heldPosted: 0, heldMoved: 0 };

function liveLoans() {
  return db.prepare("SELECT * FROM loans WHERE status IN ('active','recover_at_exit') ORDER BY id").all();
}

/** Stage 7 stand-in (PR-5 owns the real one). */
function stage7(m, runId, count = true) {
  for (const loan of liveLoans()) {
    const key = keyOf(loan.id);
    const ins = db.prepare(`SELECT * FROM loan_instalments WHERE loan_id = ? AND due_month = ? AND due_year = ?
                              AND status IN ('scheduled','provisional') ORDER BY sequence LIMIT 1`).get(loan.id, m.month, m.year);
    if (!ins) continue;
    const s = situation(key, mi(m));
    if (!s.salary) continue;
    const plan = L.planLoanDeduction({ duePaise: toPaise(ins.amount_due), headroomPaise: toPaise(s.room) });
    must(L.recordProvisional(db, { loanId: loan.id, instalmentId: ins.id, payroll: loan.borrower_type, month: m.month, year: m.year, company: loan.company, amount: toRupees(plan.deductPaise), runId }, SYS), `provisional ${key} ${monthLabel(m)}`);
    if (count) counters.provisional++;
  }
}

/** Loan close + held sweep stand-in (PR-6 owns the real ones). */
function close(m) {
  const now = closeDate(m);
  for (const payroll of ['plant', 'sales']) {
    // The close row exists first (PR-6 writes it in the same transaction), so an
    // instalment moved to the end during this close lands after month M.
    const closeId = db.prepare("INSERT INTO loan_closes (month, year, payroll, run_by, trigger_kind) VALUES (?, ?, ?, 'system', 'simulation')")
      .run(m.month, m.year, payroll).lastInsertRowid;
    // 1. provisional rows of this and earlier months
    const rows = db.prepare(`SELECT d.*, ld.borrower_type FROM loan_deductions d JOIN loans ld ON ld.id = d.loan_id
                              WHERE d.payroll = ? AND d.state = 'provisional' ORDER BY d.year, d.month, d.id`).all(payroll);
    for (const row of rows) {
      const key = keyOf(row.loan_id);
      const dm = { month: row.month, year: row.year };
      const s = situation(key, mi(dm));
      const stillHeld = s.heldThrough !== null && mi(m) < s.heldThrough;
      if (stillHeld) {
        const waited = (now - closeDate(dm)) / 86400000;
        if (waited >= 60) {
          const r = must(L.moveInstalmentToEnd(db, { instalmentId: row.instalment_id, reason: 'held' }, SYS), `held move ${key}`);
          counters.heldMoved++;
          alerts.push(...r.alerts);
        } else {
          counters.heldWaiting++;
        }
        continue;
      }
      const r = must(L.postDeduction(db, { deductionId: row.id, closeId }, SYS), `post ${key} ${monthLabel(dm)}`);
      counters.posted++;
      if (monthIndex(dm) < monthIndex(m)) counters.heldPosted++;
      if (Number(r.shortfall) > 0) counters.shortfalls++;
      alerts.push(...r.alerts);
    }
    // 2. instalments due this month with no salary row
    const due = db.prepare(`SELECT i.* FROM loan_instalments i JOIN loans l ON l.id = i.loan_id
                             WHERE l.borrower_type = ? AND l.status IN ('active','recover_at_exit')
                               AND i.due_month = ? AND i.due_year = ? AND i.status = 'scheduled'`).all(payroll, m.month, m.year);
    for (const ins of due) {
      const r = must(L.moveInstalmentToEnd(db, { instalmentId: ins.id, reason: 'no_salary' }, SYS), `no salary ${keyOf(ins.loan_id)}`);
      counters.noSalary++;
      alerts.push(...r.alerts);
    }
    db.prepare('UPDATE loan_closes SET reconciliation_ok = ? WHERE id = ?').run(L.reconcileAll(db).ok ? 1 : 0, closeId);
  }
}

/** Actions that happen during the month, before Stage 7. */
function actions(m) {
  const i = mi(m);
  const at = { asOf: simDate(m) };
  if (i === 1) {
    const ins = db.prepare("SELECT * FROM loan_instalments WHERE loan_id = ? AND sequence = 2").get(S.defer.loanId);
    must(L.deferInstalment(db, { instalmentId: ins.id, reason: 'festival month', requestedBy: HR }, ADMIN), 'defer');
  }
  if (i === 2) {
    must(L.recordReceipt(db, S.receipt.loanId, FIN, { amount: 5000, mode: 'cash', reference: 'counter', receiptDate: simDate(m, 10) }, at), 'receipt');
    must(L.restructureLoan(db, { loanId: S.restructure.loanId, newTenure: 6, reason: 'lower EMI', requestedBy: HR }, ADMIN, at), 'restructure');
  }
  if (i === 3) {
    must(L.flagForExit(db, S.exit.loanId, SYS, { exitDate: simDate(m, 5), reason: 'resigned' }), 'exit flag');
    must(L.writeOffLoan(db, { loanId: S.writeoff.loanId, reason: 'hardship, approved', requestedBy: FIN }, ADMIN), 'write-off active');
  }
  if (i === 4) {
    // after the final payroll (Feb) posted at the Feb close, the residual is written off
    must(L.writeOffLoan(db, { loanId: S.exit.loanId, reason: 'residual after final pay', requestedBy: HR }, ADMIN), 'write-off at exit');
  }
  if (i === 6) {
    // finance collects the extension loan's uncovered ₹600 in cash
    must(L.recordReceipt(db, S.extension.loanId, FIN, { amount: 600, mode: 'cash', receiptDate: simDate(m, 10) }, at), 'receipt uncovered');
  }
}

/** Re-run check: Stage 7 twice must give identical deduction rows. */
function deductionSnapshot() {
  return JSON.stringify(db.prepare('SELECT id, loan_id, instalment_id, payroll, month, year, amount, state FROM loan_deductions ORDER BY id').all());
}

// ── the 12 months ───────────────────────────────────────────────────────────
console.log('\n== Month by month ==');
console.log('  month     live  prov  posted  shortfall  no-sal  held(wait/post/move)  outstanding     recon');
for (let k = 0; k < 12; k++) {
  const m = addMonths(START, k);
  actions(m);
  const before = { ...counters };
  stage7(m, `run-${monthLabel(m)}-a`);
  const snap = deductionSnapshot();
  const nEvents = db.prepare('SELECT COUNT(*) n FROM loan_events').get().n;
  stage7(m, `run-${monthLabel(m)}-b`, false); // the re-run
  check(deductionSnapshot() === snap, `${monthLabel(m)}: Stage 7 re-run changed deduction rows`);
  check(db.prepare('SELECT COUNT(*) n FROM loan_events').get().n === nEvents, `${monthLabel(m)}: Stage 7 re-run wrote events`);
  close(m);
  const rec = L.reconcileAll(db);
  for (const r of rec.mismatches) failures.push(`${monthLabel(m)} loan ${r.loanId}: ${r.problems.join('; ')}`);
  for (const id of Object.values(S).map((s) => s.loanId)) {
    const st = L.loanStatement(db, id);
    const rc = L.reconcileLoan(db, id);
    check(st.closing === rc.expectedBalance && rc.expectedBalance === rc.balance, `${monthLabel(m)} loan ${id}: statement ${st.closing} vs recon ${rc.expectedBalance} vs balance ${rc.balance}`);
  }
  const out = db.prepare("SELECT ROUND(SUM(remaining_balance),2) b FROM loans").get().b;
  const d = (f) => counters[f] - before[f];
  console.log(`  ${monthLabel(m)}   ${String(liveLoans().length).padStart(4)}  ${String(d('provisional')).padStart(4)}  ${String(d('posted')).padStart(6)}  ${String(d('shortfalls')).padStart(9)}  ${String(d('noSalary')).padStart(6)}  ${`${d('heldWaiting')}/${d('heldPosted')}/${d('heldMoved')}`.padStart(20)}  ₹${String(out.toLocaleString('en-IN')).padStart(11)}  ${rec.ok ? 'exact' : 'MISMATCH'}`);
}

// ── expected end states ─────────────────────────────────────────────────────
const expectEnd = {
  normal: 'completed', rerun: 'completed', shortfall: 'completed', held: 'completed', nosalary: 'completed',
  receipt: 'completed', defer: 'completed', restructure: 'completed', exit: 'settled_at_exit', writeoff: 'written_off',
  extension: 'active', sales: 'completed', emergency: 'completed',
};
console.log('\n== Loans at the end ==');
console.log('  scenario      id  status            disbursed   posted     cash      written off  balance   instalments (origins)');
for (const [key, s] of Object.entries(S)) {
  const l = db.prepare('SELECT * FROM loans WHERE id = ?').get(s.loanId);
  const r = L.reconcileLoan(db, s.loanId);
  const ins = db.prepare('SELECT origin, status FROM loan_instalments WHERE loan_id = ? ORDER BY sequence').all(s.loanId);
  const origins = [...new Set(ins.filter((i) => i.origin !== 'schedule').map((i) => i.origin))].join(',') || '-';
  console.log(`  ${key.padEnd(12)} ${String(s.loanId).padStart(3)}  ${l.status.padEnd(16)} ${String(r.disbursed).padStart(9)}  ${String(r.posted).padStart(8)}  ${String(r.receipts).padStart(7)}  ${String(r.writtenOff).padStart(11)}  ${String(r.balance).padStart(7)}   ${ins.length} (${origins})`);
  check(l.status === expectEnd[key], `${key}: expected ${expectEnd[key]}, got ${l.status}`);
  check(r.ok, `${key}: reconciliation failed: ${r.problems.join('; ')}`);
}

// scenario-specific checks
const instOf = (key) => db.prepare('SELECT * FROM loan_instalments WHERE loan_id = ? ORDER BY sequence').all(S[key].loanId);
check(instOf('shortfall').filter((i) => i.origin === 'shortfall').length === 2, 'shortfall: expected 2 shortfall instalments');
check(instOf('held').some((i) => i.origin === 'held'), 'held: expected a held instalment moved to the end');
check(instOf('nosalary').some((i) => i.origin === 'no_salary'), 'nosalary: expected a no_salary instalment');
check(instOf('defer').some((i) => i.origin === 'deferred'), 'defer: expected a deferred instalment');
check(instOf('restructure').filter((i) => i.origin === 'restructure').length === 6, 'restructure: expected 6 restructure instalments');
check(instOf('extension').filter((i) => i.origin === 'shortfall').length === 3, 'extension: expected exactly 3 shortfall months');
check(alerts.length === 1 && alerts[0].type === 'loan_extension_limit_reached' && alerts[0].uncoveredAmount === 600, `extension: expected 1 alert of ₹600, got ${JSON.stringify(alerts)}`);
check(db.prepare("SELECT COUNT(*) n FROM loan_deductions WHERE payroll = 'sales' AND state = 'posted'").get().n === 3, 'sales: expected 3 posted sales deductions');
const tds = L.writeOffsForTds(db, (() => { const t = new Date(Date.now() + 330 * 60000); return { month: t.getUTCMonth() + 1, year: t.getUTCFullYear() }; })());
check(tds.length === 2, `TDS list: expected 2 write-offs, got ${tds.length}`);
check(db.prepare('SELECT COUNT(*) n FROM loan_events').get().n === db.prepare("SELECT COUNT(*) n FROM audit_log WHERE stage = 'loans'").get().n, 'every loan event has an audit_log row');

console.log(`\n  alerts for finance: ${alerts.map((a) => a.message).join(' | ') || 'none'}`);
console.log(`  write-offs listed for TDS: ${tds.map((t) => `loan ${t.loanId} ₹${t.amount} (${t.status})`).join(', ')}`);
console.log(`  events: ${db.prepare('SELECT COUNT(*) n FROM loan_events').get().n}, audit rows: ${db.prepare("SELECT COUNT(*) n FROM audit_log WHERE stage = 'loans'").get().n}, receipts: ${db.prepare('SELECT GROUP_CONCAT(receipt_no) r FROM loan_receipts').get().r}`);

if (VERBOSE) {
  for (const [key, s] of Object.entries(S)) {
    console.log(`\n── ${key} (loan ${s.loanId}) ─────────────────────────`);
    console.log('  schedule:');
    for (const i of instOf(key)) {
      console.log(`    #${String(i.sequence).padStart(2)} ${i.due_year}-${String(i.due_month).padStart(2, '0')}  ₹${String(i.amount_due).padStart(7)}  ${i.status.padEnd(12)} ${i.origin.padEnd(11)} ${i.posted_amount !== null ? 'posted ₹' + i.posted_amount : ''}`);
    }
    console.log('  statement:');
    for (const r of L.loanStatement(db, s.loanId).rows) {
      console.log(`    ${r.month}  open ${String(r.opening).padStart(7)}  +${String(r.disbursed).padStart(6)}  −ded ${String(r.recovered).padStart(6)}  −cash ${String(r.cash).padStart(6)}  −w/o ${String(r.writtenOff).padStart(6)}  close ${String(r.closing).padStart(7)}`);
    }
    console.log('  events:');
    for (const e of db.prepare('SELECT * FROM loan_events WHERE loan_id = ? ORDER BY id').all(s.loanId)) {
      console.log(`    ${e.event.padEnd(24)} ${String(e.from_state || '').padEnd(12)} → ${String(e.to_state || '').padEnd(12)} ${e.amount !== null ? '₹' + e.amount : ''}  ${e.actor}  ${e.reason || ''}`);
    }
  }
}

if (failures.length) {
  console.log(`\n✗ ${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('\n✓ 12 months simulated; every loan reconciles to the paisa every month; every scenario ended as expected.');

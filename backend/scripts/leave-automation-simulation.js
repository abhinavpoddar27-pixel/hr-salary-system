#!/usr/bin/env node
/**
 * Leave automation — end-to-end simulation.
 *
 * Builds its own SQLite database in a temp directory and walks the whole
 * pipeline: import, HR resolves miss punches, finance decides, Stage 6 runs by
 * itself, leave is computed, a leave is approved, day calculation and the
 * balance both move, salary is computed, the stale count returns to zero, the
 * month is finalised. Then the edge cases.
 *
 * Never touches a real database and never calls a real URL.
 *   NODE_ENV=test node scripts/leave-automation-simulation.js
 */
process.env.NODE_ENV = 'test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const { initSchema } = require('../src/database/schema');
const { ensureJobsTable } = require('../src/services/jobQueue');
const { recomputeDays, recomputeSalary, countStaleSalary } = require('../src/services/recompute');
const { computeLeavePlan, recomputeLeaves, runYearEndLapse, seedYearOpenings } = require('../src/services/leaveEngine');
const { queueLeaveRecalc, checkAutoStage6, safeTrigger } = require('../src/services/leaveTriggers');

// ── tiny harness ─────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
const failures = [];
const step = (name) => console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 62 - name.length))}`);
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`  ok   ${label}`); }
  else { fail += 1; failures.push(`${label}: expected ${e}, got ${a}`); console.log(`  FAIL ${label}\n         expected ${e}\n         got      ${a}`); }
}
function ok(label, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ok   ${label}`); }
  else { fail += 1; failures.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL ${label} ${detail}`); }
}
const quiet = (fn) => {
  const l = console.log; const e = console.error; const w = console.warn;
  console.log = () => {}; console.error = () => {}; console.warn = () => {};
  try { return fn(); } finally { console.log = l; console.error = e; console.warn = w; }
};

// ── constants ────────────────────────────────────────────────────────────────
const YEAR = 2026;
const MONTH = 3;
const CO_A = 'Indriyan Beverages Pvt Ltd';
const CO_B = 'Asian Lakto Ind Ltd';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leave-sim-'));
const db = new Database(path.join(dir, 'sim.db'));
quiet(() => initSchema(db));
ensureJobsTable(db);

const setPolicy = (k, v) => db.prepare(
  "INSERT INTO policy_config (key, value, description) VALUES (?, ?, 'sim') " +
  'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
).run(k, String(v));

const drift = (m = MONTH, y = YEAR) => db.prepare(`
  SELECT employee_code, ABS(net_salary - (gross_earned - total_deductions)) d
  FROM salary_computations WHERE month = ? AND year = ? ORDER BY d DESC LIMIT 20
`).all(m, y);
let maxDriftSeen = 0;
function assertNoDrift(where) {
  const rows = drift();
  const worst = rows.length ? Math.max(...rows.map((r) => r.d)) : 0;
  maxDriftSeen = Math.max(maxDriftSeen, worst);
  ok(`drift <= 1 after ${where}`, worst <= 1, `worst = ${worst}`);
}

// ── seed ─────────────────────────────────────────────────────────────────────
step('Seed: 2 companies, 20 employees, holidays, a month of attendance');

db.prepare('DELETE FROM holidays').run();
for (const [date, name] of [['2026-03-04', 'Holi'], ['2026-03-25', 'Ram Navami']]) {
  db.prepare("INSERT INTO holidays (date, name, type, applicable_to) VALUES (?, ?, 'National', 'All')").run(date, name);
}
const holidayDates = new Set(['2026-03-04', '2026-03-25']);

const insEmp = db.prepare(`
  INSERT INTO employees (code, name, department, company, employment_type, status,
                         date_of_joining, is_contractor, weekly_off_day, gross_salary)
  VALUES (?, ?, ?, ?, ?, 'Active', ?, ?, 0, 20000)
`);
const insStruct = db.prepare(`
  INSERT INTO salary_structures (employee_id, effective_from, basic, hra, gross_salary, pf_applicable, esi_applicable)
  VALUES (?, '2024-01-01', 10000, 4000, 20000, 1, 1)
`);

const employees = [];
function addEmp(code, over = {}) {
  const info = insEmp.run(code, `EMP ${code}`, over.department || 'PRODUCTION',
    over.company === undefined ? CO_A : over.company,
    over.employment_type || 'Permanent',
    over.date_of_joining || '2023-01-01',
    over.is_contractor ?? 0);
  const e = { code, id: info.lastInsertRowid, company: over.company === undefined ? CO_A : over.company, ...over };
  insStruct.run(e.id);
  employees.push(e);
  return e;
}

for (let i = 1; i <= 12; i += 1) addEmp(`P${String(i).padStart(3, '0')}`);
const contractor = addEmp('C001', { employment_type: 'Contract', department: 'CONTRACT LABOUR' });
const nonPermanent = addEmp('N001', { employment_type: 'Trainee' });
const blankCompany = addEmp('B001', { company: '' });
const nullCompany = addEmp('B002', { company: 'null' });
const midYearJoiner = addEmp('J001', { date_of_joining: '2026-09-01' });
const underThreshold = addEmp('U001');
const otherCo = addEmp('L001', { company: CO_B });
const missPunchEmp = addEmp('M001');

for (const co of [CO_A, CO_B]) {
  db.prepare(`
    INSERT INTO monthly_imports (month, year, company, file_name, status, record_count, employee_count, stage_1_done)
    VALUES (?, ?, ?, 'eesl_mar_2026.xls', 'imported', 600, 20, 1)
  `).run(MONTH, YEAR, co);
}

const insAtt = db.prepare(`
  INSERT INTO attendance_processed
    (employee_code, date, month, year, company, status_original, status_final,
     in_time_original, out_time_original, in_time_final, out_time_final,
     is_night_out_only, is_miss_punch, miss_punch_resolved, miss_punch_finance_status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
`);

/** One full March for an employee. Sundays off, one WOP, two holidays. */
function seedMonth(emp, { absentDays = [], missPunchDays = [] } = {}) {
  const company = emp.company === undefined ? CO_A : emp.company;
  let weeklyOffSeen = 0;
  for (let d = 1; d <= 31; d += 1) {
    const date = `${YEAR}-03-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    let status = 'P';
    if (dow === 0) { weeklyOffSeen += 1; status = weeklyOffSeen === 2 ? 'WOP' : 'WO'; }
    else if (holidayDates.has(date)) status = 'NH';
    else if (absentDays.includes(d)) status = 'A';
    const isMiss = missPunchDays.includes(d) ? 1 : 0;
    insAtt.run(emp.code, date, MONTH, YEAR, company || '',
      status, status, '08:00', isMiss ? null : '18:00', '08:00', isMiss ? null : '18:00',
      isMiss, 0, isMiss ? null : null);
  }
}

for (const e of employees) {
  if (e.code === 'M001') seedMonth(e, { absentDays: [12, 13], missPunchDays: [6, 7, 20] });
  else if (e.code === 'U001') seedMonth(e, { absentDays: [2, 3, 5, 9, 10, 11, 12, 16, 17, 18] });
  else seedMonth(e, { absentDays: [12] });
}

// Prior months, so days-worked YTD reaches the 180-day threshold for some.
const insDayCalc = db.prepare(`
  INSERT INTO day_calculations (employee_code, month, year, company, days_present, total_payable_days)
  VALUES (?, ?, ?, ?, ?, ?)
`);
// Seven prior months at 25 days each = 175, so March pushes the first twelve
// past the 180-day EL threshold and U001 stays well short of it.
for (const e of employees.slice(0, 12)) {
  for (const m of [1, 2, 4, 5, 6, 7, 8]) insDayCalc.run(e.code, m, YEAR, e.company || '', 25, 25);
}
insDayCalc.run(underThreshold.code, 1, YEAR, CO_A, 5, 5);

check('employees seeded', employees.length, 20);
check('attendance rows seeded', db.prepare('SELECT COUNT(*) c FROM attendance_processed').get().c, 20 * 31);
ok('miss punches present', db.prepare('SELECT COUNT(*) c FROM attendance_processed WHERE is_miss_punch = 1').get().c === 3);

// ── happy path ───────────────────────────────────────────────────────────────
step('Happy path: switch automation on, then walk the pipeline');

setPolicy('leave_automation_enabled', 'true');
setPolicy('leave_external_grants_acknowledged', 'true');

let gate = checkAutoStage6(db, CO_A, MONTH, YEAR);
check('Stage 6 does not fire while HR has miss punches', gate.reason, 'miss_punches_outstanding');
check('  backlog awaiting HR', gate.backlog.awaitingHr, 3);

db.prepare("UPDATE attendance_processed SET miss_punch_resolved = 1, miss_punch_finance_status = 'pending' WHERE is_miss_punch = 1").run();
gate = checkAutoStage6(db, CO_A, MONTH, YEAR);
check('Stage 6 does not fire while finance has yet to decide', gate.reason, 'miss_punches_outstanding');
check('  backlog awaiting finance', gate.backlog.awaitingFinance, 3);

db.prepare("UPDATE attendance_processed SET miss_punch_finance_status = 'approved' WHERE is_miss_punch = 1 AND date <= '2026-03-07'").run();
db.prepare("UPDATE attendance_processed SET miss_punch_finance_status = 'rejected' WHERE is_miss_punch = 1 AND date > '2026-03-07'").run();
gate = quiet(() => checkAutoStage6(db, CO_A, MONTH, YEAR, { actor: 'finance1' }));
ok('Stage 6 fires once both counters reach zero', gate.fired === true, JSON.stringify(gate));
ok('  a day_calculate job was queued', db.prepare("SELECT COUNT(*) c FROM jobs WHERE type='day_calculate'").get().c === 1);
ok('  a leave_recalc job was queued', db.prepare("SELECT COUNT(*) c FROM jobs WHERE type='leave_recalc'").get().c === 1);
ok('  stage_6_auto_at stamped', !!db.prepare('SELECT stage_6_auto_at FROM monthly_imports WHERE month=? AND year=? AND company=?').get(MONTH, YEAR, CO_A).stage_6_auto_at);

// Run what the worker would run.
const dayOut = quiet(() => recomputeDays(db, { company: CO_A, month: MONTH, year: YEAR, requestId: 'sim' }));
// Stage 6 is scoped by the company on the ATTENDANCE row, so the two employees
// stored with a blank / 'null' company and the one at the other company are not
// in this run: 20 - 1 - 2 = 17. The leave engine deliberately does not filter
// that way, which is why they still earn (defect e).
check('Stage 6 produced a row per CO_A employee', dayOut.results.length, 17);
check('Stage 6 had no per-employee errors', dayOut.errors.length, 0);
check('every row is marked salary_stale', countStaleSalary(db, { month: MONTH, year: YEAR, company: CO_A }).count, dayOut.results.length);

const leaveOut = quiet(() => recomputeLeaves(db, { year: YEAR, dryRun: false, scope: 'auto_stage6', actor: 'sim' }));
ok('leave applied', leaveOut.applied === true, leaveOut.reason || '');
const planned = leaveOut.plan.employees;
check('contractors and non-permanent are skipped', planned.length, 18);
ok('  blank-company employee is included', planned.some((e) => e.employee_code === 'B001'));
ok("  'null'-company employee is included", planned.some((e) => e.employee_code === 'B002'));
ok('  the contractor is not', !planned.some((e) => e.employee_code === 'C001'));

const p001 = planned.find((e) => e.employee_code === 'P001');
ok('P001 crossed the 180-day threshold and earned EL', p001.eligible && p001.el.earned > 0,
  `worked ${p001.days_worked_ytd}, earned ${p001.el.earned}`);
const u001 = planned.find((e) => e.employee_code === 'U001');
ok('U001 is under the threshold and earned nothing', !u001.eligible && u001.el.earned === 0,
  `worked ${u001.days_worked_ytd}`);

// Approve a leave and watch both sides move.
const target = employees[0];
db.prepare(`
  INSERT INTO leave_applications (employee_id, employee_code, leave_type, start_date, end_date, days, reason, status, approved_by, approved_at)
  VALUES (?, ?, 'EL', '2026-03-12', '2026-03-12', 1, 'sim', 'Approved', 'hr1', datetime('now'))
`).run(target.id, target.code);
const beforeDc = db.prepare('SELECT el_used, total_payable_days FROM day_calculations WHERE employee_code=? AND month=? AND year=?').get(target.code, MONTH, YEAR);
safeTrigger('sim.approve', () => queueLeaveRecalc(db, {
  company: CO_A, month: MONTH, year: YEAR, employeeCodes: [target.code], reason: 'leave_approved', actor: 'hr1',
}));
quiet(() => recomputeDays(db, { company: CO_A, month: MONTH, year: YEAR, requestId: 'sim' }));
quiet(() => recomputeLeaves(db, { year: YEAR, dryRun: false, scope: 'trigger', actor: 'sim' }));
const afterDc = db.prepare('SELECT el_used, total_payable_days FROM day_calculations WHERE employee_code=? AND month=? AND year=?').get(target.code, MONTH, YEAR);
check('approving EL moves day calculation', afterDc.el_used, beforeDc.el_used + 1);
ok('  and it restores the payable day', afterDc.total_payable_days > beforeDc.total_payable_days,
  `${beforeDc.total_payable_days} -> ${afterDc.total_payable_days}`);
const balAfter = db.prepare("SELECT used FROM leave_balances WHERE employee_id=? AND year=? AND leave_type='EL'").get(target.id, YEAR);
ok('  and the balance records the day as used', (balAfter?.used || 0) >= 1, JSON.stringify(balAfter));

// Salary.
const salOut = quiet(() => recomputeSalary(db, { company: CO_A, month: MONTH, year: YEAR, requestId: 'sim' }));
ok('salary computed', salOut.results.length > 0, `${salOut.results.length} rows`);
assertNoDrift('the first salary computation');
check('the stale count returns to zero', countStaleSalary(db, { month: MONTH, year: YEAR, company: CO_A }).count, 0);

db.prepare("UPDATE monthly_imports SET is_finalised = 1, finalised_at = datetime('now') WHERE month=? AND year=? AND company=?").run(MONTH, YEAR, CO_A);
check('month finalised', db.prepare('SELECT is_finalised FROM monthly_imports WHERE month=? AND year=? AND company=?').get(MONTH, YEAR, CO_A).is_finalised, 1);

// ── edge cases ───────────────────────────────────────────────────────────────
step('Edge case: a leave approved in a finalized month flags instead of changing anything');

const flagsBefore = db.prepare('SELECT COUNT(*) c FROM leave_change_flags').get().c;
const dcBefore = db.prepare('SELECT * FROM day_calculations WHERE employee_code=? AND month=? AND year=?').get(target.code, MONTH, YEAR);
const jobsBefore = db.prepare("SELECT COUNT(*) c FROM jobs WHERE type='leave_recalc'").get().c;
const flagged = queueLeaveRecalc(db, {
  company: CO_A, month: MONTH, year: YEAR, employeeCodes: [target.code], reason: 'leave_approved', actor: 'hr1',
});
check('nothing is queued', flagged.queued, false);
check('  the reason is the finalized month', flagged.reason, 'month_finalized');
check('  a flag was raised', db.prepare('SELECT COUNT(*) c FROM leave_change_flags').get().c, flagsBefore + 1);
check('  no new job', db.prepare("SELECT COUNT(*) c FROM jobs WHERE type='leave_recalc'").get().c, jobsBefore);
const dcAfter = db.prepare('SELECT * FROM day_calculations WHERE employee_code=? AND month=? AND year=?').get(target.code, MONTH, YEAR);
check('  day calculation untouched', JSON.stringify(dcAfter), JSON.stringify(dcBefore));

step('Edge case: bulk-resolving 50 miss punches queues exactly one job');

db.prepare("UPDATE jobs SET status = 'completed'").run();
const before50 = db.prepare("SELECT COUNT(*) c FROM jobs WHERE type='leave_recalc' AND status='pending'").get().c;
for (let i = 0; i < 50; i += 1) {
  queueLeaveRecalc(db, {
    company: CO_B, month: MONTH, year: YEAR, employeeCodes: [`X${i}`], reason: 'miss_punch_resolved', actor: 'hr1',
  });
}
const after50 = db.prepare("SELECT COUNT(*) c FROM jobs WHERE type='leave_recalc' AND status='pending'").get().c;
check('one job for fifty events', after50 - before50, 1);
const merged = JSON.parse(db.prepare("SELECT params FROM jobs WHERE type='leave_recalc' AND status='pending' ORDER BY id DESC LIMIT 1").get().params);
check('  all fifty codes merged into it', merged.employeeCodes.length, 50);

step('Edge case: a manual credit survives the next recompute');

const creditEmp = employees[1];
db.prepare(`
  INSERT INTO leave_transactions (employee_id, employee_code, company, leave_type, transaction_type, days,
                                  balance_after, reference_month, reference_year, reason, approved_by)
  VALUES (?, ?, ?, 'EL', 'Credit', 3, 0, 1, ?, 'goodwill credit', 'admin')
`).run(creditEmp.id, creditEmp.code, CO_A, YEAR);
quiet(() => recomputeLeaves(db, { year: YEAR, dryRun: false, scope: 'manual', actor: 'sim' }));
const bal1 = db.prepare("SELECT balance FROM leave_balances WHERE employee_id=? AND year=? AND leave_type='EL'").get(creditEmp.id, YEAR).balance;
quiet(() => recomputeLeaves(db, { year: YEAR, dryRun: false, scope: 'manual', actor: 'sim' }));
const bal2 = db.prepare("SELECT balance FROM leave_balances WHERE employee_id=? AND year=? AND leave_type='EL'").get(creditEmp.id, YEAR).balance;
check('the credit is still there after a second run', bal2, bal1);
const planCredit = computeLeavePlan(db, { year: YEAR }).employees.find((e) => e.employee_code === creditEmp.code);
check('  and it counts once, not twice', planCredit.el.adjustments, 3);

step('Edge case: leave spanning a month end lands in both months');

// A fresh employee with no Stage 6 rows for April or May, so the engine has to
// expand the application day by day — which is the path being tested. Where a
// Stage 6 row exists it wins, and that is covered in leaveEngine.test.js.
const spanEmp = addEmp('S900');
db.prepare(`
  INSERT INTO leave_applications (employee_id, employee_code, leave_type, start_date, end_date, days, reason, status, approved_by, approved_at)
  VALUES (?, ?, 'EL', '2026-04-29', '2026-05-02', 4, 'sim span', 'Approved', 'hr1', datetime('now'))
`).run(spanEmp.id, spanEmp.code);
const spanPlan = computeLeavePlan(db, { year: YEAR });
const apr = spanPlan.ledger.find((r) => r.employee_code === spanEmp.code && r.leave_type === 'EL' && r.month === 4);
const may = spanPlan.ledger.find((r) => r.employee_code === spanEmp.code && r.leave_type === 'EL' && r.month === 5);
const spanDates = ['2026-04-29', '2026-04-30', '2026-05-01', '2026-05-02']
  .filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() !== 0);
ok('April carries its share', (apr?.used || 0) > 0, JSON.stringify(apr?.used));
ok('May carries its share', (may?.used || 0) > 0, JSON.stringify(may?.used));
check('  and together they are the whole leave', (apr?.used || 0) + (may?.used || 0), spanDates.length);

step('Edge case: 179 days worked earns nothing, 180 earns the full floor');

for (const [code, total, expected] of [['T179', 179, 0], ['T180', 180, 9]]) {
  const e = addEmp(code);
  let left = total;
  for (let m = 1; m <= 9 && left > 0; m += 1) {
    const d = Math.min(20, left);
    insDayCalc.run(code, m, YEAR, CO_A, d, d);
    left -= d;
  }
  const s = computeLeavePlan(db, { year: YEAR }).employees.find((x) => x.employee_code === code);
  check(`${code}: days worked`, s.days_worked_ytd, total);
  check(`${code}: EL earned`, s.el.earned, expected);
}

step("Edge case: an external 'paid_salary' grant reduces the balance without adding worked days");

const extEmp = addEmp('X001');
insDayCalc.run(extEmp.code, 1, YEAR, CO_A, 20, 20);
const beforeExt = computeLeavePlan(db, { year: YEAR }).employees.find((e) => e.employee_code === 'X001');
db.prepare(`
  INSERT INTO leave_external_grants (employee_code, employee_id, year, month, leave_type, days, mode, uploaded_by)
  VALUES (?, ?, ?, 1, 'EL', 2, 'paid_salary', 'owner')
`).run(extEmp.code, extEmp.id, YEAR);
const afterExt = computeLeavePlan(db, { year: YEAR }).employees.find((e) => e.employee_code === 'X001');
check('days worked unchanged', afterExt.days_worked_ytd, beforeExt.days_worked_ytd);
check('  balance reduced by the grant', afterExt.el.new_balance, beforeExt.el.new_balance - 2);

const takenEmp = addEmp('X002');
insDayCalc.run(takenEmp.code, 1, YEAR, CO_A, 20, 20);
db.prepare(`
  INSERT INTO leave_external_grants (employee_code, employee_id, year, month, leave_type, days, mode, uploaded_by)
  VALUES (?, ?, ?, 1, 'EL', 2, 'leave_taken', 'owner')
`).run(takenEmp.code, takenEmp.id, YEAR);
const takenPlan = computeLeavePlan(db, { year: YEAR }).employees.find((e) => e.employee_code === 'X002');
check("'leave_taken' does add worked days", takenPlan.days_worked_ytd, 22);

step('Edge case: automation off writes nothing');

setPolicy('leave_automation_enabled', 'false');
const rowsBefore = {
  ledger: db.prepare('SELECT COUNT(*) c FROM leave_accrual_ledger').get().c,
  balances: db.prepare('SELECT COUNT(*) c FROM leave_balances').get().c,
};
const offRun = quiet(() => recomputeLeaves(db, { year: YEAR, dryRun: false, scope: 'trigger', actor: 'sim' }));
check('apply refused', offRun.applied, false);
check('  reason', offRun.reason, 'automation_disabled');
check('  ledger unchanged', db.prepare('SELECT COUNT(*) c FROM leave_accrual_ledger').get().c, rowsBefore.ledger);
check('  balances unchanged', db.prepare('SELECT COUNT(*) c FROM leave_balances').get().c, rowsBefore.balances);
const offQueue = queueLeaveRecalc(db, { company: CO_B, month: 4, year: YEAR, reason: 'x' });
check('  and no job is queued', offQueue.reason, 'automation_disabled');
ok('  a skipped_disabled run row is recorded',
  db.prepare("SELECT COUNT(*) c FROM leave_recompute_runs WHERE status='skipped_disabled'").get().c >= 2);
setPolicy('leave_automation_enabled', 'true');

step('Edge case: a second identical run changes nothing');

const snapshot = () => JSON.stringify({
  ledger: db.prepare('SELECT * FROM leave_accrual_ledger ORDER BY employee_code, leave_type, month').all(),
  balances: db.prepare('SELECT * FROM leave_balances ORDER BY employee_id, leave_type').all(),
});
quiet(() => recomputeLeaves(db, { year: YEAR, dryRun: false, scope: 'manual', actor: 'sim' }));
const snapA = snapshot();
quiet(() => recomputeLeaves(db, { year: YEAR, dryRun: false, scope: 'manual', actor: 'sim' }));
check('identical after a repeat run', snapshot() === snapA, true);

const dcSnap = () => JSON.stringify(db.prepare('SELECT * FROM day_calculations WHERE company = ? ORDER BY employee_code, month').all(CO_B));
quiet(() => recomputeDays(db, { company: CO_B, month: MONTH, year: YEAR, requestId: 'sim' }));
const dcA = dcSnap();
quiet(() => recomputeDays(db, { company: CO_B, month: MONTH, year: YEAR, requestId: 'sim' }));
ok('Stage 6 is also idempotent', dcSnap() === dcA);

step("Edge case: HR's late deduction survives a Stage 6 re-run");

const lateEmp = employees[3];
const lateBefore = db.prepare('SELECT total_payable_days, lop_days FROM day_calculations WHERE employee_code=? AND month=? AND year=?').get(lateEmp.code, MONTH, YEAR);
db.prepare(`
  UPDATE day_calculations
  SET late_deduction_days = 2, late_deduction_remark = 'sim', total_payable_days = ?, lop_days = ?
  WHERE employee_code = ? AND month = ? AND year = ?
`).run(Math.max(0, lateBefore.total_payable_days - 2), (lateBefore.lop_days || 0) + 2, lateEmp.code, MONTH, YEAR);
const deducted = db.prepare('SELECT total_payable_days, lop_days FROM day_calculations WHERE employee_code=? AND month=? AND year=?').get(lateEmp.code, MONTH, YEAR);
quiet(() => recomputeDays(db, { company: CO_A, month: MONTH, year: YEAR, requestId: 'sim' }));
const afterRerun = db.prepare('SELECT total_payable_days, lop_days, late_deduction_days FROM day_calculations WHERE employee_code=? AND month=? AND year=?').get(lateEmp.code, MONTH, YEAR);
check('payable days still carry the deduction', afterRerun.total_payable_days, deducted.total_payable_days);
check('  LOP still carries it too', afterRerun.lop_days, deducted.lop_days);
check('  and the flag is intact', afterRerun.late_deduction_days, 2);

step('Salary recompute after all of that');

quiet(() => recomputeSalary(db, { company: CO_A, month: MONTH, year: YEAR, requestId: 'sim' }));
assertNoDrift('the second salary computation');
quiet(() => recomputeSalary(db, { company: CO_B, month: MONTH, year: YEAR, requestId: 'sim' }));
assertNoDrift('the other company');

step('Edge case: year-end lapse zeroes both types and produces a report');

const beforeLapse = db.prepare("SELECT COUNT(*) c FROM leave_balances WHERE year = ? AND balance > 0").get(YEAR).c;
ok('there are balances to lapse', beforeLapse > 0, `${beforeLapse} rows`);
const dry = runYearEndLapse(db, YEAR, { dryRun: true });
check('a dry run writes nothing', db.prepare("SELECT COUNT(*) c FROM leave_balances WHERE year = ? AND balance > 0").get(YEAR).c, beforeLapse);
check('  and reports every row', dry.report.length, beforeLapse);
const live = quiet(() => runYearEndLapse(db, YEAR, { dryRun: false, actor: 'sim' }));
check('after the lapse nothing is left', db.prepare("SELECT COUNT(*) c FROM leave_balances WHERE year = ? AND balance > 0").get(YEAR).c, 0);
check('  lapse transactions written', db.prepare("SELECT COUNT(*) c FROM leave_transactions WHERE transaction_type='Year-End Lapse'").get().c, live.report.length);
ok('  the ledger records what lapsed', db.prepare('SELECT COUNT(*) c FROM leave_accrual_ledger WHERE year = ? AND month = 12 AND lapsed > 0').get(YEAR).c > 0);

step('Edge case: next year seeds its own CL openings, pro-rated');

const seeded = seedYearOpenings(db, YEAR + 1);
ok('openings seeded', seeded.seeded > 0, `${seeded.seeded} rows`);
check('  seeding again is a no-op', seedYearOpenings(db, YEAR + 1).skipped, true);
const clNext = db.prepare("SELECT opening FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = 'CL'").get(employees[0].id, YEAR + 1);
check('  a long-serving employee gets the full base', clNext.opening, 7);

step('A lapse row survives a later recompute');

const lapsedBefore = db.prepare('SELECT SUM(lapsed) s FROM leave_accrual_ledger WHERE year = ?').get(YEAR).s;
quiet(() => recomputeLeaves(db, { year: YEAR, dryRun: false, scope: 'manual', actor: 'sim' }));
check('lapse totals unchanged', db.prepare('SELECT SUM(lapsed) s FROM leave_accrual_ledger WHERE year = ?').get(YEAR).s, lapsedBefore);

// ── report ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(70)}`);
console.log(`  ${pass} passed, ${fail} failed. Maximum salary drift seen: ${maxDriftSeen}`);
if (failures.length) {
  console.log('\n  Failures:');
  for (const f of failures) console.log(`   • ${f}`);
}
console.log('═'.repeat(70));

db.close();
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail === 0 && maxDriftSeen <= 1 ? 0 : 1);

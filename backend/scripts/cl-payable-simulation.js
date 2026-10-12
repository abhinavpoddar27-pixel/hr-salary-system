#!/usr/bin/env node
/**
 * CL payable (ruling 12 Oct 2026) — Stage 6 + Stage 7 simulation.
 *
 * Builds a throwaway SQLite DB, seeds September 2026 for four employees and
 * runs the real recomputeDays + recomputeSalary:
 *   CL3   3 approved CL days on absent days      → +3 paid days vs control
 *   EL3   3 approved EL days on the same days     → same pay as CL3
 *   ABS3  3 plain absences (control)
 *   AUG   the same CL3 shape in August 2026       → pay unchanged (old rule)
 * Checks payable days, gross earned, net, and salary drift = 0.
 *
 *   NODE_ENV=test node scripts/cl-payable-simulation.js
 * Exit code 0 = all checks pass. Never touches a real database.
 */
process.env.NODE_ENV = 'test';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { initSchema } = require('../src/database/schema');
const { recomputeDays, recomputeSalary } = require('../src/services/recompute');

let pass = 0; let fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  ok   ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label} ${detail}`); }
};
const quiet = (fn) => {
  const l = console.log; const w = console.warn; const e = console.error;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return fn(); } finally { console.log = l; console.warn = w; console.error = e; }
};

const CO = 'Asian Lakto Ind Ltd';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-pay-sim-'));
const db = new Database(path.join(dir, 'sim.db'));
quiet(() => initSchema(db));

db.prepare('DELETE FROM holidays').run();
db.prepare("INSERT INTO holidays (date, name, type, applicable_to) VALUES ('2026-09-04', 'Test holiday', 'National', 'All')").run();

const insEmp = db.prepare(`
  INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining,
                         is_contractor, weekly_off_day, gross_salary)
  VALUES (?, ?, 'PRODUCTION', ?, 'Permanent', 'Active', '2024-01-01', 0, 0, 42000)`);
const insStruct = db.prepare(`
  INSERT INTO salary_structures (employee_id, effective_from, basic, hra, gross_salary, pf_applicable, esi_applicable)
  VALUES (?, '2024-01-01', 24000, 9600, 42000, 0, 0)`);
const insAtt = db.prepare(`
  INSERT INTO attendance_processed (employee_code, date, month, year, company, status_original, status_final,
    in_time_original, out_time_original, in_time_final, out_time_final, is_night_out_only, is_miss_punch)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`);
const insLeave = db.prepare(`
  INSERT INTO leave_applications (employee_id, employee_code, leave_type, start_date, end_date, days, reason, status)
  VALUES (?, ?, ?, ?, ?, ?, 'sim', 'Approved')`);

function seed(code, month, absentDays, leaveType) {
  const id = insEmp.run(code, `EMP ${code}`, CO).lastInsertRowid;
  insStruct.run(id);
  const days = new Date(Date.UTC(2026, month, 0)).getUTCDate();
  for (let d = 1; d <= days; d += 1) {
    const date = `2026-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    let s = 'P';
    if (dow === 0) s = 'WO';
    else if (date === '2026-09-04') s = 'NH';
    else if (absentDays.includes(d)) s = 'A';
    const inT = s === 'P' ? '08:00' : null; const outT = s === 'P' ? '20:00' : null;
    insAtt.run(code, date, month, 2026, CO, s, s, inT, outT, inT, outT);
  }
  if (leaveType) {
    const mm = String(month).padStart(2, '0');
    for (const d of absentDays) insLeave.run(id, code, leaveType, `2026-${mm}-${d}`, `2026-${mm}-${d}`, 1);
  }
}

seed('CL3', 9, [17, 18, 19], 'CL');
seed('EL3', 9, [17, 18, 19], 'EL');
seed('ABS3', 9, [17, 18, 19], null);
seed('AUG', 8, [18, 19, 20], 'CL');
seed('AUGA', 8, [18, 19, 20], null);
for (const m of [8, 9]) {
  db.prepare(`INSERT INTO monthly_imports (month, year, company, file_name, status, record_count, employee_count, stage_1_done)
              VALUES (?, 2026, ?, 'sim.xls', 'imported', 100, 5, 1)`).run(m, CO);
}

for (const m of [8, 9]) {
  quiet(() => recomputeDays(db, { company: '', month: m, year: 2026, requestId: 'sim' }));
  quiet(() => recomputeSalary(db, { company: '', month: m, year: 2026, requestId: 'sim' }));
}

const dc = (code, m) => db.prepare('SELECT * FROM day_calculations WHERE employee_code=? AND month=? AND year=2026').get(code, m);
const sc = (code, m) => db.prepare('SELECT * FROM salary_computations WHERE employee_code=? AND month=? AND year=2026').get(code, m);

console.log('\n── September 2026 (CL paid) ──');
const [cl, el, abs] = ['CL3', 'EL3', 'ABS3'].map((c) => ({ d: dc(c, 9), s: sc(c, 9) }));
console.log(`  payable  CL3=${cl.d.total_payable_days}  EL3=${el.d.total_payable_days}  ABS3=${abs.d.total_payable_days}`);
console.log(`  net      CL3=${cl.s.net_salary}  EL3=${el.s.net_salary}  ABS3=${abs.s.net_salary}`);
ok('CL3 cl_used = 3', cl.d.cl_used === 3);
ok('CL3 gets 3 more payable days than the plain-absence control',
  Math.abs(cl.d.total_payable_days - abs.d.total_payable_days - 3) < 0.001,
  `${cl.d.total_payable_days} vs ${abs.d.total_payable_days}`);
ok('CL3 is paid exactly like EL3 (payable)', cl.d.total_payable_days === el.d.total_payable_days);
ok('CL3 is paid exactly like EL3 (net)', Math.abs(cl.s.net_salary - el.s.net_salary) < 0.01);
const rate = 42000 / 30;
ok('CL3 gross_earned − ABS3 gross_earned = 3 days at gross/30',
  Math.abs((cl.s.gross_earned - abs.s.gross_earned) - 3 * rate) < 1,
  `diff ${cl.s.gross_earned - abs.s.gross_earned}, expected ${3 * rate}`);
ok('CL3 uninformed absences = 0', cl.d.uninformed_absent === 0);

console.log('\n── August 2026 (before the change) ──');
const aug = { d: dc('AUG', 8), s: sc('AUG', 8) }; const augA = { d: dc('AUGA', 8), s: sc('AUGA', 8) };
console.log(`  payable  AUG(CL)=${aug.d.total_payable_days}  AUGA(absent)=${augA.d.total_payable_days}`);
ok('August CL still relabels only (payable equal to absent control)', aug.d.total_payable_days === augA.d.total_payable_days);
ok('August net equal to absent control', Math.abs(aug.s.net_salary - augA.s.net_salary) < 0.01);

console.log('\n── Drift ──');
const worst = db.prepare(`SELECT MAX(ABS(net_salary - (gross_earned - total_deductions))) w FROM salary_computations`).get().w || 0;
ok('salary drift ≤ 1 on every row', worst <= 1, `worst ${worst}`);

console.log(`\n${pass} passed, ${fail} failed`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);

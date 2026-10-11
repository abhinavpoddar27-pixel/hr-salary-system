#!/usr/bin/env node
/**
 * PR-2b simulation — Stage 7 before / after: which salary rows move when contractor late / early deductions reach pay.
 *
 *   node backend/scripts/contractor-deductions-simulation.js [--root <repo root>] [--dump out.json]
 *
 * Builds an in-memory DB with the real schema (synthetic codes SIM…): 40 company staff + 20 contractors over Aug, Sep and
 * Oct 2026, a spread of approved / pending / rejected late rows and approved / warning early rows (some on contractors,
 * some on staff, some before Sep 2026), runs the real recomputeSalary for each month, and prints / dumps every salary row.
 * Run it with --root pointing at a checkout of main and at this branch, then compare the dumps: only contractor rows from
 * Sep 2026 that have an approved late / early row may differ, and only by that deduction.
 */
const path = require('path');
const args = process.argv.slice(2);
const root = args.includes('--root') ? path.resolve(args[args.indexOf('--root') + 1]) : path.resolve(__dirname, '..', '..');
const dump = args.includes('--dump') ? args[args.indexOf('--dump') + 1] : null;
const F = require(path.join(root, 'backend/src/__tests__/helpers/leaveFixture'));
const { recomputeSalary } = require(path.join(root, 'backend/src/services/recompute'));

const C = 'Indriyan Beverages Pvt Ltd';
const db = F.newDb();
let seq = 0;
for (let i = 0; i < 60; i++) {
  const contract = i >= 40;
  const code = `SIM${String(i).padStart(3, '0')}`;
  const e = F.addEmployee(db, { code, company: C, employment_type: contract ? 'Contract' : 'Permanent', is_contractor: contract ? 1 : 0 });
  db.prepare('UPDATE employees SET gross_salary = ? WHERE code = ?').run(12000 + i * 731, code);
  for (const m of [8, 9, 10]) {
    const payable = 18 + ((i + m) % 9);
    F.addDayCalc(db, e, m, 2026, { days_present: payable, total_payable_days: payable });
    if (i % 5 === 0) db.prepare('UPDATE day_calculations SET extra_duty_days = 1 WHERE employee_code = ? AND month = ?').run(code, m);
    if (i % 3 === 0) {
      const status = i % 9 === 0 ? 'pending' : i % 7 === 0 ? 'rejected' : 'approved';
      seq++;
      db.prepare(`INSERT INTO late_coming_deductions (employee_code, month, year, company, late_count, deduction_days, remark, applied_by, finance_status, applied_at)
        VALUES (?, ?, 2026, ?, 7, ?, 'sim', 'hr1', ?, datetime('now', ?))`).run(code, m, C, 0.5 + (i % 4) * 0.5, status, `-${seq} seconds`);
    }
    if (i % 4 === 1) {
      const date = `2026-${String(m).padStart(2, '0')}-${String(3 + (i % 20)).padStart(2, '0')}`;
      const det = db.prepare('INSERT INTO early_exit_detections (employee_code, date) VALUES (?, ?)').run(code, date).lastInsertRowid;
      db.prepare(`INSERT INTO early_exit_deductions (early_exit_detection_id, employee_code, company, date, deduction_type, deduction_amount,
        payroll_month, payroll_year, finance_status, hr_remark) VALUES (?, ?, ?, ?, ?, ?, ?, 2026, 'approved', 'sim')`)
        .run(det, code, C, date, i % 8 === 1 ? 'warning' : 'half_day', 150 + i * 7, m);
    }
  }
}
const rows = [];
for (const m of [8, 9, 10]) {
  F.silently(() => recomputeSalary(db, { month: m, year: 2026, company: C }));
  for (const r of db.prepare(`SELECT employee_code, month, is_contractor, gross_earned, ot_pay, late_coming_deduction, early_exit_deduction,
      total_deductions, net_salary, total_payable, take_home FROM salary_computations WHERE month = ? ORDER BY employee_code`).all(m)) rows.push(r);
}
const drift = db.prepare('SELECT COUNT(*) n FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1').get().n;
if (dump) require('fs').writeFileSync(dump, JSON.stringify(rows, null, 1));
const cAfter = rows.filter((r) => r.is_contractor && r.month >= 9 && (r.late_coming_deduction || r.early_exit_deduction));
console.log(`rows ${rows.length}; drift rows ${drift}; contractor rows charged from Sep 2026: ${cAfter.length}; ` +
  `contractor rows charged before Sep 2026: ${rows.filter((r) => r.is_contractor && r.month < 9 && (r.late_coming_deduction || r.early_exit_deduction)).length}`);

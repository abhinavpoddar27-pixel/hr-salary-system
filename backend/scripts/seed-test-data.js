#!/usr/bin/env node
/**
 * Seed Test Data for PR Preview Environments
 *
 * Populates a fresh SQLite database with realistic sample data
 * so PR preview environments have employees, attendance, and salary data.
 *
 * Safety: Exits immediately if SEED_DATA env var is not set to 'true'
 * Idempotent: Uses INSERT OR IGNORE so re-runs won't duplicate data
 */

const path = require('path');

// Safety check — never run in production
if (process.env.SEED_DATA !== 'true') {
  console.log('[SEED] SEED_DATA not set to true — skipping test data seeding');
  process.exit(0);
}

console.log('[SEED] Starting test data seeding for PR preview environment...');

// Initialize database
process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const { getDb } = require('../src/database/db');
const db = getDb();

// ── Sample Employees ──────────────────────────────────────────────
const sampleEmployees = [
  { code: 'T0001', name: 'RAJESH KUMAR', father: 'MOHAN LAL', dept: 'PRODUCTION', designation: 'OPERATOR', company: 'Indriyan Beverages Pvt Ltd', type: 'Permanent', gross: 18000, doj: '2020-03-15', gender: 'Male', pf: 1, esi: 1 },
  { code: 'T0002', name: 'SURESH SINGH', father: 'BALDEV SINGH', dept: 'PRODUCTION', designation: 'HELPER', company: 'Indriyan Beverages Pvt Ltd', type: 'Permanent', gross: 14000, doj: '2021-06-01', gender: 'Male', pf: 1, esi: 1 },
  { code: 'T0003', name: 'ANITA DEVI', father: 'RAM PRAKASH', dept: 'PACKING', designation: 'PACKING OPERATOR', company: 'Indriyan Beverages Pvt Ltd', type: 'Permanent', gross: 15500, doj: '2019-11-10', gender: 'Female', pf: 1, esi: 1 },
  { code: 'T0004', name: 'GURPREET KAUR', father: 'HARJINDER SINGH', dept: 'QUALITY', designation: 'QC INSPECTOR', company: 'Indriyan Beverages Pvt Ltd', type: 'Permanent', gross: 22000, doj: '2018-01-20', gender: 'Female', pf: 1, esi: 0 },
  { code: 'T0005', name: 'VIKRAM SHARMA', father: 'DINESH SHARMA', dept: 'MAINTENANCE', designation: 'TECHNICIAN', company: 'Indriyan Beverages Pvt Ltd', type: 'Permanent', gross: 20000, doj: '2022-04-05', gender: 'Male', pf: 1, esi: 1 },
  { code: 'T0006', name: 'HARPREET SINGH', father: 'KULWANT SINGH', dept: 'DAIRY PLANT', designation: 'PLANT OPERATOR', company: 'Asian Lakto Ind Ltd', type: 'Permanent', gross: 19000, doj: '2020-08-12', gender: 'Male', pf: 1, esi: 1 },
  { code: 'T0007', name: 'MANDEEP KAUR', father: 'SURJIT SINGH', dept: 'ADMIN', designation: 'CLERK', company: 'Asian Lakto Ind Ltd', type: 'Permanent', gross: 16000, doj: '2021-02-28', gender: 'Female', pf: 1, esi: 1 },
  { code: 'T0008', name: 'AMANDEEP SINGH', father: 'JAGTAR SINGH', dept: 'STORES', designation: 'STORE KEEPER', company: 'Asian Lakto Ind Ltd', type: 'Permanent', gross: 17500, doj: '2019-07-15', gender: 'Male', pf: 1, esi: 1 },
  { code: 'T0009', name: 'RAJU RAM', father: 'SHIV RAM', dept: 'MANPREET CON', designation: 'WORKER', company: 'Indriyan Beverages Pvt Ltd', type: 'Contract', gross: 12000, doj: '2024-01-10', gender: 'Male', pf: 0, esi: 0 },
  { code: 'T0010', name: 'PAPPU YADAV', father: 'RAMESH YADAV', dept: 'MANPREET CON', designation: 'WORKER', company: 'Indriyan Beverages Pvt Ltd', type: 'Contract', gross: 11500, doj: '2024-03-01', gender: 'Male', pf: 0, esi: 0 },
  { code: 'T0011', name: 'COM HELPER TEST', father: 'TEST FATHER', dept: 'COM. HELPER', designation: 'HELPER', company: 'Indriyan Beverages Pvt Ltd', type: 'Permanent', gross: 13000, doj: '2023-05-20', gender: 'Male', pf: 0, esi: 1 },
  { code: 'T0012', name: 'NEW JOINER APRIL', father: 'LATE FATHER', dept: 'PRODUCTION', designation: 'TRAINEE', company: 'Indriyan Beverages Pvt Ltd', type: 'Permanent', gross: 12500, doj: '2026-04-15', gender: 'Male', pf: 1, esi: 1 },
];

const insertEmployee = db.prepare(`
  INSERT OR IGNORE INTO employees (
    code, name, father_name, department, designation, company,
    employment_type, gross_salary, date_of_joining, gender,
    pf_applicable, esi_applicable, pt_applicable,
    status, is_data_complete, weekly_off_day
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'Active', 1, 'Sunday')
`);

const insertSalaryStructure = db.prepare(`
  INSERT OR IGNORE INTO salary_structures (
    employee_id, employee_code, company, gross_salary,
    basic, da, hra, conveyance, other_allowances,
    basic_percent, da_percent, hra_percent,
    pf_applicable, esi_applicable, pt_applicable
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 50, 0, 20, ?, ?, 1)
`);

console.log('[SEED] Inserting sample employees...');
const employeeIds = {};

for (const emp of sampleEmployees) {
  insertEmployee.run(
    emp.code, emp.name, emp.father, emp.dept, emp.designation, emp.company,
    emp.type, emp.gross, emp.doj, emp.gender, emp.pf, emp.esi
  );
  const row = db.prepare('SELECT id FROM employees WHERE code = ?').get(emp.code);
  if (row) {
    employeeIds[emp.code] = row.id;
    const basic = Math.round(emp.gross * 0.50);
    const hra = Math.round(emp.gross * 0.20);
    const other = emp.gross - basic - hra;
    insertSalaryStructure.run(
      row.id, emp.code, emp.company, emp.gross,
      basic, 0, hra, 0, other, emp.pf, emp.esi
    );
  }
}
console.log(`[SEED] Inserted ${Object.keys(employeeIds).length} employees`);

// ── Sample Attendance for March 2026 ──────────────────────────────
console.log('[SEED] Generating March 2026 attendance data...');
const month = 3, year = 2026, daysInMonth = 31;

db.prepare(`INSERT OR IGNORE INTO monthly_imports (month, year, company, file_name, status, record_count, employee_count, stage_1_done) VALUES (?, ?, ?, 'SEED_DATA_TEST.xls', 'imported', 0, 0, 1)`).run(month, year, 'Indriyan Beverages Pvt Ltd');
db.prepare(`INSERT OR IGNORE INTO monthly_imports (month, year, company, file_name, status, record_count, employee_count, stage_1_done) VALUES (?, ?, ?, 'SEED_DATA_TEST.xls', 'imported', 0, 0, 1)`).run(month, year, 'Asian Lakto Ind Ltd');

const insertAttendance = db.prepare(`
  INSERT OR IGNORE INTO attendance_processed (
    employee_id, employee_code, date, status_original, status_final,
    in_time_original, in_time_final, out_time_original, out_time_final,
    actual_hours, is_miss_punch, miss_punch_resolved,
    stage_2_done, stage_3_done, stage_4_done, stage_5_done,
    month, year, company
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, ?, ?, ?)
`);

function getDayOfWeek(dateStr) { return new Date(dateStr).getDay(); }
let totalRecords = 0;

for (const emp of sampleEmployees) {
  const empId = employeeIds[emp.code];
  if (!empId) continue;
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    if (emp.doj > dateStr) continue;
    const dow = getDayOfWeek(dateStr);
    if (dow === 0) {
      insertAttendance.run(empId, emp.code, dateStr, 'WO', 'WO', null, null, null, null, 0, 0, 0, month, year, emp.company);
    } else {
      const rand = Math.random();
      let status, inT, outT, hrs, mp;
      if (rand < 0.80) { status='P'; inT='08:00'; outT='17:00'; hrs=9; mp=0; }
      else if (rand < 0.88) { status='A'; inT=null; outT=null; hrs=0; mp=0; }
      else if (rand < 0.93) { status='HD'; inT='08:00'; outT='12:30'; hrs=4.5; mp=0; }
      else if (rand < 0.97) { status='MP'; inT='08:00'; outT=null; hrs=0; mp=1; }
      else { status='P'; inT='06:00'; outT='19:00'; hrs=13; mp=0; }
      insertAttendance.run(empId, emp.code, dateStr, status, status, inT, inT, outT, outT, hrs, mp, 0, month, year, emp.company);
    }
    totalRecords++;
  }
}
console.log(`[SEED] Inserted ~${totalRecords} attendance records`);

// ── Day Calculations ─────────────────────────────────────────────
console.log('[SEED] Generating day calculations...');
const insertDayCalc = db.prepare(`
  INSERT OR IGNORE INTO day_calculations (
    employee_id, employee_code, month, year, company,
    total_calendar_days, total_sundays, total_holidays, total_working_days,
    days_present, days_half_present, days_wop, days_absent,
    paid_sundays, unpaid_sundays, paid_holidays,
    cl_used, el_used, sl_used, lop_days,
    total_payable_days, ot_hours, ot_days, is_approved
  ) VALUES (?, ?, ?, ?, ?, 31, 4, 1, 26, ?, ?, 0, ?, ?, 0, 1, 0, 0, 0, ?, ?, ?, 0, 0)
`);

for (const emp of sampleEmployees) {
  const empId = employeeIds[emp.code];
  if (!empId) continue;
  const stats = db.prepare(`SELECT COUNT(CASE WHEN status_final='P' THEN 1 END) as present, COUNT(CASE WHEN status_final='HD' THEN 1 END) as half, COUNT(CASE WHEN status_final='A' THEN 1 END) as absent, COUNT(CASE WHEN status_final='MP' THEN 1 END) as mp, SUM(CASE WHEN actual_hours>10 THEN actual_hours-9 ELSE 0 END) as ot_hours FROM attendance_processed WHERE employee_code=? AND month=? AND year=?`).get(emp.code, month, year);
  const daysPresent = (stats?.present||0) + (stats?.half||0)*0.5;
  const daysHalf = stats?.half||0;
  const daysAbsent = (stats?.absent||0) + (stats?.mp||0);
  const otHours = Math.round((stats?.ot_hours||0)*100)/100;
  const paidSundays = (emp.type==='Permanent' && daysPresent>=20) ? 4 : (emp.type==='Permanent' && daysPresent>=15) ? 3 : 0;
  const lop = Math.max(0, daysAbsent);
  const payable = Math.min(31, daysPresent + paidSundays + 1 - lop);
  insertDayCalc.run(empId, emp.code, month, year, emp.company, daysPresent, daysHalf, daysAbsent, paidSundays, lop, Math.max(0, Math.round(payable*100)/100), otHours, Math.round(otHours/8*100)/100);
}

// ── Salary Computations ──────────────────────────────────────────
console.log('[SEED] Generating salary computations...');
const insertSalary = db.prepare(`
  INSERT OR IGNORE INTO salary_computations (
    employee_id, employee_code, month, year, company,
    payable_days, per_day_rate, gross_salary,
    basic_earned, da_earned, hra_earned, conveyance_earned, other_allowances_earned,
    ot_pay, gross_earned, pf_wages, esi_wages,
    pf_employee, pf_employer, eps, esi_employee, esi_employer,
    professional_tax, tds, advance_recovery, lop_deduction, other_deductions,
    total_deductions, net_salary, is_finalised
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
`);

for (const emp of sampleEmployees) {
  const empId = employeeIds[emp.code];
  if (!empId) continue;
  const dc = db.prepare('SELECT * FROM day_calculations WHERE employee_code=? AND month=? AND year=?').get(emp.code, month, year);
  if (!dc) continue;
  const payable = dc.total_payable_days;
  const perDay = Math.round(emp.gross/31*100)/100;
  const ratio = Math.min(payable/31, 1.0);
  const basic = Math.round(emp.gross*0.50);
  const hra = Math.round(emp.gross*0.20);
  const other = emp.gross - basic - hra;
  const bE = Math.round(basic*ratio*100)/100;
  const hE = Math.round(hra*ratio*100)/100;
  const oE = Math.round(other*ratio*100)/100;
  const gE = Math.round((bE+hE+oE)*100)/100;
  const otPay = Math.round(dc.ot_hours*(perDay/8)*2*100)/100;
  const pfW = emp.pf ? Math.min(bE, 15000) : 0;
  const pfEmp = emp.pf ? Math.round(pfW*0.12*100)/100 : 0;
  const pfEr = emp.pf ? Math.round(pfW*0.0833*100)/100 : 0;
  const eps = emp.pf ? Math.round(pfW*0.0367*100)/100 : 0;
  const esiW = (emp.esi && gE<=21000) ? gE : 0;
  const esiEmp = esiW ? Math.round(esiW*0.0075*100)/100 : 0;
  const esiEr = esiW ? Math.round(esiW*0.0325*100)/100 : 0;
  const pt = gE>0 ? 200 : 0;
  const totDed = Math.round((pfEmp+esiEmp+pt)*100)/100;
  const net = Math.round((gE-totDed)*100)/100;
  insertSalary.run(empId, emp.code, month, year, emp.company, payable, perDay, emp.gross, bE, 0, hE, 0, oE, otPay, gE, pfW, esiW, pfEmp, pfEr, eps, esiEmp, esiEr, pt, 0, 0, 0, 0, totDed, net);
}

db.prepare(`INSERT OR IGNORE INTO shifts (name, start_time, end_time, grace_minutes) VALUES ('GENERAL', '08:00', '17:00', 9)`).run();
db.prepare(`INSERT OR IGNORE INTO shifts (name, start_time, end_time, grace_minutes) VALUES ('NIGHT', '20:00', '05:00', 9)`).run();
db.prepare(`INSERT OR IGNORE INTO holidays (name, date, type, applicable_to) VALUES ('Holi', '2026-03-04', 'National', 'All')`).run();
db.prepare(`INSERT OR IGNORE INTO holidays (name, date, type, applicable_to) VALUES ('Ram Navami', '2026-04-02', 'National', 'All')`).run();
db.prepare(`INSERT OR IGNORE INTO company_config (company, config_key, config_value) VALUES ('Indriyan Beverages Pvt Ltd', 'address', 'Mohali, Punjab')`).run();
db.prepare(`INSERT OR IGNORE INTO company_config (company, config_key, config_value) VALUES ('Asian Lakto Ind Ltd', 'address', 'Mohali, Punjab')`).run();

console.log('[SEED] Test data seeding complete!');
console.log(`[SEED] ${Object.keys(employeeIds).length} employees, ~${totalRecords} attendance records, day calcs, salary comps`);
process.exit(0);

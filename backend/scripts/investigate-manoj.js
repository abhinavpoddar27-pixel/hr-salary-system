#!/usr/bin/env node
/**
 * Investigation: MANOJ CJOUDHARY (23551) — March 2026
 *
 * System shows: 28.5 payable days, earned ₹14,250
 * HR expected: 30.0 payable days, earned ~₹15,000
 * Gap: 1.5 days
 *
 * This script pulls Manoj's complete data so we can trace the gap to a
 * specific variable and line of code in dayCalculation.js.
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const { getDb } = require('../src/database/db');
const db = getDb();

const CODE = '23551';
const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── 1. Employee Master ──
console.log('=== EMPLOYEE MASTER ===');
const emp = db.prepare(`
  SELECT code, name, department, employment_type, gross_salary,
         pf_applicable, esi_applicable, status, is_contractor, category
  FROM employees WHERE code = ?
`).get(CODE);
console.log(JSON.stringify(emp, null, 2));

// ── 2. Day-by-day attendance ──
console.log('\n=== ATTENDANCE DAY-BY-DAY (March 2026) ===');
const records = db.prepare(`
  SELECT date, status_original, status_final,
         COALESCE(status_final, status_original) as eff,
         in_time_original, out_time_original, actual_hours,
         is_late_arrival, is_night_out_only, overtime_minutes
  FROM attendance_processed
  WHERE employee_code = ? AND month = 3 AND year = 2026
  ORDER BY date
`).all(CODE);

const statusCounts = { P: 0, WOP: 0, '½P': 0, 'WO½P': 0, A: 0, WO: 0, HP: 0, other: 0 };
const byDate = {};

for (const r of records) {
  if (r.is_night_out_only) continue;
  byDate[r.date] = r;
  const s = r.eff;
  if (statusCounts[s] !== undefined) statusCounts[s]++;
  else statusCounts.other++;

  const dow = new Date(r.date + 'T12:00:00').getDay();
  console.log(`  ${r.date} (${dayNames[dow]}) | ${(r.eff||'').padEnd(5)} | In: ${(r.in_time_original||'—').padEnd(5)} Out: ${(r.out_time_original||'—').padEnd(5)} | ${(r.actual_hours||0).toFixed(1)}h`);
}

console.log('\n  --- Dates with NO attendance record ---');
for (let d = 1; d <= 31; d++) {
  const ds = `2026-03-${String(d).padStart(2,'0')}`;
  if (!byDate[ds]) {
    const dow = new Date(ds + 'T12:00:00').getDay();
    console.log(`  ${ds} (${dayNames[dow]}) — NO RECORD`);
  }
}

console.log('\n=== ATTENDANCE COUNTS ===');
console.log(`  P (present Mon-Sat):     ${statusCounts.P}`);
console.log(`  WOP (Sunday full):       ${statusCounts.WOP}`);
console.log(`  ½P (half day Mon-Sat):   ${statusCounts['½P']}`);
console.log(`  HP (half day Mon-Sat):   ${statusCounts.HP}`);
console.log(`  WO½P (half day Sunday):  ${statusCounts['WO½P']}`);
console.log(`  A (absent):              ${statusCounts.A}`);
console.log(`  WO (weekly off):         ${statusCounts.WO}`);
console.log(`  Other:                   ${statusCounts.other}`);

// ── 3. Holidays ──
console.log('\n=== HOLIDAYS (March 2026) ===');
const holidays = db.prepare(`SELECT * FROM holidays WHERE date LIKE '2026-03-%'`).all();
console.log(JSON.stringify(holidays, null, 2));

const holidaysFetched = db.prepare(`SELECT date, name, type, applicable_to FROM holidays WHERE date LIKE ?`).all('2026-03-%');
console.log('Payroll route fetches:', JSON.stringify(holidaysFetched));

// ── 4. Day Calculation stored result ──
console.log('\n=== DAY CALCULATION (stored in DB) ===');
const dc = db.prepare(`SELECT * FROM day_calculations WHERE employee_code = ? AND month = 3 AND year = 2026`).get(CODE);
if (dc) {
  const fields = [
    'days_present', 'days_half_present', 'days_wop', 'days_absent',
    'paid_sundays', 'unpaid_sundays', 'paid_holidays',
    'cl_used', 'el_used', 'lop_days',
    'total_payable_days', 'extra_duty_days',
    'is_contractor', 'late_count', 'late_deduction_days',
    'sunday_threshold', 'sunday_note'
  ];
  for (const f of fields) {
    console.log(`  ${f.padEnd(22)} = ${dc[f]}`);
  }

  if (dc.week_breakdown) {
    try {
      const weeks = JSON.parse(dc.week_breakdown);
      console.log('\n  --- Week-by-week Sunday breakdown ---');
      for (const w of weeks) {
        console.log(`  ${w.sundayDate}: worked=${w.workedDays}/${w.requiredDays||w.availableDays} paid=${w.sundayPaid} CL=${w.clUsed} EL=${w.elUsed} LOP=${w.lop}`);
        console.log(`    Note: ${w.note}`);
      }
    } catch(e) {}
  }

  console.log('\n=== SYSTEM FORMULA BREAKDOWN ===');
  console.log(`  days_present:       ${dc.days_present} (does NOT include WOP — daysWOP is separate: ${dc.days_wop})`);
  console.log(`  days_half_present:  ${dc.days_half_present}`);
  console.log(`  days_wop:           ${dc.days_wop}`);
  console.log(`  paid_sundays:       ${dc.paid_sundays}`);
  console.log(`  paid_holidays:      ${dc.paid_holidays}`);
  console.log(`  lop_days:           ${dc.lop_days}`);
  console.log(`  `);
  console.log(`  Code formula (dayCalculation.js:281):`);
  console.log(`    grossEarned = daysPresent + daysWOP + daysHalfPresent + paidSundays + paidHolidays`);
  const sysCalc = (dc.days_present||0) + (dc.days_wop||0) + (dc.days_half_present||0) + (dc.paid_sundays||0) + (dc.paid_holidays||0);
  console.log(`                = ${dc.days_present} + ${dc.days_wop} + ${dc.days_half_present} + ${dc.paid_sundays} + ${dc.paid_holidays}`);
  console.log(`                = ${sysCalc}`);
  console.log(`    netPayable  = grossEarned - lopDays = ${sysCalc - (dc.lop_days||0)}`);
  console.log(`    finalPayable= min(daysInMonth=31, netPayable) = ${Math.min(31, sysCalc - (dc.lop_days||0))}`);
  console.log(`  Stored total:   ${dc.total_payable_days}`);
} else {
  console.log('  NO DAY CALCULATION FOUND — run Stage 6 first');
}

// ── 5. Salary Computation ──
console.log('\n=== SALARY COMPUTATION ===');
const sc = db.prepare(`SELECT * FROM salary_computations WHERE employee_code = ? AND month = 3 AND year = 2026`).get(CODE);
if (sc) {
  console.log(`  gross_salary:     ${sc.gross_salary}`);
  console.log(`  payable_days:     ${sc.payable_days}`);
  console.log(`  gross_earned:     ${sc.gross_earned}`);
  console.log(`  ot_pay:           ${sc.ot_pay}`);
  console.log(`  ot_days:          ${sc.ot_days}`);
  console.log(`  net_salary:       ${sc.net_salary}`);
  console.log(`  total_payable:    ${sc.total_payable}`);
  console.log(`  is_contractor:    ${sc.is_contractor}`);
} else {
  console.log('  NO SALARY COMPUTATION FOUND');
}

// ── 6. Contractor Detection ──
console.log('\n=== CONTRACTOR DETECTION ===');
try {
  const { isContractorDept } = require('../src/services/analytics');
  console.log(`  isContractorDept("${emp?.department}"): ${isContractorDept(emp?.department)}`);
} catch(e) {
  console.log(`  isContractorDept: ${e.message}`);
}
try {
  const { isContractorForPayroll } = require('../src/utils/employeeClassification');
  console.log(`  isContractorForPayroll(emp):            ${isContractorForPayroll(emp)}`);
} catch(e) {
  console.log(`  isContractorForPayroll: ${e.message}`);
}

// ── 7. HR Expected vs System ──
console.log('\n=== HR EXPECTED vs SYSTEM ===');
console.log('  HR model (permanent employee):');
console.log('    Base:          31 days (full month with Sundays + Holi)');
console.log('    Absent:        -4 working days');
console.log('    Half day:      -0.5 (working day)');
console.log('    Subtotal:      26.5');
console.log('    Sunday WOP:    +3 full');
console.log('    Sunday WO½P:   +0.5 half');
console.log('    Total:         30.0 days');
console.log(`  System shows:    ${dc?.total_payable_days} days`);
console.log(`  Gap:             ${30 - (dc?.total_payable_days || 0)} days`);

// ── 8. Leave Balances ──
console.log('\n=== LEAVE BALANCES ===');
const leaves = db.prepare(`
  SELECT * FROM leave_balances
  WHERE employee_id = (SELECT id FROM employees WHERE code = ?) AND year = 2026
`).all(CODE);
console.log(JSON.stringify(leaves, null, 2));

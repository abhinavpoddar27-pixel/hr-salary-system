#!/usr/bin/env node
/**
 * Import Master Employee Data into HR System Database
 *
 * Reads the extracted master data JSON and imports/upserts into the database.
 * Creates: employees, salary_structures, leave_balances
 */

const path = require('path');
const fs = require('fs');

// Initialize database (runs schema migrations)
process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const { getDb } = require('../backend/src/database/db');
const db = getDb();

const dataPath = path.join(__dirname, 'master-data-extracted.json');
if (!fs.existsSync(dataPath)) {
  console.error('ERROR: Run extract-master-data.js first');
  process.exit(1);
}

const { employees } = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
console.log(`Loaded ${employees.length} employees from extraction\n`);

// ── Determine which employees are still active ──────────────────────
// "Active" = appeared in Jan 2026 or Feb 2026 salary sheet
// "Left" = last seen before Jan 2026
const ACTIVE_CUTOFF = 202601; // Jan 2026

// ── Upsert employees ────────────────────────────────────────────────
const insertEmp = db.prepare(`
  INSERT INTO employees (
    code, name, father_name, dob, gender, department, designation, company,
    employment_type, date_of_joining, uan, aadhaar_masked, aadhar,
    bank_account, account_number, bank_name, ifsc, ifsc_code,
    gross_salary, pf_applicable, esi_applicable, pt_applicable,
    status, is_data_complete, category
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?
  )
  ON CONFLICT(code) DO UPDATE SET
    name = COALESCE(NULLIF(excluded.name, ''), employees.name),
    father_name = COALESCE(NULLIF(excluded.father_name, ''), employees.father_name),
    dob = COALESCE(excluded.dob, employees.dob),
    department = COALESCE(NULLIF(excluded.department, ''), employees.department),
    designation = COALESCE(NULLIF(excluded.designation, ''), employees.designation),
    company = COALESCE(NULLIF(excluded.company, ''), employees.company),
    employment_type = COALESCE(NULLIF(excluded.employment_type, ''), employees.employment_type),
    date_of_joining = COALESCE(excluded.date_of_joining, employees.date_of_joining),
    uan = COALESCE(NULLIF(excluded.uan, ''), employees.uan),
    bank_account = COALESCE(NULLIF(excluded.bank_account, ''), employees.bank_account),
    account_number = COALESCE(NULLIF(excluded.account_number, ''), employees.account_number),
    bank_name = COALESCE(NULLIF(excluded.bank_name, ''), employees.bank_name),
    ifsc = COALESCE(NULLIF(excluded.ifsc, ''), employees.ifsc),
    ifsc_code = COALESCE(NULLIF(excluded.ifsc_code, ''), employees.ifsc_code),
    gross_salary = CASE WHEN excluded.gross_salary > 0 THEN excluded.gross_salary ELSE employees.gross_salary END,
    pf_applicable = excluded.pf_applicable,
    esi_applicable = excluded.esi_applicable,
    status = excluded.status,
    category = excluded.category,
    updated_at = datetime('now')
`);

const insertSalary = db.prepare(`
  INSERT INTO salary_structures (
    employee_id, effective_from, gross_salary,
    basic, da, hra, conveyance, special_allowance, other_allowances,
    basic_percent, hra_percent, da_percent,
    pf_applicable, esi_applicable, pt_applicable, pf_wage_ceiling
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertLeave = db.prepare(`
  INSERT OR IGNORE INTO leave_balances (employee_id, year, leave_type, opening, balance)
  VALUES (?, ?, ?, ?, ?)
`);

// Add 'category' column to employees if not exists
try { db.exec("ALTER TABLE employees ADD COLUMN category TEXT DEFAULT ''"); } catch(e) {}

let inserted = 0, updated = 0, salaryCreated = 0, errors = 0;

const txn = db.transaction(() => {
  for (const emp of employees) {
    try {
      // Determine status
      const isActive = emp.lastSeenSortKey >= ACTIVE_CUTOFF;
      const status = isActive ? 'Active' : 'Left';

      // PF/ESI inference from salary levels
      const gross = emp.gross_salary || 0;
      const basic = emp.basic || 0;
      const pfApplicable = emp.pf_applicable !== undefined ? emp.pf_applicable : 0;
      const esiApplicable = emp.esi_applicable !== undefined ? emp.esi_applicable : 0;
      const ptApplicable = gross >= 15000 ? 1 : 0;

      // Compute salary percentages
      const basicPct = gross > 0 ? Math.round(basic / gross * 100) : 50;
      const hraPct = gross > 0 ? Math.round(emp.hra / gross * 100) : 0;
      const daPct = 0; // DA is usually 0

      // Map category to employment type
      let empType = emp.employment_type || 'Permanent';
      if (emp.category === 'Worker') empType = 'Worker';
      else if (emp.category === 'Sales') empType = 'Sales';
      else if (emp.category === 'SILP') empType = 'SILP';
      else if (emp.category === 'Driver') empType = 'Driver';

      // Check existing
      const existing = db.prepare('SELECT id FROM employees WHERE code = ?').get(emp.code);

      insertEmp.run(
        emp.code, emp.name, emp.father_name || '', emp.dob || null, null,
        emp.department || '', emp.designation || '', emp.company || '',
        empType, emp.date_of_joining || null,
        emp.uan || '', emp.aadhaar || '', emp.aadhaar || '',
        emp.account_number || '', emp.account_number || '',
        emp.bank_name || '', emp.ifsc || '', emp.ifsc || '',
        gross, pfApplicable, esiApplicable, ptApplicable,
        status, gross > 0 ? 1 : 0, emp.category || ''
      );

      if (existing) { updated++; } else { inserted++; }

      // Get employee ID (after insert/update)
      const empRow = db.prepare('SELECT id FROM employees WHERE code = ?').get(emp.code);
      if (!empRow) continue;

      // Create salary structure (only if gross > 0 and no existing structure)
      if (gross > 0) {
        const existingSalary = db.prepare('SELECT id FROM salary_structures WHERE employee_id = ?').get(empRow.id);
        if (!existingSalary) {
          const effectiveFrom = emp.date_of_joining || '2025-04-01';
          const specialAllowance = Math.max(0, gross - basic - emp.hra - emp.cca - emp.conv);

          insertSalary.run(
            empRow.id, effectiveFrom, gross,
            basic, 0, emp.hra || 0, emp.conv || 0, specialAllowance, emp.cca || 0,
            basicPct, hraPct, daPct,
            pfApplicable, esiApplicable, ptApplicable, 15000
          );
          salaryCreated++;
        }
      }

      // Initialize leave balances for 2025 and 2026
      for (const year of [2025, 2026]) {
        insertLeave.run(empRow.id, year, 'CL', 12, 12);
        insertLeave.run(empRow.id, year, 'EL', 0, 0);
        insertLeave.run(empRow.id, year, 'SL', 0, 0);
      }

    } catch (err) {
      errors++;
      if (errors <= 5) console.error(`  Error for ${emp.code} (${emp.name}): ${err.message}`);
    }
  }
});

txn();

// ── Summary ────────────────────────────────────────────────────────
const totalActive = db.prepare("SELECT COUNT(*) as cnt FROM employees WHERE status = 'Active'").get().cnt;
const totalLeft = db.prepare("SELECT COUNT(*) as cnt FROM employees WHERE status = 'Left'").get().cnt;
const totalAll = db.prepare("SELECT COUNT(*) as cnt FROM employees").get().cnt;
const totalSalary = db.prepare("SELECT COUNT(*) as cnt FROM salary_structures").get().cnt;

console.log('═'.repeat(60));
console.log('IMPORT COMPLETE');
console.log('═'.repeat(60));
console.log(`New employees inserted: ${inserted}`);
console.log(`Existing updated:       ${updated}`);
console.log(`Salary structures:      ${salaryCreated}`);
console.log(`Errors:                 ${errors}`);
console.log(`\nDatabase state:`);
console.log(`  Total employees: ${totalAll}`);
console.log(`  Active:          ${totalActive}`);
console.log(`  Left:            ${totalLeft}`);
console.log(`  Salary structs:  ${totalSalary}`);

// Category breakdown
const catBreakdown = db.prepare(`
  SELECT category, status, COUNT(*) as cnt
  FROM employees
  GROUP BY category, status
  ORDER BY category, status
`).all();
console.log('\nBy Category & Status:');
for (const r of catBreakdown) {
  console.log(`  ${r.category || 'Unknown'} [${r.status}]: ${r.cnt}`);
}

// Company breakdown
const compBreakdown = db.prepare(`
  SELECT company, status, COUNT(*) as cnt
  FROM employees
  GROUP BY company, status
  ORDER BY company, status
`).all();
console.log('\nBy Company & Status:');
for (const r of compBreakdown) {
  console.log(`  ${r.company || 'Unknown'} [${r.status}]: ${r.cnt}`);
}

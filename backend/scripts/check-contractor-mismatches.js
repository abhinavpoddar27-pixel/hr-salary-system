#!/usr/bin/env node
/**
 * Contractor detection audit — finds employees where the dept-keyword
 * heuristic disagrees with employment_type from the Employee Master, or
 * where employment_type is missing entirely.
 *
 * Usage: node backend/scripts/check-contractor-mismatches.js
 *
 * Reads the DB from DATA_DIR or ./data/hr_system.db.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const dbPath = path.join(DATA_DIR, 'hr_system.db');

if (!fs.existsSync(dbPath)) {
  console.error(`DB not found at ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const {
  isContractorForPayroll,
  deptMatchesContractorKeyword
} = require('../src/utils/employeeClassification');

const employees = db.prepare(`
  SELECT code, name, department, employment_type, category, is_contractor, status
  FROM employees
  WHERE status NOT IN ('Left', 'Inactive', 'Exited')
`).all();

const mismatches = [];
const flipped = [];

for (const emp of employees) {
  const empType = (emp.employment_type || '').trim().toLowerCase();
  const deptSaysContractor = deptMatchesContractorKeyword(emp.department);
  const typeSaysPermanent = empType && !empType.includes('contract');
  const typeSaysContractor = empType.includes('contract');

  if (deptSaysContractor && typeSaysPermanent && emp.is_contractor !== 1) {
    mismatches.push({
      code: emp.code,
      name: emp.name,
      department: emp.department,
      employment_type: emp.employment_type,
      category: emp.category || '',
      is_contractor: emp.is_contractor,
      issue: 'DEPT_SAYS_CONT_BUT_TYPE_SAYS_PERMANENT'
    });
  }

  if (!deptSaysContractor && typeSaysContractor) {
    mismatches.push({
      code: emp.code,
      name: emp.name,
      department: emp.department,
      employment_type: emp.employment_type,
      category: emp.category || '',
      is_contractor: emp.is_contractor,
      issue: 'DEPT_SAYS_PERM_BUT_TYPE_SAYS_CONTRACTOR'
    });
  }

  if (!empType) {
    mismatches.push({
      code: emp.code,
      name: emp.name,
      department: emp.department,
      employment_type: '(empty)',
      category: emp.category || '',
      is_contractor: emp.is_contractor,
      issue: 'NO_EMPLOYMENT_TYPE_SET'
    });
  }
}

console.log(`Total active employees: ${employees.length}`);
console.log(`Mismatches found: ${mismatches.length}`);
console.log('');
if (mismatches.length > 0) {
  console.table(mismatches.slice(0, 100));
  if (mismatches.length > 100) console.log(`... and ${mismatches.length - 100} more`);
}

// Compare previously-persisted salary_computations.is_contractor against the
// new payroll-grade classification to find employees whose flag will flip.
try {
  const latest = db.prepare(`
    SELECT sc.employee_code, sc.is_contractor, sc.gross_earned, sc.net_salary,
           sc.month, sc.year
    FROM salary_computations sc
    WHERE sc.month = (SELECT MAX(month) FROM salary_computations WHERE year = sc.year)
      AND sc.year = (SELECT MAX(year) FROM salary_computations)
  `).all();

  for (const row of latest) {
    const emp = employees.find(e => e.code === row.employee_code);
    if (!emp) continue;
    const newIsContractor = isContractorForPayroll(emp);
    const wasContractor = row.is_contractor === 1;
    if (newIsContractor !== wasContractor) {
      flipped.push({
        code: row.employee_code,
        name: emp.name,
        department: emp.department,
        employment_type: emp.employment_type,
        was: wasContractor ? 'CONT' : 'PERM',
        now: newIsContractor ? 'CONT' : 'PERM',
        prev_gross_earned: row.gross_earned,
        prev_net_salary: row.net_salary
      });
    }
  }

  console.log('');
  console.log(`Employees whose contractor flag flips after this fix: ${flipped.length}`);
  if (flipped.length > 0) {
    console.table(flipped.slice(0, 100));
  }
} catch (e) {
  console.log('(skipped salary_computations comparison — ' + e.message + ')');
}

db.close();

// Exit non-zero if mismatches exist so this script can be used in CI
process.exit(mismatches.length > 0 ? 1 : 0);

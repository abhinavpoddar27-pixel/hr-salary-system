/**
 * Shared fixture for the statutory-flags PR-1 suites.
 * Real initSchema() on an in-memory database; synthetic codes only (never real
 * employees, ESI numbers or UANs).
 */
const Database = require('better-sqlite3');
const { initSchema } = require('../../database/schema');

const COMPANY = 'Indriyan Beverages Pvt Ltd';
const OTHER_COMPANY = 'Asian Lakto Ind Ltd';

function silently(fn) {
  const log = console.log; const err = console.error; const warn = console.warn;
  console.log = () => {}; console.error = () => {}; console.warn = () => {};
  try { return fn(); } finally { console.log = log; console.error = err; console.warn = warn; }
}

function newDb() {
  const db = new Database(':memory:');
  silently(() => initSchema(db));
  return db;
}

let seq = 1;

/** Plant employee. The trigger sets flags to 0 on insert; pass flags to switch them on afterwards. */
function plant(db, over = {}) {
  const code = over.code || `T${String(9000 + seq++)}`;
  const info = db.prepare(`
    INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, gross_salary, uan, esi_number, pf_number)
    VALUES (?, 'SYNTH EMP', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(code, over.department || 'PRODUCTION', over.company === undefined ? COMPANY : over.company,
    over.employment_type || 'Permanent', over.status || 'Active', over.date_of_joining || '2024-01-01',
    over.gross_salary ?? 15000, over.uan ?? null, over.esi_number ?? null, over.pf_number ?? null);
  const id = Number(info.lastInsertRowid);
  if (over.pf !== undefined || over.esi !== undefined || over.lwf !== undefined) {
    db.prepare('UPDATE employees SET pf_applicable = ?, esi_applicable = ?, lwf_applicable = ? WHERE id = ?')
      .run(over.pf ? 1 : 0, over.esi ? 1 : 0, over.lwf ? 1 : 0, id);
  }
  return { id, code, company: over.company === undefined ? COMPANY : over.company };
}

/** Plant structure row. Every column the copy logic must carry gets a distinct value. */
function plantStructure(db, emp, effectiveFrom, over = {}) {
  const g = over.gross_salary ?? 15000;
  const info = db.prepare(`
    INSERT INTO salary_structures
      (employee_id, effective_from, gross_salary, basic, da, hra, conveyance, special_allowance, other_allowances,
       basic_percent, da_percent, hra_percent, pf_applicable, esi_applicable, pt_applicable, lwf_applicable, pf_wage_ceiling)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(emp.id, effectiveFrom, g, over.basic ?? g * 0.5, over.da ?? 0, over.hra ?? g * 0.2,
    over.conveyance ?? 300, over.special_allowance ?? 0, over.other_allowances ?? (g * 0.3 - 300),
    over.basic_percent ?? 50, over.da_percent ?? 0, over.hra_percent ?? 20,
    over.pf ? 1 : 0, over.esi ? 1 : 0, over.pt ?? 0, over.lwf ? 1 : 0, over.pf_wage_ceiling ?? 15000);
  return Number(info.lastInsertRowid);
}

function salesEmp(db, over = {}) {
  const code = over.code || `Z${String(800 + seq++)}`;
  const company = over.company || COMPANY;
  const info = db.prepare(`
    INSERT INTO sales_employees (code, name, company, status, doj, gross_salary, state, pf_applicable, esi_applicable, pt_applicable, lwf_applicable, esi_number, uan)
    VALUES (?, 'SYNTH SALES', ?, ?, ?, ?, 'Punjab', ?, ?, 0, ?, ?, ?)
  `).run(code, company, over.status || 'Active', over.doj ?? '2025-01-01', over.gross_salary ?? 18000,
    over.pf ? 1 : 0, over.esi ? 1 : 0, over.lwf ? 1 : 0, over.esi_number ?? null, over.uan ?? null);
  return { id: Number(info.lastInsertRowid), code, company };
}

function salesStructure(db, emp, effectiveFrom, over = {}) {
  const g = over.gross_salary ?? 18000;
  const info = db.prepare(`
    INSERT INTO sales_salary_structures
      (employee_id, effective_from, effective_to, basic, hra, cca, conveyance, gross_salary,
       pf_applicable, esi_applicable, pt_applicable, lwf_applicable, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fixture')
  `).run(emp.id, effectiveFrom, over.effective_to ?? null, over.basic ?? g * 0.5, over.hra ?? g * 0.2,
    over.cca ?? g * 0.1, over.conveyance ?? g * 0.2, g, over.pf ? 1 : 0, over.esi ? 1 : 0, 0, over.lwf ? 1 : 0,
    over.notes ?? null);
  return Number(info.lastInsertRowid);
}

const plantRows = (db, emp) => db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from, id').all(emp.id);
const salesRows = (db, emp) => db.prepare('SELECT * FROM sales_salary_structures WHERE employee_id = ? ORDER BY effective_from, id').all(emp.id);
const master = (db, emp) => db.prepare('SELECT * FROM employees WHERE id = ?').get(emp.id);
const salesMaster = (db, emp) => db.prepare('SELECT * FROM sales_employees WHERE id = ?').get(emp.id);
const flags = (r) => ({ pf: r.pf_applicable, esi: r.esi_applicable, lwf: r.lwf_applicable });

function counts(db) {
  const c = (t) => db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  return {
    employees: c('employees'), salary_structures: c('salary_structures'),
    sales_employees: c('sales_employees'), sales_salary_structures: c('sales_salary_structures'),
  };
}

module.exports = {
  COMPANY, OTHER_COMPANY, silently, newDb, plant, plantStructure, salesEmp, salesStructure,
  plantRows, salesRows, master, salesMaster, flags, counts,
};

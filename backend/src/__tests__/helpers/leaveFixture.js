/**
 * Shared in-memory fixture for the leave-automation specs.
 * Every test gets its own database — nothing here ever touches a real file.
 */
const Database = require('better-sqlite3');
const { initSchema } = require('../../database/schema');

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

function setPolicy(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO policy_config (key, value, description) VALUES (?, ?, COALESCE((SELECT description FROM policy_config WHERE key = ?), ?))')
    .run(key, String(value), key, key);
}

let nextId = 1;
function addEmployee(db, over = {}) {
  const e = {
    code: over.code || `E${String(nextId++).padStart(3, '0')}`,
    name: over.name || 'TEST EMPLOYEE',
    department: over.department || 'PRODUCTION',
    company: over.company === undefined ? 'Indriyan Beverages Pvt Ltd' : over.company,
    employment_type: over.employment_type === undefined ? 'Permanent' : over.employment_type,
    status: over.status || 'Active',
    date_of_joining: over.date_of_joining || '2024-01-01',
    is_contractor: over.is_contractor ?? 0,
    weekly_off_day: over.weekly_off_day ?? 0,
  };
  const info = db.prepare(`
    INSERT INTO employees (code, name, department, company, employment_type, status,
                           date_of_joining, is_contractor, weekly_off_day, gross_salary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 20000)
  `).run(e.code, e.name, e.department, e.company, e.employment_type, e.status,
    e.date_of_joining, e.is_contractor, e.weekly_off_day);
  return { ...e, id: info.lastInsertRowid };
}

/** One Stage-6 row. Anything not passed defaults to zero. */
function addDayCalc(db, emp, month, year, over = {}) {
  const v = {
    days_present: 0, days_half_present: 0, days_wop: 0, el_used: 0, cl_used: 0,
    sl_used: 0, od_days: 0, lop_days: 0, total_payable_days: 0,
    paid_sundays: 0, paid_holidays: 0, days_absent: 0, ...over,
  };
  db.prepare(`
    INSERT INTO day_calculations
      (employee_code, month, year, company, days_present, days_half_present, days_wop,
       cl_used, el_used, sl_used, od_days, lop_days, total_payable_days,
       paid_sundays, paid_holidays, days_absent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(emp.code, month, year, emp.company ?? null,
    v.days_present, v.days_half_present, v.days_wop, v.cl_used, v.el_used, v.sl_used,
    v.od_days, v.lop_days, v.total_payable_days, v.paid_sundays, v.paid_holidays, v.days_absent);
}

function addApplication(db, emp, over = {}) {
  const a = {
    leave_type: 'EL', start_date: '2026-01-05', end_date: '2026-01-05',
    days: 1, status: 'Approved', reason: 'test', ...over,
  };
  db.prepare(`
    INSERT INTO leave_applications
      (employee_id, employee_code, leave_type, start_date, end_date, days, reason, status, approved_by, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'hr1', datetime('now'))
  `).run(emp.id, emp.code, a.leave_type, a.start_date, a.end_date, a.days, a.reason, a.status);
}

function addTransaction(db, emp, over = {}) {
  const t = {
    leave_type: 'EL', transaction_type: 'Credit', days: 1, balance_after: 0,
    reference_month: 1, reference_year: 2026, reason: 'manual', approved_by: 'admin', ...over,
  };
  db.prepare(`
    INSERT INTO leave_transactions
      (employee_id, employee_code, company, leave_type, transaction_type, days,
       balance_after, reference_month, reference_year, reason, approved_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(emp.id, emp.code, emp.company ?? null, t.leave_type, t.transaction_type, t.days,
    t.balance_after, t.reference_month, t.reference_year, t.reason, t.approved_by);
}

function addExternalGrant(db, emp, over = {}) {
  const g = { year: 2026, month: 1, leave_type: 'EL', days: 1, mode: 'leave_taken', ...over };
  db.prepare(`
    INSERT INTO leave_external_grants (employee_code, employee_id, year, month, leave_type, days, mode, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'owner')
  `).run(emp.code, emp.id, g.year, g.month, g.leave_type, g.days, g.mode);
}

function setBalance(db, emp, leaveType, year, { opening = 0, accrued = 0, used = 0, balance = 0 }) {
  db.prepare(`
    INSERT INTO leave_balances (employee_id, year, leave_type, opening, accrued, used, balance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id, year, leave_type) DO UPDATE SET
      opening = excluded.opening, accrued = excluded.accrued,
      used = excluded.used, balance = excluded.balance
  `).run(emp.id, year, leaveType, opening, accrued, used, balance);
}

function getBalance(db, emp, leaveType, year) {
  return db.prepare('SELECT * FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = ?')
    .get(emp.id, year, leaveType);
}

/** Enough working days in one month to move the YTD total by `days`. */
function addWorkedMonth(db, emp, month, year, days) {
  addDayCalc(db, emp, month, year, { days_present: days, total_payable_days: days });
}

function rowCounts(db) {
  const c = (t) => db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  return {
    ledger: c('leave_accrual_ledger'),
    balances: c('leave_balances'),
    runs: c('leave_recompute_runs'),
    transactions: c('leave_transactions'),
  };
}

/** Automation ON + external grants acknowledged — the post-switch-on state. */
function enableAutomation(db) {
  setPolicy(db, 'leave_automation_enabled', 'true');
  setPolicy(db, 'leave_external_grants_acknowledged', 'true');
}

module.exports = {
  newDb, silently, setPolicy, addEmployee, addDayCalc, addApplication, addTransaction,
  addExternalGrant, setBalance, getBalance, addWorkedMonth, rowCounts, enableAutomation,
};

/**
 * Loans PR-1 — Mark Left must never fail because of the loan schema.
 *
 * If the Loans PR-1 rebuild refused (an old loans table with a row in it), the
 * loan tables are still the old shape. Mark Left must skip the loan block, warn,
 * note the skip in the audit remark, and still mark the employee Left — leaving
 * the old loan rows exactly as they were.
 */
const { startApi } = require('./helpers/apiHarness');
const { initSchema } = require('../database/schema');

const COMPANY = 'Indriyan Beverages Pvt Ltd';
let api;
let db;

beforeAll(() => {
  api = startApi({ '/api/employees': '../../routes/employees' }, { role: 'hr', username: 'hr1' });
  db = api.db;

  // Put the database back to the pre-PR-1 shape with a live old loan…
  db.exec('DROP VIEW loan_repayments');
  for (const t of ['loan_events', 'loan_deductions', 'loan_instalments', 'loan_receipts', 'loan_closes', 'loans']) {
    db.exec(`DROP TABLE ${t}`);
  }
  db.prepare("DELETE FROM policy_config WHERE key = 'migration_loans_schema_v2_done'").run();
  db.exec(`
    CREATE TABLE loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER, employee_code TEXT NOT NULL,
      loan_type TEXT NOT NULL, principal_amount REAL NOT NULL, interest_rate REAL DEFAULT 0,
      total_amount REAL NOT NULL, emi_amount REAL NOT NULL, tenure_months INTEGER NOT NULL,
      start_month INTEGER, start_year INTEGER, status TEXT DEFAULT 'Active', approved_by TEXT,
      approved_at TEXT, disbursed_date TEXT, disbursement_mode TEXT DEFAULT 'Bank Transfer',
      total_recovered REAL DEFAULT 0, remaining_balance REAL DEFAULT 0, remarks TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE loan_repayments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, loan_id INTEGER REFERENCES loans(id),
      employee_code TEXT NOT NULL, month INTEGER NOT NULL, year INTEGER NOT NULL,
      emi_amount REAL NOT NULL, principal_component REAL DEFAULT 0, interest_component REAL DEFAULT 0,
      deducted_from_salary INTEGER DEFAULT 0, deduction_date TEXT, status TEXT DEFAULT 'Pending',
      remarks TEXT, created_at TEXT DEFAULT (datetime('now')));
  `);
  db.prepare(`INSERT INTO employees (code, name, company, employment_type, status, date_of_joining)
              VALUES ('MU01', 'TEST', ?, 'Permanent', 'Active', '2024-01-01')`).run(COMPANY);
  const loanId = db.prepare(`INSERT INTO loans (employee_code, loan_type, principal_amount, total_amount,
              emi_amount, tenure_months, status, remaining_balance)
              VALUES ('MU01', 'Personal Loan', 6000, 6000, 2000, 3, 'Active', 6000)`).run().lastInsertRowid;
  db.prepare(`INSERT INTO loan_repayments (loan_id, employee_code, month, year, emi_amount)
              VALUES (?, 'MU01', 11, 2026, 2000)`).run(loanId);

  // …then boot again: the rebuild must take the refusal path.
  const errors = [];
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const err = jest.spyOn(console, 'error').mockImplementation((...a) => errors.push(a.join(' ')));
  try { initSchema(db); } finally { log.mockRestore(); warn.mockRestore(); err.mockRestore(); }
  expect(errors.join('\n')).toMatch(/REFUSING TO REBUILD/);
});
afterAll(async () => { await api.close(); });

test('refusal path: Mark Left returns 200, employee is Left, old loan rows untouched', async () => {
  expect(db.prepare("SELECT value FROM policy_config WHERE key = 'migration_loans_schema_v2_done'").get()).toBeUndefined();
  const loansBefore = db.prepare('SELECT * FROM loans').all();
  const repBefore = db.prepare('SELECT * FROM loan_repayments').all();

  const warnings = [];
  const warn = jest.spyOn(console, 'warn').mockImplementation((...a) => warnings.push(a.join(' ')));
  let res;
  try {
    res = await api.request('PUT', '/api/employees/MU01/mark-left', { body: { date_of_leaving: '2026-10-05', reason: 'Resigned' } });
  } finally { warn.mockRestore(); }

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(db.prepare("SELECT status, date_of_exit FROM employees WHERE code = 'MU01'").get())
    .toEqual({ status: 'Left', date_of_exit: '2026-10-05' });
  expect(db.prepare('SELECT * FROM loans').all()).toEqual(loansBefore);
  expect(db.prepare('SELECT * FROM loan_repayments').all()).toEqual(repBefore);
  expect(warnings.filter((w) => w.includes('MU01') && w.includes('loans not flagged'))).toHaveLength(1);
  const remark = db.prepare("SELECT remark FROM audit_log WHERE table_name = 'employees' ORDER BY id DESC LIMIT 1").get().remark;
  expect(remark).toMatch(/loan schema not migrated — loans not flagged/);
});

/**
 * Loans PR-1 — schema rebuild (docs/loans/SPEC.md §6, K13).
 *
 * Real initSchema() throughout. The "old shape" fixtures start from a real
 * initSchema() database and put back the pre-PR-1 `loans` / `loan_repayments`
 * DDL (copied verbatim from schema.js @ 1aa6ca4, L340–378), so every other
 * table is exactly as production has it.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { initSchema } = require('../database/schema');
const F = require('./helpers/leaveFixture');

const OLD_LOAN_DDL = `
    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER REFERENCES employees(id),
      employee_code TEXT NOT NULL,
      loan_type TEXT NOT NULL,
      principal_amount REAL NOT NULL,
      interest_rate REAL DEFAULT 0,
      total_amount REAL NOT NULL,
      emi_amount REAL NOT NULL,
      tenure_months INTEGER NOT NULL,
      start_month INTEGER,
      start_year INTEGER,
      status TEXT DEFAULT 'Active',
      approved_by TEXT,
      approved_at TEXT,
      disbursed_date TEXT,
      disbursement_mode TEXT DEFAULT 'Bank Transfer',
      total_recovered REAL DEFAULT 0,
      remaining_balance REAL DEFAULT 0,
      remarks TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS loan_repayments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id INTEGER REFERENCES loans(id),
      employee_code TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      emi_amount REAL NOT NULL,
      principal_component REAL DEFAULT 0,
      interest_component REAL DEFAULT 0,
      deducted_from_salary INTEGER DEFAULT 0,
      deduction_date TEXT,
      status TEXT DEFAULT 'Pending',
      remarks TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
`;

const NEW_TABLES = ['loans', 'loan_instalments', 'loan_deductions', 'loan_receipts', 'loan_closes', 'loan_events'];
const COMPANY = 'Indriyan Beverages Pvt Ltd';

const POLICY_DEFAULTS = {
  loan_close_day: '13',
  loan_deduction_cap_pct: '50',
  loan_max_multiple_gross: '2',
  loan_max_multiple_gross_emergency: '3',
  loan_max_tenure_months: '12',
  loan_min_service_months: '6',
  loan_max_active_per_person: '1',
  loan_emi_ceiling_pct_gross: '30',
  loan_deduction_load_warning_pct: '30',
  loan_held_emi_wait_days: '60',
  loan_max_shortfall_extension_months: '3',
  loan_eligible_employment_types: '["Permanent","SILP","Worker","Sales"]',
  loan_types: '["Personal","Emergency / medical","Festival advance","Education"]',
  loan_agreement_required: 'true',
  loan_interest_rate: '0',
  loan_perquisite_threshold: '20000',
  // Loans PR-3 gate (coordinator ruling A): no disbursement until PR-5/PR-6.
  loans_disbursement_enabled: '0',
};

let tmpDir;
beforeAll(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loans-schema-')); });
afterAll(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

let fileNo = 0;
function boot(db) {
  const errors = [];
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const err = jest.spyOn(console, 'error').mockImplementation((...a) => errors.push(a.join(' ')));
  try { initSchema(db); } finally { log.mockRestore(); warn.mockRestore(); err.mockRestore(); }
  return errors.filter((e) => e.includes('loans_schema_v2'));
}
function openFile() {
  const db = new Database(path.join(tmpDir, `db${fileNo++}.db`));
  db.pragma('foreign_keys = ON');            // production pragma (db.js)
  return db;
}
const objType = (db, name) => (db.prepare('SELECT type FROM sqlite_master WHERE name = ?').get(name) || {}).type;
const flag = (db) => (db.prepare("SELECT value FROM policy_config WHERE key = 'migration_loans_schema_v2_done'").get() || {}).value;
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

/** A production-shaped pre-PR-1 database: everything else current, loans old-shape. */
function oldShapeDb() {
  const db = openFile();
  boot(db);
  db.exec('DROP VIEW loan_repayments');
  for (const t of ['loan_events', 'loan_deductions', 'loan_instalments', 'loan_receipts', 'loan_closes', 'loans']) {
    db.exec(`DROP TABLE ${t}`);
  }
  db.prepare("DELETE FROM policy_config WHERE key = 'migration_loans_schema_v2_done' OR key LIKE 'loan%'").run();
  db.exec(OLD_LOAN_DDL);
  return db;
}

/** A plant loan in the new shape. */
function addLoan(db, over = {}) {
  const v = {
    borrower_type: 'plant', employee_code: 'L001', company: COMPANY, loan_type: 'Personal',
    principal_amount: 9000, tenure_months: 3, emi_amount: 3000, status: 'active',
    requested_by: 'hr1', remaining_balance: 9000, ...over,
  };
  const info = db.prepare(`
    INSERT INTO loans (borrower_type, employee_code, company, loan_type, principal_amount,
                       tenure_months, emi_amount, status, requested_by, remaining_balance)
    VALUES (@borrower_type, @employee_code, @company, @loan_type, @principal_amount,
            @tenure_months, @emi_amount, @status, @requested_by, @remaining_balance)
  `).run(v);
  return info.lastInsertRowid;
}
function addInstalment(db, loanId, seq, month, year, amount = 3000) {
  return db.prepare(`
    INSERT INTO loan_instalments (loan_id, sequence, due_month, due_year, amount_due)
    VALUES (?, ?, ?, ?, ?)
  `).run(loanId, seq, month, year, amount).lastInsertRowid;
}

// ── 1. Fresh database ───────────────────────────────────────────────────────
describe('fresh database', () => {
  let db;
  beforeAll(() => { db = openFile(); boot(db); });
  afterAll(() => db.close());

  test('creates the six tables and the legacy view, and sets the flag', () => {
    for (const t of NEW_TABLES) expect(objType(db, t)).toBe('table');
    expect(objType(db, 'loan_repayments')).toBe('view');
    expect(flag(db)).toBe('1');
  });

  test('loans carries the SPEC §6 columns and keeps the old reader column names', () => {
    const c = cols(db, 'loans');
    for (const k of ['borrower_type', 'company', 'exit_flag', 'exit_date', 'first_emi_month', 'first_emi_year',
      'requested_by', 'decided_by', 'disbursed_by', 'disbursement_reference', 'agreement_file_path',
      'written_off_amount', 'write_off_reason',
      // kept so loanService / routes/loans.js / ai.js / the portal still parse
      'employee_code', 'loan_type', 'principal_amount', 'interest_rate', 'tenure_months', 'emi_amount',
      'status', 'remaining_balance', 'disbursement_mode', 'remarks', 'created_at', 'updated_at']) {
      expect(c).toContain(k);
    }
    expect(cols(db, 'loan_deductions')).not.toContain('salary_computation_id');
  });

  test('every index and the two immutability triggers exist', () => {
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name LIKE 'loan%'").all().map((r) => r.name);
    for (const i of ['idx_loans_employee', 'idx_loans_status', 'idx_loans_company_status',
      'idx_loan_instalments_loan_status', 'idx_loan_instalments_due', 'idx_loan_deductions_period',
      'idx_loan_deductions_employee', 'idx_loan_deductions_instalment', 'idx_loan_receipts_loan',
      'idx_loan_events_loan']) {
      expect(idx).toContain(i);
    }
    const trg = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'loan_events'").all().map((r) => r.name);
    expect(trg.sort()).toEqual(['loan_events_no_delete', 'loan_events_no_update']);
  });

  test('the legacy view has the 13 old column names and no rows', () => {
    expect(cols(db, 'loan_repayments')).toEqual(['id', 'loan_id', 'employee_code', 'month', 'year',
      'emi_amount', 'principal_component', 'interest_component', 'deducted_from_salary',
      'deduction_date', 'status', 'remarks', 'created_at']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM loan_repayments').get().n).toBe(0);
  });

  test('foreign_keys is left ON after the migration', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

// ── 2–4. Old shape: rebuild, refuse, retry ─────────────────────────────────
describe('old-shape database', () => {
  test('both old tables empty → rebuilt to the new shape, flag set, no error', () => {
    const db = oldShapeDb();
    expect(cols(db, 'loans')).toContain('total_amount');
    const errors = boot(db);
    expect(errors).toEqual([]);
    expect(cols(db, 'loans')).toContain('borrower_type');
    expect(cols(db, 'loans')).not.toContain('total_amount');
    expect(objType(db, 'loan_repayments')).toBe('view');
    for (const t of NEW_TABLES) expect(objType(db, t)).toBe('table');
    expect(flag(db)).toBe('1');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });

  test('a row in old loans → refused loudly, nothing changed, flag unset', () => {
    const db = oldShapeDb();
    db.prepare(`INSERT INTO loans (employee_code, loan_type, principal_amount, total_amount, emi_amount, tenure_months, status)
                VALUES ('X1', 'Personal Loan', 5000, 5000, 1000, 5, 'Active')`).run();
    const errors = boot(db);
    expect(errors.join('\n')).toMatch(/REFUSING TO REBUILD.*loans \(1 rows\)/);
    expect(cols(db, 'loans')).toContain('total_amount');           // old shape intact
    expect(db.prepare('SELECT employee_code, status FROM loans').all()).toEqual([{ employee_code: 'X1', status: 'Active' }]);
    expect(objType(db, 'loan_repayments')).toBe('table');
    for (const t of NEW_TABLES.filter((t) => t !== 'loans')) expect(objType(db, t)).toBeUndefined();
    expect(flag(db)).toBeUndefined();
    db.close();
  });

  test('a row only in old loan_repayments → also refused', () => {
    const db = oldShapeDb();
    db.pragma('foreign_keys = OFF');          // an orphan repayment row (no loan)
    db.prepare(`INSERT INTO loan_repayments (loan_id, employee_code, month, year, emi_amount)
                VALUES (99, 'X2', 3, 2026, 1000)`).run();
    db.pragma('foreign_keys = ON');
    const errors = boot(db);
    expect(errors.join('\n')).toMatch(/REFUSING TO REBUILD.*loan_repayments \(1 rows\)/);
    expect(objType(db, 'loan_repayments')).toBe('table');
    expect(db.prepare('SELECT COUNT(*) AS n FROM loan_repayments').get().n).toBe(1);
    expect(flag(db)).toBeUndefined();
    db.close();
  });

  test('refused, then emptied → the next boot rebuilds (retry works)', () => {
    const db = oldShapeDb();
    db.prepare(`INSERT INTO loans (employee_code, loan_type, principal_amount, total_amount, emi_amount, tenure_months)
                VALUES ('X3', 'Personal Loan', 5000, 5000, 1000, 5)`).run();
    expect(boot(db).length).toBeGreaterThan(0);
    db.prepare('DELETE FROM loans').run();
    expect(boot(db)).toEqual([]);
    expect(cols(db, 'loans')).toContain('borrower_type');
    expect(flag(db)).toBe('1');
    db.close();
  });
});

// ── 5. Idempotent across boots ──────────────────────────────────────────────
describe('idempotent', () => {
  test('a second and third boot change nothing and keep the rows written in between', () => {
    const db = openFile();
    boot(db);
    const loanId = addLoan(db);
    addInstalment(db, loanId, 1, 4, 2026);
    db.prepare("INSERT INTO loan_events (loan_id, event, actor) VALUES (?, 'created', 'hr1')").run(loanId);
    const objects = () => db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name LIKE 'loan%' OR name LIKE 'idx_loan%' ORDER BY name").all();
    const before = objects();

    expect(boot(db)).toEqual([]);
    expect(boot(db)).toEqual([]);

    expect(objects()).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) AS n FROM loans').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM loan_instalments').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM loan_events').get().n).toBe(1);
    expect(flag(db)).toBe('1');
    db.close();
  });

  test('a dropped index comes back on the next boot', () => {
    const db = openFile();
    boot(db);
    db.exec('DROP INDEX idx_loan_deductions_period');
    boot(db);
    expect(objType(db, 'idx_loan_deductions_period')).toBe('index');
    db.close();
  });
});

// ── 6–8. Keys, CHECKs, immutability ────────────────────────────────────────
describe('constraints', () => {
  let db;
  let loanId;
  beforeEach(() => { db = F.newDb(); db.pragma('foreign_keys = ON'); loanId = addLoan(db); });
  afterEach(() => db.close());

  test('UNIQUE(loan, sequence) on instalments', () => {
    addInstalment(db, loanId, 1, 4, 2026);
    expect(() => addInstalment(db, loanId, 1, 5, 2026)).toThrow(/UNIQUE/);
    expect(() => addInstalment(db, loanId, 2, 5, 2026)).not.toThrow();
  });

  test('UNIQUE(loan, month, year, payroll) on deductions; the other payroll is allowed', () => {
    const ins = db.prepare(`INSERT INTO loan_deductions (loan_id, payroll, month, year, employee_code, amount)
                            VALUES (?, ?, 4, 2026, 'L001', 3000)`);
    ins.run(loanId, 'plant');
    expect(() => ins.run(loanId, 'plant')).toThrow(/UNIQUE/);
    expect(() => ins.run(loanId, 'sales')).not.toThrow();
  });

  test('UNIQUE receipt_no and UNIQUE close per month + year + payroll', () => {
    const rc = db.prepare(`INSERT INTO loan_receipts (receipt_no, loan_id, amount, mode, receipt_date, recorded_by)
                           VALUES (?, ?, 1000, 'cash', '2026-04-05', 'fin1')`);
    rc.run('LR-0001', loanId);
    expect(() => rc.run('LR-0001', loanId)).toThrow(/UNIQUE/);
    const cl = db.prepare("INSERT INTO loan_closes (month, year, payroll, run_by) VALUES (4, 2026, ?, 'system')");
    cl.run('plant');
    expect(() => cl.run('plant')).toThrow(/UNIQUE/);
    expect(() => cl.run('sales')).not.toThrow();
  });

  test('CHECKs reject bad states, borrower type and companies', () => {
    expect(() => addLoan(db, { status: 'Active' })).toThrow(/CHECK/);         // old vocabulary
    expect(() => addLoan(db, { status: 'closed' })).toThrow(/CHECK/);
    expect(() => addLoan(db, { borrower_type: 'contract' })).toThrow(/CHECK/);
    for (const company of ['', '   ', 'Default', 'default', 'null', 'NULL']) {
      expect(() => addLoan(db, { company })).toThrow(/CHECK/);
    }
    expect(() => addLoan(db, { principal_amount: 0 })).toThrow(/CHECK/);
    expect(() => db.prepare("UPDATE loan_instalments SET status = 'Pending'").run()).not.toThrow(); // no rows yet
    addInstalment(db, loanId, 1, 4, 2026);
    expect(() => db.prepare("UPDATE loan_instalments SET status = 'Pending'").run()).toThrow(/CHECK/);
    expect(() => db.prepare(`INSERT INTO loan_deductions (loan_id, payroll, month, year, employee_code, amount, state)
                             VALUES (?, 'plant', 4, 2026, 'L001', 1, 'deducted')`).run(loanId)).toThrow(/CHECK/);
  });

  test('origin is free text (no CHECK)', () => {
    const id = addInstalment(db, loanId, 1, 4, 2026);
    expect(() => db.prepare("UPDATE loan_instalments SET origin = 'opening_import' WHERE id = ?").run(id)).not.toThrow();
  });

  test('loan rows need a real loan (foreign key)', () => {
    expect(() => addInstalment(db, 9999, 1, 4, 2026)).toThrow(/FOREIGN KEY/);
  });

  test('loan_events is append-only', () => {
    const id = db.prepare("INSERT INTO loan_events (loan_id, event, actor) VALUES (?, 'created', 'hr1')").run(loanId).lastInsertRowid;
    expect(() => db.prepare("UPDATE loan_events SET reason = 'edited' WHERE id = ?").run(id)).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM loan_events WHERE id = ?').run(id)).toThrow(/append-only/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM loan_events').get().n).toBe(1);
  });

  test('the legacy view refuses writes', () => {
    expect(() => db.prepare(`INSERT INTO loan_repayments (loan_id, employee_code, month, year, emi_amount)
                             VALUES (?, 'L001', 4, 2026, 3000)`).run(loanId)).toThrow(/view/);
    expect(() => db.prepare("UPDATE loan_repayments SET status = 'Deducted'").run()).toThrow(/view/);
  });
});

// ── 9. Policy defaults ─────────────────────────────────────────────────────
describe('policy defaults', () => {
  test('all 16 keys + the PR-3 disbursement gate seeded with SPEC §4 values; an edited value survives a re-boot', () => {
    const db = openFile();
    boot(db);
    const rows = db.prepare("SELECT key, value FROM policy_config WHERE key LIKE 'loan%'").all();
    expect(Object.fromEntries(rows.map((r) => [r.key, r.value]))).toEqual(POLICY_DEFAULTS);

    db.prepare("UPDATE policy_config SET value = '45' WHERE key = 'loan_deduction_cap_pct'").run();
    boot(db);
    expect(db.prepare("SELECT value FROM policy_config WHERE key = 'loan_deduction_cap_pct'").get().value).toBe('45');
    db.close();
  });
});

// ── 10. Every old-table reader still runs and returns ₹0 / nothing ─────────
describe('old readers against the new schema (nothing edited in them)', () => {
  let db;
  const M = 4; const Y = 2026;
  beforeAll(() => {
    db = F.newDb();
    F.addEmployee(db, { code: 'L001', company: COMPANY });
    const loanId = addLoan(db);                        // active, with an instalment due this month
    addInstalment(db, loanId, 1, M, Y);
  });
  afterAll(() => db.close());

  test('Stage 7 getLoanDeductions SQL (salaryComputation.js L206–215) → 0', () => {
    const r = db.prepare(`
      SELECT SUM(emi_amount) as total_emi FROM loan_repayments
      WHERE employee_code = ? AND month = ? AND year = ?
      AND status = 'Pending'
    `).get('L001', M, Y);
    expect(r.total_emi || 0).toBe(0);
  });

  test('sales getLoanRecovery SQL (salesSalaryComputation.js L60–69) → 0', () => {
    const r = db.prepare(`
      SELECT COALESCE(SUM(emi_amount), 0) AS emi
        FROM loan_repayments
       WHERE employee_code = ? AND month = ? AND year = ? AND status = 'Pending'
    `).get('L001', M, Y);
    expect(r.emi).toBe(0);
  });

  // Loans PR-3: loanService.js is deleted and routes/loans.js, the portal and the Salary
  // Explainer read the new tables (their queries are covered over HTTP in loansApi.test.js).
  test('portal and Salary Explainer SQL run on the new tables (employeePortal.js, ai.js — Loans PR-3)', () => {
    expect(() => db.prepare(`SELECT id, loan_type, status FROM loans
      WHERE employee_code = ? AND borrower_type = 'plant' AND status != 'rejected' ORDER BY requested_at DESC, id DESC`).all('L001')).not.toThrow();
    const ai = db.prepare(`
      SELECT l.*,
        (SELECT SUM(amount) FROM loan_deductions
          WHERE loan_id = l.id AND month = ? AND year = ? AND state IN ('provisional', 'posted')) AS emi_this_month
      FROM loans l
      WHERE l.employee_code = ? AND l.borrower_type = 'plant' AND l.status IN ('active', 'recover_at_exit')
    `).all(M, Y, 'L001');
    expect(Array.isArray(ai)).toBe(true);
  });

  test('loanService.js is gone', () => {
    expect(() => require('../services/loanService')).toThrow();
  });
});

// ── Simulation: real Stage 7 with a live loan on the books ─────────────────
describe('simulation: Stage 7 ignores loans until Loans PR-5', () => {
  const { recomputeSalary } = require('../services/recompute');
  const M = 3; const Y = 2026;
  const stage7 = (db) => F.silently(() => recomputeSalary(db, { month: M, year: Y, company: COMPANY }));
  const totals = (db) => db.prepare(`SELECT COUNT(*) AS n, ROUND(SUM(net_salary),2) AS net,
    ROUND(SUM(total_deductions),2) AS ded FROM salary_computations WHERE month = ? AND year = ?`).get(M, Y);

  function seeded(withLoan) {
    const db = F.newDb();
    for (const code of ['S001', 'S002']) {
      const emp = F.addEmployee(db, { code, company: COMPANY });
      F.addDayCalc(db, emp, M, Y, { days_present: 26, total_payable_days: 26 });
    }
    if (withLoan) {
      const loanId = addLoan(db, { employee_code: 'S001', principal_amount: 6000, emi_amount: 2000, remaining_balance: 6000 });
      addInstalment(db, loanId, 1, M, Y, 2000);
      addInstalment(db, loanId, 2, M + 1, Y, 2000);
    }
    return db;
  }

  test('loan_recovery = 0, loan rows untouched, drift and component checks clean, totals identical', () => {
    const plain = seeded(false);
    const withLoan = seeded(true);
    stage7(plain); stage7(withLoan); stage7(withLoan);              // re-run too

    const row = withLoan.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?').get('S001', M, Y);
    expect(row).toBeDefined();
    expect(row.loan_recovery).toBe(0);
    expect(withLoan.prepare('SELECT status FROM loan_instalments ORDER BY sequence').all().map((r) => r.status))
      .toEqual(['scheduled', 'scheduled']);
    expect(withLoan.prepare('SELECT remaining_balance, status FROM loans').get()).toEqual({ remaining_balance: 6000, status: 'active' });

    for (const db of [plain, withLoan]) {
      const drift = db.prepare('SELECT COUNT(*) AS n FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1').get().n;
      expect(drift).toBe(0);
      const short = db.prepare(`SELECT COUNT(*) AS n FROM salary_computations
        WHERE ABS(total_deductions - (COALESCE(pf_employee,0) + COALESCE(esi_employee,0)
          + COALESCE(professional_tax,0) + COALESCE(tds,0) + COALESCE(advance_recovery,0)
          + COALESCE(lop_deduction,0) + COALESCE(other_deductions,0) + COALESCE(loan_recovery,0)
          + COALESCE(late_coming_deduction,0) + COALESCE(early_exit_deduction,0))) > 1`).get().n;
      expect(short).toBe(0);
    }
    expect(totals(withLoan)).toEqual(totals(plain));
    expect(totals(plain).n).toBe(2);
    plain.close(); withLoan.close();
  });
});

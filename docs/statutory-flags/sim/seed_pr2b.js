// PR-2b (sales LWF) seed — THROWAWAY DB ONLY (DATA_DIR from argv[2], backend dir argv[3]).
// Synthetic codes, no real names / numbers. A small mirror of the sales payroll around T5 (10 Oct 2026):
//   F01–F06  on the LWF list with pay (F02 also ESI via the file; F04 put on hold before the NEFT export;
//            F05 NEFT-exported then moved to paid; F06 has a ₹10,000 / 3 loan disbursed 5 Aug → EMIs Sep–Nov)
//   Z01      on the LWF list, 0 days given in September and October (no holiday) → row saved, gross 0, LWF 0
//   Z02      on the LWF list, zero-gross structure → excluded every month (no row)
//   U01–U03  not on the LWF list (U01 ESI Y via the file, U02 not in the file, U03 in the file unchanged, on hold)
// Active matched uploads (seeded directly, as salesLoanFixture.setUpload does) for August, September and October.
const path = require('path');
const BACKEND = process.argv[3];
const Database = require(path.join(BACKEND, 'node_modules/better-sqlite3'));
const { initSchema } = require(path.join(BACKEND, 'src/database/schema'));
const db = new Database(path.join(process.argv[2], 'hr_system.db'));
db.pragma('journal_mode = WAL');
const q = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };
// Keep the DB purely synthetic: never load the repo's sales_master_import.sql bootstrap.
db.exec(`CREATE TABLE IF NOT EXISTS policy_config (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, value TEXT NOT NULL, description TEXT, updated_at TEXT DEFAULT (datetime('now')))`);
for (const k of ['migration_sales_master_import_v1', 'migration_sales_structures_backfill_indriyan_v1']) {
  db.prepare('INSERT OR REPLACE INTO policy_config (key, value, description) VALUES (?, ?, ?)').run(k, '1', 'sim: skip');
}
let r = q(); initSchema(db); r();

const CO = 'Indriyan Beverages Pvt Ltd';
// code, gross, days given [Aug, Sep, Oct]
const PEOPLE = [
  ['F01', 18000, [24, 24, 25]], ['F02', 19000, [26, 26, 24]], ['F03', 25000, [22, 22, 23]],
  ['F04', 15000, [20, 20, 22]], ['F05', 20000, [25, 25, 26]], ['F06', 20000, [27, 27, 27]],
  ['Z01', 16000, [10, 0, 0]], ['Z02', 0, [24, 24, 24]],
  ['U01', 17000, [25, 25, 25]], ['U02', 14000, [26, 26, 26]], ['U03', 21000, [18, 18, 18]],
];
for (const [code, gross] of PEOPLE) {
  const id = db.prepare(`INSERT INTO sales_employees (code, name, company, status, doj, gross_salary, state, designation, headquarters, bank_name, account_no, ifsc)
                         VALUES (?, 'SIM REP', ?, 'Active', '2024-01-01', ?, 'Punjab', 'SO', 'HQ', 'SIM BANK', ?, 'SIMB0000001')`)
    .run(code, CO, gross, `SIMAC${code}`).lastInsertRowid;
  db.prepare(`INSERT INTO sales_salary_structures (employee_id, effective_from, basic, hra, cca, conveyance, gross_salary,
                pf_applicable, esi_applicable, lwf_applicable, pt_applicable, created_by)
              VALUES (?, '2026-01', ?, ?, ?, ?, ?, 0, 0, 0, 0, 'sim')`).run(id, gross * 0.5, gross * 0.2, gross * 0.1, gross * 0.2, gross);
}

[[8, 0], [9, 1], [10, 2]].forEach(([month, i]) => {
  const up = db.prepare(`INSERT INTO sales_uploads (month, year, company, filename, file_hash, total_rows, matched_rows, unmatched_rows, status, uploaded_by, is_active)
                         VALUES (?, 2026, ?, ?, ?, ?, ?, 0, 'matched', 'hr', 1)`)
    .run(month, CO, `sim-${month}.xlsx`, `sim-hash-${month}`, PEOPLE.length, PEOPLE.length).lastInsertRowid;
  const ins = db.prepare(`INSERT INTO sales_monthly_input (month, year, company, upload_id, sheet_row_number, sheet_employee_name, sheet_days_given, employee_code, match_confidence, match_method)
                          VALUES (?, 2026, ?, ?, ?, 'SIM REP', ?, ?, 'exact', 'sim')`);
  PEOPLE.forEach(([code, , days], n) => ins.run(month, CO, up, n + 1, days[i], code));
});

// F06: ₹10,000 / 3 sales loan through the real engine (HR raises, admin approves, finance disburses on 5 Aug).
const L = require(path.join(BACKEND, 'src/services/loans'));
r = q();
try {
  const asOf = '2026-08-09';
  const req = L.requestLoan(db, { borrowerType: 'sales', employeeCode: 'F06', company: CO, loanType: 'Personal', principal: 10000, tenure: 3, reason: 'sim' }, { username: 'hr', role: 'hr' }, { asOf });
  if (!req.ok) throw new Error(`request ${req.code}`);
  const ap = L.approveLoan(db, req.loanId, { username: 'admin', role: 'admin' }, { asOf });
  if (!ap.ok) throw new Error(`approve ${ap.code}`);
  const d = L.disburseLoan(db, req.loanId, { username: 'finance', role: 'finance' }, { mode: 'NEFT', reference: 'SIM-UTR', disbursedOn: '2026-08-05', agreementFilePath: 'agreements/sim.pdf' }, { asOf });
  if (!d.ok) throw new Error(`disburse ${d.code}`);
} finally { r(); }
db.close();
console.log(JSON.stringify({ ok: true, sales: PEOPLE.length, loans: 1 }));

// PR-3 (filing) seed — THROWAWAY DB ONLY (DATA_DIR from argv[2], backend dir argv[3]).
// Synthetic codes / names / numbers only. October 2026, the first month filed from the app:
//   plant (company A unless noted; flags come from the real statutory upload in run_pr3.py):
//     P01 PF + ESI + LWF, valid UAN + ESI no.   P02 PF + LWF, valid UAN        P03 PF, no UAN
//     P04 PF, 11-digit legacy UAN (set here)    P05 ESI + LWF, valid ESI no.   P06 ESI, no ESI no.
//     P07 LWF, ₹40,000 advance → deductions cap (M2)                         P08 nothing
//     B01 (company B) ESI + LWF, valid ESI no.
//   sales (company A): S01 ESI + LWF (number)  S02 ESI, no number (HR fixes it)  S03 ESI, 0 days given
//                      S04 nothing             S05 ESI (number), put on hold
//   users: viewer1 (viewer) besides the admin / hr / finance users server.js seeds.
const path = require('path');
const BACKEND = process.argv[3];
const Database = require(path.join(BACKEND, 'node_modules/better-sqlite3'));
const bcrypt = require(path.join(BACKEND, 'node_modules/bcryptjs'));
const { initSchema } = require(path.join(BACKEND, 'src/database/schema'));
const db = new Database(path.join(process.argv[2], 'hr_system.db'));
db.pragma('journal_mode = WAL');
const q = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };
// Keep the DB purely synthetic: never load the repo's sales_master_import.sql bootstrap.
db.exec(`CREATE TABLE IF NOT EXISTS policy_config (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, value TEXT NOT NULL, description TEXT, updated_at TEXT DEFAULT (datetime('now')))`);
for (const k of ['migration_sales_master_import_v1', 'migration_sales_structures_backfill_indriyan_v1']) {
  db.prepare('INSERT OR REPLACE INTO policy_config (key, value, description) VALUES (?, ?, ?)').run(k, '1', 'sim: skip');
}
const r = q(); initSchema(db); r();

const A = 'Indriyan Beverages Pvt Ltd';
const B = 'Asian Lakto Ind Ltd';
const PLANT = [['P01', A, 15000], ['P02', A, 18000], ['P03', A, 16000], ['P04', A, 14000], ['P05', A, 13000], ['P06', A, 12000],
  ['P07', A, 15000], ['P08', A, 17000], ['B01', B, 14500]];
for (const [code, co, gross] of PLANT) {
  db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, gross_salary, account_number, ifsc_code, bank_name)
              VALUES (?, ?, 'PRODUCTION', ?, 'Permanent', 'Active', '2024-01-01', ?, ?, 'SIMB0000001', 'SIM BANK')`).run(code, `Sim Plant ${code}`, co, gross, `SIMAC${code}`);
  const id = db.prepare('SELECT id FROM employees WHERE code = ?').get(code).id;
  db.prepare(`INSERT INTO salary_structures (employee_id, effective_from, gross_salary, basic, da, hra, conveyance, other_allowances,
                basic_percent, hra_percent, pf_applicable, esi_applicable, lwf_applicable, pt_applicable, pf_wage_ceiling)
              VALUES (?, '2025-01-01', ?, ?, 0, ?, 0, ?, 50, 20, 0, 0, 0, 0, 15000)`).run(id, gross, gross * 0.5, gross * 0.2, gross * 0.3);
}
db.prepare("UPDATE employees SET uan = '10000000304' WHERE code = 'P04'").run();               // legacy 11-digit UAN
db.prepare("INSERT INTO salary_advances (employee_code, month, year, advance_amount, paid) VALUES ('P07', 10, 2026, 40000, 1)").run();

for (const co of [A, B]) {
  db.prepare(`INSERT INTO monthly_imports (month, year, company, file_name, status, stage_1_done) VALUES (10, 2026, ?, 'sim.xls', 'imported', 1)`).run(co);
}
const ins = db.prepare(`INSERT INTO attendance_processed (employee_code, date, month, year, company, status_original, status_final, in_time_original, out_time_original, is_night_out_only, is_miss_punch)
                        VALUES (?, ?, 10, 2026, ?, ?, ?, '08:00', '18:00', 0, 0)`);
for (const [code, co] of PLANT) {
  for (let d = 1; d <= 31; d++) {
    const date = `2026-10-${String(d).padStart(2, '0')}`;
    const st = new Date(`${date}T12:00:00Z`).getUTCDay() === 0 ? 'WO' : 'P';
    ins.run(code, date, co, st, st);
  }
}

// sales: code, gross, days given in the October cycle (26 Sep – 25 Oct)
const SALES = [['S01', 18000, 24], ['S02', 17000, 25], ['S03', 16000, 0], ['S04', 19000, 26], ['S05', 15000, 22]];
for (const [code, gross] of SALES) {
  const id = db.prepare(`INSERT INTO sales_employees (code, name, company, status, doj, gross_salary, state, designation, headquarters, bank_name, account_no, ifsc)
                         VALUES (?, ?, ?, 'Active', '2024-01-01', ?, 'Punjab', 'SO', 'HQ', 'SIM BANK', ?, 'SIMB0000001')`)
    .run(code, `Sim Sales ${code}`, A, gross, `SIMAC${code}`).lastInsertRowid;
  db.prepare(`INSERT INTO sales_salary_structures (employee_id, effective_from, basic, hra, cca, conveyance, gross_salary,
                pf_applicable, esi_applicable, lwf_applicable, pt_applicable, created_by)
              VALUES (?, '2026-01', ?, ?, ?, ?, ?, 0, 0, 0, 0, 'sim')`).run(id, gross * 0.5, gross * 0.2, gross * 0.1, gross * 0.2, gross);
}
const up = db.prepare(`INSERT INTO sales_uploads (month, year, company, filename, file_hash, total_rows, matched_rows, unmatched_rows, status, uploaded_by, is_active)
                       VALUES (10, 2026, ?, 'sim-10.xlsx', 'sim-hash-10', ?, ?, 0, 'matched', 'hr', 1)`).run(A, SALES.length, SALES.length).lastInsertRowid;
const insIn = db.prepare(`INSERT INTO sales_monthly_input (month, year, company, upload_id, sheet_row_number, sheet_employee_name, sheet_days_given, employee_code, match_confidence, match_method)
                          VALUES (10, 2026, ?, ?, ?, 'SIM REP', ?, ?, 'exact', 'sim')`);
SALES.forEach(([code, , days], n) => insIn.run(A, up, n + 1, days, code));

db.prepare(`INSERT INTO users (username, password_hash, role, is_active) VALUES ('viewer1', ?, 'viewer', 1)`).run(bcrypt.hashSync('SimView#1', 10));
db.close();
console.log(JSON.stringify({ ok: true, plant: PLANT.length, sales: SALES.length }));

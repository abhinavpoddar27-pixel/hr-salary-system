// Phase 3 seed — throwaway DB only (DATA_DIR from argv[2]). Synthetic codes, no real names / numbers.
// Plant: 7 synthetic employees across the shapes the plan cares about; attendance Aug + Sep 2026.
// Sales: 3 synthetic employees + an Aug and Sep confirmed upload.
const path = require('path');
const BACKEND = process.argv[3];
const Database = require(path.join(BACKEND, 'node_modules/better-sqlite3'));
const { initSchema } = require(path.join(BACKEND, 'src/database/schema'));
const db = new Database(path.join(process.argv[2], 'hr_system.db'));
db.pragma('journal_mode = WAL');
const q = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };
// Keep the throwaway DB purely synthetic: mark the bootstrap sales-master import and the
// Indriyan backfill as done so initSchema never loads the repo's sales_master_import.sql.
db.exec(`CREATE TABLE IF NOT EXISTS policy_config (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, value TEXT NOT NULL, description TEXT, updated_at TEXT DEFAULT (datetime('now')))`);
for (const k of ['migration_sales_master_import_v1', 'migration_sales_structures_backfill_indriyan_v1']) {
  db.prepare('INSERT OR REPLACE INTO policy_config (key, value, description) VALUES (?, ?, ?)').run(k, '1', 'sim: skip');
}
let r = q(); initSchema(db); r();
if (db.prepare('SELECT COUNT(*) c FROM sales_employees').get().c !== 0) throw new Error('non-synthetic sales rows present');

const CO = 'Indriyan Beverages Pvt Ltd';
const emp = (code, gross, extra = {}) => {
  db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, gross_salary)
              VALUES (?, 'SIM EMP', 'PRODUCTION', ?, 'Permanent', 'Active', '2024-01-01', ?)`).run(code, CO, gross);
  const id = db.prepare('SELECT id FROM employees WHERE code = ?').get(code).id;
  if (extra.flags) db.prepare('UPDATE employees SET pf_applicable = ?, esi_applicable = ?, lwf_applicable = ? WHERE id = ?').run(...extra.flags, id);
  return id;
};
const struct = (id, from, gross, flags = [0, 0, 0]) => db.prepare(`
  INSERT INTO salary_structures (employee_id, effective_from, gross_salary, basic, da, hra, conveyance, other_allowances,
    basic_percent, hra_percent, pf_applicable, esi_applicable, lwf_applicable, pt_applicable, pf_wage_ceiling)
  VALUES (?, ?, ?, ?, 0, ?, 0, ?, 50, 20, ?, ?, ?, 0, 15000)`).run(id, from, gross, gross * 0.5, gross * 0.2, gross * 0.3, ...flags);

// SIM01 plain 2025 row; SIM02 only a 2026-09-06 row (fallback-served Aug); SIM03 April + 2026-10-15;
// SIM04 zero-gross (no Sep attendance → zero-gross / not paid); SIM05 held (big month-end absence);
// SIM06 unchanged by the file (already ESI/LWF on); SIM07 not in the file at all (control).
const ids = {
  SIM01: emp('SIM01', 15000), SIM02: emp('SIM02', 14000), SIM03: emp('SIM03', 18000),
  SIM04: emp('SIM04', 0), SIM05: emp('SIM05', 12000), SIM06: emp('SIM06', 13000, { flags: [0, 1, 1] }), SIM07: emp('SIM07', 16000),
};
struct(ids.SIM01, '2025-01-01', 15000);
struct(ids.SIM02, '2026-09-06', 14000);
struct(ids.SIM03, '2026-04-22', 18000); struct(ids.SIM03, '2026-10-15', 19000);
struct(ids.SIM05, '2025-01-01', 12000);
struct(ids.SIM06, '2025-01-01', 13000, [0, 1, 1]);
struct(ids.SIM07, '2025-01-01', 16000);

for (const [m, y] of [[8, 2026], [9, 2026]]) {
  db.prepare(`INSERT INTO monthly_imports (month, year, company, file_name, status, stage_1_done) VALUES (?, ?, ?, 'sim.xls', 'imported', 1)`).run(m, y, CO);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ins = db.prepare(`INSERT INTO attendance_processed (employee_code, date, month, year, company, status_original, status_final, in_time_original, out_time_original, is_night_out_only, is_miss_punch)
                          VALUES (?, ?, ?, ?, ?, ?, ?, '08:00', '18:00', 0, 0)`);
  for (const code of Object.keys(ids)) {
    if (code === 'SIM04' && m === 9) continue; // zero attendance in Sep
    for (let d = 1; d <= days; d++) {
      const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
      let st = dow === 0 ? 'WO' : 'P';
      if (code === 'SIM05' && m === 9 && d > days - 9) st = 'A'; // 9 absent days at month-end → held
      ins.run(code, date, m, y, CO, st, st);
    }
  }
}

// Sales
const sales = (code, gross) => {
  db.prepare(`INSERT INTO sales_employees (code, name, company, status, doj, gross_salary, state, bank_name, account_no, ifsc)
              VALUES (?, 'SIM SALES', ?, 'Active', '2025-01-01', ?, 'Punjab', 'B', '000', 'X')`).run(code, CO, gross);
  return db.prepare('SELECT id FROM sales_employees WHERE code = ? AND company = ?').get(code, CO).id;
};
const sstruct = (id, from, gross, to = null) => db.prepare(`INSERT INTO sales_salary_structures (employee_id, effective_from, effective_to, basic, hra, cca, conveyance, gross_salary, pf_applicable, esi_applicable, pt_applicable, lwf_applicable, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 'sim')`).run(id, from, to, gross * 0.5, gross * 0.2, gross * 0.1, gross * 0.2, gross);
const s1 = sales('SIMS1', 18000); sstruct(s1, '2025-01', 18000);
const s2 = sales('SIMS2', 17000); sstruct(s2, '2026-01', 17000, '2026-09'); sstruct(s2, '2026-10', 17500); // S157 shape
const s3 = sales('SIMS3', 16000); sstruct(s3, '2026-09', 16000);                                          // exact E row
for (const [m, y] of [[8, 2026], [9, 2026]]) {
  const up = db.prepare(`INSERT INTO sales_uploads (month, year, company, filename, file_hash, status, total_rows, matched_rows, unmatched_rows, uploaded_by, is_active)
                         VALUES (?, ?, ?, 'sim.xlsx', ?, 'matched', 3, 3, 0, 'sim', 1)`).run(m, y, CO, `h${m}`).lastInsertRowid;
  for (const c of ['SIMS1', 'SIMS2', 'SIMS3']) {
    db.prepare(`INSERT INTO sales_monthly_input (upload_id, month, year, company, sheet_row_number, sheet_employee_name, sheet_days_given, employee_code, match_confidence, match_method)
                VALUES (?, ?, ?, ?, 1, 'SIM SALES', 24, ?, 'exact', 'punch_no')`).run(up, m, y, CO, c);
  }
}
db.close();
console.log(JSON.stringify({ ok: true, plant: Object.keys(ids).length, sales: 3 }));

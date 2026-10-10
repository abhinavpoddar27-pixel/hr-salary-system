// PR-2 (plant LWF) seed — THROWAWAY DB ONLY (DATA_DIR from argv[2], backend dir argv[3]).
// Synthetic codes, no real names / numbers. A small mirror of today's plant September run:
//   F01–F08  on the LWF list with pay (F04/F05 also PF+ESI, F07 contractor, F08 held by month-end absence)
//   Z01      on the LWF list, zero gross (structure gross 0, attendance present) → row saved, LWF 0
//   Z02      on the LWF list, no September attendance → no salary row at all
//   U01–U05  not on the LWF list (U01/U02 PF+ESI Y via the file, U03 not in the file, U04 contractor, U05 held)
// August and September attendance for everyone (Z02 August only).
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
const r = q(); initSchema(db); r();

const CO = 'Indriyan Beverages Pvt Ltd';
const PEOPLE = [
  ['F01', 12000, 'Permanent'], ['F02', 14000, 'Permanent'], ['F03', 16000, 'Permanent'], ['F04', 15000, 'Permanent'],
  ['F05', 20000, 'Permanent'], ['F06', 18000, 'Permanent'], ['F07', 13000, 'Contract'], ['F08', 12500, 'Permanent'],
  ['Z01', 0, 'Permanent'], ['Z02', 15000, 'Permanent'],
  ['U01', 15000, 'Permanent'], ['U02', 19000, 'Permanent'], ['U03', 17000, 'Permanent'], ['U04', 13500, 'Contract'], ['U05', 12000, 'Permanent'],
];
for (const [code, gross, type] of PEOPLE) {
  db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, gross_salary)
              VALUES (?, 'SIM EMP', 'PRODUCTION', ?, ?, 'Active', '2024-01-01', ?)`).run(code, CO, type, gross);
  const id = db.prepare('SELECT id FROM employees WHERE code = ?').get(code).id;
  db.prepare(`INSERT INTO salary_structures (employee_id, effective_from, gross_salary, basic, da, hra, conveyance, other_allowances,
                basic_percent, hra_percent, pf_applicable, esi_applicable, lwf_applicable, pt_applicable, pf_wage_ceiling)
              VALUES (?, '2025-01-01', ?, ?, 0, ?, 0, ?, 50, 20, 0, 0, 0, 0, 15000)`).run(id, gross, gross * 0.5, gross * 0.2, gross * 0.3);
}

for (const [m, y] of [[8, 2026], [9, 2026]]) {
  db.prepare(`INSERT INTO monthly_imports (month, year, company, file_name, status, stage_1_done) VALUES (?, ?, ?, 'sim.xls', 'imported', 1)`).run(m, y, CO);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ins = db.prepare(`INSERT INTO attendance_processed (employee_code, date, month, year, company, status_original, status_final, in_time_original, out_time_original, is_night_out_only, is_miss_punch)
                          VALUES (?, ?, ?, ?, ?, ?, ?, '08:00', '18:00', 0, 0)`);
  for (const [code] of PEOPLE) {
    if (code === 'Z02' && m === 9) continue; // no September attendance
    for (let d = 1; d <= days; d++) {
      const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
      let st = dow === 0 ? 'WO' : 'P';
      if ((code === 'F08' || code === 'U05') && m === 9 && d > days - 9) st = 'A'; // month-end absence → held
      ins.run(code, date, m, y, CO, st, st);
    }
  }
}
db.close();
console.log(JSON.stringify({ ok: true, plant: PEOPLE.length }));

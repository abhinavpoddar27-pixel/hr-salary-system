const Database = require('better-sqlite3');
const path = require('path');
const { initSchema } = require('./schema');

let db;

function getDb() {
  if (!db) {
    const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../../data');
    const dbPath = path.join(dataDir, 'hr_system.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
      // Conservative settings for Railway (limited memory)
      db.pragma('cache_size = -8000');     // 8MB cache
      db.pragma('temp_store = MEMORY');
      db.pragma('mmap_size = 67108864');   // 64MB memory-mapped I/O
    } else {
      db.pragma('cache_size = -64000');    // 64MB cache
      db.pragma('temp_store = MEMORY');
      db.pragma('mmap_size = 268435456');  // 256MB memory-mapped I/O
    }
    initSchema(db);

    // Performance indexes (idempotent)
    try {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_employees_code ON employees(code);
        CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);
        CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
        CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company);
        CREATE INDEX IF NOT EXISTS idx_salary_structures_employee ON salary_structures(employee_id);
        CREATE INDEX IF NOT EXISTS idx_attendance_processed_employee ON attendance_processed(employee_code, month, year);
        CREATE INDEX IF NOT EXISTS idx_attendance_processed_month ON attendance_processed(month, year, company);
        CREATE INDEX IF NOT EXISTS idx_attendance_raw_import ON attendance_raw(import_id);
        CREATE INDEX IF NOT EXISTS idx_leave_balances_employee ON leave_balances(employee_id, year);
        CREATE INDEX IF NOT EXISTS idx_night_shift_pairs_month ON night_shift_pairs(month, year, company);
        CREATE INDEX IF NOT EXISTS idx_day_calculations_employee ON day_calculations(employee_code, month, year);
        CREATE INDEX IF NOT EXISTS idx_audit_log_table ON audit_log(table_name, record_id);
      `);
    } catch (e) { /* indexes may already exist or tables don't exist yet */ }
  }
  return db;
}

function logAudit(tableName, recordId, fieldName, oldValue, newValue, stage, remark) {
  try {
    const database = getDb();
    database.prepare(`
      INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, stage, remark)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(tableName, recordId, fieldName, String(oldValue ?? ''), String(newValue ?? ''), stage, remark);
  } catch (e) {
    console.error('Audit log error:', e.message);
  }
}

module.exports = { getDb, logAudit };

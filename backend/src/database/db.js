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
    initSchema(db);
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

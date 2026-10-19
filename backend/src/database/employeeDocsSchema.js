/**
 * Employee documents soft delete (G3). Adds two nullable columns to
 * employee_documents so a removed document keeps its row and its file:
 *   deleted_at TEXT  — when it was removed (NULL = live)
 *   deleted_by TEXT  — who removed it
 * Additive only, no data change. Called lazily from the document routes
 * (schema.js is not edited); runs its PRAGMA once per database handle.
 */
const done = new WeakSet();

function ensureEmployeeDocsSoftDelete(db) {
  if (done.has(db)) return;
  const cols = new Set(db.prepare('PRAGMA table_info(employee_documents)').all().map(c => c.name));
  if (!cols.has('deleted_at')) db.exec('ALTER TABLE employee_documents ADD COLUMN deleted_at TEXT');
  if (!cols.has('deleted_by')) db.exec('ALTER TABLE employee_documents ADD COLUMN deleted_by TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_employee_documents_code_live ON employee_documents(employee_code, deleted_at)');
  done.add(db);
}

module.exports = { ensureEmployeeDocsSoftDelete };

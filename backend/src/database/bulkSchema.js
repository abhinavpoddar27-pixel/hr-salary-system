/**
 * Bulk entry engine tables (P3-01). Generic: one batch per save of ≤ 50 rows,
 * one bulk_rows line per input row with its plan, before-image and after-image
 * so a batch can be undone. CREATE … IF NOT EXISTS only — safe on every boot.
 * Called once from the end of initSchema().
 */
function initBulkSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bulk_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      company TEXT,
      month INTEGER,
      year INTEGER,
      source TEXT NOT NULL DEFAULT 'form',
      status TEXT NOT NULL DEFAULT 'applied'
        CHECK (status IN ('draft','submitted','approved','applied','rejected','returned','undone')),
      plan_hash TEXT,
      row_count INTEGER NOT NULL DEFAULT 0,
      ok_count INTEGER NOT NULL DEFAULT 0,
      warn_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      common_json TEXT,
      options_json TEXT,
      group_id TEXT,
      group_index INTEGER,
      group_size INTEGER,
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      applied_at TEXT,
      undone_by TEXT,
      undone_at TEXT,
      undo_reason TEXT,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS bulk_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES bulk_batches(id),
      row_no INTEGER NOT NULL,
      row_key TEXT NOT NULL,
      input_json TEXT,
      resolved_json TEXT,
      state TEXT NOT NULL CHECK (state IN ('ok','warning','error','skipped')),
      action TEXT NOT NULL CHECK (action IN ('create','update','noop','conflict')),
      messages_json TEXT,
      before_json TEXT,
      after_json TEXT,
      target_table TEXT,
      target_id INTEGER,
      undone INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_bulk_batches_kind_created ON bulk_batches(kind, created_at);
    CREATE INDEX IF NOT EXISTS idx_bulk_batches_status ON bulk_batches(status);
    CREATE INDEX IF NOT EXISTS idx_bulk_batches_group ON bulk_batches(group_id);
    CREATE INDEX IF NOT EXISTS idx_bulk_rows_batch ON bulk_rows(batch_id, row_no);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bulk_rows_key ON bulk_rows(batch_id, row_key);
  `);
}

module.exports = { initBulkSchema };

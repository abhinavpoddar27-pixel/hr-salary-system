/**
 * protectedWrite() — Phase 2a foundation for the HR System Hardening plan.
 *
 * Library function. NOT mounted as a route, NOT registered as a cron, NOT
 * yet called by any production code. Only callers in this PR are unit tests.
 * Phase 2b will migrate the first salary-pipeline write call site onto it.
 *
 * Every call appends exactly one row to `protected_writes` (success, abort,
 * or error) — see Phase 2a entry in CLAUDE.md and the schema block in
 * backend/src/database/schema.js.
 *
 * Defences this function provides:
 *   - UPSERT_COLUMN_MISMATCH: setColumns must equal rows[0] keys minus
 *     conflictKey. This is the structural defence against the Stage 7
 *     doubling root cause (INSERT and UPDATE column lists drifting apart).
 *   - Idempotency: same idempotencyKey within window → second call returns
 *     status='aborted_idempotent' and the underlying SQL does not run.
 *   - Threshold: update/delete affecting >largeChangeThreshold (default 50)
 *     requires forceLargeChange=true.
 *   - Payroll-table delete defence-in-depth: forceLargeChange=true required
 *     for ANY delete on a payroll table regardless of row count.
 *   - Caller-supplied invariants run before the write; first failure aborts.
 *   - Atomic transaction: any throw inside the write body rolls back fully.
 *
 * Phase 3 will fill in the snapshotBeforeWrite() stub.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

// ── Constants ────────────────────────────────────────────────────────────────

const VALID_OPERATIONS = new Set(['insert', 'update', 'delete', 'upsert']);

// Hardcoded list of tables where DELETE requires forceLargeChange=true even
// for a single row (defence-in-depth on top of the allowDelete gate). This
// mirrors the design doc's payroll set; do not narrow without review.
const PAYROLL_TABLES = new Set([
  'salary_computations',
  'day_calculations',
  'attendance_processed',
  'salary_structures',
  'leave_balances',
  'leave_transactions',
  'salary_manual_flags',
  'finance_approvals',
  'sales_ta_da_computations',
]);

const ALLOWED_OPT_KEYS = new Set([
  'table', 'operation', 'scope', 'rows', 'where', 'conflictKey', 'setColumns',
  'invariants', 'idempotencyKey', 'idempotencyWindowMinutes', 'forceLargeChange',
  'largeChangeThreshold', 'allowDelete', 'triggeredBy', 'reason', 'dryRun',
]);

// Per-DB cached PRAGMA table_info results. Keyed by db handle so multiple
// in-memory DBs in tests stay isolated.
const tableMetaCache = new WeakMap();

// ── Helpers ──────────────────────────────────────────────────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function quoteIdent(name) {
  if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

function setEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function getTableMeta(db, tableName) {
  let perDb = tableMetaCache.get(db);
  if (!perDb) {
    perDb = new Map();
    tableMetaCache.set(db, perDb);
  }
  if (perDb.has(tableName)) return perDb.get(tableName);
  // PRAGMA does not accept ? bindings for the table name. quoteIdent has
  // already validated `tableName` against /^[A-Za-z_][A-Za-z0-9_]*$/.
  const rows = db.prepare(`PRAGMA table_info(${quoteIdent(tableName)})`).all();
  const meta = { exists: rows.length > 0, columns: rows.map((r) => r.name) };
  perDb.set(tableName, meta);
  return meta;
}

function snapshotBeforeWrite(_db, _opts) {
  // Phase 2a stub — no-op. Phase 3 will implement actual snapshotting into
  // the (yet-to-exist) pipeline_snapshots table. Do not move this log line
  // without updating T28 in the test suite.
  console.log('[protectedWrite] snapshot stub — Phase 3 will implement');
  return null;
}

function writeAudit(db, row) {
  db.prepare(`
    INSERT INTO protected_writes (
      operation_id, idempotency_key, table_name, operation, scope_json,
      row_count, dry_run, forced_large_change, status, aborted_reason,
      triggered_by, reason, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.operation_id,
    row.idempotency_key || null,
    row.table_name,
    row.operation,
    row.scope_json || null,
    row.row_count,
    row.dry_run ? 1 : 0,
    row.forced_large_change ? 1 : 0,
    row.status,
    row.aborted_reason || null,
    row.triggered_by || null,
    row.reason || null,
    row.duration_ms ?? null
  );
}

// ── Validation (no DB access yet) ────────────────────────────────────────────

function validate(opts) {
  if (!isPlainObject(opts)) return 'opts must be a plain object';
  for (const k of Object.keys(opts)) {
    if (!ALLOWED_OPT_KEYS.has(k)) return `Unknown opt key: ${k}`;
  }
  if (typeof opts.table !== 'string' || !opts.table) return 'table is required';
  if (!VALID_OPERATIONS.has(opts.operation)) {
    return `operation must be one of: ${[...VALID_OPERATIONS].join(', ')}`;
  }
  switch (opts.operation) {
    case 'insert':
      if (!Array.isArray(opts.rows) || opts.rows.length === 0) {
        return 'insert requires non-empty rows[]';
      }
      break;
    case 'update':
      if (!Array.isArray(opts.rows) || opts.rows.length !== 1) {
        return 'update requires rows[] with exactly one element (the SET map)';
      }
      if (!opts.where || typeof opts.where.sql !== 'string') {
        return 'update requires where: { sql, params }';
      }
      break;
    case 'delete':
      if (opts.allowDelete !== true) return 'delete requires allowDelete: true';
      if (!opts.where || typeof opts.where.sql !== 'string') {
        return 'delete requires where: { sql, params }';
      }
      break;
    case 'upsert':
      if (!Array.isArray(opts.rows) || opts.rows.length === 0) {
        return 'upsert requires non-empty rows[]';
      }
      if (!Array.isArray(opts.conflictKey) || opts.conflictKey.length === 0) {
        return 'upsert requires conflictKey[]';
      }
      if (!Array.isArray(opts.setColumns) || opts.setColumns.length === 0) {
        return 'upsert requires setColumns[]';
      }
      break;
  }
  if (opts.operation === 'insert' || opts.operation === 'upsert') {
    const sig = JSON.stringify(Object.keys(opts.rows[0]).sort());
    for (let i = 1; i < opts.rows.length; i++) {
      if (JSON.stringify(Object.keys(opts.rows[i]).sort()) !== sig) {
        return `rows[${i}] has different keys than rows[0]`;
      }
    }
  }
  return null;
}

function validateColumns(opts, allowedColumns) {
  const tableName = opts.table;
  const checkCol = (c, label) => {
    if (!allowedColumns.has(c)) {
      throw new Error(`protectedWrite validation: ${label} "${c}" not in table ${tableName}`);
    }
  };
  if (opts.operation === 'insert' || opts.operation === 'update' || opts.operation === 'upsert') {
    for (const k of Object.keys(opts.rows[0])) checkCol(k, 'column');
  }
  if (opts.operation === 'upsert') {
    for (const c of opts.conflictKey) checkCol(c, 'conflictKey column');
    for (const c of opts.setColumns) checkCol(c, 'setColumns column');
  }
}

// ── Idempotency check ───────────────────────────────────────────────────────

function checkIdempotency(db, opts) {
  if (!opts.idempotencyKey) return null;
  const window = Number.isFinite(opts.idempotencyWindowMinutes)
    ? opts.idempotencyWindowMinutes : 60;
  const row = db.prepare(`
    SELECT operation_id FROM protected_writes
    WHERE idempotency_key = ?
      AND status = 'success'
      AND executed_at >= datetime('now', ?)
    ORDER BY id DESC LIMIT 1
  `).get(opts.idempotencyKey, `-${window} minutes`);
  return row ? row.operation_id : null;
}

// ── Counting (threshold + dry-run) ──────────────────────────────────────────

function countMatching(db, opts) {
  const sql = `SELECT COUNT(*) AS c FROM ${quoteIdent(opts.table)} WHERE ${opts.where.sql}`;
  return db.prepare(sql).get(...(opts.where.params || [])).c;
}

function countUpsertConflicts(db, opts) {
  const tbl = quoteIdent(opts.table);
  const pred = opts.conflictKey.map((c) => `${quoteIdent(c)} = ?`).join(' AND ');
  const stmt = db.prepare(`SELECT 1 FROM ${tbl} WHERE ${pred} LIMIT 1`);
  let conflicts = 0;
  for (const row of opts.rows) {
    const params = opts.conflictKey.map((c) => row[c]);
    if (stmt.get(...params)) conflicts++;
  }
  return conflicts;
}

// ── Execution ───────────────────────────────────────────────────────────────

function executeWrite(db, opts) {
  let totalChanges = 0;
  const tx = db.transaction(() => {
    if (opts.operation === 'insert') {
      const cols = Object.keys(opts.rows[0]);
      const stmt = db.prepare(
        `INSERT INTO ${quoteIdent(opts.table)} (${cols.map(quoteIdent).join(', ')}) ` +
        `VALUES (${cols.map(() => '?').join(', ')})`
      );
      for (const row of opts.rows) {
        totalChanges += stmt.run(...cols.map((c) => row[c])).changes;
      }
    } else if (opts.operation === 'update') {
      const setCols = Object.keys(opts.rows[0]);
      const stmt = db.prepare(
        `UPDATE ${quoteIdent(opts.table)} SET ` +
        `${setCols.map((c) => `${quoteIdent(c)} = ?`).join(', ')} ` +
        `WHERE ${opts.where.sql}`
      );
      const setParams = setCols.map((c) => opts.rows[0][c]);
      totalChanges += stmt.run(...setParams, ...(opts.where.params || [])).changes;
    } else if (opts.operation === 'delete') {
      const stmt = db.prepare(`DELETE FROM ${quoteIdent(opts.table)} WHERE ${opts.where.sql}`);
      totalChanges += stmt.run(...(opts.where.params || [])).changes;
    } else if (opts.operation === 'upsert') {
      const cols = Object.keys(opts.rows[0]);
      const stmt = db.prepare(
        `INSERT INTO ${quoteIdent(opts.table)} (${cols.map(quoteIdent).join(', ')}) ` +
        `VALUES (${cols.map(() => '?').join(', ')}) ` +
        `ON CONFLICT (${opts.conflictKey.map(quoteIdent).join(', ')}) DO UPDATE SET ` +
        `${opts.setColumns.map((c) => `${quoteIdent(c)} = excluded.${quoteIdent(c)}`).join(', ')}`
      );
      for (const row of opts.rows) {
        totalChanges += stmt.run(...cols.map((c) => row[c])).changes;
      }
    }
  });
  tx();
  return { changes: totalChanges };
}

// ── Main entry ──────────────────────────────────────────────────────────────

async function protectedWrite(db, opts) {
  const t0 = Date.now();
  const operation_id = uuidv4();

  // 1. Validate inputs (no DB access yet — programmer errors throw).
  const validationErr = validate(opts);
  if (validationErr) throw new Error(`protectedWrite validation: ${validationErr}`);

  // 2. Resolve table metadata. Unknown table → throw.
  const meta = getTableMeta(db, opts.table);
  if (!meta.exists) {
    throw new Error(`protectedWrite validation: table "${opts.table}" does not exist`);
  }
  const allowedColumns = new Set(meta.columns);
  validateColumns(opts, allowedColumns);

  // Common audit-row prefix used by every exit path.
  const baseAudit = {
    operation_id,
    idempotency_key: opts.idempotencyKey,
    table_name: opts.table,
    operation: opts.operation,
    scope_json: opts.scope ? JSON.stringify(opts.scope) : null,
    triggered_by: opts.triggeredBy,
    reason: opts.reason,
  };

  // 4. Idempotency check.
  const existingOpId = checkIdempotency(db, opts);
  if (existingOpId) {
    const reason = `IDEMPOTENT_HIT: prior operation ${existingOpId}`;
    writeAudit(db, {
      ...baseAudit, row_count: 0, status: 'aborted_idempotent',
      aborted_reason: reason, duration_ms: Date.now() - t0,
    });
    return { operation_id, status: 'aborted_idempotent', row_count: 0,
             duration_ms: Date.now() - t0, reason };
  }

  // 5. UPSERT INSERT-list vs UPDATE SET-list alignment — the Stage 7
  //    doubling defence. setColumns must equal rows[0] keys minus conflictKey.
  if (opts.operation === 'upsert') {
    const rowKeys = new Set(Object.keys(opts.rows[0]));
    const conflictSet = new Set(opts.conflictKey);
    const expected = new Set([...rowKeys].filter((k) => !conflictSet.has(k)));
    const actual = new Set(opts.setColumns);
    if (!setEqual(expected, actual)) {
      const reason = 'UPSERT_COLUMN_MISMATCH: INSERT and UPDATE SET column lists must match exactly';
      writeAudit(db, {
        ...baseAudit, row_count: 0, status: 'aborted_invariant',
        aborted_reason: reason, duration_ms: Date.now() - t0,
      });
      return { operation_id, status: 'aborted_invariant', row_count: 0,
               duration_ms: Date.now() - t0, reason };
    }
  }

  // 6. Pre-write invariants. First failing one short-circuits.
  if (Array.isArray(opts.invariants)) {
    for (const inv of opts.invariants) {
      let result;
      try {
        result = inv(opts.rows, db, opts);
      } catch (e) {
        writeAudit(db, {
          ...baseAudit, row_count: 0, status: 'error',
          aborted_reason: e.message, duration_ms: Date.now() - t0,
        });
        throw e;
      }
      if (result !== true) {
        const reason = typeof result === 'string' ? result : 'invariant returned non-true';
        writeAudit(db, {
          ...baseAudit, row_count: 0, status: 'aborted_invariant',
          aborted_reason: reason, duration_ms: Date.now() - t0,
        });
        return { operation_id, status: 'aborted_invariant', row_count: 0,
                 duration_ms: Date.now() - t0, reason };
      }
    }
  }

  // 7. Threshold check (update/delete).
  let predictedCount = null;
  const threshold = Number.isFinite(opts.largeChangeThreshold)
    ? opts.largeChangeThreshold : 50;
  if (opts.operation === 'update' || opts.operation === 'delete') {
    predictedCount = countMatching(db, opts);
    let abortReason = null;
    if (opts.operation === 'delete' && PAYROLL_TABLES.has(opts.table) && opts.forceLargeChange !== true) {
      abortReason = `THRESHOLD_PAYROLL_DELETE: delete on payroll table ${opts.table} requires forceLargeChange=true (count=${predictedCount})`;
    } else if (predictedCount > threshold && opts.forceLargeChange !== true) {
      abortReason = `THRESHOLD_EXCEEDED: ${predictedCount} > ${threshold} requires forceLargeChange=true`;
    }
    if (abortReason) {
      writeAudit(db, {
        ...baseAudit, row_count: predictedCount, status: 'aborted_threshold',
        aborted_reason: abortReason, duration_ms: Date.now() - t0,
      });
      return { operation_id, status: 'aborted_threshold', row_count: predictedCount,
               duration_ms: Date.now() - t0, reason: abortReason };
    }
  }

  // 8. Snapshot stub for destructive operations (Phase 3 will implement).
  if (opts.operation === 'update' || opts.operation === 'delete' || opts.operation === 'upsert') {
    snapshotBeforeWrite(db, opts);
  }

  // 9. Dry-run branch — does NOT execute the write.
  if (opts.dryRun === true) {
    const out = { operation_id, status: 'dry_run', duration_ms: 0 };
    let total = 0;
    if (opts.operation === 'insert') {
      out.would_insert = opts.rows.length; total = opts.rows.length;
    } else if (opts.operation === 'update') {
      out.would_update = predictedCount; total = predictedCount;
    } else if (opts.operation === 'delete') {
      out.would_delete = predictedCount; total = predictedCount;
    } else if (opts.operation === 'upsert') {
      const conflicts = countUpsertConflicts(db, opts);
      out.would_update = conflicts;
      out.would_insert = opts.rows.length - conflicts;
      total = opts.rows.length;
    }
    writeAudit(db, {
      ...baseAudit, row_count: total, dry_run: true,
      forced_large_change: opts.forceLargeChange === true,
      status: 'success', duration_ms: Date.now() - t0,
    });
    out.row_count = total;
    out.duration_ms = Date.now() - t0;
    return out;
  }

  // 10. Execute inside a transaction. Any throw (UNIQUE violation, etc.)
  //     rolls back atomically — the audit row below is the only persistent
  //     trace, written after rollback.
  let changes;
  try {
    ({ changes } = executeWrite(db, opts));
  } catch (e) {
    writeAudit(db, {
      ...baseAudit, row_count: predictedCount ?? 0, status: 'error',
      aborted_reason: e.message, duration_ms: Date.now() - t0,
    });
    throw e;
  }

  // 11. Log success.
  writeAudit(db, {
    ...baseAudit, row_count: changes,
    forced_large_change: opts.forceLargeChange === true,
    status: 'success', duration_ms: Date.now() - t0,
  });
  return { operation_id, status: 'success', row_count: changes, duration_ms: Date.now() - t0 };
}

module.exports = { protectedWrite, PAYROLL_TABLES };

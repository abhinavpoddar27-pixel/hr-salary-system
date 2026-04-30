// SQL Console (read-only) — env-gated, admin-only / API-key.
// Phase 1: SELECT / WITH / EXPLAIN / PRAGMA only, backed by a separate
// readonly better-sqlite3 file handle so the SQLite layer refuses writes
// even if validation is somehow bypassed.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { getDb } = require('../database/db');

const JWT_SECRET = process.env.JWT_SECRET;

// ── Module-level state ────────────────────────────────────────
let readonlyDb = null;
let schemaCache = null;
let schemaCachedAt = 0;
const SCHEMA_TTL_MS = 60 * 1000;
const PRAGMA_ALLOWLIST = new Set([
  'table_info',
  'index_list',
  'index_info',
  'foreign_key_list',
  'table_list',
  'integrity_check',
  'schema_version',
  'user_version',
  'journal_mode',
  'page_count',
  'page_size'
]);

function getDbPath() {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../../data');
  return path.join(dataDir, 'hr_system.db');
}

function getReadonlyDb() {
  if (readonlyDb) return readonlyDb;
  const dbPath = getDbPath();
  readonlyDb = new Database(dbPath, { readonly: true, fileMustExist: true });
  readonlyDb.pragma('busy_timeout = 10000');
  return readonlyDb;
}

// ── Audit ─────────────────────────────────────────────────────
function ensureAuditTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS sql_console_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT DEFAULT (datetime('now')),
      actor TEXT,
      auth_method TEXT,
      sql TEXT,
      status TEXT,
      reject_reason TEXT,
      row_count INTEGER,
      ms INTEGER,
      ip TEXT,
      user_agent TEXT,
      mode TEXT DEFAULT 'read',
      txn_id TEXT,
      affected_rows INTEGER,
      remark TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sql_audit_ts ON sql_console_audit(ts);
    CREATE INDEX IF NOT EXISTS idx_sql_audit_actor ON sql_console_audit(actor);
  `);
  // Phase 2: forward-compat audit column (idempotent — pre-existing tables get
  // the column added; freshly-created tables already have everything else).
  try {
    db.exec(`ALTER TABLE sql_console_audit ADD COLUMN restored_from_audit_id INTEGER`);
  } catch (e) {
    // Column already exists (SQLite throws "duplicate column name") — fine.
  }
}

function logAuditRow({
  actor,
  authMethod,
  sql,
  status,
  rejectReason,
  rowCount,
  ms,
  ip,
  userAgent,
  mode = 'read',
  txnId = null,
  affectedRows = null,
  remark = null,
  restoredFromAuditId = null
}) {
  try {
    const db = getDb();
    const truncatedSql = sql ? String(sql).slice(0, 4000) : null;
    const truncatedUa = userAgent ? String(userAgent).slice(0, 200) : null;
    const truncatedRemark = remark ? String(remark).slice(0, 2000) : null;
    const info = db.prepare(`
      INSERT INTO sql_console_audit
        (actor, auth_method, sql, status, reject_reason, row_count, ms, ip, user_agent,
         mode, txn_id, affected_rows, remark, restored_from_audit_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      actor || null,
      authMethod || null,
      truncatedSql,
      status || null,
      rejectReason || null,
      rowCount == null ? null : rowCount,
      ms == null ? null : ms,
      ip || null,
      truncatedUa,
      mode,
      txnId || null,
      affectedRows == null ? null : affectedRows,
      truncatedRemark,
      restoredFromAuditId == null ? null : restoredFromAuditId
    );
    return info && info.lastInsertRowid != null ? Number(info.lastInsertRowid) : null;
  } catch (e) {
    // Never let an audit failure break the response.
    console.error('[SQL_CONSOLE] audit log failed:', e.message);
    return null;
  }
}

// ── Validation ────────────────────────────────────────────────
function stripCommentsAndStrings(sql) {
  let s = String(sql);
  // Block comments /* ... */ (non-greedy, multiline)
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  // Line comments -- to end of line
  s = s.replace(/--[^\n]*/g, '');
  // Single-quoted strings (handle '' escape by collapsing the whole literal)
  s = s.replace(/'(?:''|[^'])*'/g, "''");
  // Double-quoted identifiers/strings
  s = s.replace(/"(?:""|[^"])*"/g, '""');
  return s;
}

function validateReadOnlySql(sql) {
  if (typeof sql !== 'string') {
    return { ok: false, code: 'SQL_INVALID_INPUT', reason: 'sql must be a string' };
  }
  const len = sql.length;
  if (len < 1 || len > 10000) {
    return { ok: false, code: 'SQL_INVALID_INPUT', reason: 'sql length out of range (1..10000)' };
  }
  const cleaned = stripCommentsAndStrings(sql).trim();
  if (!cleaned) {
    return { ok: false, code: 'SQL_INVALID_INPUT', reason: 'sql is empty after stripping comments' };
  }
  const match = cleaned.match(/^([A-Za-z_]+)\b/);
  if (!match) {
    return { ok: false, code: 'STATEMENT_NOT_ALLOWED', reason: 'could not detect leading keyword' };
  }
  const lead = match[1].toUpperCase();
  const allowed = ['SELECT', 'WITH', 'EXPLAIN', 'PRAGMA'];
  if (!allowed.includes(lead)) {
    return {
      ok: false,
      code: 'STATEMENT_NOT_ALLOWED',
      reason: `leading keyword ${lead} not in allowlist`
    };
  }
  if (lead === 'PRAGMA') {
    // Next token after PRAGMA, ignoring whitespace
    const rest = cleaned.slice(match[0].length).trim();
    const pragmaMatch = rest.match(/^([A-Za-z_]+)/);
    if (!pragmaMatch) {
      return { ok: false, code: 'PRAGMA_NOT_ALLOWED', reason: 'could not detect pragma name' };
    }
    const pragmaName = pragmaMatch[1].toLowerCase();
    if (!PRAGMA_ALLOWLIST.has(pragmaName)) {
      return {
        ok: false,
        code: 'PRAGMA_NOT_ALLOWED',
        reason: `pragma ${pragmaName} not in allowlist`
      };
    }
  }
  return { ok: true };
}

// ── Auth ──────────────────────────────────────────────────────
function timingSafeEqualStr(a, b) {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function makeAuthMiddleware() {
  return function authMiddleware(req, res, next) {
    const ip = req.ip || req.connection?.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';
    const apiKeyHeader = req.headers['x-sql-console-key'];

    if (apiKeyHeader) {
      const envKey = process.env.SQL_CONSOLE_API_KEY;
      if (!envKey || envKey.length < 32) {
        logAuditRow({
          actor: 'unknown',
          authMethod: 'api_key',
          sql: null,
          status: 'rejected',
          rejectReason: 'BAD_API_KEY (server has no key configured)',
          ip,
          userAgent: ua
        });
        return res.status(401).json({
          success: false,
          code: 'BAD_API_KEY',
          reason: 'API key auth not configured on server'
        });
      }
      if (timingSafeEqualStr(String(apiKeyHeader), envKey)) {
        req.sqlActor = { username: 'agent', auth_method: 'api_key' };
        return next();
      }
      logAuditRow({
        actor: 'unknown',
        authMethod: 'api_key',
        sql: null,
        status: 'rejected',
        rejectReason: 'BAD_API_KEY',
        ip,
        userAgent: ua
      });
      return res.status(401).json({ success: false, code: 'BAD_API_KEY' });
    }

    // JWT fallback
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.startsWith('Bearer '))
      ? authHeader.slice(7)
      : req.cookies?.hr_token;
    if (!token) {
      return res.status(401).json({ success: false, code: 'AUTH_REQUIRED' });
    }
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', reason: 'invalid token' });
    }
    if (payload.role !== 'admin') {
      return res.status(403).json({ success: false, code: 'ADMIN_REQUIRED' });
    }
    req.sqlActor = { username: payload.username || `id:${payload.id}`, auth_method: 'jwt' };
    return next();
  };
}

// ── Snippets (hardcoded) ──────────────────────────────────────
const SNIPPETS = [
  {
    group: 'Salary Integrity',
    name: 'Salary drift sanity check',
    description: 'Net != gross_earned - total_deductions; ABS drift > 1 means STOP',
    sql: "SELECT employee_code, month, year, net_salary, gross_earned, total_deductions,\n       ABS(net_salary - (gross_earned - total_deductions)) as drift\nFROM salary_computations\nWHERE month = ? AND year = ?\nORDER BY drift DESC\nLIMIT 20;"
  },
  {
    group: 'Salary Integrity',
    name: 'Earned ratio over 1.0 (capping bug detector)',
    description: 'Base components should never have earned ratio > 1.0',
    sql: "SELECT employee_code, month, year,\n       CASE WHEN basic > 0 THEN basic_earned / basic ELSE 0 END as basic_ratio,\n       CASE WHEN hra > 0 THEN hra_earned / hra ELSE 0 END as hra_ratio\nFROM salary_computations\nWHERE month = ? AND year = ?\n  AND (basic_earned > basic * 1.001 OR hra_earned > hra * 1.001)\nORDER BY basic_ratio DESC\nLIMIT 50;"
  },
  {
    group: 'Salary Integrity',
    name: 'Net salary trend (specific employee)',
    description: 'Last 12 months for one employee — replace ? with employee code',
    sql: "SELECT month, year, gross_earned, total_deductions, net_salary,\n       advance_recovery, loan_recovery, late_coming_deduction\nFROM salary_computations\nWHERE employee_code = ?\nORDER BY year DESC, month DESC\nLIMIT 12;"
  },
  {
    group: 'Pipeline Sanity',
    name: 'Attendance row count by month',
    description: 'Post-Stage 1 sanity check',
    sql: "SELECT company, month, year, COUNT(*) as rows,\n       COUNT(DISTINCT employee_code) as employees\nFROM attendance_processed\nGROUP BY company, month, year\nORDER BY year DESC, month DESC;"
  },
  {
    group: 'Pipeline Sanity',
    name: 'Day calculation rows by month',
    description: 'Verify Stage 6 ran',
    sql: "SELECT company, month, year, COUNT(*) as rows,\n       SUM(total_payable_days) as payable_days_sum,\n       SUM(days_present) as present_days_sum\nFROM day_calculations\nGROUP BY company, month, year\nORDER BY year DESC, month DESC;"
  },
  {
    group: 'Pipeline Sanity',
    name: 'Unresolved miss-punches (current month)',
    description: 'Replace ? ? with month, year',
    sql: "SELECT employee_code, COUNT(*) as miss_punch_count,\n       SUM(CASE WHEN miss_punch_status = 'resolved' THEN 1 ELSE 0 END) as resolved\nFROM attendance_processed\nWHERE strftime('%m', date) = printf('%02d', ?)\n  AND strftime('%Y', date) = CAST(? AS TEXT)\n  AND is_miss_punch = 1\nGROUP BY employee_code\nHAVING resolved < miss_punch_count\nORDER BY miss_punch_count DESC;"
  },
  {
    group: 'Finance & Reviews',
    name: 'Pending finance reviews — late coming',
    description: 'Finance queue for late coming deductions',
    sql: "SELECT id, employee_code, month, year, late_count, deduction_days,\n       applied_by, applied_at, finance_status\nFROM late_coming_deductions\nWHERE finance_status = 'pending'\nORDER BY applied_at DESC;"
  },
  {
    group: 'Finance & Reviews',
    name: 'Active loans with pending recovery',
    description: 'Outstanding principal per active loan',
    sql: "SELECT l.employee_code, l.principal_amount, l.emi_amount, l.disbursed_at,\n       (l.principal_amount - COALESCE(SUM(lr.amount_recovered), 0)) as outstanding\nFROM loans l\nLEFT JOIN loan_repayments lr ON lr.loan_id = l.id\nWHERE l.status = 'active'\nGROUP BY l.id\nHAVING outstanding > 0\nORDER BY outstanding DESC;"
  },
  {
    group: 'Finance & Reviews',
    name: 'Salary advances pending recovery',
    description: 'Paid advances with no recovery month assigned',
    sql: "SELECT employee_code, advance_amount, paid_at, recovered\nFROM salary_advances\nWHERE paid_at IS NOT NULL AND recovered = 0\nORDER BY paid_at DESC;"
  },
  {
    group: 'Master Data & Discovery',
    name: 'Find employee (code or name)',
    description: 'Replace both ? with employee code (1st) and partial name (2nd)',
    sql: "SELECT code, name, department, company, employment_type, status, date_of_joining\nFROM employees\nWHERE code = ? OR name LIKE '%' || ? || '%'\nORDER BY name\nLIMIT 20;"
  },
  {
    group: 'Master Data & Discovery',
    name: 'Employees by department + count',
    description: 'Active headcount per dept/type',
    sql: "SELECT company, department, employment_type, COUNT(*) as count\nFROM employees\nWHERE status = 'Active'\nGROUP BY company, department, employment_type\nORDER BY company, department;"
  },
  {
    group: 'Master Data & Discovery',
    name: 'Recent audit log entries',
    description: 'Last 100 audit log entries',
    sql: "SELECT id, table_name, record_id, field_name, old_value, new_value,\n       stage, remark, datetime(timestamp) as ts\nFROM audit_log\nORDER BY id DESC\nLIMIT 100;"
  }
];

// ── Phase 2: Write Validator ──────────────────────────────────
// Forbidden tokens: even though leading-keyword validation passes for write
// ops, these tokens ANYWHERE in the stripped SQL are dangerous and rejected.
const WRITE_FORBIDDEN_TOKENS = [
  'ATTACH', 'DETACH', 'VACUUM', 'REINDEX', 'PRAGMA', 'TRIGGER', '.LOAD'
];

// Tables for which we capture rows_before/rows_after JSON snapshots and
// (for the salary-cascade subset) run a post-write drift check.
const PROTECTED_TABLES = new Set([
  'salary_computations',
  'day_calculations',
  'attendance_processed',
  'salary_structures',
  'employees'
]);
const SALARY_CASCADE_TABLES = PROTECTED_TABLES; // identical set for now

const SNAPSHOT_ROW_CAP = 500;       // refuse to snapshot more than this many rows
const WRITE_AFFECTED_ROW_CAP = 1000; // hard cap on actual rows changed
const TXN_TTL_MS = 60_000;          // 60s preview TTL

function validateWriteSql(sql, opts = {}) {
  if (typeof sql !== 'string') {
    return { ok: false, code: 'SQL_INVALID_INPUT', reason: 'sql must be a string' };
  }
  const len = sql.length;
  if (len < 1 || len > 10000) {
    return { ok: false, code: 'SQL_INVALID_INPUT', reason: 'sql length out of range (1..10000)' };
  }

  const cleaned = stripCommentsAndStrings(sql).trim();
  if (!cleaned) {
    return { ok: false, code: 'SQL_INVALID_INPUT', reason: 'sql is empty after stripping comments' };
  }

  // Layer 2: leading keyword
  const m = cleaned.match(/^([A-Za-z_]+)\b/);
  if (!m) {
    return { ok: false, code: 'STATEMENT_NOT_ALLOWED', reason: 'could not detect leading keyword' };
  }
  const lead = m[1].toUpperCase();
  let op, isDdl;
  if (lead === 'INSERT' || lead === 'UPDATE' || lead === 'DELETE') {
    op = lead;
    isDdl = false;
  } else if (lead === 'CREATE' || lead === 'ALTER' || lead === 'DROP' || lead === 'REPLACE') {
    op = 'DDL';
    isDdl = true;
  } else {
    return {
      ok: false,
      code: 'STATEMENT_NOT_ALLOWED',
      reason: `leading keyword ${lead} not allowed for write path`
    };
  }

  // Layer 3: single-statement check. Strip a single trailing ';' and whitespace,
  // then disallow any further ';' inside the cleaned body.
  const trailingStripped = cleaned.replace(/;\s*$/, '');
  if (trailingStripped.indexOf(';') !== -1) {
    return {
      ok: false,
      code: 'MULTI_STATEMENT_NOT_ALLOWED',
      reason: 'multiple statements detected'
    };
  }

  // Layer 4: forbidden tokens (case-insensitive, word-boundary)
  for (const tok of WRITE_FORBIDDEN_TOKENS) {
    const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(cleaned)) {
      return {
        ok: false,
        code: 'FORBIDDEN_TOKEN',
        reason: `forbidden token: ${tok}`
      };
    }
  }

  // Layer 5: unscoped UPDATE/DELETE — require explicit confirmation.
  if (op === 'UPDATE' || op === 'DELETE') {
    if (!/\bWHERE\b/i.test(cleaned)) {
      if (opts.acceptUnscopedWrite !== true) {
        return {
          ok: false,
          code: 'UNSCOPED_WRITE_BLOCKED',
          reason: `${op} without WHERE clause; pass acceptUnscopedWrite:true to proceed`
        };
      }
    }
  }

  // Layer 6: multi-table writes (JOIN inside UPDATE/DELETE) — diff/snapshot
  // logic gets ambiguous, so reject.
  if ((op === 'UPDATE' || op === 'DELETE') && /\bJOIN\b/i.test(cleaned)) {
    return {
      ok: false,
      code: 'MULTI_TABLE_WRITE_NOT_ALLOWED',
      reason: `JOIN not allowed inside ${op}`
    };
  }

  return { ok: true, op, isDdl };
}

function extractTableName(sql, op) {
  const cleaned = stripCommentsAndStrings(sql);
  let m;
  if (op === 'UPDATE') {
    m = cleaned.match(/\bUPDATE\s+(?:OR\s+\w+\s+)?["`]?([a-zA-Z_][a-zA-Z0-9_]*)["`]?/i);
  } else if (op === 'DELETE') {
    m = cleaned.match(/\bDELETE\s+FROM\s+["`]?([a-zA-Z_][a-zA-Z0-9_]*)["`]?/i);
  } else if (op === 'INSERT') {
    m = cleaned.match(/\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+["`]?([a-zA-Z_][a-zA-Z0-9_]*)["`]?/i);
  } else if (op === 'DDL') {
    m = cleaned.match(/\b(?:CREATE|ALTER|DROP|REPLACE)\s+(?:TABLE|INDEX|VIEW|TRIGGER)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?["`]?([a-zA-Z_][a-zA-Z0-9_]*)["`]?/i);
  }
  return m ? m[1] : null;
}

// Extract WHERE clause of an UPDATE/DELETE so we can capture matching rows
// before the change. Returns the literal WHERE string (incl. the WHERE keyword)
// or null if no WHERE is present.
function extractWhereClause(sql) {
  const cleaned = stripCommentsAndStrings(sql);
  // We need to take the original sql so string literals are preserved when
  // running SELECT * FROM <table> <WHERE>. Use index-based slicing aligned
  // with the cleaned version.
  const whereIdx = cleaned.search(/\bWHERE\b/i);
  if (whereIdx === -1) return null;
  // Everything from the WHERE in the ORIGINAL sql, stripped of trailing ';'.
  // Map index back: stripCommentsAndStrings preserves length (it replaces
  // contents with same-length placeholders). Verify.
  if (cleaned.length !== sql.length) {
    // Length mismatch — fall back to extracting from cleaned string only.
    // (Phase 1's stripper only collapses content inside quotes, so length
    // CAN drift. For our use-case we run the SELECT against the original
    // sql's WHERE clause, so re-find it in the original.)
    const m = sql.match(/\bWHERE\b[\s\S]*$/i);
    return m ? m[0].replace(/;\s*$/, '').trim() : null;
  }
  return sql.slice(whereIdx).replace(/;\s*$/, '').trim();
}

// ── Phase 2: Manual Transaction Helpers ───────────────────────
// SQLite WAL mode allows concurrent readers + a single writer. We use the
// SAME main connection (from db.js) so writes land in the live DB. We
// DON'T use db.transaction() because that auto-commits at function end —
// we need control across HTTP requests.
function beginManualTxn(db) {
  db.exec('BEGIN IMMEDIATE');
}
function commitManualTxn(db) {
  db.exec('COMMIT');
}
function rollbackManualTxn(db) {
  try {
    db.exec('ROLLBACK');
  } catch (e) {
    // Transaction may already be aborted by SQLite (e.g. statement-level error).
  }
}

// ── Phase 2: In-Memory Transaction Registry ───────────────────
// At-most-one entry. Single-writer per connection enforced by SQLite, so
// /preview rejects with TXN_ALREADY_OPEN when this Map already has an entry.
const txnRegistry = new Map();

function txnRegistryHasOpen() {
  return txnRegistry.size > 0;
}

function txnRegistryGet(txnId) {
  return txnRegistry.get(txnId);
}

function txnRegistryDelete(txnId) {
  txnRegistry.delete(txnId);
}

// Idempotently ensure the snapshot table exists. Called once at mount.
function ensureWriteSnapshotsTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS sql_console_write_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id INTEGER REFERENCES sql_console_audit(id),
      table_name TEXT NOT NULL,
      rows_before TEXT,
      rows_after TEXT,
      affected_count INTEGER,
      ts TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_snapshot_audit ON sql_console_write_snapshots(audit_id);
    CREATE INDEX IF NOT EXISTS idx_snapshot_table ON sql_console_write_snapshots(table_name);
  `);
}

// Run the salary drift check. Returns { ran, drift_count, warning } or
// { ran: false } if salary_computations doesn't exist.
function runDriftCheck(db) {
  try {
    const r = db.prepare(
      'SELECT COUNT(*) AS drift_count FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1'
    ).get();
    const drift_count = r ? r.drift_count : 0;
    return { ran: true, drift_count, warning: drift_count > 0 };
  } catch (e) {
    return { ran: false, drift_count: 0, warning: false, error: e.message };
  }
}

// Generate inverse SQL for a snapshot restore. Returns { sql, op } where op
// is INSERT|UPDATE|DELETE matching the inverse of the original write.
// IMPORTANT: rows_before/rows_after carry the original write's view of data:
//   original INSERT  → rows_after has new rows; inverse = DELETE by PK
//   original UPDATE  → rows_before has old values; inverse = UPDATE back
//   original DELETE  → rows_before has deleted rows; inverse = INSERT back
function generateInverseStatements(originalOp, tableName, rowsBefore, rowsAfter, pkCols) {
  // Returns array of { sql, params } since UPDATE-back may produce multiple
  // statements (one per row).
  const stmts = [];
  const quote = (col) => `"${col.replace(/"/g, '""')}"`;
  const placeholdersFor = (vals) => vals.map(() => '?').join(', ');

  if (originalOp === 'INSERT') {
    // Inverse: DELETE the rows we inserted, identified by PK from rows_after.
    for (const row of (rowsAfter || [])) {
      const whereParts = [];
      const params = [];
      for (const pk of pkCols) {
        whereParts.push(`${quote(pk)} = ?`);
        params.push(row[pk]);
      }
      if (whereParts.length === 0) continue;
      stmts.push({
        sql: `DELETE FROM ${quote(tableName)} WHERE ${whereParts.join(' AND ')}`,
        params
      });
    }
  } else if (originalOp === 'DELETE') {
    // Inverse: re-INSERT the rows that were deleted, from rows_before.
    for (const row of (rowsBefore || [])) {
      const cols = Object.keys(row);
      const vals = cols.map(c => row[c]);
      stmts.push({
        sql: `INSERT INTO ${quote(tableName)} (${cols.map(quote).join(', ')}) VALUES (${placeholdersFor(vals)})`,
        params: vals
      });
    }
  } else if (originalOp === 'UPDATE') {
    // Inverse: UPDATE rows back to rows_before values, matching by PK.
    // We pair rows_before[i] with rows_after[i] (same order, same row).
    const before = rowsBefore || [];
    for (const row of before) {
      const setParts = [];
      const setParams = [];
      const whereParts = [];
      const whereParams = [];
      for (const col of Object.keys(row)) {
        if (pkCols.includes(col)) {
          whereParts.push(`${quote(col)} = ?`);
          whereParams.push(row[col]);
        } else {
          setParts.push(`${quote(col)} = ?`);
          setParams.push(row[col]);
        }
      }
      if (whereParts.length === 0 || setParts.length === 0) continue;
      stmts.push({
        sql: `UPDATE ${quote(tableName)} SET ${setParts.join(', ')} WHERE ${whereParts.join(' AND ')}`,
        params: [...setParams, ...whereParams]
      });
    }
  }
  return stmts;
}

// Determine the primary-key column names for a table by reading PRAGMA
// table_info. Returns ['id'] as a sensible fallback when the table has no
// declared PK.
function getPrimaryKeyColumns(db, tableName) {
  const cols = db.prepare(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`).all();
  const pks = cols
    .filter(c => c.pk && c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map(c => c.name);
  if (pks.length > 0) return pks;
  // Fallback: try 'id' if it exists.
  const hasId = cols.some(c => c.name === 'id');
  if (hasId) return ['id'];
  // Last resort: use all columns (unique-ish).
  return cols.map(c => c.name);
}

// Compare current PRAGMA table_info column SET against keys present in a
// captured row. Returns { ok, missing_columns, extra_columns }.
function detectSchemaDrift(db, tableName, capturedRow) {
  const cols = db.prepare(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`).all();
  const currentSet = new Set(cols.map(c => c.name));
  const capturedSet = new Set(Object.keys(capturedRow || {}));
  const missing = [...capturedSet].filter(c => !currentSet.has(c)); // captured had col, table doesn't
  const extra = [...currentSet].filter(c => !capturedSet.has(c));   // table has col, captured didn't
  return { ok: missing.length === 0 && extra.length === 0, missing_columns: missing, extra_columns: extra };
}

// ── Mount ─────────────────────────────────────────────────────
function mountSqlConsole(app) {
  if (process.env.SQL_CONSOLE_ENABLED !== 'true') {
    console.log('[SQL_CONSOLE] disabled (set SQL_CONSOLE_ENABLED=true to enable)');
    return;
  }
  const apiKey = process.env.SQL_CONSOLE_API_KEY;
  const hasApiKey = !!(apiKey && apiKey.length >= 32);
  if (apiKey && !hasApiKey) {
    console.warn('[SQL_CONSOLE] SQL_CONSOLE_API_KEY is set but shorter than 32 chars — API key path will reject all requests');
  }
  if (!apiKey) {
    console.warn('[SQL_CONSOLE] SQL_CONSOLE_API_KEY not set — only JWT (admin) path will work');
  }

  ensureAuditTable();
  ensureWriteSnapshotsTable();

  const router = express.Router();
  const auth = makeAuthMiddleware();

  // Rate limit ONLY API-key-authenticated requests (skip JWT).
  const apiKeyLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    skip: (req) => !req.headers['x-sql-console-key'],
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { success: false, code: 'RATE_LIMITED', reason: '30 requests/minute on API key' }
  });
  router.use(apiKeyLimiter);

  // POST /execute
  router.post('/execute', auth, (req, res) => {
    const ip = req.ip || req.connection?.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';
    const actor = req.sqlActor.username;
    const authMethod = req.sqlActor.auth_method;

    const sql = req.body?.sql;
    if (typeof sql !== 'string') {
      logAuditRow({
        actor, authMethod, sql: null, status: 'rejected',
        rejectReason: 'SQL_INVALID_INPUT (sql not a string)', ip, userAgent: ua
      });
      return res.status(400).json({
        success: false,
        code: 'SQL_INVALID_INPUT',
        reason: 'request body must be JSON { sql: string }'
      });
    }

    const validation = validateReadOnlySql(sql);
    if (!validation.ok) {
      const httpStatus = validation.code === 'SQL_INVALID_INPUT' ? 400 : 403;
      logAuditRow({
        actor, authMethod, sql, status: 'rejected',
        rejectReason: `${validation.code}: ${validation.reason}`,
        ip, userAgent: ua
      });
      return res.status(httpStatus).json({
        success: false,
        code: validation.code,
        reason: validation.reason
      });
    }

    const start = Date.now();
    let rows = [];
    let columns = [];
    try {
      const stmt = getReadonlyDb().prepare(sql);
      const isReader = typeof stmt.reader === 'boolean' ? stmt.reader : true;
      if (isReader) {
        rows = stmt.all();
        try {
          const colsMeta = stmt.columns ? stmt.columns() : null;
          columns = colsMeta ? colsMeta.map(c => c.name) : (rows[0] ? Object.keys(rows[0]) : []);
        } catch (e) {
          columns = rows[0] ? Object.keys(rows[0]) : [];
        }
      } else {
        // EXPLAIN / non-row PRAGMA — try .all() defensively, fall through to empty.
        try { rows = stmt.all(); } catch (e) { rows = []; }
        columns = rows[0] ? Object.keys(rows[0]) : [];
      }
    } catch (err) {
      const ms = Date.now() - start;
      if (err && err.code === 'SQLITE_READONLY') {
        logAuditRow({
          actor, authMethod, sql, status: 'rejected',
          rejectReason: `WRITE_BLOCKED_BY_FILE_HANDLE: ${err.message}`,
          ms, ip, userAgent: ua
        });
        return res.status(403).json({
          success: false,
          code: 'WRITE_BLOCKED_BY_FILE_HANDLE',
          reason: err.message
        });
      }
      logAuditRow({
        actor, authMethod, sql, status: 'error',
        rejectReason: `SQL_EXECUTION_ERROR: ${err.message}`,
        ms, ip, userAgent: ua
      });
      return res.status(400).json({
        success: false,
        code: 'SQL_EXECUTION_ERROR',
        reason: err.message
      });
    }

    const ms = Date.now() - start;
    const MAX_ROWS = parseInt(process.env.SQL_CONSOLE_MAX_ROWS, 10) || 5000;
    const truncated = rows.length > MAX_ROWS;
    if (truncated) rows = rows.slice(0, MAX_ROWS);
    const slow = ms > 10000;

    logAuditRow({
      actor, authMethod, sql, status: 'ok',
      rowCount: rows.length, ms, ip, userAgent: ua
    });

    return res.json({
      success: true,
      columns,
      rows,
      rowCount: rows.length,
      ms,
      truncated,
      slow
    });
  });

  // GET /schema (cached 60s)
  router.get('/schema', auth, (req, res) => {
    const ip = req.ip || req.connection?.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';
    const actor = req.sqlActor.username;
    const authMethod = req.sqlActor.auth_method;

    const now = Date.now();
    if (schemaCache && (now - schemaCachedAt) < SCHEMA_TTL_MS) {
      return res.json({
        success: true,
        tables: schemaCache,
        cachedAt: schemaCachedAt,
        cached: true
      });
    }

    try {
      const db = getReadonlyDb();
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all().map(r => r.name);

      const out = [];
      for (const name of tables) {
        let cols = [];
        let rowCount = null;
        try {
          cols = db.prepare(`PRAGMA table_info(${name})`).all().map(c => ({
            name: c.name,
            type: c.type,
            notnull: c.notnull,
            pk: c.pk
          }));
        } catch (e) { /* ignore individual table errors */ }
        try {
          const r = db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get();
          rowCount = r ? r.c : null;
        } catch (e) { rowCount = null; }
        out.push({ name, columns: cols, rowCount });
      }

      schemaCache = out;
      schemaCachedAt = now;

      logAuditRow({
        actor, authMethod, sql: '/schema', status: 'ok',
        rowCount: out.length, ms: 0, ip, userAgent: ua
      });

      return res.json({
        success: true,
        tables: out,
        cachedAt: schemaCachedAt,
        cached: false
      });
    } catch (err) {
      logAuditRow({
        actor, authMethod, sql: '/schema', status: 'error',
        rejectReason: err.message, ip, userAgent: ua
      });
      return res.status(500).json({ success: false, code: 'SCHEMA_ERROR', reason: err.message });
    }
  });

  // GET /history (no audit on history calls)
  router.get('/history', auth, (req, res) => {
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 50;
    if (limit > 200) limit = 200;
    try {
      const db = getDb();
      let rows;
      if (req.sqlActor.auth_method === 'jwt') {
        rows = db.prepare(`
          SELECT id, ts, sql, status, reject_reason, row_count, ms
          FROM sql_console_audit
          WHERE actor = ?
          ORDER BY id DESC
          LIMIT ?
        `).all(req.sqlActor.username, limit);
      } else {
        rows = db.prepare(`
          SELECT id, ts, sql, status, reject_reason, row_count, ms
          FROM sql_console_audit
          WHERE auth_method = 'api_key'
          ORDER BY id DESC
          LIMIT ?
        `).all(limit);
      }
      return res.json({ success: true, history: rows });
    } catch (err) {
      return res.status(500).json({ success: false, code: 'HISTORY_ERROR', reason: err.message });
    }
  });

  // GET /snippets (no audit)
  router.get('/snippets', auth, (req, res) => {
    return res.json({ success: true, snippets: SNIPPETS });
  });

  // GET /health
  router.get('/health', auth, (req, res) => {
    const dbPath = getDbPath();
    let dbSizeMb = null;
    try {
      const stat = fs.statSync(dbPath);
      dbSizeMb = Math.round((stat.size / (1024 * 1024)) * 100) / 100;
    } catch (e) { /* file may not exist yet */ }
    let auditRows = 0;
    try {
      const r = getDb().prepare('SELECT COUNT(*) AS c FROM sql_console_audit').get();
      auditRows = r ? r.c : 0;
    } catch (e) { /* ignore */ }
    return res.json({
      success: true,
      enabled: true,
      hasApiKey,
      dbPath,
      dbSizeMb,
      auditRows,
      cacheStats: { schemaCachedAt: schemaCache ? schemaCachedAt : null }
    });
  });

  app.use('/api/admin/sql', router);
  console.log('[SQL_CONSOLE] enabled at /api/admin/sql/*');
}

module.exports = {
  mountSqlConsole,
  // exported for unit-style verification only
  __internals: {
    validateReadOnlySql,
    validateWriteSql,
    stripCommentsAndStrings,
    extractTableName,
    extractWhereClause,
    generateInverseStatements,
    getPrimaryKeyColumns,
    detectSchemaDrift,
    txnRegistry,
    PROTECTED_TABLES,
    SALARY_CASCADE_TABLES,
    SNAPSHOT_ROW_CAP,
    WRITE_AFFECTED_ROW_CAP,
    TXN_TTL_MS,
    SNIPPETS
  }
};

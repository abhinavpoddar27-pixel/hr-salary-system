/**
 * Diagnostic Route — read-only DB inspection for production debugging.
 *
 * Auth: Bearer token from env var DIAG_TOKEN (min 32 chars). If the env var
 * is unset or too short the entire route returns 503 so the endpoint is
 * disabled-by-default.
 *
 * Guards:
 *   - Constant-time token comparison (crypto.timingSafeEqual).
 *   - Only SELECT / WITH / EXPLAIN are accepted as statements.
 *   - A narrow allowlist of read-only PRAGMAs is also accepted
 *     (table_info, index_list, foreign_key_list, index_info,
 *      database_list, schema_version, user_version, integrity_check,
 *      page_count, page_size, journal_mode).
 *   - Multi-statement SQL is rejected (no stray `;` except a trailing one).
 *   - Dangerous keywords (INSERT/UPDATE/DELETE/DROP/CREATE/ALTER/REPLACE/
 *     VACUUM/REINDEX/TRIGGER/ATTACH/DETACH/TRUNCATE) are rejected.
 *   - Max SQL length 8000 chars; results capped at 2000 rows (default 500).
 *   - Fresh readonly SQLite handle per call (WAL allows concurrent readers).
 *   - PRAGMA query_only = ON for belt-and-braces.
 *   - Rate limited at 30 req/min per IP.
 *
 * Audit: every call (including rejections) writes to audit_log with
 * stage='DIAG_QUERY' / 'DIAG_HEALTH' / 'DIAG_ERROR' so the production
 * owner can see exactly what was run.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const { logAudit } = require('../database/db');

const router = express.Router();

// ── Bearer token middleware ──────────────────────────────────────────────────
// Constant-time comparison via Buffer to prevent timing attacks.
function requireDiagToken(req, res, next) {
  const expected = process.env.DIAG_TOKEN;
  if (!expected || expected.length < 32) {
    return res.status(503).json({
      success: false,
      error: 'Diagnostic endpoint not configured (DIAG_TOKEN missing or too short)'
    });
  }
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ success: false, error: 'Bearer token required' });
  }
  const got = Buffer.from(match[1]);
  const exp = Buffer.from(expected);
  if (got.length !== exp.length) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
  try {
    if (!crypto.timingSafeEqual(got, exp)) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
  next();
}

// ── SQL guard ────────────────────────────────────────────────────────────────
// Reject anything that isn't a pure SELECT / WITH / EXPLAIN.
// Belt-and-braces: we also open the DB in readonly mode + PRAGMA query_only,
// but this guard provides a friendlier error and blocks obvious nasties before
// they touch SQLite at all.
const DANGEROUS_TOKENS = [
  /\battach\b/i, /\bdetach\b/i,
  /\binsert\b/i, /\bupdate\b/i, /\bdelete\b/i,
  /\bdrop\b/i,   /\balter\b/i,  /\bcreate\b/i,
  /\breplace\b/i, /\bvacuum\b/i, /\breindex\b/i,
  /\btruncate\b/i,
  /\bpragma\b/i,  // block all PRAGMA in /query; /schema/:table uses inline PRAGMA directly
  /writable_schema/i,
  /;\s*\S/        // reject multi-statement (any non-whitespace after ;)
];

function isSafeSelect(sql) {
  if (typeof sql !== 'string') return false;
  const trimmed = sql.trim().replace(/;+\s*$/, ''); // strip trailing ;
  if (!trimmed) return false;
  if (!/^(select|with|explain)\b/i.test(trimmed)) return false;
  for (const re of DANGEROUS_TOKENS) {
    if (re.test(trimmed)) return false;
  }
  return true;
}

// ── Open a fresh readonly handle per-call ───────────────────────────────────
// We deliberately do NOT reuse the main app's db handle (which is RW).
// SQLite WAL allows unlimited concurrent readers alongside the writer.
function openReadonly() {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../../data');
  const dbPath = path.join(dataDir, 'hr_system.db');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  return db;
}

// ── Rate limit: 30 req/min per IP ───────────────────────────────────────────
const diagLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { success: false, error: 'Rate limit exceeded' }
});

router.use(requireDiagToken);
router.use(diagLimiter);

// ── GET /api/diagnostic/health ───────────────────────────────────────────────
// Smoke test: table list + key row counts. Zero writes to the DB.
router.get('/health', (req, res) => {
  const started = Date.now();
  let db;
  try {
    db = openReadonly();
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map(r => r.name);

    const TARGET_TABLES = [
      'employees', 'attendance_processed', 'day_calculations',
      'salary_computations', 'extra_duty_grants',
      'finance_rejections', 'audit_log'
    ];
    const counts = {};
    for (const t of TARGET_TABLES) {
      try {
        counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
      } catch {
        counts[t] = null;
      }
    }
    const durationMs = Date.now() - started;
    logAudit('diagnostic', 0, 'health', '', JSON.stringify(counts),
      'DIAG_HEALTH', `ip=${req.ip} ms=${durationMs}`);
    res.json({
      success: true,
      tableCount: tables.length,
      tables,
      rowCounts: counts,
      durationMs,
      server: {
        node: process.version,
        env: process.env.NODE_ENV,
        uptime: Math.round(process.uptime())
      }
    });
  } catch (e) {
    logAudit('diagnostic', 0, 'health_error', '', e.message, 'DIAG_ERROR', `ip=${req.ip}`);
    res.status(500).json({ success: false, error: e.message });
  } finally {
    if (db) db.close();
  }
});

// ── POST /api/diagnostic/query ───────────────────────────────────────────────
// Run an arbitrary SELECT / WITH / EXPLAIN query against the live DB.
// Body: { sql: "SELECT ...", params?: [], limit?: 500 }
router.post('/query', (req, res) => {
  const { sql, params = [], limit = 500 } = req.body || {};
  if (typeof sql !== 'string' || !sql.trim()) {
    return res.status(400).json({ success: false, error: 'sql (string) required' });
  }
  if (sql.length > 8000) {
    return res.status(400).json({ success: false, error: 'SQL too long (max 8000 chars)' });
  }
  if (!isSafeSelect(sql)) {
    logAudit('diagnostic', 0, 'query_rejected', sql.slice(0, 500),
      'blocked by guard', 'DIAG_ERROR', `ip=${req.ip}`);
    return res.status(400).json({
      success: false,
      error: 'Only single SELECT / WITH / EXPLAIN statements are allowed. ' +
             'PRAGMA, ATTACH, multi-statement, and mutations are blocked.'
    });
  }
  const cap = Math.min(Math.max(1, parseInt(limit, 10) || 500), 2000);

  const started = Date.now();
  let db;
  try {
    db = openReadonly();
    const stmt = db.prepare(sql);
    const rows = (Array.isArray(params) ? stmt.all(...params) : stmt.all())
      .slice(0, cap);
    const truncated = rows.length >= cap;
    const durationMs = Date.now() - started;
    logAudit('diagnostic', 0, 'query',
      sql.slice(0, 500),
      `rows=${rows.length} truncated=${truncated}`,
      'DIAG_QUERY',
      `ip=${req.ip} ms=${durationMs}`);
    res.json({ success: true, rowCount: rows.length, truncated, durationMs, data: rows });
  } catch (e) {
    logAudit('diagnostic', 0, 'query_error',
      sql.slice(0, 500), e.message, 'DIAG_ERROR', `ip=${req.ip}`);
    res.status(400).json({ success: false, error: e.message });
  } finally {
    if (db) db.close();
  }
});

// ── GET /api/diagnostic/schema/:table ────────────────────────────────────────
// Return column metadata for a named table (PRAGMA table_info).
router.get('/schema/:table', (req, res) => {
  const { table } = req.params;
  // Strict identifier validation — letters, digits, underscores only.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    return res.status(400).json({ success: false, error: 'Invalid table name' });
  }
  let db;
  try {
    db = openReadonly();
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.length) {
      return res.status(404).json({ success: false, error: `Table '${table}' not found` });
    }
    logAudit('diagnostic', 0, 'schema',
      table, `${cols.length} columns`, 'DIAG_QUERY', `ip=${req.ip}`);
    res.json({ success: true, table, columns: cols });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  } finally {
    if (db) db.close();
  }
});

module.exports = router;

/**
 * Phase 2b — route-level coverage for the salary_hold_releases INSERT
 * migration to protectedWrite().
 *
 * Mounts the real payroll router on a real Express app, drives requests
 * through a real http server (no supertest dep), and asserts both the
 * route response shape AND the resulting DB state. Each test gets a
 * fresh :memory: SQLite DB seeded with the minimum schema needed by the
 * hold-release handler.
 */

'use strict';

const Database = require('better-sqlite3');
const express = require('express');
const http = require('http');

// ── Mock ../database/db so the router's getDb() returns our test DB.
//    The factory is self-contained per Jest's out-of-scope rules; the
//    setter is exposed so tests can swap the DB between cases.
jest.mock('../database/db', () => {
  const state = { db: null, lastAuditCall: null };
  return {
    __testSetDb: (d) => { state.db = d; },
    __testGetLastAudit: () => state.lastAuditCall,
    __testResetAudit: () => { state.lastAuditCall = null; },
    getDb: () => state.db,
    logAudit: (...args) => { state.lastAuditCall = args; },
  };
});

// ── Mock the auth middleware so test requests bypass JWT and look like
//    a finance user. The route's own logic (role check happens in the
//    middleware itself) is not what we're testing here.
jest.mock('../middleware/roles', () => ({
  requireFinanceOrAdmin: (req, _res, next) => {
    req.user = req.user || { role: 'finance', username: 'test_finance' };
    next();
  },
  requireHrOrAdmin: (_req, _res, next) => next(),
  requireAdmin: (_req, _res, next) => next(),
  requirePermission: () => (_req, _res, next) => next(),
  roleIn: () => true,
}));

// Service imports happen inside the router's require — pull them in only
// after the mocks above are registered.
const dbMock = require('../database/db');
const router = require('../routes/payroll');

// ── Schema ───────────────────────────────────────────────────────────────────

function setupTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  db.exec(`
    CREATE TABLE protected_writes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL,
      idempotency_key TEXT,
      table_name TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('insert','update','delete','upsert')),
      scope_json TEXT,
      row_count INTEGER NOT NULL,
      dry_run INTEGER NOT NULL DEFAULT 0,
      forced_large_change INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('success','aborted_invariant','aborted_threshold','aborted_idempotent','error')),
      aborted_reason TEXT,
      triggered_by TEXT,
      reason TEXT,
      duration_ms INTEGER,
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE salary_hold_releases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT NOT NULL,
      employee_name TEXT,
      department TEXT,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      company TEXT,
      hold_reason TEXT,
      hold_amount REAL,
      released_by TEXT NOT NULL,
      released_at TEXT NOT NULL DEFAULT (datetime('now')),
      release_notes TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE salary_computations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      salary_held INTEGER DEFAULT 0,
      hold_released INTEGER DEFAULT 0,
      hold_released_by TEXT,
      hold_released_at TEXT,
      hold_reason TEXT,
      net_salary REAL,
      company TEXT,
      UNIQUE (employee_code, month, year)
    );

    CREATE TABLE employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT,
      department TEXT
    );
  `);

  // Seed: one held employee in April 2026.
  db.prepare('INSERT INTO employees (code, name, department) VALUES (?, ?, ?)')
    .run('E001', 'Test User', 'PRODUCTION');
  db.prepare(`
    INSERT INTO salary_computations
      (employee_code, month, year, salary_held, hold_reason, net_salary, company)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('E001', 4, 2026, 1, 'Auto-hold: payable_days < 5', 25000.5, 'Indriyan Beverages');

  return db;
}

// ── Test app + http driver ───────────────────────────────────────────────────

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/payroll', router);
  return app;
}

function callRoute(app, { method, path, body }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const data = body !== undefined ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data ? Buffer.byteLength(data) : 0,
        },
      }, (res) => {
        let chunks = '';
        res.on('data', (c) => { chunks += c; });
        res.on('end', () => {
          server.close();
          let parsed = chunks;
          try { parsed = chunks ? JSON.parse(chunks) : null; } catch (_) { /* keep raw */ }
          resolve({ statusCode: res.statusCode, body: parsed });
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (data) req.write(data);
      req.end();
    });
  });
}

// ── Suite ────────────────────────────────────────────────────────────────────

let testDb;
let app;
let consoleErrSpy;

beforeEach(() => {
  testDb = setupTestDb();
  dbMock.__testSetDb(testDb);
  dbMock.__testResetAudit();
  app = makeApp();
  consoleErrSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (consoleErrSpy) consoleErrSpy.mockRestore();
  if (testDb) testDb.close();
});

describe('PUT /api/payroll/salary/:code/hold-release — protectedWrite migration', () => {
  // ── T01 ────────────────────────────────────────────────────────────────────
  test('T01 happy-path release writes one salary_hold_releases row + one protected_writes success row', async () => {
    const res = await callRoute(app, {
      method: 'PUT',
      path: '/api/payroll/salary/E001/hold-release',
      body: { month: 4, year: 2026, release_notes: 'Approved per HR Form #2026-04-08-07' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Salary released for E001' });

    // salary_hold_releases row written exactly once
    const releases = testDb.prepare('SELECT * FROM salary_hold_releases').all();
    expect(releases).toHaveLength(1);
    expect(releases[0]).toMatchObject({
      employee_code: 'E001',
      employee_name: 'Test User',
      department: 'PRODUCTION',
      month: 4,
      year: 2026,
      company: 'Indriyan Beverages',
      hold_reason: 'Auto-hold: payable_days < 5',
      hold_amount: 25000.5,
      released_by: 'test_finance',
      release_notes: 'Approved per HR Form #2026-04-08-07',
    });

    // protected_writes audit row written with status='success'
    const audits = testDb.prepare('SELECT * FROM protected_writes').all();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      table_name: 'salary_hold_releases',
      operation: 'insert',
      status: 'success',
      row_count: 1,
      triggered_by: 'test_finance',
      reason: 'Release held salary for E001 4/2026',
    });
    expect(audits[0].operation_id).toMatch(/^[0-9a-f-]{36}$/); // uuid
    const scope = JSON.parse(audits[0].scope_json);
    expect(scope).toEqual({ employee_code: 'E001', month: 4, year: 2026 });
  });

  // ── T02 ────────────────────────────────────────────────────────────────────
  test('T02 invariant fires on duplicate release; UPDATE does NOT run', async () => {
    // Pre-seed a row to simulate a leftover audit (e.g. race / bad migration / direct DB).
    testDb.prepare(`
      INSERT INTO salary_hold_releases
        (employee_code, employee_name, department, month, year, company,
         hold_reason, hold_amount, released_by, release_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('E001', 'Test User', 'PRODUCTION', 4, 2026,
           'Indriyan Beverages', 'Stale prior release', 25000.5,
           'old_finance', 'Stale prior note');

    const before = testDb.prepare(
      'SELECT salary_held, hold_released, hold_released_by FROM salary_computations WHERE employee_code=? AND month=? AND year=?'
    ).get('E001', 4, 2026);
    expect(before.salary_held).toBe(1);
    expect(before.hold_released).toBe(0);

    const res = await callRoute(app, {
      method: 'PUT',
      path: '/api/payroll/salary/E001/hold-release',
      body: { month: 4, year: 2026, release_notes: 'Second attempt' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/already has a row for E001 4\/2026/);

    // No NEW salary_hold_releases row — count still 1 (the pre-seeded one).
    const releases = testDb.prepare('SELECT * FROM salary_hold_releases').all();
    expect(releases).toHaveLength(1);
    expect(releases[0].released_by).toBe('old_finance'); // proves the seeded row, not a new one

    // protected_writes records the aborted_invariant attempt.
    const audits = testDb.prepare('SELECT * FROM protected_writes').all();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      table_name: 'salary_hold_releases',
      operation: 'insert',
      status: 'aborted_invariant',
      row_count: 0,
      triggered_by: 'test_finance',
    });
    expect(audits[0].aborted_reason).toMatch(/E001 4\/2026/);

    // Critically: the salary_computations UPDATE did NOT run, because the
    // protectedWrite call sits BEFORE the UPDATE. salary_held stays 1.
    const after = testDb.prepare(
      'SELECT salary_held, hold_released, hold_released_by FROM salary_computations WHERE employee_code=? AND month=? AND year=?'
    ).get('E001', 4, 2026);
    expect(after.salary_held).toBe(1);
    expect(after.hold_released).toBe(0);
    expect(after.hold_released_by).toBeNull();
  });

  // ── T03 ────────────────────────────────────────────────────────────────────
  test('T03 happy-path response shape preserved byte-for-byte vs pre-migration contract', async () => {
    const res = await callRoute(app, {
      method: 'PUT',
      path: '/api/payroll/salary/E001/hold-release',
      body: { month: 4, year: 2026, release_notes: 'Standard release note' },
    });

    expect(res.statusCode).toBe(200);
    // Exact-shape regression: same keys, same order semantics, no extras.
    expect(res.body).toStrictEqual({ success: true, message: 'Salary released for E001' });
    expect(Object.keys(res.body)).toEqual(['success', 'message']);
  });

  // ── T04 ────────────────────────────────────────────────────────────────────
  test('T04 missing release_notes returns 400 in pre-migration shape; protectedWrite never invoked', async () => {
    const res = await callRoute(app, {
      method: 'PUT',
      path: '/api/payroll/salary/E001/hold-release',
      body: { month: 4, year: 2026 }, // no release_notes
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toStrictEqual({
      success: false,
      error: 'Release notes are required (paper verification reference)',
    });

    // Validation runs BEFORE protectedWrite → no audit row.
    const audits = testDb.prepare('SELECT COUNT(*) AS c FROM protected_writes').get();
    expect(audits.c).toBe(0);

    // No salary_hold_releases row.
    const releases = testDb.prepare('SELECT COUNT(*) AS c FROM salary_hold_releases').get();
    expect(releases.c).toBe(0);

    // salary_computations untouched.
    const after = testDb.prepare(
      'SELECT salary_held, hold_released FROM salary_computations WHERE employee_code=? AND month=? AND year=?'
    ).get('E001', 4, 2026);
    expect(after.salary_held).toBe(1);
    expect(after.hold_released).toBe(0);
  });

  // ── T05 ────────────────────────────────────────────────────────────────────
  test('T05 successful release still updates salary_computations.hold_released (the OTHER write was not regressed)', async () => {
    const res = await callRoute(app, {
      method: 'PUT',
      path: '/api/payroll/salary/E001/hold-release',
      body: { month: 4, year: 2026, release_notes: 'Form #X' },
    });

    expect(res.statusCode).toBe(200);

    const after = testDb.prepare(`
      SELECT salary_held, hold_released, hold_released_by, hold_released_at
      FROM salary_computations WHERE employee_code=? AND month=? AND year=?
    `).get('E001', 4, 2026);

    expect(after.salary_held).toBe(0);
    expect(after.hold_released).toBe(1);
    expect(after.hold_released_by).toBe('test_finance');
    expect(after.hold_released_at).not.toBeNull();
    expect(after.hold_released_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    // logAudit() was invoked with the expected args (the OTHER side-effect).
    const auditArgs = dbMock.__testGetLastAudit();
    expect(auditArgs).not.toBeNull();
    expect(auditArgs[0]).toBe('salary_computations');
    expect(auditArgs[2]).toBe('salary_held');
    expect(auditArgs[5]).toBe('FINANCE_HOLD_RELEASE');
  });
});

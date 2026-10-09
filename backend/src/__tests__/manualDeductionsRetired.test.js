/**
 * PUT /api/payroll/salary/:code/manual-deductions is RETIRED (Oct 2026).
 *
 * The old handler rewrote advance/tds/other_deductions and rebuilt
 * total_deductions / net_salary with no role guard, no audit row, no
 * company filter, and a formula that dropped late_coming_deduction and
 * early_exit_deduction — so any call silently raised net pay and created
 * drift. It had no caller. It now answers 410 Gone and writes nothing.
 *
 * Harness mirrors holdReleaseRoute.test.js: the real payroll router on a
 * real express + http server, :memory: SQLite, mocked db + roles modules.
 */

'use strict';

const Database = require('better-sqlite3');
const express = require('express');
const http = require('http');

jest.mock('../database/db', () => {
  const state = { db: null, auditCalls: [] };
  return {
    __testSetDb: (d) => { state.db = d; },
    __testAuditCalls: () => state.auditCalls,
    __testResetAudit: () => { state.auditCalls = []; },
    getDb: () => state.db,
    logAudit: (...args) => { state.auditCalls.push(args); },
  };
});

jest.mock('../middleware/roles', () => ({
  requireFinanceOrAdmin: (_req, _res, next) => next(),
  requireHrOrAdmin: (_req, _res, next) => next(),
  requireAdmin: (_req, _res, next) => next(),
  requirePermission: () => (_req, _res, next) => next(),
  roleIn: () => true,
}));

const dbMock = require('../database/db');
const router = require('../routes/payroll');

const RETIRED_ERROR =
  'This endpoint has been retired. Advance, TDS and other deductions are derived in Stage 7.';

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
      company TEXT,
      gross_earned REAL,
      pf_employee REAL DEFAULT 0,
      esi_employee REAL DEFAULT 0,
      professional_tax REAL DEFAULT 0,
      tds REAL DEFAULT 0,
      advance_recovery REAL DEFAULT 0,
      lop_deduction REAL DEFAULT 0,
      other_deductions REAL DEFAULT 0,
      loan_recovery REAL DEFAULT 0,
      late_coming_deduction REAL DEFAULT 0,
      early_exit_deduction REAL DEFAULT 0,
      total_deductions REAL,
      net_salary REAL,
      ot_pay REAL DEFAULT 0,
      holiday_duty_pay REAL DEFAULT 0,
      ed_pay REAL DEFAULT 0,
      total_payable REAL,
      take_home REAL,
      salary_held INTEGER DEFAULT 0,
      hold_released INTEGER DEFAULT 0,
      hold_released_by TEXT,
      hold_released_at TEXT,
      hold_reason TEXT,
      UNIQUE (employee_code, month, year, company)
    );

    CREATE TABLE employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT,
      department TEXT
    );
  `);

  db.prepare('INSERT INTO employees (code, name, department) VALUES (?, ?, ?)')
    .run('E001', 'Test User', 'PRODUCTION');

  // Internally consistent rows with nonzero late/early deductions — exactly
  // the buckets the old handler dropped from its recompute.
  // deductions = 1200 + 150 + 500(adv) + 300(late) + 214.29(early) = 2364.29
  const ins = db.prepare(`
    INSERT INTO salary_computations
      (employee_code, month, year, company, gross_earned, pf_employee, esi_employee,
       advance_recovery, late_coming_deduction, early_exit_deduction,
       total_deductions, net_salary, ot_pay, ed_pay, total_payable, take_home,
       salary_held, hold_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  ins.run('E001', 4, 2026, 'Indriyan Beverages', 20000, 1200, 150, 500, 300, 214.29,
          2364.29, 17635.71, 1000, 500, 18635.71, 19135.71, 1, 'Auto-hold: payable_days < 5');
  // Same employee/month, second company — the old WHERE had no company and
  // would have rewritten both.
  ins.run('E001', 4, 2026, 'Asian Lakto Ind Ltd', 10000, 600, 75, 0, 0, 0,
          675, 9325, 0, 0, 9325, 9325, 0, null);

  return db;
}

function makeApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
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

const ADMIN = { role: 'admin', username: 'test_admin' };
const VIEWER = { role: 'viewer', username: 'test_viewer' };
const FINANCE = { role: 'finance', username: 'test_finance' };

const snapshot = (db) =>
  JSON.stringify(db.prepare('SELECT * FROM salary_computations ORDER BY id').all());
const driftRows = (db) =>
  db.prepare('SELECT id FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1').all();

const FULL_BODY = { month: 4, year: 2026, advanceRecovery: 0, tds: 9999, otherDeductions: 0 };

let testDb;
let consoleErrSpy;

beforeEach(() => {
  testDb = setupTestDb();
  dbMock.__testSetDb(testDb);
  dbMock.__testResetAudit();
  consoleErrSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (consoleErrSpy) consoleErrSpy.mockRestore();
  if (testDb) testDb.close();
});

describe('PUT /api/payroll/salary/:code/manual-deductions — retired', () => {
  test('T1 admin gets 410 Gone with the retirement message', async () => {
    const res = await callRoute(makeApp(ADMIN), {
      method: 'PUT', path: '/api/payroll/salary/E001/manual-deductions', body: FULL_BODY,
    });
    expect(res.statusCode).toBe(410);
    expect(res.body).toEqual({ success: false, error: RETIRED_ERROR });
  });

  test('T2 salary_computations rows byte-identical, zero drift, no audit/protected_writes rows', async () => {
    const before = snapshot(testDb);
    expect(driftRows(testDb)).toHaveLength(0);

    const res = await callRoute(makeApp(ADMIN), {
      method: 'PUT', path: '/api/payroll/salary/E001/manual-deductions', body: FULL_BODY,
    });
    expect(res.statusCode).toBe(410);

    expect(snapshot(testDb)).toBe(before);
    expect(driftRows(testDb)).toHaveLength(0);
    // Late/early buckets still counted in total_deductions (the old bug dropped them).
    const row = testDb.prepare(
      "SELECT total_deductions, net_salary, tds FROM salary_computations WHERE company='Indriyan Beverages'"
    ).get();
    expect(row).toEqual({ total_deductions: 2364.29, net_salary: 17635.71, tds: 0 });
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM protected_writes').get().n).toBe(0);
    expect(dbMock.__testAuditCalls()).toHaveLength(0);
  });

  test('T3 viewer and empty-body callers also get 410 and nothing is written', async () => {
    const before = snapshot(testDb);
    const asViewer = await callRoute(makeApp(VIEWER), {
      method: 'PUT', path: '/api/payroll/salary/E001/manual-deductions', body: FULL_BODY,
    });
    const emptyBody = await callRoute(makeApp(ADMIN), {
      method: 'PUT', path: '/api/payroll/salary/E001/manual-deductions',
    });
    for (const res of [asViewer, emptyBody]) {
      expect(res.statusCode).toBe(410);
      expect(res.body).toEqual({ success: false, error: RETIRED_ERROR });
    }
    expect(snapshot(testDb)).toBe(before);
    expect(dbMock.__testAuditCalls()).toHaveLength(0);
  });

  test('T4 neighbouring payroll routes still mount: hold-release 200, payslips/bulk 403', async () => {
    const app = makeApp(FINANCE);
    // hold-release looks up by (code, month, year) with no company, so use a
    // single-company held employee to keep this a pure mount check.
    testDb.prepare('INSERT INTO employees (code, name, department) VALUES (?, ?, ?)')
      .run('E002', 'Held User', 'PRODUCTION');
    testDb.prepare(`
      INSERT INTO salary_computations
        (employee_code, month, year, company, gross_earned, total_deductions, net_salary, salary_held, hold_reason)
      VALUES ('E002', 4, 2026, 'Indriyan Beverages', 8000, 0, 8000, 1, 'Auto-hold: payable_days < 5')
    `).run();
    const rel = await callRoute(app, {
      method: 'PUT', path: '/api/payroll/salary/E002/hold-release',
      body: { month: 4, year: 2026, release_notes: 'Approved per HR Form #2026-10-09-01' },
    });
    expect(rel.statusCode).toBe(200);
    expect(rel.body).toEqual({ success: true, message: 'Salary released for E002' });
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM salary_hold_releases').get().n).toBe(1);

    const bulk = await callRoute(app, { method: 'GET', path: '/api/payroll/payslips/bulk' });
    expect(bulk.statusCode).toBe(403);
  });

  test('T5 only PUT is registered on the retired path — GET falls through to 404', async () => {
    const res = await callRoute(makeApp(ADMIN), {
      method: 'GET', path: '/api/payroll/salary/E001/manual-deductions',
    });
    expect(res.statusCode).toBe(404);
  });
});

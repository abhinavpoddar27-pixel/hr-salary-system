/**
 * PUT /api/payroll/day-calculations/:code/late-deduction is RETIRED (Oct 2026).
 *
 * The old handler cut total_payable_days / raised lop_days directly — no
 * finance approval, outside the Attendance Review, 0–5 days at HR's say. Late
 * and early-exit deductions are now decided only in Analytics → Attendance
 * Review and reach salary through finance approval. The route answers 410
 * Gone and writes nothing — including the "Remove" call (deductionDays 0),
 * because removing a stored cut is also a payroll change that needs a decision.
 *
 * Values already stored in day_calculations.late_deduction_days are left as
 * they are; recompute.js still re-applies them on a Stage 6 re-run (covered by
 * recomputeParity.test.js "preserves HR's late deduction").
 *
 * Harness mirrors manualDeductionsRetired.test.js: the real payroll router on a
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
  'This endpoint has been retired. Late deductions are decided in Analytics → Attendance Review and approved by finance.';

function setupTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  db.exec(`
    CREATE TABLE day_calculations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      company TEXT,
      total_payable_days REAL,
      lop_days REAL,
      late_count INTEGER DEFAULT 0,
      late_deduction_days REAL DEFAULT 0,
      late_deduction_remark TEXT,
      UNIQUE (employee_code, month, year, company)
    );
  `);
  const ins = db.prepare(`INSERT INTO day_calculations
    (employee_code, month, year, company, total_payable_days, lop_days, late_count, late_deduction_days, late_deduction_remark)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  // A person with no cut yet (the old button would have cut days here) …
  ins.run('E001', 10, 2026, 'Indriyan Beverages', 26, 0, 9, 0, null);
  // … and a person with a legacy cut already stored (must stay exactly as is).
  ins.run('E002', 8, 2026, 'Indriyan Beverages', 24, 2, 12, 2, 'Late deduction: 2 day(s)');
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
        hostname: '127.0.0.1', port, path, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': data ? Buffer.byteLength(data) : 0 },
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

const HR = { role: 'hr', username: 'test_hr' };
const ADMIN = { role: 'admin', username: 'test_admin' };

const snapshot = (db) => JSON.stringify(db.prepare('SELECT * FROM day_calculations ORDER BY id').all());

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

describe('PUT /api/payroll/day-calculations/:code/late-deduction — retired', () => {
  test('T1 HR applying a cut gets 410 Gone with the retirement message; nothing is written', async () => {
    const before = snapshot(testDb);
    const res = await callRoute(makeApp(HR), {
      method: 'PUT', path: '/api/payroll/day-calculations/E001/late-deduction',
      body: { month: 10, year: 2026, deductionDays: 2, remark: 'late' },
    });
    expect(res.statusCode).toBe(410);
    expect(res.body).toEqual({ success: false, error: RETIRED_ERROR });
    expect(snapshot(testDb)).toBe(before);
    const row = testDb.prepare("SELECT total_payable_days, lop_days, late_deduction_days FROM day_calculations WHERE employee_code='E001'").get();
    expect(row).toEqual({ total_payable_days: 26, lop_days: 0, late_deduction_days: 0 });
    expect(dbMock.__testAuditCalls()).toHaveLength(0);
  });

  test('T2 "Remove" (deductionDays 0) on a stored legacy cut also gets 410 and the cut stays', async () => {
    const res = await callRoute(makeApp(ADMIN), {
      method: 'PUT', path: '/api/payroll/day-calculations/E002/late-deduction',
      body: { month: 8, year: 2026, deductionDays: 0, remark: '' },
    });
    expect(res.statusCode).toBe(410);
    const row = testDb.prepare("SELECT total_payable_days, lop_days, late_deduction_days, late_deduction_remark FROM day_calculations WHERE employee_code='E002'").get();
    expect(row).toEqual({ total_payable_days: 24, lop_days: 2, late_deduction_days: 2, late_deduction_remark: 'Late deduction: 2 day(s)' });
  });

  test('T3 values the old handler rejected (out of range, empty body, unknown code) also get 410, not 400/404', async () => {
    const before = snapshot(testDb);
    const app = makeApp(HR);
    const calls = [
      { path: '/api/payroll/day-calculations/E001/late-deduction', body: { month: 10, year: 2026, deductionDays: 9 } },
      { path: '/api/payroll/day-calculations/E001/late-deduction' },
      { path: '/api/payroll/day-calculations/NOPE/late-deduction', body: { month: 10, year: 2026, deductionDays: 1 } },
    ];
    for (const c of calls) {
      const res = await callRoute(app, { method: 'PUT', ...c });
      expect(res.statusCode).toBe(410);
      expect(res.body).toEqual({ success: false, error: RETIRED_ERROR });
    }
    expect(snapshot(testDb)).toBe(before);
  });

  test('T4 the handler no longer touches the database at all (getDb is never needed)', async () => {
    dbMock.__testSetDb(null); // any db access would throw → 500
    const res = await callRoute(makeApp(HR), {
      method: 'PUT', path: '/api/payroll/day-calculations/E001/late-deduction',
      body: { month: 10, year: 2026, deductionDays: 1 },
    });
    expect(res.statusCode).toBe(410);
  });
});

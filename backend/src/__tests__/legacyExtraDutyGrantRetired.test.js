/**
 * Legacy Stage 6 / Payable OT "Grant Extra Duty" is RETIRED (Oct 2026, owner Q5).
 *
 * POST /api/payroll/grant-extra-duty and DELETE /api/payroll/revoke-extra-duty/:id
 * wrote day_corrections rows (correction_type='extra_duty') that no pay
 * calculation reads. They now answer 410 and write nothing. The read-only
 * GET /api/payroll/extra-duty-grants list keeps working for old rows.
 *
 * Harness mirrors manualDeductionsRetired.test.js: real payroll router on a
 * real express + http server, :memory: SQLite, mocked db + roles modules.
 */

'use strict';

const Database = require('better-sqlite3');
const express = require('express');
const http = require('http');

jest.mock('../database/db', () => {
  const state = { db: null };
  return {
    __testSetDb: (d) => { state.db = d; },
    getDb: () => state.db,
    logAudit: () => {},
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

function setupTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE employees (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, name TEXT, department TEXT, company TEXT);
    CREATE TABLE day_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER, employee_code TEXT NOT NULL,
      month INTEGER NOT NULL, year INTEGER NOT NULL, company TEXT,
      original_system_days REAL, corrected_days REAL, correction_delta REAL,
      correction_reason TEXT, correction_notes TEXT, corrected_by TEXT,
      corrected_at TEXT DEFAULT (datetime('now')), correction_type TEXT,
      finance_verified INTEGER DEFAULT 0, remark TEXT,
      UNIQUE (employee_code, month, year, company)
    );
  `);
  db.prepare("INSERT INTO employees (code, name, department, company) VALUES ('T9701','Test Person','PRODUCTION','Test Co')").run();
  // One legacy row from before the retirement.
  db.prepare(`INSERT INTO day_corrections (employee_id, employee_code, month, year, company,
    original_system_days, corrected_days, correction_delta, correction_reason, corrected_by,
    correction_type, finance_verified, remark)
    VALUES (1,'T9701',3,2026,'Test Co',0,2,2,'EXTRA_DUTY','test_finance','extra_duty',1,'old grant')`).run();
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
      const data = body !== undefined ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1', port: server.address().port, path, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': data ? Buffer.byteLength(data) : 0 },
      }, (res) => {
        let chunks = '';
        res.on('data', (c) => { chunks += c; });
        res.on('end', () => {
          server.close();
          let parsed = chunks;
          try { parsed = chunks ? JSON.parse(chunks) : null; } catch (_) { /* raw */ }
          resolve({ statusCode: res.statusCode, body: parsed });
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (data) req.write(data);
      req.end();
    });
  });
}

const FINANCE = { role: 'finance', username: 'test_finance' };
const ADMIN = { role: 'admin', username: 'test_admin' };
const snap = (db) => JSON.stringify(db.prepare('SELECT * FROM day_corrections ORDER BY id').all());

let db;
beforeEach(() => { db = setupTestDb(); dbMock.__testSetDb(db); });

describe('legacy extra-duty grant retired', () => {
  test.each([FINANCE, ADMIN])('grant answers 410 and writes nothing (%o)', async (user) => {
    const before = snap(db);
    const r = await callRoute(makeApp(user), { method: 'POST', path: '/api/payroll/grant-extra-duty',
      body: { employeeCode: 'T9701', month: 4, year: 2026, days: 1, remark: 'x' } });
    expect(r.statusCode).toBe(410);
    expect(r.body.success).toBe(false);
    expect(r.body.error).toMatch(/Extra Duty Grants page/);
    expect(snap(db)).toBe(before);
  });

  test('grant on an employee-month that already has a legacy row does not add to it', async () => {
    const before = snap(db);
    const r = await callRoute(makeApp(FINANCE), { method: 'POST', path: '/api/payroll/grant-extra-duty',
      body: { employeeCode: 'T9701', month: 3, year: 2026, days: 3 } });
    expect(r.statusCode).toBe(410);
    expect(snap(db)).toBe(before);
  });

  test('grant with an empty body still answers 410 (not 400)', async () => {
    const r = await callRoute(makeApp(FINANCE), { method: 'POST', path: '/api/payroll/grant-extra-duty', body: {} });
    expect(r.statusCode).toBe(410);
  });

  test('revoke answers 410 and the legacy row stays', async () => {
    const before = snap(db);
    const r = await callRoute(makeApp(ADMIN), { method: 'DELETE', path: '/api/payroll/revoke-extra-duty/1' });
    expect(r.statusCode).toBe(410);
    expect(snap(db)).toBe(before);
    expect(db.prepare('SELECT COUNT(*) n FROM day_corrections').get().n).toBe(1);
  });

  test('read-only list still returns the legacy row', async () => {
    const r = await callRoute(makeApp(FINANCE), { method: 'GET', path: '/api/payroll/extra-duty-grants?month=3&year=2026' });
    expect(r.statusCode).toBe(200);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].days).toBe(2);
  });
});

/**
 * Loans PR-6 — the hold-release guard on PUT /api/payroll/salary/:code/hold-release
 * (docs/loans/SPEC.md §5.2 r8, K28; coordinator change 10 Oct 2026).
 *
 * Real payroll router over a real http server, on a full initSchema database.
 *  - With an empty loan ledger the route behaves exactly as before PR-6.
 *  - A held month whose instalment moved to the end (held past the wait) is
 *    refused with 409 LOAN_ROW_STALE until Stage 7 is re-run for the employee.
 */
'use strict';

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
  requireFinanceOrAdmin: (req, _res, next) => { req.user = req.user || { role: 'finance', username: 'test_finance' }; next(); },
  requireHrOrAdmin: (_req, _res, next) => next(),
  requireAdmin: (_req, _res, next) => next(),
  requirePermission: () => (_req, _res, next) => next(),
  roleIn: () => true,
}));

const dbMock = require('../database/db');
const router = require('../routes/payroll');
const LF = require('./helpers/loanFixture');
const { F, COMPANY } = LF;
const { recomputeSalary } = require('../services/recompute');
const C = require('../services/loans/close');

const CLOSE_AT = new Date(Date.UTC(2026, 11, 13, 1, 0, 0));
const stage7 = (db, opts = {}) => F.silently(() => recomputeSalary(db, { month: 11, year: 2026, company: COMPANY, requestId: 'r', ...opts }));
const salary = (db, code) => db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = 11 AND year = 2026').get(code);
const counts = (db) => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
  .map(({ name }) => [name, db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n]));

function put(code, body) {
  const app = express();
  app.use(express.json());
  app.use('/api/payroll', router);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const data = JSON.stringify(body);
      const req = http.request({
        hostname: '127.0.0.1', port: server.address().port, path: `/api/payroll/salary/${code}/hold-release`, method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      }, (res) => {
        let chunks = '';
        res.on('data', (c) => { chunks += c; });
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: JSON.parse(chunks) }); });
      });
      req.on('error', (e) => { server.close(); reject(e); });
      req.write(data);
      req.end();
    });
  });
}

let db;
beforeEach(() => { db = F.newDb(); dbMock.__testSetDb(db); });
afterEach(() => { db.close(); });

test('empty loan ledger: the release behaves exactly as before PR-6', async () => {
  const emp = LF.plant(db);
  F.addDayCalc(db, emp, 11, 2026, { days_present: 2, total_payable_days: 2 });
  stage7(db);
  expect(salary(db, emp.code).salary_held).toBe(1);
  const before = counts(db);
  const res = await put(emp.code, { month: 11, year: 2026, release_notes: 'paper ref #1' });
  expect(res).toEqual({ status: 200, body: { success: true, message: `Salary released for ${emp.code}` } });
  expect(salary(db, emp.code)).toMatchObject({ salary_held: 0, hold_released: 1, hold_released_by: 'test_finance' });
  const after = counts(db);
  expect(after.salary_hold_releases).toBe(before.salary_hold_releases + 1);
  expect(after.protected_writes).toBe(before.protected_writes + 1);
  // nothing else in any table changed in count — the loan guard wrote nothing
  for (const t of Object.keys(before).filter((k) => !['salary_hold_releases', 'protected_writes'].includes(k))) {
    expect([t, after[t]]).toEqual([t, before[t]]);
  }
  // not held → the existing 400, unchanged
  const again = await put(emp.code, { month: 11, year: 2026, release_notes: 'paper ref #1' });
  expect(again).toEqual({ status: 400, body: { success: false, error: 'Salary is not currently held' } });
});

test('held past the wait: 409 LOAN_ROW_STALE and nothing written; after the Stage 7 re-run the release goes through', async () => {
  const { loanId, emp } = LF.activeLoan(db);
  F.addDayCalc(db, emp, 11, 2026, { days_present: 2, total_payable_days: 2 });
  stage7(db);
  F.silently(() => C.runLoanClose(db, { month: 11, year: 2026, now: CLOSE_AT }));
  F.silently(() => C.runHeldSweep(db, { now: new Date(CLOSE_AT.getTime() + 60 * 86400000) }));
  expect(db.prepare('SELECT state FROM loan_deductions WHERE loan_id = ?').get(loanId).state).toBe('reversed');
  const before = counts(db);
  const res = await put(emp.code, { month: 11, year: 2026, release_notes: 'paper ref #2' });
  expect(res.status).toBe(409);
  expect(res.body).toMatchObject({ success: false, code: 'LOAN_ROW_STALE' });
  expect(res.body.error).toMatch(/Re-run Stage 7/);
  expect(counts(db)).toEqual(before);
  expect(salary(db, emp.code).salary_held).toBe(1);

  stage7(db, { employeeCodes: [emp.code] });
  expect(salary(db, emp.code)).toMatchObject({ salary_held: 1, loan_recovery: 0 });
  const ok = await put(emp.code, { month: 11, year: 2026, release_notes: 'paper ref #2' });
  expect(ok.status).toBe(200);
  expect(salary(db, emp.code).salary_held).toBe(0);
});

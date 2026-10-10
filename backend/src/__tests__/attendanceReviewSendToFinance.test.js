/**
 * PR-2 — the Attendance Review is the only place a late / early-exit deduction is decided.
 *
 *  - POST /api/analytics/attendance-review/runs/:id/send-to-finance turns a FINAL run's deductions into PENDING
 *    late_coming_deductions rows (finance approves them in the usual queue; Stage 7 applies approved rows).
 *  - Warnings, zero-day lines and draft runs send nothing. A person who already has a pending/approved row for the month
 *    is skipped and reported, never duplicated; a second click creates nothing.
 *  - GET /runs/:id/finance shows where each sent row is, plus rows entered outside the review.
 *  - POST /api/late-coming/deduction (the second way to cut pay) answers 410 and writes nothing.
 *
 * Fixture codes and amounts are synthetic. Harness: real routers on express + http, :memory: SQLite, mocked db + roles.
 */

'use strict';

const Database = require('better-sqlite3');
const express = require('express');
const http = require('http');

jest.mock('../database/db', () => {
  const state = { db: null, audit: [] };
  return {
    __set: (d) => { state.db = d; },
    __audit: () => state.audit,
    getDb: () => state.db,
    logAudit: (...a) => { state.audit.push(a); },
  };
});
jest.mock('../middleware/roles', () => ({
  requireFinanceOrAdmin: (_q, _s, n) => n(),
  requireHrOrAdmin: (_q, _s, n) => n(),
  requireAdmin: (_q, _s, n) => n(),
  requirePermission: () => (_q, _s, n) => n(),
  roleIn: () => true,
}));

const dbMock = require('../database/db');
const reviewRouter = require('../routes/attendanceReview');
const lateRouter = require('../routes/lateComing');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE employees (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, name TEXT, company TEXT,
      employment_type TEXT DEFAULT 'Permanent', is_contractor INTEGER DEFAULT 0);
    CREATE TABLE attendance_review_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, month INTEGER NOT NULL, year INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft', config_snapshot TEXT NOT NULL, release_days TEXT NOT NULL DEFAULT '[]',
      overrides TEXT NOT NULL DEFAULT '[]', result_json TEXT NOT NULL, generated_by TEXT NOT NULL,
      generated_at TEXT DEFAULT (datetime('now')), finalised_by TEXT, finalised_at TEXT, UNIQUE(month, year));
    CREATE TABLE late_coming_deductions (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_code TEXT NOT NULL, employee_id INTEGER,
      month INTEGER NOT NULL, year INTEGER NOT NULL, company TEXT, late_count INTEGER NOT NULL, deduction_days REAL NOT NULL,
      remark TEXT NOT NULL, applied_by TEXT NOT NULL, applied_at TEXT DEFAULT (datetime('now')), finance_status TEXT DEFAULT 'pending',
      finance_reviewed_by TEXT, finance_reviewed_at TEXT, finance_remark TEXT, is_applied_to_salary INTEGER DEFAULT 0,
      applied_to_salary_at TEXT, created_at TEXT DEFAULT (datetime('now')), UNIQUE(employee_code, month, year, company, applied_at));
  `);
  const e = db.prepare('INSERT INTO employees (code, name, company, employment_type, is_contractor) VALUES (?,?,?,?,?)');
  e.run('T001', 'Worker A', 'CO-1', 'Permanent', 0);
  e.run('T002', 'Worker B', 'CO-1', 'Permanent', 0);
  e.run('T003', 'Worker C', 'CO-2', 'Contract', 1);
  e.run('T004', 'Worker D', 'CO-1', 'Permanent', 0);
  e.run('T005', 'Worker E', 'CO-1', 'Permanent', 0);
  return db;
}

const actionList = [
  { code: 'T001', name: 'Worker A', action: 'deduction', deduction_days: 1, late_days: 6, early_days: 2, workdays_lost: 1.2 },
  { code: 'T002', name: 'Worker B', action: 'deduction', deduction_days: 0.5, late_days: 0, early_days: 7, workdays_lost: 0.6,
    override: { action: 'include', reason: 'synthetic reason' } },
  { code: 'T003', name: 'Worker C', action: 'deduction', deduction_days: 2, late_days: 9, early_days: 0, workdays_lost: 2.1 },
  { code: 'T004', name: 'Worker D', action: 'warning', deduction_days: 0, late_days: 5, early_days: 0, workdays_lost: 0.9 },
  { code: 'T005', name: 'Worker E', action: 'deduction', deduction_days: 1, late_days: 7, early_days: 0, workdays_lost: 1 },
];

function addRun(db, status, month = 9) {
  return db.prepare(`INSERT INTO attendance_review_runs (month, year, status, config_snapshot, result_json, generated_by)
    VALUES (?, 2026, ?, '{}', ?, 'tester')`).run(month, status, JSON.stringify({ actionList })).lastInsertRowid;
}

let server; let base; let db;
beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use((req, _r, n) => { req.user = { username: 'tester', role: 'admin' }; n(); });
  app.use('/api/analytics/attendance-review', reviewRouter);
  app.use('/api/late-coming', lateRouter);
  server = http.createServer(app).listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; done(); });
});
afterAll((done) => { server.close(done); });
beforeEach(() => { db = makeDb(); dbMock.__set(db); dbMock.__audit().length = 0; });

const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const rows = () => db.prepare('SELECT * FROM late_coming_deductions ORDER BY employee_code, id').all();

describe('send a final review to finance', () => {
  test('one pending row per deduction; warnings are not sent', async () => {
    const id = addRun(db, 'final');
    const r = await call('POST', `/api/analytics/attendance-review/runs/${id}/send-to-finance`);
    expect(r.status).toBe(200);
    expect(r.body.data.created.map((c) => c.code)).toEqual(['T001', 'T002', 'T003', 'T005']);
    const got = rows();
    expect(got.map((x) => [x.employee_code, x.deduction_days, x.finance_status, x.is_applied_to_salary])).toEqual([
      ['T001', 1, 'pending', 0], ['T002', 0.5, 'pending', 0], ['T003', 2, 'pending', 0], ['T005', 1, 'pending', 0]]);
    expect(got.every((x) => x.remark.includes(`[review run ${id}]`) && x.applied_by === 'tester' && x.month === 9 && x.year === 2026)).toBe(true);
    expect(got.find((x) => x.employee_code === 'T003').company).toBe('CO-2');
    expect(got.find((x) => x.employee_code === 'T001').late_count).toBe(6);
    expect(got.find((x) => x.employee_code === 'T002').remark).toContain('override: synthetic reason');
    expect(r.body.data.created.find((c) => c.code === 'T003').contractor).toBe(true);
    expect(dbMock.__audit().filter((a) => a[5] === 'ATTENDANCE_REVIEW_SEND')).toHaveLength(4);
  });

  test('a draft run cannot be sent', async () => {
    const id = addRun(db, 'draft');
    const r = await call('POST', `/api/analytics/attendance-review/runs/${id}/send-to-finance`);
    expect(r.status).toBe(409);
    expect(rows()).toHaveLength(0);
  });

  test('unknown run → 404', async () => {
    expect((await call('POST', '/api/analytics/attendance-review/runs/999/send-to-finance')).status).toBe(404);
  });

  test('a second click creates nothing and says "already sent"', async () => {
    const id = addRun(db, 'final');
    await call('POST', `/api/analytics/attendance-review/runs/${id}/send-to-finance`);
    const r = await call('POST', `/api/analytics/attendance-review/runs/${id}/send-to-finance`);
    expect(r.body.data.created).toHaveLength(0);
    expect(r.body.data.skipped.map((s) => s.reason)).toEqual(Array(4).fill('already sent'));
    expect(rows()).toHaveLength(4);
  });

  test('a person with a pending or approved row from elsewhere is skipped, not duplicated; a rejected row does not block', async () => {
    const ins = db.prepare(`INSERT INTO late_coming_deductions (employee_code, month, year, company, late_count, deduction_days, remark, applied_by, finance_status, applied_at)
      VALUES (?, 9, 2026, 'CO-1', 3, ?, 'entered in the old screen', 'someone', ?, ?)`);
    ins.run('T001', 1, 'approved', '2026-10-01 10:00:00');
    ins.run('T002', 0.5, 'pending', '2026-10-01 10:00:01');
    ins.run('T005', 1, 'rejected', '2026-10-01 10:00:02');
    const id = addRun(db, 'final');
    const r = await call('POST', `/api/analytics/attendance-review/runs/${id}/send-to-finance`);
    expect(r.body.data.created.map((c) => c.code)).toEqual(['T003', 'T005']);
    expect(r.body.data.skipped.map((s) => [s.code, s.reason, s.existing[0].status])).toEqual([
      ['T001', 'a deduction row already exists for this month', 'approved'],
      ['T002', 'a deduction row already exists for this month', 'pending']]);
    expect(rows().filter((x) => x.employee_code === 'T001')).toHaveLength(1);
  });

  test('another month is not a blocker', async () => {
    db.prepare(`INSERT INTO late_coming_deductions (employee_code, month, year, company, late_count, deduction_days, remark, applied_by, finance_status)
      VALUES ('T001', 8, 2026, 'CO-1', 3, 1, 'August', 'someone', 'approved')`).run();
    const id = addRun(db, 'final');
    const r = await call('POST', `/api/analytics/attendance-review/runs/${id}/send-to-finance`);
    expect(r.body.data.created.map((c) => c.code)).toContain('T001');
  });
});

describe('finance status of a run', () => {
  test('shows sent rows by status, and rows entered outside the review', async () => {
    db.prepare(`INSERT INTO late_coming_deductions (employee_code, month, year, company, late_count, deduction_days, remark, applied_by, finance_status)
      VALUES ('T004', 9, 2026, 'CO-1', 3, 1, 'entered in the old screen', 'someone', 'approved')`).run();
    const id = addRun(db, 'final');
    const before = await call('GET', `/api/analytics/attendance-review/runs/${id}/finance`);
    expect(before.body.data.summary.sent).toBe(0);
    expect(before.body.data.preview.create).toHaveLength(4);
    await call('POST', `/api/analytics/attendance-review/runs/${id}/send-to-finance`);
    db.prepare(`UPDATE late_coming_deductions SET finance_status = 'approved' WHERE employee_code = 'T001'`).run();
    db.prepare(`UPDATE late_coming_deductions SET finance_status = 'rejected' WHERE employee_code = 'T002'`).run();
    db.prepare(`UPDATE late_coming_deductions SET finance_status = 'approved', is_applied_to_salary = 1 WHERE employee_code = 'T005'`).run();
    const s = (await call('GET', `/api/analytics/attendance-review/runs/${id}/finance`)).body.data;
    expect(s.summary).toEqual({ sent: 4, pending: 1, approved: 2, rejected: 1, applied: 1, outside: 1 });
    expect(s.outside[0].code).toBe('T004');
    expect(s.sent.find((r) => r.code === 'T005').applied).toBe(true);
  });

  test('a draft run shows no send preview', async () => {
    const id = addRun(db, 'draft');
    expect((await call('GET', `/api/analytics/attendance-review/runs/${id}/finance`)).body.data.preview).toBeNull();
  });
});

describe('the Late Coming screen no longer applies deductions', () => {
  test('POST /api/late-coming/deduction → 410, nothing written', async () => {
    const r = await call('POST', '/api/late-coming/deduction', { employeeCode: 'T001', month: 9, year: 2026, company: 'CO-1', lateCount: 5, deductionDays: 1, remark: 'x' });
    expect(r.status).toBe(410);
    expect(r.body.error).toMatch(/Attendance Review/);
    expect(rows()).toHaveLength(0);
    expect(dbMock.__audit()).toHaveLength(0);
  });
});

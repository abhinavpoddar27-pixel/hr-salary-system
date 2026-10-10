/**
 * Extra duty "Return to HR" (owner ruling 8 Oct 2026).
 *
 * Production case: 19 grants for 2026-09-07 were finance-rejected on 24 Sep.
 * HR tried to re-grant the same people for the same date and got a 500
 * (UNIQUE key), later a 409 with no way forward — a rejected grant was a dead
 * end. Now finance can return a rejected/flagged grant to HR; HR edits it
 * (e.g. 1 → 0.5 day) and approves; finance re-reviews.
 *
 * Real router on a real Express app through a real http server, against a
 * fresh copy of a DB built by the real initSchema() (same pattern as
 * extraDutyGrantsCollision.test.js).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const Database = require('better-sqlite3');

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

// Role comes from the x-test-role header so one app can act as hr or finance.
jest.mock('../middleware/roles', () => {
  const as = (allowed) => (req, res, next) => {
    const role = req.headers['x-test-role'] || allowed[0];
    if (!allowed.includes(role)) return res.status(403).json({ success: false, error: 'forbidden' });
    req.user = { role, username: `test_${role}` };
    next();
  };
  return {
    requireHrOrAdmin: as(['hr', 'admin']),
    requireFinanceOrAdmin: as(['finance', 'admin']),
  };
});

jest.mock('../services/monthEndScheduler', () => ({ createNotification: jest.fn() }));

const dbMock = require('../database/db');
const { createNotification } = require('../services/monthEndScheduler');
const router = require('../routes/extraDutyGrants');
const { initSchema } = require('../database/schema');

const COMPANY = 'Asian Lakto Ind Ltd';
const DATE = '2026-09-07';

let tmpDir, templatePath, testDb, app, caseNo = 0;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edg-return-'));
  templatePath = path.join(tmpDir, 'template.db');
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const t = new Database(templatePath);
  initSchema(t);
  t.close();
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function seed(db) {
  const emp = db.prepare("INSERT INTO employees (code, name, department, company, status) VALUES (?, ?, 'OFFICE ADMIN', ?, 'Active')");
  ['17575', '18766', '22713', '23130', '30001', '30002'].forEach((c, i) => emp.run(c, `EMP${i}`, COMPANY));
  const ins = db.prepare(`
    INSERT INTO extra_duty_grants (employee_code, grant_date, month, year, company, grant_type, duty_days,
      verification_source, remarks, status, finance_status, finance_flag_reason, requested_by, approved_by,
      finance_reviewed_by, finance_reviewed_at, is_processed)
    VALUES (?, ?, 9, 2026, ?, ?, 1, ?, 'bg', ?, ?, ?, 'hr1', ?, ?, ?, ?)
  `);
  const ids = {};
  const add = (key, code, date, o = {}) => {
    const r = ins.run(code, date, COMPANY, o.type || 'OVERNIGHT_STAY', o.source || 'Gate Register',
      o.status || 'APPROVED', o.finance || 'FINANCE_REJECTED', o.reason === undefined ? 'power cut' : o.reason,
      o.status === 'PENDING' ? null : 'hr1', o.finance === 'UNREVIEWED' ? null : 'finance',
      o.finance === 'UNREVIEWED' ? null : '2026-09-24 11:59:17', o.processed || 0);
    ids[key] = Number(r.lastInsertRowid);
  };
  add('rejected', '17575', DATE);
  add('rejected2', '18766', DATE);
  add('flagged', '22713', DATE, { finance: 'FINANCE_FLAGGED', reason: 'MISSING_EVIDENCE' });
  add('approved', '23130', DATE, { finance: 'FINANCE_APPROVED', reason: null });
  add('unreviewed', '30001', DATE, { finance: 'UNREVIEWED', reason: null });
  add('pending', '30002', DATE, { status: 'PENDING', finance: 'UNREVIEWED', reason: null });
  add('auto', '30001', '2026-09-06', { source: 'BIOMETRIC_AUTO' });
  add('pba', '30002', '2026-09-01', { type: 'PRE_BIOMETRIC_ACTIVATION' });
  add('processed', '30001', '2026-09-13', { processed: 1 });
  add('hrRejected', '30002', '2026-09-14', { status: 'REJECTED', finance: 'UNREVIEWED', reason: null });
  return ids;
}

function makeApp() {
  const a = express();
  a.use(express.json());
  a.use('/api/extra-duty-grants', router);
  a.use((err, _req, res, _next) => res.status(err.status || 500).json({ success: false, error: err.message }));
  return a;
}

function call(method, urlPath, body, role) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const data = body !== undefined ? JSON.stringify(body) : null;
      const headers = { 'Content-Type': 'application/json', 'Content-Length': data ? Buffer.byteLength(data) : 0 };
      if (role) headers['x-test-role'] = role;
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: urlPath, method, headers }, (res) => {
        let chunks = '';
        res.on('data', (c) => { chunks += c; });
        res.on('end', () => {
          server.close();
          let parsed = null;
          try { parsed = chunks ? JSON.parse(chunks) : null; } catch (_) { parsed = { raw: chunks }; }
          resolve({ statusCode: res.statusCode, body: parsed });
        });
      });
      req.on('error', (e) => { server.close(); reject(e); });
      if (data) req.write(data);
      req.end();
    });
  });
}

const row = (id) => testDb.prepare('SELECT * FROM extra_duty_grants WHERE id = ?').get(id);
const allRows = () => testDb.prepare('SELECT * FROM extra_duty_grants ORDER BY id').all();
const rowsExcept = (...ids) => allRows().filter(r => !ids.includes(r.id));
const BASE = '/api/extra-duty-grants';

let ids;
beforeEach(() => {
  caseNo += 1;
  const p = path.join(tmpDir, `case-${caseNo}.db`);
  fs.copyFileSync(templatePath, p);
  testDb = new Database(p);
  ids = seed(testDb);
  dbMock.__testSetDb(testDb);
  dbMock.__testResetAudit();
  createNotification.mockClear();
  app = makeApp();
});
afterEach(() => { if (testDb) testDb.close(); });

describe('POST /:id/finance-return', () => {
  test('finance-rejected grant goes back to HR as PENDING/UNREVIEWED with the note; old reason audited', async () => {
    const others = rowsExcept(ids.rejected);
    const res = await call('POST', `${BASE}/${ids.rejected}/finance-return`, { return_reason: '  Give 0.5 day, power cut  ' }, 'finance');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });

    const r = row(ids.rejected);
    expect(r).toMatchObject({
      status: 'PENDING', finance_status: 'UNREVIEWED', approved_by: null, approved_at: null,
      finance_flag_reason: null, finance_reviewed_by: null, finance_reviewed_at: null,
      finance_notes: 'Returned by finance (test_finance): Give 0.5 day, power cut',
      duty_days: 1, grant_date: DATE, employee_code: '17575',
    });
    expect(rowsExcept(ids.rejected)).toEqual(others);

    const audits = dbMock.__testAuditCalls();
    expect(audits).toHaveLength(2);
    expect(audits[0].slice(0, 6)).toEqual(['extra_duty_grants', ids.rejected, 'finance_status', 'FINANCE_REJECTED', 'UNREVIEWED', 'FINANCE_RETURN']);
    expect(audits[0][6]).toContain('Previous finance reason: "power cut"');
    expect(audits[0][6]).toContain('Return reason: "Give 0.5 day, power cut"');
    expect(audits[0][7]).toBe('test_finance');
    expect(audits[1].slice(2, 6)).toEqual(['status', 'APPROVED', 'PENDING', 'FINANCE_RETURN']);
    expect(createNotification).toHaveBeenCalledWith('hr', 'ED_GRANT_RETURNED', expect.stringContaining('17575'), '/extra-duty-grants');
  });

  test('finance-flagged grant can be returned too', async () => {
    const res = await call('POST', `${BASE}/${ids.flagged}/finance-return`, { return_reason: 'attach the gate entry' }, 'finance');
    expect(res.statusCode).toBe(200);
    expect(row(ids.flagged)).toMatchObject({ status: 'PENDING', finance_status: 'UNREVIEWED', finance_flag_reason: null });
  });

  test('admin may return; HR may not (403, nothing changes)', async () => {
    const before = allRows();
    const hr = await call('POST', `${BASE}/${ids.rejected}/finance-return`, { return_reason: 'hr trying' }, 'hr');
    expect(hr.statusCode).toBe(403);
    expect(allRows()).toEqual(before);
    const admin = await call('POST', `${BASE}/${ids.rejected}/finance-return`, { return_reason: 'admin returns' }, 'admin');
    expect(admin.statusCode).toBe(200);
    expect(row(ids.rejected).finance_notes).toBe('Returned by finance (test_admin): admin returns');
  });

  test.each([
    ['approved', 409, /Only finance-rejected or flagged/],
    ['unreviewed', 409, /Only finance-rejected or flagged/],
    ['pending', 409, /Only finance-rejected or flagged/],
    ['hrRejected', 409, /Only finance-rejected or flagged/],
    ['auto', 409, /System-generated/],
    ['pba', 409, /Pre-biometric/],
    ['processed', 409, /already processed/],
  ])('%s grant cannot be returned (%i), DB unchanged, no audit', async (key, code, msg) => {
    const before = allRows();
    const res = await call('POST', `${BASE}/${ids[key]}/finance-return`, { return_reason: 'some reason' }, 'finance');
    expect(res.statusCode).toBe(code);
    expect(res.body.error).toMatch(msg);
    expect(allRows()).toEqual(before);
    expect(dbMock.__testAuditCalls()).toHaveLength(0);
    expect(createNotification).not.toHaveBeenCalled();
  });

  test('missing / too-short reason → 400; unknown id → 404', async () => {
    const before = allRows();
    expect((await call('POST', `${BASE}/${ids.rejected}/finance-return`, {}, 'finance')).statusCode).toBe(400);
    expect((await call('POST', `${BASE}/${ids.rejected}/finance-return`, { return_reason: ' ab ' }, 'finance')).statusCode).toBe(400);
    expect((await call('POST', `${BASE}/999999/finance-return`, { return_reason: 'some reason' }, 'finance')).statusCode).toBe(404);
    expect(allRows()).toEqual(before);
  });

  test('returning twice: second call 409 (already pending)', async () => {
    await call('POST', `${BASE}/${ids.rejected}/finance-return`, { return_reason: 'first time' }, 'finance');
    const res = await call('POST', `${BASE}/${ids.rejected}/finance-return`, { return_reason: 'second time' }, 'finance');
    expect(res.statusCode).toBe(409);
    expect(row(ids.rejected).finance_notes).toContain('first time');
  });
});

describe('POST /bulk-finance-return', () => {
  test('returns the eligible ones, skips the rest with reasons, one notification', async () => {
    const untouched = rowsExcept(ids.rejected, ids.rejected2, ids.flagged);
    const res = await call('POST', `${BASE}/bulk-finance-return`,
      { ids: [ids.rejected, ids.rejected2, ids.flagged, ids.approved, ids.pba, 999999], return_reason: 'Power cut: 0.5 day only' }, 'finance');
    expect(res.statusCode).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.skipped.map(s => s.id).sort()).toEqual([ids.approved, ids.pba, 999999].sort());
    for (const k of ['rejected', 'rejected2', 'flagged']) {
      expect(row(ids[k])).toMatchObject({ status: 'PENDING', finance_status: 'UNREVIEWED' });
    }
    expect(rowsExcept(ids.rejected, ids.rejected2, ids.flagged)).toEqual(untouched);
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification.mock.calls[0][2]).toBe('Finance returned 3 extra duty grants for correction');
  });

  test('empty ids or short reason → 400, nothing changes; HR → 403', async () => {
    const before = allRows();
    expect((await call('POST', `${BASE}/bulk-finance-return`, { ids: [], return_reason: 'valid reason' }, 'finance')).statusCode).toBe(400);
    expect((await call('POST', `${BASE}/bulk-finance-return`, { ids: [ids.rejected], return_reason: 'x' }, 'finance')).statusCode).toBe(400);
    expect((await call('POST', `${BASE}/bulk-finance-return`, { ids: [ids.rejected], return_reason: 'valid reason' }, 'hr')).statusCode).toBe(403);
    expect(allRows()).toEqual(before);
  });
});

describe('PUT /:id — HR edit of a pending grant', () => {
  test('edits allowed fields, audits each change, ignores status/finance fields in the body', async () => {
    const res = await call('PUT', `${BASE}/${ids.pending}`,
      { duty_days: 0.5, remarks: 'half day', reference_number: 'GR-7', status: 'APPROVED', finance_status: 'FINANCE_APPROVED', employee_code: '99999' }, 'hr');
    expect(res.statusCode).toBe(200);
    expect(res.body.changed.sort()).toEqual(['duty_days', 'reference_number', 'remarks']);
    expect(row(ids.pending)).toMatchObject({
      duty_days: 0.5, remarks: 'half day', reference_number: 'GR-7',
      status: 'PENDING', finance_status: 'UNREVIEWED', employee_code: '30002',
    });
    const audits = dbMock.__testAuditCalls();
    expect(audits).toHaveLength(3);
    expect(audits.find(a => a[2] === 'duty_days').slice(3, 6)).toEqual([1, 0.5, 'HR_EDIT']);
  });

  test('no actual change → changed [] and no audit', async () => {
    const res = await call('PUT', `${BASE}/${ids.pending}`, { duty_days: 1, remarks: 'bg' }, 'hr');
    expect(res.body).toEqual({ success: true, changed: [] });
    expect(dbMock.__testAuditCalls()).toHaveLength(0);
  });

  test.each([[0], [0.3], [2.5], [-1], ['abc']])('duty_days %p → 400', async (d) => {
    const before = allRows();
    const res = await call('PUT', `${BASE}/${ids.pending}`, { duty_days: d }, 'hr');
    expect(res.statusCode).toBe(400);
    expect(allRows()).toEqual(before);
  });

  test('bad grant_type / blank or BIOMETRIC_AUTO source → 400', async () => {
    expect((await call('PUT', `${BASE}/${ids.pending}`, { grant_type: 'PRE_BIOMETRIC_ACTIVATION' }, 'hr')).statusCode).toBe(400);
    expect((await call('PUT', `${BASE}/${ids.pending}`, { verification_source: '  ' }, 'hr')).statusCode).toBe(400);
    expect((await call('PUT', `${BASE}/${ids.pending}`, { verification_source: 'BIOMETRIC_AUTO' }, 'hr')).statusCode).toBe(400);
  });

  test.each(['rejected', 'approved', 'unreviewed', 'hrRejected', 'auto', 'pba', 'processed'])(
    '%s grant cannot be edited (409), DB unchanged', async (key) => {
      const before = allRows();
      const res = await call('PUT', `${BASE}/${ids[key]}`, { duty_days: 0.5 }, 'hr');
      expect(res.statusCode).toBe(409);
      expect(allRows()).toEqual(before);
    });

  test('finance cannot edit (403); unknown id 404', async () => {
    expect((await call('PUT', `${BASE}/${ids.pending}`, { duty_days: 0.5 }, 'finance')).statusCode).toBe(403);
    expect((await call('PUT', `${BASE}/999999`, { duty_days: 0.5 }, 'hr')).statusCode).toBe(404);
  });
});

describe('POST / — re-entering a date finance turned down', () => {
  test('manual finance-rejected row: 409 now tells HR to ask finance to Return to HR', async () => {
    const before = allRows();
    const res = await call('POST', BASE, {
      employee_code: '17575', grant_date: DATE, month: 9, year: 2026, company: COMPANY,
      duty_days: 0.5, verification_source: 'Gate Register',
    }, 'hr');
    expect(res.statusCode).toBe(409);
    expect(res.body.grant_id).toBe(ids.rejected);
    expect(res.body.error).toBe(
      `A grant already exists for this employee on ${DATE} (status: APPROVED, finance: FINANCE_REJECTED, source: Gate Register). Open that row instead.`
      + ' Finance rejected it — ask finance to use "Return to HR" on that row; then correct it and approve it again.');
    expect(allRows()).toEqual(before);
  });

  test('manual flagged row gets its own hint; approved row keeps the old text', async () => {
    const flagged = await call('POST', BASE, { employee_code: '22713', grant_date: DATE, month: 9, year: 2026, verification_source: 'Gate Register' }, 'hr');
    expect(flagged.body.error).toMatch(/Finance flagged it — finance can approve it or use "Return to HR"/);
    const approved = await call('POST', BASE, { employee_code: '23130', grant_date: DATE, month: 9, year: 2026, verification_source: 'Gate Register' }, 'hr');
    expect(approved.body.error).toMatch(/Open that row instead\.$/);
  });
});

describe('end to end: the 7 Sept case', () => {
  test('rejected 1 day → return → HR edits to 0.5 → HR approves → finance approves → paid as 0.5', async () => {
    // What Stage 6/7 select (services/recompute.js + salaryComputation.js): both approvals.
    const paidGrants = () => testDb.prepare(`
      SELECT grant_date, duty_days FROM extra_duty_grants
      WHERE employee_code = '17575' AND month = 9 AND year = 2026
        AND status = 'APPROVED' AND finance_status = 'FINANCE_APPROVED'`).all();
    expect(paidGrants()).toEqual([]);

    expect((await call('POST', `${BASE}/${ids.rejected}/finance-return`, { return_reason: 'Power cut — 0.5 day' }, 'finance')).statusCode).toBe(200);
    expect(paidGrants()).toEqual([]);

    // HR's list shows it with the note
    const list = await call('GET', `${BASE}?month=9&year=2026`, undefined, 'hr');
    const listed = list.body.data.find(g => g.id === ids.rejected);
    expect(listed).toMatchObject({ status: 'PENDING', finance_notes: expect.stringContaining('Power cut — 0.5 day') });

    expect((await call('PUT', `${BASE}/${ids.rejected}`, { duty_days: 0.5 }, 'hr')).statusCode).toBe(200);
    expect((await call('POST', `${BASE}/${ids.rejected}/approve`, undefined, 'hr')).statusCode).toBe(200);
    expect(paidGrants()).toEqual([]); // still waiting for finance

    const queue = await call('GET', `${BASE}/finance-review?month=9&year=2026`, undefined, 'finance');
    expect(queue.body.data.find(g => g.id === ids.rejected)).toMatchObject({ finance_status: 'UNREVIEWED', duty_days: 0.5 });

    expect((await call('POST', `${BASE}/${ids.rejected}/finance-approve`, undefined, 'finance')).statusCode).toBe(200);
    expect(paidGrants()).toEqual([{ grant_date: DATE, duty_days: 0.5 }]);
    expect(testDb.prepare("SELECT COUNT(*) n FROM extra_duty_grants WHERE employee_code='17575' AND grant_date=?").get(DATE).n).toBe(1);
  });
});

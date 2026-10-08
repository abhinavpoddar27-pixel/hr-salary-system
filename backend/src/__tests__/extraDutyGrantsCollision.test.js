/**
 * Sentry HR-SALARY-BACKEND-2 — POST /api/extra-duty-grants used to 500 when a
 * grant already existed for the same employee+date (UNIQUE(employee_code,
 * grant_date, month, year)). Stage 6 auto-creates a hidden PENDING
 * 'BIOMETRIC_AUTO' row for every WOP day, so HR's manual grant for a worked
 * Sunday collided with it.
 *
 * Mounts the real extraDutyGrants router on a real Express app and drives it
 * through a real http server (no supertest dep, same pattern as
 * holdReleaseRoute.test.js). Every test runs against a fresh temp copy of a
 * DB built by the real initSchema(), so the production DDL (UNIQUE key,
 * NOT NULL columns, defaults) is what's being exercised.
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

jest.mock('../middleware/roles', () => ({
  requireHrOrAdmin: (req, _res, next) => {
    req.user = req.user || { role: 'hr', username: 'test_hr' };
    next();
  },
  requireFinanceOrAdmin: (req, _res, next) => {
    req.user = req.user || { role: 'finance', username: 'test_finance' };
    next();
  },
}));

const dbMock = require('../database/db');
const router = require('../routes/extraDutyGrants');
const { initSchema } = require('../database/schema');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const EMP = '60131';
const SUNDAY = '2026-09-06';
const MONTH = 9;
const YEAR = 2026;
const COMPANY = 'Asian Lakto Ind Ltd';
const OLD_REQUESTED_AT = '2026-09-07 03:30:00';

// Verbatim copy of the Stage 6 auto-create statement in services/recompute.js.
const STAGE6_WOP_INSERT = `
  INSERT OR IGNORE INTO extra_duty_grants
    (employee_code, employee_id, grant_date, month, year, company,
     grant_type, duty_days, verification_source, remarks,
     linked_attendance_id, status, finance_status, requested_by)
  VALUES (?, ?, ?, ?, ?, ?, 'OVERNIGHT_STAY', ?, 'BIOMETRIC_AUTO',
          'Auto-detected from attendance WOP status', ?, 'PENDING',
          'UNREVIEWED', 'system')
`;

const HR_BODY = {
  employee_code: EMP,
  grant_date: SUNDAY,
  month: MONTH,
  year: YEAR,
  company: COMPANY,
  grant_type: 'OVERNIGHT_STAY',
  duty_days: 1,
  verification_source: 'Gate Register',
  reference_number: 'GR-0906-14',
  remarks: 'Stayed overnight for CIP cleaning',
  original_punch_date: '',
};

const EXACT_CONFLICT = (row) =>
  `A grant already exists for this employee on ${SUNDAY} (status: ${row.status}, finance: ${row.finance_status}, source: ${row.verification_source}). Open that row instead.`;

let tmpDir;
let templatePath;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edg-collision-'));
  templatePath = path.join(tmpDir, 'template.db');
  // initSchema logs migration progress (and one known-harmless warning).
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const template = new Database(templatePath);
  initSchema(template);
  template.close();
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let testDb;
let app;
let attendanceId;
let consoleErrSpy;
let caseNo = 0;

function openTempCopy() {
  caseNo += 1;
  const p = path.join(tmpDir, `case-${caseNo}.db`);
  fs.copyFileSync(templatePath, p);
  const db = new Database(p);
  db.pragma('journal_mode = WAL');
  return db;
}

function seedBase(db) {
  db.prepare("INSERT INTO employees (code, name, department, company, status) VALUES (?, ?, ?, ?, 'Active')")
    .run(EMP, 'NANDINI', 'PRODUCTION', COMPANY);
  db.prepare("INSERT INTO employees (code, name, department, company, status) VALUES ('70059', 'SONU', 'PACKING', ?, 'Active')")
    .run(COMPANY);
  const ap = db.prepare(`
    INSERT INTO attendance_processed (employee_code, date, status_original, status_final, month, year, company)
    VALUES (?, ?, 'WOP', 'WOP', ?, ?, ?)
  `).run(EMP, SUNDAY, MONTH, YEAR, COMPANY);
  attendanceId = Number(ap.lastInsertRowid);

  // Background population across every status combination, so the
  // regression check can prove nothing outside the target row moves.
  const ins = db.prepare(`
    INSERT INTO extra_duty_grants (employee_code, grant_date, month, year, company, grant_type, duty_days,
      verification_source, remarks, status, finance_status, requested_by)
    VALUES (?, ?, 9, 2026, ?, 'OVERNIGHT_STAY', 1, ?, 'bg', ?, ?, ?)
  `);
  ins.run('70059', '2026-09-06', COMPANY, 'BIOMETRIC_AUTO', 'PENDING', 'UNREVIEWED', 'system');
  ins.run('70059', '2026-09-13', COMPANY, 'BIOMETRIC_AUTO', 'REJECTED', 'UNREVIEWED', 'hr1');
  ins.run('70059', '2026-09-14', COMPANY, 'Gate Register', 'APPROVED', 'FINANCE_APPROVED', 'hr1');
  ins.run('70059', '2026-09-15', COMPANY, 'Gate Register', 'APPROVED', 'UNREVIEWED', 'hr1');
  ins.run('70059', '2026-09-16', COMPANY, 'Production Office', 'PENDING', 'UNREVIEWED', 'hr1');
  ins.run('70059', '2026-09-17', COMPANY, 'Gate Register', 'APPROVED', 'FINANCE_REJECTED', 'hr1');
}

function seedAutoRow(db, { status = 'PENDING', finance = 'UNREVIEWED' } = {}) {
  db.prepare(STAGE6_WOP_INSERT).run(EMP, 1, SUNDAY, MONTH, YEAR, COMPANY, 1.0, attendanceId);
  const row = targetRows(db)[0];
  db.prepare('UPDATE extra_duty_grants SET status = ?, finance_status = ?, requested_at = ? WHERE id = ?')
    .run(status, finance, OLD_REQUESTED_AT, row.id);
  return targetRows(db)[0];
}

function targetRows(db) {
  return db.prepare('SELECT * FROM extra_duty_grants WHERE employee_code = ? AND grant_date = ?').all(EMP, SUNDAY);
}

function otherRows(db) {
  return db.prepare('SELECT * FROM extra_duty_grants WHERE NOT (employee_code = ? AND grant_date = ?) ORDER BY id').all(EMP, SUNDAY);
}

function allRows(db) {
  return db.prepare('SELECT * FROM extra_duty_grants ORDER BY id').all();
}

function statusCounts(db) {
  return db.prepare(`
    SELECT verification_source = 'BIOMETRIC_AUTO' AS auto, status, finance_status, COUNT(*) AS n
    FROM extra_duty_grants GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
  `).all();
}

// ── Test app + http driver ───────────────────────────────────────────────────

function makeApp() {
  const a = express();
  a.use(express.json());
  a.use('/api/extra-duty-grants', router);
  // Mirrors server.js's global error handler so an unexpected throw shows up
  // as the same 500 production returns.
  a.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ success: false, error: err.message || 'Internal server error' });
  });
  return a;
}

function callRoute(a, { method, path: urlPath, body }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(a);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const data = body !== undefined ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: urlPath,
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

const post = (body) => callRoute(app, { method: 'POST', path: '/api/extra-duty-grants', body });

beforeEach(() => {
  testDb = openTempCopy();
  seedBase(testDb);
  dbMock.__testSetDb(testDb);
  dbMock.__testResetAudit();
  app = makeApp();
  consoleErrSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (consoleErrSpy) consoleErrSpy.mockRestore();
  jest.restoreAllMocks();
  if (testDb) testDb.close();
});

// ── Suite ────────────────────────────────────────────────────────────────────

describe('POST /api/extra-duty-grants — existing-row handling (HR-SALARY-BACKEND-2)', () => {
  test('1. no existing row: creates exactly as before, same response shape, no audit', async () => {
    const before = otherRows(testDb);
    const res = await post(HR_BODY);

    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['id', 'success']);
    expect(res.body.success).toBe(true);

    const rows = targetRows(testDb);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(res.body.id);
    expect(rows[0]).toMatchObject({
      employee_id: 1, month: MONTH, year: YEAR, company: COMPANY,
      grant_type: 'OVERNIGHT_STAY', duty_days: 1, verification_source: 'Gate Register',
      reference_number: 'GR-0906-14', remarks: 'Stayed overnight for CIP cleaning',
      status: 'PENDING', finance_status: 'UNREVIEWED', requested_by: 'test_hr',
      linked_attendance_id: null,
    });
    expect(otherRows(testDb)).toEqual(before);
    expect(dbMock.__testAuditCalls()).toHaveLength(0);
  });

  test('1b. no existing row: INSERT defaults unchanged (grant_type, duty_days, blanks)', async () => {
    const res = await post({
      employee_code: EMP, grant_date: SUNDAY, month: MONTH, year: YEAR, verification_source: 'Other',
    });
    expect(res.statusCode).toBe(200);
    expect(targetRows(testDb)[0]).toMatchObject({
      company: '', grant_type: 'OVERNIGHT_STAY', duty_days: 1, reference_number: '', remarks: '', original_punch_date: '',
    });
  });

  test('1c. missing required fields still 400 and writes nothing', async () => {
    const before = allRows(testDb);
    const res = await post({ employee_code: EMP, grant_date: SUNDAY, month: MONTH, year: YEAR });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Missing required fields' });
    expect(allRows(testDb)).toEqual(before);
  });

  test('2. AUTO PENDING row exists: upgraded in place, id kept, still PENDING, link intact, one row', async () => {
    const auto = seedAutoRow(testDb);
    const countsBefore = statusCounts(testDb);
    const othersBefore = otherRows(testDb);

    const res = await post({ ...HR_BODY, duty_days: 0.5, grant_type: 'EXTENDED_SHIFT', original_punch_date: '2026-09-07' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, id: auto.id });

    const rows = targetRows(testDb);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.id).toBe(auto.id);
    expect(r).toMatchObject({
      status: 'PENDING', finance_status: 'UNREVIEWED', is_processed: 0,
      linked_attendance_id: attendanceId, company: COMPANY, employee_id: 1,
      verification_source: 'Gate Register', reference_number: 'GR-0906-14',
      remarks: 'Stayed overnight for CIP cleaning', duty_days: 0.5, grant_type: 'EXTENDED_SHIFT',
      original_punch_date: '2026-09-07', requested_by: 'test_hr',
      approved_by: null, approved_at: null, finance_reviewed_by: null,
    });
    expect(r.requested_at).not.toBe(OLD_REQUESTED_AT);
    expect(r.requested_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    // Regression: only the target row moved between status buckets (AUTO → manual).
    expect(otherRows(testDb)).toEqual(othersBefore);
    const countsAfter = statusCounts(testDb);
    const bucket = (cs, auto) => (cs.find((c) => c.auto === auto && c.status === 'PENDING' && c.finance_status === 'UNREVIEWED') || { n: 0 }).n;
    expect(bucket(countsAfter, 1)).toBe(bucket(countsBefore, 1) - 1);
    expect(bucket(countsAfter, 0)).toBe(bucket(countsBefore, 0) + 1);
    const strip = (cs) => cs.filter((c) => !(c.status === 'PENDING' && c.finance_status === 'UNREVIEWED'));
    expect(strip(countsAfter)).toEqual(strip(countsBefore));

    // Audit: one row, HR_UPGRADE_AUTO, old values + "WOP date" recorded.
    const calls = dbMock.__testAuditCalls();
    expect(calls).toHaveLength(1);
    const [table, recordId, field, oldVal, newVal, stage, remark, changedBy] = calls[0];
    expect([table, recordId, field, oldVal, newVal, stage, changedBy])
      .toEqual(['extra_duty_grants', auto.id, 'verification_source', 'BIOMETRIC_AUTO', 'Gate Register', 'HR_UPGRADE_AUTO', 'test_hr']);
    expect(remark).toContain('WOP date');
    expect(remark).toContain('duty_days=1');
    expect(remark).toContain('grant_type=OVERNIGHT_STAY');
    expect(remark).toContain('remarks="Auto-detected from attendance WOP status"');
    expect(remark).toContain('requested_by=system');
    expect(remark).toContain(`requested_at=${OLD_REQUESTED_AT}`);
    expect(remark).toContain(`linked_attendance_id=${attendanceId}`);
    expect(remark).toContain('New: 0.5 day(s) EXTENDED_SHIFT');
  });

  test('2b. upgraded row survives a Stage 6 re-run, shows in the HR list, and approves by returned id', async () => {
    seedAutoRow(testDb);
    const res = await post(HR_BODY);
    const upgraded = targetRows(testDb)[0];

    // Stage 6 re-run: INSERT OR IGNORE must neither duplicate nor overwrite.
    const info = testDb.prepare(STAGE6_WOP_INSERT).run(EMP, 1, SUNDAY, MONTH, YEAR, COMPANY, 1.0, attendanceId);
    expect(info.changes).toBe(0);
    expect(targetRows(testDb)).toEqual([upgraded]);

    const list = await callRoute(app, { method: 'GET', path: `/api/extra-duty-grants?month=${MONTH}&year=${YEAR}` });
    expect(list.body.data.map((g) => g.id)).toContain(res.body.id);

    const approve = await callRoute(app, { method: 'POST', path: `/api/extra-duty-grants/${res.body.id}/approve` });
    expect(approve.statusCode).toBe(200);
    expect(targetRows(testDb)[0].status).toBe('APPROVED');
  });

  test('2c. upgrade with duty_days/grant_type omitted uses the INSERT defaults (no NOT NULL throw)', async () => {
    seedAutoRow(testDb);
    const res = await post({
      ...HR_BODY, duty_days: null, grant_type: undefined, reference_number: undefined, remarks: undefined, original_punch_date: undefined,
    });
    expect(res.statusCode).toBe(200);
    // Stage 6 left original_punch_date NULL; the upgrade copies it like the INSERT does ('' when omitted).
    expect(targetRows(testDb)[0]).toMatchObject({
      duty_days: 1, grant_type: 'OVERNIGHT_STAY', reference_number: '', remarks: '', original_punch_date: '',
    });
  });

  test('3. existing manual APPROVED row: 409 with exact text + grant_id, DB unchanged', async () => {
    testDb.prepare(`
      INSERT INTO extra_duty_grants (employee_code, grant_date, month, year, company, duty_days, verification_source,
        status, finance_status, requested_by)
      VALUES (?, ?, ?, ?, ?, 1, 'Gate Register', 'APPROVED', 'FINANCE_APPROVED', 'hr1')
    `).run(EMP, SUNDAY, MONTH, YEAR, COMPANY);
    const before = allRows(testDb);
    const row = targetRows(testDb)[0];

    const res = await post(HR_BODY);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ success: false, error: EXACT_CONFLICT(row), grant_id: row.id });
    expect(res.body.error).toBe(
      `A grant already exists for this employee on ${SUNDAY} (status: APPROVED, finance: FINANCE_APPROVED, source: Gate Register). Open that row instead.`
    );
    expect(allRows(testDb)).toEqual(before);
    expect(dbMock.__testAuditCalls()).toHaveLength(0);
  });

  test('3b. a second HR submit for the same date after an upgrade: 409, not a second upgrade', async () => {
    seedAutoRow(testDb);
    await post(HR_BODY);
    const before = allRows(testDb);
    const res = await post({ ...HR_BODY, remarks: 'double click' });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toContain('source: Gate Register');
    expect(allRows(testDb)).toEqual(before);
  });

  test('4. existing AUTO REJECTED row: 409, DB unchanged', async () => {
    const auto = seedAutoRow(testDb, { status: 'REJECTED' });
    const before = allRows(testDb);

    const res = await post(HR_BODY);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ success: false, error: EXACT_CONFLICT(auto), grant_id: auto.id });
    expect(res.body.error).toContain('status: REJECTED, finance: UNREVIEWED, source: BIOMETRIC_AUTO');
    expect(allRows(testDb)).toEqual(before);
    expect(dbMock.__testAuditCalls()).toHaveLength(0);
  });

  test('4b. AUTO row already finance-approved, or flagged as processed: 409, not upgraded', async () => {
    const auto = seedAutoRow(testDb, { status: 'APPROVED', finance: 'FINANCE_APPROVED' });
    let before = allRows(testDb);
    let res = await post(HR_BODY);
    expect(res.statusCode).toBe(409);
    expect(allRows(testDb)).toEqual(before);

    testDb.prepare("UPDATE extra_duty_grants SET status = 'PENDING', finance_status = 'UNREVIEWED', is_processed = 1 WHERE id = ?").run(auto.id);
    before = allRows(testDb);
    res = await post(HR_BODY);
    expect(res.statusCode).toBe(409);
    expect(res.body.grant_id).toBe(auto.id);
    expect(allRows(testDb)).toEqual(before);
  });

  test('4c. AUTO row still PENDING but already finance-flagged or finance-rejected: 409, not upgraded', async () => {
    // finance-flag / finance-reject load the grant by id alone, so a PENDING
    // auto row can carry a finance decision; only the finance check stops it.
    const auto = seedAutoRow(testDb, { status: 'PENDING', finance: 'FINANCE_FLAGGED' });
    for (const finance of ['FINANCE_FLAGGED', 'FINANCE_REJECTED', 'FINANCE_APPROVED']) {
      testDb.prepare('UPDATE extra_duty_grants SET finance_status = ? WHERE id = ?').run(finance, auto.id);
      const before = allRows(testDb);
      const row = targetRows(testDb)[0];

      const res = await post(HR_BODY);

      expect(res.statusCode).toBe(409);
      expect(res.body).toEqual({ success: false, error: EXACT_CONFLICT(row), grant_id: auto.id });
      expect(res.body.error).toContain(`status: PENDING, finance: ${finance}, source: BIOMETRIC_AUTO`);
      expect(allRows(testDb)).toEqual(before);
    }
    expect(dbMock.__testAuditCalls()).toHaveLength(0);
  });

  test('5. race: lookup misses but the UNIQUE key is taken → 409 naming the row, not 500', async () => {
    const auto = seedAutoRow(testDb, { status: 'REJECTED' });
    const before = allRows(testDb);
    // Simulate another writer landing between the lookup and the INSERT: the
    // first lookup sees nothing, the INSERT then hits the real UNIQUE index.
    const realPrepare = testDb.prepare.bind(testDb);
    let lookups = 0;
    jest.spyOn(testDb, 'prepare').mockImplementation((sql) => {
      if (sql.startsWith('SELECT * FROM extra_duty_grants WHERE employee_code') && lookups++ === 0) {
        return { get: () => undefined };
      }
      return realPrepare(sql);
    });

    const res = await post(HR_BODY);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ success: false, error: EXACT_CONFLICT(auto), grant_id: auto.id });
    expect(lookups).toBe(2);
    expect(allRows(testDb)).toEqual(before);
  });

  test('5b. race where the colliding row is gone by re-read: still 409, generic text', async () => {
    // A TEMP trigger inserts the same key inside the INSERT statement, so the
    // INSERT raises SQLITE_CONSTRAINT_UNIQUE and the rollback removes both.
    testDb.exec(`
      CREATE TEMP TRIGGER race_dup BEFORE INSERT ON extra_duty_grants
      WHEN NEW.requested_by != 'race'
      BEGIN
        INSERT INTO extra_duty_grants (employee_code, grant_date, month, year, verification_source, requested_by)
        VALUES (NEW.employee_code, NEW.grant_date, NEW.month, NEW.year, 'race', 'race');
      END;
    `);
    const before = allRows(testDb);

    const res = await post(HR_BODY);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ success: false, error: `A grant already exists for this employee on ${SUNDAY}.` });
    expect(allRows(testDb)).toEqual(before);
  });

  test('5c. a non-UNIQUE SQLite error is not swallowed as 409: it still 500s', async () => {
    testDb.exec(`
      CREATE TEMP TRIGGER boom BEFORE INSERT ON extra_duty_grants
      BEGIN SELECT RAISE(ABORT, 'boom'); END;
    `);
    const before = allRows(testDb);

    const res = await post(HR_BODY);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('boom');
    expect(allRows(testDb)).toEqual(before);
  });

  test('PBA request against an upgradable AUTO row: own 409 text + grant_id, DB unchanged', async () => {
    const auto = seedAutoRow(testDb);
    const before = allRows(testDb);

    const res = await post({ ...HR_BODY, grant_type: 'PRE_BIOMETRIC_ACTIVATION' });

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error: 'Pre-biometric grants cannot replace a system-generated entry for this date.',
      grant_id: auto.id,
    });
    expect(allRows(testDb)).toEqual(before);
    expect(targetRows(testDb)[0].linked_attendance_id).toBe(attendanceId);
    expect(dbMock.__testAuditCalls()).toHaveLength(0);
  });

  test('6. regression: the whole sequence leaves every non-target row and status bucket untouched', async () => {
    const othersBefore = otherRows(testDb);
    const countsBefore = statusCounts(testDb);

    const auto = seedAutoRow(testDb);
    const pba = await post({ ...HR_BODY, grant_type: 'PRE_BIOMETRIC_ACTIVATION' });
    expect(pba.statusCode).toBe(409);
    expect(pba.body.error).toBe('Pre-biometric grants cannot replace a system-generated entry for this date.');
    const upgrade = await post(HR_BODY);
    expect(upgrade.statusCode).toBe(200);
    expect(upgrade.body).toEqual({ success: true, id: auto.id });
    const again = await post(HR_BODY);
    expect(again.statusCode).toBe(409);
    expect(again.body.grant_id).toBe(auto.id);
    const fresh = await post({ ...HR_BODY, grant_date: '2026-09-20' });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.body.id).not.toBe(auto.id);
    expect(targetRows(testDb)[0]).toMatchObject({ grant_type: 'OVERNIGHT_STAY', verification_source: 'Gate Register' });

    expect(otherRows(testDb).filter((r) => r.grant_date !== '2026-09-20' || r.employee_code !== EMP)).toEqual(othersBefore);
    expect(targetRows(testDb)).toHaveLength(1);
    const after = statusCounts(testDb);
    const manualPending = (cs) => (cs.find((c) => c.auto === 0 && c.status === 'PENDING' && c.finance_status === 'UNREVIEWED') || { n: 0 }).n;
    // +1 upgraded target, +1 fresh 09-20 grant; the AUTO PENDING bucket is back to its pre-seed size.
    expect(manualPending(after)).toBe(manualPending(countsBefore) + 2);
    const autoPending = (cs) => (cs.find((c) => c.auto === 1 && c.status === 'PENDING') || { n: 0 }).n;
    expect(autoPending(after)).toBe(autoPending(countsBefore));
  });
});

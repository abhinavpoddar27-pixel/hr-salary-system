/**
 * Gate pass quota (owner ruling 10 Oct 2026).
 *
 * Per employee per calendar month: 2 Short Leaves OR 1 Half Day.
 * Points: Short Leave 1, Half Day 2, budget 2. Short Leave = 2 hours ending
 * at shift end. Only an admin may go over, with a reason of 10+ characters.
 * Backdating open (7-day limit removed). One active pass per employee per date.
 *
 * Driven over HTTP behind the REAL requireAuth with real JWTs.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');

const COMPANY = 'Indriyan Beverages Pvt Ltd';
let api;
let db;

beforeAll(() => {
  api = startJwtApi({ '/api/short-leaves': '../../routes/short-leaves' }, {
    users: [
      { username: 'hr1', role: 'hr' },
      { username: 'boss', role: 'admin' },
      { username: 'fin1', role: 'finance' },
      { username: 'view1', role: 'viewer' },
    ],
  });
  db = api.db;
});
afterAll(async () => { await api.close(); });

let n = 0;
function newEmployee() {
  const code = `GP${String(++n).padStart(3, '0')}`;
  // No shift_id and no attendance → route falls back to the seeded 12HR shift (08:00–20:00).
  db.prepare(`INSERT INTO employees (code, name, company, employment_type, status, date_of_joining)
              VALUES (?, 'TEST', ?, 'Permanent', 'Active', '2024-01-01')`).run(code, COMPANY);
  return code;
}
const create = (as, body) => api.request('POST', '/api/short-leaves', {
  as, body: { remark: 'doctor visit', ...body },
});
const rowsFor = (code) => db.prepare(
  'SELECT * FROM short_leaves WHERE employee_code = ? ORDER BY id').all(code);
const quota = (code, month, year, as = 'hr1') =>
  api.request('GET', `/api/short-leaves/quota/${code}?month=${month}&year=${year}`, { as });

describe('durations', () => {
  test('Short Leave is 2 hours and ends at shift end (12HR → leave from 18:00)', async () => {
    const code = newEmployee();
    const r = await create('hr1', { employee_code: code, date: '2026-10-05', leave_type: 'short_leave' });
    expect(r.status).toBe(201);
    const [row] = rowsFor(code);
    expect(row.duration_hours).toBe(2);
    expect(row.authorized_leave_until).toBe('18:00');
    expect(row.quota_breach).toBe(0);
    expect(row.breach_reason).toBeNull();
  });

  test('uses the employee\'s assigned shift (default_shift_id → 10HR 09:00–19:00 → leave from 17:00)', async () => {
    const code = newEmployee();
    const s = db.prepare("SELECT id FROM shifts WHERE code = '10HR'").get();
    db.prepare('UPDATE employees SET default_shift_id = ? WHERE code = ?').run(s.id, code);
    const r = await create('hr1', { employee_code: code, date: '2026-10-05', leave_type: 'short_leave' });
    expect(r.status).toBe(201);
    const [row] = rowsFor(code);
    expect(row.shift_code).toBe('10HR');
    expect(row.authorized_leave_until).toBe('17:00');
  });

  test('falls back to shift_code when there is no default_shift_id (9HR 09:30–18:30 → leave from 16:30)', async () => {
    const code = newEmployee();
    db.prepare("UPDATE employees SET shift_code = '9HR' WHERE code = ?").run(code);
    const r = await create('hr1', { employee_code: code, date: '2026-10-05', leave_type: 'short_leave' });
    expect(r.status).toBe(201);
    const [row] = rowsFor(code);
    expect(row.shift_code).toBe('9HR');
    expect(row.authorized_leave_until).toBe('16:30');
  });

  test('Half Day is unchanged: half the shift (12HR → 6 h, leave from 14:00)', async () => {
    const code = newEmployee();
    const r = await create('hr1', { employee_code: code, date: '2026-10-05', leave_type: 'half_day' });
    expect(r.status).toBe(201);
    const [row] = rowsFor(code);
    expect(row.duration_hours).toBe(6);
    expect(row.authorized_leave_until).toBe('14:00');
  });
});

describe('monthly allowance: 2 Short Leaves OR 1 Half Day', () => {
  test('two Short Leaves allowed, a third refused', async () => {
    const code = newEmployee();
    expect((await create('hr1', { employee_code: code, date: '2026-10-02', leave_type: 'short_leave' })).status).toBe(201);
    expect((await create('hr1', { employee_code: code, date: '2026-10-09', leave_type: 'short_leave' })).status).toBe(201);
    const third = await create('hr1', { employee_code: code, date: '2026-10-16', leave_type: 'short_leave' });
    expect(third.status).toBe(422);
    expect(third.body.quota_exceeded).toBe(true);
    expect(third.body.can_override).toBe(false);
    expect(third.body.message).toMatch(/2 Short Leaves or 1 Half Day/);
    expect(rowsFor(code)).toHaveLength(2);
  });

  test('one Short Leave used → Half Day refused', async () => {
    const code = newEmployee();
    expect((await create('hr1', { employee_code: code, date: '2026-10-02', leave_type: 'short_leave' })).status).toBe(201);
    const hd = await create('hr1', { employee_code: code, date: '2026-10-10', leave_type: 'half_day' });
    expect(hd.status).toBe(422);
    expect(hd.body.message).toMatch(/1 Short Leave .*Half Day is not available/);
    expect(rowsFor(code)).toHaveLength(1);
  });

  test('one Half Day used → Short Leave refused, and a second Half Day refused', async () => {
    const code = newEmployee();
    expect((await create('hr1', { employee_code: code, date: '2026-10-02', leave_type: 'half_day' })).status).toBe(201);
    expect((await create('hr1', { employee_code: code, date: '2026-10-10', leave_type: 'short_leave' })).status).toBe(422);
    expect((await create('hr1', { employee_code: code, date: '2026-10-11', leave_type: 'half_day' })).status).toBe(422);
    expect(rowsFor(code)).toHaveLength(1);
  });

  test('allowance is per calendar month (30 Sep Half Day does not block 1 Oct Half Day)', async () => {
    const code = newEmployee();
    expect((await create('hr1', { employee_code: code, date: '2026-09-30', leave_type: 'half_day' })).status).toBe(201);
    expect((await create('hr1', { employee_code: code, date: '2026-10-01', leave_type: 'half_day' })).status).toBe(201);
  });

  test('allowance is per employee', async () => {
    const a = newEmployee(); const b = newEmployee();
    expect((await create('hr1', { employee_code: a, date: '2026-10-02', leave_type: 'half_day' })).status).toBe(201);
    expect((await create('hr1', { employee_code: b, date: '2026-10-02', leave_type: 'half_day' })).status).toBe(201);
  });

  test('cancelling a pass gives its points back', async () => {
    const code = newEmployee();
    const first = await create('hr1', { employee_code: code, date: '2026-10-02', leave_type: 'short_leave' });
    expect((await create('hr1', { employee_code: code, date: '2026-10-08', leave_type: 'half_day' })).status).toBe(422);
    const c = await api.request('PUT', `/api/short-leaves/${first.body.id}/cancel`, { as: 'hr1', body: { cancel_reason: 'not taken' } });
    expect(c.status).toBe(200);
    expect((await create('hr1', { employee_code: code, date: '2026-10-08', leave_type: 'half_day' })).status).toBe(201);
  });
});

describe('going over the allowance — admin only, with a reason', () => {
  async function exhausted() {
    const code = newEmployee();
    expect((await create('hr1', { employee_code: code, date: '2026-10-02', leave_type: 'half_day' })).status).toBe(201);
    return code;
  }

  test('HR forcing it → 403, nothing written', async () => {
    const code = await exhausted();
    const r = await create('hr1', { employee_code: code, date: '2026-10-09', leave_type: 'short_leave',
      force_quota_breach: true, breach_reason: 'manager approved urgent family matter' });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/Only an admin/);
    expect(rowsFor(code)).toHaveLength(1);
  });

  test('admin sees can_override on the 422', async () => {
    const code = await exhausted();
    const r = await create('boss', { employee_code: code, date: '2026-10-09', leave_type: 'short_leave' });
    expect(r.status).toBe(422);
    expect(r.body.can_override).toBe(true);
  });

  test('admin without a reason, or a reason under 10 characters → 400, nothing written', async () => {
    const code = await exhausted();
    const none = await create('boss', { employee_code: code, date: '2026-10-09', leave_type: 'short_leave', force_quota_breach: true });
    expect(none.status).toBe(400);
    const short = await create('boss', { employee_code: code, date: '2026-10-09', leave_type: 'short_leave',
      force_quota_breach: true, breach_reason: '  too sho ' });
    expect(short.status).toBe(400);
    expect(rowsFor(code)).toHaveLength(1);
  });

  test('admin with a reason → 201, marked as a breach, reason and audit stored', async () => {
    const code = await exhausted();
    const r = await create('boss', { employee_code: code, date: '2026-10-09', leave_type: 'short_leave',
      force_quota_breach: true, breach_reason: 'Hospital visit, approved by plant head' });
    expect(r.status).toBe(201);
    expect(r.body.quota_breach).toBe(1);
    const row = rowsFor(code)[1];
    expect(row.quota_breach).toBe(1);
    expect(row.breach_reason).toBe('Hospital visit, approved by plant head');
    const audit = db.prepare(`SELECT stage, remark, changed_by FROM audit_log
                              WHERE table_name = 'short_leaves' AND record_id = ?`).get(row.id);
    expect(audit.stage).toBe('short_leave_quota_override');
    expect(audit.remark).toMatch(/Hospital visit/);
    expect(audit.changed_by).toBe('boss');
  });

  test('a reason is ignored (not stored) when the pass is within the allowance', async () => {
    const code = newEmployee();
    const r = await create('boss', { employee_code: code, date: '2026-10-09', leave_type: 'short_leave',
      force_quota_breach: true, breach_reason: 'not needed here at all' });
    expect(r.status).toBe(201);
    const [row] = rowsFor(code);
    expect(row.quota_breach).toBe(0);
    expect(row.breach_reason).toBeNull();
  });
});

describe('other rules', () => {
  test('backdating is open: a date 40+ days in the past is accepted', async () => {
    const code = newEmployee();
    const d = new Date(); d.setDate(d.getDate() - 45);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const r = await create('hr1', { employee_code: code, date: iso, leave_type: 'short_leave' });
    expect(r.status).toBe(201);
  });

  test('one active pass per date: a Half Day on a Short Leave day is refused (409)', async () => {
    const code = newEmployee();
    expect((await create('hr1', { employee_code: code, date: '2026-10-07', leave_type: 'short_leave' })).status).toBe(201);
    const r = await create('boss', { employee_code: code, date: '2026-10-07', leave_type: 'half_day',
      force_quota_breach: true, breach_reason: 'trying to stack two passes' });
    expect(r.status).toBe(409);
    expect(rowsFor(code)).toHaveLength(1);
  });

  test('malformed date → 400', async () => {
    const code = newEmployee();
    expect((await create('hr1', { employee_code: code, date: '07/10/2026', leave_type: 'short_leave' })).status).toBe(400);
    expect((await create('hr1', { employee_code: code, date: '2026-13-45', leave_type: 'short_leave' })).status).toBe(400);
  });

  test('viewer and finance still cannot create (403)', async () => {
    const code = newEmployee();
    expect((await create('view1', { employee_code: code, date: '2026-10-07', leave_type: 'short_leave' })).status).toBe(403);
    expect((await create('fin1', { employee_code: code, date: '2026-10-07', leave_type: 'short_leave' })).status).toBe(403);
  });
});

describe('GET /quota/:code', () => {
  test('reports points, per-type counts and what is still allowed', async () => {
    const code = newEmployee();
    let q = (await quota(code, 10, 2026)).body;
    expect(q).toMatchObject({ used: 0, limit: 2, remaining: 2, can_short_leave: true, can_half_day: true, short_leave_hours: 2 });

    await create('hr1', { employee_code: code, date: '2026-10-03', leave_type: 'short_leave' });
    q = (await quota(code, 10, 2026)).body;
    expect(q).toMatchObject({ used: 1, remaining: 1, passes: 1, short_leaves_used: 1, half_days_used: 0,
      can_short_leave: true, can_half_day: false });

    await create('hr1', { employee_code: code, date: '2026-10-04', leave_type: 'short_leave' });
    q = (await quota(code, 10, 2026)).body;
    expect(q).toMatchObject({ used: 2, remaining: 0, can_short_leave: false, can_half_day: false });
  });

  test('finance can read the quota', async () => {
    const code = newEmployee();
    expect((await quota(code, 10, 2026, 'fin1')).status).toBe(200);
  });
});

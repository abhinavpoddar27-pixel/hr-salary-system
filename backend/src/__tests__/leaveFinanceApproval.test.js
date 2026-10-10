/**
 * Leave Management applications: HR raises, finance approves (owner rule,
 * 10 Oct 2026), and the same day can never be taken as leave twice.
 *
 * Before: only HR/admin could approve or reject; finance saw greyed-out buttons.
 * HR also approved its own applications, and nothing stopped an EL being raised
 * and approved over a day already approved as CL (both balances debited).
 *
 * Driven over a real socket against a real schema-initialised temp database.
 */
const { startApi } = require('./helpers/apiHarness');

const YEAR = 2026;
const CO = 'Asian Lakto Ind Ltd';

let api;
let db;

beforeAll(() => {
  api = startApi({ '/api/leaves': '../../routes/leaves' });
  db = api.db;
});

afterAll(async () => { await api.close(); });

beforeEach(() => {
  for (const t of ['leave_balances', 'leave_applications', 'leave_transactions',
    'monthly_imports', 'employees', 'audit_log']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
});

let seq = 0;
function addEmployee() {
  const code = `LF${String(++seq).padStart(3, '0')}`;
  const info = db.prepare(`
    INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, gross_salary)
    VALUES (?, 'LEAVE FIN TEST', 'PRODUCTION', ?, 'Permanent', 'Active', '2023-01-01', 20000)
  `).run(code, CO);
  const emp = { code, id: info.lastInsertRowid };
  for (const [type, bal] of [['CL', 4], ['EL', 10]]) {
    db.prepare(`INSERT INTO leave_balances (employee_id, year, leave_type, opening, accrued, used, balance)
                VALUES (?, ?, ?, ?, 0, 0, ?)`).run(emp.id, YEAR, type, bal, bal);
  }
  return emp;
}

const balanceOf = (emp, type) => db.prepare(
  'SELECT balance FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = ?'
).get(emp.id, YEAR, type).balance;
const statusOf = (id) => db.prepare('SELECT status, approved_by FROM leave_applications WHERE id = ?').get(id);

const raise = (emp, { type = 'EL', start = `${YEAR}-09-15`, end = start, days = 1 } = {}, role = 'hr') =>
  api.request('POST', '/api/leaves', {
    role,
    body: { employeeCode: emp.code, leaveType: type, startDate: start, endDate: end, days, reason: 'test', hrRemark: 'raised in test' },
  });
const approve = (id, role) => api.request('PUT', `/api/leaves/${id}/approve`, { role, body: {} });
const reject = (id, role) => api.request('PUT', `/api/leaves/${id}/reject`, { role, body: { reason: 'not valid' } });

describe('who decides a Leave Management application', () => {
  test('HR raises; HR cannot approve; the application stays Pending and nothing moves', async () => {
    const e = addEmployee();
    const r = await raise(e);
    expect(r.status).toBe(200);
    const res = await approve(r.body.id, 'hr');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('HR_CANNOT_APPROVE');
    expect(statusOf(r.body.id).status).toBe('Pending');
    expect(balanceOf(e, 'EL')).toBe(10);
  });

  test('finance approves: status Approved by finance, EL debited', async () => {
    const e = addEmployee();
    const { body } = await raise(e, { days: 2, start: `${YEAR}-09-15`, end: `${YEAR}-09-16` });
    const res = await approve(body.id, 'finance');
    expect(res.status).toBe(200);
    expect(statusOf(body.id).status).toBe('Approved');
    expect(balanceOf(e, 'EL')).toBe(8);
  });

  test('admin can still approve', async () => {
    const e = addEmployee();
    const { body } = await raise(e);
    expect((await approve(body.id, 'admin')).status).toBe(200);
    expect(balanceOf(e, 'EL')).toBe(9);
  });

  test('finance and HR can both reject; nothing is debited', async () => {
    const e = addEmployee();
    const a = (await raise(e, { start: `${YEAR}-09-15` })).body.id;
    const b = (await raise(e, { start: `${YEAR}-09-18` })).body.id;
    expect((await reject(a, 'finance')).status).toBe(200);
    expect((await reject(b, 'hr')).status).toBe(200);
    expect(statusOf(a).status).toBe('Rejected');
    expect(statusOf(b).status).toBe('Rejected');
    expect(balanceOf(e, 'EL')).toBe(10);
  });

  test('finance still cannot raise leave or adjust balances; viewer cannot decide', async () => {
    const e = addEmployee();
    expect((await raise(e, {}, 'finance')).status).toBe(403);
    expect((await api.request('POST', '/api/leaves/adjust', {
      role: 'finance',
      body: { employee_code: e.code, leave_type: 'EL', transaction_type: 'Credit', days: 5, reason: 'nope' },
    })).status).toBe(403);
    const { body } = await raise(e);
    expect((await approve(body.id, 'viewer')).status).toBe(403);
    expect((await reject(body.id, 'viewer')).status).toBe(403);
    expect(statusOf(body.id).status).toBe('Pending');
  });
});

describe('the same day cannot be taken as leave twice', () => {
  test('raising EL over a day already approved as CL is refused (409)', async () => {
    const e = addEmployee();
    const cl = (await raise(e, { type: 'CL', start: `${YEAR}-09-21` })).body.id;
    expect((await approve(cl, 'finance')).status).toBe(200);
    const res = await raise(e, { type: 'EL', start: `${YEAR}-09-21`, end: `${YEAR}-09-25`, days: 5 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LEAVE_OVERLAP');
    expect(res.body.error).toContain(`CL ${YEAR}-09-21`);
  });

  test('raising the same day twice while the first is still pending is refused', async () => {
    const e = addEmployee();
    expect((await raise(e, { start: `${YEAR}-09-19` })).status).toBe(200);
    expect((await raise(e, { start: `${YEAR}-09-19` })).status).toBe(409);
  });

  test('approving an older pending application over a day approved since is refused, balances untouched', async () => {
    const e = addEmployee();
    // Simulates rows raised before this guard existed: both pending on the same day.
    const ins = db.prepare(`INSERT INTO leave_applications (employee_id, employee_code, leave_type, start_date, end_date, days, reason, status)
                            VALUES (?, ?, ?, ?, ?, 1, 'legacy', 'Pending')`);
    const cl = ins.run(e.id, e.code, 'CL', `${YEAR}-09-28`, `${YEAR}-09-28`).lastInsertRowid;
    const el = ins.run(e.id, e.code, 'EL', `${YEAR}-09-28`, `${YEAR}-09-28`).lastInsertRowid;
    expect((await approve(cl, 'finance')).status).toBe(200);
    const res = await approve(el, 'finance');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LEAVE_OVERLAP');
    expect(statusOf(el).status).toBe('Pending');
    expect(balanceOf(e, 'CL')).toBe(3);
    expect(balanceOf(e, 'EL')).toBe(10);
  });

  test('rejected and cancelled applications do not block the day', async () => {
    const e = addEmployee();
    const first = (await raise(e, { start: `${YEAR}-09-22` })).body.id;
    expect((await reject(first, 'hr')).status).toBe(200);
    const second = await raise(e, { start: `${YEAR}-09-22` });
    expect(second.status).toBe(200);
    expect((await api.request('DELETE', `/api/leaves/${second.body.id}`, { role: 'hr' })).status).toBe(200);
    expect((await raise(e, { start: `${YEAR}-09-22` })).status).toBe(200);
  });

  test('a range that only touches the edge of another range does not clash', async () => {
    const e = addEmployee();
    expect((await raise(e, { start: `${YEAR}-09-01`, end: `${YEAR}-09-03`, days: 3 })).status).toBe(200);
    expect((await raise(e, { start: `${YEAR}-09-04`, end: `${YEAR}-09-05`, days: 2 })).status).toBe(200);
    expect((await raise(e, { start: `${YEAR}-09-03`, end: `${YEAR}-09-04`, days: 2 })).status).toBe(409);
  });
});

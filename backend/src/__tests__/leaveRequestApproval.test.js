/**
 * Stage 6 leave on an absent day: HR raises, finance approves.
 *
 * Until Oct 2026 POST /api/finance-audit/corrections/apply-leave was finance or
 * admin only, while the Stage 6 "Apply Leave" button showed for HR and failed
 * with 403. Now an HR call raises a request (leave_applications status
 * 'Pending Finance') that changes nothing until finance approves it. Finance
 * and admin keep the direct path.
 *
 * Driven over a real socket against a real schema-initialised temp database.
 */
const { startApi } = require('./helpers/apiHarness');

const YEAR = new Date().getFullYear();
const CO = 'Indriyan Beverages Pvt Ltd';
const MON = 3;
const D = (d) => `${YEAR}-03-${String(d).padStart(2, '0')}`;

let api;
let db;

beforeAll(() => {
  api = startApi({
    '/api/leaves': '../../routes/leaves',
    '/api/finance-audit': '../../routes/financeAudit',
    '/api/payroll': '../../routes/payroll',
  });
  db = api.db;
});
afterAll(async () => { await api.close(); });

beforeEach(() => {
  for (const t of ['leave_balances', 'leave_applications', 'leave_transactions', 'day_calculations',
    'monthly_imports', 'employees', 'attendance_processed', 'audit_log', 'notifications']) {
    try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* table may not exist */ }
  }
});

let seq = 0;
function addEmployee() {
  const code = `LR${String(++seq).padStart(3, '0')}`;
  const info = db.prepare(`
    INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, gross_salary)
    VALUES (?, 'LEAVE REQ TEST', 'PRODUCTION', ?, 'Permanent', 'Active', '2023-01-01', 26000)
  `).run(code, CO);
  return { code, id: info.lastInsertRowid };
}
function setBalance(emp, type, balance) {
  db.prepare(`
    INSERT INTO leave_balances (employee_id, year, leave_type, opening, accrued, used, balance)
    VALUES (?, ?, ?, ?, 0, 0, ?)
    ON CONFLICT(employee_id, year, leave_type) DO UPDATE SET balance = excluded.balance
  `).run(emp.id, YEAR, type, balance, balance);
}
function attend(emp, day, status) {
  db.prepare(`
    INSERT INTO attendance_processed (employee_id, employee_code, date, month, year, company, status_original, status_final, is_night_out_only)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(emp.id, emp.code, D(day), MON, YEAR, CO, status, status);
}
const balanceOf = (emp, type = 'EL') => db.prepare(
  'SELECT balance FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = ?'
).get(emp.id, YEAR, type)?.balance;
const dayStatus = (emp, day) => db.prepare(
  'SELECT status_final FROM attendance_processed WHERE employee_code = ? AND date = ?'
).get(emp.code, D(day)).status_final;
const appRow = (id) => db.prepare('SELECT * FROM leave_applications WHERE id = ?').get(id);

const raise = (emp, day, extra = {}, username = 'hr1') => api.request('POST', '/api/finance-audit/corrections/apply-leave', {
  role: 'hr', username,
  body: { employee_code: emp.code, date: D(day), leave_type: 'EL', month: MON, year: YEAR, reason: 'applied on phone', ...extra },
});
const decide = (id, action, body = {}, role = 'finance', username = 'fin1') =>
  api.request('POST', `/api/finance-audit/leave-requests/${id}/${action}`, { role, username, body });

describe('HR raises a request', () => {
  test('nothing changes until finance approves', async () => {
    const e = addEmployee(); setBalance(e, 'EL', 5); attend(e, 10, 'A');
    const res = await raise(e, 10);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, pending: true });
    expect(appRow(res.body.request_id)).toMatchObject({ status: 'Pending Finance', leave_type: 'EL', days: 1, approved_by: null });
    expect(dayStatus(e, 10)).toBe('A');
    expect(balanceOf(e)).toBe(5);
    const audit = db.prepare("SELECT changed_by FROM audit_log WHERE action_type = 'leave_request_raised'").all();
    expect(audit).toEqual([{ changed_by: 'hr1' }]);
    expect(db.prepare("SELECT COUNT(*) c FROM notifications WHERE role_target = 'finance'").get().c).toBe(1);
  });

  test('the same day twice is refused', async () => {
    const e = addEmployee(); setBalance(e, 'EL', 5); attend(e, 10, 'A');
    expect((await raise(e, 10)).status).toBe(200);
    const again = await raise(e, 10);
    expect(again.status).toBe(409);
    expect(db.prepare('SELECT COUNT(*) c FROM leave_applications').get().c).toBe(1);
  });

  test('pending requests count against the balance', async () => {
    const e = addEmployee(); setBalance(e, 'EL', 1); attend(e, 10, 'A'); attend(e, 11, 'A');
    expect((await raise(e, 10)).status).toBe(200);
    const second = await raise(e, 11);
    expect(second.status).toBe(400);
    expect(second.body.error).toContain('already waiting for finance');
  });

  test('zero balance is refused; LWP still goes through', async () => {
    const e = addEmployee(); setBalance(e, 'EL', 0); attend(e, 10, 'A');
    const el = await raise(e, 10);
    expect(el.status).toBe(400);
    expect(el.body.error).toContain('balance is 0');
    expect(db.prepare('SELECT COUNT(*) c FROM leave_applications').get().c).toBe(0);
    expect((await raise(e, 10, { leave_type: 'LWP' })).status).toBe(200);
  });

  test('a day that is not absent, a finalized month and a viewer are refused', async () => {
    const e = addEmployee(); setBalance(e, 'EL', 5); attend(e, 10, 'P'); attend(e, 11, 'A');
    expect((await raise(e, 10)).status).toBe(404);
    const viewer = await api.request('POST', '/api/finance-audit/corrections/apply-leave', { role: 'viewer', body: {} });
    expect(viewer.status).toBe(403);
    db.prepare(`INSERT INTO monthly_imports (month, year, company, file_name, status, is_finalised) VALUES (?, ?, ?, 'x.xls', 'imported', 1)`)
      .run(MON, YEAR, CO);
    const closed = await raise(e, 11);
    expect(closed.status).toBe(400);
    expect(closed.body.error).toContain('finalized month');
  });

  test('HR cannot approve its own request from Leave Management', async () => {
    const e = addEmployee(); setBalance(e, 'EL', 5); attend(e, 10, 'A');
    const { body } = await raise(e, 10);
    const res = await api.request('PUT', `/api/leaves/${body.request_id}/approve`, { role: 'hr', body: {} });
    // HR may not approve leave at all since 10 Oct 2026 (403); before that the
    // 'Pending Finance' status already kept this route from finding it (404).
    expect(res.status).toBe(403);
    expect(appRow(body.request_id).status).toBe('Pending Finance');
    expect(dayStatus(e, 10)).toBe('A');
  });
});

describe('finance decides', () => {
  test('approve flips the day, debits the balance and records who did what', async () => {
    const e = addEmployee(); setBalance(e, 'EL', 5); attend(e, 10, 'A');
    const { body } = await raise(e, 10);
    expect((await decide(body.request_id, 'approve', {}, 'hr', 'hr2')).status).toBe(403);

    const res = await decide(body.request_id, 'approve', { remark: 'form seen' });
    expect(res.status).toBe(200);
    expect(res.body.new_balance).toBe(4);
    expect(appRow(body.request_id)).toMatchObject({ status: 'Approved', approved_by: 'fin1' });
    expect(dayStatus(e, 10)).toBe('EL');
    expect(balanceOf(e)).toBe(4);
    expect(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action_type = 'leave_correction'").get().c).toBe(1);

    const twice = await decide(body.request_id, 'approve');
    expect(twice.status).toBe(409);
    expect(balanceOf(e)).toBe(4);
  });

  test('the person who raised it cannot approve it', async () => {
    const e = addEmployee(); setBalance(e, 'EL', 5); attend(e, 10, 'A');
    const { body } = await raise(e, 10, {}, 'samename');
    const res = await decide(body.request_id, 'approve', {}, 'finance', 'samename');
    expect(res.status).toBe(403);
    expect(appRow(body.request_id).status).toBe('Pending Finance');
  });

  test('balance gone meanwhile: approval refused, request stays pending, day stays absent', async () => {
    const e = addEmployee(); setBalance(e, 'EL', 1); attend(e, 10, 'A');
    const { body } = await raise(e, 10);
    setBalance(e, 'EL', 0);
    const res = await decide(body.request_id, 'approve');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('balance is 0');
    expect(appRow(body.request_id).status).toBe('Pending Finance');
    expect(dayStatus(e, 10)).toBe('A');
  });

  test('day no longer absent: approval refused with 409', async () => {
    const e = addEmployee(); setBalance(e, 'EL', 5); attend(e, 10, 'A');
    const { body } = await raise(e, 10);
    db.prepare("UPDATE attendance_processed SET status_final = 'P' WHERE employee_code = ?").run(e.code);
    const res = await decide(body.request_id, 'approve');
    expect(res.status).toBe(409);
    expect(balanceOf(e)).toBe(5);
    expect(appRow(body.request_id).status).toBe('Pending Finance');
  });

  test('reject needs a reason and leaves everything as it was', async () => {
    const e = addEmployee(); setBalance(e, 'EL', 5); attend(e, 10, 'A');
    const { body } = await raise(e, 10);
    expect((await decide(body.request_id, 'reject', {})).status).toBe(400);
    const res = await decide(body.request_id, 'reject', { reason: 'no leave form' });
    expect(res.status).toBe(200);
    expect(appRow(body.request_id)).toMatchObject({ status: 'Rejected', rejection_reason: 'no leave form', approved_by: 'fin1' });
    expect(dayStatus(e, 10)).toBe('A');
    expect(balanceOf(e)).toBe(5);
    expect((await decide(body.request_id, 'approve')).status).toBe(409);
  });

  test('withdraw: only the requester or an admin', async () => {
    const e = addEmployee(); setBalance(e, 'EL', 5); attend(e, 10, 'A');
    const { body } = await raise(e, 10);
    expect((await decide(body.request_id, 'withdraw', {}, 'hr', 'hr2')).status).toBe(403);
    expect((await decide(body.request_id, 'withdraw', {}, 'hr', 'hr1')).status).toBe(200);
    expect(appRow(body.request_id).status).toBe('Cancelled');
    // A withdrawn day can be raised again.
    expect((await raise(e, 10)).status).toBe(200);
  });

  test('list shows the request, who raised it, and whether the viewer may decide', async () => {
    const e = addEmployee(); setBalance(e, 'EL', 5); attend(e, 10, 'A');
    await raise(e, 10);
    const asFin = await api.request('GET', `/api/finance-audit/leave-requests?month=${MON}&year=${YEAR}`, { role: 'finance', username: 'fin1' });
    expect(asFin.status).toBe(200);
    expect(asFin.body.pending_count).toBe(1);
    expect(asFin.body.data[0]).toMatchObject({ employee_code: e.code, requested_by: 'hr1', current_balance: 5, day_status: 'A', can_decide: true });
    const asReq = await api.request('GET', `/api/finance-audit/leave-requests?month=${MON}&year=${YEAR}`, { role: 'hr', username: 'hr1' });
    expect(asReq.body.data[0].can_decide).toBe(false);
  });

  test('readiness check warns while a request is pending', async () => {
    const e = addEmployee(); setBalance(e, 'EL', 5); attend(e, 10, 'A');
    await raise(e, 10);
    const res = await api.request('GET', `/api/finance-audit/readiness-check?month=${MON}&year=${YEAR}`, { role: 'finance' });
    expect(res.body.data.warnings.map(w => w.type)).toContain('LEAVE_REQUESTS_PENDING');
  });

  test('finance and admin still apply directly', async () => {
    const e = addEmployee(); setBalance(e, 'EL', 5); attend(e, 10, 'A');
    const res = await api.request('POST', '/api/finance-audit/corrections/apply-leave', {
      role: 'finance', username: 'fin1',
      body: { employee_code: e.code, date: D(10), leave_type: 'EL', month: MON, year: YEAR, reason: 'direct' },
    });
    expect(res.status).toBe(200);
    expect(res.body.pending).toBeUndefined();
    expect(appRow(res.body.application_id).status).toBe('Approved');
    expect(dayStatus(e, 10)).toBe('EL');
  });
});

describe('Stage 6 sees only approved requests', () => {
  function seedMonth(emp) {
    for (let d = 1; d <= 31; d++) {
      const dow = new Date(Date.UTC(YEAR, 2, d)).getUTCDay();
      attend(emp, d, dow === 0 ? 'WO' : (d === 10 && dow !== 0 ? 'A' : 'P'));
    }
  }
  const stage6 = () => api.request('POST', '/api/payroll/calculate-days', { role: 'admin', body: { month: MON, year: YEAR, company: CO } });
  const payable = (emp) => db.prepare('SELECT total_payable_days p, el_used el FROM day_calculations WHERE employee_code = ?').get(emp.code);

  test('pending → no change; approved → one paid EL day', async () => {
    const e = addEmployee(); setBalance(e, 'EL', 5);
    seedMonth(e);
    if (dayStatus(e, 10) !== 'A') return; // 10 March fell on a Sunday this year
    expect((await stage6()).status).toBe(200);
    const before = payable(e);

    const { body } = await raise(e, 10);
    expect((await stage6()).status).toBe(200);
    expect(payable(e)).toEqual(before);

    expect((await decide(body.request_id, 'approve')).status).toBe(200);
    expect((await stage6()).status).toBe(200);
    expect(payable(e).el).toBe(1);
    expect(payable(e).p).toBe(before.p + 1);
  });
});

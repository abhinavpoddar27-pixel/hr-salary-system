/**
 * The floor: leave_balances.balance may not go below zero.
 *
 * Employee 23725 reached -5 EL and -2 CL through six single-day debits in four
 * minutes on POST /api/leaves/adjust, which had no balance check at all. Two
 * other paths checked, but check-then-act — SELECT, return 400 if short, then
 * open a transaction and UPDATE with no predicate. This file pins both
 * properties for every request path that moves a balance:
 *
 *   • a debit landing exactly on zero succeeds
 *   • a debit past zero is refused with 400 and writes nothing
 *   • an admin with a >=10-char reason may override, and it lands in audit_log
 *   • an override with a short/absent reason is refused
 *   • a non-admin override is refused
 *   • two debits that individually fit and together do not → exactly one lands
 *
 * Driven over a real socket against a real schema-initialised temp database.
 */
const { startApi } = require('./helpers/apiHarness');

const YEAR = new Date().getFullYear();
const CO = 'Indriyan Beverages Pvt Ltd';
const LONG_REASON = 'audited correction, approved by owner';

let api;
let db;

beforeAll(() => {
  api = startApi({
    '/api/leaves': '../../routes/leaves',
    '/api/employees': '../../routes/employees',
    '/api/finance-audit': '../../routes/financeAudit',
  });
  db = api.db;
});

afterAll(async () => { await api.close(); });

beforeEach(() => {
  for (const t of ['leave_balances', 'leave_applications', 'leave_transactions',
    'day_calculations', 'monthly_imports', 'employees', 'attendance_processed', 'audit_log']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
});

let seq = 0;
function addEmployee(over = {}) {
  const code = `FL${String(++seq).padStart(3, '0')}`;
  const info = db.prepare(`
    INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, gross_salary)
    VALUES (?, 'FLOOR TEST', 'PRODUCTION', ?, 'Permanent', 'Active', '2023-01-01', 20000)
  `).run(code, over.company ?? CO);
  return { code, id: info.lastInsertRowid };
}

function setBalance(emp, leaveType, balance, { opening = balance, used = 0 } = {}) {
  db.prepare(`
    INSERT INTO leave_balances (employee_id, year, leave_type, opening, accrued, used, balance)
    VALUES (?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(employee_id, year, leave_type) DO UPDATE SET
      opening = excluded.opening, used = excluded.used, balance = excluded.balance
  `).run(emp.id, YEAR, leaveType, opening, used, balance);
}

const balanceOf = (emp, leaveType = 'CL') => db.prepare(
  'SELECT balance FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = ?'
).get(emp.id, YEAR, leaveType)?.balance;

const overrideRows = () => db.prepare(
  "SELECT * FROM audit_log WHERE action_type = 'leave_balance_negative_override'"
).all();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/leaves/adjust — the path the live incident took
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/leaves/adjust', () => {
  const adjust = (body, role = 'hr') => api.request('POST', '/api/leaves/adjust', { body, role });
  const debit = (emp, days, extra = {}) => adjust({
    employee_code: emp.code, leave_type: 'CL', transaction_type: 'Debit', days, reason: 'test', ...extra,
  }, extra.role || 'hr');

  test('a debit landing exactly on zero succeeds', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 3);
    const res = await debit(e, 3);
    expect(res.status).toBe(200);
    expect(res.body.newBalance).toBe(0);
    expect(balanceOf(e)).toBe(0);
  });

  test('a debit one day past zero is refused with 400 and writes nothing', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 3);
    const res = await debit(e, 4);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INSUFFICIENT_LEAVE_BALANCE');
    expect(res.body.error).toMatch(/3 day\(s\) available/);
    expect(balanceOf(e)).toBe(3);
    expect(db.prepare('SELECT COUNT(*) c FROM leave_transactions').get().c).toBe(0);
  });

  test('the six-one-day-debits shape stops at zero instead of reaching -2', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 4);
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await debit(e, 1));
    expect(results.filter((r) => r.status === 200)).toHaveLength(4);
    expect(results.filter((r) => r.status === 400)).toHaveLength(2);
    expect(balanceOf(e)).toBe(0);
  });

  test('two debits that individually fit and together do not → exactly one lands', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 3);
    const [a, b] = await Promise.all([debit(e, 2), debit(e, 2)]);
    const ok = [a, b].filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    expect(balanceOf(e)).toBe(1);
  });

  test('an admin override with a reason succeeds and writes the audit row', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 1);
    const res = await debit(e, 3, { role: 'admin', allow_negative: true, negative_reason: LONG_REASON });
    expect(res.status).toBe(200);
    expect(balanceOf(e)).toBe(-2);
    const rows = overrideRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].employee_code).toBe(e.code);
    expect(rows[0].field_name).toBe('CL');
    expect(rows[0].new_value).toBe('-2');
    expect(rows[0].remark).toBe(LONG_REASON);
  });

  test('an override with a too-short reason is refused', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 1);
    const res = await debit(e, 3, { role: 'admin', allow_negative: true, negative_reason: 'oops' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NEGATIVE_OVERRIDE_REASON_REQUIRED');
    expect(balanceOf(e)).toBe(1);
    expect(overrideRows()).toHaveLength(0);
  });

  test('a non-admin override is refused even with a good reason', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 1);
    const res = await debit(e, 3, { role: 'hr', allow_negative: true, negative_reason: LONG_REASON });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NEGATIVE_OVERRIDE_NOT_ADMIN');
    expect(balanceOf(e)).toBe(1);
  });

  test('a credit is unaffected by the floor', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 1);
    const res = await adjust({
      employee_code: e.code, leave_type: 'CL', transaction_type: 'Credit', days: 5, reason: 'test',
    });
    expect(res.status).toBe(200);
    expect(res.body.newBalance).toBe(6);
    expect(balanceOf(e)).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/leaves/bulk-adjust
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/leaves/bulk-adjust', () => {
  const bulk = (adjustments, role = 'hr') =>
    api.request('POST', '/api/leaves/bulk-adjust', { body: { adjustments }, role });
  const row = (emp, days, extra = {}) => ({
    employee_code: emp.code, leave_type: 'CL', transaction_type: 'Debit', days, reason: 'test', ...extra,
  });

  test('a debit landing exactly on zero succeeds', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 2);
    const res = await bulk([row(e, 2)]);
    expect(res.body.processed).toBe(1);
    expect(balanceOf(e)).toBe(0);
  });

  test('an over-debit is reported in errors and the rest of the batch still applies', async () => {
    const good = addEmployee(); setBalance(good, 'CL', 5);
    const bad = addEmployee(); setBalance(bad, 'CL', 1);
    const res = await bulk([row(bad, 4), row(good, 2)]);
    expect(res.body.processed).toBe(1);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].employee_code).toBe(bad.code);
    expect(res.body.errors[0].code).toBe('INSUFFICIENT_LEAVE_BALANCE');
    expect(balanceOf(bad)).toBe(1);
    expect(balanceOf(good)).toBe(3);
  });

  test('two rows for the same employee that together overdraw → only the first lands', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 3);
    const res = await bulk([row(e, 2), row(e, 2)]);
    expect(res.body.processed).toBe(1);
    expect(res.body.errors).toHaveLength(1);
    expect(balanceOf(e)).toBe(1);
  });

  test('an admin override with a reason succeeds and writes the audit row', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 1);
    const res = await bulk([row(e, 2, { allow_negative: true, negative_reason: LONG_REASON })], 'admin');
    expect(res.body.processed).toBe(1);
    expect(balanceOf(e)).toBe(-1);
    expect(overrideRows()).toHaveLength(1);
  });

  test('a non-admin override is reported as an error, not applied', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 1);
    const res = await bulk([row(e, 2, { allow_negative: true, negative_reason: LONG_REASON })], 'hr');
    expect(res.body.processed).toBe(0);
    expect(res.body.errors[0].code).toBe('NEGATIVE_OVERRIDE_NOT_ADMIN');
    expect(balanceOf(e)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/leaves/:id/approve — already floored before this PR, now atomic
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /api/leaves/:id/approve', () => {
  const apply = (emp, days) => db.prepare(`
    INSERT INTO leave_applications
      (employee_id, employee_code, leave_type, start_date, end_date, days, reason, status)
    VALUES (?, ?, 'CL', ?, ?, ?, 'test', 'Pending')
  `).run(emp.id, emp.code, `${YEAR}-03-10`, `${YEAR}-03-10`, days).lastInsertRowid;

  const approve = (id, body = {}, role = 'hr') =>
    api.request('PUT', `/api/leaves/${id}/approve`, { body, role });

  test('an approval landing exactly on zero succeeds', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 2);
    expect((await approve(apply(e, 2))).status).toBe(200);
    expect(balanceOf(e)).toBe(0);
  });

  test('an approval past zero is refused, and the application stays Pending', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 1);
    const id = apply(e, 2);
    const res = await approve(id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficient CL balance \(current: 1, requested: 2\)/);
    expect(balanceOf(e)).toBe(1);
    // The rollback is the point: the status must not have moved either.
    expect(db.prepare('SELECT status FROM leave_applications WHERE id = ?').get(id).status).toBe('Pending');
  });

  test('two approvals that individually fit and together do not → exactly one lands', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 3);
    const [a, b] = [apply(e, 2), apply(e, 2)];
    const results = await Promise.all([approve(a), approve(b)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(balanceOf(e)).toBe(1);
  });

  test('an admin override with a reason succeeds and writes the audit row', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 1);
    const res = await approve(apply(e, 3), { allow_negative: true, negative_reason: LONG_REASON }, 'admin');
    expect(res.status).toBe(200);
    expect(balanceOf(e)).toBe(-2);
    expect(overrideRows()).toHaveLength(1);
  });

  test('a non-admin override is refused', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 1);
    const res = await approve(apply(e, 3), { allow_negative: true, negative_reason: LONG_REASON }, 'hr');
    expect(res.status).toBe(400);
    expect(balanceOf(e)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/finance-audit/corrections/apply-leave — and the dead literal -1
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/finance-audit/corrections/apply-leave', () => {
  const absent = (emp, date) => db.prepare(`
    INSERT INTO attendance_processed (employee_code, date, month, year, company, status_original, status_final, is_night_out_only)
    VALUES (?, ?, 3, ?, ?, 'A', 'A', 0)
  `).run(emp.code, date, YEAR, CO);

  const post = (body, role = 'finance') =>
    api.request('POST', '/api/finance-audit/corrections/apply-leave', { body, role });

  const applyLeave = (emp, extra = {}, role = 'finance') => {
    const date = `${YEAR}-03-10`;
    return post({
      employee_code: emp.code, date, leave_type: 'CL', month: 3, year: YEAR, reason: 'sick', ...extra,
    }, role);
  };

  test('a debit landing exactly on zero succeeds', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 1); absent(e, `${YEAR}-03-10`);
    const res = await applyLeave(e);
    expect(res.status).toBe(200);
    expect(res.body.new_balance).toBe(0);
    expect(balanceOf(e)).toBe(0);
  });

  test('with no balance row at all it refuses — it no longer inserts balance = -1', async () => {
    const e = addEmployee(); absent(e, `${YEAR}-03-10`);
    const res = await applyLeave(e);
    expect(res.status).toBe(400);
    // The pre-guard wording is preserved on purpose.
    expect(res.body.error).toContain('balance is 0');
    expect(balanceOf(e) ?? 0).toBe(0);
    // And the whole correction rolled back with it.
    expect(db.prepare('SELECT status_final FROM attendance_processed WHERE employee_code = ?').get(e.code).status_final).toBe('A');
    expect(db.prepare('SELECT COUNT(*) c FROM leave_applications').get().c).toBe(0);
  });

  test('a debit past zero refuses and rolls the whole correction back', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 0); absent(e, `${YEAR}-03-10`);
    const res = await applyLeave(e);
    expect(res.status).toBe(400);
    expect(balanceOf(e)).toBe(0);
    expect(db.prepare('SELECT status_final FROM attendance_processed WHERE employee_code = ?').get(e.code).status_final).toBe('A');
    expect(db.prepare('SELECT COUNT(*) c FROM leave_applications').get().c).toBe(0);
  });

  test('an admin override with a reason succeeds and writes the audit row', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 0); absent(e, `${YEAR}-03-10`);
    const res = await applyLeave(e, { allow_negative: true, negative_reason: LONG_REASON }, 'admin');
    expect(res.status).toBe(200);
    expect(balanceOf(e)).toBe(-1);
    expect(overrideRows()).toHaveLength(1);
  });

  test('a non-admin (finance) override is refused', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 0); absent(e, `${YEAR}-03-10`);
    const res = await applyLeave(e, { allow_negative: true, negative_reason: LONG_REASON }, 'finance');
    expect(res.status).toBe(400);
    expect(balanceOf(e)).toBe(0);
  });

  test('LWP still never touches a balance', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 0); absent(e, `${YEAR}-03-10`);
    const res = await applyLeave(e, { leave_type: 'LWP' });
    expect(res.status).toBe(200);
    expect(balanceOf(e)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/employees/:code/leaves — absolute set, plus the C1 role guard
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /api/employees/:code/leaves', () => {
  const put = (emp, body, role = 'hr') =>
    api.request('PUT', `/api/employees/${emp.code}/leaves`, { body, role });

  test('the role guard from commit 1 holds', async () => {
    const e = addEmployee();
    expect((await put(e, { year: YEAR, leaveType: 'CL', opening: 5, used: 0 }, 'viewer')).status).toBe(403);
    expect((await put(e, { year: YEAR, leaveType: 'CL', opening: 5, used: 0 }, 'finance')).status).toBe(403);
    expect((await put(e, { year: YEAR, leaveType: 'CL', opening: 5, used: 0 }, 'hr')).status).toBe(200);
  });

  test('used equal to opening lands exactly on zero', async () => {
    const e = addEmployee();
    expect((await put(e, { year: YEAR, leaveType: 'CL', opening: 4, used: 4 })).status).toBe(200);
    expect(balanceOf(e)).toBe(0);
  });

  test('used greater than opening is refused with 400 and writes nothing', async () => {
    const e = addEmployee(); setBalance(e, 'CL', 4);
    const res = await put(e, { year: YEAR, leaveType: 'CL', opening: 4, used: 9 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NEGATIVE_LEAVE_BALANCE');
    expect(balanceOf(e)).toBe(4);
  });

  test('an admin override with a reason succeeds and writes the audit row', async () => {
    const e = addEmployee();
    const res = await put(e, {
      year: YEAR, leaveType: 'CL', opening: 4, used: 9,
      allow_negative: true, negative_reason: LONG_REASON,
    }, 'admin');
    expect(res.status).toBe(200);
    expect(balanceOf(e)).toBe(-5);
    expect(overrideRows()).toHaveLength(1);
  });

  test('an override with a too-short reason is refused', async () => {
    const e = addEmployee();
    const res = await put(e, {
      year: YEAR, leaveType: 'CL', opening: 4, used: 9,
      allow_negative: true, negative_reason: 'short',
    }, 'admin');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NEGATIVE_OVERRIDE_REASON_REQUIRED');
  });

  test('a non-admin override is refused', async () => {
    const e = addEmployee();
    const res = await put(e, {
      year: YEAR, leaveType: 'CL', opening: 4, used: 9,
      allow_negative: true, negative_reason: LONG_REASON,
    }, 'hr');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NEGATIVE_OVERRIDE_NOT_ADMIN');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/finance-audit/corrections/mark-present — role guard (commit 3)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/finance-audit/corrections/mark-present', () => {
  const post = (role) => api.request('POST', '/api/finance-audit/corrections/mark-present', { body: {}, role });

  test('only finance and admin can reach it', async () => {
    expect((await post('hr')).status).toBe(403);
    expect((await post('viewer')).status).toBe(403);
    // Past the gate, then refused for missing fields — which is the point.
    expect((await post('finance')).status).toBe(400);
    expect((await post('admin')).status).toBe(400);
  });
});

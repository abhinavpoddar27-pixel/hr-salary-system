/**
 * P4 — Mark Left is hr + admin only.
 *
 * PUT /api/employees/:code/mark-left flags the leaver's open plant loans for
 * exit recovery and collapses their schedules (Loans PR-1 / PR-7), so it has
 * money consequences. Until P4 it had no role guard: the employees router is
 * mounted behind requireAuth only, so a viewer, supervisor, finance user or
 * even an employee-portal login could mark anyone Left.
 *
 * Driven over HTTP behind the REAL requireAuth with real JWTs (jwtApiHarness),
 * on a real initSchema() database.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');

const COMPANY = 'Indriyan Beverages Pvt Ltd';
let api;
let db;

beforeAll(() => {
  api = startJwtApi({ '/api/employees': '../../routes/employees' }, {
    users: [
      { username: 'hr1', role: 'hr' },
      { username: 'boss', role: 'admin' },
      { username: 'hrmgr', role: 'HR Manager' },       // normalises to hr
      { username: 'fin1', role: 'finance' },
      { username: 'finteam', role: 'Finance Team' },   // normalises to finance
      { username: 'view1', role: 'viewer' },
      { username: 'sup1', role: 'supervisor' },
      { username: 'emp1', role: 'employee', employeeCode: 'E0001' },
      { username: 'blank', role: '' },                 // normalises to viewer
    ],
  });
  db = api.db;
});
afterAll(async () => { await api.close(); });

let n = 0;
const nextCode = () => `RG${String(++n).padStart(3, '0')}`;

function addEmployee(code, status = 'Active') {
  db.prepare(`INSERT INTO employees (code, name, company, employment_type, status, date_of_joining)
              VALUES (?, 'TEST', ?, 'Permanent', ?, '2024-01-01')`).run(code, COMPANY, status);
}
function addActiveLoan(code) {
  const id = db.prepare(`
    INSERT INTO loans (borrower_type, employee_code, company, loan_type, principal_amount,
                       tenure_months, emi_amount, status, requested_by, remaining_balance)
    VALUES ('plant', ?, ?, 'Personal', 6000, 3, 2000, 'active', 'hr2', 6000)
  `).run(code, COMPANY).lastInsertRowid;
  const ins = db.prepare(`INSERT INTO loan_instalments (loan_id, sequence, due_month, due_year, amount_due)
                          VALUES (?, ?, ?, 2026, 2000)`);
  for (let i = 1; i <= 3; i++) ins.run(id, i, 9 + i);
  return id;
}
const empRow = (code) => db.prepare('SELECT status, date_of_exit, exit_reason, inactive_since FROM employees WHERE code = ?').get(code);
const loanRow = (id) => db.prepare('SELECT status, exit_flag, exit_date, remaining_balance FROM loans WHERE id = ?').get(id);
const schedule = (id) => db.prepare('SELECT sequence, due_month, amount_due, status FROM loan_instalments WHERE loan_id = ? ORDER BY sequence').all(id);
const counts = () => ({
  audit: db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c,
  events: db.prepare('SELECT COUNT(*) AS c FROM loan_events').get().c,
  notes: db.prepare('SELECT COUNT(*) AS c FROM notifications').get().c,
});
const markLeft = (code, as) => api.request('PUT', `/api/employees/${code}/mark-left`,
  { as, body: { date_of_leaving: '2026-10-05', reason: 'Resigned' } });

describe('PUT /api/employees/:code/mark-left — refused roles change nothing', () => {
  test.each(['view1', 'fin1', 'finteam', 'sup1', 'emp1', 'blank'])('%s → 403', async (who) => {
    const code = nextCode();
    addEmployee(code);
    const loanId = addActiveLoan(code);
    const before = { emp: empRow(code), loan: loanRow(loanId), sched: schedule(loanId), counts: counts() };

    const r = await markLeft(code, who);
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ success: false, error: 'HR or admin access required' });

    expect(empRow(code)).toEqual(before.emp);
    expect(empRow(code).status).toBe('Active');
    expect(loanRow(loanId)).toEqual(before.loan);
    expect(loanRow(loanId)).toMatchObject({ status: 'active', exit_flag: 0 });
    expect(schedule(loanId)).toEqual(before.sched);
    expect(counts()).toEqual(before.counts);   // no audit row, no loan event, no notification
  });

  test('an unknown code is refused before the lookup (403, not 404 — no code probing)', async () => {
    const r = await markLeft('NOPE999', 'view1');
    expect(r.status).toBe(403);
  });

  test('no token at all → 401 from requireAuth', async () => {
    const code = nextCode();
    addEmployee(code);
    const r = await api.request('PUT', `/api/employees/${code}/mark-left`, { body: { reason: 'x' } });
    expect(r.status).toBe(401);
    expect(empRow(code).status).toBe('Active');
  });
});

describe('PUT /api/employees/:code/mark-left — hr and admin still work, loan flagging unchanged', () => {
  test.each(['hr1', 'boss', 'hrmgr'])('%s → 200; the active loan becomes recover_at_exit and its schedule collapses', async (who) => {
    const code = nextCode();
    addEmployee(code);
    const loanId = addActiveLoan(code);

    const r = await markLeft(code, who);
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.loans).toEqual([expect.objectContaining({ loanId, status: 'recover_at_exit', outstanding: 6000 })]);

    expect(empRow(code)).toMatchObject({ status: 'Left', date_of_exit: '2026-10-05', inactive_since: '2026-10-05' });
    expect(loanRow(loanId)).toEqual({ status: 'recover_at_exit', exit_flag: 1, exit_date: '2026-10-05', remaining_balance: 6000 });
    expect(schedule(loanId)).toEqual([
      { sequence: 1, due_month: 10, amount_due: 6000, status: 'scheduled' },
      { sequence: 2, due_month: 11, amount_due: 2000, status: 'cancelled' },
      { sequence: 3, due_month: 12, amount_due: 2000, status: 'cancelled' },
    ]);
    const ev = db.prepare("SELECT actor FROM loan_events WHERE loan_id = ? AND event = 'borrower_left'").all(loanId);
    expect(ev).toEqual([{ actor: who }]);
  });
});

// ── PUT /api/employees/:code — no exit by the back door (P4, option B) ──
// Setting status Left/Exited here skipped the exit date, inactive_since, the
// audit row and the loan exit flagging — for every role, HR included.
describe('PUT /api/employees/:code cannot move an employee into Left / Exited', () => {
  const put = (code, as, body) => api.request('PUT', `/api/employees/${code}`, { as, body });

  test.each([
    ['hr1', 'Left'], ['boss', 'Exited'], ['view1', 'Left'], ['fin1', 'Exited'], ['hr1', ' left '],
  ])('%s sending status %p → 400 pointing to Mark Left; nothing written', async (who, status) => {
    const code = nextCode();
    addEmployee(code);
    const loanId = addActiveLoan(code);
    const before = { emp: empRow(code), loan: loanRow(loanId), counts: counts() };

    const r = await put(code, who, { status, name: 'RENAMED' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Use Mark Left/);

    expect(empRow(code)).toEqual(before.emp);
    expect(db.prepare('SELECT name FROM employees WHERE code = ?').get(code).name).toBe('TEST');   // whole edit refused
    expect(loanRow(loanId)).toEqual(before.loan);
    expect(counts()).toEqual(before.counts);
  });

  test('ordinary edits are unaffected (status Active resent on an Active employee)', async () => {
    const code = nextCode();
    addEmployee(code);
    const r = await put(code, 'hr1', { status: 'Active', name: 'RENAMED' });
    expect(r.status).toBe(200);
    expect(db.prepare('SELECT name, status FROM employees WHERE code = ?').get(code)).toEqual({ name: 'RENAMED', status: 'Active' });
  });

  test('re-sending the current exit status is a no-op, not refused', async () => {
    const code = nextCode();
    addEmployee(code, 'Left');
    const r = await put(code, 'hr1', { status: 'Left', name: 'RENAMED' });
    expect(r.status).toBe(200);
    expect(db.prepare('SELECT name, status FROM employees WHERE code = ?').get(code)).toEqual({ name: 'RENAMED', status: 'Left' });
  });

  test('reactivation (Left → Active) still works', async () => {
    const code = nextCode();
    addEmployee(code, 'Left');
    const r = await put(code, 'hr1', { status: 'Active' });
    expect(r.status).toBe(200);
    expect(empRow(code).status).toBe('Active');
  });

  test('the refusal does not hide a missing employee (404 first)', async () => {
    const r = await put('NOPE998', 'hr1', { status: 'Left' });
    expect(r.status).toBe(404);
  });
});

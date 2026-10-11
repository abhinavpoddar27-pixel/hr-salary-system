/**
 * P1-13 (F-4 + N-18) — Finance Verification covers every company for the month and keeps
 * ONE sign-off row per month. Owner ruling 11 Oct 2026: Option B; old NULL-company rows are
 * deleted in the same transaction; the latest decision wins, so a reject after an approve
 * re-locks payroll.js's finalise gate. Real router behind the real requireAuth with real
 * JWTs (jwtApiHarness). Fictional companies, codes and money.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');

const USERS = [
  { username: 'fin1', role: 'finance' },
  { username: 'boss', role: 'admin' },
  { username: 'hr1', role: 'hr' },
];

// Copied VERBATIM from backend/src/routes/payroll.js POST /finalise (the sign-off gate).
// Not imported on purpose: if payroll.js changes its query, re-copy it here.
const PAYROLL_GATE_SQL = "SELECT status FROM finance_month_signoff WHERE month = ? AND year = ? AND status = 'approved'";

const M = 9; const Y = 2031; // a month no other fixture uses

let api; let db;
beforeAll(() => {
  api = startJwtApi({ '/api/finance-verify': '../../routes/financeVerification' }, { users: USERS });
  db = api.db;
  const ins = db.prepare(`INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, gross_earned, total_deductions, net_salary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run('T13A1', M, Y, 'Test Co A', 20000, 20000, 1000, 19000);
  ins.run('T13A2', M, Y, 'Test Co A', 15000, 15000, 500, 14500);
  ins.run('T13B1', M, Y, 'Test Co B', 12000, 12000, 0, 12000);
  ins.run('T13X1', M, Y, '', 10000, 10000, 0, 10000); // blank label, as in production
});
afterAll(() => api.close());

const rows = (m = M) => db.prepare('SELECT * FROM finance_month_signoff WHERE month = ? AND year = ? ORDER BY id').all(m, Y);
const signoff = (as, body) => api.request('POST', '/api/finance-verify/signoff', { as, body: { month: M, year: Y, ...body } });
const status = (as, extra = '') => api.request('GET', `/api/finance-verify/signoff-status?month=${M}&year=${Y}${extra}`, { as });
const dash = (as, extra = '') => api.request('GET', `/api/finance-verify/dashboard?month=${M}&year=${Y}${extra}`, { as });
const reset = () => db.prepare('DELETE FROM finance_month_signoff WHERE year = ?').run(Y);

describe('P1-13 one month-wide sign-off', () => {
  beforeEach(reset);

  test('approve then reject: one row, status rejected, payroll gate finds no approved row', async () => {
    expect((await signoff('fin1', { status: 'approved' })).status).toBe(200);
    expect(db.prepare(PAYROLL_GATE_SQL).get(M, Y)).toBeTruthy();
    const rj = await signoff('fin1', { status: 'rejected', rejectionReason: 'synthetic reason' });
    expect(rj.status).toBe(200);
    expect(rj.body.data).toMatchObject({ status: 'rejected', rejection_reason: 'synthetic reason', company: '', scope: 'all' });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].status).toBe('rejected');
    expect(db.prepare(PAYROLL_GATE_SQL).get(M, Y)).toBeUndefined();
    const s = await status('fin1');
    expect(s.body.data.status).toBe('rejected');
    expect(s.body.data.scope).toBe('all');
    expect((await dash('fin1')).body.data.summary.signoffStatus).toBe('rejected');
  });

  test('reject then approve: latest wins everywhere', async () => {
    await signoff('fin1', { status: 'rejected', rejectionReason: 'synthetic reason' });
    await signoff('boss', { status: 'approved' });
    expect(rows()).toHaveLength(1);
    expect((await status('fin1')).body.data).toMatchObject({ status: 'approved', signed_by: 'boss' });
    expect(db.prepare(PAYROLL_GATE_SQL).get(M, Y)).toEqual({ status: 'approved' });
  });

  test('a company in the body is ignored: still one row, company ""', async () => {
    await signoff('fin1', { status: 'approved', company: 'Test Co A' });
    await signoff('fin1', { status: 'rejected', rejectionReason: 'synthetic reason', company: 'Test Co B' });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ company: '', status: 'rejected', total_employees: 4 });
  });

  test('old NULL-company rows for that month are deleted in the same write; other months untouched', async () => {
    const legacy = db.prepare(`INSERT INTO finance_month_signoff (month, year, company, status, signed_by) VALUES (?, ?, NULL, 'approved', 'old')`);
    legacy.run(M, Y); legacy.run(M, Y); legacy.run(M + 1, Y);
    expect(db.prepare(PAYROLL_GATE_SQL).get(M, Y)).toBeTruthy();
    await signoff('fin1', { status: 'rejected', rejectionReason: 'synthetic reason' });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ company: '', status: 'rejected' });
    expect(db.prepare(PAYROLL_GATE_SQL).get(M, Y)).toBeUndefined();
    expect(rows(M + 1)).toHaveLength(1); // another month's legacy row is not ours to touch
  });

  test('status with no sign-off is pending, scope all', async () => {
    expect((await status('fin1')).body.data).toEqual({ status: 'pending', scope: 'all' });
  });

  test('flagged employees still block approve (P1-15 gate unchanged); nothing written', async () => {
    db.prepare(`INSERT INTO finance_audit_status (employee_code, month, year, status) VALUES ('T13B1', ?, ?, 'flagged')`).run(M, Y);
    try {
      const r = await signoff('fin1', { status: 'approved' });
      expect(r.status).toBe(400);
      expect(rows()).toHaveLength(0);
    } finally {
      db.prepare('DELETE FROM finance_audit_status WHERE year = ?').run(Y);
    }
  });

  test('hr cannot sign off (role guard unchanged)', async () => {
    expect((await signoff('hr1', { status: 'approved' })).status).toBe(403);
    expect(rows()).toHaveLength(0);
  });
});

describe('P1-13 reads cover every company; a company param changes nothing', () => {
  test('dashboard counts all four rows (both companies + blank label)', async () => {
    const all = (await dash('fin1')).body.data.summary;
    expect(all).toMatchObject({ totalEmployees: 4, totalNetSalary: 55500, scope: 'all' });
    const withA = (await dash('fin1', '&company=Test%20Co%20A')).body.data.summary;
    expect(withA).toEqual(all);
  });

  test('employees list returns every company', async () => {
    const r = await api.request('GET', `/api/finance-verify/employees?month=${M}&year=${Y}&company=Test%20Co%20B`, { as: 'fin1' });
    expect(r.body.data.map((x) => x.employee_code).sort()).toEqual(['T13A1', 'T13A2', 'T13B1', 'T13X1']);
  });
});

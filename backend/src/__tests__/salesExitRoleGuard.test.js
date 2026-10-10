/**
 * P4 — pins the hr + admin guard on both sales exit paths.
 *
 *   PUT /api/sales/employees/:code/mark-left?company=   (flags the rep's open sales loans)
 *   PUT /api/sales/employees/:code?company= {status}    (Left / Exited flag them too — Loans PR-8)
 *
 * Both sit after `router.use(requireHrOrAdmin)` in routes/sales.js, so they are
 * already hr + admin only; no source change. Nothing tested that before — a
 * future refactor that moved the router.use line would have opened them
 * silently (the same failure mode as the TA/DA routes registered above it).
 * Real requireAuth, real JWTs, real initSchema() database.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');
const S = require('./helpers/salesLoanFixture');

const { IND } = S;

let api; let db;
beforeAll(() => {
  api = startJwtApi({ '/api/sales': '../../routes/sales' }, {
    users: [
      { username: 'hr1', role: 'hr' },
      { username: 'boss', role: 'admin' },
      { username: 'fin1', role: 'finance' },
      { username: 'view1', role: 'viewer' },
    ],
  });
  db = api.db;
});
afterAll(() => api.close());

let n = 0;
const code = () => `SG${String(++n).padStart(3, '0')}`;
const repRow = (c) => db.prepare('SELECT status, dol FROM sales_employees WHERE code = ? AND company = ?').get(c, IND);
const loanRow = (id) => db.prepare('SELECT status, exit_flag, exit_date, remaining_balance FROM loans WHERE id = ?').get(id);
const eventCount = () => db.prepare('SELECT COUNT(*) AS c FROM loan_events').get().c;
const q = `?company=${encodeURIComponent(IND)}`;
const markLeft = (c, as) => api.request('PUT', `/api/sales/employees/${c}/mark-left${q}`, { as, body: { dol: '2026-11-10', reason: 'resigned' } });
const putStatus = (c, as, status) => api.request('PUT', `/api/sales/employees/${c}${q}`, { as, body: { status, dol: '2026-11-10' } });

describe.each([
  ['mark-left', (c, as) => markLeft(c, as)],
  ['status → Left', (c, as) => putStatus(c, as, 'Left')],
  ['status → Exited', (c, as) => putStatus(c, as, 'Exited')],
])('sales %s', (label, call) => {
  test.each(['view1', 'fin1'])('%s → 403; rep and sales loan untouched', async (who) => {
    const c = code();
    S.addRep(db, { code: c });
    const loanId = S.salesLoan(db, { code: c });
    const before = { rep: repRow(c), loan: loanRow(loanId), events: eventCount() };

    const r = await call(c, who);
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ success: false, error: 'HR or admin access required' });
    expect(repRow(c)).toEqual(before.rep);
    expect(repRow(c).status).toBe('Active');
    expect(loanRow(loanId)).toEqual(before.loan);
    expect(loanRow(loanId)).toMatchObject({ status: 'active', exit_flag: 0 });
    expect(eventCount()).toBe(before.events);
  });
});

test.each(['hr1', 'boss'])('sales mark-left as %s → 200 and the loan is flagged (sanity)', async (who) => {
  const c = code();
  S.addRep(db, { code: c });
  const loanId = S.salesLoan(db, { code: c });
  const r = await markLeft(c, who);
  expect(r.status).toBe(200);
  expect(repRow(c).status).toBe('Left');
  expect(loanRow(loanId)).toMatchObject({ status: 'recover_at_exit', exit_flag: 1, exit_date: '2026-11-10' });
});

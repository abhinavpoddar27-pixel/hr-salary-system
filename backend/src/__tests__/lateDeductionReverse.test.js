/**
 * PUT /api/late-coming/finance-reverse/:id (owner 12 Oct 2026: people wrongly penalised for late coming).
 * An APPROVED late deduction can be reversed by finance/admin with a reason; the next Stage 7 run then drops it.
 * Real requireAuth + real JWTs, real initSchema, real recomputeSalary. Synthetic codes RV…
 */
const F = require('./helpers/leaveFixture');
const { startJwtApi } = require('./helpers/jwtApiHarness');
const { recomputeSalary } = require('../services/recompute');

const C = 'Indriyan Beverages Pvt Ltd';
let api; let db; let seq = 0;

beforeAll(() => {
  api = startJwtApi({ '/api/late-coming': '../../routes/lateComing' }, {
    users: [{ username: 'fin1', role: 'finance' }, { username: 'adm1', role: 'admin' }, { username: 'hr1', role: 'hr' }, { username: 'view1', role: 'viewer' }],
  });
  db = api.db;
});
afterAll(() => api.close());

function setup(code, month = 9, year = 2026, status = 'approved') {
  const e = F.addEmployee(db, { code, company: C, employment_type: 'Permanent' });
  db.prepare('UPDATE employees SET gross_salary = 30000 WHERE code = ?').run(code);
  F.addDayCalc(db, e, month, year, { days_present: 26, total_payable_days: 26 });
  seq++;
  return db.prepare(`INSERT INTO late_coming_deductions (employee_code, month, year, company, late_count, deduction_days, remark, applied_by, finance_status, applied_at)
    VALUES (?, ?, ?, ?, 8, 1.5, 'test', 'hr1', ?, datetime('now', ?))`).run(code, month, year, C, status, `-${seq} seconds`).lastInsertRowid;
}
const stage7 = (month, year) => F.silently(() => recomputeSalary(db, { month, year, company: C }));
const sal = (code) => db.prepare('SELECT late_coming_deduction l, net_salary n FROM salary_computations WHERE employee_code = ? AND month = 9 AND year = 2026').get(code);
const ded = (id) => db.prepare('SELECT * FROM late_coming_deductions WHERE id = ?').get(id);
const reverse = (id, as, remark = 'Stayed late the previous evening — not a habit') =>
  api.request('PUT', `/api/late-coming/finance-reverse/${id}`, { body: { remark }, as });

test('reversing a deduction already in salary: row rejected, salary marked stale, Stage 7 re-run drops it', async () => {
  const id = setup('RV01');
  stage7(9, 2026);
  const before = sal('RV01');
  expect(before.l).toBe(1500); expect(ded(id).is_applied_to_salary).toBe(1);

  const r = await reverse(id, 'fin1');
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ success: true, wasApplied: true, needsStage7: true, month: 9, year: 2026 });
  const d = ded(id);
  expect(d.finance_status).toBe('rejected'); expect(d.is_applied_to_salary).toBe(0);
  expect(d.finance_remark).toBe('Reversed after approval: Stayed late the previous evening — not a habit');
  expect(d.finance_reviewed_by).toBe('fin1');
  expect(db.prepare("SELECT salary_stale s FROM day_calculations WHERE employee_code = 'RV01' AND month = 9").get().s).toBe(1);
  const audit = db.prepare("SELECT * FROM audit_log WHERE table_name = 'late_coming_deductions' AND record_id = ? AND action_type = 'finance_reverse'").get(id);
  expect(audit).toMatchObject({ old_value: 'approved', new_value: 'rejected', changed_by: 'fin1', employee_code: 'RV01' });

  stage7(9, 2026);
  const after = sal('RV01');
  expect(after.l).toBe(0);
  expect(after.n).toBe(before.n + 1500);
  expect(db.prepare("SELECT salary_stale s FROM day_calculations WHERE employee_code = 'RV01' AND month = 9").get().s).toBe(0);
});

test('admin can reverse; a deduction not yet in salary needs no re-run', async () => {
  const id = setup('RV02');
  const r = await reverse(id, 'adm1');
  expect(r.status).toBe(200); expect(r.body.wasApplied).toBe(false);
  expect(ded(id).finance_status).toBe('rejected');
});

test('hr, viewer and no login are refused; nothing changes', async () => {
  const id = setup('RV03');
  expect((await reverse(id, 'hr1')).status).toBe(403);
  expect((await reverse(id, 'view1')).status).toBe(403);
  expect((await reverse(id, null)).status).toBe(401);
  expect(ded(id).finance_status).toBe('approved');
});

test('reason under 10 characters, pending / rejected rows, unknown id and a finalised month are refused', async () => {
  const id = setup('RV04');
  expect((await reverse(id, 'fin1', '  short   ')).status).toBe(400);
  expect(ded(id).finance_status).toBe('approved');

  const pend = setup('RV05', 9, 2026, 'pending');
  const p = await reverse(pend, 'fin1');
  expect(p.status).toBe(409); expect(p.body.error).toMatch('this one is pending');
  const rej = setup('RV06', 9, 2026, 'rejected');
  expect((await reverse(rej, 'fin1')).status).toBe(409);
  expect((await reverse(999999, 'fin1')).status).toBe(404);

  const old = setup('RV07', 7, 2026);
  db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (7, 2026, ?, 1)").run(C);
  const f = await reverse(old, 'fin1');
  expect(f.status).toBe(409); expect(f.body.code).toBe('MONTH_FINALISED');
  expect(ded(old).finance_status).toBe('approved');
});

test('reversing twice: the second call is refused', async () => {
  const id = setup('RV08');
  expect((await reverse(id, 'fin1')).status).toBe(200);
  expect((await reverse(id, 'fin1')).status).toBe(409);
  expect(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE record_id = ? AND action_type = 'finance_reverse'").get(id).n).toBe(1);
});

/**
 * N-MONEY2 (12 Oct 2026) — money permission batch 4. Real routers behind the real
 * requireAuth, real JWTs. Fictional codes and money only.
 *  N-19  PUT /employees/:code/salary: a same-gross split change rewrote
 *        salary_structures with no finance approval; an explicit 0 % became 50/20.
 *  N-23  PUT /finance-audit/approve-flag + bulk-approve: the person behind a gross
 *        change could decide its flag; a revert left the request reading "Approved".
 *  ED    POST /extra-duty-grants/:id/finance-approve (+ bulk) approved a
 *        FINANCE_REJECTED grant directly at its old days.
 *  Tax   GET /tax-declarations/:code(/calculate) were open to every role.
 *  Pay   POST /payroll/calculate-days, compute-salary, finalise had no role guard.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');
const S = require('./helpers/statutoryFixture');

const USERS = [
  { username: 'boss', role: 'admin' },
  { username: 'boss2', role: 'admin' },
  { username: 'fin1', role: 'finance' },
  { username: 'fin2', role: 'finance' },
  { username: 'hr1', role: 'hr' },
  { username: 'view1', role: 'viewer' },
  { username: 'sup1', role: 'supervisor' },
  { username: 'emp1', role: 'employee', employeeCode: 'T9899' },
];

let api; let db;
beforeAll(() => {
  api = startJwtApi({
    '/api/employees': '../../routes/employees',
    '/api/finance-audit': '../../routes/financeAudit',
    '/api/salary-input': '../../routes/salary-input',
    '/api/extra-duty-grants': '../../routes/extraDutyGrants',
    '/api/tax-declarations': '../../routes/taxDeclarations',
    '/api/payroll': '../../routes/payroll',
  }, { users: USERS });
  db = api.db;
});
afterAll(() => api.close());

let seq = 0;
const code = () => `T98${String(++seq).padStart(2, '0')}`;
const structs = (id) => db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY id').all(id);
const pending = (c) => db.prepare("SELECT * FROM salary_change_requests WHERE employee_code = ? AND status = 'Pending'").all(c);

/** What the Employee Master salary window sends for a structure row. */
function windowBody(s, over = {}) {
  return {
    gross_salary: s.gross_salary,
    basic_percent: s.basic_percent, hra_percent: s.hra_percent, da_percent: s.da_percent,
    special_allowance_percent: s.special_allowance / s.gross_salary * 100,
    other_allowance: s.other_allowances, pf_wage_ceiling: s.pf_wage_ceiling, pt_applicable: 0,
    ...over,
  };
}

// ── N-19 ───────────────────────────────────────────────────────────────
describe('N-19 — PUT /employees/:code/salary, same gross', () => {
  test('a changed split raises a Pending request; the structure is untouched', async () => {
    const e = S.plant(db, { code: code(), gross_salary: 20000 });
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 20000 });
    const before = structs(e.id);
    const r = await api.request('PUT', `/api/employees/${e.code}/salary`, { as: 'hr1', body: windowBody(before[0], { basic_percent: 40 }) });
    expect(r.status).toBe(200);
    expect(r.body.pendingApproval).toBe(true);
    expect(structs(e.id)).toEqual(before);
    const reqs = pending(e.code);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].requested_by).toBe('hr1');
    expect(reqs[0].old_gross).toBe(20000);
    expect(reqs[0].new_gross).toBe(20000);
    const ns = JSON.parse(reqs[0].new_structure);
    expect(ns.basic).toBe(8000);
    expect(ns.basic_percent).toBe(40);
  });

  test('the requester cannot approve it (P1-23); another finance user can, and only then the structure moves', async () => {
    const e = S.plant(db, { code: code(), gross_salary: 20000 });
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 20000 });
    const before = structs(e.id);
    await api.request('PUT', `/api/employees/${e.code}/salary`, { as: 'boss', body: windowBody(before[0], { hra_percent: 25 }) });
    const id = pending(e.code)[0].id;
    expect((await api.request('PUT', `/api/salary-input/approve/${id}`, { as: 'boss', body: {} })).status).toBe(403);
    expect(structs(e.id)).toEqual(before);
    const ok = await api.request('PUT', `/api/salary-input/approve/${id}`, { as: 'fin1', body: {} });
    expect(ok.status).toBe(200);
    const latest = db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC, id DESC LIMIT 1').get(e.id);
    expect(latest.hra).toBe(5000);
    expect(db.prepare('SELECT gross_salary FROM employees WHERE id = ?').get(e.id).gross_salary).toBe(20000);
  });

  test('an untouched save is still "structureUnchanged" and raises nothing', async () => {
    const e = S.plant(db, { code: code(), gross_salary: 20000 });
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 20000, basic: 9876.5 }); // amount ≠ gross × %
    const before = structs(e.id);
    const r = await api.request('PUT', `/api/employees/${e.code}/salary`, { as: 'hr1', body: windowBody(before[0]) });
    expect(r.body.structureUnchanged).toBe(true);
    expect(pending(e.code)).toHaveLength(0);
    expect(structs(e.id)).toEqual(before);
  });

  test('an explicit 0 % is kept as 0 (was turned into 50 / 20)', async () => {
    const e = S.plant(db, { code: code(), gross_salary: 20000 });
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 20000 });
    await api.request('PUT', `/api/employees/${e.code}/salary`, { as: 'hr1', body: windowBody(structs(e.id)[0], { hra_percent: 0 }) });
    const ns = JSON.parse(pending(e.code)[0].new_structure);
    expect(ns.hra_percent).toBe(0);
    expect(ns.hra).toBe(0);
    expect(ns.basic_percent).toBe(50);
  });

  test('a gross change with basic 0 % and fields left out keeps the stored split, not 50/20', async () => {
    const e = S.plant(db, { code: code(), gross_salary: 20000 });
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 20000, basic_percent: 60, hra_percent: 15, basic: 12000, hra: 3000 });
    await api.request('PUT', `/api/employees/${e.code}/salary`, { as: 'hr1', body: { gross_salary: 30000, da_percent: 0 } });
    const ns = JSON.parse(pending(e.code)[0].new_structure);
    expect(ns.basic_percent).toBe(60);
    expect(ns.hra_percent).toBe(15);
    expect(ns.basic).toBe(18000);
  });

  test('unreadable text keeps the stored value; out of range → 400, nothing written', async () => {
    const e = S.plant(db, { code: code(), gross_salary: 20000 });
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 20000 });
    const before = structs(e.id);
    const r1 = await api.request('PUT', `/api/employees/${e.code}/salary`, { as: 'hr1', body: windowBody(before[0], { basic_percent: 'abc' }) });
    expect(r1.body.structureUnchanged).toBe(true);
    const r2 = await api.request('PUT', `/api/employees/${e.code}/salary`, { as: 'hr1', body: windowBody(before[0], { basic_percent: 140, account_number: '999900009999' }) });
    expect(r2.status).toBe(400);
    expect(r2.body.code).toBe('SPLIT_OUT_OF_RANGE');
    expect(db.prepare('SELECT account_number FROM employees WHERE id = ?').get(e.id).account_number).toBeNull();
    expect(pending(e.code)).toHaveLength(0);
    expect(structs(e.id)).toEqual(before);
  });

  test('a second split change while one is pending creates no second request', async () => {
    const e = S.plant(db, { code: code(), gross_salary: 20000 });
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 20000 });
    const s = structs(e.id)[0];
    await api.request('PUT', `/api/employees/${e.code}/salary`, { as: 'hr1', body: windowBody(s, { basic_percent: 45 }) });
    const r = await api.request('PUT', `/api/employees/${e.code}/salary`, { as: 'hr1', body: windowBody(s, { basic_percent: 44 }) });
    expect(r.body.pendingApproval).toBe(true);
    expect(pending(e.code)).toHaveLength(1);
  });

  test('no structure: the default 50/20 split is still created directly; any other split goes to approval', async () => {
    const a = S.plant(db, { code: code(), gross_salary: 20000 });
    await api.request('PUT', `/api/employees/${a.code}/salary`, { as: 'hr1', body: { gross_salary: 20000 } });
    expect(structs(a.id)).toHaveLength(1);
    expect(structs(a.id)[0].basic).toBe(10000);
    const b = S.plant(db, { code: code(), gross_salary: 20000 });
    const r = await api.request('PUT', `/api/employees/${b.code}/salary`, { as: 'hr1', body: { gross_salary: 20000, basic_percent: 60 } });
    expect(r.body.pendingApproval).toBe(true);
    expect(structs(b.id)).toHaveLength(0);
  });

  test('PF wage ceiling (statutory) is still written directly', async () => {
    const e = S.plant(db, { code: code(), gross_salary: 20000 });
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 20000 });
    const r = await api.request('PUT', `/api/employees/${e.code}/salary`, { as: 'hr1', body: windowBody(structs(e.id)[0], { pf_wage_ceiling: 21000 }) });
    expect(r.body.structureUnchanged).toBe(true);
    expect(structs(e.id)[0].pf_wage_ceiling).toBe(21000);
  });
});

// ── N-23 ───────────────────────────────────────────────────────────────
describe('N-23 — flag decisions: maker-checker + reverted request', () => {
  /** Gross 15000 → 18000 through an approved request raised by `requester`, plus the Stage 7 flag. */
  function grossViaRequest(requester, { month = 9 } = {}) {
    const e = S.plant(db, { code: code(), gross_salary: 18000 });
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 18000 });
    const reqId = Number(db.prepare(`INSERT INTO salary_change_requests
        (employee_id, employee_code, requested_by, old_gross, new_gross, old_structure, new_structure, reason, status, approved_by, approved_at)
        VALUES (?, ?, ?, 15000, 18000, '{}', '{}', 'synthetic', 'Approved', 'fin2', datetime('now'))`)
      .run(e.id, e.code, requester).lastInsertRowid);
    const flagId = Number(db.prepare(`INSERT INTO salary_manual_flags
        (employee_code, month, year, flag_type, field_name, system_value, manual_value, delta, changed_by, notes)
        VALUES (?, ?, 2026, 'GROSS_STRUCTURE_CHANGE', 'gross_salary', 15000, 18000, 3000, 'system', 'synthetic')`)
      .run(e.code, month).lastInsertRowid);
    return { e, reqId, flagId };
  }
  const flagRow = (id) => db.prepare('SELECT finance_approved FROM salary_manual_flags WHERE id = ?').get(id);
  const gross = (e) => db.prepare('SELECT gross_salary FROM employees WHERE id = ?').get(e.id).gross_salary;
  const reqStatus = (id) => db.prepare('SELECT status FROM salary_change_requests WHERE id = ?').get(id).status;

  test('the requester of the gross change cannot decide its flag (any status); nothing written', async () => {
    const { e, reqId, flagId } = grossViaRequest('boss');
    for (const status of ['APPROVED', 'REJECTED', 'CLEAR']) {
      const r2 = await api.request('PUT', `/api/finance-audit/approve-flag/${flagId}`, { as: 'boss', body: { status, comments: 'x' } });
      expect(r2.status).toBe(403);
      expect(r2.body.code).toBe('SELF_APPROVAL');
    }
    expect(flagRow(flagId).finance_approved).toBe(0);
    expect(gross(e)).toBe(18000);
    expect(reqStatus(reqId)).toBe('Approved');
    expect(db.prepare('SELECT COUNT(*) c FROM finance_approvals WHERE flag_id = ?').get(flagId).c).toBe(0);
  });

  test('case / spaces in the stored requester still match', async () => {
    const { flagId } = grossViaRequest('  Fin1 ');
    const r = await api.request('PUT', `/api/finance-audit/approve-flag/${flagId}`, { as: 'fin1', body: { status: 'APPROVED' } });
    expect(r.status).toBe(403);
  });

  test('bulk: one self-raised flag refuses the whole batch', async () => {
    const a = grossViaRequest('hr1');
    const b = grossViaRequest('fin1');
    const r = await api.request('PUT', '/api/finance-audit/bulk-approve', { as: 'fin1', body: { flagIds: [a.flagId, b.flagId], status: 'APPROVED' } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SELF_APPROVAL');
    expect(flagRow(a.flagId).finance_approved).toBe(0);
    expect(flagRow(b.flagId).finance_approved).toBe(0);
  });

  test('another user rejects → gross reverted, request reads "Reverted" with an audit row, message says re-run Stage 7', async () => {
    const { e, reqId, flagId } = grossViaRequest('hr1');
    const r = await api.request('PUT', `/api/finance-audit/approve-flag/${flagId}`, { as: 'fin1', body: { status: 'REJECTED', comments: 'not agreed' } });
    expect(r.status).toBe(200);
    expect(r.body.reverted).toBe(true);
    expect(r.body.message).toMatch(/Stage 7/);
    expect(gross(e)).toBe(15000);
    expect(reqStatus(reqId)).toBe('Reverted');
    const audit = db.prepare("SELECT * FROM audit_log WHERE table_name = 'salary_change_requests' AND record_id = ?").all(reqId);
    expect(audit).toHaveLength(1);
    expect(audit[0].new_value).toBe('Reverted');
  });

  test('bulk reject by another user: message + request reverted', async () => {
    const a = grossViaRequest('hr1');
    const r = await api.request('PUT', '/api/finance-audit/bulk-approve', { as: 'boss2', body: { flagIds: [a.flagId], status: 'REJECTED' } });
    expect(r.status).toBe(200);
    expect(r.body.reverted).toBe(1);
    expect(r.body.message).toMatch(/Stage 7/);
    expect(reqStatus(a.reqId)).toBe('Reverted');
  });

  test('a request that does not match the flag gross is neither blocking nor marked', async () => {
    const { e, reqId, flagId } = grossViaRequest('fin1');
    db.prepare('UPDATE salary_change_requests SET new_gross = 17000 WHERE id = ?').run(reqId);
    const r = await api.request('PUT', `/api/finance-audit/approve-flag/${flagId}`, { as: 'fin1', body: { status: 'REJECTED' } });
    expect(r.status).toBe(200);
    expect(gross(e)).toBe(15000);
    expect(reqStatus(reqId)).toBe('Approved');
  });

  test('system-raised flags (no person behind them) stay decidable by anyone in finance', async () => {
    const e = S.plant(db, { code: code() });
    const id = Number(db.prepare(`INSERT INTO salary_manual_flags (employee_code, month, year, flag_type, field_name, system_value, manual_value, delta, changed_by)
      VALUES (?, 9, 2026, 'MANUAL_TDS', 'tds', 0, 500, 500, 'system')`).run(e.code).lastInsertRowid);
    expect((await api.request('PUT', `/api/finance-audit/approve-flag/${id}`, { as: 'fin1', body: { status: 'APPROVED' } })).status).toBe(200);
  });
});

// ── Extra duty finance approve ─────────────────────────────────────────
describe('Extra duty — finance approves only waiting, HR-approved grants', () => {
  let ins;
  beforeAll(() => {
    ins = db.prepare(`INSERT INTO extra_duty_grants (employee_code, grant_date, month, year, company, grant_type, duty_days,
      verification_source, remarks, status, finance_status, requested_by, approved_by)
      VALUES (?, ?, 9, 2026, 'Test Co', 'OVERNIGHT_STAY', 1, 'Gate Register', 'synthetic', ?, ?, 'hr1', 'hr1')`);
  });
  let day = 0;
  const grant = (status, finance) => Number(ins.run(code(), `2026-09-${String(++day).padStart(2, '0')}`, status, finance).lastInsertRowid);
  const fs = (id) => db.prepare('SELECT finance_status FROM extra_duty_grants WHERE id = ?').get(id).finance_status;

  test.each([
    ['APPROVED', 'FINANCE_REJECTED', /Return to HR/],
    ['APPROVED', 'FINANCE_APPROVED', /already approved/],
    ['PENDING', 'UNREVIEWED', /HR has not approved/],
  ])('%s / %s → 409, unchanged', async (status, finance, msg) => {
    const id = grant(status, finance);
    const r = await api.request('POST', `/api/extra-duty-grants/${id}/finance-approve`, { as: 'fin1', body: {} });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(msg);
    expect(fs(id)).toBe(finance);
  });

  test.each([['UNREVIEWED'], ['FINANCE_FLAGGED']])('APPROVED / %s → approved', async (finance) => {
    const id = grant('APPROVED', finance);
    const r = await api.request('POST', `/api/extra-duty-grants/${id}/finance-approve`, { as: 'fin1', body: {} });
    expect(r.status).toBe(200);
    expect(fs(id)).toBe('FINANCE_APPROVED');
  });

  test('bulk: eligible ones approved, the rest reported in skipped', async () => {
    const ok = grant('APPROVED', 'UNREVIEWED');
    const rej = grant('APPROVED', 'FINANCE_REJECTED');
    const r = await api.request('POST', '/api/extra-duty-grants/bulk-finance-approve', { as: 'fin1', body: { ids: [ok, rej, 999999] } });
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(1);
    expect(r.body.skipped.map((s) => s.id).sort()).toEqual([rej, 999999].sort());
    expect(fs(ok)).toBe('FINANCE_APPROVED');
    expect(fs(rej)).toBe('FINANCE_REJECTED');
  });

  test('bulk with no ids → 400', async () => {
    expect((await api.request('POST', '/api/extra-duty-grants/bulk-finance-approve', { as: 'fin1', body: {} })).status).toBe(400);
  });
});

// ── Tax declarations ───────────────────────────────────────────────────
describe('Tax declarations — reads are hr / finance / admin only', () => {
  test.each(['view1', 'sup1', 'emp1'])('%s → 403 on both GETs', async (who) => {
    expect((await api.request('GET', '/api/tax-declarations/T9801', { as: who })).status).toBe(403);
    expect((await api.request('GET', '/api/tax-declarations/T9801/calculate', { as: who })).status).toBe(403);
  });
  test.each(['hr1', 'fin1', 'boss'])('%s → allowed', async (who) => {
    expect((await api.request('GET', '/api/tax-declarations/T9801', { as: who })).status).toBe(200);
    expect((await api.request('GET', '/api/tax-declarations/T9801/calculate', { as: who })).status).not.toBe(403);
  });
});

// ── Payroll guards ─────────────────────────────────────────────────────
describe('Payroll — Stage 6 / Stage 7 / finalise need hr, finance or admin', () => {
  const routes = ['/api/payroll/calculate-days', '/api/payroll/compute-salary', '/api/payroll/finalise'];
  test.each(['view1', 'sup1', 'emp1'])('%s → 403 on all three, nothing run', async (who) => {
    for (const url of routes) {
      const r = await api.request('POST', url, { as: who, body: { month: 9, year: 2091, company: '' } });
      expect(r.status).toBe(403);
    }
    expect(db.prepare('SELECT COUNT(*) c FROM day_calculations WHERE year = 2091').get().c).toBe(0);
  });
  test.each(['hr1', 'fin1', 'boss'])('%s is not refused by the guard', async (who) => {
    for (const url of routes) {
      const r = await api.request('POST', url, { as: who, body: { month: 9, year: 2091, company: '' } });
      // finalise may still answer 403 for the finance sign-off gate — never the role guard
      expect(r.body.error).not.toBe('HR, finance or admin access required');
    }
  });
});

/**
 * N-PF-LOWS (planner rulings 22 Oct 2026) — input checks on the PF wage ceiling, the
 * salary split and the gross, the same on the Employee Master window
 * (PUT /employees/:code/salary) and Salary Input (POST /salary-input/request-change).
 * Real routers behind the real requireAuth. Fictional codes and money only.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');
const S = require('./helpers/statutoryFixture');

const USERS = [
  { username: 'boss', role: 'admin' },
  { username: 'fin1', role: 'finance' },
  { username: 'hr1', role: 'hr' },
];

let api; let db; let requestedCeiling; let split;
beforeAll(() => {
  api = startJwtApi({
    '/api/employees': '../../routes/employees',
    '/api/salary-input': '../../routes/salary-input',
  }, { users: USERS });
  db = api.db;
  ({ requestedCeiling } = require('../routes/salary-input'));
  split = require('../services/salarySplit');
});
afterAll(() => api.close());

let seq = 0;
const code = () => `T96${String(++seq).padStart(2, '0')}`;
const structs = (id) => db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from, id').all(id);
const pending = (c) => db.prepare("SELECT * FROM salary_change_requests WHERE employee_code = ? AND status = 'Pending'").all(c);
const empRow = (id) => db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
const save = (e, body, as = 'hr1') => api.request('PUT', `/api/employees/${e.code}/salary`, { as, body });
const requestChange = (e, newStructure, as = 'hr1') =>
  api.request('POST', '/api/salary-input/request-change', { as, body: { employeeCode: e.code, newStructure, reason: 'test' } });

function windowBody(s, over = {}) {
  return {
    gross_salary: s.gross_salary,
    basic_percent: s.basic_percent, hra_percent: s.hra_percent, da_percent: s.da_percent,
    special_allowance_percent: s.special_allowance / s.gross_salary * 100,
    other_allowance: s.other_allowances, pf_wage_ceiling: s.pf_wage_ceiling, pt_applicable: 0,
    ...over,
  };
}
function withStructure(gross = 20000) {
  const e = S.plant(db, { code: code(), gross_salary: gross });
  S.plantStructure(db, e, '2025-01-01', { gross_salary: gross });
  return e;
}
const snapshot = (e) => ({ emp: empRow(e.id), structs: structs(e.id), pending: pending(e.code) });

describe('PUT /employees/:code/salary — PF wage ceiling', () => {
  test('ceiling as text → 400 NOT_A_NUMBER, nothing written (bank field in the same body not saved)', async () => {
    const e = withStructure();
    const before = snapshot(e);
    const r = await save(e, windowBody(before.structs[0], { pf_wage_ceiling: 'abc', account_number: '111122223333' }));
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ success: false, code: 'NOT_A_NUMBER', field: 'pf_wage_ceiling' });
    expect(r.body.error).toMatch(/PF wage ceiling must be a number/);
    expect(snapshot(e)).toEqual(before);
  });

  test.each([[0], [-1], [100001], ['15,000']])('ceiling %p → 400, nothing written', async (v) => {
    const e = withStructure();
    const before = snapshot(e);
    const r = await save(e, windowBody(before.structs[0], { pf_wage_ceiling: v }));
    expect(r.status).toBe(400);
    expect(['SPLIT_OUT_OF_RANGE', 'NOT_A_NUMBER']).toContain(r.body.code);
    expect(snapshot(e)).toEqual(before);
  });

  test('ceiling exactly ₹1,00,000 → request raised (the limit itself is allowed)', async () => {
    const e = withStructure();
    const r = await save(e, windowBody(structs(e.id)[0], { pf_wage_ceiling: 100000 }));
    expect(r.status).toBe(200);
    expect(r.body.pendingApproval).toBe(true);
    expect(JSON.parse(pending(e.code)[0].new_structure).pf_wage_ceiling).toBe(100000);
  });

  test('ceiling left blank → stored value kept, structureUnchanged (control)', async () => {
    const e = withStructure();
    const before = snapshot(e);
    const r = await save(e, windowBody(before.structs[0], { pf_wage_ceiling: '' }));
    expect(r.status).toBe(200);
    expect(r.body.structureUnchanged).toBe(true);
    expect(snapshot(e).structs).toEqual(before.structs);
  });

  test('other allowance as text → 400 NOT_A_NUMBER', async () => {
    const e = withStructure();
    const r = await save(e, windowBody(structs(e.id)[0], { other_allowance: 'x' }));
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'NOT_A_NUMBER', field: 'other_allowance' });
  });
});

describe('PUT /employees/:code/salary — gross', () => {
  test('gross blank + changed split → 400 GROSS_REQUIRED, nothing written', async () => {
    const e = withStructure();
    const before = snapshot(e);
    const r = await save(e, windowBody(before.structs[0], { gross_salary: '', basic_percent: 40, account_number: '444455556666' }));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('GROSS_REQUIRED');
    expect(r.body.error).toMatch(/nothing was saved/);
    expect(snapshot(e)).toEqual(before);
  });

  test('gross 0 + changed ceiling → 400 GROSS_REQUIRED', async () => {
    const e = withStructure();
    const before = snapshot(e);
    const r = await save(e, windowBody(before.structs[0], { gross_salary: 0, pf_wage_ceiling: 21000 }));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('GROSS_REQUIRED');
    expect(snapshot(e)).toEqual(before);
  });

  test('gross blank + split unchanged + new account → 200, account saved, says "bank and ID details"', async () => {
    const e = withStructure();
    const before = structs(e.id);
    const r = await save(e, windowBody(before[0], { gross_salary: '', account_number: '777788889999' }));
    expect(r.status).toBe(200);
    expect(r.body.message).toBe('Saved — bank and ID details');
    expect(empRow(e.id).account_number).toBe('777788889999');
    expect(structs(e.id)).toEqual(before);
    expect(pending(e.code)).toHaveLength(0);
  });

  test('no gross and no structure on record, default window → 200 (bank-only save still works)', async () => {
    const e = S.plant(db, { code: code(), gross_salary: 0 });
    const r = await save(e, {
      gross_salary: '', basic_percent: 50, hra_percent: 20, da_percent: 0, special_allowance_percent: 0,
      other_allowance: 0, pf_wage_ceiling: 15000, account_number: '123412341234',
    });
    expect(r.status).toBe(200);
    expect(structs(e.id)).toHaveLength(0);
    expect(empRow(e.id).account_number).toBe('123412341234');
  });

  test.each([['abc', 'NOT_A_NUMBER'], ['-5', 'GROSS_OUT_OF_RANGE'], [-5, 'GROSS_OUT_OF_RANGE']])(
    'gross %p → 400 %s, nothing written', async (g, codeExpected) => {
      const e = withStructure();
      const before = snapshot(e);
      const r = await save(e, windowBody(before.structs[0], { gross_salary: g }));
      expect(r.status).toBe(400);
      expect(r.body.code).toBe(codeExpected);
      expect(snapshot(e)).toEqual(before);
    });

  test('already pending + new split → alreadyPending + notSaved, request untouched, bank saved', async () => {
    const e = withStructure();
    const s0 = structs(e.id)[0];
    await save(e, windowBody(s0, { gross_salary: 22000 }));
    const p0 = pending(e.code);
    expect(p0).toHaveLength(1);
    const r = await save(e, windowBody(s0, { basic_percent: 45, account_number: '555566667777' }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ pendingApproval: true, alreadyPending: true, notSaved: true });
    expect(r.body.message).toMatch(/new salary values were not saved/);
    expect(r.body.message).toMatch(/Bank and ID details were saved/);
    expect(pending(e.code)).toEqual(p0);
    expect(empRow(e.id).account_number).toBe('555566667777');
    expect(structs(e.id)).toEqual([s0]);
  });
});

describe('POST /salary-input/request-change — same rules', () => {
  test.each([
    [{ basic: -1 }, 'SPLIT_OUT_OF_RANGE'],
    [{ basic: 'abc' }, 'NOT_A_NUMBER'],
    [{ basic: 10000, basic_percent: 120 }, 'SPLIT_OUT_OF_RANGE'],
    [{ basic: 10000, pf_wage_ceiling: 1e9 }, 'SPLIT_OUT_OF_RANGE'],
    [{ basic: 10000, pf_wage_ceiling: 0 }, 'SPLIT_OUT_OF_RANGE'],
    [{ basic: 10000, pf_wage_ceiling: 'x' }, 'NOT_A_NUMBER'],
  ])('%p → 400 %s, no request written', async (ns, codeExpected) => {
    const e = withStructure();
    const r = await requestChange(e, ns);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe(codeExpected);
    expect(pending(e.code)).toHaveLength(0);
  });

  test('normal body → 200, one request (control); second one → alreadyPending, not saved', async () => {
    const e = withStructure();
    const ns = { basic: 11000, da: 0, hra: 4000, conveyance: 0, other_allowances: 5000 };
    const r1 = await requestChange(e, ns);
    expect(r1.status).toBe(200);
    expect(r1.body.alreadyPending).toBeUndefined();
    const p = pending(e.code);
    expect(p).toHaveLength(1);
    expect(p[0].new_gross).toBe(20000);
    const r2 = await requestChange(e, { ...ns, basic: 12000 });
    expect(r2.status).toBe(200);
    expect(r2.body).toMatchObject({ alreadyPending: true, notSaved: true });
    expect(pending(e.code)).toEqual(p);
  });

  test('numbers sent as text are added up as numbers (was string concatenation)', async () => {
    const e = withStructure();
    const r = await requestChange(e, { basic: '10000', hra: '5000', da: '0', conveyance: '0', other_allowances: '5000' });
    expect(r.status).toBe(200);
    expect(pending(e.code)[0].new_gross).toBe(20000);
  });
});

describe('helpers', () => {
  test('requestedCeiling writes only an in-range, changed ceiling', () => {
    expect(requestedCeiling({ pf_wage_ceiling: 0 }, {})).toBeNull();
    expect(requestedCeiling({ pf_wage_ceiling: 100001 }, {})).toBeNull();
    expect(requestedCeiling({ pf_wage_ceiling: 25000 }, {})).toBe(25000);
  });
  test('PF_CEILING_MAX is ₹1,00,000', () => {
    expect(split.PF_CEILING_MAX).toBe(100000);
  });
  test('a stored out-of-range ceiling does not block an unrelated save (only a SENT ceiling is checked)', () => {
    const stored = split.storedSplit({ basic_percent: 50, hra_percent: 20, da_percent: 0, gross_salary: 20000, special_allowance: 0, other_allowances: 0, pf_wage_ceiling: 0 });
    expect(split.resolveSplit({ basic_percent: 50 }, stored).split.pfCeiling).toBe(0);
  });
});

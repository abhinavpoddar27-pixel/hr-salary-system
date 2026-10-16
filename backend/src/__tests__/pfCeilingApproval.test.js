/**
 * N-PF (owner ruling 16 Oct 2026) — a PF wage ceiling change at the same gross goes
 * to finance approval like a split change (N-19), never a direct write. Real routers
 * behind the real requireAuth. Fictional codes and money only.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');
const S = require('./helpers/statutoryFixture');

const USERS = [
  { username: 'boss', role: 'admin' },
  { username: 'fin1', role: 'finance' },
  { username: 'hr1', role: 'hr' },
];

let api; let db; let requestedCeiling;
beforeAll(() => {
  api = startJwtApi({
    '/api/employees': '../../routes/employees',
    '/api/salary-input': '../../routes/salary-input',
  }, { users: USERS });
  db = api.db;
  ({ requestedCeiling } = require('../routes/salary-input')); // after the harness sets JWT_SECRET
});
afterAll(() => api.close());

let seq = 0;
const code = () => `T95${String(++seq).padStart(2, '0')}`;
const structs = (id) => db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from, id').all(id);
const latest = (id) => db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC, id DESC LIMIT 1').get(id);
const pending = (c) => db.prepare("SELECT * FROM salary_change_requests WHERE employee_code = ? AND status = 'Pending'").all(c);
const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const save = (e, body, as = 'hr1') => api.request('PUT', `/api/employees/${e.code}/salary`, { as, body });
const approve = (id, as = 'fin1') => api.request('PUT', `/api/salary-input/approve/${id}`, { as, body: {} });

function windowBody(s, over = {}) {
  return {
    gross_salary: s.gross_salary,
    basic_percent: s.basic_percent, hra_percent: s.hra_percent, da_percent: s.da_percent,
    special_allowance_percent: s.special_allowance / s.gross_salary * 100,
    other_allowance: s.other_allowances, pf_wage_ceiling: s.pf_wage_ceiling, pt_applicable: 0,
    ...over,
  };
}
function withStructure(over = {}) {
  const e = S.plant(db, { code: code(), gross_salary: 20000 });
  S.plantStructure(db, e, '2025-01-01', { gross_salary: 20000, ...over });
  return e;
}

describe('PUT /employees/:code/salary — ceiling at the same gross', () => {
  test('ceiling only → one pending request, structure untouched', async () => {
    const e = withStructure();
    const before = structs(e.id)[0];
    const r = await save(e, windowBody(before, { pf_wage_ceiling: 21000 }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, pendingApproval: true });
    expect(r.body.alreadyPending).toBeUndefined();
    expect(r.body.message).toMatch(/PF wage ceiling change submitted for finance approval/);
    expect(structs(e.id)).toEqual([before]);
    const p = pending(e.code);
    expect(p).toHaveLength(1);
    expect(p[0].old_gross).toBe(20000);
    expect(p[0].new_gross).toBe(20000);
    expect(p[0].reason).toMatch(/PF wage ceiling/);
    expect(JSON.parse(p[0].new_structure).pf_wage_ceiling).toBe(21000);
    expect(JSON.parse(p[0].old_structure).pf_wage_ceiling).toBe(15000);
  });

  test('second save while one is pending → alreadyPending, nothing new raised or written', async () => {
    const e = withStructure();
    const before = structs(e.id)[0];
    await save(e, windowBody(before, { pf_wage_ceiling: 21000 }));
    const r = await save(e, windowBody(before, { pf_wage_ceiling: 25000 }));
    expect(r.body).toMatchObject({ pendingApproval: true, alreadyPending: true });
    expect(r.body.message).toMatch(/already pending/);
    expect(pending(e.code)).toHaveLength(1);
    expect(JSON.parse(pending(e.code)[0].new_structure).pf_wage_ceiling).toBe(21000);
    expect(structs(e.id)).toEqual([before]);
  });

  test('ceiling + split change → ONE request carrying both', async () => {
    const e = withStructure();
    const r = await save(e, windowBody(structs(e.id)[0], { pf_wage_ceiling: 21000, basic_percent: 40 }));
    expect(r.body.pendingApproval).toBe(true);
    expect(r.body.message).toMatch(/split and PF wage ceiling/);
    const p = pending(e.code);
    expect(p).toHaveLength(1);
    const ns = JSON.parse(p[0].new_structure);
    expect([ns.basic_percent, ns.pf_wage_ceiling]).toEqual([40, 21000]);
  });

  test('ceiling + gross change → ONE request; approval writes gross AND ceiling', async () => {
    const e = withStructure();
    const r = await save(e, windowBody(structs(e.id)[0], { gross_salary: 24000, pf_wage_ceiling: 21000 }));
    expect(r.body.pendingApproval).toBe(true);
    expect(pending(e.code)).toHaveLength(1);
    expect((await approve(pending(e.code)[0].id)).status).toBe(200);
    const s = latest(e.id);
    expect([s.gross_salary, s.pf_wage_ceiling]).toEqual([24000, 21000]);
  });

  test('untouched save (same ceiling, same split) → structureUnchanged, no request', async () => {
    const e = withStructure();
    const before = structs(e.id)[0];
    const r = await save(e, windowBody(before));
    expect(r.body.structureUnchanged).toBe(true);
    expect(pending(e.code)).toHaveLength(0);
    expect(structs(e.id)).toEqual([before]);
  });

  test('ceiling left out / blank → counts as unchanged', async () => {
    const e = withStructure({ pf_wage_ceiling: 18000 });
    const before = structs(e.id)[0];
    expect((await save(e, windowBody(before, { pf_wage_ceiling: undefined }))).body.structureUnchanged).toBe(true);
    expect((await save(e, windowBody(before, { pf_wage_ceiling: '' }))).body.structureUnchanged).toBe(true);
    expect(pending(e.code)).toHaveLength(0);
  });

  test('no structure on record: default split + 15000 → created directly; another ceiling → request', async () => {
    const a = S.plant(db, { code: code(), gross_salary: 20000 });
    const ra = await save(a, { gross_salary: 20000, pf_wage_ceiling: 15000 });
    expect(ra.body.message).toBe('Salary structure updated');
    expect(structs(a.id)).toHaveLength(1);
    expect(structs(a.id)[0].pf_wage_ceiling).toBe(15000);

    const b = S.plant(db, { code: code(), gross_salary: 20000 });
    const rb = await save(b, { gross_salary: 20000, pf_wage_ceiling: 21000 });
    expect(rb.body.pendingApproval).toBe(true);
    expect(structs(b.id)).toHaveLength(0);
    expect(pending(b.code)).toHaveLength(1);
  });

  test('negative ceiling → 400, nothing written', async () => {
    const e = withStructure();
    const before = structs(e.id)[0];
    const r = await save(e, windowBody(before, { pf_wage_ceiling: -1 }));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('SPLIT_OUT_OF_RANGE');
    expect(pending(e.code)).toHaveLength(0);
    expect(structs(e.id)).toEqual([before]);
  });
});

describe('PUT /salary-input/approve/:id — the requested ceiling', () => {
  test('ceiling-only approval → new row today with the ceiling; components, percents, flags unchanged', async () => {
    const e = withStructure({ pf: 1, pt: 1, basic_percent: 50, hra_percent: 20 });
    const before = structs(e.id)[0];
    await save(e, windowBody(before, { pf_wage_ceiling: 21000, pt_applicable: 1 }));
    expect((await approve(pending(e.code)[0].id)).status).toBe(200);
    const s = latest(e.id);
    expect(s.effective_from).toBe(todayIST());
    expect(s.pf_wage_ceiling).toBe(21000);
    expect(s).toMatchObject({
      gross_salary: before.gross_salary, basic: before.basic, hra: before.hra, da: before.da,
      basic_percent: 50, hra_percent: 20, pf_applicable: 1,
    });
    expect(structs(e.id)[0].pf_wage_ceiling).toBe(15000); // the old row is history, not edited
  });

  test('same-date approval (row already dated today) writes the ceiling in place', async () => {
    const e = S.plant(db, { code: code(), gross_salary: 20000 });
    S.plantStructure(db, e, todayIST(), { gross_salary: 20000 });
    await save(e, windowBody(structs(e.id)[0], { pf_wage_ceiling: 0 }));
    expect((await approve(pending(e.code)[0].id)).status).toBe(200);
    const rows = structs(e.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].pf_wage_ceiling).toBe(0);
  });

  test('the requester never decides it — hr requester (403 for a finance-role check) and admin requester', async () => {
    const e = withStructure();
    await save(e, windowBody(structs(e.id)[0], { pf_wage_ceiling: 21000 }), 'boss');
    const id = pending(e.code)[0].id;
    const self = await approve(id, 'boss');
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('SELF_APPROVAL');
    expect((await approve(id, 'hr1')).status).toBe(403); // hr is not finance
    expect(latest(e.id).pf_wage_ceiling).toBe(15000);
    expect((await approve(id, 'fin1')).status).toBe(200);
    expect(latest(e.id).pf_wage_ceiling).toBe(21000);
  });

  test('reject → ceiling unchanged', async () => {
    const e = withStructure();
    await save(e, windowBody(structs(e.id)[0], { pf_wage_ceiling: 21000 }));
    const id = pending(e.code)[0].id;
    const r = await api.request('PUT', `/api/salary-input/reject/${id}`, { as: 'fin1', body: { reason: 'synthetic reject' } });
    expect(r.status).toBe(200);
    expect(structs(e.id)).toHaveLength(1);
    expect(latest(e.id).pf_wage_ceiling).toBe(15000);
  });

  test('control: a request that only echoes its snapshot ceiling carries the in-force value', async () => {
    const e = withStructure({ pf_wage_ceiling: 18000 });
    // gross change; the window sends the stored 18000 back → no ceiling change requested
    await save(e, windowBody(structs(e.id)[0], { gross_salary: 22000 }));
    // the in-force ceiling moves meanwhile (e.g. an older approval) — approval must not undo it
    db.prepare('UPDATE salary_structures SET pf_wage_ceiling = 19000 WHERE employee_id = ?').run(e.id);
    expect((await approve(pending(e.code)[0].id)).status).toBe(200);
    expect(latest(e.id).pf_wage_ceiling).toBe(19000);
  });

  test('requestedCeiling: only a real, changed, non-negative ceiling counts', () => {
    expect(requestedCeiling({ pf_wage_ceiling: 21000 }, { pf_wage_ceiling: 15000 })).toBe(21000);
    expect(requestedCeiling({ pf_wage_ceiling: 21000 }, {})).toBe(21000);
    expect(requestedCeiling({ pf_wage_ceiling: 15000 }, {})).toBeNull();
    expect(requestedCeiling({ pf_wage_ceiling: 0 }, { pf_wage_ceiling: 15000 })).toBe(0);
    expect(requestedCeiling({ pf_wage_ceiling: -5 }, {})).toBeNull();
    expect(requestedCeiling({ pf_wage_ceiling: 'abc' }, {})).toBeNull();
    expect(requestedCeiling({}, {})).toBeNull();
    expect(requestedCeiling(null, null)).toBeNull();
  });
});

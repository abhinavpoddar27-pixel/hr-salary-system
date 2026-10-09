/**
 * Statutory flags PR-1 — every structure / master writer preserves the flags
 * set by the upload (R10), through the REAL routers behind the real
 * requireAuth (jwtApiHarness) on the production-shaped DEFAULT 1 tables
 * (withLiveDefaults, C2). Synthetic codes only.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');
const S = require('./helpers/statutoryFixture');
const SF = require('../services/statutoryFlags');

const USERS = [
  { username: 'boss', role: 'admin' },
  { username: 'hr1', role: 'hr' },
  { username: 'fin1', role: 'finance' },
  { username: 'view1', role: 'viewer' },
];

let api; let db;
beforeAll(() => {
  api = startJwtApi({
    '/api/employees': '../../routes/employees',
    '/api/finance-audit': '../../routes/financeAudit',
    '/api/salary-input': '../../routes/salary-input',
    '/api/sales': '../../routes/sales',
  }, { users: USERS });
  db = S.withLiveDefaults(api.db);
});
afterAll(() => api.close());

/** Flags on the master and every structure row, in date order. */
function snapshot(emp) {
  return {
    master: S.flags(S.master(db, emp)),
    rows: S.plantRows(db, emp).map((r) => ({ d: r.effective_from, ...S.flags(r) })),
  };
}

/** An employee whose flags were set by an applied upload (ESI + LWF on, PF off). */
function uploaded(code, over = {}) {
  const e = S.plant(db, { code, gross_salary: over.gross ?? 15000 });
  S.plantStructure(db, e, '2025-01-01', { gross_salary: over.gross ?? 15000, pt: 1 });
  const r = S.applyFile(db, 'plant', S.plantFile(S.prow(code, 1, 0, 1)));
  if (!r.ok) throw new Error(JSON.stringify(r));
  expect(S.flags(S.master(db, e))).toEqual({ pf: 0, esi: 1, lwf: 1 });
  return e;
}

describe('T9a — plant master writers keep the uploaded flags', () => {
  test('PUT /employees/:code with flags (and a gross change) → flags unchanged, ignoredFields', async () => {
    const e = uploaded('W101');
    const before = snapshot(e);
    const r = await api.request('PUT', '/api/employees/W101', { as: 'boss', body: { pf_applicable: 1, esi_applicable: 0, lwf_applicable: 0, gross_salary: 16000, name: 'SYNTH 2' } });
    expect(r.status).toBe(200);
    expect(r.body.ignoredFields).toEqual(['pf_applicable', 'esi_applicable', 'lwf_applicable']);
    expect(snapshot(e)).toEqual(before);
    expect(S.master(db, e).gross_salary).toBe(16000);
  });

  test('PUT /employees/:code with only flags → "No updates", nothing changed', async () => {
    const e = uploaded('W102');
    const before = snapshot(e);
    const r = await api.request('PUT', '/api/employees/W102', { as: 'boss', body: { pf_applicable: 1, esi_applicable: 0 } });
    expect(r.body).toMatchObject({ success: true, message: 'No updates', ignoredFields: ['pf_applicable', 'esi_applicable'] });
    expect(snapshot(e)).toEqual(before);
  });

  test('PUT /employees/:code basic/da on an employee with no structure → inserted row carries the in-force flags (0 when none), not DEFAULT 1', async () => {
    const e = S.plant(db, { code: 'W103' });
    // basic/da alone hit the pre-existing "No updates" early return (not in allowedFields) — send a name too
    await api.request('PUT', '/api/employees/W103', { as: 'boss', body: { name: 'SYNTH', basic: 8000, da: 0, hra: 2000 } });
    const rows = S.plantRows(db, e);
    expect(rows.length).toBe(1);
    expect(S.flags(rows[0])).toEqual({ pf: 0, esi: 0, lwf: 0 });
  });

  test('PUT /employees/:code/salary, same gross, flags in body → flags unchanged, ignoredFields', async () => {
    const e = uploaded('W104');
    const before = snapshot(e);
    const r = await api.request('PUT', '/api/employees/W104/salary', { as: 'hr1', body: {
      gross_salary: 15000, basic_percent: 50, hra_percent: 20, pf_applicable: 1, esi_applicable: 0, lwf_applicable: 0, pt_applicable: 0,
    } });
    expect(r.status).toBe(200);
    expect(r.body.ignoredFields).toEqual(['pf_applicable', 'esi_applicable', 'lwf_applicable']);
    expect(snapshot(e)).toEqual(before);
    expect(S.master(db, e).pt_applicable).toBe(0); // pt still writable
  });

  test('PUT /employees/:code/salary, new gross → pending request; flags unchanged; request JSON has no flags', async () => {
    const e = uploaded('W105');
    const before = snapshot(e);
    const r = await api.request('PUT', '/api/employees/W105/salary', { as: 'hr1', body: { gross_salary: 18000, pf_applicable: 1, esi_applicable: 0 } });
    expect(r.body).toMatchObject({ success: true, pendingApproval: true, ignoredFields: ['pf_applicable', 'esi_applicable'] });
    expect(snapshot(e)).toEqual(before);
    const req = db.prepare("SELECT new_structure FROM salary_change_requests WHERE employee_code = 'W105'").get();
    const ns = JSON.parse(req.new_structure);
    expect(ns.pf_applicable).toBeUndefined();
    expect(ns.esi_applicable).toBeUndefined();
  });

  test('PUT /employees/:code/salary, same gross, no structure → inserted row carries 0, not DEFAULT 1', async () => {
    const e = S.plant(db, { code: 'W106', gross_salary: 15000 });
    await api.request('PUT', '/api/employees/W106/salary', { as: 'hr1', body: { gross_salary: 15000 } });
    expect(S.plantRows(db, e).map(S.flags)).toEqual([{ pf: 0, esi: 0, lwf: 0 }]);
  });

  test('bulk-import upsert of an existing employee with pf/esi in the file → flags unchanged everywhere, ignoredFields', async () => {
    const e = uploaded('W107');
    const before = snapshot(e);
    const r = await api.request('POST', '/api/employees/bulk-import', { as: 'boss', body: { employees: [
      { code: 'W107', name: 'SYNTH', gross_salary: 17000, basic: 8500, pf_applicable: 1, esi_applicable: 0, lastSeenSortKey: 202609 },
    ] } });
    expect(r.status).toBe(200);
    expect(r.body.ignoredFields).toEqual(['pf_applicable', 'esi_applicable']);
    expect(snapshot(e)).toEqual(before);
    expect(S.master(db, e).gross_salary).toBe(17000);
  });

  test('bulk-import of a NEW employee with pf/esi = 1 → master and structure 0', async () => {
    await api.request('POST', '/api/employees/bulk-import', { as: 'boss', body: { employees: [
      { code: 'W108', name: 'SYNTH', gross_salary: 14000, basic: 7000, pf_applicable: 1, esi_applicable: 1, lastSeenSortKey: 202609, date_of_joining: '2026-09-01' },
    ] } });
    const e = { id: db.prepare("SELECT id FROM employees WHERE code = 'W108'").get().id };
    expect(snapshot(e)).toEqual({ master: { pf: 0, esi: 0, lwf: 0 }, rows: [{ d: '2026-09-01', pf: 0, esi: 0, lwf: 0 }] });
  });

  test('integrity-check reports a flag mismatch; integrity-fix never writes flags (fixes gross only)', async () => {
    const e = uploaded('W109');
    // master/structure disagree on flags (e.g. someone edited the master by hand) + gross drift
    db.prepare('UPDATE employees SET pf_applicable = 1, gross_salary = 15500 WHERE id = ?').run(e.id);
    const before = snapshot(e);
    const chk = await api.request('GET', '/api/employees/admin/integrity-check', { as: 'boss' });
    expect(chk.body.data.flagMismatches.map((x) => x.code)).toContain('W109');
    const fix = await api.request('POST', '/api/employees/admin/integrity-fix', { as: 'boss', body: {} });
    const a = fix.body.actions.find((x) => x.code === 'W109');
    expect(a).toMatchObject({ action: 'updated', flagMismatch: true });
    expect(snapshot(e)).toEqual(before);
    const latest = S.plantRows(db, e).pop();
    expect(latest.gross_salary).toBe(15500);
  });

  test('integrity-fix: a flag-only mismatch is skipped and reported', async () => {
    const e = uploaded('W110');
    db.prepare('UPDATE employees SET esi_applicable = 0 WHERE id = ?').run(e.id);
    const before = snapshot(e);
    const fix = await api.request('POST', '/api/employees/admin/integrity-fix', { as: 'boss', body: {} });
    expect(fix.body.actions.find((x) => x.code === 'W110')).toMatchObject({ action: 'skipped', flagMismatch: true });
    expect(snapshot(e)).toEqual(before);
  });
});

describe('C4 — the other sync-helper callers', () => {
  test('GET /employees/:code self-heal (gross drift) → gross repaired, flags unchanged', async () => {
    const e = uploaded('W111');
    db.prepare('UPDATE employees SET gross_salary = 16500 WHERE id = ?').run(e.id);
    const before = snapshot(e);
    const r = await api.request('GET', '/api/employees/W111', { as: 'hr1' });
    expect(r.status).toBe(200);
    expect(r.body.data.salaryStructure.gross_salary).toBe(16500);
    expect(snapshot(e)).toEqual(before);
  });

  test('financeAudit gross revert (approve-flag REJECTED, GROSS_STRUCTURE_CHANGE) → gross reverted, flags unchanged', async () => {
    const e = uploaded('W112');
    db.prepare('UPDATE employees SET gross_salary = 19000 WHERE id = ?').run(e.id);
    const flagId = db.prepare(`INSERT INTO salary_manual_flags (employee_code, month, year, flag_type, system_value, manual_value)
                               VALUES ('W112', 9, 2026, 'GROSS_STRUCTURE_CHANGE', 15000, 19000)`).run().lastInsertRowid;
    const before = snapshot(e);
    const r = await api.request('PUT', `/api/finance-audit/approve-flag/${flagId}`, { as: 'fin1', body: { status: 'REJECTED', comments: 'test' } });
    expect(r.status).toBe(200);
    expect(S.master(db, e).gross_salary).toBe(15000);
    expect(S.plantRows(db, e).pop().gross_salary).toBe(15000);
    expect(snapshot(e)).toEqual(before);
  });
});

describe('T8b — new employees land with flags OFF on the DEFAULT 1 tables (L3), through Stage 7', () => {
  test('EESL-style upsert (import.js:383 SQL) + gross via PUT → master and structure 0; Stage 7 PF/ESI 0', async () => {
    db.prepare(`
      INSERT INTO employees (code, name, department, company, status, is_data_complete)
      VALUES (?, COALESCE(NULLIF(?, ''), ?), ?, ?, 'Active', 0)
      ON CONFLICT(code) DO UPDATE SET
        name = COALESCE(NULLIF(excluded.name, ''), employees.name),
        department = COALESCE(NULLIF(excluded.department, ''), employees.department),
        updated_at = datetime('now')
    `).run('W120', 'NEW JOINER', 'W120', 'PRODUCTION', S.COMPANY);
    const e = { id: db.prepare("SELECT id FROM employees WHERE code='W120'").get().id, code: 'W120', company: S.COMPANY };
    expect(S.flags(S.master(db, e))).toEqual({ pf: 0, esi: 0, lwf: 0 });
    await api.request('PUT', '/api/employees/W120', { as: 'boss', body: { gross_salary: 12000 } }); // sync create path
    expect(S.plantRows(db, e).map(S.flags)).toEqual([{ pf: 0, esi: 0, lwf: 0 }]);
    S.plantMonth(db, e, 9, 2026);
    const sc = S.computePlant(db, e, 9, 2026);
    expect(sc).toMatchObject({ pf_employee: 0, esi_employee: 0 });
  });

  test('POST /employees with basic > 0 (flags in body) → master + structure 0; Stage 7 PF/ESI 0', async () => {
    const r = await api.request('POST', '/api/employees', { as: 'boss', body: {
      code: 'W121', name: 'NEW', company: S.COMPANY, basic: 7000, hra: 2000, pf_applicable: 1, esi_applicable: 1,
    } });
    expect(r.body).toMatchObject({ success: true, ignoredFields: ['pf_applicable', 'esi_applicable'] });
    const e = { id: r.body.id, code: 'W121', company: S.COMPANY };
    db.prepare('UPDATE employees SET gross_salary = 12000 WHERE id = ?').run(e.id);
    expect(snapshot(e).master).toEqual({ pf: 0, esi: 0, lwf: 0 });
    expect(S.plantRows(db, e).map(S.flags)).toEqual([{ pf: 0, esi: 0, lwf: 0 }]);
    S.plantMonth(db, e, 9, 2026);
    expect(S.computePlant(db, e, 9, 2026)).toMatchObject({ pf_employee: 0, esi_employee: 0 });
  });
});

describe('guards (STEP 6)', () => {
  for (const who of ['hr1', 'fin1', 'view1']) {
    test(`${who} → 403 on bulk-import, integrity-check, integrity-fix`, async () => {
      expect((await api.request('POST', '/api/employees/bulk-import', { as: who, body: { employees: [{ code: 'X' }] } })).status).toBe(403);
      expect((await api.request('GET', '/api/employees/admin/integrity-check', { as: who })).status).toBe(403);
      expect((await api.request('POST', '/api/employees/admin/integrity-fix', { as: who, body: { dryRun: true } })).status).toBe(403);
    });
  }
});

module.exports = { snapshot };

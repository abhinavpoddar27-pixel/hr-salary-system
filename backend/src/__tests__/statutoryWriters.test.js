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

  test('integrity-fix syncs gross only: a pt mismatch is reported, not written', async () => {
    const e = uploaded('W113');
    db.prepare('UPDATE employees SET pt_applicable = 0 WHERE id = ?').run(e.id);
    const before = S.plantRows(db, e).map((r) => r.pt_applicable);
    const fix = await api.request('POST', '/api/employees/admin/integrity-fix', { as: 'boss', body: {} });
    expect(fix.body.actions.find((x) => x.code === 'W113')).toMatchObject({ action: 'skipped' });
    expect(S.plantRows(db, e).map((r) => r.pt_applicable)).toEqual(before);
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

// ═══════════════════════ STEP 7 — salary approval + auto-create ═══════════════════════

function pendingRequest(code, newStructure) {
  const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(code);
  return Number(db.prepare(`INSERT INTO salary_change_requests (employee_id, employee_code, requested_by, old_gross, new_gross, old_structure, new_structure, reason, status)
                            VALUES (?, ?, 'hr1', 15000, ?, '{}', ?, 't', 'Pending')`)
    .run(emp.id, code, newStructure.gross_salary || 0, JSON.stringify(newStructure)).lastInsertRowid);
}

describe('T9b — salary approval carries the in-force flags', () => {
  test('approval (effectiveFrom 2026-10-01) → new row carries ESI/LWF ON from the upload, request JSON flags ignored; master gross only', async () => {
    const e = uploaded('W130');
    db.prepare('UPDATE salary_structures SET pt_applicable = 0, basic_percent = 47, hra_percent = 21, da_percent = 3, pf_wage_ceiling = 14000 WHERE employee_id = ?').run(e.id);
    const id = pendingRequest('W130', { gross_salary: 18000, basic: 9000, hra: 3600, other_allowances: 5400, pf_applicable: 1, esi_applicable: 0 });
    const r = await api.request('PUT', `/api/salary-input/approve/${id}`, { as: 'fin1', body: { effectiveFrom: '2026-10-01' } });
    expect(r.status).toBe(200);
    const row = S.plantRows(db, e).find((x) => x.effective_from === '2026-10-01');
    expect(row).toMatchObject({ gross_salary: 18000, pf_applicable: 0, esi_applicable: 1, lwf_applicable: 1,
      pt_applicable: 0, basic_percent: 47, hra_percent: 21, da_percent: 3, pf_wage_ceiling: 14000 });
    expect(S.master(db, e)).toMatchObject({ gross_salary: 18000, pf_applicable: 0, esi_applicable: 1, lwf_applicable: 1 });
  });

  test('approval with no effectiveFrom (today) → carries the flags in force today', async () => {
    const e = uploaded('W131');
    const id = pendingRequest('W131', { gross_salary: 16000, basic: 8000, hra: 3200, other_allowances: 4800, esi_applicable: 0 });
    await api.request('PUT', `/api/salary-input/approve/${id}`, { as: 'fin1', body: {} });
    const today = new Date().toISOString().slice(0, 10);
    const row = S.plantRows(db, e).find((x) => x.effective_from === today);
    expect(S.flags(row)).toEqual(SF.carryFlags(db, 'plant', e.id, today));
    expect(S.flags(row)).toEqual({ pf: 0, esi: 1, lwf: 1 }); // today is after 2026-09-01
  });

  test('request-change strips flag keys and returns ignoredFields', async () => {
    uploaded('W132');
    const r = await api.request('POST', '/api/salary-input/request-change', { as: 'hr1', body: {
      employeeCode: 'W132', reason: 't', newStructure: { basic: 9000, hra: 3600, pf_applicable: 1, esi_applicable: 0, lwf_applicable: 0 },
    } });
    expect(r.body).toMatchObject({ success: true, ignoredFields: ['pf_applicable', 'esi_applicable', 'lwf_applicable'] });
    const ns = JSON.parse(db.prepare("SELECT new_structure FROM salary_change_requests WHERE employee_code = 'W132' ORDER BY id DESC").get().new_structure);
    expect(ns).toEqual({ basic: 9000, hra: 3600 });
  });
});

const approve = (id, effectiveFrom) => api.request('PUT', `/api/salary-input/approve/${id}`, { as: 'fin1', body: { effectiveFrom } });
const auditCount = (code) => db.prepare('SELECT COUNT(*) c FROM audit_log WHERE employee_code = ?').get(code).c;
const NEW_SPLIT = { gross_salary: 18000, basic: 12000, hra: 3600, other_allowances: 2400 };

describe('T11b — plant approval after the upload: back-dated refused, same-date in place, later-dated new row (10 Oct 2026 ruling)', () => {
  test('effectiveFrom before the 2026-09-01 row → 409, nothing written (master + request included), May–Oct byte-identical; bad format → 400', async () => {
    const e = S.plant(db, { code: 'W133', gross_salary: 15000 });
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 15000 });
    for (const m of [5, 6, 7, 8, 9, 10]) S.plantMonth(db, e, m, 2026);
    expect(S.applyFile(db, 'plant', S.plantFile(S.prow('W133', 1, 1, 1))).ok).toBe(true);
    const months = {};
    for (const m of [5, 6, 7, 8, 9, 10]) months[m] = S.computePlant(db, e, m, 2026);
    const rows = S.plantRows(db, e); const mst = S.master(db, e); const audits = auditCount('W133');
    const id = pendingRequest('W133', NEW_SPLIT);
    expect((await approve(id, '2026-5-15')).status).toBe(400);
    expect((await approve(id, '15/05/2026')).status).toBe(400);
    for (const d of ['2026-05-15', '2026-06-01', '2026-08-31']) {
      const r = await approve(id, d);
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ success: false, code: 'STRUCTURE_DATED_LATER', latestDate: '2026-09-01',
        error: 'A salary structure dated 2026-09-01 already exists; date this change on or after 2026-09-01.' });
    }
    expect(S.plantRows(db, e)).toEqual(rows);
    expect(S.master(db, e)).toEqual(mst);
    expect(auditCount('W133')).toBe(audits);
    expect(db.prepare('SELECT status FROM salary_change_requests WHERE id = ?').get(id).status).toBe('Pending');
    for (const m of [5, 6, 7, 8, 9, 10]) expect(S.computePlant(db, e, m, 2026)).toEqual(months[m]);
  });

  // Plant compute takes the stated gross from employees.gross_salary for every
  // month (salaryComputation.js 'Priority: employees.gross_salary'), so an
  // approval re-grosses earlier months on a re-run — pre-existing, not touched
  // here. These two tests pin the structure rows and the flag-driven amounts.
  test('effectiveFrom 2026-09-01 (= the upload row) → one row at that date, updated in place: components new, flags/pt/percents kept; September pays the new gross + split; earlier rows untouched, August PF/ESI unchanged', async () => {
    const e = S.plant(db, { code: 'W136', gross_salary: 15000 });
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 15000, pt: 1, basic_percent: 47, pf_wage_ceiling: 15000 });
    for (const m of [8, 9]) S.plantMonth(db, e, m, 2026);
    expect(S.applyFile(db, 'plant', S.plantFile(S.prow('W136', 1, 1, 1))).ok).toBe(true);
    const aug = S.computePlant(db, e, 8, 2026);
    const earlier = S.plantRows(db, e).filter((x) => x.effective_from < '2026-09-01');
    const n = S.plantRows(db, e).length;
    const sepRow = S.plantRows(db, e).find((x) => x.effective_from === '2026-09-01');
    const r = await approve(pendingRequest('W136', NEW_SPLIT), '2026-09-01');
    expect(r.status).toBe(200);
    const at = S.plantRows(db, e).filter((x) => x.effective_from === '2026-09-01');
    expect(at).toHaveLength(1);
    expect(S.plantRows(db, e)).toHaveLength(n);
    expect(at[0]).toMatchObject({ id: sepRow.id, gross_salary: 18000, basic: 12000, da: 0, hra: 3600, conveyance: 0, special_allowance: 0, other_allowances: 2400,
      pf_applicable: 1, esi_applicable: 1, lwf_applicable: 1, pt_applicable: sepRow.pt_applicable, basic_percent: sepRow.basic_percent, pf_wage_ceiling: sepRow.pf_wage_ceiling });
    expect(S.master(db, e)).toMatchObject({ gross_salary: 18000, pf_applicable: 1, esi_applicable: 1, lwf_applicable: 1 });
    const sep = S.computePlant(db, e, 9, 2026);
    expect(sep).toMatchObject({ gross_salary: 18000, basic_earned: 12000, hra_earned: 3600, pf_employee: 1440 });
    expect(sep.esi_employee).toBeGreaterThan(0);
    expect(S.plantRows(db, e).filter((x) => x.effective_from < '2026-09-01')).toEqual(earlier);
    const aug2 = S.computePlant(db, e, 8, 2026);
    expect({ pf: aug2.pf_employee, esi: aug2.esi_employee }).toEqual({ pf: aug.pf_employee, esi: aug.esi_employee });
  });

  test('effectiveFrom 2026-10-01 (after every row) → a new row with the in-force flags; October pays the new gross + split; the 2026-09-01 row untouched', async () => {
    const e = S.plant(db, { code: 'W137', gross_salary: 15000 });
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 15000 });
    for (const m of [9, 10]) S.plantMonth(db, e, m, 2026);
    expect(S.applyFile(db, 'plant', S.plantFile(S.prow('W137', 1, 1, 1))).ok).toBe(true);
    const sepRow = S.plantRows(db, e).find((x) => x.effective_from === '2026-09-01');
    const r = await approve(pendingRequest('W137', NEW_SPLIT), '2026-10-01');
    expect(r.status).toBe(200);
    expect(S.plantRows(db, e).find((x) => x.effective_from === '2026-10-01')).toMatchObject({ gross_salary: 18000, basic: 12000, pf_applicable: 1, esi_applicable: 1, lwf_applicable: 1 });
    expect(S.computePlant(db, e, 10, 2026)).toMatchObject({ gross_salary: 18000, basic_earned: 12000, hra_earned: 3600, pf_employee: 1440 });
    expect(S.plantRows(db, e).find((x) => x.effective_from === '2026-09-01')).toEqual(sepRow);
  });
});

describe('salaryComputation.js 301–308 auto-create lists lwf', () => {
  test('employee with gross and no structure → auto-created row carries the master flags incl. LWF', () => {
    const e = S.plant(db, { code: 'W134', gross_salary: 14000 });
    db.prepare('UPDATE employees SET lwf_applicable = 1, esi_applicable = 1 WHERE id = ?').run(e.id);
    S.plantMonth(db, e, 9, 2026);
    S.computePlant(db, e, 9, 2026);
    const rows = S.plantRows(db, e);
    expect(rows.map((r) => [r.effective_from, S.flags(r)])).toEqual([['2025-01-01', { pf: 0, esi: 1, lwf: 1 }]]);
  });

  test('a brand-new employee (trigger → 0) → auto-created row 0/0/0 on the DEFAULT 1 table', () => {
    const e = S.plant(db, { code: 'W135', gross_salary: 14000 });
    S.plantMonth(db, e, 9, 2026);
    const sc = S.computePlant(db, e, 9, 2026);
    expect(S.plantRows(db, e).map(S.flags)).toEqual([{ pf: 0, esi: 0, lwf: 0 }]);
    expect(sc).toMatchObject({ pf_employee: 0, esi_employee: 0 });
  });
});

// ═══════════════════════════════ STEP 8 — sales writers ═══════════════════════════════

const salesSnap = (e) => ({
  master: S.flags(S.salesMaster(db, e)),
  rows: S.salesRows(db, e).map((r) => ({ d: r.effective_from, ...S.flags(r) })),
});

function uploadedSales(code, over = {}) {
  const e = S.salesEmp(db, { code, gross_salary: over.gross ?? 18000 });
  S.salesStructure(db, e, over.from ?? '2025-01', { gross_salary: over.gross ?? 18000 });
  const r = S.applyFile(db, 'sales', S.salesFile(S.srow(code, S.COMPANY, 1, 0, 1)));
  if (!r.ok) throw new Error(JSON.stringify(r));
  return e;
}
const co = encodeURIComponent(S.COMPANY);

describe('T9c — sales master writers keep the uploaded flags', () => {
  test('PUT /sales/employees/:code with flags + gross change → new 2026-10 version carries the in-force flags; master flags unchanged; ignoredFields', async () => {
    const e = uploadedSales('Z201');
    const r = await api.request('PUT', `/api/sales/employees/Z201?company=${co}`, { as: 'hr1', body: {
      gross_salary: 19000, pf_applicable: 1, esi_applicable: 0, lwf_applicable: 0, effective_from: '2026-10',
    } });
    expect(r.status).toBe(200);
    expect(r.body.ignoredFields).toEqual(['pf_applicable', 'esi_applicable', 'lwf_applicable']);
    expect(S.flags(S.salesMaster(db, e))).toEqual({ pf: 0, esi: 1, lwf: 1 });
    const rows = S.salesRows(db, e);
    expect(rows.find((x) => x.effective_from === '2026-10')).toMatchObject({ gross_salary: 19000, pf_applicable: 0, esi_applicable: 1, lwf_applicable: 1, effective_to: null });
  });

  test('PUT with only flags → No updates, nothing changed', async () => {
    const e = uploadedSales('Z202');
    const before = salesSnap(e);
    const r = await api.request('PUT', `/api/sales/employees/Z202?company=${co}`, { as: 'hr1', body: { esi_applicable: 0 } });
    expect(r.body).toMatchObject({ success: true, message: 'No updates', ignoredFields: ['esi_applicable'] });
    expect(salesSnap(e)).toEqual(before);
  });

  test('POST /sales/employees (create) may set flags incl. LWF on master + structure', async () => {
    const r = await api.request('POST', '/api/sales/employees', { as: 'hr1', body: {
      name: 'NEW SALES', company: S.COMPANY, bank_name: 'B', account_no: '1', ifsc: 'X', gross_salary: 15000, doj: '2026-10-01',
      esi_applicable: 1, lwf_applicable: 1,
    } });
    expect(r.status).toBe(201);
    const e = { id: r.body.data.id };
    expect(salesSnap(e)).toEqual({ master: { pf: 0, esi: 1, lwf: 1 }, rows: [{ d: '2026-10', pf: 0, esi: 1, lwf: 1 }] });
  });

  test('POST /sales/employees (create) without flags → all 0', async () => {
    const r = await api.request('POST', '/api/sales/employees', { as: 'hr1', body: {
      name: 'NEW SALES 2', company: S.COMPANY, bank_name: 'B', account_no: '2', ifsc: 'X', gross_salary: 15000, doj: '2026-10-01',
    } });
    const e = { id: r.body.data.id };
    expect(salesSnap(e)).toEqual({ master: { pf: 0, esi: 0, lwf: 0 }, rows: [{ d: '2026-10', pf: 0, esi: 0, lwf: 0 }] });
  });
});

const salesAudits = (code) => db.prepare('SELECT COUNT(*) c FROM audit_log WHERE employee_code = ?').get(code).c;
const putGross = (code, gross, from) => api.request('PUT', `/api/sales/employees/${code}?company=${co}`, { as: 'hr1', body: { gross_salary: gross, effective_from: from } });

describe('T11 — sales gross edit after the upload: back-dated refused, same-date in place, later-dated new version (10 Oct 2026 ruling)', () => {
  test('effective_from before the 2026-09 row → 409, nothing written (master + audit included), May–Oct byte-identical', async () => {
    const e = S.salesEmp(db, { code: 'Z210', gross_salary: 18000 });
    S.salesStructure(db, e, '2025-01', { gross_salary: 18000 });
    expect(S.applyFile(db, 'sales', S.salesFile(S.srow('Z210', S.COMPANY, 1, 0, 1))).ok).toBe(true);
    const months = {};
    for (const m of [5, 6, 7, 8, 9, 10]) months[m] = S.computeSales(db, e, m, 2026);
    const rows = S.salesRows(db, e); const mst = S.salesMaster(db, e); const audits = salesAudits('Z210');
    for (const f of ['2026-05', '2026-08']) {
      const r = await putGross('Z210', 18500, f);
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ success: false, code: 'STRUCTURE_DATED_LATER', latestDate: '2026-09',
        error: 'A salary structure dated 2026-09 already exists; date this change on or after 2026-09.' });
    }
    expect(S.salesRows(db, e)).toEqual(rows);
    expect(S.salesMaster(db, e)).toEqual(mst);
    expect(salesAudits('Z210')).toBe(audits);
    for (const m of [5, 6, 7, 8, 9, 10]) expect(S.computeSales(db, e, m, 2026)).toEqual(months[m]);
  });

  test('effective_from 2026-09 (= the upload row) → that row updated in place (ON CONFLICT): gross + basic new, other components and flags kept; September pays the new gross + split; August byte-identical', async () => {
    const e = S.salesEmp(db, { code: 'Z211', gross_salary: 18000 });
    S.salesStructure(db, e, '2025-01', { gross_salary: 18000 });
    expect(S.applyFile(db, 'sales', S.salesFile(S.srow('Z211', S.COMPANY, 1, 0, 1))).ok).toBe(true);
    const aug = S.computeSales(db, e, 8, 2026);
    const n = S.salesRows(db, e).length;
    const sepRow = S.salesRows(db, e).find((x) => x.effective_from === '2026-09');
    const r = await putGross('Z211', 20000, '2026-09');
    expect(r.status).toBe(200);
    const at = S.salesRows(db, e).filter((x) => x.effective_from === '2026-09');
    expect(at).toHaveLength(1);
    expect(S.salesRows(db, e)).toHaveLength(n);
    const basic = 20000 - (sepRow.hra + sepRow.cca + sepRow.conveyance);
    expect(at[0]).toMatchObject({ id: sepRow.id, gross_salary: 20000, basic, hra: sepRow.hra, cca: sepRow.cca, conveyance: sepRow.conveyance,
      pf_applicable: 0, esi_applicable: 1, lwf_applicable: 1, effective_to: null });
    const sep = S.computeSales(db, e, 9, 2026);
    expect(sep).toMatchObject({ gross_monthly: 20000, basic_monthly: basic, hra_monthly: sepRow.hra, cca_monthly: sepRow.cca, conveyance_monthly: sepRow.conveyance });
    expect(sep.esi_employee).toBeGreaterThan(0);
    expect(S.computeSales(db, e, 8, 2026)).toEqual(aug);
  });

  test('effective_from 2026-10 (after every row) → a new version with the in-force flags; October pays the new gross + split; September byte-identical', async () => {
    const e = S.salesEmp(db, { code: 'Z212', gross_salary: 18000 });
    S.salesStructure(db, e, '2025-01', { gross_salary: 18000 });
    expect(S.applyFile(db, 'sales', S.salesFile(S.srow('Z212', S.COMPANY, 1, 0, 1))).ok).toBe(true);
    const sep = S.computeSales(db, e, 9, 2026);
    expect((await putGross('Z212', 20000, '2026-10')).status).toBe(200);
    const oct = S.salesRows(db, e).find((x) => x.effective_from === '2026-10');
    expect(oct).toMatchObject({ gross_salary: 20000, pf_applicable: 0, esi_applicable: 1, lwf_applicable: 1 });
    expect(S.computeSales(db, e, 10, 2026)).toMatchObject({ gross_monthly: 20000, basic_monthly: oct.basic, hra_monthly: oct.hra });
    expect(S.computeSales(db, e, 9, 2026)).toEqual(sep);
  });
});

describe('T18 (C3) — POST /sales/employees/:code/structures (the dynamic-insert exemption)', () => {
  test('no later row: body flags pf=1 esi=0 at 2026-05 → stored flags = in force at 2026-05 (esi on from 2025-01), not the body; ignoredFields', async () => {
    const e = S.salesEmp(db, { code: 'Z220' });
    S.salesStructure(db, e, '2025-01', { esi: 1 });
    const r = await api.request('POST', `/api/sales/employees/Z220/structures?company=${co}`, { as: 'hr1', body: {
      effective_from: '2026-05', basic: 9000, gross_salary: 18000, pf_applicable: 1, esi_applicable: 0,
    } });
    expect(r.status).toBe(201);
    expect(r.body.ignoredFields).toEqual(['pf_applicable', 'esi_applicable']);
    expect(r.body.data).toMatchObject({ effective_from: '2026-05', pf_applicable: 0, esi_applicable: 1, lwf_applicable: 0 });
  });

  test('after an upload, 2026-05 (before the 2026-09 row) → 409, nothing written', async () => {
    const e = uploadedSales('Z223');
    const rows = S.salesRows(db, e);
    const r = await api.request('POST', `/api/sales/employees/Z223/structures?company=${co}`, { as: 'hr1', body: {
      effective_from: '2026-05', basic: 9000, gross_salary: 18000, pf_applicable: 1,
    } });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'STRUCTURE_DATED_LATER', latestDate: '2026-09', ignoredFields: ['pf_applicable'],
      error: 'A salary structure dated 2026-09 already exists; date this change on or after 2026-09.' });
    expect(S.salesRows(db, e)).toEqual(rows);
  });

  test('same date as an existing row (2026-09) → that row updated in place, keeps its own flags; 200 updatedInPlace', async () => {
    const e = uploadedSales('Z224');
    const before = S.salesRows(db, e);
    const sepRow = before.find((x) => x.effective_from === '2026-09');
    const r = await api.request('POST', `/api/sales/employees/Z224/structures?company=${co}`, { as: 'hr1', body: {
      effective_from: '2026-09', basic: 11000, gross_salary: 20000, esi_applicable: 0, lwf_applicable: 0,
    } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ updatedInPlace: true, ignoredFields: ['esi_applicable', 'lwf_applicable'] });
    const after = S.salesRows(db, e);
    expect(after).toHaveLength(before.length);
    expect(after.find((x) => x.effective_from === '2026-09')).toMatchObject({ id: sepRow.id, basic: 11000, gross_salary: 20000, hra: sepRow.hra,
      pf_applicable: 0, esi_applicable: 1, lwf_applicable: 1 });
  });

  test('at 2026-11 (after E) → stored flags = the uploaded ones', async () => {
    uploadedSales('Z221');
    const r = await api.request('POST', `/api/sales/employees/Z221/structures?company=${co}`, { as: 'hr1', body: {
      effective_from: '2026-11', basic: 9000, gross_salary: 18000, esi_applicable: 0,
    } });
    expect(r.body.data).toMatchObject({ pf_applicable: 0, esi_applicable: 1, lwf_applicable: 1 });
  });

  test('2026-5 and 2026-05-01 → 400', async () => {
    uploadedSales('Z222');
    for (const bad of ['2026-5', '2026-05-01', '2026-13']) {
      const r = await api.request('POST', `/api/sales/employees/Z222/structures?company=${co}`, { as: 'hr1', body: { effective_from: bad, basic: 1 } });
      expect(r.status).toBe(400);
    }
  });
});

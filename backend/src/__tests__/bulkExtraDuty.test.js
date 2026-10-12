/**
 * P3-01 — bulk engine + Extra Duty bulk grant.
 * Real routers (/api/bulk, /api/extra-duty-grants) behind the REAL requireAuth with real JWTs,
 * on a temp DB built by the real initSchema() (bulkSchema included). Fictional codes only.
 */
const express = require('express');
const { startJwtApi } = require('./helpers/jwtApiHarness');

const DATE = '2026-09-23';
const CO = 'Fict Co A';
let api; let db;

const codes = (from, n) => Array.from({ length: n }, (_, i) => `T${from + i}`);
const common = (over = {}) => ({ grant_date: DATE, grant_type: 'OVERNIGHT_STAY', duty_days: 1,
  verification_source: 'Gate Register', reference_number: 'GR-TEST', remarks: 'test batch', ...over });
const preview = (rows, c = common(), as = 'hr1') => api.request('POST', '/api/bulk/extra-duty/preview', { as, body: { common: c, rows } });
const apply = (rows, planHash, extra = {}, as = 'hr1', c = common()) =>
  api.request('POST', '/api/bulk/extra-duty/apply', { as, body: { common: c, rows, planHash, ...extra } });

// Preview, then apply every group in order (what the screen does).
async function saveAll(rowsIn, { hrApprove = true, c = common() } = {}) {
  const p = await preview(rowsIn, c);
  expect(p.status).toBe(200);
  const byNo = new Map(p.body.rows.map(r => [r.rowNo, r]));
  const results = [];
  for (const g of p.body.groups) {
    const rows = g.rowNos.map(n => ({ code: byNo.get(n).code, duty_days: byNo.get(n).dutyDays }));
    results.push(await apply(rows, g.planHash, { options: { hrApprove }, groupId: 'g1', groupIndex: g.index, groupSize: p.body.groups.length }, 'hr1', c));
  }
  return { preview: p.body, results };
}

const grant = (code) => db.prepare('SELECT * FROM extra_duty_grants WHERE employee_code = ? AND grant_date = ?').get(code, DATE);
const countGrants = () => db.prepare("SELECT COUNT(*) n FROM extra_duty_grants WHERE grant_date = ? AND verification_source != 'BIOMETRIC_AUTO'").get(DATE).n;
const clearGrants = () => { db.prepare('DELETE FROM extra_duty_grants').run(); db.prepare('DELETE FROM bulk_rows').run(); db.prepare('DELETE FROM bulk_batches').run(); };

beforeAll(() => {
  // Old POST / handler, verbatim from origin/main 8abee969 (parity proof for the extraction).
  api = startJwtApi({
    '/api/bulk': '../../routes/bulk',
    '/api/extra-duty-grants': '../../routes/extraDutyGrants',
    '/api/old-edg': require.resolve('./helpers/__p301OldEdgPost'),
  }, { users: [
    { username: 'hr1', role: 'hr' }, { username: 'admin1', role: 'admin' },
    { username: 'fin1', role: 'finance' }, { username: 'view1', role: 'viewer' },
  ] });
  db = api.db;
  const ins = db.prepare("INSERT INTO employees (code, name, department, company, status, date_of_exit) VALUES (?, ?, ?, ?, ?, ?)");
  for (const c of codes(9001, 120)) ins.run(c, `Test Person ${c}`, Number(c.slice(1)) % 2 ? 'PROD' : 'STORE', CO, 'Active', null);
  ins.run('T9200', 'Test Leaver', 'PROD', CO, 'Left', '2026-08-31');
  ins.run('T9300', 'Test Nocompany', 'PROD', 'null', 'Active', null);
  ins.run('S0901', 'Test Sales', 'SALES', CO, 'Active', null);
});
afterAll(() => api.close());
beforeEach(() => { clearGrants(); db.prepare('DELETE FROM monthly_imports').run(); });

function seedAuto(code) {
  return db.prepare(`INSERT INTO extra_duty_grants (employee_code, grant_date, month, year, company, grant_type, duty_days,
    verification_source, remarks, status, finance_status, requested_by, linked_attendance_id)
    VALUES (?, ?, 9, 2026, ?, 'OVERNIGHT_STAY', 1, 'BIOMETRIC_AUTO', 'auto', 'PENDING', 'UNREVIEWED', 'system', 777)`).run(code, DATE, CO).lastInsertRowid;
}
function seedManual(code, over = {}) {
  const r = { status: 'APPROVED', finance_status: 'UNREVIEWED', ...over };
  return db.prepare(`INSERT INTO extra_duty_grants (employee_code, grant_date, month, year, company, grant_type, duty_days,
    verification_source, status, finance_status, requested_by) VALUES (?, ?, 9, 2026, ?, 'OVERNIGHT_STAY', 1, 'Gate Register', ?, ?, 'hr1')`)
    .run(code, DATE, CO, r.status, r.finance_status).lastInsertRowid;
}

describe('preview', () => {
  test('paste rows: duplicates merged, unknown / left / ok / auto / existing / no company', async () => {
    seedAuto('T9005'); seedManual('T9006');
    const r = await preview(['T9001', 't9002', 'T9001', 'X999', 'T9200', 'T9005', 'T9006', 'T9300', { code: 'T9003', duty_days: 0.5 }]);
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.body.rows.map(x => [x.code, x]));
    expect(r.body.rows).toHaveLength(8);
    expect(by.T9001.state).toBe('ok');
    expect(by.T9001.messages.join()).toMatch(/more than once/);
    expect(by.T9002.state).toBe('ok'); // case-insensitive → master spelling
    expect(by.X999.state).toBe('error'); expect(by.X999.messages[0]).toMatch(/Not found/);
    expect(by.T9200.state).toBe('error'); expect(by.T9200.messages[0]).toMatch(/Not active \(Left, left on 31-08-2026\)/);
    expect(by.T9005).toMatchObject({ state: 'warning', action: 'update' });
    expect(by.T9006).toMatchObject({ state: 'skipped', action: 'noop' });
    expect(by.T9006.messages[0]).toMatch(/Already granted.*HR: approved, finance: unreviewed/);
    expect(by.T9300).toMatchObject({ state: 'warning', action: 'create', company: '' });
    expect(by.T9003.dutyDays).toBe(0.5);
    expect(r.body.counts).toMatchObject({ total: 8, ok: 3, warning: 2, error: 2, skipped: 1 });
    expect(r.body.groups).toHaveLength(1);
    expect(countGrants()).toBe(1); // nothing written by preview
  });

  test('common validation + PBA not offered + bad per-row duty', async () => {
    let r = await preview(['T9001'], common({ grant_date: '2026-02-30' }));
    expect(r.status).toBe(400); expect(r.body.code).toBe('BULK_BAD_COMMON');
    r = await preview(['T9001'], common({ grant_type: 'PRE_BIOMETRIC_ACTIVATION' }));
    expect(r.status).toBe(400); expect(r.body.fields.grant_type).toBeTruthy();
    r = await preview(['T9001'], common({ duty_days: 3 }));
    expect(r.status).toBe(400);
    r = await preview(['T9001'], common({ verification_source: 'Hearsay' }));
    expect(r.status).toBe(400);
    r = await preview([{ code: 'T9001', duty_days: 0.7 }]);
    expect(r.body.rows[0].state).toBe('error');
    r = await preview([]);
    expect(r.status).toBe(400); expect(r.body.code).toBe('BULK_NO_ROWS');
  });

  test('finalised month → every row an error', async () => {
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (9, 2026, 'Other label', 1)").run();
    const r = await preview(['T9001', 'T9002']);
    expect(r.body.rows.every(x => x.state === 'error' && /finalised/.test(x.messages[0]))).toBe(true);
    expect(r.body.groups).toHaveLength(0);
  });

  test('109 people → groups 50 + 50 + 9; skipped rows ride with group 0', async () => {
    seedManual('T9001');
    const r = await preview(codes(9001, 110));
    expect(r.body.groups.map(g => g.applyCount)).toEqual([50, 50, 9]);
    expect(r.body.groups[0].rowNos).toHaveLength(51);
  });
});

describe('apply', () => {
  test('109 → 3 batches, one group id, HR-approved by the saver, audit rows', async () => {
    const { results } = await saveAll(codes(9001, 109));
    expect(results.map(x => x.status)).toEqual([200, 200, 200]);
    expect(results.map(x => x.body.counts.created)).toEqual([50, 50, 9]);
    const batches = db.prepare('SELECT * FROM bulk_batches ORDER BY id').all();
    expect(batches).toHaveLength(3);
    expect(new Set(batches.map(b => b.group_id))).toEqual(new Set(['g1']));
    expect(batches.map(b => b.group_index)).toEqual([0, 1, 2]);
    const g = grant('T9001');
    expect(g).toMatchObject({ status: 'APPROVED', approved_by: 'hr1', finance_status: 'UNREVIEWED', requested_by: 'hr1',
      company: CO, month: 9, year: 2026, verification_source: 'Gate Register', reference_number: 'GR-TEST' });
    const audit = (stage) => db.prepare('SELECT COUNT(*) n FROM audit_log WHERE stage = ?').get(stage).n;
    expect(audit('HR_BULK_CREATE')).toBe(109);
    expect(audit('HR_BULK_CREATE_APPROVE')).toBe(109);
    expect(audit('BULK_CREATE')).toBe(3);
    // Finance queue sees them (unchanged route).
    const fin = await api.request('GET', '/api/extra-duty-grants/finance-review?month=9&year=2026', { as: 'fin1' });
    expect(fin.body.data).toHaveLength(109);
  });

  test('HR-approve off → rows PENDING', async () => {
    await saveAll(['T9001', 'T9002'], { hrApprove: false });
    expect(grant('T9001')).toMatchObject({ status: 'PENDING', approved_by: null });
  });

  test('51 applicable rows in one batch → 400, nothing written', async () => {
    const p = await preview(codes(9001, 51));
    const r = await apply(codes(9001, 51).map(code => ({ code })), p.body.groups[0].planHash);
    expect(r.status).toBe(400); expect(r.body.code).toBe('BULK_ROW_LIMIT');
    expect(countGrants()).toBe(0);
  });

  test('data changed between check and save → 409, nothing written', async () => {
    const p = await preview(['T9001', 'T9002', 'T9003']);
    seedManual('T9002', { status: 'PENDING' });
    const r = await apply(['T9001', 'T9002', 'T9003'].map(code => ({ code })), p.body.groups[0].planHash);
    expect(r.status).toBe(409); expect(r.body.code).toBe('BULK_PLAN_CHANGED');
    expect(grant('T9001')).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) n FROM bulk_batches').get().n).toBe(0);
  });

  test('changed duty days after the check → hash mismatch 409', async () => {
    const p = await preview(['T9001', 'T9002']);
    const r = await apply([{ code: 'T9001', duty_days: 0.5 }, { code: 'T9002' }], p.body.groups[0].planHash);
    expect(r.status).toBe(409); expect(r.body.code).toBe('BULK_PLAN_CHANGED');
  });

  test('an error row in the save → 409 BULK_ROW_ERROR (all-or-nothing)', async () => {
    const p = await preview(['T9001', 'T9200']);
    const r = await apply([{ code: 'T9001' }, { code: 'T9200' }], p.body.groups[0].planHash);
    expect(r.status).toBe(409); expect(r.body.code).toBe('BULK_ROW_ERROR');
    expect(countGrants()).toBe(0);
  });

  test('mid-batch failure rolls back every row and the batch', async () => {
    const p = await preview(codes(9001, 30));
    const auditBefore = db.prepare('SELECT COUNT(*) n FROM audit_log').get().n;
    const kind = require('../services/bulk/kinds/extraDuty');
    const real = kind.applyRow;
    let n = 0;
    kind.applyRow = (...a) => { if (++n === 20) throw new Error('disk on fire'); return real(...a); };
    try {
      const r = await apply(codes(9001, 30).map(code => ({ code })), p.body.groups[0].planHash);
      expect(r.status).toBe(500);
    } finally { kind.applyRow = real; }
    expect(countGrants()).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM bulk_batches').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM audit_log').get().n).toBe(auditBefore); // audit rows rolled back too
  });

  test('BIOMETRIC_AUTO upgrade keeps id + link; undo restores it byte-identical', async () => {
    const autoId = seedAuto('T9005');
    const before = db.prepare('SELECT * FROM extra_duty_grants WHERE id = ?').get(autoId);
    const { results } = await saveAll(['T9005', 'T9007']);
    expect(results[0].body.counts).toMatchObject({ created: 1, updated: 1 });
    const g = grant('T9005');
    expect(g).toMatchObject({ id: Number(autoId), linked_attendance_id: 777, verification_source: 'Gate Register', status: 'APPROVED' });
    expect(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE stage = 'HR_UPGRADE_AUTO'").get().n).toBe(1);
    const u = await api.request('POST', `/api/bulk/batches/${results[0].body.batchId}/undo`, { as: 'hr1', body: { reason: 'wrong date' } });
    expect(u.status).toBe(200); expect(u.body.undone).toBe(2);
    expect(db.prepare('SELECT * FROM extra_duty_grants WHERE id = ?').get(autoId)).toEqual(before);
    expect(grant('T9007')).toBeUndefined();
    expect(db.prepare('SELECT status FROM bulk_batches').get().status).toBe('undone');
    const again = await api.request('POST', `/api/bulk/batches/${results[0].body.batchId}/undo`, { as: 'hr1', body: { reason: 'wrong date' } });
    expect(again.status).toBe(409);
  });

  test('skipped rows are stored, not applied', async () => {
    const existing = seedManual('T9006');
    const before = db.prepare('SELECT * FROM extra_duty_grants WHERE id = ?').get(existing);
    const { results } = await saveAll(['T9006', 'T9008']);
    expect(results[0].body.counts).toMatchObject({ created: 1, skipped: 1 });
    expect(db.prepare('SELECT * FROM extra_duty_grants WHERE id = ?').get(existing)).toEqual(before);
    expect(db.prepare("SELECT state FROM bulk_rows WHERE row_key = 'T9006'").get().state).toBe('skipped');
  });

  test('nothing to save → 400', async () => {
    seedManual('T9006');
    const p = await preview(['T9006']);
    expect(p.body.groups).toHaveLength(0);
    const r = await apply([{ code: 'T9006' }], 'x');
    expect(r.status).toBe(400);
  });
});

describe('undo guards', () => {
  async function batchOf(rows, opts) { const { results } = await saveAll(rows, opts); return results[0].body.batchId; }
  const undo = (id, reason = 'test undo') => api.request('POST', `/api/bulk/batches/${id}/undo`, { as: 'hr1', body: { reason } });

  test('refused after finance review; nothing undone', async () => {
    const id = await batchOf(['T9001', 'T9002']);
    const g = grant('T9001');
    await api.request('POST', `/api/extra-duty-grants/${g.id}/finance-approve`, { as: 'fin1' });
    const r = await undo(id);
    expect(r.status).toBe(409); expect(r.body.code).toBe('BULK_UNDO_BLOCKED');
    expect(r.body.rows).toEqual([expect.objectContaining({ code: 'T9001', reason: expect.stringMatching(/Finance has reviewed/) })]);
    expect(grant('T9002')).toBeTruthy();
  });
  test('refused after HR edit, HR status change, processed, finalised', async () => {
    let id = await batchOf(['T9001'], { hrApprove: false });
    await api.request('PUT', `/api/extra-duty-grants/${grant('T9001').id}`, { as: 'hr1', body: { duty_days: 0.5 } });
    expect((await undo(id)).body.code).toBe('BULK_UNDO_BLOCKED');
    clearGrants();
    id = await batchOf(['T9001'], { hrApprove: false });
    await api.request('POST', `/api/extra-duty-grants/${grant('T9001').id}/approve`, { as: 'hr1' });
    expect((await undo(id)).body.rows[0].reason).toMatch(/HR status changed/);
    clearGrants();
    id = await batchOf(['T9001']);
    db.prepare('UPDATE extra_duty_grants SET is_processed = 1').run();
    expect((await undo(id)).body.rows[0].reason).toMatch(/salary/);
    clearGrants();
    id = await batchOf(['T9001']);
    db.prepare("INSERT INTO monthly_imports (month, year, company, is_finalised) VALUES (9, 2026, ?, 1)").run(CO);
    expect((await undo(id)).body.rows[0].reason).toMatch(/finalised/);
  });
  test('reason required', async () => {
    const id = await batchOf(['T9001']);
    expect((await undo(id, 'no')).status).toBe(400);
  });
});

describe('roles + reads', () => {
  test('viewer and finance get 403 everywhere; admin allowed', async () => {
    for (const as of ['view1', 'fin1']) {
      expect((await preview(['T9001'], common(), as)).status).toBe(403);
      expect((await apply([{ code: 'T9001' }], 'x', {}, as)).status).toBe(403);
      expect((await api.request('GET', '/api/bulk/batches?kind=extra-duty', { as })).status).toBe(403);
      expect((await api.request('POST', '/api/bulk/batches/1/undo', { as, body: { reason: 'x x x x' } })).status).toBe(403);
      expect((await api.request('GET', '/api/bulk/extra-duty/employees', { as })).status).toBe(403);
    }
    expect((await api.request('GET', '/api/bulk/batches', {})).status).toBe(401);
    expect((await preview(['T9001'], common(), 'admin1')).status).toBe(200);
  });
  test('batch list/detail, people on a date, employees lite, unknown kind', async () => {
    seedManual('T9010'); seedManual('T9011', { status: 'REJECTED' }); seedAuto('T9012');
    const ppl = await api.request('GET', `/api/bulk/extra-duty/people?date=${DATE}`, { as: 'hr1' });
    expect(ppl.body.data.map(p => p.code)).toEqual(['T9010']);
    const emp = await api.request('GET', '/api/bulk/extra-duty/employees', { as: 'hr1' });
    expect(Object.keys(emp.body.data[0]).sort()).toEqual(['code', 'company', 'department', 'name', 'status']);
    await saveAll(['T9001', 'T9010']);
    const list = await api.request('GET', '/api/bulk/batches?kind=extra-duty&month=9&year=2026', { as: 'hr1' });
    expect(list.body.data[0]).toMatchObject({ kind: 'extra-duty', status: 'applied', applyCount: 1, skippedCount: 1, createdBy: 'hr1' });
    const one = await api.request('GET', `/api/bulk/batches/${list.body.data[0].id}`, { as: 'hr1' });
    expect(one.body.data.rows).toHaveLength(2);
    expect((await api.request('POST', '/api/bulk/nope/preview', { as: 'hr1', body: { common: {}, rows: [] } })).status).toBe(404);
  });
});

describe('single "+ New Grant" route unchanged (parity with the old handler)', () => {
  const body = (over = {}) => ({ employee_code: 'T9050', grant_date: DATE, month: 9, year: 2026, company: CO,
    grant_type: 'EXTENDED_SHIFT', duty_days: 1.5, verification_source: 'Production Office', reference_number: 'R1', remarks: 'x', ...over });
  const snap = () => ({
    grants: db.prepare('SELECT * FROM extra_duty_grants ORDER BY employee_code').all()
      .map(({ id, requested_at, ...g }) => g),
    audit: db.prepare("SELECT table_name, field_name, old_value, new_value, changed_by, stage, remark FROM audit_log WHERE table_name = 'extra_duty_grants' ORDER BY id").all()
      .map(a => ({ ...a, remark: String(a.remark).replace(/requested_at=[^,]*/, 'requested_at=*') })),
  });
  async function run(path) {
    clearGrants(); db.prepare("DELETE FROM audit_log WHERE table_name = 'extra_duty_grants'").run();
    seedAuto('T9051'); seedManual('T9052', { status: 'APPROVED', finance_status: 'FINANCE_REJECTED' });
    const out = [];
    for (const b of [body(), body(), body({ employee_code: 'T9051' }), body({ employee_code: 'T9052' }),
      body({ employee_code: 'T9053', grant_type: undefined, duty_days: undefined, company: undefined }),
      body({ employee_code: 'T9051', grant_type: 'PRE_BIOMETRIC_ACTIVATION' }), body({ verification_source: '' }),
      body({ employee_code: 'NOPE1' })]) {
      const r = await api.request('POST', path, { as: 'hr1', body: b });
      out.push({ status: r.status, body: { ...r.body, id: r.body.id ? 'ID' : undefined, grant_id: r.body.grant_id ? 'ID' : undefined } });
    }
    return { out, ...snap() };
  }
  test('same responses, rows and audit as the 8abee969 handler', async () => {
    const neu = await run('/api/extra-duty-grants');
    const old = await run('/api/old-edg');
    expect(neu).toEqual(old);
    expect(neu.out.map(o => o.status)).toEqual([200, 409, 200, 409, 200, 409, 400, 200]);
    expect((await api.request('POST', '/api/extra-duty-grants', { as: 'view1', body: body() })).status).toBe(403);
  });
});

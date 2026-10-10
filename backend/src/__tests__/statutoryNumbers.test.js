/**
 * Statutory flags PR-3 — ESI numbers / UANs.
 *   F12  the rules the sales master uses are the very regexes / holder lookup the
 *        statutory upload (planFlagChanges) uses — exported, not copied.
 * Synthetic codes and numbers only.
 */
const S = require('./helpers/statutoryFixture');
const SF = require('../services/statutoryFlags');

// Every sample is judged by the exported regex AND by the upload planner; both must agree.
const SAMPLES = {
  esi_number: ['1000000001', '100000000', '10000000011', '10000 00002', ' 1000000003 ', 'ABCDEFGHIJ', '١٢٣٤٥٦٧٨٩٠', '10000-00004'],
  uan: ['100000000001', '10000000001', '1000000000011', '1000 0000 0002', 'UAN100000003', '١٠٠٠٠٠٠٠٠٠٠٤'],
};

describe('F12 — the exported rules are the upload planner rules', () => {
  test('ESI_NUMBER_RE = 10 ASCII digits, UAN_RE = 12 ASCII digits; numberInUse exported', () => {
    expect(SF.ESI_NUMBER_RE).toBeInstanceOf(RegExp);
    expect(SF.UAN_RE).toBeInstanceOf(RegExp);
    expect(SF.ESI_NUMBER_RE.source).toBe('^\\d{10}$');
    expect(SF.UAN_RE.source).toBe('^\\d{12}$');
    expect(typeof SF.numberInUse).toBe('function');
  });

  for (const [col, re, label] of [['esi_number', 'ESI_NUMBER_RE', 'Malformed ESI number'], ['uan', 'UAN_RE', 'Malformed UAN']]) {
    test(`${col}: planFlagChanges calls a value malformed exactly when ${re} rejects it (spaces stripped)`, () => {
      const db = S.newDb();
      const verdicts = [];
      for (const v of SAMPLES[col]) {
        const e = S.plant(db, {});
        S.plantStructure(db, e, '2025-01-01', {});
        const rows = SF.parseFlagFile(S.plantFile(S.prow(e.code, 0, 0, 0, { [col]: v })), 'plant').rows;
        const p = SF.planFlagChanges(db, { scope: 'plant', effectiveMonth: '2026-09', rows }).rows[0];
        const planner = p.warnings.some((w) => w.startsWith(label));
        const exported = !SF[re].test(v.replace(/\s+/g, ''));
        verdicts.push([v, planner, exported]);
        // a value the planner accepts is the value the master would store
        if (!planner) expect(p.numbers[col]).toBe(v.replace(/\s+/g, ''));
      }
      for (const [v, planner, exported] of verdicts) expect({ v, malformed: planner }).toEqual({ v, malformed: exported });
      expect(verdicts.some(([, p]) => p)).toBe(true);    // both kinds present
      expect(verdicts.some(([, p]) => !p)).toBe(true);
      db.close();
    });
  }

  test('numberInUse: the holder code within the same master, never the employee itself', () => {
    const db = S.newDb();
    const a = S.salesEmp(db, { esi_number: '1000000101', uan: '100000000101' });
    const b = S.salesEmp(db, {});
    const c = S.salesEmp(db, { company: S.OTHER_COMPANY });
    expect(SF.numberInUse(db, 'sales', 'esi_number', '1000000101', b.id)).toBe(a.code);
    expect(SF.numberInUse(db, 'sales', 'uan', '100000000101', c.id)).toBe(a.code);   // N3: across sales companies
    expect(SF.numberInUse(db, 'sales', 'esi_number', '1000000101', a.id)).toBeNull();
    expect(SF.numberInUse(db, 'sales', 'esi_number', '1000000102', -1)).toBeNull();
    expect(SF.numberInUse(db, 'plant', 'esi_number', '1000000101', -1)).toBeNull();   // plant master is a different master
    db.close();
  });
});

// ── F7 / F8 — the sales master edits ESI number / UAN under the upload's rules (real routes, real JWTs) ──
const { startJwtApi } = require('./helpers/jwtApiHarness');
let api;
beforeAll(() => {
  api = startJwtApi({ '/api/sales': '../../routes/sales' }, { users: [{ username: 'hr1', role: 'hr' }] });
});
afterAll(() => api.close());

const CO = S.COMPANY;
const CQ = encodeURIComponent(CO);
const auditOf = (code) => api.db.prepare(
  "SELECT field_name, old_value, new_value, stage, changed_by FROM audit_log WHERE table_name = 'sales_employees' AND employee_code = ? ORDER BY id",
).all(code);
const state = (emp) => JSON.stringify({ m: S.salesMaster(api.db, emp), a: auditOf(emp.code), s: S.salesRows(api.db, emp) });
const put = (emp, body) => api.request('PUT', `/api/sales/employees/${emp.code}?company=${CQ}`, { as: 'hr1', body });

describe('F7 — PUT /api/sales/employees/:code: ESI number / UAN', () => {
  test('valid values with spaces → stored normalised, one audit row each (stage sales_employee_master)', async () => {
    const e = S.salesEmp(api.db, { code: 'N701' });
    const r = await put(e, { esi_number: '1000 000 201', uan: ' 100000000201 ' });
    expect(r.status).toBe(200);
    expect(S.salesMaster(api.db, e)).toMatchObject({ esi_number: '1000000201', uan: '100000000201' });
    expect(auditOf(e.code).map((a) => [a.field_name, a.old_value, a.new_value, a.stage, a.changed_by])).toEqual([
      ['esi_number', '', '1000000201', 'sales_employee_master', 'hr1'],
      ['uan', '', '100000000201', 'sales_employee_master', 'hr1'],
    ]);
  });

  test('malformed → 400 INVALID_ESI_NUMBER / INVALID_UAN; nothing written (not even the other fields)', async () => {
    const e = S.salesEmp(api.db, { code: 'N702' });
    const before = state(e);
    for (const [body, code] of [[{ esi_number: '123456789', name: 'CHANGED' }, 'INVALID_ESI_NUMBER'], [{ esi_number: 'ABCDEFGHIJ' }, 'INVALID_ESI_NUMBER'],
      [{ uan: '10000000020', name: 'CHANGED' }, 'INVALID_UAN'], [{ uan: '1000000002011' }, 'INVALID_UAN']]) {
      const r = await put(e, body);
      expect([r.status, r.body.code]).toEqual([400, code]);
    }
    expect(state(e)).toBe(before);
  });

  test('held by another sales employee → 409 NUMBER_IN_USE + heldBy (also across companies, N3); nothing written', async () => {
    const holder = S.salesEmp(api.db, { code: 'N703', esi_number: '1000000203', uan: '100000000203' });
    const e = S.salesEmp(api.db, { code: 'N704' });
    const other = S.salesEmp(api.db, { code: 'N703', company: S.OTHER_COMPANY });
    const before = state(e);
    let r = await put(e, { esi_number: '1000000203', name: 'CHANGED' });
    expect([r.status, r.body.code, r.body.heldBy, r.body.field]).toEqual([409, 'NUMBER_IN_USE', holder.code, 'esi_number']);
    r = await put(e, { uan: '1000 0000 0203' });
    expect([r.status, r.body.heldBy]).toEqual([409, holder.code]);
    expect(state(e)).toBe(before);
    r = await api.request('PUT', `/api/sales/employees/${other.code}?company=${encodeURIComponent(S.OTHER_COMPANY)}`, { as: 'hr1', body: { uan: '100000000203' } });
    expect([r.status, r.body.heldBy]).toEqual([409, holder.code]);
  });

  test('an unchanged legacy bad value never blocks an unrelated edit (N2); re-sending your own number is fine', async () => {
    const e = S.salesEmp(api.db, { code: 'N705', esi_number: '12345', uan: '100000000205' });
    const r = await put(e, { name: 'NEW NAME', esi_number: '12345', uan: '1000 0000 0205' });   // the edit form re-sends every field
    expect(r.status).toBe(200);
    expect(S.salesMaster(api.db, e)).toMatchObject({ name: 'NEW NAME', esi_number: '12345', uan: '100000000205' });
    expect(auditOf(e.code).map((a) => a.field_name)).toEqual(['name']);
    expect((await put(e, { esi_number: '123456' })).status).toBe(400);                         // but a changed value is checked
  });

  test("'' → NULL, audited", async () => {
    const e = S.salesEmp(api.db, { code: 'N706', esi_number: '1000000206', uan: '100000000206' });
    const r = await put(e, { esi_number: '', uan: '   ' });
    expect(r.status).toBe(200);
    expect(S.salesMaster(api.db, e)).toMatchObject({ esi_number: null, uan: null });
    expect(auditOf(e.code).map((a) => [a.field_name, a.old_value, a.new_value])).toEqual([['esi_number', '1000000206', ''], ['uan', '100000000206', '']]);
  });

  test('flags still go to ignoredFields; structures unchanged; the number is written', async () => {
    const e = S.salesEmp(api.db, { code: 'N707' });
    S.salesStructure(api.db, e, '2026-01', { esi: 0, pf: 0, lwf: 0 });
    const rows = JSON.stringify(S.salesRows(api.db, e));
    const r = await put(e, { esi_number: '1000000207', esi_applicable: 1, pf_applicable: 1, lwf_applicable: 1 });
    expect(r.status).toBe(200);
    expect(r.body.ignoredFields).toEqual(['pf_applicable', 'esi_applicable', 'lwf_applicable']);
    expect(S.flags(S.salesMaster(api.db, e))).toEqual({ pf: 0, esi: 0, lwf: 0 });
    expect(JSON.stringify(S.salesRows(api.db, e))).toBe(rows);
    expect(S.salesMaster(api.db, e).esi_number).toBe('1000000207');
  });
});

describe('F8 — POST /api/sales/employees: ESI number / UAN', () => {
  const NEW = { company: CO, bank_name: 'SYNTH BANK', account_no: '9000000001', ifsc: 'SYNB0000001', gross_salary: 15000, doj: '2026-08-01' };
  const count = () => api.db.prepare('SELECT COUNT(*) AS c FROM sales_employees').get().c;
  test('valid → 201, stored normalised', async () => {
    const r = await api.request('POST', '/api/sales/employees', { as: 'hr1', body: { ...NEW, name: 'SYNTH NEW ONE', esi_number: '1000 000 301', uan: '100000000301' } });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ esi_number: '1000000301', uan: '100000000301', esi_applicable: 0 });
  });
  test('malformed → 400 and held → 409: nothing created', async () => {
    S.salesEmp(api.db, { code: 'N801', esi_number: '1000000302' });
    const n = count();
    let r = await api.request('POST', '/api/sales/employees', { as: 'hr1', body: { ...NEW, name: 'SYNTH BAD', uan: '12' } });
    expect([r.status, r.body.code]).toEqual([400, 'INVALID_UAN']);
    r = await api.request('POST', '/api/sales/employees', { as: 'hr1', body: { ...NEW, name: 'SYNTH DUP', esi_number: '1000000302' } });
    expect([r.status, r.body.code, r.body.heldBy]).toEqual([409, 'NUMBER_IN_USE', 'N801']);
    expect(count()).toBe(n);
    expect(api.db.prepare("SELECT COUNT(*) AS c FROM sales_employees WHERE name IN ('SYNTH BAD', 'SYNTH DUP')").get().c).toBe(0);
  });
});

/**
 * N-13 (owner ruling 17 Oct 2026, "close the API gap") — a new employee's salary
 * never goes in without finance:
 *   1. POST /api/employees refuses any salary field with a real value (400
 *      SALARY_VIA_SALARY_INPUT, nothing written); empty values count as not sent.
 *   2. POST /api/employees/bulk-import never writes the file's gross to
 *      employees.gross_salary / salary_structures; a different gross raises ONE
 *      Pending salary_change_requests row (requested_by = importing admin), which
 *      finance approves and the importing admin cannot (SELF_APPROVAL).
 * Real routers behind the real requireAuth with real JWTs. Fictional codes.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');
const S = require('./helpers/statutoryFixture');

const USERS = [
  { username: 'boss', role: 'admin' },
  { username: 'boss2', role: 'admin' },
  { username: 'fin1', role: 'finance' },
  { username: 'hr1', role: 'hr' },
];

let api; let db;
beforeAll(() => {
  api = startJwtApi({
    '/api/employees': '../../routes/employees',
    '/api/salary-input': '../../routes/salary-input',
  }, { users: USERS });
  db = api.db;
});
afterAll(() => api.close());

const MSG = 'Create the employee first, then set salary in Salary Input (finance approves it).';
const count = (sql, ...p) => db.prepare(sql).get(...p).n;
const tableCounts = () => ({
  employees: count('SELECT COUNT(*) n FROM employees'),
  structures: count('SELECT COUNT(*) n FROM salary_structures'),
  requests: count('SELECT COUNT(*) n FROM salary_change_requests'),
  leave: count('SELECT COUNT(*) n FROM leave_balances'),
  audit: count('SELECT COUNT(*) n FROM audit_log'),
});
const create = (as, body) => api.request('POST', '/api/employees', { as, body });
const bulk = (employees, as = 'boss') => api.request('POST', '/api/employees/bulk-import', { as, body: { employees } });
const pending = (code) => db.prepare("SELECT * FROM salary_change_requests WHERE employee_code = ? AND status = 'Pending'").all(code);
const emp = (code) => db.prepare('SELECT id, code, gross_salary FROM employees WHERE code = ?').get(code);
const structures = (code) => db.prepare('SELECT s.* FROM salary_structures s JOIN employees e ON e.id = s.employee_id WHERE e.code = ? ORDER BY s.id').all(code);

describe('1 — POST /employees refuses salary on create', () => {
  const KEYS = [
    ['basic', 7000], ['da', 500], ['hra', 2000], ['conveyance', 800], ['otherAllowances', 300],
    ['other_allowances', 300], ['gross_salary', 15000], ['grossSalary', '15000'],
    ['special_allowance', 900], ['specialAllowance', 900],
  ];
  test.each(KEYS)('%s = %p → 400 SALARY_VIA_SALARY_INPUT, nothing written', async (key, value) => {
    for (const as of ['hr1', 'boss']) {
      const before = tableCounts();
      const code = `N13${key.length}${as[0]}`;
      const r = await create(as, { code, name: 'SYNTH', company: S.COMPANY, [key]: value });
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ success: false, code: 'SALARY_VIA_SALARY_INPUT', error: MSG, fields: [key] });
      expect(tableCounts()).toEqual(before);
      expect(emp(code)).toBeUndefined();
    }
  });

  test('several salary keys → one 400 naming them all', async () => {
    const r = await create('hr1', { code: 'N1301', name: 'SYNTH', company: S.COMPANY, basic: 7000, hra: 2000, da: 0 });
    expect(r.status).toBe(400);
    expect(r.body.fields).toEqual(['basic', 'hra']);
  });

  test('salary refusal comes before the duplicate-code check (no leak of which codes exist)', async () => {
    S.plant(db, { code: 'N1302' });
    const r = await create('hr1', { code: 'N1302', name: 'SYNTH', basic: 1 });
    expect(r.body.code).toBe('SALARY_VIA_SALARY_INPUT');
  });

  test('empty salary fields (undefined / null / "" / 0 / "0") are treated as not sent → created, no structure', async () => {
    const r = await create('hr1', {
      code: 'N1303', name: 'SYNTH', company: S.COMPANY,
      basic: 0, da: '', hra: null, conveyance: '0', otherAllowances: '  ', gross_salary: 0, special_allowance: undefined,
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, message: 'Employee created' });
    expect(structures('N1303')).toEqual([]);
    expect(emp('N1303').gross_salary || 0).toBe(0);
    expect(pending('N1303')).toEqual([]);
  });

  test('create without salary (the UI form shape) → 200, leave balances seeded, no structure', async () => {
    const r = await create('hr1', { code: 'N1304', name: 'SYNTH', company: S.COMPANY, department: 'TEST', dateOfJoining: '2026-10-01' });
    expect(r.status).toBe(200);
    expect(structures('N1304')).toEqual([]);
    expect(count('SELECT COUNT(*) n FROM leave_balances WHERE employee_id = ?', emp('N1304').id)).toBe(2);
  });

  test('a non-numeric salary value is still refused (not silently dropped)', async () => {
    const r = await create('hr1', { code: 'N1305', name: 'SYNTH', basic: 'abc' });
    expect(r.status).toBe(400);
    expect(emp('N1305')).toBeUndefined();
  });

  test('role guard unchanged: finance → 403 before the salary check', async () => {
    const r = await create('fin1', { code: 'N1306', name: 'SYNTH', basic: 7000 });
    expect(r.status).toBe(403);
  });
});

describe('2 — bulk-import raises a finance request instead of writing gross', () => {
  test('new row with gross → employee created with NO gross, NO structure, ONE pending request by the importer', async () => {
    const r = await bulk([{ code: 'N1310', name: 'SYNTH', company: S.COMPANY, gross_salary: 18000, basic: 9000, hra: 3600, lastSeenSortKey: 202609 }]);
    expect(r.status).toBe(200);
    expect(r.body.results).toMatchObject({ inserted: 1, updated: 0, requestsRaised: 1, salaryUnchanged: 0 });
    expect(r.body.results.rows).toEqual([{ code: 'N1310', employee: 'created', salary: 'request_raised' }]);
    expect(emp('N1310').gross_salary).toBe(0);
    expect(structures('N1310')).toEqual([]);
    const reqs = pending('N1310');
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ requested_by: 'boss', old_gross: 0, new_gross: 18000, reason: 'Salary from employee bulk import' });
    const ns = JSON.parse(reqs[0].new_structure);
    expect(ns).toMatchObject({ gross_salary: 18000, basic: 9000, hra: 3600, special_allowance: 5400, basic_percent: 50, hra_percent: 20 });
    expect(ns.pf_applicable).toBeUndefined();
  });

  test('existing employee, different gross → master + structure untouched, one request', async () => {
    const e = S.plant(db, { code: 'N1311', gross_salary: 15000 });
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 15000 });
    const before = { gross: emp('N1311').gross_salary, structs: structures('N1311') };
    const r = await bulk([{ code: 'N1311', name: 'SYNTH RENAMED', gross_salary: 17000, basic: 8500, lastSeenSortKey: 202609 }]);
    expect(r.body.results.rows).toEqual([{ code: 'N1311', employee: 'updated', salary: 'request_raised' }]);
    expect(emp('N1311').gross_salary).toBe(before.gross);
    expect(structures('N1311')).toEqual(before.structs);
    expect(db.prepare('SELECT name FROM employees WHERE code = ?').get('N1311').name).toBe('SYNTH RENAMED'); // employee fields still import
    expect(pending('N1311')).toHaveLength(1);
    expect(pending('N1311')[0]).toMatchObject({ old_gross: 15000, new_gross: 17000 });
  });

  test('same gross as stored → no request, "unchanged"', async () => {
    const e = S.plant(db, { code: 'N1312', gross_salary: 16000 });
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 16000 });
    const r = await bulk([{ code: 'N1312', name: 'SYNTH', gross_salary: 16000, basic: 8000, lastSeenSortKey: 202609 }]);
    expect(r.body.results.rows[0].salary).toBe('unchanged');
    expect(r.body.results.salaryUnchanged).toBe(1);
    expect(pending('N1312')).toEqual([]);
  });

  test('no gross in the row → no request, "no_gross"', async () => {
    const r = await bulk([{ code: 'N1313', name: 'SYNTH', lastSeenSortKey: 202609 }]);
    expect(r.body.results.rows[0]).toEqual({ code: 'N1313', employee: 'created', salary: 'no_gross' });
    expect(pending('N1313')).toEqual([]);
  });

  test('re-import while a request is pending → no second request, "already_pending"', async () => {
    await bulk([{ code: 'N1314', name: 'SYNTH', gross_salary: 12000, lastSeenSortKey: 202609 }]);
    const r = await bulk([{ code: 'N1314', name: 'SYNTH', gross_salary: 13000, lastSeenSortKey: 202609 }]);
    expect(r.body.results.rows[0].salary).toBe('already_pending');
    expect(pending('N1314')).toHaveLength(1);
    expect(pending('N1314')[0].new_gross).toBe(12000);
  });

  test('mixed file → per-row report', async () => {
    const e = S.plant(db, { code: 'N1316', gross_salary: 20000 });
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 20000 });
    const r = await bulk([
      { code: 'N1315', name: 'A', gross_salary: 14000, lastSeenSortKey: 202609 },
      { code: 'N1316', name: 'B', gross_salary: 20000, lastSeenSortKey: 202609 },
      { code: 'N1317', name: 'C', lastSeenSortKey: 202609 },
    ]);
    expect(r.body.results.rows).toEqual([
      { code: 'N1315', employee: 'created', salary: 'request_raised' },
      { code: 'N1316', employee: 'updated', salary: 'unchanged' },
      { code: 'N1317', employee: 'created', salary: 'no_gross' },
    ]);
  });

  test('finance sees the request; importing admin approve/reject → 403 SELF_APPROVAL; finance approves → gross + structure written', async () => {
    await bulk([{ code: 'N1318', name: 'SYNTH', company: S.COMPANY, gross_salary: 19000, basic: 9500, hra: 3800, lastSeenSortKey: 202609 }]);
    const list = await api.request('GET', '/api/salary-input/pending-changes', { as: 'fin1' });
    const row = list.body.data.find((x) => x.employee_code === 'N1318');
    expect(row).toBeTruthy();
    expect(row.requested_by).toBe('boss');

    const self = await api.request('PUT', `/api/salary-input/approve/${row.id}`, { as: 'boss', body: { effectiveFrom: '2026-10-01' } });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('SELF_APPROVAL');
    const selfRej = await api.request('PUT', `/api/salary-input/reject/${row.id}`, { as: 'boss', body: { reason: 'synthetic reason' } });
    expect(selfRej.status).toBe(403);
    expect(emp('N1318').gross_salary).toBe(0);

    const ok = await api.request('PUT', `/api/salary-input/approve/${row.id}`, { as: 'fin1', body: { effectiveFrom: '2026-10-01' } });
    expect(ok.status).toBe(200);
    expect(emp('N1318').gross_salary).toBe(19000);
    const s = structures('N1318');
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ effective_from: '2026-10-01', gross_salary: 19000, basic: 9500, hra: 3800, special_allowance: 5700 });
    expect([s[0].pf_applicable, s[0].esi_applicable, s[0].lwf_applicable]).toEqual([0, 0, 0]);
  });

  test('a second admin can approve the import request', async () => {
    await bulk([{ code: 'N1319', name: 'SYNTH', gross_salary: 11000, lastSeenSortKey: 202609 }]);
    const id = pending('N1319')[0].id;
    const r = await api.request('PUT', `/api/salary-input/approve/${id}`, { as: 'boss2', body: { effectiveFrom: '2026-10-01' } });
    expect(r.status).toBe(200);
    expect(emp('N1319').gross_salary).toBe(11000);
  });

  test('bulk-import stays admin only', async () => {
    for (const as of ['hr1', 'fin1']) {
      expect((await bulk([{ code: 'N1399', name: 'X', gross_salary: 1 }], as)).status).toBe(403);
    }
    expect(emp('N1399')).toBeUndefined();
  });
});

describe('PUT /:code/salary still raises its request through the shared helper', () => {
  test('gross change → pending request by the caller; second change → alreadyPending', async () => {
    const e = S.plant(db, { code: 'N1320', gross_salary: 15000 });
    S.plantStructure(db, e, '2025-01-01', { gross_salary: 15000 });
    const r1 = await api.request('PUT', '/api/employees/N1320/salary', { as: 'hr1', body: { gross_salary: 16000 } });
    expect(r1.body).toMatchObject({ success: true, pendingApproval: true });
    expect(r1.body.alreadyPending).toBeUndefined();
    const r2 = await api.request('PUT', '/api/employees/N1320/salary', { as: 'hr1', body: { gross_salary: 17000 } });
    expect(r2.body).toMatchObject({ pendingApproval: true, alreadyPending: true });
    expect(pending('N1320')).toHaveLength(1);
    expect(pending('N1320')[0]).toMatchObject({ requested_by: 'hr1', old_gross: 15000, new_gross: 16000 });
  });
});

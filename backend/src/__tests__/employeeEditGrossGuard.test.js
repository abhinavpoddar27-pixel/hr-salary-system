/**
 * P1-25 — PUT /api/employees/:code cannot change a gross salary, and is hr + admin only.
 *
 * Before: gross_salary was in the edit route's allowedFields and the route had
 * no role guard, so any logged-in role could move employees.gross_salary (and
 * rescale salary_structures) with no salary_change_requests row, no finance
 * approval and no audit row. Plant Stage 7 pays employees.gross_salary.
 * The one allowed path is PUT /:code/salary → a Pending request finance approves.
 *
 * Driven over HTTP behind the REAL requireAuth with real JWTs (jwtApiHarness).
 * Fictional codes / amounts only.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');

const COMPANY = 'Test Company Ltd';
let api;
let db;

beforeAll(() => {
  api = startJwtApi({ '/api/employees': '../../routes/employees' }, {
    users: [
      { username: 'hr1', role: 'hr' },
      { username: 'boss', role: 'admin' },
      { username: 'fin1', role: 'finance' },
      { username: 'view1', role: 'viewer' },
      { username: 'sup1', role: 'supervisor' },
      { username: 'emp1', role: 'employee', employeeCode: 'T2599' },
    ],
  });
  db = api.db;
});
afterAll(async () => { await api.close(); });

let n = 0;
const nextCode = () => `T25${String(++n).padStart(2, '0')}`;

function addEmployee(code, gross = 15000) {
  const id = db.prepare(`INSERT INTO employees (code, name, company, employment_type, status, date_of_joining, gross_salary, designation)
              VALUES (?, 'SYNTH', ?, 'Permanent', 'Active', '2024-01-01', ?, 'OPERATOR')`).run(code, COMPANY, gross).lastInsertRowid;
  if (gross) {
    db.prepare(`INSERT INTO salary_structures (employee_id, effective_from, gross_salary, basic, hra, basic_percent, hra_percent)
                VALUES (?, '2025-01-01', ?, ?, ?, 50, 20)`).run(id, gross, gross * 0.5, gross * 0.2);
  }
  return id;
}
const put = (code, as, body) => api.request('PUT', `/api/employees/${code}`, { as, body });
const empRow = (code) => db.prepare('SELECT name, designation, phone, gross_salary, status FROM employees WHERE code = ?').get(code);
const structs = (id) => db.prepare('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY id').all(id);
const counts = () => ({
  audit: db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c,
  requests: db.prepare('SELECT COUNT(*) AS c FROM salary_change_requests').get().c,
  structures: db.prepare('SELECT COUNT(*) AS c FROM salary_structures').get().c,
});
const snap = (code, id) => ({ emp: empRow(code), structs: structs(id), counts: counts() });

describe('a changed gross is refused for every role that may edit, nothing written', () => {
  test.each(['hr1', 'boss'])('%s: 15000 → 16000 (+ name) → 400 GROSS_CHANGE_NEEDS_APPROVAL', async (who) => {
    const code = nextCode();
    const id = addEmployee(code);
    const before = snap(code, id);
    const r = await put(code, who, { gross_salary: 16000, name: 'RENAMED' });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ success: false, code: 'GROSS_CHANGE_NEEDS_APPROVAL' });
    expect(r.body.error).toMatch(/request a change/);
    expect(snap(code, id)).toEqual(before);   // whole edit refused, name too
  });

  test('a first gross on an employee with none (NULL) is a change → 400', async () => {
    const code = nextCode();
    const id = addEmployee(code, null);
    const before = snap(code, id);
    const r = await put(code, 'hr1', { gross_salary: 12000 });
    expect(r.status).toBe(400);
    expect(snap(code, id)).toEqual(before);
  });

  test.each([['abc'], [{}], ['12,000']])('unreadable gross %p → 400', async (g) => {
    const code = nextCode();
    const id = addEmployee(code);
    const before = snap(code, id);
    const r = await put(code, 'hr1', { gross_salary: g });
    expect(r.status).toBe(400);
    expect(snap(code, id)).toEqual(before);
  });

  test('a change within 0.01 is not a change; 0.02 is', async () => {
    const code = nextCode();
    addEmployee(code);
    expect((await put(code, 'hr1', { gross_salary: 15000.005 })).status).toBe(200);
    expect((await put(code, 'hr1', { gross_salary: 15000.02 })).status).toBe(400);
  });
});

describe('ordinary edits still work', () => {
  test.each([[15000], ['15000'], ['15000.00']])('re-sending the current gross %p with a name change → 200', async (g) => {
    const code = nextCode();
    const id = addEmployee(code);
    const beforeStructs = structs(id);
    const r = await put(code, 'hr1', { gross_salary: g, name: 'RENAMED' });
    expect(r.status).toBe(200);
    expect(empRow(code)).toMatchObject({ name: 'RENAMED', gross_salary: 15000 });
    expect(structs(id).map(s => [s.gross_salary, s.basic, s.hra])).toEqual(beforeStructs.map(s => [s.gross_salary, s.basic, s.hra]));
  });

  test.each([[0], [null], ['']])('employee with no gross: re-sending %p → 200', async (g) => {
    const code = nextCode();
    addEmployee(code, null);
    const r = await put(code, 'hr1', { gross_salary: g, name: 'RENAMED' });
    expect(r.status).toBe(200);
    expect(empRow(code).name).toBe('RENAMED');
  });

  test.each(['hr1', 'boss'])('%s edits other fields (Edit-modal body, no gross) → 200', async (who) => {
    const code = nextCode();
    addEmployee(code);
    const body = { code, name: 'NEW NAME', department: 'PRODUCTION', designation: 'FITTER', company: COMPANY,
      date_of_joining: '2024-01-01', employment_type: 'Permanent', shift_code: '', default_shift_id: null,
      weekly_off_day: 0, phone: '9000000000', email: '', aadhar: '', pan: '' };
    const r = await put(code, who, body);
    expect(r.status).toBe(200);
    expect(empRow(code)).toMatchObject({ name: 'NEW NAME', designation: 'FITTER', phone: '9000000000', gross_salary: 15000 });
  });

  test('P4 exit refusal unchanged for hr', async () => {
    const code = nextCode();
    addEmployee(code);
    const r = await put(code, 'hr1', { status: 'Left' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Use Mark Left/);
  });
});

describe('PUT /:code is hr + admin only', () => {
  test.each(['fin1', 'view1', 'sup1', 'emp1'])('%s plain name edit → 403, nothing written', async (who) => {
    const code = nextCode();
    const id = addEmployee(code);
    const before = snap(code, id);
    const r = await put(code, who, { name: 'RENAMED' });
    expect(r.status).toBe(403);
    expect(snap(code, id)).toEqual(before);
  });

  test('no token → 401', async () => {
    const code = nextCode();
    addEmployee(code);
    const r = await api.request('PUT', `/api/employees/${code}`, { body: { name: 'X' } });
    expect(r.status).toBe(401);
  });

  test('missing employee: hr → 404, viewer → 403 (guard first)', async () => {
    expect((await put('NOPE25', 'hr1', { name: 'X' })).status).toBe(404);
    expect((await put('NOPE25', 'view1', { name: 'X' })).status).toBe(403);
  });
});

describe('the approval path is unchanged', () => {
  test('PUT /:code/salary with a new gross → Pending request, gross unchanged', async () => {
    const code = nextCode();
    addEmployee(code);
    const before = counts().requests;
    const r = await api.request('PUT', `/api/employees/${code}/salary`, { as: 'hr1', body: { gross_salary: 16000 } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, pendingApproval: true });
    expect(counts().requests).toBe(before + 1);
    expect(db.prepare("SELECT status, old_gross, new_gross, requested_by FROM salary_change_requests WHERE employee_code = ? ORDER BY id DESC").get(code))
      .toEqual({ status: 'Pending', old_gross: 15000, new_gross: 16000, requested_by: 'hr1' });
    expect(empRow(code).gross_salary).toBe(15000);
  });
});

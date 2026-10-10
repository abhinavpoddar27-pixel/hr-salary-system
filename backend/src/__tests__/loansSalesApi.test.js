/**
 * Loans PR-8 — sales borrowers over HTTP with REAL JWT auth.
 *
 *   GET  /api/loans/borrowers?q=   one search across the plant and sales masters
 *   POST /api/loans                a sales loan (code + company), HR raises
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');

const IND = 'Indriyan Beverages Pvt Ltd';
const ALI = 'Asian Lakto Ind Ltd';
const USERS = [
  { username: 'boss', role: 'admin' },
  { username: 'hr1', role: 'hr' },
  { username: 'fin1', role: 'finance' },
  { username: 'finAsian', role: 'finance', allowedCompanies: ALI },
  { username: 'view1', role: 'viewer' },
];

let api; let db;
beforeAll(() => {
  api = startJwtApi({ '/api/loans': '../../routes/loans' }, { users: USERS });
  db = api.db;
  const plant = db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, is_contractor, gross_salary)
                            VALUES (?, ?, 'PRODUCTION', ?, ?, ?, '2024-01-01', 0, 20000)`);
  plant.run('70001', 'ZQXRAM KUMAR', IND, 'Permanent', 'Active');
  plant.run('70002', 'ZQXRAM SALESTYPED', IND, 'Sales', 'Active');
  plant.run('70003', 'ZQXRAM LEFT', IND, 'Permanent', 'Left');
  const sales = db.prepare(`INSERT INTO sales_employees (code, name, company, status, doj, gross_salary, designation)
                            VALUES (?, ?, ?, ?, '2024-01-01', 25000, 'SO')`);
  sales.run('SX101', 'ZQXRAM SALES IND', IND, 'Active');
  sales.run('SX101', 'ZQXRAM SALES ALI', ALI, 'Active');
  sales.run('SX102', 'ZQXRAM SALES LEFT', IND, 'Left');
});
afterAll(() => api.close());

const search = (as, q) => api.request('GET', `/api/loans/borrowers?q=${encodeURIComponent(q)}`, { as });

describe('GET /api/loans/borrowers', () => {
  test('both masters, Active only; plant rows typed Sales left out', async () => {
    const r = await search('hr1', 'ZQXRAM');
    expect(r.status).toBe(200);
    const got = r.body.data.map((x) => `${x.borrowerType}:${x.code}:${x.company}`).sort();
    expect(got).toEqual([`plant:70001:${IND}`, `sales:SX101:${ALI}`, `sales:SX101:${IND}`].sort());
    expect(r.body.data.find((x) => x.borrowerType === 'sales').employmentType).toBe('Sales');
  });
  test('by code; fewer than 2 characters → empty', async () => {
    expect((await search('fin1', 'SX10')).body.data.map((x) => x.code)).toEqual(['SX101', 'SX101']);
    expect((await search('hr1', 'R')).body.data).toEqual([]);
  });
  test('a company-restricted user sees only their companies of the sales master', async () => {
    const r = await search('finAsian', 'SX101');
    expect(r.body.data.map((x) => x.company)).toEqual([ALI]);
  });
  test('viewer → 403', async () => {
    expect((await search('view1', 'ZQXRAM')).status).toBe(403);
  });
});

describe('POST /api/loans for a sales borrower', () => {
  const body = (over = {}) => ({ borrowerType: 'sales', employeeCode: 'SX101', company: IND, loanType: 'Personal', principal: 9000, tenure: 3, reason: 'family need', ...over });

  test('HR raises a sales loan against code + company → 201', async () => {
    const r = await api.request('POST', '/api/loans', { as: 'hr1', body: body() });
    expect(r.status).toBe(201);
    const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(r.body.data.loanId);
    expect(loan).toMatchObject({ borrower_type: 'sales', employee_code: 'SX101', company: IND, status: 'requested' });
  });
  test('the same code in the other company is a separate person: its own loan is allowed', async () => {
    const r = await api.request('POST', '/api/loans', { as: 'hr1', body: body({ company: ALI }) });
    expect(r.status).toBe(201);
  });
  test('a second loan for the same person is refused (one active loan)', async () => {
    const r = await api.request('POST', '/api/loans', { as: 'hr1', body: body() });
    expect(r.status).toBe(400);
    expect(r.body.refusals.map((x) => x.code)).toContain('ACTIVE_LOAN_LIMIT');
  });
  test('a Left sales rep is refused; a plant row typed Sales is refused', async () => {
    const left = await api.request('POST', '/api/loans', { as: 'hr1', body: body({ employeeCode: 'SX102' }) });
    expect(left.body.refusals.map((x) => x.code)).toContain('EMPLOYEE_NOT_ACTIVE');
    const typed = await api.request('POST', '/api/loans', { as: 'hr1', body: { ...body({ employeeCode: '70002' }), borrowerType: 'plant' } });
    expect(typed.body.refusals.map((x) => x.code)).toContain('SALES_USE_SALES_MASTER');
  });
  test('the admin cannot raise; company is required', async () => {
    expect((await api.request('POST', '/api/loans', { as: 'boss', body: body() })).body.code).toBe('ADMIN_CANNOT_RAISE');
    expect((await api.request('POST', '/api/loans', { as: 'hr1', body: body({ company: '' }) })).body.code).toBe('COMPANY_REQUIRED');
  });
  test('GET /employee/:code?borrowerType=sales&company= narrows to one person', async () => {
    const both = await api.request('GET', '/api/loans/employee/SX101?borrowerType=sales', { as: 'view1' });
    expect(both.body.data.length).toBe(2);
    const one = await api.request('GET', `/api/loans/employee/SX101?borrowerType=sales&company=${encodeURIComponent(ALI)}`, { as: 'view1' });
    expect(one.body.data.map((l) => l.company)).toEqual([ALI]);
  });
});

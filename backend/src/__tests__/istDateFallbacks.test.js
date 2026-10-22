/**
 * P3-IST-BE — backend "today" fallbacks use the IST date.
 *
 * The server clock is UTC. A fallback built from new Date().toISOString() (or
 * getFullYear / getMonth, or SQL date('now')) is the UTC date, i.e. yesterday
 * between 00:00 and 05:30 IST. Only the JS Date clock is pinned here (sockets
 * and timers stay real), so routes are driven over HTTP behind the real
 * requireAuth with real JWTs (jwtApiHarness) on a real initSchema() database.
 *
 * Clock 2026-10-10T19:00:00Z = 00:30 IST on 11 Oct 2026 (UTC date still 10 Oct).
 *
 * Passes in any server zone. To see the old code fail (--base), run under TZ=UTC as on
 * Railway: the old getFullYear()/getMonth() defaults read the server's LOCAL zone, so a
 * container set to IST hides three of the failures (jest sandboxes process.env, so the
 * zone cannot be forced from inside this file).
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');
const ist = require('../utils/istDate');

const NIGHT = Date.parse('2026-10-10T19:00:00Z');       // 00:30 IST 11 Oct
const NEW_YEAR = Date.parse('2026-12-31T19:00:00Z');    // 00:30 IST 1 Jan 2027
const NEW_MONTH = Date.parse('2026-10-31T19:00:00Z');   // 00:30 IST 1 Nov 2026
const COMPANY = 'Indriyan Beverages Pvt Ltd';

// Fake only Date — HTTP sockets, timers and nextTick stay real.
const REAL = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame',
  'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate',
  'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'];
const pin = (ms) => jest.useFakeTimers({ doNotFake: REAL, now: ms });

describe('utils/istDate', () => {
  test('istToday is the IST calendar date', () => {
    expect(ist.istToday(NIGHT)).toBe('2026-10-11');
    expect(ist.istToday(Date.parse('2026-10-10T18:29:59Z'))).toBe('2026-10-10');
    expect(ist.istToday(Date.parse('2026-10-10T18:30:00Z'))).toBe('2026-10-11');
    expect(ist.istToday(new Date(NIGHT))).toBe('2026-10-11');
  });
  test('istYearMonth / istYear roll over at IST midnight', () => {
    expect(ist.istYearMonth(NEW_YEAR)).toEqual({ year: 2027, month: 1 });
    expect(ist.istYear(NEW_YEAR)).toBe(2027);
    expect(ist.istYearMonth(NEW_MONTH)).toEqual({ year: 2026, month: 11 });
  });
  test('istAddDays / istAddMonths are plain date arithmetic', () => {
    expect(ist.istAddDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(ist.istAddDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(ist.istAddMonths('2026-10-11', -6)).toBe('2026-04-11');
    expect(ist.istAddMonths('2026-08-31', -6)).toBe('2026-03-03'); // JS rollover, same as the frontend
  });
  test('the default argument reads the (pinned) clock', () => {
    pin(NIGHT);
    try { expect(ist.istToday()).toBe('2026-10-11'); } finally { jest.useRealTimers(); }
  });
});

describe('routes at 00:30 IST', () => {
  let api; let db;
  beforeAll(() => {
    api = startJwtApi({
      '/api/employees': '../../routes/employees',
      '/api/sales': '../../routes/sales',
      '/api/advance': '../../routes/advance',
      '/api/leaves': '../../routes/leaves',
      '/api/early-exits': '../../routes/early-exits',
      '/api/short-leaves': '../../routes/short-leaves',
    }, { users: [{ username: 'hr1', role: 'hr' }, { username: 'boss', role: 'admin' }] });
    db = api.db;
  });
  afterAll(async () => { jest.useRealTimers(); await api.close(); });
  afterEach(() => jest.useRealTimers());
  // A token is checked against the (pinned) clock: sign one after pinning a future date.
  let u = 0;
  const pinnedUser = () => { const name = `hrclock${++u}`; api.addUser({ username: name, role: 'hr' }); return name; };

  const addEmp = (code, extra = {}) => db.prepare(`INSERT INTO employees (code, name, company, employment_type, status, date_of_joining)
      VALUES (?, 'TEST', ?, 'Permanent', 'Active', ?)`).run(code, COMPANY, extra.doj || '2024-01-01').lastInsertRowid;

  test('M2 plant Mark Left with no date → exit date = IST today', async () => {
    addEmp('T9001');
    pin(NIGHT);
    const r = await api.request('PUT', '/api/employees/T9001/mark-left', { as: 'hr1', body: { reason: 'Resigned' } });
    expect(r.status).toBe(200);
    const row = db.prepare('SELECT date_of_exit, inactive_since FROM employees WHERE code = ?').get('T9001');
    expect(row).toEqual({ date_of_exit: '2026-10-11', inactive_since: '2026-10-11' });
  });

  test('M2 an explicit date is still used as given', async () => {
    addEmp('T9002');
    pin(NIGHT);
    const r = await api.request('PUT', '/api/employees/T9002/mark-left', { as: 'hr1', body: { date_of_leaving: '2026-10-05', reason: 'x' } });
    expect(r.status).toBe(200);
    expect(db.prepare('SELECT date_of_exit FROM employees WHERE code = ?').get('T9002').date_of_exit).toBe('2026-10-05');
  });

  test('M4 sales mark-left with no dol → dol = IST today', async () => {
    db.prepare(`INSERT INTO sales_employees (code, name, company, status) VALUES ('S901', 'TEST', ?, 'Active')`).run(COMPANY);
    pin(NIGHT);
    const r = await api.request('PUT', `/api/sales/employees/S901/mark-left?company=${encodeURIComponent(COMPANY)}`, { as: 'hr1', body: { reason: 'x' } });
    expect(r.status).toBe(200);
    expect(db.prepare('SELECT dol FROM sales_employees WHERE code = ?').get('S901').dol).toBe('2026-10-11');
  });

  test('M6 mark advance paid → paid_date = IST today (single + batch)', async () => {
    const ins = db.prepare(`INSERT INTO salary_advances (employee_code, month, year, is_eligible, advance_amount) VALUES (?, 10, 2026, 1, 1000)`);
    const a = ins.run('T9003').lastInsertRowid;
    const b = ins.run('T9004').lastInsertRowid;
    pin(NIGHT);
    expect((await api.request('PUT', `/api/advance/${a}/mark-paid`, { as: 'hr1', body: {} })).status).toBe(200);
    expect((await api.request('PUT', '/api/advance/batch-mark-paid', { as: 'hr1', body: { ids: [b] } })).status).toBe(200);
    const rows = db.prepare('SELECT paid_date FROM salary_advances WHERE id IN (?, ?)').all(a, b);
    expect(rows.map((x) => x.paid_date)).toEqual(['2026-10-11', '2026-10-11']);
  });

  test('M7 leave /adjust at 00:30 IST on 1 Jan moves the NEW year balance', async () => {
    const id = addEmp('T9005');
    const bal = db.prepare('INSERT INTO leave_balances (employee_id, year, leave_type, opening, balance) VALUES (?, ?, ?, 5, 5)');
    bal.run(id, 2026, 'EL'); bal.run(id, 2027, 'EL');
    pin(NEW_YEAR);
    const r = await api.request('POST', '/api/leaves/adjust', { as: pinnedUser(), body: { employee_code: 'T9005', leave_type: 'EL', days: 2, transaction_type: 'Credit', reason: 'test' } });
    expect(r.status).toBe(200);
    const b = db.prepare('SELECT year, balance FROM leave_balances WHERE employee_id = ? ORDER BY year').all(id);
    expect(b).toEqual([{ year: 2026, balance: 5 }, { year: 2027, balance: 7 }]);
    const tx = db.prepare('SELECT reference_month AS month, reference_year AS year FROM leave_transactions WHERE employee_code = ?').get('T9005');
    expect(tx).toEqual({ month: 1, year: 2027 });
  });

  test('on-leave-today lists a leave that starts on the IST date', async () => {
    addEmp('T9006');
    db.prepare(`INSERT INTO leave_applications (employee_code, leave_type, start_date, end_date, days, status)
                VALUES ('T9006', 'CL', '2026-10-11', '2026-10-11', 1, 'Approved')`).run();
    pin(NIGHT);
    const r = await api.request('GET', '/api/leaves/on-leave-today', { as: 'hr1' });
    expect(r.status).toBe(200);
    expect(r.body.data.map((x) => x.employee_code)).toContain('T9006');
  });

  test('early-exit detect accepts the IST date (not "future") and defaults to IST yesterday', async () => {
    pin(NIGHT);
    const r = await api.request('POST', '/api/early-exits/detect', { as: 'hr1', body: { date: '2026-10-11' } });
    expect(r.status).toBe(200);
    const future = await api.request('POST', '/api/early-exits/detect', { as: 'hr1', body: { date: '2026-10-12' } });
    expect(future.status).toBe(400);
  });

  test('gate-pass quota defaults to the IST month', async () => {
    pin(NEW_MONTH);
    const r = await api.request('GET', '/api/short-leaves/quota/T9001', { as: pinnedUser() });
    expect(r.status).toBe(200);
    expect([r.body.calendar_month, r.body.calendar_year]).toEqual([11, 2026]);
  });

  test('M8 new employee leave balance year = IST year', async () => {
    pin(NEW_YEAR);
    const r = await api.request('POST', '/api/employees', { as: pinnedUser(), body: { code: 'T9007', name: 'TEST', company: COMPANY, dateOfJoining: '2027-01-01' } });
    expect(r.status).toBe(200);
    const id = db.prepare('SELECT id FROM employees WHERE code = ?').get('T9007').id;
    const years = db.prepare('SELECT DISTINCT year FROM leave_balances WHERE employee_id = ?').all(id).map((x) => x.year);
    expect(years).toEqual([2027]);
  });

  test('M1 PUT /employees/:code with no structure → new structure effective_from = IST today', async () => {
    const id = addEmp('T9008');
    pin(NIGHT);
    const r = await api.request('PUT', '/api/employees/T9008', { as: 'hr1', body: { name: 'TEST', basic: 0, da: 0, hra: 0 } });
    expect(r.status).toBe(200);
    const rows = db.prepare('SELECT effective_from FROM salary_structures WHERE employee_id = ?').all(id);
    expect(rows.map((x) => x.effective_from)).toEqual(['2026-10-11']);
  });

  test('M9 sales gross change with no effective_from → structure month = IST month', async () => {
    db.prepare(`INSERT INTO sales_employees (code, name, company, status, gross_salary) VALUES ('S902', 'TEST', ?, 'Active', 20000)`).run(COMPANY);
    pin(NEW_MONTH);
    const r = await api.request('PUT', `/api/sales/employees/S902?company=${encodeURIComponent(COMPANY)}`, { as: pinnedUser(), body: { gross_salary: 22000 } });
    expect(r.status).toBe(200);
    const sid = db.prepare('SELECT id FROM sales_employees WHERE code = ?').get('S902').id;
    const months = db.prepare('SELECT effective_from FROM sales_salary_structures WHERE employee_id = ?').all(sid).map((x) => x.effective_from);
    expect(months).toContain('2026-11');
    expect(months).not.toContain('2026-10');
  });
});

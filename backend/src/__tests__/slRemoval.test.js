/**
 * Owner rulings 7 and 8: SL is abolished as a live leave type, and CL is 7 days
 * pro-rated by joining month. Historical SL rows must still read back.
 */
const { calculateDays } = require('../services/dayCalculation');
const { computeClEntitlement } = require('../services/phase5Features');
const { startApi } = require('./helpers/apiHarness');

const MONTH = 3;
const YEAR = 2026;

function records(status = 'P') {
  const out = [];
  for (let d = 1; d <= 31; d += 1) {
    const date = `${YEAR}-03-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    out.push({
      date, month: MONTH, year: YEAR,
      status_original: dow === 0 ? 'WO' : status,
      status_final: dow === 0 ? 'WO' : status,
      in_time_original: '08:00', out_time_original: '18:00',
      is_night_out_only: 0, is_miss_punch: 0,
    });
  }
  return out;
}

/** Turn a run of working days absent so a leave application has something to cover. */
function withAbsences(recs, days) {
  let left = days;
  for (const r of recs) {
    if (left === 0) break;
    if (r.status_final === 'WO') continue;
    r.status_original = 'A';
    r.status_final = 'A';
    left -= 1;
  }
  return recs;
}

const run = (recs, approvedLeaves) => calculateDays(
  'SLTEST', MONTH, YEAR, 'Indriyan Beverages Pvt Ltd',
  recs, { CL: 10, EL: 10, SL: 10 }, [],
  { isContractor: false, weeklyOffDay: 0, employmentType: 'Permanent', approvedLeaves, approvedCompOff: [] }
);

describe('SL no longer changes pay (ruling 8)', () => {
  test('an SL application leaves payable days exactly where an absence left them', () => {
    const baseline = run(withAbsences(records(), 3), []);
    const withSl = run(withAbsences(records(), 3), [
      { leave_type: 'SL', start_date: '2026-03-02', end_date: '2026-03-04', days: 3, status: 'Approved' },
    ]);
    expect(withSl.totalPayableDays).toBe(baseline.totalPayableDays);
    expect(withSl.slUsed).toBe(3); // still counted, for the record
  });

  test('CL still reclassifies without restoring pay, and EL still restores it', () => {
    const baseline = run(withAbsences(records(), 3), []);
    const withCl = run(withAbsences(records(), 3), [
      { leave_type: 'CL', start_date: '2026-03-02', end_date: '2026-03-04', days: 3, status: 'Approved' },
    ]);
    const withEl = run(withAbsences(records(), 3), [
      { leave_type: 'EL', start_date: '2026-03-02', end_date: '2026-03-04', days: 3, status: 'Approved' },
    ]);
    expect(withCl.totalPayableDays).toBe(baseline.totalPayableDays);
    expect(withCl.clUsed).toBe(3);
    expect(withEl.totalPayableDays).toBeGreaterThan(baseline.totalPayableDays);
    expect(withEl.elUsed).toBe(3);
  });

  test('sl_used is still written, so historical rows keep rendering', () => {
    const out = run(withAbsences(records(), 2), [
      { leave_type: 'SL', start_date: '2026-03-02', end_date: '2026-03-03', days: 2, status: 'Approved' },
    ]);
    expect(out).toHaveProperty('slUsed', 2);
  });
});

describe('CL entitlement is 7, pro-rated by joining month (ruling 7)', () => {
  test.each([
    ['2026-01-01', 7], ['2026-02-01', 7],
    ['2026-03-01', 6], ['2026-04-01', 6],
    ['2026-05-01', 5], ['2026-06-01', 5],
    ['2026-07-01', 4], ['2026-08-01', 4],
    ['2026-09-01', 3], ['2026-10-01', 3],
    ['2026-11-01', 2], ['2026-12-01', 2],
  ])('joining %s gives %i days', (doj, expected) => {
    expect(computeClEntitlement(doj, YEAR, 7)).toBe(expected);
  });

  test('a mid-month joiner rolls to the next month, and a prior-year joiner gets the full base', () => {
    expect(computeClEntitlement('2026-02-15', YEAR, 7)).toBe(6); // effective March
    expect(computeClEntitlement('2026-12-15', YEAR, 7)).toBe(0); // rolls into next year
    expect(computeClEntitlement('2023-06-01', YEAR, 7)).toBe(7);
  });
});

describe('the write paths reject SL', () => {
  let api;
  let db;
  beforeAll(() => {
    api = startApi({ '/api/leaves': '../../routes/leaves', '/api/employees': '../../routes/employees' });
    db = api.db;
  });
  afterAll(async () => { await api.close(); });
  beforeEach(() => {
    for (const t of ['leave_applications', 'leave_balances', 'employees', 'leave_transactions']) {
      db.prepare(`DELETE FROM ${t}`).run();
    }
  });

  const SL_MSG = 'Invalid leave_type. Must be CL or EL. SL is no longer supported.';

  test('POST /api/leaves refuses an SL application', async () => {
    db.prepare(`INSERT INTO employees (code, name, company, employment_type, status, date_of_joining)
                VALUES ('SL01', 'X', 'Indriyan Beverages Pvt Ltd', 'Permanent', 'Active', '2024-01-01')`).run();
    const res = await api.request('POST', '/api/leaves', {
      body: { employeeCode: 'SL01', leaveType: 'SL', startDate: '2026-03-02', endDate: '2026-03-02', days: 1, hrRemark: 'sick' },
      role: 'hr',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(SL_MSG);
    expect(db.prepare('SELECT COUNT(*) c FROM leave_applications').get().c).toBe(0);
  });

  test('a Pending SL row raised before the change cannot be approved', async () => {
    const info = db.prepare(`INSERT INTO employees (code, name, company, employment_type, status, date_of_joining)
                VALUES ('SL02', 'X', 'Indriyan Beverages Pvt Ltd', 'Permanent', 'Active', '2024-01-01')`).run();
    db.prepare(`INSERT INTO leave_applications (employee_id, employee_code, leave_type, start_date, end_date, days, status)
                VALUES (?, 'SL02', 'SL', '2026-03-02', '2026-03-02', 1, 'Pending')`).run(info.lastInsertRowid);
    const id = db.prepare('SELECT id FROM leave_applications').get().id;
    const res = await api.request('PUT', `/api/leaves/${id}/approve`, { role: 'hr' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(SL_MSG);
    expect(db.prepare('SELECT status FROM leave_applications WHERE id = ?').get(id).status).toBe('Pending');
  });

  test('POST /api/leaves/adjust already refused SL and still does', async () => {
    const res = await api.request('POST', '/api/leaves/adjust', {
      body: { employee_code: 'SL01', leave_type: 'SL', transaction_type: 'Credit', days: 1, reason: 'x' },
      role: 'hr',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(SL_MSG);
  });

  test('a new employee is seeded 7 CL pro-rated by joining month, not 12', async () => {
    const res = await api.request('POST', '/api/employees', {
      body: { code: 'NEW01', name: 'NEW HIRE', company: 'Indriyan Beverages Pvt Ltd', employmentType: 'Permanent', dateOfJoining: '2026-09-01' },
      role: 'hr',
    });
    expect(res.status).toBe(200);
    const emp = db.prepare("SELECT id FROM employees WHERE code = 'NEW01'").get();
    const cl = db.prepare("SELECT opening, balance FROM leave_balances WHERE employee_id = ? AND leave_type = 'CL'").get(emp.id);
    expect(cl).toEqual({ opening: 3, balance: 3 }); // Sept joiner
    const el = db.prepare("SELECT opening FROM leave_balances WHERE employee_id = ? AND leave_type = 'EL'").get(emp.id);
    expect(el.opening).toBe(0);
  });
});

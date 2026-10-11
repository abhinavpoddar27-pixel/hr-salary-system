/**
 * N-REP — Reports correctness (routes/reports.js):
 *   N-3  Bank Transfer Sheet leaves out held salaries (same people as the NEFT bank file) and reports them
 *        as a separate held count / amount; account / IFSC fall back from a blank primary column.
 *   N-2  PF and ESI Statements follow the company filter (blank = every company); held rows stay in.
 *   N-1  Audit Trail: timestamps come back (changed_at, plus created_at alias), month / year filter by IST
 *        calendar month, 1,000-row cap with total + truncated.
 * Synthetic codes, names and numbers only.
 */
const { startJwtApi } = require('./helpers/jwtApiHarness');
const { generateBankFile } = require('../services/exportFormats');

const A = 'Synth Company Alpha';
const B = 'Synth Company Beta';
const MONTH = 10; const YEAR = 2026;
let api;

function seed(db, code, company, over = {}) {
  db.prepare(`INSERT INTO employees (code, name, department, company, status, date_of_joining, uan, esi_number,
                account_number, bank_account, ifsc_code, ifsc, bank_name)
              VALUES (?, ?, 'PRODUCTION', ?, 'Active', '2024-03-01', '100000000001', '2000000001', ?, ?, ?, ?, 'SYNTH BANK')`)
    .run(code, `Synth ${code}`, company,
      over.account === undefined ? `5000${code.replace(/\D/g, '')}` : over.account, over.bankAccount ?? null,
      over.ifscCode === undefined ? 'SYNB0000123' : over.ifscCode, over.ifsc ?? null);
  const net = over.net ?? 10000;
  db.prepare(`INSERT INTO salary_computations (employee_code, month, year, company, gross_salary, gross_earned, payable_days,
                pf_wages, pf_employee, pf_employer, eps, esi_wages, esi_employee, esi_employer, total_deductions, net_salary, salary_held)
              VALUES (?, ?, ?, ?, 12000, 12000, 26, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
    .run(code, MONTH, YEAR, company,
      over.pf ? 6000 : 0, over.pf ? 720 : 0, over.pf ? 220 : 0, over.pf ? 500 : 0,
      over.esi ? 12000 : 0, over.esi ? 90 : 0, over.esi ? 390 : 0, net, over.held ? 1 : 0);
}

function audit(db, changedAt, n = 1, stage = 'synth') {
  const ins = db.prepare(`INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, changed_at, stage, remark)
                          VALUES ('synth_table', 1, 'f', 'a', 'b', 'tester', ?, ?, 'synthetic')`);
  for (let i = 0; i < n; i++) ins.run(changedAt, stage);
}

beforeAll(() => {
  api = startJwtApi({ '/api/reports': '../../routes/reports' }, {
    users: [{ username: 'hr1', role: 'hr' }, { username: 'fin1', role: 'finance' }],
  });
  const db = api.db;
  // Bank / PF / ESI
  seed(db, 'T8101', A, { net: 10000, pf: true, esi: true });
  seed(db, 'T8102', A, { net: 20000, pf: true });
  seed(db, 'T8103', A, { net: 7000, held: true, pf: true, esi: true });     // held
  seed(db, 'T8104', B, { net: 15000, esi: true });
  seed(db, 'T8105', B, { net: 3000, held: true });                            // held
  seed(db, 'T8106', B, { net: 0 });                                           // zero net → never listed
  seed(db, 'T8107', A, { net: 5000, account: '  ', bankAccount: '777000111', ifscCode: '', ifsc: 'SYNB0000999' });
  // Audit: other tables seed their own audit rows at boot — start from a clean slate.
  db.prepare('DELETE FROM audit_log').run();
  audit(db, '2026-09-30 18:29:59', 1, 'edge_before');  // = 30 Sep 23:59:59 IST → September
  audit(db, '2026-09-30 18:30:00', 1, 'edge_start');   // = 1 Oct 00:00 IST → October
  audit(db, '2026-10-15 06:00:00', 3, 'mid');
  audit(db, '2026-10-31 18:29:59', 1, 'edge_end');     // = 31 Oct 23:59:59 IST → October
  audit(db, '2026-10-31 18:30:00', 1, 'edge_after');   // = 1 Nov 00:00 IST → November
  audit(db, '2026-08-10 10:00:00', 1005, 'aug_bulk');  // > 1,000 rows in August
});
afterAll(() => api.close());

const get = async (url, as = 'hr1') => {
  const r = await api.request('GET', url, { as });
  expect(r.status).toBe(200);
  return r.body;
};

describe('N-3 — Bank Transfer Sheet', () => {
  test('held salaries are left out; totals cover the sheet only; held count / amount separate', async () => {
    const b = await get(`/api/reports/bank-transfer?month=${MONTH}&year=${YEAR}`);
    const codes = b.data.map(r => r.employee_code).sort();
    expect(codes).toEqual(['T8101', 'T8102', 'T8104', 'T8107']);
    expect(b.count).toBe(4);
    expect(b.totalAmount).toBe(50000);
    expect(b.held).toEqual({ count: 2, amount: 10000 });
  });
  test('company filter: held count follows the company', async () => {
    const a = await get(`/api/reports/bank-transfer?month=${MONTH}&year=${YEAR}&company=${encodeURIComponent(A)}`);
    expect(a.data.map(r => r.employee_code).sort()).toEqual(['T8101', 'T8102', 'T8107']);
    expect(a.totalAmount).toBe(35000);
    expect(a.held).toEqual({ count: 1, amount: 7000 });
    const bb = await get(`/api/reports/bank-transfer?month=${MONTH}&year=${YEAR}&company=${encodeURIComponent(B)}`, 'fin1');
    expect(bb.data.map(r => r.employee_code)).toEqual(['T8104']);
    expect(bb.held).toEqual({ count: 1, amount: 3000 });
  });
  test('same people as the NEFT bank file', async () => {
    for (const company of ['', A, B]) {
      const b = await get(`/api/reports/bank-transfer?month=${MONTH}&year=${YEAR}${company ? `&company=${encodeURIComponent(company)}` : ''}`);
      const file = generateBankFile(api.db, MONTH, YEAR, company || undefined);
      const fileCodes = [...file.employees, ...file.missing].map(e => e.employee_code).sort();
      expect(b.data.map(r => r.employee_code).sort()).toEqual(fileCodes);
    }
  });
  test('blank primary account / IFSC falls back to the second column', async () => {
    const b = await get(`/api/reports/bank-transfer?month=${MONTH}&year=${YEAR}`);
    const r = b.data.find(x => x.employee_code === 'T8107');
    expect(r.account_number).toBe('777000111');
    expect(r.ifsc_code).toBe('SYNB0000999');
  });
});

describe('N-2 — PF / ESI Statements follow the company', () => {
  test('PF: A only, B only, blank = both; held rows stay in', async () => {
    const q = (c) => `/api/reports/pf-statement?month=${MONTH}&year=${YEAR}${c ? `&company=${encodeURIComponent(c)}` : ''}`;
    const all = await get(q(''));
    expect(all.data.employees.map(r => r.employee_code).sort()).toEqual(['T8101', 'T8102', 'T8103']);
    const a = await get(q(A));
    expect(a.data.employees.map(r => r.employee_code).sort()).toEqual(['T8101', 'T8102', 'T8103']);
    expect(a.data.totals.employeePF).toBe(2160);
    const b = await get(q(B), 'fin1');
    expect(b.data.employees).toEqual([]);
    expect(b.data.totals.total).toBe(0);
  });
  test('ESI: A only, B only, blank = both', async () => {
    const q = (c) => `/api/reports/esi-statement?month=${MONTH}&year=${YEAR}${c ? `&company=${encodeURIComponent(c)}` : ''}`;
    expect((await get(q(''))).data.employees.map(r => r.employee_code).sort()).toEqual(['T8101', 'T8103', 'T8104']);
    const a = await get(q(A));
    expect(a.data.employees.map(r => r.employee_code).sort()).toEqual(['T8101', 'T8103']);
    expect(a.data.totals.employeeESI).toBe(180);
    const b = await get(q(B));
    expect(b.data.employees.map(r => r.employee_code)).toEqual(['T8104']);
    expect(b.data.totals.total).toBe(480);
  });
});

describe('N-1 — Audit Trail', () => {
  test('month filter is the IST calendar month (UTC boundary rows)', async () => {
    const o = await get(`/api/reports/audit-trail?month=10&year=2026`);
    expect(o.data.map(r => r.stage).sort()).toEqual(['edge_end', 'edge_start', 'mid', 'mid', 'mid']);
    expect(o.total).toBe(5);
    expect(o.truncated).toBe(false);
    const s = await get(`/api/reports/audit-trail?month=9&year=2026`);
    expect(s.data.map(r => r.stage)).toEqual(['edge_before']);
    const n = await get(`/api/reports/audit-trail?month=11&year=2026`);
    expect(n.data.map(r => r.stage)).toEqual(['edge_after']);
  });
  test('timestamps are present (changed_at and the created_at alias)', async () => {
    const o = await get(`/api/reports/audit-trail?month=10&year=2026`);
    for (const r of o.data) {
      expect(r.changed_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(r.created_at).toBe(r.changed_at);
    }
    expect(o.data[0].changed_at >= o.data[o.data.length - 1].changed_at).toBe(true); // newest first
  });
  test('cap 1,000 with total + truncated', async () => {
    const a = await get(`/api/reports/audit-trail?month=8&year=2026`);
    expect(a.data.length).toBe(1000);
    expect(a.total).toBe(1005);
    expect(a.truncated).toBe(true);
  });
  test('company is ignored; no month → all time (unchanged behaviour)', async () => {
    const c = await get(`/api/reports/audit-trail?month=10&year=2026&company=${encodeURIComponent(B)}`);
    expect(c.total).toBe(5);
    const all = await get(`/api/reports/audit-trail`);
    expect(all.data.length).toBe(1000);
    expect(all.total).toBe(1013);
  });
  test('stage and employeeCode filters still combine with the month', async () => {
    const m = await get(`/api/reports/audit-trail?month=10&year=2026&stage=mid`);
    expect(m.total).toBe(3);
  });
});

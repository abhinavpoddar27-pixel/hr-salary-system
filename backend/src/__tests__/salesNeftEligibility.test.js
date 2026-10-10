/**
 * P1-03 (finding S-1, ruling Q12 = C) — who goes into the sales bank (NEFT) file.
 *   N1  eligibility — IN: computed / reviewed / finalized with net > 0 and bank details;
 *       OUT: paid, hold, net 0 / negative, another company, another month;
 *       missing account / IFSC → `missing`, never a line.
 *   N2  preview counts — byStatus, notFinalized, alreadyExported, excludedPaid(+Amount).
 *   N3  file bytes — header = the plant bank header; with no paid rows the CSV equals the
 *       pre-P1-03 function's output byte for byte (old logic copied below as the reference).
 *   N4  route — preview JSON carries the new totals (no route change); download stamps exactly
 *       the written rows, a paid row's neft_exported_at is untouched, one audit row; real JWTs.
 * Real initSchema, synthetic codes and bank numbers only.
 */
const S = require('./helpers/statutoryFixture');
const { generateSalesNEFT } = require('../services/salesExportFormats');
const { startJwtApi } = require('./helpers/jwtApiHarness');

const CO = S.COMPANY;
const OTHER = S.OTHER_COMPANY;
const M = 10; const Y = 2026;
const HEADER = 'Sr No,Beneficiary Name,Account Number,IFSC Code,Date of Joining,Amount,Narration';
const PAID_STAMP = '2026-10-01 10:00:00';

function rep(db, { code, name, status = 'computed', net = 15000, acct = `9000${code}`, ifsc = 'TEST0000001',
  company = CO, month = M, year = Y, stamp = null }) {
  db.prepare(`INSERT INTO sales_employees (code, name, company, status, doj, account_no, ifsc)
              VALUES (?, ?, ?, 'Active', '2025-01-15', ?, ?)
              ON CONFLICT DO NOTHING`).run(code, name, company, acct, ifsc);
  const info = db.prepare(`INSERT INTO sales_salary_computations
      (employee_code, month, year, company, days_given, total_days, calendar_days, earned_ratio, net_salary, status, neft_exported_at)
      VALUES (?, ?, ?, ?, 25, 29, 30, 0.9667, ?, ?, ?)`).run(code, month, year, company, net, status, stamp);
  return Number(info.lastInsertRowid);
}

/** The October cast (synthetic). */
function cast(db) {
  rep(db, { code: 'N01', name: 'Alpha', status: 'computed', net: 15000.5 });                 // IN
  rep(db, { code: 'N02', name: 'Bravo', status: 'reviewed', net: 12000 });                    // IN
  rep(db, { code: 'N03', name: 'Charlie', status: 'finalized', net: 18000.25 });              // IN
  rep(db, { code: 'N04', name: 'Delta', status: 'finalized', net: 9000, stamp: '2026-10-05 09:00:00' }); // IN, already exported
  rep(db, { code: 'N05', name: 'Echo', status: 'paid', net: 20000, stamp: PAID_STAMP });     // OUT paid
  rep(db, { code: 'N06', name: 'Foxtrot', status: 'paid', net: 5000.4, stamp: PAID_STAMP });  // OUT paid
  rep(db, { code: 'N07', name: 'Golf', status: 'hold', net: 11000 });                         // OUT hold
  rep(db, { code: 'N08', name: 'Hotel', status: 'computed', net: 0 });                        // OUT net 0
  rep(db, { code: 'N09', name: 'India', status: 'computed', net: -5 });                       // OUT negative
  rep(db, { code: 'N10', name: 'Juliet', status: 'computed', net: 7000, acct: null });        // missing account
  rep(db, { code: 'N11', name: 'Kilo', status: 'reviewed', net: 6000, ifsc: '' });            // missing IFSC
  rep(db, { code: 'N12', name: 'Lima', status: 'computed', net: 8000, company: OTHER });      // OUT other company
  rep(db, { code: 'N13', name: 'Mike', status: 'computed', net: 8000, month: 9 });            // OUT other month
  rep(db, { code: 'N14', name: 'Nov, ember', status: 'paid', net: 0 });                       // OUT paid but net 0 (not counted)
}

/** Verbatim copy of the pre-P1-03 CSV logic (origin/main 96ee482) — the byte reference. */
function oldNeftContent(db, month, year, company) {
  const MONTHS_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDOJ = (d) => { if (!d) return ''; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d)); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d); };
  const rows = db.prepare(`
    SELECT c.employee_code, c.net_salary, c.status, c.id AS computation_id,
           e.name, e.account_no, e.ifsc, e.bank_name, e.doj
      FROM sales_salary_computations c
 LEFT JOIN sales_employees e
        ON e.code = c.employee_code AND e.company = c.company
     WHERE c.month = ? AND c.year = ? AND c.company = ?
       AND c.net_salary > 0
       AND c.status != 'hold'
  ORDER BY e.name ASC, c.employee_code ASC
  `).all(month, year, company);
  const narration = `SALARY ${MONTHS_SHORT[month].toUpperCase()} ${year}`;
  const lines = [HEADER];
  let sr = 0;
  for (const r of rows) {
    if (!r.account_no || !r.ifsc) continue;
    sr++;
    const name = (r.name || '').replace(/,/g, ' ').replace(/"/g, '');
    const amount = Math.round((r.net_salary || 0) * 100) / 100;
    lines.push(`${sr},"${name}",${r.account_no},${r.ifsc},${fmtDOJ(r.doj)},${amount},"${narration}"`);
  }
  return lines.join('\n');
}

const codes = (f) => f.employees.map((r) => r.employee_code);

describe('N1/N2 — eligibility and preview counts', () => {
  test('paid / hold / net ≤ 0 / other company / other month are left out; counts exact', () => {
    const db = S.newDb();
    cast(db);
    const f = generateSalesNEFT(db, M, Y, CO);
    expect(codes(f)).toEqual(['N01', 'N02', 'N03', 'N04']);              // ORDER BY name
    expect(f.missing.map((m) => m.employee_code)).toEqual(['N10', 'N11']);
    const lines = f.content.split('\n');
    expect(lines[0]).toBe(HEADER);
    expect(lines.length).toBe(1 + 4);
    for (const out of ['N05', 'N06', 'N07', 'N08', 'N09', 'N12', 'N13', 'N14']) {
      expect(f.content).not.toContain(`9000${out}`);
    }
    expect(f.eligibleIds.length).toBe(4);
    expect(f.totals).toEqual({
      count: 4,
      totalAmount: 54000.75,
      missingCount: 2,
      byStatus: { computed: 1, reviewed: 1, finalized: 2 },
      notFinalized: 2,
      alreadyExported: 1,
      excludedPaid: 2,
      excludedPaidAmount: 25000.4,
    });
    db.close();
  });

  test('a month with no paid rows: excludedPaid 0, sum of byStatus = count', () => {
    const db = S.newDb();
    rep(db, { code: 'P01', name: 'Papa', status: 'computed' });
    rep(db, { code: 'P02', name: 'Quebec', status: 'computed' });
    const f = generateSalesNEFT(db, M, Y, CO);
    expect(f.totals.excludedPaid).toBe(0);
    expect(f.totals.excludedPaidAmount).toBe(0);
    expect(f.totals.alreadyExported).toBe(0);
    const b = f.totals.byStatus;
    expect(b.computed + b.reviewed + b.finalized).toBe(f.totals.count);
    db.close();
  });

  test('empty month: header-only file, all counts 0', () => {
    const db = S.newDb();
    const f = generateSalesNEFT(db, M, Y, CO);
    expect(f.content).toBe(HEADER);
    expect(f.totals).toMatchObject({ count: 0, excludedPaid: 0, notFinalized: 0, alreadyExported: 0 });
    db.close();
  });
});

describe('N3 — file bytes', () => {
  test('without paid rows the CSV equals the pre-P1-03 output byte for byte', () => {
    const db = S.newDb();
    cast(db);
    db.prepare("DELETE FROM sales_salary_computations WHERE status = 'paid'").run();
    expect(generateSalesNEFT(db, M, Y, CO).content).toBe(oldNeftContent(db, M, Y, CO));
    db.close();
  });

  test('with paid rows the only difference is the paid lines (re-numbered Sr No)', () => {
    const db = S.newDb();
    cast(db);
    const before = oldNeftContent(db, M, Y, CO).split('\n');
    const after = generateSalesNEFT(db, M, Y, CO).content.split('\n');
    const strip = (l) => l.replace(/^\d+,/, '');
    const paidAccts = ['9000N05', '9000N06'];
    expect(before.length - after.length).toBe(2);
    expect(after.map(strip)).toEqual(before.filter((l) => !paidAccts.some((a) => l.includes(a))).map(strip));
    db.close();
  });
});

describe('N4 — route (real JWTs)', () => {
  let api;
  beforeAll(() => {
    api = startJwtApi({ '/api/sales': '../../routes/sales' }, {
      users: [{ username: 'hr1', role: 'hr' }, { username: 'fin1', role: 'finance' }],
    });
    S.silently(() => cast(api.db));
  });
  afterAll(() => api.close());

  const q = `month=${M}&year=${Y}&company=${encodeURIComponent(CO)}`;
  const stampOf = (code) => api.db.prepare('SELECT neft_exported_at FROM sales_salary_computations WHERE employee_code = ? AND month = ? AND year = ?').get(code, M, Y).neft_exported_at;

  test('preview JSON carries the new totals; nothing stamped', async () => {
    const r = await api.request('GET', `/api/sales/export/bank-neft?${q}`, { as: 'hr1' });
    expect(r.status).toBe(200);
    expect(r.body.data.totals).toMatchObject({ count: 4, excludedPaid: 2, notFinalized: 2, alreadyExported: 1,
      byStatus: { computed: 1, reviewed: 1, finalized: 2 } });
    expect(stampOf('N01')).toBeNull();
  });

  test('download stamps exactly the written rows; paid / hold / missing untouched; one audit row', async () => {
    const audit0 = api.db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c;
    const r = await api.request('GET', `/api/sales/export/bank-neft?${q}&download=true`, { as: 'hr1' });
    expect(r.status).toBe(200);
    expect(r.text.split('\n').length).toBe(5);
    expect(r.text).not.toContain('9000N05');
    for (const c of ['N01', 'N02', 'N03', 'N04']) expect(stampOf(c)).not.toBeNull();
    expect(stampOf('N05')).toBe(PAID_STAMP);
    expect(stampOf('N06')).toBe(PAID_STAMP);
    for (const c of ['N07', 'N08', 'N09', 'N10', 'N11']) expect(stampOf(c)).toBeNull();
    expect(api.db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c).toBe(audit0 + 1);
    const again = await api.request('GET', `/api/sales/export/bank-neft?${q}`, { as: 'hr1' });
    expect(again.body.data.totals.alreadyExported).toBe(4);   // lost-file re-download still allowed
    expect(again.body.data.totals.count).toBe(4);
  });

  test('finance stays refused (router-level hr/admin gate unchanged)', async () => {
    const r = await api.request('GET', `/api/sales/export/bank-neft?${q}`, { as: 'fin1' });
    expect(r.status).toBe(403);
  });
});

/**
 * Loans PR-10 follow-up — the real accounts layout (synthetic fixture of the same
 * SHAPE; never the real file): a title row; 'Punch No' | 'Name' |
 * 'Pending Loan Amount ' | 'Deduct per month Aug ' | 'Op sep'; no company,
 * loan date, type or agreement; a 'Total' row with no code.
 *  - code column → exact match by code (S… sales master, numeric plant), company from the master;
 *    the name is a cross-check (NAME_CLOSE_SPELLING pre-selectable, NAME_MISMATCH never accepted without a note);
 *  - total rows skipped; last balance column is the default outstanding, re-choosable (uploader / admin);
 *  - EMI 0 → EMI_MISSING: finance must enter it (with a note) before approval.
 */
const XLSX = require('xlsx');
const { F, L, ADMIN } = require('./helpers/loanFixture');
const P = require('../services/loans/importParse');

const AL = 'Asian Lakto Ind Ltd';
const IND = 'Indriyan Beverages Pvt Ltd';
const HR = { username: 'hr1', role: 'hr' };
const HR2 = { username: 'hr2', role: 'hr' };
const FIN = { username: 'fin1', role: 'finance' };
const NOW = new Date('2026-10-10T06:00:00Z');
const H = ['Punch No', 'Name', 'Pending Loan Amount ', 'Deduct per month Aug ', 'Op sep'];
let db;

const book = (rows, head = H) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Loan Register'], [], head, ...rows]), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};
const FILE_ROWS = [
  ['S901', 'Amit Bansal', 60000, 15000, 45000],      // sales, same name
  ['S902', 'Rohan Mehta', 80000, 10000, 70000],      // sales, master says ROHAN KUMAR → NAME_MISMATCH
  ['S903', 'Kiram Arora', 20000, 4000, 16000],      // sales, typo of KIRAN ARORA → close spelling
  [91001, 'Kamal Jeet', 20000, 5000, 15000],         // plant, same name
  [91002, 'Shubham', 40000, 0, 40000],               // plant, EMI 0 → EMI_MISSING
  [91003, 'Gone Person', 9000, 3000, 6000],          // plant, Left → Left section
  [99999, 'Not There', 5000, 1000, 4000],            // unknown code → unmatched
  [null, null, null, null, null],
  [null, 'Total', 234000, 38000, 196000],
];
const upload = (rows = FILE_ROWS, actor = HR, extra = {}) => L.createBatch(db, { fileName: 'LOAN.xlsx', buffer: book(rows), ...extra }, actor);
const detail = (id, o = {}) => L.batchDetail(db, id, { now: NOW, ...o });
const byCode = (d, code) => d.rows.find((r) => r.code === code);

beforeEach(() => {
  db = F.newDb();
  const sales = db.prepare("INSERT INTO sales_employees (code, name, company, status, doj, gross_salary) VALUES (?, ?, ?, 'Active', ?, 60000)");
  sales.run('S901', 'AMIT BANSAL', IND, '2024-01-01');
  sales.run('S902', 'ROHAN KUMAR', IND, null);
  sales.run('S903', 'KIRAN ARORA', IND, '2026-04-01');
  F.addEmployee(db, { code: '91001', name: 'KAMAL JEET', company: AL });
  F.addEmployee(db, { code: '91002', name: 'SHUBHAM', company: AL });
  F.addEmployee(db, { code: '91003', name: 'GONE PERSON', company: AL, status: 'Left' });
  db.prepare("UPDATE employees SET date_of_joining = NULL WHERE code = '91002'").run();
});

describe('parsing the accounts layout', () => {
  test('auto-mapping: code, name, the LAST balance column as outstanding, the deduction as EMI; no company needed; Total skipped', () => {
    const p = P.parseWorkbook(book(FILE_ROWS), { loanTypes: ['Personal'], today: '2026-10-10' });
    expect(p.ok).toBe(true);
    expect(p.mapping).toEqual({ code: 0, name: 1, outstanding: 4, emi: 3 });
    expect(p.balanceColumns).toEqual([2, 4]);
    expect(p.rows).toHaveLength(7);
    expect(p.skipped).toEqual([{ rowNo: 12, reason: 'total row' }]);
    expect(p.rows[0]).toMatchObject({ code: 'S901', company: null, outstandingPaise: 4500000, emiPaise: 1500000, errors: [] });
    expect(p.rows[3].code).toBe('91001');
    expect(p.rows[4].errors.map((e) => e.code)).toEqual(['EMI_MISSING']);
    expect(p.rows[4].amountFixable).toBe(true);
  });
  test('a total row is skipped wherever the label sits; a row with a code is never a total', () => {
    const p = P.parseWorkbook(book([['S901', 'Amit', 1, 1, 1], ['Total', null, 9, 9, 9], [null, 'Subtotal', 1, 1, 1], ['S902', 'Total Singh', 1, 1, 1]]), { loanTypes: ['Personal'] });
    expect(p.rows.map((r) => r.code)).toEqual(['S901', 'S902']);
  });
  test('the user can pick the other balance column', () => {
    const p = P.parseWorkbook(book(FILE_ROWS), { loanTypes: ['Personal'], mapping: { code: 0, name: 1, outstanding: 2, emi: 3 } });
    expect(p.rows[0].outstandingPaise).toBe(6000000);
  });
});

describe('matching by code', () => {
  test('tiers, company from the master, name cross-check flags', () => {
    const r = upload();
    expect(r.ok).toBe(true);
    expect(r.counts).toMatchObject({ rows: 7, code: 3, code_close: 1, code_mismatch: 1, inactive: 1, none: 1 });
    const d = detail(r.batchId);
    expect(byCode(d, 'S901')).toMatchObject({ match_tier: 'code', borrower_type: 'sales', employee_code: 'S901', company: IND, state: 'needs_match' });
    expect(byCode(d, 'S903')).toMatchObject({ match_tier: 'code_close', employee_code: 'S903', company: IND });
    expect(byCode(d, 'S903').warnings.map((w) => w.code)).toContain('NAME_CLOSE_SPELLING');
    expect(byCode(d, 'S902')).toMatchObject({ match_tier: 'code_mismatch', employee_code: null, company: IND, state: 'needs_match' });
    expect(byCode(d, 'S902').warnings.map((w) => w.code)).toContain('NAME_MISMATCH');
    expect(byCode(d, '91001')).toMatchObject({ match_tier: 'code', borrower_type: 'plant', company: AL });
    expect(byCode(d, '91003')).toMatchObject({ match_tier: 'inactive', outReason: 'left', state: 'out' });
    expect(byCode(d, '99999')).toMatchObject({ match_tier: 'none', outReason: 'unmatched' });
    expect(d.sections.left).toHaveLength(1);
  });
  test('a NAME_MISMATCH is never accepted without a note; the confirmed row keeps the flag', () => {
    const { batchId } = upload();
    const row = byCode(detail(batchId), 'S902');
    const go = (note) => L.confirmMatch(db, { batchId, rowId: row.id, borrowerType: 'sales', employeeCode: 'S902', note }, HR);
    expect(go().code).toBe('NOTE_REQUIRED');
    expect(go('accounts: same person, surname changed').ok).toBe(true);
    expect(byCode(detail(batchId), 'S902').warnings.map((w) => w.code)).toContain('NAME_MISMATCH');
  });
  test('a close-spelling code match confirms without a note', () => {
    const { batchId } = upload();
    const row = byCode(detail(batchId), 'S903');
    expect(L.confirmMatch(db, { batchId, rowId: row.id, borrowerType: 'sales', employeeCode: 'S903' }, HR).ok).toBe(true);
  });
  test('plant master without a company: invalid unless a default company is chosen', () => {
    db.prepare("UPDATE employees SET company = 'Default' WHERE code = '91001'").run();
    const a = upload([[91001, 'Kamal Jeet', 2000, 500, 1500]]);
    expect(byCode(detail(a.batchId), '91001')).toMatchObject({ parse_status: 'invalid', state: 'out' });
    const b = upload([[91001, 'Kamal Jeet', 2000, 500, 1500], [91002, 'Shubham', 1, 1, 1]], HR, { defaultCompany: AL });
    expect(byCode(detail(b.batchId), '91001')).toMatchObject({ company: AL, match_tier: 'code', state: 'needs_match' });
  });
  test('a sales code present in two companies with no company column → shared, not pre-selected', () => {
    db.prepare("INSERT INTO sales_employees (code, name, company, status, doj, gross_salary) VALUES ('S901', 'OTHER MAN', ?, 'Active', '2024-01-01', 20000)").run(AL);
    const { batchId } = upload([['S901', 'Amit Bansal', 6000, 1500, 4500]]);
    expect(detail(batchId).rows[0]).toMatchObject({ match_tier: 'ambiguous', employee_code: null });
  });
  test('a company-restricted uploader cannot import rows whose master company is another', () => {
    const r = L.createBatch(db, { fileName: 'x.xlsx', buffer: book([['S901', 'Amit Bansal', 6000, 1500, 4500]]) }, HR, { companies: [AL] });
    expect(r.code).toBe('COMPANY_NOT_ALLOWED');
  });
});

describe('EMI missing and the balance column choice', () => {
  function decideAll(batchId) {
    for (const r of detail(batchId).rows.filter((x) => x.state === 'needs_match')) {
      const note = r.match_tier === 'code_mismatch' ? 'confirmed with accounts' : undefined;
      const res = L.confirmMatch(db, { batchId, rowId: r.id, borrowerType: r.candidates[0].borrowerType, employeeCode: r.candidates[0].code, note }, HR);
      if (!res.ok) throw new Error(res.message);
    }
  }
  test('EMI 0 blocks approval until finance enters it with a note', () => {
    const { batchId } = upload();
    decideAll(batchId);
    const shubham = byCode(detail(batchId), '91002');
    for (const r of detail(batchId).rows.filter((x) => x.state === 'needs_balance' && x.code !== '91002')) L.confirmBalance(db, { batchId, rowId: r.id }, FIN);
    let a = L.approveBatch(db, { batchId, cutoverMonth: 11, cutoverYear: 2026 }, ADMIN, { now: NOW });
    expect(a).toMatchObject({ code: 'ROWS_NOT_DECIDED', blockers: [expect.objectContaining({ code: 'NEEDS_FINANCE_BALANCE' })] });
    expect(L.confirmBalance(db, { batchId, rowId: shubham.id }, FIN).code).toBe('EMI_MISSING');
    expect(L.confirmBalance(db, { batchId, rowId: shubham.id, emi: 5000 }, FIN).code).toBe('NOTE_REQUIRED');
    expect(L.confirmBalance(db, { batchId, rowId: shubham.id, emi: 5000, note: 'EMI agreed ₹5,000 from Nov' }, FIN).ok).toBe(true);
    a = L.approveBatch(db, { batchId, cutoverMonth: 11, cutoverYear: 2026 }, ADMIN, { now: NOW });
    expect(a.ok).toBe(true);
    const by = Object.fromEntries(a.loans.map((l) => [l.employeeCode, l]));
    expect(by.S901).toMatchObject({ company: IND, borrowerType: 'sales', outstanding: 45000, emi: 15000, tenure: 3 });
    expect(by['91002']).toMatchObject({ company: AL, outstanding: 40000, emi: 5000, tenure: 8 });
    expect(by.S902).toBeDefined();
    expect(a.leftOut.map((x) => x.section).sort()).toEqual(['left', 'unmatched']);
    expect(L.reconcileAll(db).ok).toBe(true);
  });
  test('re-choosing the outstanding column re-reads every row and resets finance confirmations (uploader or admin only)', () => {
    const { batchId } = upload();
    const s901 = byCode(detail(batchId), 'S901');
    L.confirmBalance(db, { batchId, rowId: s901.id }, FIN);
    expect(L.remapColumns(db, { batchId, outstanding: 2 }, HR2).code).toBe('NOT_UPLOADER');
    expect(L.remapColumns(db, { batchId, outstanding: 3 }, ADMIN).code).toBe('MAPPING_INVALID');   // same as the EMI column
    const r = L.remapColumns(db, { batchId, outstanding: 2 }, ADMIN);
    expect(r).toMatchObject({ ok: true, outstandingColumn: 'Pending Loan Amount', emiColumn: 'Deduct per month Aug', rowsChanged: 6, confirmationsReset: 1 });
    const d = detail(batchId);
    expect(byCode(d, 'S901')).toMatchObject({ outstanding: 60000, balance_status: 'pending', confirmed_outstanding: null });
    expect(byCode(d, '91002').parse_errors.map((e) => e.code)).toEqual(['EMI_MISSING']);
    expect(d.batch.column_map.mapping).toMatchObject({ outstanding: 2, emi: 3 });
    expect(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action_type = 'loan_import_columns_changed'").get().n).toBe(1);
    expect(L.remapColumns(db, { batchId, outstanding: 4 }, HR).ok).toBe(true);    // the uploader may switch back
  });
});

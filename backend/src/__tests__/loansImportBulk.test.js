/**
 * Loans import — one-click bulk confirmation of CLEAN rows (importer.js
 * confirmCleanMatches / confirmFileBalances; routes/loanImport.js
 * POST /batches/:id/confirm-clean-matches (hr) and /confirm-file-balances (finance)).
 *
 * The maker-checker is unchanged: HR still confirms matches, finance balances,
 * the admin approves. Every row gets the same row update + audit row as the
 * single-row path; flagged rows are skipped and untouched; all-or-nothing.
 * Synthetic fixture only.
 */
const XLSX = require('xlsx');
const { F, L, ADMIN, VIEWER } = require('./helpers/loanFixture');
const { startJwtApi } = require('./helpers/jwtApiHarness');

const AL = 'Asian Lakto Ind Ltd';
const IND = 'Indriyan Beverages Pvt Ltd';
const HR = { username: 'hr1', role: 'hr' };
const FIN = { username: 'fin1', role: 'finance' };
const NOW = new Date('2026-10-10T06:00:00Z');
const NOV = { cutoverMonth: 11, cutoverYear: 2026 };
const CODE_HEAD = ['Punch No', 'Name', 'Outstanding', 'EMI'];

const book = (rows, head = CODE_HEAD) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...rows]), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

/** A plant employee with 3 computed salary months (so no NO_SALARY_HISTORY flag). */
function plantWithHistory(db, code, name, over = {}) {
  F.addEmployee(db, { code, name, company: AL, date_of_joining: '2024-01-01', ...over });
  for (const m of [7, 8, 9]) {
    db.prepare('INSERT INTO salary_computations (employee_code, month, year, company, gross_earned, total_deductions, net_salary) VALUES (?, ?, 2026, ?, 20000, 0, 20000)').run(code, m, AL);
  }
}
function salesWithHistory(db, code, name) {
  db.prepare("INSERT INTO sales_employees (code, name, company, status, doj, gross_salary) VALUES (?, ?, ?, 'Active', '2024-01-01', 30000)").run(code, name, IND);
  for (const m of [7, 8, 9]) {
    db.prepare('INSERT INTO sales_salary_computations (employee_code, month, year, company, days_given, total_days, calendar_days, earned_ratio, gross_earned, total_deductions, net_salary) VALUES (?, ?, 2026, ?, 30, 30, 30, 1, 30000, 0, 30000)').run(code, m, IND);
  }
}

/**
 * Rows (row_no = sheet row):
 *  2 P101 clean code match                     → bulk match + bulk balance
 *  3 P102 close spelling                       → match skipped; balance bulk after HR confirms
 *  4 P103 NAME DIFFERS                         → match skipped
 *  5 P104 EMI 0 (EMI_MISSING)                  → match + balance skipped
 *  6 P105 Left in master                       → out (untouched)
 *  7 P106 EMI above the 30% ceiling            → match + balance skipped (flagged)
 *  8 S901 clean sales code match               → bulk match + bulk balance
 */
function seed(db) {
  plantWithHistory(db, 'P101', 'RAVI KUMAR');
  plantWithHistory(db, 'P102', 'MANPREET SINGH');
  plantWithHistory(db, 'P103', 'GURDEEP KAUR');
  plantWithHistory(db, 'P104', 'SUNIL VERMA');
  plantWithHistory(db, 'P105', 'LAL CHAND', { status: 'Left' });
  plantWithHistory(db, 'P106', 'ANIL SHARMA');
  salesWithHistory(db, 'S901', 'DEEPAK ARORA');
}
const FILE_ROWS = [
  ['P101', 'Ravi Kumar', 12000, 2000],
  ['P102', 'Manpret Singh', 6000, 1500],
  ['P103', 'Harjit Bains', 9000, 1500],
  ['P104', 'Sunil Verma', 8000, 0],
  ['P105', 'Lal Chand', 5000, 1000],
  ['P106', 'Anil Sharma', 14000, 7000],
  ['S901', 'Deepak Arora', 20000, 5000],
];

const auditCount = (db, action) => db.prepare('SELECT COUNT(*) n FROM audit_log WHERE action_type = ?').get(action).n;
const rowsOf = (db, id) => db.prepare('SELECT * FROM loan_import_rows WHERE batch_id = ? ORDER BY row_no').all(id);
const byNo = (db, id, n) => rowsOf(db, id).find((r) => r.row_no === n);
/** Comparable view of a row's confirmation fields (timestamps dropped). */
const conf = (r) => ({ match_status: r.match_status, borrower_type: r.borrower_type, employee_code: r.employee_code, match_confirmed_by: r.match_confirmed_by, match_note: r.match_note,
  balance_status: r.balance_status, confirmed_outstanding: r.confirmed_outstanding, confirmed_emi: r.confirmed_emi, balance_confirmed_by: r.balance_confirmed_by, balance_note: r.balance_note });
const auditOf = (db, action) => db.prepare('SELECT table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type FROM audit_log WHERE action_type = ? ORDER BY record_id').all(action);

describe('engine', () => {
  let db;
  let batchId;
  beforeEach(() => {
    db = F.newDb();
    seed(db);
    const r = L.createBatch(db, { fileName: 'accounts.xlsx', buffer: book(FILE_ROWS) }, HR);
    expect(r.ok).toBe(true);
    batchId = r.batchId;
  });

  test('batchDetail bulk counts equal what each action then confirms', () => {
    const d = L.batchDetail(db, batchId, { now: NOW });
    expect(d.bulk).toEqual({ cleanMatches: 2, fileBalances: 0 });
    const m = L.confirmCleanMatches(db, { batchId }, HR);
    expect(m).toMatchObject({ ok: true, confirmed: 2, rows: [2, 8] });
    const d2 = L.batchDetail(db, batchId, { now: NOW });
    expect(d2.bulk).toEqual({ cleanMatches: 0, fileBalances: 2 });
    const b = L.confirmFileBalances(db, { batchId }, FIN);
    expect(b).toMatchObject({ ok: true, confirmed: 2, rows: [2, 8] });
    expect(L.batchDetail(db, batchId, { now: NOW }).bulk).toEqual({ cleanMatches: 0, fileBalances: 0 });
  });

  test('flagged rows are skipped with the reason and left untouched', () => {
    const before = Object.fromEntries(rowsOf(db, batchId).map((r) => [r.row_no, conf(r)]));
    const m = L.confirmCleanMatches(db, { batchId }, HR);
    const skipped = Object.fromEntries(m.skipped.map((s) => [s.rowNo, s]));
    expect(Object.keys(skipped).map(Number).sort()).toEqual([3, 4, 5, 7]);
    expect(skipped[3].reason).toMatch(/code_close/);
    expect(skipped[4].reason).toMatch(/code_mismatch/);
    expect(skipped[5].reason).toMatch(/amount problem/);
    expect(skipped[7].flags).toContain('EMI_OVER_CEILING');
    for (const n of [3, 4, 5, 6, 7]) expect(conf(byNo(db, batchId, n))).toEqual(before[n]);
    expect(byNo(db, batchId, 6).match_tier).toBe('inactive'); // Left → out, never confirmed
    // AGREEMENT_MISSING / LOAN_TYPE_DEFAULTED (every row of a file like the accounts one) do not block.
    expect(conf(byNo(db, batchId, 2))).toMatchObject({ match_status: 'confirmed', employee_code: 'P101', match_confirmed_by: 'hr1' });
  });

  test('balances: only needs_balance rows with clean file values; EMI 0 and the ceiling row skipped', () => {
    L.confirmCleanMatches(db, { batchId }, HR);
    // HR confirms the close-spelling row and the EMI-0 row one by one.
    for (const n of [3, 5]) {
      const r = byNo(db, batchId, n);
      expect(L.confirmMatch(db, { batchId, rowId: r.id, borrowerType: 'plant', employeeCode: r.employee_code }, HR).ok).toBe(true);
    }
    const b = L.confirmFileBalances(db, { batchId }, FIN);
    expect(b.rows).toEqual([2, 3, 8]); // close spelling is HR's decision, not a balance matter
    const s5 = b.skipped.find((s) => s.rowNo === 5);
    expect(s5.flags).toContain('EMI_MISSING');
    expect(byNo(db, batchId, 5).balance_status).not.toBe('confirmed');
    expect(byNo(db, batchId, 2)).toMatchObject({ balance_status: 'confirmed', confirmed_outstanding: 12000, confirmed_emi: 2000, balance_confirmed_by: 'fin1', balance_note: null });
  });

  test('per-row result and audit are identical to the single-row path', () => {
    // Twin DB: the same batch confirmed one by one.
    const db2 = F.newDb();
    seed(db2);
    const id2 = L.createBatch(db2, { fileName: 'accounts.xlsx', buffer: book(FILE_ROWS) }, HR).batchId;
    for (const n of [2, 8]) {
      const r = byNo(db2, id2, n);
      expect(L.confirmMatch(db2, { batchId: id2, rowId: r.id, borrowerType: r.borrower_type, employeeCode: r.employee_code, company: r.company }, HR).ok).toBe(true);
    }
    for (const n of [2, 8]) expect(L.confirmBalance(db2, { batchId: id2, rowId: byNo(db2, id2, n).id }, FIN).ok).toBe(true);

    L.confirmCleanMatches(db, { batchId }, HR);
    L.confirmFileBalances(db, { batchId }, FIN);
    expect(rowsOf(db, batchId).map(conf)).toEqual(rowsOf(db2, id2).map(conf));
    for (const a of ['loan_import_match_confirmed', 'loan_import_balance_confirmed']) {
      expect(auditOf(db, a)).toEqual(auditOf(db2, a));
      expect(auditOf(db, a)).toHaveLength(2);
    }
    // Plus one summary row per bulk action.
    expect(auditCount(db, 'loan_import_bulk_match_confirmed')).toBe(1);
    expect(auditCount(db, 'loan_import_bulk_balance_confirmed')).toBe(1);
  });

  test('all-or-nothing: an error on the second row confirms nothing (no row, no audit)', () => {
    const r8 = byNo(db, batchId, 8);
    db.exec(`CREATE TRIGGER boom BEFORE UPDATE OF match_status ON loan_import_rows WHEN NEW.id = ${r8.id} BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    expect(() => L.confirmCleanMatches(db, { batchId }, HR)).toThrow(/boom/);
    expect(rowsOf(db, batchId).filter((r) => r.match_status === 'confirmed')).toHaveLength(0);
    expect(auditCount(db, 'loan_import_match_confirmed')).toBe(0);
    expect(auditCount(db, 'loan_import_bulk_match_confirmed')).toBe(0);
  });

  test('all-or-nothing: a refusal on a later row rolls back the earlier ones', () => {
    const r8 = byNo(db, batchId, 8);
    db.exec(`CREATE TRIGGER quiet BEFORE UPDATE OF match_status ON loan_import_rows WHEN NEW.id = ${r8.id} BEGIN SELECT RAISE(IGNORE); END`);
    const res = L.confirmCleanMatches(db, { batchId }, HR);
    expect(res).toMatchObject({ ok: false, code: 'BULK_CONFIRM_FAILED', rowNo: 8, cause: 'CONCURRENT_CHANGE' });
    expect(byNo(db, batchId, 2).match_status).toBe('pending');
    expect(auditCount(db, 'loan_import_match_confirmed')).toBe(0);
  });

  test('a second click finds nothing: confirmed 0, no extra audit row', () => {
    expect(L.confirmCleanMatches(db, { batchId }, HR).confirmed).toBe(2);
    const again = L.confirmCleanMatches(db, { batchId }, HR);
    expect(again).toMatchObject({ ok: true, confirmed: 0, rows: [] });
    expect(auditCount(db, 'loan_import_match_confirmed')).toBe(2);
    expect(auditCount(db, 'loan_import_bulk_match_confirmed')).toBe(1);
  });

  test('roles unchanged: finance/admin/viewer cannot bulk-match; hr/admin cannot bulk-balance', () => {
    for (const a of [FIN, ADMIN, VIEWER]) expect(L.confirmCleanMatches(db, { batchId }, a)).toMatchObject({ ok: false, code: 'ROLE_NOT_ALLOWED' });
    for (const a of [HR, ADMIN, VIEWER]) expect(L.confirmFileBalances(db, { batchId }, a)).toMatchObject({ ok: false, code: 'ROLE_NOT_ALLOWED' });
    expect(rowsOf(db, batchId).filter((r) => r.match_status === 'confirmed')).toHaveLength(0);
  });

  test('a batch not in review is refused; a company-restricted user is refused like batchDetail', () => {
    expect(L.confirmCleanMatches(db, { batchId }, HR, { companies: [IND] }).code).toBe('COMPANY_NOT_ALLOWED');
    expect(L.discardBatch(db, { batchId, reason: 'wrong file' }, HR).ok).toBe(true);
    expect(L.confirmCleanMatches(db, { batchId }, HR).code).toBe('BATCH_NOT_IN_REVIEW');
    expect(L.confirmFileBalances(db, { batchId }, FIN).code).toBe('BATCH_NOT_IN_REVIEW');
    expect(L.batchDetail(db, batchId, { now: NOW }).bulk).toEqual({ cleanMatches: 0, fileBalances: 0 });
  });

  test('two rows for the same employee are never bulk-confirmed', () => {
    const db2 = F.newDb();
    seed(db2);
    const id2 = L.createBatch(db2, { fileName: 'twins.xlsx', buffer: book([['P101', 'Ravi Kumar', 12000, 2000], ['P101', 'Ravi Kumar', 4000, 1000]]) }, HR).batchId;
    const r = L.confirmCleanMatches(db2, { batchId: id2 }, HR);
    expect(r.confirmed).toBe(0);
    expect(r.skipped.every((s) => s.flags.includes('SECOND_LOAN_IN_BATCH'))).toBe(true);
  });

  test('a name file: an exact unique name is clean; a shared name is not', () => {
    const db2 = F.newDb();
    plantWithHistory(db2, 'N1', 'KARAN MEHTA');
    plantWithHistory(db2, 'N2', 'POOJA RANI');
    plantWithHistory(db2, 'N3', 'POOJA RANI', { department: 'STORES' });
    const id2 = L.createBatch(db2, { fileName: 'names.xlsx', buffer: book([['Karan Mehta', 'Asian Lakto', 3000, 1000], ['Pooja Rani', 'Asian Lakto', 3000, 1000]], ['Name', 'Company', 'Outstanding', 'EMI']) }, HR).batchId;
    const r = L.confirmCleanMatches(db2, { batchId: id2 }, HR);
    expect(r.rows).toEqual([2]);
    expect(r.skipped).toEqual([expect.objectContaining({ rowNo: 3, reason: expect.stringMatching(/ambiguous/) })]);
  });

  test('after bulk HR + bulk finance the admin approves and the loans are created; SELF_APPROVAL unchanged', () => {
    // Make every remaining row decided: exclude the flagged ones.
    L.confirmCleanMatches(db, { batchId }, HR);
    for (const n of [3, 4, 5, 7]) expect(L.excludeRow(db, { batchId, rowId: byNo(db, batchId, n).id, reason: 'one by one later' }, HR).ok).toBe(true);
    L.confirmFileBalances(db, { batchId }, FIN);
    const d = L.batchDetail(db, batchId, { now: NOW });
    expect(d.approval.canApprove).toBe(true);
    // An admin who confirmed rows is refused exactly as before (here: an admin named like the HR maker).
    const r0 = L.approveBatch(db, { batchId, ...NOV }, { username: 'hr1', role: 'admin' }, { now: NOW });
    expect(r0).toMatchObject({ ok: false, code: 'SELF_APPROVAL' });
    const r = L.approveBatch(db, { batchId, plant: { month: 11, year: 2026 }, sales: { month: 11, year: 2026 }, ...NOV, note: 'go' }, ADMIN, { now: NOW });
    expect(r.ok).toBe(true);
    expect(r.loans).toHaveLength(2);
    expect(db.prepare("SELECT COUNT(*) n FROM loans WHERE status = 'active'").get().n).toBe(2);
  });
});

describe('routes (real requireAuth + JWT)', () => {
  let api;
  let db;
  let batchId;
  const USERS = [{ username: 'hr1', role: 'hr' }, { username: 'fin1', role: 'finance' }, { username: 'boss', role: 'admin' }, { username: 'view1', role: 'viewer' }];
  beforeAll(() => {
    api = startJwtApi({ '/api/loans/import': '../../routes/loanImport' }, { users: USERS });
    db = api.db;
    seed(db);
    batchId = L.createBatch(db, { fileName: 'accounts.xlsx', buffer: book(FILE_ROWS) }, HR).batchId;
  });
  afterAll(() => api.close());
  const post = (path, as) => api.request('POST', `/api/loans/import/batches/${batchId}/${path}`, { as, body: {} });

  test('confirm-clean-matches: hr only (finance/admin/viewer 403, no token 401)', async () => {
    for (const as of ['fin1', 'boss', 'view1']) expect((await post('confirm-clean-matches', as)).status).toBe(403);
    expect((await api.request('POST', `/api/loans/import/batches/${batchId}/confirm-clean-matches`, { body: {} })).status).toBe(401);
    const d = (await api.request('GET', `/api/loans/import/batches/${batchId}`, { as: 'view1' })).body.data;
    expect(d.bulk.cleanMatches).toBe(2);
    const r = await post('confirm-clean-matches', 'hr1');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ confirmed: 2, rows: [2, 8] });
    expect(r.body.data.skipped.map((s) => s.rowNo)).toEqual([3, 4, 5, 7]);
  });

  test('confirm-file-balances: finance only', async () => {
    for (const as of ['hr1', 'boss', 'view1']) expect((await post('confirm-file-balances', as)).status).toBe(403);
    const r = await post('confirm-file-balances', 'fin1');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ confirmed: 2, rows: [2, 8] });
  });

  test('unknown batch 404; discarded batch 409', async () => {
    expect((await api.request('POST', '/api/loans/import/batches/999/confirm-clean-matches', { as: 'hr1', body: {} })).status).toBe(404);
    expect(L.discardBatch(db, { batchId, reason: 'test over' }, HR).ok).toBe(true);
    expect((await post('confirm-clean-matches', 'hr1')).status).toBe(409);
  });
});

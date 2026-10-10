/**
 * Loans PR-10 follow-up #2 — one import batch, a cutover month PER PAYROLL.
 *
 * Owner facts (10 Oct 2026): plant September salaries are not paid yet → plant
 * cutover = September 2026; the sales September NEFT went out on 7 Oct with no
 * loan deduction → sales cutover = October 2026 (the cycle 26 Sep – 25 Oct,
 * PR-8). One file carries both, and a second upload of the same file is
 * blocked by the hash guard, so the admin names both months on one approval.
 *
 * Real schema, real engine, real plant Stage 7 (recomputeSalary), real sales
 * compute steps (salesLoanFixture.computeSalesMonth), real loan closes.
 */
const XLSX = require('xlsx');
const LF = require('./helpers/loanFixture');
const S = require('./helpers/salesLoanFixture');
const { recomputeSalary } = require('../services/recompute');
const C = require('../services/loans/close');

const { F, L, COMPANY, ADMIN } = LF;
const IND = S.IND;
const HR = { username: 'hr1', role: 'hr' };
const FIN = { username: 'fin1', role: 'finance' };
const NOW = new Date('2026-10-10T06:00:00Z');
const SEP = { month: 9, year: 2026 };
const OCT = { month: 10, year: 2026 };
const ist = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 1, 0, 0));
const H = ['Name', 'Company', 'Department', 'Loan date', 'Original principal', 'Outstanding', 'EMI', 'Loan type', 'Agreement ref', 'Notes'];

const book = (rows) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, ...rows]), 'Loans');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};
const stage7 = (db, month, year, requestId) => F.silently(() => recomputeSalary(db, { month, year, company: COMPANY, requestId }));
const close = (db, payroll, month, year, now) => F.silently(() => C.runLoanClose(db, { payroll, month, year, now }));
const instalments = (db, loanId) => db.prepare('SELECT due_month, due_year, amount_due FROM loan_instalments WHERE loan_id = ? ORDER BY sequence').all(loanId)
  .map((i) => [i.due_year, i.due_month, i.amount_due]);
function worked(db, emp, month, year) {
  F.addDayCalc(db, emp, month, year, { days_present: 26, total_payable_days: 26 });
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const ins = db.prepare("INSERT OR IGNORE INTO attendance_processed (employee_code, date, status_original, status_final, company, month, year) VALUES (?, ?, 'P', 'P', ?, ?, ?)");
  for (let d = last - 7; d <= last; d++) ins.run(emp.code, `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`, COMPANY, month, year);
}

/** A plant borrower + a sales borrower, both confirmed by HR and finance. */
function readyBatch(db) {
  const emp = LF.plant(db, { name: 'PLANT ONE' });
  S.addRep(db, { code: 'SC1', name: 'SALES ONE', gross: 30000 });
  const up = L.createBatch(db, { fileName: 'loans.xlsx', buffer: book([
    ['Plant One', 'Indriyan', '', '', '', 6000, 2000, 'Personal', 'AG-P', ''],
    ['Sales One', 'Indriyan', '', '', '', 9000, 3000, 'Personal', 'AG-S', ''],
  ]) }, HR);
  if (!up.ok) throw new Error(`${up.code} ${up.message}`);
  for (const r of L.batchDetail(db, up.batchId, { now: NOW }).rows) {
    const pick = r.candidates[0];
    const m = L.confirmMatch(db, { batchId: up.batchId, rowId: r.id, borrowerType: pick.borrowerType, employeeCode: pick.code }, HR);
    if (!m.ok) throw new Error(`${m.code} ${m.message}`);
    const b = L.confirmBalance(db, { batchId: up.batchId, rowId: r.id }, FIN);
    if (!b.ok) throw new Error(`${b.code} ${b.message}`);
  }
  return { batchId: up.batchId, emp };
}
const approve = (db, batchId, cutover, extra = {}) => L.approveBatch(db, { batchId, cutover, note: 'go', ...extra }, ADMIN, { now: NOW });

describe('validation: each payroll on its own', () => {
  test('defaults per payroll, a month per payroll required, each checked against its own payroll', () => {
    const db = F.newDb();
    const { batchId } = readyBatch(db);
    const d = L.batchDetail(db, batchId, { now: NOW });
    expect(d.approval.payrolls.sort()).toEqual(['plant', 'sales']);
    expect(d.approval.earliestCutover).toEqual({ plant: SEP, sales: SEP });
    expect(d.approval.byPayroll).toEqual({ plant: { loans: 1, outstanding: 6000, monthlyEmi: 2000 }, sales: { loans: 1, outstanding: 9000, monthlyEmi: 3000 } });

    expect(approve(db, batchId, { plant: SEP })).toMatchObject({ code: 'MONTH_INVALID', payroll: 'sales' });
    expect(approve(db, batchId, { plant: { month: 8, year: 2026 }, sales: OCT })).toMatchObject({ code: 'CUTOVER_TOO_EARLY', payroll: 'plant', earliest: SEP });
    expect(approve(db, batchId, { plant: SEP, sales: { month: 8, year: 2026 } })).toMatchObject({ code: 'CUTOVER_TOO_EARLY', payroll: 'sales', earliest: SEP });

    // a sales close of September moves only the sales floor
    db.prepare("INSERT INTO loan_closes (month, year, payroll, run_by) VALUES (9, 2026, 'sales', 'system')").run();
    expect(L.batchDetail(db, batchId, { now: NOW }).approval.earliestCutover).toEqual({ plant: SEP, sales: OCT });
    expect(approve(db, batchId, { plant: SEP, sales: SEP })).toMatchObject({ code: 'CUTOVER_TOO_EARLY', payroll: 'sales', earliest: OCT });
    expect(db.prepare('SELECT COUNT(*) AS n FROM loans').get().n).toBe(0);
    expect(approve(db, batchId, { plant: SEP, sales: OCT }).ok).toBe(true);
    db.close();
  });

  test('a plant-only batch needs only the plant month; the sales month stays empty', () => {
    const db = F.newDb();
    LF.plant(db, { name: 'PLANT ONE' });
    const up = L.createBatch(db, { fileName: 'p.xlsx', buffer: book([['Plant One', 'Indriyan', '', '', '', 6000, 2000, '', '', '']]) }, HR);
    const r = L.batchDetail(db, up.batchId, { now: NOW }).rows[0];
    L.confirmMatch(db, { batchId: up.batchId, rowId: r.id, borrowerType: 'plant', employeeCode: r.candidates[0].code }, HR);
    L.confirmBalance(db, { batchId: up.batchId, rowId: r.id }, FIN);
    const a = approve(db, up.batchId, { plant: SEP });
    expect(a).toMatchObject({ ok: true, cutover: { plant: SEP, sales: null } });
    expect(db.prepare('SELECT plant_cutover_month, plant_cutover_year, sales_cutover_month FROM loan_import_batches').get())
      .toEqual({ plant_cutover_month: 9, plant_cutover_year: 2026, sales_cutover_month: null });
    expect(L.listBatches(db).batches[0].cutover).toEqual({ plant: SEP, sales: null });
    db.close();
  });

  test('a single cutoverMonth/Year still applies to both payrolls', () => {
    const db = F.newDb();
    const { batchId } = readyBatch(db);
    const a = L.approveBatch(db, { batchId, cutoverMonth: 10, cutoverYear: 2026 }, ADMIN, { now: NOW });
    expect(a).toMatchObject({ ok: true, cutover: { plant: OCT, sales: OCT } });
    db.close();
  });
});

describe('plant September + sales October in one batch, through Stage 7 and the close', () => {
  test('first deductions land in each payroll\'s own month and reconcile exactly', () => {
    const db = F.newDb();
    const { batchId, emp } = readyBatch(db);
    const a = approve(db, batchId, { plant: SEP, sales: OCT });
    expect(a.ok).toBe(true);
    expect(a.cutover).toEqual({ plant: SEP, sales: OCT });
    const [p, s] = a.loans;
    expect(p).toMatchObject({ borrowerType: 'plant', cutover: SEP, firstEmi: SEP, tenure: 3 });
    expect(s).toMatchObject({ borrowerType: 'sales', cutover: OCT, firstEmi: OCT, tenure: 3 });
    expect(db.prepare('SELECT disbursed_on, first_emi_month FROM loans WHERE id = ?').get(p.loanId)).toEqual({ disbursed_on: '2026-08-31', first_emi_month: 9 });
    expect(db.prepare('SELECT disbursed_on, first_emi_month FROM loans WHERE id = ?').get(s.loanId)).toEqual({ disbursed_on: '2026-09-25', first_emi_month: 10 });
    expect(instalments(db, p.loanId)).toEqual([[2026, 9, 2000], [2026, 10, 2000], [2026, 11, 2000]]);
    expect(instalments(db, s.loanId)).toEqual([[2026, 10, 3000], [2026, 11, 3000], [2026, 12, 3000]]);
    expect(db.prepare("SELECT remark FROM audit_log WHERE action_type = 'loan_import_approve'").get().remark).toMatch(/cutover plant 2026-09 · sales 2026-10/);

    // cutover check before any payroll: the month per row
    let c = L.cutoverCheck(db, batchId);
    expect(c.months).toEqual({ plant: SEP, sales: OCT });
    expect(c.rows.map((r) => [r.payroll, r.month, r.appInstalment, r.flags])).toEqual([
      ['plant', SEP, 2000, ['STAGE7_PENDING']], ['sales', OCT, 3000, ['STAGE7_PENDING']],
    ]);
    const sheet = XLSX.read(L.cutoverCheckXlsx(c), { type: 'buffer' }).Sheets['Cutover check'];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    expect(aoa[0][0]).toMatch(/plant 2026-09 · sales 2026-10/);
    expect(aoa[2][3]).toBe('Month');
    expect(aoa.slice(3, 5).map((r) => [r[2], r[3]])).toEqual([['plant', '2026-09'], ['sales', '2026-10']]);

    // plant September: Stage 7 deducts the first EMI; the 13 Oct close posts it
    worked(db, emp, 9, 2026);
    stage7(db, 9, 2026, 'sep-1');
    expect(db.prepare('SELECT loan_recovery FROM salary_computations WHERE employee_code = ? AND month = 9').get(emp.code).loan_recovery).toBe(2000);
    expect(close(db, 'plant', 9, 2026, ist(2026, 10, 13))).toMatchObject({ ok: true, posted: 1, postedAmount: 2000, reconciliationOk: true });

    // sales September (already paid without a loan): a re-run carries no loan
    S.setUpload(db, { month: 9, year: 2026, rows: [{ code: 'SC1', days: 30 }] });
    S.computeSalesMonth(db, { month: 9, year: 2026 });
    expect(S.salaryRow(db, 'SC1', 9, 2026).loan_recovery).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM loan_deductions WHERE payroll = 'sales' AND month = 9").get().n).toBe(0);

    // October: both payrolls deduct; the 13 Nov closes post both
    worked(db, emp, 10, 2026);
    stage7(db, 10, 2026, 'oct-1');
    S.setUpload(db, { month: 10, year: 2026, rows: [{ code: 'SC1', days: 31 }] });
    S.computeSalesMonth(db, { month: 10, year: 2026 });
    expect(S.salaryRow(db, 'SC1', 10, 2026).loan_recovery).toBe(3000);
    c = L.cutoverCheck(db, batchId);
    expect(c.rows.map((r) => [r.payroll, r.flags, r.deduction])).toEqual([
      ['plant', [], { state: 'posted', amount: 2000 }], ['sales', [], { state: 'provisional', amount: 3000 }],
    ]);
    expect(close(db, 'plant', 10, 2026, ist(2026, 11, 13))).toMatchObject({ ok: true, posted: 1, postedAmount: 2000, reconciliationOk: true });
    expect(close(db, 'sales', 10, 2026, ist(2026, 11, 13))).toMatchObject({ ok: true, posted: 1, postedAmount: 3000, reconciliationOk: true });

    // balances to the paisa, payslip = ledger, no drift
    expect(L.reconcileLoan(db, p.loanId)).toMatchObject({ ok: true, balance: 2000 });
    expect(L.reconcileLoan(db, s.loanId)).toMatchObject({ ok: true, balance: 6000 });
    expect(L.getLoan(db, p.loanId).remaining_balance).toBe(2000);
    expect(L.getLoan(db, s.loanId).remaining_balance).toBe(6000);
    for (const m of [9, 10]) expect(C.checkPayslipLedger(db, { month: m, year: 2026 }).mismatches).toEqual([]);
    expect(C.checkPayslipLedger(db, { payroll: 'sales', month: 10, year: 2026 }).mismatches).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1').get().n).toBe(0);
    expect(db.prepare(S.SALES_DRIFT_SQL).get().n).toBe(0);
    expect(L.loanStatement(db, s.loanId).rows[0]).toMatchObject({ month: '2026-09', disbursed: 9000, closing: 9000 });
    expect(L.loanStatement(db, p.loanId).rows[0]).toMatchObject({ month: '2026-08', disbursed: 6000, closing: 6000 });
    db.close();
  });
});

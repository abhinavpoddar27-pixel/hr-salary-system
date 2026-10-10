/**
 * Loans PR-9 — Finance Audit hooks. Warnings only, never blockers:
 *   readiness-check  LOAN_CLOSE_OVERDUE when a needed loan close for a month up
 *                    to M − 1 is past its close day and has not run
 *   red flags        loan_emi_high_vs_net, loan_posted_unborne, loan_exit_residual
 *                    (plant payroll only, ruling Q2)
 * A database with no loans gets exactly the checks and flags it had before.
 */
const LF = require('./helpers/loanFixture');
const { startJwtApi } = require('./helpers/jwtApiHarness');
const { detectRedFlags } = require('../services/financeRedFlags');

const { F, L, COMPANY, HR, SYS } = LF;
const salRow = (db, code, month, year, loan, net) => db.prepare(`INSERT INTO salary_computations (employee_code, month, year, company, loan_recovery, net_salary, gross_earned, gross_salary, total_deductions)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(code, month, year, COMPANY, loan, net, net + loan, net + loan, loan);
const closeRow = (db, month, year) => db.prepare(`INSERT INTO loan_closes (month, year, payroll, run_by, trigger_kind) VALUES (?, ?, 'plant', 'system', 'test')`).run(month, year);
const loanTypes = (flags) => flags.filter((f) => f.type.startsWith('loan_')).map((f) => [f.type, f.employeeCode]);

describe('red flags', () => {
  test('no loans → no loan flags, and the other flags are untouched', () => {
    const db = F.newDb();
    const e = F.addEmployee(db);
    salRow(db, e.code, 11, 2026, 0, 0);                 // negative_net fires as before
    const flags = detectRedFlags(db, 11, 2026);
    expect(flags.map((f) => f.type)).toEqual(['negative_net']);
  });

  test('EMI above 30 % of net is flagged with the borrower; at 30 % it is not; policy moves the line', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    const other = F.addEmployee(db);
    salRow(db, emp.code, 11, 2026, 3334, 9000);        // 37 %
    salRow(db, other.code, 11, 2026, 3000, 10000);     // 30 % exactly (code-only match: flags read salary rows)
    let flags = detectRedFlags(db, 11, 2026);
    expect(loanTypes(flags)).toEqual([['loan_emi_high_vs_net', emp.code]]);
    expect(flags.find((f) => f.type === 'loan_emi_high_vs_net')).toMatchObject({ severity: 'warning', department: 'PRODUCTION' });
    F.setPolicy(db, 'loan_emi_net_flag_pct', '40');
    flags = detectRedFlags(db, 11, 2026);
    expect(loanTypes(flags)).toEqual([]);
    expect(loanId).toBeGreaterThan(0);
  });

  test('posted-unborne and exit residual flags', () => {
    const db = F.newDb();
    const A = LF.activeLoan(db);
    const ins = LF.instalments(db, A.loanId)[0];
    LF.deductAndPost(db, A.loanId, ins, 3334);
    const d = db.prepare('SELECT id FROM loan_deductions WHERE loan_id = ?').get(A.loanId);
    expect(L.writeAdjustment(db, { deductionId: d.id, kind: 'unborne', amountPaise: 50000, reason: 'Stage 7 re-run' }, SYS).ok).toBe(true);
    const E = LF.activeLoan(db);
    closeRow(db, 11, 2026);
    expect(L.flagForExit(db, E.loanId, HR, { exitDate: '2026-11-20' }).ok).toBe(true);
    const flags = detectRedFlags(db, 11, 2026);
    expect(loanTypes(flags)).toEqual([['loan_posted_unborne', A.emp.code], ['loan_exit_residual', E.emp.code]]);
    expect(flags.find((f) => f.type === 'loan_exit_residual').description).toMatch(/₹6666 left after the final payroll 11\/2026/);
    expect(loanTypes(detectRedFlags(db, 10, 2026))).toEqual([]);
  });
});

describe('readiness-check over HTTP', () => {
  let api; let db;
  beforeAll(() => {
    api = startJwtApi({ '/api/finance-audit': '../../routes/financeAudit' }, { users: [{ username: 'fin1', role: 'finance' }] });
    db = api.db;
  });
  afterAll(() => api.close());
  const check = async (m, y) => (await api.request('GET', `/api/finance-audit/readiness-check?month=${m}&year=${y}`, { as: 'fin1' })).body.data;
  const loanEntries = (d) => [...d.blockers, ...d.warnings, ...d.passed].filter((x) => String(x.type).startsWith('LOAN_'));

  test('no loans → no loan entry anywhere', async () => {
    const d = await check(9, 2026);
    expect(loanEntries(d)).toEqual([]);
  });

  test('a needed close past its day → LOAN_CLOSE_OVERDUE warning (never a blocker); a closed month clears it', async () => {
    const L2 = require('../services/loans');
    const code = 'RD001';
    db.prepare(`INSERT INTO employees (code, name, department, company, employment_type, status, date_of_joining, is_contractor, gross_salary)
                VALUES (?, 'TEST', 'PRODUCTION', ?, 'Permanent', 'Active', '2024-01-01', 0, 30000)`).run(code, COMPANY);
    const asOf = '2026-06-10';
    const r = L2.requestLoan(db, { borrowerType: 'plant', employeeCode: code, company: COMPANY, loanType: 'Personal', principal: 9000, tenure: 3, reason: 't' }, HR, { asOf });
    L2.approveLoan(db, r.loanId, LF.ADMIN, { asOf });
    expect(L2.disburseLoan(db, r.loanId, LF.FIN, { mode: 'NEFT', reference: 'U', disbursedOn: '2026-06-05', agreementFilePath: 'a' }, { asOf }).ok).toBe(true);   // Jul, Aug, Sep
    const d = await check(9, 2026);
    expect(d.blockers.filter((b) => String(b.type).startsWith('LOAN_'))).toEqual([]);
    expect(d.warnings.find((w) => w.type === 'LOAN_CLOSE_OVERDUE')).toMatchObject({ count: 2, severity: 'WARNING', detail: expect.stringContaining('plant 7/2026, plant 8/2026') });
    closeRow(db, 7, 2026); closeRow(db, 8, 2026);
    expect(loanEntries(await check(9, 2026))).toEqual([]);
  });
});

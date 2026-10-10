/**
 * Loans PR-9 — reports, payslip balance line, Finance Audit data (engine level).
 * services/loans/reports.js is read-only; every total must reconcile to the
 * ledger to the paisa.
 */
const LF = require('./helpers/loanFixture');
const S = require('./helpers/salesLoanFixture');
const XLSX = require('xlsx');

const { F, L, COMPANY, OTHER_COMPANY, HR, FIN, ADMIN, SYS } = LF;
const P = (rupees) => Math.round(rupees * 100);
const closeRow = (db, month, year, payroll = 'plant') => db.prepare(`INSERT INTO loan_closes (month, year, payroll, run_by, trigger_kind) VALUES (?, ?, ?, 'system', 'test')`).run(month, year, payroll).lastInsertRowid;
const liveSum = (db) => db.prepare("SELECT COALESCE(SUM(remaining_balance), 0) AS v FROM loans WHERE status IN ('active','recover_at_exit')").get().v;
const firstOpen = (db, loanId) => LF.instalments(db, loanId).find((i) => i.status === 'scheduled');

/**
 * A mixed ledger (disbursed 5 Oct 2026, first EMI Nov 2026 unless stated):
 *   A  plant IND PRODUCTION ₹10,000/3, Nov posted in full           → 6,666
 *   B  plant IND STORES     ₹12,000/4, cash receipt ₹2,000 (8 Oct)  → 10,000
 *   C  plant ALI            ₹6,000/3, Nov posted ₹1,000 of ₹2,000    → shortfall instalment, 5,000
 *   D  plant IND            ₹5,000/2, written off                    → not live
 *   S  sales IND            ₹9,000/3 (first EMI the Nov sales cycle) → 9,000
 *   E  plant IND            ₹6,000/3, Mark Left after the Nov close  → Nov still open, residual 4,000
 *   R  plant IND            requested, then Mark Left                → exit flag only
 */
function scene() {
  const db = F.newDb();
  const A = LF.activeLoan(db, { principal: 10000, tenure: 3 });
  LF.deductAndPost(db, A.loanId, firstOpen(db, A.loanId), 3334);
  const B = LF.activeLoan(db, { emp: LF.plant(db, { department: 'STORES' }), principal: 12000, tenure: 4 });
  expect(L.recordReceipt(db, B.loanId, FIN, { amount: 2000, mode: 'Cash', reference: 'R', receiptDate: '2026-10-08' }, { asOf: '2026-10-09' }).ok).toBe(true);
  const C = LF.activeLoan(db, { company: OTHER_COMPANY, principal: 6000, tenure: 3 });
  const pc = L.recordProvisional(db, { loanId: C.loanId, instalmentId: firstOpen(db, C.loanId).id, payroll: 'plant', month: 11, year: 2026, company: OTHER_COMPANY, amount: 1000 }, SYS);
  expect(L.postDeduction(db, { deductionId: pc.deductionId }, SYS).ok).toBe(true);
  const D = LF.activeLoan(db, { principal: 5000, tenure: 2 });
  expect(L.writeOffLoan(db, { loanId: D.loanId, reason: 'test write-off', requestedBy: HR }, ADMIN).ok).toBe(true);
  S.addRep(db, { code: 'S7001', company: COMPANY, gross: 30000, name: 'REP ONE' });
  const Sid = S.salesLoan(db, { code: 'S7001', principal: 9000, tenure: 3 });
  const E = LF.activeLoan(db, { principal: 6000, tenure: 3 });
  const Remp = LF.plant(db);
  const Rreq = L.requestLoan(db, { borrowerType: 'plant', employeeCode: Remp.code, company: COMPANY, loanType: 'Personal', principal: 3000, tenure: 3, reason: 't' }, HR, { asOf: LF.ASOF });
  expect(Rreq.ok).toBe(true);
  closeRow(db, 11, 2026);
  expect(L.flagForExit(db, E.loanId, HR, { exitDate: '2026-11-20' }).ok).toBe(true);
  expect(L.flagForExit(db, Rreq.loanId, HR, { exitDate: '2026-11-20' }).ok).toBe(true);
  return { db, A: A.loanId, B: B.loanId, C: C.loanId, D: D.loanId, S: Sid, E: E.loanId, R: Rreq.loanId, Aemp: A.emp };
}

describe('outstanding register', () => {
  test('live loans only, grouped by payroll → company → department; totals = the ledger to the paisa', () => {
    const x = scene();
    const r = L.outstandingRegister(x.db);
    expect(r.rows.map((row) => row.loanId).sort((a, b) => a - b)).toEqual([x.A, x.B, x.C, x.S, x.E].sort((a, b) => a - b));
    expect(P(r.totals.balance)).toBe(P(liveSum(x.db)));
    expect(r.totals.balance).toBe(6666 + 10000 + 5000 + 9000 + 6000);
    expect(r.reconcileProblems).toBe(0);
    for (const row of r.rows) {
      expect(row.reconciles).toBe(true);
      expect(P(row.disbursed) - P(row.recovered) - P(row.cash) - P(row.writtenOff)).toBe(P(row.balance));
      expect(P(row.openInstalments) + P(row.uncovered)).toBe(P(row.balance));
    }
    expect(r.groups.map((g) => [g.payroll, g.company, g.department, g.loans, g.balance])).toEqual([
      ['plant', OTHER_COMPANY, 'PRODUCTION', 1, 5000],
      ['plant', COMPANY, 'PRODUCTION', 2, 12666],
      ['plant', COMPANY, 'STORES', 1, 10000],
      ['sales', COMPANY, 'Sales', 1, 9000],
    ]);
    expect(r.byCompany.reduce((s, c) => s + P(c.balance), 0)).toBe(P(r.totals.balance));
    expect(r.rows.find((row) => row.loanId === x.S)).toMatchObject({ payroll: 'sales', employeeName: 'REP ONE', headquarters: 'HQ' });
  });

  test('company restriction keeps that company only', () => {
    const x = scene();
    const r = L.outstandingRegister(x.db, { companies: [OTHER_COMPANY] });
    expect(r.rows.map((row) => row.loanId)).toEqual([x.C]);
    expect(r.totals.balance).toBe(5000);
  });

  test('a ledger with no loans gives empty groups and ₹0', () => {
    const r = L.outstandingRegister(F.newDb());
    expect(r).toMatchObject({ rows: [], groups: [], totals: { loans: 0, balance: 0 } });
  });
});

describe('12-month recovery forecast', () => {
  test('overdue + 12 months + later + unscheduled = outstanding, to the paisa', () => {
    const x = scene();
    const f = L.recoveryForecast(x.db, { from: { month: 12, year: 2026 } });
    expect(f.reconciles).toBe(true);
    expect(P(f.total)).toBe(P(liveSum(x.db)));
    expect(f.months).toHaveLength(12);
    expect(f.months[0]).toMatchObject({ month: 12, year: 2026, label: '2026-12' });
    // B, S and E have their Nov instalment still open (no Stage 7 yet) → overdue from Dec.
    expect(f.overdue.amount).toBe(3000 + 3000 + 2000);
    expect(f.unscheduled.amount).toBe(4000);           // E's exit residual (Dec + Jan cancelled at Mark Left)
    const colTotal = (k) => [f.overdue, f.later, f.unscheduled, ...f.months].reduce((s, b) => s + P(b.byKey[k] || 0), 0);
    expect(f.columns.reduce((s, c) => s + colTotal(c.key), 0)).toBe(P(f.total));
  });

  test('a later start moves early months into "overdue"; a short horizon moves the tail into "later"', () => {
    const x = scene();
    const f = L.recoveryForecast(x.db, { from: { month: 11, year: 2026 }, months: 2 });
    expect(f.overdue.amount).toBe(0);
    expect(f.later.amount).toBeGreaterThan(0);
    expect(f.reconciles).toBe(true);
  });
});

describe('exceptions and leavers', () => {
  test('shortfall instalment and exit residual, both payrolls; summary by kind', () => {
    const x = scene();
    const e = L.exceptionsList(x.db);
    expect(e.rows.map((r) => [r.kind, r.loanId, r.amount])).toEqual([
      ['shortfall', x.C, 1000],
      ['exit_residual', x.E, 4000],
    ]);
    expect(e.rows[0].fromMonth).toEqual({ month: 11, year: 2026 });
    expect(e.summary).toEqual({ shortfall: { count: 1, amount: 1000 }, exit_residual: { count: 1, amount: 4000 } });
    expect(e.total).toBe(5000);
  });

  test('leavers: the residual, and a requested loan that only carries the exit flag', () => {
    const x = scene();
    const lv = L.leaversWithBalance(x.db);
    expect(lv.rows.map((r) => [r.loanId, r.stage, r.balance, r.residual])).toEqual([
      [x.E, 'residual', 6000, 4000],
      [x.R, 'not_disbursed', 0, 0],
    ]);
    expect(lv.totals).toMatchObject({ loans: 2, balance: 6000, residual: 4000 });
  });
});

describe('perquisite list (threshold ₹20,000, pending CA)', () => {
  function perqDb() {
    const db = F.newDb();
    F.setPolicy(db, 'loan_max_active_per_person', '2');
    const at = LF.plant(db, { gross_salary: 50000 });
    const at20 = LF.activeLoan(db, { emp: at, principal: 20000, tenure: 10, disbursedOn: '2026-09-10' });   // exactly the threshold
    const two = LF.plant(db, { gross_salary: 50000 });
    const t1 = LF.activeLoan(db, { emp: two, principal: 12000, tenure: 4, disbursedOn: '2026-09-10' });
    const t2 = LF.activeLoan(db, { emp: two, principal: 9000, tenure: 3, disbursedOn: '2026-10-02' });       // aggregate 21,000 from Oct
    const big = LF.plant(db, { gross_salary: 50000 });
    const b = LF.activeLoan(db, { emp: big, principal: 25000, tenure: 5, disbursedOn: '2026-09-10' });
    return { db, at, two, big, at20: at20.loanId, t1: t1.loanId, t2: t2.loanId, b: b.loanId };
  }

  test('only borrowers ABOVE the threshold; two loans of one borrower aggregate; peak and month-end shown', () => {
    const x = perqDb();
    const p = L.perquisiteList(x.db, { from: { month: 9, year: 2026 }, to: { month: 10, year: 2026 } });
    expect(p).toMatchObject({ threshold: 20000, thresholdPending: 'pending CA confirmation' });
    const sep = p.months.find((m) => m.label === '2026-09');
    const oct = p.months.find((m) => m.label === '2026-10');
    expect(sep.borrowers.map((b) => [b.employeeCode, b.peak])).toEqual([[x.big.code, 25000]]);
    expect(oct.borrowers.map((b) => [b.employeeCode, b.peak, b.closing, b.loans.length])).toEqual([
      [x.two.code, 21000, 21000, 2],
      [x.big.code, 25000, 25000, 1],
    ].sort((a, b) => a[0].localeCompare(b[0])));
    expect(oct.closed).toEqual({ plant: false, sales: false });
  });

  test('peak counts a month whose month-end is below the threshold (a receipt during the month)', () => {
    const x = perqDb();
    expect(L.recordReceipt(x.db, x.b, FIN, { amount: 6000, mode: 'Cash', receiptDate: '2026-10-08' }, { asOf: '2026-10-09' }).ok).toBe(true);
    const oct = L.perquisiteList(x.db, { from: { month: 10, year: 2026 }, to: { month: 10, year: 2026 } }).months[0];
    expect(oct.borrowers.find((b) => b.employeeCode === x.big.code)).toMatchObject({ peak: 25000, closing: 19000 });
  });

  test('the threshold follows policy', () => {
    const x = perqDb();
    F.setPolicy(x.db, 'loan_perquisite_threshold', '30000');
    const p = L.perquisiteList(x.db, { from: { month: 10, year: 2026 }, to: { month: 10, year: 2026 } });
    expect(p.threshold).toBe(30000);
    expect(p.months[0].borrowers).toEqual([]);
  });

  test('default range = the Indian FY to date', () => {
    const p = L.perquisiteList(F.newDb(), { to: { month: 2, year: 2027 } });
    expect([p.from, p.to]).toEqual([{ month: 4, year: 2026 }, { month: 2, year: 2027 }]);
    expect(p.months).toHaveLength(11);
  });
});

describe('payslip balance line', () => {
  test('posted month: equals the statement closing for that month', () => {
    const x = scene();
    const b = L.payslipLoanBalance(x.db, { payroll: 'plant', employeeCode: x.Aemp.code, month: 11, year: 2026 });
    expect(b).toMatchObject({ show: true, total: 6666 });
    expect(b.loans).toEqual([{ loanId: x.A, loanType: 'Personal', outstandingAfter: 6666, emiThisMonth: 3334, emiState: 'posted' }]);
    const st = L.loanStatement(x.db, x.A);
    expect(st.rows.find((r) => r.month === '2026-11').closing).toBe(6666);
  });

  test('before the close: statement closing less the provisional EMI', () => {
    const x = scene();
    const ins = firstOpen(x.db, x.B);
    expect(L.recordProvisional(x.db, { loanId: x.B, instalmentId: ins.id, payroll: 'plant', month: 11, year: 2026, company: COMPANY, amount: 3000 }, SYS).ok).toBe(true);
    const code = L.getLoan(x.db, x.B).employee_code;
    const b = L.payslipLoanBalance(x.db, { payroll: 'plant', employeeCode: code, month: 11, year: 2026 });
    expect(b.loans).toEqual([{ loanId: x.B, loanType: 'Personal', outstandingAfter: 7000, emiThisMonth: 3000, emiState: 'provisional' }]);
  });

  test('after an admin reversal the month carries no EMI and the balance is back', () => {
    const x = scene();
    const d = x.db.prepare('SELECT id FROM loan_deductions WHERE loan_id = ?').get(x.A);
    expect(L.reverseDeduction(x.db, { deductionId: d.id, reason: 'reversed for the test' }, ADMIN).ok).toBe(true);
    const b = L.payslipLoanBalance(x.db, { payroll: 'plant', employeeCode: x.Aemp.code, month: 11, year: 2026 });
    expect(b.loans[0]).toMatchObject({ outstandingAfter: 10000, emiThisMonth: 0, emiState: 'posted' });
  });

  test('no line: non-borrower, month before disbursement, loan already at ₹0 before the month', () => {
    const x = scene();
    const none = L.payslipLoanBalance(x.db, { payroll: 'plant', employeeCode: 'NOBODY', month: 11, year: 2026 });
    expect(none).toMatchObject({ show: false, loans: [], total: 0 });
    expect(L.payslipLoanBalance(x.db, { payroll: 'plant', employeeCode: x.Aemp.code, month: 9, year: 2026 }).show).toBe(false);
    const dCode = L.getLoan(x.db, x.D).employee_code;   // written off in Oct 2026 (today, IST)
    expect(L.payslipLoanBalance(x.db, { payroll: 'plant', employeeCode: dCode, month: 3, year: 2027 }).show).toBe(false);
  });

  test('sales: code + company; another company with the same code shows nothing', () => {
    const x = scene();
    const ok = L.payslipLoanBalance(x.db, { payroll: 'sales', employeeCode: 'S7001', company: COMPANY, month: 11, year: 2026 });
    expect(ok).toMatchObject({ show: true, total: 9000 });
    expect(L.payslipLoanBalance(x.db, { payroll: 'sales', employeeCode: 'S7001', company: OTHER_COMPANY, month: 11, year: 2026 }).show).toBe(false);
    expect(L.payslipLoanBalance(x.db, { payroll: 'plant', employeeCode: 'S7001', month: 11, year: 2026 }).show).toBe(false);
  });
});

describe('Finance Audit data', () => {
  const salRow = (db, code, month, year, loan, net) => db.prepare(`INSERT INTO salary_computations (employee_code, month, year, company, loan_recovery, net_salary, gross_earned, total_deductions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(code, month, year, COMPANY, loan, net, net + loan, loan);

  test('EMI vs net: strictly above the policy %, and net ≤ 0 with a loan', () => {
    const db = F.newDb();
    salRow(db, 'X1', 11, 2026, 3000, 9000);    // 33.3 %
    salRow(db, 'X2', 11, 2026, 3000, 10000);   // 30 % exactly — not flagged
    salRow(db, 'X3', 11, 2026, 500, 0);        // net 0
    salRow(db, 'X4', 11, 2026, 0, 100);        // no loan
    let r = L.loanRedFlagData(db, 11, 2026);
    expect(r.pct).toBe(30);
    expect(r.emiHigh.map((e) => [e.employeeCode, e.pctOfNet])).toEqual([['X1', 33.3], ['X3', null]]);
    F.setPolicy(db, 'loan_emi_net_flag_pct', '40');
    r = L.loanRedFlagData(db, 11, 2026);
    expect(r.emiHigh.map((e) => e.employeeCode)).toEqual(['X3']);
  });

  test('unborne opposite entry on the month; exit residual from its final month on', () => {
    const x = scene();
    const d = x.db.prepare('SELECT id FROM loan_deductions WHERE loan_id = ?').get(x.A);
    expect(L.writeAdjustment(x.db, { deductionId: d.id, kind: 'unborne', amountPaise: 100000, reason: 'Stage 7 re-run' }, SYS).ok).toBe(true);
    const nov = L.loanRedFlagData(x.db, 11, 2026);
    expect(nov.unborne).toEqual([{ employeeCode: x.Aemp.code, loanId: x.A, amount: 1000, posted: 3334 }]);
    expect(nov.exitResiduals.map((r) => [r.loanId, r.residual])).toEqual([[x.E, 4000]]);
    expect(L.loanRedFlagData(x.db, 10, 2026).exitResiduals).toEqual([]);
    expect(L.loanRedFlagData(x.db, 12, 2026).exitResiduals).toHaveLength(1);
    expect(L.loanRedFlagData(x.db, 12, 2026).unborne).toEqual([]);
  });

  test('overdue closes: due by the close day, up to M − 1; closed or empty → none', () => {
    const db = F.newDb();
    expect(L.overdueCloses(db, { month: 12, year: 2026, now: new Date('2026-12-20T00:00:00Z') })).toEqual([]);
    LF.activeLoan(db);                                                        // instalments Nov, Dec, Jan
    const at = (d) => new Date(`${d}T03:00:00Z`);                             // 08:30 IST
    expect(L.overdueCloses(db, { month: 12, year: 2026, now: at('2026-12-13') })).toEqual([{ payroll: 'plant', month: 11, year: 2026 }]);
    expect(L.overdueCloses(db, { month: 12, year: 2026, now: at('2026-12-12') })).toEqual([]);   // Nov close not yet due
    expect(L.overdueCloses(db, { month: 11, year: 2026, now: at('2027-01-20') })).toEqual([]);   // only months before M
    closeRow(db, 11, 2026);
    expect(L.overdueCloses(db, { month: 12, year: 2026, now: at('2026-12-13') })).toEqual([]);
  });
});

describe('Excel', () => {
  test('every report builds a workbook whose totals match the JSON', () => {
    const x = scene();
    for (const name of Object.keys(L.REPORTS)) {
      const data = L.REPORTS[name](x.db, { from: name === 'perquisite' ? { month: 10, year: 2026 } : undefined });
      const wb = XLSX.read(L.toXlsx(L.reportSheets(name, data)), { type: 'buffer' });
      expect(wb.SheetNames.length).toBeGreaterThan(0);
    }
    const reg = L.outstandingRegister(x.db);
    const wb = XLSX.read(L.toXlsx(L.reportSheets('outstanding', reg)), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Outstanding register'], { header: 1 });
    const balCol = rows[0].indexOf('Outstanding ₹');
    expect(rows[rows.length - 1][0]).toBe('Total');
    expect(rows[rows.length - 1][balCol]).toBe(reg.totals.balance);
    expect(rows.slice(1, -1).reduce((s, r) => s + P(r[balCol]), 0)).toBe(P(reg.totals.balance));
  });
});

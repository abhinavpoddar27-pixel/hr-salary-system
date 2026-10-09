/**
 * Loans PR-7 — exit recovery (docs/loans/SPEC.md §5.2 r11, §5.4, D-7, D-15,
 * D-21; K9, K20, K32, K35; planner rulings 10 Oct 2026).
 *
 * The whole outstanding falls due in the final monthly payroll — the month of
 * the loan's own exit date (F) — within the cap's headroom. Anything the final
 * payroll cannot recover is the exit residual (= reconciliation "uncovered"),
 * cleared by a receipt or an admin-approved write-off; ₹0 → settled_at_exit.
 *
 * activeLoan() disburses on 5 Oct 2026: ₹10,000 over 3 = ₹3,334 Nov / ₹3,334 Dec / ₹3,332 Jan 2027.
 */
const LF = require('./helpers/loanFixture');
const { F, L, COMPANY, SYS, HR, FIN, ADMIN } = LF;
const common = require('../services/loans/common');

const closeRow = (db, month, year) => db.prepare(`INSERT INTO loan_closes (month, year, payroll, run_by, trigger_kind) VALUES (?, ?, 'plant', 'system', 'test')`).run(month, year).lastInsertRowid;
const sched = (db, id) => LF.instalments(db, id).map((i) => ({ m: i.due_month, y: i.due_year, due: i.amount_due, st: i.status, origin: i.origin }));
const recon = (db, id) => L.reconcileLoan(db, id);

describe('final month and "F is past" (one helper)', () => {
  test('finalMonthOf: exit date, time suffix, unreadable → IST month of exit_flagged_at', () => {
    expect(common.finalMonthOf({ exit_date: '2026-12-15' })).toEqual({ month: 12, year: 2026 });
    expect(common.finalMonthOf({ exit_date: '2026-12-15 10:00:00' })).toEqual({ month: 12, year: 2026 });
    // 31 Oct 2026 20:00 UTC = 1 Nov 01:30 IST
    expect(common.finalMonthOf({ exit_date: '15/12/2026', exit_flagged_at: '2026-10-31 20:00:00' })).toEqual({ month: 11, year: 2026 });
    expect(common.finalMonthOf({ exit_date: null, exit_flagged_at: null }, new Date('2027-02-10T00:00:00Z'))).toEqual({ month: 2, year: 2027 });
  });

  test('isMonthPast: a close row for F, or any later month closed; open otherwise', () => {
    const db = F.newDb();
    const nov = { month: 11, year: 2026 };
    expect(common.isMonthPast(db, 'plant', nov)).toBe(false);          // nothing ever closed
    closeRow(db, 12, 2026);                                              // Nov never needed a close, Dec closed
    expect(common.isMonthPast(db, 'plant', nov)).toBe(true);
    expect(common.isMonthPast(db, 'plant', { month: 12, year: 2026 })).toBe(true);
    expect(common.isMonthPast(db, 'plant', { month: 1, year: 2027 })).toBe(false);
    expect(common.isMonthPast(db, 'sales', nov)).toBe(false);           // per payroll
  });
});

describe('consolidateForExit — the schedule collapses into the final month', () => {
  test('F open: earlier months stay, F holds the rest, later months are cancelled; idempotent; reconciles', () => {
    const db = F.newDb();
    const { loanId } = LF.activeLoan(db);
    const r = L.flagForExit(db, loanId, HR, { exitDate: '2026-12-15' });
    expect(r).toMatchObject({ ok: true, status: 'recover_at_exit', exit: { finalMonth: { month: 12, year: 2026 }, finalMonthPast: false, dueInFinalPayroll: 6666, residual: 0, cancelled: 1 } });
    expect(sched(db, loanId)).toEqual([
      { m: 11, y: 2026, due: 3334, st: 'scheduled', origin: 'schedule' },
      { m: 12, y: 2026, due: 6666, st: 'scheduled', origin: 'schedule' },
      { m: 1, y: 2027, due: 3332, st: 'cancelled', origin: 'schedule' },
    ]);
    expect(recon(db, loanId)).toMatchObject({ ok: true, uncovered: 0 });
    const n = LF.events(db, loanId).length;
    expect(L.consolidateForExit(db, loanId, SYS)).toMatchObject({ ok: true, changed: false, dueInFinalPayroll: 6666 });
    expect(LF.events(db, loanId)).toHaveLength(n);
  });

  test('exit before the first EMI: one new "exit" instalment in F for the whole loan', () => {
    const db = F.newDb();
    const { loanId } = LF.activeLoan(db);
    L.flagForExit(db, loanId, HR, { exitDate: '2026-10-20' });
    const s = sched(db, loanId);
    expect(s.filter((x) => x.st !== 'cancelled')).toEqual([{ m: 10, y: 2026, due: 10000, st: 'scheduled', origin: 'exit' }]);
    expect(s.filter((x) => x.st === 'cancelled')).toHaveLength(3);
    expect(recon(db, loanId).ok).toBe(true);
  });

  test('an "uncovered" amount (extension limit reached) is folded into F', () => {
    const db = F.newDb();
    const { loanId } = LF.activeLoan(db);
    // Nothing deducted Nov, Dec, Jan, Feb → 3 shortfall months, then the limit: ₹3,334 uncovered.
    for (let k = 0; k < 4; k++) {
      const ins = LF.instalments(db, loanId).find((i) => i.status === 'scheduled');
      LF.deductAndPost(db, loanId, ins, 0);
    }
    expect(recon(db, loanId)).toMatchObject({ ok: true, uncovered: 3334 });
    L.flagForExit(db, loanId, HR, { exitDate: '2027-03-10' });
    const open = sched(db, loanId).filter((x) => x.st === 'scheduled');
    expect(open).toEqual([{ m: 3, y: 2027, due: 10000, st: 'scheduled', origin: 'shortfall' }]);
    expect(recon(db, loanId)).toMatchObject({ ok: true, uncovered: 0 });
  });

  test('Stage 7 already ran for F: the provisional F instalment is raised, its deduction is not touched', () => {
    const db = F.newDb();
    const { loanId } = LF.activeLoan(db);
    const dec = LF.instalments(db, loanId)[1];
    expect(L.recordProvisional(db, { loanId, instalmentId: dec.id, payroll: 'plant', month: 12, year: 2026, company: COMPANY, amount: 3334 }, SYS).ok).toBe(true);
    L.flagForExit(db, loanId, HR, { exitDate: '2026-12-31' });
    expect(LF.instalments(db, loanId)[1]).toMatchObject({ status: 'provisional', amount_due: 6666 });
    expect(db.prepare('SELECT amount, state FROM loan_deductions WHERE loan_id = ?').get(loanId)).toEqual({ amount: 3334, state: 'provisional' });
    expect(recon(db, loanId).ok).toBe(true);
  });

  test('F past (Mark Left after the final month\'s close): later months cancelled, residual alert at once', () => {
    const db = F.newDb();
    const { loanId } = LF.activeLoan(db);
    closeRow(db, 11, 2026);
    const r = L.flagForExit(db, loanId, HR, { exitDate: '2026-11-20' });
    expect(r.exit).toMatchObject({ finalMonthPast: true, cancelled: 2, residual: 6666 });
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]).toMatchObject({ type: 'loan_exit_residual', audience: 'finance', loanId, residual: 6666, finalMonth: { month: 11, year: 2026 } });
    expect(sched(db, loanId).map((x) => x.st)).toEqual(['scheduled', 'cancelled', 'cancelled']);   // Nov is the close / sweep's business
    expect(recon(db, loanId)).toMatchObject({ ok: true, uncovered: 6666 });
  });

  test('a receipt before F comes off the F instalment (it is the last one)', () => {
    const db = F.newDb();
    const { loanId } = LF.activeLoan(db);
    L.flagForExit(db, loanId, HR, { exitDate: '2026-12-15' });
    expect(L.recordReceipt(db, loanId, FIN, { amount: 2000, mode: 'Cash', receiptDate: '2026-10-09' }, { asOf: '2026-10-09' }).ok).toBe(true);
    expect(LF.instalments(db, loanId)[1]).toMatchObject({ due_month: 12, amount_due: 4666, status: 'scheduled' });
    expect(recon(db, loanId).ok).toBe(true);
  });

  test('requested / approved loans: flag only, nothing to consolidate', () => {
    const db = F.newDb();
    const emp = LF.plant(db);
    const r = L.requestLoan(db, { borrowerType: 'plant', employeeCode: emp.code, company: COMPANY, loanType: 'Personal', principal: 6000, tenure: 3, reason: 't' }, HR, { asOf: LF.ASOF });
    const f = L.flagForExit(db, r.loanId, HR, { exitDate: '2026-12-15' });
    expect(f).toMatchObject({ ok: true, status: 'requested', exit: { changed: false } });
    expect(L.approveLoan(db, r.loanId, ADMIN, { asOf: LF.ASOF })).toMatchObject({ ok: false, code: 'LOAN_EXIT_FLAGGED' });
  });
});

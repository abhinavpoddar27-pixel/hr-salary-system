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

// ── Stage 7 + loan close + sweep (real recomputeSalary, real close) ─────────
const { recomputeSalary } = require('../services/recompute');
const C = require('../services/loans/close');

const ist = (y, m, d, hh = 1) => new Date(Date.UTC(y, m - 1, d, hh, 0, 0));
const stage7 = (db, month, year, requestId = 'run-1') => F.silently(() => recomputeSalary(db, { month, year, company: COMPANY, requestId }));
function worked(db, emp, month, year, payable = 26) {
  F.addDayCalc(db, emp, month, year, { days_present: payable, total_payable_days: payable });
  if (payable < 5) return;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const ins = db.prepare("INSERT OR IGNORE INTO attendance_processed (employee_code, date, status_original, status_final, company, month, year) VALUES (?, ?, 'P', 'P', ?, ?, ?)");
  for (let d = last - 7; d <= last; d++) ins.run(emp.code, `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`, COMPANY, month, year);
}
function advance(db, code, month, year, amount) {
  db.prepare(`INSERT INTO salary_advances (employee_code, month, year, is_eligible, advance_amount, paid, recovered, recovery_month, recovery_year)
              VALUES (?, ?, ?, 1, ?, 1, 0, ?, ?)`).run(code, month === 1 ? 12 : month - 1, month === 1 ? year - 1 : year, amount, month, year);
}
const salary = (db, code, month, year) => db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?').get(code, month, year);
const close = (db, month, year, now, over = {}) => F.silently(() => C.runLoanClose(db, { month, year, now, ...over }));
const notes = (db, type) => db.prepare('SELECT * FROM notifications WHERE type = ? ORDER BY id').all(type);
const open = (db, id) => LF.instalments(db, id).filter((i) => i.status === 'scheduled' || i.status === 'provisional');
const after = (db, id, m) => LF.instalments(db, id).filter((i) => i.status !== 'cancelled' && (i.due_year * 12 + i.due_month) > (m.year * 12 + m.month));

function expectClean(db, month, year) {
  expect(db.prepare('SELECT COUNT(*) AS n FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1').get().n).toBe(0);
  expect(db.prepare(`SELECT COUNT(*) AS n FROM salary_computations
    WHERE ABS(total_deductions - (COALESCE(pf_employee,0) + COALESCE(esi_employee,0)
      + COALESCE(professional_tax,0) + COALESCE(tds,0) + COALESCE(advance_recovery,0)
      + COALESCE(lop_deduction,0) + COALESCE(other_deductions,0) + COALESCE(loan_recovery,0)
      + COALESCE(late_coming_deduction,0) + COALESCE(early_exit_deduction,0))) > 1`).get().n).toBe(0);
  expect(C.checkPayslipLedger(db, { month, year }).mismatches).toEqual([]);
}

/** Nov posted normally; the borrower leaves in December (exit 15 Dec 2026, final month Dec). */
function leaverInDecember(db, over = {}) {
  const { loanId, emp } = LF.activeLoan(db, over);
  worked(db, emp, 11, 2026);
  stage7(db, 11, 2026);
  expect(close(db, 11, 2026, ist(2026, 12, 13)).ok).toBe(true);
  const f = L.flagForExit(db, loanId, HR, { exitDate: '2026-12-15' });
  expect(f.ok).toBe(true);
  db.prepare("UPDATE employees SET status = 'Left', date_of_exit = '2026-12-15' WHERE code = ?").run(emp.code);
  return { loanId, emp };
}
const DEC = { month: 12, year: 2026 };

describe('the final payroll recovers the whole outstanding within the cap', () => {
  test('room for all of it: one provisional row = the outstanding; the close settles the loan at exit', () => {
    const db = F.newDb();
    const { loanId, emp } = leaverInDecember(db);
    worked(db, emp, 12, 2026);
    stage7(db, 12, 2026);
    expect(salary(db, emp.code, 12, 2026).loan_recovery).toBe(6666);
    expect(db.prepare("SELECT COUNT(*) AS n FROM loan_deductions WHERE loan_id = ? AND month = 12 AND state = 'provisional'").get(loanId).n).toBe(1);
    expectClean(db, 12, 2026);
    const r = close(db, 12, 2026, ist(2027, 1, 13));
    expect(r).toMatchObject({ ok: true, posted: 1, postedAmount: 6666, exitResiduals: [] });
    expect(LF.loan(db, loanId)).toMatchObject({ status: 'settled_at_exit', remaining_balance: 0 });
    expect(open(db, loanId)).toEqual([]);
    expect(recon(db, loanId).problems).toEqual([]);
    db.close();
  });

  test('the cap leaves a residual: posted partially, nothing added after F, no extension month, finance alerted; reconciles to the paisa', () => {
    const db = F.newDb();
    const { loanId, emp } = leaverInDecember(db);
    worked(db, emp, 12, 2026);
    advance(db, emp.code, 12, 2026, 6387.09);            // room 2,000 (December: 31 days)
    stage7(db, 12, 2026);
    expect(salary(db, emp.code, 12, 2026).loan_recovery).toBe(2000);
    // non-blocking readiness warning, and the close still runs
    const ready = C.closeReadiness(db, { month: 12, year: 2026, now: ist(2027, 1, 13) });
    expect(ready.ok).toBe(true);
    expect(ready.warnings).toEqual([expect.objectContaining({ code: 'EXIT_FINAL_PAYROLL_SHORT', loanId, deducted: 2000, dueInFinalPayroll: 6666, expectedResidual: 4666, computedBeforeExit: false })]);
    const before = LF.instalments(db, loanId).length;
    const r = close(db, 12, 2026, ist(2027, 1, 13));
    expect(r).toMatchObject({ ok: true, posted: 1, postedAmount: 2000, shortfall: 1, reconciliationOk: true });
    expect(r.exitResiduals).toEqual([{ loanId, employeeCode: emp.code, residual: 4666, heldPending: 0 }]);
    expect(LF.instalments(db, loanId)).toHaveLength(before);                 // the boundary: the close of F itself ⇒ F past ⇒ residual
    expect(after(db, loanId, DEC)).toEqual([]);
    expect(common.extensionMonthsUsed(LF.instalments(db, loanId))).toBe(0);
    expect(LF.loan(db, loanId)).toMatchObject({ status: 'recover_at_exit', remaining_balance: 4666 });
    expect(recon(db, loanId)).toMatchObject({ ok: true, uncovered: 4666, openInstalments: 0, expectedBalance: 4666 });
    const n = notes(db, 'LOAN_EXIT_RESIDUAL');
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ role_target: 'finance' });
    expect(n[0].message).toMatch(/exit residual now ₹4666/);
    expect(notes(db, 'LOAN_CLOSE_DONE')[1].message).toMatch(/exit residual 1/);
    expectClean(db, 12, 2026);

    // Q-C: the borrower comes back (Stage 6 reactivation) — the loan stays recover_at_exit, January deducts ₹0.
    db.prepare("UPDATE employees SET status = 'Active' WHERE code = ?").run(emp.code);
    worked(db, emp, 1, 2027);
    stage7(db, 1, 2027);
    expect(salary(db, emp.code, 1, 2027).loan_recovery).toBe(0);
    expect(LF.loan(db, loanId).status).toBe('recover_at_exit');

    // a receipt clears the residual → settled at exit
    const rc = L.recordReceipt(db, loanId, FIN, { amount: 4666, mode: 'Cash', receiptDate: '2027-01-20' }, { asOf: '2027-01-20' });
    expect(rc).toMatchObject({ ok: true, balance: 0, loanStatus: 'settled_at_exit' });
    expect(recon(db, loanId).problems).toEqual([]);
    db.close();
  });

  test('no salary row in F: the F instalment is cancelled (Q-D), the amount stays as residual; reconciles', () => {
    const db = F.newDb();
    const { loanId } = leaverInDecember(db);
    worked(db, LF.plant(db), 12, 2026);                  // someone else is paid in December
    stage7(db, 12, 2026);
    const r = close(db, 12, 2026, ist(2027, 1, 13));
    expect(r).toMatchObject({ ok: true, noSalary: 1 });
    expect(LF.instalments(db, loanId).find((i) => i.due_month === 12)).toMatchObject({ status: 'cancelled', amount_due: 6666 });
    expect(after(db, loanId, DEC)).toEqual([]);
    expect(recon(db, loanId)).toMatchObject({ ok: true, uncovered: 6666, balance: 6666 });
    expect(r.exitResiduals).toEqual([expect.objectContaining({ loanId, residual: 6666 })]);
    db.close();
  });

  test('F computed before Mark Left: warning says so; a re-run recovers the rest; without it the rest is residual', () => {
    const run = (rerun) => {
      const db = F.newDb();
      const { loanId, emp } = LF.activeLoan(db);
      worked(db, emp, 11, 2026); stage7(db, 11, 2026); close(db, 11, 2026, ist(2026, 12, 13));
      worked(db, emp, 12, 2026); stage7(db, 12, 2026);                // Dec EMI ₹3,334 provisional
      db.prepare("UPDATE loan_deductions SET updated_at = '2027-01-03 06:00:00' WHERE loan_id = ? AND month = 12").run(loanId);
      L.flagForExit(db, loanId, HR, { exitDate: '2026-12-15' });
      db.prepare("UPDATE loans SET exit_flagged_at = '2027-01-08 06:00:00' WHERE id = ?").run(loanId);
      const w = C.closeReadiness(db, { month: 12, year: 2026, now: ist(2027, 1, 13) }).warnings;
      expect(w).toEqual([expect.objectContaining({ code: 'EXIT_FINAL_PAYROLL_SHORT', deducted: 3334, dueInFinalPayroll: 6666, computedBeforeExit: true })]);
      expect(w[0].message).toMatch(/re-run Stage 7/);
      expect(C.previewClose(db, { month: 12, year: 2026, now: ist(2027, 1, 13) }).exitFinalMonth).toMatchObject({ loans: 1, short: [expect.objectContaining({ loanId })] });
      if (rerun) stage7(db, 12, 2026, 'run-2');
      close(db, 12, 2026, ist(2027, 1, 13));
      expectClean(db, 12, 2026);
      return { loan: LF.loan(db, loanId), recon: recon(db, loanId) };
    };
    expect(run(true).loan).toMatchObject({ status: 'settled_at_exit', remaining_balance: 0 });
    const no = run(false);
    expect(no.loan).toMatchObject({ status: 'recover_at_exit', remaining_balance: 3332 });
    expect(no.recon).toMatchObject({ ok: true, uncovered: 3332 });
  });

  test('a Stage 7 re-run of F after posting that pay can no longer bear: opposite entry → residual, no instalment added', () => {
    const db = F.newDb();
    const { loanId, emp } = leaverInDecember(db);
    worked(db, emp, 12, 2026);
    stage7(db, 12, 2026);
    close(db, 12, 2026, ist(2027, 1, 13));
    expect(LF.loan(db, loanId).status).toBe('settled_at_exit');
    // settled loan: a re-run with no room keeps the full posted amount (PR-6 rule for a loan no longer live)
    advance(db, emp.code, 12, 2026, 8000);
    stage7(db, 12, 2026, 'run-2');
    expect(salary(db, emp.code, 12, 2026).loan_recovery).toBe(6666);
    expectClean(db, 12, 2026);
    db.close();
  });

  test('…and on a loan still in recover_at_exit the unborne part becomes residual', () => {
    const db = F.newDb();
    const { loanId, emp } = leaverInDecember(db);
    worked(db, emp, 12, 2026);
    advance(db, emp.code, 12, 2026, 6387.09);            // room 2,000 → posted 2,000, residual 4,666
    stage7(db, 12, 2026);
    close(db, 12, 2026, ist(2027, 1, 13));
    const n = LF.instalments(db, loanId).length;
    db.prepare('UPDATE salary_advances SET advance_amount = 7387.09 WHERE employee_code = ?').run(emp.code);   // room 1,000 now
    stage7(db, 12, 2026, 'run-2');
    expect(salary(db, emp.code, 12, 2026).loan_recovery).toBe(1000);
    expect(LF.instalments(db, loanId)).toHaveLength(n);
    expect(LF.loan(db, loanId).remaining_balance).toBe(5666);
    expect(recon(db, loanId)).toMatchObject({ ok: true, uncovered: 5666 });
    expectClean(db, 12, 2026);
    db.close();
  });
});

describe('before F, changes are recovered in the final payroll; after F they are residual', () => {
  test('a shortfall in a month before F goes into the F instalment (not an extension month)', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    L.flagForExit(db, loanId, HR, { exitDate: '2027-01-10' });           // F = Jan 2027
    worked(db, emp, 11, 2026);
    advance(db, emp.code, 11, 2026, 7666.66);                             // room 1,000
    stage7(db, 11, 2026);
    close(db, 11, 2026, ist(2026, 12, 13));
    const s = LF.instalments(db, loanId);
    expect(s.find((i) => i.due_month === 1)).toMatchObject({ amount_due: 5666, status: 'scheduled' });   // 3,332 + 2,334
    expect(s.filter((i) => i.origin === 'shortfall')).toHaveLength(0);
    expect(common.extensionMonthsUsed(s)).toBe(0);
    expect(recon(db, loanId).problems).toEqual([]);
    db.close();
  });

  test('admin reversal: F open → into F; F past → residual', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    worked(db, emp, 11, 2026); stage7(db, 11, 2026); close(db, 11, 2026, ist(2026, 12, 13));
    L.flagForExit(db, loanId, HR, { exitDate: '2026-12-15' });
    const nov = db.prepare('SELECT id FROM loan_deductions WHERE loan_id = ? AND month = 11').get(loanId).id;
    expect(F.silently(() => C.reverseDeduction(db, { deductionId: nov, reason: 'posted against the wrong month' }, ADMIN)).ok).toBe(true);
    expect(LF.instalments(db, loanId).find((i) => i.due_month === 12)).toMatchObject({ amount_due: 10000 });
    expect(recon(db, loanId).problems).toEqual([]);
    // after F: no salary in Dec → residual 10,000; a later reversal adds nothing to the schedule
    worked(db, LF.plant(db), 12, 2026); stage7(db, 12, 2026); close(db, 12, 2026, ist(2027, 1, 13));
    expect(recon(db, loanId)).toMatchObject({ ok: true, uncovered: 10000 });
    db.close();
  });

  test('Mark Left after F closed: residual at once, later Stage 7 deducts ₹0', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    worked(db, emp, 11, 2026); stage7(db, 11, 2026); close(db, 11, 2026, ist(2026, 12, 13));
    const f = L.flagForExit(db, loanId, HR, { exitDate: '2026-11-25' });
    expect(f.exit).toMatchObject({ finalMonthPast: true, residual: 6666, cancelled: 2 });
    worked(db, emp, 12, 2026); stage7(db, 12, 2026);
    expect(salary(db, emp.code, 12, 2026).loan_recovery).toBe(0);
    expect(recon(db, loanId)).toMatchObject({ ok: true, uncovered: 6666 });
    db.close();
  });
});

describe('held final salary (ruling Q-B: the 60-day wait stays)', () => {
  const heldLeaver = () => {
    const db = F.newDb();
    const x = leaverInDecember(db);
    worked(db, x.emp, 12, 2026, 2);                      // payable < 5 → held
    worked(db, LF.plant(db), 12, 2026);
    stage7(db, 12, 2026);
    expect(salary(db, x.emp.code, 12, 2026).salary_held).toBe(1);
    const r = close(db, 12, 2026, ist(2027, 1, 13));
    expect(r).toMatchObject({ ok: true, held: 1 });
    expect(r.exitResiduals).toEqual([expect.objectContaining({ loanId: x.loanId, heldPending: x.prov = salary(db, x.emp.code, 12, 2026).loan_recovery })]);
    expect(notes(db, 'LOAN_EXIT_FINAL_HELD')).toHaveLength(1);
    expect(notes(db, 'LOAN_CLOSE_DONE')[1].message).toMatch(/held final salary 1/);
    return { db, ...x };
  };

  test('released within the wait: the sweep posts it, the rest is residual', () => {
    const { db, loanId, emp, prov } = heldLeaver();
    expect(prov).toBeGreaterThan(0);
    db.prepare("UPDATE salary_computations SET salary_held = 0, hold_released = 1 WHERE employee_code = ? AND month = 12").run(emp.code);
    expect(F.silently(() => C.runHeldSweep(db, { now: ist(2027, 2, 1) })).posted).toBe(1);
    expect(recon(db, loanId)).toMatchObject({ ok: true, uncovered: Math.round((6666 - prov) * 100) / 100, openInstalments: 0 });
    db.close();
  });

  test('never released: day 59 waits; day 60 the F instalment is cancelled and the whole amount is residual; write-off then settles it', () => {
    const { db, loanId } = heldLeaver();
    expect(L.writeOffLoan(db, { loanId, reason: 'leaver', requestedBy: HR }, ADMIN).code).toBe('WRITE_OFF_PROVISIONAL_PENDING');
    expect(F.silently(() => C.runHeldSweep(db, { now: ist(2027, 3, 13) })).waiting).toBe(1);   // 59 days
    expect(F.silently(() => C.runHeldSweep(db, { now: ist(2027, 3, 14) })).moved).toBe(1);
    expect(LF.instalments(db, loanId).find((i) => i.due_month === 12)).toMatchObject({ status: 'cancelled' });
    expect(after(db, loanId, DEC)).toEqual([]);
    expect(recon(db, loanId)).toMatchObject({ ok: true, uncovered: 6666 });
    expect(notes(db, 'LOAN_EXIT_RESIDUAL')).toHaveLength(1);
    const w = L.writeOffLoan(db, { loanId, reason: 'leaver, nothing left to recover', requestedBy: HR }, ADMIN);
    expect(w).toMatchObject({ ok: true, status: 'settled_at_exit', writtenOff: 6666 });
    expect(recon(db, loanId).problems).toEqual([]);
    db.close();
  });
});

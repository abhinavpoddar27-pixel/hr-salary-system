/**
 * Loans PR-6 — the daily held sweep (docs/loans/SPEC.md §5.2 r8, D-6, D-14;
 * K5, K19, K28; coordinator change 10 Oct 2026: the 60-day staleness marker
 * lives on the loan side, never in day_calculations.salary_stale).
 *
 * A held salary (< 5 payable days) keeps its provisional EMI at the close. The
 * sweep posts it once the hold is released; still held 60 days after the close,
 * the instalment moves to the end and the reversed deduction is the marker the
 * hold-release guard reads.
 */
const LF = require('./helpers/loanFixture');
const { F, L, COMPANY } = LF;
const { recomputeSalary } = require('../services/recompute');
const C = require('../services/loans/close');

const ist = (y, m, d, hh = 1) => new Date(Date.UTC(y, m - 1, d, hh, 0, 0));
const CLOSE_AT = ist(2026, 12, 13);                         // run_at 2026-12-13 01:00:00 UTC
const dayAfterClose = (n) => new Date(CLOSE_AT.getTime() + n * 86400000);

function stage7(db, requestId = 'run-1', opts = {}) {
  return F.silently(() => recomputeSalary(db, { month: 11, year: 2026, company: COMPANY, requestId, ...opts }));
}
const deductions = (db, loanId) => db.prepare('SELECT * FROM loan_deductions WHERE loan_id = ? ORDER BY id').all(loanId);
const salary = (db, code) => db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = 11 AND year = 2026').get(code);
const sweep = (db, now) => F.silently(() => C.runHeldSweep(db, { now }));
const release = (db, code) => db.prepare("UPDATE salary_computations SET salary_held = 0, hold_released = 1, hold_released_by = 'fin1' WHERE employee_code = ? AND month = 11 AND year = 2026").run(code);
const tableCounts = (db) => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
  .map(({ name }) => [name, db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n]));

/** One held borrower, closed on 13 Dec 2026. */
function heldAtClose() {
  const db = F.newDb();
  const { loanId, emp } = LF.activeLoan(db);
  F.addDayCalc(db, emp, 11, 2026, { days_present: 2, total_payable_days: 2 });   // < 5 payable → held
  stage7(db);
  const row = salary(db, emp.code);
  expect(row.salary_held).toBe(1);
  expect(row.loan_recovery).toBeGreaterThan(0);
  const r = F.silently(() => C.runLoanClose(db, { month: 11, year: 2026, now: CLOSE_AT }));
  expect(r).toMatchObject({ ok: true, posted: 0, held: 1 });
  expect(deductions(db, loanId)[0].state).toBe('provisional');
  return { db, loanId, emp, amount: row.loan_recovery, closeId: r.closeId };
}

describe('held at the close (D-6, K5)', () => {
  test('released within the wait: the next sweep posts it against the month\'s close', () => {
    const { db, loanId, emp, amount, closeId } = heldAtClose();
    expect(sweep(db, dayAfterClose(5))).toMatchObject({ posted: 0, waiting: 1, moved: 0 });
    release(db, emp.code);
    const s = sweep(db, dayAfterClose(6));
    expect(s).toMatchObject({ posted: 1, postedAmount: amount, moved: 0, errors: [] });
    expect(deductions(db, loanId)[0]).toMatchObject({ state: 'posted', amount, posted_close_id: closeId });
    expect(LF.loan(db, loanId).remaining_balance).toBeCloseTo(10000 - amount, 2);
    expect(L.reconcileLoan(db, loanId).problems).toEqual([]);
    expect(C.checkPayslipLedger(db, { month: 11, year: 2026 }).ok).toBe(true);
    // twice the same day: nothing more
    const counts = tableCounts(db);
    sweep(db, dayAfterClose(6));
    expect(tableCounts(db)).toEqual(counts);
    db.close();
  });

  test('re-held at the moment of the sweep (K19): not posted', () => {
    const { db, loanId, emp } = heldAtClose();
    release(db, emp.code);
    db.prepare('UPDATE salary_computations SET salary_held = 1 WHERE employee_code = ?').run(emp.code);
    expect(sweep(db, dayAfterClose(10))).toMatchObject({ posted: 0, waiting: 1 });
    expect(deductions(db, loanId)[0].state).toBe('provisional');
    db.close();
  });

  test('day 59 waits; day 60 still held: moved to the end, loan-side stale marker, release refused until Stage 7 re-runs', () => {
    const { db, loanId, emp, amount } = heldAtClose();
    expect(sweep(db, dayAfterClose(59))).toMatchObject({ waiting: 1, moved: 0 });
    const s = sweep(db, dayAfterClose(60));
    expect(s).toMatchObject({ moved: 1, posted: 0, errors: [] });
    const d = deductions(db, loanId)[0];
    expect(d).toMatchObject({ state: 'reversed', reversal_reason: L.HELD_MOVE_REVERSAL_REASON });
    const ins = LF.instalments(db, loanId);
    expect(ins[0].status).toBe('deferred');
    expect(ins[3]).toMatchObject({ origin: 'held', amount_due: 3334, status: 'scheduled' });
    expect(LF.loan(db, loanId).remaining_balance).toBe(10000);
    expect(L.reconcileLoan(db, loanId).problems).toEqual([]);
    // never the leave-automation flag (coordinator change)
    expect(db.prepare('SELECT salary_stale FROM day_calculations WHERE employee_code = ?').get(emp.code).salary_stale).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'LOAN_HELD_MOVED_TO_END'").get().n).toBe(1);
    // the salary row still shows the loan → release refused
    expect(salary(db, emp.code).loan_recovery).toBe(amount);
    expect(C.loanHoldReleaseCheck(db, emp.code, 11, 2026)).toMatchObject({ ok: false, code: 'LOAN_ROW_STALE' });
    expect(C.loanHoldReleaseCheck(db, emp.code, '11', '2026').ok).toBe(false);   // route passes strings
    // Stage 7 re-run for this employee: the month no longer carries the instalment → agree → allowed
    stage7(db, 'rerun', { employeeCodes: [emp.code] });
    expect(salary(db, emp.code).loan_recovery).toBe(0);
    expect(C.loanHoldReleaseCheck(db, emp.code, 11, 2026)).toEqual({ ok: true });
    // and a later sweep leaves it alone
    expect(sweep(db, dayAfterClose(61))).toMatchObject({ posted: 0, moved: 0, waiting: 0 });
    db.close();
  });

  test('loanHoldReleaseCheck is a no-op with no loan rows, for another month, and on a database without loan tables', () => {
    const db = F.newDb();
    const emp = LF.plant(db);
    expect(C.loanHoldReleaseCheck(db, emp.code, 11, 2026)).toEqual({ ok: true });
    const bare = new (require('better-sqlite3'))(':memory:');
    expect(C.loanHoldReleaseCheck(bare, 'E1', 4, 2026)).toEqual({ ok: true });
    bare.close();
    db.close();
  });
});

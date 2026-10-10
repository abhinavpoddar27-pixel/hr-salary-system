/**
 * Statutory flags PR-1 — T12: flags switched on by the upload interact with a
 * live loan (Loans PR-6 shape: August posted at the loan close, so it is
 * frozen; corrections would go through loan_adjustments).
 *
 * Synthetic data; real initSchema, real loan engine, real recomputeSalary,
 * real runLoanClose, real statutory upload.
 */
const LF = require('./helpers/loanFixture');
const S = require('./helpers/statutoryFixture');
const { F, L, COMPANY } = LF;
const { recomputeSalary } = require('../services/recompute');
const C = require('../services/loans/close');

const ist = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 1, 0, 0));
const stage7 = (db, month, year, requestId) => F.silently(() => recomputeSalary(db, { month, year, company: COMPANY, requestId }));
const salary = (db, code, month, year) => db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?').get(code, month, year);
const ledger = (db, loanId) => db.prepare('SELECT * FROM loan_deductions WHERE loan_id = ? ORDER BY id').all(loanId);

function worked(db, emp, month, year, payable = 26) {
  F.addDayCalc(db, emp, month, year, { days_present: payable, total_payable_days: payable });
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const ins = db.prepare("INSERT OR IGNORE INTO attendance_processed (employee_code, date, status_original, status_final, company, month, year) VALUES (?, ?, 'P', 'P', ?, ?, ?)");
  for (let d = last - 7; d <= last; d++) ins.run(emp.code, `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`, COMPANY, month, year);
}

const strip = (r, extra = []) => {
  if (!r) return r;
  const o = { ...r };
  for (const k of ['computed_at', 'created_at', 'updated_at', 'run_id', ...extra]) delete o[k];
  return o;
};

describe('T12 — flags ON with a live loan', () => {
  test('September: loan EMI fits the headroom left after PF/ESI; identity holds; August salary row + ledger byte-identical', () => {
    const db = F.newDb();
    // Disbursed 5 Jul → EMIs Aug / Sep / Oct 2026 of ₹3,000. Gross ₹20,000.
    const { loanId, emp } = LF.activeLoan(db, { disbursedOn: '2026-07-05', principal: 9000, tenure: 3 });
    db.prepare('INSERT INTO salary_structures (employee_id, effective_from, gross_salary, basic, hra, other_allowances, pf_applicable, esi_applicable, lwf_applicable) VALUES (?, ?, 20000, 10000, 4000, 6000, 0, 0, 0)')
      .run(emp.id, '2026-08-24'); // only a row dated after August starts → August is served by the fallback (L18)
    // a big advance in September so the cap actually binds
    db.prepare(`INSERT INTO salary_advances (employee_code, month, year, is_eligible, advance_amount, paid, recovered, recovery_month, recovery_year)
                VALUES (?, 8, 2026, 1, 6000, 1, 0, 9, 2026)`).run(emp.code);

    worked(db, emp, 8, 2026);
    stage7(db, 8, 2026, 'aug-1');
    const closeAug = F.silently(() => C.runLoanClose(db, { month: 8, year: 2026, now: ist(2026, 9, 13) }));
    expect(closeAug).toMatchObject({ ok: true, posted: 1 });
    const aug0 = strip(salary(db, emp.code, 8, 2026));
    const led0 = ledger(db, loanId).map((d) => strip(d));
    expect(aug0.loan_recovery).toBe(3000);
    expect(aug0.pf_employee).toBe(0);

    // the statutory upload: PF + ESI + LWF ON from September
    const up = S.applyFile(db, 'plant', S.plantFile(S.prow(emp.code, 1, 1, 1)));
    expect(up.ok).toBe(true);

    // August re-run: unchanged salary row, ledger untouched (posted month stays frozen)
    stage7(db, 8, 2026, 'aug-2');
    expect(strip(salary(db, emp.code, 8, 2026))).toEqual(aug0);
    expect(ledger(db, loanId).map((d) => strip(d))).toEqual(led0);
    expect(db.prepare('SELECT COUNT(*) c FROM loan_adjustments').get().c).toBe(0);

    // September: PF + ESI applied, loan takes only the room left under the 50% cap
    worked(db, emp, 9, 2026);
    const out = stage7(db, 9, 2026, 'sep-1');
    expect(out.errors).toEqual([]);
    const sep = salary(db, emp.code, 9, 2026);
    expect(sep.pf_employee).toBeGreaterThan(0);
    expect(sep.esi_employee).toBeGreaterThan(0);
    expect(sep.lwf_employee).toBe(5); // PR-2: LWF Y from September; ranks above the loan (headroom.js)
    const before = sep.pf_employee + sep.esi_employee + sep.advance_recovery + sep.lwf_employee;
    const cap = Math.floor(sep.gross_earned * 0.5 * 100) / 100;
    expect(sep.loan_recovery).toBeCloseTo(Math.min(3000, Math.max(0, cap - before)), 2);
    expect(sep.loan_recovery).toBeLessThan(3000); // the cap binds because PF/ESI now take room
    expect(sep.total_deductions).toBeCloseTo(before + sep.loan_recovery, 2);
    expect(Math.abs(sep.net_salary - (sep.gross_earned - sep.total_deductions))).toBeLessThanOrEqual(1);
    const sepLedger = ledger(db, loanId).filter((d) => d.month === 9);
    expect(sepLedger).toEqual([expect.objectContaining({ state: 'provisional', amount: sep.loan_recovery })]);
    expect(L.reconcileLoan(db, loanId).ok).toBe(true);

    // drift identity across every row
    expect(db.prepare('SELECT COUNT(*) c FROM salary_computations WHERE ABS(net_salary-(gross_earned-total_deductions))>1').get().c).toBe(0);
    db.close();
  });
});

/**
 * Loans PR-6 — the monthly loan close and the catch-up (docs/loans/SPEC.md
 * §5.1, §5.2 r6–r7 and r13, D-5, D-10, D-19; K1, K6, K27, K29, K33, K34;
 * owner rulings Q5, Q7, Q8, Q10, Q11, 10 Oct 2026).
 *
 * Real schema, real engine, real recomputeSalary. activeLoan() disburses on
 * 5 Oct 2026: ₹10,000 over 3 = ₹3,334 Nov / ₹3,334 Dec / ₹3,332 Jan 2027.
 * The close of month M is due on the 13th of M+1 in IST.
 */
const LF = require('./helpers/loanFixture');
const { F, L, COMPANY, SYS, FIN, HR, ADMIN, VIEWER } = LF;
const { recomputeSalary } = require('../services/recompute');
const C = require('../services/loans/close');
const { startLoanCloseScheduler, LOAN_CLOSE_CRON, LOAN_CLOSE_TIMEZONE } = require('../services/loans/closeScheduler');

/** 06:30 IST on day d of month m (01:00 UTC). */
const ist = (y, m, d, hh = 1, mm = 0) => new Date(Date.UTC(y, m - 1, d, hh, mm, 0));

function stage7(db, month, year, requestId = 'run-1', opts = {}) {
  return F.silently(() => recomputeSalary(db, { month, year, company: COMPANY, requestId, ...opts }));
}
/** A Stage 6 row; a full month also gets present punches for its last days (else the month-end absence streak holds it). */
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
const deductions = (db, loanId) => db.prepare('SELECT * FROM loan_deductions WHERE loan_id = ? ORDER BY id').all(loanId);
const closes = (db) => db.prepare('SELECT * FROM loan_closes ORDER BY id').all();
const notes = (db, type) => db.prepare('SELECT * FROM notifications WHERE type = ? ORDER BY id').all(type);
const close = (db, month, year, now, over = {}) => F.silently(() => C.runLoanClose(db, { month, year, now, ...over }));
const catchUp = (db, now, trigger = 'auto') => F.silently(() => C.runCatchUp(db, { now, trigger }));

/** Row count of every table — proves "writes nothing". */
function tableCounts(db) {
  const out = {};
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    out[name] = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n;
  }
  return out;
}

function expectClean(db) {
  expect(db.prepare('SELECT COUNT(*) AS n FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1').get().n).toBe(0);
  expect(db.prepare(`SELECT COUNT(*) AS n FROM salary_computations
    WHERE ABS(total_deductions - (COALESCE(pf_employee,0) + COALESCE(esi_employee,0)
      + COALESCE(professional_tax,0) + COALESCE(tds,0) + COALESCE(advance_recovery,0)
      + COALESCE(lop_deduction,0) + COALESCE(other_deductions,0) + COALESCE(loan_recovery,0)
      + COALESCE(late_coming_deduction,0) + COALESCE(early_exit_deduction,0))) > 1`).get().n).toBe(0);
  expect(C.checkPayslipLedger(db, { month: 11, year: 2026 }).mismatches).toEqual([]);
}

describe('dueCloseMonth (D-10, IST)', () => {
  test('the 13th IST closes last month; the 12th still waits', () => {
    expect(C.dueCloseMonth(new Date('2026-10-12T18:29:59Z'), 13)).toEqual({ month: 8, year: 2026 }); // 23:59 IST 12 Oct
    expect(C.dueCloseMonth(new Date('2026-10-12T18:30:00Z'), 13)).toEqual({ month: 9, year: 2026 }); // 00:00 IST 13 Oct
    expect(C.dueCloseMonth(ist(2027, 1, 5), 13)).toEqual({ month: 11, year: 2026 });
    expect(C.dueCloseMonth(ist(2027, 1, 13), 13)).toEqual({ month: 12, year: 2026 });
    expect(C.dueCloseMonth(ist(2026, 12, 10), 10)).toEqual({ month: 11, year: 2026 });
  });

  test('the cron is daily at 00:45 UTC (06:15 IST), timezone pinned, and the boot run happens once', () => {
    const db = F.newDb();
    const calls = [];
    const cronLib = { schedule: (expr, fn, opts) => { calls.push({ expr, opts, fn }); return { stop() {} }; } };
    const out = F.silently(() => startLoanCloseScheduler(db, { cronLib, now: ist(2026, 10, 13) }));
    expect(LOAN_CLOSE_CRON).toBe('45 0 * * *');
    expect(calls).toEqual([{ expr: '45 0 * * *', opts: { timezone: LOAN_CLOSE_TIMEZONE }, fn: expect.any(Function) }]);
    expect(LOAN_CLOSE_TIMEZONE).toBe('Etc/UTC');
    expect(out.errors).toEqual([]);
    db.close();
  });
});

describe('an empty ledger writes nothing (ruling Q5)', () => {
  test('13 Oct 2026: cron run, boot catch-up twice and the sweep leave every table unchanged', () => {
    const db = F.newDb();
    // A month shaped like production: computed plant Stage 7 for Sep, a held row, a stamped import.
    for (let i = 0; i < 4; i++) worked(db, LF.plant(db), 9, 2026);
    worked(db, LF.plant(db), 9, 2026, 2);
    db.prepare("INSERT INTO monthly_imports (month, year, company, stage_7_done) VALUES (9, 2026, ?, 0)").run(COMPANY);
    stage7(db, 9, 2026);
    expect(db.prepare('SELECT COUNT(*) AS n FROM salary_computations WHERE salary_held = 1').get().n).toBe(1);
    const before = tableCounts(db);
    expect(before.notifications).toBe(0);
    const cronLib = { schedule: () => ({}) };
    const boot1 = F.silently(() => startLoanCloseScheduler(db, { cronLib, now: ist(2026, 10, 13) }));
    const boot2 = F.silently(() => startLoanCloseScheduler(db, { cronLib, now: ist(2026, 10, 13, 2) }));
    const cron = F.silently(() => C.runDailyLoanJobs(db, { now: ist(2026, 10, 13, 0, 45), trigger: 'auto' }));
    for (const r of [boot1, boot2, cron]) {
      expect(r.errors).toEqual([]);
      expect(r.close.results).toEqual([]);
      expect(r.sweep).toMatchObject({ posted: 0, moved: 0, waiting: 0, mismatched: 0, errors: [] });
    }
    expect(tableCounts(db)).toEqual(before);   // every table, incl. audit_log, notifications, loan_closes
    // and a manual close of an empty month refuses without writing
    expect(close(db, 9, 2026, ist(2026, 10, 13), { trigger: 'manual', actor: FIN }).code).toBe('NOT_NEEDED');
    expect(tableCounts(db)).toEqual(before);
    db.close();
  });

  test('a database whose loan tables are not migrated: the daily job is a no-op', () => {
    const db = F.newDb();
    db.prepare("DELETE FROM policy_config WHERE key = 'migration_loans_schema_v2_done'").run();
    const before = tableCounts(db);
    const r = F.silently(() => C.runDailyLoanJobs(db, { now: ist(2026, 10, 13) }));
    expect(r.errors).toEqual([]);
    expect(r.close.skipped).toBe(true);
    expect(tableCounts(db)).toEqual(before);
    db.close();
  });
});

describe('runLoanClose — happy path, idempotency, frozen re-run', () => {
  test('posts, freezes the amount, moves the balance once, writes the close row and its counts', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    worked(db, emp, 11, 2026);
    stage7(db, 11, 2026);
    const r = close(db, 11, 2026, ist(2026, 12, 13));
    expect(r).toMatchObject({ ok: true, posted: 1, postedAmount: 3334, held: 0, shortfall: 0, noSalary: 0, reconciliationOk: true, mismatches: [] });
    const row = closes(db)[0];
    expect(row).toMatchObject({ month: 11, year: 2026, payroll: 'plant', run_by: 'system', trigger_kind: 'auto', posted_count: 1, posted_amount: 3334, reconciliation_ok: 1, run_at: '2026-12-13 01:00:00' });
    expect(deductions(db, loanId)[0]).toMatchObject({ state: 'posted', amount: 3334, posted_close_id: row.id });
    expect(LF.instalments(db, loanId)[0]).toMatchObject({ status: 'posted', posted_amount: 3334, posted_close_id: row.id });
    expect(LF.loan(db, loanId).remaining_balance).toBe(6666);
    expect(L.reconcileLoan(db, loanId).problems).toEqual([]);
    expect(notes(db, 'LOAN_CLOSE_DONE')).toHaveLength(1);
    expect(LF.events(db, loanId).filter((e) => e.event === 'posted')).toHaveLength(1);

    // second call, and the catch-up, write nothing more
    const counts = tableCounts(db);
    expect(close(db, 11, 2026, ist(2026, 12, 13, 3)).code).toBe('ALREADY_CLOSED');
    expect(catchUp(db, ist(2026, 12, 14)).results).toEqual([]);
    expect(tableCounts(db)).toEqual(counts);

    // a later Stage 7 re-run of November deducts exactly the posted amount
    stage7(db, 11, 2026, 'run-2');
    expect(salary(db, emp.code, 11, 2026).loan_recovery).toBe(3334);
    expect(deductions(db, loanId)).toHaveLength(1);
    expect(LF.loan(db, loanId).remaining_balance).toBe(6666);
    expectClean(db);
    db.close();
  });

  test('reimport after the close: salary rows deleted and recomputed — posted amounts come back exactly, nothing double-posts', () => {
    const db = F.newDb();
    const a = LF.activeLoan(db);
    const b = LF.activeLoan(db, { principal: 6000, tenure: 2 });
    worked(db, a.emp, 11, 2026); worked(db, b.emp, 11, 2026, 20);
    stage7(db, 11, 2026);
    close(db, 11, 2026, ist(2026, 12, 13));
    const ledger = { d: [...deductions(db, a.loanId), ...deductions(db, b.loanId)], la: LF.loan(db, a.loanId), lb: LF.loan(db, b.loanId) };
    db.prepare('DELETE FROM salary_computations WHERE month = 11 AND year = 2026').run();   // what import.js does on reimport
    stage7(db, 11, 2026, 'reimport');
    expect(salary(db, a.emp.code, 11, 2026).loan_recovery).toBe(3334);
    expect(salary(db, b.emp.code, 11, 2026).loan_recovery).toBe(3000);
    expect([...deductions(db, a.loanId), ...deductions(db, b.loanId)]).toEqual(ledger.d);
    expect(LF.loan(db, a.loanId)).toEqual(ledger.la);
    expect(LF.loan(db, b.loanId)).toEqual(ledger.lb);
    expectClean(db);
    db.close();
  });

  test('the close that posts the last instalment completes the loan; a re-run still deducts it', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db, { principal: 3000, tenure: 1 });
    worked(db, emp, 11, 2026);
    stage7(db, 11, 2026);
    close(db, 11, 2026, ist(2026, 12, 13));
    expect(LF.loan(db, loanId)).toMatchObject({ status: 'completed', remaining_balance: 0 });
    stage7(db, 11, 2026, 'run-2');
    expect(salary(db, emp.code, 11, 2026).loan_recovery).toBe(3000);
    expectClean(db);
    db.close();
  });
});

describe('readiness (K27): the close waits, and finance is told once a day', () => {
  test('before Stage 7: refused, no row, LOAN_CLOSE_WAITING once per day; then it closes once Stage 7 runs', () => {
    const db = F.newDb();
    const { emp } = LF.activeLoan(db);
    worked(db, emp, 11, 2026);
    let r = catchUp(db, ist(2026, 12, 13));
    expect(r.results).toEqual([expect.objectContaining({ payroll: 'plant', month: 11, ok: false, code: 'STAGE7_NOT_COMPUTED' })]);
    catchUp(db, ist(2026, 12, 13, 5));
    expect(closes(db)).toHaveLength(0);
    expect(notes(db, 'LOAN_CLOSE_WAITING').filter((n) => n.role_target === 'finance')).toHaveLength(1);
    stage7(db, 11, 2026);
    r = catchUp(db, ist(2026, 12, 14));
    expect(r.results).toEqual([expect.objectContaining({ ok: true, month: 11 })]);
    expect(closes(db)).toHaveLength(1);
    db.close();
  });

  test('an import not yet stamped stage_7_done blocks the close', () => {
    const db = F.newDb();
    const { emp } = LF.activeLoan(db);
    worked(db, emp, 11, 2026);
    stage7(db, 11, 2026, 'r', { stampStage: false });
    db.prepare("INSERT INTO monthly_imports (month, year, company, stage_7_done) VALUES (11, 2026, ?, 0)").run(COMPANY);
    expect(close(db, 11, 2026, ist(2026, 12, 13)).code).toBe('STAGE7_NOT_COMPUTED');
    db.prepare('UPDATE monthly_imports SET stage_7_done = 1').run();
    expect(close(db, 11, 2026, ist(2026, 12, 13)).ok).toBe(true);
    db.close();
  });

  test('the month must have ended (IST); an earlier needed month must be closed first', () => {
    const db = F.newDb();
    const { emp } = LF.activeLoan(db);
    worked(db, emp, 11, 2026); worked(db, emp, 12, 2026);
    stage7(db, 11, 2026); stage7(db, 12, 2026);
    expect(close(db, 12, 2026, ist(2026, 12, 31), { actor: FIN, trigger: 'manual' }).code).toBe('MONTH_NOT_ENDED');
    expect(close(db, 12, 2026, ist(2027, 1, 2), { actor: FIN, trigger: 'manual' }).code).toBe('EARLIER_MONTH_OPEN');
    expect(close(db, 11, 2026, ist(2027, 1, 2), { actor: FIN, trigger: 'manual' })).toMatchObject({ ok: true, trigger: 'manual' });
    expect(closes(db)[0]).toMatchObject({ run_by: 'fin1', trigger_kind: 'manual' });
    // finance may close December early (before the 13th)
    expect(close(db, 12, 2026, ist(2027, 1, 2), { actor: FIN, trigger: 'manual' }).ok).toBe(true);
    db.close();
  });

  test('roles: finance, admin and system may close; hr and viewer may not', () => {
    const db = F.newDb();
    expect(close(db, 11, 2026, ist(2026, 12, 13), { actor: HR }).code).toBe('ROLE_NOT_ALLOWED');
    expect(close(db, 11, 2026, ist(2026, 12, 13), { actor: VIEWER }).code).toBe('ROLE_NOT_ALLOWED');
    expect(close(db, 11, 2026, ist(2026, 12, 13), { actor: ADMIN }).code).toBe('NOT_NEEDED');
    db.close();
  });
});

describe('catch-up at boot (K33)', () => {
  test('a server down over two close days closes November then December once; a second boot closes nothing', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    worked(db, emp, 11, 2026); worked(db, emp, 12, 2026);
    stage7(db, 11, 2026); stage7(db, 12, 2026);
    const cronLib = { schedule: () => ({}) };
    const boot = F.silently(() => startLoanCloseScheduler(db, { cronLib, now: ist(2027, 1, 14) }));
    expect(boot.close.results.map((r) => [r.month, r.ok])).toEqual([[11, true], [12, true]]);
    expect(closes(db).map((c) => [c.month, c.trigger_kind])).toEqual([[11, 'catch_up'], [12, 'catch_up']]);
    expect(LF.loan(db, loanId).remaining_balance).toBe(3332);
    const counts = tableCounts(db);
    F.silently(() => startLoanCloseScheduler(db, { cronLib, now: ist(2027, 1, 14, 3) }));
    expect(tableCounts(db)).toEqual(counts);
    db.close();
  });
});

describe('shortfall, no salary, extension limit (D-5, D-19, K6)', () => {
  test('a partial post adds the rest as a new last instalment', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    worked(db, emp, 11, 2026);
    advance(db, emp.code, 11, 2026, 7666.66);           // room 1,000
    stage7(db, 11, 2026);
    const r = close(db, 11, 2026, ist(2026, 12, 13));
    expect(r).toMatchObject({ posted: 1, postedAmount: 1000, shortfall: 1 });
    const ins = LF.instalments(db, loanId);
    expect(ins[0]).toMatchObject({ status: 'posted', posted_amount: 1000 });
    expect(ins[3]).toMatchObject({ origin: 'shortfall', amount_due: 2334, due_month: 2, due_year: 2027 });
    expect(L.reconcileLoan(db, loanId).problems).toEqual([]);
    expectClean(db);
    db.close();
  });

  test('₹0 four months running: three shortfall instalments, then the limit alert reaches finance', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db, { principal: 12000, tenure: 6 });
    const months = [[11, 2026], [12, 2026], [1, 2027], [2, 2027]];
    F.setPolicy(db, 'loan_deduction_cap_pct', '0.01');   // cap ≈ ₹2 …
    for (const [m, y] of months) {
      worked(db, emp, m, y);
      advance(db, emp.code, m, y, 100);                  // … and ₹100 above it → room 0 every month
      stage7(db, m, y);
      expect(salary(db, emp.code, m, y).loan_recovery).toBe(0);
      const due = m === 12 ? ist(y + 1, 1, 13) : ist(y, m + 1, 13);
      const r = close(db, m, y, due);
      expect(r).toMatchObject({ ok: true, posted: 0, deferred: 1, shortfall: 1 });
    }
    const ins = LF.instalments(db, loanId);
    expect(ins.filter((i) => i.origin === 'shortfall')).toHaveLength(3);
    expect(ins.filter((i) => i.status === 'deferred')).toHaveLength(4);
    expect(LF.loan(db, loanId).remaining_balance).toBe(12000);
    const rec = L.reconcileLoan(db, loanId);
    expect(rec.problems).toEqual([]);
    expect(rec.uncovered).toBe(2000);
    const alerts = notes(db, 'LOAN_EXTENSION_LIMIT_REACHED');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].role_target).toBe('finance');
    expectClean(db);
    db.close();
  });

  test('no salary row: the due instalment moves to the end with reason no_salary', () => {
    const db = F.newDb();
    const { loanId } = LF.activeLoan(db);
    const other = LF.plant(db);
    worked(db, other, 11, 2026);
    stage7(db, 11, 2026);
    const r = close(db, 11, 2026, ist(2026, 12, 13));
    expect(r).toMatchObject({ ok: true, posted: 0, noSalary: 1, deferred: 1 });
    const ins = LF.instalments(db, loanId);
    expect(ins[0].status).toBe('deferred');
    expect(ins[3]).toMatchObject({ origin: 'no_salary', amount_due: 3334, due_month: 2, due_year: 2027 });
    expect(LF.events(db, loanId).find((e) => e.event === 'moved_to_end').reason).toMatch(/no_salary: 11\/2026 close: no salary row this month/);
    expect(JSON.parse(closes(db)[0].notes).noSalary).toEqual([expect.objectContaining({ loanId, note: 'no salary row this month' })]);
    expect(L.reconcileLoan(db, loanId).problems).toEqual([]);
    db.close();
  });

  test('a salary row with no deduction (Stage 7 ran before the loan went live) moves the instalment too (ruling Q8)', () => {
    const db = F.newDb();
    const emp = LF.plant(db);
    worked(db, emp, 11, 2026);
    stage7(db, 11, 2026);
    const { loanId } = LF.activeLoan(db, { emp });
    const r = close(db, 11, 2026, ist(2026, 12, 13));
    expect(r).toMatchObject({ noSalary: 1, mismatches: [] });
    expect(LF.events(db, loanId).find((e) => e.event === 'moved_to_end').reason).toMatch(/salary row exists but carried no deduction/);
    db.close();
  });
});

describe('payslip ↔ ledger (K29) and reconciliation (K34, ruling Q11)', () => {
  test('an employee whose payslip disagrees is left provisional and listed; the others post', () => {
    const db = F.newDb();
    const a = LF.activeLoan(db);
    const b = LF.activeLoan(db);
    worked(db, a.emp, 11, 2026); worked(db, b.emp, 11, 2026);
    stage7(db, 11, 2026);
    db.prepare('UPDATE salary_computations SET loan_recovery = 0 WHERE employee_code = ?').run(b.emp.code);
    const r = close(db, 11, 2026, ist(2026, 12, 13));
    expect(r).toMatchObject({ ok: true, posted: 1 });
    expect(r.mismatches).toEqual([{ employeeCode: b.emp.code, payslip: 0, ledger: 3334, salaryRows: 1 }]);
    expect(deductions(db, a.loanId)[0].state).toBe('posted');
    expect(deductions(db, b.loanId)[0].state).toBe('provisional');
    expect(notes(db, 'LOAN_PAYSLIP_LEDGER_MISMATCH')).toHaveLength(1);
    // the sweep posts it once Stage 7 is re-run and the two agree
    stage7(db, 11, 2026, 'run-2');
    const s = F.silently(() => C.runHeldSweep(db, { now: ist(2026, 12, 14) }));
    expect(s.posted).toBe(1);
    expect(deductions(db, b.loanId)[0]).toMatchObject({ state: 'posted', posted_close_id: closes(db)[0].id });
    expect(L.reconcileLoan(db, b.loanId).problems).toEqual([]);
    db.close();
  });

  test('a close that would break a loan\'s reconciliation rolls back entirely and tells admin and finance', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    worked(db, emp, 11, 2026);
    stage7(db, 11, 2026);
    // An engine fault, simulated: posting an instalment also nudges the balance.
    db.exec(`CREATE TRIGGER fault AFTER UPDATE OF status ON loan_instalments WHEN NEW.status = 'posted'
             BEGIN UPDATE loans SET remaining_balance = remaining_balance + 1 WHERE id = NEW.loan_id; END`);
    const before = { d: deductions(db, loanId), l: LF.loan(db, loanId), i: LF.instalments(db, loanId) };
    const r = close(db, 11, 2026, ist(2026, 12, 13));
    expect(r.code).toBe('RECONCILIATION_BROKEN');
    expect(closes(db)).toHaveLength(0);
    expect(deductions(db, loanId)).toEqual(before.d);
    expect(LF.loan(db, loanId)).toEqual(before.l);
    expect(LF.instalments(db, loanId)).toEqual(before.i);
    expect(notes(db, 'LOAN_CLOSE_FAILED').map((n) => n.role_target).sort()).toEqual(['admin', 'finance']);
    db.close();
  });
});

describe('sales (ruling Q7)', () => {
  test('a sales loan with no computed sales payroll makes the sales part wait; the plant close goes ahead regardless', () => {
    const db = F.newDb();
    const plant = LF.activeLoan(db);
    worked(db, plant.emp, 11, 2026);
    stage7(db, 11, 2026);
    const s = LF.activeLoan(db, { borrowerType: 'sales', emp: LF.sales(db) });
    expect(LF.loan(db, s.loanId).borrower_type).toBe('sales');
    const r = catchUp(db, ist(2026, 12, 13));
    expect(r.results).toEqual([
      expect.objectContaining({ payroll: 'plant', month: 11, ok: true }),
      expect.objectContaining({ payroll: 'sales', month: 11, ok: false, code: 'STAGE7_NOT_COMPUTED' }),
    ]);
    expect(closes(db).map((c) => c.payroll)).toEqual(['plant']);
    // Loans PR-8: SALES_CLOSE_NOT_WIRED is gone; the sales close waits like plant does (finance only).
    expect(notes(db, 'LOAN_CLOSE_WAITING').map((n) => n.role_target)).toEqual(['finance']);
    db.close();
  });
});

describe('admin reversal (ruling Q2)', () => {
  test('returns the amount to the schedule; the month\'s re-run deducts ₹0; payslip = ledger; reconciles', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    worked(db, emp, 11, 2026);
    stage7(db, 11, 2026);
    close(db, 11, 2026, ist(2026, 12, 13));
    const d = deductions(db, loanId)[0];
    expect(C.reverseDeduction(db, { deductionId: d.id, reason: 'too short' }, ADMIN).code).toBe('REASON_TOO_SHORT');
    expect(C.reverseDeduction(db, { deductionId: d.id, reason: 'salary for November was not paid' }, FIN).code).toBe('ROLE_NOT_ALLOWED');
    const r = F.silently(() => C.reverseDeduction(db, { deductionId: d.id, reason: 'salary for November was not paid' }, ADMIN));
    expect(r).toMatchObject({ ok: true, amount: 3334, effectivePosted: 0 });
    expect(r.added).toMatchObject({ origin: 'reversal', amount: 3334 });
    expect(LF.loan(db, loanId).remaining_balance).toBe(10000);
    expect(C.checkPayslipLedger(db, { month: 11, year: 2026 }).mismatches).toEqual([{ employeeCode: emp.code, payslip: 3334, ledger: 0, salaryRows: 1 }]);
    expect(notes(db, 'LOAN_DEDUCTION_REVERSED')).toHaveLength(1);
    stage7(db, 11, 2026, 'run-2');
    expect(salary(db, emp.code, 11, 2026).loan_recovery).toBe(0);
    expect(C.reverseDeduction(db, { deductionId: d.id, reason: 'salary for November was not paid' }, ADMIN).code).toBe('NOTHING_TO_REVERSE');
    expect(L.reconcileLoan(db, loanId).problems).toEqual([]);
    expectClean(db);
    db.close();
  });
});

describe('previewClose (the close screen, PR-6b)', () => {
  test('counts what the close would do, writes nothing', () => {
    const db = F.newDb();
    const a = LF.activeLoan(db);
    const h = LF.activeLoan(db);
    LF.activeLoan(db); // no salary
    worked(db, a.emp, 11, 2026); worked(db, h.emp, 11, 2026, 2);
    stage7(db, 11, 2026);
    const counts = tableCounts(db);
    const p = C.previewClose(db, { month: 11, year: 2026, now: ist(2026, 12, 13) });
    expect(p).toMatchObject({ ok: true, readiness: { ok: true }, wouldPost: { count: 1, amount: 3334 }, held: 1, noSalary: 1, mismatches: [], close: null });
    expect(tableCounts(db)).toEqual(counts);
    db.close();
  });
});

describe('drift monitor (ruling Q12)', () => {
  const { runChecks } = require('../services/driftMonitor');
  const status = (db) => Object.fromEntries(F.silently(() => runChecks(db)).results
    .filter((r) => r.check_name.startsWith('loan_')).map((r) => [r.check_name, r.status]));

  test('pass on an empty ledger and on a clean close; catch a balance and a payslip mismatch', () => {
    const db = F.newDb();
    expect(status(db)).toEqual({ loan_balance_reconciles: 'pass', loan_payslip_matches_ledger: 'pass' });
    const { loanId, emp } = LF.activeLoan(db);
    worked(db, emp, 11, 2026);
    stage7(db, 11, 2026);
    close(db, 11, 2026, ist(2026, 12, 13));
    C.reverseDeduction(db, { deductionId: deductions(db, loanId)[0].id, reason: 'salary for November was not paid' }, ADMIN);
    stage7(db, 11, 2026, 'run-2');
    expect(status(db)).toEqual({ loan_balance_reconciles: 'pass', loan_payslip_matches_ledger: 'pass' });
    db.prepare('UPDATE salary_computations SET loan_recovery = 5 WHERE employee_code = ?').run(emp.code);
    db.prepare('UPDATE loans SET remaining_balance = remaining_balance + 1 WHERE id = ?').run(loanId);
    expect(status(db)).toEqual({ loan_balance_reconciles: 'fail', loan_payslip_matches_ledger: 'fail' });
    expect(db.prepare("SELECT severity FROM system_health_checks WHERE check_name = 'loan_payslip_matches_ledger' ORDER BY id DESC").get().severity).toBe('medium');
    db.close();
  });
});

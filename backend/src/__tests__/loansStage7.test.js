/**
 * Loans PR-5 — plant Stage 7 (docs/loans/SPEC.md §5.1, §5.2 r4–r5, D-5, D-6,
 * D-11, D-12; K2, K22–K25, K29).
 *
 * Real schema (initSchema), real engine (PR-2), real recomputeSalary — the one
 * loop the Compute Salary route, the job queue and the reimport recompute use.
 *
 * Fixture month: Nov 2026 (30 days). activeLoan() disburses 5 Oct 2026, so the
 * first EMI is Nov 2026. ₹10,000 over 3 = ₹3,334 / ₹3,334 / ₹3,332. An employee
 * on ₹20,000 gross with 26 payable days earns ₹17,333.33; the 50% cap is
 * ₹8,666.66 (floor to the paisa).
 */
const LF = require('./helpers/loanFixture');
const { F, L, COMPANY, SYS } = LF;
const { recomputeSalary } = require('../services/recompute');

const M = 11;
const Y = 2026;

function stage7(db, requestId = 'run-1', opts = {}) {
  return F.silently(() => recomputeSalary(db, { month: M, year: Y, company: COMPANY, requestId, ...opts }));
}

function worked(db, emp, payable = 26, over = {}) {
  F.addDayCalc(db, emp, M, Y, { days_present: payable, total_payable_days: payable, ...over });
}

const salary = (db, code) => db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?').get(code, M, Y);
const deductions = (db, loanId) => db.prepare('SELECT * FROM loan_deductions WHERE loan_id = ? ORDER BY id').all(loanId);
const eventCount = (db) => db.prepare('SELECT COUNT(*) AS n FROM loan_events').get().n;
const loanAudit = (db) => db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE table_name = 'loans'").get().n;

function advance(db, code, amount) {
  db.prepare(`INSERT INTO salary_advances (employee_code, month, year, is_eligible, advance_amount, paid, recovered, recovery_month, recovery_year)
              VALUES (?, 10, 2026, 1, ?, 1, 0, ?, ?)`).run(code, amount, M, Y);
}

/** Drift, component and clip checks for every salary row in the database. */
function expectClean(db) {
  const drift = db.prepare('SELECT COUNT(*) AS n FROM salary_computations WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1').get().n;
  expect(drift).toBe(0);
  const short = db.prepare(`SELECT COUNT(*) AS n FROM salary_computations
    WHERE ABS(total_deductions - (COALESCE(pf_employee,0) + COALESCE(esi_employee,0)
      + COALESCE(professional_tax,0) + COALESCE(tds,0) + COALESCE(advance_recovery,0)
      + COALESCE(lop_deduction,0) + COALESCE(other_deductions,0) + COALESCE(loan_recovery,0)
      + COALESCE(late_coming_deduction,0) + COALESCE(early_exit_deduction,0))) > 1`).get().n;
  expect(short).toBe(0);
}

/** Every column except the timestamps a re-run legitimately restamps. */
function strip(row, extra = []) {
  if (!row) return row;
  const r = { ...row };
  for (const k of ['computed_at', 'created_at', 'updated_at', ...extra]) delete r[k];
  return r;
}

function snapshot(db, codes, loanIds) {
  return {
    salary: codes.map((c) => strip(salary(db, c))),
    deductions: loanIds.map((id) => deductions(db, id).map((d) => strip(d, ['run_id']))),
    instalments: loanIds.map((id) => LF.instalments(db, id).map((i) => strip(i))),
    loans: loanIds.map((id) => strip(LF.loan(db, id))),
  };
}

describe('Stage 7 with no loans', () => {
  test('loan_recovery is 0, no ledger rows, result reports nothing', () => {
    const db = F.newDb();
    for (let i = 0; i < 3; i++) worked(db, LF.plant(db));
    const out = stage7(db);
    expect(out.errors).toEqual([]);
    expect(out.results).toHaveLength(3);
    expect(db.prepare('SELECT COUNT(*) AS n FROM salary_computations WHERE loan_recovery <> 0').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM loan_deductions').get().n).toBe(0);
    expect(out.loans).toEqual({ recorded: 0, cleared: 0, orphansCleared: 0, alerts: [], staleRows: [], errors: [] });
    expectClean(db);
    db.close();
  });
});

describe('Stage 7 with a live loan', () => {
  test('the EMI due this month is deducted provisionally; the balance does not move', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    worked(db, emp);
    const out = stage7(db);
    expect(out.errors).toEqual([]);
    const row = salary(db, emp.code);
    expect(row.loan_recovery).toBe(3334);
    expect(row.net_salary).toBeCloseTo(row.gross_earned - row.total_deductions, 2);
    const d = deductions(db, loanId);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ payroll: 'plant', month: M, year: Y, amount: 3334, state: 'provisional', run_id: 'run-1', employee_code: emp.code, company: COMPANY });
    expect(LF.instalments(db, loanId).map((i) => i.status)).toEqual(['provisional', 'scheduled', 'scheduled']);
    expect(d[0].instalment_id).toBe(LF.instalments(db, loanId)[0].id);
    expect(LF.loan(db, loanId)).toMatchObject({ remaining_balance: 10000, status: 'active' });
    expect(out.loans.recorded).toBe(1);
    expect(L.reconcileLoan(db, loanId).ok).toBe(true);
    expectClean(db);
    db.close();
  });

  test('Compute Salary three times: rows, instalment states and the event count are identical', () => {
    const db = F.newDb();
    const a = LF.activeLoan(db);
    const b = LF.activeLoan(db, { principal: 6000, tenure: 2 });
    worked(db, a.emp); worked(db, b.emp, 20);
    const other = LF.plant(db); worked(db, other);
    stage7(db, 'run-1');
    const codes = [a.emp.code, b.emp.code, other.code];
    const first = snapshot(db, codes, [a.loanId, b.loanId]);
    const events1 = eventCount(db); const audit1 = loanAudit(db);
    const out2 = stage7(db, 'run-2');
    expect(snapshot(db, codes, [a.loanId, b.loanId])).toEqual(first);
    expect(eventCount(db)).toBe(events1);
    expect(loanAudit(db)).toBe(audit1);
    expect(out2.loans.recorded).toBe(0);
    expect(deductions(db, a.loanId)[0].run_id).toBe('run-2');
    stage7(db, 'run-3');
    expect(snapshot(db, codes, [a.loanId, b.loanId])).toEqual(first);
    expect(eventCount(db)).toBe(events1);
    expectClean(db);
    db.close();
  });

  test('a re-run after pay changes updates the same row in place (one event, no duplicate)', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    worked(db, emp);
    stage7(db);
    const id = deductions(db, loanId)[0].id;
    const ev = eventCount(db);
    advance(db, emp.code, 7000);                // room 8,666.66 − 7,000 = 1,666.66
    stage7(db, 'run-2');
    const d = deductions(db, loanId);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ id, amount: 1666.66, state: 'provisional' });
    expect(salary(db, emp.code).loan_recovery).toBe(1666.66);
    expect(eventCount(db)).toBe(ev + 1);
    expectClean(db);
    db.close();
  });

  test('reimport shape (salary rows deleted, then recomputed) gives the same deduction', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    worked(db, emp);
    stage7(db);
    const before = deductions(db, loanId).map((d) => strip(d, ['run_id']));
    const salaryBefore = strip(salary(db, emp.code), ['id']);
    const ev = eventCount(db);
    // import.js runReimportRecompute deletes the cycle's salary rows, then re-runs Stage 6 + 7.
    db.prepare('DELETE FROM salary_computations WHERE month = ? AND year = ? AND company = ?').run(M, Y, COMPANY);
    const out = stage7(db, 'reimport-1', { scopeStampToCompany: true });
    expect(deductions(db, loanId).map((d) => strip(d, ['run_id']))).toEqual(before);
    expect(strip(salary(db, emp.code), ['id'])).toEqual(salaryBefore);
    expect(eventCount(db)).toBe(ev);
    expect(out.loans.orphansCleared).toBe(0);
    expectClean(db);
    db.close();
  });
});

describe('the cap (D-11) and the order of deductions (D-12)', () => {
  test('a large advance leaves less room: the loan takes only the headroom', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    worked(db, emp);
    advance(db, emp.code, 6000);                // room 8,666.66 − 6,000 = 2,666.66
    stage7(db);
    const row = salary(db, emp.code);
    expect(row.advance_recovery).toBe(6000);
    expect(row.loan_recovery).toBe(2666.66);
    expect(deductions(db, loanId)[0]).toMatchObject({ amount: 2666.66, state: 'provisional' });
    expect(row.total_deductions).toBeLessThanOrEqual(row.gross_earned * 0.5 + 0.01);
    expectClean(db);
    db.close();
  });

  test('no room at all: a ₹0 provisional row is kept for the close, nothing is clipped', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    worked(db, emp);
    advance(db, emp.code, 9000);                // above the cap on its own
    const out = stage7(db);
    const row = salary(db, emp.code);
    expect(row.loan_recovery).toBe(0);
    expect(out.results[0].salaryWarning).toBe('');
    expect(deductions(db, loanId)[0]).toMatchObject({ amount: 0, state: 'provisional' });
    expect(LF.instalments(db, loanId)[0].status).toBe('provisional');
    expectClean(db);
    db.close();
  });

  test('OT and holiday duty are outside gross_earned and are not subtracted from the cap base', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    worked(db, emp, 26, {});
    db.prepare('UPDATE day_calculations SET extra_duty_days = 4, holiday_duty_days = 2 WHERE employee_code = ?').run(emp.code);
    advance(db, emp.code, 5000);
    // Right base: 8,666.66 − 5,000 = 3,666.66 ≥ 3,334. The PR-2 base (gross_earned − OT
    // − holiday duty) would have left 6,666.66 − 5,000 = 1,666.66.
    stage7(db);
    const row = salary(db, emp.code);
    expect(row.ot_pay).toBeGreaterThan(0);
    expect(row.holiday_duty_pay).toBeGreaterThan(0);
    expect(row.loan_recovery).toBe(3334);
    expect(deductions(db, loanId)[0].amount).toBe(3334);
    expectClean(db);
    db.close();
  });

  test('two live loans share the room, oldest loan first', () => {
    const db = F.newDb();
    F.setPolicy(db, 'loan_max_active_per_person', 2);
    F.setPolicy(db, 'loan_emi_ceiling_pct_gross', 100);
    const emp = LF.plant(db);
    const a = LF.activeLoan(db, { emp, principal: 3000, tenure: 3 });   // EMI 1,000
    const b = LF.activeLoan(db, { emp, principal: 3000, tenure: 3 });   // EMI 1,000
    worked(db, emp);
    advance(db, emp.code, 7166.66);              // room 1,500
    stage7(db);
    expect(deductions(db, a.loanId)[0].amount).toBe(1000);
    expect(deductions(db, b.loanId)[0].amount).toBe(500);
    expect(salary(db, emp.code).loan_recovery).toBe(1500);
    expectClean(db);
    db.close();
  });

  test('ignored: a sales loan on the same code, a completed loan, and a loan with nothing due this month', () => {
    const db = F.newDb();
    F.setPolicy(db, 'loan_max_active_per_person', 3);
    F.setPolicy(db, 'loan_emi_ceiling_pct_gross', 100);
    const emp = LF.plant(db);
    const later = LF.activeLoan(db, { emp, principal: 3000, tenure: 3, firstEmiMonth: { month: 12, year: 2026 } });
    db.prepare(`INSERT INTO loans (borrower_type, employee_code, company, loan_type, principal_amount, tenure_months, emi_amount, status, requested_by, remaining_balance)
                VALUES ('sales', ?, ?, 'Personal', 3000, 3, 1000, 'active', 'hr1', 3000)`).run(emp.code, COMPANY);
    db.prepare(`INSERT INTO loans (borrower_type, employee_code, company, loan_type, principal_amount, tenure_months, emi_amount, status, requested_by, remaining_balance)
                VALUES ('plant', ?, ?, 'Personal', 3000, 3, 1000, 'completed', 'hr1', 0)`).run(emp.code, COMPANY);
    for (const id of db.prepare("SELECT id FROM loans WHERE status = 'completed' OR borrower_type = 'sales'").all().map((r) => r.id)) {
      db.prepare("INSERT INTO loan_instalments (loan_id, sequence, due_month, due_year, amount_due, status) VALUES (?, 1, ?, ?, 1000, 'scheduled')").run(id, M, Y);
    }
    worked(db, emp);
    stage7(db);
    expect(salary(db, emp.code).loan_recovery).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM loan_deductions').get().n).toBe(0);
    expect(LF.instalments(db, later.loanId)[0]).toMatchObject({ due_month: 12, status: 'scheduled' });
    db.close();
  });
});

describe('held salary (D-6)', () => {
  test('the deduction is shown and recorded provisional; nothing posts and the balance stays', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    worked(db, emp, 2);                          // < 5 payable days → held
    const out = stage7(db);
    const row = salary(db, emp.code);
    expect(row.salary_held).toBe(1);
    expect(out.held.map((h) => h.code)).toEqual([emp.code]);
    // earned 20,000 × 2/30 = 1,333.33; cap 666.66
    expect(row.loan_recovery).toBe(666.66);
    expect(deductions(db, loanId)[0]).toMatchObject({ amount: 666.66, state: 'provisional' });
    expect(LF.loan(db, loanId).remaining_balance).toBe(10000);
    expectClean(db);
    db.close();
  });
});

describe('one employee failing (per-employee savepoint, K25)', () => {
  function three(db) {
    const loans = [LF.activeLoan(db), LF.activeLoan(db), LF.activeLoan(db)];
    loans.forEach((l) => worked(db, l.emp));
    return loans;
  }

  test('first run: the failing borrower gets no salary row and no loan rows; the others are saved', () => {
    const db = F.newDb();
    const [a, b, c] = three(db);
    db.exec(`CREATE TRIGGER fail_b BEFORE INSERT ON loan_deductions WHEN NEW.employee_code = '${b.emp.code}'
             BEGIN SELECT RAISE(ABORT, 'injected ledger failure'); END;`);
    const out = stage7(db);
    expect(out.errors.map((e) => e.employeeCode)).toEqual([b.emp.code]);
    expect(salary(db, b.emp.code)).toBeUndefined();
    expect(deductions(db, b.loanId)).toEqual([]);
    expect(LF.instalments(db, b.loanId).map((i) => i.status)).toEqual(['scheduled', 'scheduled', 'scheduled']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM loan_events WHERE loan_id = ? AND event LIKE ?').get(b.loanId, 'provisional%').n).toBe(0);
    for (const ok of [a, c]) {
      expect(salary(db, ok.emp.code).loan_recovery).toBe(3334);
      expect(deductions(db, ok.loanId)[0].state).toBe('provisional');
    }
    expectClean(db);
    db.close();
  });

  test('re-run: the failing borrower keeps its prior salary row and provisional rows exactly as they were', () => {
    const db = F.newDb();
    const [a, b, c] = three(db);
    stage7(db, 'run-1');
    const before = {
      salary: salary(db, b.emp.code),
      deductions: deductions(db, b.loanId),
      instalments: LF.instalments(db, b.loanId),
      loan: LF.loan(db, b.loanId),
      events: db.prepare('SELECT * FROM loan_events WHERE loan_id = ? ORDER BY id').all(b.loanId),
    };
    // B's pay changes, and the ledger write for B fails this time.
    advance(db, b.emp.code, 7000);
    db.exec(`CREATE TRIGGER fail_b BEFORE UPDATE ON loan_deductions WHEN NEW.employee_code = '${b.emp.code}'
             BEGIN SELECT RAISE(ABORT, 'injected ledger failure'); END;`);
    const out = stage7(db, 'run-2');
    expect(out.errors.map((e) => e.employeeCode)).toEqual([b.emp.code]);
    expect(salary(db, b.emp.code)).toEqual(before.salary);
    expect(deductions(db, b.loanId)).toEqual(before.deductions);
    expect(LF.instalments(db, b.loanId)).toEqual(before.instalments);
    expect(LF.loan(db, b.loanId)).toEqual(before.loan);
    expect(db.prepare('SELECT * FROM loan_events WHERE loan_id = ? ORDER BY id').all(b.loanId)).toEqual(before.events);
    expect(db.prepare('SELECT recovered FROM salary_advances WHERE employee_code = ?').get(b.emp.code).recovered).toBe(0);
    for (const ok of [a, c]) expect(deductions(db, ok.loanId)[0].run_id).toBe('run-2');
    expectClean(db);
    db.close();
  });
});

describe('employees Stage 7 no longer pays this month (K29)', () => {
  test('zero attendance on a re-run: provisional row reversed, the stale salary row listed and logged', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    worked(db, emp);
    stage7(db);
    const oldRow = salary(db, emp.code);
    db.prepare('UPDATE day_calculations SET days_present = 0, days_half_present = 0, days_wop = 0, total_payable_days = 0 WHERE employee_code = ?').run(emp.code);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    let out;
    try {
      out = recomputeSalary(db, { month: M, year: Y, company: COMPANY, requestId: 'run-2' });
    } finally {
      const warnings = warn.mock.calls.map((c) => c.join(' '));
      warn.mockRestore(); log.mockRestore(); err.mockRestore();
      expect(warnings.some((w) => w.includes('LOAN STALE ROW') && w.includes(emp.code) && w.includes(`${M}/${Y}`))).toBe(true);
    }
    expect(out.loans.staleRows).toEqual([{ employeeCode: emp.code, month: M, year: Y, loanRecovery: 3334, deductionsCleared: 1, reason: 'Zero working days — no attendance recorded' }]);
    expect(out.loans.cleared).toBe(1);
    expect(deductions(db, loanId)[0]).toMatchObject({ state: 'reversed', reversed_by: 'system' });
    expect(LF.instalments(db, loanId)[0].status).toBe('scheduled');
    expect(salary(db, emp.code)).toEqual(oldRow);           // not touched (owner ruling Q3)
    // The next run still lists the stale row, and does not reverse anything twice.
    const again = stage7(db, 'run-3');
    expect(again.loans.staleRows).toEqual([{ employeeCode: emp.code, month: M, year: Y, loanRecovery: 3334, deductionsCleared: 0, reason: 'Zero working days — no attendance recorded' }]);
    expect(again.loans.cleared).toBe(0);
    db.close();
  });

  test('orphan: salary row gone and the employee not in the run → reversed by the sweep', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    const other = LF.plant(db);
    worked(db, emp); worked(db, other);
    stage7(db);
    // Reimport: rows deleted, and the borrower has no attendance in the new file.
    db.prepare('DELETE FROM salary_computations WHERE month = ? AND year = ?').run(M, Y);
    db.prepare('DELETE FROM day_calculations WHERE employee_code = ?').run(emp.code);
    const out = stage7(db, 'reimport-2');
    expect(out.loans.orphansCleared).toBe(1);
    expect(deductions(db, loanId)[0].state).toBe('reversed');
    expect(LF.instalments(db, loanId)[0].status).toBe('scheduled');
    expect(salary(db, other.code)).toBeDefined();
    db.close();
  });

  test('nothing due this month any more → the old provisional row is reversed on the re-run', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    worked(db, emp);
    stage7(db);
    // Simulate the instalment leaving month M without going through Stage 7.
    const ins = LF.instalments(db, loanId)[0];
    db.prepare("UPDATE loan_instalments SET due_month = 12 WHERE id = ?").run(ins.id);
    db.prepare("UPDATE loan_instalments SET due_month = 1, due_year = 2027 WHERE loan_id = ? AND sequence = 2").run(loanId);
    db.prepare("UPDATE loan_instalments SET due_month = 2, due_year = 2027 WHERE loan_id = ? AND sequence = 3").run(loanId);
    stage7(db, 'run-2');
    expect(deductions(db, loanId)[0].state).toBe('reversed');
    expect(salary(db, emp.code).loan_recovery).toBe(0);
    expectClean(db);
    db.close();
  });
});

describe('a month already posted is frozen (K2)', () => {
  test('a re-run deducts exactly the posted amount and reports the unborne part; the ledger is untouched', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    worked(db, emp);
    stage7(db);
    const p = L.postDeduction(db, { deductionId: deductions(db, loanId)[0].id }, SYS);
    expect(p.ok).toBe(true);
    const ledger = { d: deductions(db, loanId), i: LF.instalments(db, loanId), l: LF.loan(db, loanId), ev: eventCount(db) };
    advance(db, emp.code, 7666.66);              // room now 1,000
    const out = stage7(db, 'run-2');
    expect(salary(db, emp.code).loan_recovery).toBe(3334);
    expect(out.loans.alerts).toEqual([expect.objectContaining({ type: 'loan_posted_unborne', loanId, postedAmount: 3334, unborneAmount: 2334, audience: 'finance' })]);
    expect(deductions(db, loanId)).toEqual(ledger.d);
    expect(LF.instalments(db, loanId)).toEqual(ledger.i);
    expect(LF.loan(db, loanId)).toEqual(ledger.l);
    expect(eventCount(db)).toBe(ledger.ev);
    expectClean(db);
    db.close();
  });
});

describe('loan tables not migrated', () => {
  test('the loan step returns ₹0 and Stage 7 still completes', () => {
    const db = F.newDb();
    const { loanId, emp } = LF.activeLoan(db);
    worked(db, emp);
    db.prepare("DELETE FROM policy_config WHERE key = 'migration_loans_schema_v2_done'").run();
    const out = stage7(db);
    expect(out.errors).toEqual([]);
    expect(salary(db, emp.code).loan_recovery).toBe(0);
    expect(deductions(db, loanId)).toEqual([]);
    expectClean(db);
    db.close();
  });
});

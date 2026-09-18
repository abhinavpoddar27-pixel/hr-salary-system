const {
  computeLeavePlan, applyLeavePlan, recomputeLeaves, runYearEndLapse, seedYearOpenings,
} = require('../services/leaveEngine');
const F = require('./helpers/leaveFixture');

const YEAR = 2026;
const who = (plan, code) => plan.employees.find((e) => e.employee_code === code);

describe('leaveEngine — days worked (ruling 1)', () => {
  test('five months of full attendance accumulate, and EL accrues once eligible', () => {
    const db = F.newDb();
    const e = F.addEmployee(db, { code: 'W001' });
    for (let m = 1; m <= 5; m += 1) F.addWorkedMonth(db, e, m, YEAR, 26);

    const below = who(computeLeavePlan(db, { year: YEAR }), 'W001');
    expect(below.days_worked_ytd).toBe(130);
    expect(below.eligible).toBe(false);
    expect(below.el.earned).toBe(0);
    expect(below.days_to_eligibility).toBe(50);

    F.setPolicy(db, 'el_eligibility_days', '100');
    const above = who(computeLeavePlan(db, { year: YEAR }), 'W001');
    expect(above.eligible).toBe(true);
    expect(above.el.earned).toBe(6); // floor(130 / 20) * 1
    db.close();
  });

  test('half days count as 0.5, not 0', () => {
    const db = F.newDb();
    const e = F.addEmployee(db, { code: 'W002' });
    F.addDayCalc(db, e, 1, YEAR, { days_present: 20, days_half_present: 4 });
    expect(who(computeLeavePlan(db, { year: YEAR }), 'W002').days_worked_ytd).toBe(22);
    db.close();
  });

  test('comp-off is counted once — od_days is not added on top of days_present', () => {
    const db = F.newDb();
    const e = F.addEmployee(db, { code: 'W003' });
    // dayCalculation.js already folded the 3 comp-off days into days_present.
    F.addDayCalc(db, e, 1, YEAR, { days_present: 25, od_days: 3 });
    expect(who(computeLeavePlan(db, { year: YEAR }), 'W003').days_worked_ytd).toBe(25);
    db.close();
  });

  test('paid Sundays and paid holidays do not count as days worked', () => {
    const db = F.newDb();
    const e = F.addEmployee(db, { code: 'W004' });
    F.addDayCalc(db, e, 1, YEAR, { days_present: 22, paid_sundays: 4, paid_holidays: 2 });
    expect(who(computeLeavePlan(db, { year: YEAR }), 'W004').days_worked_ytd).toBe(22);
    db.close();
  });

  test('WOP and EL used both count as days worked', () => {
    const db = F.newDb();
    const e = F.addEmployee(db, { code: 'W005' });
    F.addDayCalc(db, e, 1, YEAR, { days_present: 20, days_wop: 2, el_used: 3 });
    expect(who(computeLeavePlan(db, { year: YEAR }), 'W005').days_worked_ytd).toBe(25);
    db.close();
  });

  test('a skipped month does not reset the running total (defect a)', () => {
    const db = F.newDb();
    const e = F.addEmployee(db, { code: 'W006' });
    F.addWorkedMonth(db, e, 1, YEAR, 26);
    // February has no Stage 6 row at all.
    F.addWorkedMonth(db, e, 3, YEAR, 26);
    const plan = computeLeavePlan(db, { year: YEAR });
    const s = who(plan, 'W006');
    expect(s.days_worked_ytd).toBe(52);
    const el = plan.ledger
      .filter((r) => r.employee_code === 'W006' && r.leave_type === 'EL' && r.month <= 3)
      .sort((a, b) => a.month - b.month);
    // Feb sits between two worked months and must carry the total forward, not reset it.
    expect(el.map((r) => r.paid_days_ytd)).toEqual([26, 26, 52]);
    expect(el[1].paid_days_this_month).toBe(0);
    db.close();
  });
});

describe('leaveEngine — eligibility boundary (ruling 2)', () => {
  test('179 days worked earns nothing; 180 earns the full floor', () => {
    const mk = (total) => {
      const db = F.newDb();
      const e = F.addEmployee(db, { code: 'B001' });
      let left = total;
      for (let m = 1; m <= 9 && left > 0; m += 1) {
        const d = Math.min(20, left);
        F.addWorkedMonth(db, e, m, YEAR, d);
        left -= d;
      }
      const s = who(computeLeavePlan(db, { year: YEAR }), 'B001');
      db.close();
      return s;
    };
    const at179 = mk(179);
    expect(at179.days_worked_ytd).toBe(179);
    expect(at179.eligible).toBe(false);
    expect(at179.el.earned).toBe(0);
    expect(at179.days_to_eligibility).toBe(1);

    const at180 = mk(180);
    expect(at180.days_worked_ytd).toBe(180);
    expect(at180.eligible).toBe(true);
    expect(at180.el.earned).toBe(9); // floor(180 / 20) * 1
    db_noop();
  });
});
function db_noop() { /* keeps the boundary test readable */ }

describe('leaveEngine — leave used', () => {
  test('leave spanning a month end lands in both months (defect d)', () => {
    const db = F.newDb();
    const e = F.addEmployee(db, { code: 'S001', weekly_off_day: 0 });
    db.prepare('DELETE FROM holidays').run();
    // No Stage 6 rows for March/April, so the engine expands the application.
    F.addApplication(db, e, { leave_type: 'EL', start_date: '2026-03-30', end_date: '2026-04-02', days: 4 });

    computeLeavePlan(db, { year: YEAR }); // exercise the pure path
    const plan = computeLeavePlan(db, { year: YEAR });
    const mar = plan.ledger.find((r) => r.employee_code === 'S001' && r.leave_type === 'EL' && r.month === 3);
    const apr = plan.ledger.find((r) => r.employee_code === 'S001' && r.leave_type === 'EL' && r.month === 4);

    // Independent expectation: every date in the range that is not a Sunday.
    const dates = ['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02'];
    const notSunday = dates.filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() !== 0);
    const expectMar = notSunday.filter((d) => d.startsWith('2026-03')).length;
    const expectApr = notSunday.filter((d) => d.startsWith('2026-04')).length;

    expect(mar.used).toBe(expectMar);
    expect(apr.used).toBe(expectApr);
    expect(mar.used + apr.used).toBe(notSunday.length);
    expect(mar.used).toBeGreaterThan(0);
    expect(apr.used).toBeGreaterThan(0);
    db.close();
  });

  test('a Stage 6 row wins over the application expansion for that month', () => {
    const db = F.newDb();
    const e = F.addEmployee(db, { code: 'S002' });
    F.addDayCalc(db, e, 3, YEAR, { days_present: 20, el_used: 2 });
    F.addApplication(db, e, { leave_type: 'EL', start_date: '2026-03-02', end_date: '2026-03-06', days: 5 });
    const plan = computeLeavePlan(db, { year: YEAR });
    const mar = plan.ledger.find((r) => r.employee_code === 'S002' && r.leave_type === 'EL' && r.month === 3);
    expect(mar.used).toBe(2);
    db.close();
  });

  test('weekly offs and holidays are skipped when expanding an application', () => {
    const db = F.newDb();
    const e = F.addEmployee(db, { code: 'S003', weekly_off_day: 0 });
    db.prepare('DELETE FROM holidays').run(); // the schema seeds 20 real ones
    db.prepare("INSERT INTO holidays (date, name, type) VALUES ('2026-03-03', 'Test Holiday', 'National')").run();
    F.addApplication(db, e, { leave_type: 'CL', start_date: '2026-03-02', end_date: '2026-03-04', days: 3 });
    const plan = computeLeavePlan(db, { year: YEAR });
    const mar = plan.ledger.find((r) => r.employee_code === 'S003' && r.leave_type === 'CL' && r.month === 3);
    expect(mar.used).toBe(2); // 2 Mar + 4 Mar; 3 Mar is a holiday
    db.close();
  });
});

describe('leaveEngine — adjustments, external grants, employee selection', () => {
  test('a manual credit survives a recompute and is not doubled', () => {
    const db = F.newDb();
    F.enableAutomation(db);
    const e = F.addEmployee(db, { code: 'A001' });
    F.addWorkedMonth(db, e, 1, YEAR, 26);
    F.addTransaction(db, e, { leave_type: 'EL', transaction_type: 'Credit', days: 2, reference_month: 1 });

    recomputeLeaves(db, { year: YEAR, dryRun: false, allowWrite: true });
    const first = F.getBalance(db, e, 'EL', YEAR).balance;
    expect(first).toBe(2);

    recomputeLeaves(db, { year: YEAR, dryRun: false, allowWrite: true });
    expect(F.getBalance(db, e, 'EL', YEAR).balance).toBe(2);
    db.close();
  });

  test('a finance apply-leave transaction is excluded and reported separately', () => {
    const db = F.newDb();
    const e = F.addEmployee(db, { code: 'A002' });
    // The finance screen writes both of these together.
    db.prepare(`INSERT INTO attendance_processed (employee_code, date, status_final, correction_source)
                VALUES (?, '2026-02-10', 'CL', 'leave_correction')`).run(e.code);
    F.addTransaction(db, e, { leave_type: 'CL', transaction_type: 'Debit', days: 1, reference_month: 2, approved_by: 'finance1' });
    // A genuine manual debit in the same month, same type, different size.
    F.addTransaction(db, e, { leave_type: 'CL', transaction_type: 'Debit', days: 2, reference_month: 2 });

    const plan = computeLeavePlan(db, { year: YEAR });
    expect(plan.unresolved_finance_rows).toHaveLength(1);
    expect(plan.unresolved_finance_rows[0].leave_type).toBe('CL');
    expect(who(plan, 'A002').cl.adjustments).toBe(-2); // only the manual one
    db.close();
  });

  test("external 'leave_taken' counts as days worked; 'paid_salary' does not", () => {
    const db = F.newDb();
    const taken = F.addEmployee(db, { code: 'X001' });
    const paid = F.addEmployee(db, { code: 'X002' });
    F.addWorkedMonth(db, taken, 1, YEAR, 20);
    F.addWorkedMonth(db, paid, 1, YEAR, 20);
    F.addExternalGrant(db, taken, { month: 1, days: 3, mode: 'leave_taken' });
    F.addExternalGrant(db, paid, { month: 1, days: 3, mode: 'paid_salary' });

    const plan = computeLeavePlan(db, { year: YEAR });
    expect(who(plan, 'X001').days_worked_ytd).toBe(23);
    expect(who(plan, 'X002').days_worked_ytd).toBe(20);
    // Both consume balance.
    expect(who(plan, 'X001').el.external).toBe(3);
    expect(who(plan, 'X002').el.external).toBe(3);
    expect(who(plan, 'X002').el.new_balance).toBe(-3);
    db.close();
  });

  test("an employee stored with company 'null' or blank still earns (defect e)", () => {
    const db = F.newDb();
    const nullCo = F.addEmployee(db, { code: 'C001', company: 'null' });
    const blankCo = F.addEmployee(db, { code: 'C002', company: '' });
    F.addWorkedMonth(db, nullCo, 1, YEAR, 26);
    F.addWorkedMonth(db, blankCo, 1, YEAR, 26);
    const plan = computeLeavePlan(db, { year: YEAR });
    expect(who(plan, 'C001').days_worked_ytd).toBe(26);
    expect(who(plan, 'C002').days_worked_ytd).toBe(26);
    db.close();
  });

  test('contractors and non-permanent employees are skipped', () => {
    const db = F.newDb();
    F.addEmployee(db, { code: 'P001' });
    F.addEmployee(db, { code: 'N001', employment_type: 'Contract' });
    F.addEmployee(db, { code: 'N002', employment_type: '', is_contractor: 1 });
    F.addEmployee(db, { code: 'N004', employment_type: 'Contractual' });
    F.addEmployee(db, { code: 'N003', employment_type: 'Permanent', status: 'Left' });
    const codes = computeLeavePlan(db, { year: YEAR }).employees.map((e) => e.employee_code);
    expect(codes).toEqual(['P001']);
    db.close();
  });

  test('employment_type matching ignores case and padding', () => {
    const db = F.newDb();
    F.addEmployee(db, { code: 'P002', employment_type: '  permanent ' });
    expect(computeLeavePlan(db, { year: YEAR }).employees.map((e) => e.employee_code)).toEqual(['P002']);
    db.close();
  });
});

describe('leaveEngine — write gates (ruling 9) and idempotency', () => {
  test('a dry run writes nothing', () => {
    const db = F.newDb();
    F.enableAutomation(db);
    const e = F.addEmployee(db, { code: 'D001' });
    F.addWorkedMonth(db, e, 1, YEAR, 26);
    const before = F.rowCounts(db);
    const out = recomputeLeaves(db, { year: YEAR, dryRun: true });
    expect(out.applied).toBe(false);
    expect(F.rowCounts(db)).toEqual(before);
    expect(out.plan.employees).toHaveLength(1);
    db.close();
  });

  test('apply is refused while automation is off and nothing is acknowledged', () => {
    const db = F.newDb();
    const e = F.addEmployee(db, { code: 'D002' });
    F.addWorkedMonth(db, e, 1, YEAR, 26);
    const plan = computeLeavePlan(db, { year: YEAR });

    const off = applyLeavePlan(db, plan, { actor: 'test' });
    expect(off.applied).toBe(false);
    expect(off.reason).toBe('automation_disabled');
    expect(db.prepare("SELECT status FROM leave_recompute_runs WHERE id = ?").get(off.run_id).status)
      .toBe('skipped_disabled');
    expect(F.rowCounts(db).ledger).toBe(0);

    // Automation on, but the outside-the-system EL list is neither uploaded nor waived.
    F.setPolicy(db, 'leave_automation_enabled', 'true');
    const blocked = applyLeavePlan(db, plan, { actor: 'test' });
    expect(blocked.applied).toBe(false);
    expect(blocked.reason).toBe('external_grants_not_acknowledged');
    expect(F.rowCounts(db).ledger).toBe(0);

    // Acknowledging "there is no outside list" unblocks it.
    F.setPolicy(db, 'leave_external_grants_acknowledged', 'true');
    expect(applyLeavePlan(db, plan, { actor: 'test' }).applied).toBe(true);
    expect(F.rowCounts(db).ledger).toBeGreaterThan(0);
    db.close();
  });

  test('an explicit allowWrite bypasses the automation switch but not the grants gate', () => {
    const db = F.newDb();
    const e = F.addEmployee(db, { code: 'D003' });
    F.addWorkedMonth(db, e, 1, YEAR, 26);
    const plan = computeLeavePlan(db, { year: YEAR });
    expect(applyLeavePlan(db, plan, { allowWrite: true }).reason).toBe('external_grants_not_acknowledged');
    F.setPolicy(db, 'leave_external_grants_acknowledged', 'true');
    expect(applyLeavePlan(db, plan, { allowWrite: true }).applied).toBe(true);
    db.close();
  });

  test('two identical runs produce identical ledger and balances', () => {
    const db = F.newDb();
    F.enableAutomation(db);
    const a = F.addEmployee(db, { code: 'I001' });
    const b = F.addEmployee(db, { code: 'I002', date_of_joining: '2026-05-10' });
    for (let m = 1; m <= 6; m += 1) { F.addWorkedMonth(db, a, m, YEAR, 24); F.addWorkedMonth(db, b, m, YEAR, 18); }

    const snap = () => JSON.stringify({
      l: db.prepare('SELECT * FROM leave_accrual_ledger ORDER BY employee_code, leave_type, month').all(),
      b: db.prepare('SELECT * FROM leave_balances ORDER BY employee_id, leave_type').all(),
    });
    recomputeLeaves(db, { year: YEAR, dryRun: false, allowWrite: true });
    const first = snap();
    recomputeLeaves(db, { year: YEAR, dryRun: false, allowWrite: true });
    expect(snap()).toBe(first);
    db.close();
  });

  test('a year-end lapse row survives a later recompute', () => {
    const db = F.newDb();
    F.enableAutomation(db);
    const e = F.addEmployee(db, { code: 'L001' });
    F.addWorkedMonth(db, e, 1, YEAR, 26);
    recomputeLeaves(db, { year: YEAR, dryRun: false, allowWrite: true });
    db.prepare("UPDATE leave_accrual_ledger SET lapsed = 5 WHERE employee_code = 'L001' AND month = 1 AND leave_type = 'CL'").run();
    recomputeLeaves(db, { year: YEAR, dryRun: false, allowWrite: true });
    expect(db.prepare("SELECT lapsed FROM leave_accrual_ledger WHERE employee_code='L001' AND month=1 AND leave_type='CL'").get().lapsed).toBe(5);
    db.close();
  });
});

describe('leaveEngine — CL, year end and seeding', () => {
  test('CL opening is pro-rated by joining month off cl_entitlement_base', () => {
    const db = F.newDb();
    F.addEmployee(db, { code: 'K001', date_of_joining: '2024-06-01' }); // prior year -> full 7
    F.addEmployee(db, { code: 'K002', date_of_joining: '2026-09-01' }); // Sep -> 3
    F.addEmployee(db, { code: 'K003', date_of_joining: '2026-11-20' }); // Dec effective -> 2
    const plan = computeLeavePlan(db, { year: YEAR });
    expect(who(plan, 'K001').cl.opening).toBe(7);
    expect(who(plan, 'K002').cl.opening).toBe(3);
    expect(who(plan, 'K003').cl.opening).toBe(2);
    db.close();
  });

  test('an opening HR set by hand is respected, and flagged in the reasons', () => {
    const db = F.newDb();
    const e = F.addEmployee(db, { code: 'K004' });
    F.setBalance(db, e, 'CL', YEAR, { opening: 12, balance: 12 });
    const s = who(computeLeavePlan(db, { year: YEAR }), 'K004');
    expect(s.cl.opening).toBe(12);
    expect(s.cl.computed_opening).toBe(7);
    expect(s.reasons.join(' ')).toMatch(/CL opening on file is 12/);
    db.close();
  });

  test('year-end lapse zeroes both types, records the lapse and reports it', () => {
    const db = F.newDb();
    const e = F.addEmployee(db, { code: 'Y001' });
    F.setBalance(db, e, 'CL', YEAR, { opening: 7, balance: 4 });
    F.setBalance(db, e, 'EL', YEAR, { opening: 0, accrued: 9, used: 3, balance: 6 });

    const dry = runYearEndLapse(db, YEAR, { dryRun: true });
    expect(dry.applied).toBe(false);
    expect(dry.totals).toEqual({ rows: 2, cl_days: 4, el_days: 6 });
    expect(F.getBalance(db, e, 'CL', YEAR).balance).toBe(4);

    const live = runYearEndLapse(db, YEAR, { dryRun: false, actor: 'admin1' });
    expect(live.applied).toBe(true);
    expect(F.getBalance(db, e, 'CL', YEAR).balance).toBe(0);
    expect(F.getBalance(db, e, 'EL', YEAR).balance).toBe(0);
    expect(db.prepare("SELECT COUNT(*) c FROM leave_transactions WHERE transaction_type='Year-End Lapse'").get().c).toBe(2);
    expect(db.prepare("SELECT lapsed FROM leave_accrual_ledger WHERE employee_code='Y001' AND month=12 AND leave_type='EL'").get().lapsed).toBe(6);
    db.close();
  });

  test('seedYearOpenings is idempotent', () => {
    const db = F.newDb();
    F.addEmployee(db, { code: 'Z001', date_of_joining: '2024-01-01' });
    F.addEmployee(db, { code: 'Z002', employment_type: 'Contract' });
    const first = seedYearOpenings(db, 2027);
    expect(first.seeded).toBe(2); // CL + EL for the one eligible employee
    const second = seedYearOpenings(db, 2027);
    expect(second.skipped).toBe(true);
    expect(db.prepare('SELECT COUNT(*) c FROM leave_balances WHERE year = 2027').get().c).toBe(2);
    const cl = db.prepare("SELECT opening FROM leave_balances WHERE year=2027 AND leave_type='CL'").get();
    expect(cl.opening).toBe(7);
    db.close();
  });
});

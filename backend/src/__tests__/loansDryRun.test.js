/**
 * Loans PR-11 — production dry run: real engine, live-shaped data, ONE
 * transaction that is always rolled back (services/loans/dryRun.js).
 *
 * The proof used everywhere here is independent of the service's own
 * fingerprint: dumpAll() hashes the FULL contents of EVERY table (ordered by
 * rowid). After a dry run the dump must be identical, except audit_log, which
 * must have gained exactly one row — action_type 'loan_dry_run', written after
 * the rollback (owner ruling Q1).
 *
 * getDb() is mocked to the test database and logAudit() writes into it, as in
 * production (where getDb() IS the handle the dry run uses): the late-coming
 * logAudit() inside saveSalaryComputation lands inside the transaction and must
 * be rolled back with it.
 */
const crypto = require('crypto');

jest.mock('../database/db', () => {
  const state = { db: null, auditCalls: 0 };
  return {
    __testSetDb: (d) => { state.db = d; },
    __auditCalls: () => state.auditCalls,
    getDb: () => state.db,
    logAudit: (table, recordId, field, oldV, newV, stage, remark) => {
      state.auditCalls += 1;
      state.db.prepare('INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, stage, remark) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(table, recordId, field, String(oldV ?? ''), String(newV ?? ''), stage, remark);
    },
  };
});

const dbMock = require('../database/db');
const LF = require('./helpers/loanFixture');
const SF = require('./helpers/salesLoanFixture');
const { F, L, COMPANY } = LF;
const D = require('../services/loans/dryRun');
const { recomputeSalary } = require('../services/recompute');

const NOW = new Date(Date.UTC(2026, 9, 10, 6, 0, 0));   // 10 Oct 2026 11:30 IST
const ADMIN = { username: 'boss', role: 'admin' };

// ── helpers ─────────────────────────────────────────────────────────────────

function dumpAll(db, auditMax) {
  const out = {};
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()) {
    // audit_log: only the rows that existed before; sqlite_sequence: without
    // audit_log's counter (the one deliberate post-rollback row advances it).
    const where = name === 'audit_log' ? ` WHERE id <= ${Number(auditMax)}`
      : name === 'sqlite_sequence' ? " WHERE name <> 'audit_log'" : '';
    const h = crypto.createHash('sha256');
    for (const row of db.prepare(`SELECT * FROM "${name}"${where} ORDER BY rowid`).raw().iterate()) h.update(JSON.stringify(row));
    out[name] = h.digest('hex');
  }
  return out;
}
const auditMax = (db) => db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM audit_log').get().m;

/** Asserts the database is exactly as before, plus one 'loan_dry_run' audit row. */
function expectUntouched(db, before) {
  expect(dumpAll(db, before.auditMax)).toEqual(before.dump);
  const added = db.prepare('SELECT action_type, changed_by, remark FROM audit_log WHERE id > ?').all(before.auditMax);
  expect(added).toHaveLength(1);
  expect(added[0].action_type).toBe('loan_dry_run');
  expect(added[0].changed_by).toBe('boss');
  return JSON.parse(added[0].remark);
}
const snap = (db) => { const m = auditMax(db); return { auditMax: m, dump: dumpAll(db, m) }; };

function plantEmp(db, month, year, over = {}) {
  const emp = LF.plant(db, over);
  F.addDayCalc(db, { code: emp.code, company: COMPANY }, month, year, { days_present: 26, total_payable_days: 26 });
  const ins = db.prepare("INSERT OR IGNORE INTO attendance_processed (employee_code, date, status_original, status_final, company, month, year) VALUES (?, ?, 'P', 'P', ?, ?, ?)");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let d = last - 7; d <= last; d++) ins.run(emp.code, `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`, COMPANY, month, year);
  return emp;
}
const storedStage7 = (db, month, year) => F.silently(() => recomputeSalary(db, { month, year, company: COMPANY, requestId: 'stored' }));

function advance(db, code, month, year, amount) {
  db.prepare(`INSERT INTO salary_advances (employee_code, month, year, is_eligible, advance_amount, paid, recovered, recovery_month, recovery_year)
              VALUES (?, ?, ?, 1, ?, 1, 0, ?, ?)`).run(code, month === 1 ? 12 : month - 1, month === 1 ? year - 1 : year, amount, month, year);
}

/** A plant world for Sep 2026: three employees with stored Stage 7 rows. */
function plantWorld() {
  const db = F.newDb();
  dbMock.__testSetDb(db);
  const a = plantEmp(db, 9, 2026);
  const b = plantEmp(db, 9, 2026);
  const c = plantEmp(db, 9, 2026);
  advance(db, b.code, 9, 2026, 7500);   // eats most of b's headroom → shortfall
  storedStage7(db, 9, 2026);
  return { db, a, b, c };
}

const run = (db, input, opts = {}) => F.silently(() => D.runLoanDryRun(db, { month: 9, year: 2026, payroll: 'plant', ...input }, ADMIN, { now: NOW, ...opts }));
const sc = (emp, over = {}) => ({ employeeCode: emp.code, company: COMPANY, principal: 10000, tenure: 3, ...over });

// ── plant ───────────────────────────────────────────────────────────────────

describe('plant dry run', () => {
  test('happy path: loan raised, approved, disbursed, deducted, posted at the close — and nothing is saved', () => {
    const { db, a } = plantWorld();
    const before = snap(db);
    const r = run(db, { scenarios: [sc(a)] });
    expect(r.ok).toBe(true);
    expect(r.nothingSaved).toBe(true);
    expect(r.verification.rollbackVerified).toBe(true);
    expect(r.verification.differences).toEqual([]);
    const s = r.scenarios[0];
    expect(s.refusal).toBeNull();
    expect(s.firstEmiMonth).toEqual({ month: 9, year: 2026 });
    expect(s.dueInMonth).toBe(3334);
    expect(s.deductedInMonth).toBe(3334);
    expect(s.salary.rerunWithLoan.loan_recovery).toBe(3334);
    expect(s.salary.loanEffectOnNet).toBe(-3334);
    expect(s.salary.staleNetDifference).toBe(0);
    expect(r.close.result.ok).toBe(true);
    expect(r.close.result.posted).toBe(1);
    expect(r.close.result.trigger).toBe('dry_run');
    expect(s.reconciliation.ok).toBe(true);
    expect(s.loanAfter.remainingBalance).toBe(6666);
    expect(s.deductions).toEqual([{ month: 9, year: 2026, amount: 3334, state: 'posted' }]);
    expect(s.payslipLine.show).toBe(true);
    expect(r.checks.ok).toBe(true);
    expect(r.totals.loansCreated).toBe(1);
    expect(r.totals.deductedInMonth).toBe(3334);
    expect(r.timings.lockMs).toBeGreaterThanOrEqual(0);
    const audit = expectUntouched(db, before);
    expect(audit.rollbackVerified).toBe(true);
    expect(audit.scenarios).toHaveLength(1);
    expect(audit.timings).toHaveProperty('lockMs');
    expect(db.prepare('SELECT COUNT(*) AS n FROM loans').get().n).toBe(0);
    db.close();
  });

  test('stale Stage 6: stored vs re-run difference is reported apart from the loan effect', () => {
    const { db, a } = plantWorld();
    db.prepare('UPDATE day_calculations SET total_payable_days = 20, days_present = 20, salary_stale = 1 WHERE employee_code = ?').run(a.code);
    const before = snap(db);
    const r = run(db, { scenarios: [sc(a)] });
    expect(r.ok).toBe(true);
    const s = r.scenarios[0];
    expect(s.salary.staleNetDifference).toBeLessThan(-1);                 // pre-existing staleness, not the loan
    expect(s.salary.loanEffectOnNet).toBe(-s.deductedInMonth);           // the loan's own effect
    expect(r.totals.staleRows).toBe(1);
    expectUntouched(db, before);
    db.close();
  });

  test('shortfall: low headroom deducts what fits, the rest becomes a new last instalment', () => {
    const { db, b } = plantWorld();
    const before = snap(db);
    const r = run(db, { scenarios: [sc(b)] });
    expect(r.ok).toBe(true);
    const s = r.scenarios[0];
    expect(s.deductedInMonth).toBeLessThan(3334);
    expect(s.deductedInMonth).toBe(s.headroom.headroom);
    expect(r.close.result.shortfall).toBe(1);
    expect(s.scheduleAfter.some((i) => i.origin === 'shortfall')).toBe(true);
    expect(s.reconciliation.ok).toBe(true);
    expect(r.checks.componentShort).toEqual([]);
    expectUntouched(db, before);
    db.close();
  });

  test('hold toggle: the close leaves the EMI provisional', () => {
    const { db, c } = plantWorld();
    const before = snap(db);
    const r = run(db, { scenarios: [sc(c, { hold: true })] });
    expect(r.ok).toBe(true);
    expect(r.scenarios[0].salary.heldAtClose).toBe(true);
    expect(r.close.result.held).toBe(1);
    expect(r.close.result.posted).toBe(0);
    expect(r.scenarios[0].deductions[0].state).toBe('provisional');
    expectUntouched(db, before);
    db.close();
  });

  test('Mark Left: the schedule collapses into the exit month; what is left is the exit residual', () => {
    const { db, a } = plantWorld();
    const before = snap(db);
    const r = run(db, { scenarios: [sc(a, { principal: 30000, tenure: 6, markLeft: true })] });
    expect(r.ok).toBe(true);
    const s = r.scenarios[0];
    expect(s.exit.exitDate).toBe('2026-09-30');
    expect(s.loanAfter.status).toBe('recover_at_exit');
    expect(s.dueInMonth).toBe(30000);
    expect(s.deductedInMonth).toBeLessThan(30000);
    expect(r.exitResiduals.residuals).toHaveLength(1);
    expect(r.exitResiduals.residuals[0].residual).toBe(Math.round((30000 - s.deductedInMonth) * 100) / 100);
    expect(s.reconciliation.ok).toBe(true);
    expectUntouched(db, before);
    db.close();
  });

  test('an ineligible scenario is refused and reported; the others still run', () => {
    const { db, a } = plantWorld();
    const contract = plantEmp(db, 9, 2026, { employment_type: 'Contract' });
    const before = snap(db);
    const r = run(db, { scenarios: [sc(contract), sc(a)] });
    expect(r.ok).toBe(true);
    expect(r.scenarios[0].refusal.stage).toBe('request');
    expect(r.scenarios[0].refusal.code).toBe('NOT_ELIGIBLE');
    expect(r.scenarios[0].loanId).toBeNull();
    expect(r.scenarios[1].deductedInMonth).toBe(3334);
    expect(r.totals.refused).toBe(1);
    expectUntouched(db, before);
    db.close();
  });

  test('offset 0: paid out in M, first EMI M+1; with M+1 data both Stage 7s and both closes run', () => {
    const db = F.newDb();
    dbMock.__testSetDb(db);
    const a = plantEmp(db, 8, 2026);
    F.addDayCalc(db, { code: a.code, company: COMPANY }, 9, 2026, { days_present: 26, total_payable_days: 26 });
    const ins = db.prepare("INSERT OR IGNORE INTO attendance_processed (employee_code, date, status_original, status_final, company, month, year) VALUES (?, ?, 'P', 'P', ?, 9, 2026)");
    for (let d = 23; d <= 30; d++) ins.run(a.code, `2026-09-${d}`, COMPANY);
    storedStage7(db, 8, 2026);
    storedStage7(db, 9, 2026);
    const before = snap(db);
    const r = run(db, { month: 8, scenarios: [sc(a, { disburseMonthOffset: 0 })] });
    expect(r.ok).toBe(true);
    const s = r.scenarios[0];
    expect(s.firstEmiMonth).toEqual({ month: 9, year: 2026 });
    expect(s.deductedInMonth).toBe(0);
    expect(r.close.result.code).toBe('NOT_NEEDED');               // nothing due in Aug
    expect(r.nextMonth.skipped).toBe(false);
    expect(r.nextMonth.close.ok).toBe(true);
    expect(r.nextMonth.close.posted).toBe(1);
    expect(r.nextMonth.salary[0].row.loan_recovery).toBe(3334);
    expectUntouched(db, before);
    db.close();
  });

  test('no M+1 data → nextMonth skipped with a reason', () => {
    const { db, a } = plantWorld();
    const r = run(db, { scenarios: [sc(a)] });
    expect(r.nextMonth).toMatchObject({ month: 10, year: 2026, skipped: true });
    db.close();
  });

  test('logAudit() through getDb() during Stage 7 lands inside the transaction and is rolled back', () => {
    const { db, a } = plantWorld();
    db.prepare(`INSERT INTO late_coming_deductions (employee_code, month, year, company, late_count, deduction_days, remark, applied_by, finance_status)
                VALUES (?, 9, 2026, ?, 4, 1, 'late', 'hr1', 'approved')`).run(a.code, COMPANY);
    storedStage7(db, 9, 2026);
    const calls = dbMock.__auditCalls();
    const before = snap(db);
    const r = run(db, { scenarios: [sc(a)] });
    expect(r.ok).toBe(true);
    expect(dbMock.__auditCalls()).toBeGreaterThan(calls);           // it really was called during the run
    expectUntouched(db, before);                                      // … and nothing of it survived
    db.close();
  });
});

// ── rollback proof under failure ────────────────────────────────────────────

describe('a failure at any step still rolls everything back', () => {
  test.each(D.DRY_RUN_STEPS)('throw at step "%s"', (step) => {
    const { db, a, b } = plantWorld();
    const before = snap(db);
    const r = run(db, { scenarios: [sc(a), sc(b, { hold: true })] }, { hooks: { [step]: () => { throw new Error(`injected at ${step}`); } } });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('DRY_RUN_FAILED');
    expect(r.status).toBe(200);
    expect(r.failedAt).toBe(step);
    expect(r.nothingSaved).toBe(true);
    expect(r.verification.rollbackVerified).toBe(true);
    const audit = expectUntouched(db, before);
    expect(audit.failedAt).toBe(step);
    db.close();
  });

  test('a throw INSIDE the loan close (after Stage 7 wrote salary rows and ledger rows) is rolled back', () => {
    const { db, a } = plantWorld();
    const before = snap(db);
    const spy = jest.spyOn(L, 'runLoanClose').mockImplementation(() => { throw new Error('close exploded'); });
    try {
      const r = run(db, { scenarios: [sc(a)] });
      expect(r.ok).toBe(false);
      expect(r.failedAt).toBe('close');
      expect(r.partial.stage7.computed).toEqual([a.code]);
      expect(r.verification.rollbackVerified).toBe(true);
    } finally { spy.mockRestore(); }
    expectUntouched(db, before);
    db.close();
  });

  test('the step budget stops a long run and rolls it back', () => {
    const { db, a } = plantWorld();
    const before = snap(db);
    const r = run(db, { scenarios: [sc(a)] }, { budgetMs: -1 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/STEP_BUDGET_EXCEEDED/);
    expectUntouched(db, before);
    db.close();
  });

  test('if the transaction ends on its own, the run stops and reports 500 ROLLBACK_GUARANTEE_LOST', () => {
    const { db, a } = plantWorld();
    const r = run(db, { scenarios: [sc(a)] }, { hooks: { loans: ({ db: d }) => d.exec('ROLLBACK') } });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(500);
    expect(r.code).toBe('ROLLBACK_GUARANTEE_LOST');
    expect(r.verification.rollbackVerified).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'LOAN_DRY_RUN_NOT_VERIFIED'").get().n).toBe(1);
    expect(db.inTransaction).toBe(false);
    db.close();
  });
});

// ── refusals ────────────────────────────────────────────────────────────────

describe('refusals before anything is written', () => {
  test.each([
    ['no scenarios', { scenarios: [] }, 'SCENARIOS_INVALID'],
    ['11 scenarios', { scenarios: Array.from({ length: 11 }, (_, i) => ({ employeeCode: `X${i}`, principal: 1000, tenure: 1 })) }, 'SCENARIOS_INVALID'],
    ['offset −2', { scenarios: [{ employeeCode: 'X', principal: 1000, tenure: 1, disburseMonthOffset: -2 }] }, 'OFFSET_INVALID'],
    ['current month', { month: 10, scenarios: [{ employeeCode: 'X', principal: 1000, tenure: 1 }] }, 'MONTH_NOT_ENDED'],
    ['bad payroll', { payroll: 'both', scenarios: [{ employeeCode: 'X' }] }, 'PAYROLL_INVALID'],
    ['exit date outside M', { scenarios: [{ employeeCode: 'X', principal: 1000, tenure: 1, markLeft: true, exitDate: '2026-08-31' }] }, 'EXIT_DATE_INVALID'],
    ['month with no payroll', { month: 7, scenarios: [{ employeeCode: 'X', principal: 1000, tenure: 1 }] }, 'PAYROLL_NOT_COMPUTED'],
  ])('%s', (_n, input, code) => {
    const { db } = plantWorld();
    const before = snap(db);
    const r = run(db, input);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(code);
    expect(r.status).toBe(400);
    expect(dumpAll(db, before.auditMax)).toEqual(before.dump);
    expect(auditMax(db)).toBe(before.auditMax);      // a refused request writes nothing at all
    db.close();
  });

  test('duplicate borrower', () => {
    const { db, a } = plantWorld();
    expect(run(db, { scenarios: [sc(a), sc(a)] }).code).toBe('SCENARIO_DUPLICATE');
    db.close();
  });

  test('another transaction open on the handle → 409 DB_BUSY, nothing written', () => {
    const { db, a } = plantWorld();
    db.exec('BEGIN');
    const r = run(db, { scenarios: [sc(a)] });
    db.exec('ROLLBACK');
    expect(r.code).toBe('DB_BUSY');
    expect(r.status).toBe(409);
    db.close();
  });

  test('only the admin', () => {
    const { db, a } = plantWorld();
    const r = F.silently(() => D.runLoanDryRun(db, { month: 9, year: 2026, payroll: 'plant', scenarios: [sc(a)] }, { username: 'fin1', role: 'finance' }, { now: NOW }));
    expect(r.code).toBe('ROLE_NOT_ALLOWED');
    expect(r.status).toBe(403);
    db.close();
  });
});

// ── sales ───────────────────────────────────────────────────────────────────

function salesWorld() {
  const db = F.newDb();
  dbMock.__testSetDb(db);
  const reps = [SF.addRep(db, { code: 'S9001' }), SF.addRep(db, { code: 'S9002' })];
  SF.setUpload(db, { month: 9, year: 2026, rows: reps.map((r) => ({ code: r.code, days: 26 })) });
  SF.computeSalesMonth(db, { month: 9, year: 2026 });
  return { db, reps };
}

describe('sales dry run', () => {
  test('code + company: deducted in the sales cycle, posted at the sales close, nothing saved', () => {
    const { db, reps } = salesWorld();
    const before = snap(db);
    const r = run(db, { payroll: 'sales', scenarios: [{ employeeCode: reps[0].code, company: SF.IND, principal: 10000, tenure: 3 }] });
    expect(r.ok).toBe(true);
    const s = r.scenarios[0];
    expect(s.firstEmiMonth).toEqual({ month: 9, year: 2026 });
    expect(s.deductedInMonth).toBe(3334);
    expect(s.salary.rerunWithLoan.loan_recovery).toBe(3334);
    expect(r.close.result.ok).toBe(true);
    expect(r.close.result.posted).toBe(1);
    expect(s.reconciliation.ok).toBe(true);
    expect(r.checks.ok).toBe(true);
    expectUntouched(db, before);
    db.close();
  });

  test('sales hold (status hold) and Mark Left (exit in the cycle, 25th)', () => {
    const { db, reps } = salesWorld();
    const before = snap(db);
    const r = run(db, {
      payroll: 'sales',
      scenarios: [
        { employeeCode: reps[0].code, company: SF.IND, principal: 10000, tenure: 3, hold: true },
        { employeeCode: reps[1].code, company: SF.IND, principal: 20000, tenure: 4, markLeft: true },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.close.result.held).toBe(1);
    expect(r.scenarios[1].exit.exitDate).toBe('2026-09-25');
    expect(r.scenarios[1].loanAfter.status).toBe('recover_at_exit');
    expectUntouched(db, before);
    db.close();
  });

  test('sales needs the company', () => {
    const { db, reps } = salesWorld();
    expect(run(db, { payroll: 'sales', scenarios: [{ employeeCode: reps[0].code, principal: 1000, tenure: 1 }] }).code).toBe('COMPANY_REQUIRED');
    db.close();
  });
});

// ── rehearsal pack ──────────────────────────────────────────────────────────

describe('rehearsal pack', () => {
  test('plant: highest headroom, a shortfall and a held salary — read-only', () => {
    const { db, a, b } = plantWorld();
    plantEmp(db, 9, 2026);
    storedStage7(db, 9, 2026);
    db.prepare("UPDATE salary_computations SET salary_held = 1 WHERE employee_code = ?").run(a.code);
    const before = snap(db);
    const p = F.silently(() => D.rehearsalPack(db, { payroll: 'plant', now: NOW }));
    expect(p.ok).toBe(true);
    expect(p).toMatchObject({ month: 9, year: 2026 });
    expect(p.scenarios).toHaveLength(3);
    expect(p.scenarios[1].employeeCode).toBe(b.code);                // the low-headroom one
    expect(p.scenarios[2].employeeCode).toBe(a.code);                // the really held one
    expect(p.scenarios[2].hold).toBe(true);
    expect(new Set(p.scenarios.map((x) => x.employeeCode)).size).toBe(3);
    expect(dumpAll(db, before.auditMax)).toEqual(before.dump);
    expect(auditMax(db)).toBe(before.auditMax);
    // … and the pack runs as a dry run
    const r = run(db, { scenarios: p.scenarios });
    expect(r.ok).toBe(true);
    expect(r.totals.loansCreated).toBe(3);
    expectUntouched(db, before);
    db.close();
  });

  test('sales: two picks, the second a leaver', () => {
    const { db } = salesWorld();
    const p = F.silently(() => D.rehearsalPack(db, { payroll: 'sales', now: NOW }));
    expect(p.ok).toBe(true);
    expect(p.scenarios).toHaveLength(2);
    expect(p.scenarios[1].markLeft).toBe(true);
    expect(p.scenarios[1].exitDate).toBe('2026-09-25');
    db.close();
  });
});

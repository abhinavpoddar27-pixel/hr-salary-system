/**
 * 10 Oct 2026 incident: the nightly leave sweep ran Stage 6 once per
 * monthly_imports row, filtering attendance by that row's company label.
 * day_calculations holds ONE row per employee-month, so the last label
 * ('null', which held only 1–5 Sept) overwrote each whole-month row:
 * employee 14686 went from 33 payable days to 4. The leave engine then read
 * those rows and almost nobody reached 180 days for EL.
 *
 * These specs pin the fix: automatic Stage 6 always spans every label.
 */
const F = require('./helpers/leaveFixture');
const { ensureJobsTable, executeJob, employeesForCompanyMonth } = require('../services/jobQueue');
const { recomputeDays } = require('../services/recompute');

const YEAR = 2026;
const SEP = 9;
const AL = 'Asian Lakto Ind Ltd';
// 26 Mon–Sat in Sept 2026, less 4 Sept (Janmashtami, seeded holiday) which
// counts as holiday duty rather than a present day. Same as HR's All run.
const FULL_SEPT = 25;

function newDb() {
  const db = F.newDb();
  ensureJobsTable(db);
  F.enableAutomation(db);
  return db;
}

function addImport(db, month, company, over = {}) {
  db.prepare(`
    INSERT INTO monthly_imports (month, year, company, file_name, status, stage_1_done, stage_6_done, is_finalised)
    VALUES (?, ?, ?, 'x.xls', 'imported', 1, ?, ?)
  `).run(month, YEAR, company, over.stage_6_done ?? 1, over.is_finalised ?? 0);
}

/** A worked (or weekly-off) row for every day of the month, label chosen per date. */
function addMonth(db, emp, month, labelFor) {
  const last = new Date(Date.UTC(YEAR, month, 0)).getUTCDate();
  const ins = db.prepare(`
    INSERT INTO attendance_processed
      (employee_code, date, month, year, company, status_original, status_final, is_night_out_only)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `);
  for (let d = 1; d <= last; d += 1) {
    const date = `${YEAR}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const sunday = new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
    const st = sunday ? 'WO' : 'P';
    ins.run(emp.code, date, month, YEAR, labelFor(d), st, st);
  }
}

const dc = (db, code, month) => db.prepare(
  'SELECT days_present, total_payable_days FROM day_calculations WHERE employee_code = ? AND month = ? AND year = ?'
).get(code, month, YEAR);

/** Sept split the way production's was: 1–5 under 'null', 6–30 under the company. */
function septSplit(db) {
  const emp = F.addEmployee(db, { code: '14686', company: AL });
  addMonth(db, emp, SEP, (d) => (d <= 5 ? 'null' : AL));
  for (const co of [AL, 'Default', 'null']) addImport(db, SEP, co);
  return emp;
}

describe('the bug this fixes (documented, old shape)', () => {
  test('a per-label Stage 6 loop leaves only the last label\'s days', () => {
    const db = newDb();
    const emp = septSplit(db);
    F.silently(() => recomputeDays(db, { month: SEP, year: YEAR }));
    const full = dc(db, emp.code, SEP);
    for (const co of [AL, 'Default', 'null']) {
      F.silently(() => recomputeDays(db, { company: co, month: SEP, year: YEAR }));
    }
    expect(dc(db, emp.code, SEP).days_present).toBeLessThan(full.days_present);
    expect(dc(db, emp.code, SEP).days_present).toBeLessThanOrEqual(5);
  });
});

describe('leave_nightly', () => {
  test('rebuilds the whole-month row from every label', () => {
    const db = newDb();
    const emp = septSplit(db);
    F.silently(() => recomputeDays(db, { month: SEP, year: YEAR })); // HR "All companies"
    const full = dc(db, emp.code, SEP);
    expect(full.days_present).toBe(FULL_SEPT);

    const out = F.silently(() => executeJob(db, 'leave_nightly', { year: YEAR }, 1));
    expect(out.periodsRefreshed).toBe(1); // once per month, not once per label
    expect(dc(db, emp.code, SEP)).toEqual(full);
  });

  test('repairs a row an earlier per-label run had cut short', () => {
    const db = newDb();
    const emp = septSplit(db);
    F.silently(() => recomputeDays(db, { company: 'null', month: SEP, year: YEAR }));
    expect(dc(db, emp.code, SEP).days_present).toBeLessThanOrEqual(5);
    F.silently(() => executeJob(db, 'leave_nightly', { year: YEAR }, 1));
    expect(dc(db, emp.code, SEP).days_present).toBe(FULL_SEPT);
  });

  test('a month with any finalized label is left alone', () => {
    const db = newDb();
    const emp = F.addEmployee(db, { code: 'F01', company: AL });
    addMonth(db, emp, 8, () => AL);
    addImport(db, 8, AL, { is_finalised: 1 });
    addImport(db, 8, 'null');
    F.addDayCalc(db, emp, 8, YEAR, { days_present: 11, total_payable_days: 11 });
    const out = F.silently(() => executeJob(db, 'leave_nightly', { year: YEAR }, 1));
    expect(out.periodsRefreshed).toBe(0);
    expect(dc(db, emp.code, 8)).toEqual({ days_present: 11, total_payable_days: 11 });
  });

  test('a month whose Stage 6 never ran is not started by the sweep', () => {
    const db = newDb();
    const emp = F.addEmployee(db, { code: 'N01', company: AL });
    addMonth(db, emp, 7, () => AL);
    addImport(db, 7, AL, { stage_6_done: 0 });
    const out = F.silently(() => executeJob(db, 'leave_nightly', { year: YEAR }, 1));
    expect(out.periodsRefreshed).toBe(0);
    expect(dc(db, emp.code, 7)).toBeUndefined();
  });

  test('EL accrues from the full-month rows', () => {
    const db = newDb();
    const emp = F.addEmployee(db, { code: 'EL01', company: AL });
    // Jan–Sep fully worked; every month split across two labels.
    for (let m = 1; m <= 9; m += 1) {
      addMonth(db, emp, m, (d) => (d <= 5 ? 'null' : AL));
      addImport(db, m, AL);
      addImport(db, m, 'null');
    }
    F.silently(() => executeJob(db, 'leave_nightly', { year: YEAR }, 1));
    const ytd = db.prepare(`
      SELECT SUM(days_present) AS p FROM day_calculations WHERE employee_code = 'EL01' AND year = ?
    `).get(YEAR).p;
    expect(ytd).toBeGreaterThan(180);
    const el = F.getBalance(db, emp, 'EL', YEAR);
    expect(el.balance).toBeGreaterThan(0);
  });
});

describe('leave_recalc and day_calculate (trigger paths)', () => {
  test('a company-scoped leave_recalc for one employee uses all of their attendance', () => {
    const db = newDb();
    const emp = septSplit(db);
    F.silently(() => executeJob(db, 'leave_recalc', {
      company: AL, month: SEP, year: YEAR, employeeCodes: [emp.code], reason: 'leave_approved',
    }, 2));
    expect(dc(db, emp.code, SEP).days_present).toBe(FULL_SEPT);
  });

  test('a company-scoped run with no codes recomputes that label\'s people, fully', () => {
    const db = newDb();
    const emp = septSplit(db);
    const other = F.addEmployee(db, { code: 'OTH', company: 'Indriyan Beverages Pvt Ltd' });
    addMonth(db, other, SEP, () => 'Indriyan Beverages Pvt Ltd');
    F.silently(() => executeJob(db, 'day_calculate', { company: 'null', month: SEP, year: YEAR }, 3));
    expect(dc(db, emp.code, SEP).days_present).toBe(FULL_SEPT);
    expect(dc(db, other.code, SEP)).toBeUndefined(); // not in the 'null' label → untouched
  });

  test('a label with nobody in it recomputes nobody (never "everyone")', () => {
    const db = newDb();
    const emp = septSplit(db);
    const out = F.silently(() => executeJob(db, 'day_calculate', { company: 'Default', month: SEP, year: YEAR }, 4));
    expect(out.processed).toBe(0);
    expect(dc(db, emp.code, SEP)).toBeUndefined();
  });

  test('employeesForCompanyMonth lists only that label', () => {
    const db = newDb();
    septSplit(db);
    expect(employeesForCompanyMonth(db, 'null', SEP, YEAR)).toEqual(['14686']);
    expect(employeesForCompanyMonth(db, 'Default', SEP, YEAR)).toEqual([]);
  });
});

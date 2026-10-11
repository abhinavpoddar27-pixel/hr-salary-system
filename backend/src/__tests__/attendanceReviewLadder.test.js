/**
 * Attendance Review PR-7 — escalation ladder (owner ruling D-10: warning → deduction → deduction + HR hearing; history
 * counted from Aug 2026) and the person history API. Synthetic codes LA…, import basis, Oct 2026 reviewed.
 */
const F = require('./helpers/attendanceReviewFixture');
const S = require('../services/attendanceReviewService');
const { startJwtApi } = require('./helpers/jwtApiHarness');

const LATE8 = (i) => (i < 8 ? { lm: 30 } : {}); // 8 lates of 30 min = a late regular, ½ day
const CLEAN = () => ({});
const LADDER = { ladder_rule: true };
const item = (r, code) => r.actionList.find((a) => a.code === code) || r.earlyExitWarnings.find((a) => a.code === code);

function person(db, code, pattern) {          // pattern: [Aug, Sep, Oct] fill functions
  F.emp(db, code);
  F.month(db, code, 2026, 7, 20, CLEAN);
  [8, 9, 10].forEach((m, k) => F.month(db, code, 2026, m, 20, pattern[k]));
}

function seed(db) {
  person(db, 'LA1', [LATE8, LATE8, LATE8]);   // 3 strike months → deduction + hearing
  person(db, 'LA2', [CLEAN, CLEAN, LATE8]);   // first strike → warning
  person(db, 'LA3', [CLEAN, LATE8, LATE8]);   // second strike → deduction
  person(db, 'LA4', [CLEAN, CLEAN, LATE8]);   // first strike, but an admin override → untouched
}

describe('ladder engine', () => {
  let db;
  beforeAll(() => { db = F.newDb(); seed(db); });

  test('ladder off (default): no ladder data, deductions as before', () => {
    const r = S.computeAttendanceReview(db, { month: 10, year: 2026, config: {} });
    expect(r.ladder).toEqual({ rule: false });
    for (const c of ['LA1', 'LA2', 'LA3']) expect(item(r, c)).toMatchObject({ action: 'deduction', deduction_days: 0.5 });
    expect(item(r, 'LA1').ladder).toBeUndefined();
  });

  test('ladder on: step 1 → warning (days kept as downgraded), step 2 → deduction, step 3 → deduction + hearing', () => {
    const r = S.computeAttendanceReview(db, { month: 10, year: 2026, config: LADDER });
    expect(r.ladder).toMatchObject({ rule: true, from: '2026-08', window_months: 3, deduction_from: 2, hearing_from: 3 });
    expect(r.ladder.months).toEqual([{ ym: '2026-08', source: 'live' }, { ym: '2026-09', source: 'live' }]);
    expect(item(r, 'LA1')).toMatchObject({ action: 'deduction', deduction_days: 0.5, ladder: { step: 3, months: ['2026-08', '2026-09', '2026-10'], hearing: true } });
    expect(item(r, 'LA2')).toMatchObject({ action: 'warning', deduction_days: 0, indicative_amount: 0, ladder: { step: 1, months: ['2026-10'], downgraded_days: 0.5 } });
    expect(item(r, 'LA2').ladder.downgraded_amount).toBeGreaterThan(0);
    expect(item(r, 'LA3')).toMatchObject({ action: 'deduction', deduction_days: 0.5, ladder: { step: 2, months: ['2026-09', '2026-10'] } });
    expect(item(r, 'LA3').ladder.hearing).toBeUndefined();
    expect(r.actionTotals).toMatchObject({ ladder_warnings: 2, hearings: 1 });                     // LA2 + LA4 downgraded
  });

  test('an admin override wins over the ladder (step still recorded)', () => {
    const r = S.computeAttendanceReview(db, { month: 10, year: 2026, config: LADDER, overrides: [{ code: 'LA4', action: 'include', reason: 'repeat case, HR decided' }] });
    expect(item(r, 'LA4')).toMatchObject({ action: 'deduction', deduction_days: 0.5, ladder: { step: 1 } });
    expect(item(r, 'LA4').ladder.downgraded_days).toBeUndefined();
  });

  test('ladder_from: months before it are not strikes; a month before it gets no ladder at all', () => {
    const r = S.computeAttendanceReview(db, { month: 10, year: 2026, config: { ...LADDER, ladder_from: '2026-09' } });
    expect(item(r, 'LA1').ladder).toMatchObject({ step: 2, months: ['2026-09', '2026-10'] });
    expect(item(r, 'LA1').ladder.hearing).toBeUndefined();
    const aug = S.computeAttendanceReview(db, { month: 8, year: 2026, config: { ...LADDER, ladder_from: '2026-09' } });
    expect(aug.ladder).toEqual({ rule: false });
  });

  test('a stored run is the history for its month (before live), and a wider window / lower bar move the steps', () => {
    // a September draft that (wrongly, on purpose) lists LA2 → LA2 has 2 strike months in October
    const sep = S.computeAttendanceReview(db, { month: 9, year: 2026, config: {} });
    sep.actionList.push({ code: 'LA2', action: 'warning', deduction_days: 0 });
    db.prepare(`INSERT INTO attendance_review_runs (month, year, status, config_snapshot, release_days, overrides, result_json, generated_by)
      VALUES (9, 2026, 'draft', '{}', '[]', '[]', ?, 'adm')`).run(JSON.stringify(sep));
    const r = S.computeAttendanceReview(db, { month: 10, year: 2026, config: LADDER });
    expect(r.ladder.months).toEqual([{ ym: '2026-08', source: 'live' }, { ym: '2026-09', source: 'draft' }]);
    expect(item(r, 'LA2')).toMatchObject({ action: 'deduction', ladder: { step: 2 } });
    const two = S.computeAttendanceReview(db, { month: 10, year: 2026, config: { ...LADDER, thresholds: { ladder_window_months: 1 } } });
    expect(item(two, 'LA1').ladder).toMatchObject({ step: 1 });                                     // only October in a 1-month window
    expect(item(two, 'LA1').action).toBe('warning');
    const bar = S.computeAttendanceReview(db, { month: 10, year: 2026, config: { ...LADDER, thresholds: { ladder_deduction_from: 1, ladder_hearing_from: 2 } } });
    expect(item(bar, 'LA3')).toMatchObject({ action: 'deduction', ladder: { step: 2, hearing: true } });
    db.prepare('DELETE FROM attendance_review_runs').run();
  });

  test('config validation', () => {
    expect(S.validateConfig({ ladder_rule: 'yes' })).toContain('ladder_rule must be true or false');
    expect(S.validateConfig({ ladder_from: '2026-8' })).toContain('ladder_from must be YYYY-MM');
    expect(S.validateConfig({ thresholds: { ladder_window_months: 0 } })).toContain('ladder_window_months must be a whole number from 1 to 12');
    expect(S.validateConfig({ ladder_rule: true, ladder_from: '2026-08', thresholds: { ladder_window_months: 3, ladder_deduction_from: 2, ladder_hearing_from: 3 } })).toEqual([]);
  });
});

describe('person history API', () => {
  const BASE = '/api/analytics/attendance-review';
  let api; let db;
  beforeAll(() => {
    api = startJwtApi({ [BASE]: '../../routes/attendanceReview' }, { users: [{ username: 'adm', role: 'admin' }, { username: 'hr1', role: 'hr' }] });
    db = api.db; seed(db);
    db.prepare("INSERT INTO attendance_review_config (effective_from, config_json, updated_by) VALUES ('2026-08', ?, 'adm')").run(JSON.stringify(LADDER));
    db.prepare(`INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark)
      VALUES ('attendance_review_board', 202610, 'board_print', '', ?, 'adm', 'ATTENDANCE_REVIEW_BOARD_PRINT', 'No. 1')`)
      .run(JSON.stringify({ from: '2026-10-01', to: '2026-10-15', listed: [['LA1', 6, 0, 0]], spotless: ['LA9'] }));
    db.prepare(`INSERT INTO late_coming_deductions (employee_code, month, year, company, late_count, deduction_days, remark, applied_by, finance_status)
      VALUES ('LA1', 9, 2026, 'Indriyan Beverages Pvt Ltd', 8, 0.5, 'Attendance review deduction [review run 7]', 'adm', 'approved')`).run();
    db.prepare(`INSERT INTO late_coming_deductions (employee_code, month, year, company, late_count, deduction_days, remark, applied_by, finance_status)
      VALUES ('LA1', 8, 2026, 'Indriyan Beverages Pvt Ltd', 8, 1, 'entered by hand', 'hr1', 'approved')`).run();
  });
  afterAll(() => api.close());

  test('hr refused; bad input 400', async () => {
    expect((await api.request('GET', `${BASE}/person/LA1?from=2026-08&to=2026-10`, { as: 'hr1' })).status).toBe(403);
    expect((await api.request('GET', `${BASE}/person/LA1?from=2026-8&to=2026-10`, { as: 'adm' })).status).toBe(400);
    expect((await api.request('GET', `${BASE}/person/LA1?from=2026-11&to=2026-10`, { as: 'adm' })).status).toBe(400);
    expect((await api.request('GET', `${BASE}/person/LA1?from=2025-01&to=2026-10`, { as: 'adm' })).status).toBe(400);
  });

  test('months, ladder, board appearances and review finance rows', async () => {
    const r = await api.request('GET', `${BASE}/person/LA1?from=2026-08&to=2026-10`, { as: 'adm' });
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.employee).toMatchObject({ code: 'LA1' });
    expect(d.months.map((m) => [m.ym, m.source, m.list, m.action, m.late_days])).toEqual([
      ['2026-08', 'live', 'action list', 'warning', 8], ['2026-09', 'live', 'action list', 'deduction', 8], ['2026-10', 'live', 'action list', 'deduction', 8]]);
    expect(d.months.map((m) => m.ladder && m.ladder.step)).toEqual([1, 2, 3]);
    expect(d.months[2].ladder.hearing).toBe(true);
    expect(d.months[2].notice_late).toBe(true);
    expect(d.boards).toEqual([expect.objectContaining({ ym: '2026-10', to: '2026-10-15', as: 'named', lates: 6 })]);
    expect(d.finance).toEqual([expect.objectContaining({ ym: '2026-09', deduction_days: 0.5, finance_status: 'approved', run_id: 7 })]);
    const la9 = (await api.request('GET', `${BASE}/person/LA9?from=2026-10&to=2026-10`, { as: 'adm' })).body.data;
    expect(la9.boards[0]).toMatchObject({ as: 'on time every day' });
    expect(la9.months[0]).toMatchObject({ list: null, action: null });
  });
});

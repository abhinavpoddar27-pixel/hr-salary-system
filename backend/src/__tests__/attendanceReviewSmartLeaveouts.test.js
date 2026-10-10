/**
 * Attendance Review — standing leave-out rules, the contractor-loader rule and monthly suggestions (owner rulings 11 Oct 2026).
 * Synthetic codes only (SL…). Current month Oct 2026, previous Sep 2026. Fixture shifts: DAY/12HR 08:00–20:00,
 * GEN 09:00–18:00, 10HR 09:00–19:00, 9HR 09:30–18:30, NIGHT 20:00–08:00.
 */
const F = require('./helpers/attendanceReviewFixture');
const S = require('../services/attendanceReviewService');
const { startJwtApi } = require('./helpers/jwtApiHarness');

const M = 10; const Y = 2026;
const MASTER = { assessment_basis: 'master' };
const run = (db, config = {}) => S.computeAttendanceReview(db, { month: M, year: Y, config, releaseDays: [], prevReleaseDays: [], overrides: [] });
const person = (r, code) => r.people.find((p) => p.code === code) || { code, late_days: 0, early_days: 0 };
const sug = (r, key) => r.suggestions.find((s) => s.key === key);
const kinds = (r) => r.suggestions.map((s) => s.key);

function shift(db, code, name, start, end, hours) {
  db.prepare('INSERT INTO shifts (name, code, start_time, end_time, duration_hours) VALUES (?, ?, ?, ?, ?)').run(name, code, start, end, hours);
}
const master = (db, c, sc) => db.prepare('UPDATE employees SET default_shift_id = (SELECT id FROM shifts WHERE code = ?) WHERE code = ?').run(sc, c);
/** n worked weekdays of Oct with fixed punches (import flags off). */
function octDays(db, code, n, it, ot, o = {}) {
  F.weekdays(2026, 10).slice(0, n).forEach((d) => F.day(db, code, d, { it, ot, lm: o.lm || 0, em: o.em || 0 }));
  db.prepare('UPDATE attendance_processed SET is_late_arrival = CASE WHEN ? > 0 THEN 1 ELSE 0 END, late_by_minutes = ?, is_early_departure = CASE WHEN ? > 0 THEN 1 ELSE 0 END, early_by_minutes = ? WHERE employee_code = ? AND substr(date,1,7) = \'2026-10\'')
    .run(o.lm || 0, o.lm || 0, o.em || 0, o.em || 0, code);
}
const sep = (db, code, it = '08:00', ot = '20:00') => F.month(db, code, 2026, 9, 22, () => ({ it, ot }));
const contractEmp = (db, code, dept, designation) => F.emp(db, code, { department: dept, designation, is_contractor: 1, employment_type: 'Contract' });

describe('standing rules', () => {
  test('older lists fold into standing rules with a reason; the derived lists still drive the engine', () => {
    const c = S.mergeConfig({ excluded_codes: ['A1'], early_excluded_codes: ['A2'], held_codes: ['A3'], excluded_departments: ['CREW X'],
      standing_people: { B1: { rule: 'exclude', reason: 'Senior staff' } } });
    expect(c.standing_people).toEqual({ A1: { rule: 'exclude', reason: S.LEGACY_REASON }, A2: { rule: 'early_exempt', reason: S.LEGACY_REASON },
      A3: { rule: 'held', reason: S.LEGACY_REASON }, B1: { rule: 'exclude', reason: 'Senior staff' } });
    expect(c.excluded_codes.sort()).toEqual(['A1', 'B1']); expect(c.early_excluded_codes).toEqual(['A2']); expect(c.held_codes).toEqual(['A3']);
    expect(c.excluded_departments).toEqual(['CREW X']);
    const stored = S.toStoredConfig({ excluded_codes: ['A1'], excluded_departments: ['CREW X'], early_exit_rule: 'warning' });
    expect(stored).toEqual({ early_exit_rule: 'warning', standing_people: { A1: { rule: 'exclude', reason: S.LEGACY_REASON } },
      standing_departments: { 'CREW X': { rule: 'exclude', reason: S.LEGACY_REASON } } });
  });

  test('validation: a rule needs a known type and a reason', () => {
    expect(S.validateConfig({ standing_people: { A1: { rule: 'exclude', reason: 'Senior staff' } }, standing_departments: { X: { rule: 'exclude', reason: 'Piece rate' } } })).toEqual([]);
    expect(S.validateConfig({ standing_people: { A1: { rule: 'exclude', reason: '' } } })[0]).toMatch(/reason/);
    expect(S.validateConfig({ standing_people: { A1: { rule: 'skip', reason: 'xxx' } } })[0]).toMatch(/rule must be/);
    expect(S.validateConfig({ standing_departments: { X: { rule: 'early_exempt', reason: 'xxx' } } })[0]).toMatch(/rule must be exclude/);
    expect(S.validateConfig({ contract_loaders_early_exempt: 'yes' })).toContain('contract_loaders_early_exempt must be true or false');
  });

  test('a standing person rule leaves them out exactly like the old list did', () => {
    const db = F.newDb(); F.emp(db, 'SL1'); sep(db, 'SL1'); octDays(db, 'SL1', 12, '08:45', '20:00', { lm: 45 });
    expect(run(db).actionList.map((a) => a.code)).toEqual(['SL1']);
    const r = run(db, { standing_people: { SL1: { rule: 'exclude', reason: 'Senior staff' } } });
    expect(r.actionList).toEqual([]);
    expect(r.standing.people).toEqual([expect.objectContaining({ code: 'SL1', rule: 'exclude', reason: 'Senior staff' })]);
  });
});

describe('contractor loaders (owner ruling 11 Oct 2026)', () => {
  test('a contract loader: no lates, no early exits; a permanent loader: early exits still counted; switchable', () => {
    const db = F.newDb();
    contractEmp(db, 'SL10', 'MEERA', 'LOADING'); F.emp(db, 'SL11', { designation: 'LOADING SUPERVISOR' });
    for (const c of ['SL10', 'SL11']) { sep(db, c); octDays(db, c, 10, '08:30', '17:00', { lm: 30, em: 180 }); }
    const r = run(db);
    expect(person(r, 'SL10')).toMatchObject({ late_days: 0, early_days: 0 });
    expect(person(r, 'SL11')).toMatchObject({ late_days: 0, early_days: 10 });
    expect(r.earlyExitWarnings.map((w) => w.code)).not.toContain('SL10');
    const off = run(db, { contract_loaders_early_exempt: false });
    expect(person(off, 'SL10').early_days).toBe(10);
  });
});

describe('suggestions', () => {
  test('stale person rule: changes nothing now → suggested; one that still matters → not; a left employee → suggested', () => {
    const db = F.newDb();
    F.emp(db, 'SL20'); sep(db, 'SL20'); octDays(db, 'SL20', 10, '08:00', '20:00');                 // clean
    F.emp(db, 'SL21'); sep(db, 'SL21'); octDays(db, 'SL21', 12, '08:45', '20:00', { lm: 45 });     // late regular
    F.emp(db, 'SL22'); db.prepare("UPDATE employees SET status = 'Left', date_of_exit = '2026-08-31' WHERE code = 'SL22'").run();
    const cfg = { standing_people: { SL20: { rule: 'exclude', reason: 'Night worker on a day master' }, SL21: { rule: 'exclude', reason: 'Senior staff' },
      SL22: { rule: 'early_exempt', reason: 'Wrong shift' } } };
    const r = run(db, cfg);
    expect(sug(r, 'stale_person|SL20').evidence).toMatch(/would not reach any list/);
    expect(sug(r, 'stale_person|SL21')).toBeUndefined();
    expect(sug(r, 'stale_person|SL22').evidence).toMatch(/no longer active/);
  });

  test('stale department rule: nobody worked in it → suggested', () => {
    const db = F.newDb(); F.emp(db, 'SL23'); sep(db, 'SL23');
    const r = run(db, { standing_departments: { 'OLD CREW': { rule: 'exclude', reason: 'Piece rate' } } });
    expect(sug(r, 'stale_department|OLD CREW')).toMatchObject({ can_apply: true });
  });

  test('loader crew: a contract department that is mostly loaders → mark piece rate; once ruled, not suggested', () => {
    const db = F.newDb();
    for (const [c, des] of [['SL30', 'LODING'], ['SL31', 'LODING'], ['SL32', 'LODING'], ['SL33', 'HELPER']]) { contractEmp(db, c, 'CREW K', des); octDays(db, c, 5, '08:00', '20:00'); }
    expect(sug(run(db), 'loader_crew|CREW K')).toMatchObject({ rule: { scope: 'department', rule: 'exclude' } });
    expect(sug(run(db, { standing_departments: { 'CREW K': { rule: 'exclude', reason: 'Piece rate' } } }), 'loader_crew|CREW K')).toBeUndefined();
  });

  test('a crew loader booked in another department → leave out; with that rule it is not called stale', () => {
    const db = F.newDb();
    for (const c of ['SL40', 'SL41']) { contractEmp(db, c, 'CREW K', 'LODING'); octDays(db, c, 5, '08:00', '20:00'); }
    F.emp(db, 'SL42', { department: 'PRODUCTION', designation: 'LODING' }); octDays(db, 'SL42', 5, '08:00', '20:00');
    const crew = { standing_departments: { 'CREW K': { rule: 'exclude', reason: 'Piece rate' } } };
    expect(sug(run(db, crew), 'loader_outside_crew|SL42')).toMatchObject({ rule: { scope: 'person', rule: 'exclude' } });
    const withRule = run(db, { ...crew, standing_people: { SL42: { rule: 'exclude', reason: 'Crew loader in PRODUCTION' } } });
    expect(kinds(withRule)).not.toContain('loader_outside_crew|SL42');
    expect(kinds(withRule)).not.toContain('stale_person|SL42');
  });

  test('senior hint: a high earner about to be deducted; not for an ordinary wage', () => {
    const db = F.newDb();
    F.emp(db, 'SL50', { gross_salary: 90000, designation: 'MANAGER' }); F.emp(db, 'SL51', { gross_salary: 30000 });
    for (const c of ['SL50', 'SL51']) { sep(db, c); octDays(db, c, 12, '08:45', '20:00', { lm: 45 }); }
    const r = run(db);
    expect(sug(r, 'senior_hint|SL50')).toMatchObject({ rule: { reason: 'Senior staff' } });
    expect(sug(r, 'senior_hint|SL51')).toBeUndefined();
  });

  test('master fit: 10-hour master, punches 08:00–18:00 every day → no shift fits, propose creating 08:00–18:00; retired once fixed', () => {
    const db = F.newDb(); F.emp(db, 'SL60'); master(db, 'SL60', '10HR'); sep(db, 'SL60', '09:00', '19:00');
    octDays(db, 'SL60', 12, '08:00', '18:00');
    const r = run(db, MASTER);
    const s = sug(r, 'master_fit|SL60');
    expect(s.proposed).toEqual({ create: '08:00–18:00' });
    expect(s.evidence).toMatch(/early on 100%/);
    // accept, then fix the master → the rule is offered for removal
    const { config } = S.applySuggestions(MASTER, r.suggestions, { accept: ['master_fit|SL60'], by: 'adm', at: 't' });
    expect(config.standing_people.SL60).toMatchObject({ rule: 'exclude', source: 'master_fit' });
    expect(run(db, config).actionList.map((a) => a.code)).not.toContain('SL60');
    shift(db, 'H10', 'Housekeeping 08-18', '08:00', '18:00', 10); master(db, 'SL60', 'H10');
    expect(sug(run(db, config), 'stale_person|SL60').evidence).toMatch(/master shift now fits/);
  });

  test('master fit: a fitting existing shift is proposed; a master that is roughly right (genuinely late) is left alone', () => {
    const db = F.newDb();
    F.emp(db, 'SL61'); master(db, 'SL61', '12HR'); sep(db, 'SL61'); octDays(db, 'SL61', 12, '09:00', '19:00');   // 10HR fits
    shift(db, 'HK', 'Housekeeping', '07:30', '16:30', 9);
    F.emp(db, 'SL62'); master(db, 'SL62', 'HK'); sep(db, 'SL62', '07:30', '16:30'); octDays(db, 'SL62', 12, '08:05', '16:35'); // late daily, master ok
    const r = run(db, MASTER);
    expect(sug(r, 'master_fit|SL61').proposed).toEqual({ shift: '10-Hour Shift', start: '09:00', end: '19:00' });
    expect(sug(r, 'master_fit|SL62')).toBeUndefined();
    expect(run(db, {}).suggestions.filter((x) => x.kind === 'master_fit')).toEqual([]);   // import basis: no master-fit check
  });

  test('master fit compares shifts by times: a same-times duplicate is not a "better fit"; a late person on a right master is left alone', () => {
    const db = F.newDb();
    // as on production: the master is a shift whose times duplicate an older (lower-id) shift — that twin must not "fit better"
    shift(db, 'DUP', 'Nine Hour Duplicate', '09:30', '18:30', 9);
    F.emp(db, 'SL63', { designation: 'A/C MANAGER' }); master(db, 'SL63', 'DUP'); sep(db, 'SL63', '09:30', '18:30');
    octDays(db, 'SL63', 12, '10:30', '18:30');                          // late an hour every day, master right
    expect(run(db, MASTER).suggestions.filter((x) => x.code === 'SL63' && x.kind === 'master_fit')).toEqual([]);
  });

  test('master fit ignores what is never counted: a contract loader leaving early every day gets no master suggestion', () => {
    const db = F.newDb();
    contractEmp(db, 'SL64', 'MEERA', 'LOADING'); master(db, 'SL64', '12HR'); sep(db, 'SL64'); octDays(db, 'SL64', 12, '08:00', '17:00');
    F.emp(db, 'SL65'); master(db, 'SL65', '12HR'); sep(db, 'SL65'); octDays(db, 'SL65', 12, '08:00', '17:00');   // same punches, not a loader
    const r = run(db, MASTER);
    expect(sug(r, 'master_fit|SL64')).toBeUndefined();
    expect(sug(r, 'master_fit|SL65')).toBeDefined();
  });

  test('no master: data fix only, with the fitting shift proposed', () => {
    const db = F.newDb(); F.emp(db, 'SL70'); octDays(db, 'SL70', 6, '09:30', '18:30');
    const s = sug(run(db, MASTER), 'no_master|SL70');
    expect(s).toMatchObject({ can_apply: false, proposed: { shift: '9-Hour Shift', start: '09:30', end: '18:30' } });
  });

  test('redundant re-measure (master basis): a row with exactly the master times', () => {
    const db = F.newDb(); F.emp(db, 'SL80'); master(db, 'SL80', '10HR'); sep(db, 'SL80', '09:00', '19:00'); octDays(db, 'SL80', 5, '09:00', '19:00');
    const cfg = { ...MASTER, remeasure: { SL80: { start: '09:00', end: '19:00' } } };
    expect(sug(run(db, cfg), 'redundant_remeasure|SL80')).toMatchObject({ can_apply: true });
    expect(sug(run(db, { ...MASTER, remeasure: { SL80: { start: '08:00', end: '18:00' } } }), 'redundant_remeasure|SL80')).toBeUndefined();
  });

  test('a dismissed suggestion is not shown again', () => {
    const db = F.newDb(); F.emp(db, 'SL70'); octDays(db, 'SL70', 6, '09:30', '18:30');
    expect(sug(run(db, { ...MASTER, dismissed_suggestions: { 'no_master|SL70': { by: 'a', at: 't' } } }), 'no_master|SL70')).toBeUndefined();
  });

  test('applySuggestions: accept / remove / dismiss; unknown and data-fix keys are reported, not applied', () => {
    const list = [
      { key: 'loader_crew|K', kind: 'loader_crew', department: 'K', can_apply: true, rule: { scope: 'department', rule: 'exclude', reason: 'Piece-rate loading crew' } },
      { key: 'stale_person|A1', kind: 'stale_person', code: 'A1', can_apply: true },
      { key: 'redundant_remeasure|R1', kind: 'redundant_remeasure', code: 'R1', can_apply: true },
      { key: 'no_master|N1', kind: 'no_master', code: 'N1', can_apply: false },
    ];
    const stored = { excluded_codes: ['A1', 'A2'], remeasure: { R1: { start: '09:00', end: '19:00' } } };
    const out = S.applySuggestions(stored, list, { accept: ['loader_crew|K', 'stale_person|A1', 'redundant_remeasure|R1', 'no_master|N1', 'gone|X'], dismiss: ['no_master|N1'], by: 'adm', at: 't' });
    expect(out.config).toEqual({
      standing_people: { A2: { rule: 'exclude', reason: S.LEGACY_REASON } },
      standing_departments: { K: { rule: 'exclude', reason: 'Piece-rate loading crew', source: 'loader_crew', set_by: 'adm', set_at: 't' } },
      dismissed_suggestions: { 'no_master|N1': { by: 'adm', at: 't' } },
    });
    expect(out.unknown).toEqual(['no_master|N1', 'gone|X']);
    expect(S.validateConfig(out.config)).toEqual([]);
  });

  test('the old shift-issues table is not shown on the master basis (the master-fit suggestions replace it)', () => {
    const db = F.newDb(); F.emp(db, 'SL90'); octDays(db, 'SL90', 12, '07:00', '19:00', { em: 60 });
    db.prepare("UPDATE attendance_processed SET is_early_departure = 1 WHERE employee_code = 'SL90'").run();
    expect(run(db, {}).shiftIssues.map((x) => x.code)).toContain('SL90');
    expect(run(db, MASTER).shiftIssues).toEqual([]);
  });
});

describe('API: POST /suggestions', () => {
  const BASE = '/api/analytics/attendance-review';
  let api; let db;
  beforeAll(() => {
    api = startJwtApi({ [BASE]: '../../routes/attendanceReview' }, { users: [{ username: 'adm', role: 'admin' }, { username: 'hr1', role: 'hr' }] });
    db = api.db;
    for (const c of ['SA1', 'SA2', 'SA3']) { contractEmp(db, c, 'CREW Z', 'LODING'); octDays(db, c, 5, '08:00', '20:00'); }
    F.emp(db, 'SA9'); octDays(db, 'SA9', 6, '09:30', '18:30');
    db.prepare("INSERT INTO attendance_review_config (effective_from, config_json, updated_by) VALUES ('2026-10', ?, 'adm')")
      .run(JSON.stringify({ assessment_basis: 'master', excluded_codes: ['GONE1'] }));
  });
  afterAll(() => api.close());
  const preview = async () => (await api.request('GET', `${BASE}?month=10&year=2026`, { as: 'adm' })).body.data;

  test('admin only; empty or contradictory requests refused', async () => {
    expect((await api.request('POST', `${BASE}/suggestions`, { as: 'hr1', body: { month: 10, year: 2026, accept: ['x'] } })).status).toBe(403);
    expect((await api.request('POST', `${BASE}/suggestions`, { as: 'adm', body: { month: 10, year: 2026 } })).status).toBe(400);
    expect((await api.request('POST', `${BASE}/suggestions`, { as: 'adm', body: { month: 10, year: 2026, accept: ['a'], dismiss: ['a'] } })).status).toBe(400);
  });

  test('accept + dismiss → one new version for that month, audited; the suggestions are gone; a stale key → 409', async () => {
    const before = await preview();
    expect(before.suggestions.map((s) => s.key)).toEqual(expect.arrayContaining(['loader_crew|CREW Z', 'no_master|SA9', 'stale_person|GONE1']));
    const versions = () => db.prepare('SELECT COUNT(*) n FROM attendance_review_config').get().n;
    const v0 = versions();
    const r = await api.request('POST', `${BASE}/suggestions`, { as: 'adm', body: { month: 10, year: 2026, accept: ['loader_crew|CREW Z', 'stale_person|GONE1'], dismiss: ['no_master|SA9'] } });
    expect(r.status).toBe(200); expect(r.body.data).toMatchObject({ effective_from: '2026-10', accepted: 2, dismissed: 1 });
    expect(versions()).toBe(v0 + 1);
    const stored = JSON.parse(db.prepare('SELECT config_json FROM attendance_review_config ORDER BY id DESC LIMIT 1').get().config_json);
    expect(stored.assessment_basis).toBe('master');
    expect(stored.standing_departments['CREW Z']).toMatchObject({ rule: 'exclude', set_by: 'adm' });
    expect(stored.standing_people).toEqual({});
    expect(stored.excluded_codes).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE stage = 'ATTENDANCE_REVIEW_SUGGESTIONS'").get().n).toBe(1);
    const after = await preview();
    expect(after.suggestions.map((s) => s.key)).not.toEqual(expect.arrayContaining(['loader_crew|CREW Z']));
    expect(after.suggestions.map((s) => s.key)).not.toContain('no_master|SA9');
    expect(after.people.map((p) => p.code)).not.toContain('SA1');
    const again = await api.request('POST', `${BASE}/suggestions`, { as: 'adm', body: { month: 10, year: 2026, accept: ['loader_crew|CREW Z'] } });
    expect(again.status).toBe(409);
  });

  test('refused when a later-effective version exists', async () => {
    db.prepare("INSERT INTO attendance_review_config (effective_from, config_json, updated_by) VALUES ('2026-11', '{}', 'adm')").run();
    const r = await api.request('POST', `${BASE}/suggestions`, { as: 'adm', body: { month: 10, year: 2026, dismiss: ['x'] } });
    expect(r.status).toBe(409); expect(r.body.error).toMatch(/later rules version/);
  });

  test('PUT /config with the older lists stores standing rules', async () => {
    const r = await api.request('PUT', `${BASE}/config`, { as: 'adm', body: { effective_from: '2026-12', config: { excluded_codes: ['Q1'], excluded_departments: ['CREW Q'] } } });
    expect(r.status).toBe(200);
    const stored = JSON.parse(db.prepare('SELECT config_json FROM attendance_review_config WHERE id = ?').get(r.body.data.id).config_json);
    expect(stored).toEqual({ standing_people: { Q1: { rule: 'exclude', reason: S.LEGACY_REASON } }, standing_departments: { 'CREW Q': { rule: 'exclude', reason: S.LEGACY_REASON } } });
  });
});

/**
 * Attendance Review — mid-month notice board (PR-5): GET /board, POST /board/prints, svc.noticeBoard.
 * Names + codes + counts only (no ₹, no minutes); lates / early exits are the review's counted figures for 1st → `to`;
 * personal missed punches skip bulk-failure days and today; every print recorded in audit_log. Synthetic codes (NB…).
 * October 2026: Sundays 4 / 11 / 18 / 25; Mon–Sat days 1–15 = 13.
 */
const F = require('./helpers/attendanceReviewFixture');
const S = require('../services/attendanceReviewService');
const { startJwtApi } = require('./helpers/jwtApiHarness');

const BASE = '/api/analytics/attendance-review';
const M = 10; const Y = 2026; const TODAY = '2026-10-20';
const board = (db, config = {}, over = {}) => S.noticeBoard(db, { month: M, year: Y, to: '2026-10-15', config, today: TODAY, ...over });
const wd = F.weekdays(Y, M);           // Mon–Sat dates of October
const first15 = wd.filter((d) => d <= '2026-10-15');

function seed(db) {
  // NBLATE: 4 lates by the 15th → named for lates
  F.emp(db, 'NBLATE'); first15.forEach((d, i) => F.day(db, 'NBLATE', d, i < 4 ? { lm: 45 } : {}));
  // NBLATE3: 3 lates by the 15th, 3 more after → not named on the 15th, named at month end
  F.emp(db, 'NBLATE3'); wd.forEach((d, i) => F.day(db, 'NBLATE3', d, (i < 3 || (d > '2026-10-15' && d < '2026-10-20')) ? { lm: 30 } : {}));
  // NBEARLY: 3 early exits → named for early exits
  F.emp(db, 'NBEARLY'); first15.forEach((d, i) => F.day(db, 'NBEARLY', d, i < 3 ? { em: 60 } : {}));
  // NBMP: 3 personal missed punches on ordinary days
  F.emp(db, 'NBMP'); first15.forEach((d, i) => F.day(db, 'NBMP', d, i >= 5 && i < 8 ? { mp: 1 } : {}));
  // NBSPOT: clean every day → on time every day
  F.emp(db, 'NBSPOT', { name: 'Aaa Spot' }); first15.forEach((d) => F.day(db, 'NBSPOT', d, {}));
  // NBFEW: clean but only 5 days → too few days for "on time every day"
  F.emp(db, 'NBFEW'); first15.slice(0, 5).forEach((d) => F.day(db, 'NBFEW', d, {}));
  // NBLOAD: loader, 6 lates (not assessed) → neither named for lates nor "on time"
  F.emp(db, 'NBLOAD', { designation: 'LOADER' }); first15.forEach((d, i) => F.day(db, 'NBLOAD', d, i < 6 ? { lm: 40 } : {}));
  // NBOUT: left out by a standing rule; NBHELD: held → neither shown
  F.emp(db, 'NBOUT'); first15.forEach((d, i) => F.day(db, 'NBOUT', d, i < 9 ? { lm: 50 } : {}));
  F.emp(db, 'NBHELD'); first15.forEach((d, i) => F.day(db, 'NBHELD', d, i < 9 ? { lm: 50 } : {}));
  // NBOTHER: other company, 5 lates
  F.emp(db, 'NBOTHER'); db.prepare("UPDATE employees SET company = 'Asian Lakto Ind Ltd' WHERE code = 'NBOTHER'").run();
  first15.forEach((d, i) => F.day(db, 'NBOTHER', d, i < 5 ? { lm: 25 } : {}));
}
const RULES = { standing_people: { NBOUT: { rule: 'exclude', reason: 'Senior staff' }, NBHELD: { rule: 'held', reason: 'Awaiting ruling' } } };
const codes = (list) => list.map((x) => x.code).sort();

describe('svc.noticeBoard', () => {
  let db;
  beforeAll(() => { db = F.newDb(); seed(db); });

  test('names 4+ lates, 3+ early exits, 3+ missed punches — counts only, no money or minutes', () => {
    const b = board(db, RULES);
    expect(codes(b.listed)).toEqual(['NBEARLY', 'NBLATE', 'NBMP', 'NBOTHER']);
    const late = b.listed.find((x) => x.code === 'NBLATE');
    expect(late).toMatchObject({ lates: 4, early_exits: 0, missed_punches: 0, flags: { late: true, early: false, missed: false } });
    expect(b.listed.find((x) => x.code === 'NBEARLY')).toMatchObject({ early_exits: 3, flags: { early: true } });
    expect(b.listed.find((x) => x.code === 'NBMP')).toMatchObject({ missed_punches: 3, flags: { missed: true } });
    const keys = new Set(b.listed.flatMap((x) => Object.keys(x)));
    for (const k of ['late_min', 'early_min', 'indicative_amount', 'gross_salary', 'deduction_days', 'workdays_lost']) expect(keys.has(k)).toBe(false);
    expect(b.counts).toMatchObject({ listed: 4, late: 2, early: 1, missed: 1 });
  });

  test('only the 1st → `to` counts: 3 lates by the 15th is not enough, 6 by month end is', () => {
    expect(board(db, RULES).listed.map((x) => x.code)).not.toContain('NBLATE3');
    const full = board(db, RULES, { to: '2026-10-31', today: '2026-11-02' });
    expect(full.listed.find((x) => x.code === 'NBLATE3')).toMatchObject({ lates: 6 });
  });

  test('standing leave-outs and held people are never shown; loaders are not named for lates', () => {
    const b = board(db, RULES);
    const all = [...codes(b.listed), ...codes(b.spotless)];
    for (const c of ['NBOUT', 'NBHELD', 'NBLOAD']) expect(all).not.toContain(c);
    // without the rules the left-out and held people do appear
    expect(codes(board(db, {}).listed)).toEqual(expect.arrayContaining(['NBOUT', 'NBHELD']));
  });

  test('"on time every day": clean and enough assessed days; loaders and short attendance left out', () => {
    const b = board(db, RULES);
    expect(b.meta).toMatchObject({ mon_sat_days: 13, spotless_min_days: 10 });
    expect(codes(b.spotless)).toEqual(['NBSPOT']);
    expect(b.spotless[0]).toMatchObject({ code: 'NBSPOT', name: 'Aaa Spot', assessed_days: 13 });
  });

  test('missed punches: bulk-failure days, skip days and today onward are not counted', () => {
    const d2 = F.newDb();
    F.emp(d2, 'NBA'); F.emp(d2, 'NBB');
    first15.forEach((d, i) => F.day(d2, 'NBA', d, i < 4 ? { mp: 1 } : {}));         // 4 missed: Oct 1, 2, 3, 5
    first15.forEach((d, i) => F.day(d2, 'NBB', d, i < 4 ? { mp: 1 } : {}));         // same days → each day has 2 rows
    // with a bulk threshold of 2 every one of those days is a system failure → nobody named
    const bulk = S.noticeBoard(d2, { month: M, year: Y, to: '2026-10-15', config: { thresholds: { bulk_miss_punch_day: 2 } }, today: TODAY });
    expect(bulk.meta.bulk_miss_punch_days.map((x) => x.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05']);
    expect(bulk.listed).toEqual([]);
    // normal threshold: 4 each; skipping 2 days leaves 2 (below 3)
    expect(S.noticeBoard(d2, { month: M, year: Y, to: '2026-10-15', config: {}, today: TODAY }).listed.map((x) => x.missed_punches)).toEqual([4, 4]);
    const skipped = S.noticeBoard(d2, { month: M, year: Y, to: '2026-10-15', config: {}, today: TODAY, skipDays: ['2026-10-01', '2026-10-02'] });
    expect(skipped.listed).toEqual([]); expect(skipped.meta.skip_days).toEqual(['2026-10-01', '2026-10-02']);
    // printed on the 3rd: only the 1st and 2nd are closed days
    const early = S.noticeBoard(d2, { month: M, year: Y, to: '2026-10-15', config: {}, today: '2026-10-03' });
    expect(early.meta.miss_punches_counted_to).toBe('2026-10-02'); expect(early.listed).toEqual([]);
  });

  test('company filter; footer carries the last attendance day covered', () => {
    const b = board(db, RULES, { company: 'Asian Lakto Ind Ltd' });
    expect(codes(b.listed)).toEqual(['NBOTHER']);
    expect(b.meta.companies).toEqual(['Asian Lakto Ind Ltd', 'Indriyan Beverages Pvt Ltd']);
    expect(b.footer.en).toMatch(/up to 15 October 2026\./);
    expect(b.footer.hi).toMatch(/15 October 2026 तक/);
    expect(b.footer.en).not.toMatch(/\{date\}/);
  });

  test('same engine as the review: at month end the counts equal the review\'s counted lates / early exits', () => {
    const rel = S.detectReleaseDays(db, M, Y, S.mergeConfig(RULES)).map((d) => d.date);
    const rv = S.computeAttendanceReview(db, { month: M, year: Y, config: RULES, releaseDays: rel, prevReleaseDays: [] });
    const b = board(db, RULES, { to: '2026-10-31', today: '2026-11-02' });
    for (const x of b.listed) {
      const p = rv.people.find((q) => q.code === x.code) || { late_days: 0, early_days: 0 };
      expect([x.code, x.lates, x.early_exits]).toEqual([x.code, p.late_days, p.early_days]);
    }
    const reviewNamed = new Set([...rv.noticeLate.map((n) => n.code), ...rv.noticeEarly.map((n) => n.code)]);
    for (const c of reviewNamed) expect(b.listed.map((x) => x.code)).toContain(c);
  });

  test('master basis: measured on the master shift, like the review', () => {
    const d3 = F.newDb();
    d3.prepare("INSERT INTO shifts (name, code, start_time, end_time, duration_hours) VALUES ('Ten', 'T10', '09:00', '19:00', 10)").run();
    F.emp(d3, 'NBM');
    d3.prepare("UPDATE employees SET default_shift_id = (SELECT id FROM shifts WHERE code = 'T10') WHERE code = 'NBM'").run();
    // in 09:30 on 4 days (late on a 09:00 master), out 19:00; import flags say nothing
    first15.forEach((d, i) => F.day(d3, 'NBM', d, { it: i < 4 ? '09:30' : '08:58', ot: '19:00' }));
    expect(S.noticeBoard(d3, { month: M, year: Y, to: '2026-10-15', config: {}, today: TODAY }).listed).toEqual([]);
    const b = S.noticeBoard(d3, { month: M, year: Y, to: '2026-10-15', config: { assessment_basis: 'master', late_full_hours: false }, today: TODAY });
    expect(b.listed).toEqual([expect.objectContaining({ code: 'NBM', lates: 4 })]);
    expect(b.meta.basis).toBe('master');
  });

  test('footer wording is validated', () => {
    expect(S.validateConfig({ board_footer_en: 'short' })).toEqual(['board_footer_en must be text of 10–800 characters']);
    expect(S.validateConfig({ board_footer_hi: 'यह एक लंबा पर्याप्त वाक्य है {date}', thresholds: { board_miss_punch_min: 4 } })).toEqual([]);
  });
});

describe('API: notice board', () => {
  let api; let db;
  beforeAll(() => {
    api = startJwtApi({ [BASE]: '../../routes/attendanceReview' }, { users: [{ username: 'adm', role: 'admin' }, { username: 'hr1', role: 'hr' }] });
    db = api.db; seed(db);
    db.prepare('INSERT INTO attendance_review_config (effective_from, config_json, updated_by) VALUES (?, ?, ?)').run('2026-10', JSON.stringify(RULES), 'adm');
  });
  afterAll(() => api.close());

  test('admin only; bad dates refused', async () => {
    expect((await api.request('GET', `${BASE}/board?month=10&year=2026&to=2026-10-15`, { as: 'hr1' })).status).toBe(403);
    expect((await api.request('POST', `${BASE}/board/prints`, { as: 'hr1', body: { month: 10, year: 2026, to: '2026-10-15' } })).status).toBe(403);
    for (const q of ['to=2026-11-01', 'to=2026-10-32', 'to=15-10-2026', 'skipDays=2026-09-30']) {
      expect((await api.request('GET', `${BASE}/board?month=10&year=2026&${q}`, { as: 'adm' })).status).toBe(400);
    }
    expect((await api.request('GET', `${BASE}/board?year=2026`, { as: 'adm' })).status).toBe(400);
  });

  test('GET: the board with the stored rules, defaulting to the 15th; no prints yet', async () => {
    const r = await api.request('GET', `${BASE}/board?month=10&year=2026`, { as: 'adm' });
    expect(r.status).toBe(200);
    expect(r.body.data.meta).toMatchObject({ from: '2026-10-01', to: '2026-10-15', covered_to: '2026-10-15' });
    expect(r.body.data.listed.map((x) => x.code)).not.toContain('NBOUT');
    expect(r.body.data.prints).toEqual([]);
  });

  test('POST records each print with who was named; the history counts them; nothing else is written', async () => {
    const before = { att: db.prepare('SELECT COUNT(*) n FROM attendance_processed').get().n, lcd: db.prepare('SELECT COUNT(*) n FROM late_coming_deductions').get().n,
      cfg: db.prepare('SELECT COUNT(*) n FROM attendance_review_config').get().n };
    const p1 = await api.request('POST', `${BASE}/board/prints`, { as: 'adm', body: { month: 10, year: 2026, to: '2026-10-15' } });
    expect(p1.status).toBe(201);
    expect(p1.body.data).toMatchObject({ number: 1, printed_by: 'adm' });
    const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(p1.body.data.print_id);
    expect(row).toMatchObject({ table_name: 'attendance_review_board', record_id: 202610, stage: 'ATTENDANCE_REVIEW_BOARD_PRINT', changed_by: 'adm' });
    const snap = JSON.parse(row.new_value);
    expect(snap.listed.map((x) => x[0]).sort()).toEqual(p1.body.data.board.listed.map((x) => x.code).sort());
    expect(snap.listed.find((x) => x[0] === 'NBLATE')).toEqual(['NBLATE', 4, 0, 0]);
    expect(snap.spotless).toEqual(['NBSPOT']);
    const p2 = await api.request('POST', `${BASE}/board/prints`, { as: 'adm', body: { month: 10, year: 2026, to: '2026-10-10', company: 'Asian Lakto Ind Ltd' } });
    expect(p2.body.data.number).toBe(2);
    const hist = (await api.request('GET', `${BASE}/board?month=10&year=2026`, { as: 'adm' })).body.data.prints;
    expect(hist.map((h) => [h.to, h.company])).toEqual([['2026-10-10', 'Asian Lakto Ind Ltd'], ['2026-10-15', null]]);
    expect({ att: db.prepare('SELECT COUNT(*) n FROM attendance_processed').get().n, lcd: db.prepare('SELECT COUNT(*) n FROM late_coming_deductions').get().n,
      cfg: db.prepare('SELECT COUNT(*) n FROM attendance_review_config').get().n }).toEqual(before);
  });

  test('a month with no attendance cannot be printed', async () => {
    const r = await api.request('POST', `${BASE}/board/prints`, { as: 'adm', body: { month: 3, year: 2026, to: '2026-03-15' } });
    expect(r.status).toBe(409);
  });
});

/**
 * Attendance Review T4 — Trends additions: waterfall, ₹ value of time lost, distributions, funnel, miss punches,
 * top people, effects and the trends workbook. Synthetic codes TM…, import basis, Sep–Oct 2026.
 */
const XLSX = require('xlsx');
const http = require('http');
const F = require('./helpers/attendanceReviewFixture');
const S = require('../services/attendanceReviewService');
const { startJwtApi } = require('./helpers/jwtApiHarness');

const oct = F.weekdays(2026, 10);
function seed(db) {
  // TM1: 10 lates — 2 × 12 min, 3 × 20, 3 × 45, 1 × 90, 1 × 150 (on the shift's 08:00 start, 12 h out 20:00 → not full hours)
  F.emp(db, 'TM1'); F.month(db, 'TM1', 2026, 9, 20);
  const lm = [12, 12, 20, 20, 20, 45, 45, 45, 90, 150];
  oct.slice(0, 22).forEach((d, i) => F.day(db, 'TM1', d, i < 10 ? { lm: lm[i] } : {}));
  // TM2: 4 lates of 30 min made up by staying the full 12 h (in 08:30, out 20:40) → excused by full hours
  F.emp(db, 'TM2'); F.month(db, 'TM2', 2026, 9, 20);
  oct.slice(0, 22).forEach((d, i) => F.day(db, 'TM2', d, i < 4 ? { lm: 30, it: '08:30', ot: '20:40' } : {}));
  // TM3: late 25 min the morning after staying late (stayed-late excuse) ×3
  F.emp(db, 'TM3'); F.month(db, 'TM3', 2026, 9, 20);
  oct.slice(0, 22).forEach((d, i) => F.day(db, 'TM3', d, [0, 2, 4].includes(i) ? { ll: 1, ot: '21:00' } : [1, 3, 5].includes(i) ? { lm: 25 } : {}));
  // TM4: a loader with 5 lates of 30 min (lates of loading staff are not counted)
  F.emp(db, 'TM4', { designation: 'LOADER' }); F.month(db, 'TM4', 2026, 9, 20);
  oct.slice(0, 22).forEach((d, i) => F.day(db, 'TM4', d, i < 5 ? { lm: 30 } : {}));
  // TM5: early exits 40, 70, 130 min on short days; 2 exits of 20 min on a full-hours day (in 07:30 out 19:40 = 12 h 10 m)
  F.emp(db, 'TM5'); F.month(db, 'TM5', 2026, 9, 20);
  oct.slice(0, 22).forEach((d, i) => F.day(db, 'TM5', d, i === 0 ? { em: 40 } : i === 1 ? { em: 70 } : i === 2 ? { em: 130 } : [3, 4].includes(i) ? { em: 20, it: '07:30', ot: '19:40' } : {}));
}

describe('engine: waterfall and distributions', () => {
  let db; let r;
  beforeAll(() => { db = F.newDb(); seed(db); r = S.computeAttendanceReview(db, { month: 10, year: 2026, config: {} }); });

  test('lates: measured − stayed late − full hours − loaders = counted', () => {
    const l = r.waterfall.lates;
    expect(l).toMatchObject({ measured: 22, stayed_late: 3, full_hours: 4, loaders: 5, counted: 10 });
    expect(l.measured - l.stayed_late - l.full_hours - l.loaders).toBe(l.counted);
  });

  test('early exits: measured − full hours − exempt + missed OUT = counted', () => {
    const e = r.waterfall.early;
    expect(e).toMatchObject({ measured: 5, full_hours: 2, exempt: 0, missed_out: 0, counted: 3 });
    expect(e.measured - e.full_hours - e.exempt + e.missed_out).toBe(e.counted);
  });

  test('bands and weekdays add up to the counted figures', () => {
    const d = r.distribution;
    expect(d.late_bands.map((b) => b.count)).toEqual([2, 3, 3, 1, 1]);                 // TM1 only (others excused / loader)
    expect(d.late_bands[4]).toMatchObject({ from: 120, to: null });
    expect(d.early_bands.map((b) => b.count)).toEqual([0, 1, 1, 1]);                   // 40, 70, 130 (the 20-min full-hours ones excused)
    expect(d.late_weekday.reduce((a, x) => a + x, 0)).toBe(r.waterfall.lates.counted);
    expect(d.early_weekday.reduce((a, x) => a + x, 0)).toBe(r.waterfall.early.counted);
    expect(d.late_weekday[0]).toBe(0);                                                   // no Sunday rows in the fixture
  });

  test('₹ value of the counted time = minutes ÷ shift minutes × gross ÷ days in month', () => {
    const mins = 2 * 12 + 3 * 20 + 3 * 45 + 90 + 150 + 40 + 70 + 130;
    expect(r.waterfall.minutes_counted).toBe(mins);
    expect(r.waterfall.value_lost_inr).toBe(Math.round((mins / 720) * (31000 / 31)));
  });

  test('MP-2 missed OUTs go into the 120+ band and their weekday', () => {
    const db2 = F.newDb(); F.emp(db2, 'TM9'); F.month(db2, 'TM9', 2026, 9, 20);
    oct.slice(0, 22).forEach((d, i) => F.day(db2, 'TM9', d, i < 6 ? { mp: 1 } : {}));
    db2.prepare("UPDATE attendance_processed SET miss_punch_type = 'MISSING_OUT', miss_punch_resolved = 1 WHERE is_miss_punch = 1").run();
    const x = S.computeAttendanceReview(db2, { month: 10, year: 2026, config: { missed_out_rule: true } });
    expect(x.waterfall.early.missed_out).toBe(2);                                        // 5th and 6th own missed punch
    expect(x.distribution.early_bands[3].count).toBe(2);
    expect(x.distribution.early_weekday.reduce((a, v) => a + v, 0)).toBe(x.waterfall.early.counted);
  });

  test('trendRow carries the new fields; an older stored result reads them as empty', () => {
    const row = S.trendRow(r, { month: 10, year: 2026, source: 'live' });
    expect(row.waterfall.lates.counted).toBe(10);
    expect(row.distribution.late_bands).toHaveLength(5);
    expect(row.people_counts.find((p) => p.code === 'TM1')).toMatchObject({ late_days: 10 });
    expect(row.ladder).toEqual({ rule: false, warnings: 0, hearings: 0 });
    const old = S.trendRow({ actionList: [], meta: {} }, { month: 8, year: 2026, source: 'final' });
    expect(old).toMatchObject({ waterfall: null, distribution: null, quality: null, early_people: [], people_counts: [], missed_out_counted: 0 });
  });
});

describe('cross-month figures', () => {
  const row = (ym, over = {}) => ({ ym, month: Number(ym.slice(5)), year: Number(ym.slice(0, 4)), action: { people: 0, deductions: 0, deduction_days: 0 },
    action_people: [], early_people: [], people_counts: [], ...over });

  test('top people: totals, labels, order', () => {
    const rows = [
      row('2026-08', { action_people: [{ code: 'A' }], people_counts: [{ code: 'A', name: 'a', worked_days: 20, late_days: 18, early_days: 0, workdays_lost: 1 },
        { code: 'B', worked_days: 20, late_days: 5, early_days: 5, workdays_lost: 0.6 }, { code: 'C', worked_days: 20, late_days: 6, early_days: 2, workdays_lost: 0.5 }] }),
      row('2026-09', { early_people: [{ code: 'A' }], people_counts: [{ code: 'A', worked_days: 20, late_days: 2, early_days: 17, workdays_lost: 2 },
        { code: 'C', worked_days: 20, late_days: 1, early_days: 0, workdays_lost: 0.1 }] }),
    ];
    const t = S.topPeople(rows);
    expect(t.map((p) => p.code)).toEqual(['A', 'B', 'C']);
    expect(t[0]).toMatchObject({ late_days: 20, early_days: 17, worked_days: 40, listed_months: 2, workdays_lost: 3 });
    expect(t[0].labels).toEqual(expect.arrayContaining(['late almost every day — check the shift start', 'leaves early almost every day — check the shift end', 'on a list in 2 months']));
    expect(t[1].labels).toEqual(['late and early in the same month']);
    expect(t[2].labels).toEqual(['improving']);
  });

  test('effects: note cohort M vs M+1, board before vs after the print', () => {
    const db = F.newDb();
    F.emp(db, 'E1'); F.day(db, 'E1', '2026-10-29', {});
    db.prepare(`INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark)
      VALUES ('attendance_review_board', 202610, 'board_print', '', ?, 'adm', 'ATTENDANCE_REVIEW_BOARD_PRINT', 'No. 1')`)
      .run(JSON.stringify({ to: '2026-10-15', covered_to: '2026-10-15', listed: [['E1', 6, 2, 0], ['E2', 4, 0, 0]], spotless: [] }));
    const rows = [
      row('2026-09', { action_people: [{ code: 'E1' }, { code: 'E2' }], people_counts: [{ code: 'E1', late_days: 8, early_days: 2 }, { code: 'E2', late_days: 10, early_days: 0 }] }),
      row('2026-10', { action_people: [{ code: 'E1' }], people_counts: [{ code: 'E1', late_days: 7, early_days: 2 }, { code: 'E2', late_days: 5, early_days: 0 }] }),
    ];
    const e = S.effects(db, rows);
    expect(e.notes).toEqual([{ ym: '2026-09', next_ym: '2026-10', people: 2, before: 20, after: 14, change_pct: -30, listed_again: 1 }]);
    // up to 15 Oct: 13 working days, 12 at print over 2 people; after: 16–29 Oct = 12 working days, (14 − 12) over 2 people
    expect(e.boards[0]).toMatchObject({ ym: '2026-10', to: '2026-10-15', named: 2, at_print: 12, after_print: 2, days_after: 12,
      per_person_day_before: Math.round((12 / 2 / 13) * 100) / 100, per_person_day_after: Math.round((2 / 2 / 12) * 100) / 100 });
    expect(e.boards[0].change_pct).toBeLessThan(0);
  });

  test('funnel and miss punches from the tables', () => {
    const db = F.newDb(); F.emp(db, 'FN1'); F.emp(db, 'FN2');
    const ins = db.prepare(`INSERT INTO late_coming_deductions (employee_code, month, year, company, late_count, deduction_days, remark, applied_by, finance_status, is_applied_to_salary, applied_at)
      VALUES (?, 10, 2026, 'C', 8, ?, ?, 'adm', ?, ?, datetime('now', ?))`);
    ins.run('FN1', 1, 'review [review run 3]', 'approved', 1, '-1 seconds'); ins.run('FN2', 0.5, 'review [review run 3]', 'rejected', 0, '-2 seconds');
    ins.run('FN2', 1, 'by hand', 'approved', 0, '-3 seconds');
    const f = S.funnelRow(db, row('2026-10', { run_id: 3, action: { people: 3, deductions: 2, deduction_days: 1.5 },
      early_people: [{ code: 'X', action: 'deduction', deduction_days: 0.5 }, { code: 'Y', action: 'warning', deduction_days: 0 }] }));
    expect(f).toMatchObject({ listed: 5, decided: 3, decided_days: 2, sent: 2, sent_days: 1.5, approved: 1, rejected: 1, pending: 0, in_salary: 1, other_rows: 1, other_approved: 1, inr_in_salary: 0 });
    // miss punches: 3 own (1 fixed) + a failure day with 2 rows (threshold 2)
    oct.slice(0, 3).forEach((d) => F.day(db, 'FN1', d, { mp: 1 }));
    db.prepare("UPDATE attendance_processed SET miss_punch_resolved = 1 WHERE employee_code = 'FN1' AND date = ?").run(oct[0]);
    F.day(db, 'FN2', oct[5], { mp: 1 }); F.day(db, 'FN1', oct[5], { mp: 1 });
    expect(S.missPunchRow(db, 10, 2026, 2, 4)).toEqual({ total: 5, people: 2, bulk_days: 1, on_bulk_days: 2, own: 3, fixed: 1, open: 4, counted_as_early: 4 });
  });
});

describe('API: /trends additions and the workbook', () => {
  const BASE = '/api/analytics/attendance-review';
  let api;
  beforeAll(() => { api = startJwtApi({ [BASE]: '../../routes/attendanceReview' }, { users: [{ username: 'adm', role: 'admin' }, { username: 'hr1', role: 'hr' }] }); seed(api.db); });
  afterAll(() => api.close());

  test('trends carry funnel, miss punches, waterfall, top people, effects; people lists stay server-side', async () => {
    const r = await api.request('GET', `${BASE}/trends?from=2026-09&to=2026-10`, { as: 'adm' });
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.months.map((m) => m.ym)).toEqual(['2026-09', '2026-10']);
    const o = d.months[1];
    expect(o.waterfall.lates.counted).toBe(10);
    expect(o.funnel).toMatchObject({ sent: 0, approved: 0 });
    expect(o.miss_punch).toMatchObject({ total: 0 });
    expect(o.people_counts).toBeUndefined();
    expect(d.top_people[0].code).toBe('TM1');
    expect(d.effects).toEqual({ notes: expect.any(Array), boards: [] });
  });

  test('workbook: 200 with the five sheets and an audit row; hr refused', async () => {
    const r = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: api.server.address().port, path: `${BASE}/trends/export.xlsx?from=2026-09&to=2026-10`,
        headers: { Authorization: `Bearer ${api.tokens.adm}` } }, (res) => {
        const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }); req.on('error', reject); req.end();
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toBe('attachment; filename="Attendance_Trends_2026-09_to_2026-10.xlsx"');
    const wb = XLSX.read(r.body, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Months', 'Departments', 'Distribution', 'Top people', 'Effect']);
    const months = XLSX.utils.sheet_to_json(wb.Sheets.Months);
    expect(months[1]).toMatchObject({ Month: '2026-10', 'Lates counted': 10 });
    expect(api.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE stage = 'ATTENDANCE_REVIEW_EXPORT' AND remark LIKE 'trends%'").get().n).toBe(1);
    expect((await api.request('GET', `${BASE}/trends/export.xlsx?from=2026-09&to=2026-10`, { as: 'hr1' })).status).toBe(403);
    expect((await api.request('GET', `${BASE}/trends/export.xlsx?from=2026-9&to=2026-10`, { as: 'adm' })).status).toBe(400);
  });
});

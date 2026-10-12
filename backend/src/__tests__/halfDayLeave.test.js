/**
 * Owner ruling 12 Oct 2026: from September 2026 a paid leave (EL, paid CL)
 * counts what it pays — 1 on an absent day, 0.5 on a half day (its absent half
 * is paid), 0 on a day already worked. Earlier months keep the old rule.
 */
const { calculateDays } = require('../services/dayCalculation');

function daysIn(m, y) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function records(month, year) {
  const out = [];
  for (let d = 1; d <= daysIn(month, year); d += 1) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const wo = new Date(`${date}T12:00:00Z`).getUTCDay() === 0;
    out.push({ date, month, year, status_original: wo ? 'WO' : 'P', status_final: wo ? 'WO' : 'P',
      in_time_original: '08:00', out_time_original: '20:00', is_night_out_only: 0, is_miss_punch: 0 });
  }
  return out;
}
function setStatus(recs, date, s) {
  const r = recs.find((x) => x.date === date);
  r.status_original = s; r.status_final = s;
  if (s === 'A') { r.in_time_original = null; r.out_time_original = null; }
  return recs;
}
const leave = (type, start, end = start) => ({ leave_type: type, start_date: start, end_date: end, status: 'Approved' });
const run = (m, y, recs, leaves) => calculateDays('HDTEST', m, y, 'Asian Lakto Ind Ltd', recs, {}, [],
  { isContractor: false, weeklyOffDay: 0, employmentType: 'Permanent', approvedLeaves: leaves, approvedCompOff: [] });

describe('half-day leave, September 2026 onward', () => {
  const HALF = '2026-09-21';
  test('control: a half day without leave pays half', () => {
    const out = run(9, 2026, setStatus(records(9, 2026), HALF, '½P'), []);
    expect(out.totalPayableDays).toBe(29.5);
  });

  test('EL on a half day pays the absent half and counts 0.5', () => {
    const out = run(9, 2026, setStatus(records(9, 2026), HALF, '½P'), [leave('EL', HALF)]);
    expect(out.totalPayableDays).toBe(30);
    expect(out.elUsed).toBe(0.5);
  });

  test('paid CL on a half day does the same', () => {
    const out = run(9, 2026, setStatus(records(9, 2026), HALF, 'HP'), [leave('CL', HALF)]);
    expect(out.totalPayableDays).toBe(30);
    expect(out.clUsed).toBe(0.5);
  });

  test('shape of the reported case: EL on Sunday + half day → 0.5 counted, Sunday ignored', () => {
    const recs = setStatus(records(9, 2026), HALF, '½P');
    const out = run(9, 2026, recs, [leave('EL', '2026-09-20', HALF)]);
    expect(out.elUsed).toBe(0.5);
    expect(out.totalPayableDays).toBe(30);
  });

  test('EL on a day already worked counts 0 and pays nothing extra', () => {
    const base = run(9, 2026, records(9, 2026), []);
    const out = run(9, 2026, records(9, 2026), [leave('EL', '2026-09-22')]);
    expect(out.elUsed).toBe(0);
    expect(out.totalPayableDays).toBe(base.totalPayableDays);
  });

  test('EL on an absent day still counts 1 and pays 1', () => {
    const base = run(9, 2026, setStatus(records(9, 2026), '2026-09-22', 'A'), []);
    const out = run(9, 2026, setStatus(records(9, 2026), '2026-09-22', 'A'), [leave('EL', '2026-09-22')]);
    expect(out.elUsed).toBe(1);
    expect(out.totalPayableDays).toBe(base.totalPayableDays + 1);
  });

  test('LWP on a half day pays nothing extra', () => {
    const base = run(9, 2026, setStatus(records(9, 2026), HALF, '½P'), []);
    const out = run(9, 2026, setStatus(records(9, 2026), HALF, '½P'), [leave('LWP', HALF)]);
    expect(out.totalPayableDays).toBe(base.totalPayableDays);
  });

  test('no integrity warning for half-day and worked-day leave', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const recs = setStatus(setStatus(records(9, 2026), HALF, '½P'), '2026-09-23', 'A');
    run(9, 2026, recs, [leave('EL', HALF), leave('CL', '2026-09-23'), leave('EL', '2026-09-24')]);
    const hits = warn.mock.calls.filter((c) => String(c[0]).includes('Integrity warning'));
    warn.mockRestore();
    expect(hits).toHaveLength(0);
  });
});

describe('August 2026 keeps the old rule', () => {
  test('EL on a half day: pays nothing extra, counts 1', () => {
    const base = run(8, 2026, setStatus(records(8, 2026), '2026-08-18', '½P'), []);
    const out = run(8, 2026, setStatus(records(8, 2026), '2026-08-18', '½P'), [leave('EL', '2026-08-18')]);
    expect(out.elUsed).toBe(1);
    expect(out.totalPayableDays).toBe(base.totalPayableDays);
  });
});

describe('LWP never cuts a worked day (Sep 2026 onward)', () => {
  test('LWP on a full day worked pays the same as no leave', () => {
    const base = run(9, 2026, records(9, 2026), []);
    const out = run(9, 2026, records(9, 2026), [leave('LWP', '2026-09-22')]);
    expect(out.totalPayableDays).toBe(base.totalPayableDays);
  });
  test('LWP on an absent day still pays nothing for it', () => {
    const base = run(9, 2026, setStatus(records(9, 2026), '2026-09-22', 'A'), []);
    const out = run(9, 2026, setStatus(records(9, 2026), '2026-09-22', 'A'), [leave('LWP', '2026-09-22')]);
    expect(out.totalPayableDays).toBe(base.totalPayableDays);
  });
});

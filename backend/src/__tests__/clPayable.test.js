/**
 * Owner ruling 12 Oct 2026: CL is paid leave from the September 2026 payroll.
 * An approved CL on an absent working day restores the payable day, exactly
 * like EL. Months before September 2026 keep the old rule (CL only relabels
 * the absence) so re-running a settled month never changes its pay.
 */
const { calculateDays } = require('../services/dayCalculation');

function daysIn(month, year) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

function records(month, year, status = 'P') {
  const out = [];
  for (let d = 1; d <= daysIn(month, year); d += 1) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    out.push({
      date, month, year,
      status_original: dow === 0 ? 'WO' : status,
      status_final: dow === 0 ? 'WO' : status,
      in_time_original: '08:00', out_time_original: '20:00',
      is_night_out_only: 0, is_miss_punch: 0,
    });
  }
  return out;
}

/** Mark the given dates absent (working days only). */
function absentOn(recs, dates) {
  for (const r of recs) {
    if (dates.includes(r.date) && r.status_final !== 'WO') {
      r.status_original = 'A';
      r.status_final = 'A';
      r.in_time_original = null;
      r.out_time_original = null;
    }
  }
  return recs;
}

const leave = (type, start, end = start) => ({
  leave_type: type, start_date: start, end_date: end, status: 'Approved',
});

function run(month, year, recs, approvedLeaves, extra = {}) {
  return calculateDays(
    'CLTEST', month, year, 'Asian Lakto Ind Ltd',
    recs, { CL: 4, EL: 10 }, [],
    { isContractor: false, weeklyOffDay: 0, employmentType: 'Permanent', approvedLeaves, approvedCompOff: [], ...extra }
  );
}

describe('CL is paid from September 2026', () => {
  const SEP = ['2026-09-17', '2026-09-18', '2026-09-19'];

  test('three CL days restore three payable days in September 2026', () => {
    const base = run(9, 2026, absentOn(records(9, 2026), SEP), []);
    const withCl = run(9, 2026, absentOn(records(9, 2026), SEP), [leave('CL', SEP[0], SEP[2])]);
    expect(withCl.clUsed).toBe(3);
    expect(withCl.totalPayableDays).toBe(base.totalPayableDays + 3);
    expect(withCl.uninformedAbsent).toBe(0);
  });

  test('CL and EL now pay the same', () => {
    const withCl = run(9, 2026, absentOn(records(9, 2026), SEP), [leave('CL', SEP[0], SEP[2])]);
    const withEl = run(9, 2026, absentOn(records(9, 2026), SEP), [leave('EL', SEP[0], SEP[2])]);
    expect(withCl.totalPayableDays).toBe(withEl.totalPayableDays);
  });

  test('October 2026 and later are paid too', () => {
    const OCT = ['2026-10-06'];
    const base = run(10, 2026, absentOn(records(10, 2026), OCT), []);
    const withCl = run(10, 2026, absentOn(records(10, 2026), OCT), [leave('CL', OCT[0])]);
    expect(withCl.totalPayableDays).toBe(base.totalPayableDays + 1);
  });

  test('August 2026 and earlier keep the old rule: CL relabels, pay unchanged', () => {
    const AUG = ['2026-08-18', '2026-08-19'];
    const base = run(8, 2026, absentOn(records(8, 2026), AUG), []);
    const withCl = run(8, 2026, absentOn(records(8, 2026), AUG), [leave('CL', AUG[0], AUG[1])]);
    expect(withCl.clUsed).toBe(2);
    expect(withCl.totalPayableDays).toBe(base.totalPayableDays);
    // June 2025 (195.5 CL days in production) must also stay as settled.
    const JUN = ['2025-06-10'];
    const b25 = run(6, 2025, absentOn(records(6, 2025), JUN), []);
    const c25 = run(6, 2025, absentOn(records(6, 2025), JUN), [leave('CL', JUN[0])]);
    expect(c25.totalPayableDays).toBe(b25.totalPayableDays);
  });

  test('a CL on a day already worked adds nothing (no double pay)', () => {
    const base = run(9, 2026, records(9, 2026), []);
    const withCl = run(9, 2026, records(9, 2026), [leave('CL', '2026-09-17')]);
    expect(withCl.totalPayableDays).toBe(base.totalPayableDays);
    expect(withCl.clUsed).toBe(1);
  });

  test('a CL on a Sunday is ignored', () => {
    const recs = absentOn(records(9, 2026), ['2026-09-17']);
    const base = run(9, 2026, recs.map(r => ({ ...r })), []);
    const withCl = run(9, 2026, recs.map(r => ({ ...r })), [leave('CL', '2026-09-20')]); // Sunday
    expect(withCl.clUsed).toBe(0);
    expect(withCl.totalPayableDays).toBe(base.totalPayableDays);
  });

  test('LWP stays unpaid in September 2026', () => {
    const base = run(9, 2026, absentOn(records(9, 2026), SEP), []);
    const withLwp = run(9, 2026, absentOn(records(9, 2026), SEP), [leave('LWP', SEP[0], SEP[2])]);
    expect(withLwp.totalPayableDays).toBe(base.totalPayableDays);
  });

  test('mixed month (shape of employee 23698): 1 CL + 2 EL + 2 plain absences', () => {
    const ABS = ['2026-09-05', '2026-09-07', '2026-09-18', '2026-09-19', '2026-09-23'];
    const recs = () => absentOn(records(9, 2026), ABS);
    const base = run(9, 2026, recs(), []);
    const out = run(9, 2026, recs(), [
      leave('EL', '2026-09-05'), leave('CL', '2026-09-18'), leave('EL', '2026-09-19'),
    ]);
    expect(out.clUsed).toBe(1);
    expect(out.elUsed).toBe(2);
    expect(out.uninformedAbsent).toBe(2);
    expect(out.totalPayableDays).toBe(base.totalPayableDays + 3);
  });

  test('the integrity check stays quiet for paid CL', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    run(9, 2026, absentOn(records(9, 2026), SEP), [leave('CL', SEP[0], SEP[2])]);
    const integrity = warn.mock.calls.filter(c => String(c[0]).includes('Integrity warning'));
    warn.mockRestore();
    expect(integrity).toHaveLength(0);
  });

  test('contractors are unaffected (their path ignores leave)', () => {
    const recs = () => absentOn(records(9, 2026), SEP);
    const base = run(9, 2026, recs(), [], { isContractor: true, employmentType: 'Contract' });
    const withCl = run(9, 2026, recs(), [leave('CL', SEP[0], SEP[2])], { isContractor: true, employmentType: 'Contract' });
    expect(withCl.totalPayableDays).toBe(base.totalPayableDays);
  });
});

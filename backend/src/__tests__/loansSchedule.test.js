/**
 * Loans PR-2 — money, months, schedule (docs/loans/SPEC.md §5.2 r3, K11).
 */
const { toPaise, toRupees, parseAmount, ceilToRupee } = require('../services/loans/money');
const M = require('../services/loans/months');
const S = require('../services/loans/schedule');

const sum = (ins) => ins.reduce((s, i) => s + i.amountPaise, 0);

describe('money', () => {
  test('paise round-trip and 2-decimal guard', () => {
    expect(toPaise(10000.1)).toBe(1000010);
    expect(toPaise('3334.33')).toBe(333433);
    expect(toRupees(333433)).toBe(3334.33);
    expect(toPaise('abc')).toBeNaN();
    expect(parseAmount(0.1 + 0.2).ok).toBe(true); // float noise within 1e-6 paise
    expect(parseAmount(10.001).code).toBe('AMOUNT_INVALID');
    expect(parseAmount(0).ok).toBe(false);
    expect(parseAmount(0, { allowZero: true }).paise).toBe(0);
    expect(parseAmount(-1).ok).toBe(false);
    expect(parseAmount(NaN).ok).toBe(false);
    expect(parseAmount('').ok).toBe(false);
    expect(ceilToRupee(333333)).toBe(333400);
    expect(ceilToRupee(333300)).toBe(333300);
  });
});

describe('months', () => {
  test('year wrap and comparisons', () => {
    expect(M.addMonths({ month: 11, year: 2026 }, 3)).toEqual({ month: 2, year: 2027 });
    expect(M.addMonths({ month: 1, year: 2027 }, -1)).toEqual({ month: 12, year: 2026 });
    expect(M.compareMonth({ month: 1, year: 2027 }, { month: 12, year: 2026 })).toBeGreaterThan(0);
  });
  test('end-of-month clamp, leap years', () => {
    expect(M.addMonthsToDate('2024-08-31', 6)).toBe('2025-02-28');
    expect(M.addMonthsToDate('2023-08-31', 6)).toBe('2024-02-29');
    expect(M.addMonthsToDate('2024-02-29', 12)).toBe('2025-02-28');
    expect(M.addMonthsToDate('2026-03-15', 6)).toBe('2026-09-15');
  });
  test('invalid dates rejected (incl. the 0026 DOJ seen on production)', () => {
    expect(M.parseDate('0026-03-21')).toBeNull();
    expect(M.parseDate('2026-02-30')).toBeNull();
    expect(M.parseDate('15/03/2026')).toBeNull();
    expect(M.parseDate(null)).toBeNull();
    expect(M.parseDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
  });
  test('todayIst crosses midnight at 18:30 UTC', () => {
    expect(M.todayIst(new Date('2026-10-09T18:29:00Z'))).toBe('2026-10-09');
    expect(M.todayIst(new Date('2026-10-09T18:30:00Z'))).toBe('2026-10-10');
  });
});

describe('buildSchedule', () => {
  const first = { month: 11, year: 2026 };
  test('SPEC: ₹10,000 over 3 → 3,334 / 3,334 / 3,332', () => {
    const r = S.buildSchedule({ principalPaise: 1000000, tenure: 3, firstMonth: first });
    expect(r.ok).toBe(true);
    expect(r.instalments.map((i) => i.amountPaise)).toEqual([333400, 333400, 333200]);
    expect(sum(r.instalments)).toBe(1000000);
    expect(r.instalments.map((i) => `${i.year}-${i.month}`)).toEqual(['2026-11', '2026-12', '2027-1']);
  });
  test('exact division, single month, paisa principal', () => {
    expect(S.buildSchedule({ principalPaise: 900000, tenure: 3, firstMonth: first }).instalments.map((i) => i.amountPaise)).toEqual([300000, 300000, 300000]);
    const one = S.buildSchedule({ principalPaise: 1000050, tenure: 1, firstMonth: first });
    expect(one.instalments).toHaveLength(1);
    expect(one.instalments[0].amountPaise).toBe(1000050);
    const paisa = S.buildSchedule({ principalPaise: 1000050, tenure: 3, firstMonth: first });
    expect(paisa.instalments.map((i) => i.amountPaise)).toEqual([333400, 333400, 333250]);
    expect(sum(paisa.instalments)).toBe(1000050);
  });
  test('every principal 1..2000 rupees × tenure 1..12 sums exactly or refuses', () => {
    for (let rupees = 1; rupees <= 2000; rupees += 7) {
      for (let n = 1; n <= 12; n++) {
        const r = S.buildSchedule({ principalPaise: rupees * 100 + 37, tenure: n, firstMonth: first });
        if (r.ok) {
          expect(sum(r.instalments)).toBe(rupees * 100 + 37);
          expect(r.instalments.every((i) => i.amountPaise > 0)).toBe(true);
          expect(r.instalments.slice(0, -1).every((i) => i.amountPaise % 100 === 0)).toBe(true);
        } else {
          expect(r.code).toBe('TENURE_TOO_LONG_FOR_AMOUNT');
          expect(r.maxTenure).toBeLessThan(n);
        }
      }
    }
  });
  test('TENURE_TOO_LONG_FOR_AMOUNT: ₹25 over 12 months', () => {
    const r = S.buildSchedule({ principalPaise: 2500, tenure: 12, firstMonth: first });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TENURE_TOO_LONG_FOR_AMOUNT');
    expect(S.buildSchedule({ principalPaise: 2500, tenure: r.maxTenure, firstMonth: first }).ok).toBe(true);
  });
  test('bad inputs', () => {
    expect(S.buildSchedule({ principalPaise: 0, tenure: 3, firstMonth: first }).code).toBe('AMOUNT_INVALID');
    expect(S.buildSchedule({ principalPaise: 100, tenure: 0, firstMonth: first }).code).toBe('TENURE_INVALID');
    expect(S.buildSchedule({ principalPaise: 100, tenure: 1.5, firstMonth: first }).code).toBe('TENURE_INVALID');
    expect(S.buildSchedule({ principalPaise: 100, tenure: 1, firstMonth: { month: 13, year: 2026 } }).code).toBe('MONTH_INVALID');
  });
  test('by EMI', () => {
    const r = S.buildScheduleByEmi({ principalPaise: 1000000, emiPaise: 400000, firstMonth: first });
    expect(r.instalments.map((i) => i.amountPaise)).toEqual([400000, 400000, 200000]);
    expect(S.buildScheduleByEmi({ principalPaise: 1000000, emiPaise: 400050, firstMonth: first }).code).toBe('EMI_INVALID');
  });
});

describe('firstEmiMonth (K11)', () => {
  test('month after the disbursement month', () => {
    expect(S.firstEmiMonth({ disbursedOn: '2026-10-05', closed: new Set() }).month).toEqual({ month: 11, year: 2026 });
    expect(S.firstEmiMonth({ disbursedOn: '2026-12-31', closed: new Set() }).month).toEqual({ month: 1, year: 2027 });
  });
  test('skips months already closed for the payroll', () => {
    const closed = new Set([M.monthIndex({ month: 9, year: 2026 }), M.monthIndex({ month: 10, year: 2026 })]);
    expect(S.firstEmiMonth({ disbursedOn: '2026-08-20', closed }).month).toEqual({ month: 11, year: 2026 });
  });
  test('later allowed, earlier refused', () => {
    expect(S.firstEmiMonth({ disbursedOn: '2026-10-05', closed: new Set(), requested: { month: 2, year: 2027 } }).month).toEqual({ month: 2, year: 2027 });
    const r = S.firstEmiMonth({ disbursedOn: '2026-10-05', closed: new Set(), requested: { month: 10, year: 2026 } });
    expect(r.code).toBe('FIRST_EMI_TOO_EARLY');
    expect(S.firstEmiMonth({ disbursedOn: 'yesterday', closed: new Set() }).code).toBe('DATE_INVALID');
  });
});

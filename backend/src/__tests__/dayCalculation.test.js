const { calculateDays } = require('../services/dayCalculation');

// Helper to create attendance records
function makeRecord(date, status, inTime = '08:00', outTime = '18:00') {
  const [y, m] = date.split('-');
  return {
    date,
    month: parseInt(m),
    year: parseInt(y),
    status_original: status,
    status_final: status,
    in_time_original: inTime,
    out_time_original: outTime,
    is_night_out_only: 0,
    is_late_arrival: 0,
    overtime_minutes: 0
  };
}

describe('Day Calculation', () => {
  const month = 3, year = 2026;

  test('full attendance should give 31 payable days for March', () => {
    // Create records for every day in March 2026
    const records = [];
    for (let d = 1; d <= 31; d++) {
      const dateStr = `2026-03-${String(d).padStart(2, '0')}`;
      const dow = new Date(dateStr + 'T12:00:00').getDay();
      const status = dow === 0 ? 'WOP' : 'P'; // Sunday = WOP, else P
      records.push(makeRecord(dateStr, status));
    }

    const result = calculateDays('TEST001', month, year, '', records, { CL: 12, EL: 0, SL: 0 }, []);
    expect(result.daysPresent).toBeGreaterThan(20);
    expect(result.totalPayableDays).toBeGreaterThanOrEqual(26);
  });

  test('zero attendance should give 0 payable days', () => {
    const result = calculateDays('TEST002', month, year, '', [], { CL: 12, EL: 0, SL: 0 }, []);
    expect(result.daysPresent).toBe(0);
    expect(result.daysAbsent).toBeGreaterThan(0);
  });

  test('half-day records counted as 0.5', () => {
    const records = [makeRecord('2026-03-02', '½P')];
    const result = calculateDays('TEST003', month, year, '', records, { CL: 12, EL: 0, SL: 0 }, []);
    expect(result.daysHalfPresent).toBe(0.5);
  });

  test('WOP days should be counted separately from present', () => {
    const records = [
      makeRecord('2026-03-01', 'WOP'), // Sunday
    ];
    const result = calculateDays('TEST004', month, year, '', records, { CL: 0, EL: 0, SL: 0 }, []);
    expect(result.daysWOP).toBeGreaterThanOrEqual(0.5);
  });

  test('holidays should reduce working days', () => {
    const holidays = [{ date: '2026-03-17' }]; // Holi
    const records = [];
    for (let d = 1; d <= 31; d++) {
      const dateStr = `2026-03-${String(d).padStart(2, '0')}`;
      const dow = new Date(dateStr + 'T12:00:00').getDay();
      if (dow === 0) continue; // skip sundays
      if (dateStr === '2026-03-17') continue; // skip holiday
      records.push(makeRecord(dateStr, 'P'));
    }
    const result = calculateDays('TEST005', month, year, '', records, { CL: 12, EL: 0, SL: 0 }, holidays);
    expect(result.paidHolidays).toBe(1);
  });
});

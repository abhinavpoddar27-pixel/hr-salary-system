/**
 * Synthetic attendance fixture for the Attendance Review specs. Codes are fake (AR…), never real employees.
 * Current month = Oct 2026, previous = Sep 2026. Sundays: Sep 6/13/20/27, Oct 4/11/18/25.
 */
const { newDb } = require('./leaveFixture');

function emp(db, code, over = {}) {
  db.prepare(`INSERT INTO employees (code, name, department, designation, company, employment_type, status, date_of_joining,
      is_contractor, gross_salary) VALUES (?, ?, ?, ?, 'Indriyan Beverages Pvt Ltd', ?, 'Active', '2024-01-01', ?, ?)`)
    .run(code, over.name || `Test ${code}`, over.department || 'PRODUCTION', over.designation || 'OPERATOR',
      over.employment_type || 'Permanent', over.is_contractor || 0, over.gross_salary ?? 31000);
  return code;
}

/** One attendance_processed row. Defaults: present, on time, on the 12-hour shift. */
function day(db, code, date, o = {}) {
  db.prepare(`INSERT INTO attendance_processed (employee_code, date, status_original, status_final, in_time_final, out_time_final,
      shift_detected, is_night_shift, is_miss_punch, is_late_arrival, late_by_minutes, is_early_departure, early_by_minutes, is_left_late, month, year)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(code, date, o.st || 'P', o.st || 'P', o.it || '08:00', o.ot || '20:00', o.sd || '12-Hour Shift', o.night || 0, o.mp || 0,
      o.lm ? 1 : 0, o.lm || 0, o.em ? 1 : 0, o.em || 0, o.ll || 0, Number(date.slice(5, 7)), Number(date.slice(0, 4)));
}

/** Working days (Mon–Sat) of a month, in order. */
function weekdays(year, month) {
  const out = []; const n = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let d = 1; d <= n; d++) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (new Date(`${iso}T00:00:00Z`).getUTCDay() !== 0) out.push(iso);
  }
  return out;
}

/** Fills `n` worked weekdays of a month; fn(i, iso) returns per-day overrides. */
function month(db, code, year, mon, n, fn = () => ({})) {
  weekdays(year, mon).slice(0, n).forEach((iso, i) => day(db, code, iso, fn(i, iso) || {}));
}

module.exports = { newDb, emp, day, month, weekdays };

'use strict';

/**
 * Sales Salary Cycle Utility (Phase 1 — April 2026)
 *
 * Canonical rule: the sales salary cycle ending in month M of year Y is
 * the inclusive date range (M-1)-26 through M-25.
 *
 * Examples:
 *   Feb 2026 → 2026-01-26 … 2026-02-25 (31 days)
 *   Mar 2026 → 2026-02-26 … 2026-03-25 (28 days — Feb 2026 has 28 days)
 *   Jan 2026 → 2025-12-26 … 2026-01-25 (31 days — year rollover)
 *   Mar 2024 → 2024-02-26 … 2024-03-25 (29 days — leap-year Feb has 29)
 *
 * CRITICAL: pure, no DB, no I/O, no locale-sensitive date parsing.
 * Implemented with UTC integer arithmetic and ISO-8601 strings
 * (which are lexically comparable, so `a <= b` works on YYYY-MM-DD).
 */

const DAYS_IN_MONTH_COMMON = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(month, year) {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH_COMMON[month - 1];
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function iso(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Derive cycle start + end for the cycle ending in (month, year).
 *
 * @param {number} month  1-12
 * @param {number} year   YYYY (integer)
 * @returns {{start: string, end: string, lengthDays: number}}
 */
function deriveCycle(month, year) {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`deriveCycle: month must be 1-12 (got ${month})`);
  }
  if (!Number.isInteger(year) || year < 1900 || year > 3000) {
    throw new Error(`deriveCycle: year must be a reasonable YYYY (got ${year})`);
  }

  // Start = day 26 of previous month (with year rollover for January)
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear  = month === 1 ? year - 1 : year;
  const start = iso(prevYear, prevMonth, 26);

  // End = day 25 of cycle-end month
  const end = iso(year, month, 25);

  return { start, end, lengthDays: cycleLengthDays(start, end) };
}

/**
 * Integer day count between two ISO dates (inclusive).
 * Uses Date.UTC to avoid DST/timezone drift; result is exact.
 *
 * @param {string} startISO 'YYYY-MM-DD'
 * @param {string} endISO   'YYYY-MM-DD'
 */
function cycleLengthDays(startISO, endISO) {
  const [sy, sm, sd] = startISO.split('-').map(Number);
  const [ey, em, ed] = endISO.split('-').map(Number);
  const sMs = Date.UTC(sy, sm - 1, sd);
  const eMs = Date.UTC(ey, em - 1, ed);
  const diff = Math.round((eMs - sMs) / 86400000);
  return diff + 1;
}

/**
 * Is the given date within [start, end] inclusive?
 * Pure ISO lexicographic comparison — no Date objects.
 */
function dateInCycle(dateISO, cycleStartISO, cycleEndISO) {
  return dateISO >= cycleStartISO && dateISO <= cycleEndISO;
}

/**
 * Count Sundays in [start, end] inclusive. Uses UTC getUTCDay.
 */
function countSundaysInCycle(startISO, endISO) {
  const [sy, sm, sd] = startISO.split('-').map(Number);
  const [ey, em, ed] = endISO.split('-').map(Number);
  const endMs = Date.UTC(ey, em - 1, ed);
  let ms = Date.UTC(sy, sm - 1, sd);
  let n = 0;
  while (ms <= endMs) {
    if (new Date(ms).getUTCDay() === 0) n++;
    ms += 86400000;
  }
  return n;
}

module.exports = {
  deriveCycle,
  cycleLengthDays,
  dateInCycle,
  countSundaysInCycle,
};

// ── Inline smoke tests (run with `node cycleUtil.js`) ─────────────────
if (require.main === module) {
  const assert = require('assert');

  // Feb 2026 → 31 days
  let r = deriveCycle(2, 2026);
  assert.strictEqual(r.start, '2026-01-26');
  assert.strictEqual(r.end, '2026-02-25');
  assert.strictEqual(r.lengthDays, 31);

  // Mar 2026 → 28 days (Feb 2026 non-leap)
  r = deriveCycle(3, 2026);
  assert.strictEqual(r.start, '2026-02-26');
  assert.strictEqual(r.end, '2026-03-25');
  assert.strictEqual(r.lengthDays, 28);

  // Jan 2026 → Dec 26 2025 to Jan 25 2026 (31 days)
  r = deriveCycle(1, 2026);
  assert.strictEqual(r.start, '2025-12-26');
  assert.strictEqual(r.end, '2026-01-25');
  assert.strictEqual(r.lengthDays, 31);

  // Mar 2024 → 29 days (Feb 2024 leap)
  r = deriveCycle(3, 2024);
  assert.strictEqual(r.start, '2024-02-26');
  assert.strictEqual(r.end, '2024-03-25');
  assert.strictEqual(r.lengthDays, 29);

  // Apr 2026 → 31 days
  r = deriveCycle(4, 2026);
  assert.strictEqual(r.start, '2026-03-26');
  assert.strictEqual(r.end, '2026-04-25');
  assert.strictEqual(r.lengthDays, 31);

  // Every month of 2026 should round-trip
  for (let m = 1; m <= 12; m++) {
    const c = deriveCycle(m, 2026);
    assert.ok(c.lengthDays >= 28 && c.lengthDays <= 31,
      `2026-${m} lengthDays=${c.lengthDays} out of expected range`);
  }

  // dateInCycle boundary cases (Feb 2026 cycle)
  const { start, end } = deriveCycle(2, 2026);
  assert.strictEqual(dateInCycle('2026-01-26', start, end), true);  // exact start
  assert.strictEqual(dateInCycle('2026-02-25', start, end), true);  // exact end
  assert.strictEqual(dateInCycle('2026-01-25', start, end), false); // day before start
  assert.strictEqual(dateInCycle('2026-02-26', start, end), false); // day after end
  assert.strictEqual(dateInCycle('2026-02-10', start, end), true);  // midpoint

  // Sunday count (Feb 2026 cycle: Jan 26 Mon → Feb 25 Wed; Sundays: Feb 1, 8, 15, 22 = 4)
  const sundays = countSundaysInCycle(start, end);
  assert.strictEqual(sundays, 4, `Feb 2026 cycle Sundays: expected 4, got ${sundays}`);

  // Errors
  assert.throws(() => deriveCycle(0, 2026), /month must be 1-12/);
  assert.throws(() => deriveCycle(13, 2026), /month must be 1-12/);
  assert.throws(() => deriveCycle(1, 1800), /reasonable YYYY/);

  console.log('cycleUtil.js: all smoke tests passed');
}

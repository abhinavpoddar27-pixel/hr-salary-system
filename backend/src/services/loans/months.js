/**
 * Loans engine — calendar helpers (Loans PR-2).
 *
 * A loan month is a plain {month, year} pair (month 1..12). monthIndex() turns
 * it into a single integer so comparisons and "+n months" never fiddle with
 * year wrap by hand. Dates are 'YYYY-MM-DD' strings; anything else, or a year
 * before 1900 (production holds a DOJ of '0026-03-21'), is treated as invalid.
 */

const IST_OFFSET_MS = 330 * 60 * 1000;

function monthIndex(m) {
  return m.year * 12 + (m.month - 1);
}

function fromIndex(i) {
  return { month: (i % 12) + 1, year: Math.floor(i / 12) };
}

function addMonths(m, n) {
  return fromIndex(monthIndex(m) + n);
}

function compareMonth(a, b) {
  return monthIndex(a) - monthIndex(b);
}

function isValidMonth(m) {
  return !!m && Number.isInteger(m.month) && m.month >= 1 && m.month <= 12
    && Number.isInteger(m.year) && m.year >= 1900 && m.year <= 9999;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 'YYYY-MM-DD' (optionally followed by a time) → {year, month, day} or null. */
function parseDate(str) {
  if (typeof str !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str.trim());
  if (!m) return null;
  const year = Number(m[1]); const month = Number(m[2]); const day = Number(m[3]);
  if (year < 1900 || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function formatDate({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Adds n calendar months to a date, clamping to the end of the target month:
 * 2024-08-31 + 6 → 2025-02-28; 2023-08-31 + 6 → 2024-02-29.
 */
function addMonthsToDate(str, n) {
  const d = parseDate(str);
  if (!d) return null;
  const t = addMonths({ month: d.month, year: d.year }, n);
  return formatDate({ year: t.year, month: t.month, day: Math.min(d.day, daysInMonth(t.year, t.month)) });
}

/** Today's date in IST as 'YYYY-MM-DD' (the plant runs on IST). */
function todayIst(now = new Date()) {
  const t = new Date(now.getTime() + IST_OFFSET_MS);
  return formatDate({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() });
}

function dateToMonth(str) {
  const d = parseDate(str);
  return d ? { month: d.month, year: d.year } : null;
}

/**
 * Sales cycle month of a date (Loans PR-8, SPEC §5.3 / K12): the sales cycle for
 * month M runs from the 26th of M−1 to the 25th of M, so a date on day 26 or
 * later belongs to the NEXT month's cycle. 2026-10-28 → Nov 2026; 2026-10-25 →
 * Oct 2026; 2026-12-26 → Jan 2027. Null for an invalid date.
 */
function salesCycleMonthOf(str) {
  const d = parseDate(str);
  if (!d) return null;
  const m = { month: d.month, year: d.year };
  return d.day >= 26 ? addMonths(m, 1) : m;
}

/** Payroll month of a date: plant = calendar month, sales = sales cycle month. */
function payrollMonthOf(str, payroll = 'plant') {
  return payroll === 'sales' ? salesCycleMonthOf(str) : dateToMonth(str);
}

function monthLabel(m) {
  return `${m.year}-${String(m.month).padStart(2, '0')}`;
}

module.exports = {
  monthIndex, fromIndex, addMonths, compareMonth, isValidMonth, daysInMonth,
  parseDate, formatDate, addMonthsToDate, todayIst, dateToMonth, monthLabel,
  salesCycleMonthOf, payrollMonthOf,
};

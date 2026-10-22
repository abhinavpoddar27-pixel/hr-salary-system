/**
 * IST calendar helpers (P3-IST-BE).
 *
 * The server clock is UTC; the plant runs on IST (UTC+05:30, no DST). A "today"
 * built from new Date().toISOString() is the UTC date — yesterday between 00:00
 * and 05:30 IST, last month on the 1st, last year on 1 January. Use these for any
 * business date or default period. Stored timestamps (created_at etc.) stay UTC.
 */
const IST_OFFSET_MS = 330 * 60 * 1000;

function istShifted(now = Date.now()) {
  const ms = now instanceof Date ? now.getTime() : Number(now);
  return new Date(ms + IST_OFFSET_MS);
}

/** Today's IST date as 'YYYY-MM-DD'. */
function istToday(now = Date.now()) {
  return istShifted(now).toISOString().slice(0, 10);
}

/** {year, month} (month 1–12) of today in IST. */
function istYearMonth(now = Date.now()) {
  const d = istShifted(now);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function istYear(now = Date.now()) {
  return istShifted(now).getUTCFullYear();
}

/** 'YYYY-MM-DD' + n calendar days → 'YYYY-MM-DD' (pure date arithmetic, no zone). */
function istAddDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' + n calendar months (JS rollover: 31 Aug − 6 → 3 Mar, same as the frontend). */
function istAddMonths(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** SQL expression for today's IST date (SQLite). */
const IST_TODAY_SQL = "date('now','+330 minutes')";

module.exports = { istToday, istYearMonth, istYear, istAddDays, istAddMonths, IST_TODAY_SQL };

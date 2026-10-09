/**
 * Loans PR-6 — the daily loan job (docs/loans/SPEC.md D-10, D-14, K33).
 *
 * One cron, every day at 00:45 UTC = 06:15 IST (crons in this codebase are
 * written in UTC with the IST time in a comment; the timezone is pinned so a
 * host clock in another zone cannot move it). Each run: the held sweep, then
 * the catch-up close of every needed month up to the due month (the 13th IST
 * rule lives in close.js dueCloseMonth). Daily rather than "on the 13th" so a
 * close that is waiting for Stage 7 re-tries every morning.
 *
 * The same run happens once at server start (catch-up after a restart). A
 * second run on the same day — boot then cron, or two boots — cannot close a
 * month twice: runLoanClose writes its loan_closes row first and the
 * (month, year, payroll) unique key refuses the second; the sweep only touches
 * rows still provisional; notifications are de-duplicated per role per day.
 * An empty ledger writes nothing at all.
 */
const { runDailyLoanJobs } = require('./close');

const LOAN_CLOSE_CRON = '45 0 * * *'; // 00:45 UTC = 06:15 IST, daily
const LOAN_CLOSE_TIMEZONE = 'Etc/UTC';

function safeRun(db, trigger, now) {
  try {
    return runDailyLoanJobs(db, { trigger, now: now || new Date() });
  } catch (e) {
    console.error(`[loans-close] ${trigger} run failed:`, e.message);
    return null;
  }
}

/**
 * @param {object} db
 * @param {object} [opts] cronLib (tests inject a stub), now (tests), boot=false skips the start-up run
 */
function startLoanCloseScheduler(db, { cronLib = require('node-cron'), now = null, boot = true } = {}) {
  cronLib.schedule(LOAN_CLOSE_CRON, () => safeRun(db, 'auto'), { timezone: LOAN_CLOSE_TIMEZONE });
  console.log(`[loans-close] daily job scheduled (${LOAN_CLOSE_CRON} UTC = 06:15 IST)`);
  return boot ? safeRun(db, 'catch_up', now) : null;
}

module.exports = { startLoanCloseScheduler, LOAN_CLOSE_CRON, LOAN_CLOSE_TIMEZONE };

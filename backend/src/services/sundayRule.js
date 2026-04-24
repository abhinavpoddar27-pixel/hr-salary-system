/**
 * Sunday Rule — Shared Pure Function
 *
 * Ported verbatim from backend/src/services/dayCalculation.js lines 473-504
 * (the three-tier weekly-off granting formula). This is the authoritative
 * source of truth for both sales (Phase 3 consumer) and plant (Phase 5
 * migration target — see CLAUDE.md Section 5 for migration status).
 *
 * CRITICAL: this module MUST stay a pure function:
 *   - no DB access
 *   - no I/O
 *   - no side effects
 *   - no imports outside of standard library
 *
 * Phase 5's behavior-preservation gate diffs plant's March 2026
 * day_calculations output against the version produced by this module.
 * Any drift fails the gate.
 */

/**
 * Calculate how many weekly offs (Sundays) an employee earned in the
 * month, using the three-tier granting rule.
 *
 * @param {Object}  args
 * @param {number}  args.effectivePresent  Days the employee "showed up": P + ½P + WOP + paid holidays
 * @param {number}  args.workingDays       Non-Sunday, non-holiday working days in the month
 * @param {number}  args.totalSundays      Number of Sundays (or other weekly-off days) in the month
 * @param {number}  args.leniency          Absent working days permitted before any Sunday is lost
 *                                         (plant default: 2; sales default: 2 per design §4.3)
 *
 * @returns {Object} Granting result:
 *   paidSundays      — number of Sundays paid this month
 *   unpaidSundays    — totalSundays - paidSundays
 *   tier             — 'tier1_full' | 'tier2_proportional' | 'tier3_none'
 *   threshold        — workingDays - leniency (breakpoint for tier 1 vs 2/3)
 *   daysPerWeeklyOff — workingDays / totalSundays (breakpoint for tier 2 vs 3)
 *   note             — human-readable explanation, goes into audit JSON
 */
function calculateSundayCredit({ effectivePresent, workingDays, totalSundays, leniency }) {
  const daysPerWeeklyOff = totalSundays > 0 ? workingDays / totalSundays : workingDays;
  const threshold = workingDays - leniency;

  let paidSundays, unpaidSundays, tier, note;

  if (effectivePresent >= threshold) {
    // TIER 1: good attendance → all weekly offs paid
    paidSundays = totalSundays;
    unpaidSundays = 0;
    tier = 'tier1_full';
    note = `Tier 1: ${effectivePresent}/${workingDays} present (≥${threshold}) → All ${totalSundays} weekly offs paid`;
  } else if (effectivePresent > daysPerWeeklyOff) {
    // TIER 2: proportional — each chunk of working days earns 1 weekly off
    paidSundays = Math.min(totalSundays, Math.floor(effectivePresent / daysPerWeeklyOff));
    unpaidSundays = totalSundays - paidSundays;
    tier = 'tier2_proportional';
    note = `Tier 2: ${effectivePresent}/${workingDays} present. floor(${effectivePresent}/${daysPerWeeklyOff.toFixed(2)})=${paidSundays} weekly off(s) paid, ${unpaidSundays} lost`;
  } else {
    // TIER 3: severe absence → no weekly offs
    paidSundays = 0;
    unpaidSundays = totalSundays;
    tier = 'tier3_none';
    note = `Tier 3: ${effectivePresent}/${workingDays} present (≤${daysPerWeeklyOff.toFixed(2)}) → 0 weekly offs paid`;
  }

  return {
    paidSundays: Math.round(paidSundays * 100) / 100,
    unpaidSundays,
    tier,
    threshold,
    daysPerWeeklyOff,
    note,
  };
}

/**
 * Cycle-aware convenience wrapper for sales salary (Phase 1, April 2026).
 *
 * Delegates to `calculateSundayCredit` after deriving `totalSundays` and
 * `workingDays` from the cycle date range and the caller-supplied list of
 * gazetted holiday dates. The tier logic in `calculateSundayCredit` is
 * untouched — this is purely a wiring helper so sales code doesn't have
 * to duplicate date arithmetic.
 *
 * `workingDays = cycleLengthDays − totalSundays − nonSundayGazettedHolidays`.
 * Gazetted holidays that fall on a Sunday are ignored in the working-day
 * reduction (same semantics the existing sales compute already enforces —
 * see countGazettedHolidays in salesSalaryComputation.js).
 *
 * @param {Object} args
 * @param {string} args.cycleStart 'YYYY-MM-DD'
 * @param {string} args.cycleEnd   'YYYY-MM-DD'
 * @param {number} args.effectivePresent
 * @param {number} args.leniency
 * @param {string[]} [args.gazettedHolidayDates]  ISO dates inside the cycle
 */
function calculateSundayCreditFromCycle({
  cycleStart, cycleEnd, effectivePresent, leniency, gazettedHolidayDates = [],
}) {
  const { cycleLengthDays, countSundaysInCycle, dateInCycle } = require('./cycleUtil');
  const calendarDays = cycleLengthDays(cycleStart, cycleEnd);
  const totalSundays = countSundaysInCycle(cycleStart, cycleEnd);

  const nonSundayHolidaysInCycle = gazettedHolidayDates.filter(d => {
    if (!dateInCycle(d, cycleStart, cycleEnd)) return false;
    const [y, m, day] = d.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day)).getUTCDay() !== 0;
  }).length;

  const workingDays = calendarDays - totalSundays - nonSundayHolidaysInCycle;

  return calculateSundayCredit({
    effectivePresent, workingDays, totalSundays, leniency,
  });
}

module.exports = { calculateSundayCredit, calculateSundayCreditFromCycle };

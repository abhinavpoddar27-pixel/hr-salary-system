'use strict';
/**
 * Phase 2b — Temporal Pattern Detectors (5.1 – 5.3)
 */

function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }
function r1(x) { return Math.round(x * 10) / 10; }

const PRESENT = ['P', 'WOP', '½P', 'WO½P'];

// ── 5.1 Payday Proximity ───────────────────────────────────────────────────
function detectPaydayProximity(records, context) {
  let paydayZoneWorking = 0, paydayZoneAbsent = 0, paydayZoneLate = 0;
  let midMonthWorking   = 0, midMonthAbsent   = 0, midMonthLate   = 0;

  for (const r of records) {
    if (r.dow === 0) continue; // skip Sundays
    const [y, m, d] = r.date.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const isPaydayZone = (d <= 2 || d >= daysInMonth - 1);

    if (isPaydayZone) {
      paydayZoneWorking++;
      if (r.status === 'A') paydayZoneAbsent++;
      if (r.is_late_arrival) paydayZoneLate++;
    } else {
      midMonthWorking++;
      if (r.status === 'A') midMonthAbsent++;
      if (r.is_late_arrival) midMonthLate++;
    }
  }

  if (paydayZoneWorking < 3 || midMonthWorking < 5) return null;

  const paydayAbsRate = paydayZoneAbsent / paydayZoneWorking;
  const midAbsRate    = midMonthAbsent   / midMonthWorking;
  const paydayLateRate = paydayZoneLate / paydayZoneWorking;
  const midLateRate    = midMonthLate    / midMonthWorking;

  if (!(paydayAbsRate > 1.5 * midAbsRate && paydayZoneAbsent >= 3)) return null;

  const ratio = midAbsRate > 0 ? paydayAbsRate / midAbsRate : paydayAbsRate * 10;

  return {
    id: 'PAYDAY_PROXIMITY',
    detected: true,
    severity: ratio > 2.0 ? 'Medium' : 'Low',
    score: clamp(Math.round(ratio * 30)),
    category: 'temporal',
    label: 'Payday Proximity Absence',
    detail: `Absence rate near month start/end: ${Math.round(paydayAbsRate * 100)}% vs mid-month ${Math.round(midAbsRate * 100)}% (${Math.round(ratio * 10) / 10}× ratio)`,
    evidence: { paydayAbsenceRate: r1(paydayAbsRate), midMonthAbsenceRate: r1(midAbsRate), ratio: r1(ratio), paydayLateRate: r1(paydayLateRate), midLateRate: r1(midLateRate) },
    hrAction: 'Absence/lateness spikes around month-end/start — may indicate financial stress or secondary employment',
    value: Math.round(ratio * 10) / 10
  };
}

// ── 5.2 Seasonal Pattern ───────────────────────────────────────────────────
function detectSeasonalPattern(records, context) {
  const { monthlyBreakdown } = context;
  const mb = monthlyBreakdown || [];
  if (mb.length < 4) return null;

  function season(month) {
    if ([4, 5, 6].includes(month))  return 'Summer';
    if ([7, 8, 9].includes(month))  return 'Monsoon';
    if ([10, 11, 12].includes(month)) return 'Winter';
    return 'Spring'; // 1, 2, 3
  }

  const seasonStats = {};
  for (const m of mb) {
    const s = season(m.month);
    if (!seasonStats[s]) seasonStats[s] = { absences: 0, workingDays: 0, lateDays: 0, hoursSum: 0, hoursCount: 0 };
    const st = seasonStats[s];
    st.absences    += m.absences || 0;
    st.workingDays += m.workingDays || 0;
    st.lateDays    += m.lateCount || 0;
    if (m.avgHours !== null) { st.hoursSum += m.avgHours; st.hoursCount++; }
  }

  const seasonList = Object.entries(seasonStats)
    .filter(([, s]) => s.workingDays >= 20)
    .map(([name, s]) => ({
      season: name,
      absenceRate: s.workingDays > 0 ? s.absences / s.workingDays : 0,
      lateRate:    s.workingDays > 0 ? s.lateDays  / s.workingDays : 0,
      avgHours:    s.hoursCount > 0  ? s.hoursSum  / s.hoursCount  : null,
      workingDays: s.workingDays
    }));

  if (seasonList.length < 2) return null;

  const rates = seasonList.map(s => s.absenceRate);
  const worst = Math.max(...rates);
  const best  = Math.min(...rates);
  const worstSeason = seasonList.find(s => s.absenceRate === worst);
  const bestSeason  = seasonList.find(s => s.absenceRate === best);

  if (!(best > 0 && worst > 1.5 * best)) return null;

  return {
    id: 'SEASONAL_PATTERN',
    detected: true,
    severity: 'Low',
    score: clamp(Math.round((worst / Math.max(best, 0.01) - 1) * 50)),
    category: 'temporal',
    label: 'Seasonal Attendance Variation',
    detail: `${worstSeason?.season} has ${Math.round(worst * 100)}% absence vs ${bestSeason?.season} ${Math.round(best * 100)}% (${Math.round(worst / Math.max(best, 0.01) * 10) / 10}× ratio)`,
    evidence: seasonList.map(s => ({ season: s.season, absenceRate: r1(s.absenceRate), lateRate: r1(s.lateRate), avgHours: s.avgHours !== null ? Math.round(s.avgHours * 100) / 100 : null, workingDays: s.workingDays })),
    hrAction: 'Seasonal attendance variation detected — consider adjusting expectations or shift timings for affected season',
    value: Math.round(worst / Math.max(best, 0.01) * 10) / 10
  };
}

// ── 5.3 Day-of-Month Hotspot ───────────────────────────────────────────────
function detectDayOfMonthHotspot(records, context) {
  // Count absences and total records per day-of-month
  const dayAbsences = {}, dayTotals = {};
  const dayMonths = {}; // how many distinct months each day appeared in

  for (const r of records) {
    if (r.dow === 0) continue;
    const [y, m, d] = r.date.split('-').map(Number);
    const dayKey = d;
    dayTotals[dayKey]   = (dayTotals[dayKey]   || 0) + 1;
    if (r.status === 'A') dayAbsences[dayKey] = (dayAbsences[dayKey] || 0) + 1;
    // Track distinct months
    const monthKey = y * 100 + m;
    if (!dayMonths[dayKey]) dayMonths[dayKey] = new Set();
    dayMonths[dayKey].add(monthKey);
  }

  const totalAbsences   = Object.values(dayAbsences).reduce((s, v) => s + v, 0);
  const totalWorkingDays = Object.values(dayTotals).reduce((s, v) => s + v, 0);
  if (totalAbsences < 5 || totalWorkingDays < 20) return null;

  const overallAvg = totalAbsences / totalWorkingDays;

  const hotspotDays = Object.entries(dayTotals)
    .filter(([d, total]) => {
      const absCount   = dayAbsences[d] || 0;
      const monthCount = dayMonths[d] ? dayMonths[d].size : 0;
      const rate       = absCount / total;
      return rate > 1.3 * overallAvg && monthCount >= 3;
    })
    .map(([d, total]) => ({
      dayOfMonth:     parseInt(d, 10),
      absenceRate:    r1((dayAbsences[d] || 0) / total),
      monthsObserved: dayMonths[d] ? dayMonths[d].size : 0
    }))
    .sort((a, b) => b.absenceRate - a.absenceRate);

  if (!hotspotDays.length) return null;

  const maxRate = hotspotDays[0].absenceRate;

  return {
    id: 'DAY_OF_MONTH_HOTSPOT',
    detected: true,
    severity: 'Low',
    score: clamp(Math.round(maxRate / Math.max(overallAvg, 0.01) * 25)),
    category: 'temporal',
    label: 'Day-of-Month Absence Hotspot',
    detail: `Days ${hotspotDays.map(d => d.dayOfMonth).join(', ')} show elevated absence vs overall avg (${Math.round(overallAvg * 100)}%)`,
    evidence: { hotspotDays, overallRate: r1(overallAvg) },
    hrAction: 'Specific days of the month show elevated absence — investigate recurring obligations (market days, religious observances)',
    value: Math.round(maxRate * 100)
  };
}

module.exports = {
  detectPaydayProximity,
  detectSeasonalPattern,
  detectDayOfMonthHotspot
};

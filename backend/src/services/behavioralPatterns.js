/**
 * Behavioral Pattern Detection Service
 *
 * Detects attendance patterns per employee:
 * - Chronic lateness (>30% days late)
 * - Monday syndrome (late/absent on Mondays at 2x+ rate)
 * - Early Friday exits (avg departure >30min earlier on Fridays)
 * - Overtime warriors (OT on >60% of days)
 * - Suspicious short hours (Present but <4h)
 * - Improving/declining trends (vs 3-month rolling avg)
 * - Regularity score (0-100 based on arrival time consistency)
 */

/**
 * Compute all behavioral patterns for a single employee in a given month.
 * @param {Object} db
 * @param {string} employeeCode
 * @param {number} month
 * @param {number} year
 * @returns {Object} patterns
 */
function detectPatterns(db, employeeCode, month, year) {
  const records = db.prepare(`
    SELECT ap.date, ap.status_final, ap.status_original,
           ap.in_time_final, ap.out_time_final, ap.in_time_original, ap.out_time_original,
           ap.actual_hours, ap.is_late_arrival, ap.late_by_minutes,
           ap.is_early_departure, ap.early_by_minutes,
           ap.is_overtime, ap.overtime_minutes, ap.is_night_shift
    FROM attendance_processed ap
    WHERE ap.employee_code = ? AND ap.month = ? AND ap.year = ?
    AND ap.is_night_out_only = 0
    ORDER BY ap.date
  `).all(employeeCode, month, year);

  if (records.length === 0) return null;

  const patterns = [];
  const PRESENT_STATUSES = ['P', 'WOP', '½P', 'WO½P'];

  // Working day records (exclude Sundays)
  const workingRecords = records.filter(r => {
    const dow = new Date(r.date + 'T12:00:00').getDay();
    return dow !== 0;
  });
  const presentRecords = workingRecords.filter(r => {
    const s = r.status_final || r.status_original || '';
    return PRESENT_STATUSES.includes(s);
  });

  const totalWorkDays = workingRecords.length;
  const presentDays = presentRecords.length;
  if (totalWorkDays === 0) return { patterns, stats: {} };

  // ── Chronic Lateness ──────────────────────────────────
  const lateDays = presentRecords.filter(r => r.is_late_arrival).length;
  const lateRate = presentDays > 0 ? lateDays / presentDays : 0;
  if (lateRate >= 0.30) {
    patterns.push({
      type: 'CHRONIC_LATE',
      severity: lateRate >= 0.50 ? 'High' : 'Medium',
      label: lateRate >= 0.50 ? 'Habitual Latecomer' : 'Chronic Latecomer',
      detail: `Late on ${lateDays} of ${presentDays} working days (${Math.round(lateRate * 100)}%)`,
      value: Math.round(lateRate * 100)
    });
  }

  // ── Monday Syndrome ───────────────────────────────────
  const mondayRecords = workingRecords.filter(r => new Date(r.date + 'T12:00:00').getDay() === 1);
  const otherRecords = workingRecords.filter(r => {
    const d = new Date(r.date + 'T12:00:00').getDay();
    return d !== 0 && d !== 1;
  });

  if (mondayRecords.length >= 2) {
    const mondayAbsentOrLate = mondayRecords.filter(r => {
      const s = r.status_final || r.status_original || '';
      return s === 'A' || r.is_late_arrival;
    }).length;
    const otherAbsentOrLate = otherRecords.filter(r => {
      const s = r.status_final || r.status_original || '';
      return s === 'A' || r.is_late_arrival;
    }).length;

    const mondayIssueRate = mondayRecords.length > 0 ? mondayAbsentOrLate / mondayRecords.length : 0;
    const otherIssueRate = otherRecords.length > 0 ? otherAbsentOrLate / otherRecords.length : 0;

    if (mondayIssueRate > 0 && otherIssueRate > 0 && mondayIssueRate >= otherIssueRate * 2) {
      patterns.push({
        type: 'MONDAY_SYNDROME',
        severity: 'Medium',
        label: 'Monday Syndrome',
        detail: `Monday late/absent rate ${Math.round(mondayIssueRate * 100)}% vs ${Math.round(otherIssueRate * 100)}% other days`,
        value: Math.round(mondayIssueRate * 100)
      });
    }
  }

  // ── Early Friday Exits ────────────────────────────────
  const fridayRecords = presentRecords.filter(r => new Date(r.date + 'T12:00:00').getDay() === 5);
  const nonFridayRecords = presentRecords.filter(r => {
    const d = new Date(r.date + 'T12:00:00').getDay();
    return d !== 5 && d !== 0;
  });

  if (fridayRecords.length >= 2 && nonFridayRecords.length >= 4) {
    const fridayAvgOut = avgOutTime(fridayRecords);
    const otherAvgOut = avgOutTime(nonFridayRecords);
    if (fridayAvgOut !== null && otherAvgOut !== null) {
      const diffMin = otherAvgOut - fridayAvgOut;
      if (diffMin > 30) {
        patterns.push({
          type: 'EARLY_FRIDAY',
          severity: 'Low',
          label: 'Early Friday Exits',
          detail: `Leaves ~${Math.round(diffMin)} min earlier on Fridays than other days`,
          value: Math.round(diffMin)
        });
      }
    }
  }

  // ── Overtime Warriors ─────────────────────────────────
  const otDays = presentRecords.filter(r => r.is_overtime && r.overtime_minutes > 0).length;
  const otRate = presentDays > 0 ? otDays / presentDays : 0;
  if (otRate >= 0.60 && otDays >= 5) {
    const totalOTMin = presentRecords.reduce((s, r) => s + (r.overtime_minutes || 0), 0);
    patterns.push({
      type: 'OT_WARRIOR',
      severity: 'Low',
      label: 'Overtime Warrior',
      detail: `OT on ${otDays} of ${presentDays} days (${Math.round(otRate * 100)}%), total ${Math.round(totalOTMin / 60)}h`,
      value: Math.round(otRate * 100)
    });
  }

  // ── Suspicious Short Hours ────────────────────────────
  const shortHourDays = presentRecords.filter(r =>
    r.actual_hours && r.actual_hours > 0 && r.actual_hours < 4 &&
    (r.status_final === 'P' || r.status_original === 'P')
  );
  if (shortHourDays.length >= 2) {
    patterns.push({
      type: 'SHORT_HOURS',
      severity: 'High',
      label: 'Suspicious Short Hours',
      detail: `${shortHourDays.length} days marked Present but worked <4 hours`,
      value: shortHourDays.length
    });
  }

  // ── Regularity Score ──────────────────────────────────
  const arrivalMinutes = presentRecords
    .map(r => {
      const t = r.in_time_final || r.in_time_original;
      if (!t) return null;
      const [h, m] = t.split(':').map(Number);
      if (isNaN(h)) return null;
      let mins = h * 60 + (m || 0);
      // Night shift normalization: if arrival > 18:00, subtract 1440 for consistency
      if (mins > 1080) mins -= 1440;
      return mins;
    })
    .filter(v => v !== null);

  let regularityScore = 0;
  if (arrivalMinutes.length >= 5) {
    const mean = arrivalMinutes.reduce((s, v) => s + v, 0) / arrivalMinutes.length;
    const variance = arrivalMinutes.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arrivalMinutes.length;
    const stddev = Math.sqrt(variance);
    regularityScore = Math.max(0, Math.min(100, Math.round(100 - stddev * 2)));
  }

  // ── Improving/Declining Trend ─────────────────────────
  const prevMonths = getPrev3MonthKeys(month, year);
  let prevAvgAttRate = null;
  let prevAvgLateRate = null;
  let prevMonthCount = 0;
  let prevAttSum = 0;
  let prevLateSum = 0;

  for (const pm of prevMonths) {
    const prevData = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN is_night_out_only = 0 AND (status_final IN ('P','WOP') OR status_original IN ('P','WOP')) THEN 1
                 WHEN is_night_out_only = 0 AND (status_final IN ('½P','WO½P') OR status_original IN ('½P','WO½P')) THEN 0.5
                 ELSE 0 END) as present,
        SUM(CASE WHEN is_late_arrival = 1 THEN 1 ELSE 0 END) as late
      FROM attendance_processed
      WHERE employee_code = ? AND month = ? AND year = ? AND is_night_out_only = 0
    `).get(employeeCode, pm.month, pm.year);

    if (prevData && prevData.total > 5) {
      prevMonthCount++;
      prevAttSum += (prevData.present / prevData.total);
      if (prevData.present > 0) prevLateSum += (prevData.late / prevData.present);
    }
  }

  let trend = 'stable';
  if (prevMonthCount >= 2) {
    prevAvgAttRate = prevAttSum / prevMonthCount;
    prevAvgLateRate = prevLateSum / prevMonthCount;
    const currAttRate = presentDays / totalWorkDays;
    const currLateRate = presentDays > 0 ? lateDays / presentDays : 0;

    if (currAttRate > prevAvgAttRate + 0.10 || currLateRate < prevAvgLateRate - 0.10) {
      trend = 'improving';
    } else if (currAttRate < prevAvgAttRate - 0.10 || currLateRate > prevAvgLateRate + 0.10) {
      trend = 'declining';
    }
  }

  if (trend !== 'stable') {
    patterns.push({
      type: trend === 'improving' ? 'TREND_IMPROVING' : 'TREND_DECLINING',
      severity: trend === 'declining' ? 'Medium' : 'Low',
      label: trend === 'improving' ? 'Improving Trend' : 'Declining Trend',
      detail: trend === 'improving'
        ? 'Attendance or punctuality improved vs 3-month average'
        : 'Attendance or punctuality declined vs 3-month average',
      value: 0
    });
  }

  // ── Leave Discipline: Informed Leave Ratio (Phase 4) ──
  // What % of non-present days are covered by approved leave applications?
  // Read from day_calculations (populated by Phase 2 leave post-processing).
  try {
    const dcData = db.prepare(`
      SELECT cl_used, el_used, lop_days, od_days, uninformed_absent
      FROM day_calculations
      WHERE employee_code = ? AND month = ? AND year = ?
    `).get(employeeCode, month, year);

    if (dcData) {
      const totalLeaves = (dcData.cl_used || 0) + (dcData.el_used || 0) + (dcData.lop_days || 0) + (dcData.od_days || 0);
      const totalNonPresent = totalLeaves + (dcData.uninformed_absent || 0);
      if (totalNonPresent > 0) {
        const ratio = Math.round((totalLeaves / totalNonPresent) * 100);
        if (ratio >= 80) {
          patterns.push({
            type: 'LEAVE_DISCIPLINE_HIGH',
            severity: 'Low',
            label: 'Strong Leave Discipline',
            detail: `${ratio}% of absences are covered by approved leaves (CL:${dcData.cl_used || 0} EL:${dcData.el_used || 0} LWP:${dcData.lop_days || 0} OD:${dcData.od_days || 0}, Uninformed:${dcData.uninformed_absent || 0})`,
            value: ratio
          });
        } else if (ratio < 50 && (dcData.uninformed_absent || 0) >= 3) {
          patterns.push({
            type: 'LEAVE_DISCIPLINE_LOW',
            severity: 'High',
            label: 'Poor Leave Discipline',
            detail: `Only ${ratio}% of absences covered by leaves. ${dcData.uninformed_absent} uninformed absent days.`,
            value: ratio
          });
        }
      }
    }
  } catch {}

  // ── Leave Planning: advance vs after-the-fact applications ──
  try {
    const monthPad = String(month).padStart(2, '0');
    const monthStart = `${year}-${monthPad}-01`;
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthEnd = `${year}-${monthPad}-${String(daysInMonth).padStart(2, '0')}`;
    const leaveApps = db.prepare(`
      SELECT applied_at, start_date
      FROM leave_applications
      WHERE employee_code = ? AND status = 'Approved'
        AND start_date <= ? AND end_date >= ?
    `).all(employeeCode, monthEnd, monthStart);

    if (leaveApps.length >= 2) {
      const advanceCount = leaveApps.filter(la => {
        if (!la.applied_at || !la.start_date) return false;
        return la.applied_at.slice(0, 10) < la.start_date;
      }).length;
      const advancePct = Math.round((advanceCount / leaveApps.length) * 100);
      if (advancePct >= 75) {
        patterns.push({
          type: 'LEAVE_PLANNER',
          severity: 'Low',
          label: 'Advance Leave Planner',
          detail: `${advancePct}% of ${leaveApps.length} leave applications were submitted before the leave start date`,
          value: advancePct
        });
      } else if (advancePct < 30 && leaveApps.length >= 3) {
        patterns.push({
          type: 'LEAVE_REACTIVE',
          severity: 'Medium',
          label: 'Reactive Leave Behaviour',
          detail: `Only ${advancePct}% of ${leaveApps.length} leaves were planned in advance — most applied after the fact`,
          value: advancePct
        });
      }
    }
  } catch {}

  // ── Absence Improvement: informed ratio improving over 3 months? ──
  try {
    const prevMonthsLeave = getPrev3MonthKeys(month, year);
    const ratios = [];

    for (const pm of prevMonthsLeave) {
      const prevDc = db.prepare(`
        SELECT cl_used, el_used, lop_days, od_days, uninformed_absent
        FROM day_calculations
        WHERE employee_code = ? AND month = ? AND year = ?
      `).get(employeeCode, pm.month, pm.year);
      if (prevDc) {
        const tl = (prevDc.cl_used || 0) + (prevDc.el_used || 0) + (prevDc.lop_days || 0) + (prevDc.od_days || 0);
        const tnp = tl + (prevDc.uninformed_absent || 0);
        ratios.push(tnp > 0 ? tl / tnp : 1);
      }
    }

    const curDc = db.prepare(`
      SELECT cl_used, el_used, lop_days, od_days, uninformed_absent
      FROM day_calculations WHERE employee_code = ? AND month = ? AND year = ?
    `).get(employeeCode, month, year);
    if (curDc && ratios.length >= 2) {
      const curTl = (curDc.cl_used || 0) + (curDc.el_used || 0) + (curDc.lop_days || 0) + (curDc.od_days || 0);
      const curTnp = curTl + (curDc.uninformed_absent || 0);
      const curRatio = curTnp > 0 ? curTl / curTnp : 1;
      const prevAvg = ratios.reduce((s, v) => s + v, 0) / ratios.length;

      if (curRatio > prevAvg + 0.20 && curRatio >= 0.60) {
        patterns.push({
          type: 'ABSENCE_IMPROVING',
          severity: 'Low',
          label: 'Leave Discipline Improving',
          detail: `Informed leave ratio improved from ${Math.round(prevAvg * 100)}% to ${Math.round(curRatio * 100)}% — employee is shifting from uninformed absents to approved leaves`,
          value: Math.round(curRatio * 100)
        });
      }
    }
  } catch {}

  // ── Compute stats ─────────────────────────────────────
  const avgHours = presentRecords.length > 0
    ? Math.round(presentRecords.reduce((s, r) => s + (r.actual_hours || 0), 0) / presentRecords.length * 100) / 100
    : 0;

  const avgArrival = arrivalMinutes.length > 0
    ? Math.round(arrivalMinutes.reduce((s, v) => s + v, 0) / arrivalMinutes.length)
    : null;

  return {
    patterns,
    stats: {
      totalWorkDays,
      presentDays,
      lateDays,
      lateRate: Math.round(lateRate * 1000) / 10,
      otDays,
      avgHours,
      regularityScore,
      trend,
      avgArrivalMinutes: avgArrival,
      avgArrivalTime: avgArrival !== null ? minutesToTime(avgArrival < 0 ? avgArrival + 1440 : avgArrival) : null
    }
  };
}

/**
 * Generate narrative assessment for an employee.
 */
function generateNarrative(db, employeeCode, month, year) {
  const emp = db.prepare('SELECT name, department, shift_code FROM employees WHERE code = ?').get(employeeCode);
  if (!emp) return null;

  const result = detectPatterns(db, employeeCode, month, year);
  if (!result) return 'No attendance data available for this period.';

  const { patterns, stats } = result;
  const shift = db.prepare('SELECT start_time FROM shifts WHERE code = ?').get(emp.shift_code || 'DAY');
  const shiftStart = shift?.start_time || '08:00';

  let narrative = `${emp.name} (${emp.department || 'N/A'}) `;

  // Attendance summary
  const attRate = stats.totalWorkDays > 0 ? Math.round(stats.presentDays / stats.totalWorkDays * 100) : 0;
  if (attRate >= 90) narrative += `has maintained strong attendance at ${attRate}% this month. `;
  else if (attRate >= 75) narrative += `has ${attRate}% attendance this month. `;
  else narrative += `has concerning attendance at only ${attRate}% this month. `;

  // Arrival pattern
  if (stats.avgArrivalTime) {
    narrative += `Average arrival: ${stats.avgArrivalTime} against a ${shiftStart} shift start`;
    if (stats.regularityScore >= 80) narrative += ` (highly consistent, regularity score: ${stats.regularityScore}/100). `;
    else if (stats.regularityScore >= 60) narrative += ` (moderately consistent, regularity score: ${stats.regularityScore}/100). `;
    else narrative += ` (erratic timing, regularity score: ${stats.regularityScore}/100). `;
  }

  // Late pattern
  if (stats.lateDays > 0) {
    narrative += `Late on ${stats.lateDays} of ${stats.presentDays} working days (${stats.lateRate}%). `;
  } else if (stats.presentDays > 5) {
    narrative += `No late arrivals recorded — punctual. `;
  }

  // Pattern flags
  for (const p of patterns) {
    if (p.type === 'MONDAY_SYNDROME') narrative += `Shows Monday syndrome: ${p.detail}. `;
    if (p.type === 'EARLY_FRIDAY') narrative += `Flagged: ${p.detail}. `;
    if (p.type === 'OT_WARRIOR') narrative += `Consistently working overtime: ${p.detail}. `;
    if (p.type === 'SHORT_HOURS') narrative += `Warning: ${p.detail}. `;
    if (p.type === 'TREND_IMPROVING') narrative += `Positive trend: attendance/punctuality improving vs previous 3 months. `;
    if (p.type === 'TREND_DECLINING') narrative += `Attention needed: attendance/punctuality declining vs previous 3 months. `;
    // Leave discipline patterns (Phase 4)
    if (p.type === 'LEAVE_DISCIPLINE_HIGH') narrative += `Excellent leave discipline: ${p.detail}. `;
    if (p.type === 'LEAVE_DISCIPLINE_LOW') narrative += `Attention: poor leave discipline — ${p.detail}. `;
    if (p.type === 'LEAVE_PLANNER') narrative += `Plans leaves in advance: ${p.detail}. `;
    if (p.type === 'LEAVE_REACTIVE') narrative += `Tends to apply for leave after the fact: ${p.detail}. `;
    if (p.type === 'ABSENCE_IMPROVING') narrative += `Positive: ${p.detail}. `;
  }

  return narrative.trim();
}

/**
 * Run pattern detection for ALL active employees for a month.
 * Returns summary grouped by pattern type.
 */
function detectAllPatterns(db, month, year) {
  const employees = db.prepare(`
    SELECT DISTINCT ap.employee_code
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.month = ? AND ap.year = ? AND ap.is_night_out_only = 0
    AND (e.status IS NULL OR e.status NOT IN ('Inactive', 'Exited', 'Left'))
  `).all(month, year);

  const allResults = [];
  for (const { employee_code } of employees) {
    const result = detectPatterns(db, employee_code, month, year);
    if (result && result.patterns.length > 0) {
      const emp = db.prepare('SELECT name, department, company FROM employees WHERE code = ?').get(employee_code);
      allResults.push({
        code: employee_code,
        name: emp?.name || employee_code,
        department: emp?.department || '',
        company: emp?.company || '',
        patterns: result.patterns,
        stats: result.stats
      });
    }
  }

  // Summary by pattern type
  const summary = {};
  for (const r of allResults) {
    for (const p of r.patterns) {
      if (!summary[p.type]) summary[p.type] = { type: p.type, label: p.label, count: 0, employees: [] };
      summary[p.type].count++;
      summary[p.type].employees.push({ code: r.code, name: r.name, department: r.department, detail: p.detail, severity: p.severity });
    }
  }

  return { employees: allResults, summary: Object.values(summary) };
}

// ── Helpers ─────────────────────────────────────────────

function avgOutTime(records) {
  const times = records
    .map(r => {
      const t = r.out_time_final || r.out_time_original;
      if (!t) return null;
      const [h, m] = t.split(':').map(Number);
      if (isNaN(h)) return null;
      return h * 60 + (m || 0);
    })
    .filter(v => v !== null);
  if (times.length === 0) return null;
  return times.reduce((s, v) => s + v, 0) / times.length;
}

function minutesToTime(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getPrev3MonthKeys(month, year) {
  const result = [];
  for (let i = 1; i <= 3; i++) {
    let m = month - i;
    let y = year;
    while (m <= 0) { m += 12; y--; }
    result.push({ month: m, year: y });
  }
  return result;
}

module.exports = {
  detectPatterns,
  detectAllPatterns,
  generateNarrative
};

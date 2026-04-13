function computeOrgMetrics(db, startDate, endDate) {
  const result = {};

  // Section A: Workforce Utilization
  try {
    const stats = db.prepare(`
      SELECT
        COUNT(DISTINCT ap.employee_code) as active_employees,
        SUM(CASE WHEN ap.actual_hours > 0 THEN ap.actual_hours ELSE 0 END) as total_actual_hours,
        SUM(CASE WHEN strftime('%w', ap.date) != '0' AND COALESCE(ap.status_final, ap.status_original) = 'A' THEN 1 ELSE 0 END) as total_absent_days,
        SUM(CASE WHEN ap.is_late_arrival = 1 THEN ap.late_by_minutes ELSE 0 END) as total_late_minutes,
        SUM(CASE WHEN ap.is_early_departure = 1 THEN ap.early_by_minutes ELSE 0 END) as total_early_minutes,
        COUNT(CASE WHEN strftime('%w', ap.date) != '0' THEN 1 END) as total_working_records
      FROM attendance_processed ap
      LEFT JOIN employees e ON ap.employee_code = e.code
      WHERE ap.date BETWEEN ? AND ? AND ap.is_night_out_only = 0
      AND (e.status IS NULL OR e.status NOT IN ('Inactive','Exited','Left'))
    `).get(startDate, endDate);

    const expectedHours = (stats.total_working_records || 0) * 10;
    const absenceLoss = (stats.total_absent_days || 0) * 10;
    const lateLoss = Math.round((stats.total_late_minutes || 0) / 60 * 100) / 100;
    const earlyLoss = Math.round((stats.total_early_minutes || 0) / 60 * 100) / 100;
    const otherLoss = Math.max(0, expectedHours - (stats.total_actual_hours || 0) - absenceLoss - lateLoss - earlyLoss);

    result.workforceUtilization = {
      utilizationRate: expectedHours > 0 ? Math.round((stats.total_actual_hours || 0) / expectedHours * 1000) / 10 : 0,
      expectedHours: Math.round(expectedHours),
      actualHours: Math.round(stats.total_actual_hours || 0),
      absenceLoss: Math.round(absenceLoss),
      lateLoss,
      earlyLoss,
      otherLoss: Math.round(otherLoss),
      activeEmployees: stats.active_employees || 0
    };
  } catch (e) {
    console.warn('[orgMetrics] utilization failed:', e.message);
    result.workforceUtilization = null;
  }

  // Section B: Punctuality Curve
  try {
    const records = db.prepare(`
      SELECT ap.in_time_final, ap.in_time_original, e.shift_code
      FROM attendance_processed ap
      LEFT JOIN employees e ON ap.employee_code = e.code
      WHERE ap.date BETWEEN ? AND ? AND ap.is_night_out_only = 0
      AND COALESCE(ap.status_final, ap.status_original) IN ('P','WOP','½P','WO½P')
      AND (e.status IS NULL OR e.status NOT IN ('Inactive','Exited','Left'))
    `).all(startDate, endDate);

    const shiftStarts = {};
    const shifts = db.prepare('SELECT code, start_time FROM shifts').all();
    for (const s of shifts) {
      const [h, m] = (s.start_time || '08:00').split(':').map(Number);
      shiftStarts[s.code] = h * 60 + (m || 0);
    }

    const bins = {};
    for (let b = -30; b <= 60; b += 5) bins[b] = 0;

    const offsets = [];
    for (const r of records) {
      const timeStr = r.in_time_final || r.in_time_original;
      if (!timeStr) continue;
      const [h, m] = timeStr.split(':').map(Number);
      if (isNaN(h)) continue;
      const arrMin = h * 60 + (m || 0);
      const shiftStart = shiftStarts[r.shift_code] || 480;
      let offset = arrMin - shiftStart;
      if (offset < -600) offset += 1440;
      if (offset > 600) offset -= 1440;
      offsets.push(offset);
      const bin = Math.max(-30, Math.min(60, Math.floor(offset / 5) * 5));
      if (bins[bin] !== undefined) bins[bin]++;
    }

    offsets.sort((a, b) => a - b);
    const median = offsets.length > 0 ? offsets[Math.floor(offsets.length / 2)] : 0;
    const onTime = offsets.filter(o => o >= -5 && o <= 5).length;
    const late15 = offsets.filter(o => o > 15).length;

    result.punctualityCurve = {
      bins: Object.entries(bins).map(([offset, count]) => ({ offset: parseInt(offset), count })).sort((a, b) => a.offset - b.offset),
      medianOffset: median,
      pctOnTime: offsets.length > 0 ? Math.round(onTime / offsets.length * 1000) / 10 : 0,
      pctLate15Plus: offsets.length > 0 ? Math.round(late15 / offsets.length * 1000) / 10 : 0,
      totalRecords: offsets.length
    };
  } catch (e) {
    console.warn('[orgMetrics] punctuality failed:', e.message);
    result.punctualityCurve = null;
  }

  // Section C: Absenteeism Cost
  try {
    const rows = db.prepare(`
      SELECT ap.employee_code, ap.date, COALESCE(ap.status_final, ap.status_original) as status,
        ap.is_late_arrival, ap.late_by_minutes, e.gross_salary, e.department
      FROM attendance_processed ap
      LEFT JOIN employees e ON ap.employee_code = e.code
      WHERE ap.date BETWEEN ? AND ? AND ap.is_night_out_only = 0
      AND strftime('%w', ap.date) != '0'
      AND (e.status IS NULL OR e.status NOT IN ('Inactive','Exited','Left'))
    `).all(startDate, endDate);

    let directCost = 0, latenessCost = 0, absentDays = 0, lateInstances = 0;
    const deptCosts = {};

    for (const r of rows) {
      const dailyCost = (r.gross_salary || 0) / 30;
      if (r.status === 'A') {
        directCost += dailyCost;
        absentDays++;
        const d = r.department || 'Unknown';
        if (!deptCosts[d]) deptCosts[d] = { cost: 0, days: 0 };
        deptCosts[d].cost += dailyCost;
        deptCosts[d].days++;
      }
      if (r.is_late_arrival && r.late_by_minutes > 0) {
        latenessCost += (r.late_by_minutes / 600) * dailyCost;
        lateInstances++;
      }
    }

    const topDepts = Object.entries(deptCosts)
      .map(([dept, v]) => ({ department: dept, cost: Math.round(v.cost), absentDays: v.days }))
      .sort((a, b) => b.cost - a.cost).slice(0, 5);

    result.absenteeismCost = {
      totalAbsenteeismCost: Math.round((directCost + latenessCost) * 100) / 100,
      directAbsenceCost: Math.round(directCost * 100) / 100,
      latenessCost: Math.round(latenessCost * 100) / 100,
      totalAbsentDays: absentDays,
      totalLateInstances: lateInstances,
      avgCostPerAbsentDay: absentDays > 0 ? Math.round(directCost / absentDays) : 0,
      topDepartmentsByAbsenteeismCost: topDepts
    };
  } catch (e) {
    console.warn('[orgMetrics] cost failed:', e.message);
    result.absenteeismCost = null;
  }

  // Section D: Contractor vs Permanent Gap
  try {
    const monthly = db.prepare(`
      SELECT ap.month, ap.year,
        SUM(CASE WHEN e.employment_type = 'Contractor' AND strftime('%w', ap.date) != '0' THEN 1 ELSE 0 END) as cont_working,
        SUM(CASE WHEN e.employment_type = 'Contractor' AND COALESCE(ap.status_final, ap.status_original) IN ('P','WOP') THEN 1.0
                 WHEN e.employment_type = 'Contractor' AND COALESCE(ap.status_final, ap.status_original) IN ('½P','WO½P') THEN 0.5 ELSE 0 END) as cont_present,
        SUM(CASE WHEN (e.employment_type IS NULL OR e.employment_type != 'Contractor') AND strftime('%w', ap.date) != '0' THEN 1 ELSE 0 END) as perm_working,
        SUM(CASE WHEN (e.employment_type IS NULL OR e.employment_type != 'Contractor') AND COALESCE(ap.status_final, ap.status_original) IN ('P','WOP') THEN 1.0
                 WHEN (e.employment_type IS NULL OR e.employment_type != 'Contractor') AND COALESCE(ap.status_final, ap.status_original) IN ('½P','WO½P') THEN 0.5 ELSE 0 END) as perm_present
      FROM attendance_processed ap
      LEFT JOIN employees e ON ap.employee_code = e.code
      WHERE ap.date BETWEEN ? AND ? AND ap.is_night_out_only = 0
      AND (e.status IS NULL OR e.status NOT IN ('Inactive','Exited','Left'))
      GROUP BY ap.year, ap.month ORDER BY ap.year, ap.month
    `).all(startDate, endDate);

    const months = monthly.map(m => {
      const cr = m.cont_working > 0 ? Math.round(m.cont_present / m.cont_working * 1000) / 10 : null;
      const pr = m.perm_working > 0 ? Math.round(m.perm_present / m.perm_working * 1000) / 10 : null;
      return { month: m.month, year: m.year, contractorRate: cr, permRate: pr, gap: cr != null && pr != null ? Math.round((cr - pr) * 10) / 10 : null };
    });
    const gaps = months.filter(m => m.gap != null).map(m => m.gap);
    const avgGap = gaps.length > 0 ? Math.round(gaps.reduce((s, v) => s + v, 0) / gaps.length * 10) / 10 : 0;

    result.contractorPermanentGap = { monthly: months, avgGap, flagged: Math.abs(avgGap) > 10 };
  } catch (e) {
    console.warn('[orgMetrics] contractor gap failed:', e.message);
    result.contractorPermanentGap = null;
  }

  // Section E: Coordinated Absence Alerts
  try {
    const alerts = db.prepare(`
      SELECT ap.date, e.department,
        COUNT(DISTINCT CASE WHEN COALESCE(ap.status_final, ap.status_original) = 'A' THEN ap.employee_code END) as absent_count,
        COUNT(DISTINCT ap.employee_code) as dept_size
      FROM attendance_processed ap
      LEFT JOIN employees e ON ap.employee_code = e.code
      WHERE ap.date BETWEEN ? AND ? AND ap.is_night_out_only = 0
      AND e.department IS NOT NULL
      AND (e.status IS NULL OR e.status NOT IN ('Inactive','Exited','Left'))
      GROUP BY ap.date, e.department
      HAVING absent_count * 1.0 / dept_size > 0.40 AND dept_size >= 3
      ORDER BY ap.date DESC LIMIT 50
    `).all(startDate, endDate);

    result.coordinatedAbsenceAlerts = alerts.map(a => ({
      date: a.date, department: a.department, absentCount: a.absent_count,
      deptSize: a.dept_size, rate: Math.round(a.absent_count / a.dept_size * 1000) / 10
    }));
  } catch (e) {
    console.warn('[orgMetrics] coordinated absence failed:', e.message);
    result.coordinatedAbsenceAlerts = [];
  }

  // Section F: Stability Index (simplified)
  try {
    const u = result.workforceUtilization;
    const absRate = u ? (u.absenceLoss / Math.max(u.expectedHours, 1)) : 0;
    const lateRate = u ? (u.lateLoss / Math.max(u.actualHours, 1)) : 0;
    const stability = Math.max(0, Math.min(100, Math.round(100 - (
      25 * Math.min(absRate / 0.10, 1) +
      25 * Math.min(lateRate / 0.05, 1) +
      25 * ((result.coordinatedAbsenceAlerts || []).length > 3 ? 1 : (result.coordinatedAbsenceAlerts || []).length / 3) +
      25 * (Math.abs(result.contractorPermanentGap?.avgGap || 0) > 10 ? 1 : Math.abs(result.contractorPermanentGap?.avgGap || 0) / 10)
    ))));
    result.stabilityIndex = { stabilityIndex: stability, interpretation: stability >= 80 ? 'Stable' : stability >= 60 ? 'Moderate' : 'Concerning' };
  } catch (e) {
    result.stabilityIndex = { stabilityIndex: 0, interpretation: 'Unable to compute' };
  }

  result.meta = { rangeStart: startDate, rangeEnd: endDate, generatedAt: new Date().toISOString() };
  return result;
}

module.exports = { computeOrgMetrics };

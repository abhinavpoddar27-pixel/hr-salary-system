const { detectPatterns } = require('./behavioralPatterns');

function computeDepartmentAnalytics(db, startDate, endDate) {
  const depts = db.prepare(`
    SELECT DISTINCT e.department FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.date BETWEEN ? AND ? AND ap.is_night_out_only = 0
    AND e.department IS NOT NULL AND e.department != ''
    AND (e.status IS NULL OR e.status NOT IN ('Inactive','Exited','Left'))
    ORDER BY e.department
  `).all(startDate, endDate).map(r => r.department);

  const departments = [];

  for (const dept of depts) {
    try {
      const stats = db.prepare(`
        SELECT
          COUNT(CASE WHEN strftime('%w', ap.date) != '0' THEN 1 END) as working_days,
          SUM(CASE WHEN strftime('%w', ap.date) != '0' AND COALESCE(ap.status_final, ap.status_original) IN ('P','WOP') THEN 1.0
                   WHEN strftime('%w', ap.date) != '0' AND COALESCE(ap.status_final, ap.status_original) IN ('½P','WO½P') THEN 0.5
                   ELSE 0 END) as present_days,
          SUM(CASE WHEN ap.is_late_arrival = 1 THEN 1 ELSE 0 END) as late_days,
          SUM(CASE WHEN ap.is_early_departure = 1 THEN 1 ELSE 0 END) as early_days,
          AVG(CASE WHEN ap.actual_hours > 0 AND COALESCE(ap.status_final, ap.status_original) IN ('P','WOP','½P','WO½P') THEN ap.actual_hours END) as avg_hours,
          COUNT(DISTINCT ap.employee_code) as headcount,
          SUM(CASE WHEN strftime('%w', ap.date) != '0' AND COALESCE(ap.status_final, ap.status_original) = 'A' THEN 1 ELSE 0 END) as absent_days,
          SUM(CASE WHEN ap.is_overtime = 1 THEN 1 ELSE 0 END) as ot_days,
          SUM(CASE WHEN ap.is_night_shift = 1 THEN 1 ELSE 0 END) as night_days,
          COUNT(DISTINCT CASE WHEN e.employment_type = 'Contractor' THEN ap.employee_code END) as contractor_count
        FROM attendance_processed ap
        LEFT JOIN employees e ON ap.employee_code = e.code
        WHERE ap.date BETWEEN ? AND ? AND ap.is_night_out_only = 0
        AND e.department = ? AND (e.status IS NULL OR e.status NOT IN ('Inactive','Exited','Left'))
      `).get(startDate, endDate, dept);

      if (!stats || stats.working_days === 0) continue;

      const attRate = stats.present_days / stats.working_days;
      const punctRate = stats.present_days > 0 ? (stats.present_days - stats.late_days) / stats.present_days : 0;
      const absRate = stats.absent_days / stats.working_days;
      const hoursRatio = Math.min((stats.avg_hours || 0) / 10, 1.0);
      const lateRate = stats.present_days > 0 ? stats.late_days / stats.present_days : 0;
      const earlyRate = stats.present_days > 0 ? stats.early_days / stats.present_days : 0;

      // Trend: compare first half vs second half
      const midDate = new Date((new Date(startDate).getTime() + new Date(endDate).getTime()) / 2).toISOString().split('T')[0];
      const h1 = db.prepare(`SELECT SUM(CASE WHEN strftime('%w', ap.date)!='0' AND COALESCE(ap.status_final,ap.status_original) IN ('P','WOP') THEN 1.0 WHEN strftime('%w',ap.date)!='0' AND COALESCE(ap.status_final,ap.status_original) IN ('½P','WO½P') THEN 0.5 ELSE 0 END) as p, COUNT(CASE WHEN strftime('%w',ap.date)!='0' THEN 1 END) as w FROM attendance_processed ap LEFT JOIN employees e ON ap.employee_code=e.code WHERE ap.date BETWEEN ? AND ? AND ap.is_night_out_only=0 AND e.department=? AND (e.status IS NULL OR e.status NOT IN ('Inactive','Exited','Left'))`).get(startDate, midDate, dept);
      const h2 = db.prepare(`SELECT SUM(CASE WHEN strftime('%w', ap.date)!='0' AND COALESCE(ap.status_final,ap.status_original) IN ('P','WOP') THEN 1.0 WHEN strftime('%w',ap.date)!='0' AND COALESCE(ap.status_final,ap.status_original) IN ('½P','WO½P') THEN 0.5 ELSE 0 END) as p, COUNT(CASE WHEN strftime('%w',ap.date)!='0' THEN 1 END) as w FROM attendance_processed ap LEFT JOIN employees e ON ap.employee_code=e.code WHERE ap.date > ? AND ap.date <= ? AND ap.is_night_out_only=0 AND e.department=? AND (e.status IS NULL OR e.status NOT IN ('Inactive','Exited','Left'))`).get(midDate, endDate, dept);
      const r1 = h1 && h1.w > 0 ? h1.p / h1.w * 100 : 0;
      const r2 = h2 && h2.w > 0 ? h2.p / h2.w * 100 : 0;
      let trend = 'stable', trendFactor = 0.75;
      if (r2 > r1 + 2) { trend = 'improving'; trendFactor = 1.0; }
      else if (r2 < r1 - 2) { trend = 'declining'; trendFactor = 0.5; }

      const health = Math.round((30 * attRate + 20 * punctRate + 15 * hoursRatio + 15 * (1 - absRate) + 10 * trendFactor + 10 * 0.7) * 100) / 100;

      departments.push({
        department: dept,
        healthScore: Math.min(100, Math.round(health * 100) / 100),
        headcount: stats.headcount,
        contractorCount: stats.contractor_count,
        attendanceRate: Math.round(attRate * 1000) / 10,
        punctualityRate: Math.round(punctRate * 1000) / 10,
        absenceRate: Math.round(absRate * 1000) / 10,
        avgHours: Math.round((stats.avg_hours || 0) * 100) / 100,
        lateRate: Math.round(lateRate * 1000) / 10,
        earlyExitRate: Math.round(earlyRate * 1000) / 10,
        otDays: stats.ot_days,
        nightShiftDays: stats.night_days,
        trend
      });
    } catch (e) { console.warn('[deptAnalytics] ' + dept + ' failed:', e.message); }
  }

  departments.sort((a, b) => b.healthScore - a.healthScore);
  departments.forEach((d, i) => d.rank = i + 1);

  // OT Gini per department
  const otConcentration = [];
  for (const dept of depts) {
    try {
      const otValues = db.prepare(`
        SELECT COALESCE(SUM(ap.overtime_minutes), 0) as total_ot
        FROM attendance_processed ap LEFT JOIN employees e ON ap.employee_code = e.code
        WHERE ap.date BETWEEN ? AND ? AND ap.is_night_out_only = 0 AND e.department = ?
        AND (e.status IS NULL OR e.status NOT IN ('Inactive','Exited','Left'))
        GROUP BY ap.employee_code ORDER BY total_ot ASC
      `).all(startDate, endDate, dept).map(r => r.total_ot);
      if (otValues.length < 2) continue;
      const sum = otValues.reduce((s, v) => s + v, 0);
      if (sum === 0) { otConcentration.push({ department: dept, giniCoefficient: 0, interpretation: 'No overtime' }); continue; }
      let cumSum = 0, area = 0;
      for (const v of otValues) { cumSum += v; area += cumSum / sum; }
      area /= otValues.length;
      const gini = Math.round((1 - 2 * area + 1 / otValues.length) * 100) / 100;
      otConcentration.push({ department: dept, giniCoefficient: gini, interpretation: gini > 0.6 ? 'Highly concentrated' : gini > 0.4 ? 'Moderately concentrated' : 'Well distributed' });
    } catch (e) { /* skip */ }
  }

  // Night shift burden
  const nightShiftBurden = [];
  let orgTotalPresent = 0, orgTotalNight = 0;
  for (const d of departments) { orgTotalPresent += d.headcount; orgTotalNight += d.nightShiftDays; }
  const orgNightRatio = orgTotalPresent > 0 ? orgTotalNight / (orgTotalPresent * 30) : 0;
  for (const d of departments) {
    const deptNightRatio = d.headcount > 0 ? d.nightShiftDays / (d.headcount * 30) : 0;
    const burden = orgNightRatio > 0 ? deptNightRatio / orgNightRatio : 0;
    nightShiftBurden.push({ department: d.department, nightRatio: Math.round(deptNightRatio * 1000) / 10, orgAvgNightRatio: Math.round(orgNightRatio * 1000) / 10, burden: Math.round(burden * 100) / 100, flagged: burden > 2.0 });
  }

  // Attendance inequality per department
  const attendanceInequality = [];
  for (const dept of depts) {
    try {
      const empRates = db.prepare(`
        SELECT ap.employee_code,
          SUM(CASE WHEN strftime('%w',ap.date)!='0' AND COALESCE(ap.status_final,ap.status_original)='A' THEN 1 ELSE 0 END) * 1.0 /
          NULLIF(COUNT(CASE WHEN strftime('%w',ap.date)!='0' THEN 1 END), 0) as abs_rate
        FROM attendance_processed ap LEFT JOIN employees e ON ap.employee_code=e.code
        WHERE ap.date BETWEEN ? AND ? AND ap.is_night_out_only=0 AND e.department=?
        AND (e.status IS NULL OR e.status NOT IN ('Inactive','Exited','Left'))
        GROUP BY ap.employee_code HAVING COUNT(*)>5
      `).all(startDate, endDate, dept).map(r => (r.abs_rate || 0) * 100);
      if (empRates.length < 3) continue;
      const mean = empRates.reduce((s, v) => s + v, 0) / empRates.length;
      const variance = empRates.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / empRates.length;
      const stddev = Math.sqrt(variance);
      const cv = mean > 0 ? Math.round(stddev / mean * 100) / 100 : 0;
      const range = Math.round((Math.max(...empRates) - Math.min(...empRates)) * 10) / 10;
      attendanceInequality.push({ department: dept, cv, range, meanAbsenceRate: Math.round(mean * 10) / 10, flagged: cv > 1.0 || range > 25 });
    } catch (e) { /* skip */ }
  }

  return {
    departments,
    otConcentration,
    nightShiftBurden,
    attendanceInequality,
    meta: { rangeStart: startDate, rangeEnd: endDate, totalDepartments: departments.length, generatedAt: new Date().toISOString() }
  };
}

module.exports = { computeDepartmentAnalytics };

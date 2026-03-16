/**
 * Daily MIS Service
 * Upload daily attendance (~10AM), get night shift report, punched-in list, absentees
 */

/**
 * Get daily summary for a specific date
 */
function getDailySummary(db, date) {
  // Total employees (active)
  const totalEmployees = db.prepare(`
    SELECT COUNT(*) as count FROM employees
    WHERE status != 'Inactive'
    AND (date_of_joining IS NULL OR date_of_joining <= ?)
    AND (date_of_exit IS NULL OR date_of_exit >= ?)
  `).get(date, date);

  // Present today
  const present = db.prepare(`
    SELECT COUNT(DISTINCT employee_code) as count FROM attendance_processed
    WHERE date = ? AND status IN ('P', '½P', 'WOP') AND is_night_out_only = 0
  `).get(date);

  // Absent today (have records but marked absent, or no record at all)
  const absent = db.prepare(`
    SELECT COUNT(DISTINCT employee_code) as count FROM attendance_processed
    WHERE date = ? AND status = 'A' AND is_night_out_only = 0
  `).get(date);

  // Currently punched in (have in_time but no out_time for today)
  const punchedIn = db.prepare(`
    SELECT ap.employee_code, e.name as employee_name, e.department, e.designation,
           ap.in_time_original as in_time, ap.shift_detected
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.date = ? AND ap.in_time_original IS NOT NULL
    AND (ap.out_time_original IS NULL OR ap.out_time_original = '')
    AND ap.is_night_out_only = 0
    ORDER BY ap.in_time_original
  `).all(date);

  // Late arrivals today
  const lateArrivals = db.prepare(`
    SELECT COUNT(DISTINCT employee_code) as count FROM attendance_processed
    WHERE date = ? AND is_late_arrival = 1 AND is_night_out_only = 0
  `).get(date);

  // Miss punches today
  const missPunches = db.prepare(`
    SELECT COUNT(*) as count FROM attendance_processed
    WHERE date = ? AND (status_code LIKE '%MISS%' OR in_time_original IS NULL OR out_time_original IS NULL)
    AND status != 'A' AND is_night_out_only = 0
  `).get(date);

  return {
    date,
    totalEmployees: totalEmployees?.count || 0,
    present: present?.count || 0,
    absent: absent?.count || 0,
    punchedIn: punchedIn.length,
    punchedInList: punchedIn,
    lateArrivals: lateArrivals?.count || 0,
    missPunches: missPunches?.count || 0,
    attendanceRate: totalEmployees?.count > 0
      ? Math.round((present?.count || 0) / totalEmployees.count * 100 * 10) / 10
      : 0
  };
}

/**
 * Get previous night shift details
 */
function getNightShiftReport(db, date) {
  // Previous date
  const prevDate = new Date(date + 'T12:00:00');
  prevDate.setDate(prevDate.getDate() - 1);
  const prevDateStr = prevDate.toISOString().split('T')[0];

  // Night shift workers from previous day (paired records with night shift)
  const nightWorkers = db.prepare(`
    SELECT ap.employee_code, e.name as employee_name, e.department, e.designation,
           ap.in_time_original as in_time, ap.out_time_original as out_time,
           ap.actual_hours, ap.shift_detected, ap.date,
           ap.is_late_arrival, ap.late_by_minutes
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.date = ?
    AND (
      ap.shift_detected LIKE '%NIGHT%' OR ap.shift_detected LIKE '%N%'
      OR ap.is_night_shift = 1
      OR (ap.in_time_original >= '18:00' OR ap.in_time_original <= '06:00')
    )
    AND ap.is_night_out_only = 0
    ORDER BY e.department, e.name
  `).all(prevDateStr);

  return {
    date: prevDateStr,
    count: nightWorkers.length,
    workers: nightWorkers,
    totalHours: nightWorkers.reduce((s, w) => s + (w.actual_hours || 0), 0)
  };
}

/**
 * Get department-wise breakdown for a date
 */
function getDepartmentBreakdown(db, date) {
  const depts = db.prepare(`
    SELECT e.department,
           COUNT(DISTINCT ap.employee_code) as present,
           SUM(CASE WHEN ap.is_late_arrival = 1 THEN 1 ELSE 0 END) as late
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.date = ? AND ap.status IN ('P', '½P', 'WOP') AND ap.is_night_out_only = 0
    GROUP BY e.department
    ORDER BY e.department
  `).all(date);

  // Get total per department
  const totals = db.prepare(`
    SELECT department, COUNT(*) as total FROM employees
    WHERE status != 'Inactive'
    AND (date_of_joining IS NULL OR date_of_joining <= ?)
    AND (date_of_exit IS NULL OR date_of_exit >= ?)
    GROUP BY department
  `).all(date, date);

  const totalMap = {};
  for (const t of totals) totalMap[t.department] = t.total;

  return depts.map(d => ({
    ...d,
    total: totalMap[d.department] || d.present,
    absent: (totalMap[d.department] || d.present) - d.present,
    rate: totalMap[d.department] > 0
      ? Math.round(d.present / totalMap[d.department] * 100 * 10) / 10
      : 100
  }));
}

module.exports = { getDailySummary, getNightShiftReport, getDepartmentBreakdown };

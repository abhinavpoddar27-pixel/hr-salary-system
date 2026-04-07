/**
 * Daily MIS Service
 * Upload daily attendance (~10AM), get night shift report, punched-in list, absentees.
 * Enhanced with shift-wise, department-type (admin vs manufacturing),
 * and worker-type (permanent vs contractor) breakdowns.
 */

const { isContractorDept, isContractorForPayroll } = require('./analytics');

// Admin departments (office/admin roles)
const ADMIN_DEPTS = ['OFFICE ADMIN', 'H.R', 'ACCOUNTS', 'Sales Coordinator', 'SECURITY', 'HOUSE KEEPING'];

function isAdminDept(deptName) {
  if (!deptName) return false;
  return ADMIN_DEPTS.some(a => a.toUpperCase() === deptName.toUpperCase());
}

/**
 * Classify a single attendance row, enriching it with is_contractor and is_admin flags.
 */
function classifyEmployee(row) {
  const dept = row.department || '';
  return {
    ...row,
    is_contractor: isContractorDept(dept),
    is_admin: isAdminDept(dept),
  };
}

/**
 * Determine whether a record belongs to the night shift.
 * Night shift: is_night_shift flag, or in_time >= 18:00 or in_time < 06:00.
 */
function isNightShiftRecord(row) {
  if (row.is_night_shift === 1) return true;
  const shift = (row.shift_detected || '').toUpperCase();
  if (shift.includes('NIGHT') || shift === 'N') return true;
  const inTime = row.in_time_original || row.in_time || '';
  if (!inTime) return false;
  const hh = parseInt(inTime.split(':')[0], 10);
  if (isNaN(hh)) return false;
  return hh >= 18 || hh < 6;
}

// ───────────────────────────────────────────────────────────────
// 1. getDailySummary — existing logic PLUS shift/dept-type/worker-type counts
// ───────────────────────────────────────────────────────────────
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
    WHERE date = ? AND COALESCE(status_final, status_original) IN ('P', '\u00bdP', 'WOP') AND is_night_out_only = 0
  `).get(date);

  // Absent today
  const absent = db.prepare(`
    SELECT COUNT(DISTINCT employee_code) as count FROM attendance_processed
    WHERE date = ? AND COALESCE(status_final, status_original) = 'A' AND is_night_out_only = 0
  `).get(date);

  // Currently punched in (in_time but no out_time)
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

  // Late arrivals
  const lateArrivals = db.prepare(`
    SELECT COUNT(DISTINCT employee_code) as count FROM attendance_processed
    WHERE date = ? AND is_late_arrival = 1 AND is_night_out_only = 0
  `).get(date);

  // Miss punches
  const missPunches = db.prepare(`
    SELECT COUNT(*) as count FROM attendance_processed
    WHERE date = ? AND (is_miss_punch = 1 OR in_time_original IS NULL OR out_time_original IS NULL)
    AND COALESCE(status_final, status_original) != 'A' AND is_night_out_only = 0
  `).get(date);

  // ── Night shift count for the selected date ──
  const nightShiftCount = db.prepare(`
    SELECT COUNT(DISTINCT ap.employee_code) as count
    FROM attendance_processed ap
    WHERE ap.date = ?
    AND ap.is_night_out_only = 0
    AND (
      ap.shift_detected LIKE '%NIGHT%' OR ap.shift_detected LIKE '%N%'
      OR ap.is_night_shift = 1
      OR ap.in_time_original >= '18:00' OR ap.in_time_original <= '06:00'
    )
  `).get(date);

  // ── Present employees with department info for classification ──
  const presentEmployees = db.prepare(`
    SELECT ap.employee_code, e.department, ap.in_time_original, ap.is_night_shift, ap.shift_detected
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.date = ? AND COALESCE(ap.status_final, ap.status_original) IN ('P', '\u00bdP', 'WOP') AND ap.is_night_out_only = 0
  `).all(date);

  // Classification counts
  let dayShiftCount = 0, nightShiftPresentCount = 0;
  let adminPresent = 0, mfgPresent = 0;
  let permanentPresent = 0, contractorPresent = 0;

  for (const emp of presentEmployees) {
    const enriched = classifyEmployee(emp);
    if (isNightShiftRecord(emp)) nightShiftPresentCount++;
    else dayShiftCount++;
    if (enriched.is_admin) adminPresent++;
    else mfgPresent++;
    if (enriched.is_contractor) contractorPresent++;
    else permanentPresent++;
  }

  // ── Total employee classification counts ──
  // Fetches employment_type so isContractorForPayroll can honour it over the
  // dept-keyword heuristic (e.g. COM. HELPER staff with employment_type=Permanent).
  const allActive = db.prepare(`
    SELECT code, department, employment_type, is_contractor FROM employees
    WHERE status != 'Inactive'
    AND (date_of_joining IS NULL OR date_of_joining <= ?)
    AND (date_of_exit IS NULL OR date_of_exit >= ?)
  `).all(date, date);

  let totalAdmin = 0, totalMfg = 0, totalPermanent = 0, totalContractor = 0;
  for (const emp of allActive) {
    if (isAdminDept(emp.department)) totalAdmin++;
    else totalMfg++;
    if (isContractorForPayroll(emp)) totalContractor++;
    else totalPermanent++;
  }

  // Not yet punched: active employees with no attendance record today
  const todayPunchedCodes = new Set(presentEmployees.map(e => e.employee_code));
  const notYetPunched = allActive.filter(e => !todayPunchedCodes.has(e.code));

  return {
    date,
    totalEmployees: totalEmployees?.count || 0,
    present: present?.count || 0,
    absent: absent?.count || 0,
    notYetPunched: notYetPunched.length,
    punchedIn: punchedIn.length,
    punchedInList: punchedIn,
    lateArrivals: lateArrivals?.count || 0,
    missPunches: missPunches?.count || 0,
    nightShiftCount: nightShiftCount?.count || 0,
    attendanceRate: totalEmployees?.count > 0
      ? Math.round((present?.count || 0) / totalEmployees.count * 100 * 10) / 10
      : 0,
    // Shift-wise summary
    shiftSummary: {
      dayShift: dayShiftCount,
      nightShift: nightShiftPresentCount,
    },
    // Department-type summary
    deptTypeSummary: {
      admin: { total: totalAdmin, present: adminPresent },
      manufacturing: { total: totalMfg, present: mfgPresent },
    },
    // Worker-type summary
    workerTypeSummary: {
      permanent: { total: totalPermanent, present: permanentPresent },
      contractor: { total: totalContractor, present: contractorPresent },
    },
  };
}

// ───────────────────────────────────────────────────────────────
// 2. getNightShiftReport — enhanced with classification
// ───────────────────────────────────────────────────────────────
function getNightShiftReport(db, date) {
  const prevDate = new Date(date + 'T12:00:00');
  prevDate.setDate(prevDate.getDate() - 1);
  const prevDateStr = prevDate.toISOString().split('T')[0];

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

  const enriched = nightWorkers.map(w => classifyEmployee(w));

  return {
    date: prevDateStr,
    count: enriched.length,
    workers: enriched,
    totalHours: enriched.reduce((s, w) => s + (w.actual_hours || 0), 0),
    adminCount: enriched.filter(w => w.is_admin).length,
    mfgCount: enriched.filter(w => !w.is_admin).length,
    permanentCount: enriched.filter(w => !w.is_contractor).length,
    contractorCount: enriched.filter(w => w.is_contractor).length,
  };
}

// ───────────────────────────────────────────────────────────────
// 3. getDepartmentBreakdown — enhanced with permanent/contractor split
// ───────────────────────────────────────────────────────────────
function getDepartmentBreakdown(db, date) {
  const depts = db.prepare(`
    SELECT e.department,
           COUNT(DISTINCT ap.employee_code) as present,
           SUM(CASE WHEN ap.is_late_arrival = 1 THEN 1 ELSE 0 END) as late
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.date = ? AND COALESCE(ap.status_final, ap.status_original) IN ('P', '\u00bdP', 'WOP') AND ap.is_night_out_only = 0
    GROUP BY e.department
    ORDER BY e.department
  `).all(date);

  // Total per department
  const totals = db.prepare(`
    SELECT department, COUNT(*) as total FROM employees
    WHERE status != 'Inactive'
    AND (date_of_joining IS NULL OR date_of_joining <= ?)
    AND (date_of_exit IS NULL OR date_of_exit >= ?)
    GROUP BY department
  `).all(date, date);
  const totalMap = {};
  for (const t of totals) totalMap[t.department] = t.total;

  // Permanent/contractor counts per department
  const permCounts = {};
  const contCounts = {};
  const allEmps = db.prepare(`
    SELECT code, department FROM employees
    WHERE status != 'Inactive'
    AND (date_of_joining IS NULL OR date_of_joining <= ?)
    AND (date_of_exit IS NULL OR date_of_exit >= ?)
  `).all(date, date);

  for (const e of allEmps) {
    const dept = e.department || 'Unknown';
    if (isContractorDept(dept)) {
      contCounts[dept] = (contCounts[dept] || 0) + 1;
    } else {
      permCounts[dept] = (permCounts[dept] || 0) + 1;
    }
  }

  return depts.map(d => ({
    ...d,
    total: totalMap[d.department] || d.present,
    permanent: permCounts[d.department] || 0,
    contractor: contCounts[d.department] || 0,
    absent: (totalMap[d.department] || d.present) - d.present,
    rate: totalMap[d.department] > 0
      ? Math.round(d.present / totalMap[d.department] * 100 * 10) / 10
      : 100,
    is_admin: isAdminDept(d.department),
    is_contractor: isContractorDept(d.department),
  }));
}

// ───────────────────────────────────────────────────────────────
// 4. getShiftWiseBreakdown — NEW: day vs night shift detail
// ───────────────────────────────────────────────────────────────
function getShiftWiseBreakdown(db, date) {
  // All present records for the date
  const records = db.prepare(`
    SELECT ap.employee_code, e.name as employee_name, e.department, e.designation,
           ap.in_time_original as in_time, ap.out_time_original as out_time,
           ap.actual_hours, ap.shift_detected, ap.is_night_shift,
           ap.is_late_arrival, ap.late_by_minutes, COALESCE(ap.status_final, ap.status_original) as status
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.date = ? AND COALESCE(ap.status_final, ap.status_original) IN ('P', '\u00bdP', 'WOP') AND ap.is_night_out_only = 0
    ORDER BY e.department, e.name
  `).all(date);

  const dayShiftEmployees = [];
  const nightShiftEmployees = [];

  for (const r of records) {
    const enriched = classifyEmployee(r);
    if (isNightShiftRecord(r)) {
      nightShiftEmployees.push(enriched);
    } else {
      dayShiftEmployees.push(enriched);
    }
  }

  const buildStats = (employees) => {
    const adminPerm = employees.filter(e => e.is_admin && !e.is_contractor).length;
    const adminCont = employees.filter(e => e.is_admin && e.is_contractor).length;
    const mfgPerm = employees.filter(e => !e.is_admin && !e.is_contractor).length;
    const mfgCont = employees.filter(e => !e.is_admin && e.is_contractor).length;
    return {
      total: employees.length,
      admin: adminPerm + adminCont,
      manufacturing: mfgPerm + mfgCont,
      permanent: adminPerm + mfgPerm,
      contractor: adminCont + mfgCont,
      adminPermanent: adminPerm,
      adminContractor: adminCont,
      mfgPermanent: mfgPerm,
      mfgContractor: mfgCont,
      employees,
    };
  };

  return {
    date,
    dayShift: buildStats(dayShiftEmployees),
    nightShift: buildStats(nightShiftEmployees),
  };
}

// ───────────────────────────────────────────────────────────────
// 5. getDepartmentTypeBreakdown — NEW: admin vs manufacturing groups
// ───────────────────────────────────────────────────────────────
function getDepartmentTypeBreakdown(db, date) {
  const departments = getDepartmentBreakdown(db, date);

  const adminDepts = departments.filter(d => isAdminDept(d.department));
  const mfgDepts = departments.filter(d => !isAdminDept(d.department));

  const aggregate = (deptList) => {
    const totalAll = deptList.reduce((s, d) => s + (d.total || 0), 0);
    const presentAll = deptList.reduce((s, d) => s + (d.present || 0), 0);
    const permanentAll = deptList.reduce((s, d) => s + (d.permanent || 0), 0);
    const contractorAll = deptList.reduce((s, d) => s + (d.contractor || 0), 0);
    const lateAll = deptList.reduce((s, d) => s + (d.late || 0), 0);
    return {
      totalEmployees: totalAll,
      present: presentAll,
      absent: totalAll - presentAll,
      permanent: permanentAll,
      contractor: contractorAll,
      late: lateAll,
      rate: totalAll > 0 ? Math.round(presentAll / totalAll * 100 * 10) / 10 : 0,
      departments: deptList,
    };
  };

  return {
    date,
    admin: aggregate(adminDepts),
    manufacturing: aggregate(mfgDepts),
  };
}

// ───────────────────────────────────────────────────────────────
// 6. getWorkerTypeBreakdown — NEW: permanent vs contractor detail
// ───────────────────────────────────────────────────────────────
function getWorkerTypeBreakdown(db, date) {
  // All active employees — fetches employment_type so isContractorForPayroll
  // honours it over the dept-keyword heuristic.
  const allActive = db.prepare(`
    SELECT code, name, department, designation, employment_type, is_contractor FROM employees
    WHERE status != 'Inactive'
    AND (date_of_joining IS NULL OR date_of_joining <= ?)
    AND (date_of_exit IS NULL OR date_of_exit >= ?)
  `).all(date, date);

  // Present employee codes
  const presentRows = db.prepare(`
    SELECT DISTINCT ap.employee_code, e.department
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.date = ? AND COALESCE(ap.status_final, ap.status_original) IN ('P', '\u00bdP', 'WOP') AND ap.is_night_out_only = 0
  `).all(date);
  const presentSet = new Set(presentRows.map(r => r.employee_code));

  // Split into permanent and contractor
  const permanent = { total: [], present: [], departments: {} };
  const contractor = { total: [], present: [], departments: {} };

  for (const emp of allActive) {
    const isCont = isContractorForPayroll(emp);
    const bucket = isCont ? contractor : permanent;
    bucket.total.push(emp);
    if (presentSet.has(emp.code)) bucket.present.push(emp);

    // Department breakdown
    const dept = emp.department || 'Unknown';
    if (!bucket.departments[dept]) bucket.departments[dept] = { total: 0, present: 0 };
    bucket.departments[dept].total++;
    if (presentSet.has(emp.code)) bucket.departments[dept].present++;
  }

  const formatBucket = (b) => ({
    totalCount: b.total.length,
    presentCount: b.present.length,
    absentCount: b.total.length - b.present.length,
    attendanceRate: b.total.length > 0
      ? Math.round(b.present.length / b.total.length * 100 * 10) / 10
      : 0,
    departments: Object.entries(b.departments)
      .map(([dept, stats]) => ({
        department: dept,
        total: stats.total,
        present: stats.present,
        absent: stats.total - stats.present,
        rate: stats.total > 0 ? Math.round(stats.present / stats.total * 100 * 10) / 10 : 0,
        is_admin: isAdminDept(dept),
      }))
      .sort((a, b2) => b2.total - a.total),
  });

  return {
    date,
    permanent: formatBucket(permanent),
    contractor: formatBucket(contractor),
  };
}

// ───────────────────────────────────────────────────────────────
// 7. getPreviousDayReport — Complete day report for yesterday
//    Splits into day shift and night shift with full employee lists
// ───────────────────────────────────────────────────────────────
function getPreviousDayReport(db, todayDate) {
  const prevDate = new Date(todayDate + 'T12:00:00');
  prevDate.setDate(prevDate.getDate() - 1);
  const prevDateStr = prevDate.toISOString().split('T')[0];

  // All attendance records for previous day
  const records = db.prepare(`
    SELECT ap.employee_code, e.name as employee_name, e.department, e.designation,
           COALESCE(ap.in_time_final, ap.in_time_original) as in_time,
           COALESCE(ap.out_time_final, ap.out_time_original) as out_time,
           COALESCE(ap.status_final, ap.status_original) as status,
           ap.actual_hours, ap.is_night_shift, ap.shift_detected,
           ap.is_late_arrival, ap.late_by_minutes,
           ap.overtime_minutes, ap.is_miss_punch, ap.miss_punch_type
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.date = ? AND ap.is_night_out_only = 0
    ORDER BY e.department, e.name
  `).all(prevDateStr);

  // Active employee count for that date
  const totalActive = db.prepare(`
    SELECT COUNT(*) as count FROM employees
    WHERE status != 'Inactive'
    AND (date_of_joining IS NULL OR date_of_joining <= ?)
    AND (date_of_exit IS NULL OR date_of_exit >= ?)
  `).get(prevDateStr, prevDateStr);

  // Classify each record
  const dayShiftEmps = [];
  const nightShiftEmps = [];

  for (const rec of records) {
    const enriched = classifyEmployee(rec);
    if (isNightShiftRecord(rec)) {
      nightShiftEmps.push(enriched);
    } else {
      dayShiftEmps.push(enriched);
    }
  }

  // Present = P, WOP, ½P
  const presentStatuses = ['P', 'WOP', '\u00bdP', 'WO\u00bdP'];
  const presentRecords = records.filter(r => presentStatuses.includes(r.status));
  const absentRecords = records.filter(r => r.status === 'A');
  const halfDayRecords = records.filter(r => r.status === '\u00bdP' || r.status === 'WO\u00bdP');
  const lateRecords = records.filter(r => r.is_late_arrival === 1);

  // Avg hours (only where actual_hours > 0)
  const hoursRecords = records.filter(r => r.actual_hours > 0);
  const avgHours = hoursRecords.length > 0
    ? Math.round(hoursRecords.reduce((s, r) => s + r.actual_hours, 0) / hoursRecords.length * 10) / 10
    : 0;
  const totalHours = Math.round(hoursRecords.reduce((s, r) => s + r.actual_hours, 0) * 10) / 10;
  const totalOT = Math.round(records.reduce((s, r) => s + (r.overtime_minutes || 0), 0) / 60 * 10) / 10;

  const total = totalActive?.count || 0;
  const attendanceRate = total > 0 ? Math.round(presentRecords.length / total * 100 * 10) / 10 : 0;

  // Department breakdown
  const deptMap = {};
  for (const rec of records) {
    const dept = rec.department || 'Unknown';
    if (!deptMap[dept]) deptMap[dept] = { department: dept, total: 0, present: 0, absent: 0, late: 0, halfDay: 0, hours: 0, hoursCount: 0, is_admin: isAdminDept(dept), is_contractor: isContractorDept(dept) };
    deptMap[dept].total++;
    if (presentStatuses.includes(rec.status)) deptMap[dept].present++;
    if (rec.status === 'A') deptMap[dept].absent++;
    if (rec.is_late_arrival) deptMap[dept].late++;
    if (rec.status === '\u00bdP' || rec.status === 'WO\u00bdP') deptMap[dept].halfDay++;
    if (rec.actual_hours > 0) { deptMap[dept].hours += rec.actual_hours; deptMap[dept].hoursCount++; }
  }
  const departments = Object.values(deptMap).map(d => ({
    ...d,
    avgHours: d.hoursCount > 0 ? Math.round(d.hours / d.hoursCount * 10) / 10 : 0,
    rate: d.total > 0 ? Math.round(d.present / d.total * 100 * 10) / 10 : 0,
  })).sort((a, b) => b.total - a.total);

  // Shift stats builder
  const buildShiftStats = (emps) => {
    const h = emps.filter(e => e.actual_hours > 0);
    return {
      count: emps.length,
      lateCount: emps.filter(e => e.is_late_arrival).length,
      avgHours: h.length > 0 ? Math.round(h.reduce((s, e) => s + e.actual_hours, 0) / h.length * 10) / 10 : 0,
      totalHours: Math.round(h.reduce((s, e) => s + e.actual_hours, 0) * 10) / 10,
      adminCount: emps.filter(e => e.is_admin).length,
      mfgCount: emps.filter(e => !e.is_admin).length,
      permanentCount: emps.filter(e => !e.is_contractor).length,
      contractorCount: emps.filter(e => e.is_contractor).length,
      employees: emps,
    };
  };

  return {
    date: prevDateStr,
    summary: {
      total,
      present: presentRecords.length,
      absent: absentRecords.length,
      halfDay: halfDayRecords.length,
      late: lateRecords.length,
      avgHours,
      nightShiftCount: nightShiftEmps.length,
      attendanceRate,
    },
    dayShift: buildShiftStats(dayShiftEmps),
    nightShift: buildShiftStats(nightShiftEmps),
    departments,
    totals: {
      totalHours,
      otHours: totalOT,
      manDaysUtilized: Math.round(presentRecords.length * 10) / 10,
    },
  };
}

module.exports = {
  getDailySummary,
  getNightShiftReport,
  getDepartmentBreakdown,
  getShiftWiseBreakdown,
  getDepartmentTypeBreakdown,
  getWorkerTypeBreakdown,
  getPreviousDayReport,
};

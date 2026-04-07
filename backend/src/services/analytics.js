/**
 * Analytics Service
 * Computes HR intelligence metrics from attendance and salary data.
 */

const PERMANENT_DEPTS = [
  'BLOW MOULDING', 'PRODUCTION', 'OPR', 'LAB', 'ELECTRICIAN', 'MAINTANCE',
  'GODOWN', 'ETP', 'STORE', 'RO', 'OFFICE ADMIN', 'H.R', 'ACCOUNTS',
  'HOUSE KEEPING', 'SECURITY', 'Sales Coordinator'
];

/**
 * Department name heuristic — for MIS display grouping ONLY.
 *
 * ⚠️ Do NOT use isContractorDept() for payroll math or any logic that
 *    determines whether an employee gets paid Sundays, holidays, or OT.
 *    Use isContractorForPayroll(employee) — re-exported below from
 *    utils/employeeClassification — which honours employment_type first
 *    and falls back to this keyword heuristic only for legacy rows.
 */
const CONTRACTOR_KEYWORDS = [
  'MEERA', 'KULDEEP', 'LAMBU', 'COM. HELPER', 'JIWAN', 'DAVINDER',
  'SUNNY', 'AMAR', 'BISLERI', 'CONT'
];

function isContractorDept(deptName) {
  if (!deptName) return false;
  const upper = deptName.toUpperCase();
  return CONTRACTOR_KEYWORDS.some(k => upper.includes(k));
}

// Re-export the payroll-grade detection so MIS/analytics code that already
// imports from './analytics' has a single place to get the correct function.
const { isContractorForPayroll } = require('../utils/employeeClassification');

/**
 * Build a WHERE clause for date filtering.
 * Supports either month/year or startDate/endDate range.
 */
function dateClause(month, year, startDate, endDate) {
  if (startDate && endDate) {
    return { clause: 'ap.date >= ? AND ap.date <= ?', args: [startDate, endDate] };
  }
  return { clause: 'ap.month = ? AND ap.year = ?', args: [month, year] };
}

function isPermanentDept(deptName) {
  if (!deptName) return false;
  return PERMANENT_DEPTS.some(p => p.toUpperCase() === deptName.toUpperCase());
}

/**
 * Compute organisation overview for a given month
 * Only counts ACTIVE employees (excludes Inactive/Exited)
 */
function computeOrgOverview(db, month, year, startDate, endDate) {
  // Get all processed records for this month — only active employees
  const dc = dateClause(month, year, startDate, endDate);
  const records = db.prepare(`
    SELECT ap.*, e.department, e.company, e.employment_type, e.contractor_group
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ${dc.clause}
    AND ap.is_night_out_only = 0
    AND (e.status IS NULL OR e.status NOT IN ('Inactive', 'Exited', 'Left'))
  `).all(...dc.args);

  if (records.length === 0) return null;

  // Unique employees
  const empCodes = [...new Set(records.map(r => r.employee_code))];
  const totalHeadcount = empCodes.length;

  // Company split
  const companyBreakdown = {};
  for (const r of records) {
    const comp = r.company || 'Unknown';
    if (!companyBreakdown[comp]) companyBreakdown[comp] = new Set();
    companyBreakdown[comp].add(r.employee_code);
  }

  // Permanent vs contractor
  let permanentCount = 0;
  let contractorCount = 0;
  for (const code of empCodes) {
    const emp = db.prepare('SELECT department, employment_type FROM employees WHERE code = ?').get(code);
    const dept = emp?.department || '';
    if (isContractorDept(dept)) contractorCount++;
    else permanentCount++;
  }

  // Attendance rate (days present / total possible days)
  const PRESENT_STATUSES = ['P', 'WOP', '½P', 'WO½P'];
  let totalPossible = 0;
  let totalPresent = 0;

  for (const r of records) {
    const dow = new Date(r.date + 'T12:00:00').getDay();
    if (dow === 0) continue; // Skip Sundays
    totalPossible++;
    const status = r.status_final || r.status_original || '';
    if (status === 'P' || status === 'WOP') totalPresent += 1;
    else if (status === '½P' || status === 'WO½P') totalPresent += 0.5;
  }

  const attendanceRate = totalPossible > 0 ? Math.round((totalPresent / totalPossible) * 1000) / 10 : 0;

  // Avg hours and miss punches
  let totalHours = 0, hoursCount = 0, missPunchCount = 0;
  for (const r of records) {
    if (r.actual_hours && r.actual_hours > 0) { totalHours += r.actual_hours; hoursCount++; }
    if (!r.in_time_original || !r.out_time_original) missPunchCount++;
  }
  const avgHours = hoursCount > 0 ? Math.round(totalHours / hoursCount * 100) / 100 : 0;

  // Department stats
  const deptStats = {};
  for (const r of records) {
    const dept = r.department || 'Unknown';
    if (!deptStats[dept]) deptStats[dept] = { employees: new Set(), present: 0, possible: 0, late: 0, ot: 0, hours: 0, hoursCount: 0, missPunch: 0, absent: 0 };
    deptStats[dept].employees.add(r.employee_code);

    const dow = new Date(r.date + 'T12:00:00').getDay();
    if (dow !== 0) {
      deptStats[dept].possible++;
      const status = r.status_final || r.status_original || '';
      if (status === 'P' || status === 'WOP') deptStats[dept].present += 1;
      else if (status === '½P' || status === 'WO½P') deptStats[dept].present += 0.5;
      else if (status === 'A') deptStats[dept].absent++;
    }

    if (r.is_late_arrival) deptStats[dept].late++;
    if (r.overtime_minutes) deptStats[dept].ot += r.overtime_minutes;
    if (r.actual_hours > 0) { deptStats[dept].hours += r.actual_hours; deptStats[dept].hoursCount++; }
    if (!r.in_time_original || !r.out_time_original) deptStats[dept].missPunch++;
  }

  const departments = Object.entries(deptStats).map(([dept, stats]) => ({
    department: dept,
    totalEmployees: stats.employees.size,
    headcount: stats.employees.size,
    presentDays: Math.round(stats.present * 10) / 10,
    absentDays: stats.absent,
    attendanceRate: stats.possible > 0 ? Math.round((stats.present / stats.possible) * 1000) / 10 : 0,
    punctualityIssues: stats.late,
    overtimeHours: Math.round(stats.ot / 60),
    avgActualHours: stats.hoursCount > 0 ? Math.round(stats.hours / stats.hoursCount * 100) / 100 : 0,
    missPunchCount: stats.missPunch,
    isContractor: isContractorDept(dept)
  })).sort((a, b) => b.headcount - a.headcount);

  // Salary outflow
  let salaryData;
  if (startDate && endDate) {
    salaryData = db.prepare(`
      SELECT SUM(net_salary) as total, SUM(gross_earned) as gross
      FROM salary_computations sc
      WHERE EXISTS (
        SELECT 1 FROM attendance_processed ap2
        WHERE ap2.employee_code = sc.employee_code
        AND ap2.date >= ? AND ap2.date <= ?
        AND sc.month = ap2.month AND sc.year = ap2.year
      )
    `).get(startDate, endDate);
  } else {
    salaryData = db.prepare(`
      SELECT SUM(net_salary) as total, SUM(gross_earned) as gross
      FROM salary_computations WHERE month = ? AND year = ?
    `).get(month, year);
  }

  // Total present / absent day counts
  let totalPresentDays = 0, totalAbsentDays = 0;
  for (const r of records) {
    const dow = new Date(r.date + 'T12:00:00').getDay();
    if (dow === 0) continue;
    const status = r.status_final || r.status_original || '';
    if (status === 'P' || status === 'WOP') totalPresentDays += 1;
    else if (status === '½P' || status === 'WO½P') totalPresentDays += 0.5;
    else if (status === 'A') totalAbsentDays++;
  }

  return {
    month, year,
    totalHeadcount,
    totalEmployees: totalHeadcount,
    companyBreakdown: Object.entries(companyBreakdown).map(([company, emps]) => ({ company, count: emps.size })),
    permanentCount,
    contractorCount,
    attendanceRate,
    avgAttendanceRate: attendanceRate,
    avgHours,
    missPunchCount,
    totalPresentDays: Math.round(totalPresentDays * 10) / 10,
    totalAbsentDays,
    departments,
    salaryOutflow: salaryData?.total || 0,
    grossOutflow: salaryData?.gross || 0
  };
}

/**
 * Compute headcount trend across multiple months
 */
function computeHeadcountTrend(db, months) {
  // months: array of {month, year}
  const trend = [];
  const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  for (const { month, year } of months) {
    // Try attendance data first
    const result = db.prepare(`
      SELECT COUNT(DISTINCT employee_code) as count, company
      FROM attendance_processed
      WHERE month = ? AND year = ? AND is_night_out_only = 0
      GROUP BY company
    `).all(month, year);

    let total = db.prepare(`
      SELECT COUNT(DISTINCT employee_code) as count
      FROM attendance_processed
      WHERE month = ? AND year = ? AND is_night_out_only = 0
    `).get(month, year);

    let totalCount = total?.count || 0;
    let byCompany = result;

    // Fallback to employee master if no attendance data
    if (totalCount === 0) {
      const monthStr = String(month).padStart(2, '0');
      const monthEnd = `${year}-${monthStr}-31`;
      const monthStart = `${year}-${monthStr}-01`;

      totalCount = db.prepare(`
        SELECT COUNT(*) as count FROM employees
        WHERE date_of_joining <= ?
        AND (date_of_exit IS NULL OR date_of_exit = '' OR date_of_exit > ?)
        AND status NOT IN ('Inactive', 'Left', 'Exited')
      `).get(monthEnd, monthStart)?.count || 0;

      byCompany = db.prepare(`
        SELECT COUNT(*) as count, company FROM employees
        WHERE date_of_joining <= ?
        AND (date_of_exit IS NULL OR date_of_exit = '' OR date_of_exit > ?)
        AND status NOT IN ('Inactive', 'Left', 'Exited')
        GROUP BY company
      `).all(monthEnd, monthStart);
    }

    // Permanent vs Contractor split
    let permCount = 0, contCount = 0;
    const empCodes = totalCount > 0 ? db.prepare(`
      SELECT DISTINCT employee_code FROM attendance_processed
      WHERE month = ? AND year = ? AND is_night_out_only = 0
    `).all(month, year).map(r => r.employee_code) : [];

    if (empCodes.length > 0) {
      for (const code of empCodes) {
        const emp = db.prepare('SELECT department FROM employees WHERE code = ?').get(code);
        if (isContractorDept(emp?.department)) contCount++;
        else permCount++;
      }
    } else {
      // Fallback from employee master
      const monthStr = String(month).padStart(2, '0');
      const monthEnd = `${year}-${monthStr}-31`;
      const monthStart = `${year}-${monthStr}-01`;
      const emps = db.prepare(`
        SELECT department FROM employees
        WHERE date_of_joining <= ?
        AND (date_of_exit IS NULL OR date_of_exit = '' OR date_of_exit > ?)
        AND status NOT IN ('Inactive', 'Left', 'Exited')
      `).all(monthEnd, monthStart);
      for (const emp of emps) {
        if (isContractorDept(emp.department)) contCount++;
        else permCount++;
      }
    }

    trend.push({
      month, year,
      label: `${MONTH_NAMES[month]} ${year}`,
      monthLabel: `${MONTH_NAMES[month]} ${year}`,
      total: totalCount,
      totalEmployees: totalCount,
      permanentCount: permCount,
      contractorCount: contCount,
      byCompany
    });
  }

  // Detect joins and exits
  for (let i = 1; i < trend.length; i++) {
    const getPrev = () => {
      const codes = db.prepare(`
        SELECT DISTINCT employee_code FROM attendance_processed
        WHERE month = ? AND year = ? AND is_night_out_only = 0
      `).all(trend[i-1].month, trend[i-1].year).map(r => r.employee_code);
      if (codes.length > 0) return codes;
      // Fallback
      const ms = String(trend[i-1].month).padStart(2,'0');
      return db.prepare(`
        SELECT code as employee_code FROM employees
        WHERE date_of_joining <= ? AND (date_of_exit IS NULL OR date_of_exit = '' OR date_of_exit > ?) AND status NOT IN ('Inactive', 'Left', 'Exited')
      `).all(`${trend[i-1].year}-${ms}-31`, `${trend[i-1].year}-${ms}-01`).map(r => r.employee_code);
    };
    const getCurr = () => {
      const codes = db.prepare(`
        SELECT DISTINCT employee_code FROM attendance_processed
        WHERE month = ? AND year = ? AND is_night_out_only = 0
      `).all(trend[i].month, trend[i].year).map(r => r.employee_code);
      if (codes.length > 0) return codes;
      const ms = String(trend[i].month).padStart(2,'0');
      return db.prepare(`
        SELECT code as employee_code FROM employees
        WHERE date_of_joining <= ? AND (date_of_exit IS NULL OR date_of_exit = '' OR date_of_exit > ?) AND status NOT IN ('Inactive', 'Left', 'Exited')
      `).all(`${trend[i].year}-${ms}-31`, `${trend[i].year}-${ms}-01`).map(r => r.employee_code);
    };

    const prev = getPrev();
    const curr = getCurr();
    const prevSet = new Set(prev);
    const currSet = new Set(curr);

    trend[i].newJoins = curr.filter(c => !prevSet.has(c)).length;
    trend[i].exits = prev.filter(p => !currSet.has(p)).length;
    trend[i].netChange = trend[i].total - trend[i-1].total;
  }

  return trend;
}

/**
 * Compute attrition analysis
 */
function computeAttrition(db, month, year) {
  // Compare with previous month
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  const prevEmps = db.prepare(`
    SELECT DISTINCT employee_code FROM attendance_processed
    WHERE month = ? AND year = ? AND is_night_out_only = 0
  `).all(prevMonth, prevYear).map(r => r.employee_code);

  const currEmps = db.prepare(`
    SELECT DISTINCT employee_code FROM attendance_processed
    WHERE month = ? AND year = ? AND is_night_out_only = 0
  `).all(month, year).map(r => r.employee_code);

  const prevSet = new Set(prevEmps);
  const currSet = new Set(currEmps);

  const newJoins = currEmps.filter(c => !prevSet.has(c));
  const exits = prevEmps.filter(p => !currSet.has(p));

  const attritionRate = prevEmps.length > 0
    ? Math.round((exits.length / prevEmps.length) * 1000) / 10
    : 0;

  // Get employee details for joins and exits
  const getEmpDetails = (codes) => codes.map(code => {
    const emp = db.prepare('SELECT name, department, company FROM employees WHERE code = ?').get(code);
    return { code, name: emp?.name || code, department: emp?.department || '', company: emp?.company || '' };
  });

  return {
    month, year,
    openingHeadcount: prevEmps.length,
    closingHeadcount: currEmps.length,
    newJoins: newJoins.length,
    exits: exits.length,
    netChange: currEmps.length - prevEmps.length,
    attritionRate,
    annualisedAttritionRate: Math.round(attritionRate * 12 * 10) / 10,
    newJoinDetails: getEmpDetails(newJoins.slice(0, 20)),
    exitDetails: getEmpDetails(exits.slice(0, 20))
  };
}

/**
 * Compute chronic absenteeism report
 */
function computeChronicAbsentees(db, month, year, startDate, endDate) {
  // Get attendance rates for active employees this month
  const dc = dateClause(month, year, startDate, endDate);
  const records = db.prepare(`
    SELECT ap.employee_code, ap.status_final, ap.status_original, ap.date
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ${dc.clause} AND ap.is_night_out_only = 0
    AND (e.status IS NULL OR e.status NOT IN ('Inactive', 'Exited', 'Left'))
  `).all(...dc.args);

  const byEmp = {};
  for (const r of records) {
    if (!byEmp[r.employee_code]) byEmp[r.employee_code] = { present: 0, total: 0 };
    const dow = new Date(r.date + 'T12:00:00').getDay();
    if (dow === 0) continue;
    byEmp[r.employee_code].total++;
    const status = r.status_final || r.status_original || '';
    if (status === 'P' || status === 'WOP') byEmp[r.employee_code].present += 1;
    else if (status === '½P' || status === 'WO½P') byEmp[r.employee_code].present += 0.5;
  }

  const absentees = Object.entries(byEmp)
    .map(([code, stats]) => {
      const rate = stats.total > 0 ? Math.round((stats.present / stats.total) * 1000) / 10 : 0;
      const emp = db.prepare('SELECT name, department, company FROM employees WHERE code = ?').get(code);
      return {
        code,
        name: emp?.name || code,
        department: emp?.department || '',
        company: emp?.company || '',
        presentDays: Math.round(stats.present * 10) / 10,
        totalDays: stats.total,
        attendanceRate: rate
      };
    })
    .filter(e => e.attendanceRate < 50)
    .sort((a, b) => a.attendanceRate - b.attendanceRate);

  return absentees;
}

/**
 * Compute punctuality analysis
 */
function computePunctualityReport(db, month, year, startDate, endDate) {
  const dc = dateClause(month, year, startDate, endDate);
  const records = db.prepare(`
    SELECT ap.employee_code, ap.is_late_arrival, ap.late_by_minutes, ap.date,
           e.name, e.department, e.company
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ${dc.clause} AND ap.is_night_out_only = 0
    AND (ap.status_final IN ('P','WOP') OR ap.status_original IN ('P','WOP'))
    AND (e.status IS NULL OR e.status NOT IN ('Inactive', 'Exited', 'Left'))
  `).all(...dc.args);

  const byEmp = {};
  for (const r of records) {
    if (!byEmp[r.employee_code]) {
      byEmp[r.employee_code] = {
        code: r.employee_code, name: r.name, department: r.department, company: r.company,
        totalDays: 0, lateDays: 0, totalLateMinutes: 0
      };
    }
    byEmp[r.employee_code].totalDays++;
    if (r.is_late_arrival) {
      byEmp[r.employee_code].lateDays++;
      byEmp[r.employee_code].totalLateMinutes += (r.late_by_minutes || 0);
    }
  }

  const employees = Object.values(byEmp).map(e => ({
    ...e,
    lateRate: e.totalDays > 0 ? Math.round((e.lateDays / e.totalDays) * 1000) / 10 : 0,
    avgLateMinutes: e.lateDays > 0 ? Math.round(e.totalLateMinutes / e.lateDays) : 0
  })).sort((a, b) => b.lateRate - a.lateRate);

  // Department summary
  const deptStats = {};
  for (const e of employees) {
    if (!deptStats[e.department]) deptStats[e.department] = { total: 0, late: 0, minutes: 0, employees: 0 };
    deptStats[e.department].employees++;
    deptStats[e.department].total += e.totalDays;
    deptStats[e.department].late += e.lateDays;
    deptStats[e.department].minutes += e.totalLateMinutes;
  }

  return {
    month, year,
    habitualLatecomers: employees.filter(e => e.lateRate >= 50),
    allEmployees: employees,
    departmentSummary: Object.entries(deptStats).map(([dept, s]) => ({
      department: dept,
      employees: s.employees,
      lateRate: s.total > 0 ? Math.round((s.late / s.total) * 1000) / 10 : 0,
      avgLateMinutes: s.late > 0 ? Math.round(s.minutes / s.late) : 0,
      totalLostMinutes: s.minutes,
      totalLostHours: Math.round(s.minutes / 60)
    })).sort((a, b) => b.lateRate - a.lateRate)
  };
}

/**
 * Generate alerts for the month
 */
function generateAlerts(db, month, year) {
  const alerts = [];
  const now = new Date().toISOString();

  // Chronic absentees
  const absentees = computeChronicAbsentees(db, month, year);
  for (const emp of absentees) {
    alerts.push({
      type: 'CHRONIC_ABSENTEE',
      severity: 'Critical',
      employee_code: emp.code,
      department: emp.department,
      month, year,
      title: `Chronic Absentee: ${emp.name}`,
      description: `${emp.name} (${emp.department}) has only ${emp.attendanceRate}% attendance this month (${emp.presentDays}/${emp.totalDays} days)`
    });
  }

  // Habitually late employees
  const punct = computePunctualityReport(db, month, year);
  for (const emp of punct.habitualLatecomers) {
    alerts.push({
      type: 'HABITUAL_LATE',
      severity: 'Warning',
      employee_code: emp.code,
      department: emp.department,
      month, year,
      title: `Habitual Late: ${emp.name}`,
      description: `${emp.name} arrived late on ${emp.lateDays} out of ${emp.totalDays} working days (${emp.lateRate}%)`
    });
  }

  // Ghost employees (0% attendance but on rolls)
  const ghost = db.prepare(`
    SELECT employee_code, COUNT(*) as total,
      SUM(CASE WHEN (status_final IN ('P','WOP','½P','WO½P') OR status_original IN ('P','WOP','½P','WO½P')) THEN 1 ELSE 0 END) as present_days
    FROM attendance_processed
    WHERE month = ? AND year = ? AND is_night_out_only = 0
    GROUP BY employee_code
    HAVING present_days = 0 AND total >= 10
  `).all(month, year);

  for (const g of ghost) {
    const emp = db.prepare('SELECT name, department FROM employees WHERE code = ?').get(g.employee_code);
    alerts.push({
      type: 'GHOST_EMPLOYEE',
      severity: 'Critical',
      employee_code: g.employee_code,
      department: emp?.department || '',
      month, year,
      title: `Ghost Employee Check: ${emp?.name || g.employee_code}`,
      description: `${emp?.name || g.employee_code} has 0% attendance this month but is on active rolls`
    });
  }

  // Save alerts to DB
  const insertAlert = db.prepare(`
    INSERT OR IGNORE INTO alerts (type, severity, employee_code, department, month, year, title, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const txn = db.transaction(() => {
    for (const alert of alerts) {
      insertAlert.run(alert.type, alert.severity, alert.employee_code, alert.department,
        alert.month, alert.year, alert.title, alert.description);
    }
  });
  txn();

  return alerts;
}

/**
 * Compute overtime analysis
 */
function computeOvertimeReport(db, month, year, startDate, endDate) {
  const dc = dateClause(month, year, startDate, endDate);
  const records = db.prepare(`
    SELECT ap.employee_code, ap.overtime_minutes, ap.actual_hours, ap.date,
           e.name, e.department, e.company
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ${dc.clause} AND ap.is_night_out_only = 0
    AND ap.overtime_minutes > 0
    AND (e.status IS NULL OR e.status NOT IN ('Inactive', 'Exited', 'Left'))
  `).all(...dc.args);

  const byEmp = {};
  for (const r of records) {
    if (!byEmp[r.employee_code]) {
      byEmp[r.employee_code] = {
        code: r.employee_code, name: r.name, department: r.department,
        company: r.company, totalOTMinutes: 0, otDays: 0, maxOT: 0
      };
    }
    byEmp[r.employee_code].totalOTMinutes += (r.overtime_minutes || 0);
    byEmp[r.employee_code].otDays++;
    if (r.overtime_minutes > byEmp[r.employee_code].maxOT) byEmp[r.employee_code].maxOT = r.overtime_minutes;
  }

  const employees = Object.values(byEmp).map(e => ({
    ...e,
    totalOTHours: Math.round(e.totalOTMinutes / 60 * 10) / 10,
    avgOTMinutes: e.otDays > 0 ? Math.round(e.totalOTMinutes / e.otDays) : 0
  })).sort((a, b) => b.totalOTMinutes - a.totalOTMinutes);

  // Department summary
  const deptMap = {};
  for (const e of employees) {
    const dept = e.department || 'Unknown';
    if (!deptMap[dept]) deptMap[dept] = { totalMinutes: 0, employees: 0, days: 0 };
    deptMap[dept].totalMinutes += e.totalOTMinutes;
    deptMap[dept].employees++;
    deptMap[dept].days += e.otDays;
  }

  const totalOTMinutes = employees.reduce((s, e) => s + e.totalOTMinutes, 0);
  const totalOTHours = Math.round(totalOTMinutes / 60 * 10) / 10;

  return {
    month, year,
    totalOTHours,
    totalOTMinutes,
    employeesWithOT: employees.length,
    topOTEmployees: employees.slice(0, 20),
    allEmployees: employees,
    departmentSummary: Object.entries(deptMap).map(([dept, s]) => ({
      department: dept,
      totalHours: Math.round(s.totalMinutes / 60 * 10) / 10,
      employees: s.employees,
      totalDays: s.days,
      avgPerEmployee: s.employees > 0 ? Math.round(s.totalMinutes / s.employees / 60 * 10) / 10 : 0
    })).sort((a, b) => b.totalHours - a.totalHours)
  };
}

/**
 * Compute working hours distribution
 */
function computeWorkingHoursReport(db, month, year, startDate, endDate) {
  const dc = dateClause(month, year, startDate, endDate);
  const records = db.prepare(`
    SELECT ap.employee_code, ap.actual_hours, ap.date,
           e.name, e.department
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ${dc.clause} AND ap.is_night_out_only = 0
    AND ap.actual_hours > 0
    AND (e.status IS NULL OR e.status NOT IN ('Inactive', 'Exited', 'Left'))
  `).all(...dc.args);

  // Histogram buckets
  const buckets = { '<6h': 0, '6-7h': 0, '7-8h': 0, '8-9h': 0, '9-10h': 0, '10-11h': 0, '11-12h': 0, '>12h': 0 };
  for (const r of records) {
    const h = r.actual_hours;
    if (h < 6) buckets['<6h']++;
    else if (h < 7) buckets['6-7h']++;
    else if (h < 8) buckets['7-8h']++;
    else if (h < 9) buckets['8-9h']++;
    else if (h < 10) buckets['9-10h']++;
    else if (h < 11) buckets['10-11h']++;
    else if (h < 12) buckets['11-12h']++;
    else buckets['>12h']++;
  }

  // Per employee avg hours
  const byEmp = {};
  for (const r of records) {
    if (!byEmp[r.employee_code]) byEmp[r.employee_code] = { code: r.employee_code, name: r.name, department: r.department, total: 0, count: 0 };
    byEmp[r.employee_code].total += r.actual_hours;
    byEmp[r.employee_code].count++;
  }

  const employees = Object.values(byEmp).map(e => ({
    ...e,
    avgHours: Math.round(e.total / e.count * 100) / 100
  })).sort((a, b) => b.avgHours - a.avgHours);

  const totalHours = records.reduce((s, r) => s + r.actual_hours, 0);
  const avgHours = records.length > 0 ? Math.round(totalHours / records.length * 100) / 100 : 0;

  return {
    month, year,
    distribution: Object.entries(buckets).map(([range, count]) => ({ range, count })),
    avgHoursPerDay: avgHours,
    totalRecords: records.length,
    topWorkers: employees.slice(0, 15),
    lowWorkers: employees.filter(e => e.avgHours < 7).sort((a, b) => a.avgHours - b.avgHours).slice(0, 15)
  };
}

/**
 * Department deep-dive: employee-level stats for a specific department
 */
function computeDepartmentDeepDive(db, department, month, year, startDate, endDate) {
  const dc = dateClause(month, year, startDate, endDate);
  const records = db.prepare(`
    SELECT ap.*, e.name, e.department, e.designation
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ${dc.clause} AND ap.is_night_out_only = 0
    AND e.department = ?
  `).all(...dc.args, department);

  if (records.length === 0) return { department, employees: [] };

  const byEmp = {};
  for (const r of records) {
    if (!byEmp[r.employee_code]) {
      byEmp[r.employee_code] = {
        code: r.employee_code, name: r.name, designation: r.designation,
        present: 0, absent: 0, halfDay: 0, total: 0, late: 0, otMinutes: 0,
        hours: 0, hoursCount: 0, missPunch: 0
      };
    }
    const dow = new Date(r.date + 'T12:00:00').getDay();
    if (dow !== 0) {
      byEmp[r.employee_code].total++;
      const status = r.status_final || r.status_original || '';
      if (status === 'P' || status === 'WOP') byEmp[r.employee_code].present++;
      else if (status === '½P' || status === 'WO½P') { byEmp[r.employee_code].present += 0.5; byEmp[r.employee_code].halfDay++; }
      else if (status === 'A') byEmp[r.employee_code].absent++;
    }
    if (r.is_late_arrival) byEmp[r.employee_code].late++;
    if (r.overtime_minutes) byEmp[r.employee_code].otMinutes += r.overtime_minutes;
    if (r.actual_hours > 0) { byEmp[r.employee_code].hours += r.actual_hours; byEmp[r.employee_code].hoursCount++; }
    if (!r.in_time_original || !r.out_time_original) byEmp[r.employee_code].missPunch++;
  }

  const employees = Object.values(byEmp).map(e => ({
    ...e,
    attendanceRate: e.total > 0 ? Math.round(e.present / e.total * 1000) / 10 : 0,
    avgHours: e.hoursCount > 0 ? Math.round(e.hours / e.hoursCount * 100) / 100 : 0,
    otHours: Math.round(e.otMinutes / 60 * 10) / 10
  })).sort((a, b) => b.attendanceRate - a.attendanceRate);

  return { department, headcount: employees.length, employees };
}

module.exports = {
  computeOrgOverview,
  computeHeadcountTrend,
  computeAttrition,
  computeChronicAbsentees,
  computePunctualityReport,
  computeOvertimeReport,
  computeWorkingHoursReport,
  computeDepartmentDeepDive,
  generateAlerts,
  isContractorDept,
  isContractorForPayroll,
  isPermanentDept
};

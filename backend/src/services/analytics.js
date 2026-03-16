/**
 * Analytics Service
 * Computes HR intelligence metrics from attendance and salary data.
 */

const PERMANENT_DEPTS = [
  'BLOW MOULDING', 'PRODUCTION', 'OPR', 'LAB', 'ELECTRICIAN', 'MAINTANCE',
  'GODOWN', 'ETP', 'STORE', 'RO', 'OFFICE ADMIN', 'H.R', 'ACCOUNTS',
  'HOUSE KEEPING', 'SECURITY', 'Sales Coordinator'
];

const CONTRACTOR_KEYWORDS = [
  'MEERA', 'KULDEEP', 'LAMBU', 'COM. HELPER', 'JIWAN', 'DAVINDER',
  'SUNNY', 'AMAR', 'BISLERI', 'CONT'
];

function isContractorDept(deptName) {
  if (!deptName) return false;
  const upper = deptName.toUpperCase();
  return CONTRACTOR_KEYWORDS.some(k => upper.includes(k));
}

function isPermanentDept(deptName) {
  if (!deptName) return false;
  return PERMANENT_DEPTS.some(p => p.toUpperCase() === deptName.toUpperCase());
}

/**
 * Compute organisation overview for a given month
 */
function computeOrgOverview(db, month, year) {
  // Get all processed records for this month
  const records = db.prepare(`
    SELECT ap.*, e.department, e.company, e.employment_type, e.contractor_group
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.month = ? AND ap.year = ?
    AND ap.is_night_out_only = 0
  `).all(month, year);

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

  // Department stats
  const deptStats = {};
  for (const r of records) {
    const dept = r.department || 'Unknown';
    if (!deptStats[dept]) deptStats[dept] = { employees: new Set(), present: 0, possible: 0, late: 0, ot: 0 };
    deptStats[dept].employees.add(r.employee_code);

    const dow = new Date(r.date + 'T12:00:00').getDay();
    if (dow !== 0) {
      deptStats[dept].possible++;
      const status = r.status_final || r.status_original || '';
      if (status === 'P' || status === 'WOP') deptStats[dept].present += 1;
      else if (status === '½P' || status === 'WO½P') deptStats[dept].present += 0.5;
    }

    if (r.is_late_arrival) deptStats[dept].late++;
    if (r.overtime_minutes) deptStats[dept].ot += r.overtime_minutes;
  }

  const departments = Object.entries(deptStats).map(([dept, stats]) => ({
    department: dept,
    headcount: stats.employees.size,
    attendanceRate: stats.possible > 0 ? Math.round((stats.present / stats.possible) * 1000) / 10 : 0,
    punctualityIssues: stats.late,
    overtimeHours: Math.round(stats.ot / 60),
    isContractor: isContractorDept(dept)
  })).sort((a, b) => b.headcount - a.headcount);

  // Salary outflow
  const salaryData = db.prepare(`
    SELECT SUM(net_salary) as total, SUM(gross_earned) as gross
    FROM salary_computations WHERE month = ? AND year = ?
  `).get(month, year);

  return {
    month, year,
    totalHeadcount,
    companyBreakdown: Object.entries(companyBreakdown).map(([company, emps]) => ({ company, count: emps.size })),
    permanentCount,
    contractorCount,
    attendanceRate,
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

  for (const { month, year } of months) {
    const result = db.prepare(`
      SELECT COUNT(DISTINCT employee_code) as count, company
      FROM attendance_processed
      WHERE month = ? AND year = ? AND is_night_out_only = 0
      GROUP BY company
    `).all(month, year);

    const total = db.prepare(`
      SELECT COUNT(DISTINCT employee_code) as count
      FROM attendance_processed
      WHERE month = ? AND year = ? AND is_night_out_only = 0
    `).get(month, year);

    trend.push({
      month, year,
      label: `${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month]} ${year}`,
      total: total?.count || 0,
      byCompany: result
    });
  }

  // Detect joins and exits
  for (let i = 1; i < trend.length; i++) {
    const prev = db.prepare(`
      SELECT DISTINCT employee_code FROM attendance_processed
      WHERE month = ? AND year = ? AND is_night_out_only = 0
    `).all(trend[i-1].month, trend[i-1].year).map(r => r.employee_code);

    const curr = db.prepare(`
      SELECT DISTINCT employee_code FROM attendance_processed
      WHERE month = ? AND year = ? AND is_night_out_only = 0
    `).all(trend[i].month, trend[i].year).map(r => r.employee_code);

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
function computeChronicAbsentees(db, month, year) {
  // Get attendance rates for all employees this month
  const records = db.prepare(`
    SELECT employee_code, status_final, status_original, date
    FROM attendance_processed
    WHERE month = ? AND year = ? AND is_night_out_only = 0
  `).all(month, year);

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
function computePunctualityReport(db, month, year) {
  const records = db.prepare(`
    SELECT ap.employee_code, ap.is_late_arrival, ap.late_by_minutes, ap.date,
           e.name, e.department, e.company
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.month = ? AND ap.year = ? AND ap.is_night_out_only = 0
    AND (ap.status_final IN ('P','WOP') OR ap.status_original IN ('P','WOP'))
  `).all(month, year);

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

module.exports = {
  computeOrgOverview,
  computeHeadcountTrend,
  computeAttrition,
  computeChronicAbsentees,
  computePunctualityReport,
  generateAlerts,
  isContractorDept,
  isPermanentDept
};

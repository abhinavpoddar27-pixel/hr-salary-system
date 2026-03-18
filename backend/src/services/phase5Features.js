/**
 * Phase 5 Features Service
 *
 * 1. Leave accrual (auto-accrue CL/EL after salary finalization)
 * 2. Compliance alerts (statutory deadline detection)
 * 3. Attrition risk scoring
 */

/**
 * 1. LEAVE ACCRUAL
 * CL: 1 per month (12 per year), credited at month start
 * EL: 1 per 20 working days (computed from attendance)
 * SL: No accrual — fixed annual entitlement
 */
function runLeaveAccrual(db, month, year) {
  const results = { accrued: 0, errors: [] };

  // Get active employees with attendance this month
  const employees = db.prepare(`
    SELECT DISTINCT ap.employee_code, e.id as emp_id
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.month = ? AND ap.year = ? AND ap.is_night_out_only = 0
    AND e.status = 'Active'
  `).all(month, year);

  const policyELRate = db.prepare("SELECT value FROM policy_config WHERE key = 'el_accrual_rate'").get();
  const elPer20Days = parseFloat(policyELRate?.value || '1');

  const upsertBalance = db.prepare(`
    INSERT INTO leave_balances (employee_id, year, leave_type, opening, accrued, used, balance)
    VALUES (?, ?, ?, 0, ?, 0, ?)
    ON CONFLICT(employee_id, year, leave_type) DO UPDATE SET
      accrued = accrued + excluded.accrued,
      balance = balance + excluded.accrued
  `);

  const txn = db.transaction(() => {
    for (const emp of employees) {
      try {
        // CL: 1 per month
        upsertBalance.run(emp.emp_id, year, 'CL', 1, 1);

        // EL: based on working days
        const dayCalc = db.prepare(`
          SELECT days_present FROM day_calculations
          WHERE employee_code = ? AND month = ? AND year = ?
        `).get(emp.employee_code, month, year);

        if (dayCalc && dayCalc.days_present >= 20) {
          const elDays = Math.floor(dayCalc.days_present / 20) * elPer20Days;
          if (elDays > 0) {
            upsertBalance.run(emp.emp_id, year, 'EL', elDays, elDays);
          }
        }

        results.accrued++;
      } catch (err) {
        results.errors.push({ code: emp.employee_code, error: err.message });
      }
    }
  });
  txn();

  return results;
}

/**
 * 2. COMPLIANCE ALERTS
 * Check for upcoming statutory deadlines and generate alerts
 */
function generateComplianceAlerts(db, month, year) {
  const alerts = [];
  const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // PF ECR due date: 15th of following month
  const pfDueMonth = month === 12 ? 1 : month + 1;
  const pfDueYear = month === 12 ? year + 1 : year;
  const pfDueDate = `${pfDueYear}-${String(pfDueMonth).padStart(2,'0')}-15`;
  const today = new Date().toISOString().slice(0, 10);
  const daysUntilPF = Math.ceil((new Date(pfDueDate) - new Date(today)) / 86400000);

  if (daysUntilPF <= 10 && daysUntilPF > 0) {
    alerts.push({
      type: 'COMPLIANCE', severity: 'High',
      title: `PF ECR Filing Due in ${daysUntilPF} days`,
      description: `PF ECR for ${MONTH_NAMES[month]} ${year} is due on ${pfDueDate}. Ensure all PF-applicable employees are covered.`
    });
  }

  // ESI contribution due date: 15th of following month
  if (daysUntilPF <= 10 && daysUntilPF > 0) {
    alerts.push({
      type: 'COMPLIANCE', severity: 'High',
      title: `ESI Contribution Due in ${daysUntilPF} days`,
      description: `ESI contribution for ${MONTH_NAMES[month]} ${year} is due on ${pfDueDate}.`
    });
  }

  // Gratuity eligibility: employees approaching 5 years
  const gratuityEmps = db.prepare(`
    SELECT code, name, department, date_of_joining,
      CAST((julianday('now') - julianday(date_of_joining)) / 365.25 AS REAL) as years_of_service
    FROM employees
    WHERE status = 'Active' AND date_of_joining IS NOT NULL AND date_of_joining != ''
    AND CAST((julianday('now') - julianday(date_of_joining)) / 365.25 AS REAL) BETWEEN 4.5 AND 5.0
  `).all();

  for (const emp of gratuityEmps) {
    alerts.push({
      type: 'COMPLIANCE', severity: 'Medium',
      title: `Gratuity Eligibility Approaching: ${emp.name}`,
      description: `${emp.name} (${emp.department}) has ${Math.round(emp.years_of_service * 10) / 10} years of service. Will become gratuity-eligible at 5 years.`,
      employee_code: emp.code
    });
  }

  // Bonus applicability: employees with >30 days service in the year
  const bonusMonth = 3; // March — annual bonus calculation period
  if (month === bonusMonth) {
    const bonusCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM employees
      WHERE status = 'Active' AND date_of_joining IS NOT NULL
      AND date_of_joining <= ? AND gross_salary <= 21000
    `).get(`${year}-${String(bonusMonth).padStart(2,'0')}-31`);

    if (bonusCount.cnt > 0) {
      alerts.push({
        type: 'COMPLIANCE', severity: 'Medium',
        title: `Bonus Calculation Due for ${bonusCount.cnt} Employees`,
        description: `${bonusCount.cnt} employees with gross <= 21,000 are eligible for statutory bonus calculation for FY ${year-1}-${year}.`
      });
    }
  }

  // Save to alerts table
  const insertAlert = db.prepare(`
    INSERT OR IGNORE INTO alerts (type, severity, employee_code, month, year, title, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const a of alerts) {
    insertAlert.run(a.type, a.severity, a.employee_code || null, month, year, a.title, a.description);
  }

  return alerts;
}

/**
 * 3. ATTRITION RISK SCORING
 * Score 0-100 based on behavioral patterns:
 * - Declining regularity (30%)
 * - Increasing absence (25%)
 * - Declining hours (20%)
 * - High late rate (15%)
 * - Tenure <6 months (10%)
 */
function computeAttritionRisk(db, month, year) {
  const employees = db.prepare(`
    SELECT DISTINCT ap.employee_code, e.name, e.department, e.company,
           e.date_of_joining, e.employment_type
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.month = ? AND ap.year = ? AND ap.is_night_out_only = 0
    AND e.status = 'Active'
  `).all(month, year);

  const results = [];

  // Previous 3 months for trend comparison
  const prevMonths = [];
  for (let i = 1; i <= 3; i++) {
    let m = month - i, y = year;
    while (m <= 0) { m += 12; y--; }
    prevMonths.push({ month: m, year: y });
  }

  for (const emp of employees) {
    let score = 0;
    const factors = [];

    // Current month stats
    const curr = db.prepare(`
      SELECT
        COUNT(CASE WHEN strftime('%w', date) != '0' THEN 1 END) as total_days,
        SUM(CASE WHEN (status_final IN ('P','WOP') OR status_original IN ('P','WOP')) THEN 1.0
                 WHEN (status_final IN ('½P','WO½P') OR status_original IN ('½P','WO½P')) THEN 0.5 ELSE 0 END) as present,
        SUM(CASE WHEN is_late_arrival = 1 THEN 1 ELSE 0 END) as late,
        AVG(CASE WHEN actual_hours > 0 THEN actual_hours END) as avg_hours
      FROM attendance_processed
      WHERE employee_code = ? AND month = ? AND year = ? AND is_night_out_only = 0
    `).get(emp.employee_code, month, year);

    if (!curr || curr.total_days < 5) continue;

    const currAttRate = curr.total_days > 0 ? curr.present / curr.total_days : 0;
    const currLateRate = curr.present > 0 ? curr.late / curr.present : 0;

    // Previous months average
    let prevAttSum = 0, prevLateSum = 0, prevHoursSum = 0, prevCount = 0;
    for (const pm of prevMonths) {
      const prev = db.prepare(`
        SELECT
          COUNT(CASE WHEN strftime('%w', date) != '0' THEN 1 END) as total_days,
          SUM(CASE WHEN (status_final IN ('P','WOP') OR status_original IN ('P','WOP')) THEN 1.0
                   WHEN (status_final IN ('½P','WO½P') OR status_original IN ('½P','WO½P')) THEN 0.5 ELSE 0 END) as present,
          SUM(CASE WHEN is_late_arrival = 1 THEN 1 ELSE 0 END) as late,
          AVG(CASE WHEN actual_hours > 0 THEN actual_hours END) as avg_hours
        FROM attendance_processed
        WHERE employee_code = ? AND month = ? AND year = ? AND is_night_out_only = 0
      `).get(emp.employee_code, pm.month, pm.year);
      if (prev && prev.total_days > 5) {
        prevAttSum += (prev.present / prev.total_days);
        prevLateSum += (prev.present > 0 ? prev.late / prev.present : 0);
        prevHoursSum += (prev.avg_hours || 0);
        prevCount++;
      }
    }

    // Factor 1: Declining attendance (25%)
    if (prevCount >= 2) {
      const prevAvgAtt = prevAttSum / prevCount;
      const attDecline = prevAvgAtt - currAttRate;
      if (attDecline > 0.15) { score += 25; factors.push('Attendance dropped significantly'); }
      else if (attDecline > 0.05) { score += 15; factors.push('Attendance declining'); }
    }

    // Factor 2: Low current attendance (25% absolute)
    if (currAttRate < 0.50) { score += 25; factors.push('Very low attendance (<50%)'); }
    else if (currAttRate < 0.70) { score += 15; factors.push('Below average attendance'); }

    // Factor 3: Declining hours (20%)
    if (prevCount >= 2 && curr.avg_hours) {
      const prevAvgHrs = prevHoursSum / prevCount;
      if (prevAvgHrs > 0 && curr.avg_hours < prevAvgHrs * 0.85) {
        score += 20; factors.push('Working hours declining');
      }
    }

    // Factor 4: High late rate (15%)
    if (currLateRate > 0.50) { score += 15; factors.push('Frequently late (>50%)'); }
    else if (currLateRate > 0.30) { score += 8; factors.push('Often late'); }

    // Factor 5: Short tenure (10%)
    if (emp.date_of_joining) {
      const tenureMonths = (new Date() - new Date(emp.date_of_joining)) / (1000 * 60 * 60 * 24 * 30);
      if (tenureMonths < 6) { score += 10; factors.push('Short tenure (<6 months)'); }
      else if (tenureMonths < 12) { score += 5; factors.push('Relatively new (<12 months)'); }
    }

    score = Math.min(100, score);

    if (score >= 30) {
      results.push({
        code: emp.employee_code,
        name: emp.name,
        department: emp.department,
        company: emp.company,
        employmentType: emp.employment_type,
        riskScore: score,
        riskLevel: score >= 70 ? 'High' : score >= 50 ? 'Medium' : 'Low',
        factors,
        attendanceRate: Math.round(currAttRate * 100),
        lateRate: Math.round(currLateRate * 100),
        avgHours: curr.avg_hours ? Math.round(curr.avg_hours * 10) / 10 : null
      });
    }
  }

  return results.sort((a, b) => b.riskScore - a.riskScore);
}

module.exports = { runLeaveAccrual, generateComplianceAlerts, computeAttritionRisk };

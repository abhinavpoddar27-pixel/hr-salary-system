/**
 * Export Format Generators
 * Generates government-format files for PF ECR, ESI, and Bank salary uploads
 */

const MONTHS_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Generate PF ECR (Electronic Challan cum Return) text file
 * EPFO format: pipe-delimited, one row per employee
 * Columns: UAN | Member Name | Gross Wages | EPF Wages | EPS Wages | EDLI Wages |
 *          EPF Contribution (EE 12%) | EPS Contribution (8.33%) | EPF Diff (ER 3.67%) | NCP Days | Refund
 */
function generatePFECR(db, month, year, company) {
  const employees = db.prepare(`
    SELECT sc.employee_code, e.name as employee_name, e.uan, e.pf_number,
           sc.gross_earned, sc.pf_wages, sc.pf_employee, sc.pf_employer, sc.eps,
           sc.payable_days,
           dc.total_calendar_days, dc.total_sundays, dc.total_holidays
    FROM salary_computations sc
    LEFT JOIN employees e ON sc.employee_code = e.code
    LEFT JOIN day_calculations dc ON sc.employee_code = dc.employee_code AND sc.month = dc.month AND sc.year = dc.year
    WHERE sc.month = ? AND sc.year = ?
    ${company ? 'AND sc.company = ?' : ''}
    AND (COALESCE(sc.pf_employee, 0) + COALESCE(sc.pf_employer, 0)) > 0
    ORDER BY e.name
  `).all(...[month, year, company].filter(Boolean));

  const lines = [];
  for (const emp of employees) {
    const uan = (emp.uan || '').replace(/\s/g, '');
    const name = (emp.employee_name || '').toUpperCase().replace(/\|/g, ' ');
    const grossWages = Math.round(emp.gross_earned || 0);
    const epfWages = Math.round(emp.pf_wages || 0);
    const epsWages = Math.round(emp.pf_wages || 0);
    const edliWages = Math.round(emp.pf_wages || 0);
    const eePF = Math.round(emp.pf_employee || 0);
    const eps = Math.round(emp.eps || 0);
    const erPFDiff = Math.round((emp.pf_employer || 0) - (emp.eps || 0));
    // NCP days = calendar days - payable days (excluding sundays/holidays that are non-working)
    // Leave Management Phase 3 (April 2026): payable_days already reflects EL / OD
    // leave restorations from Stage 6 (EL decrements absences; OD credits present
    // on absent working days). Therefore NCP is computed directly from payable_days
    // with no separate leave adjustment here — the leave post-processing in
    // dayCalculation.js is the single source of truth. CL / SL / LWP do NOT
    // increase payable_days (absence stays absent, just reclassified), so NCP
    // correctly stays high for unpaid-leave employees — matching PF rules.
    const calendarDays = emp.total_calendar_days || 30;
    const ncpDays = Math.max(0, Math.round(calendarDays - (emp.total_sundays || 0) - (emp.total_holidays || 0) - (emp.payable_days || 0)));
    const refund = 0;

    lines.push([uan, name, grossWages, epfWages, epsWages, edliWages, eePF, eps, erPFDiff, ncpDays, refund].join('|'));
  }

  const totals = {
    count: employees.length,
    totalEPFWages: employees.reduce((s, e) => s + Math.round(e.pf_wages || 0), 0),
    totalEEPF: employees.reduce((s, e) => s + Math.round(e.pf_employee || 0), 0),
    totalEPS: employees.reduce((s, e) => s + Math.round(e.eps || 0), 0),
    totalERPF: employees.reduce((s, e) => s + Math.round((e.pf_employer || 0) - (e.eps || 0)), 0),
  };

  return { content: lines.join('\n'), employees, totals, filename: `ECR_${MONTHS_SHORT[month]}_${year}.txt` };
}

/**
 * Generate ESI Contribution File
 * ESIC portal format: pipe-delimited text
 * Columns: IP Number | IP Name | No of Days | Total Wages | IP Contribution | Reason Code
 */
function generateESIFile(db, month, year, company) {
  const employees = db.prepare(`
    SELECT sc.employee_code, e.name as employee_name, e.esi_number,
           sc.esi_wages, sc.esi_employee, sc.esi_employer, sc.payable_days,
           dc.total_calendar_days, dc.total_sundays, dc.total_holidays,
           e.date_of_joining
    FROM salary_computations sc
    LEFT JOIN employees e ON sc.employee_code = e.code
    LEFT JOIN day_calculations dc ON sc.employee_code = dc.employee_code AND sc.month = dc.month AND sc.year = dc.year
    WHERE sc.month = ? AND sc.year = ?
    ${company ? 'AND sc.company = ?' : ''}
    AND (COALESCE(sc.esi_employee, 0) + COALESCE(sc.esi_employer, 0)) > 0
    ORDER BY e.name
  `).all(...[month, year, company].filter(Boolean));

  const lines = [];
  for (const emp of employees) {
    const ipNumber = (emp.esi_number || '').replace(/\s/g, '');
    const name = (emp.employee_name || '').toUpperCase().replace(/\|/g, ' ');
    const calDays = emp.total_calendar_days || 30;
    const noDays = Math.round(emp.payable_days || 0);
    const totalWages = Math.round(emp.esi_wages || 0);
    const ipContribution = Math.round(emp.esi_employee || 0);

    // Reason code: 0 = normal, 1 = new joiner
    let reasonCode = 0;
    if (emp.date_of_joining) {
      const doj = new Date(emp.date_of_joining);
      const monthStart = new Date(year, month - 1, 1);
      const monthEnd = new Date(year, month, 0);
      if (doj >= monthStart && doj <= monthEnd) reasonCode = 1;
    }

    lines.push([ipNumber, name, noDays, totalWages, ipContribution, reasonCode].join('|'));
  }

  const totals = {
    count: employees.length,
    totalWages: employees.reduce((s, e) => s + Math.round(e.esi_wages || 0), 0),
    totalEEESI: employees.reduce((s, e) => s + Math.round(e.esi_employee || 0), 0),
    totalERESI: employees.reduce((s, e) => s + Math.round(e.esi_employer || 0), 0),
  };

  return { content: lines.join('\n'), employees, totals, filename: `ESI_${MONTHS_SHORT[month]}_${year}.txt` };
}

/**
 * Generate Bank Salary Upload File (PNB/Generic Format)
 * CSV: Sr No, Beneficiary Name, Account Number, IFSC Code, Amount, Narration
 */
function generateBankFile(db, month, year, company) {
  const employees = db.prepare(`
    SELECT sc.employee_code, e.name as employee_name,
           COALESCE(e.account_number, e.bank_account) as account_number,
           COALESCE(e.ifsc_code, e.ifsc) as ifsc_code,
           e.bank_name, e.department, e.date_of_joining,
           sc.net_salary
    FROM salary_computations sc
    LEFT JOIN employees e ON sc.employee_code = e.code
    WHERE sc.month = ? AND sc.year = ?
    ${company ? 'AND sc.company = ?' : ''}
    AND sc.net_salary > 0
    AND sc.salary_held = 0
    ORDER BY e.department, e.name
  `).all(...[month, year, company].filter(Boolean));

  const narration = `SALARY ${MONTHS_SHORT[month].toUpperCase()} ${year}`;

  // Build CSV with header (Date of Joining included for HR audit, April 2026)
  const csvLines = ['Sr No,Beneficiary Name,Account Number,IFSC Code,Date of Joining,Amount,Narration'];
  const missing = [];

  const fmtDOJ = (iso) => {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };

  let sr = 0;
  for (const emp of employees) {
    if (!emp.account_number || !emp.ifsc_code) {
      missing.push({
        employee_code: emp.employee_code,
        employee_name: emp.employee_name,
        department: emp.department,
        date_of_joining: emp.date_of_joining,
        net_salary: emp.net_salary,
        missing_account: !emp.account_number,
        missing_ifsc: !emp.ifsc_code,
      });
      continue;
    }

    sr++;
    const name = (emp.employee_name || '').replace(/,/g, ' ').replace(/"/g, '');
    const amount = Math.round(emp.net_salary * 100) / 100;
    const doj = fmtDOJ(emp.date_of_joining);
    csvLines.push(`${sr},"${name}",${emp.account_number},${emp.ifsc_code},${doj},${amount},"${narration}"`);
  }

  const validEmployees = employees.filter(e => e.account_number && e.ifsc_code);
  const totalAmount = validEmployees.reduce((s, e) => s + (e.net_salary || 0), 0);

  return {
    content: csvLines.join('\n'),
    employees: validEmployees,
    missing,
    totals: {
      count: validEmployees.length,
      totalAmount: Math.round(totalAmount * 100) / 100,
      missingCount: missing.length,
    },
    filename: `Bank_Salary_${MONTHS_SHORT[month]}_${year}${company ? '_' + company.replace(/\s/g, '_') : ''}.csv`
  };
}

module.exports = { generatePFECR, generateESIFile, generateBankFile };

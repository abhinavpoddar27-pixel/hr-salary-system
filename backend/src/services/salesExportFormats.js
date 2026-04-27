/**
 * Sales Export Format Generators — Phase 4
 *
 * Parallel to plant's backend/src/services/exportFormats.js. Sales-specific
 * exports keep their own filename prefix (`Sales_`), their own filter rules
 * (status != 'hold' instead of salary_held = 0), and pull HQ/State/Manager/
 * Designation + Phase 3 structure/earned/deduction columns.
 *
 * No new dependencies — uses the existing `xlsx` (SheetJS) community build.
 * Rich cell styling (bold headers, fill colors, percentage format) is NOT
 * reliably rendered by community SheetJS, so the Excel writer ships with
 * column widths + frozen header row + plain numeric cells; HR can apply
 * formatting in Excel afterwards if desired.
 *
 * NEFT CSV header matches plant `generateBankFile` exactly so Sales and
 * Plant NEFT files interoperate with the same bank upload pipeline.
 */

const XLSX = require('xlsx');

const MONTHS_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDOJ(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function underscoreCompany(company) {
  return company ? company.replace(/\s+/g, '_') : '';
}

// Pull one row per computation joined with its employee master fields.
function loadRows(db, month, year, company) {
  return db.prepare(`
    SELECT c.*,
           e.name, e.state, e.headquarters, e.city_of_operation,
           e.reporting_manager, e.designation, e.doj,
           e.bank_name, e.account_no, e.ifsc
      FROM sales_salary_computations c
 LEFT JOIN sales_employees e
        ON e.code = c.employee_code AND e.company = c.company
     WHERE c.month = ? AND c.year = ? AND c.company = ?
  ORDER BY e.name ASC, c.employee_code ASC
  `).all(month, year, company);
}

// ══════════════════════════════════════════════════════════════════════
// generateSalesExcel — Salary Register XLSX
// ══════════════════════════════════════════════════════════════════════
function generateSalesExcel(db, month, year, company) {
  const rows = loadRows(db, month, year, company);

  const header = [
    'Code', 'Name', 'HQ', 'State', 'Reporting Manager', 'Designation',
    'Days Given', 'Paid Sundays', 'Gazetted Holidays', 'Earned Leave',
    'Total Days', 'Calendar Days', 'Earned Ratio',
    'Basic (Monthly)', 'HRA (Monthly)', 'CCA (Monthly)', 'Conveyance (Monthly)', 'Gross (Monthly)',
    'Basic (Earned)', 'HRA (Earned)', 'CCA (Earned)', 'Conveyance (Earned)', 'Gross (Earned)',
    'PF Employee', 'ESI Employee', 'PT', 'TDS', 'Advance Recovery', 'Loan Recovery',
    'Other Deductions', 'Total Deductions',
    'Diwali Bonus', 'Incentive', 'Net Salary',
    'Status', 'Bank Name', 'Account Number', 'IFSC',
  ];

  const round2 = (n) => Math.round((n || 0) * 100) / 100;

  const data = [header];
  const totals = {
    gross_earned: 0, total_deductions: 0, net_salary: 0,
    incentive_amount: 0, diwali_bonus: 0,
  };

  for (const r of rows) {
    data.push([
      r.employee_code,
      r.name || '',
      r.headquarters || '',
      r.state || '',
      r.reporting_manager || '',
      r.designation || '',
      round2(r.days_given),
      round2(r.sundays_paid),
      round2(r.gazetted_holidays_paid),
      round2(r.earned_leave_days),
      round2(r.total_days),
      r.calendar_days,
      Math.round((r.earned_ratio || 0) * 10000) / 10000,
      round2(r.basic_monthly),
      round2(r.hra_monthly),
      round2(r.cca_monthly),
      round2(r.conveyance_monthly),
      round2(r.gross_monthly),
      round2(r.basic_earned),
      round2(r.hra_earned),
      round2(r.cca_earned),
      round2(r.conveyance_earned),
      round2(r.gross_earned),
      round2(r.pf_employee),
      round2(r.esi_employee),
      round2(r.professional_tax),
      round2(r.tds),
      round2(r.advance_recovery),
      round2(r.loan_recovery),
      round2(r.other_deductions),
      round2(r.total_deductions),
      round2(r.diwali_bonus),
      round2(r.incentive_amount),
      round2(r.net_salary),
      r.status || '',
      r.bank_name || '',
      r.account_no || '',
      r.ifsc || '',
    ]);

    totals.gross_earned += r.gross_earned || 0;
    totals.total_deductions += r.total_deductions || 0;
    totals.net_salary += r.net_salary || 0;
    totals.incentive_amount += r.incentive_amount || 0;
    totals.diwali_bonus += r.diwali_bonus || 0;
  }

  Object.keys(totals).forEach(k => { totals[k] = round2(totals[k]); });

  const sheet = XLSX.utils.aoa_to_sheet(data);

  // Frozen header row (community SheetJS supports this via !freeze).
  sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  sheet['!views'] = [{ state: 'frozen', ySplit: 1 }];

  // Column widths tuned to the register layout.
  sheet['!cols'] = [
    { wch: 10 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 16 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
    { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
    { wch: 14 }, { wch: 14 },
    { wch: 12 }, { wch: 10 }, { wch: 12 },
    { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 12 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Sales Salary Register');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return {
    content: buf,
    filename: `Sales_Salary_Register_${MONTHS_SHORT[month]}_${year}_${underscoreCompany(company)}.xlsx`,
    employees: rows,
    totals,
    count: rows.length,
  };
}

// ══════════════════════════════════════════════════════════════════════
// generateSalesNEFT — Bank Salary Upload CSV
// Mirrors plant `generateBankFile` header exactly so the bank's upload
// pipeline accepts both files interchangeably.
// ══════════════════════════════════════════════════════════════════════
function generateSalesNEFT(db, month, year, company) {
  const rows = db.prepare(`
    SELECT c.employee_code, c.net_salary, c.status, c.id AS computation_id,
           e.name, e.account_no, e.ifsc, e.bank_name, e.doj
      FROM sales_salary_computations c
 LEFT JOIN sales_employees e
        ON e.code = c.employee_code AND e.company = c.company
     WHERE c.month = ? AND c.year = ? AND c.company = ?
       AND c.net_salary > 0
       AND c.status != 'hold'
  ORDER BY e.name ASC, c.employee_code ASC
  `).all(month, year, company);

  const narration = `SALARY ${MONTHS_SHORT[month].toUpperCase()} ${year}`;

  const csvLines = ['Sr No,Beneficiary Name,Account Number,IFSC Code,Date of Joining,Amount,Narration'];
  const missing = [];
  const eligibleIds = [];

  let sr = 0;
  for (const r of rows) {
    if (!r.account_no || !r.ifsc) {
      missing.push({
        employee_code: r.employee_code,
        employee_name: r.name || '',
        net_salary: r.net_salary,
        missing_account: !r.account_no,
        missing_ifsc: !r.ifsc,
      });
      continue;
    }

    sr++;
    const name = (r.name || '').replace(/,/g, ' ').replace(/"/g, '');
    const amount = Math.round((r.net_salary || 0) * 100) / 100;
    const doj = fmtDOJ(r.doj);
    csvLines.push(`${sr},"${name}",${r.account_no},${r.ifsc},${doj},${amount},"${narration}"`);
    eligibleIds.push(r.computation_id);
  }

  const validEmployees = rows.filter(r => r.account_no && r.ifsc);
  const totalAmount = validEmployees.reduce((s, r) => s + (r.net_salary || 0), 0);

  return {
    content: csvLines.join('\n'),
    filename: `Sales_Bank_Salary_${MONTHS_SHORT[month]}_${year}_${underscoreCompany(company)}.csv`,
    employees: validEmployees,
    missing,
    eligibleIds,  // consumed by the route to stamp neft_exported_at in the same txn
    totals: {
      count: validEmployees.length,
      totalAmount: Math.round(totalAmount * 100) / 100,
      missingCount: missing.length,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════
// generateSalesTaDaExcel — TA/DA Payable Register XLSX
// 20 columns. Same SheetJS-community treatment as generateSalesExcel
// (frozen header + column widths; no cell-level styling).
// ══════════════════════════════════════════════════════════════════════
function generateSalesTaDaExcel(db, month, year, company, statusFilter) {
  const where = ['c.month = ?', 'c.year = ?', 'c.company = ?'];
  const params = [month, year, company];
  if (statusFilter) {
    where.push('c.status = ?');
    params.push(statusFilter);
  }

  const rows = db.prepare(`
    SELECT c.*,
           e.name, e.headquarters, e.city_of_operation, e.designation,
           e.reporting_manager
      FROM sales_ta_da_computations c
 LEFT JOIN sales_employees e
        ON e.id = c.employee_id
     WHERE ${where.join(' AND ')}
  ORDER BY e.code ASC, c.employee_code ASC
  `).all(...params);

  const header = [
    'Code', 'Name', 'HQ', 'City of Operation', 'Designation', 'Reporting Manager',
    'Class', 'Status', 'Days Worked',
    'In-City Days', 'Outstation Days',
    'Total KM', 'Bike KM', 'Car KM',
    'DA Local', 'DA Outstation', 'Total DA',
    'TA Primary', 'TA Secondary', 'Total TA',
    'Total Payable',
  ];

  const round2 = (n) => Math.round((n || 0) * 100) / 100;
  const data = [header];

  for (const r of rows) {
    data.push([
      r.employee_code,
      r.name || '',
      r.headquarters || '',
      r.city_of_operation || '',
      r.designation || '',
      r.reporting_manager || '',
      r.ta_da_class_at_compute,
      r.status || '',
      r.days_worked_at_compute || 0,
      r.in_city_days_at_compute,
      r.outstation_days_at_compute,
      r.total_km_at_compute,
      r.bike_km_at_compute,
      r.car_km_at_compute,
      round2(r.da_local_amount),
      round2(r.da_outstation_amount),
      round2(r.total_da),
      round2(r.ta_primary_amount),
      round2(r.ta_secondary_amount),
      round2(r.total_ta),
      round2(r.total_payable),
    ]);
  }

  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  sheet['!views'] = [{ state: 'frozen', ySplit: 1 }];
  sheet['!cols'] = [
    { wch: 10 }, { wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 18 },
    { wch: 7 }, { wch: 14 }, { wch: 12 },
    { wch: 12 }, { wch: 14 },
    { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 12 }, { wch: 14 }, { wch: 12 },
    { wch: 12 }, { wch: 14 }, { wch: 12 },
    { wch: 14 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'TA-DA Payable');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return {
    content: buf,
    filename: `Sales_TADA_Payable_${MONTHS_SHORT[month]}_${year}_${underscoreCompany(company)}.xlsx`,
    rows,
    count: rows.length,
  };
}

// ══════════════════════════════════════════════════════════════════════
// generateSalesTaDaNEFT — TA/DA Bank Upload CSV
// Header is byte-identical to plant generateBankFile so the bank's upload
// pipeline accepts both salary and TA/DA files interchangeably.
// `mode` controls which statuses are eligible:
//   'computed_only' → status='computed'
//   'all'           → status IN ('computed','partial')
// ══════════════════════════════════════════════════════════════════════
function generateSalesTaDaNEFT(db, month, year, company, mode) {
  const allowedStatuses = mode === 'all'
    ? ['computed', 'partial']
    : ['computed'];

  const placeholders = allowedStatuses.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT c.id AS computation_id, c.employee_code, c.total_payable, c.status,
           e.name, e.account_no, e.ifsc, e.bank_name, e.doj
      FROM sales_ta_da_computations c
 LEFT JOIN sales_employees e
        ON e.id = c.employee_id
     WHERE c.month = ? AND c.year = ? AND c.company = ?
       AND c.total_payable > 0
       AND c.status IN (${placeholders})
  ORDER BY e.name ASC, c.employee_code ASC
  `).all(month, year, company, ...allowedStatuses);

  const narration = `TADA ${MONTHS_SHORT[month].toUpperCase()} ${year}`;
  const csvLines = ['Sr No,Beneficiary Name,Account Number,IFSC Code,Date of Joining,Amount,Narration'];
  const missing = [];
  const eligibleIds = [];

  let sr = 0;
  for (const r of rows) {
    if (!r.bank_name || !r.account_no || !r.ifsc) {
      missing.push({
        employee_code: r.employee_code,
        employee_name: r.name || '',
        total_payable: r.total_payable,
        missing_bank_name: !r.bank_name,
        missing_account: !r.account_no,
        missing_ifsc: !r.ifsc,
      });
      continue;
    }

    sr++;
    const name = (r.name || '').replace(/[,"]/g, ' ');
    const amount = Math.round((r.total_payable || 0) * 100) / 100;
    const doj = fmtDOJ(r.doj);
    csvLines.push(`${sr},"${name}",${r.account_no},${r.ifsc},${doj},${amount},"${narration}"`);
    eligibleIds.push(r.computation_id);
  }

  const validRows = rows.filter(r => r.bank_name && r.account_no && r.ifsc);
  const totalAmount = validRows.reduce((s, r) => s + (r.total_payable || 0), 0);

  return {
    content: csvLines.join('\n'),
    filename: `Sales_TADA_NEFT_${MONTHS_SHORT[month]}_${year}_${underscoreCompany(company)}.csv`,
    rows: validRows,
    missing,
    eligibleIds,
    totals: {
      count: validRows.length,
      totalAmount: Math.round(totalAmount * 100) / 100,
      missingCount: missing.length,
    },
  };
}

module.exports = {
  generateSalesExcel,
  generateSalesNEFT,
  generateSalesTaDaExcel,
  generateSalesTaDaNEFT,
};

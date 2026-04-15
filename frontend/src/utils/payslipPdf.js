/**
 * Salary Slip Register PDF — matches the Excel format from ASIAN LAKTO / INDRIYAN
 * Tabular register with contractor group sections, subtotals, and grand total
 */

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function fmt(v) { return Math.round(v || 0).toLocaleString('en-IN') }

const cellStyle = 'padding:3px 4px;border:1px solid #999;font-size:9px;';
const numStyle = cellStyle + 'text-align:right;font-family:monospace;';
const hdrStyle = 'padding:4px 5px;border:1px solid #666;font-size:8px;font-weight:bold;background:#d9e2f3;text-align:center;';

/**
 * Generate the salary register HTML matching the Excel format
 * @param {Array} payslips - array from GET /payroll/payslips/bulk
 * @param {Object} companyConfig - company_config record
 * @param {number} month
 * @param {number} year
 */
function generateSalaryRegisterHTML(payslips, companyConfig, month, year) {
  const companyName = companyConfig?.company_name || 'Company';
  const monthName = MONTHS[month] || month;

  // Group employees by contractor_group or department category
  // Permanent employees first (no contractor group), then each contractor group
  const groups = {};
  const permanentKey = '__PERMANENT__';
  groups[permanentKey] = { label: 'PERMANENT STAFF', employees: [] };

  for (const ps of payslips) {
    const emp = ps.employee;
    const att = ps.attendance || {};
    const otPay = ps.otPay || ps.earnings?.find(e => e.label === 'OT Pay')?.amount || 0;
    const edPay = ps.edPay || ps.earnings?.find(e => e.label === 'Extra Duty Pay')?.amount || 0;
    const takeHome = ps.takeHome || ((ps.totalPayable || ps.netSalary || 0) + edPay);
    const row = {
      code: emp.code,
      name: emp.name || emp.code,
      designation: emp.designation || emp.department || '',
      grossSalary: ps.grossSalary || ps.grossEarned || 0,
      basic: ps.earnings?.find(e => e.label?.includes('Basic'))?.amount || 0,
      hra: ps.earnings?.find(e => e.label?.includes('HRA'))?.amount || 0,
      cca: 0,
      conv: ps.earnings?.find(e => e.label?.includes('Conveyance'))?.amount || 0,
      totalEarned: ps.grossEarned || 0,
      otPay,
      edPay,
      advance: ps.deductions?.find(d => d.label?.includes('Advance'))?.amount || 0,
      pf: ps.deductions?.find(d => d.label?.includes('PF') && !d.label?.includes('Employer'))?.amount || 0,
      esi: ps.deductions?.find(d => d.label?.includes('ESI') && !d.label?.includes('Employer'))?.amount || 0,
      wlf: 0,
      tds: ps.deductions?.find(d => d.label?.includes('TDS'))?.amount || 0,
      pt: ps.deductions?.find(d => d.label?.includes('Professional'))?.amount || 0,
      lateDed: ps.deductions?.find(d => d.label?.includes('LOP') || d.label?.includes('Late'))?.amount || 0,
      days: att.days_present || 0,
      el: att.el_used || 0,
      sundays: att.paid_sundays || 0,
      totalDays: att.total_payable_days || 0,
      payable: ps.grossEarned || 0,
      netPayable: ps.netSalary || 0,
      takeHome,
      department: emp.department || '',
    };

    // Determine group — use the authoritative is_contractor flag from the
    // salary computation data (set by isContractorForPayroll on the backend,
    // which honours employment_type). Fall back to dept heuristic ONLY for
    // payslips generated from legacy data that predates the flag.
    const scIsContractor = ps.is_contractor === 1 || ps.is_contractor === true;
    const dept = (emp.department || '').toUpperCase();
    const isContractor = scIsContractor || (
      ps.is_contractor === undefined && (
        dept.includes('CONT') || dept.includes('LAMBU') || dept.includes('MEERA') ||
        dept.includes('KULDEEP') || dept.includes('JIWAN') || dept.includes('SUNNY') || dept.includes('AMAR')
      )
    );

    if (isContractor) {
      const groupKey = emp.department || 'CONTRACTOR';
      if (!groups[groupKey]) groups[groupKey] = { label: groupKey, employees: [] };
      groups[groupKey].employees.push(row);
    } else {
      groups[permanentKey].employees.push(row);
    }
  }

  // Build HTML
  let html = `<div style="font-family:Arial,sans-serif;padding:10px;">
    <h2 style="text-align:center;margin:0;font-size:14px;">${companyName.toUpperCase()}</h2>
    <p style="text-align:center;margin:2px 0 10px;font-size:12px;font-weight:bold;">SALARY SLIP ${monthName.toUpperCase()} ${year}</p>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="${hdrStyle}width:30px;">S.No</th>
          <th style="${hdrStyle}width:40px;">EMP</th>
          <th style="${hdrStyle}text-align:left;min-width:100px;">Name</th>
          <th style="${hdrStyle}text-align:left;min-width:70px;">Desig.</th>
          <th style="${hdrStyle}">Gross</th>
          <th style="${hdrStyle}">Basic</th>
          <th style="${hdrStyle}">Total Earned</th>
          <th style="${hdrStyle}">OT Pay</th>
          <th style="${hdrStyle}">ED Pay</th>
          <th style="${hdrStyle}">Advance</th>
          <th style="${hdrStyle}">PF</th>
          <th style="${hdrStyle}">ESI</th>
          <th style="${hdrStyle}">Days</th>
          <th style="${hdrStyle}">Sun</th>
          <th style="${hdrStyle}">Tot Days</th>
          <th style="${hdrStyle}">Payable</th>
          <th style="${hdrStyle}">Late Ded</th>
          <th style="${hdrStyle}font-weight:bold;">Net Pay</th>
          <th style="${hdrStyle}font-weight:bold;background:#cdebd6;">Take Home</th>
          <th style="${hdrStyle}width:50px;">Sign</th>
        </tr>
      </thead>
      <tbody>`;

  let grandTotals = { gross: 0, basic: 0, totalEarned: 0, otPay: 0, edPay: 0, advance: 0, pf: 0, esi: 0, days: 0, sundays: 0, totalDays: 0, payable: 0, lateDed: 0, netPayable: 0, takeHome: 0 };

  for (const [key, group] of Object.entries(groups)) {
    if (group.employees.length === 0) continue;

    // Group header
    if (key !== permanentKey) {
      html += `<tr><td colspan="19" style="padding:6px 5px;border:1px solid #999;font-weight:bold;background:#f0e6d2;font-size:10px;">${group.label}</td></tr>`;
    }

    let groupTotals = { gross: 0, basic: 0, totalEarned: 0, otPay: 0, edPay: 0, advance: 0, pf: 0, esi: 0, days: 0, sundays: 0, totalDays: 0, payable: 0, lateDed: 0, netPayable: 0, takeHome: 0 };

    group.employees.forEach((r, i) => {
      groupTotals.gross += r.grossSalary;
      groupTotals.basic += r.basic;
      groupTotals.totalEarned += r.totalEarned;
      groupTotals.otPay += r.otPay;
      groupTotals.edPay += r.edPay;
      groupTotals.advance += r.advance;
      groupTotals.pf += r.pf;
      groupTotals.esi += r.esi;
      groupTotals.days += r.days;
      groupTotals.sundays += r.sundays;
      groupTotals.totalDays += r.totalDays;
      groupTotals.payable += r.payable;
      groupTotals.lateDed += r.lateDed;
      groupTotals.netPayable += r.netPayable;
      groupTotals.takeHome += r.takeHome;

      html += `<tr>
        <td style="${cellStyle}text-align:center;">${i + 1}</td>
        <td style="${cellStyle}text-align:center;font-size:8px;">${r.code}</td>
        <td style="${cellStyle}font-weight:500;">${r.name}</td>
        <td style="${cellStyle}font-size:8px;">${r.designation}</td>
        <td style="${numStyle}">${fmt(r.grossSalary)}</td>
        <td style="${numStyle}">${fmt(r.basic)}</td>
        <td style="${numStyle}">${fmt(r.totalEarned)}</td>
        <td style="${numStyle}">${r.otPay ? fmt(r.otPay) : ''}</td>
        <td style="${numStyle}">${r.edPay ? fmt(r.edPay) : ''}</td>
        <td style="${numStyle}">${r.advance ? fmt(r.advance) : ''}</td>
        <td style="${numStyle}">${r.pf ? fmt(r.pf) : ''}</td>
        <td style="${numStyle}">${r.esi ? fmt(r.esi) : ''}</td>
        <td style="${numStyle}">${r.days}</td>
        <td style="${numStyle}">${r.sundays || ''}</td>
        <td style="${numStyle}">${r.totalDays}</td>
        <td style="${numStyle}font-weight:bold;">${fmt(r.payable)}</td>
        <td style="${numStyle}">${r.lateDed ? fmt(r.lateDed) : ''}</td>
        <td style="${numStyle}font-weight:bold;">${fmt(r.netPayable)}</td>
        <td style="${numStyle}font-weight:bold;background:#eaf6ec;">${fmt(r.takeHome)}</td>
        <td style="${cellStyle}"></td>
      </tr>`;
    });

    // Group total row
    html += `<tr style="background:#e8e8e8;font-weight:bold;">
      <td colspan="3" style="${cellStyle}text-align:right;font-weight:bold;">TOTAL</td>
      <td style="${cellStyle}"></td>
      <td style="${numStyle}font-weight:bold;">${fmt(groupTotals.gross)}</td>
      <td style="${numStyle}font-weight:bold;">${fmt(groupTotals.basic)}</td>
      <td style="${numStyle}font-weight:bold;">${fmt(groupTotals.totalEarned)}</td>
      <td style="${numStyle}font-weight:bold;">${fmt(groupTotals.otPay)}</td>
      <td style="${numStyle}font-weight:bold;">${fmt(groupTotals.edPay)}</td>
      <td style="${numStyle}font-weight:bold;">${fmt(groupTotals.advance)}</td>
      <td style="${numStyle}font-weight:bold;">${fmt(groupTotals.pf)}</td>
      <td style="${numStyle}font-weight:bold;">${fmt(groupTotals.esi)}</td>
      <td style="${numStyle}font-weight:bold;">${groupTotals.days}</td>
      <td style="${numStyle}font-weight:bold;">${groupTotals.sundays || ''}</td>
      <td style="${numStyle}font-weight:bold;">${groupTotals.totalDays}</td>
      <td style="${numStyle}font-weight:bold;">${fmt(groupTotals.payable)}</td>
      <td style="${numStyle}font-weight:bold;">${fmt(groupTotals.lateDed)}</td>
      <td style="${numStyle}font-weight:bold;">${fmt(groupTotals.netPayable)}</td>
      <td style="${numStyle}font-weight:bold;background:#cdebd6;">${fmt(groupTotals.takeHome)}</td>
      <td style="${cellStyle}"></td>
    </tr>`;

    // Accumulate grand totals
    for (const k of Object.keys(grandTotals)) grandTotals[k] += groupTotals[k];
  }

  // Grand total row
  html += `<tr style="background:#d9e2f3;font-weight:bold;">
    <td colspan="3" style="${cellStyle}text-align:right;font-weight:bold;font-size:10px;">GRAND TOTAL</td>
    <td style="${cellStyle}"></td>
    <td style="${numStyle}font-weight:bold;">${fmt(grandTotals.gross)}</td>
    <td style="${numStyle}font-weight:bold;">${fmt(grandTotals.basic)}</td>
    <td style="${numStyle}font-weight:bold;">${fmt(grandTotals.totalEarned)}</td>
    <td style="${numStyle}font-weight:bold;">${fmt(grandTotals.otPay)}</td>
    <td style="${numStyle}font-weight:bold;">${fmt(grandTotals.edPay)}</td>
    <td style="${numStyle}font-weight:bold;">${fmt(grandTotals.advance)}</td>
    <td style="${numStyle}font-weight:bold;">${fmt(grandTotals.pf)}</td>
    <td style="${numStyle}font-weight:bold;">${fmt(grandTotals.esi)}</td>
    <td style="${numStyle}font-weight:bold;">${grandTotals.days}</td>
    <td style="${numStyle}font-weight:bold;">${grandTotals.sundays || ''}</td>
    <td style="${numStyle}font-weight:bold;">${grandTotals.totalDays}</td>
    <td style="${numStyle}font-weight:bold;">${fmt(grandTotals.payable)}</td>
    <td style="${numStyle}font-weight:bold;">${fmt(grandTotals.lateDed)}</td>
    <td style="${numStyle}font-weight:bold;font-size:10px;">${fmt(grandTotals.netPayable)}</td>
    <td style="${numStyle}font-weight:bold;font-size:10px;background:#cdebd6;">${fmt(grandTotals.takeHome)}</td>
    <td style="${cellStyle}"></td>
  </tr>`;

  html += `</tbody></table></div>`;
  return html;
}

// Keep the individual payslip function for single-employee view
function generatePayslipHTML(payslip, companyConfig) {
  const emp = payslip.employee;
  const companyName = companyConfig?.company_name || emp.company || 'Company';
  const att = payslip.attendance || {};
  function fmtC(v) { return Math.round(v || 0).toLocaleString('en-IN') }

  const earningsRows = payslip.earnings.map(e =>
    `<tr><td style="padding:4px 8px;border:1px solid #ddd;">${e.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${fmtC(e.amount)}</td></tr>`
  ).join('');
  const deductionsRows = payslip.deductions.map(d =>
    `<tr><td style="padding:4px 8px;border:1px solid #ddd;">${d.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${fmtC(d.amount)}</td></tr>`
  ).join('');

  const fmtDOJ = (iso) => {
    if (!iso) return '\u2014';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };

  return `<div style="font-family:Arial,sans-serif;font-size:11px;max-width:700px;margin:0 auto;padding:20px;page-break-after:always;">
    <div style="text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:15px;">
      <h2 style="margin:0;font-size:16px;">${companyName}</h2>
      <p style="margin:5px 0 0;font-size:12px;font-weight:bold;">Pay Slip for ${payslip.period.period}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px;">
      <tr><td style="padding:3px 0;width:25%;"><strong>Name:</strong></td><td style="width:25%;">${emp.name}</td><td style="width:25%;"><strong>Code:</strong></td><td style="width:25%;">${emp.code}</td></tr>
      <tr><td style="padding:3px 0;"><strong>Department:</strong></td><td>${emp.department}</td><td><strong>Designation:</strong></td><td>${emp.designation}</td></tr>
      <tr><td style="padding:3px 0;"><strong>Date of Joining:</strong></td><td>${fmtDOJ(emp.date_of_joining)}</td><td><strong>UAN:</strong></td><td>${emp.uan || '\u2014'}</td></tr>
      <tr><td style="padding:3px 0;"><strong>Bank A/C:</strong></td><td colspan="3">${emp.bank_account || '\u2014'}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
      <tr style="background:#f0f0f0;">
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Present:</strong> ${att.days_present || 0}</td>
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Sundays:</strong> ${att.paid_sundays || 0}</td>
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Payable:</strong> ${att.total_payable_days || 0}</td>
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>LOP:</strong> ${att.lop_days || 0}</td>
      </tr>
    </table>
    ${(() => {
      const lv = payslip.leaveSummary || {};
      const parts = [];
      if ((lv.cl || 0) > 0) parts.push(`<strong>CL:</strong> ${lv.cl}`);
      if ((lv.el || 0) > 0) parts.push(`<strong>EL:</strong> ${lv.el}`);
      if ((lv.sl || 0) > 0) parts.push(`<strong>SL:</strong> ${lv.sl}`);
      if ((lv.lwp || 0) > 0) parts.push(`<strong>LWP:</strong> ${lv.lwp}`);
      if ((lv.od || 0) > 0) parts.push(`<strong>OD:</strong> ${lv.od}`);
      if ((lv.shortLeave || 0) > 0) parts.push(`<strong>Short Lv:</strong> ${lv.shortLeave}`);
      if ((lv.uninformedAbsent || 0) > 0) parts.push(`<strong>Uninfo. Abs:</strong> ${lv.uninformedAbsent}`);
      if (parts.length === 0) return '';
      return `<table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
      <tr style="background:#fef3c7;">
        <td style="padding:3px 6px;border:1px solid #fcd34d;" colspan="4"><strong>Leave Summary:</strong> ${parts.join(' &nbsp;|&nbsp; ')}</td>
      </tr>
    </table>`;
    })()}
    <div style="display:flex;gap:12px;">
      <div style="flex:1;"><table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr style="background:#e8f4fd;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Earnings</th></tr></thead>
        <tbody>${earningsRows}<tr style="background:#e8f4fd;font-weight:bold;"><td style="padding:4px 8px;border:1px solid #ddd;">Gross Earned</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${fmtC(payslip.grossEarned)}</td></tr></tbody>
      </table></div>
      <div style="flex:1;"><table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr style="background:#fde8e8;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Deductions</th></tr></thead>
        <tbody>${deductionsRows}<tr style="background:#fde8e8;font-weight:bold;"><td style="padding:4px 8px;border:1px solid #ddd;">Total Deductions</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${fmtC(payslip.totalDeductions)}</td></tr></tbody>
      </table></div>
    </div>
    <div style="margin-top:12px;padding:10px;background:#e8fde8;border:2px solid #4caf50;text-align:center;font-size:14px;"><strong>Net Salary: ${fmtC(payslip.netSalary)}</strong></div>
    ${((payslip.otPay || 0) > 0 || (payslip.edPay || 0) > 0 || (payslip.holidayDutyPay || 0) > 0) ? `
    <div style="margin-top:6px;padding:8px 12px;background:#f0fdf4;border:1px solid #86efac;font-size:10px;">
      ${(payslip.otPay || 0) > 0 ? `<div style="display:flex;justify-content:space-between;"><span>+ OT Pay</span><span>${fmtC(payslip.otPay)}</span></div>` : ''}
      ${(payslip.holidayDutyPay || 0) > 0 ? `<div style="display:flex;justify-content:space-between;"><span>+ Holiday Duty Pay</span><span>${fmtC(payslip.holidayDutyPay)}</span></div>` : ''}
      ${(payslip.edPay || 0) > 0 ? `<div style="display:flex;justify-content:space-between;"><span>+ Extra Duty Pay (${payslip.edDays || 0}d)</span><span>${fmtC(payslip.edPay)}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;margin-top:4px;padding-top:4px;border-top:1px solid #86efac;font-weight:bold;font-size:12px;">
        <span>TAKE HOME</span><span>${fmtC(payslip.takeHome || payslip.totalPayable || payslip.netSalary)}</span>
      </div>
    </div>` : ''}
    <div style="margin-top:8px;font-size:9px;color:#666;"><p>Employer PF: ${fmtC(payslip.pfEmployer)} | Employer ESI: ${fmtC(payslip.esiEmployer)}</p></div>
  </div>`;
}

export async function downloadPayslipPDF(payslip, companyConfig) {
  const html2pdf = (await import('html2pdf.js')).default;
  const html = generatePayslipHTML(payslip, companyConfig);
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    await html2pdf().set({
      margin: [5, 5, 5, 5], filename: `Payslip_${payslip.employee.code}_${payslip.period.monthName}_${payslip.period.year}.pdf`,
      image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(container).save();
  } finally { document.body.removeChild(container) }
}

export async function downloadBulkPayslipsPDF(payslips, companyConfig, month, year) {
  const html2pdf = (await import('html2pdf.js')).default;
  const html = generateSalaryRegisterHTML(payslips, companyConfig, month, year);
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  const monthName = MONTHS[month] || month;
  try {
    await html2pdf().set({
      margin: [5, 5, 5, 5], filename: `Salary_Slip_${monthName}_${year}.pdf`,
      image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
      pagebreak: { mode: ['css', 'legacy'] }
    }).from(container).save();
  } finally { document.body.removeChild(container) }
}

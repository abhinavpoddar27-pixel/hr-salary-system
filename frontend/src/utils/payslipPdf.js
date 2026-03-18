/**
 * Client-side payslip PDF generator using html2pdf.js
 */

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function fmtCurrency(v) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v || 0);
}

function generatePayslipHTML(payslip, companyConfig) {
  const emp = payslip.employee;
  const companyName = companyConfig?.company_name || emp.company || 'Company';
  const companyAddr = [companyConfig?.address_line1, companyConfig?.address_line2, companyConfig?.city, companyConfig?.state, companyConfig?.pin].filter(Boolean).join(', ');

  const earningsRows = payslip.earnings.map(e =>
    `<tr><td style="padding:4px 8px;border:1px solid #ddd;">${e.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${fmtCurrency(e.amount)}</td></tr>`
  ).join('');

  const deductionsRows = payslip.deductions.map(d =>
    `<tr><td style="padding:4px 8px;border:1px solid #ddd;">${d.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${fmtCurrency(d.amount)}</td></tr>`
  ).join('');

  const att = payslip.attendance || {};

  return `
    <div style="font-family:Arial,sans-serif;font-size:11px;max-width:700px;margin:0 auto;padding:20px;page-break-after:always;">
      <div style="text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:15px;">
        <h2 style="margin:0;font-size:16px;">${companyName}</h2>
        ${companyAddr ? `<p style="margin:2px 0;font-size:10px;color:#666;">${companyAddr}</p>` : ''}
        <p style="margin:5px 0 0;font-size:12px;font-weight:bold;">Pay Slip for ${payslip.period.period}</p>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px;">
        <tr>
          <td style="padding:3px 0;width:25%;"><strong>Name:</strong></td><td style="width:25%;">${emp.name}</td>
          <td style="width:25%;"><strong>Code:</strong></td><td style="width:25%;">${emp.code}</td>
        </tr>
        <tr>
          <td style="padding:3px 0;"><strong>Department:</strong></td><td>${emp.department}</td>
          <td><strong>Designation:</strong></td><td>${emp.designation}</td>
        </tr>
        <tr>
          <td style="padding:3px 0;"><strong>UAN:</strong></td><td>${emp.uan || '—'}</td>
          <td><strong>Bank A/C:</strong></td><td>${emp.bank_account || '—'}</td>
        </tr>
        <tr>
          <td style="padding:3px 0;"><strong>DOJ:</strong></td><td>${emp.date_of_joining || '—'}</td>
          <td><strong>PF No:</strong></td><td>${emp.pf_number || '—'}</td>
        </tr>
      </table>

      <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
        <tr style="background:#f0f0f0;">
          <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Days Present:</strong> ${att.days_present || 0}</td>
          <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Half Days:</strong> ${att.days_half_present || 0}</td>
          <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Paid Sundays:</strong> ${att.paid_sundays || 0}</td>
          <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Payable Days:</strong> ${att.total_payable_days || 0}</td>
          <td style="padding:3px 6px;border:1px solid #ddd;"><strong>LOP:</strong> ${att.lop_days || 0}</td>
        </tr>
      </table>

      <div style="display:flex;gap:12px;">
        <div style="flex:1;">
          <table style="width:100%;border-collapse:collapse;font-size:10px;">
            <thead><tr style="background:#e8f4fd;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Earnings</th></tr></thead>
            <tbody>
              ${earningsRows}
              <tr style="background:#e8f4fd;font-weight:bold;">
                <td style="padding:4px 8px;border:1px solid #ddd;">Gross Earned</td>
                <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${fmtCurrency(payslip.grossEarned)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style="flex:1;">
          <table style="width:100%;border-collapse:collapse;font-size:10px;">
            <thead><tr style="background:#fde8e8;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Deductions</th></tr></thead>
            <tbody>
              ${deductionsRows}
              <tr style="background:#fde8e8;font-weight:bold;">
                <td style="padding:4px 8px;border:1px solid #ddd;">Total Deductions</td>
                <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${fmtCurrency(payslip.totalDeductions)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style="margin-top:12px;padding:10px;background:#e8fde8;border:2px solid #4caf50;text-align:center;font-size:14px;">
        <strong>Net Salary: ${fmtCurrency(payslip.netSalary)}</strong>
      </div>

      <div style="margin-top:8px;font-size:9px;color:#666;">
        <p>Employer PF: ${fmtCurrency(payslip.pfEmployer)} | Employer ESI: ${fmtCurrency(payslip.esiEmployer)}</p>
        <p style="margin-top:20px;">This is a computer-generated document and does not require a signature.</p>
      </div>
    </div>
  `;
}

export async function downloadPayslipPDF(payslip, companyConfig) {
  const html2pdf = (await import('html2pdf.js')).default;
  const html = generatePayslipHTML(payslip, companyConfig);

  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    await html2pdf().set({
      margin: [5, 5, 5, 5],
      filename: `Payslip_${payslip.employee.code}_${payslip.period.monthName}_${payslip.period.year}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(container).save();
  } finally {
    document.body.removeChild(container);
  }
}

export async function downloadBulkPayslipsPDF(payslips, companyConfig, month, year) {
  const html2pdf = (await import('html2pdf.js')).default;
  const allHTML = payslips.map(ps => generatePayslipHTML(ps, companyConfig)).join('');

  const container = document.createElement('div');
  container.innerHTML = allHTML;
  document.body.appendChild(container);

  const monthName = MONTHS[month] || month;

  try {
    await html2pdf().set({
      margin: [5, 5, 5, 5],
      filename: `All_Payslips_${monthName}_${year}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] }
    }).from(container).save();
  } finally {
    document.body.removeChild(container);
  }
}

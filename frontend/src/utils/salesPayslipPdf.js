/**
 * Sales Payslip PDF — Phase 4
 *
 * Mirrors the plant pattern in ./payslipPdf.js — renders the payslip as
 * HTML off-DOM, then uses html2pdf.js (already a frontend dep) to produce
 * a downloadable PDF. No backend PDF lib is installed; keeping this on the
 * client side avoids the dep bump.
 *
 * Watermark: "NOT VALID · DRAFT" is overlaid diagonally when the row is
 * NOT in `finalized` or `paid` — so early-stage drafts can't be mistaken
 * for the authoritative payslip.
 */

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

function fmtINR(v) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
    .format(Number(v || 0));
}

function fmtDOJ(iso) {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function generateSalesPayslipHTML(payslip) {
  const {
    employee, period, days, earnings, totalEarnings,
    deductions, totalDeductions, netSalary, status, bank,
    computedAt, finalizedAt, finalizedBy,
  } = payslip;

  const isDraft = !['finalized', 'paid'].includes(status);
  const statusLabel = (status || 'computed').toUpperCase();

  const earningsRows = (earnings || [])
    .filter(e => (e.amount || 0) > 0)
    .map(e =>
      `<tr><td style="padding:4px 8px;border:1px solid #ddd;">${e.label}</td>
           <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;font-family:monospace;">₹${fmtINR(e.amount)}</td></tr>`
    ).join('');

  const deductionsRows = (deductions || [])
    .filter(d => (d.amount || 0) > 0)
    .map(d =>
      `<tr><td style="padding:4px 8px;border:1px solid #ddd;">${d.label}</td>
           <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;font-family:monospace;">₹${fmtINR(d.amount)}</td></tr>`
    ).join('');

  const watermark = isDraft
    ? `<div style="position:absolute;top:45%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);
        font-size:64px;font-weight:900;color:rgba(220,38,38,0.18);
        letter-spacing:8px;white-space:nowrap;pointer-events:none;z-index:10;">
         NOT VALID · DRAFT
       </div>`
    : '';

  return `<div style="position:relative;font-family:Arial,sans-serif;font-size:11px;max-width:720px;margin:0 auto;padding:24px;page-break-after:always;">
    ${watermark}

    <div style="text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:15px;">
      <h2 style="margin:0;font-size:18px;">${employee.company || 'Company'}</h2>
      <p style="margin:5px 0 0;font-size:13px;font-weight:bold;">SALARY SLIP — ${MONTHS[period.month]} ${period.year}</p>
      <p style="margin:4px 0 0;font-size:10px;color:#666;">Status: ${statusLabel}</p>
    </div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px;">
      <tr>
        <td style="padding:3px 0;width:25%;"><strong>Code:</strong></td><td style="width:25%;">${employee.code || '—'}</td>
        <td style="padding:3px 0;width:25%;"><strong>Name:</strong></td><td style="width:25%;">${employee.name || '—'}</td>
      </tr>
      <tr>
        <td style="padding:3px 0;"><strong>Designation:</strong></td><td>${employee.designation || '—'}</td>
        <td style="padding:3px 0;"><strong>Reporting Manager:</strong></td><td>${employee.reporting_manager || '—'}</td>
      </tr>
      <tr>
        <td style="padding:3px 0;"><strong>HQ:</strong></td><td>${employee.headquarters || '—'}</td>
        <td style="padding:3px 0;"><strong>City of Operation:</strong></td><td>${employee.city_of_operation || '—'}</td>
      </tr>
      <tr>
        <td style="padding:3px 0;"><strong>Date of Joining:</strong></td><td>${fmtDOJ(employee.doj)}</td>
        <td style="padding:3px 0;"></td><td></td>
      </tr>
    </table>

    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
      <tr style="background:#f0f0f0;">
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>Days Given:</strong> ${days.days_given}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>Paid Sundays:</strong> ${days.sundays_paid}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>Holidays:</strong> ${days.gazetted_holidays_paid}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>Earned Leave:</strong> ${days.earned_leave_days || 0}</td>
      </tr>
      <tr style="background:#f0f0f0;">
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>Total Days:</strong> ${days.total_days}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>Calendar Days:</strong> ${days.calendar_days}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;" colspan="2"><strong>Earned Ratio:</strong> ${(days.earned_ratio || 0).toFixed(4)}</td>
      </tr>
    </table>

    <div style="display:flex;gap:12px;margin-bottom:12px;">
      <div style="flex:1;">
        <table style="width:100%;border-collapse:collapse;font-size:10px;">
          <thead><tr style="background:#e8f4fd;">
            <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Earnings</th>
          </tr></thead>
          <tbody>
            ${earningsRows || '<tr><td colspan="2" style="padding:4px 8px;color:#999;font-style:italic;">—</td></tr>'}
            <tr style="background:#e8f4fd;font-weight:bold;">
              <td style="padding:5px 8px;border:1px solid #ddd;">Total Earnings</td>
              <td style="padding:5px 8px;border:1px solid #ddd;text-align:right;font-family:monospace;">₹${fmtINR(totalEarnings)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style="flex:1;">
        <table style="width:100%;border-collapse:collapse;font-size:10px;">
          <thead><tr style="background:#fde8e8;">
            <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Deductions</th>
          </tr></thead>
          <tbody>
            ${deductionsRows || '<tr><td colspan="2" style="padding:4px 8px;color:#999;font-style:italic;">No deductions this month</td></tr>'}
            <tr style="background:#fde8e8;font-weight:bold;">
              <td style="padding:5px 8px;border:1px solid #ddd;">Total Deductions</td>
              <td style="padding:5px 8px;border:1px solid #ddd;text-align:right;font-family:monospace;">₹${fmtINR(totalDeductions)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div style="padding:12px;background:#e8fde8;border:2px solid #4caf50;text-align:center;font-size:16px;margin-bottom:12px;">
      <strong>Net Salary Payable: ₹${fmtINR(netSalary)}</strong>
    </div>

    ${(bank && (bank.bank_name || bank.account_no || bank.ifsc)) ? `
    <table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:10px;">
      <tr><td style="padding:4px 8px;border:1px solid #ddd;" colspan="2"><strong>Bank Details</strong></td></tr>
      <tr>
        <td style="padding:4px 8px;border:1px solid #ddd;width:50%;"><strong>Bank:</strong> ${bank.bank_name || '—'}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>IFSC:</strong> ${bank.ifsc || '—'}</td>
      </tr>
      <tr>
        <td style="padding:4px 8px;border:1px solid #ddd;" colspan="2"><strong>A/C No.:</strong> ${bank.account_no || '—'}</td>
      </tr>
    </table>` : ''}

    <div style="margin-top:12px;font-size:9px;color:#666;">
      <p style="margin:2px 0;">Generated: ${new Date().toLocaleString('en-IN')}</p>
      <p style="margin:2px 0;">Computed: ${computedAt || '—'}${finalizedAt ? ` · Finalized: ${finalizedAt}${finalizedBy ? ` by ${finalizedBy}` : ''}` : ''}</p>
      ${isDraft ? '<p style="margin:4px 0;color:#dc2626;font-weight:bold;">⚠ This payslip is a draft. Final figures require finalization.</p>' : ''}
    </div>
  </div>`;
}

export async function downloadSalesPayslipPDF(payslip) {
  const html2pdf = (await import('html2pdf.js')).default;
  const html = generateSalesPayslipHTML(payslip);
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  const monthName = MONTHS[payslip.period.month] || String(payslip.period.month);
  try {
    await html2pdf().set({
      margin: [8, 8, 8, 8],
      filename: `Payslip_${payslip.employee.code}_${monthName}_${payslip.period.year}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    }).from(container).save();
  } finally {
    document.body.removeChild(container);
  }
}

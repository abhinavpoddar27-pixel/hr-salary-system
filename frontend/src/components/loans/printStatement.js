// Loans PR-4 — printable loan statement (SPEC §7 screen 4).
// Same pattern as DailyWagePayments.jsx: a self-contained print window.
// Holds borrower code + name only — no bank, PAN, phone or address.
import { rupees, stateLabel, LOAN_STATE } from './loanUi'

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export function statementHtml(loan, st) {
  const rows = (st.rows || []).map((r) => `<tr><td>${esc(r.month)}</td><td class="n">${rupees(r.opening)}</td><td class="n">${rupees(r.disbursed)}</td>
    <td class="n">${rupees(r.recovered)}</td><td class="n">${rupees(r.cash)}</td><td class="n">${rupees(r.writtenOff)}</td><td class="n b">${rupees(r.closing)}</td></tr>`).join('')
  const generated = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Loan statement #${esc(loan.id)}</title>
<style>body{font-family:Arial,sans-serif;margin:24px;font-size:12px;color:#111}h2{margin:0 0 4px}
.meta{margin:8px 0 14px;line-height:1.6}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:5px 8px}
th{background:#f0f0f0;text-align:left}td.n,th.n{text-align:right}.b{font-weight:bold}tfoot td{font-weight:bold;background:#f9f9f9}
.foot{margin-top:14px;color:#555;font-size:11px}@media print{button{display:none}}</style></head><body>
<h2>Loan statement</h2>
<div class="meta"><strong>${esc(loan.company)}</strong><br>
Loan #${esc(loan.id)} · ${esc(loan.loan_type)} · status: ${esc(stateLabel(LOAN_STATE, st.status || loan.status))}<br>
Borrower: ${esc(loan.employee_name || '')} (${esc(loan.employee_code)})${loan.department ? ' · ' + esc(loan.department) : ''}<br>
Principal ${rupees(loan.principal_amount)} · ${esc(loan.tenure_months)} months · EMI ${rupees(loan.emi_amount)}${loan.disbursed_on ? ' · disbursed ' + esc(loan.disbursed_on) : ''}</div>
<table><thead><tr><th>Month</th><th class="n">Opening</th><th class="n">Disbursed</th><th class="n">Recovered (payroll)</th>
<th class="n">Cash receipts</th><th class="n">Written off</th><th class="n">Closing</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7">No money has moved on this loan yet.</td></tr>'}</tbody>
<tfoot><tr><td colspan="6">Closing balance</td><td class="n">${rupees(st.closing)}</td></tr></tfoot></table>
<div class="foot">Interest-free loan. Recovered = deductions posted at the monthly loan close. Generated ${esc(generated)} IST.</div>
<button onclick="window.print()">Print</button></body></html>`
}

export function openStatementWindow(loan, st) {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.write(statementHtml(loan, st))
  w.document.close()
  return true
}

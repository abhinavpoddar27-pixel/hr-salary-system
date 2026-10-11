const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/html2pdf-D5zdSBum.js","assets/index-uzjAjtjg.js","assets/index-CfBkunmT.css"])))=>i.map(i=>d[i]);
import{bE as x}from"./index-uzjAjtjg.js";function y(t){if(!t||!t.show||!Array.isArray(t.loans)||t.loans.length===0)return"";const a=e=>Number(e||0).toLocaleString("en-IN",{minimumFractionDigits:0,maximumFractionDigits:2});return`<div data-loan-balance="1" style="margin-top:6px;padding:6px 12px;background:#f8fafc;border:1px solid #cbd5e1;font-size:10px;"><div style="display:flex;justify-content:space-between;">${t.loans.length===1?`<span>Loan outstanding after this month's EMI</span><span>&#8377;${a(t.loans[0].outstandingAfter)}</span>`:t.loans.map(e=>`<span>Loan #${e.loanId} (${e.loanType}) outstanding after this month's EMI</span><span>&#8377;${a(e.outstandingAfter)}</span>`).join('</div><div style="display:flex;justify-content:space-between;">')}</div></div>`}function f(t,a,r=null){const e=t.employee,i=e.company||"Company",s=t.attendance||{};function n(d){return Math.round(d||0).toLocaleString("en-IN")}const l=t.earnings.map(d=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${d.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${n(d.amount)}</td></tr>`).join(""),p=t.deductions.map(d=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${d.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${n(d.amount)}</td></tr>`).join(""),g=d=>{if(!d)return"—";const o=/^(\d{4})-(\d{2})-(\d{2})/.exec(d);return o?`${o[3]}/${o[2]}/${o[1]}`:d};return`<div style="font-family:Arial,sans-serif;font-size:11px;max-width:700px;margin:0 auto;padding:20px;page-break-after:always;">
    <div style="text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:15px;">
      <h2 style="margin:0;font-size:16px;">${i}</h2>
      <p style="margin:5px 0 0;font-size:12px;font-weight:bold;">Pay Slip for ${t.period.period}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px;">
      <tr><td style="padding:3px 0;width:25%;"><strong>Name:</strong></td><td style="width:25%;">${e.name}</td><td style="width:25%;"><strong>Code:</strong></td><td style="width:25%;">${e.code}</td></tr>
      <tr><td style="padding:3px 0;"><strong>Department:</strong></td><td>${e.department}</td><td><strong>Designation:</strong></td><td>${e.designation}</td></tr>
      <tr><td style="padding:3px 0;"><strong>Date of Joining:</strong></td><td>${g(e.date_of_joining)}</td><td><strong>UAN:</strong></td><td>${e.uan||"—"}</td></tr>
      <tr><td style="padding:3px 0;"><strong>Bank A/C:</strong></td><td colspan="3">${e.bank_account||"—"}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
      <tr style="background:#f0f0f0;">
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Present:</strong> ${s.days_present||0}</td>
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Sundays:</strong> ${s.paid_sundays||0}</td>
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Payable:</strong> ${s.total_payable_days||0}</td>
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>LOP:</strong> ${s.lop_days||0}</td>
      </tr>
    </table>
    ${(()=>{const d=t.leaveSummary||{},o=[];return(d.cl||0)>0&&o.push(`<strong>CL:</strong> ${d.cl}`),(d.el||0)>0&&o.push(`<strong>EL:</strong> ${d.el}`),(d.sl||0)>0&&o.push(`<strong>SL:</strong> ${d.sl}`),(d.lwp||0)>0&&o.push(`<strong>LWP:</strong> ${d.lwp}`),(d.od||0)>0&&o.push(`<strong>OD:</strong> ${d.od}`),(d.shortLeave||0)>0&&o.push(`<strong>Short Lv:</strong> ${d.shortLeave}`),(d.uninformedAbsent||0)>0&&o.push(`<strong>Uninfo. Abs:</strong> ${d.uninformedAbsent}`),o.length===0?"":`<table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
      <tr style="background:#fef3c7;">
        <td style="padding:3px 6px;border:1px solid #fcd34d;" colspan="4"><strong>Leave Summary:</strong> ${o.join(" &nbsp;|&nbsp; ")}</td>
      </tr>
    </table>`})()}
    <div style="display:flex;gap:12px;">
      <div style="flex:1;"><table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr style="background:#e8f4fd;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Earnings</th></tr></thead>
        <tbody>${l}<tr style="background:#e8f4fd;font-weight:bold;"><td style="padding:4px 8px;border:1px solid #ddd;">Gross Earned</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${n(t.grossEarned)}</td></tr></tbody>
      </table></div>
      <div style="flex:1;"><table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr style="background:#fde8e8;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Deductions</th></tr></thead>
        <tbody>${p}<tr style="background:#fde8e8;font-weight:bold;"><td style="padding:4px 8px;border:1px solid #ddd;">Total Deductions</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${n(t.totalDeductions)}</td></tr></tbody>
      </table></div>
    </div>
    <div style="margin-top:12px;padding:10px;background:#e8fde8;border:2px solid #4caf50;text-align:center;font-size:14px;"><strong>Net Salary: ${n(t.netSalary)}</strong></div>${y(r)}
    ${(t.otPay||0)>0||(t.edPay||0)>0||(t.holidayDutyPay||0)>0?`
    <div style="margin-top:6px;padding:8px 12px;background:#f0fdf4;border:1px solid #86efac;font-size:10px;">
      ${(t.otPay||0)>0?`<div style="display:flex;justify-content:space-between;"><span>+ OT Pay</span><span>${n(t.otPay)}</span></div>`:""}
      ${(t.holidayDutyPay||0)>0?`<div style="display:flex;justify-content:space-between;"><span>+ Holiday Duty Pay</span><span>${n(t.holidayDutyPay)}</span></div>`:""}
      ${(t.edPay||0)>0?`<div style="display:flex;justify-content:space-between;"><span>+ Extra Duty Pay (${t.edDays||0}d)</span><span>${n(t.edPay)}</span></div>`:""}
      <div style="display:flex;justify-content:space-between;margin-top:4px;padding-top:4px;border-top:1px solid #86efac;font-weight:bold;font-size:12px;">
        <span>TAKE HOME</span><span>${n(t.takeHome||t.totalPayable||t.netSalary)}</span>
      </div>
    </div>`:""}
    <div style="margin-top:8px;font-size:9px;color:#666;"><p>Employer PF: ${n(t.pfEmployer)} | Employer ESI: ${n(t.esiEmployer)}${(t.lwfEmployer||0)>0?` | Employer LWF: ${n(t.lwfEmployer)}`:""}</p></div>
  </div>`}async function m(t,a,r=null){const e=(await x(async()=>{const{default:n}=await import("./html2pdf-D5zdSBum.js").then(l=>l.h);return{default:n}},__vite__mapDeps([0,1,2]))).default,i=f(t,a,r),s=document.createElement("div");s.innerHTML=i,document.body.appendChild(s);try{await e().set({margin:[5,5,5,5],filename:`Payslip_${t.employee.code}_${t.period.monthName}_${t.period.year}.pdf`,image:{type:"jpeg",quality:.98},html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(s).save()}finally{document.body.removeChild(s)}}export{m as d,y as l};

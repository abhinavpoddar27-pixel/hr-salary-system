const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/html2pdf-D9Lcimdo.js","assets/index-BR0V-jfz.js","assets/index-khVqL_po.css"])))=>i.map(i=>d[i]);
import{aq as p}from"./index-BR0V-jfz.js";const u=["","January","February","March","April","May","June","July","August","September","October","November","December"];function n(d){return new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(d||0)}function x(d,t){const e=d.employee,l=(t==null?void 0:t.company_name)||e.company||"Company",r=[t==null?void 0:t.address_line1,t==null?void 0:t.address_line2,t==null?void 0:t.city,t==null?void 0:t.state,t==null?void 0:t.pin].filter(Boolean).join(", "),i=d.earnings.map(a=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${a.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${n(a.amount)}</td></tr>`).join(""),s=d.deductions.map(a=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${a.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${n(a.amount)}</td></tr>`).join(""),o=d.attendance||{};return`
    <div style="font-family:Arial,sans-serif;font-size:11px;max-width:700px;margin:0 auto;padding:20px;page-break-after:always;">
      <div style="text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:15px;">
        <h2 style="margin:0;font-size:16px;">${l}</h2>
        ${r?`<p style="margin:2px 0;font-size:10px;color:#666;">${r}</p>`:""}
        <p style="margin:5px 0 0;font-size:12px;font-weight:bold;">Pay Slip for ${d.period.period}</p>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px;">
        <tr>
          <td style="padding:3px 0;width:25%;"><strong>Name:</strong></td><td style="width:25%;">${e.name}</td>
          <td style="width:25%;"><strong>Code:</strong></td><td style="width:25%;">${e.code}</td>
        </tr>
        <tr>
          <td style="padding:3px 0;"><strong>Department:</strong></td><td>${e.department}</td>
          <td><strong>Designation:</strong></td><td>${e.designation}</td>
        </tr>
        <tr>
          <td style="padding:3px 0;"><strong>UAN:</strong></td><td>${e.uan||"—"}</td>
          <td><strong>Bank A/C:</strong></td><td>${e.bank_account||"—"}</td>
        </tr>
        <tr>
          <td style="padding:3px 0;"><strong>DOJ:</strong></td><td>${e.date_of_joining||"—"}</td>
          <td><strong>PF No:</strong></td><td>${e.pf_number||"—"}</td>
        </tr>
      </table>

      <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
        <tr style="background:#f0f0f0;">
          <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Days Present:</strong> ${o.days_present||0}</td>
          <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Half Days:</strong> ${o.days_half_present||0}</td>
          <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Paid Sundays:</strong> ${o.paid_sundays||0}</td>
          <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Payable Days:</strong> ${o.total_payable_days||0}</td>
          <td style="padding:3px 6px;border:1px solid #ddd;"><strong>LOP:</strong> ${o.lop_days||0}</td>
        </tr>
      </table>

      <div style="display:flex;gap:12px;">
        <div style="flex:1;">
          <table style="width:100%;border-collapse:collapse;font-size:10px;">
            <thead><tr style="background:#e8f4fd;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Earnings</th></tr></thead>
            <tbody>
              ${i}
              <tr style="background:#e8f4fd;font-weight:bold;">
                <td style="padding:4px 8px;border:1px solid #ddd;">Gross Earned</td>
                <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${n(d.grossEarned)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style="flex:1;">
          <table style="width:100%;border-collapse:collapse;font-size:10px;">
            <thead><tr style="background:#fde8e8;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Deductions</th></tr></thead>
            <tbody>
              ${s}
              <tr style="background:#fde8e8;font-weight:bold;">
                <td style="padding:4px 8px;border:1px solid #ddd;">Total Deductions</td>
                <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${n(d.totalDeductions)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style="margin-top:12px;padding:10px;background:#e8fde8;border:2px solid #4caf50;text-align:center;font-size:14px;">
        <strong>Net Salary: ${n(d.netSalary)}</strong>
      </div>

      <div style="margin-top:8px;font-size:9px;color:#666;">
        <p>Employer PF: ${n(d.pfEmployer)} | Employer ESI: ${n(d.esiEmployer)}</p>
        <p style="margin-top:20px;">This is a computer-generated document and does not require a signature.</p>
      </div>
    </div>
  `}async function y(d,t){const e=(await p(async()=>{const{default:i}=await import("./html2pdf-D9Lcimdo.js").then(s=>s.h);return{default:i}},__vite__mapDeps([0,1,2]))).default,l=x(d,t),r=document.createElement("div");r.innerHTML=l,document.body.appendChild(r);try{await e().set({margin:[5,5,5,5],filename:`Payslip_${d.employee.code}_${d.period.monthName}_${d.period.year}.pdf`,image:{type:"jpeg",quality:.98},html2canvas:{scale:2,useCORS:!0},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(r).save()}finally{document.body.removeChild(r)}}async function m(d,t,e,l){const r=(await p(async()=>{const{default:a}=await import("./html2pdf-D9Lcimdo.js").then(g=>g.h);return{default:a}},__vite__mapDeps([0,1,2]))).default,i=d.map(a=>x(a,t)).join(""),s=document.createElement("div");s.innerHTML=i,document.body.appendChild(s);const o=u[e]||e;try{await r().set({margin:[5,5,5,5],filename:`All_Payslips_${o}_${l}.pdf`,image:{type:"jpeg",quality:.95},html2canvas:{scale:2,useCORS:!0},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"},pagebreak:{mode:["css","legacy"]}}).from(s).save()}finally{document.body.removeChild(s)}}export{m as a,y as d};

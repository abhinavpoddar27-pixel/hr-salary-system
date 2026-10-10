const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/html2pdf-71pfs1Tu.js","assets/index-D7m_4yGU.js","assets/index-Dl09D_3h.css"])))=>i.map(i=>d[i]);
import{bq as V}from"./index-D7m_4yGU.js";const Y=["","January","February","March","April","May","June","July","August","September","October","November","December"];function a(t){return Math.round(t||0).toLocaleString("en-IN")}const $="padding:3px 4px;border:1px solid #999;font-size:9px;",e=$+"text-align:right;font-family:monospace;",g="padding:4px 5px;border:1px solid #666;font-size:8px;font-weight:bold;background:#d9e2f3;text-align:center;";function X(t,u,h,y){var s,c,D,_,S,k,A,L,T,N,z,H,M,O,j,C,R,F,I,U,J,K,W,q;const P=(u==null?void 0:u.company_name)||"Company",f=Y[h]||h,r={},x="__PERMANENT__";r[x]={label:"PERMANENT STAFF",employees:[]};for(const l of t){const b=l.employee,n=l.attendance||{},d=l.otPay||((c=(s=l.earnings)==null?void 0:s.find(o=>o.label==="OT Pay"))==null?void 0:c.amount)||0,E=l.edPay||((_=(D=l.earnings)==null?void 0:D.find(o=>o.label==="Extra Duty Pay"))==null?void 0:_.amount)||0,B=l.takeHome||(l.totalPayable||l.netSalary||0)+E,G={code:b.code,name:b.name||b.code,designation:b.designation||b.department||"",grossSalary:l.grossSalary||l.grossEarned||0,basic:((k=(S=l.earnings)==null?void 0:S.find(o=>{var i;return(i=o.label)==null?void 0:i.includes("Basic")}))==null?void 0:k.amount)||0,hra:((L=(A=l.earnings)==null?void 0:A.find(o=>{var i;return(i=o.label)==null?void 0:i.includes("HRA")}))==null?void 0:L.amount)||0,cca:0,conv:((N=(T=l.earnings)==null?void 0:T.find(o=>{var i;return(i=o.label)==null?void 0:i.includes("Conveyance")}))==null?void 0:N.amount)||0,totalEarned:l.grossEarned||0,otPay:d,edPay:E,advance:((H=(z=l.deductions)==null?void 0:z.find(o=>{var i;return(i=o.label)==null?void 0:i.includes("Advance")}))==null?void 0:H.amount)||0,pf:((O=(M=l.deductions)==null?void 0:M.find(o=>{var i,w;return((i=o.label)==null?void 0:i.includes("PF"))&&!((w=o.label)!=null&&w.includes("Employer"))}))==null?void 0:O.amount)||0,esi:((C=(j=l.deductions)==null?void 0:j.find(o=>{var i,w;return((i=o.label)==null?void 0:i.includes("ESI"))&&!((w=o.label)!=null&&w.includes("Employer"))}))==null?void 0:C.amount)||0,wlf:((F=(R=l.deductions)==null?void 0:R.find(o=>{var i;return(i=o.label)==null?void 0:i.includes("LWF")}))==null?void 0:F.amount)||0,tds:((U=(I=l.deductions)==null?void 0:I.find(o=>{var i;return(i=o.label)==null?void 0:i.includes("TDS")}))==null?void 0:U.amount)||0,pt:((K=(J=l.deductions)==null?void 0:J.find(o=>{var i;return(i=o.label)==null?void 0:i.includes("Professional")}))==null?void 0:K.amount)||0,lateDed:((q=(W=l.deductions)==null?void 0:W.find(o=>{var i,w;return((i=o.label)==null?void 0:i.includes("LOP"))||((w=o.label)==null?void 0:w.includes("Late"))}))==null?void 0:q.amount)||0,days:n.days_present||0,el:n.el_used||0,sundays:n.paid_sundays||0,totalDays:n.total_payable_days||0,payable:l.grossEarned||0,netPayable:l.netSalary||0,takeHome:B,department:b.department||""},Q=l.is_contractor===1||l.is_contractor===!0,v=(b.department||"").toUpperCase();if(Q||l.is_contractor===void 0&&(v.includes("CONT")||v.includes("LAMBU")||v.includes("MEERA")||v.includes("KULDEEP")||v.includes("JIWAN")||v.includes("SUNNY")||v.includes("AMAR"))){const o=b.department||"CONTRACTOR";r[o]||(r[o]={label:o,employees:[]}),r[o].employees.push(G)}else r[x].employees.push(G)}let m=`<div style="font-family:Arial,sans-serif;padding:10px;">
    <h2 style="text-align:center;margin:0;font-size:14px;">${P.toUpperCase()}</h2>
    <p style="text-align:center;margin:2px 0 10px;font-size:12px;font-weight:bold;">SALARY SLIP ${f.toUpperCase()} ${y}</p>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="${g}width:30px;">S.No</th>
          <th style="${g}width:40px;">EMP</th>
          <th style="${g}text-align:left;min-width:100px;">Name</th>
          <th style="${g}text-align:left;min-width:70px;">Desig.</th>
          <th style="${g}">Gross</th>
          <th style="${g}">Basic</th>
          <th style="${g}">Total Earned</th>
          <th style="${g}">OT Pay</th>
          <th style="${g}">ED Pay</th>
          <th style="${g}">Advance</th>
          <th style="${g}">PF</th>
          <th style="${g}">ESI</th>
          <th style="${g}">Days</th>
          <th style="${g}">Sun</th>
          <th style="${g}">Tot Days</th>
          <th style="${g}">Payable</th>
          <th style="${g}">Late Ded</th>
          <th style="${g}font-weight:bold;">Net Pay</th>
          <th style="${g}font-weight:bold;background:#cdebd6;">Take Home</th>
          <th style="${g}width:50px;">Sign</th>
        </tr>
      </thead>
      <tbody>`,p={gross:0,basic:0,totalEarned:0,otPay:0,edPay:0,advance:0,pf:0,esi:0,days:0,sundays:0,totalDays:0,payable:0,lateDed:0,netPayable:0,takeHome:0};for(const[l,b]of Object.entries(r)){if(b.employees.length===0)continue;l!==x&&(m+=`<tr><td colspan="19" style="padding:6px 5px;border:1px solid #999;font-weight:bold;background:#f0e6d2;font-size:10px;">${b.label}</td></tr>`);let n={gross:0,basic:0,totalEarned:0,otPay:0,edPay:0,advance:0,pf:0,esi:0,days:0,sundays:0,totalDays:0,payable:0,lateDed:0,netPayable:0,takeHome:0};b.employees.forEach((d,E)=>{n.gross+=d.grossSalary,n.basic+=d.basic,n.totalEarned+=d.totalEarned,n.otPay+=d.otPay,n.edPay+=d.edPay,n.advance+=d.advance,n.pf+=d.pf,n.esi+=d.esi,n.days+=d.days,n.sundays+=d.sundays,n.totalDays+=d.totalDays,n.payable+=d.payable,n.lateDed+=d.lateDed,n.netPayable+=d.netPayable,n.takeHome+=d.takeHome,m+=`<tr>
        <td style="${$}text-align:center;">${E+1}</td>
        <td style="${$}text-align:center;font-size:8px;">${d.code}</td>
        <td style="${$}font-weight:500;">${d.name}</td>
        <td style="${$}font-size:8px;">${d.designation}</td>
        <td style="${e}">${a(d.grossSalary)}</td>
        <td style="${e}">${a(d.basic)}</td>
        <td style="${e}">${a(d.totalEarned)}</td>
        <td style="${e}">${d.otPay?a(d.otPay):""}</td>
        <td style="${e}">${d.edPay?a(d.edPay):""}</td>
        <td style="${e}">${d.advance?a(d.advance):""}</td>
        <td style="${e}">${d.pf?a(d.pf):""}</td>
        <td style="${e}">${d.esi?a(d.esi):""}</td>
        <td style="${e}">${d.days}</td>
        <td style="${e}">${d.sundays||""}</td>
        <td style="${e}">${d.totalDays}</td>
        <td style="${e}font-weight:bold;">${a(d.payable)}</td>
        <td style="${e}">${d.lateDed?a(d.lateDed):""}</td>
        <td style="${e}font-weight:bold;">${a(d.netPayable)}</td>
        <td style="${e}font-weight:bold;background:#eaf6ec;">${a(d.takeHome)}</td>
        <td style="${$}"></td>
      </tr>`}),m+=`<tr style="background:#e8e8e8;font-weight:bold;">
      <td colspan="3" style="${$}text-align:right;font-weight:bold;">TOTAL</td>
      <td style="${$}"></td>
      <td style="${e}font-weight:bold;">${a(n.gross)}</td>
      <td style="${e}font-weight:bold;">${a(n.basic)}</td>
      <td style="${e}font-weight:bold;">${a(n.totalEarned)}</td>
      <td style="${e}font-weight:bold;">${a(n.otPay)}</td>
      <td style="${e}font-weight:bold;">${a(n.edPay)}</td>
      <td style="${e}font-weight:bold;">${a(n.advance)}</td>
      <td style="${e}font-weight:bold;">${a(n.pf)}</td>
      <td style="${e}font-weight:bold;">${a(n.esi)}</td>
      <td style="${e}font-weight:bold;">${n.days}</td>
      <td style="${e}font-weight:bold;">${n.sundays||""}</td>
      <td style="${e}font-weight:bold;">${n.totalDays}</td>
      <td style="${e}font-weight:bold;">${a(n.payable)}</td>
      <td style="${e}font-weight:bold;">${a(n.lateDed)}</td>
      <td style="${e}font-weight:bold;">${a(n.netPayable)}</td>
      <td style="${e}font-weight:bold;background:#cdebd6;">${a(n.takeHome)}</td>
      <td style="${$}"></td>
    </tr>`;for(const d of Object.keys(p))p[d]+=n[d]}return m+=`<tr style="background:#d9e2f3;font-weight:bold;">
    <td colspan="3" style="${$}text-align:right;font-weight:bold;font-size:10px;">GRAND TOTAL</td>
    <td style="${$}"></td>
    <td style="${e}font-weight:bold;">${a(p.gross)}</td>
    <td style="${e}font-weight:bold;">${a(p.basic)}</td>
    <td style="${e}font-weight:bold;">${a(p.totalEarned)}</td>
    <td style="${e}font-weight:bold;">${a(p.otPay)}</td>
    <td style="${e}font-weight:bold;">${a(p.edPay)}</td>
    <td style="${e}font-weight:bold;">${a(p.advance)}</td>
    <td style="${e}font-weight:bold;">${a(p.pf)}</td>
    <td style="${e}font-weight:bold;">${a(p.esi)}</td>
    <td style="${e}font-weight:bold;">${p.days}</td>
    <td style="${e}font-weight:bold;">${p.sundays||""}</td>
    <td style="${e}font-weight:bold;">${p.totalDays}</td>
    <td style="${e}font-weight:bold;">${a(p.payable)}</td>
    <td style="${e}font-weight:bold;">${a(p.lateDed)}</td>
    <td style="${e}font-weight:bold;font-size:10px;">${a(p.netPayable)}</td>
    <td style="${e}font-weight:bold;font-size:10px;background:#cdebd6;">${a(p.takeHome)}</td>
    <td style="${$}"></td>
  </tr>`,m+="</tbody></table></div>",m}function Z(t){if(!t||!t.show||!Array.isArray(t.loans)||t.loans.length===0)return"";const u=y=>Number(y||0).toLocaleString("en-IN",{minimumFractionDigits:0,maximumFractionDigits:2});return`<div data-loan-balance="1" style="margin-top:6px;padding:6px 12px;background:#f8fafc;border:1px solid #cbd5e1;font-size:10px;"><div style="display:flex;justify-content:space-between;">${t.loans.length===1?`<span>Loan outstanding after this month's EMI</span><span>&#8377;${u(t.loans[0].outstandingAfter)}</span>`:t.loans.map(y=>`<span>Loan #${y.loanId} (${y.loanType}) outstanding after this month's EMI</span><span>&#8377;${u(y.outstandingAfter)}</span>`).join('</div><div style="display:flex;justify-content:space-between;">')}</div></div>`}function tt(t,u,h=null){const y=t.employee,P=y.company||"Company",f=t.attendance||{};function r(s){return Math.round(s||0).toLocaleString("en-IN")}const x=t.earnings.map(s=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${s.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${r(s.amount)}</td></tr>`).join(""),m=t.deductions.map(s=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${s.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${r(s.amount)}</td></tr>`).join(""),p=s=>{if(!s)return"—";const c=/^(\d{4})-(\d{2})-(\d{2})/.exec(s);return c?`${c[3]}/${c[2]}/${c[1]}`:s};return`<div style="font-family:Arial,sans-serif;font-size:11px;max-width:700px;margin:0 auto;padding:20px;page-break-after:always;">
    <div style="text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:15px;">
      <h2 style="margin:0;font-size:16px;">${P}</h2>
      <p style="margin:5px 0 0;font-size:12px;font-weight:bold;">Pay Slip for ${t.period.period}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px;">
      <tr><td style="padding:3px 0;width:25%;"><strong>Name:</strong></td><td style="width:25%;">${y.name}</td><td style="width:25%;"><strong>Code:</strong></td><td style="width:25%;">${y.code}</td></tr>
      <tr><td style="padding:3px 0;"><strong>Department:</strong></td><td>${y.department}</td><td><strong>Designation:</strong></td><td>${y.designation}</td></tr>
      <tr><td style="padding:3px 0;"><strong>Date of Joining:</strong></td><td>${p(y.date_of_joining)}</td><td><strong>UAN:</strong></td><td>${y.uan||"—"}</td></tr>
      <tr><td style="padding:3px 0;"><strong>Bank A/C:</strong></td><td colspan="3">${y.bank_account||"—"}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
      <tr style="background:#f0f0f0;">
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Present:</strong> ${f.days_present||0}</td>
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Sundays:</strong> ${f.paid_sundays||0}</td>
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Payable:</strong> ${f.total_payable_days||0}</td>
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>LOP:</strong> ${f.lop_days||0}</td>
      </tr>
    </table>
    ${(()=>{const s=t.leaveSummary||{},c=[];return(s.cl||0)>0&&c.push(`<strong>CL:</strong> ${s.cl}`),(s.el||0)>0&&c.push(`<strong>EL:</strong> ${s.el}`),(s.sl||0)>0&&c.push(`<strong>SL:</strong> ${s.sl}`),(s.lwp||0)>0&&c.push(`<strong>LWP:</strong> ${s.lwp}`),(s.od||0)>0&&c.push(`<strong>OD:</strong> ${s.od}`),(s.shortLeave||0)>0&&c.push(`<strong>Short Lv:</strong> ${s.shortLeave}`),(s.uninformedAbsent||0)>0&&c.push(`<strong>Uninfo. Abs:</strong> ${s.uninformedAbsent}`),c.length===0?"":`<table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
      <tr style="background:#fef3c7;">
        <td style="padding:3px 6px;border:1px solid #fcd34d;" colspan="4"><strong>Leave Summary:</strong> ${c.join(" &nbsp;|&nbsp; ")}</td>
      </tr>
    </table>`})()}
    <div style="display:flex;gap:12px;">
      <div style="flex:1;"><table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr style="background:#e8f4fd;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Earnings</th></tr></thead>
        <tbody>${x}<tr style="background:#e8f4fd;font-weight:bold;"><td style="padding:4px 8px;border:1px solid #ddd;">Gross Earned</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${r(t.grossEarned)}</td></tr></tbody>
      </table></div>
      <div style="flex:1;"><table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr style="background:#fde8e8;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Deductions</th></tr></thead>
        <tbody>${m}<tr style="background:#fde8e8;font-weight:bold;"><td style="padding:4px 8px;border:1px solid #ddd;">Total Deductions</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${r(t.totalDeductions)}</td></tr></tbody>
      </table></div>
    </div>
    <div style="margin-top:12px;padding:10px;background:#e8fde8;border:2px solid #4caf50;text-align:center;font-size:14px;"><strong>Net Salary: ${r(t.netSalary)}</strong></div>${Z(h)}
    ${(t.otPay||0)>0||(t.edPay||0)>0||(t.holidayDutyPay||0)>0?`
    <div style="margin-top:6px;padding:8px 12px;background:#f0fdf4;border:1px solid #86efac;font-size:10px;">
      ${(t.otPay||0)>0?`<div style="display:flex;justify-content:space-between;"><span>+ OT Pay</span><span>${r(t.otPay)}</span></div>`:""}
      ${(t.holidayDutyPay||0)>0?`<div style="display:flex;justify-content:space-between;"><span>+ Holiday Duty Pay</span><span>${r(t.holidayDutyPay)}</span></div>`:""}
      ${(t.edPay||0)>0?`<div style="display:flex;justify-content:space-between;"><span>+ Extra Duty Pay (${t.edDays||0}d)</span><span>${r(t.edPay)}</span></div>`:""}
      <div style="display:flex;justify-content:space-between;margin-top:4px;padding-top:4px;border-top:1px solid #86efac;font-weight:bold;font-size:12px;">
        <span>TAKE HOME</span><span>${r(t.takeHome||t.totalPayable||t.netSalary)}</span>
      </div>
    </div>`:""}
    <div style="margin-top:8px;font-size:9px;color:#666;"><p>Employer PF: ${r(t.pfEmployer)} | Employer ESI: ${r(t.esiEmployer)}${(t.lwfEmployer||0)>0?` | Employer LWF: ${r(t.lwfEmployer)}`:""}</p></div>
  </div>`}async function nt(t,u,h=null){const y=(await V(async()=>{const{default:r}=await import("./html2pdf-71pfs1Tu.js").then(x=>x.h);return{default:r}},__vite__mapDeps([0,1,2]))).default,P=tt(t,u,h),f=document.createElement("div");f.innerHTML=P,document.body.appendChild(f);try{await y().set({margin:[5,5,5,5],filename:`Payslip_${t.employee.code}_${t.period.monthName}_${t.period.year}.pdf`,image:{type:"jpeg",quality:.98},html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(f).save()}finally{document.body.removeChild(f)}}async function at(t,u,h,y){const P=(await V(async()=>{const{default:m}=await import("./html2pdf-71pfs1Tu.js").then(p=>p.h);return{default:m}},__vite__mapDeps([0,1,2]))).default,f=X(t,u,h,y),r=document.createElement("div");r.innerHTML=f,document.body.appendChild(r);const x=Y[h]||h;try{await P().set({margin:[5,5,5,5],filename:`Salary_Slip_${x}_${y}.pdf`,image:{type:"jpeg",quality:.95},html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4",orientation:"landscape"},pagebreak:{mode:["css","legacy"]}}).from(r).save()}finally{document.body.removeChild(r)}}export{at as a,nt as d,Z as l};

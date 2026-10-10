const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/html2pdf-C4ZLKjc-.js","assets/index-DoJbVe0K.js","assets/index-C9bwjQJ-.css"])))=>i.map(i=>d[i]);
import{bq as G}from"./index-DoJbVe0K.js";const V=["","January","February","March","April","May","June","July","August","September","October","November","December"];function n(d){return Math.round(d||0).toLocaleString("en-IN")}const $="padding:3px 4px;border:1px solid #999;font-size:9px;",t=$+"text-align:right;font-family:monospace;",g="padding:4px 5px;border:1px solid #666;font-size:8px;font-weight:bold;background:#d9e2f3;text-align:center;";function B(d,h,u,y){var o,c,_,E,S,k,A,L,T,N,z,H,M,O,j,C,R,I,F,U,J,K;const P=(h==null?void 0:h.company_name)||"Company",f=V[u]||u,r={},x="__PERMANENT__";r[x]={label:"PERMANENT STAFF",employees:[]};for(const l of d){const b=l.employee,a=l.attendance||{},e=l.otPay||((c=(o=l.earnings)==null?void 0:o.find(s=>s.label==="OT Pay"))==null?void 0:c.amount)||0,D=l.edPay||((E=(_=l.earnings)==null?void 0:_.find(s=>s.label==="Extra Duty Pay"))==null?void 0:E.amount)||0,W=l.takeHome||(l.totalPayable||l.netSalary||0)+D,q={code:b.code,name:b.name||b.code,designation:b.designation||b.department||"",grossSalary:l.grossSalary||l.grossEarned||0,basic:((k=(S=l.earnings)==null?void 0:S.find(s=>{var i;return(i=s.label)==null?void 0:i.includes("Basic")}))==null?void 0:k.amount)||0,hra:((L=(A=l.earnings)==null?void 0:A.find(s=>{var i;return(i=s.label)==null?void 0:i.includes("HRA")}))==null?void 0:L.amount)||0,cca:0,conv:((N=(T=l.earnings)==null?void 0:T.find(s=>{var i;return(i=s.label)==null?void 0:i.includes("Conveyance")}))==null?void 0:N.amount)||0,totalEarned:l.grossEarned||0,otPay:e,edPay:D,advance:((H=(z=l.deductions)==null?void 0:z.find(s=>{var i;return(i=s.label)==null?void 0:i.includes("Advance")}))==null?void 0:H.amount)||0,pf:((O=(M=l.deductions)==null?void 0:M.find(s=>{var i,w;return((i=s.label)==null?void 0:i.includes("PF"))&&!((w=s.label)!=null&&w.includes("Employer"))}))==null?void 0:O.amount)||0,esi:((C=(j=l.deductions)==null?void 0:j.find(s=>{var i,w;return((i=s.label)==null?void 0:i.includes("ESI"))&&!((w=s.label)!=null&&w.includes("Employer"))}))==null?void 0:C.amount)||0,wlf:0,tds:((I=(R=l.deductions)==null?void 0:R.find(s=>{var i;return(i=s.label)==null?void 0:i.includes("TDS")}))==null?void 0:I.amount)||0,pt:((U=(F=l.deductions)==null?void 0:F.find(s=>{var i;return(i=s.label)==null?void 0:i.includes("Professional")}))==null?void 0:U.amount)||0,lateDed:((K=(J=l.deductions)==null?void 0:J.find(s=>{var i,w;return((i=s.label)==null?void 0:i.includes("LOP"))||((w=s.label)==null?void 0:w.includes("Late"))}))==null?void 0:K.amount)||0,days:a.days_present||0,el:a.el_used||0,sundays:a.paid_sundays||0,totalDays:a.total_payable_days||0,payable:l.grossEarned||0,netPayable:l.netSalary||0,takeHome:W,department:b.department||""},Y=l.is_contractor===1||l.is_contractor===!0,v=(b.department||"").toUpperCase();if(Y||l.is_contractor===void 0&&(v.includes("CONT")||v.includes("LAMBU")||v.includes("MEERA")||v.includes("KULDEEP")||v.includes("JIWAN")||v.includes("SUNNY")||v.includes("AMAR"))){const s=b.department||"CONTRACTOR";r[s]||(r[s]={label:s,employees:[]}),r[s].employees.push(q)}else r[x].employees.push(q)}let m=`<div style="font-family:Arial,sans-serif;padding:10px;">
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
      <tbody>`,p={gross:0,basic:0,totalEarned:0,otPay:0,edPay:0,advance:0,pf:0,esi:0,days:0,sundays:0,totalDays:0,payable:0,lateDed:0,netPayable:0,takeHome:0};for(const[l,b]of Object.entries(r)){if(b.employees.length===0)continue;l!==x&&(m+=`<tr><td colspan="19" style="padding:6px 5px;border:1px solid #999;font-weight:bold;background:#f0e6d2;font-size:10px;">${b.label}</td></tr>`);let a={gross:0,basic:0,totalEarned:0,otPay:0,edPay:0,advance:0,pf:0,esi:0,days:0,sundays:0,totalDays:0,payable:0,lateDed:0,netPayable:0,takeHome:0};b.employees.forEach((e,D)=>{a.gross+=e.grossSalary,a.basic+=e.basic,a.totalEarned+=e.totalEarned,a.otPay+=e.otPay,a.edPay+=e.edPay,a.advance+=e.advance,a.pf+=e.pf,a.esi+=e.esi,a.days+=e.days,a.sundays+=e.sundays,a.totalDays+=e.totalDays,a.payable+=e.payable,a.lateDed+=e.lateDed,a.netPayable+=e.netPayable,a.takeHome+=e.takeHome,m+=`<tr>
        <td style="${$}text-align:center;">${D+1}</td>
        <td style="${$}text-align:center;font-size:8px;">${e.code}</td>
        <td style="${$}font-weight:500;">${e.name}</td>
        <td style="${$}font-size:8px;">${e.designation}</td>
        <td style="${t}">${n(e.grossSalary)}</td>
        <td style="${t}">${n(e.basic)}</td>
        <td style="${t}">${n(e.totalEarned)}</td>
        <td style="${t}">${e.otPay?n(e.otPay):""}</td>
        <td style="${t}">${e.edPay?n(e.edPay):""}</td>
        <td style="${t}">${e.advance?n(e.advance):""}</td>
        <td style="${t}">${e.pf?n(e.pf):""}</td>
        <td style="${t}">${e.esi?n(e.esi):""}</td>
        <td style="${t}">${e.days}</td>
        <td style="${t}">${e.sundays||""}</td>
        <td style="${t}">${e.totalDays}</td>
        <td style="${t}font-weight:bold;">${n(e.payable)}</td>
        <td style="${t}">${e.lateDed?n(e.lateDed):""}</td>
        <td style="${t}font-weight:bold;">${n(e.netPayable)}</td>
        <td style="${t}font-weight:bold;background:#eaf6ec;">${n(e.takeHome)}</td>
        <td style="${$}"></td>
      </tr>`}),m+=`<tr style="background:#e8e8e8;font-weight:bold;">
      <td colspan="3" style="${$}text-align:right;font-weight:bold;">TOTAL</td>
      <td style="${$}"></td>
      <td style="${t}font-weight:bold;">${n(a.gross)}</td>
      <td style="${t}font-weight:bold;">${n(a.basic)}</td>
      <td style="${t}font-weight:bold;">${n(a.totalEarned)}</td>
      <td style="${t}font-weight:bold;">${n(a.otPay)}</td>
      <td style="${t}font-weight:bold;">${n(a.edPay)}</td>
      <td style="${t}font-weight:bold;">${n(a.advance)}</td>
      <td style="${t}font-weight:bold;">${n(a.pf)}</td>
      <td style="${t}font-weight:bold;">${n(a.esi)}</td>
      <td style="${t}font-weight:bold;">${a.days}</td>
      <td style="${t}font-weight:bold;">${a.sundays||""}</td>
      <td style="${t}font-weight:bold;">${a.totalDays}</td>
      <td style="${t}font-weight:bold;">${n(a.payable)}</td>
      <td style="${t}font-weight:bold;">${n(a.lateDed)}</td>
      <td style="${t}font-weight:bold;">${n(a.netPayable)}</td>
      <td style="${t}font-weight:bold;background:#cdebd6;">${n(a.takeHome)}</td>
      <td style="${$}"></td>
    </tr>`;for(const e of Object.keys(p))p[e]+=a[e]}return m+=`<tr style="background:#d9e2f3;font-weight:bold;">
    <td colspan="3" style="${$}text-align:right;font-weight:bold;font-size:10px;">GRAND TOTAL</td>
    <td style="${$}"></td>
    <td style="${t}font-weight:bold;">${n(p.gross)}</td>
    <td style="${t}font-weight:bold;">${n(p.basic)}</td>
    <td style="${t}font-weight:bold;">${n(p.totalEarned)}</td>
    <td style="${t}font-weight:bold;">${n(p.otPay)}</td>
    <td style="${t}font-weight:bold;">${n(p.edPay)}</td>
    <td style="${t}font-weight:bold;">${n(p.advance)}</td>
    <td style="${t}font-weight:bold;">${n(p.pf)}</td>
    <td style="${t}font-weight:bold;">${n(p.esi)}</td>
    <td style="${t}font-weight:bold;">${p.days}</td>
    <td style="${t}font-weight:bold;">${p.sundays||""}</td>
    <td style="${t}font-weight:bold;">${p.totalDays}</td>
    <td style="${t}font-weight:bold;">${n(p.payable)}</td>
    <td style="${t}font-weight:bold;">${n(p.lateDed)}</td>
    <td style="${t}font-weight:bold;font-size:10px;">${n(p.netPayable)}</td>
    <td style="${t}font-weight:bold;font-size:10px;background:#cdebd6;">${n(p.takeHome)}</td>
    <td style="${$}"></td>
  </tr>`,m+="</tbody></table></div>",m}function Q(d){if(!d||!d.show||!Array.isArray(d.loans)||d.loans.length===0)return"";const h=y=>Number(y||0).toLocaleString("en-IN",{minimumFractionDigits:0,maximumFractionDigits:2});return`<div data-loan-balance="1" style="margin-top:6px;padding:6px 12px;background:#f8fafc;border:1px solid #cbd5e1;font-size:10px;"><div style="display:flex;justify-content:space-between;">${d.loans.length===1?`<span>Loan outstanding after this month's EMI</span><span>&#8377;${h(d.loans[0].outstandingAfter)}</span>`:d.loans.map(y=>`<span>Loan #${y.loanId} (${y.loanType}) outstanding after this month's EMI</span><span>&#8377;${h(y.outstandingAfter)}</span>`).join('</div><div style="display:flex;justify-content:space-between;">')}</div></div>`}function X(d,h,u=null){const y=d.employee,P=y.company||"Company",f=d.attendance||{};function r(o){return Math.round(o||0).toLocaleString("en-IN")}const x=d.earnings.map(o=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${o.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${r(o.amount)}</td></tr>`).join(""),m=d.deductions.map(o=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${o.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${r(o.amount)}</td></tr>`).join(""),p=o=>{if(!o)return"—";const c=/^(\d{4})-(\d{2})-(\d{2})/.exec(o);return c?`${c[3]}/${c[2]}/${c[1]}`:o};return`<div style="font-family:Arial,sans-serif;font-size:11px;max-width:700px;margin:0 auto;padding:20px;page-break-after:always;">
    <div style="text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:15px;">
      <h2 style="margin:0;font-size:16px;">${P}</h2>
      <p style="margin:5px 0 0;font-size:12px;font-weight:bold;">Pay Slip for ${d.period.period}</p>
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
    ${(()=>{const o=d.leaveSummary||{},c=[];return(o.cl||0)>0&&c.push(`<strong>CL:</strong> ${o.cl}`),(o.el||0)>0&&c.push(`<strong>EL:</strong> ${o.el}`),(o.sl||0)>0&&c.push(`<strong>SL:</strong> ${o.sl}`),(o.lwp||0)>0&&c.push(`<strong>LWP:</strong> ${o.lwp}`),(o.od||0)>0&&c.push(`<strong>OD:</strong> ${o.od}`),(o.shortLeave||0)>0&&c.push(`<strong>Short Lv:</strong> ${o.shortLeave}`),(o.uninformedAbsent||0)>0&&c.push(`<strong>Uninfo. Abs:</strong> ${o.uninformedAbsent}`),c.length===0?"":`<table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
      <tr style="background:#fef3c7;">
        <td style="padding:3px 6px;border:1px solid #fcd34d;" colspan="4"><strong>Leave Summary:</strong> ${c.join(" &nbsp;|&nbsp; ")}</td>
      </tr>
    </table>`})()}
    <div style="display:flex;gap:12px;">
      <div style="flex:1;"><table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr style="background:#e8f4fd;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Earnings</th></tr></thead>
        <tbody>${x}<tr style="background:#e8f4fd;font-weight:bold;"><td style="padding:4px 8px;border:1px solid #ddd;">Gross Earned</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${r(d.grossEarned)}</td></tr></tbody>
      </table></div>
      <div style="flex:1;"><table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr style="background:#fde8e8;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Deductions</th></tr></thead>
        <tbody>${m}<tr style="background:#fde8e8;font-weight:bold;"><td style="padding:4px 8px;border:1px solid #ddd;">Total Deductions</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${r(d.totalDeductions)}</td></tr></tbody>
      </table></div>
    </div>
    <div style="margin-top:12px;padding:10px;background:#e8fde8;border:2px solid #4caf50;text-align:center;font-size:14px;"><strong>Net Salary: ${r(d.netSalary)}</strong></div>${Q(u)}
    ${(d.otPay||0)>0||(d.edPay||0)>0||(d.holidayDutyPay||0)>0?`
    <div style="margin-top:6px;padding:8px 12px;background:#f0fdf4;border:1px solid #86efac;font-size:10px;">
      ${(d.otPay||0)>0?`<div style="display:flex;justify-content:space-between;"><span>+ OT Pay</span><span>${r(d.otPay)}</span></div>`:""}
      ${(d.holidayDutyPay||0)>0?`<div style="display:flex;justify-content:space-between;"><span>+ Holiday Duty Pay</span><span>${r(d.holidayDutyPay)}</span></div>`:""}
      ${(d.edPay||0)>0?`<div style="display:flex;justify-content:space-between;"><span>+ Extra Duty Pay (${d.edDays||0}d)</span><span>${r(d.edPay)}</span></div>`:""}
      <div style="display:flex;justify-content:space-between;margin-top:4px;padding-top:4px;border-top:1px solid #86efac;font-weight:bold;font-size:12px;">
        <span>TAKE HOME</span><span>${r(d.takeHome||d.totalPayable||d.netSalary)}</span>
      </div>
    </div>`:""}
    <div style="margin-top:8px;font-size:9px;color:#666;"><p>Employer PF: ${r(d.pfEmployer)} | Employer ESI: ${r(d.esiEmployer)}</p></div>
  </div>`}async function et(d,h,u=null){const y=(await G(async()=>{const{default:r}=await import("./html2pdf-C4ZLKjc-.js").then(x=>x.h);return{default:r}},__vite__mapDeps([0,1,2]))).default,P=X(d,h,u),f=document.createElement("div");f.innerHTML=P,document.body.appendChild(f);try{await y().set({margin:[5,5,5,5],filename:`Payslip_${d.employee.code}_${d.period.monthName}_${d.period.year}.pdf`,image:{type:"jpeg",quality:.98},html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(f).save()}finally{document.body.removeChild(f)}}async function dt(d,h,u,y){const P=(await G(async()=>{const{default:m}=await import("./html2pdf-C4ZLKjc-.js").then(p=>p.h);return{default:m}},__vite__mapDeps([0,1,2]))).default,f=B(d,h,u,y),r=document.createElement("div");r.innerHTML=f,document.body.appendChild(r);const x=V[u]||u;try{await P().set({margin:[5,5,5,5],filename:`Salary_Slip_${x}_${y}.pdf`,image:{type:"jpeg",quality:.95},html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4",orientation:"landscape"},pagebreak:{mode:["css","legacy"]}}).from(r).save()}finally{document.body.removeChild(r)}}export{dt as a,et as d,Q as l};

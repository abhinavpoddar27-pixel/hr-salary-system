const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/html2pdf-DRxFiE2V.js","assets/index-CWAwBLmV.js","assets/index-BhRR70Sz.css"])))=>i.map(i=>d[i]);
import{aU as G}from"./index-CWAwBLmV.js";const q=["","January","February","March","April","May","June","July","August","September","October","November","December"];function o(n){return Math.round(n||0).toLocaleString("en-IN")}const $="padding:3px 4px;border:1px solid #999;font-size:9px;",e=$+"text-align:right;font-family:monospace;",r="padding:4px 5px;border:1px solid #666;font-size:8px;font-weight:bold;background:#d9e2f3;text-align:center;";function Y(n,x,y,u){var g,_,D,E,S,k,A,T,L,N,z,H,O,C,M,j,R,F,I,U,J,B;const f=(x==null?void 0:x.company_name)||"Company",p=q[y]||y,c={},w="__PERMANENT__";c[w]={label:"PERMANENT STAFF",employees:[]};for(const l of n){const b=l.employee,a=l.attendance||{},d=l.otPay||((_=(g=l.earnings)==null?void 0:g.find(s=>s.label==="OT Pay"))==null?void 0:_.amount)||0,v=l.edPay||((E=(D=l.earnings)==null?void 0:D.find(s=>s.label==="Extra Duty Pay"))==null?void 0:E.amount)||0,V=l.takeHome||(l.totalPayable||l.netSalary||0)+v,K={code:b.code,name:b.name||b.code,designation:b.designation||b.department||"",grossSalary:l.grossSalary||l.grossEarned||0,basic:((k=(S=l.earnings)==null?void 0:S.find(s=>{var i;return(i=s.label)==null?void 0:i.includes("Basic")}))==null?void 0:k.amount)||0,hra:((T=(A=l.earnings)==null?void 0:A.find(s=>{var i;return(i=s.label)==null?void 0:i.includes("HRA")}))==null?void 0:T.amount)||0,cca:0,conv:((N=(L=l.earnings)==null?void 0:L.find(s=>{var i;return(i=s.label)==null?void 0:i.includes("Conveyance")}))==null?void 0:N.amount)||0,totalEarned:l.grossEarned||0,otPay:d,edPay:v,advance:((H=(z=l.deductions)==null?void 0:z.find(s=>{var i;return(i=s.label)==null?void 0:i.includes("Advance")}))==null?void 0:H.amount)||0,pf:((C=(O=l.deductions)==null?void 0:O.find(s=>{var i,m;return((i=s.label)==null?void 0:i.includes("PF"))&&!((m=s.label)!=null&&m.includes("Employer"))}))==null?void 0:C.amount)||0,esi:((j=(M=l.deductions)==null?void 0:M.find(s=>{var i,m;return((i=s.label)==null?void 0:i.includes("ESI"))&&!((m=s.label)!=null&&m.includes("Employer"))}))==null?void 0:j.amount)||0,wlf:0,tds:((F=(R=l.deductions)==null?void 0:R.find(s=>{var i;return(i=s.label)==null?void 0:i.includes("TDS")}))==null?void 0:F.amount)||0,pt:((U=(I=l.deductions)==null?void 0:I.find(s=>{var i;return(i=s.label)==null?void 0:i.includes("Professional")}))==null?void 0:U.amount)||0,lateDed:((B=(J=l.deductions)==null?void 0:J.find(s=>{var i,m;return((i=s.label)==null?void 0:i.includes("LOP"))||((m=s.label)==null?void 0:m.includes("Late"))}))==null?void 0:B.amount)||0,days:a.days_present||0,el:a.el_used||0,sundays:a.paid_sundays||0,totalDays:a.total_payable_days||0,payable:l.grossEarned||0,netPayable:l.netSalary||0,takeHome:V,department:b.department||""},W=l.is_contractor===1||l.is_contractor===!0,P=(b.department||"").toUpperCase();if(W||l.is_contractor===void 0&&(P.includes("CONT")||P.includes("LAMBU")||P.includes("MEERA")||P.includes("KULDEEP")||P.includes("JIWAN")||P.includes("SUNNY")||P.includes("AMAR"))){const s=b.department||"CONTRACTOR";c[s]||(c[s]={label:s,employees:[]}),c[s].employees.push(K)}else c[w].employees.push(K)}let h=`<div style="font-family:Arial,sans-serif;padding:10px;">
    <h2 style="text-align:center;margin:0;font-size:14px;">${f.toUpperCase()}</h2>
    <p style="text-align:center;margin:2px 0 10px;font-size:12px;font-weight:bold;">SALARY SLIP ${p.toUpperCase()} ${u}</p>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="${r}width:30px;">S.No</th>
          <th style="${r}width:40px;">EMP</th>
          <th style="${r}text-align:left;min-width:100px;">Name</th>
          <th style="${r}text-align:left;min-width:70px;">Desig.</th>
          <th style="${r}">Gross</th>
          <th style="${r}">Basic</th>
          <th style="${r}">Total Earned</th>
          <th style="${r}">OT Pay</th>
          <th style="${r}">ED Pay</th>
          <th style="${r}">Advance</th>
          <th style="${r}">PF</th>
          <th style="${r}">ESI</th>
          <th style="${r}">Days</th>
          <th style="${r}">Sun</th>
          <th style="${r}">Tot Days</th>
          <th style="${r}">Payable</th>
          <th style="${r}">Late Ded</th>
          <th style="${r}font-weight:bold;">Net Pay</th>
          <th style="${r}font-weight:bold;background:#cdebd6;">Take Home</th>
          <th style="${r}width:50px;">Sign</th>
        </tr>
      </thead>
      <tbody>`,t={gross:0,basic:0,totalEarned:0,otPay:0,edPay:0,advance:0,pf:0,esi:0,days:0,sundays:0,totalDays:0,payable:0,lateDed:0,netPayable:0,takeHome:0};for(const[l,b]of Object.entries(c)){if(b.employees.length===0)continue;l!==w&&(h+=`<tr><td colspan="19" style="padding:6px 5px;border:1px solid #999;font-weight:bold;background:#f0e6d2;font-size:10px;">${b.label}</td></tr>`);let a={gross:0,basic:0,totalEarned:0,otPay:0,edPay:0,advance:0,pf:0,esi:0,days:0,sundays:0,totalDays:0,payable:0,lateDed:0,netPayable:0,takeHome:0};b.employees.forEach((d,v)=>{a.gross+=d.grossSalary,a.basic+=d.basic,a.totalEarned+=d.totalEarned,a.otPay+=d.otPay,a.edPay+=d.edPay,a.advance+=d.advance,a.pf+=d.pf,a.esi+=d.esi,a.days+=d.days,a.sundays+=d.sundays,a.totalDays+=d.totalDays,a.payable+=d.payable,a.lateDed+=d.lateDed,a.netPayable+=d.netPayable,a.takeHome+=d.takeHome,h+=`<tr>
        <td style="${$}text-align:center;">${v+1}</td>
        <td style="${$}text-align:center;font-size:8px;">${d.code}</td>
        <td style="${$}font-weight:500;">${d.name}</td>
        <td style="${$}font-size:8px;">${d.designation}</td>
        <td style="${e}">${o(d.grossSalary)}</td>
        <td style="${e}">${o(d.basic)}</td>
        <td style="${e}">${o(d.totalEarned)}</td>
        <td style="${e}">${d.otPay?o(d.otPay):""}</td>
        <td style="${e}">${d.edPay?o(d.edPay):""}</td>
        <td style="${e}">${d.advance?o(d.advance):""}</td>
        <td style="${e}">${d.pf?o(d.pf):""}</td>
        <td style="${e}">${d.esi?o(d.esi):""}</td>
        <td style="${e}">${d.days}</td>
        <td style="${e}">${d.sundays||""}</td>
        <td style="${e}">${d.totalDays}</td>
        <td style="${e}font-weight:bold;">${o(d.payable)}</td>
        <td style="${e}">${d.lateDed?o(d.lateDed):""}</td>
        <td style="${e}font-weight:bold;">${o(d.netPayable)}</td>
        <td style="${e}font-weight:bold;background:#eaf6ec;">${o(d.takeHome)}</td>
        <td style="${$}"></td>
      </tr>`}),h+=`<tr style="background:#e8e8e8;font-weight:bold;">
      <td colspan="3" style="${$}text-align:right;font-weight:bold;">TOTAL</td>
      <td style="${$}"></td>
      <td style="${e}font-weight:bold;">${o(a.gross)}</td>
      <td style="${e}font-weight:bold;">${o(a.basic)}</td>
      <td style="${e}font-weight:bold;">${o(a.totalEarned)}</td>
      <td style="${e}font-weight:bold;">${o(a.otPay)}</td>
      <td style="${e}font-weight:bold;">${o(a.edPay)}</td>
      <td style="${e}font-weight:bold;">${o(a.advance)}</td>
      <td style="${e}font-weight:bold;">${o(a.pf)}</td>
      <td style="${e}font-weight:bold;">${o(a.esi)}</td>
      <td style="${e}font-weight:bold;">${a.days}</td>
      <td style="${e}font-weight:bold;">${a.sundays||""}</td>
      <td style="${e}font-weight:bold;">${a.totalDays}</td>
      <td style="${e}font-weight:bold;">${o(a.payable)}</td>
      <td style="${e}font-weight:bold;">${o(a.lateDed)}</td>
      <td style="${e}font-weight:bold;">${o(a.netPayable)}</td>
      <td style="${e}font-weight:bold;background:#cdebd6;">${o(a.takeHome)}</td>
      <td style="${$}"></td>
    </tr>`;for(const d of Object.keys(t))t[d]+=a[d]}return h+=`<tr style="background:#d9e2f3;font-weight:bold;">
    <td colspan="3" style="${$}text-align:right;font-weight:bold;font-size:10px;">GRAND TOTAL</td>
    <td style="${$}"></td>
    <td style="${e}font-weight:bold;">${o(t.gross)}</td>
    <td style="${e}font-weight:bold;">${o(t.basic)}</td>
    <td style="${e}font-weight:bold;">${o(t.totalEarned)}</td>
    <td style="${e}font-weight:bold;">${o(t.otPay)}</td>
    <td style="${e}font-weight:bold;">${o(t.edPay)}</td>
    <td style="${e}font-weight:bold;">${o(t.advance)}</td>
    <td style="${e}font-weight:bold;">${o(t.pf)}</td>
    <td style="${e}font-weight:bold;">${o(t.esi)}</td>
    <td style="${e}font-weight:bold;">${t.days}</td>
    <td style="${e}font-weight:bold;">${t.sundays||""}</td>
    <td style="${e}font-weight:bold;">${t.totalDays}</td>
    <td style="${e}font-weight:bold;">${o(t.payable)}</td>
    <td style="${e}font-weight:bold;">${o(t.lateDed)}</td>
    <td style="${e}font-weight:bold;font-size:10px;">${o(t.netPayable)}</td>
    <td style="${e}font-weight:bold;font-size:10px;background:#cdebd6;">${o(t.takeHome)}</td>
    <td style="${$}"></td>
  </tr>`,h+="</tbody></table></div>",h}function Q(n,x){const y=n.employee,u=y.company||"Company",f=n.attendance||{};function p(t){return Math.round(t||0).toLocaleString("en-IN")}const c=n.earnings.map(t=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${t.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${p(t.amount)}</td></tr>`).join(""),w=n.deductions.map(t=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${t.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${p(t.amount)}</td></tr>`).join(""),h=t=>{if(!t)return"—";const g=/^(\d{4})-(\d{2})-(\d{2})/.exec(t);return g?`${g[3]}/${g[2]}/${g[1]}`:t};return`<div style="font-family:Arial,sans-serif;font-size:11px;max-width:700px;margin:0 auto;padding:20px;page-break-after:always;">
    <div style="text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:15px;">
      <h2 style="margin:0;font-size:16px;">${u}</h2>
      <p style="margin:5px 0 0;font-size:12px;font-weight:bold;">Pay Slip for ${n.period.period}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px;">
      <tr><td style="padding:3px 0;width:25%;"><strong>Name:</strong></td><td style="width:25%;">${y.name}</td><td style="width:25%;"><strong>Code:</strong></td><td style="width:25%;">${y.code}</td></tr>
      <tr><td style="padding:3px 0;"><strong>Department:</strong></td><td>${y.department}</td><td><strong>Designation:</strong></td><td>${y.designation}</td></tr>
      <tr><td style="padding:3px 0;"><strong>Date of Joining:</strong></td><td>${h(y.date_of_joining)}</td><td><strong>UAN:</strong></td><td>${y.uan||"—"}</td></tr>
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
    ${(()=>{const t=n.leaveSummary||{},g=[];return(t.cl||0)>0&&g.push(`<strong>CL:</strong> ${t.cl}`),(t.el||0)>0&&g.push(`<strong>EL:</strong> ${t.el}`),(t.sl||0)>0&&g.push(`<strong>SL:</strong> ${t.sl}`),(t.lwp||0)>0&&g.push(`<strong>LWP:</strong> ${t.lwp}`),(t.od||0)>0&&g.push(`<strong>OD:</strong> ${t.od}`),(t.shortLeave||0)>0&&g.push(`<strong>Short Lv:</strong> ${t.shortLeave}`),(t.uninformedAbsent||0)>0&&g.push(`<strong>Uninfo. Abs:</strong> ${t.uninformedAbsent}`),g.length===0?"":`<table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
      <tr style="background:#fef3c7;">
        <td style="padding:3px 6px;border:1px solid #fcd34d;" colspan="4"><strong>Leave Summary:</strong> ${g.join(" &nbsp;|&nbsp; ")}</td>
      </tr>
    </table>`})()}
    <div style="display:flex;gap:12px;">
      <div style="flex:1;"><table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr style="background:#e8f4fd;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Earnings</th></tr></thead>
        <tbody>${c}<tr style="background:#e8f4fd;font-weight:bold;"><td style="padding:4px 8px;border:1px solid #ddd;">Gross Earned</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${p(n.grossEarned)}</td></tr></tbody>
      </table></div>
      <div style="flex:1;"><table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr style="background:#fde8e8;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Deductions</th></tr></thead>
        <tbody>${w}<tr style="background:#fde8e8;font-weight:bold;"><td style="padding:4px 8px;border:1px solid #ddd;">Total Deductions</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${p(n.totalDeductions)}</td></tr></tbody>
      </table></div>
    </div>
    <div style="margin-top:12px;padding:10px;background:#e8fde8;border:2px solid #4caf50;text-align:center;font-size:14px;"><strong>Net Salary: ${p(n.netSalary)}</strong></div>
    ${(n.otPay||0)>0||(n.edPay||0)>0||(n.holidayDutyPay||0)>0?`
    <div style="margin-top:6px;padding:8px 12px;background:#f0fdf4;border:1px solid #86efac;font-size:10px;">
      ${(n.otPay||0)>0?`<div style="display:flex;justify-content:space-between;"><span>+ OT Pay</span><span>${p(n.otPay)}</span></div>`:""}
      ${(n.holidayDutyPay||0)>0?`<div style="display:flex;justify-content:space-between;"><span>+ Holiday Duty Pay</span><span>${p(n.holidayDutyPay)}</span></div>`:""}
      ${(n.edPay||0)>0?`<div style="display:flex;justify-content:space-between;"><span>+ Extra Duty Pay (${n.edDays||0}d)</span><span>${p(n.edPay)}</span></div>`:""}
      <div style="display:flex;justify-content:space-between;margin-top:4px;padding-top:4px;border-top:1px solid #86efac;font-weight:bold;font-size:12px;">
        <span>TAKE HOME</span><span>${p(n.takeHome||n.totalPayable||n.netSalary)}</span>
      </div>
    </div>`:""}
    <div style="margin-top:8px;font-size:9px;color:#666;"><p>Employer PF: ${p(n.pfEmployer)} | Employer ESI: ${p(n.esiEmployer)}</p></div>
  </div>`}async function tt(n,x){const y=(await G(async()=>{const{default:p}=await import("./html2pdf-DRxFiE2V.js").then(c=>c.h);return{default:p}},__vite__mapDeps([0,1,2]))).default,u=Q(n),f=document.createElement("div");f.innerHTML=u,document.body.appendChild(f);try{await y().set({margin:[5,5,5,5],filename:`Payslip_${n.employee.code}_${n.period.monthName}_${n.period.year}.pdf`,image:{type:"jpeg",quality:.98},html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(f).save()}finally{document.body.removeChild(f)}}async function et(n,x,y,u){const f=(await G(async()=>{const{default:h}=await import("./html2pdf-DRxFiE2V.js").then(t=>t.h);return{default:h}},__vite__mapDeps([0,1,2]))).default,p=Y(n,x,y,u),c=document.createElement("div");c.innerHTML=p,document.body.appendChild(c);const w=q[y]||y;try{await f().set({margin:[5,5,5,5],filename:`Salary_Slip_${w}_${u}.pdf`,image:{type:"jpeg",quality:.95},html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4",orientation:"landscape"},pagebreak:{mode:["css","legacy"]}}).from(c).save()}finally{document.body.removeChild(c)}}export{et as a,tt as d};

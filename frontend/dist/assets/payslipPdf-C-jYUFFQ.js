const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/html2pdf-C4hvKKM2.js","assets/index--FWwePcn.js","assets/index-gIOjWlo_.css"])))=>i.map(i=>d[i]);
import{am as G}from"./index--FWwePcn.js";const q=["","January","February","March","April","May","June","July","August","September","October","November","December"];function a(o){return Math.round(o||0).toLocaleString("en-IN")}const b="padding:3px 4px;border:1px solid #999;font-size:9px;",t=b+"text-align:right;font-family:monospace;",y="padding:4px 5px;border:1px solid #666;font-size:8px;font-weight:bold;background:#d9e2f3;text-align:center;";function W(o,m,r,h){var w,_,D,E,k,S,T,A,N,z,H,L,O,C,M,R,j,F,I,U,J,B;const g=(m==null?void 0:m.company_name)||"Company",p=q[r]||r,c={},x="__PERMANENT__";c[x]={label:"PERMANENT STAFF",employees:[]};for(const l of o){const f=l.employee,d=l.attendance||{},e=l.otPay||((_=(w=l.earnings)==null?void 0:w.find(s=>s.label==="OT Pay"))==null?void 0:_.amount)||0,v=l.edPay||((E=(D=l.earnings)==null?void 0:D.find(s=>s.label==="Extra Duty Pay"))==null?void 0:E.amount)||0,V=l.takeHome||(l.totalPayable||l.netSalary||0)+v,K={code:f.code,name:f.name||f.code,designation:f.designation||f.department||"",grossSalary:l.grossSalary||l.grossEarned||0,basic:((S=(k=l.earnings)==null?void 0:k.find(s=>{var i;return(i=s.label)==null?void 0:i.includes("Basic")}))==null?void 0:S.amount)||0,hra:((A=(T=l.earnings)==null?void 0:T.find(s=>{var i;return(i=s.label)==null?void 0:i.includes("HRA")}))==null?void 0:A.amount)||0,cca:0,conv:((z=(N=l.earnings)==null?void 0:N.find(s=>{var i;return(i=s.label)==null?void 0:i.includes("Conveyance")}))==null?void 0:z.amount)||0,totalEarned:l.grossEarned||0,otPay:e,edPay:v,advance:((L=(H=l.deductions)==null?void 0:H.find(s=>{var i;return(i=s.label)==null?void 0:i.includes("Advance")}))==null?void 0:L.amount)||0,pf:((C=(O=l.deductions)==null?void 0:O.find(s=>{var i,u;return((i=s.label)==null?void 0:i.includes("PF"))&&!((u=s.label)!=null&&u.includes("Employer"))}))==null?void 0:C.amount)||0,esi:((R=(M=l.deductions)==null?void 0:M.find(s=>{var i,u;return((i=s.label)==null?void 0:i.includes("ESI"))&&!((u=s.label)!=null&&u.includes("Employer"))}))==null?void 0:R.amount)||0,wlf:0,tds:((F=(j=l.deductions)==null?void 0:j.find(s=>{var i;return(i=s.label)==null?void 0:i.includes("TDS")}))==null?void 0:F.amount)||0,pt:((U=(I=l.deductions)==null?void 0:I.find(s=>{var i;return(i=s.label)==null?void 0:i.includes("Professional")}))==null?void 0:U.amount)||0,lateDed:((B=(J=l.deductions)==null?void 0:J.find(s=>{var i,u;return((i=s.label)==null?void 0:i.includes("LOP"))||((u=s.label)==null?void 0:u.includes("Late"))}))==null?void 0:B.amount)||0,days:d.days_present||0,el:d.el_used||0,sundays:d.paid_sundays||0,totalDays:d.total_payable_days||0,payable:l.grossEarned||0,netPayable:l.netSalary||0,takeHome:V,department:f.department||""},Y=l.is_contractor===1||l.is_contractor===!0,P=(f.department||"").toUpperCase();if(Y||l.is_contractor===void 0&&(P.includes("CONT")||P.includes("LAMBU")||P.includes("MEERA")||P.includes("KULDEEP")||P.includes("JIWAN")||P.includes("SUNNY")||P.includes("AMAR"))){const s=f.department||"CONTRACTOR";c[s]||(c[s]={label:s,employees:[]}),c[s].employees.push(K)}else c[x].employees.push(K)}let $=`<div style="font-family:Arial,sans-serif;padding:10px;">
    <h2 style="text-align:center;margin:0;font-size:14px;">${g.toUpperCase()}</h2>
    <p style="text-align:center;margin:2px 0 10px;font-size:12px;font-weight:bold;">SALARY SLIP ${p.toUpperCase()} ${h}</p>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="${y}width:30px;">S.No</th>
          <th style="${y}width:40px;">EMP</th>
          <th style="${y}text-align:left;min-width:100px;">Name</th>
          <th style="${y}text-align:left;min-width:70px;">Desig.</th>
          <th style="${y}">Gross</th>
          <th style="${y}">Basic</th>
          <th style="${y}">Total Earned</th>
          <th style="${y}">OT Pay</th>
          <th style="${y}">ED Pay</th>
          <th style="${y}">Advance</th>
          <th style="${y}">PF</th>
          <th style="${y}">ESI</th>
          <th style="${y}">Days</th>
          <th style="${y}">Sun</th>
          <th style="${y}">Tot Days</th>
          <th style="${y}">Payable</th>
          <th style="${y}">Late Ded</th>
          <th style="${y}font-weight:bold;">Net Pay</th>
          <th style="${y}font-weight:bold;background:#cdebd6;">Take Home</th>
          <th style="${y}width:50px;">Sign</th>
        </tr>
      </thead>
      <tbody>`,n={gross:0,basic:0,totalEarned:0,otPay:0,edPay:0,advance:0,pf:0,esi:0,days:0,sundays:0,totalDays:0,payable:0,lateDed:0,netPayable:0,takeHome:0};for(const[l,f]of Object.entries(c)){if(f.employees.length===0)continue;l!==x&&($+=`<tr><td colspan="19" style="padding:6px 5px;border:1px solid #999;font-weight:bold;background:#f0e6d2;font-size:10px;">${f.label}</td></tr>`);let d={gross:0,basic:0,totalEarned:0,otPay:0,edPay:0,advance:0,pf:0,esi:0,days:0,sundays:0,totalDays:0,payable:0,lateDed:0,netPayable:0,takeHome:0};f.employees.forEach((e,v)=>{d.gross+=e.grossSalary,d.basic+=e.basic,d.totalEarned+=e.totalEarned,d.otPay+=e.otPay,d.edPay+=e.edPay,d.advance+=e.advance,d.pf+=e.pf,d.esi+=e.esi,d.days+=e.days,d.sundays+=e.sundays,d.totalDays+=e.totalDays,d.payable+=e.payable,d.lateDed+=e.lateDed,d.netPayable+=e.netPayable,d.takeHome+=e.takeHome,$+=`<tr>
        <td style="${b}text-align:center;">${v+1}</td>
        <td style="${b}text-align:center;font-size:8px;">${e.code}</td>
        <td style="${b}font-weight:500;">${e.name}</td>
        <td style="${b}font-size:8px;">${e.designation}</td>
        <td style="${t}">${a(e.grossSalary)}</td>
        <td style="${t}">${a(e.basic)}</td>
        <td style="${t}">${a(e.totalEarned)}</td>
        <td style="${t}">${e.otPay?a(e.otPay):""}</td>
        <td style="${t}">${e.edPay?a(e.edPay):""}</td>
        <td style="${t}">${e.advance?a(e.advance):""}</td>
        <td style="${t}">${e.pf?a(e.pf):""}</td>
        <td style="${t}">${e.esi?a(e.esi):""}</td>
        <td style="${t}">${e.days}</td>
        <td style="${t}">${e.sundays||""}</td>
        <td style="${t}">${e.totalDays}</td>
        <td style="${t}font-weight:bold;">${a(e.payable)}</td>
        <td style="${t}">${e.lateDed?a(e.lateDed):""}</td>
        <td style="${t}font-weight:bold;">${a(e.netPayable)}</td>
        <td style="${t}font-weight:bold;background:#eaf6ec;">${a(e.takeHome)}</td>
        <td style="${b}"></td>
      </tr>`}),$+=`<tr style="background:#e8e8e8;font-weight:bold;">
      <td colspan="3" style="${b}text-align:right;font-weight:bold;">TOTAL</td>
      <td style="${b}"></td>
      <td style="${t}font-weight:bold;">${a(d.gross)}</td>
      <td style="${t}font-weight:bold;">${a(d.basic)}</td>
      <td style="${t}font-weight:bold;">${a(d.totalEarned)}</td>
      <td style="${t}font-weight:bold;">${a(d.otPay)}</td>
      <td style="${t}font-weight:bold;">${a(d.edPay)}</td>
      <td style="${t}font-weight:bold;">${a(d.advance)}</td>
      <td style="${t}font-weight:bold;">${a(d.pf)}</td>
      <td style="${t}font-weight:bold;">${a(d.esi)}</td>
      <td style="${t}font-weight:bold;">${d.days}</td>
      <td style="${t}font-weight:bold;">${d.sundays||""}</td>
      <td style="${t}font-weight:bold;">${d.totalDays}</td>
      <td style="${t}font-weight:bold;">${a(d.payable)}</td>
      <td style="${t}font-weight:bold;">${a(d.lateDed)}</td>
      <td style="${t}font-weight:bold;">${a(d.netPayable)}</td>
      <td style="${t}font-weight:bold;background:#cdebd6;">${a(d.takeHome)}</td>
      <td style="${b}"></td>
    </tr>`;for(const e of Object.keys(n))n[e]+=d[e]}return $+=`<tr style="background:#d9e2f3;font-weight:bold;">
    <td colspan="3" style="${b}text-align:right;font-weight:bold;font-size:10px;">GRAND TOTAL</td>
    <td style="${b}"></td>
    <td style="${t}font-weight:bold;">${a(n.gross)}</td>
    <td style="${t}font-weight:bold;">${a(n.basic)}</td>
    <td style="${t}font-weight:bold;">${a(n.totalEarned)}</td>
    <td style="${t}font-weight:bold;">${a(n.otPay)}</td>
    <td style="${t}font-weight:bold;">${a(n.edPay)}</td>
    <td style="${t}font-weight:bold;">${a(n.advance)}</td>
    <td style="${t}font-weight:bold;">${a(n.pf)}</td>
    <td style="${t}font-weight:bold;">${a(n.esi)}</td>
    <td style="${t}font-weight:bold;">${n.days}</td>
    <td style="${t}font-weight:bold;">${n.sundays||""}</td>
    <td style="${t}font-weight:bold;">${n.totalDays}</td>
    <td style="${t}font-weight:bold;">${a(n.payable)}</td>
    <td style="${t}font-weight:bold;">${a(n.lateDed)}</td>
    <td style="${t}font-weight:bold;font-size:10px;">${a(n.netPayable)}</td>
    <td style="${t}font-weight:bold;font-size:10px;background:#cdebd6;">${a(n.takeHome)}</td>
    <td style="${b}"></td>
  </tr>`,$+="</tbody></table></div>",$}function Q(o,m){const r=o.employee,h=r.company||"Company",g=o.attendance||{};function p(n){return Math.round(n||0).toLocaleString("en-IN")}const c=o.earnings.map(n=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${n.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${p(n.amount)}</td></tr>`).join(""),x=o.deductions.map(n=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${n.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${p(n.amount)}</td></tr>`).join(""),$=n=>{if(!n)return"—";const w=/^(\d{4})-(\d{2})-(\d{2})/.exec(n);return w?`${w[3]}/${w[2]}/${w[1]}`:n};return`<div style="font-family:Arial,sans-serif;font-size:11px;max-width:700px;margin:0 auto;padding:20px;page-break-after:always;">
    <div style="text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:15px;">
      <h2 style="margin:0;font-size:16px;">${h}</h2>
      <p style="margin:5px 0 0;font-size:12px;font-weight:bold;">Pay Slip for ${o.period.period}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px;">
      <tr><td style="padding:3px 0;width:25%;"><strong>Name:</strong></td><td style="width:25%;">${r.name}</td><td style="width:25%;"><strong>Code:</strong></td><td style="width:25%;">${r.code}</td></tr>
      <tr><td style="padding:3px 0;"><strong>Department:</strong></td><td>${r.department}</td><td><strong>Designation:</strong></td><td>${r.designation}</td></tr>
      <tr><td style="padding:3px 0;"><strong>Date of Joining:</strong></td><td>${$(r.date_of_joining)}</td><td><strong>UAN:</strong></td><td>${r.uan||"—"}</td></tr>
      <tr><td style="padding:3px 0;"><strong>Bank A/C:</strong></td><td colspan="3">${r.bank_account||"—"}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
      <tr style="background:#f0f0f0;">
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Present:</strong> ${g.days_present||0}</td>
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Sundays:</strong> ${g.paid_sundays||0}</td>
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Payable:</strong> ${g.total_payable_days||0}</td>
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>LOP:</strong> ${g.lop_days||0}</td>
      </tr>
    </table>
    <div style="display:flex;gap:12px;">
      <div style="flex:1;"><table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr style="background:#e8f4fd;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Earnings</th></tr></thead>
        <tbody>${c}<tr style="background:#e8f4fd;font-weight:bold;"><td style="padding:4px 8px;border:1px solid #ddd;">Gross Earned</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${p(o.grossEarned)}</td></tr></tbody>
      </table></div>
      <div style="flex:1;"><table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr style="background:#fde8e8;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Deductions</th></tr></thead>
        <tbody>${x}<tr style="background:#fde8e8;font-weight:bold;"><td style="padding:4px 8px;border:1px solid #ddd;">Total Deductions</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${p(o.totalDeductions)}</td></tr></tbody>
      </table></div>
    </div>
    <div style="margin-top:12px;padding:10px;background:#e8fde8;border:2px solid #4caf50;text-align:center;font-size:14px;"><strong>Net Salary: ${p(o.netSalary)}</strong></div>
    ${(o.otPay||0)>0||(o.edPay||0)>0||(o.holidayDutyPay||0)>0?`
    <div style="margin-top:6px;padding:8px 12px;background:#f0fdf4;border:1px solid #86efac;font-size:10px;">
      ${(o.otPay||0)>0?`<div style="display:flex;justify-content:space-between;"><span>+ OT Pay</span><span>${p(o.otPay)}</span></div>`:""}
      ${(o.holidayDutyPay||0)>0?`<div style="display:flex;justify-content:space-between;"><span>+ Holiday Duty Pay</span><span>${p(o.holidayDutyPay)}</span></div>`:""}
      ${(o.edPay||0)>0?`<div style="display:flex;justify-content:space-between;"><span>+ Extra Duty Pay (${o.edDays||0}d)</span><span>${p(o.edPay)}</span></div>`:""}
      <div style="display:flex;justify-content:space-between;margin-top:4px;padding-top:4px;border-top:1px solid #86efac;font-weight:bold;font-size:12px;">
        <span>TAKE HOME</span><span>${p(o.takeHome||o.totalPayable||o.netSalary)}</span>
      </div>
    </div>`:""}
    <div style="margin-top:8px;font-size:9px;color:#666;"><p>Employer PF: ${p(o.pfEmployer)} | Employer ESI: ${p(o.esiEmployer)}</p></div>
  </div>`}async function tt(o,m){const r=(await G(async()=>{const{default:p}=await import("./html2pdf-C4hvKKM2.js").then(c=>c.h);return{default:p}},__vite__mapDeps([0,1,2]))).default,h=Q(o),g=document.createElement("div");g.innerHTML=h,document.body.appendChild(g);try{await r().set({margin:[5,5,5,5],filename:`Payslip_${o.employee.code}_${o.period.monthName}_${o.period.year}.pdf`,image:{type:"jpeg",quality:.98},html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(g).save()}finally{document.body.removeChild(g)}}async function et(o,m,r,h){const g=(await G(async()=>{const{default:$}=await import("./html2pdf-C4hvKKM2.js").then(n=>n.h);return{default:$}},__vite__mapDeps([0,1,2]))).default,p=W(o,m,r,h),c=document.createElement("div");c.innerHTML=p,document.body.appendChild(c);const x=q[r]||r;try{await g().set({margin:[5,5,5,5],filename:`Salary_Slip_${x}_${h}.pdf`,image:{type:"jpeg",quality:.95},html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4",orientation:"landscape"},pagebreak:{mode:["css","legacy"]}}).from(c).save()}finally{document.body.removeChild(c)}}export{et as a,tt as d};

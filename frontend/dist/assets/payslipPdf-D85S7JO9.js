const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/html2pdf-BBeNh6NP.js","assets/index-CSCE4nw4.js","assets/index-CzI7mgWX.css"])))=>i.map(i=>d[i]);
import{am as U}from"./index-CSCE4nw4.js";const H=["","January","February","March","April","May","June","July","August","September","October","November","December"];function n(s){return Math.round(s||0).toLocaleString("en-IN")}const f="padding:3px 4px;border:1px solid #999;font-size:9px;",e=f+"text-align:right;font-family:monospace;",y="padding:4px 5px;border:1px solid #666;font-size:8px;font-weight:bold;background:#d9e2f3;text-align:center;";function J(s,m,r,h){var w,E,D,P,S,A,N,T,k,z,L,C,M,O,R,F,I,j;const c=(m==null?void 0:m.company_name)||"Company",g=H[r]||r,p={},x="__PERMANENT__";p[x]={label:"PERMANENT STAFF",employees:[]};for(const i of s){const b=i.employee,d=i.attendance||{},t={code:b.code,name:b.name||b.code,designation:b.designation||b.department||"",grossSalary:i.grossSalary||i.grossEarned||0,basic:((E=(w=i.earnings)==null?void 0:w.find(l=>{var o;return(o=l.label)==null?void 0:o.includes("Basic")}))==null?void 0:E.amount)||0,hra:((P=(D=i.earnings)==null?void 0:D.find(l=>{var o;return(o=l.label)==null?void 0:o.includes("HRA")}))==null?void 0:P.amount)||0,cca:0,conv:((A=(S=i.earnings)==null?void 0:S.find(l=>{var o;return(o=l.label)==null?void 0:o.includes("Conveyance")}))==null?void 0:A.amount)||0,totalEarned:i.grossEarned||0,advance:((T=(N=i.deductions)==null?void 0:N.find(l=>{var o;return(o=l.label)==null?void 0:o.includes("Advance")}))==null?void 0:T.amount)||0,pf:((z=(k=i.deductions)==null?void 0:k.find(l=>{var o,u;return((o=l.label)==null?void 0:o.includes("PF"))&&!((u=l.label)!=null&&u.includes("Employer"))}))==null?void 0:z.amount)||0,esi:((C=(L=i.deductions)==null?void 0:L.find(l=>{var o,u;return((o=l.label)==null?void 0:o.includes("ESI"))&&!((u=l.label)!=null&&u.includes("Employer"))}))==null?void 0:C.amount)||0,wlf:0,tds:((O=(M=i.deductions)==null?void 0:M.find(l=>{var o;return(o=l.label)==null?void 0:o.includes("TDS")}))==null?void 0:O.amount)||0,pt:((F=(R=i.deductions)==null?void 0:R.find(l=>{var o;return(o=l.label)==null?void 0:o.includes("Professional")}))==null?void 0:F.amount)||0,lateDed:((j=(I=i.deductions)==null?void 0:I.find(l=>{var o,u;return((o=l.label)==null?void 0:o.includes("LOP"))||((u=l.label)==null?void 0:u.includes("Late"))}))==null?void 0:j.amount)||0,days:d.days_present||0,el:d.el_used||0,sundays:d.paid_sundays||0,totalDays:d.total_payable_days||0,payable:i.grossEarned||0,netPayable:i.netSalary||0,department:b.department||""},v=i.is_contractor===1||i.is_contractor===!0,_=(b.department||"").toUpperCase();if(v||i.is_contractor===void 0&&(_.includes("CONT")||_.includes("LAMBU")||_.includes("MEERA")||_.includes("KULDEEP")||_.includes("JIWAN")||_.includes("SUNNY")||_.includes("AMAR"))){const l=b.department||"CONTRACTOR";p[l]||(p[l]={label:l,employees:[]}),p[l].employees.push(t)}else p[x].employees.push(t)}let $=`<div style="font-family:Arial,sans-serif;padding:10px;">
    <h2 style="text-align:center;margin:0;font-size:14px;">${c.toUpperCase()}</h2>
    <p style="text-align:center;margin:2px 0 10px;font-size:12px;font-weight:bold;">SALARY SLIP ${g.toUpperCase()} ${h}</p>
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
          <th style="${y}">Advance</th>
          <th style="${y}">PF</th>
          <th style="${y}">ESI</th>
          <th style="${y}">Days</th>
          <th style="${y}">Sun</th>
          <th style="${y}">Tot Days</th>
          <th style="${y}">Payable</th>
          <th style="${y}">Late Ded</th>
          <th style="${y}font-weight:bold;">Net Pay</th>
          <th style="${y}width:50px;">Sign</th>
        </tr>
      </thead>
      <tbody>`,a={gross:0,basic:0,totalEarned:0,advance:0,pf:0,esi:0,days:0,sundays:0,totalDays:0,payable:0,lateDed:0,netPayable:0};for(const[i,b]of Object.entries(p)){if(b.employees.length===0)continue;i!==x&&($+=`<tr><td colspan="17" style="padding:6px 5px;border:1px solid #999;font-weight:bold;background:#f0e6d2;font-size:10px;">${b.label}</td></tr>`);let d={gross:0,basic:0,totalEarned:0,advance:0,pf:0,esi:0,days:0,sundays:0,totalDays:0,payable:0,lateDed:0,netPayable:0};b.employees.forEach((t,v)=>{d.gross+=t.grossSalary,d.basic+=t.basic,d.totalEarned+=t.totalEarned,d.advance+=t.advance,d.pf+=t.pf,d.esi+=t.esi,d.days+=t.days,d.sundays+=t.sundays,d.totalDays+=t.totalDays,d.payable+=t.payable,d.lateDed+=t.lateDed,d.netPayable+=t.netPayable,$+=`<tr>
        <td style="${f}text-align:center;">${v+1}</td>
        <td style="${f}text-align:center;font-size:8px;">${t.code}</td>
        <td style="${f}font-weight:500;">${t.name}</td>
        <td style="${f}font-size:8px;">${t.designation}</td>
        <td style="${e}">${n(t.grossSalary)}</td>
        <td style="${e}">${n(t.basic)}</td>
        <td style="${e}">${n(t.totalEarned)}</td>
        <td style="${e}">${t.advance?n(t.advance):""}</td>
        <td style="${e}">${t.pf?n(t.pf):""}</td>
        <td style="${e}">${t.esi?n(t.esi):""}</td>
        <td style="${e}">${t.days}</td>
        <td style="${e}">${t.sundays||""}</td>
        <td style="${e}">${t.totalDays}</td>
        <td style="${e}font-weight:bold;">${n(t.payable)}</td>
        <td style="${e}">${t.lateDed?n(t.lateDed):""}</td>
        <td style="${e}font-weight:bold;">${n(t.netPayable)}</td>
        <td style="${f}"></td>
      </tr>`}),$+=`<tr style="background:#e8e8e8;font-weight:bold;">
      <td colspan="3" style="${f}text-align:right;font-weight:bold;">TOTAL</td>
      <td style="${f}"></td>
      <td style="${e}font-weight:bold;">${n(d.gross)}</td>
      <td style="${e}font-weight:bold;">${n(d.basic)}</td>
      <td style="${e}font-weight:bold;">${n(d.totalEarned)}</td>
      <td style="${e}font-weight:bold;">${n(d.advance)}</td>
      <td style="${e}font-weight:bold;">${n(d.pf)}</td>
      <td style="${e}font-weight:bold;">${n(d.esi)}</td>
      <td style="${e}font-weight:bold;">${d.days}</td>
      <td style="${e}font-weight:bold;">${d.sundays||""}</td>
      <td style="${e}font-weight:bold;">${d.totalDays}</td>
      <td style="${e}font-weight:bold;">${n(d.payable)}</td>
      <td style="${e}font-weight:bold;">${n(d.lateDed)}</td>
      <td style="${e}font-weight:bold;">${n(d.netPayable)}</td>
      <td style="${f}"></td>
    </tr>`;for(const t of Object.keys(a))a[t]+=d[t]}return $+=`<tr style="background:#d9e2f3;font-weight:bold;">
    <td colspan="3" style="${f}text-align:right;font-weight:bold;font-size:10px;">GRAND TOTAL</td>
    <td style="${f}"></td>
    <td style="${e}font-weight:bold;">${n(a.gross)}</td>
    <td style="${e}font-weight:bold;">${n(a.basic)}</td>
    <td style="${e}font-weight:bold;">${n(a.totalEarned)}</td>
    <td style="${e}font-weight:bold;">${n(a.advance)}</td>
    <td style="${e}font-weight:bold;">${n(a.pf)}</td>
    <td style="${e}font-weight:bold;">${n(a.esi)}</td>
    <td style="${e}font-weight:bold;">${a.days}</td>
    <td style="${e}font-weight:bold;">${a.sundays||""}</td>
    <td style="${e}font-weight:bold;">${a.totalDays}</td>
    <td style="${e}font-weight:bold;">${n(a.payable)}</td>
    <td style="${e}font-weight:bold;">${n(a.lateDed)}</td>
    <td style="${e}font-weight:bold;font-size:10px;">${n(a.netPayable)}</td>
    <td style="${f}"></td>
  </tr>`,$+="</tbody></table></div>",$}function B(s,m){const r=s.employee,h=r.company||"Company",c=s.attendance||{};function g(a){return Math.round(a||0).toLocaleString("en-IN")}const p=s.earnings.map(a=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${a.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${g(a.amount)}</td></tr>`).join(""),x=s.deductions.map(a=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${a.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${g(a.amount)}</td></tr>`).join(""),$=a=>{if(!a)return"—";const w=/^(\d{4})-(\d{2})-(\d{2})/.exec(a);return w?`${w[3]}/${w[2]}/${w[1]}`:a};return`<div style="font-family:Arial,sans-serif;font-size:11px;max-width:700px;margin:0 auto;padding:20px;page-break-after:always;">
    <div style="text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:15px;">
      <h2 style="margin:0;font-size:16px;">${h}</h2>
      <p style="margin:5px 0 0;font-size:12px;font-weight:bold;">Pay Slip for ${s.period.period}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px;">
      <tr><td style="padding:3px 0;width:25%;"><strong>Name:</strong></td><td style="width:25%;">${r.name}</td><td style="width:25%;"><strong>Code:</strong></td><td style="width:25%;">${r.code}</td></tr>
      <tr><td style="padding:3px 0;"><strong>Department:</strong></td><td>${r.department}</td><td><strong>Designation:</strong></td><td>${r.designation}</td></tr>
      <tr><td style="padding:3px 0;"><strong>Date of Joining:</strong></td><td>${$(r.date_of_joining)}</td><td><strong>UAN:</strong></td><td>${r.uan||"—"}</td></tr>
      <tr><td style="padding:3px 0;"><strong>Bank A/C:</strong></td><td colspan="3">${r.bank_account||"—"}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
      <tr style="background:#f0f0f0;">
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Present:</strong> ${c.days_present||0}</td>
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Sundays:</strong> ${c.paid_sundays||0}</td>
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>Payable:</strong> ${c.total_payable_days||0}</td>
        <td style="padding:3px 6px;border:1px solid #ddd;"><strong>LOP:</strong> ${c.lop_days||0}</td>
      </tr>
    </table>
    <div style="display:flex;gap:12px;">
      <div style="flex:1;"><table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr style="background:#e8f4fd;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Earnings</th></tr></thead>
        <tbody>${p}<tr style="background:#e8f4fd;font-weight:bold;"><td style="padding:4px 8px;border:1px solid #ddd;">Gross Earned</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${g(s.grossEarned)}</td></tr></tbody>
      </table></div>
      <div style="flex:1;"><table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr style="background:#fde8e8;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Deductions</th></tr></thead>
        <tbody>${x}<tr style="background:#fde8e8;font-weight:bold;"><td style="padding:4px 8px;border:1px solid #ddd;">Total Deductions</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${g(s.totalDeductions)}</td></tr></tbody>
      </table></div>
    </div>
    <div style="margin-top:12px;padding:10px;background:#e8fde8;border:2px solid #4caf50;text-align:center;font-size:14px;"><strong>Net Salary: ${g(s.netSalary)}</strong></div>
    <div style="margin-top:8px;font-size:9px;color:#666;"><p>Employer PF: ${g(s.pfEmployer)} | Employer ESI: ${g(s.esiEmployer)}</p></div>
  </div>`}async function q(s,m){const r=(await U(async()=>{const{default:g}=await import("./html2pdf-BBeNh6NP.js").then(p=>p.h);return{default:g}},__vite__mapDeps([0,1,2]))).default,h=B(s),c=document.createElement("div");c.innerHTML=h,document.body.appendChild(c);try{await r().set({margin:[5,5,5,5],filename:`Payslip_${s.employee.code}_${s.period.monthName}_${s.period.year}.pdf`,image:{type:"jpeg",quality:.98},html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(c).save()}finally{document.body.removeChild(c)}}async function V(s,m,r,h){const c=(await U(async()=>{const{default:$}=await import("./html2pdf-BBeNh6NP.js").then(a=>a.h);return{default:$}},__vite__mapDeps([0,1,2]))).default,g=J(s,m,r,h),p=document.createElement("div");p.innerHTML=g,document.body.appendChild(p);const x=H[r]||r;try{await c().set({margin:[5,5,5,5],filename:`Salary_Slip_${x}_${h}.pdf`,image:{type:"jpeg",quality:.95},html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4",orientation:"landscape"},pagebreak:{mode:["css","legacy"]}}).from(p).save()}finally{document.body.removeChild(p)}}export{V as a,q as d};

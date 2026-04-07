const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/html2pdf-DFyiW5IA.js","assets/index-C2GSWo2h.js","assets/index-CzI7mgWX.css"])))=>i.map(i=>d[i]);
import{am as U}from"./index-C2GSWo2h.js";const H=["","January","February","March","April","May","June","July","August","September","October","November","December"];function a(l){return Math.round(l||0).toLocaleString("en-IN")}const $="padding:3px 4px;border:1px solid #999;font-size:9px;",e=$+"text-align:right;font-family:monospace;",i="padding:4px 5px;border:1px solid #666;font-size:8px;font-weight:bold;background:#d9e2f3;text-align:center;";function B(l,m,r,h){var v,E,D,P,S,A,N,T,k,z,L,C,M,R,O,F,I,j;const g=(m==null?void 0:m.company_name)||"Company",b=H[r]||r,c={},x="__PERMANENT__";c[x]={label:"PERMANENT STAFF",employees:[]};for(const s of l){const f=s.employee,d=s.attendance||{},t={code:f.code,name:f.name||f.code,designation:f.designation||f.department||"",grossSalary:s.grossSalary||s.grossEarned||0,basic:((E=(v=s.earnings)==null?void 0:v.find(o=>{var n;return(n=o.label)==null?void 0:n.includes("Basic")}))==null?void 0:E.amount)||0,hra:((P=(D=s.earnings)==null?void 0:D.find(o=>{var n;return(n=o.label)==null?void 0:n.includes("HRA")}))==null?void 0:P.amount)||0,cca:0,conv:((A=(S=s.earnings)==null?void 0:S.find(o=>{var n;return(n=o.label)==null?void 0:n.includes("Conveyance")}))==null?void 0:A.amount)||0,totalEarned:s.grossEarned||0,advance:((T=(N=s.deductions)==null?void 0:N.find(o=>{var n;return(n=o.label)==null?void 0:n.includes("Advance")}))==null?void 0:T.amount)||0,pf:((z=(k=s.deductions)==null?void 0:k.find(o=>{var n,u;return((n=o.label)==null?void 0:n.includes("PF"))&&!((u=o.label)!=null&&u.includes("Employer"))}))==null?void 0:z.amount)||0,esi:((C=(L=s.deductions)==null?void 0:L.find(o=>{var n,u;return((n=o.label)==null?void 0:n.includes("ESI"))&&!((u=o.label)!=null&&u.includes("Employer"))}))==null?void 0:C.amount)||0,wlf:0,tds:((R=(M=s.deductions)==null?void 0:M.find(o=>{var n;return(n=o.label)==null?void 0:n.includes("TDS")}))==null?void 0:R.amount)||0,pt:((F=(O=s.deductions)==null?void 0:O.find(o=>{var n;return(n=o.label)==null?void 0:n.includes("Professional")}))==null?void 0:F.amount)||0,lateDed:((j=(I=s.deductions)==null?void 0:I.find(o=>{var n,u;return((n=o.label)==null?void 0:n.includes("LOP"))||((u=o.label)==null?void 0:u.includes("Late"))}))==null?void 0:j.amount)||0,days:d.days_present||0,el:d.el_used||0,sundays:d.paid_sundays||0,totalDays:d.total_payable_days||0,payable:s.grossEarned||0,netPayable:s.netSalary||0,department:f.department||""},_=s.is_contractor===1||s.is_contractor===!0,w=(f.department||"").toUpperCase();if(_||s.is_contractor===void 0&&(w.includes("CONT")||w.includes("LAMBU")||w.includes("MEERA")||w.includes("KULDEEP")||w.includes("JIWAN")||w.includes("SUNNY")||w.includes("AMAR"))){const o=f.department||"CONTRACTOR";c[o]||(c[o]={label:o,employees:[]}),c[o].employees.push(t)}else c[x].employees.push(t)}let y=`<div style="font-family:Arial,sans-serif;padding:10px;">
    <h2 style="text-align:center;margin:0;font-size:14px;">${g.toUpperCase()}</h2>
    <p style="text-align:center;margin:2px 0 10px;font-size:12px;font-weight:bold;">SALARY SLIP ${b.toUpperCase()} ${h}</p>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="${i}width:30px;">S.No</th>
          <th style="${i}width:40px;">EMP</th>
          <th style="${i}text-align:left;min-width:100px;">Name</th>
          <th style="${i}text-align:left;min-width:70px;">Desig.</th>
          <th style="${i}">Gross</th>
          <th style="${i}">Basic</th>
          <th style="${i}">Total Earned</th>
          <th style="${i}">Advance</th>
          <th style="${i}">PF</th>
          <th style="${i}">ESI</th>
          <th style="${i}">Days</th>
          <th style="${i}">Sun</th>
          <th style="${i}">Tot Days</th>
          <th style="${i}">Payable</th>
          <th style="${i}">Late Ded</th>
          <th style="${i}font-weight:bold;">Net Pay</th>
          <th style="${i}width:50px;">Sign</th>
        </tr>
      </thead>
      <tbody>`,p={gross:0,basic:0,totalEarned:0,advance:0,pf:0,esi:0,days:0,sundays:0,totalDays:0,payable:0,lateDed:0,netPayable:0};for(const[s,f]of Object.entries(c)){if(f.employees.length===0)continue;s!==x&&(y+=`<tr><td colspan="17" style="padding:6px 5px;border:1px solid #999;font-weight:bold;background:#f0e6d2;font-size:10px;">${f.label}</td></tr>`);let d={gross:0,basic:0,totalEarned:0,advance:0,pf:0,esi:0,days:0,sundays:0,totalDays:0,payable:0,lateDed:0,netPayable:0};f.employees.forEach((t,_)=>{d.gross+=t.grossSalary,d.basic+=t.basic,d.totalEarned+=t.totalEarned,d.advance+=t.advance,d.pf+=t.pf,d.esi+=t.esi,d.days+=t.days,d.sundays+=t.sundays,d.totalDays+=t.totalDays,d.payable+=t.payable,d.lateDed+=t.lateDed,d.netPayable+=t.netPayable,y+=`<tr>
        <td style="${$}text-align:center;">${_+1}</td>
        <td style="${$}text-align:center;font-size:8px;">${t.code}</td>
        <td style="${$}font-weight:500;">${t.name}</td>
        <td style="${$}font-size:8px;">${t.designation}</td>
        <td style="${e}">${a(t.grossSalary)}</td>
        <td style="${e}">${a(t.basic)}</td>
        <td style="${e}">${a(t.totalEarned)}</td>
        <td style="${e}">${t.advance?a(t.advance):""}</td>
        <td style="${e}">${t.pf?a(t.pf):""}</td>
        <td style="${e}">${t.esi?a(t.esi):""}</td>
        <td style="${e}">${t.days}</td>
        <td style="${e}">${t.sundays||""}</td>
        <td style="${e}">${t.totalDays}</td>
        <td style="${e}font-weight:bold;">${a(t.payable)}</td>
        <td style="${e}">${t.lateDed?a(t.lateDed):""}</td>
        <td style="${e}font-weight:bold;">${a(t.netPayable)}</td>
        <td style="${$}"></td>
      </tr>`}),y+=`<tr style="background:#e8e8e8;font-weight:bold;">
      <td colspan="3" style="${$}text-align:right;font-weight:bold;">TOTAL</td>
      <td style="${$}"></td>
      <td style="${e}font-weight:bold;">${a(d.gross)}</td>
      <td style="${e}font-weight:bold;">${a(d.basic)}</td>
      <td style="${e}font-weight:bold;">${a(d.totalEarned)}</td>
      <td style="${e}font-weight:bold;">${a(d.advance)}</td>
      <td style="${e}font-weight:bold;">${a(d.pf)}</td>
      <td style="${e}font-weight:bold;">${a(d.esi)}</td>
      <td style="${e}font-weight:bold;">${d.days}</td>
      <td style="${e}font-weight:bold;">${d.sundays||""}</td>
      <td style="${e}font-weight:bold;">${d.totalDays}</td>
      <td style="${e}font-weight:bold;">${a(d.payable)}</td>
      <td style="${e}font-weight:bold;">${a(d.lateDed)}</td>
      <td style="${e}font-weight:bold;">${a(d.netPayable)}</td>
      <td style="${$}"></td>
    </tr>`;for(const t of Object.keys(p))p[t]+=d[t]}return y+=`<tr style="background:#d9e2f3;font-weight:bold;">
    <td colspan="3" style="${$}text-align:right;font-weight:bold;font-size:10px;">GRAND TOTAL</td>
    <td style="${$}"></td>
    <td style="${e}font-weight:bold;">${a(p.gross)}</td>
    <td style="${e}font-weight:bold;">${a(p.basic)}</td>
    <td style="${e}font-weight:bold;">${a(p.totalEarned)}</td>
    <td style="${e}font-weight:bold;">${a(p.advance)}</td>
    <td style="${e}font-weight:bold;">${a(p.pf)}</td>
    <td style="${e}font-weight:bold;">${a(p.esi)}</td>
    <td style="${e}font-weight:bold;">${p.days}</td>
    <td style="${e}font-weight:bold;">${p.sundays||""}</td>
    <td style="${e}font-weight:bold;">${p.totalDays}</td>
    <td style="${e}font-weight:bold;">${a(p.payable)}</td>
    <td style="${e}font-weight:bold;">${a(p.lateDed)}</td>
    <td style="${e}font-weight:bold;font-size:10px;">${a(p.netPayable)}</td>
    <td style="${$}"></td>
  </tr>`,y+="</tbody></table></div>",y}function J(l,m){const r=l.employee,h=r.company||"Company",g=l.attendance||{};function b(y){return Math.round(y||0).toLocaleString("en-IN")}const c=l.earnings.map(y=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${y.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${b(y.amount)}</td></tr>`).join(""),x=l.deductions.map(y=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${y.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${b(y.amount)}</td></tr>`).join("");return`<div style="font-family:Arial,sans-serif;font-size:11px;max-width:700px;margin:0 auto;padding:20px;page-break-after:always;">
    <div style="text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:15px;">
      <h2 style="margin:0;font-size:16px;">${h}</h2>
      <p style="margin:5px 0 0;font-size:12px;font-weight:bold;">Pay Slip for ${l.period.period}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px;">
      <tr><td style="padding:3px 0;width:25%;"><strong>Name:</strong></td><td style="width:25%;">${r.name}</td><td style="width:25%;"><strong>Code:</strong></td><td style="width:25%;">${r.code}</td></tr>
      <tr><td style="padding:3px 0;"><strong>Department:</strong></td><td>${r.department}</td><td><strong>Designation:</strong></td><td>${r.designation}</td></tr>
      <tr><td style="padding:3px 0;"><strong>UAN:</strong></td><td>${r.uan||"—"}</td><td><strong>Bank A/C:</strong></td><td>${r.bank_account||"—"}</td></tr>
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
        <tbody>${c}<tr style="background:#e8f4fd;font-weight:bold;"><td style="padding:4px 8px;border:1px solid #ddd;">Gross Earned</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${b(l.grossEarned)}</td></tr></tbody>
      </table></div>
      <div style="flex:1;"><table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr style="background:#fde8e8;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Deductions</th></tr></thead>
        <tbody>${x}<tr style="background:#fde8e8;font-weight:bold;"><td style="padding:4px 8px;border:1px solid #ddd;">Total Deductions</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${b(l.totalDeductions)}</td></tr></tbody>
      </table></div>
    </div>
    <div style="margin-top:12px;padding:10px;background:#e8fde8;border:2px solid #4caf50;text-align:center;font-size:14px;"><strong>Net Salary: ${b(l.netSalary)}</strong></div>
    <div style="margin-top:8px;font-size:9px;color:#666;"><p>Employer PF: ${b(l.pfEmployer)} | Employer ESI: ${b(l.esiEmployer)}</p></div>
  </div>`}async function q(l,m){const r=(await U(async()=>{const{default:b}=await import("./html2pdf-DFyiW5IA.js").then(c=>c.h);return{default:b}},__vite__mapDeps([0,1,2]))).default,h=J(l),g=document.createElement("div");g.innerHTML=h,document.body.appendChild(g);try{await r().set({margin:[5,5,5,5],filename:`Payslip_${l.employee.code}_${l.period.monthName}_${l.period.year}.pdf`,image:{type:"jpeg",quality:.98},html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(g).save()}finally{document.body.removeChild(g)}}async function V(l,m,r,h){const g=(await U(async()=>{const{default:y}=await import("./html2pdf-DFyiW5IA.js").then(p=>p.h);return{default:y}},__vite__mapDeps([0,1,2]))).default,b=B(l,m,r,h),c=document.createElement("div");c.innerHTML=b,document.body.appendChild(c);const x=H[r]||r;try{await g().set({margin:[5,5,5,5],filename:`Salary_Slip_${x}_${h}.pdf`,image:{type:"jpeg",quality:.95},html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4",orientation:"landscape"},pagebreak:{mode:["css","legacy"]}}).from(c).save()}finally{document.body.removeChild(c)}}export{V as a,q as d};

const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/html2pdf-CHIfZBAz.js","assets/index-BMVCRzJo.js","assets/index-CooR3ho5.css"])))=>i.map(i=>d[i]);
import{am as j}from"./index-BMVCRzJo.js";const U=["","January","February","March","April","May","June","July","August","September","October","November","December"];function a(l){return Math.round(l||0).toLocaleString("en-IN")}const $="padding:3px 4px;border:1px solid #999;font-size:9px;",e=$+"text-align:right;font-family:monospace;",i="padding:4px 5px;border:1px solid #666;font-size:8px;font-weight:bold;background:#d9e2f3;text-align:center;";function H(l,x,p,m){var _,v,E,D,P,S,A,N,T,k,z,L,C,M,R,O,F,I;const c=(x==null?void 0:x.company_name)||"Company",b=U[p]||p,g={},w="__PERMANENT__";g[w]={label:"PERMANENT STAFF",employees:[]};for(const s of l){const f=s.employee,d=s.attendance||{},t={code:f.code,name:f.name||f.code,designation:f.designation||f.department||"",grossSalary:s.grossSalary||s.grossEarned||0,basic:((v=(_=s.earnings)==null?void 0:_.find(o=>{var n;return(n=o.label)==null?void 0:n.includes("Basic")}))==null?void 0:v.amount)||0,hra:((D=(E=s.earnings)==null?void 0:E.find(o=>{var n;return(n=o.label)==null?void 0:n.includes("HRA")}))==null?void 0:D.amount)||0,cca:0,conv:((S=(P=s.earnings)==null?void 0:P.find(o=>{var n;return(n=o.label)==null?void 0:n.includes("Conveyance")}))==null?void 0:S.amount)||0,totalEarned:s.grossEarned||0,advance:((N=(A=s.deductions)==null?void 0:A.find(o=>{var n;return(n=o.label)==null?void 0:n.includes("Advance")}))==null?void 0:N.amount)||0,pf:((k=(T=s.deductions)==null?void 0:T.find(o=>{var n,u;return((n=o.label)==null?void 0:n.includes("PF"))&&!((u=o.label)!=null&&u.includes("Employer"))}))==null?void 0:k.amount)||0,esi:((L=(z=s.deductions)==null?void 0:z.find(o=>{var n,u;return((n=o.label)==null?void 0:n.includes("ESI"))&&!((u=o.label)!=null&&u.includes("Employer"))}))==null?void 0:L.amount)||0,wlf:0,tds:((M=(C=s.deductions)==null?void 0:C.find(o=>{var n;return(n=o.label)==null?void 0:n.includes("TDS")}))==null?void 0:M.amount)||0,pt:((O=(R=s.deductions)==null?void 0:R.find(o=>{var n;return(n=o.label)==null?void 0:n.includes("Professional")}))==null?void 0:O.amount)||0,lateDed:((I=(F=s.deductions)==null?void 0:F.find(o=>{var n,u;return((n=o.label)==null?void 0:n.includes("LOP"))||((u=o.label)==null?void 0:u.includes("Late"))}))==null?void 0:I.amount)||0,days:d.days_present||0,el:d.el_used||0,sundays:d.paid_sundays||0,totalDays:d.total_payable_days||0,payable:s.grossEarned||0,netPayable:s.netSalary||0,department:f.department||""},h=(f.department||"").toUpperCase();if(h.includes("CONT")||h.includes("LAMBU")||h.includes("MEERA")||h.includes("KULDEEP")||h.includes("JIWAN")||h.includes("SUNNY")||h.includes("AMAR")){const o=f.department||"CONTRACTOR";g[o]||(g[o]={label:o,employees:[]}),g[o].employees.push(t)}else g[w].employees.push(t)}let y=`<div style="font-family:Arial,sans-serif;padding:10px;">
    <h2 style="text-align:center;margin:0;font-size:14px;">${c.toUpperCase()}</h2>
    <p style="text-align:center;margin:2px 0 10px;font-size:12px;font-weight:bold;">SALARY SLIP ${b.toUpperCase()} ${m}</p>
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
          <th style="${i}">PT</th>
          <th style="${i}">Days</th>
          <th style="${i}">Sun</th>
          <th style="${i}">Tot Days</th>
          <th style="${i}">Payable</th>
          <th style="${i}">Late Ded</th>
          <th style="${i}font-weight:bold;">Net Pay</th>
          <th style="${i}width:50px;">Sign</th>
        </tr>
      </thead>
      <tbody>`,r={gross:0,basic:0,totalEarned:0,advance:0,pf:0,esi:0,pt:0,days:0,sundays:0,totalDays:0,payable:0,lateDed:0,netPayable:0};for(const[s,f]of Object.entries(g)){if(f.employees.length===0)continue;s!==w&&(y+=`<tr><td colspan="18" style="padding:6px 5px;border:1px solid #999;font-weight:bold;background:#f0e6d2;font-size:10px;">${f.label}</td></tr>`);let d={gross:0,basic:0,totalEarned:0,advance:0,pf:0,esi:0,pt:0,days:0,sundays:0,totalDays:0,payable:0,lateDed:0,netPayable:0};f.employees.forEach((t,h)=>{d.gross+=t.grossSalary,d.basic+=t.basic,d.totalEarned+=t.totalEarned,d.advance+=t.advance,d.pf+=t.pf,d.esi+=t.esi,d.pt+=t.pt,d.days+=t.days,d.sundays+=t.sundays,d.totalDays+=t.totalDays,d.payable+=t.payable,d.lateDed+=t.lateDed,d.netPayable+=t.netPayable,y+=`<tr>
        <td style="${$}text-align:center;">${h+1}</td>
        <td style="${$}text-align:center;font-size:8px;">${t.code}</td>
        <td style="${$}font-weight:500;">${t.name}</td>
        <td style="${$}font-size:8px;">${t.designation}</td>
        <td style="${e}">${a(t.grossSalary)}</td>
        <td style="${e}">${a(t.basic)}</td>
        <td style="${e}">${a(t.totalEarned)}</td>
        <td style="${e}">${t.advance?a(t.advance):""}</td>
        <td style="${e}">${t.pf?a(t.pf):""}</td>
        <td style="${e}">${t.esi?a(t.esi):""}</td>
        <td style="${e}">${t.pt?a(t.pt):""}</td>
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
      <td style="${e}font-weight:bold;">${a(d.pt)}</td>
      <td style="${e}font-weight:bold;">${d.days}</td>
      <td style="${e}font-weight:bold;">${d.sundays||""}</td>
      <td style="${e}font-weight:bold;">${d.totalDays}</td>
      <td style="${e}font-weight:bold;">${a(d.payable)}</td>
      <td style="${e}font-weight:bold;">${a(d.lateDed)}</td>
      <td style="${e}font-weight:bold;">${a(d.netPayable)}</td>
      <td style="${$}"></td>
    </tr>`;for(const t of Object.keys(r))r[t]+=d[t]}return y+=`<tr style="background:#d9e2f3;font-weight:bold;">
    <td colspan="3" style="${$}text-align:right;font-weight:bold;font-size:10px;">GRAND TOTAL</td>
    <td style="${$}"></td>
    <td style="${e}font-weight:bold;">${a(r.gross)}</td>
    <td style="${e}font-weight:bold;">${a(r.basic)}</td>
    <td style="${e}font-weight:bold;">${a(r.totalEarned)}</td>
    <td style="${e}font-weight:bold;">${a(r.advance)}</td>
    <td style="${e}font-weight:bold;">${a(r.pf)}</td>
    <td style="${e}font-weight:bold;">${a(r.esi)}</td>
    <td style="${e}font-weight:bold;">${a(r.pt)}</td>
    <td style="${e}font-weight:bold;">${r.days}</td>
    <td style="${e}font-weight:bold;">${r.sundays||""}</td>
    <td style="${e}font-weight:bold;">${r.totalDays}</td>
    <td style="${e}font-weight:bold;">${a(r.payable)}</td>
    <td style="${e}font-weight:bold;">${a(r.lateDed)}</td>
    <td style="${e}font-weight:bold;font-size:10px;">${a(r.netPayable)}</td>
    <td style="${$}"></td>
  </tr>`,y+="</tbody></table></div>",y}function B(l,x){const p=l.employee,m=p.company||"Company",c=l.attendance||{};function b(y){return Math.round(y||0).toLocaleString("en-IN")}const g=l.earnings.map(y=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${y.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${b(y.amount)}</td></tr>`).join(""),w=l.deductions.map(y=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${y.label}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${b(y.amount)}</td></tr>`).join("");return`<div style="font-family:Arial,sans-serif;font-size:11px;max-width:700px;margin:0 auto;padding:20px;page-break-after:always;">
    <div style="text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:15px;">
      <h2 style="margin:0;font-size:16px;">${m}</h2>
      <p style="margin:5px 0 0;font-size:12px;font-weight:bold;">Pay Slip for ${l.period.period}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px;">
      <tr><td style="padding:3px 0;width:25%;"><strong>Name:</strong></td><td style="width:25%;">${p.name}</td><td style="width:25%;"><strong>Code:</strong></td><td style="width:25%;">${p.code}</td></tr>
      <tr><td style="padding:3px 0;"><strong>Department:</strong></td><td>${p.department}</td><td><strong>Designation:</strong></td><td>${p.designation}</td></tr>
      <tr><td style="padding:3px 0;"><strong>UAN:</strong></td><td>${p.uan||"—"}</td><td><strong>Bank A/C:</strong></td><td>${p.bank_account||"—"}</td></tr>
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
        <tbody>${g}<tr style="background:#e8f4fd;font-weight:bold;"><td style="padding:4px 8px;border:1px solid #ddd;">Gross Earned</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${b(l.grossEarned)}</td></tr></tbody>
      </table></div>
      <div style="flex:1;"><table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr style="background:#fde8e8;"><th style="padding:4px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Deductions</th></tr></thead>
        <tbody>${w}<tr style="background:#fde8e8;font-weight:bold;"><td style="padding:4px 8px;border:1px solid #ddd;">Total Deductions</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${b(l.totalDeductions)}</td></tr></tbody>
      </table></div>
    </div>
    <div style="margin-top:12px;padding:10px;background:#e8fde8;border:2px solid #4caf50;text-align:center;font-size:14px;"><strong>Net Salary: ${b(l.netSalary)}</strong></div>
    <div style="margin-top:8px;font-size:9px;color:#666;"><p>Employer PF: ${b(l.pfEmployer)} | Employer ESI: ${b(l.esiEmployer)}</p></div>
  </div>`}async function K(l,x){const p=(await j(async()=>{const{default:b}=await import("./html2pdf-CHIfZBAz.js").then(g=>g.h);return{default:b}},__vite__mapDeps([0,1,2]))).default,m=B(l),c=document.createElement("div");c.innerHTML=m,document.body.appendChild(c);try{await p().set({margin:[5,5,5,5],filename:`Payslip_${l.employee.code}_${l.period.monthName}_${l.period.year}.pdf`,image:{type:"jpeg",quality:.98},html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(c).save()}finally{document.body.removeChild(c)}}async function q(l,x,p,m){const c=(await j(async()=>{const{default:y}=await import("./html2pdf-CHIfZBAz.js").then(r=>r.h);return{default:y}},__vite__mapDeps([0,1,2]))).default,b=H(l,x,p,m),g=document.createElement("div");g.innerHTML=b,document.body.appendChild(g);const w=U[p]||p;try{await c().set({margin:[5,5,5,5],filename:`Salary_Slip_${w}_${m}.pdf`,image:{type:"jpeg",quality:.95},html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4",orientation:"landscape"},pagebreak:{mode:["css","legacy"]}}).from(g).save()}finally{document.body.removeChild(g)}}export{q as a,K as d};

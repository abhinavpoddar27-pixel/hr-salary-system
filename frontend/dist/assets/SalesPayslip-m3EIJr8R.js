const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/html2pdf-Dv1TsXBc.js","assets/index-DPKIVqdL.js","assets/index-CvpR-AmH.css"])))=>i.map(i=>d[i]);
import{aV as M,dO as O,_ as B,u as J,b as q,r as H,j as t,c as V,z as C,dP as G}from"./index-DPKIVqdL.js";const T=["","January","February","March","April","May","June","July","August","September","October","November","December"];function h(e){return new Intl.NumberFormat("en-IN",{maximumFractionDigits:2,minimumFractionDigits:2}).format(Number(e||0))}function Q(e){if(!e)return"—";const s=/^(\d{4})-(\d{2})-(\d{2})/.exec(e);return s?`${s[3]}/${s[2]}/${s[1]}`:e}function K(e){const{employee:s,period:c,days:a,earnings:i,totalEarnings:p,deductions:d,totalDeductions:N,netSalary:v,status:m,bank:n,computedAt:f,finalizedAt:b,finalizedBy:r}=e,y=!["finalized","paid"].includes(m),x=(m||"computed").toUpperCase(),$=(i||[]).filter(l=>(l.amount||0)>0).map(l=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${l.label}</td>
           <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;font-family:monospace;">₹${h(l.amount)}</td></tr>`).join(""),_=(d||[]).filter(l=>(l.amount||0)>0).map(l=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${l.label}</td>
           <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;font-family:monospace;">₹${h(l.amount)}</td></tr>`).join("");return`<div style="position:relative;font-family:Arial,sans-serif;font-size:11px;max-width:720px;margin:0 auto;padding:24px;page-break-after:always;">
    ${y?`<div style="position:absolute;top:45%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);
        font-size:64px;font-weight:900;color:rgba(220,38,38,0.18);
        letter-spacing:8px;white-space:nowrap;pointer-events:none;z-index:10;">
         NOT VALID · DRAFT
       </div>`:""}

    <div style="text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:15px;">
      <h2 style="margin:0;font-size:18px;">${s.company||"Company"}</h2>
      <p style="margin:5px 0 0;font-size:13px;font-weight:bold;">SALARY SLIP — ${T[c.month]} ${c.year}</p>
      <p style="margin:4px 0 0;font-size:10px;color:#666;">Status: ${x}</p>
    </div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px;">
      <tr>
        <td style="padding:3px 0;width:25%;"><strong>Code:</strong></td><td style="width:25%;">${s.code||"—"}</td>
        <td style="padding:3px 0;width:25%;"><strong>Name:</strong></td><td style="width:25%;">${s.name||"—"}</td>
      </tr>
      <tr>
        <td style="padding:3px 0;"><strong>Designation:</strong></td><td>${s.designation||"—"}</td>
        <td style="padding:3px 0;"><strong>Reporting Manager:</strong></td><td>${s.reporting_manager||"—"}</td>
      </tr>
      <tr>
        <td style="padding:3px 0;"><strong>HQ:</strong></td><td>${s.headquarters||"—"}</td>
        <td style="padding:3px 0;"><strong>City of Operation:</strong></td><td>${s.city_of_operation||"—"}</td>
      </tr>
      <tr>
        <td style="padding:3px 0;"><strong>Date of Joining:</strong></td><td>${Q(s.doj)}</td>
        <td style="padding:3px 0;"></td><td></td>
      </tr>
    </table>

    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
      <tr style="background:#f0f0f0;">
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>Days Given:</strong> ${a.days_given}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>Paid Sundays:</strong> ${a.sundays_paid}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>Holidays:</strong> ${a.gazetted_holidays_paid}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>Earned Leave:</strong> ${a.earned_leave_days||0}</td>
      </tr>
      <tr style="background:#f0f0f0;">
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>Total Days:</strong> ${a.total_days}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>Calendar Days:</strong> ${a.calendar_days}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;" colspan="2"><strong>Earned Ratio:</strong> ${(a.earned_ratio||0).toFixed(4)}</td>
      </tr>
    </table>

    <div style="display:flex;gap:12px;margin-bottom:12px;">
      <div style="flex:1;">
        <table style="width:100%;border-collapse:collapse;font-size:10px;">
          <thead><tr style="background:#e8f4fd;">
            <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Earnings</th>
          </tr></thead>
          <tbody>
            ${$||'<tr><td colspan="2" style="padding:4px 8px;color:#999;font-style:italic;">—</td></tr>'}
            <tr style="background:#e8f4fd;font-weight:bold;">
              <td style="padding:5px 8px;border:1px solid #ddd;">Total Earnings</td>
              <td style="padding:5px 8px;border:1px solid #ddd;text-align:right;font-family:monospace;">₹${h(p)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style="flex:1;">
        <table style="width:100%;border-collapse:collapse;font-size:10px;">
          <thead><tr style="background:#fde8e8;">
            <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Deductions</th>
          </tr></thead>
          <tbody>
            ${_||'<tr><td colspan="2" style="padding:4px 8px;color:#999;font-style:italic;">No deductions this month</td></tr>'}
            <tr style="background:#fde8e8;font-weight:bold;">
              <td style="padding:5px 8px;border:1px solid #ddd;">Total Deductions</td>
              <td style="padding:5px 8px;border:1px solid #ddd;text-align:right;font-family:monospace;">₹${h(N)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div style="padding:12px;background:#e8fde8;border:2px solid #4caf50;text-align:center;font-size:16px;margin-bottom:12px;">
      <strong>Net Salary Payable: ₹${h(v)}</strong>
    </div>

    ${n&&(n.bank_name||n.account_no||n.ifsc)?`
    <table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:10px;">
      <tr><td style="padding:4px 8px;border:1px solid #ddd;" colspan="2"><strong>Bank Details</strong></td></tr>
      <tr>
        <td style="padding:4px 8px;border:1px solid #ddd;width:50%;"><strong>Bank:</strong> ${n.bank_name||"—"}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>IFSC:</strong> ${n.ifsc||"—"}</td>
      </tr>
      <tr>
        <td style="padding:4px 8px;border:1px solid #ddd;" colspan="2"><strong>A/C No.:</strong> ${n.account_no||"—"}</td>
      </tr>
    </table>`:""}

    <div style="margin-top:12px;font-size:9px;color:#666;">
      <p style="margin:2px 0;">Generated: ${new Date().toLocaleString("en-IN")}</p>
      <p style="margin:2px 0;">Computed: ${f||"—"}${b?` · Finalized: ${b}${r?` by ${r}`:""}`:""}</p>
      ${y?'<p style="margin:4px 0;color:#dc2626;font-weight:bold;">⚠ This payslip is a draft. Final figures require finalization.</p>':""}
    </div>
  </div>`}async function U(e){const s=(await M(async()=>{const{default:p}=await import("./html2pdf-Dv1TsXBc.js").then(d=>d.h);return{default:p}},__vite__mapDeps([0,1,2]))).default,c=K(e),a=document.createElement("div");a.innerHTML=c,document.body.appendChild(a);const i=T[e.period.month]||String(e.period.month);try{await s().set({margin:[8,8,8,8],filename:`Payslip_${e.employee.code}_${i}_${e.period.year}.pdf`,image:{type:"jpeg",quality:.98},html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(a).save()}finally{document.body.removeChild(a)}}const Y=["","January","February","March","April","May","June","July","August","September","October","November","December"];function u(e){return new Intl.NumberFormat("en-IN",{maximumFractionDigits:2,minimumFractionDigits:2}).format(Number(e||0))}function X(){var F,S,P,A;const{code:e}=O(),[s]=B(),c=J(),a=parseInt(s.get("month"),10),i=parseInt(s.get("year"),10),p=s.get("company")||"",{data:d,isLoading:N,isError:v,error:m}=q({queryKey:["sales-payslip",e,a,i,p],queryFn:()=>G(e,{month:a,year:i,company:p}),enabled:!!e&&!!a&&!!i&&!!p,retry:0}),[n,f]=H.useState(!1);if(!e||!a||!i||!p)return t.jsx("div",{className:"p-6 text-sm text-slate-500",children:"Missing parameters: code, month, year, company are all required."});if(N)return t.jsx("div",{className:"p-6 text-sm text-slate-500",children:"Loading payslip…"});if(v||!((F=d==null?void 0:d.data)!=null&&F.success)){const o=((P=(S=m==null?void 0:m.response)==null?void 0:S.data)==null?void 0:P.error)||((A=d==null?void 0:d.data)==null?void 0:A.error)||"Payslip unavailable";return t.jsxs("div",{className:"p-6 space-y-3",children:[t.jsx("div",{className:"bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800",children:o}),t.jsx("button",{onClick:()=>c(-1),className:"px-3 py-1.5 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700",children:"← Back"})]})}const b=d.data.data,{employee:r,period:y,days:x,earnings:$,totalEarnings:_,deductions:w,totalDeductions:l,netSalary:E,status:j,bank:g,computedAt:I,finalizedAt:k,finalizedBy:R}=b,z=!["finalized","paid"].includes(j),L=async()=>{if(!n){f(!0);try{await U(b),C.success("PDF downloaded")}catch(o){C.error("Failed to render PDF: "+((o==null?void 0:o.message)||"unknown error"))}finally{f(!1)}}};return t.jsxs("div",{className:"p-4 md:p-6 space-y-4 print:p-0",children:[t.jsxs("div",{className:"flex items-center justify-between print:hidden",children:[t.jsx("button",{onClick:()=>c(-1),className:"px-3 py-1.5 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700",children:"← Back to register"}),t.jsxs("div",{className:"flex items-center gap-2",children:[t.jsx("span",{className:V("text-xs px-2 py-0.5 rounded font-medium",j==="finalized"||j==="paid"?"bg-green-100 text-green-700":"bg-blue-100 text-blue-700"),children:j}),z&&t.jsx("span",{className:"text-xs px-2 py-0.5 rounded font-medium bg-rose-100 text-rose-700",children:"DRAFT — not valid"}),t.jsx("button",{onClick:L,disabled:n,className:"px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white",children:n?"Rendering PDF…":"Download PDF"})]})]}),t.jsxs("div",{className:"bg-white border border-slate-300 rounded-lg p-6 max-w-3xl mx-auto print:border-0 print:rounded-none print:shadow-none relative",children:[z&&t.jsx("div",{className:"absolute inset-0 flex items-center justify-center pointer-events-none z-10",children:t.jsx("span",{className:"font-black text-rose-600/15 tracking-widest select-none",style:{transform:"rotate(-30deg)",fontSize:"5rem",letterSpacing:"0.5rem"},children:"NOT VALID · DRAFT"})}),t.jsxs("div",{className:"border-b border-slate-200 pb-4 mb-4",children:[t.jsx("h1",{className:"text-xl font-bold text-slate-800",children:"Sales Salary Slip"}),t.jsx("p",{className:"text-sm text-slate-600",children:r.company}),t.jsxs("p",{className:"text-xs text-slate-500 mt-1",children:["Period: ",Y[y.month]," ",y.year]})]}),t.jsxs("div",{className:"grid grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4",children:[t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs",children:"Code"}),t.jsx("br",{}),t.jsx("span",{className:"font-mono",children:r.code})]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs",children:"Name"}),t.jsx("br",{}),t.jsx("span",{className:"font-medium",children:r.name})]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs",children:"Designation"}),t.jsx("br",{}),r.designation||"—"]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs",children:"Reporting Manager"}),t.jsx("br",{}),r.reporting_manager||"—"]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs",children:"Headquarters"}),t.jsx("br",{}),r.headquarters||"—"]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs",children:"City of Operation"}),t.jsx("br",{}),r.city_of_operation||"—"]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs",children:"Date of Joining"}),t.jsx("br",{}),r.doj||"—"]})]}),t.jsxs("div",{className:"grid grid-cols-4 gap-3 text-sm mb-4 bg-slate-50 rounded p-3",children:[t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs block",children:"Days Given"}),x.days_given]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs block",children:"+ Sundays Paid"}),x.sundays_paid]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs block",children:"+ Holidays"}),x.gazetted_holidays_paid]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs block",children:"= Total Days"}),t.jsx("span",{className:"font-semibold",children:x.total_days})]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs block",children:"Calendar Days"}),x.calendar_days]}),t.jsxs("div",{className:"col-span-3",children:[t.jsx("span",{className:"text-slate-500 text-xs block",children:"Earned Ratio"}),(x.earned_ratio||0).toFixed(4)]})]}),t.jsxs("div",{className:"grid grid-cols-2 gap-6 mb-4",children:[t.jsxs("div",{children:[t.jsx("h3",{className:"text-sm font-bold text-slate-800 mb-2 border-b border-slate-200 pb-1",children:"Earnings"}),t.jsx("table",{className:"w-full text-sm",children:t.jsxs("tbody",{children:[$.map((o,D)=>t.jsxs("tr",{className:"border-b border-slate-100 last:border-0",children:[t.jsx("td",{className:"py-1",children:o.label}),t.jsxs("td",{className:"py-1 text-right font-mono",children:["₹",u(o.amount)]})]},D)),t.jsxs("tr",{className:"font-semibold bg-slate-50",children:[t.jsx("td",{className:"py-1.5 px-1",children:"Total Earnings"}),t.jsxs("td",{className:"py-1.5 px-1 text-right font-mono",children:["₹",u(_)]})]})]})})]}),t.jsxs("div",{children:[t.jsx("h3",{className:"text-sm font-bold text-slate-800 mb-2 border-b border-slate-200 pb-1",children:"Deductions"}),t.jsx("table",{className:"w-full text-sm",children:t.jsxs("tbody",{children:[w.length===0&&t.jsx("tr",{children:t.jsx("td",{className:"py-2 text-slate-400 italic",children:"No deductions this month"})}),w.map((o,D)=>t.jsxs("tr",{className:"border-b border-slate-100 last:border-0",children:[t.jsx("td",{className:"py-1",children:o.label}),t.jsxs("td",{className:"py-1 text-right font-mono",children:["₹",u(o.amount)]})]},D)),t.jsxs("tr",{className:"font-semibold bg-slate-50",children:[t.jsx("td",{className:"py-1.5 px-1",children:"Total Deductions"}),t.jsxs("td",{className:"py-1.5 px-1 text-right font-mono",children:["₹",u(l)]})]})]})})]})]}),t.jsxs("div",{className:"bg-green-50 border border-green-200 rounded p-3 flex items-center justify-between mb-4",children:[t.jsx("span",{className:"text-sm font-semibold text-green-900",children:"Net Salary Payable"}),t.jsxs("span",{className:"text-xl font-bold text-green-900 font-mono",children:["₹",u(E)]})]}),(g.bank_name||g.account_no||g.ifsc)&&t.jsxs("div",{className:"text-xs text-slate-500 border-t border-slate-200 pt-3 mb-2",children:[t.jsxs("p",{children:[t.jsx("span",{className:"font-medium",children:"Bank:"})," ",g.bank_name||"—"]}),t.jsxs("p",{children:[t.jsx("span",{className:"font-medium",children:"A/C No.:"})," ",g.account_no||"—"]}),t.jsxs("p",{children:[t.jsx("span",{className:"font-medium",children:"IFSC:"})," ",g.ifsc||"—"]})]}),t.jsxs("div",{className:"text-xs text-slate-400 border-t border-slate-200 pt-2",children:["Computed: ",I,k&&t.jsxs(t.Fragment,{children:[" · Finalized: ",k," by ",R]})]})]})]})}export{X as default};

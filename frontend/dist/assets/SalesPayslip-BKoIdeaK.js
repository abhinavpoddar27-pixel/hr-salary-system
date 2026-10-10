const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/html2pdf-D_6o7Ubw.js","assets/index-C7wPx1wJ.js","assets/index-De7A8vwa.css"])))=>i.map(i=>d[i]);
import{bA as J,cl as G,a2 as V,u as K,b as E,r as Q,j as t,c as U,z as L,f3 as Y,a8 as W}from"./index-C7wPx1wJ.js";import{l as X}from"./payslipPdf-B8YwevaH.js";const R=["","January","February","March","April","May","June","July","August","September","October","November","December"];function N(e){return new Intl.NumberFormat("en-IN",{maximumFractionDigits:2,minimumFractionDigits:2}).format(Number(e||0))}function Z(e){if(!e)return"—";const n=/^(\d{4})-(\d{2})-(\d{2})/.exec(e);return n?`${n[3]}/${n[2]}/${n[1]}`:e}function tt(e,n=null){const{employee:d,period:r,days:s,earnings:i,totalEarnings:p,deductions:y,totalDeductions:w,netSalary:h,status:m,bank:l,computedAt:u,finalizedAt:f,finalizedBy:j}=e,c=!["finalized","paid"].includes(m),v=(m||"computed").toUpperCase(),x=(i||[]).filter(o=>(o.amount||0)>0).map(o=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${o.label}</td>
           <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;font-family:monospace;">₹${N(o.amount)}</td></tr>`).join(""),_=(y||[]).filter(o=>(o.amount||0)>0).map(o=>`<tr><td style="padding:4px 8px;border:1px solid #ddd;">${o.label}</td>
           <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;font-family:monospace;">₹${N(o.amount)}</td></tr>`).join("");return`<div style="position:relative;font-family:Arial,sans-serif;font-size:11px;max-width:720px;margin:0 auto;padding:24px;page-break-after:always;">
    ${c?`<div style="position:absolute;top:45%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);
        font-size:64px;font-weight:900;color:rgba(220,38,38,0.18);
        letter-spacing:8px;white-space:nowrap;pointer-events:none;z-index:10;">
         NOT VALID · DRAFT
       </div>`:""}

    <div style="text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:15px;">
      <h2 style="margin:0;font-size:18px;">${d.company||"Company"}</h2>
      <p style="margin:5px 0 0;font-size:13px;font-weight:bold;">SALARY SLIP — ${R[r.month]} ${r.year}</p>
      <p style="margin:4px 0 0;font-size:10px;color:#666;">Status: ${v}</p>
    </div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px;">
      <tr>
        <td style="padding:3px 0;width:25%;"><strong>Code:</strong></td><td style="width:25%;">${d.code||"—"}</td>
        <td style="padding:3px 0;width:25%;"><strong>Name:</strong></td><td style="width:25%;">${d.name||"—"}</td>
      </tr>
      <tr>
        <td style="padding:3px 0;"><strong>Designation:</strong></td><td>${d.designation||"—"}</td>
        <td style="padding:3px 0;"><strong>Reporting Manager:</strong></td><td>${d.reporting_manager||"—"}</td>
      </tr>
      <tr>
        <td style="padding:3px 0;"><strong>HQ:</strong></td><td>${d.headquarters||"—"}</td>
        <td style="padding:3px 0;"><strong>City of Operation:</strong></td><td>${d.city_of_operation||"—"}</td>
      </tr>
      <tr>
        <td style="padding:3px 0;"><strong>Date of Joining:</strong></td><td>${Z(d.doj)}</td>
        <td style="padding:3px 0;"></td><td></td>
      </tr>
    </table>

    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
      <tr style="background:#f0f0f0;">
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>Days Given:</strong> ${s.days_given}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>Paid Sundays:</strong> ${s.sundays_paid}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>Holidays:</strong> ${s.gazetted_holidays_paid}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>Earned Leave:</strong> ${s.earned_leave_days||0}</td>
      </tr>
      <tr style="background:#f0f0f0;">
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>Total Days:</strong> ${s.total_days}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>Calendar Days:</strong> ${s.calendar_days}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;" colspan="2"><strong>Earned Ratio:</strong> ${(s.earned_ratio||0).toFixed(4)}</td>
      </tr>
    </table>

    <div style="display:flex;gap:12px;margin-bottom:12px;">
      <div style="flex:1;">
        <table style="width:100%;border-collapse:collapse;font-size:10px;">
          <thead><tr style="background:#e8f4fd;">
            <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;" colspan="2">Earnings</th>
          </tr></thead>
          <tbody>
            ${x||'<tr><td colspan="2" style="padding:4px 8px;color:#999;font-style:italic;">—</td></tr>'}
            <tr style="background:#e8f4fd;font-weight:bold;">
              <td style="padding:5px 8px;border:1px solid #ddd;">Total Earnings</td>
              <td style="padding:5px 8px;border:1px solid #ddd;text-align:right;font-family:monospace;">₹${N(p)}</td>
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
              <td style="padding:5px 8px;border:1px solid #ddd;text-align:right;font-family:monospace;">₹${N(w)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div style="padding:12px;background:#e8fde8;border:2px solid #4caf50;text-align:center;font-size:16px;margin-bottom:12px;">
      <strong>Net Salary Payable: ₹${N(h)}</strong>
    </div>${X(n)}

    ${l&&(l.bank_name||l.account_no||l.ifsc)?`
    <table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:10px;">
      <tr><td style="padding:4px 8px;border:1px solid #ddd;" colspan="2"><strong>Bank Details</strong></td></tr>
      <tr>
        <td style="padding:4px 8px;border:1px solid #ddd;width:50%;"><strong>Bank:</strong> ${l.bank_name||"—"}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;"><strong>IFSC:</strong> ${l.ifsc||"—"}</td>
      </tr>
      <tr>
        <td style="padding:4px 8px;border:1px solid #ddd;" colspan="2"><strong>A/C No.:</strong> ${l.account_no||"—"}</td>
      </tr>
    </table>`:""}

    <div style="margin-top:12px;font-size:9px;color:#666;">
      <p style="margin:2px 0;">Generated: ${new Date().toLocaleString("en-IN")}</p>
      <p style="margin:2px 0;">Computed: ${u||"—"}${f?` · Finalized: ${f}${j?` by ${j}`:""}`:""}</p>
      ${c?'<p style="margin:4px 0;color:#dc2626;font-weight:bold;">⚠ This payslip is a draft. Final figures require finalization.</p>':""}
    </div>
  </div>`}async function et(e,n=null){const d=(await J(async()=>{const{default:p}=await import("./html2pdf-D_6o7Ubw.js").then(y=>y.h);return{default:p}},__vite__mapDeps([0,1,2]))).default,r=tt(e,n),s=document.createElement("div");s.innerHTML=r,document.body.appendChild(s);const i=R[e.period.month]||String(e.period.month);try{await d().set({margin:[8,8,8,8],filename:`Payslip_${e.employee.code}_${i}_${e.period.year}.pdf`,image:{type:"jpeg",quality:.98},html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(s).save()}finally{document.body.removeChild(s)}}const st=["","January","February","March","April","May","June","July","August","September","October","November","December"];function b(e){return new Intl.NumberFormat("en-IN",{maximumFractionDigits:2,minimumFractionDigits:2}).format(Number(e||0))}function nt(){var S,P,A,C,I,T;const{code:e}=G(),[n]=V(),d=K(),r=parseInt(n.get("month"),10),s=parseInt(n.get("year"),10),i=n.get("company")||"",{data:p,isLoading:y,isError:w,error:h}=E({queryKey:["sales-payslip",e,r,s,i],queryFn:()=>Y(e,{month:r,year:s,company:i}),enabled:!!e&&!!r&&!!s&&!!i,retry:0}),{data:m}=E({queryKey:["sales-payslip-loan-balance",e,r,s,i],queryFn:()=>W({payroll:"sales",employeeCode:e,company:i,month:r,year:s}),enabled:!!e&&!!r&&!!s&&!!i,retry:0}),l=(P=(S=m==null?void 0:m.data)==null?void 0:S.data)!=null&&P.show?m.data.data:null,[u,f]=Q.useState(!1);if(!e||!r||!s||!i)return t.jsx("div",{className:"p-6 text-sm text-slate-500",children:"Missing parameters: code, month, year, company are all required."});if(y)return t.jsx("div",{className:"p-6 text-sm text-slate-500",children:"Loading payslip…"});if(w||!((A=p==null?void 0:p.data)!=null&&A.success)){const a=((I=(C=h==null?void 0:h.response)==null?void 0:C.data)==null?void 0:I.error)||((T=p==null?void 0:p.data)==null?void 0:T.error)||"Payslip unavailable";return t.jsxs("div",{className:"p-6 space-y-3",children:[t.jsx("div",{className:"bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800",children:a}),t.jsx("button",{onClick:()=>d(-1),className:"px-3 py-1.5 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700",children:"← Back"})]})}const j=p.data.data,{employee:c,period:v,days:x,earnings:_,totalEarnings:k,deductions:o,totalDeductions:M,netSalary:B,status:$,bank:g,computedAt:q,finalizedAt:z,finalizedBy:O}=j,F=!["finalized","paid"].includes($),H=async()=>{if(!u){f(!0);try{await et(j,l),L.success("PDF downloaded")}catch(a){L.error("Failed to render PDF: "+((a==null?void 0:a.message)||"unknown error"))}finally{f(!1)}}};return t.jsxs("div",{className:"p-4 md:p-6 space-y-4 print:p-0",children:[t.jsxs("div",{className:"flex items-center justify-between print:hidden",children:[t.jsx("button",{onClick:()=>d(-1),className:"px-3 py-1.5 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700",children:"← Back to register"}),t.jsxs("div",{className:"flex items-center gap-2",children:[t.jsx("span",{className:U("text-xs px-2 py-0.5 rounded font-medium",$==="finalized"||$==="paid"?"bg-green-100 text-green-700":"bg-blue-100 text-blue-700"),children:$}),F&&t.jsx("span",{className:"text-xs px-2 py-0.5 rounded font-medium bg-rose-100 text-rose-700",children:"DRAFT — not valid"}),t.jsx("button",{onClick:H,disabled:u,className:"px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white",children:u?"Rendering PDF…":"Download PDF"})]})]}),t.jsxs("div",{className:"bg-white border border-slate-300 rounded-lg p-6 max-w-3xl mx-auto print:border-0 print:rounded-none print:shadow-none relative",children:[F&&t.jsx("div",{className:"absolute inset-0 flex items-center justify-center pointer-events-none z-10",children:t.jsx("span",{className:"font-black text-rose-600/15 tracking-widest select-none",style:{transform:"rotate(-30deg)",fontSize:"5rem",letterSpacing:"0.5rem"},children:"NOT VALID · DRAFT"})}),t.jsxs("div",{className:"border-b border-slate-200 pb-4 mb-4",children:[t.jsx("h1",{className:"text-xl font-bold text-slate-800",children:"Sales Salary Slip"}),t.jsx("p",{className:"text-sm text-slate-600",children:c.company}),t.jsxs("p",{className:"text-xs text-slate-500 mt-1",children:["Period: ",st[v.month]," ",v.year]})]}),t.jsxs("div",{className:"grid grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4",children:[t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs",children:"Code"}),t.jsx("br",{}),t.jsx("span",{className:"font-mono",children:c.code})]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs",children:"Name"}),t.jsx("br",{}),t.jsx("span",{className:"font-medium",children:c.name})]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs",children:"Designation"}),t.jsx("br",{}),c.designation||"—"]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs",children:"Reporting Manager"}),t.jsx("br",{}),c.reporting_manager||"—"]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs",children:"Headquarters"}),t.jsx("br",{}),c.headquarters||"—"]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs",children:"City of Operation"}),t.jsx("br",{}),c.city_of_operation||"—"]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs",children:"Date of Joining"}),t.jsx("br",{}),c.doj||"—"]})]}),t.jsxs("div",{className:"grid grid-cols-4 gap-3 text-sm mb-4 bg-slate-50 rounded p-3",children:[t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs block",children:"Days Given"}),x.days_given]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs block",children:"+ Sundays Paid"}),x.sundays_paid]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs block",children:"+ Holidays"}),x.gazetted_holidays_paid]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs block",children:"= Total Days"}),t.jsx("span",{className:"font-semibold",children:x.total_days})]}),t.jsxs("div",{children:[t.jsx("span",{className:"text-slate-500 text-xs block",children:"Calendar Days"}),x.calendar_days]}),t.jsxs("div",{className:"col-span-3",children:[t.jsx("span",{className:"text-slate-500 text-xs block",children:"Earned Ratio"}),(x.earned_ratio||0).toFixed(4)]})]}),t.jsxs("div",{className:"grid grid-cols-2 gap-6 mb-4",children:[t.jsxs("div",{children:[t.jsx("h3",{className:"text-sm font-bold text-slate-800 mb-2 border-b border-slate-200 pb-1",children:"Earnings"}),t.jsx("table",{className:"w-full text-sm",children:t.jsxs("tbody",{children:[_.map((a,D)=>t.jsxs("tr",{className:"border-b border-slate-100 last:border-0",children:[t.jsx("td",{className:"py-1",children:a.label}),t.jsxs("td",{className:"py-1 text-right font-mono",children:["₹",b(a.amount)]})]},D)),t.jsxs("tr",{className:"font-semibold bg-slate-50",children:[t.jsx("td",{className:"py-1.5 px-1",children:"Total Earnings"}),t.jsxs("td",{className:"py-1.5 px-1 text-right font-mono",children:["₹",b(k)]})]})]})})]}),t.jsxs("div",{children:[t.jsx("h3",{className:"text-sm font-bold text-slate-800 mb-2 border-b border-slate-200 pb-1",children:"Deductions"}),t.jsx("table",{className:"w-full text-sm",children:t.jsxs("tbody",{children:[o.length===0&&t.jsx("tr",{children:t.jsx("td",{className:"py-2 text-slate-400 italic",children:"No deductions this month"})}),o.map((a,D)=>t.jsxs("tr",{className:"border-b border-slate-100 last:border-0",children:[t.jsx("td",{className:"py-1",children:a.label}),t.jsxs("td",{className:"py-1 text-right font-mono",children:["₹",b(a.amount)]})]},D)),t.jsxs("tr",{className:"font-semibold bg-slate-50",children:[t.jsx("td",{className:"py-1.5 px-1",children:"Total Deductions"}),t.jsxs("td",{className:"py-1.5 px-1 text-right font-mono",children:["₹",b(M)]})]})]})})]})]}),t.jsxs("div",{className:"bg-green-50 border border-green-200 rounded p-3 flex items-center justify-between mb-4",children:[t.jsx("span",{className:"text-sm font-semibold text-green-900",children:"Net Salary Payable"}),t.jsxs("span",{className:"text-xl font-bold text-green-900 font-mono",children:["₹",b(B)]})]}),l&&t.jsx("div",{className:"bg-slate-50 border border-slate-200 rounded px-3 py-2 mb-4 space-y-0.5","data-testid":"sales-payslip-loan-balance",children:l.loans.map(a=>t.jsxs("div",{className:"flex items-center justify-between text-sm",children:[t.jsx("span",{className:"text-slate-600",children:l.loans.length>1?`Loan #${a.loanId} (${a.loanType}) outstanding after this month's EMI`:"Loan outstanding after this month's EMI"}),t.jsxs("span",{className:"font-mono font-semibold",children:["₹",b(a.outstandingAfter)]})]},a.loanId))}),(g.bank_name||g.account_no||g.ifsc)&&t.jsxs("div",{className:"text-xs text-slate-500 border-t border-slate-200 pt-3 mb-2",children:[t.jsxs("p",{children:[t.jsx("span",{className:"font-medium",children:"Bank:"})," ",g.bank_name||"—"]}),t.jsxs("p",{children:[t.jsx("span",{className:"font-medium",children:"A/C No.:"})," ",g.account_no||"—"]}),t.jsxs("p",{children:[t.jsx("span",{className:"font-medium",children:"IFSC:"})," ",g.ifsc||"—"]})]}),t.jsxs("div",{className:"text-xs text-slate-400 border-t border-slate-200 pt-2",children:["Computed: ",q,z&&t.jsxs(t.Fragment,{children:[" · Finalized: ",z," by ",O]})]})]})]})}export{nt as default};

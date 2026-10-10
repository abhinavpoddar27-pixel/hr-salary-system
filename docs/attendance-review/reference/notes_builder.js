const fs=require('fs');
const {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,WidthType,AlignmentType,PageOrientation,ShadingType,BorderStyle,PageBreak,HeadingLevel,Footer,PageNumber}=require('docx');
const P=JSON.parse(fs.readFileSync('people.json'));
const N=JSON.parse(fs.readFileSync('notice.json'));
const EA=JSON.parse(fs.readFileSync('early.json')).filter(x=>!x.load);
const haveNote=new Set(P.map(p=>String(p.code)));
const EW=EA.filter(x=>!haveNote.has(String(x.code)));
const fixDept=d=>({'Opr':'OPR','Maintance':'Maintenance','Etp':'ETP','Com. Helper':'Common Helper','H.R':'HR','Meera':'Meera (contractor)','Parikshan Paswan':'Parikshan Paswan (contractor)'}[d]||d);
const fixRole=r=>({'Labbler Opt':'Labeller Operator','Opt Labeller':'Labeller Operator','Shrink Opt':'Shrink Operator','Etp Operator':'ETP Operator','Operator Etp':'ETP Operator','Opt':'Operator','S.Guard':'Security Guard','Electician':'Electrician','Blowing Opt':'Blowing Operator','':'Security Guard'}[r]??r);
const ROLE={'Labbler Opt':'Labeller Operator','Boiler Opt':'Boiler Operator','Sweeper Admin Block':'Sweeper (admin block)','':'Security Guard'};
const role=p=>ROLE[p.role]!==undefined?ROLE[p.role]:p.role;
const CFG=fs.existsSync('config.json')?JSON.parse(fs.readFileSync('config.json')):{};  // private: {beforeIssue, nameFixes:{wrong:right}}
const nm=n=>Object.entries(CFG.nameFixes||{}).reduce((a,[w,r])=>a.replace(w,r),n);
const F='Arial';
const t=(s,o={})=>new TextRun({text:String(s),font:F,size:o.size||21,bold:o.bold,italics:o.it,color:o.color});
const para=(runs,o={})=>new Paragraph({children:Array.isArray(runs)?runs:[t(runs,o)],alignment:o.align,spacing:{after:o.after??120,before:o.before??0}});
const inr=n=>'₹'+Number(n).toLocaleString('en-IN');
const days=d=>d===1?'1 day':`${d} days`;
const B={style:BorderStyle.SINGLE,size:4,color:'BFBFBF'};
const cell=(s,w,o={})=>new TableCell({width:{size:w,type:WidthType.DXA},shading:o.fill?{type:ShadingType.CLEAR,fill:o.fill,color:'auto'}:undefined,margins:{top:o.tight?15:40,bottom:o.tight?15:40,left:70,right:70},borders:{top:B,bottom:B,left:B,right:B},children:[new Paragraph({alignment:o.align,children:[t(s,{size:o.size||17,bold:o.bold,color:o.color})]})]});
const table=(heads,rows,widths,hsize,tight)=>new Table({width:{size:widths.reduce((a,b)=>a+b,0),type:WidthType.DXA},columnWidths:widths,rows:[new TableRow({tableHeader:true,children:heads.map((h,i)=>cell(h,widths[i],{bold:true,fill:'1F3864',color:'FFFFFF',size:hsize,tight}))}),...rows.map(r=>new TableRow({cantSplit:true,children:r.map((v,i)=>cell(v.v??v,widths[i],{fill:v.fill,align:v.align,bold:v.bold,size:hsize,tight}))}))]});
const today='10 October 2026';
const ded=P.filter(p=>p.action==='Deduction note'), warn=P.filter(p=>p.action==='Warning note');
const totDays=ded.reduce((a,p)=>a+p.ded,0), totRs=ded.reduce((a,p)=>a+p.rs,0);

// ---------- Section 1: action list (landscape)
const W1=[380,680,1750,2750,600,600,1150,950,1300,950,1050,3450];
const s1=[
 para([t('Late Coming & Early Exit – Action List, September 2026',{size:30,bold:true})],{after:60}),
 para([t(`Prepared ${today} · HR Department · For HR and Finance only – not for display`,{size:18,color:'595959'})],{after:160}),
 para([t(`${P.length} people: ${ded.length} get a deduction note (${totDays} days in total, about ${inr(totRs)}), ${warn.length} newcomers get a warning note only.`,{size:21})],{after:80}),
 para([t('Deduction = workdays actually lost (late minutes + early-exit minutes ÷ shift length), rounded to the nearest 0.5 day, minimum 0.5 day. Mornings after the person stayed 20+ min late the previous evening are not counted. ₹ amounts are indicative (monthly gross ÷ 30 × days); payroll gives the final figure.',{size:18,color:'404040'})],{after:60}),
 para([t('Before issuing: '+(CFG.beforeIssue||'check the open items in the exclusions doc.')+' Contractor workers’ notes should be copied to their contractor.',{size:18,it:true,color:'404040'})],{after:120}),
 table(['#','Code','Name','Department – Role','Late days','Early days','Time lost','Workdays lost','Action','Deduction','Indicative ₹','Remark'],
   P.map((p,i)=>[{v:i+1,align:AlignmentType.CENTER},{v:p.code,align:AlignmentType.CENTER},{v:nm(p.name),bold:true},`${p.dept} – ${role(p)}`,{v:p.L,align:AlignmentType.CENTER},{v:p.E,align:AlignmentType.CENTER},p.hrs,{v:p.md.toFixed(2),align:AlignmentType.CENTER},{v:p.action,fill:p.action==='Warning note'?'FFF2CC':'FCE4D6'},{v:p.ded?days(p.ded):'—',align:AlignmentType.CENTER,bold:true},{v:p.rs?inr(p.rs):'—',align:AlignmentType.RIGHT},p.remark]).concat([[ '', '', {v:'TOTAL',bold:true},'','','','','','',{v:days(totDays),align:AlignmentType.CENTER,bold:true},{v:inr(totRs),align:AlignmentType.RIGHT,bold:true},'']]),W1,15,true),

 para([t(`Early-exit warning notes (${EW.length} people)`,{size:24,bold:true})],{before:240,after:60}),
 para([t('People who left 15+ minutes before shift end on 3 or more days in September (Mon–Sat), who do not already have a note above. Warning only this month; the early-exit deduction rule starts in October. Plant-wide early-release days (3 Sep, 25 Sep), wrong-shift cases and loading staff are excluded.',{size:18,color:'404040'})],{after:100}),
 table(['#','Code','Name','Department – Role','Early exits','1 h+ early','Avg early','Aug early exits','Action'],
   EW.map((x,i)=>[{v:i+1,align:AlignmentType.CENTER},{v:x.code,align:AlignmentType.CENTER},{v:x.name,bold:true},`${fixDept(x.dept)} – ${fixRole(x.role)}`,{v:x.n,align:AlignmentType.CENTER},{v:x.long,align:AlignmentType.CENTER},{v:x.avg>=90?(x.avg/60).toFixed(1)+' h':x.avg+' min',align:AlignmentType.CENTER},{v:x.aug??'new',align:AlignmentType.CENTER},{v:'Warning note',fill:'FFF2CC'}]),
   [400,700,2000,3300,900,900,1000,1100,1300],15,true),
];

// ---------- Section 2: notice board (portrait)
const W2=[600,900,3300,2900,1300];
const s2b=[
 new Paragraph({children:[new PageBreak()]}),
 para([t('NOTICE',{size:32,bold:true})],{align:AlignmentType.CENTER,after:20}),
 para([t('Leaving Early – September 2026',{size:26,bold:true})],{align:AlignmentType.CENTER,after:120}),
 para('The following employees left before the end of their shift on 3 or more days in September 2026 without a recorded gate pass or short leave.',{size:19,after:60}),
 para('1.  Leaving more than 15 minutes before shift end without a gate pass or approved short leave is marked as an early exit.',{size:18,after:20}),
 para('2.  From October 2026, early exits will be deducted from salary in half-day steps.',{size:18,after:20}),
 para('3.  If you must leave early, take a gate pass from your in-charge and show it at the gate.',{size:18,after:100}),
 table(['S.No','Code','Name','Department','Early exits'],[...EA].sort((a,b)=>b.n-a.n||a.name.localeCompare(b.name)).map((x,i)=>[{v:i+1,align:AlignmentType.CENTER},{v:x.code,align:AlignmentType.CENTER},x.name,fixDept(x.dept).replace(' (contractor)',''),{v:x.n,align:AlignmentType.CENTER,bold:true}]),[600,900,3300,2900,1300],16,true),
 para('Plant-wide early release days (3 and 25 September) are not counted. Anyone who believes their record is wrong should meet HR within 3 working days.',{size:17,before:60,after:0}),
 para([t(`Date: ${today}`,{size:20}),t('                                                                        HR Manager',{size:20,bold:true})],{before:60,after:0}),
];
const s2=[
 para([t('NOTICE',{size:32,bold:true})],{align:AlignmentType.CENTER,after:20}),
 para([t('Late Coming – September 2026',{size:26,bold:true})],{align:AlignmentType.CENTER,after:120}),
 para('The following employees came late to duty on 4 or more days in September 2026.',{size:19,after:30}),
 para('Please note the company attendance policy:',{size:19,after:30}),
 para('1.  Reporting after 9 minutes past shift start is marked as late.',{size:18,after:20}),
 para('2.  A late morning is not counted if you stayed 20 minutes or more after your shift the previous evening.',{size:18,after:20}),
 para('3.  Time lost by late coming and early leaving is deducted from salary, in half-day steps.',{size:18,after:20}),
 para('4.  Leaving before shift end without a gate pass or approved short leave is treated the same as late coming.',{size:18,after:100}),
 table(['S.No','Code','Name','Department','Late days'],N.map((n,i)=>[{v:i+1,align:AlignmentType.CENTER},{v:n.code,align:AlignmentType.CENTER},n.name,n.dept,{v:n.L,align:AlignmentType.CENTER,bold:true}]),W2,16,true),
 para('Anyone who believes their record is wrong should meet HR within 3 working days with the reason.',{size:17,before:60,after:0}),
 para([t(`Date: ${today}`,{size:20}),t('                                                                        HR Manager',{size:20,bold:true})],{before:60,after:0}),
];

// ---------- Section 3: individual notes
const sig=()=>[
 para('',{after:500}),
 new Table({width:{size:9000,type:WidthType.DXA},columnWidths:[4500,4500],rows:[new TableRow({children:[
   new TableCell({width:{size:4500,type:WidthType.DXA},borders:{top:{style:BorderStyle.NONE},bottom:{style:BorderStyle.NONE},left:{style:BorderStyle.NONE},right:{style:BorderStyle.NONE}},children:[para('______________________',{after:40}),para([t('HR Manager',{bold:true})],{after:0})]}),
   new TableCell({width:{size:4500,type:WidthType.DXA},borders:{top:{style:BorderStyle.NONE},bottom:{style:BorderStyle.NONE},left:{style:BorderStyle.NONE},right:{style:BorderStyle.NONE}},children:[para('______________________',{after:40,align:AlignmentType.RIGHT}),para([t('Received by employee (signature & date)',{bold:true})],{after:0,align:AlignmentType.RIGHT})]})]})]})
];
const facts=p=>table(['Month','Late days','Early-exit days','Time lost'],[[ 'September 2026',{v:p.L,align:AlignmentType.CENTER},{v:p.E,align:AlignmentType.CENTER},`${p.hrs} (= ${p.md.toFixed(2)} workdays)` ],[ 'August 2026',{v:p.aL??'—',align:AlignmentType.CENTER},{v:p.aE??'—',align:AlignmentType.CENTER},'—']],[2400,1600,1900,3100],20);
const head=(p,i,subj)=>[
 para([t('HR Department',{size:20,bold:true,color:'1F3864'})],{after:0}),
 para([t(`Ref: HR/ATT/SEP26/${String(i+1).padStart(2,'0')}`,{size:19,color:'595959'}),t(`          Date: ${today}`,{size:19,color:'595959'})],{after:240}),
 para([t('To: ',{bold:true}),t(`${nm(p.name)}  (Code ${p.code})`)],{after:40}),
 para([t('Department / Role: ',{bold:true}),t(`${p.dept} – ${role(p)}`)],{after:200}),
 para([t('Subject: ',{bold:true}),t(subj,{bold:true})],{after:200}),
];
const contr=p=>/contractor/.test(p.dept)?[para([t(`Copy to: ${p.dept.replace(' (contractor)','')} contractor`,{size:19,it:true})],{before:120})]:[];
const notes=[];
P.forEach((p,i)=>{
 const pb=i>0?[new Paragraph({children:[new PageBreak()]})]:[];
 const what=[p.L?`came late on ${p.L} day${p.L>1?'s':''}`:null,p.E?`left before shift end on ${p.E} day${p.E>1?'s':''}`:null].filter(Boolean).join(' and ');
 if(p.action==='Warning note'){
  notes.push(...pb,...head(p,i,'Warning – late coming / early leaving, September 2026'),
   para(`Our attendance record shows that in September 2026 you ${what}. This is ${p.hrs} of working time.`),
   facts(p),
   para('As you have joined recently, no deduction is being made this month. Please treat this note as a first warning.',{before:200}),
   para('From October 2026, any time lost through late coming or leaving early will be deducted from your salary in half-day steps, as per company policy. A late morning is not counted if you stayed 20 minutes or more after your shift the previous evening.'),
   para('If you need to leave early for a genuine reason, take a gate pass or approved short leave from your in-charge before leaving.'),
   ...contr(p),...sig());
 } else {
  notes.push(...pb,...head(p,i,`Late coming / early leaving, September 2026 – deduction of ${days(p.ded)}`),
   para(`Our attendance record shows that in September 2026 you ${what}. Together this is ${p.hrs} of working time, equal to ${p.md.toFixed(2)} workdays.`),
   facts(p),
   para([t('As per company attendance policy, a deduction of '),t(days(p.ded),{bold:true}),t(' will be made from your salary. Deductions are made in half-day steps, with a minimum of half a day.')],{before:200}),
   para('Late mornings that followed an evening when you stayed 20 minutes or more after your shift have not been counted.'),
   para('Further late coming or leaving early will lead to deductions every month and may lead to stricter action. If you believe this record is wrong, meet HR within 3 working days with the reason or proof.'),
   ...contr(p),...sig());
 }
});

EW.forEach((x,j)=>{
 const i=P.length+j;
 const q={code:x.code,name:x.name,dept:fixDept(x.dept),role:x.role};
 notes.push(new Paragraph({children:[new PageBreak()]}),...head({...q,role:fixRole(x.role)},i,'Warning – leaving before shift end, September 2026'),
  para(`Our attendance record shows that in September 2026 you left before the end of your shift on ${x.n} days, with no gate pass or short leave recorded. On average you left ${x.avg>=90?(x.avg/60).toFixed(1)+' hours':x.avg+' minutes'} early${x.long?`, and on ${x.long} of these days more than one hour early`:''}.`),
  table(['Month','Early-exit days','Total time'],[['September 2026',{v:x.n,align:AlignmentType.CENTER},`${x.hrs} hours`],['August 2026',{v:x.aug??'—',align:AlignmentType.CENTER},'—']],[3000,2500,3500],20),
  para('This note is a warning. No deduction is being made for September.',{before:200}),
  para('From October 2026, leaving before shift end without a gate pass or approved short leave will be deducted from your salary in half-day steps, as per company policy.'),
  para('If you need to leave early for a genuine reason, take a gate pass from your in-charge before leaving and show it at the gate.'),
  ...(/contractor/.test(q.dept)?[para([t(`Copy to: ${q.dept.replace(' (contractor)','')} contractor`,{size:19,it:true})],{before:120})]:[]),...sig());
});
const foot=new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({font:F,size:16,color:'808080',children:['Page ',PageNumber.CURRENT]})]})]});
const A4={width:11906,height:16838};
const m={top:500,bottom:400,left:1000,right:1000};
const doc=new Document({sections:[
 {properties:{page:{size:{...A4,orientation:PageOrientation.LANDSCAPE},margin:{top:500,bottom:500,left:600,right:600}}},footers:{default:foot},children:s1},
 {properties:{page:{size:A4,margin:m}},footers:{default:new Footer({children:[new Paragraph({children:[]})]})},children:[...s2,...s2b]},
 {properties:{page:{size:A4,margin:{top:1200,bottom:1200,left:1300,right:1300}}},footers:{default:new Footer({children:[new Paragraph({children:[]})]})},children:notes},
]});
Packer.toBuffer(doc).then(b=>{fs.writeFileSync('/tmp/outputs/Late_Early_Action_Notes_Sep2026.docx',b);console.log('ok')});

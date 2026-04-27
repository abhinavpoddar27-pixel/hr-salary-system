import{a as p,b as u,j as s,V as m}from"./index-6ngi7R49.js";function c({className:n="",compact:o=!1}){var t;const{selectedCompany:r,setSelectedCompany:l}=p(),{data:a}=u({queryKey:["companies"],queryFn:()=>m.get("/settings/companies"),staleTime:3e5,retry:0}),i=((t=a==null?void 0:a.data)==null?void 0:t.data)||[];return s.jsxs("select",{value:r,onChange:e=>l(e.target.value),className:`
        border border-slate-300 rounded-lg bg-white text-slate-700
        focus:ring-2 focus:ring-blue-500 focus:border-blue-500
        ${o?"px-2 py-1 text-xs":"px-3 py-1.5 text-sm"}
        ${n}
      `,children:[s.jsx("option",{value:"",children:"All Companies"}),i.map(e=>s.jsx("option",{value:e.name,children:e.display_name||e.name},e.id))]})}export{c as C};

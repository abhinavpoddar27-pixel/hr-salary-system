import{a as p,j as t,P as m}from"./index-BgiLUfyi.js";import{u}from"./useQuery-CvQb447Q.js";function x({className:o="",compact:n=!1}){var s;const{selectedCompany:r,setSelectedCompany:i}=p(),{data:a}=u({queryKey:["companies"],queryFn:()=>m.get("/settings/companies"),staleTime:3e5,retry:0}),l=((s=a==null?void 0:a.data)==null?void 0:s.data)||[];return t.jsxs("select",{value:r,onChange:e=>i(e.target.value),className:`
        border border-slate-300 rounded-lg bg-white text-slate-700
        focus:ring-2 focus:ring-blue-500 focus:border-blue-500
        ${n?"px-2 py-1 text-xs":"px-3 py-1.5 text-sm"}
        ${o}
      `,children:[t.jsx("option",{value:"",children:"All Companies"}),l.map(e=>t.jsx("option",{value:e.name,children:e.display_name||e.name},e.id))]})}export{x as C};

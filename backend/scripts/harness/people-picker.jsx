// P2-07 browser harness: mounts PeoplePicker and two EmployeeSearchSelect
// instances with FICTIONAL employees. Built by build-harness.mjs (esbuild).
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import PeoplePicker from '@picker'
import EmployeeSearchSelect from '@ess'

const DEPTS = [['PACKING', 6], ['PRODUCTION', 9], ['STORES', 3], ['QUALITY', 3]]
const FIRST = ['Asha', 'Vikram', 'Neha', 'Rohit', 'Kiran', 'Dev', 'Meera', 'Sunil', 'Tara']
const employees = []
let n = 90001
for (const [dept, size] of DEPTS) {
  for (let i = 0; i < size; i++) {
    employees.push({ code: String(n), name: `${FIRST[i % FIRST.length]} Test${n % 100}`, department: dept, status: 'Active' })
    n++
  }
}
employees.push({ code: '01234', name: 'Zero Lead', department: 'STORES', status: 'Active' })
employees.push({ code: 'S901', name: 'Sales Person', department: '', status: 'Active' })
employees.push({ code: '90901', name: 'Gone Away', department: 'PACKING', status: 'Left' })
employees.push({ code: '90902', name: 'Moved On', department: 'QUALITY', status: 'Left' })
window.__employees = employees

function App() {
  const [sel, setSel] = useState([])
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  window.__selected = sel
  return (
    <div style={{ padding: 16, maxWidth: 720 }}>
      <h1>Harness</h1>
      <section id="picker"><PeoplePicker employees={employees} value={sel} onChange={setSel} allowLeft /></section>
      <section id="ess" style={{ marginTop: 24 }}>
        <label htmlFor="ess-a">A</label>
        <EmployeeSearchSelect id="ess-a" employees={employees} value={a} onChange={setA} />
        <label htmlFor="ess-b">B</label>
        <EmployeeSearchSelect id="ess-b" employees={employees} value={b} onChange={setB} />
        <output id="ess-values">{a}|{b}</output>
      </section>
    </div>
  )
}
createRoot(document.getElementById('root')).render(<App />)

/**
 * LWF register — statutory flags PR-3 (read-only; for the Punjab Labour Welfare Fund remittance).
 *
 * One row per salary row of the month that carries LWF (employee or employer share > 0):
 *   plant  salary_computations        LEFT JOIN employees        ON code
 *   sales  sales_salary_computations  LEFT JOIN sales_employees  ON code + company
 * Columns: payroll, company, code, name, LWF (EE), LWF (ER). Plant rows also carry
 * `capped` / `shortfall`: shortfall = the VERIFY V11 component sum − total_deductions; capped when it
 * is above ₹1 (the deductions cap fired — DEDUCTIONS_EXCEED_EARNINGS). Sales has no cap (E8) → null.
 * M2 ruling (D-F3 default, C5): the register lists what is DUE — the ₹5 / ₹20 stay on a capped row; the
 * part the cap did not recover is an employer cost, shown as the shortfall.
 * Company subtotals and a grand total. XLSX: every row (header, data, subtotal, total) is 8 cells wide.
 * Reads only; writes nothing.
 */
const XLSX = require('xlsx');

const MONTHS_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// VERIFY.sql V11: the 10 plant deduction components + LWF(EE).
const PLANT_COMPONENTS = ['pf_employee', 'esi_employee', 'professional_tax', 'tds', 'advance_recovery', 'lop_deduction',
  'other_deductions', 'loan_recovery', 'late_coming_deduction', 'early_exit_deduction', 'lwf_employee'];
const HEADER = ['Payroll', 'Company', 'Code', 'Name', 'LWF (EE)', 'LWF (ER)', 'Capped', 'Shortfall'];
const round2 = (n) => Math.round((n || 0) * 100) / 100;

function buildLwfRegister(db, { month, year, company = null }) {
  const co = company ? ' AND COALESCE(sc.company, \'\') = ?' : '';
  const args = company ? [month, year, company] : [month, year];
  const lwfOn = '(COALESCE(sc.lwf_employee, 0) > 0 OR COALESCE(sc.lwf_employer, 0) > 0)';

  const plant = db.prepare(`
    SELECT 'Plant' AS payroll, COALESCE(sc.company, '') AS company, sc.employee_code, e.name AS employee_name,
           sc.lwf_employee, sc.lwf_employer, sc.total_deductions,
           ${PLANT_COMPONENTS.map((c) => `COALESCE(sc.${c}, 0)`).join(' + ')} AS component_sum
      FROM salary_computations sc
 LEFT JOIN employees e ON e.code = sc.employee_code
     WHERE sc.month = ? AND sc.year = ?${co} AND ${lwfOn}
  `).all(...args).map((r) => {
    const gap = round2(r.component_sum - (r.total_deductions || 0));
    const capped = gap > 1 ? 1 : 0;
    return { payroll: 'Plant', company: r.company, employee_code: r.employee_code, employee_name: r.employee_name || '',
      lwf_employee: round2(r.lwf_employee), lwf_employer: round2(r.lwf_employer), capped, shortfall: capped ? gap : 0 };
  });

  const sales = db.prepare(`
    SELECT COALESCE(sc.company, '') AS company, sc.employee_code, e.name AS employee_name, sc.lwf_employee, sc.lwf_employer
      FROM sales_salary_computations sc
 LEFT JOIN sales_employees e ON e.code = sc.employee_code AND e.company = sc.company
     WHERE sc.month = ? AND sc.year = ?${co} AND ${lwfOn}
  `).all(...args).map((r) => ({ payroll: 'Sales', company: r.company, employee_code: r.employee_code, employee_name: r.employee_name || '',
    lwf_employee: round2(r.lwf_employee), lwf_employer: round2(r.lwf_employer), capped: null, shortfall: null }));

  const rows = [...plant, ...sales].sort((a, b) => a.company.localeCompare(b.company) || a.payroll.localeCompare(b.payroll)
    || a.employee_name.localeCompare(b.employee_name) || a.employee_code.localeCompare(b.employee_code));

  const byCompany = new Map();
  for (const r of rows) {
    const s = byCompany.get(r.company) || { company: r.company, count: 0, plant: 0, sales: 0, lwf_employee: 0, lwf_employer: 0, capped: 0, shortfall: 0 };
    s.count += 1;
    s[r.payroll === 'Plant' ? 'plant' : 'sales'] += 1;
    s.lwf_employee = round2(s.lwf_employee + r.lwf_employee);
    s.lwf_employer = round2(s.lwf_employer + r.lwf_employer);
    s.capped += r.capped || 0;
    s.shortfall = round2(s.shortfall + (r.shortfall || 0));
    byCompany.set(r.company, s);
  }
  const subtotals = [...byCompany.values()];
  const totals = subtotals.reduce((t, s) => ({
    count: t.count + s.count, plant: t.plant + s.plant, sales: t.sales + s.sales,
    lwf_employee: round2(t.lwf_employee + s.lwf_employee), lwf_employer: round2(t.lwf_employer + s.lwf_employer),
    capped: t.capped + s.capped, shortfall: round2(t.shortfall + s.shortfall),
  }), { count: 0, plant: 0, sales: 0, lwf_employee: 0, lwf_employer: 0, capped: 0, shortfall: 0 });

  // filename goes into a header: the company is reduced to [A-Za-z0-9_.-] (N6)
  const filename = `LWF_Register_${MONTHS_SHORT[month]}_${year}${company ? `_${company.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_.-]/g, '')}` : ''}.xlsx`;
  return { month, year, company, rows, subtotals, totals, filename };
}

/** XLSX of a built register: per company its rows then a subtotal row; a grand total last. */
function lwfRegisterWorkbook(reg) {
  const aoa = [HEADER];
  for (const s of reg.subtotals) {
    for (const r of reg.rows.filter((x) => x.company === s.company)) {
      aoa.push([r.payroll, r.company, r.employee_code, r.employee_name, r.lwf_employee, r.lwf_employer,
        r.capped == null ? '' : (r.capped ? 'Yes' : 'No'), r.shortfall == null ? '' : r.shortfall]);
    }
    aoa.push(['Subtotal', s.company, `${s.count} rows`, `Plant ${s.plant} / Sales ${s.sales}`, s.lwf_employee, s.lwf_employer, s.capped, s.shortfall]);
  }
  const t = reg.totals;
  aoa.push(['Total', '', `${t.count} rows`, `Plant ${t.plant} / Sales ${t.sales}`, t.lwf_employee, t.lwf_employer, t.capped, t.shortfall]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 9 }, { wch: 28 }, { wch: 12 }, { wch: 28 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 }];
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'LWF Register');
  return { buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), filename: reg.filename, width: HEADER.length };
}

module.exports = { buildLwfRegister, lwfRegisterWorkbook, PLANT_COMPONENTS, HEADER };

// Sales Template Generator — Phase 1 Template Model (May 2026)
//
// Builds the pre-populated XLSX HR downloads from /api/sales/template.
// Sheet 1 ("Input"): one row per eligible employee, columns
//   S.No | Employee Code | Name | Reporting Manager | HQ/City |
//   Designation | Status | DOJ | DOL | Days Given
// Sheet 2 ("_meta"): hidden audit metadata (month/year/company,
// generated_at/by, master_snapshot_hash, employee_count, schema_version).
//
// Phase 1 enforcement: cell-level locking (all locked except Days Given)
// is NOT applied — community xlsx 0.18.5 does not reliably write
// cell.s.protection, so the sheet-level !protect block below is the only
// soft hint. The real enforcement is the Phase 2 server-side validator;
// see the Phase 1 plan doc.

const XLSX = require('xlsx');
const { computeMasterHash, getEligibleEmployees, monthBounds } =
  require('./salesMasterHash');

const HEADER = [
  'S.No', 'Employee Code', 'Name', 'Reporting Manager',
  'HQ/City', 'Designation', 'Status', 'DOJ', 'DOL', 'Days Given',
];

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function deriveStatus(doj, dol, monthStart, monthEnd) {
  if (dol && dol >= monthStart && dol <= monthEnd) return 'Left mid-month';
  if (doj && doj >= monthStart && doj <= monthEnd) return 'Joined mid-month';
  return 'Active';
}

function companySlug(company) {
  return String(company)
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function generateTemplate(db, { month, year, company, generatedBy }) {
  if (!db) throw new Error('db handle required');
  const m = Number(month), y = Number(year);
  if (!Number.isInteger(m) || m < 1 || m > 12) throw new Error('invalid month');
  if (!Number.isInteger(y)) throw new Error('invalid year');
  if (!company || typeof company !== 'string') throw new Error('company required');
  if (!generatedBy || typeof generatedBy !== 'string') {
    throw new Error('generatedBy required');
  }

  const eligible = getEligibleEmployees(db, m, y, company);
  const employeeCount = eligible.length;
  const hash = computeMasterHash(db, m, y, company);
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const { start: monthStart, end: monthEnd } = monthBounds(m, y);

  // Pull the full master row for each eligible code so the template can
  // surface name / manager / hq / designation alongside the four fields
  // already covered by the hash. One IN-list query keeps it cheap.
  const codes = eligible.map((e) => e.code);
  let masterByCode = {};
  if (codes.length) {
    const placeholders = codes.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT code, name, reporting_manager, headquarters, city_of_operation,
             designation, doj, dol
      FROM sales_employees
      WHERE company = ? AND code IN (${placeholders})
    `).all(company, ...codes);
    for (const r of rows) masterByCode[r.code] = r;
  }

  const dataRows = [HEADER];
  eligible.forEach((e, idx) => {
    const m0 = masterByCode[e.code] || {};
    const hqCity = m0.headquarters || m0.city_of_operation || '';
    const status = deriveStatus(e.doj, e.dol, monthStart, monthEnd);
    dataRows.push([
      idx + 1,
      e.code,
      m0.name || '',
      m0.reporting_manager || '',
      hqCity,
      m0.designation || '',
      status,
      e.doj || '',
      e.dol || '',
      '',
    ]);
  });

  const sheet = XLSX.utils.aoa_to_sheet(dataRows);
  sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  sheet['!views'] = [{ state: 'frozen', ySplit: 1 }];
  sheet['!cols'] = [
    { wch: 6 },   // S.No
    { wch: 14 },  // Employee Code
    { wch: 28 },  // Name
    { wch: 22 },  // Reporting Manager
    { wch: 20 },  // HQ/City
    { wch: 22 },  // Designation
    { wch: 18 },  // Status
    { wch: 12 },  // DOJ
    { wch: 12 },  // DOL
    { wch: 12 },  // Days Given
  ];
  // Soft sheet-level protection hint. Phase 2 server-side validator is
  // the real enforcement.
  sheet['!protect'] = {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: true,
    formatColumns: false,
    formatRows: false,
    insertColumns: false,
    insertRows: false,
    deleteColumns: false,
    deleteRows: false,
    sort: false,
    autoFilter: false,
    pivotTables: false,
  };

  const meta = XLSX.utils.aoa_to_sheet([
    ['key', 'value'],
    ['month', String(m)],
    ['year', String(y)],
    ['company', company],
    ['generated_at', generatedAt],
    ['generated_by', generatedBy],
    ['master_snapshot_hash', hash],
    ['employee_count', String(employeeCount)],
    ['schema_version', '1'],
  ]);
  meta['!cols'] = [{ wch: 24 }, { wch: 64 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Input');
  XLSX.utils.book_append_sheet(wb, meta, '_meta');

  // Mark the _meta sheet hidden in the workbook view. xlsx 0.18.5 honours
  // wb.Workbook.Sheets[i].Hidden = 1 (1 = hidden, 2 = very hidden).
  if (!wb.Workbook) wb.Workbook = {};
  if (!Array.isArray(wb.Workbook.Sheets)) wb.Workbook.Sheets = [];
  wb.Workbook.Sheets[0] = { ...(wb.Workbook.Sheets[0] || {}), Hidden: 0 };
  wb.Workbook.Sheets[1] = { ...(wb.Workbook.Sheets[1] || {}), Hidden: 1 };

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const slug = companySlug(company);
  const filename = `sales_input_${y}-${String(m).padStart(2, '0')}_${slug}.xlsx`;

  // Audit row: stamps the snapshot hash + employee count for this download
  // so Phase 2 can reconcile uploads back to a known template.
  try {
    db.prepare(`
      INSERT INTO sales_template_downloads
        (month, year, company, master_snapshot_hash, employee_count, downloaded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(m, y, company, hash, employeeCount, generatedBy);
  } catch (e) {
    // Best-effort: never block the download on audit failure. The hash is
    // also embedded in the workbook _meta sheet, so reconciliation isn't
    // dependent on this row alone.
    console.warn('[sales-template] audit insert failed:', e.message);
  }

  return { buffer, hash, employeeCount, filename };
}

module.exports = { generateTemplate, deriveStatus, companySlug, MONTH_NAMES };

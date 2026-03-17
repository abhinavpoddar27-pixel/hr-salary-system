#!/usr/bin/env node
/**
 * Extract Master Employee Data from Salary Sheets
 *
 * Reads all Staff/Workers/Sales salary Excel files, extracts employee master data,
 * deduplicates (keeping latest month's info), and imports into the HR system database.
 */

const XLSX = require('../backend/node_modules/xlsx');
const path = require('path');
const fs = require('fs');

const SALARY_DIR = '/Users/abhinavpoddar/Desktop/hr attendence/salary sheets';

// ── Excel serial date → YYYY-MM-DD ─────────────────────────────────
function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number' || serial < 1000) return null;
  // Excel epoch: Jan 1, 1900 (with the Lotus 1-2-3 leap year bug)
  const utcDays = Math.floor(serial - 25569);
  const d = new Date(utcDays * 86400000);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

// ── Parse month/year from filename ──────────────────────────────────
function parseMonthYear(filename) {
  const monthNames = {
    'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3,
    'apr': 4, 'april': 4, 'may': 5, 'jun': 6, 'june': 6,
    'jul': 7, 'july': 7, 'aug': 8, 'august': 8, 'sep': 9, 'sept': 9, 'september': 9,
    'oct': 10, 'october': 10, 'nov': 11, 'november': 11, 'dec': 12, 'december': 12
  };
  const lower = filename.toLowerCase();
  let month = 0, year = 0;

  for (const [name, num] of Object.entries(monthNames)) {
    if (lower.includes(name)) { month = num; break; }
  }

  const yearMatch = lower.match(/(20\d{2})/);
  if (yearMatch) year = parseInt(yearMatch[1]);
  // Handle "25" or "26" shorthand
  if (!year) {
    const shortYear = lower.match(/\b(\d{2})\b/);
    if (shortYear) year = 2000 + parseInt(shortYear[1]);
  }

  return { month, year, sortKey: year * 100 + month };
}

// ── Detect category from filename ───────────────────────────────────
function detectCategory(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes('staff')) return 'Staff';
  if (lower.includes('worker')) return 'Worker';
  if (lower.includes('sales') || lower.includes('sale')) return 'Sales';
  return 'Unknown';
}

// ── Find header row index ───────────────────────────────────────────
function findHeaderRow(data) {
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = (data[i] || []).map(c => String(c || '').toLowerCase().trim());
    if (row.some(c => c.includes('s.no') || c === 's.no') &&
        row.some(c => c.includes('emp') || c.includes('name'))) {
      return i;
    }
  }
  return -1;
}

// ── Map header columns to indices ───────────────────────────────────
function mapColumns(headerRow) {
  const map = {};
  for (let i = 0; i < headerRow.length; i++) {
    const h = String(headerRow[i] || '').toLowerCase().trim().replace(/,.*$/, '');

    if (h.includes('s.no') || h === 's.no') map.sno = i;
    else if (h.match(/^emp[_ ]?(cod)?$/) || h === 'emp' || h === 'emp_' || h === 'emp_ cod') map.code = i;
    else if (h.includes('empnam') || (h === 'name' && !map.name)) map.name = i;
    else if (h.includes('f_name') || h.includes('father')) map.fatherName = i;
    else if (h === 'dob' || h.startsWith('dob') || h === 'd.o.b') {
      if (!map.dob) map.dob = i;
    }
    else if (h.includes('desi')) map.designation = i;
    else if (h === 'date' || h.startsWith('date') || h === 'd.o.j' || h.includes('pay roll doj')) {
      if (!map.doj) map.doj = i;
    }
    else if (h.includes('admin') || h.includes('plant')) map.deptPlant = i;
    else if (h === 'location') map.location = i;
    else if (h.includes('uan')) map.uan = i;
    else if (h.includes('uidai')) map.aadhaar = i;
    else if ((h === 'basic' || h.startsWith('basic')) && !map.basic) map.basic = i;
    else if ((h === 'hra' || h.startsWith('hra')) && !map.hra) map.hra = i;
    else if ((h === 'cca' || h.startsWith('cca')) && !map.cca) map.cca = i;
    else if ((h === 'conv' || h.startsWith('conv')) && !map.conv) map.conv = i;
    else if (h.includes('gross') || (h === 'total salary' || h.startsWith('total salary'))) {
      if (!map.gross) map.gross = i;
    }
    else if (h === 'pf' && !map.pf) map.pf = i;
    else if (h === 'esi' && !map.esi) map.esi = i;
    else if (h.includes('bank') && !h.includes('loan')) map.bank = i;
    else if (h.includes('account')) map.accountNo = i;
    else if (h.includes('ifsc')) map.ifsc = i;
    else if (h.includes('net payable') || h.includes('net paid')) {
      if (!map.netPayable) map.netPayable = i;
    }
    else if (h === 'days' || h === 'p-days') map.days = i;
    else if (h.includes('total days')) map.totalDays = i;
  }
  return map;
}

// ── Check if a row is a data row (has valid emp code and name) ──────
function isDataRow(row, colMap) {
  if (!row || row.length < 5) return false;
  const sno = row[colMap.sno];
  const code = row[colMap.code];
  const name = row[colMap.name];

  // Must have a serial number (numeric) and non-empty name
  if (!sno || (typeof sno !== 'number' && !String(sno).match(/^\d+$/))) return false;
  if (!name || String(name).trim() === '' || String(name).toLowerCase().includes('total')) return false;
  if (!code) return false;

  return true;
}

// ── Extract company from sheet header ───────────────────────────────
function detectCompany(data) {
  for (let i = 0; i < Math.min(5, data.length); i++) {
    const row = (data[i] || []).join(' ').toLowerCase();
    if (row.includes('indriyan')) return 'Indriyan Beverages Pvt Ltd';
    if (row.includes('asian lakto') || row.includes('lakto')) return 'Asian Lakto Ind Ltd';
  }
  return '';
}

// ── MAIN ────────────────────────────────────────────────────────────

const files = fs.readdirSync(SALARY_DIR)
  .filter(f => f.endsWith('.xlsx') && !f.startsWith('~'))
  .sort();

console.log(`Found ${files.length} salary sheet files\n`);

// Master employee map: code → { ...employee data, lastSeenSortKey }
const masterMap = {};
let totalRowsParsed = 0;
let filesProcessed = 0;

for (const file of files) {
  const filePath = path.join(SALARY_DIR, file);
  const category = detectCategory(file);
  const { month, year, sortKey } = parseMonthYear(file);

  console.log(`Processing: ${file} [${category}] ${month}/${year}`);

  let wb;
  try {
    wb = XLSX.readFile(filePath, { cellDates: false });
  } catch (e) {
    console.error(`  ERROR reading file: ${e.message}`);
    continue;
  }

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (data.length < 4) continue;

    // For Sales sheets, there can be multiple company sections
    // We need to handle them section by section
    if (category === 'Sales') {
      // Find all header rows (there may be multiple sections)
      const sections = [];
      for (let i = 0; i < data.length; i++) {
        const row = (data[i] || []).map(c => String(c || '').toLowerCase().trim());
        if (row.some(c => c.includes('s.no')) && row.some(c => c.includes('emp'))) {
          // Detect company from rows above this header
          let company = '';
          for (let j = Math.max(0, i - 5); j < i; j++) {
            const txt = (data[j] || []).join(' ').toLowerCase();
            if (txt.includes('indriyan')) company = 'Indriyan Beverages Pvt Ltd';
            else if (txt.includes('asian lakto') || txt.includes('lakto')) company = 'Asian Lakto Ind Ltd';
          }
          sections.push({ headerIdx: i, company });
        }
      }

      for (let s = 0; s < sections.length; s++) {
        const { headerIdx, company } = sections[s];
        const nextHeaderIdx = s + 1 < sections.length ? sections[s + 1].headerIdx : data.length;
        const colMap = mapColumns(data[headerIdx]);

        if (!colMap.code || !colMap.name) continue;

        for (let i = headerIdx + 1; i < nextHeaderIdx; i++) {
          const row = data[i];
          if (!isDataRow(row, colMap)) continue;

          const code = String(row[colMap.code]).trim();
          if (!code || code === '0') continue;

          const existing = masterMap[code];
          if (existing && existing.lastSeenSortKey > sortKey) continue; // Keep newer data

          const gross = parseFloat(row[colMap.gross]) || 0;
          const pf = parseFloat(row[colMap.pf]) || 0;
          const esi = parseFloat(row[colMap.esi]) || 0;

          masterMap[code] = {
            code,
            name: String(row[colMap.name] || '').trim(),
            father_name: colMap.fatherName !== undefined ? String(row[colMap.fatherName] || '').trim() : '',
            dob: excelDateToISO(row[colMap.dob]),
            date_of_joining: excelDateToISO(row[colMap.doj]),
            department: colMap.location !== undefined ? String(row[colMap.location] || '').trim() : 'Sales',
            designation: colMap.designation !== undefined ? String(row[colMap.designation] || '').trim() : '',
            company: company || 'Asian Lakto Ind Ltd',
            employment_type: 'Sales',
            category: 'Sales',
            uan: colMap.uan !== undefined ? String(row[colMap.uan] || '').trim() : '',
            aadhaar: colMap.aadhaar !== undefined ? String(row[colMap.aadhaar] || '').trim() : '',
            basic: parseFloat(row[colMap.basic]) || 0,
            hra: parseFloat(row[colMap.hra]) || 0,
            cca: parseFloat(row[colMap.cca]) || 0,
            conv: parseFloat(row[colMap.conv]) || 0,
            gross_salary: gross,
            pf_applicable: pf > 0 ? 1 : 0,
            esi_applicable: esi > 0 ? 1 : 0,
            bank_name: colMap.bank !== undefined ? String(row[colMap.bank] || '').trim() : '',
            account_number: colMap.accountNo !== undefined ? String(row[colMap.accountNo] || '').trim() : '',
            ifsc: colMap.ifsc !== undefined ? String(row[colMap.ifsc] || '').trim() : '',
            lastSeenMonth: month,
            lastSeenYear: year,
            lastSeenSortKey: sortKey,
            sourceFile: file,
            sheetName
          };
          totalRowsParsed++;
        }
      }
    } else {
      // Staff / Worker: single company section per sheet
      const headerIdx = findHeaderRow(data);
      if (headerIdx < 0) continue;

      const colMap = mapColumns(data[headerIdx]);
      if (!colMap.code || !colMap.name) {
        // For Staff, column 1 might be EMP and column 2 is Name
        // Try manual mapping if auto-detection fails
        if (data[headerIdx] && data[headerIdx].length > 5) {
          colMap.code = 1;
          colMap.name = 2;
        } else continue;
      }

      const company = detectCompany(data);

      // Detect if this sheet is SILP or a sub-category from title row
      let subCategory = '';
      for (let i = 0; i < headerIdx; i++) {
        const txt = (data[i] || []).join(' ').toLowerCase();
        if (txt.includes('silp')) subCategory = 'SILP';
        if (txt.includes('driver')) subCategory = 'Driver';
      }

      for (let i = headerIdx + 1; i < data.length; i++) {
        const row = data[i];
        if (!isDataRow(row, colMap)) continue;

        const code = String(row[colMap.code]).trim();
        if (!code || code === '0') continue;

        const existing = masterMap[code];
        if (existing && existing.lastSeenSortKey > sortKey) continue;

        const gross = parseFloat(row[colMap.gross]) || 0;
        const pf = parseFloat(row[colMap.pf]) || 0;
        const esi = parseFloat(row[colMap.esi]) || 0;
        const basic = parseFloat(row[colMap.basic]) || 0;
        const hra = parseFloat(row[colMap.hra]) || 0;
        const cca = parseFloat(row[colMap.cca]) || 0;
        const conv = parseFloat(row[colMap.conv]) || 0;

        // Department: for Staff use Admin/Plant column, for Worker default to 'Production'
        let dept = '';
        if (colMap.deptPlant !== undefined) {
          dept = String(row[colMap.deptPlant] || '').trim();
        }
        if (!dept && category === 'Worker') dept = 'Production';
        if (!dept && category === 'Staff') dept = 'Admin';

        // DOJ column position varies between old and new Staff format
        let doj = null;
        if (colMap.doj !== undefined) {
          doj = excelDateToISO(row[colMap.doj]);
        }

        masterMap[code] = {
          code,
          name: String(row[colMap.name] || '').trim(),
          father_name: colMap.fatherName !== undefined ? String(row[colMap.fatherName] || '').trim() : '',
          dob: colMap.dob !== undefined ? excelDateToISO(row[colMap.dob]) : null,
          date_of_joining: doj,
          department: dept,
          designation: colMap.designation !== undefined ? String(row[colMap.designation] || '').trim() : '',
          company: company || 'Asian Lakto Ind Ltd',
          employment_type: category === 'Worker' ? 'Worker' : 'Permanent',
          category: subCategory || category,
          uan: colMap.uan !== undefined ? String(row[colMap.uan] || '').trim() : '',
          aadhaar: '',
          basic,
          hra,
          cca,
          conv,
          gross_salary: gross || (basic + hra + cca + conv),
          pf_applicable: pf > 0 ? 1 : 0,
          esi_applicable: esi > 0 ? 1 : 0,
          bank_name: colMap.bank !== undefined ? String(row[colMap.bank] || '').trim() : '',
          account_number: colMap.accountNo !== undefined ? String(row[colMap.accountNo] || '').trim() : '',
          ifsc: colMap.ifsc !== undefined ? String(row[colMap.ifsc] || '').trim() : '',
          lastSeenMonth: month,
          lastSeenYear: year,
          lastSeenSortKey: sortKey,
          sourceFile: file,
          sheetName
        };
        totalRowsParsed++;
      }
    }
  }

  filesProcessed++;
}

// ── Summary ────────────────────────────────────────────────────────
const employees = Object.values(masterMap);
const stats = {
  totalFiles: filesProcessed,
  totalRowsParsed,
  uniqueEmployees: employees.length,
  byCategory: {},
  byCompany: {},
  withDOJ: employees.filter(e => e.date_of_joining).length,
  withDOB: employees.filter(e => e.dob).length,
  withUAN: employees.filter(e => e.uan && e.uan !== '0' && e.uan !== '').length,
  withBank: employees.filter(e => e.account_number && e.account_number !== '0').length,
  withGross: employees.filter(e => e.gross_salary > 0).length,
  pfApplicable: employees.filter(e => e.pf_applicable).length,
  esiApplicable: employees.filter(e => e.esi_applicable).length,
};

for (const e of employees) {
  stats.byCategory[e.category] = (stats.byCategory[e.category] || 0) + 1;
  stats.byCompany[e.company] = (stats.byCompany[e.company] || 0) + 1;
}

console.log('\n' + '═'.repeat(60));
console.log('MASTER DATA EXTRACTION SUMMARY');
console.log('═'.repeat(60));
console.log(`Files processed:     ${stats.totalFiles}`);
console.log(`Total rows parsed:   ${stats.totalRowsParsed}`);
console.log(`Unique employees:    ${stats.uniqueEmployees}`);
console.log(`\nBy Category:`);
for (const [cat, count] of Object.entries(stats.byCategory)) {
  console.log(`  ${cat}: ${count}`);
}
console.log(`\nBy Company:`);
for (const [comp, count] of Object.entries(stats.byCompany)) {
  console.log(`  ${comp}: ${count}`);
}
console.log(`\nData Completeness:`);
console.log(`  With DOJ:     ${stats.withDOJ} / ${stats.uniqueEmployees}`);
console.log(`  With DOB:     ${stats.withDOB} / ${stats.uniqueEmployees}`);
console.log(`  With UAN:     ${stats.withUAN} / ${stats.uniqueEmployees}`);
console.log(`  With Bank:    ${stats.withBank} / ${stats.uniqueEmployees}`);
console.log(`  With Gross:   ${stats.withGross} / ${stats.uniqueEmployees}`);
console.log(`  PF Applicable:  ${stats.pfApplicable}`);
console.log(`  ESI Applicable: ${stats.esiApplicable}`);

// Save to JSON
const outputPath = path.join(__dirname, 'master-data-extracted.json');
fs.writeFileSync(outputPath, JSON.stringify({ stats, employees }, null, 2));
console.log(`\nSaved to: ${outputPath}`);

// ── Print sample employees ──────────────────────────────────────────
console.log('\n── Sample Employees ──');
const samples = [
  employees.find(e => e.category === 'Staff'),
  employees.find(e => e.category === 'Worker'),
  employees.find(e => e.category === 'Sales'),
].filter(Boolean);
for (const s of samples) {
  console.log(`\n  [${s.category}] ${s.code} - ${s.name}`);
  console.log(`    Company: ${s.company} | Dept: ${s.department} | Desig: ${s.designation}`);
  console.log(`    DOJ: ${s.date_of_joining || 'N/A'} | DOB: ${s.dob || 'N/A'}`);
  console.log(`    Gross: ₹${s.gross_salary} (B:${s.basic} H:${s.hra} C:${s.cca} CV:${s.conv})`);
  console.log(`    UAN: ${s.uan || 'N/A'} | PF: ${s.pf_applicable ? 'Yes' : 'No'} | ESI: ${s.esi_applicable ? 'Yes' : 'No'}`);
  console.log(`    Bank: ${s.bank_name || 'N/A'} | Acct: ${s.account_number || 'N/A'}`);
  console.log(`    Source: ${s.sourceFile} (${s.lastSeenMonth}/${s.lastSeenYear})`);
}

/**
 * Loans PR-10 — accounts-Excel import: template, header detection, column
 * mapping and row parsing. Pure (no database).
 *
 * The accounts sheet has names but no employee codes (SPEC D-9, K36, K37).
 * Our own template maps itself; any other sheet gets an automatic mapping from
 * header synonyms that the user can change before the batch is created.
 *
 * Dates are Indian: a text date is read DAY first (03/04/2026 = 3 Apr 2026).
 * Anything that cannot be read that way (02/13/2026, a 2-digit year, free
 * text) makes the row invalid — never guessed (coordinator ruling, 10 Oct 2026).
 */
const XLSX = require('xlsx');
const { VALID_COMPANIES } = require('./policy');
const { parseDate, formatDate, todayIst } = require('./months');

const FIELDS = Object.freeze([
  // PR-10 follow-up: a code column ("Punch No") makes the match exact by code (S… = sales master, numeric = plant).
  { key: 'code', label: 'Employee code', required: false,
    synonyms: ['punch no', 'punch number', 'punch', 'emp code', 'employee code', 'code', 'emp no', 'employee no', 'emp id', 'employee id', 'ecode'] },
  { key: 'name', label: 'Name', required: true,
    synonyms: ['name', 'employee name', 'emp name', 'employee', 'borrower', 'borrower name', 'staff name', 'name of employee', 'name of borrower'] },
  { key: 'company', label: 'Company', required: false,
    synonyms: ['company', 'company name', 'firm', 'employer', 'unit'] },
  { key: 'department', label: 'Department', required: false,
    synonyms: ['department', 'dept', 'section'] },
  { key: 'loanDate', label: 'Loan date', required: false,
    synonyms: ['loan date', 'date of loan', 'date', 'disbursed on', 'disbursement date', 'given on', 'loan given on'] },
  { key: 'originalPrincipal', label: 'Original principal', required: false,
    synonyms: ['original principal', 'principal', 'loan amount', 'original amount', 'sanctioned amount', 'amount'] },
  { key: 'outstanding', label: 'Outstanding at cutover', required: true,
    synonyms: ['outstanding at cutover', 'outstanding', 'outstanding balance', 'balance outstanding', 'balance', 'balance amount', 'closing balance', 'bal', 'o s', 'os',
      'pending amount', 'pending loan amount', 'pending loan', 'opening balance'] },
  { key: 'emi', label: 'Monthly EMI', required: true,
    synonyms: ['monthly emi', 'emi', 'emi amount', 'instalment', 'installment', 'monthly instalment', 'monthly installment', 'monthly deduction', 'deduction',
      'deduct per month', 'deduction per month', 'deduct'] },
  { key: 'loanType', label: 'Loan type', required: false,
    synonyms: ['loan type', 'type', 'purpose'] },
  { key: 'agreementRef', label: 'Agreement ref', required: false,
    synonyms: ['agreement ref', 'agreement', 'agreement no', 'agreement number', 'reference', 'ref'] },
  { key: 'notes', label: 'Notes', required: false,
    synonyms: ['notes', 'note', 'remarks', 'remark'] },
]);
const FIELD_KEYS = FIELDS.map((f) => f.key);
// Fuzzy ("header contains synonym") pass order: the specific fields first, so
// "Outstanding loan amount" goes to outstanding, not to original principal.
const CONTAINS_ORDER = ['code', 'outstanding', 'emi', 'loanDate', 'agreementRef', 'loanType', 'name', 'company', 'department', 'originalPrincipal', 'notes'];

const TEMPLATE_HEADERS = ['Employee code', 'Name', 'Company', 'Department', 'Loan date (DD-MM-YYYY)', 'Original principal', 'Outstanding at cutover',
  'Monthly EMI', 'Loan type', 'Agreement ref', 'Notes'];

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, JUNE: 6, JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12 };

const normHeader = (h) => String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const cellText = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** {sheet, aoa, firstRow} — the "Loans" sheet if there is one, else the first sheet. */
function readSheet(buffer) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  } catch (e) {
    return { ok: false, code: 'FILE_UNREADABLE', message: 'the file could not be read as an Excel workbook' };
  }
  const name = wb.SheetNames.find((n) => n.trim().toLowerCase() === 'loans') || wb.SheetNames[0];
  const ws = name && wb.Sheets[name];
  if (!ws || !ws['!ref']) return { ok: false, code: 'SHEET_EMPTY', message: 'the workbook has no data' };
  const range = XLSX.utils.decode_range(ws['!ref']);
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  return { ok: true, sheetName: name, aoa, firstRow: range.s.r + 1 };
}

/** Index (in aoa) of the header row: the first of the top 11 rows with ≥ 3 recognised headers (else the best one). */
function detectHeaderRow(aoa) {
  const known = new Set(FIELDS.flatMap((f) => f.synonyms));
  let best = { index: -1, score: 0 };
  for (let i = 0; i < Math.min(11, aoa.length); i++) {
    const row = aoa[i] || [];
    let score = 0;
    for (const c of row) {
      const h = normHeader(c);
      if (!h) continue;
      if (known.has(h) || [...known].some((s) => s.length >= 3 && ` ${h} `.includes(` ${s} `))) score += 1;
    }
    if (score >= 3) return i;
    if (score > best.score) best = { index: i, score };
  }
  if (best.index >= 0) return best.index;
  // Nothing recognised: the first non-empty row is the header, so a hand-made mapping can still be applied.
  return aoa.slice(0, 11).findIndex((r) => (r || []).some((c) => cellText(c) !== ''));
}

const BALANCE_WORDS = ['outstanding', 'balance', 'pending', 'bal', 'opening', 'op', 'os', 'closing'];
const NOT_BALANCE_WORDS = ['deduct', 'deduction', 'emi', 'instalment', 'installment', 'principal', 'date'];

/**
 * Columns that look like a loan balance ("Pending Loan Amount", "Op sep", "Balance"…), in sheet order.
 * A file can carry several (balance before and after a month's deduction); the LAST one is the
 * default cutover outstanding and the user can pick another (coordinator, PR-10 follow-up).
 */
function balanceColumns(headers) {
  return headers.filter((h) => {
    const t = normHeader(h.text).split(' ');
    if (t.some((w) => NOT_BALANCE_WORDS.includes(w))) return false;
    return t.some((w) => BALANCE_WORDS.includes(w)) || normHeader(h.text) === 'o s';
  }).map((h) => h.index);
}

/** Automatic mapping {field: columnIndex} from header synonyms; each column used once. */
function autoMap(headers) {
  const map = {};
  const used = new Set();
  const norm = headers.map((h) => normHeader(h.text));
  const balances = balanceColumns(headers);
  if (balances.length) {
    const last = balances[balances.length - 1];
    map.outstanding = last;
    used.add(headers.findIndex((h) => h.index === last));
  }
  // The other balance columns are never auto-mapped to anything else (e.g. original principal).
  const balanceIdx = new Set(balances.map((b) => headers.findIndex((h) => h.index === b)));
  for (const f of FIELDS) {
    if (map[f.key] !== undefined) continue;
    const i = norm.findIndex((h, idx) => !used.has(idx) && !balanceIdx.has(idx) && f.synonyms.includes(h));
    if (i >= 0) { map[f.key] = headers[i].index; used.add(i); }
  }
  for (const key of CONTAINS_ORDER) {
    if (map[key] !== undefined) continue;
    const f = FIELDS.find((x) => x.key === key);
    const i = norm.findIndex((h, idx) => !used.has(idx) && !balanceIdx.has(idx) && h && f.synonyms.some((s) => s.length >= 3 && ` ${h} `.includes(` ${s} `)));
    if (i >= 0) { map[key] = headers[i].index; used.add(i); }
  }
  return map;
}

/** Validates a {field: columnIndex} mapping against the header list. */
function validateMapping(mapping, headers, { defaultCompany = null } = {}) {
  const errors = [];
  const valid = new Set(headers.map((h) => h.index));
  const seen = new Map();
  const clean = {};
  for (const [k, v] of Object.entries(mapping || {})) {
    if (!FIELD_KEYS.includes(k)) { errors.push(`unknown field "${k}"`); continue; }
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (!Number.isInteger(n) || !valid.has(n)) { errors.push(`${k}: column ${v} is not a header column`); continue; }
    if (seen.has(n)) { errors.push(`${k} and ${seen.get(n)} both use the same column`); continue; }
    seen.set(n, k);
    clean[k] = n;
  }
  const byCode = clean.code !== undefined;
  for (const f of FIELDS.filter((x) => x.required)) {
    if (f.key === 'name' && byCode) continue;          // with a code column the name is only a cross-check
    if (clean[f.key] === undefined) errors.push(`${f.label} is not mapped to a column`);
  }
  // With a code column the company comes from the employee master (the default covers a master without one).
  if (!byCode && clean.company === undefined && !normaliseCompany(defaultCompany)) {
    errors.push('Company is not mapped to a column and no default company was chosen');
  }
  return errors.length ? { ok: false, code: 'MAPPING_INVALID', message: errors.join('; '), errors } : { ok: true, mapping: clean };
}

/** Company name from the sheet → one of VALID_COMPANIES, or null. */
function normaliseCompany(v) {
  const s = cellText(v);
  if (!s) return null;
  const exact = VALID_COMPANIES.find((c) => c.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const u = s.toUpperCase().replace(/[^A-Z]+/g, ' ').trim();
  if (u.startsWith('INDRIYAN')) return 'Indriyan Beverages Pvt Ltd';
  if (u.startsWith('ASIAN')) return 'Asian Lakto Ind Ltd';
  return null;
}

/** Money cell → {ok, paise|null}. ₹, Rs, INR and commas are stripped; blank → null. */
function parseMoneyCell(v) {
  if (v === null || v === undefined) return { ok: true, paise: null };
  let n;
  if (typeof v === 'number') n = v;
  else {
    const s = String(v).replace(/₹|rs\.?|inr|,|\s/gi, '');
    if (s === '' || s === '-') return { ok: true, paise: null };
    if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false };
    n = Number(s);
  }
  if (!Number.isFinite(n)) return { ok: false };
  const scaled = n * 100;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) return { ok: false, tooManyDecimals: true };
  return { ok: true, paise: Math.round(scaled) };
}

/**
 * Loan-date cell → {ok, value:'YYYY-MM-DD'|null}. Excel date serials are exact.
 * Text: YYYY-MM-DD, or DAY-first DD-MM-YYYY / DD/MM/YYYY / DD.MM.YYYY (4-digit
 * year), or 3-Apr-2026 / 3 April 2026. A month above 12 (a US-style date), a
 * 2-digit year or anything else → not readable.
 */
function parseIndianDate(v) {
  if (v === null || v === undefined || cellText(v) === '') return { ok: true, value: null };
  let d = null;
  if (typeof v === 'number') {
    const c = XLSX.SSF.parse_date_code(v);
    if (c && c.y) d = { year: c.y, month: c.m, day: c.d };
  } else {
    const s = cellText(v);
    let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) d = { year: +m[1], month: +m[2], day: +m[3] };
    else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) d = { year: +m[3], month: +m[2], day: +m[1] };
    else if ((m = /^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]+(\d{4})$/.exec(s))) {
      const mo = MONTHS[m[2].toUpperCase()];
      if (mo) d = { year: +m[3], month: mo, day: +m[1] };
    }
  }
  if (!d || d.month < 1 || d.month > 12) return { ok: false };
  const iso = formatDate(d);
  if (!parseDate(iso) || d.year < 1990) return { ok: false };
  return { ok: true, value: iso };
}

/** Free-text loan type → a policy loan type; blank / unknown → Personal with a warning. */
function mapLoanType(v, loanTypes) {
  const s = cellText(v);
  if (!s) return { value: loanTypes.includes('Personal') ? 'Personal' : loanTypes[0], defaulted: true, original: null };
  const lc = s.toLowerCase();
  const exact = loanTypes.find((t) => t.toLowerCase() === lc);
  if (exact) return { value: exact, defaulted: false, original: s };
  const hint = [['emergenc', 'Emergency / medical'], ['medical', 'Emergency / medical'], ['festival', 'Festival advance'],
    ['education', 'Education'], ['school', 'Education'], ['personal', 'Personal']].find(([k, t]) => lc.includes(k) && loanTypes.includes(t));
  if (hint) return { value: hint[1], defaulted: false, original: s };
  return { value: loanTypes.includes('Personal') ? 'Personal' : loanTypes[0], defaulted: true, original: s };
}

/** Outstanding + EMI cells → parsed values and their (finance-fixable) errors. Also used when the columns are re-chosen. */
function amountChecks(outCell, emiCell) {
  const errors = [];
  const out = parseMoneyCell(outCell);
  if (!out.ok || out.paise === null || out.paise <= 0) errors.push({ code: 'OUTSTANDING_INVALID', message: 'outstanding must be an amount above ₹0 with at most 2 decimals' });
  const emi = parseMoneyCell(emiCell);
  if (emi.ok && (emi.paise === null || emi.paise === 0)) errors.push({ code: 'EMI_MISSING', message: 'monthly EMI is 0 or blank — finance must enter it (with a note)' });
  else if (!emi.ok || emi.paise < 0) errors.push({ code: 'EMI_INVALID', message: 'monthly EMI must be an amount above ₹0' });
  else if (emi.paise % 100 !== 0) errors.push({ code: 'EMI_NOT_WHOLE_RUPEE', message: 'monthly EMI must be a whole rupee amount (no paise)' });
  return { out, emi, errors };
}

/** Errors that finance can cure by confirming corrected amounts (ruling Q7). */
const AMOUNT_ERRORS = new Set(['OUTSTANDING_INVALID', 'EMI_INVALID', 'EMI_NOT_WHOLE_RUPEE', 'EMI_MISSING']);

/**
 * Parses a workbook. Without `mapping` the automatic one is used.
 * @returns {{ok:true, sheetName, headerRow, headers:[{index,text}], mapping, autoMapping, rows, skipped}
 *          | {ok:false, code, message}}
 */
function parseWorkbook(buffer, { mapping = null, defaultCompany = null, loanTypes, today = todayIst() } = {}) {
  const sheet = readSheet(buffer);
  if (!sheet.ok) return sheet;
  const hIdx = detectHeaderRow(sheet.aoa);
  if (hIdx < 0) return { ok: false, code: 'HEADER_NOT_FOUND', message: 'no header row found in the first 11 rows' };
  const headers = (sheet.aoa[hIdx] || []).map((t, index) => ({ index, text: cellText(t) })).filter((h) => h.text);
  const auto = autoMap(headers);
  const v = validateMapping(mapping || auto, headers, { defaultCompany });
  const base = { sheetName: sheet.sheetName, headerRow: sheet.firstRow + hIdx, headers, autoMapping: auto, balanceColumns: balanceColumns(headers) };
  if (!v.ok) return { ...v, ...base, mapping: mapping || auto };
  const map = v.mapping;
  const defCo = normaliseCompany(defaultCompany);
  const rows = [];
  const skipped = [];
  for (let i = hIdx + 1; i < sheet.aoa.length; i++) {
    const cells = sheet.aoa[i] || [];
    const rowNo = sheet.firstRow + i;
    const get = (k) => (map[k] === undefined ? null : cells[map[k]]);
    const mappedVals = Object.values(map).map((c) => cellText(cells[c]));
    if (mappedVals.every((s) => s === '')) continue;
    const name = cellText(get('name'));
    const code = cellText(get('code')).toUpperCase().replace(/\s+/g, '');
    const totalRe = /^(grand\s*)?(sub\s*)?total\b/i;
    // A total / subtotal row: no employee code and a "Total" label (in the name column or the first filled cell).
    const firstText = cells.map(cellText).find((t) => t !== '') || '';
    if ((!code && (totalRe.test(name) || totalRe.test(firstText))) || totalRe.test(code)) { skipped.push({ rowNo, reason: 'total row' }); continue; }
    const raw = {};
    for (const h of headers) raw[h.text] = cells[h.index] === undefined ? null : cells[h.index];
    const errors = [];
    const warnings = [];
    const byCode = map.code !== undefined;
    if (!name && !code) errors.push({ code: 'NAME_MISSING', message: 'name is blank' });
    if (byCode && !code && !name) errors.push({ code: 'CODE_MISSING', message: 'employee code and name are blank' });
    const coCell = get('company');
    // With a code column a blank company is resolved from the employee master at matching (default as fallback).
    const company = cellText(coCell) ? normaliseCompany(coCell) : (byCode && code ? null : defCo);
    if (!company && !(byCode && code && !cellText(coCell))) errors.push({ code: 'COMPANY_INVALID', message: cellText(coCell) ? `company "${cellText(coCell)}" is not one of: ${VALID_COMPANIES.join(', ')}` : 'company is blank' });
    const am = amountChecks(get('outstanding'), get('emi'));
    const out = am.out;
    const emi = am.emi;
    errors.push(...am.errors);
    const op = parseMoneyCell(get('originalPrincipal'));
    if (!op.ok || (op.paise !== null && op.paise <= 0)) errors.push({ code: 'PRINCIPAL_INVALID', message: 'original principal must be an amount above ₹0 (or blank)' });
    const ld = parseIndianDate(get('loanDate'));
    if (!ld.ok) errors.push({ code: 'LOAN_DATE_INVALID', message: `loan date "${cellText(get('loanDate'))}" cannot be read as a day-first date (DD-MM-YYYY)` });
    else if (ld.value && ld.value > today) errors.push({ code: 'LOAN_DATE_IN_FUTURE', message: 'loan date is in the future' });
    const lt = mapLoanType(get('loanType'), loanTypes);
    if (lt.defaulted) warnings.push({ code: 'LOAN_TYPE_DEFAULTED', message: lt.original ? `loan type "${lt.original}" not recognised; imported as ${lt.value}` : `no loan type; imported as ${lt.value}` });
    if (out.ok && op.ok && out.paise && op.paise && out.paise > op.paise) {
      warnings.push({ code: 'OUTSTANDING_ABOVE_PRINCIPAL', message: 'outstanding is above the original principal' });
    }
    rows.push({
      rowNo, raw, code: code || null, name, company, department: cellText(get('department')) || null, loanDate: ld.ok ? ld.value : null,
      originalPrincipalPaise: op.ok ? op.paise : null, outstandingPaise: out.ok ? out.paise : null, emiPaise: emi.ok ? emi.paise : null,
      loanType: lt.value, loanTypeOriginal: lt.original, agreementRef: cellText(get('agreementRef')) || null, notes: cellText(get('notes')) || null,
      errors, warnings, amountFixable: errors.length > 0 && errors.every((e) => AMOUNT_ERRORS.has(e.code)),
    });
  }
  return { ok: true, ...base, mapping: map, rows, skipped };
}

/** The downloadable template (scope 1). */
function buildTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
  ws['!cols'] = TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Loans');
  const notes = XLSX.utils.aoa_to_sheet([
    ['Field', 'How to fill it'],
    ['Employee code', 'Recommended. Punch / employee code (S… for sales staff). When given, the match is exact by code and the name is only a cross-check; the company comes from the employee master.'],
    ['Name', 'Required. As in the employee master; HR confirms the match to an employee code.'],
    ['Company', `Required when there is no employee code. ${VALID_COMPANIES.join(' or ')}.`],
    ['Department', 'Optional. Helps match people who share a name.'],
    ['Loan date (DD-MM-YYYY)', 'Optional. Day first: 03-04-2026 = 3 April 2026. A date that cannot be read makes the row invalid.'],
    ['Original principal', 'Optional. ₹ amount first lent.'],
    ['Outstanding at cutover', 'Required. ₹ still owed BEFORE the cutover month\'s EMI.'],
    ['Monthly EMI', 'Required. Whole rupees; the last instalment is the remainder.'],
    ['Loan type', 'Optional. Personal, Emergency / medical, Festival advance or Education (blank = Personal).'],
    ['Agreement ref', 'Optional. File or DMS number of the signed agreement.'],
    ['Notes', 'Optional.'],
  ]);
  notes['!cols'] = [{ wch: 26 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, notes, 'Read me');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  FIELDS, TEMPLATE_HEADERS, AMOUNT_ERRORS,
  readSheet, detectHeaderRow, autoMap, balanceColumns, amountChecks, validateMapping, normaliseCompany, parseMoneyCell, parseIndianDate, mapLoanType,
  parseWorkbook, buildTemplate,
};

/**
 * Loans PR-10 — name-to-code matching for the accounts-Excel import (K37).
 *
 * Proposals only: nothing here is ever accepted without HR confirming it.
 * Tiers: exact (one Active person with the same normalised name) → ambiguous
 * (several; pre-selected only when the department settles it) → close spelling
 * (typo, swapped order, initials; never pre-selected) → inactive (the name is
 * only found on a Left / Inactive person: settle outside the app, ruling Q3) →
 * none.
 *
 * Pools (read-only): plant = `employees` not typed "Sales" (a loan on a
 * Sales-typed plant row is deducted nowhere, SPEC §8.3) whose company is the
 * row's company OR unknown (the plant company field is unreliable, K7); sales =
 * `sales_employees` of the row's company (a sales borrower is code + company).
 */
const { normalizeName } = require('../salesCoordinatorParser');
const { VALID_COMPANIES } = require('./policy');

const HONORIFICS = new Set(['MR', 'MRS', 'MS', 'MISS', 'SH', 'SHRI', 'SMT', 'KUMARI', 'KU', 'KM', 'DR']);

/** The sales parser's normaliser after punctuation → spaces and a leading honorific dropped. */
function normalizeImportName(s) {
  const n = normalizeName(String(s == null ? '' : s).replace(/[.,'`’\-_()/]/g, ' '));
  const t = n.split(' ').filter(Boolean);
  while (t.length > 1 && HONORIFICS.has(t[0])) t.shift();
  return t.join(' ');
}

const normDept = (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const isKnownCompany = (c) => VALID_COMPANIES.includes(String(c == null ? '' : c).trim());

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length; const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** "R K SHARMA" ↔ "RAJ KUMAR SHARMA": same token count, last name equal, other tokens equal or an initial. */
function initialsMatch(a, b) {
  const x = a.split(' '); const y = b.split(' ');
  if (x.length !== y.length || x.length < 2) return false;
  if (x[x.length - 1] !== y[y.length - 1]) return false;
  let initials = 0;
  for (let i = 0; i < x.length - 1; i++) {
    if (x[i] === y[i]) continue;
    if ((x[i].length === 1 && y[i].startsWith(x[i])) || (y[i].length === 1 && x[i].startsWith(y[i]))) { initials += 1; continue; }
    return false;
  }
  return initials > 0;
}

/** Close-spelling score in (0, 1] with a reason, or null. */
function closeScore(rowName, candName) {
  if (!rowName || !candName || rowName === candName) return null;
  const sortTok = (s) => s.split(' ').sort().join(' ');
  if (sortTok(rowName) === sortTok(candName)) return { score: 0.95, reason: 'same words, different order' };
  const d = levenshtein(rowName, candName);
  const maxD = Math.min(rowName.length, candName.length) <= 6 ? 1 : 2;
  if (d <= maxD) return { score: Math.round((1 - d / Math.max(rowName.length, candName.length)) * 1000) / 1000, reason: `${d} letter${d === 1 ? '' : 's'} different` };
  if (initialsMatch(rowName, candName)) return { score: 0.8, reason: 'initials' };
  // One name is the other with a word missing ("SHUBHAM" ↔ "SHUBHAM KUMAR"): every word of the shorter
  // (each 3+ letters) appears in the longer.
  const [short, long] = rowName.split(' ').length <= candName.split(' ').length ? [rowName, candName] : [candName, rowName];
  const sw = short.split(' '); const lw = new Set(long.split(' '));
  if (sw.length < lw.size && sw.every((w) => w.length >= 3 && lw.has(w))) return { score: 0.75, reason: 'a word missing' };
  return null;
}

/**
 * Pool of possible borrowers for one company (all statuses; matching uses the
 * Active ones and reports Left / Inactive exact hits separately).
 */
function loadPool(db, company) {
  const plant = db.prepare(`SELECT code, name, company, department, employment_type, status, date_of_joining, is_contractor
                              FROM employees WHERE LOWER(TRIM(COALESCE(employment_type, ''))) <> 'sales'`).all()
    .filter((e) => String(e.company || '').trim() === company || !isKnownCompany(e.company))
    .map((e) => ({
      borrowerType: 'plant', code: e.code, name: e.name, nameNorm: normalizeImportName(e.name), company: isKnownCompany(e.company) ? e.company.trim() : null,
      masterCompany: e.company || null, department: e.department || null, deptNorm: normDept(e.department), employmentType: e.employment_type || null,
      isContractor: Number(e.is_contractor) === 1, status: e.status, doj: e.date_of_joining || null,
    }));
  const sales = db.prepare('SELECT code, name, company, designation, headquarters, status, doj FROM sales_employees WHERE company = ?').all(company)
    .map((e) => ({
      borrowerType: 'sales', code: e.code, name: e.name, nameNorm: normalizeImportName(e.name), company: e.company, masterCompany: e.company,
      department: 'Sales', deptNorm: 'SALES', designation: e.designation || null, headquarters: e.headquarters || null, employmentType: 'Sales',
      isContractor: false, status: e.status, doj: e.doj || null,
    }));
  return [...plant, ...sales];
}

const isActive = (p) => String(p.status || '').trim() === 'Active';

function publicCandidate(p, extra = {}) {
  const { nameNorm: _n, deptNorm: _d, ...rest } = p;
  return { ...rest, ...extra };
}

/**
 * @param {Array} pool loadPool() for the row's company
 * @param {{name:string, department?:string}} row
 * @returns {{tier, nameNorm, candidates:Array, selected:null|{borrowerType, code, company, by}}}
 */
function matchRow(pool, row) {
  const nameNorm = normalizeImportName(row.name);
  const dept = normDept(row.department);
  const active = pool.filter(isActive);
  const exact = active.filter((p) => p.nameNorm === nameNorm);
  const pick = (p, by) => ({ borrowerType: p.borrowerType, code: p.code, company: p.borrowerType === 'sales' ? p.company : null, by });
  if (exact.length === 1) {
    return { tier: 'exact', nameNorm, candidates: exact.map((p) => publicCandidate(p, { reason: 'exact name' })), selected: pick(exact[0], 'exact name') };
  }
  if (exact.length > 1) {
    const byDept = dept ? exact.filter((p) => p.deptNorm === dept) : [];
    return {
      tier: 'ambiguous', nameNorm,
      candidates: exact.map((p) => publicCandidate(p, { reason: dept && p.deptNorm === dept ? 'exact name, same department' : 'exact name' })),
      selected: byDept.length === 1 ? pick(byDept[0], 'department') : null,
    };
  }
  const close = [];
  for (const p of active) {
    if (dept && p.borrowerType === 'plant' && p.deptNorm && p.deptNorm !== dept) continue;
    const s = closeScore(nameNorm, p.nameNorm);
    if (s) close.push({ p, ...s });
  }
  if (close.length) {
    close.sort((a, b) => b.score - a.score || a.p.code.localeCompare(b.p.code));
    return { tier: 'close', nameNorm, candidates: close.slice(0, 5).map((c) => publicCandidate(c.p, { reason: c.reason, score: c.score })), selected: null };
  }
  const gone = pool.filter((p) => !isActive(p) && p.nameNorm === nameNorm);
  if (gone.length) {
    return { tier: 'inactive', nameNorm, candidates: gone.map((p) => publicCandidate(p, { reason: `exact name, status ${p.status || 'blank'}` })), selected: null };
  }
  return { tier: 'none', nameNorm, candidates: [], selected: null };
}

/**
 * Excel name vs a master name (PR-10 follow-up): 'same' | 'close' (the close-spelling rule above) | 'mismatch'.
 * A blank Excel name is 'same' (nothing to cross-check).
 */
function nameCheck(excelName, masterName) {
  const a = normalizeImportName(excelName);
  const b = normalizeImportName(masterName);
  if (!a || a === b) return { result: 'same' };
  const c = closeScore(a, b);
  return c ? { result: 'close', reason: c.reason } : { result: 'mismatch' };
}

const isSalesCode = (code) => /^S/i.test(String(code || '').trim());

/**
 * Exact match by employee code (PR-10 follow-up). S-prefixed → sales_employees
 * (of the row's company when the file has one, else any company); otherwise →
 * plant employees (a plant row typed Sales is never a borrower, SPEC §8.3).
 * The name is a cross-check: same → tier 'code' (pre-selected); close spelling →
 * 'code_close' (pre-selected, flagged); anything else → 'code_mismatch' (listed,
 * NOT pre-selected, HR confirms with a note). Not found → 'none'; found but not
 * Active → 'inactive' (settle outside the app). `company` = the loan's company:
 * the file's, else the master's, else the default company, else null.
 */
function matchByCode(db, { code, name, company = null, defaultCompany = null }) {
  const c = String(code || '').trim().toUpperCase();
  const nameNorm = normalizeImportName(name);
  let rows;
  if (isSalesCode(c)) {
    rows = (company
      ? db.prepare('SELECT code, name, company, designation, headquarters, status, doj FROM sales_employees WHERE UPPER(code) = ? AND company = ?').all(c, company)
      : db.prepare('SELECT code, name, company, designation, headquarters, status, doj FROM sales_employees WHERE UPPER(code) = ?').all(c))
      .map((e) => ({
        borrowerType: 'sales', code: e.code, name: e.name, nameNorm: normalizeImportName(e.name), company: e.company, masterCompany: e.company,
        department: 'Sales', deptNorm: 'SALES', designation: e.designation || null, headquarters: e.headquarters || null, employmentType: 'Sales',
        isContractor: false, status: e.status, doj: e.doj || null,
      }));
  } else {
    rows = db.prepare(`SELECT code, name, company, department, employment_type, status, date_of_joining, is_contractor FROM employees
                        WHERE UPPER(TRIM(code)) = ? AND LOWER(TRIM(COALESCE(employment_type, ''))) <> 'sales'`).all(c)
      .map((e) => ({
        borrowerType: 'plant', code: e.code, name: e.name, nameNorm: normalizeImportName(e.name), company: isKnownCompany(e.company) ? e.company.trim() : null,
        masterCompany: e.company || null, department: e.department || null, deptNorm: normDept(e.department), employmentType: e.employment_type || null,
        isContractor: Number(e.is_contractor) === 1, status: e.status, doj: e.date_of_joining || null,
      }));
  }
  const loanCompany = (p) => company || p.company || defaultCompany || null;
  if (!rows.length) return { tier: 'none', nameNorm, candidates: [], selected: null, company: company || null, codeNotFound: true };
  const active = rows.filter(isActive);
  if (!active.length) {
    return { tier: 'inactive', nameNorm, candidates: rows.map((p) => publicCandidate(p, { reason: `code ${c}, status ${p.status || 'blank'}` })), selected: null, company: loanCompany(rows[0]) };
  }
  if (active.length > 1) {
    return { tier: 'ambiguous', nameNorm, candidates: active.map((p) => publicCandidate(p, { reason: `code ${c} in ${p.company}` })), selected: null, company: company || null };
  }
  const p = active[0];
  const nc = nameCheck(name, p.name);
  const pick = { borrowerType: p.borrowerType, code: p.code, company: p.borrowerType === 'sales' ? p.company : null, by: 'code' };
  if (nc.result === 'same') return { tier: 'code', nameNorm, candidates: [publicCandidate(p, { reason: 'code, same name' })], selected: pick, company: loanCompany(p) };
  if (nc.result === 'close') {
    return { tier: 'code_close', nameNorm, candidates: [publicCandidate(p, { reason: `code; name ${nc.reason}` })], selected: pick, company: loanCompany(p),
      warning: { code: 'NAME_CLOSE_SPELLING', message: `the Excel name differs from the master (${nc.reason}) — the code matches; confirm it is the same person` } };
  }
  return { tier: 'code_mismatch', nameNorm, candidates: [publicCandidate(p, { reason: 'code matches; NAME DIFFERS' })], selected: null, company: loanCompany(p),
    warning: { code: 'NAME_MISMATCH', message: 'the Excel name and the master name for this code differ — HR must confirm (with a note) that it is the same person' } };
}

module.exports = { nameCheck, matchByCode, isSalesCode, normalizeImportName, normDept, levenshtein, initialsMatch, closeScore, loadPool, matchRow, isKnownCompany };

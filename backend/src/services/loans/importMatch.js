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

module.exports = { normalizeImportName, normDept, levenshtein, initialsMatch, closeScore, loadPool, matchRow, isKnownCompany };

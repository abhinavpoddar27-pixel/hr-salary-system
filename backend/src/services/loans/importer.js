/**
 * Loans PR-10 — import of the loans run outside the app (docs/loans/SPEC.md
 * D-9, D-26, K36, K37; §7 last row; coordinator rulings 10 Oct 2026).
 *
 *   upload (HR or finance) → HR confirms each match → finance confirms each
 *   balance (may correct it, with a note) → the admin approves the batch and
 *   names the cutover month M → one ACTIVE loan per confirmed row.
 *
 * An imported loan is an OPENING BALANCE, not a payout: principal = disbursed =
 * balance = the confirmed outstanding, disbursement_mode 'Opening balance
 * (import)', an `imported` loan event (never `disbursed`). So reconciliation
 * (disbursed − posted − receipts − written off = balance) is exact from the
 * first minute. disbursed_on is the last payroll date of M−1, which makes the
 * engine's own firstEmiMonth() land on M and puts the opening in M−1 on the
 * statement. Schedule = outstanding ÷ EMI from M, the last instalment the
 * remainder. Eligibility is NOT enforced (these loans exist); its findings are
 * warnings. Allowed while loans_disbursement_enabled = '0' (ruling Q1).
 *
 * Every function returns a plain object and never throws for a refusal.
 * Pre-approval steps write audit_log (loan_events needs a loan); the per-loan
 * `imported` event carries the whole chain of who did what.
 */
const crypto = require('crypto');
const { toPaise, toRupees, parseAmount } = require('./money');
const { addMonths, compareMonth, isValidMonth, todayIst, monthLabel, daysInMonth, formatDate, parseDate, addMonthsToDate } = require('./months');
const { readLoanPolicy } = require('./policy');
const { buildScheduleByEmi, closedMonths, firstEmiMonth } = require('./schedule');
const { checkActor } = require('./states');
const { writeEvent } = require('./events');
const { fail, text, getLoan, inTxn, firstUnclosedMonth } = require('./common');
const { reconcileLoan } = require('./reconcile');
const { loadBorrowerFacts } = require('./eligibility');
const { earnedBase, priorDeductions, computeHeadroom } = require('./headroom');
const P = require('./importParse');
const Mx = require('./importMatch');

const IMPORT_MODE = 'Opening balance (import)';
const OUT_REASON = {
  duplicate: 'Duplicate line in the file',
  excluded: 'Excluded by HR',
  invalid: 'Invalid row',
  unmatched: 'No employee matched',
  left: 'Left — settle outside the app',
};

// ── helpers ──────────────────────────────────────────────────────────────────

function importReady(db) {
  const flag = db.prepare("SELECT value FROM policy_config WHERE key = 'migration_loans_schema_v2_done'").get();
  const t = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'loan_import_rows'").get();
  return !!(flag && t);
}

function audit(db, { table, recordId, field, oldValue = '', newValue = '', actor, remark = null, action, employeeCode = null }) {
  db.prepare(`INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type)
              VALUES (?, ?, ?, ?, ?, ?, 'loans_import', ?, ?, ?)`)
    .run(table, recordId, field, oldValue == null ? '' : String(oldValue), newValue == null ? '' : String(newValue),
      actor.username, remark, employeeCode, `loan_import_${action}`);
}

const json = (v, d) => { try { return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const istMonth = (now) => { const [y, m] = todayIst(now).split('-').map(Number); return { month: m, year: y }; };

function getBatch(db, id) {
  return db.prepare('SELECT * FROM loan_import_batches WHERE id = ?').get(id) || null;
}
function getRow(db, batchId, rowId) {
  return db.prepare('SELECT * FROM loan_import_rows WHERE id = ? AND batch_id = ?').get(rowId, batchId) || null;
}

function hydrate(r) {
  return {
    ...r,
    raw: json(r.raw, {}), parse_errors: json(r.parse_errors, []), candidates: json(r.candidates, []), warnings: json(r.warnings, []),
  };
}

const fixable = (row) => row.parse_status === 'invalid' && row.parse_errors.length > 0 && row.parse_errors.every((e) => P.AMOUNT_ERRORS.has(e.code));

/** 'in' | 'out' | 'needs_match' | 'needs_balance', with the out reason. Row must be hydrated. */
function rowState(row) {
  if (row.parse_status === 'duplicate') return { state: 'out', reason: 'duplicate' };
  if (row.match_status === 'excluded') return { state: 'out', reason: 'excluded' };
  if (row.parse_status === 'invalid' && !fixable(row)) return { state: 'out', reason: 'invalid' };
  if (row.match_status === 'pending') {
    if (row.match_tier === 'inactive') return { state: 'out', reason: 'left' };
    if (row.match_tier === 'none' || !row.match_tier) return { state: 'out', reason: 'unmatched' };
    return { state: 'needs_match' };
  }
  if (row.parse_status === 'invalid' || row.balance_status !== 'confirmed') return { state: 'needs_balance' };
  return { state: 'in' };
}

const effOutstanding = (row) => toPaise(row.balance_status === 'confirmed' ? row.confirmed_outstanding : row.outstanding);
const effEmi = (row) => toPaise(row.balance_status === 'confirmed' ? row.confirmed_emi : row.emi);
const money2 = (p) => (p === null || p === undefined || Number.isNaN(p) ? '' : (p / 100).toFixed(2));

/** Per-loan key across batches: an edited file cannot import the same loan twice. */
function rowKey(row) {
  return [row.borrower_type, row.employee_code, row.company, row.loan_date || '',
    row.original_principal === null || row.original_principal === undefined ? '' : Number(row.original_principal).toFixed(2),
    text(row.agreement_ref).toUpperCase()].join('|');
}

function companiesAllowed(companies, list) {
  return !companies || list.every((c) => !c || companies.includes(c));
}

function batchCompanies(db, batchId) {
  return db.prepare('SELECT DISTINCT company FROM loan_import_rows WHERE batch_id = ? AND company IS NOT NULL').all(batchId).map((r) => r.company);
}

/** Borrower checks shared by confirmMatch and approval (ruling Q3: Active only). */
function checkBorrower(db, { borrowerType, employeeCode, company }) {
  const code = text(employeeCode);
  if (!['plant', 'sales'].includes(borrowerType)) return fail('BORROWER_TYPE_INVALID', 'borrower must be plant or sales');
  if (!code) return fail('EMPLOYEE_NOT_FOUND', 'employee code is required');
  if (borrowerType === 'plant') {
    const e = db.prepare('SELECT code, name, status, employment_type, company FROM employees WHERE code = ?').get(code);
    if (!e) return fail('EMPLOYEE_NOT_FOUND', `no plant employee ${code}`);
    if (String(e.employment_type || '').trim().toLowerCase() === 'sales') {
      return fail('SALES_USE_SALES_MASTER', `${code} is a plant row typed Sales — a loan on it is deducted nowhere; pick the sales-master code`);
    }
    if (String(e.status || '').trim() !== 'Active') return fail('BORROWER_NOT_ACTIVE', `${code} is ${e.status || 'blank'}, not Active — settle this loan outside the app`);
    return { ok: true, employee: e };
  }
  const s = db.prepare('SELECT code, name, status, company FROM sales_employees WHERE code = ? AND company = ?').get(code, text(company));
  if (!s) return fail('EMPLOYEE_NOT_FOUND', `no sales employee ${code} in ${text(company) || 'that company'}`);
  if (String(s.status || '').trim() !== 'Active') return fail('BORROWER_NOT_ACTIVE', `${code} is ${s.status || 'blank'}, not Active — settle this loan outside the app`);
  return { ok: true, employee: s };
}

/** Eligibility findings as warnings (not enforced for imports). Row hydrated, with a confirmed borrower. */
function rowWarnings(db, row, policy, batchRows = []) {
  const w = [...(row.parse_warnings || [])];
  if (!row.borrower_type || !row.employee_code) return w;
  const add = (code, message, extra = {}) => w.push({ code, message, ...extra });
  const facts = loadBorrowerFacts(db, { borrowerType: row.borrower_type, employeeCode: row.employee_code, company: row.company });
  const out = effOutstanding(row);
  const emi = effEmi(row);
  if (facts.found) {
    const type = String(facts.employmentType || '').toLowerCase();
    if (row.borrower_type === 'plant' && (type.includes('contract') || Number(facts.isContractor) === 1)) {
      add('CONTRACT_WORKER', 'contract worker — imported because the loan already exists (D-17 governs new loans only)');
    }
    if (row.borrower_type === 'plant') {
      if (!Mx.isKnownCompany(facts.masterCompany)) add('MASTER_COMPANY_UNKNOWN', `employee master company is "${facts.masterCompany || 'blank'}"; the loan is booked to ${row.company}`);
      else if (String(facts.masterCompany).trim() !== row.company) add('COMPANY_DIFFERS_FROM_MASTER', `employee master says ${facts.masterCompany}; the loan is booked to ${row.company}`);
    }
    if (!parseDate(facts.doj)) add('SERVICE_UNKNOWN', 'date of joining is missing or invalid');
    else if (todayIst() < addMonthsToDate(facts.doj, policy.minServiceMonths)) add('MIN_SERVICE_NOT_MET', `under ${policy.minServiceMonths} months of service`);
    const g = facts.grossPaise || 0;
    if (!(g > 0)) add('GROSS_UNKNOWN', 'monthly gross is not set');
    else {
      const basis = row.original_principal ? toPaise(row.original_principal) : out;
      const mult = row.loan_type === 'Emergency / medical' ? policy.maxMultipleGrossEmergency : policy.maxMultipleGross;
      if (basis > Math.floor(g * mult)) add('AMOUNT_OVER_LIMIT', `loan is above ${mult}× monthly gross`);
      if (emi > Math.floor((g * policy.emiCeilingPctGross) / 100)) add('EMI_OVER_CEILING', `EMI is above ${policy.emiCeilingPctGross}% of monthly gross`);
    }
    if (Number(facts.openLoanCount || 0) > 0) add('SECOND_LOAN', `already has ${facts.openLoanCount} open loan(s) in the app`);
    const h = facts.history;
    if (!h || !h.months) add('NO_SALARY_HISTORY', 'no computed salary yet — the deduction room cannot be checked');
    else {
      const room = computeHeadroom({ earnedBasePaise: Math.floor(h.earnedBasePaise / h.months), capPct: policy.deductionCapPct, priorDeductionsPaise: Math.ceil(h.priorDeductionsPaise / h.months) });
      if (emi > 0 && room < emi) add('HEADROOM_SHORT', `average room under the ${policy.deductionCapPct}% cap over the last ${h.months} month(s) is ₹${toRupees(room)}, below the EMI of ₹${toRupees(emi)}; shortfalls likely`, { projectedHeadroom: toRupees(room) });
    }
  }
  if (emi > 0 && Math.ceil(out / emi) > policy.maxTenureMonths) add('TENURE_OVER_LIMIT', `${Math.ceil(out / emi)} months left — above the ${policy.maxTenureMonths}-month limit for new loans`);
  if (!text(row.agreement_ref)) add('AGREEMENT_MISSING', 'no signed-agreement reference');
  const same = batchRows.filter((r) => r.id !== row.id && r.borrower_type === row.borrower_type && r.employee_code === row.employee_code
    && (row.borrower_type === 'plant' || r.company === row.company) && r.match_status === 'confirmed');
  if (same.length) add('SECOND_LOAN_IN_BATCH', `the same borrower is on row(s) ${same.map((r) => r.row_no).join(', ')}`);
  if (row.balance_status === 'confirmed' && (toPaise(row.confirmed_outstanding) !== toPaise(row.outstanding) || toPaise(row.confirmed_emi) !== toPaise(row.emi))) {
    add('BALANCE_CHANGED_BY_FINANCE', `finance changed outstanding ₹${row.outstanding ?? '—'} → ₹${row.confirmed_outstanding}, EMI ₹${row.emi ?? '—'} → ₹${row.confirmed_emi}`);
  }
  return w;
}

/** Earliest cutover month per payroll: after the latest loan close, and not before the current IST month − 1 (ruling Q2). */
function earliestCutover(db, payroll, now = new Date()) {
  const floor = addMonths(istMonth(now), -1);
  const open = firstUnclosedMonth(db, payroll);
  return open && compareMonth(open, floor) > 0 ? open : floor;
}

/** Included borrowers whose Stage 7 / sales compute for M already ran (their first EMI needs a re-run). */
function stage7ComputedFor(db, rows, M) {
  const out = [];
  for (const r of rows) {
    const hit = r.borrower_type === 'sales'
      ? db.prepare('SELECT 1 FROM sales_salary_computations WHERE employee_code = ? AND company = ? AND month = ? AND year = ? LIMIT 1').get(r.employee_code, r.company, M.month, M.year)
      : db.prepare('SELECT 1 FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ? LIMIT 1').get(r.employee_code, M.month, M.year);
    if (hit) out.push({ rowNo: r.row_no, borrowerType: r.borrower_type, employeeCode: r.employee_code, company: r.company });
  }
  return out;
}

// ── upload ───────────────────────────────────────────────────────────────────

/** Parse only (no write): headers, automatic mapping, preview — the mapping step. */
function previewImport(db, { buffer, mapping = null, defaultCompany = null }) {
  const policy = readLoanPolicy(db);
  const p = P.parseWorkbook(buffer, { mapping, defaultCompany, loanTypes: policy.loanTypes });
  const fields = P.FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required }));
  if (!p.ok) return { ...p, fields };
  return {
    ok: true, fields, sheetName: p.sheetName, headerRow: p.headerRow, headers: p.headers, mapping: p.mapping, autoMapping: p.autoMapping,
    rowCount: p.rows.length, invalidCount: p.rows.filter((r) => r.errors.length).length,
    preview: p.rows.slice(0, 5).map((r) => ({
      rowNo: r.rowNo, name: r.name, company: r.company, department: r.department, loanDate: r.loanDate,
      originalPrincipal: r.originalPrincipalPaise === null ? null : toRupees(r.originalPrincipalPaise),
      outstanding: r.outstandingPaise === null ? null : toRupees(r.outstandingPaise), emi: r.emiPaise === null ? null : toRupees(r.emiPaise),
      loanType: r.loanType, errors: r.errors,
    })),
  };
}

/**
 * Creates a batch from an uploaded workbook: parse, de-duplicate, propose matches.
 * @param {{fileName, buffer, mapping?, defaultCompany?}} input
 */
function createBatch(db, input, actor, { companies = null } = {}) {
  const gate = checkActor('import_upload', actor);
  if (!gate.ok) return gate;
  if (!importReady(db)) return fail('NOT_MIGRATED', 'loan tables are not migrated');
  if (!input || !Buffer.isBuffer(input.buffer) || !input.buffer.length) return fail('FILE_REQUIRED', 'an .xlsx file is required');
  const sha = crypto.createHash('sha256').update(input.buffer).digest('hex');
  const dup = db.prepare("SELECT id, status FROM loan_import_batches WHERE file_sha256 = ? AND status <> 'discarded'").get(sha);
  if (dup) return fail('IMPORT_FILE_ALREADY_UPLOADED', `this file is already batch #${dup.id} (${dup.status})`, { batchId: dup.id });
  const policy = readLoanPolicy(db);
  const p = P.parseWorkbook(input.buffer, { mapping: input.mapping || null, defaultCompany: input.defaultCompany || null, loanTypes: policy.loanTypes });
  if (!p.ok) return p;
  if (!p.rows.length) return fail('NO_ROWS', 'the sheet has no loan rows under the header');
  if (!companiesAllowed(companies, p.rows.map((r) => r.company))) return fail('COMPANY_NOT_ALLOWED', 'the file has rows for a company you do not have access to');

  return inTxn(db, () => {
    const b = db.prepare(`INSERT INTO loan_import_batches (file_name, file_sha256, sheet_name, header_row, column_map, default_company, total_rows, uploaded_by, uploaded_by_role)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(text(input.fileName) || 'upload.xlsx', sha, p.sheetName, p.headerRow, JSON.stringify(p.mapping), P.normaliseCompany(input.defaultCompany),
        p.rows.length, gate.actor.username, gate.actor.role).lastInsertRowid;
    const ins = db.prepare(`INSERT INTO loan_import_rows (batch_id, row_no, raw, name, name_norm, company, department, loan_date, original_principal, outstanding, emi,
                              loan_type, agreement_ref, notes, parse_status, parse_errors, match_tier, candidates, borrower_type, employee_code, warnings)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const pools = new Map();
    const firstSeen = new Map();
    const counts = { rows: 0, invalid: 0, duplicate: 0, exact: 0, ambiguous: 0, close: 0, inactive: 0, none: 0 };
    for (const r of p.rows) {
      const nameNorm = Mx.normalizeImportName(r.name);
      let status = r.errors.length ? 'invalid' : 'ok';
      const errors = [...r.errors];
      const dk = [nameNorm, r.company, r.loanDate, r.originalPrincipalPaise, r.outstandingPaise, r.emiPaise].join('|');
      if (status === 'ok' && firstSeen.has(dk)) {
        status = 'duplicate';
        errors.push({ code: 'DUPLICATE_ROW', message: `same as row ${firstSeen.get(dk)}` });
      } else if (status === 'ok') firstSeen.set(dk, r.rowNo);
      let m = { tier: null, candidates: [], selected: null };
      if (status !== 'duplicate' && r.name && r.company) {
        if (!pools.has(r.company)) pools.set(r.company, Mx.loadPool(db, r.company));
        m = Mx.matchRow(pools.get(r.company), r);
      }
      counts.rows += 1;
      if (status === 'invalid') counts.invalid += 1;
      if (status === 'duplicate') counts.duplicate += 1;
      if (m.tier) counts[m.tier] += 1;
      ins.run(b, r.rowNo, JSON.stringify(r.raw), r.name || null, nameNorm || null, r.company, r.department, r.loanDate,
        r.originalPrincipalPaise === null ? null : toRupees(r.originalPrincipalPaise),
        r.outstandingPaise === null ? null : toRupees(r.outstandingPaise), r.emiPaise === null ? null : toRupees(r.emiPaise),
        r.loanType, r.agreementRef, [r.notes, r.loanTypeOriginal && r.loanTypeOriginal !== r.loanType ? `Excel loan type: ${r.loanTypeOriginal}` : null].filter(Boolean).join(' · ') || null,
        status, JSON.stringify(errors), m.tier, JSON.stringify(m.candidates),
        m.selected ? m.selected.borrowerType : null, m.selected ? m.selected.code : null, JSON.stringify(r.warnings));
    }
    audit(db, { table: 'loan_import_batches', recordId: b, field: 'status', newValue: 'review', actor: gate.actor, action: 'upload',
      remark: `${text(input.fileName)} · ${counts.rows} rows (${counts.invalid} invalid, ${counts.duplicate} duplicate) · sha256 ${sha.slice(0, 12)}` });
    return { ok: true, batchId: b, counts, skipped: p.skipped };
  });
}

// ── reads ────────────────────────────────────────────────────────────────────

function listBatches(db, { companies = null } = {}) {
  if (!importReady(db)) return { ok: true, batches: [] };
  const rows = db.prepare('SELECT * FROM loan_import_batches ORDER BY id DESC').all();
  const batches = [];
  for (const b of rows) {
    if (!companiesAllowed(companies, batchCompanies(db, b.id))) continue;
    const rs = db.prepare('SELECT * FROM loan_import_rows WHERE batch_id = ?').all(b.id).map(hydrate);
    const st = rs.map(rowState);
    batches.push({
      id: b.id, fileName: b.file_name, status: b.status, uploadedBy: b.uploaded_by, uploadedAt: b.uploaded_at, totalRows: b.total_rows,
      cutover: b.cutover_month ? { month: b.cutover_month, year: b.cutover_year } : null, approvedBy: b.approved_by, approvedAt: b.approved_at,
      counts: {
        ready: st.filter((s) => s.state === 'in').length,
        needsMatch: st.filter((s) => s.state === 'needs_match').length,
        needsBalance: st.filter((s) => s.state === 'needs_balance').length,
        out: st.filter((s) => s.state === 'out').length,
        imported: rs.filter((r) => r.outcome === 'imported').length,
      },
    });
  }
  return { ok: true, batches };
}

function batchDetail(db, batchId, { companies = null, cutover = null, now = new Date() } = {}) {
  if (!importReady(db)) return fail('NOT_MIGRATED', 'loan tables are not migrated');
  const b = getBatch(db, batchId);
  if (!b) return fail('BATCH_NOT_FOUND', `import batch ${batchId} not found`);
  if (!companiesAllowed(companies, batchCompanies(db, b.id))) return fail('COMPANY_NOT_ALLOWED', 'this batch has rows for a company you do not have access to');
  const policy = readLoanPolicy(db);
  const rows = db.prepare('SELECT * FROM loan_import_rows WHERE batch_id = ? ORDER BY row_no').all(b.id).map(hydrate);
  const out = rows.map((r) => {
    const s = rowState(r);
    const warnings = r.outcome === 'imported' ? r.warnings
      : (r.match_status === 'confirmed' ? rowWarnings(db, { ...r, parse_warnings: r.warnings }, policy, rows) : r.warnings);
    return {
      ...r, state: s.state, outReason: s.reason || null, outLabel: s.reason ? OUT_REASON[s.reason] : null, amountFixable: fixable(r),
      warnings, effectiveOutstanding: r.outstanding === null && r.confirmed_outstanding === null ? null : toRupees(effOutstanding(r)),
      effectiveEmi: r.emi === null && r.confirmed_emi === null ? null : toRupees(effEmi(r)),
    };
  });
  const blockers = out.filter((r) => r.state === 'needs_match' || r.state === 'needs_balance')
    .map((r) => ({ rowId: r.id, rowNo: r.row_no, name: r.name, code: r.state === 'needs_match' ? 'NEEDS_HR_MATCH' : 'NEEDS_FINANCE_BALANCE' }));
  const included = out.filter((r) => r.state === 'in');
  const payrolls = [...new Set(included.map((r) => r.borrower_type))];
  const earliest = Object.fromEntries(['plant', 'sales'].map((p) => [p, earliestCutover(db, p, now)]));
  const sumP = (list, f) => list.reduce((s, r) => s + f(r), 0);
  const M = cutover && isValidMonth(cutover) ? cutover : (b.cutover_month ? { month: b.cutover_month, year: b.cutover_year } : null);
  return {
    ok: true,
    batch: { ...b, column_map: json(b.column_map, {}), result: json(b.result, null) },
    rows: out,
    sections: {
      needsMatch: out.filter((r) => r.state === 'needs_match').map((r) => r.id),
      needsBalance: out.filter((r) => r.state === 'needs_balance').map((r) => r.id),
      ready: included.map((r) => r.id),
      left: out.filter((r) => r.outReason === 'left').map((r) => r.id),
      unmatched: out.filter((r) => r.outReason === 'unmatched').map((r) => r.id),
      excluded: out.filter((r) => r.outReason === 'excluded').map((r) => r.id),
      invalid: out.filter((r) => r.outReason === 'invalid').map((r) => r.id),
      duplicate: out.filter((r) => r.outReason === 'duplicate').map((r) => r.id),
    },
    approval: {
      canApprove: b.status === 'review' && blockers.length === 0 && included.length > 0,
      blockers, payrolls,
      earliestCutover: earliest,
      earliestForBatch: payrolls.length ? payrolls.map((p) => earliest[p]).sort(compareMonth).pop() : earliest.plant,
      totals: { loans: included.length, outstanding: toRupees(sumP(included, effOutstanding)), monthlyEmi: toRupees(sumP(included, effEmi)) },
      stage7Computed: M && b.status === 'review' ? stage7ComputedFor(db, included, M) : [],
    },
  };
}

// ── HR: match ────────────────────────────────────────────────────────────────

function loadEditable(db, batchId, rowId, companies) {
  const b = getBatch(db, batchId);
  if (!b) return fail('BATCH_NOT_FOUND', `import batch ${batchId} not found`);
  if (b.status !== 'review') return fail('BATCH_NOT_IN_REVIEW', `batch #${b.id} is ${b.status}`);
  const row = getRow(db, batchId, rowId);
  if (!row) return fail('ROW_NOT_FOUND', `row ${rowId} not found in batch #${batchId}`);
  if (companies && row.company && !companies.includes(row.company)) return fail('COMPANY_NOT_ALLOWED', 'you do not have access to this company');
  return { ok: true, batch: b, row: hydrate(row) };
}

/** HR confirms the borrower of a row (the proposal, another candidate, or anyone found by search). */
function confirmMatch(db, { batchId, rowId, borrowerType, employeeCode, company = null, note = null }, actor, { companies = null } = {}) {
  const gate = checkActor('import_confirm_match', actor);
  if (!gate.ok) return gate;
  const e = loadEditable(db, batchId, rowId, companies);
  if (!e.ok) return e;
  const { row } = e;
  if (row.parse_status === 'duplicate') return fail('ROW_NOT_IMPORTABLE', `row ${row.row_no} is a duplicate line`);
  if (row.parse_status === 'invalid' && !fixable(row)) return fail('ROW_NOT_IMPORTABLE', `row ${row.row_no} is invalid: ${row.parse_errors.map((x) => x.message).join('; ')}`);
  if (borrowerType === 'sales' && text(company) && text(company) !== row.company) {
    return fail('SALES_COMPANY_MISMATCH', `the row is for ${row.company}; a sales borrower is code + company`);
  }
  const who = checkBorrower(db, { borrowerType, employeeCode, company: row.company });
  if (!who.ok) return who;
  const code = text(employeeCode);
  const listed = row.candidates.some((c) => c.borrowerType === borrowerType && c.code === code);
  if (!listed && text(note).length < 5) return fail('NOTE_REQUIRED', 'a note (5+ characters) is required when the employee is not one of the proposed candidates');
  return inTxn(db, () => {
    const r = db.prepare(`UPDATE loan_import_rows SET borrower_type = ?, employee_code = ?, match_status = 'confirmed', match_confirmed_by = ?,
                                 match_confirmed_at = datetime('now'), match_note = ?, updated_at = datetime('now')
                           WHERE id = ? AND batch_id = ? AND (SELECT status FROM loan_import_batches WHERE id = ?) = 'review'`)
      .run(borrowerType, code, gate.actor.username, text(note) || null, row.id, batchId, batchId);
    if (r.changes !== 1) return fail('CONCURRENT_CHANGE', 'the batch changed underneath');
    audit(db, { table: 'loan_import_rows', recordId: row.id, field: 'match', actor: gate.actor, action: 'match_confirmed', employeeCode: code,
      oldValue: row.match_status === 'confirmed' ? `${row.borrower_type}:${row.employee_code}` : `${row.match_status} (${row.match_tier || 'no match'})`,
      newValue: `${borrowerType}:${code}`, remark: `batch #${batchId} row ${row.row_no} "${row.name}"${listed ? '' : ' (not a proposed candidate)'}${text(note) ? ` · ${text(note)}` : ''}` });
    return { ok: true, rowId: row.id, borrowerType, employeeCode: code, name: who.employee.name };
  });
}

/** HR excludes a row (a decision: it stays out of the import). */
function excludeRow(db, { batchId, rowId, reason }, actor, { companies = null } = {}) {
  const gate = checkActor('import_confirm_match', actor);
  if (!gate.ok) return gate;
  if (text(reason).length < 3) return fail('REASON_REQUIRED', 'a reason is required to exclude a row');
  const e = loadEditable(db, batchId, rowId, companies);
  if (!e.ok) return e;
  const { row } = e;
  return inTxn(db, () => {
    const r = db.prepare(`UPDATE loan_import_rows SET match_status = 'excluded', match_confirmed_by = ?, match_confirmed_at = datetime('now'),
                                 match_note = ?, updated_at = datetime('now')
                           WHERE id = ? AND batch_id = ? AND (SELECT status FROM loan_import_batches WHERE id = ?) = 'review'`)
      .run(gate.actor.username, text(reason), row.id, batchId, batchId);
    if (r.changes !== 1) return fail('CONCURRENT_CHANGE', 'the batch changed underneath');
    audit(db, { table: 'loan_import_rows', recordId: row.id, field: 'match', actor: gate.actor, action: 'row_excluded', employeeCode: row.employee_code,
      oldValue: row.match_status, newValue: 'excluded', remark: `batch #${batchId} row ${row.row_no} "${row.name}" · ${text(reason)}` });
    return { ok: true, rowId: row.id, status: 'excluded' };
  });
}

// ── finance: balance ─────────────────────────────────────────────────────────

/** Finance confirms (or corrects, with a note — ruling Q7) a row's outstanding and EMI. The Excel values stay on the row. */
function confirmBalance(db, { batchId, rowId, outstanding, emi, note = null }, actor, { companies = null } = {}) {
  const gate = checkActor('import_confirm_balance', actor);
  if (!gate.ok) return gate;
  const e = loadEditable(db, batchId, rowId, companies);
  if (!e.ok) return e;
  const { row } = e;
  if (row.parse_status === 'duplicate') return fail('ROW_NOT_IMPORTABLE', `row ${row.row_no} is a duplicate line`);
  if (row.parse_status === 'invalid' && !fixable(row)) return fail('ROW_NOT_IMPORTABLE', `row ${row.row_no} is invalid: ${row.parse_errors.map((x) => x.message).join('; ')}`);
  const pick = (v, excel, field) => {
    if (v === undefined || v === null || v === '') return excel === null ? fail('AMOUNT_INVALID', `${field} is required`) : { ok: true, paise: toPaise(excel) };
    return parseAmount(v, { field });
  };
  const o = pick(outstanding, row.outstanding, 'outstanding');
  if (!o.ok) return o;
  const m = pick(emi, row.emi, 'EMI');
  if (!m.ok) return m;
  if (m.paise % 100 !== 0) return fail('EMI_NOT_WHOLE_RUPEE', 'EMI must be a whole rupee amount');
  const changed = row.outstanding === null || row.emi === null || o.paise !== toPaise(row.outstanding) || m.paise !== toPaise(row.emi);
  if (changed && text(note).length < 5) return fail('NOTE_REQUIRED', 'a note (5+ characters) is required when the outstanding or EMI differs from the Excel');
  return inTxn(db, () => {
    const r = db.prepare(`UPDATE loan_import_rows SET confirmed_outstanding = ?, confirmed_emi = ?, balance_status = 'confirmed', balance_confirmed_by = ?,
                                 balance_confirmed_at = datetime('now'), balance_note = ?,
                                 parse_status = CASE WHEN parse_status = 'invalid' THEN 'ok' ELSE parse_status END,
                                 parse_errors = CASE WHEN parse_status = 'invalid' THEN '[]' ELSE parse_errors END,
                                 updated_at = datetime('now')
                           WHERE id = ? AND batch_id = ? AND (SELECT status FROM loan_import_batches WHERE id = ?) = 'review'`)
      .run(toRupees(o.paise), toRupees(m.paise), gate.actor.username, text(note) || null, row.id, batchId, batchId);
    if (r.changes !== 1) return fail('CONCURRENT_CHANGE', 'the batch changed underneath');
    audit(db, { table: 'loan_import_rows', recordId: row.id, field: 'balance', actor: gate.actor, action: 'balance_confirmed', employeeCode: row.employee_code,
      oldValue: `outstanding ${row.outstanding ?? '—'} / EMI ${row.emi ?? '—'} (Excel)${row.balance_status === 'confirmed' ? `; was confirmed ${row.confirmed_outstanding} / ${row.confirmed_emi}` : ''}`,
      newValue: `outstanding ${toRupees(o.paise)} / EMI ${toRupees(m.paise)}`,
      remark: `batch #${batchId} row ${row.row_no} "${row.name}"${changed ? ' · CHANGED' : ''}${text(note) ? ` · ${text(note)}` : ''}` });
    return { ok: true, rowId: row.id, outstanding: toRupees(o.paise), emi: toRupees(m.paise), changed };
  });
}

// ── discard ──────────────────────────────────────────────────────────────────

function discardBatch(db, { batchId, reason }, actor, { companies = null } = {}) {
  const gate = checkActor('import_discard', actor);
  if (!gate.ok) return gate;
  const b = getBatch(db, batchId);
  if (!b) return fail('BATCH_NOT_FOUND', `import batch ${batchId} not found`);
  if (!companiesAllowed(companies, batchCompanies(db, b.id))) return fail('COMPANY_NOT_ALLOWED', 'this batch has rows for a company you do not have access to');
  if (gate.actor.role !== 'admin' && gate.actor.username.toLowerCase() !== String(b.uploaded_by).toLowerCase()) {
    return fail('NOT_UPLOADER', 'only the person who uploaded the batch (or the admin) can discard it');
  }
  if (text(reason).length < 3) return fail('REASON_REQUIRED', 'a reason is required to discard a batch');
  if (b.status !== 'review') return fail('BATCH_NOT_IN_REVIEW', `batch #${b.id} is ${b.status}`);
  return inTxn(db, () => {
    const r = db.prepare(`UPDATE loan_import_batches SET status = 'discarded', discarded_by = ?, discarded_at = datetime('now'), discard_reason = ?, updated_at = datetime('now')
                           WHERE id = ? AND status = 'review'`).run(gate.actor.username, text(reason), b.id);
    if (r.changes !== 1) return fail('CONCURRENT_CHANGE', 'the batch changed underneath');
    audit(db, { table: 'loan_import_batches', recordId: b.id, field: 'status', oldValue: 'review', newValue: 'discarded', actor: gate.actor, action: 'discard', remark: text(reason) });
    return { ok: true, batchId: b.id, status: 'discarded' };
  });
}

// ── admin: approve ───────────────────────────────────────────────────────────

/** Last payroll date of the month before M: plant = last calendar day; sales = the 25th (inside cycle M−1, SPEC §5.3). */
function openingDate(payroll, M) {
  const prev = addMonths(M, -1);
  return formatDate({ year: prev.year, month: prev.month, day: payroll === 'sales' ? 25 : daysInMonth(prev.year, prev.month) });
}

/**
 * Admin approves the batch (never one they uploaded or confirmed anything in)
 * and names the cutover month M. All or nothing: one transaction.
 */
function approveBatch(db, { batchId, cutoverMonth, cutoverYear, note = null }, actor, { companies = null, now = new Date() } = {}) {
  const gate = checkActor('import_approve', actor);
  if (!gate.ok) return gate;
  const d = batchDetail(db, batchId, { companies, now });
  if (!d.ok) return d;
  const b = d.batch;
  if (b.status !== 'review') return fail('BATCH_NOT_IN_REVIEW', `batch #${b.id} is ${b.status}`);
  const me = gate.actor.username.toLowerCase();
  const involved = new Set([b.uploaded_by, ...d.rows.map((r) => r.match_confirmed_by), ...d.rows.map((r) => r.balance_confirmed_by)]
    .filter(Boolean).map((u) => String(u).toLowerCase()));
  if (involved.has(me)) return fail('SELF_APPROVAL', 'nobody can approve an import batch they uploaded or confirmed rows in');
  if (d.approval.blockers.length) {
    return fail('ROWS_NOT_DECIDED', `${d.approval.blockers.length} row(s) still need HR or finance: ${d.approval.blockers.map((x) => x.rowNo).join(', ')}`, { blockers: d.approval.blockers });
  }
  const included = d.rows.filter((r) => r.state === 'in');
  if (!included.length) return fail('NOTHING_TO_IMPORT', 'no row is confirmed by both HR and finance');
  const M = { month: Number(cutoverMonth), year: Number(cutoverYear) };
  if (!isValidMonth(M)) return fail('MONTH_INVALID', 'cutover month/year invalid');
  for (const p of d.approval.payrolls) {
    const earliest = d.approval.earliestCutover[p];
    if (compareMonth(M, earliest) < 0) {
      return fail('CUTOVER_TOO_EARLY', `the ${p} cutover month cannot be earlier than ${monthLabel(earliest)} (after the latest loan close, and no earlier than last month)`, { earliest });
    }
  }
  const policy = readLoanPolicy(db);

  return inTxn(db, () => {
    const u = db.prepare(`UPDATE loan_import_batches SET status = 'approved', cutover_month = ?, cutover_year = ?, approved_by = ?, approved_at = datetime('now'),
                                 approval_note = ?, updated_at = datetime('now') WHERE id = ? AND status = 'review'`)
      .run(M.month, M.year, gate.actor.username, text(note) || null, b.id);
    if (u.changes !== 1) return fail('CONCURRENT_CHANGE', 'the batch was approved or discarded underneath');
    const loans = [];
    const leftOut = [];
    const keys = new Map();
    const setOut = db.prepare("UPDATE loan_import_rows SET outcome = 'left_out', outcome_reason = ?, updated_at = datetime('now') WHERE id = ?");
    for (const r of d.rows.filter((x) => x.state === 'out')) {
      setOut.run(OUT_REASON[r.outReason], r.id);
      leftOut.push({ rowNo: r.row_no, name: r.name, company: r.company, reason: OUT_REASON[r.outReason], section: r.outReason,
        detail: r.outReason === 'excluded' ? r.match_note : r.outReason === 'invalid' || r.outReason === 'duplicate' ? r.parse_errors.map((x) => x.message).join('; ') : null });
    }
    for (const r of included) {
      const who = checkBorrower(db, { borrowerType: r.borrower_type, employeeCode: r.employee_code, company: r.company });
      if (!who.ok) return { ...who, message: `row ${r.row_no}: ${who.message}`, rowNo: r.row_no };
      const key = rowKey(r);
      const prior = db.prepare("SELECT batch_id, loan_id, row_no FROM loan_import_rows WHERE row_key = ? AND outcome = 'imported'").get(key);
      if (prior || keys.has(key)) {
        const why = prior ? `already imported as loan #${prior.loan_id} (batch #${prior.batch_id} row ${prior.row_no})` : `same loan as row ${keys.get(key)} in this file`;
        setOut.run(`Already imported — ${why}`, r.id);
        leftOut.push({ rowNo: r.row_no, name: r.name, company: r.company, reason: 'Already imported', section: 'already_imported', detail: why });
        continue;
      }
      keys.set(key, r.row_no);
      const outP = effOutstanding(r);
      const emiP = effEmi(r);
      const payroll = r.borrower_type;
      const opening = openingDate(payroll, M);
      const first = firstEmiMonth({ disbursedOn: opening, closed: closedMonths(db, payroll), requested: M, payroll });
      if (!first.ok) return { ...first, message: `row ${r.row_no}: ${first.message}`, rowNo: r.row_no };
      const sched = buildScheduleByEmi({ principalPaise: outP, emiPaise: emiP, firstMonth: first.month });
      if (!sched.ok) return { ...sched, message: `row ${r.row_no}: ${sched.message}`, rowNo: r.row_no };
      const warnings = rowWarnings(db, { ...r, parse_warnings: (r.warnings || []).filter((w) => ['LOAN_TYPE_DEFAULTED', 'OUTSTANDING_ABOVE_PRINCIPAL'].includes(w.code)) }, policy, d.rows);
      const reason = `Imported from the accounts Excel — batch #${b.id} row ${r.row_no} (${b.file_name}); `
        + `${r.original_principal ? `original principal ₹${r.original_principal}` : 'original principal not given'}${r.loan_date ? `, loan date ${r.loan_date}` : ''}`;
      const info = db.prepare(`
        INSERT INTO loans (borrower_type, employee_code, company, loan_type, principal_amount, interest_rate, tenure_months, emi_amount, status,
                           requested_by, request_reason, decided_by, decided_at, decision_reason,
                           disbursed_amount, disbursement_mode, disbursement_reference, disbursed_on, disbursed_by, disbursed_at,
                           agreement_file_path, agreement_uploaded_by, agreement_uploaded_at,
                           first_emi_month, first_emi_year, remaining_balance, remarks)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'active', ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?,
                CASE WHEN ? = 1 THEN datetime('now') END, ?, ?, ?, ?)
      `).run(payroll, r.employee_code, r.company, r.loan_type, toRupees(outP), sched.instalments.length, toRupees(sched.emiPaise),
        b.uploaded_by, reason, gate.actor.username, `Import approved, cutover ${monthLabel(M)}${text(note) ? `: ${text(note)}` : ''}`,
        toRupees(outP), IMPORT_MODE, `IMPORT-${b.id}-R${r.row_no}`, opening, r.balance_confirmed_by,
        text(r.agreement_ref) || null, text(r.agreement_ref) ? r.balance_confirmed_by : null, text(r.agreement_ref) ? 1 : 0,
        first.month.month, first.month.year, toRupees(outP), r.notes || null);
      const loan = getLoan(db, info.lastInsertRowid);
      const insI = db.prepare(`INSERT INTO loan_instalments (loan_id, sequence, due_month, due_year, amount_due, status, origin)
                               VALUES (?, ?, ?, ?, ?, 'scheduled', 'schedule')`);
      for (const i of sched.instalments) insI.run(loan.id, i.sequence, i.month, i.year, toRupees(i.amountPaise));
      const changed = toPaise(r.confirmed_outstanding) !== toPaise(r.outstanding) || toPaise(r.confirmed_emi) !== toPaise(r.emi);
      writeEvent(db, {
        loan, event: 'imported', fromState: null, toState: 'active', amountPaise: outP, actor: gate.actor,
        reason: `opening balance from batch #${b.id} row ${r.row_no} "${r.name}"; uploaded by ${b.uploaded_by}; match (${r.match_tier || 'manual'}) confirmed by ${r.match_confirmed_by}; `
          + `balance confirmed by ${r.balance_confirmed_by}${changed ? ` (Excel ₹${r.outstanding ?? '—'} / EMI ₹${r.emi ?? '—'} → ₹${r.confirmed_outstanding} / ₹${r.confirmed_emi}: ${r.balance_note})` : ''}; `
          + `approved by ${gate.actor.username}; EMI ₹${toRupees(sched.emiPaise)} from ${monthLabel(first.month)}, ${sched.instalments.length} instalment(s)`,
      });
      const rec = reconcileLoan(db, loan.id);
      if (!rec.ok) return fail('RECONCILE_FAILED', `row ${r.row_no}: ${rec.problems.join('; ')}`, { rowNo: r.row_no });
      db.prepare(`UPDATE loan_import_rows SET outcome = 'imported', loan_id = ?, row_key = ?, warnings = ?, outcome_reason = NULL, updated_at = datetime('now') WHERE id = ?`)
        .run(loan.id, key, JSON.stringify(warnings), r.id);
      loans.push({
        rowNo: r.row_no, loanId: loan.id, borrowerType: payroll, employeeCode: r.employee_code, company: r.company, name: r.name,
        outstanding: toRupees(outP), emi: toRupees(sched.emiPaise), tenure: sched.instalments.length, firstEmi: first.month,
        lastInstalment: toRupees(sched.instalments[sched.instalments.length - 1].amountPaise), warnings: warnings.map((w) => w.code),
      });
    }
    if (!loans.length) return fail('NOTHING_TO_IMPORT', 'every confirmed row was already imported');
    const stage7 = stage7ComputedFor(db, included.filter((r) => loans.some((l) => l.rowNo === r.row_no)), M);
    const result = {
      cutover: M, loans: loans.length,
      outstanding: toRupees(loans.reduce((s, l) => s + toPaise(l.outstanding), 0)),
      monthlyEmi: toRupees(loans.reduce((s, l) => s + toPaise(l.emi), 0)),
      leftOut: leftOut.length, stage7Computed: stage7.length,
    };
    db.prepare("UPDATE loan_import_batches SET result = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(result), b.id);
    audit(db, { table: 'loan_import_batches', recordId: b.id, field: 'status', oldValue: 'review', newValue: 'approved', actor: gate.actor, action: 'approve',
      remark: `cutover ${monthLabel(M)} · ${loans.length} loan(s) ₹${result.outstanding} · EMI ₹${result.monthlyEmi}/month · ${leftOut.length} left out${text(note) ? ` · ${text(note)}` : ''}` });
    return { ok: true, batchId: b.id, cutover: M, loans, leftOut, totals: result, stage7Computed: stage7 };
  });
}

// ── cutover check (scope 4) ──────────────────────────────────────────────────

/**
 * For every loan the batch imported: Excel EMI vs the app's instalment for M vs
 * what Stage 7 deducted, the deduction room, and net pay (for accounts to
 * compare with the bank payment).
 */
function cutoverCheck(db, batchId, { month = null, year = null, companies = null } = {}) {
  const d = batchDetail(db, batchId, { companies });
  if (!d.ok) return d;
  const b = d.batch;
  if (b.status !== 'approved') return fail('BATCH_NOT_APPROVED', `batch #${b.id} is ${b.status}; the cutover check runs after approval`);
  const M = month && year ? { month: Number(month), year: Number(year) } : { month: b.cutover_month, year: b.cutover_year };
  if (!isValidMonth(M)) return fail('MONTH_INVALID', 'month/year invalid');
  const policy = readLoanPolicy(db);
  const rows = [];
  const totals = { loans: 0, excelEmi: 0, appInstalment: 0, deducted: 0, flagged: 0 };
  for (const r of d.rows.filter((x) => x.outcome === 'imported')) {
    const loan = getLoan(db, r.loan_id);
    const ins = db.prepare(`SELECT * FROM loan_instalments WHERE loan_id = ? AND due_month = ? AND due_year = ? AND status <> 'cancelled' ORDER BY sequence LIMIT 1`)
      .get(loan.id, M.month, M.year);
    const ded = db.prepare('SELECT * FROM loan_deductions WHERE loan_id = ? AND month = ? AND year = ? AND payroll = ?').get(loan.id, M.month, M.year, loan.borrower_type);
    const adj = ded ? db.prepare('SELECT COALESCE(SUM(amount), 0) AS a FROM loan_adjustments WHERE deduction_id = ?').get(ded.id).a : 0;
    const dedPaise = ded && ded.state !== 'reversed' ? toPaise(ded.amount) - (ded.state === 'posted' ? toPaise(adj) : 0) : 0;
    const salRows = loan.borrower_type === 'sales'
      ? db.prepare('SELECT * FROM sales_salary_computations WHERE employee_code = ? AND company = ? AND month = ? AND year = ?').all(loan.employee_code, loan.company, M.month, M.year)
      : db.prepare('SELECT * FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?').all(loan.employee_code, M.month, M.year);
    let basis = salRows;
    if (!basis.length) {
      const t = loan.borrower_type === 'sales' ? 'sales_salary_computations' : 'salary_computations';
      const last = loan.borrower_type === 'sales'
        ? db.prepare(`SELECT month, year FROM ${t} WHERE employee_code = ? AND company = ? ORDER BY year DESC, month DESC LIMIT 1`).get(loan.employee_code, loan.company)
        : db.prepare(`SELECT month, year FROM ${t} WHERE employee_code = ? ORDER BY year DESC, month DESC LIMIT 1`).get(loan.employee_code);
      basis = last ? (loan.borrower_type === 'sales'
        ? db.prepare(`SELECT * FROM ${t} WHERE employee_code = ? AND company = ? AND month = ? AND year = ?`).all(loan.employee_code, loan.company, last.month, last.year)
        : db.prepare(`SELECT * FROM ${t} WHERE employee_code = ? AND month = ? AND year = ?`).all(loan.employee_code, last.month, last.year)) : [];
    }
    const room = basis.length ? computeHeadroom({
      earnedBasePaise: basis.reduce((s, x) => s + earnedBase(x, loan.borrower_type), 0),
      capPct: policy.deductionCapPct,
      priorDeductionsPaise: basis.reduce((s, x) => s + priorDeductions(x, loan.borrower_type), 0),
    }) : null;
    const excel = toPaise(r.emi);
    const due = ins ? toPaise(ins.amount_due) : 0;
    const flags = [];
    if (!['active', 'recover_at_exit'].includes(loan.status)) flags.push('LOAN_NOT_LIVE');
    if (due !== excel) flags.push('EMI_DIFFERS');
    if (room !== null && due > 0 && room < due) flags.push('HEADROOM_SHORT');
    if (!salRows.length) flags.push('STAGE7_PENDING');
    else if (due > 0 && !ded) flags.push('NOT_DEDUCTED');
    else if (due > 0 && dedPaise < due) flags.push('DEDUCTED_SHORT');
    const net = salRows.reduce((s, x) => s + toPaise(x.net_salary || 0), 0);
    const payslipLoan = salRows.reduce((s, x) => s + toPaise(x.loan_recovery || 0), 0);
    rows.push({
      rowNo: r.row_no, loanId: loan.id, payroll: loan.borrower_type, employeeCode: loan.employee_code, name: r.name, company: loan.company,
      excelEmi: toRupees(excel), confirmedEmi: r.confirmed_emi, appInstalment: toRupees(due),
      deduction: ded ? { state: ded.state, amount: toRupees(dedPaise) } : null,
      payslipLoan: salRows.length ? toRupees(payslipLoan) : null, netSalary: salRows.length ? toRupees(net) : null,
      projectedHeadroom: room === null ? null : toRupees(room), headroomBasis: salRows.length ? 'this month' : basis.length ? `latest computed (${basis[0].month}/${basis[0].year})` : 'none',
      balance: loan.remaining_balance, status: loan.status, flags,
    });
    totals.loans += 1; totals.excelEmi += excel; totals.appInstalment += due; totals.deducted += dedPaise;
    if (flags.length) totals.flagged += 1;
  }
  return {
    ok: true, batchId: b.id, month: M, rows,
    totals: { ...totals, excelEmi: toRupees(totals.excelEmi), appInstalment: toRupees(totals.appInstalment), deducted: toRupees(totals.deducted) },
  };
}

/** Excel of the cutover check (for accounts to sign against the bank file). */
function cutoverCheckXlsx(c) {
  const XLSX = require('xlsx');
  const head = ['Row', 'Loan #', 'Payroll', 'Company', 'Code', 'Name', 'Excel EMI ₹', 'App instalment ₹', 'Stage 7 deduction ₹', 'Deduction state',
    'Payslip loan ₹', 'Net salary ₹', 'Projected room ₹', 'Room basis', 'Balance ₹', 'Status', 'Flags'];
  const aoa = [[`Loan import cutover check — batch #${c.batchId}, ${monthLabel(c.month)}`], [], head];
  for (const r of c.rows) {
    aoa.push([r.rowNo, r.loanId, r.payroll, r.company, r.employeeCode, r.name, r.excelEmi, r.appInstalment, r.deduction ? r.deduction.amount : '',
      r.deduction ? r.deduction.state : '', r.payslipLoan ?? '', r.netSalary ?? '', r.projectedHeadroom ?? '', r.headroomBasis, r.balance, r.status, r.flags.join(', ')]);
  }
  aoa.push(['Total', c.totals.loans, '', '', '', '', c.totals.excelEmi, c.totals.appInstalment, c.totals.deducted, '', '', '', '', '', '', '', `${c.totals.flagged} flagged`]);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = head.map((h) => ({ wch: Math.max(10, h.length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Cutover check');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** The import row behind a loan (LoanDetail badge, reports label). */
function importOfLoan(db, loanId) {
  if (!importReady(db)) return null;
  return db.prepare('SELECT batch_id AS batchId, row_no AS rowNo FROM loan_import_rows WHERE loan_id = ? LIMIT 1').get(loanId) || null;
}

module.exports = {
  IMPORT_MODE, importReady, previewImport, createBatch, listBatches, batchDetail, confirmMatch, excludeRow, confirmBalance,
  discardBatch, approveBatch, cutoverCheck, cutoverCheckXlsx, importOfLoan, openingDate, earliestCutover, rowKey,
  buildImportTemplate: P.buildTemplate,
};

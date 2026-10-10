/**
 * Loans PR-10 — import of the loans run outside the app (docs/loans/SPEC.md
 * D-9, D-26, K36, K37; §7 last row; coordinator rulings 10 Oct 2026).
 *
 *   upload (HR or finance) → HR confirms each match → finance confirms each
 *   balance (may correct it, with a note) → the admin approves the batch and
 *   names the cutover month M PER PAYROLL (plant rows and sales rows of one
 *   batch may start in different months) → one ACTIVE loan per confirmed row.
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
const NAME_WARNINGS = ['NAME_MISMATCH', 'NAME_CLOSE_SPELLING'];

function rowWarnings(db, row, policy, batchRows = []) {
  const w = (row.parse_warnings || []).filter((x) => !NAME_WARNINGS.includes(x.code));
  if (!row.borrower_type || !row.employee_code) return [...w, ...(row.parse_warnings || []).filter((x) => NAME_WARNINGS.includes(x.code))];
  const add = (code, message, extra = {}) => w.push({ code, message, ...extra });
  const master = row.borrower_type === 'sales'
    ? db.prepare('SELECT name FROM sales_employees WHERE code = ? AND company = ?').get(row.employee_code, row.company)
    : db.prepare('SELECT name FROM employees WHERE code = ?').get(row.employee_code);
  if (master && row.name) {
    const nc = Mx.nameCheck(row.name, master.name);
    if (nc.result === 'mismatch') add('NAME_MISMATCH', 'the Excel name differs from the master name of the confirmed employee');
    if (nc.result === 'close') add('NAME_CLOSE_SPELLING', `the Excel name differs slightly from the master (${nc.reason})`);
  }
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

const PAYROLLS = ['plant', 'sales'];

/** The cutover months stamped on a batch: { plant: {month, year} | null, sales: … }. */
function batchCutover(b) {
  const one = (p) => (b[`${p}_cutover_month`] ? { month: b[`${p}_cutover_month`], year: b[`${p}_cutover_year`] } : null);
  return { plant: one('plant'), sales: one('sales') };
}

/** "plant Sep 2026 · sales Oct 2026" (only the payrolls that have a month). */
function cutoverLabel(c) {
  return PAYROLLS.filter((p) => c && c[p]).map((p) => `${p} ${monthLabel(c[p])}`).join(' · ') || '—';
}

/**
 * Read a per-payroll cutover from a request: plant/sales specific months win;
 * a single { month, year } (legacy) applies to both. Invalid → null for that payroll.
 */
function pickCutover({ plant = null, sales = null, both = null } = {}) {
  const ok = (m) => (m && isValidMonth({ month: Number(m.month), year: Number(m.year) }) ? { month: Number(m.month), year: Number(m.year) } : null);
  return { plant: ok(plant) || ok(both), sales: ok(sales) || ok(both) };
}

/** Included borrowers whose Stage 7 / sales compute for their payroll's cutover month already ran (their first EMI needs a re-run). */
function stage7ComputedFor(db, rows, months) {
  const out = [];
  for (const r of rows) {
    const M = months && months[r.borrower_type];
    if (!M) continue;
    const hit = r.borrower_type === 'sales'
      ? db.prepare('SELECT 1 FROM sales_salary_computations WHERE employee_code = ? AND company = ? AND month = ? AND year = ? LIMIT 1').get(r.employee_code, r.company, M.month, M.year)
      : db.prepare('SELECT 1 FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ? LIMIT 1').get(r.employee_code, M.month, M.year);
    if (hit) out.push({ rowNo: r.row_no, borrowerType: r.borrower_type, employeeCode: r.employee_code, company: r.company, month: M });
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
    ok: true, fields, sheetName: p.sheetName, headerRow: p.headerRow, headers: p.headers, mapping: p.mapping, autoMapping: p.autoMapping, balanceColumns: p.balanceColumns,
    rowCount: p.rows.length, invalidCount: p.rows.filter((r) => r.errors.length).length,
    preview: p.rows.slice(0, 5).map((r) => ({
      rowNo: r.rowNo, code: r.code, name: r.name, company: r.company, department: r.department, loanDate: r.loanDate,
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
      .run(text(input.fileName) || 'upload.xlsx', sha, p.sheetName, p.headerRow,
        JSON.stringify({ mapping: p.mapping, headers: p.headers, balanceColumns: p.balanceColumns }), P.normaliseCompany(input.defaultCompany),
        p.rows.length, gate.actor.username, gate.actor.role).lastInsertRowid;
    const ins = db.prepare(`INSERT INTO loan_import_rows (batch_id, row_no, raw, name, name_norm, company, department, loan_date, original_principal, outstanding, emi,
                              loan_type, agreement_ref, notes, parse_status, parse_errors, match_tier, candidates, borrower_type, employee_code, warnings, code)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const defCo = P.normaliseCompany(input.defaultCompany);
    const pools = new Map();
    const firstSeen = new Map();
    const counts = { rows: 0, invalid: 0, duplicate: 0, exact: 0, ambiguous: 0, close: 0, inactive: 0, none: 0, code: 0, code_close: 0, code_mismatch: 0 };
    for (const r of p.rows) {
      const nameNorm = Mx.normalizeImportName(r.name);
      let status = r.errors.length ? 'invalid' : 'ok';
      const errors = [...r.errors];
      const dk = [r.code || '', nameNorm, r.company, r.loanDate, r.originalPrincipalPaise, r.outstandingPaise, r.emiPaise].join('|');
      if (status === 'ok' && firstSeen.has(dk)) {
        status = 'duplicate';
        errors.push({ code: 'DUPLICATE_ROW', message: `same as row ${firstSeen.get(dk)}` });
      } else if (status === 'ok') firstSeen.set(dk, r.rowNo);
      let m = { tier: null, candidates: [], selected: null };
      let company = r.company;
      const warnings = [...r.warnings];
      if (status !== 'duplicate' && r.code) {
        // PR-10 follow-up: exact by code; the name is a cross-check; the company comes from the master.
        m = Mx.matchByCode(db, { code: r.code, name: r.name, company: r.company, defaultCompany: defCo });
        company = m.company;
        if (m.warning) warnings.push(m.warning);
        if (!company && m.tier !== 'none') {
          status = 'invalid';
          errors.push({ code: 'COMPANY_INVALID', message: 'the file has no company and the employee master has none for this code — choose a default company at upload' });
        }
        if (company && companies && !companies.includes(company)) return fail('COMPANY_NOT_ALLOWED', 'the file has rows for a company you do not have access to');
      } else if (status !== 'duplicate' && r.name && r.company) {
        if (!pools.has(r.company)) pools.set(r.company, Mx.loadPool(db, r.company));
        m = Mx.matchRow(pools.get(r.company), r);
      }
      counts.rows += 1;
      if (status === 'invalid') counts.invalid += 1;
      if (status === 'duplicate') counts.duplicate += 1;
      if (m.tier) counts[m.tier] += 1;
      ins.run(b, r.rowNo, JSON.stringify(r.raw), r.name || null, nameNorm || null, company, r.department, r.loanDate,
        r.originalPrincipalPaise === null ? null : toRupees(r.originalPrincipalPaise),
        r.outstandingPaise === null ? null : toRupees(r.outstandingPaise), r.emiPaise === null ? null : toRupees(r.emiPaise),
        r.loanType, r.agreementRef, [r.notes, r.loanTypeOriginal && r.loanTypeOriginal !== r.loanType ? `Excel loan type: ${r.loanTypeOriginal}` : null].filter(Boolean).join(' · ') || null,
        status, JSON.stringify(errors), m.tier, JSON.stringify(m.candidates),
        m.selected ? m.selected.borrowerType : null, m.selected ? m.selected.code : null, JSON.stringify(warnings), r.code || null);
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
      cutover: b.status === 'approved' ? batchCutover(b) : null, approvedBy: b.approved_by, approvedAt: b.approved_at,
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
  const earliest = Object.fromEntries(PAYROLLS.map((p) => [p, earliestCutover(db, p, now)]));
  const sumP = (list, f) => list.reduce((s, r) => s + f(r), 0);
  // The months to preview (Stage 7 already run?): the ones asked for, else the
  // earliest allowed per payroll (= the screen's defaults).
  const asked = cutover && cutover.month ? pickCutover({ both: cutover }) : (cutover || {});
  const preview = Object.fromEntries(PAYROLLS.map((p) => [p, asked[p] && isValidMonth(asked[p]) ? asked[p] : earliest[p]]));
  const byPayroll = Object.fromEntries(PAYROLLS.map((p) => {
    const list = included.filter((r) => r.borrower_type === p);
    return [p, { loans: list.length, outstanding: toRupees(sumP(list, effOutstanding)), monthlyEmi: toRupees(sumP(list, effEmi)) }];
  }));
  const bp = b.status === 'review' ? bulkPlan(db, b.id, policy) : null;
  return {
    ok: true,
    batch: { ...b, column_map: json(b.column_map, {}), result: json(b.result, null), cutover: b.status === 'approved' ? batchCutover(b) : null },
    rows: out,
    bulk: { cleanMatches: bp ? bp.matches.eligible.length : 0, fileBalances: bp ? bp.balances.eligible.length : 0 },
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
      totals: { loans: included.length, outstanding: toRupees(sumP(included, effOutstanding)), monthlyEmi: toRupees(sumP(included, effEmi)) },
      byPayroll,
      stage7Computed: b.status === 'review' ? stage7ComputedFor(db, included, preview) : [],
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
  // PR-10 follow-up: never accept a name that differs from the master (beyond close spelling) without a note.
  const nc = Mx.nameCheck(row.name, who.employee.name);
  if (nc.result === 'mismatch' && text(note).length < 5) {
    return fail('NOTE_REQUIRED', 'the Excel name and the master name differ — a note (5+ characters) confirming it is the same person is required');
  }
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
  if (!(o.paise > 0)) return fail('AMOUNT_INVALID', 'outstanding must be above ₹0');
  if (!(m.paise > 0)) return fail('EMI_MISSING', 'enter the monthly EMI (the Excel has none)');
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

// ── bulk confirmation of clean rows (one click; maker-checker unchanged) ────
//
// HR confirms every CLEAN match in one click, finance confirms every balance as
// in the file in one click. Each row still goes through the single-row
// confirmMatch / confirmBalance (same checks, same row update, same audit row);
// the loop runs in ONE transaction, so a refusal or an error on any row
// confirms nothing. Flagged rows are skipped, listed with the reason, and stay
// for one-by-one review. The admin approval is untouched.

/** Flags that never stop a bulk confirmation (information only). */
const BULK_INFO_ONLY = new Set(['AGREEMENT_MISSING', 'SERVICE_UNKNOWN', 'LOAN_TYPE_DEFAULTED']);
/** Identity flags HR has already decided (with a note when needed) — not a balance matter. */
const BULK_HR_DECIDED = new Set(NAME_WARNINGS);
const CLEAN_TIERS = new Set(['code', 'exact']);

const borrowerKey = (r) => `${r.borrower_type}|${r.employee_code}|${r.borrower_type === 'sales' ? r.company : ''}`;

/**
 * Which rows of a batch in review the two bulk actions would confirm, and why
 * the others are left. Read-only; batchDetail's `bulk` counts use the same plan.
 * @returns {{matches:{eligible:Array, skipped:Array}, balances:{eligible:Array, skipped:Array}}}
 */
function bulkPlan(db, batchId, policy = readLoanPolicy(db)) {
  const rows = db.prepare('SELECT * FROM loan_import_rows WHERE batch_id = ? ORDER BY row_no').all(batchId).map(hydrate);
  const live = rows.filter((r) => rowState(r).state !== 'out');
  const sameBorrower = (row) => live.filter((r) => r.id !== row.id && r.employee_code && r.borrower_type && borrowerKey(r) === borrowerKey(row)).map((r) => r.row_no);
  const flagsOf = (row) => rowWarnings(db, { ...row, match_status: 'confirmed', parse_warnings: row.warnings }, policy, []).map((w) => w.code);
  const plan = { matches: { eligible: [], skipped: [] }, balances: { eligible: [], skipped: [] } };
  const skip = (list, row, reason, flags = []) => list.push({ rowId: row.id, rowNo: row.row_no, name: row.name, reason, flags });

  for (const row of rows) {
    const st = rowState(row).state;
    if (st === 'needs_match') {
      const s = plan.matches.skipped;
      if (row.parse_status !== 'ok') { skip(s, row, 'the row has an amount problem — confirm it one by one'); continue; }
      if (!CLEAN_TIERS.has(row.match_tier)) { skip(s, row, `match is "${row.match_tier}" — not a code or exact-name match`); continue; }
      if (row.candidates.length !== 1 || !row.borrower_type || !row.employee_code
        || row.candidates[0].borrowerType !== row.borrower_type || row.candidates[0].code !== row.employee_code) {
        skip(s, row, 'not exactly one proposed employee'); continue;
      }
      const who = checkBorrower(db, { borrowerType: row.borrower_type, employeeCode: row.employee_code, company: row.company });
      if (!who.ok) { skip(s, row, who.message); continue; }
      const stored = row.warnings.map((w) => w.code).filter((c) => !BULK_INFO_ONLY.has(c));
      const flags = [...new Set([...stored, ...flagsOf(row).filter((c) => !BULK_INFO_ONLY.has(c))])];
      if (flags.length) { skip(s, row, `flagged: ${flags.join(', ')}`, flags); continue; }
      const twins = sameBorrower(row);
      if (twins.length) { skip(s, row, `the same employee is also on row(s) ${twins.join(', ')}`, ['SECOND_LOAN_IN_BATCH']); continue; }
      plan.matches.eligible.push(row);
    } else if (st === 'needs_balance') {
      const s = plan.balances.skipped;
      if (row.parse_status !== 'ok') { skip(s, row, `the file's amounts need finance: ${row.parse_errors.map((e) => e.code).join(', ')}`, row.parse_errors.map((e) => e.code)); continue; }
      const o = toPaise(row.outstanding);
      const m = toPaise(row.emi);
      if (!(o > 0) || !(m > 0) || m % 100 !== 0) { skip(s, row, 'outstanding or EMI in the file is not usable'); continue; }
      const flags = rowWarnings(db, { ...row, parse_warnings: row.warnings }, policy, rows).map((w) => w.code)
        .filter((c) => !BULK_INFO_ONLY.has(c) && !BULK_HR_DECIDED.has(c));
      if (flags.length) { skip(s, row, `flagged: ${[...new Set(flags)].join(', ')}`, [...new Set(flags)]); continue; }
      plan.balances.eligible.push(row);
    }
  }
  return plan;
}

function loadBulkBatch(db, batchId, companies) {
  if (!importReady(db)) return fail('NOT_MIGRATED', 'loan tables are not migrated');
  const b = getBatch(db, batchId);
  if (!b) return fail('BATCH_NOT_FOUND', `import batch ${batchId} not found`);
  if (!companiesAllowed(companies, batchCompanies(db, b.id))) return fail('COMPANY_NOT_ALLOWED', 'this batch has rows for a company you do not have access to');
  if (b.status !== 'review') return fail('BATCH_NOT_IN_REVIEW', `batch #${b.id} is ${b.status}`);
  return { ok: true, batch: b };
}

const skippedOut = (list) => list.map(({ rowNo, name, reason, flags }) => ({ rowNo, name, reason, flags }));

/**
 * Shared loop: ONE transaction — the plan is read inside it, then the single-row
 * function runs per eligible row; any refusal (or error) rolls everything back.
 */
function runBulk(db, { batchId, gate, kind, step, action, label }) {
  return inTxn(db, () => {
    const { eligible, skipped } = bulkPlan(db, batchId)[kind];
    if (!eligible.length) return { ok: true, batchId, confirmed: 0, rows: [], skipped: skippedOut(skipped) };
    for (const row of eligible) {
      const r = step(row);
      if (!r || !r.ok) {
        return fail('BULK_CONFIRM_FAILED', `row ${row.row_no}: ${(r && (r.message || r.code)) || 'refused'} — nothing was confirmed`, { rowNo: row.row_no, cause: r && r.code });
      }
    }
    audit(db, { table: 'loan_import_batches', recordId: batchId, field: label, actor: gate.actor, action,
      newValue: `${eligible.length} confirmed`, remark: `rows ${eligible.map((r) => r.row_no).join(', ')}; ${skipped.length} left for one-by-one` });
    return { ok: true, batchId, confirmed: eligible.length, rows: eligible.map((r) => r.row_no), skipped: skippedOut(skipped) };
  });
}

/** HR: confirm every clean proposed match of a batch in one click (bulkPlan().matches). */
function confirmCleanMatches(db, { batchId, note = null }, actor, { companies = null } = {}) {
  const gate = checkActor('import_confirm_match', actor);
  if (!gate.ok) return gate;
  const e = loadBulkBatch(db, batchId, companies);
  if (!e.ok) return e;
  return runBulk(db, {
    batchId: e.batch.id, gate, kind: 'matches', action: 'bulk_match_confirmed', label: 'match',
    step: (row) => confirmMatch(db, { batchId: e.batch.id, rowId: row.id, borrowerType: row.borrower_type, employeeCode: row.employee_code, company: row.company, note: text(note) || null },
      actor, { companies }),
  });
}

/** Finance: confirm every clean balance of a batch as in the file, in one click (bulkPlan().balances). */
function confirmFileBalances(db, { batchId, note = null }, actor, { companies = null } = {}) {
  const gate = checkActor('import_confirm_balance', actor);
  if (!gate.ok) return gate;
  const e = loadBulkBatch(db, batchId, companies);
  if (!e.ok) return e;
  return runBulk(db, {
    batchId: e.batch.id, gate, kind: 'balances', action: 'bulk_balance_confirmed', label: 'balance',
    step: (row) => confirmBalance(db, { batchId: e.batch.id, rowId: row.id, note: text(note) || null }, actor, { companies }),
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

/**
 * Re-choose which column is the cutover outstanding and which is the EMI on a
 * batch in review (PR-10 follow-up): a file can carry several balance columns
 * (before / after a month's deduction) and the right one is a business answer
 * that may come after the upload. Uploader or admin. Values are re-read from
 * each row's original cells; every finance balance confirmation is reset (the
 * amounts it attested changed); audited.
 */
function remapColumns(db, { batchId, outstanding, emi }, actor, { companies = null } = {}) {
  const gate = checkActor('import_remap', actor);
  if (!gate.ok) return gate;
  const b = getBatch(db, batchId);
  if (!b) return fail('BATCH_NOT_FOUND', `import batch ${batchId} not found`);
  if (!companiesAllowed(companies, batchCompanies(db, b.id))) return fail('COMPANY_NOT_ALLOWED', 'this batch has rows for a company you do not have access to');
  if (gate.actor.role !== 'admin' && gate.actor.username.toLowerCase() !== String(b.uploaded_by).toLowerCase()) {
    return fail('NOT_UPLOADER', 'only the person who uploaded the batch (or the admin) can change its columns');
  }
  if (b.status !== 'review') return fail('BATCH_NOT_IN_REVIEW', `batch #${b.id} is ${b.status}`);
  const cm = json(b.column_map, {});
  const headers = cm.headers || [];
  const mapping = { ...(cm.mapping || {}) };
  const col = (v) => headers.find((h) => h.index === Number(v)) || null;
  const o = col(outstanding === undefined ? mapping.outstanding : outstanding);
  const e = col(emi === undefined ? mapping.emi : emi);
  if (!o || !e) return fail('MAPPING_INVALID', 'choose an outstanding column and an EMI column from the file headers');
  if (o.index === e.index) return fail('MAPPING_INVALID', 'the outstanding and EMI columns must differ');
  const others = Object.entries(mapping).filter(([k, v]) => !['outstanding', 'emi'].includes(k) && (v === o.index || v === e.index)).map(([k]) => k);
  if (others.length) return fail('MAPPING_INVALID', `that column is already used for ${others.join(', ')}`);
  return inTxn(db, () => {
    const rows = db.prepare('SELECT * FROM loan_import_rows WHERE batch_id = ?').all(b.id).map(hydrate);
    let changed = 0; let reset = 0;
    const up = db.prepare(`UPDATE loan_import_rows SET outstanding = ?, emi = ?, parse_status = ?, parse_errors = ?, balance_status = 'pending',
                                  confirmed_outstanding = NULL, confirmed_emi = NULL, balance_confirmed_by = NULL, balance_confirmed_at = NULL, balance_note = NULL,
                                  updated_at = datetime('now') WHERE id = ?`);
    for (const r of rows) {
      const am = P.amountChecks(r.raw[o.text], r.raw[e.text]);
      const errors = [...r.parse_errors.filter((x) => !P.AMOUNT_ERRORS.has(x.code)), ...am.errors];
      const status = r.parse_status === 'duplicate' ? 'duplicate' : (errors.length ? 'invalid' : 'ok');
      const out = am.out.ok ? am.out.paise : null;
      const em = am.emi.ok ? am.emi.paise : null;
      if (toPaise(r.outstanding) !== out || toPaise(r.emi) !== em) changed += 1;
      if (r.balance_status === 'confirmed') reset += 1;
      up.run(out === null ? null : toRupees(out), em === null ? null : toRupees(em), status, JSON.stringify(errors), r.id);
    }
    const before = `${(headers.find((h) => h.index === mapping.outstanding) || {}).text || '—'} / ${(headers.find((h) => h.index === mapping.emi) || {}).text || '—'}`;
    mapping.outstanding = o.index;
    mapping.emi = e.index;
    db.prepare("UPDATE loan_import_batches SET column_map = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify({ ...cm, mapping }), b.id);
    audit(db, { table: 'loan_import_batches', recordId: b.id, field: 'column_map', actor: gate.actor, action: 'columns_changed',
      oldValue: before, newValue: `${o.text} / ${e.text}`, remark: `${changed} row(s) changed; ${reset} finance confirmation(s) reset` });
    return { ok: true, batchId: b.id, outstandingColumn: o.text, emiColumn: e.text, rowsChanged: changed, confirmationsReset: reset };
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
 * and names the cutover month M for each payroll in it: `cutover.plant` /
 * `cutover.sales` ({month, year}); a single cutoverMonth/Year applies to both.
 * Each payroll's month is checked on its own (not closed for that payroll, not
 * earlier than the current IST month − 1). Sales M = the cycle ending the 25th
 * of M (PR-8). All or nothing: one transaction.
 */
function approveBatch(db, { batchId, cutover = null, cutoverMonth = null, cutoverYear = null, note = null }, actor, { companies = null, now = new Date() } = {}) {
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
  const asked = pickCutover({
    plant: cutover && cutover.plant, sales: cutover && cutover.sales,
    both: cutoverMonth && cutoverYear ? { month: cutoverMonth, year: cutoverYear } : null,
  });
  const months = { plant: null, sales: null };
  for (const p of d.approval.payrolls) {
    if (!asked[p]) return fail('MONTH_INVALID', `the ${p} cutover month/year is missing or invalid`, { payroll: p });
    const earliest = d.approval.earliestCutover[p];
    if (compareMonth(asked[p], earliest) < 0) {
      return fail('CUTOVER_TOO_EARLY', `the ${p} cutover month cannot be earlier than ${monthLabel(earliest)} (after the latest ${p} loan close, and no earlier than last month)`, { payroll: p, earliest });
    }
    months[p] = asked[p];
  }
  const label = cutoverLabel(months);
  const policy = readLoanPolicy(db);

  return inTxn(db, () => {
    const u = db.prepare(`UPDATE loan_import_batches SET status = 'approved', plant_cutover_month = ?, plant_cutover_year = ?,
                                 sales_cutover_month = ?, sales_cutover_year = ?, approved_by = ?, approved_at = datetime('now'),
                                 approval_note = ?, updated_at = datetime('now') WHERE id = ? AND status = 'review'`)
      .run(months.plant ? months.plant.month : null, months.plant ? months.plant.year : null,
        months.sales ? months.sales.month : null, months.sales ? months.sales.year : null, gate.actor.username, text(note) || null, b.id);
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
      const M = months[payroll];
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
        b.uploaded_by, reason, gate.actor.username, `Import approved, ${payroll} cutover ${monthLabel(M)}${text(note) ? `: ${text(note)}` : ''}`,
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
        rowNo: r.row_no, loanId: loan.id, borrowerType: payroll, employeeCode: r.employee_code, company: r.company, name: r.name, cutover: M,
        outstanding: toRupees(outP), emi: toRupees(sched.emiPaise), tenure: sched.instalments.length, firstEmi: first.month,
        lastInstalment: toRupees(sched.instalments[sched.instalments.length - 1].amountPaise), warnings: warnings.map((w) => w.code),
      });
    }
    if (!loans.length) return fail('NOTHING_TO_IMPORT', 'every confirmed row was already imported');
    const stage7 = stage7ComputedFor(db, included.filter((r) => loans.some((l) => l.rowNo === r.row_no)), months);
    const result = {
      cutover: months, loans: loans.length,
      outstanding: toRupees(loans.reduce((s, l) => s + toPaise(l.outstanding), 0)),
      monthlyEmi: toRupees(loans.reduce((s, l) => s + toPaise(l.emi), 0)),
      leftOut: leftOut.length, stage7Computed: stage7.length,
    };
    db.prepare("UPDATE loan_import_batches SET result = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(result), b.id);
    audit(db, { table: 'loan_import_batches', recordId: b.id, field: 'status', oldValue: 'review', newValue: 'approved', actor: gate.actor, action: 'approve',
      remark: `cutover ${label} · ${loans.length} loan(s) ₹${result.outstanding} · EMI ₹${result.monthlyEmi}/month · ${leftOut.length} left out${text(note) ? ` · ${text(note)}` : ''}` });
    return { ok: true, batchId: b.id, cutover: months, loans, leftOut, totals: result, stage7Computed: stage7 };
  });
}

// ── cutover check (scope 4) ──────────────────────────────────────────────────

/**
 * For every loan the batch imported: Excel EMI vs the app's instalment for M vs
 * what Stage 7 deducted, the deduction room, and net pay (for accounts to
 * compare with the bank payment). M is the loan's OWN payroll's cutover month
 * (shown per row); `plant` / `sales` ({month, year}) or a single month/year
 * look at another month instead.
 */
function cutoverCheck(db, batchId, { month = null, year = null, plant = null, sales = null, companies = null } = {}) {
  const d = batchDetail(db, batchId, { companies });
  if (!d.ok) return d;
  const b = d.batch;
  if (b.status !== 'approved') return fail('BATCH_NOT_APPROVED', `batch #${b.id} is ${b.status}; the cutover check runs after approval`);
  if ((month || year) && !(month && year && isValidMonth({ month: Number(month), year: Number(year) }))) return fail('MONTH_INVALID', 'month/year invalid');
  const asked = pickCutover({ plant, sales, both: month && year ? { month, year } : null });
  const stamped = batchCutover(b);
  const months = { plant: asked.plant || stamped.plant, sales: asked.sales || stamped.sales };
  const policy = readLoanPolicy(db);
  const rows = [];
  const totals = { loans: 0, excelEmi: 0, appInstalment: 0, deducted: 0, flagged: 0 };
  for (const r of d.rows.filter((x) => x.outcome === 'imported')) {
    const loan = getLoan(db, r.loan_id);
    const M = months[loan.borrower_type];
    if (!M) return fail('MONTH_INVALID', `no ${loan.borrower_type} cutover month on batch #${b.id}`);
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
      rowNo: r.row_no, loanId: loan.id, payroll: loan.borrower_type, month: M, employeeCode: loan.employee_code, name: r.name, company: loan.company,
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
    ok: true, batchId: b.id, months, rows,
    totals: { ...totals, excelEmi: toRupees(totals.excelEmi), appInstalment: toRupees(totals.appInstalment), deducted: toRupees(totals.deducted) },
  };
}

/** Excel of the cutover check (for accounts to sign against the bank file). */
function cutoverCheckXlsx(c) {
  const XLSX = require('xlsx');
  const head = ['Row', 'Loan #', 'Payroll', 'Month', 'Company', 'Code', 'Name', 'Excel EMI ₹', 'App instalment ₹', 'Stage 7 deduction ₹', 'Deduction state',
    'Payslip loan ₹', 'Net salary ₹', 'Projected room ₹', 'Room basis', 'Balance ₹', 'Status', 'Flags'];
  const aoa = [[`Loan import cutover check — batch #${c.batchId}, ${cutoverLabel(c.months)}`], [], head];
  for (const r of c.rows) {
    aoa.push([r.rowNo, r.loanId, r.payroll, monthLabel(r.month), r.company, r.employeeCode, r.name, r.excelEmi, r.appInstalment, r.deduction ? r.deduction.amount : '',
      r.deduction ? r.deduction.state : '', r.payslipLoan ?? '', r.netSalary ?? '', r.projectedHeadroom ?? '', r.headroomBasis, r.balance, r.status, r.flags.join(', ')]);
  }
  aoa.push(['Total', c.totals.loans, '', '', '', '', '', c.totals.excelEmi, c.totals.appInstalment, c.totals.deducted, '', '', '', '', '', '', '', `${c.totals.flagged} flagged`]);
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
  bulkPlan, confirmCleanMatches, confirmFileBalances,
  discardBatch, remapColumns, approveBatch, cutoverCheck, cutoverCheckXlsx, importOfLoan, openingDate, earliestCutover, rowKey,
  batchCutover, cutoverLabel, pickCutover,
  buildImportTemplate: P.buildTemplate,
};

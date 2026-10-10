/**
 * Loans engine — reports, payslip balance line, Finance Audit hooks
 * (Loans PR-9, docs/loans/SPEC.md §1.2, §7 screen 6, K15, K35; D-22).
 *
 * READ-ONLY. Nothing in this file writes to the database.
 *
 * Every money figure comes from the ledger the reconciliation already checks
 * (reconcile.js): balance = disbursed − (posted − adjusted) − receipts − written
 * off, and open instalments + uncovered = balance. So each report reconciles to
 * the ledger to the paisa by construction, and every figure is summed in PAISE
 * (money.js) and turned into rupees only on the way out.
 *
 *   outstandingRegister   live loans by payroll → company → department
 *   recoveryForecast      open instalments by due month (overdue, 12 months, later)
 *                         + the unscheduled ("uncovered") part → sums to outstanding
 *   exceptionsList        shortfall / no-salary / held / deferred / reversal
 *                         instalments still open; extension-limit and exit residuals
 *   leaversWithBalance    exit loans (PR-7 listExitResiduals) + exit-flagged loans
 *                         not yet paid out
 *   perquisiteList        per month, borrowers whose aggregate outstanding exceeded
 *                         the perquisite threshold (pending CA, Q3)
 *   payslipLoanBalance    "Loan outstanding after this month's EMI" for a payslip
 *   loanRedFlagData       plant Finance Audit red flags (EMI vs net, unborne, residual)
 *   overdueCloses         readiness warning: a needed loan close that is past due
 *   reportSheets / toXlsx Excel export
 *
 * Companies: every function takes {companies} (null = all) and keeps loans of
 * those companies only — the route passes users.allowed_companies.
 */
const XLSX = require('xlsx');
const { toPaise, toRupees } = require('./money');
const { addMonths, compareMonth, monthIndex, fromIndex, monthLabel, todayIst, isValidMonth } = require('./months');
const { readLoanPolicy } = require('./policy');
const { LIVE_LOAN_STATES } = require('./states');
const { reconcileLoan, loanStatement } = require('./reconcile');
const { listExitResiduals, heldPendingPaise } = require('./exit');
const { dueCloseMonth, neededUnclosedMonths } = require('./close');
const { effectivePostedPaise } = require('./adjustments');

const LIVE_SQL = LIVE_LOAN_STATES.map((s) => `'${s}'`).join(',');
const PAYROLLS = Object.freeze(['plant', 'sales']);
const R = toRupees;

/** Origins of instalments added at the end that the exceptions list shows (exit is a leaver item). */
const EXCEPTION_ORIGINS = Object.freeze(['shortfall', 'no_salary', 'held', 'deferred', 'reversal']);

function istMonthNow(now = new Date()) {
  const [y, m] = todayIst(now).split('-').map(Number);
  return { month: m, year: y };
}

const keep = (companies) => (loan) => !companies || companies.includes(loan.company);

/** Memoised borrower name / department lookup across both masters. */
function whoIs(db) {
  const plant = db.prepare('SELECT name, department FROM employees WHERE code = ?');
  const sales = db.prepare('SELECT name, headquarters, designation FROM sales_employees WHERE code = ? AND company = ?');
  const cache = new Map();
  return (loan) => {
    const k = `${loan.borrower_type}|${loan.employee_code}|${loan.company}`;
    if (!cache.has(k)) {
      const r = loan.borrower_type === 'sales' ? sales.get(loan.employee_code, loan.company) : plant.get(loan.employee_code);
      cache.set(k, loan.borrower_type === 'sales'
        ? { name: (r && r.name) || null, department: 'Sales', headquarters: (r && r.headquarters) || null }
        : { name: (r && r.name) || null, department: (r && r.department) || null, headquarters: null });
    }
    return cache.get(k);
  };
}

function liveLoans(db, companies) {
  return db.prepare(`SELECT * FROM loans WHERE status IN (${LIVE_SQL}) ORDER BY company, employee_code, id`).all().filter(keep(companies));
}

// ── 1. Outstanding register ──────────────────────────────────────────────────

/**
 * Every live loan (active, recover at exit), whatever its balance — a live loan
 * at ₹0 is a reconciliation problem and is shown with reconciles = false.
 * Grand total balance = Σ loans.remaining_balance of live loans = /stats outstanding.
 */
function outstandingRegister(db, { companies = null } = {}) {
  const who = whoIs(db);
  const nextDue = db.prepare(`SELECT due_month, due_year, amount_due FROM loan_instalments
                               WHERE loan_id = ? AND status IN ('scheduled','provisional')
                               ORDER BY due_year, due_month, sequence LIMIT 1`);
  const F = ['disbursed', 'recovered', 'cash', 'writtenOff', 'balance', 'openInstalments', 'uncovered'];
  const zero = () => Object.fromEntries(F.map((f) => [f, 0]));
  const totals = { loans: 0, ...zero() };
  const groups = new Map();
  const rows = [];
  let problems = 0;
  for (const loan of liveLoans(db, companies)) {
    const rec = reconcileLoan(db, loan.id);
    const w = who(loan);
    const nd = nextDue.get(loan.id);
    const p = {
      disbursed: toPaise(rec.disbursed), recovered: toPaise(rec.posted) - toPaise(rec.adjusted), cash: toPaise(rec.receipts),
      writtenOff: toPaise(rec.writtenOff), balance: toPaise(rec.balance), openInstalments: toPaise(rec.openInstalments), uncovered: toPaise(rec.uncovered),
    };
    if (!rec.ok) problems += 1;
    rows.push({
      loanId: loan.id, payroll: loan.borrower_type, employeeCode: loan.employee_code, employeeName: w.name, company: loan.company,
      department: w.department || '(no department)', headquarters: w.headquarters, loanType: loan.loan_type, status: loan.status,
      ...Object.fromEntries(F.map((f) => [f, R(p[f])])),
      nextDue: nd ? { month: nd.due_month, year: nd.due_year, amount: R(toPaise(nd.amount_due)) } : null,
      reconciles: rec.ok, problems: rec.problems,
    });
    const gk = `${loan.borrower_type}|${loan.company}|${w.department || '(no department)'}`;
    if (!groups.has(gk)) groups.set(gk, { payroll: loan.borrower_type, company: loan.company, department: w.department || '(no department)', loans: 0, ...zero() });
    const g = groups.get(gk);
    g.loans += 1; totals.loans += 1;
    for (const f of F) { g[f] += p[f]; totals[f] += p[f]; }
  }
  const out = (o) => ({ ...o, ...Object.fromEntries(F.map((f) => [f, R(o[f])])) });
  const byCompany = new Map();
  for (const g of groups.values()) {
    const k = `${g.payroll}|${g.company}`;
    if (!byCompany.has(k)) byCompany.set(k, { payroll: g.payroll, company: g.company, loans: 0, ...zero() });
    const c = byCompany.get(k);
    c.loans += g.loans;
    for (const f of F) c[f] += g[f];
  }
  const sortG = (a, b) => a.payroll.localeCompare(b.payroll) || a.company.localeCompare(b.company) || String(a.department || '').localeCompare(String(b.department || ''));
  return {
    ok: true, asOf: todayIst(), rows,
    groups: [...groups.values()].sort(sortG).map(out),
    byCompany: [...byCompany.values()].sort(sortG).map(out),
    totals: out(totals), reconcileProblems: problems,
  };
}

// ── 2. 12-month recovery forecast ────────────────────────────────────────────

/**
 * Open instalments (scheduled + provisional) of live loans by due month:
 * overdue (due before `from` and not yet closed), 12 months from `from`, later,
 * plus the unscheduled part (uncovered: extension limit or exit residual).
 * Columns: one per payroll + company. Σ every bucket = outstanding.
 */
function recoveryForecast(db, { from = null, months = 12, companies = null, now = new Date() } = {}) {
  const start = from && isValidMonth(from) ? from : istMonthNow(now);
  const n = Math.max(1, Math.min(24, Number(months) || 12));
  const loans = liveLoans(db, companies);
  const ids = new Set(loans.map((l) => l.id));
  const byId = new Map(loans.map((l) => [l.id, l]));
  const colKey = (l) => `${l.borrower_type}|${l.company}`;
  const columns = [...new Set(loans.map(colKey))].sort().map((k) => { const [payroll, company] = k.split('|'); return { key: k, payroll, company }; });
  const bucket = () => ({ amount: 0, count: 0, byKey: {} });
  const add = (b, l, paise) => { b.amount += paise; b.count += 1; b.byKey[colKey(l)] = (b.byKey[colKey(l)] || 0) + paise; };
  const monthsOut = Array.from({ length: n }, (_, i) => ({ ...addMonths(start, i), ...bucket() }));
  const overdue = bucket(); const later = bucket(); const unscheduled = bucket();
  const inst = db.prepare(`SELECT loan_id, due_month, due_year, amount_due FROM loan_instalments WHERE status IN ('scheduled','provisional')`).all()
    .filter((i) => ids.has(i.loan_id));
  for (const i of inst) {
    const l = byId.get(i.loan_id);
    const k = monthIndex({ month: i.due_month, year: i.due_year }) - monthIndex(start);
    const paise = toPaise(i.amount_due);
    if (k < 0) add(overdue, l, paise);
    else if (k >= n) add(later, l, paise);
    else add(monthsOut[k], l, paise);
  }
  let outstanding = 0;
  for (const l of loans) {
    outstanding += toPaise(l.remaining_balance);
    const unc = toPaise(reconcileLoan(db, l.id).uncovered);
    if (unc > 0) add(unscheduled, l, unc);
  }
  const out = (b) => ({ ...b, amount: R(b.amount), byKey: Object.fromEntries(Object.entries(b.byKey).map(([k, v]) => [k, R(v)])) });
  const total = overdue.amount + later.amount + unscheduled.amount + monthsOut.reduce((s, b) => s + b.amount, 0);
  return {
    ok: true, from: start, columns,
    months: monthsOut.map((b) => ({ ...out(b), label: monthLabel(b) })),
    overdue: out(overdue), later: out(later), unscheduled: out(unscheduled),
    total: R(total), outstanding: R(outstanding), reconciles: total === outstanding,
  };
}

// ── 3. Exceptions: deferred / shortfall / no salary / held / residual ────────

function exceptionsList(db, { companies = null } = {}) {
  const who = whoIs(db);
  const loans = liveLoans(db, companies);
  const byId = new Map(loans.map((l) => [l.id, l]));
  const src = db.prepare('SELECT due_month, due_year FROM loan_instalments WHERE id = ?');
  const rows = [];
  const inst = db.prepare(`SELECT * FROM loan_instalments WHERE status IN ('scheduled','provisional')
                             AND origin IN (${EXCEPTION_ORIGINS.map((o) => `'${o}'`).join(',')}) ORDER BY loan_id, sequence`).all()
    .filter((i) => byId.has(i.loan_id));
  for (const i of inst) {
    const l = byId.get(i.loan_id);
    const s = i.source_instalment_id ? src.get(i.source_instalment_id) : null;
    rows.push({
      kind: i.origin, loanId: l.id, payroll: l.borrower_type, employeeCode: l.employee_code, employeeName: who(l).name, company: l.company,
      loanStatus: l.status, instalmentId: i.id, dueMonth: { month: i.due_month, year: i.due_year }, status: i.status,
      fromMonth: s ? { month: s.due_month, year: s.due_year } : null, amount: R(toPaise(i.amount_due)), heldPending: 0,
    });
  }
  for (const l of loans) {
    const unc = toPaise(reconcileLoan(db, l.id).uncovered);
    if (unc <= 0) continue;
    const exit = l.status === 'recover_at_exit';
    rows.push({
      kind: exit ? 'exit_residual' : 'extension_limit', loanId: l.id, payroll: l.borrower_type, employeeCode: l.employee_code,
      employeeName: who(l).name, company: l.company, loanStatus: l.status, instalmentId: null, dueMonth: null, status: null, fromMonth: null,
      amount: R(unc), heldPending: exit ? R(heldPendingPaise(db, l.id)) : 0,
    });
  }
  const summary = {};
  for (const r of rows) {
    if (!summary[r.kind]) summary[r.kind] = { count: 0, amount: 0 };
    summary[r.kind].count += 1;
    summary[r.kind].amount += toPaise(r.amount);
  }
  for (const k of Object.keys(summary)) summary[k].amount = R(summary[k].amount);
  return { ok: true, rows, summary, total: R(rows.reduce((s, r) => s + toPaise(r.amount), 0)) };
}

// ── 4. Leavers with a balance ────────────────────────────────────────────────

function leaversWithBalance(db, { companies = null } = {}) {
  const ex = listExitResiduals(db, { companies });
  const rows = [
    ...ex.awaitingFinalPayroll.map((r) => ({ ...r, stage: 'awaiting_final_payroll', heldPending: 0 })),
    ...ex.residuals.map((r) => ({ ...r, dueInFinalPayroll: 0 })),
  ];
  const who = whoIs(db);
  for (const l of db.prepare("SELECT * FROM loans WHERE exit_flag = 1 AND status IN ('requested','approved') ORDER BY company, employee_code, id").all().filter(keep(companies))) {
    const w = who(l);
    rows.push({
      loanId: l.id, borrowerType: l.borrower_type, employeeCode: l.employee_code, employeeName: w.name, department: w.department, company: l.company,
      loanType: l.loan_type, exitDate: l.exit_date || null, finalMonth: null, balance: 0, pendingRequest: null,
      stage: 'not_disbursed', residual: 0, heldPending: 0, dueInFinalPayroll: 0,
    });
  }
  const sum = (f) => R(rows.reduce((s, r) => s + toPaise(r[f] || 0), 0));
  return { ok: true, rows, totals: { loans: rows.length, balance: sum('balance'), residual: sum('residual'), heldPending: sum('heldPending'), dueInFinalPayroll: sum('dueInFinalPayroll') } };
}

// ── 5. Perquisite list (K15; threshold pending CA, SPEC §12 Q3) ──────────────

/** Statement facts of one loan for month m: {opening, disbursed, closing} (paise) or null before the first movement. */
function statementAt(st, m) {
  if (!st.rows.length) return null;
  const label = monthLabel(m);
  if (label < st.rows[0].month) return null;
  const row = st.rows.find((r) => r.month === label);
  if (row) return { opening: toPaise(row.opening), disbursed: toPaise(row.disbursed), closing: toPaise(row.closing) };
  return { opening: toPaise(st.closing), disbursed: 0, closing: toPaise(st.closing) };
}

/** Indian FY start (April) of a month. */
const fyStart = (m) => ({ month: 4, year: m.month >= 4 ? m.year : m.year - 1 });

/**
 * Per payroll month, borrowers — one borrower = payroll + code + company (the
 * employer; ruling Q4) — whose aggregate outstanding EXCEEDED the threshold
 * (≤ threshold is exempt) at any point in the month:
 *   peak    = Σ over the borrower's loans of (opening + disbursed in the month):
 *             the most it can have been, since every reduction inside a month is
 *             a receipt or the month-end payroll recovery (an upper bound if a
 *             receipt came before a top-up in the same month — never lower).
 *   closing = Σ statement closing (the month-end "maximum outstanding monthly
 *             balance" a CA values the perquisite on).
 * A month whose loan close has not run shows closing before its provisional EMI.
 */
function perquisiteList(db, { from = null, to = null, companies = null, now = new Date() } = {}) {
  const end = to && isValidMonth(to) ? to : istMonthNow(now);
  let start = from && isValidMonth(from) ? from : fyStart(end);
  if (compareMonth(start, end) > 0) start = end;
  if (monthIndex(end) - monthIndex(start) > 23) start = addMonths(end, -23);
  const thresholdPaise = toPaise(readLoanPolicy(db).perquisiteThreshold);
  const who = whoIs(db);
  const loans = db.prepare('SELECT * FROM loans WHERE disbursed_amount IS NOT NULL ORDER BY company, employee_code, id').all().filter(keep(companies));
  const statements = loans.map((l) => ({ loan: l, st: loanStatement(db, l.id) }));
  const closed = db.prepare('SELECT 1 FROM loan_closes WHERE payroll = ? AND month = ? AND year = ?');
  const months = [];
  for (let k = monthIndex(start); k <= monthIndex(end); k++) {
    const m = fromIndex(k);
    const by = new Map();
    for (const { loan, st } of statements) {
      const s = statementAt(st, m);
      if (!s) continue;
      const key = `${loan.borrower_type}|${loan.employee_code}|${loan.company}`;
      if (!by.has(key)) by.set(key, { payroll: loan.borrower_type, employeeCode: loan.employee_code, employeeName: who(loan).name, company: loan.company, loans: [], peak: 0, closing: 0 });
      const b = by.get(key);
      b.loans.push(loan.id);
      b.peak += s.opening + s.disbursed;
      b.closing += s.closing;
    }
    const borrowers = [...by.values()].filter((b) => b.peak > thresholdPaise)
      .sort((a, b) => a.company.localeCompare(b.company) || a.payroll.localeCompare(b.payroll) || a.employeeCode.localeCompare(b.employeeCode))
      .map((b) => ({ ...b, peak: R(b.peak), closing: R(b.closing) }));
    months.push({
      month: m.month, year: m.year, label: monthLabel(m),
      closed: Object.fromEntries(PAYROLLS.map((p) => [p, !!closed.get(p, m.month, m.year)])),
      borrowers,
    });
  }
  return { ok: true, from: start, to: end, threshold: R(thresholdPaise), thresholdPending: 'pending CA confirmation', months };
}

// ── 6. Payslip balance line ──────────────────────────────────────────────────

/**
 * "Loan outstanding after this month's EMI" for one payslip (plant: code, as
 * Stage 7 matches plant loans; sales: code + company, PR-8 Q2).
 *   outstandingAfter = statement closing for month M − M's EMI while it is
 *                      still provisional (before the loan close).
 * After the close it equals the statement's closing for M exactly. Loans not
 * yet paid out by M, or already at ₹0 before M, are left out; none left →
 * {show:false} and the payslip shows no line at all.
 */
function payslipLoanBalance(db, { payroll = 'plant', employeeCode, company = null, month, year }) {
  const m = { month: Number(month), year: Number(year) };
  const base = { ok: true, show: false, payroll, employeeCode: String(employeeCode || ''), company: company || null, month: m.month, year: m.year, loans: [], total: 0 };
  if (!PAYROLLS.includes(payroll) || !isValidMonth(m) || !employeeCode) return base;
  const loans = payroll === 'sales'
    ? db.prepare("SELECT * FROM loans WHERE borrower_type = 'sales' AND employee_code = ? AND company = ? AND disbursed_amount IS NOT NULL ORDER BY id").all(String(employeeCode), String(company || ''))
    : db.prepare("SELECT * FROM loans WHERE borrower_type = 'plant' AND employee_code = ? AND disbursed_amount IS NOT NULL ORDER BY id").all(String(employeeCode));
  const ded = db.prepare('SELECT * FROM loan_deductions WHERE loan_id = ? AND month = ? AND year = ? AND payroll = ?');
  let total = 0;
  for (const l of loans) {
    const s = statementAt(loanStatement(db, l.id), m);
    if (!s || (s.opening <= 0 && s.disbursed <= 0)) continue;
    const d = ded.get(l.id, m.month, m.year, payroll);
    const provisional = d && d.state === 'provisional' ? toPaise(d.amount) : 0;
    const emi = !d ? 0 : d.state === 'posted' ? effectivePostedPaise(db, d) : provisional;
    const after = s.closing - provisional;
    total += after;
    base.loans.push({ loanId: l.id, loanType: l.loan_type, outstandingAfter: R(after), emiThisMonth: R(emi), emiState: d ? d.state : 'none' });
  }
  return { ...base, show: base.loans.length > 0, total: R(total) };
}

// ── 7. Finance Audit hooks ───────────────────────────────────────────────────

/**
 * Plant red-flag rows for month M (ruling Q2: plant only — financeRedFlags is the
 * plant payroll's audit; sales exceptions live in the Loans reports).
 *   emiHigh:       loan_recovery > 0 and (net ≤ 0 or loan_recovery > pct% of net),
 *                  net = net_salary after the loan (ruling Q3, like advance_exceeds_net)
 *   unborne:       an 'unborne' opposite entry on M's plant deduction (SPEC §5.2 r7)
 *   exitResiduals: an open exit residual whose final month is M or earlier (Q5)
 */
function loanRedFlagData(db, month, year) {
  const M = { month: Number(month), year: Number(year) };
  const pct = readLoanPolicy(db).emiNetFlagPct;
  const emiHigh = db.prepare(`SELECT sc.employee_code, sc.loan_recovery, sc.net_salary FROM salary_computations sc
                               WHERE sc.month = ? AND sc.year = ? AND COALESCE(sc.loan_recovery, 0) > 0
                                 AND (sc.net_salary <= 0 OR sc.loan_recovery * 100 > sc.net_salary * ?)
                               ORDER BY sc.employee_code`).all(M.month, M.year, pct)
    .map((r) => ({ employeeCode: r.employee_code, loanRecovery: r.loan_recovery, netSalary: r.net_salary, pct,
      pctOfNet: r.net_salary > 0 ? Math.round((r.loan_recovery / r.net_salary) * 1000) / 10 : null }));
  const hasAdj = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'loan_adjustments'").get();
  const unborne = !hasAdj ? [] : db.prepare(`SELECT d.employee_code, d.loan_id, SUM(a.amount) AS amount, d.amount AS posted
                                               FROM loan_adjustments a JOIN loan_deductions d ON d.id = a.deduction_id
                                              WHERE a.kind = 'unborne' AND d.payroll = 'plant' AND d.month = ? AND d.year = ?
                                              GROUP BY d.id ORDER BY d.employee_code, d.loan_id`).all(M.month, M.year)
    .map((r) => ({ employeeCode: r.employee_code, loanId: r.loan_id, amount: R(toPaise(r.amount)), posted: r.posted }));
  const exitResiduals = listExitResiduals(db).residuals
    .filter((r) => r.borrowerType === 'plant' && toPaise(r.residual) > 0 && compareMonth(r.finalMonth, M) <= 0)
    .map((r) => ({ employeeCode: r.employeeCode, loanId: r.loanId, residual: r.residual, heldPending: r.heldPending, finalMonth: r.finalMonth }));
  return { pct, emiHigh, unborne, exitResiduals };
}

/**
 * Readiness hook: needed loan closes past due, for the month M under review —
 * any needed, unclosed month up to min(M − 1, the month whose close is due
 * today). An empty ledger needs no close → [] (the readiness response is then
 * unchanged).
 */
function overdueCloses(db, { month, year, now = new Date() }) {
  const M = { month: Number(month), year: Number(year) };
  if (!isValidMonth(M)) return [];
  const due = dueCloseMonth(now, readLoanPolicy(db).closeDay);
  const prev = addMonths(M, -1);
  const upTo = compareMonth(prev, due) < 0 ? prev : due;
  const out = [];
  for (const payroll of PAYROLLS) {
    for (const m of neededUnclosedMonths(db, payroll, upTo)) out.push({ payroll, month: m.month, year: m.year });
  }
  return out;
}

// ── 8. Excel ─────────────────────────────────────────────────────────────────

const mLabel = (m) => (m ? monthLabel(m) : '');

/** {name, columns:[[key, label, width?]], rows, totals?} → one sheet each. */
function toXlsx(sheets) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const aoa = [s.columns.map((c) => c[1])];
    for (const r of s.rows) aoa.push(s.columns.map((c) => (r[c[0]] === undefined || r[c[0]] === null ? '' : r[c[0]])));
    if (s.totals) aoa.push(s.columns.map((c, i) => (i === 0 ? 'Total' : s.totals[c[0]] === undefined ? '' : s.totals[c[0]])));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = s.columns.map((c) => ({ wch: c[2] || Math.max(10, String(c[1]).length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const MONEY_COLS = [['disbursed', 'Disbursed ₹'], ['recovered', 'Recovered (payroll) ₹'], ['cash', 'Cash receipts ₹'], ['writtenOff', 'Written off ₹'], ['balance', 'Outstanding ₹']];

/** Excel sheets for a report's data (same figures as the JSON). */
function reportSheets(name, d) {
  if (name === 'outstanding') {
    return [
      { name: 'Outstanding register', rows: d.rows.map((r) => ({ ...r, nextDueMonth: r.nextDue ? mLabel(r.nextDue) : '', reconcilesText: r.reconciles ? 'yes' : 'NO' })),
        columns: [['loanId', 'Loan #'], ['payroll', 'Payroll'], ['company', 'Company', 26], ['department', 'Department', 18], ['employeeCode', 'Code'], ['employeeName', 'Name', 24],
          ['loanType', 'Type', 18], ['status', 'Status', 16], ...MONEY_COLS, ['openInstalments', 'Open instalments ₹'], ['uncovered', 'Unscheduled ₹'],
          ['nextDueMonth', 'Next due'], ['reconcilesText', 'Reconciles']],
        totals: { ...d.totals, loanId: '' } },
      { name: 'By department', rows: d.groups, columns: [['payroll', 'Payroll'], ['company', 'Company', 26], ['department', 'Department', 18], ['loans', 'Loans'], ...MONEY_COLS],
        totals: d.totals },
    ];
  }
  if (name === 'forecast') {
    const cols = d.columns;
    const line = (label, b) => ({ label, count: b.count, amount: b.amount, ...Object.fromEntries(cols.map((c) => [c.key, b.byKey[c.key] || 0])) });
    const rows = [line('Overdue (before start)', d.overdue), ...d.months.map((b) => line(b.label, b)), line('Later than 12 months', d.later), line('Unscheduled (uncovered)', d.unscheduled)];
    return [{ name: 'Recovery forecast', rows,
      columns: [['label', 'Month', 24], ['count', 'Instalments'], ...cols.map((c) => [c.key, `${c.payroll} · ${c.company} ₹`, 30]), ['amount', 'Total ₹']],
      totals: { amount: d.total, count: '', ...Object.fromEntries(cols.map((c) => [c.key, rows.reduce((s, r) => s + toPaise(r[c.key]), 0) / 100])) } }];
  }
  if (name === 'exceptions') {
    return [{ name: 'Exceptions', rows: d.rows.map((r) => ({ ...r, due: mLabel(r.dueMonth), from: mLabel(r.fromMonth) })),
      columns: [['kind', 'Kind', 16], ['loanId', 'Loan #'], ['payroll', 'Payroll'], ['company', 'Company', 26], ['employeeCode', 'Code'], ['employeeName', 'Name', 24],
        ['loanStatus', 'Loan status', 16], ['due', 'Due month'], ['from', 'Moved from'], ['status', 'Instalment'], ['amount', 'Amount ₹'], ['heldPending', 'Held pending ₹']],
      totals: { amount: d.total } }];
  }
  if (name === 'leavers') {
    return [{ name: 'Leavers with balance', rows: d.rows.map((r) => ({ ...r, final: mLabel(r.finalMonth) })),
      columns: [['loanId', 'Loan #'], ['borrowerType', 'Payroll'], ['company', 'Company', 26], ['employeeCode', 'Code'], ['employeeName', 'Name', 24], ['exitDate', 'Exit date'],
        ['final', 'Final payroll'], ['stage', 'Stage', 22], ['balance', 'Outstanding ₹'], ['dueInFinalPayroll', 'Due in final payroll ₹'], ['residual', 'Residual ₹'],
        ['heldPending', 'Held pending ₹'], ['pendingRequest', 'Pending request']],
      totals: d.totals }];
  }
  if (name === 'perquisite') {
    const rows = [];
    for (const m of d.months) for (const b of m.borrowers) rows.push({ month: m.label, ...b, loans: b.loans.join(', '), closedText: m.closed[b.payroll] ? 'yes' : 'no' });
    return [{ name: 'Perquisite list', rows,
      columns: [['month', 'Month'], ['payroll', 'Payroll'], ['company', 'Company', 26], ['employeeCode', 'Code'], ['employeeName', 'Name', 24], ['loans', 'Loans'],
        ['peak', 'Peak outstanding ₹', 18], ['closing', 'Month-end outstanding ₹', 22], ['closedText', 'Loan close run']] },
    { name: 'Notes', rows: [{ k: 'Threshold ₹', v: d.threshold }, { k: 'Status', v: d.thresholdPending }, { k: 'Rule', v: 'Listed when peak > threshold (≤ threshold is exempt)' },
      { k: 'Range', v: `${mLabel(d.from)} to ${mLabel(d.to)}` }], columns: [['k', 'Item', 16], ['v', 'Value', 60]] }];
  }
  if (name === 'write-offs') {
    return [{ name: 'Write-offs (TDS)', rows: d.rows.map((r) => ({ ...r, final: mLabel(r.finalMonth), woMonth: mLabel(r.writeOffMonth) })),
      columns: [['loanId', 'Loan #'], ['borrowerType', 'Payroll'], ['company', 'Company', 26], ['employeeCode', 'Code'], ['loanType', 'Type', 18], ['amount', 'Written off ₹'],
        ['woMonth', 'Write-off month'], ['writtenOffAt', 'Written off at (UTC)', 20], ['writtenOffBy', 'Approved by'], ['exitDate', 'Exit date'], ['final', 'Final payroll'], ['reason', 'Reason', 40]],
      totals: { amount: d.total } }];
  }
  return [];
}

const REPORTS = Object.freeze({
  outstanding: (db, o) => outstandingRegister(db, o),
  forecast: (db, o) => recoveryForecast(db, o),
  exceptions: (db, o) => exceptionsList(db, o),
  leavers: (db, o) => leaversWithBalance(db, o),
  perquisite: (db, o) => perquisiteList(db, o),
});

module.exports = {
  outstandingRegister, recoveryForecast, exceptionsList, leaversWithBalance, perquisiteList,
  payslipLoanBalance, loanRedFlagData, overdueCloses, reportSheets, toXlsx, REPORTS,
};

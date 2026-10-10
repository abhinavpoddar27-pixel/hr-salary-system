/**
 * Loans engine — eligibility (Loans PR-2, docs/loans/SPEC.md §5.2 r2, D-4, D-13,
 * D-17, D-23, D-24, K7, K16, K18, K26; coordinator rulings 4 and 5, 9 Oct 2026).
 *
 * evaluateEligibility() is pure: facts in, verdict out. loadBorrowerFacts()
 * gathers the facts from the database (read-only). Checked at request and again
 * at approval. Every refusal is collected (not first-fail) so the request form
 * can show them all; warnings never block.
 */
const { parseAmount, toRupees, toPaise } = require('./money');
const { addMonthsToDate, parseDate, todayIst } = require('./months');
const { buildSchedule } = require('./schedule');
const { EMERGENCY_LOAN_TYPE, VALID_COMPANIES } = require('./policy');
const { OPEN_LOAN_STATES } = require('./states');
const { earnedBase, priorDeductions, computeHeadroom } = require('./headroom');

const refusal = (code, message) => ({ code, message });
const rs = (p) => `₹${toRupees(p).toLocaleString('en-IN')}`;

function isValidCompany(c) {
  return typeof c === 'string' && VALID_COMPANIES.includes(c.trim());
}

/**
 * @param {object} facts   from loadBorrowerFacts (or hand-built in tests)
 * @param {object} request {borrowerType, company, loanType, principal, tenure, asOf}
 * @param {object} policy  readLoanPolicy()
 */
function evaluateEligibility(facts, request, policy) {
  const refusals = [];
  const warnings = [];
  const asOf = request.asOf || todayIst();
  const borrowerType = request.borrowerType;

  if (!['plant', 'sales'].includes(borrowerType)) refusals.push(refusal('BORROWER_TYPE_INVALID', 'borrower must be plant or sales'));
  if (!isValidCompany(request.company)) {
    refusals.push(refusal('COMPANY_INVALID', `company must be one of: ${VALID_COMPANIES.join(', ')}`));
  }
  if (!policy.loanTypes.includes(request.loanType)) {
    refusals.push(refusal('LOAN_TYPE_INVALID', `loan type must be one of: ${policy.loanTypes.join(', ')}`));
  }

  // ── borrower ───────────────────────────────────────────────────────────────
  if (!facts || !facts.found) {
    refusals.push(refusal('EMPLOYEE_NOT_FOUND', borrowerType === 'sales'
      ? 'no sales-master employee with this code in this company'
      : 'no plant employee with this code'));
  } else {
    if (String(facts.status || '').trim() !== 'Active') {
      refusals.push(refusal('EMPLOYEE_NOT_ACTIVE', `employee status is ${facts.status || 'blank'}, not Active`));
    }
    const type = String(facts.employmentType || '').trim();
    const eligible = policy.eligibleEmploymentTypes.map((t) => t.toLowerCase());
    if (borrowerType === 'plant') {
      if (type.toLowerCase().includes('contract') || Number(facts.isContractor) === 1) {
        refusals.push(refusal('CONTRACT_NOT_ELIGIBLE', 'contract workers cannot borrow: their employer is the contractor (D-17)'));
      } else if (type.toLowerCase() === 'sales') {
        refusals.push(refusal('SALES_USE_SALES_MASTER', 'plant-master rows typed Sales cannot borrow; raise the loan against the sales-master code'));
      } else if (!eligible.filter((t) => t !== 'sales').includes(type.toLowerCase())) {
        refusals.push(refusal('EMPLOYMENT_TYPE_NOT_ELIGIBLE', `employment type "${type || 'blank'}" is not eligible`));
      }
    } else if (borrowerType === 'sales' && !eligible.includes('sales')) {
      refusals.push(refusal('EMPLOYMENT_TYPE_NOT_ELIGIBLE', 'sales staff are not in the eligible employment types'));
    }
    if (facts.masterCompany && isValidCompany(facts.masterCompany) && isValidCompany(request.company)
        && facts.masterCompany.trim() !== request.company.trim()) {
      warnings.push({ code: 'COMPANY_DIFFERS_FROM_MASTER', message: `employee master says ${facts.masterCompany}; loan company is ${request.company}` });
    }
  }

  // ── gross and service ─────────────────────────────────────────────────────
  const grossPaise = facts && facts.found ? facts.grossPaise : 0;
  if (facts && facts.found && !(grossPaise > 0)) {
    refusals.push(refusal('GROSS_UNKNOWN', 'monthly gross is not set for this employee'));
  }
  if (facts && facts.found) {
    const doj = parseDate(facts.doj);
    if (!doj) {
      refusals.push(refusal('SERVICE_UNKNOWN', 'date of joining is missing or invalid'));
    } else {
      const eligibleFrom = addMonthsToDate(facts.doj, policy.minServiceMonths);
      if (asOf < eligibleFrom) {
        refusals.push(refusal('MIN_SERVICE_NOT_MET', `needs ${policy.minServiceMonths} months of service; eligible from ${eligibleFrom}`));
      }
    }
    const open = Number(facts.openLoanCount || 0);
    if (open >= policy.maxActivePerPerson) {
      refusals.push(refusal('ACTIVE_LOAN_LIMIT', `already has ${open} open loan(s); the limit is ${policy.maxActivePerPerson}`));
    }
  }

  // ── amount, tenure, EMI ───────────────────────────────────────────────────
  const amt = parseAmount(request.principal, { field: 'principal' });
  const tenure = Number(request.tenure);
  let emiPaise = null;
  let schedulePreview = null;
  const multiple = request.loanType === EMERGENCY_LOAN_TYPE ? policy.maxMultipleGrossEmergency : policy.maxMultipleGross;
  const limits = {
    maxAmount: grossPaise > 0 ? toRupees(Math.floor(grossPaise * multiple)) : null,
    amountMultiple: multiple,
    maxTenure: policy.maxTenureMonths,
    maxEmi: grossPaise > 0 ? toRupees(Math.floor((grossPaise * policy.emiCeilingPctGross) / 100)) : null,
  };
  if (!amt.ok) refusals.push(refusal(amt.code, amt.message));
  if (!Number.isInteger(tenure) || tenure < 1) {
    refusals.push(refusal('TENURE_INVALID', 'tenure must be a whole number of months, at least 1'));
  } else if (tenure > policy.maxTenureMonths) {
    refusals.push(refusal('TENURE_OVER_LIMIT', `tenure ${tenure} months is above the ${policy.maxTenureMonths}-month limit`));
  }
  if (amt.ok && grossPaise > 0 && amt.paise > Math.floor(grossPaise * multiple)) {
    refusals.push(refusal('AMOUNT_OVER_LIMIT', `${rs(amt.paise)} is above ${multiple}× monthly gross (${rs(Math.floor(grossPaise * multiple))})`));
  }
  if (amt.ok && Number.isInteger(tenure) && tenure >= 1) {
    const sched = buildSchedule({ principalPaise: amt.paise, tenure, firstMonth: request.previewFirstMonth || { month: 1, year: 2000 } });
    if (!sched.ok) {
      refusals.push(refusal(sched.code, sched.message));
    } else {
      emiPaise = sched.emiPaise;
      schedulePreview = sched.instalments.map((i) => ({ sequence: i.sequence, amount: toRupees(i.amountPaise) }));
      const ceiling = Math.floor((grossPaise * policy.emiCeilingPctGross) / 100);
      if (grossPaise > 0 && emiPaise > ceiling) {
        refusals.push(refusal('EMI_OVER_CEILING', `EMI ${rs(emiPaise)} is above ${policy.emiCeilingPctGross}% of monthly gross (${rs(ceiling)})`));
      }
    }
  }

  // ── deduction load (D-13, K26) — warnings only ────────────────────────────
  const h = facts && facts.history;
  if (h && h.months > 0) {
    const loadPct = h.earnedBasePaise > 0 ? (h.totalDeductionsPaise * 100) / h.earnedBasePaise : null;
    if (loadPct === null || loadPct > policy.deductionLoadWarningPct) {
      warnings.push({
        code: 'DEDUCTION_LOAD_HIGH',
        message: `last ${h.months} month(s) deductions averaged ${loadPct === null ? 'n/a' : loadPct.toFixed(1) + '%'} of earned pay (warning above ${policy.deductionLoadWarningPct}%)`,
        loadPct,
      });
    }
    if (emiPaise !== null) {
      const room = computeHeadroom({
        earnedBasePaise: Math.floor(h.earnedBasePaise / h.months),
        capPct: policy.deductionCapPct,
        priorDeductionsPaise: Math.ceil(h.priorDeductionsPaise / h.months),
      });
      if (room < emiPaise) {
        warnings.push({
          code: 'PROJECTED_RECOVERY_LOW',
          message: `average room under the ${policy.deductionCapPct}% cap is ${rs(room)} a month, below the EMI of ${rs(emiPaise)}; shortfalls likely`,
          projectedHeadroom: toRupees(room),
        });
      }
    }
  } else if (facts && facts.found) {
    warnings.push({ code: 'NO_SALARY_HISTORY', message: 'no computed salary in the system yet; deduction load cannot be checked' });
  }

  return {
    eligible: refusals.length === 0,
    refusals, warnings, limits,
    emi: emiPaise === null ? null : toRupees(emiPaise),
    emiPaise, schedulePreview,
    urgent: request.loanType === EMERGENCY_LOAN_TYPE,
  };
}

/**
 * Reads everything evaluateEligibility needs. Read-only.
 * Plant: employees by code; sales: sales_employees by code AND company (that
 * table is unique on code + company). Sales gross = latest structure (PR-8 Q5).
 */
function loadBorrowerFacts(db, { borrowerType, employeeCode, company, excludeLoanId = null, asOf = null }) {
  const code = String(employeeCode == null ? '' : employeeCode).trim();
  const facts = { found: false, borrowerType };
  if (!code) return facts;

  let row = null;
  let grossPaise = 0;
  if (borrowerType === 'plant') {
    row = db.prepare(`SELECT id, code, status, employment_type, is_contractor, company, gross_salary, date_of_joining
                        FROM employees WHERE code = ?`).get(code);
    if (row) {
      grossPaise = toPaise(row.gross_salary || 0);
      if (!(grossPaise > 0)) {
        const s = db.prepare(`SELECT gross_salary FROM salary_structures WHERE employee_id = ?
                               ORDER BY effective_from DESC, id DESC LIMIT 1`).get(row.id);
        grossPaise = s ? toPaise(s.gross_salary || 0) : 0;
      }
      Object.assign(facts, {
        found: true, status: row.status, employmentType: row.employment_type,
        isContractor: row.is_contractor, masterCompany: row.company, doj: row.date_of_joining,
      });
    }
  } else if (borrowerType === 'sales') {
    row = db.prepare(`SELECT id, code, status, company, gross_salary, doj
                        FROM sales_employees WHERE code = ? AND company = ?`).get(code, String(company || '').trim());
    if (row) {
      // Loans PR-8 (ruling Q5): the gross sales compute actually pays — the latest
      // structure effective on or before the as-of month (else the latest one, the
      // same fallback as salesSalaryComputation getLatestStructure); the master
      // gross only when there is no structure.
      const asOfMonth = String(asOf || todayIst()).slice(0, 7);
      const s = db.prepare(`SELECT gross_salary FROM sales_salary_structures WHERE employee_id = ? AND effective_from <= ?
                             ORDER BY effective_from DESC, id DESC LIMIT 1`).get(row.id, asOfMonth)
        || db.prepare(`SELECT gross_salary FROM sales_salary_structures WHERE employee_id = ?
                        ORDER BY effective_from DESC, id DESC LIMIT 1`).get(row.id);
      grossPaise = s ? toPaise(s.gross_salary || 0) : 0;
      if (!(grossPaise > 0)) grossPaise = toPaise(row.gross_salary || 0);
      Object.assign(facts, {
        found: true, status: row.status, employmentType: 'Sales', isContractor: 0,
        masterCompany: row.company, doj: row.doj,
      });
    }
  }
  if (!facts.found) return facts;
  facts.grossPaise = Number.isFinite(grossPaise) ? grossPaise : 0;

  // Loans PR-8 (ruling Q2): a sales borrower is code + company, so the sales
  // open-loan count and deduction history are scoped to the company.
  const salesCo = borrowerType === 'sales' ? String(company || '').trim() : null;
  facts.openLoanCount = db.prepare(`
    SELECT COUNT(*) AS n FROM loans
     WHERE borrower_type = ? AND employee_code = ? AND status IN (${OPEN_LOAN_STATES.map(() => '?').join(',')})
       AND id IS NOT ?${salesCo !== null ? ' AND company = ?' : ''}
  `).get(borrowerType, code, ...OPEN_LOAN_STATES, excludeLoanId, ...(salesCo !== null ? [salesCo] : [])).n;

  facts.history = loadDeductionHistory(db, borrowerType, code, salesCo);
  return facts;
}

/** Last 3 computed salary months (all companies summed per month). */
function loadDeductionHistory(db, borrowerType, code, company = null) {
  const table = borrowerType === 'sales' ? 'sales_salary_computations' : 'salary_computations';
  const rows = borrowerType === 'sales' && company !== null
    ? db.prepare(`SELECT * FROM ${table} WHERE employee_code = ? AND company = ? ORDER BY year DESC, month DESC`).all(code, company)
    : db.prepare(`SELECT * FROM ${table} WHERE employee_code = ? ORDER BY year DESC, month DESC`).all(code);
  const months = [];
  const byMonth = new Map();
  for (const r of rows) {
    const k = `${r.year}-${r.month}`;
    if (!byMonth.has(k)) {
      if (byMonth.size === 3) break;
      byMonth.set(k, []);
      months.push(k);
    }
    byMonth.get(k).push(r);
  }
  const h = { months: byMonth.size, earnedBasePaise: 0, priorDeductionsPaise: 0, totalDeductionsPaise: 0 };
  for (const list of byMonth.values()) {
    for (const r of list) {
      h.earnedBasePaise += earnedBase(r, borrowerType);
      h.priorDeductionsPaise += priorDeductions(r, borrowerType);
      h.totalDeductionsPaise += Math.max(0, toPaise(r.total_deductions || 0) || 0);
    }
  }
  return h;
}

module.exports = { evaluateEligibility, loadBorrowerFacts, loadDeductionHistory, isValidCompany };

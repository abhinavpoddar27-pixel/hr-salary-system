/**
 * Loans PR-8 — sales payroll fixture (plain node, no jest: the sales
 * simulation script uses it too).
 *
 * Builds sales reps, structures and an ACTIVE upload exactly as the sales
 * routes expect them, and raises / approves / disburses a sales loan through
 * the real engine. Sales compute itself is driven through the real route
 * (POST /api/sales/compute) by the caller, over the JWT harness.
 */
const L = require('../../services/loans');

const IND = 'Indriyan Beverages Pvt Ltd';
const ALI = 'Asian Lakto Ind Ltd';
const HR = { username: 'hr1', role: 'hr' };
const ADMIN = { username: 'boss', role: 'admin' };
const FIN = { username: 'fin1', role: 'finance' };
const SYS = { username: 'system', role: 'system' };

/** A sales rep + one salary structure (basic = gross unless split given). */
function addRep(db, { code, company = IND, gross = 20000, basic = null, hra = 0, doj = '2024-01-01', status = 'Active', pf = 0, esi = 0, name = 'SALES REP' }) {
  const info = db.prepare(`INSERT INTO sales_employees (code, name, company, status, doj, gross_salary, designation, headquarters, bank_name, account_no, ifsc)
                           VALUES (?, ?, ?, ?, ?, ?, 'SO', 'HQ', 'BANK', ?, 'IFSC0000001')`)
    .run(code, name, company, status, doj, gross, `AC${code}`);
  const b = basic === null ? gross - hra : basic;
  db.prepare(`INSERT INTO sales_salary_structures (employee_id, effective_from, basic, hra, cca, conveyance, gross_salary, pf_applicable, esi_applicable, pt_applicable, created_by)
              VALUES (?, '2024-01', ?, ?, 0, 0, ?, ?, ?, 0, 'test')`).run(info.lastInsertRowid, b, hra, gross, pf, esi);
  return { id: info.lastInsertRowid, code, company };
}

/**
 * A new ACTIVE upload for (month, year, company) with one matched row per rep
 * (days given). Any earlier upload of the period is superseded, as confirm does.
 */
function setUpload(db, { month, year, company = IND, rows }) {
  return db.transaction(() => {
    db.prepare('UPDATE sales_uploads SET is_active = 0 WHERE month = ? AND year = ? AND company = ?').run(month, year, company);
    const up = db.prepare(`INSERT INTO sales_uploads (month, year, company, filename, file_hash, total_rows, matched_rows, unmatched_rows, status, uploaded_by, is_active)
                           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'matched', 'hr1', 1)`)
      .run(month, year, company, `sheet-${month}-${year}.xlsx`, `h-${month}-${year}-${company}-${Date.now()}-${Math.random()}`, rows.length, rows.length).lastInsertRowid;
    const ins = db.prepare(`INSERT INTO sales_monthly_input (month, year, company, upload_id, sheet_row_number, sheet_employee_name, sheet_days_given, employee_code, match_confidence, match_method)
                            VALUES (?, ?, ?, ?, ?, 'REP', ?, ?, 'exact', 'test')`);
    rows.forEach((r, i) => ins.run(month, year, company, up, i + 1, r.days, r.code));
    return up;
  })();
}

/** Raised by HR, approved by the admin, disbursed by finance — returns the loan id. */
function salesLoan(db, { code, company = IND, principal = 10000, tenure = 3, disbursedOn = '2026-10-05', asOf = '2026-10-09', loanType = 'Personal' }) {
  const r = L.requestLoan(db, { borrowerType: 'sales', employeeCode: code, company, loanType, principal, tenure, reason: 'test' }, HR, { asOf });
  if (!r.ok) throw new Error(`request failed: ${r.code} ${r.message}`);
  const a = L.approveLoan(db, r.loanId, ADMIN, { asOf });
  if (!a.ok) throw new Error(`approve failed: ${a.code} ${a.message}`);
  const d = L.disburseLoan(db, r.loanId, FIN, { mode: 'NEFT', reference: 'UTR', disbursedOn, agreementFilePath: 'agreements/a.pdf' }, { asOf: asOf > disbursedOn ? asOf : disbursedOn });
  if (!d.ok) throw new Error(`disburse failed: ${d.code} ${d.message}`);
  return r.loanId;
}

const salaryRow = (db, code, month, year, company = IND) => db.prepare(
  'SELECT * FROM sales_salary_computations WHERE employee_code = ? AND month = ? AND year = ? AND company = ?',
).get(code, month, year, company);

/** Sales drift (net formula verified in PR-8 Phase 0). */
const SALES_DRIFT_SQL = `SELECT COUNT(*) AS n FROM sales_salary_computations
  WHERE ABS(net_salary - (gross_earned + COALESCE(diwali_bonus,0) + COALESCE(incentive_amount,0) - total_deductions)) > 1`;

/** Sales rows whose total_deductions is not the sum of its components. */
const SALES_SHORT_SQL = `SELECT COUNT(*) AS n FROM sales_salary_computations
  WHERE ABS(total_deductions - (COALESCE(pf_employee,0) + COALESCE(esi_employee,0) + COALESCE(professional_tax,0) + COALESCE(tds,0)
        + COALESCE(advance_recovery,0) + COALESCE(loan_recovery,0) + COALESCE(other_deductions,0))) > 0.005`;

module.exports = { L, IND, ALI, HR, ADMIN, FIN, SYS, addRep, setUpload, salesLoan, salaryRow, SALES_DRIFT_SQL, SALES_SHORT_SQL };

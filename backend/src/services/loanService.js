/**
 * Loan Service
 * Manages loan lifecycle: create, approve, disburse, generate EMI schedule, auto-deduct
 */

const LOAN_TYPES = ['Salary Advance', 'Personal Loan', 'Festival Advance', 'Emergency'];

/**
 * Create a new loan
 */
function createLoan(db, data) {
  const { employeeCode, loanType, principalAmount, interestRate = 0, tenureMonths, startMonth, startYear, remarks } = data;

  const emp = db.prepare('SELECT id, name, department FROM employees WHERE code = ?').get(employeeCode);
  if (!emp) throw new Error('Employee not found');

  // Calculate total amount and EMI
  const rate = interestRate / 100 / 12; // monthly rate
  let totalAmount, emiAmount;

  if (rate > 0) {
    // EMI formula: P * r * (1+r)^n / ((1+r)^n - 1)
    const factor = Math.pow(1 + rate, tenureMonths);
    emiAmount = Math.round(principalAmount * rate * factor / (factor - 1));
    totalAmount = emiAmount * tenureMonths;
  } else {
    totalAmount = principalAmount;
    emiAmount = Math.ceil(principalAmount / tenureMonths);
  }

  const result = db.prepare(`
    INSERT INTO loans (
      employee_id, employee_code, loan_type, principal_amount, interest_rate,
      total_amount, emi_amount, tenure_months, start_month, start_year,
      status, remaining_balance, remarks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)
  `).run(
    emp.id, employeeCode, loanType, principalAmount, interestRate,
    totalAmount, emiAmount, tenureMonths,
    startMonth || null, startYear || null,
    totalAmount, remarks || ''
  );

  return {
    id: result.lastInsertRowid,
    employeeCode, employeeName: emp.name,
    loanType, principalAmount, totalAmount, emiAmount, tenureMonths,
    status: 'Pending'
  };
}

/**
 * Approve a loan and generate repayment schedule
 */
function approveLoan(db, loanId, approvedBy, startMonth, startYear) {
  const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId);
  if (!loan) throw new Error('Loan not found');
  if (loan.status !== 'Pending') throw new Error(`Loan is already ${loan.status}`);

  const sMonth = startMonth || loan.start_month;
  const sYear = startYear || loan.start_year;
  if (!sMonth || !sYear) throw new Error('Start month and year required');

  const txn = db.transaction(() => {
    // Update loan status
    db.prepare(`
      UPDATE loans SET
        status = 'Active', approved_by = ?, approved_at = datetime('now'),
        disbursed_date = datetime('now'), start_month = ?, start_year = ?
      WHERE id = ?
    `).run(approvedBy, sMonth, sYear, loanId);

    // Generate repayment schedule
    let month = sMonth;
    let year = sYear;
    let remaining = loan.total_amount;
    const rate = (loan.interest_rate || 0) / 100 / 12;

    for (let i = 0; i < loan.tenure_months; i++) {
      let emi = loan.emi_amount;
      // Last EMI: adjust to remaining balance
      if (i === loan.tenure_months - 1) {
        emi = Math.round(remaining * 100) / 100;
      }

      let interestComp = 0, principalComp = emi;
      if (rate > 0) {
        interestComp = Math.round(remaining * rate * 100) / 100;
        principalComp = Math.round((emi - interestComp) * 100) / 100;
      }

      db.prepare(`
        INSERT INTO loan_repayments (
          loan_id, employee_code, month, year, emi_amount,
          principal_component, interest_component, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')
      `).run(loanId, loan.employee_code, month, year, emi, principalComp, interestComp);

      remaining -= principalComp;
      month++;
      if (month > 12) { month = 1; year++; }
    }
  });
  txn();

  return { loanId, status: 'Active', startMonth: sMonth, startYear: sYear };
}

/**
 * Get all loans with optional filters
 */
function getLoans(db, filters = {}) {
  const { status, employeeCode } = filters;
  let query = `
    SELECT l.*, e.name as employee_name, e.department, e.designation
    FROM loans l
    LEFT JOIN employees e ON l.employee_code = e.code
    WHERE 1=1
  `;
  const params = [];

  if (status) { query += ' AND l.status = ?'; params.push(status); }
  if (employeeCode) { query += ' AND l.employee_code = ?'; params.push(employeeCode); }

  query += ' ORDER BY l.created_at DESC';
  return db.prepare(query).all(...params);
}

/**
 * Get loan details with repayment schedule
 */
function getLoanDetails(db, loanId) {
  const loan = db.prepare(`
    SELECT l.*, e.name as employee_name, e.department
    FROM loans l
    LEFT JOIN employees e ON l.employee_code = e.code
    WHERE l.id = ?
  `).get(loanId);

  if (!loan) return null;

  const repayments = db.prepare(`
    SELECT * FROM loan_repayments
    WHERE loan_id = ? ORDER BY year, month
  `).all(loanId);

  return { ...loan, repayments };
}

/**
 * Get loans for a specific employee
 */
function getEmployeeLoans(db, employeeCode) {
  const loans = db.prepare(`
    SELECT l.*, e.name as employee_name
    FROM loans l
    LEFT JOIN employees e ON l.employee_code = e.code
    WHERE l.employee_code = ?
    ORDER BY l.created_at DESC
  `).all(employeeCode);

  // Add repayment progress for each loan
  for (const loan of loans) {
    const paid = db.prepare(`
      SELECT COUNT(*) as count, SUM(emi_amount) as total
      FROM loan_repayments
      WHERE loan_id = ? AND deducted_from_salary = 1
    `).get(loan.id);
    loan.paidEmis = paid.count;
    loan.totalRecovered = paid.total || 0;
    loan.remainingEmis = loan.tenure_months - paid.count;
  }

  return loans;
}

/**
 * Process monthly deductions for all active loans
 * Called during salary computation or as a batch job
 */
function processMonthlyDeductions(db, month, year) {
  const pending = db.prepare(`
    SELECT lr.*, l.employee_code, l.loan_type, e.name as employee_name
    FROM loan_repayments lr
    JOIN loans l ON lr.loan_id = l.id
    LEFT JOIN employees e ON l.employee_code = e.code
    WHERE lr.month = ? AND lr.year = ? AND lr.status = 'Pending'
    AND l.status = 'Active'
  `).all(month, year);

  return pending;
}

/**
 * Get pending deductions for a specific month
 */
function getPendingDeductions(db, month, year) {
  return db.prepare(`
    SELECT lr.*, l.employee_code, l.loan_type, l.principal_amount,
           e.name as employee_name, e.department
    FROM loan_repayments lr
    JOIN loans l ON lr.loan_id = l.id
    LEFT JOIN employees e ON l.employee_code = e.code
    WHERE lr.month = ? AND lr.year = ? AND lr.deducted_from_salary = 0
    AND l.status = 'Active'
    ORDER BY e.department, e.name
  `).all(month, year);
}

/**
 * Get loan summary stats
 */
function getLoanStats(db) {
  const active = db.prepare("SELECT COUNT(*) as count, SUM(remaining_balance) as balance FROM loans WHERE status = 'Active'").get();
  const pending = db.prepare("SELECT COUNT(*) as count FROM loans WHERE status = 'Pending'").get();
  const total = db.prepare("SELECT COUNT(*) as count, SUM(principal_amount) as amount FROM loans").get();
  const recovered = db.prepare("SELECT SUM(emi_amount) as total FROM loan_repayments WHERE deducted_from_salary = 1").get();

  return {
    activeLoans: active.count,
    outstandingBalance: Math.round((active.balance || 0) * 100) / 100,
    pendingApproval: pending.count,
    totalLoans: total.count,
    totalDisbursed: Math.round((total.amount || 0) * 100) / 100,
    totalRecovered: Math.round((recovered.total || 0) * 100) / 100
  };
}

module.exports = {
  LOAN_TYPES,
  createLoan,
  approveLoan,
  getLoans,
  getLoanDetails,
  getEmployeeLoans,
  processMonthlyDeductions,
  getPendingDeductions,
  getLoanStats
};

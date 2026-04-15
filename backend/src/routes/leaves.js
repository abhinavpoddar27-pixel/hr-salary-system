const express = require('express');
const router = express.Router();
const { getDb, logAudit } = require('../database/db');

/**
 * GET /api/leaves
 * List leave applications with optional filters
 */
router.get('/', (req, res) => {
  const db = getDb();
  const { status, employeeCode, month, year } = req.query;

  let query = `
    SELECT la.*, e.name as employee_name, e.department, e.designation
    FROM leave_applications la
    LEFT JOIN employees e ON la.employee_code = e.code
    WHERE 1=1
  `;
  const params = [];

  if (status) { query += ' AND la.status = ?'; params.push(status); }
  if (employeeCode) { query += ' AND la.employee_code = ?'; params.push(employeeCode); }
  if (month && year) {
    const ms = String(month).padStart(2, '0');
    query += ` AND (la.start_date LIKE ? OR la.end_date LIKE ?)`;
    params.push(`${year}-${ms}-%`, `${year}-${ms}-%`);
  }

  query += ' ORDER BY la.applied_at DESC LIMIT 200';
  const records = db.prepare(query).all(...params);

  const stats = {
    total: records.length,
    pending: records.filter(r => r.status === 'Pending').length,
    approved: records.filter(r => r.status === 'Approved').length,
    rejected: records.filter(r => r.status === 'Rejected').length
  };

  res.json({ success: true, data: records, stats });
});

/**
 * POST /api/leaves
 * Submit a leave application
 *
 * Phase 1 leave-management additions:
 *  - CL / EL requests hard-blocked at zero balance (no more warnings)
 *  - hr_remark mandatory for CL / EL / LWP
 *  - finalization lock: no new leave against a finalised month
 */
router.post('/', (req, res) => {
  const db = getDb();
  const { employeeCode, leaveType, startDate, endDate, days, reason, hrRemark } = req.body;

  if (!employeeCode || !leaveType || !startDate || !endDate) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(employeeCode);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

  // Calculate days if not provided
  const leaveDays = days || Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;

  // Mandatory HR remark on CL / EL / LWP
  if (['CL', 'EL', 'LWP'].includes(leaveType) && (!hrRemark || !String(hrRemark).trim())) {
    return res.status(400).json({
      success: false,
      error: `hrRemark is required for ${leaveType} leave`
    });
  }

  // Hard block: CL and EL cannot go negative on submission.
  // (SL and LWP are not balance-backed; OD is its own table.)
  if (['CL', 'EL'].includes(leaveType)) {
    const year = new Date(startDate).getFullYear();
    const bal = db.prepare(`
      SELECT balance FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = ?
    `).get(emp.id, year, leaveType);
    const currentBalance = bal?.balance || 0;
    if (currentBalance < leaveDays) {
      return res.status(400).json({
        success: false,
        error: `Insufficient ${leaveType} balance (current: ${currentBalance}, requested: ${leaveDays})`
      });
    }
  }

  // Finalization lock — block leaves against months that are locked for payroll.
  const leaveMonth = new Date(startDate).getMonth() + 1;
  const leaveYear = new Date(startDate).getFullYear();
  const finalized = db.prepare(`
    SELECT 1 FROM monthly_imports
    WHERE month = ? AND year = ? AND is_finalised = 1
    LIMIT 1
  `).get(leaveMonth, leaveYear);
  if (finalized) {
    return res.status(400).json({
      success: false,
      error: `Cannot apply leaves for a finalized month (${leaveMonth}/${leaveYear})`
    });
  }

  const cleanHrRemark = hrRemark ? String(hrRemark).trim() : null;

  const result = db.prepare(`
    INSERT INTO leave_applications
      (employee_id, employee_code, leave_type, start_date, end_date, days, reason, hr_remark)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(emp.id, employeeCode, leaveType, startDate, endDate, leaveDays, reason || '', cleanHrRemark);

  // Create notification
  db.prepare(`
    INSERT INTO notifications (type, title, message, action_url)
    VALUES ('LEAVE_REQUEST', 'New Leave Request', ?, '/leave-management')
  `).run(`${emp.id}: ${employeeCode} requested ${leaveDays} day(s) ${leaveType} leave`);

  res.json({ success: true, id: result.lastInsertRowid, message: 'Leave application submitted' });
});

/**
 * PUT /api/leaves/:id/approve
 *
 * Phase 1: CL / EL approval is hard-blocked when balance would go negative.
 * Previously the approval went through with a "balance will go negative"
 * warning, which silently created LWP-shaped liabilities on the books.
 */
router.put('/:id/approve', (req, res) => {
  const db = getDb();
  const approvedBy = req.user?.username || 'admin';

  const leave = db.prepare('SELECT * FROM leave_applications WHERE id = ? AND status = ?').get(req.params.id, 'Pending');
  if (!leave) return res.status(404).json({ success: false, error: 'Leave not found or already processed' });

  const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(leave.employee_code);

  // Hard-block CL / EL when balance is insufficient. SL has no balance model
  // so it passes through (historic behaviour preserved).
  if (emp && ['CL', 'EL'].includes(leave.leave_type)) {
    const year = new Date(leave.start_date).getFullYear();
    const bal = db.prepare(`
      SELECT balance FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = ?
    `).get(emp.id, year, leave.leave_type);
    const currentBalance = bal?.balance || 0;
    if (currentBalance < leave.days) {
      return res.status(400).json({
        success: false,
        error: `Cannot approve: insufficient ${leave.leave_type} balance (current: ${currentBalance}, requested: ${leave.days})`
      });
    }
  }

  const txn = db.transaction(() => {
    db.prepare(`
      UPDATE leave_applications SET status = 'Approved', approved_by = ?, approved_at = datetime('now')
      WHERE id = ?
    `).run(approvedBy, req.params.id);

    if (emp && ['CL', 'EL', 'SL'].includes(leave.leave_type)) {
      const year = new Date(leave.start_date).getFullYear();
      db.prepare(`
        UPDATE leave_balances SET used = used + ?, balance = balance - ?
        WHERE employee_id = ? AND year = ? AND leave_type = ?
      `).run(leave.days, leave.days, emp.id, year, leave.leave_type);
    }
  });
  txn();

  res.json({ success: true, message: 'Leave approved' });
});

/**
 * DELETE /api/leaves/:id
 *
 * Soft-cancellation: sets status='Cancelled' so the audit trail is preserved.
 * If the leave was already Approved and was CL / EL / SL, the consumed
 * balance is credited back. Blocked when the underlying month is finalised.
 */
router.delete('/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ success: false, error: 'id required' });

  const leave = db.prepare('SELECT * FROM leave_applications WHERE id = ?').get(id);
  if (!leave) return res.status(404).json({ success: false, error: 'Leave not found' });

  if (!['Pending', 'Approved'].includes(leave.status)) {
    return res.status(400).json({
      success: false,
      error: `Cannot cancel leave with status '${leave.status}'`
    });
  }

  const month = new Date(leave.start_date).getMonth() + 1;
  const year = new Date(leave.start_date).getFullYear();
  const finalized = db.prepare(`
    SELECT 1 FROM monthly_imports WHERE month = ? AND year = ? AND is_finalised = 1 LIMIT 1
  `).get(month, year);
  if (finalized) {
    return res.status(400).json({
      success: false,
      error: `Cannot cancel leave in a finalized month (${month}/${year})`
    });
  }

  const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(leave.employee_code);
  const cancelledBy = req.user?.username || 'admin';

  const txn = db.transaction(() => {
    db.prepare(`
      UPDATE leave_applications
      SET status = 'Cancelled', approved_by = ?, approved_at = datetime('now')
      WHERE id = ?
    `).run(cancelledBy, id);

    // Credit balance back only if the leave was Approved and was balance-backed
    if (leave.status === 'Approved' && emp && ['CL', 'EL', 'SL'].includes(leave.leave_type)) {
      db.prepare(`
        UPDATE leave_balances
        SET used = MAX(0, used - ?), balance = balance + ?
        WHERE employee_id = ? AND year = ? AND leave_type = ?
      `).run(leave.days, leave.days, emp.id, year, leave.leave_type);
    }
  });
  txn();

  try {
    logAudit('leave_applications', id, 'status', leave.status, 'Cancelled', 'leave_cancel', `Cancelled by ${cancelledBy}`);
  } catch (e) { /* audit failure must not break cancellation */ }

  res.json({ success: true, id });
});

/**
 * PUT /api/leaves/:id/reject
 */
router.put('/:id/reject', (req, res) => {
  const db = getDb();
  const { reason } = req.body;

  db.prepare(`
    UPDATE leave_applications SET status = 'Rejected', approved_by = ?, approved_at = datetime('now'),
    rejection_reason = ?
    WHERE id = ? AND status = 'Pending'
  `).run(req.user?.username || 'admin', reason || '', req.params.id);

  res.json({ success: true, message: 'Leave rejected' });
});

/**
 * GET /api/leaves/summary
 * Get leave summary for the month
 */
router.get('/summary', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  const ms = String(month).padStart(2, '0');
  const prefix = `${year}-${ms}`;

  const approved = db.prepare(`
    SELECT la.employee_code, la.leave_type, la.days, la.start_date, la.end_date,
           e.name as employee_name, e.department
    FROM leave_applications la
    LEFT JOIN employees e ON la.employee_code = e.code
    WHERE la.status = 'Approved'
    AND (la.start_date LIKE ? OR la.end_date LIKE ?)
  `).all(`${prefix}-%`, `${prefix}-%`);

  const byType = {};
  for (const l of approved) {
    byType[l.leave_type] = (byType[l.leave_type] || 0) + l.days;
  }

  res.json({
    success: true,
    data: approved,
    summary: {
      totalDays: approved.reduce((s, l) => s + l.days, 0),
      byType,
      employeesOnLeave: [...new Set(approved.map(l => l.employee_code))].length
    }
  });
});

/**
 * GET /api/leaves/balances
 * All employee leave balances
 */
router.get('/balances', (req, res) => {
  const db = getDb();
  const { company, year, department, search } = req.query;
  const currentYear = year || new Date().getFullYear();

  let query = `
    SELECT e.code as employee_code, e.name, e.department, e.company,
           MAX(CASE WHEN lb.leave_type = 'CL' THEN lb.balance ELSE 0 END) as CL,
           MAX(CASE WHEN lb.leave_type = 'EL' THEN lb.balance ELSE 0 END) as EL,
           MAX(CASE WHEN lb.leave_type = 'SL' THEN lb.balance ELSE 0 END) as SL
    FROM employees e
    LEFT JOIN leave_balances lb ON lb.employee_id = e.id AND lb.year = ?
    WHERE e.status = 'Active'
  `;
  const params = [currentYear];

  if (company) { query += ' AND e.company = ?'; params.push(company); }
  if (department) { query += ' AND e.department = ?'; params.push(department); }
  if (search) {
    query += ' AND (e.code LIKE ? OR e.name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ' GROUP BY e.code ORDER BY e.name';
  const rows = db.prepare(query).all(...params);
  res.json({ success: true, data: rows });
});

/**
 * GET /api/leaves/balances/:code
 * Single employee leave balances
 */
router.get('/balances/:code', (req, res) => {
  const db = getDb();
  const { year } = req.query;
  const currentYear = year || new Date().getFullYear();

  const rows = db.prepare(`
    SELECT lb.leave_type, lb.opening, lb.accrued, lb.used, lb.balance
    FROM leave_balances lb
    JOIN employees e ON lb.employee_id = e.id
    WHERE e.code = ? AND lb.year = ?
  `).all(req.params.code, currentYear);

  const balances = { CL: 0, EL: 0, SL: 0 };
  for (const r of rows) {
    balances[r.leave_type] = r.balance;
  }

  res.json({ success: true, data: balances, details: rows });
});

/**
 * POST /api/leaves/adjust
 * Manual leave adjustment
 */
router.post('/adjust', (req, res) => {
  const db = getDb();
  const { employee_code, leave_type, days, transaction_type, reason } = req.body;

  if (!employee_code || !leave_type || days == null || !transaction_type) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  const validTypes = ['Credit', 'Debit', 'Manual Adjustment', 'Opening Balance', 'Carry Forward'];
  if (!validTypes.includes(transaction_type)) {
    return res.status(400).json({ success: false, error: `Invalid transaction_type. Must be one of: ${validTypes.join(', ')}` });
  }

  const emp = db.prepare('SELECT id, company FROM employees WHERE code = ?').get(employee_code);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

  const currentYear = new Date().getFullYear();

  // Ensure leave_balances row exists
  db.prepare(`
    INSERT OR IGNORE INTO leave_balances (employee_id, year, leave_type, opening, accrued, used, balance)
    VALUES (?, ?, ?, 0, 0, 0, 0)
  `).run(emp.id, currentYear, leave_type);

  const bal = db.prepare(`
    SELECT * FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = ?
  `).get(emp.id, currentYear, leave_type);

  const oldBalance = bal.balance;
  let newBalance = oldBalance;

  if (transaction_type === 'Debit') {
    newBalance = oldBalance - Math.abs(days);
    db.prepare(`
      UPDATE leave_balances SET used = used + ?, balance = ? WHERE id = ?
    `).run(Math.abs(days), newBalance, bal.id);
  } else {
    // Credit, Manual Adjustment, Opening Balance, Carry Forward all add
    newBalance = oldBalance + Math.abs(days);
    db.prepare(`
      UPDATE leave_balances SET balance = ? WHERE id = ?
    `).run(newBalance, bal.id);
  }

  // Insert leave transaction
  const now = new Date();
  db.prepare(`
    INSERT INTO leave_transactions (employee_id, employee_code, company, leave_type, transaction_type, days, balance_after, reference_month, reference_year, reason, approved_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(emp.id, employee_code, emp.company, leave_type, transaction_type, days, newBalance, now.getMonth() + 1, now.getFullYear(), reason || '', 'admin');

  logAudit('leave_balances', emp.id, leave_type, oldBalance, newBalance, 'leave_adjustment', reason || '');

  res.json({ success: true, message: 'Leave adjusted', oldBalance, newBalance });
});

/**
 * GET /api/leaves/transactions/:code
 * Leave transaction history for an employee
 */
router.get('/transactions/:code', (req, res) => {
  const db = getDb();
  const { year, leave_type } = req.query;

  let query = 'SELECT * FROM leave_transactions WHERE employee_code = ?';
  const params = [req.params.code];

  if (year) { query += ' AND reference_year = ?'; params.push(year); }
  if (leave_type) { query += ' AND leave_type = ?'; params.push(leave_type); }

  query += ' ORDER BY created_at DESC';
  const rows = db.prepare(query).all(...params);
  res.json({ success: true, data: rows });
});

/**
 * GET /api/leaves/register
 * Monthly leave register — who took leave and what type
 */
router.get('/register', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;

  if (!month || !year) {
    return res.status(400).json({ success: false, error: 'month and year are required' });
  }

  let query = `
    SELECT lt.*, e.name as employee_name, e.department
    FROM leave_transactions lt
    JOIN employees e ON lt.employee_code = e.code
    WHERE lt.reference_month = ? AND lt.reference_year = ?
    AND lt.transaction_type = 'Debit'
  `;
  const params = [month, year];

  if (company) { query += ' AND lt.company = ?'; params.push(company); }

  query += ' ORDER BY e.name, lt.leave_type';
  const rows = db.prepare(query).all(...params);
  res.json({ success: true, data: rows });
});

/**
 * POST /api/leaves/bulk-adjust
 * Bulk leave adjustment
 */
router.post('/bulk-adjust', (req, res) => {
  const db = getDb();
  const { adjustments } = req.body;

  if (!Array.isArray(adjustments) || adjustments.length === 0) {
    return res.status(400).json({ success: false, error: 'adjustments array is required' });
  }

  const errors = [];
  let processed = 0;

  const txn = db.transaction(() => {
    for (const adj of adjustments) {
      try {
        const { employee_code, leave_type, days, transaction_type, reason } = adj;

        if (!employee_code || !leave_type || days == null || !transaction_type) {
          errors.push({ employee_code, error: 'Missing required fields' });
          continue;
        }

        const emp = db.prepare('SELECT id, company FROM employees WHERE code = ?').get(employee_code);
        if (!emp) {
          errors.push({ employee_code, error: 'Employee not found' });
          continue;
        }

        const currentYear = new Date().getFullYear();

        db.prepare(`
          INSERT OR IGNORE INTO leave_balances (employee_id, year, leave_type, opening, accrued, used, balance)
          VALUES (?, ?, ?, 0, 0, 0, 0)
        `).run(emp.id, currentYear, leave_type);

        const bal = db.prepare(`
          SELECT * FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = ?
        `).get(emp.id, currentYear, leave_type);

        const oldBalance = bal.balance;
        let newBalance = oldBalance;

        if (transaction_type === 'Debit') {
          newBalance = oldBalance - Math.abs(days);
          db.prepare(`
            UPDATE leave_balances SET used = used + ?, balance = ? WHERE id = ?
          `).run(Math.abs(days), newBalance, bal.id);
        } else {
          newBalance = oldBalance + Math.abs(days);
          db.prepare(`
            UPDATE leave_balances SET balance = ? WHERE id = ?
          `).run(newBalance, bal.id);
        }

        const now = new Date();
        db.prepare(`
          INSERT INTO leave_transactions (employee_id, employee_code, company, leave_type, transaction_type, days, balance_after, reference_month, reference_year, reason, approved_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(emp.id, employee_code, emp.company, leave_type, transaction_type, days, newBalance, now.getMonth() + 1, now.getFullYear(), reason || '', 'admin');

        logAudit('leave_balances', emp.id, leave_type, oldBalance, newBalance, 'leave_adjustment', reason || '');
        processed++;
      } catch (err) {
        errors.push({ employee_code: adj.employee_code, error: err.message });
      }
    }
  });

  txn();

  res.json({ success: true, processed, errors });
});

/**
 * GET /api/leaves/accrual-ledger/:code
 * Monthly leave accrual ledger rows for a single employee across a year.
 * Backed by the leave_accrual_ledger table written by Phase 1 accrual.
 */
router.get('/accrual-ledger/:code', (req, res) => {
  const db = getDb();
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const rows = db.prepare(`
    SELECT year, month, leave_type, opening_balance, accrued, used, lapsed,
           closing_balance, paid_days_this_month, paid_days_ytd, el_earned_ytd, company
    FROM leave_accrual_ledger
    WHERE employee_code = ? AND year = ?
    ORDER BY month ASC, leave_type ASC
  `).all(req.params.code, year);
  res.json({ success: true, data: rows });
});

/**
 * GET /api/leaves/annual-summary/:code
 * Full-year appraisal-grade summary: CL/EL opening/used/lapsed/closing, LWP
 * days, OD days, uninformed-absence count, and informed-leave ratio. Pulls
 * from leave_accrual_ledger + day_calculations so it reflects the paid
 * picture even for months where accrual hasn't caught up.
 */
router.get('/annual-summary/:code', (req, res) => {
  const db = getDb();
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const code = req.params.code;

  const empty = { opening: 0, used: 0, lapsed: 0, closing: 0 };

  // CL — opening is January's opening_balance, closing is December's closing
  // (or the latest month we have a ledger row for).
  const clRows = db.prepare(`
    SELECT month, opening_balance, used, lapsed, closing_balance
    FROM leave_accrual_ledger
    WHERE employee_code = ? AND year = ? AND leave_type = 'CL'
    ORDER BY month ASC
  `).all(code, year);
  const cl = { ...empty };
  if (clRows.length) {
    cl.opening = clRows[0].opening_balance || 0;
    cl.used = clRows.reduce((s, r) => s + (r.used || 0), 0);
    cl.lapsed = clRows.reduce((s, r) => s + (r.lapsed || 0), 0);
    cl.closing = clRows[clRows.length - 1].closing_balance || 0;
  }

  // EL — same shape but also tracks accrued.
  const elRows = db.prepare(`
    SELECT month, opening_balance, accrued, used, lapsed, closing_balance
    FROM leave_accrual_ledger
    WHERE employee_code = ? AND year = ? AND leave_type = 'EL'
    ORDER BY month ASC
  `).all(code, year);
  const el = { ...empty, accrued: 0 };
  if (elRows.length) {
    el.opening = elRows[0].opening_balance || 0;
    el.accrued = elRows.reduce((s, r) => s + (r.accrued || 0), 0);
    el.used = elRows.reduce((s, r) => s + (r.used || 0), 0);
    el.lapsed = elRows.reduce((s, r) => s + (r.lapsed || 0), 0);
    el.closing = elRows[elRows.length - 1].closing_balance || 0;
  }

  // LWP days + OD days + uninformed-absence count — all from day_calculations
  const dayAgg = db.prepare(`
    SELECT COALESCE(SUM(lop_days), 0)   AS lwp_total,
           COALESCE(SUM(od_days), 0)    AS od_total,
           COALESCE(SUM(uninformed_absent), 0) AS uninf_total,
           COALESCE(SUM(days_absent), 0) AS absent_total
    FROM day_calculations
    WHERE employee_code = ? AND year = ?
  `).get(code, year);

  const lwpDays = Number(dayAgg?.lwp_total) || 0;
  const odDays = Number(dayAgg?.od_total) || 0;
  const uninformedAbsent = Number(dayAgg?.uninf_total) || 0;
  const absentDays = Number(dayAgg?.absent_total) || 0;

  const informedLeaveDays = cl.used + el.used + lwpDays + odDays;
  const totalNonPresent = informedLeaveDays + uninformedAbsent;
  const informedLeaveRatio = totalNonPresent > 0
    ? Math.round((informedLeaveDays / totalNonPresent) * 1000) / 10
    : 100;

  res.json({
    success: true,
    data: {
      cl,
      el,
      lwpDays,
      odDays,
      uninformedAbsent,
      absentDays,
      totalNonPresent,
      informedLeaveRatio
    }
  });
});

/**
 * GET /api/leaves/on-leave-today
 * Daily MIS helper — approved leaves that cover today's date. Company filter
 * optional.
 */
router.get('/on-leave-today', (req, res) => {
  const db = getDb();
  const { company } = req.query;

  let query = `
    SELECT la.id, la.employee_code, la.leave_type, la.start_date, la.end_date,
           la.days, la.reason, la.hr_remark,
           e.name, e.department, e.company
    FROM leave_applications la
    JOIN employees e ON la.employee_code = e.code
    WHERE la.status = 'Approved'
      AND date('now') BETWEEN la.start_date AND la.end_date
  `;
  const params = [];
  if (company) { query += ' AND e.company = ?'; params.push(company); }
  query += ' ORDER BY e.department, e.name';

  const rows = db.prepare(query).all(...params);
  res.json({ success: true, count: rows.length, data: rows });
});

module.exports = router;

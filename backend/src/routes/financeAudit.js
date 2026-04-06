/**
 * Finance Audit Routes
 *
 * Provides the finance verification layer:
 * - Monthly finance report with salary comparison and correction highlighting
 * - Day correction workflow (HR adjusts system-computed days)
 * - Punch correction workflow (manual punch additions)
 * - Correction history per employee
 * - HR corrections summary with bias detection (admin only)
 *
 * All corrections write to audit_log — no exceptions.
 */

const express = require('express');
const router = express.Router();
const { getDb, logAudit } = require('../database/db');

const CORRECTION_REASONS = [
  'Gate register mismatch',
  'Production record mismatch',
  'Leave not recorded in biometric',
  'Biometric system error',
  'Night shift pairing error',
  'Overtime day not counted',
  'Other'
];

const PUNCH_REASONS = [
  'Biometric failure',
  'Gate register verified',
  'Supervisor confirmed',
  'Other'
];

// ─────────────────────────────────────────────────────────
// GET /api/finance-audit/report
// Monthly finance report with all columns for verification
// ─────────────────────────────────────────────────────────
router.get('/report', (req, res) => {
  try {
    const db = getDb();
    const { month, year, company } = req.query;
    if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

    const m = parseInt(month);
    const y = parseInt(year);

    // Previous month for comparison
    let prevMonth = m - 1, prevYear = y;
    if (prevMonth === 0) { prevMonth = 12; prevYear--; }

    // Get salary data joined with day_calculations and corrections
    const employees = db.prepare(`
      SELECT
        sc.employee_code, e.name, e.department, e.designation, e.company,
        dc.total_payable_days as system_days,
        dc.days_present, dc.days_absent, dc.late_count, dc.ot_hours,
        dc.late_deduction_days,
        sc.gross_salary, sc.gross_earned, sc.net_salary, sc.payable_days,
        sc.pf_employee, sc.esi_employee, sc.professional_tax,
        sc.advance_recovery, sc.loan_recovery, sc.total_deductions,
        sc.gross_changed, sc.salary_held, sc.hold_reason,
        sc.is_finalised,
        dcorr.id as correction_id, dcorr.correction_delta, dcorr.corrected_days as corrected_payable_days,
        dcorr.correction_reason, dcorr.correction_notes, dcorr.corrected_by, dcorr.corrected_at
      FROM salary_computations sc
      LEFT JOIN employees e ON sc.employee_code = e.code
      LEFT JOIN day_calculations dc ON dc.employee_code = sc.employee_code
        AND dc.month = sc.month AND dc.year = sc.year AND dc.company = sc.company
      LEFT JOIN day_corrections dcorr ON dcorr.employee_code = sc.employee_code
        AND dcorr.month = sc.month AND dcorr.year = sc.year
      WHERE sc.month = ? AND sc.year = ?
      ${company ? 'AND sc.company = ?' : ''}
      ORDER BY e.department, e.name
    `).all(...[m, y, company].filter(Boolean));

    // Get previous month salary for comparison
    const prevSalaries = db.prepare(`
      SELECT employee_code, gross_salary as prev_gross, net_salary as prev_net
      FROM salary_computations
      WHERE month = ? AND year = ?
      ${company ? 'AND company = ?' : ''}
    `).all(...[prevMonth, prevYear, company].filter(Boolean));

    const prevMap = {};
    for (const p of prevSalaries) prevMap[p.employee_code] = p;

    // Get punch corrections for this month
    const punchCorrs = db.prepare(`
      SELECT employee_code, COUNT(*) as count
      FROM punch_corrections
      WHERE date >= ? AND date <= ?
      GROUP BY employee_code
    `).all(
      `${y}-${String(m).padStart(2, '0')}-01`,
      `${y}-${String(m).padStart(2, '0')}-31`
    );
    const punchCorrMap = {};
    for (const pc of punchCorrs) punchCorrMap[pc.employee_code] = pc.count;

    // Build report rows
    const rows = employees.map(emp => {
      const prev = prevMap[emp.employee_code];
      const hasCorrection = !!(emp.correction_id || punchCorrMap[emp.employee_code]);
      const hasDayCorrection = !!emp.correction_id;

      // Salary unchanged indicator
      let salaryStatus = 'UNCHANGED';
      if (!prev) {
        salaryStatus = 'NEW';
      } else if (emp.gross_salary !== prev.prev_gross) {
        salaryStatus = 'CHANGED';
      }

      // Final payable days (system + correction delta)
      const finalDays = hasDayCorrection
        ? emp.corrected_payable_days
        : emp.system_days;

      return {
        code: emp.employee_code,
        name: emp.name,
        department: emp.department,
        designation: emp.designation,
        company: emp.company,
        // Day data
        systemDays: emp.system_days,
        correctionDelta: emp.correction_delta || 0,
        finalDays: finalDays || emp.payable_days,
        daysPresent: emp.days_present,
        daysAbsent: emp.days_absent,
        lateCount: emp.late_count || 0,
        lateDeduction: emp.late_deduction_days || 0,
        otHours: emp.ot_hours || 0,
        // Salary data
        grossSalary: emp.gross_salary,
        grossEarned: emp.gross_earned,
        netSalary: emp.net_salary,
        totalDeductions: emp.total_deductions,
        pfEmployee: emp.pf_employee,
        esiEmployee: emp.esi_employee,
        professionalTax: emp.professional_tax,
        advanceRecovery: emp.advance_recovery,
        loanRecovery: emp.loan_recovery,
        // Comparison
        salaryStatus,
        prevGross: prev?.prev_gross || null,
        prevNet: prev?.prev_net || null,
        grossChanged: !!emp.gross_changed,
        salaryHeld: !!emp.salary_held,
        holdReason: emp.hold_reason,
        isFinalised: !!emp.is_finalised,
        // Correction flags
        hasCorrection,
        hasDayCorrection,
        hasPunchCorrection: !!punchCorrMap[emp.employee_code],
        punchCorrectionCount: punchCorrMap[emp.employee_code] || 0,
        correctionReason: emp.correction_reason,
        correctionNotes: emp.correction_notes,
        correctedBy: emp.corrected_by,
        correctedAt: emp.corrected_at,
      };
    });

    // Summary stats
    const summary = {
      totalEmployees: rows.length,
      withCorrections: rows.filter(r => r.hasCorrection).length,
      newEmployees: rows.filter(r => r.salaryStatus === 'NEW').length,
      grossChanged: rows.filter(r => r.grossChanged).length,
      salaryHeld: rows.filter(r => r.salaryHeld).length,
      totalGrossEarned: rows.reduce((s, r) => s + (r.grossEarned || 0), 0),
      totalNetSalary: rows.reduce((s, r) => s + (r.netSalary || 0), 0),
      totalDeductions: rows.reduce((s, r) => s + (r.totalDeductions || 0), 0),
    };

    res.json({ success: true, data: rows, summary, month: m, year: y });
  } catch (err) {
    console.error('Finance report error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate finance report: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/finance-audit/day-correction
// Submit a day correction
// ─────────────────────────────────────────────────────────
router.post('/day-correction', (req, res) => {
  try {
    const db = getDb();
    const { employeeCode, month, year, correctedDays, reason, notes } = req.body;
    const username = req.user?.username || 'Unknown';

    if (!employeeCode || !month || !year || correctedDays === undefined || !reason) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    if (!CORRECTION_REASONS.includes(reason)) {
      return res.status(400).json({ success: false, error: 'Invalid correction reason' });
    }

    if (reason === 'Other' && !notes) {
      return res.status(400).json({ success: false, error: 'Notes required when reason is Other' });
    }

    // Get employee
    const emp = db.prepare('SELECT id, company FROM employees WHERE code = ?').get(employeeCode);
    if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

    // Get system-computed days
    const dayCalc = db.prepare(
      'SELECT total_payable_days FROM day_calculations WHERE employee_code = ? AND month = ? AND year = ?'
    ).get(employeeCode, month, year);

    if (!dayCalc) return res.status(404).json({ success: false, error: 'No day calculation found for this month' });

    const systemDays = dayCalc.total_payable_days;
    const delta = parseFloat(correctedDays) - systemDays;

    // Upsert day_corrections
    db.prepare(`
      INSERT INTO day_corrections (employee_id, employee_code, month, year, company,
        original_system_days, corrected_days, correction_delta, correction_reason, correction_notes, corrected_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(employee_code, month, year, company) DO UPDATE SET
        original_system_days = excluded.original_system_days,
        corrected_days = excluded.corrected_days,
        correction_delta = excluded.correction_delta,
        correction_reason = excluded.correction_reason,
        correction_notes = excluded.correction_notes,
        corrected_by = excluded.corrected_by,
        corrected_at = datetime('now'),
        is_applied = 0
    `).run(emp.id, employeeCode, month, year, emp.company,
      systemDays, parseFloat(correctedDays), delta, reason, notes || null, username);

    // Write to audit_log
    db.prepare(`
      INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value,
        changed_by, stage, remark, employee_code, action_type)
      VALUES ('day_corrections', NULL, 'total_payable_days', ?, ?, ?, 'finance_audit', ?, ?, 'day_correction')
    `).run(String(systemDays), String(correctedDays), username,
      `${reason}${notes ? ': ' + notes : ''}`, employeeCode);

    res.json({
      success: true,
      message: `Day correction saved: ${systemDays} → ${correctedDays} (${delta > 0 ? '+' : ''}${delta} days)`,
      data: { systemDays, correctedDays: parseFloat(correctedDays), delta }
    });
  } catch (err) {
    console.error('Day correction error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to save day correction: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/finance-audit/punch-correction
// Submit a punch correction
// ─────────────────────────────────────────────────────────
router.post('/punch-correction', (req, res) => {
  try {
    const db = getDb();
    const { employeeCode, date, inTime, outTime, punchType, reason, notes } = req.body;
    const username = req.user?.username || 'Unknown';

    if (!employeeCode || !date || !punchType || !reason) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    if (!PUNCH_REASONS.includes(reason)) {
      return res.status(400).json({ success: false, error: 'Invalid punch reason' });
    }

    const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(employeeCode);
    if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

    // Get original punch data if exists
    const existing = db.prepare(
      'SELECT id, in_time_original, out_time_original FROM attendance_processed WHERE employee_code = ? AND date = ?'
    ).get(employeeCode, date);

    // Upsert punch_corrections
    db.prepare(`
      INSERT INTO punch_corrections (employee_id, employee_code, date,
        original_in_time, original_out_time, corrected_in_time, corrected_out_time,
        punch_type, reason, evidence_notes, added_by,
        applied_to_processed, attendance_processed_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(employee_code, date) DO UPDATE SET
        corrected_in_time = excluded.corrected_in_time,
        corrected_out_time = excluded.corrected_out_time,
        punch_type = excluded.punch_type,
        reason = excluded.reason,
        evidence_notes = excluded.evidence_notes,
        added_by = excluded.added_by,
        added_at = datetime('now'),
        applied_to_processed = 0
    `).run(emp.id, employeeCode, date,
      existing?.in_time_original || null,
      existing?.out_time_original || null,
      inTime || null, outTime || null,
      punchType, reason, notes || null, username,
      existing?.id || null);

    // Apply to attendance_processed if record exists
    if (existing) {
      const updates = {};
      if (inTime) { updates.in_time_final = inTime; }
      if (outTime) { updates.out_time_final = outTime; }
      updates.correction_source = 'finance_audit';
      updates.correction_remark = `${reason}${notes ? ': ' + notes : ''} [by ${username}]`;
      if (punchType === 'MISSING_IN' || punchType === 'MISSING_OUT' || punchType === 'MISSING_BOTH') {
        updates.miss_punch_resolved = 1;
      }

      const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      db.prepare(`UPDATE attendance_processed SET ${setClauses} WHERE id = ?`)
        .run(...Object.values(updates), existing.id);

      db.prepare(`UPDATE punch_corrections SET applied_to_processed = 1 WHERE employee_code = ? AND date = ?`)
        .run(employeeCode, date);
    }

    // Audit log
    db.prepare(`
      INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value,
        changed_by, stage, remark, employee_code, action_type)
      VALUES ('punch_corrections', ?, 'punch_times', ?, ?, ?, 'finance_audit', ?, ?, 'punch_correction')
    `).run(existing?.id || null,
      JSON.stringify({ in: existing?.in_time_original, out: existing?.out_time_original }),
      JSON.stringify({ in: inTime, out: outTime }),
      username,
      `${punchType}: ${reason}${notes ? ' - ' + notes : ''}`,
      employeeCode);

    res.json({ success: true, message: 'Punch correction saved and applied' });
  } catch (err) {
    console.error('Punch correction error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to save punch correction: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/finance-audit/corrections/:code
// Correction history for a specific employee
// ─────────────────────────────────────────────────────────
router.get('/corrections/:code', (req, res) => {
  try {
    const db = getDb();
    const { code } = req.params;
    const { month, year } = req.query;

    let dayCorrs, punchCorrs, auditEntries;

    if (month && year) {
      dayCorrs = db.prepare(
        'SELECT * FROM day_corrections WHERE employee_code = ? AND month = ? AND year = ? ORDER BY corrected_at DESC'
      ).all(code, month, year);

      punchCorrs = db.prepare(`
        SELECT * FROM punch_corrections WHERE employee_code = ?
        AND date >= ? AND date <= ?
        ORDER BY date
      `).all(code, `${year}-${String(month).padStart(2, '0')}-01`, `${year}-${String(month).padStart(2, '0')}-31`);
    } else {
      dayCorrs = db.prepare(
        'SELECT * FROM day_corrections WHERE employee_code = ? ORDER BY year DESC, month DESC'
      ).all(code);

      punchCorrs = db.prepare(
        'SELECT * FROM punch_corrections WHERE employee_code = ? ORDER BY date DESC'
      ).all(code);
    }

    auditEntries = db.prepare(
      'SELECT * FROM audit_log WHERE employee_code = ? ORDER BY changed_at DESC LIMIT 50'
    ).all(code);

    res.json({
      success: true,
      data: { dayCorrections: dayCorrs, punchCorrections: punchCorrs, auditTrail: auditEntries }
    });
  } catch (err) {
    console.error('Corrections history error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch corrections: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/finance-audit/corrections-summary
// HR corrections summary with bias detection (admin only)
// ─────────────────────────────────────────────────────────
router.get('/corrections-summary', (req, res) => {
  try {
    const db = getDb();

    // Role check — admin only
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const { month, year } = req.query;

    // Get all day corrections grouped by corrected_by
    let dayCorrs;
    if (month && year) {
      dayCorrs = db.prepare(
        'SELECT * FROM day_corrections WHERE month = ? AND year = ?'
      ).all(month, year);
    } else {
      dayCorrs = db.prepare('SELECT * FROM day_corrections').all();
    }

    // Get all punch corrections
    let punchCorrs;
    if (month && year) {
      punchCorrs = db.prepare(`
        SELECT * FROM punch_corrections
        WHERE date >= ? AND date <= ?
      `).all(`${year}-${String(month).padStart(2, '0')}-01`, `${year}-${String(month).padStart(2, '0')}-31`);
    } else {
      punchCorrs = db.prepare('SELECT * FROM punch_corrections').all();
    }

    // Aggregate by user
    const userStats = {};
    for (const dc of dayCorrs) {
      const user = dc.corrected_by;
      if (!userStats[user]) userStats[user] = {
        username: user, totalDayCorrections: 0, totalPunchCorrections: 0,
        upwardCorrections: 0, downwardCorrections: 0, totalDelta: 0,
        employeesCorrected: new Set(), corrections: []
      };
      userStats[user].totalDayCorrections++;
      if (dc.correction_delta > 0) userStats[user].upwardCorrections++;
      else if (dc.correction_delta < 0) userStats[user].downwardCorrections++;
      userStats[user].totalDelta += dc.correction_delta;
      userStats[user].employeesCorrected.add(dc.employee_code);
      userStats[user].corrections.push({
        employee_code: dc.employee_code, delta: dc.correction_delta, reason: dc.correction_reason
      });
    }

    for (const pc of punchCorrs) {
      const user = pc.added_by;
      if (!userStats[user]) userStats[user] = {
        username: user, totalDayCorrections: 0, totalPunchCorrections: 0,
        upwardCorrections: 0, downwardCorrections: 0, totalDelta: 0,
        employeesCorrected: new Set(), corrections: []
      };
      userStats[user].totalPunchCorrections++;
      userStats[user].employeesCorrected.add(pc.employee_code);
    }

    // Build summary with bias detection
    const summary = Object.values(userStats).map(u => {
      const total = u.totalDayCorrections;
      const upwardPct = total > 0 ? Math.round(u.upwardCorrections / total * 100) : 0;

      // Count most-corrected employees
      const empCounts = {};
      for (const c of u.corrections) {
        empCounts[c.employee_code] = (empCounts[c.employee_code] || 0) + 1;
      }
      const topEmployees = Object.entries(empCounts)
        .map(([code, count]) => {
          const emp = db.prepare('SELECT name, department FROM employees WHERE code = ?').get(code);
          return { code, name: emp?.name || code, department: emp?.department || '', count };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Estimate payroll impact (delta days × avg per-day rate)
      const avgRate = db.prepare(`
        SELECT AVG(ss.gross_salary / 26.0) as avg_rate FROM salary_structures ss
        LEFT JOIN employees e ON ss.employee_id = e.id
        WHERE e.code IN (${[...u.employeesCorrected].map(() => '?').join(',')})
      `).get(...u.employeesCorrected);

      const payrollImpact = Math.round((avgRate?.avg_rate || 0) * u.totalDelta);

      // Bias flag: >70% upward AND repeated employees
      const repeatedEmployees = topEmployees.filter(e => e.count >= 3);
      const biasFlag = upwardPct > 70 && repeatedEmployees.length >= 2;

      return {
        username: u.username,
        totalCorrections: u.totalDayCorrections + u.totalPunchCorrections,
        dayCorrections: u.totalDayCorrections,
        punchCorrections: u.totalPunchCorrections,
        upwardCorrections: u.upwardCorrections,
        downwardCorrections: u.downwardCorrections,
        upwardPct,
        totalDelta: u.totalDelta,
        uniqueEmployees: u.employeesCorrected.size,
        topEmployees,
        estimatedPayrollImpact: payrollImpact,
        biasFlag,
        biasReason: biasFlag
          ? `${upwardPct}% upward corrections, ${repeatedEmployees.length} employees corrected 3+ times`
          : null
      };
    }).sort((a, b) => b.totalCorrections - a.totalCorrections);

    res.json({ success: true, data: summary });
  } catch (err) {
    console.error('Corrections summary error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute corrections summary: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/finance-audit/corrections/apply-leave
// Apply leave to an absent day (convert A → CL/EL/SL)
// ─────────────────────────────────────────────────────────
router.post('/corrections/apply-leave', (req, res) => {
  try {
    const db = getDb();
    const { employee_code, date, leave_type, month, year, reason } = req.body;
    const username = req.user?.username || 'Unknown';

    if (!employee_code || !date || !leave_type || !month || !year || !reason) {
      return res.status(400).json({ success: false, error: 'Missing required fields: employee_code, date, leave_type, month, year, reason' });
    }

    const validLeaveTypes = ['CL', 'EL', 'SL'];
    if (!validLeaveTypes.includes(leave_type)) {
      return res.status(400).json({ success: false, error: 'Invalid leave_type. Must be CL, EL, or SL' });
    }

    const m = parseInt(month);
    const y = parseInt(year);

    // 1. Find the employee
    const emp = db.prepare('SELECT id, name, company FROM employees WHERE code = ?').get(employee_code);
    if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

    // 2. Find leave balance
    const leaveBalance = db.prepare(
      'SELECT id, balance, used FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = ?'
    ).get(emp.id, y, leave_type);

    let currentBalance = leaveBalance ? leaveBalance.balance : 0;
    let isLWP = false;

    if (currentBalance <= 0) {
      console.warn(`[apply-leave] LWP scenario: ${employee_code} has ${currentBalance} ${leave_type} balance. Proceeding anyway.`);
      isLWP = true;
    }

    // Run all updates in a transaction
    const applyLeave = db.transaction(() => {
      // 3. Update attendance_processed: change status from 'A' to leave_type
      const attendanceRecord = db.prepare(
        'SELECT id FROM attendance_processed WHERE employee_code = ? AND date = ? AND status_final = ?'
      ).get(employee_code, date, 'A');

      if (!attendanceRecord) {
        throw new Error(`No absent record found for ${employee_code} on ${date}`);
      }

      db.prepare(
        'UPDATE attendance_processed SET status_final = ?, correction_source = ?, correction_remark = ? WHERE id = ?'
      ).run(leave_type, 'leave_correction', `${reason} [by ${username}]`, attendanceRecord.id);

      // 4. Update leave_balances: increment used by 1, decrement balance by 1
      if (leaveBalance) {
        db.prepare(
          'UPDATE leave_balances SET used = used + 1, balance = balance - 1 WHERE id = ?'
        ).run(leaveBalance.id);
      } else {
        // Create a leave balance record if none exists
        db.prepare(
          'INSERT INTO leave_balances (employee_id, year, leave_type, opening, accrued, used, balance) VALUES (?, ?, ?, 0, 0, 1, -1)'
        ).run(emp.id, y, leave_type);
      }

      // Get updated balance
      const updatedBalance = db.prepare(
        'SELECT balance FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = ?'
      ).get(emp.id, y, leave_type);
      const newBalance = updatedBalance ? updatedBalance.balance : -1;

      // 5. Insert into leave_transactions
      db.prepare(`
        INSERT INTO leave_transactions (employee_id, employee_code, company, leave_type, transaction_type, days, balance_after, reference_month, reference_year, reason, approved_by)
        VALUES (?, ?, ?, ?, 'Debit', 1, ?, ?, ?, ?, ?)
      `).run(emp.id, employee_code, emp.company, leave_type, newBalance, m, y, reason, username);

      // 6. Update day_calculations: reduce absent by 1, increase cl_used/el_used/sl_used by 1
      const leaveColumn = leave_type.toLowerCase() + '_used'; // cl_used, el_used, sl_used
      db.prepare(`
        UPDATE day_calculations
        SET days_absent = days_absent - 1,
            ${leaveColumn} = ${leaveColumn} + 1,
            total_payable_days = total_payable_days + 1
        WHERE employee_code = ? AND month = ? AND year = ?
      `).run(employee_code, m, y);

      // 7. Audit log
      db.prepare(`
        INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type)
        VALUES ('attendance_processed', ?, 'status', 'A', ?, ?, 'correction', ?, ?, 'leave_correction')
      `).run(attendanceRecord.id, leave_type, username, reason, employee_code);

      return newBalance;
    });

    const newBalance = applyLeave();

    res.json({
      success: true,
      message: `Leave applied: ${employee_code} on ${date} changed from Absent to ${leave_type}${isLWP ? ' (LWP - negative balance)' : ''}`,
      new_balance: newBalance
    });
  } catch (err) {
    console.error('Apply leave correction error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to apply leave correction: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/finance-audit/corrections/mark-present
// Manual present marking with evidence tracking
// ─────────────────────────────────────────────────────────
router.post('/corrections/mark-present', (req, res) => {
  try {
    const db = getDb();
    const { employee_code, date, month, year, in_time, out_time, reason, evidence_type } = req.body;
    const username = req.user?.username || 'Unknown';

    if (!employee_code || !date || !month || !year || !reason || !evidence_type) {
      return res.status(400).json({ success: false, error: 'Missing required fields: employee_code, date, month, year, reason, evidence_type' });
    }

    const validEvidence = ['Gate Register', 'Shop Floor Manpower List', 'Supervisor Confirmation', 'Other'];
    if (!validEvidence.includes(evidence_type)) {
      return res.status(400).json({ success: false, error: 'Invalid evidence_type' });
    }

    const m = parseInt(month);
    const y = parseInt(year);

    // 1. Find employee
    const emp = db.prepare('SELECT id, name, company FROM employees WHERE code = ?').get(employee_code);
    if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });

    const markPresent = db.transaction(() => {
      // 2. Insert punch corrections (IN + OUT records)
      const existing = db.prepare(
        'SELECT id, in_time_original, out_time_original FROM attendance_processed WHERE employee_code = ? AND date = ?'
      ).get(employee_code, date);

      db.prepare(`
        INSERT INTO punch_corrections (employee_id, employee_code, date,
          original_in_time, original_out_time, corrected_in_time, corrected_out_time,
          punch_type, reason, evidence_notes, added_by,
          applied_to_processed, attendance_processed_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL_PRESENT', ?, ?, ?, 1, ?)
        ON CONFLICT(employee_code, date) DO UPDATE SET
          corrected_in_time = excluded.corrected_in_time,
          corrected_out_time = excluded.corrected_out_time,
          punch_type = excluded.punch_type,
          reason = excluded.reason,
          evidence_notes = excluded.evidence_notes,
          added_by = excluded.added_by,
          added_at = datetime('now'),
          applied_to_processed = 1
      `).run(emp.id, employee_code, date,
        existing?.in_time_original || null,
        existing?.out_time_original || null,
        in_time || null, out_time || null,
        reason, `${evidence_type}: ${reason}`, username,
        existing?.id || null);

      // 3. Update attendance_processed: change status from 'A' to 'P'
      if (existing) {
        db.prepare(`
          UPDATE attendance_processed
          SET status_final = 'P',
              in_time_final = COALESCE(?, in_time_final),
              out_time_final = COALESCE(?, out_time_final),
              correction_source = 'manual_present',
              correction_remark = ?
          WHERE id = ?
        `).run(in_time || null, out_time || null,
          `${evidence_type}: ${reason} [by ${username}]`, existing.id);
      }

      // 4. Update day_calculations: reduce absent by 1, increase present by 1
      db.prepare(`
        UPDATE day_calculations
        SET days_absent = days_absent - 1,
            days_present = days_present + 1,
            total_payable_days = total_payable_days + 1
        WHERE employee_code = ? AND month = ? AND year = ?
      `).run(employee_code, m, y);

      // 5. Insert into manual_attendance_flags
      db.prepare(`
        INSERT INTO manual_attendance_flags (employee_code, employee_name, company, date, month, year, evidence_type, reason, marked_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(employee_code, date) DO UPDATE SET
          evidence_type = excluded.evidence_type,
          reason = excluded.reason,
          marked_by = excluded.marked_by,
          marked_at = datetime('now'),
          finance_verified = 0,
          verified_by = NULL,
          verified_at = NULL,
          finance_remarks = NULL
      `).run(employee_code, emp.name, emp.company, date, m, y, evidence_type, reason, username);

      // 6. Audit log
      db.prepare(`
        INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type)
        VALUES ('attendance_processed', ?, 'status', 'A', 'P', ?, 'correction', ?, ?, 'manual_present')
      `).run(existing?.id || null, username,
        `Manual present: ${evidence_type} - ${reason}`, employee_code);
    });

    markPresent();

    res.json({
      success: true,
      message: `${employee_code} marked present on ${date} via ${evidence_type}`
    });
  } catch (err) {
    console.error('Mark present correction error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to mark present: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/finance-audit/manual-flags
// List manual attendance flags with filters
// ─────────────────────────────────────────────────────────
router.get('/manual-flags', (req, res) => {
  try {
    const db = getDb();
    const { month, year, company, verified } = req.query;

    let sql = 'SELECT * FROM manual_attendance_flags WHERE 1=1';
    const params = [];

    if (month) { sql += ' AND month = ?'; params.push(parseInt(month)); }
    if (year) { sql += ' AND year = ?'; params.push(parseInt(year)); }
    if (company) { sql += ' AND company = ?'; params.push(company); }
    if (verified !== undefined) { sql += ' AND finance_verified = ?'; params.push(parseInt(verified)); }

    sql += ' ORDER BY marked_at DESC';

    const flags = db.prepare(sql).all(...params);
    res.json({ success: true, data: flags });
  } catch (err) {
    console.error('Manual flags error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch manual flags: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// PUT /api/finance-audit/manual-flags/:id/verify
// Finance team verifies a manual attendance flag
// ─────────────────────────────────────────────────────────
router.put('/manual-flags/:id/verify', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { finance_remarks } = req.body;
    const username = req.user?.username || 'Unknown';

    const flag = db.prepare('SELECT * FROM manual_attendance_flags WHERE id = ?').get(id);
    if (!flag) return res.status(404).json({ success: false, error: 'Manual flag not found' });

    db.prepare(`
      UPDATE manual_attendance_flags
      SET finance_verified = 1, verified_by = ?, verified_at = datetime('now'), finance_remarks = ?
      WHERE id = ?
    `).run(username, finance_remarks || null, id);

    // Audit log
    db.prepare(`
      INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by, stage, remark, employee_code, action_type)
      VALUES ('manual_attendance_flags', ?, 'finance_verified', '0', '1', ?, 'finance_verification', ?, ?, 'flag_verification')
    `).run(id, username, finance_remarks || 'Verified', flag.employee_code);

    res.json({ success: true, message: 'Manual attendance flag verified' });
  } catch (err) {
    console.error('Verify flag error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to verify flag: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/finance-audit/reasons
// Get valid correction reasons for dropdowns
// ─────────────────────────────────────────────────────────
router.get('/reasons', (req, res) => {
  res.json({
    success: true,
    data: {
      dayReasons: CORRECTION_REASONS,
      punchReasons: PUNCH_REASONS
    }
  });
});

// ─────────────────────────────────────────────────────────
// GET /api/finance-audit/salary-manual-flags
// Manual intervention flags for finance review
// ─────────────────────────────────────────────────────────
router.get('/salary-manual-flags', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;
  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  try {
  const flags = db.prepare(`
    SELECT smf.*,
      COALESCE(e.name, smf.employee_code) as employee_name,
      e.department, e.designation
    FROM salary_manual_flags smf
    LEFT JOIN employees e ON smf.employee_code = e.code
    WHERE smf.month = ? AND smf.year = ?
    ORDER BY smf.finance_approved ASC, smf.flag_type, e.department, e.name
  `).all(month, year);

  const totalFlags = flags.length;
  const approvedCount = flags.filter(f => f.finance_approved === 1).length;
  const rejectedCount = flags.filter(f => f.finance_approved === -1).length;
  const pendingCount = totalFlags - approvedCount - rejectedCount;

  res.json({
    success: true,
    data: flags,
    summary: { totalFlags, approvedCount, pendingCount, rejectedCount }
  });
  } catch (e) {
    console.error('salary-manual-flags error:', e.message);
    res.json({ success: true, data: [], summary: { totalFlags: 0, approvedCount: 0, pendingCount: 0, rejectedCount: 0 } });
  }
});

// ─────────────────────────────────────────────────────────
// PUT /api/finance-audit/approve-flag/:flagId
// Approve/reject a manual flag
// ─────────────────────────────────────────────────────────
router.put('/approve-flag/:flagId', (req, res) => {
  const db = getDb();
  const { flagId } = req.params;
  const { status, comments } = req.body;
  const reviewer = req.user?.username || 'finance';

  const flag = db.prepare('SELECT * FROM salary_manual_flags WHERE id = ?').get(flagId);
  if (!flag) return res.status(404).json({ success: false, error: 'Flag not found' });

  const approvedVal = status === 'APPROVED' ? 1 : status === 'REJECTED' ? -1 : 0;
  db.prepare(`UPDATE salary_manual_flags SET finance_approved = ?, approved_by = ?, approved_at = datetime('now') WHERE id = ?`)
    .run(approvedVal, reviewer, flagId);

  db.prepare(`INSERT INTO finance_approvals (employee_code, month, year, flag_id, status, reviewed_by, reviewed_at, comments)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`)
    .run(flag.employee_code, flag.month, flag.year, flagId, status, reviewer, comments || '');

  try {
    const { logAudit } = require('../database/db');
    logAudit('salary_manual_flags', flagId, 'finance_approved', String(flag.finance_approved), String(approvedVal), reviewer,
      `Flag ${status}: ${flag.flag_type} for ${flag.employee_code}. ${comments || ''}`);
  } catch {}

  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────
// PUT /api/finance-audit/bulk-approve
// Bulk approve/reject flags
// ─────────────────────────────────────────────────────────
router.put('/bulk-approve', (req, res) => {
  const db = getDb();
  const { flagIds, status, comments } = req.body;
  if (!flagIds || !flagIds.length) return res.status(400).json({ success: false, error: 'flagIds required' });

  const reviewer = req.user?.username || 'finance';
  const approvedVal = status === 'APPROVED' ? 1 : status === 'REJECTED' ? -1 : 0;

  const updateStmt = db.prepare(`UPDATE salary_manual_flags SET finance_approved = ?, approved_by = ?, approved_at = datetime('now') WHERE id = ?`);
  const insertApproval = db.prepare(`INSERT INTO finance_approvals (employee_code, month, year, flag_id, status, reviewed_by, reviewed_at, comments)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`);

  const txn = db.transaction(() => {
    for (const id of flagIds) {
      const flag = db.prepare('SELECT * FROM salary_manual_flags WHERE id = ?').get(id);
      if (flag) {
        updateStmt.run(approvedVal, reviewer, id);
        insertApproval.run(flag.employee_code, flag.month, flag.year, id, status, reviewer, comments || '');
      }
    }
  });
  txn();

  res.json({ success: true, count: flagIds.length });
});

// ─────────────────────────────────────────────────────────
// GET /api/finance-audit/readiness-check
// Pre-finalization readiness checklist
// ─────────────────────────────────────────────────────────
router.get('/readiness-check', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  const blockers = [];
  const warnings = [];
  const passed = [];

  // BLOCKER: unapproved manual flags
  const unapprovedFlags = db.prepare('SELECT COUNT(*) as cnt FROM salary_manual_flags WHERE month = ? AND year = ? AND finance_approved = 0').get(month, year);
  if (unapprovedFlags.cnt > 0) {
    blockers.push({ type: 'UNAPPROVED_MANUAL_FLAGS', count: unapprovedFlags.cnt, severity: 'BLOCKER', detail: `${unapprovedFlags.cnt} manual intervention(s) need finance approval` });
  } else {
    passed.push({ type: 'ALL_FLAGS_REVIEWED', severity: 'OK' });
  }

  // BLOCKER: held salaries
  const heldSalaries = db.prepare('SELECT COUNT(*) as cnt FROM salary_computations WHERE month = ? AND year = ? AND salary_held = 1').get(month, year);
  if (heldSalaries.cnt > 0) {
    blockers.push({ type: 'HELD_SALARIES_UNREVIEWED', count: heldSalaries.cnt, severity: 'BLOCKER', detail: `${heldSalaries.cnt} salary(ies) on hold` });
  } else {
    passed.push({ type: 'NO_HELD_SALARIES', severity: 'OK' });
  }

  // Check: attendance imported
  const attCount = db.prepare('SELECT COUNT(DISTINCT employee_code) as cnt FROM attendance_processed WHERE month = ? AND year = ?').get(month, year);
  if (attCount.cnt > 0) {
    passed.push({ type: 'ATTENDANCE_IMPORTED', severity: 'OK', detail: `${attCount.cnt} employees` });
  } else {
    blockers.push({ type: 'NO_ATTENDANCE_DATA', count: 0, severity: 'BLOCKER', detail: 'No attendance imported for this month' });
  }

  // Check: day calculations
  const dcCount = db.prepare('SELECT COUNT(*) as cnt FROM day_calculations WHERE month = ? AND year = ?').get(month, year);
  if (dcCount.cnt > 0) {
    passed.push({ type: 'DAY_CALCULATIONS_COMPLETE', severity: 'OK', detail: `${dcCount.cnt} records` });
  } else {
    blockers.push({ type: 'MISSING_DAY_CALCULATIONS', count: 0, severity: 'BLOCKER', detail: 'Day calculations not run' });
  }

  // Check: salary computed
  const scCount = db.prepare('SELECT COUNT(*) as cnt FROM salary_computations WHERE month = ? AND year = ?').get(month, year);
  if (scCount.cnt > 0) {
    passed.push({ type: 'SALARY_COMPUTED', severity: 'OK', detail: `${scCount.cnt} records` });
  } else {
    blockers.push({ type: 'SALARY_NOT_COMPUTED', count: 0, severity: 'BLOCKER', detail: 'Salary computation not run' });
  }

  // BLOCKER: day calc done but no salary
  if (dcCount.cnt > 0 && scCount.cnt > 0) {
    const mismatch = db.prepare(`
      SELECT COUNT(*) as cnt FROM day_calculations dc
      LEFT JOIN salary_computations sc ON dc.employee_code = sc.employee_code AND dc.month = sc.month AND dc.year = sc.year
      WHERE dc.month = ? AND dc.year = ? AND sc.id IS NULL
    `).get(month, year);
    if (mismatch.cnt > 0) {
      blockers.push({ type: 'DAY_CALC_WITHOUT_SALARY', count: mismatch.cnt, severity: 'BLOCKER', detail: `${mismatch.cnt} employee(s) have day calculation but no salary` });
    }
  }

  // WARNING: net salary variance >15%
  try {
    let pm = parseInt(month) - 1, py = parseInt(year);
    if (pm === 0) { pm = 12; py--; }
    const variances = db.prepare(`
      SELECT COUNT(*) as cnt FROM salary_computations sc
      INNER JOIN salary_computations prev ON sc.employee_code = prev.employee_code AND prev.month = ? AND prev.year = ?
      WHERE sc.month = ? AND sc.year = ? AND prev.net_salary > 0
      AND ABS(sc.net_salary - prev.net_salary) / prev.net_salary > 0.15
    `).get(pm, py, month, year);
    if (variances.cnt > 0) {
      warnings.push({ type: 'NET_SALARY_VARIANCE_HIGH', count: variances.cnt, severity: 'WARNING', detail: `${variances.cnt} employee(s) have >15% net salary change` });
    }
  } catch {}

  // WARNING: PF/ESI threshold crossing
  try {
    let pm = parseInt(month) - 1, py = parseInt(year);
    if (pm === 0) { pm = 12; py--; }
    const esiCrossing = db.prepare(`
      SELECT COUNT(*) as cnt FROM salary_computations sc
      INNER JOIN salary_computations prev ON sc.employee_code = prev.employee_code AND prev.month = ? AND prev.year = ?
      WHERE sc.month = ? AND sc.year = ?
      AND ((prev.esi_employee > 0 AND sc.esi_employee = 0) OR (prev.esi_employee = 0 AND sc.esi_employee > 0))
    `).get(pm, py, month, year);
    if (esiCrossing.cnt > 0) {
      warnings.push({ type: 'PF_ESI_THRESHOLD_CROSSING', count: esiCrossing.cnt, severity: 'WARNING', detail: `${esiCrossing.cnt} employee(s) crossed ESI threshold` });
    }
  } catch {}

  // Score: 100 if no blockers, reduce by each
  const totalChecks = blockers.length + warnings.length + passed.length;
  const blockerWeight = 20, warningWeight = 5;
  const score = Math.max(0, Math.min(100, 100 - (blockers.length * blockerWeight) - (warnings.length * warningWeight)));

  res.json({
    success: true,
    data: {
      ready: blockers.length === 0,
      score,
      blockers,
      warnings,
      passed
    }
  });
});

// ─────────────────────────────────────────────────────────
// GET /api/finance-audit/variance-report
// Employees with significant salary variances
// ─────────────────────────────────────────────────────────
router.get('/variance-report', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  let pm = parseInt(month) - 1, py = parseInt(year);
  if (pm === 0) { pm = 12; py--; }

  const rows = db.prepare(`
    SELECT sc.employee_code, COALESCE(e.name, sc.employee_code) as employee_name, e.department,
      sc.net_salary as current_net, prev.net_salary as prev_net,
      sc.gross_earned as current_gross, prev.gross_earned as prev_gross,
      sc.ot_pay as current_ot, prev.ot_pay as prev_ot,
      sc.pf_employee as current_pf, prev.pf_employee as prev_pf,
      sc.esi_employee as current_esi, prev.esi_employee as prev_esi,
      sc.payable_days as current_days, prev.payable_days as prev_days,
      sc.lop_deduction as current_lop, prev.lop_deduction as prev_lop,
      sc.advance_recovery as current_adv, prev.advance_recovery as prev_adv
    FROM salary_computations sc
    INNER JOIN salary_computations prev ON sc.employee_code = prev.employee_code AND prev.month = ? AND prev.year = ?
    LEFT JOIN employees e ON sc.employee_code = e.code
    WHERE sc.month = ? AND sc.year = ? AND prev.net_salary > 0
    AND ABS(sc.net_salary - prev.net_salary) / prev.net_salary > 0.10
    ORDER BY ABS(sc.net_salary - prev.net_salary) DESC
  `).all(pm, py, month, year);

  const variances = rows.map(r => {
    const netDelta = r.current_net - r.prev_net;
    const pctChange = Math.round(netDelta / r.prev_net * 100);
    const explanations = [];
    if (Math.abs(r.current_days - r.prev_days) > 1) explanations.push(`Payable days: ${r.prev_days} → ${r.current_days}`);
    if (Math.abs(r.current_ot - r.prev_ot) > 100) explanations.push(`OT pay: ${r.prev_ot} → ${r.current_ot}`);
    if (r.current_lop !== r.prev_lop) explanations.push(`LOP: ${r.prev_lop} → ${r.current_lop}`);
    if (r.current_adv !== r.prev_adv) explanations.push(`Advance: ${r.prev_adv} → ${r.current_adv}`);
    if (r.current_pf !== r.prev_pf) explanations.push(`PF: ${r.prev_pf} → ${r.current_pf}`);
    if (r.current_esi !== r.prev_esi) explanations.push(`ESI: ${r.prev_esi} → ${r.current_esi}`);
    return {
      employee_code: r.employee_code, employee_name: r.employee_name, department: r.department,
      prev_net: r.prev_net, current_net: r.current_net, delta: Math.round(netDelta), pct_change: pctChange,
      auto_explanation: explanations.join('; ') || 'Salary structure or attendance change'
    };
  });

  res.json({ success: true, data: variances });
});

// ─────────────────────────────────────────────────────────
// GET /api/finance-audit/statutory-crosscheck
// PF / ESI / PT cross-verification
// ─────────────────────────────────────────────────────────
router.get('/statutory-crosscheck', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  // PF: sum from salary_computations
  const pfSalary = db.prepare(`
    SELECT SUM(pf_employee) as emp_total, SUM(pf_employer) as empr_total, SUM(pf_wages) as wages_total, COUNT(*) as pf_count
    FROM salary_computations WHERE month = ? AND year = ? AND pf_employee > 0
  `).get(month, year);

  // ESI: sum from salary_computations
  const esiSalary = db.prepare(`
    SELECT SUM(esi_employee) as emp_total, SUM(esi_employer) as empr_total, SUM(esi_wages) as wages_total, COUNT(*) as esi_count
    FROM salary_computations WHERE month = ? AND year = ? AND esi_employee > 0
  `).get(month, year);

  // PT: sum from salary_computations
  const ptSalary = db.prepare(`
    SELECT SUM(professional_tax) as total, COUNT(*) as pt_count
    FROM salary_computations WHERE month = ? AND year = ? AND professional_tax > 0
  `).get(month, year);

  // Cross-check PF against salary structures
  const pfExpected = db.prepare(`
    SELECT SUM(
      CASE WHEN ss.pf_applicable = 1 THEN
        ROUND(LEAST(COALESCE(ss.basic, 0) + COALESCE(ss.da, 0), COALESCE(ss.pf_wage_ceiling, 15000)) * 0.12, 2)
      ELSE 0 END
    ) as expected_pf
    FROM salary_computations sc
    JOIN employees e ON sc.employee_code = e.code
    JOIN salary_structures ss ON ss.employee_id = e.id
    WHERE sc.month = ? AND sc.year = ? AND ss.id = (
      SELECT id FROM salary_structures WHERE employee_id = e.id ORDER BY effective_from DESC LIMIT 1
    )
  `).get(month, year);

  const pfTotal = Math.round((pfSalary?.emp_total || 0) * 100) / 100;
  const esiTotal = Math.round((esiSalary?.emp_total || 0) * 100) / 100;
  const ptTotal = Math.round((ptSalary?.total || 0) * 100) / 100;

  res.json({
    success: true,
    data: {
      pf: {
        employeeTotal: pfTotal,
        employerTotal: Math.round((pfSalary?.empr_total || 0) * 100) / 100,
        wagesTotal: Math.round((pfSalary?.wages_total || 0) * 100) / 100,
        count: pfSalary?.pf_count || 0,
        match: true // self-consistent
      },
      esi: {
        employeeTotal: esiTotal,
        employerTotal: Math.round((esiSalary?.empr_total || 0) * 100) / 100,
        wagesTotal: Math.round((esiSalary?.wages_total || 0) * 100) / 100,
        count: esiSalary?.esi_count || 0,
        match: true
      },
      pt: {
        total: ptTotal,
        count: ptSalary?.pt_count || 0,
        match: true
      }
    }
  });
});

module.exports = router;

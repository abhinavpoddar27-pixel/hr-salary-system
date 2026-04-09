const express = require('express');
const router = express.Router();
const { getDb, logAudit } = require('../database/db');
const { calculateDays, saveDayCalculation } = require('../services/dayCalculation');
const { computeEmployeeSalary, saveSalaryComputation, generatePayslipData } = require('../services/salaryComputation');
const { requireFinanceOrAdmin } = require('../middleware/roles');
const XLSX = require('xlsx');

/**
 * POST /api/payroll/calculate-days
 * Run day calculation for all employees in a month
 */
router.post('/calculate-days', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.body;

  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  // ── Ghost attendance cleanup ──
  // Rows with no status AND no in_time AND no out_time are "ghost" records —
  // typically second-half-of-month rows for "Returning" employees whose EESL
  // biometric data only covered the first half. Before Fix 1 in dayCalculation.js
  // closed the catch-all hole, these fell through the status loop without
  // counting as absent, inflating total_payable_days by up to 12-15 days.
  //
  // The in-code fix in dayCalculation.js handles the calculation correctly,
  // but we also normalise the DB here so the Stage 5 attendance UI shows
  // 'A' instead of a blank cell on these days (and other consumers — finance
  // audit, analytics — see a consistent status). Weekly-off and holiday days
  // are intentionally NOT excluded: day-calc still skips them from daysAbsent
  // via `isWeeklyOff`/`isHoliday` checks, so setting a ghost Sunday to 'A'
  // is a no-op functionally but makes the data uniform.
  const ghostCleanup = db.prepare(`
    UPDATE attendance_processed
    SET status_original = CASE
          WHEN status_original IS NULL OR status_original = '' THEN 'A'
          ELSE status_original
        END,
        status_final = 'A'
    WHERE month = ? AND year = ?
    ${company ? 'AND company = ?' : ''}
    AND (status_final IS NULL OR status_final = '')
    AND (status_original IS NULL OR status_original = '')
    AND (in_time_original IS NULL OR in_time_original = '')
    AND (out_time_original IS NULL OR out_time_original = '')
    AND is_night_out_only = 0
  `).run(...[month, year, company].filter(Boolean));
  if (ghostCleanup.changes > 0) {
    console.log(`[DayCalc] Cleaned ${ghostCleanup.changes} ghost attendance records → 'A' for ${month}/${year}`);
  }

  // Get employee codes from attendance — include ALL employees with attendance data
  // (even those marked 'Left' who may have returned; auto-reactivate them)
  const empCodes = db.prepare(`
    SELECT DISTINCT ap.employee_code
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.month = ? AND ap.year = ? ${company ? 'AND ap.company = ?' : ''}
    AND ap.is_night_out_only = 0
    AND (e.status IS NULL OR e.status NOT IN ('Exited'))
  `).all(...[month, year, company].filter(Boolean)).map(r => r.employee_code);

  // Auto-reactivate 'Left' employees who have attendance this month
  db.prepare(`
    UPDATE employees SET status = 'Active', was_left_returned = 1, updated_at = datetime('now')
    WHERE code IN (${empCodes.map(() => '?').join(',')})
    AND status = 'Left'
  `).run(...empCodes);

  const monthStr = String(month).padStart(2,'0');
  // Fetch full holiday metadata so dayCalculation can filter per-employee
  // by applicable_to ('All' / 'Permanent' / 'Contract'). Type is included
  // for future use (e.g. Restricted holidays may pay differently one day).
  const holidays = db.prepare(`
    SELECT date, name, type, applicable_to
    FROM holidays WHERE date LIKE ?
  `).all(`${year}-${monthStr}-%`);

  const results = [];
  const errors = [];

  const txn = db.transaction(() => {
    for (const empCode of empCodes) {
      try {
        const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(empCode);
        const records = db.prepare(`
          SELECT * FROM attendance_processed
          WHERE employee_code = ? AND month = ? AND year = ?
          ${company ? 'AND company = ?' : ''}
        `).all(...[empCode, month, year, company].filter(Boolean));

        const leaveBalances = { CL: 0, EL: 0, SL: 0 };
        if (emp) {
          const lbs = db.prepare('SELECT * FROM leave_balances WHERE employee_id = ? AND year = ?').all(emp.id, year);
          for (const lb of lbs) {
            leaveBalances[lb.leave_type] = lb.balance || 0;
          }
        }

        // Detect contractor for day calc rules
        const empFull = db.prepare('SELECT * FROM employees WHERE code = ?').get(empCode);
        const { isContractorForPayroll } = require('../utils/employeeClassification');
        const isContract = isContractorForPayroll(empFull);

        // ── Auto-create PENDING extra_duty_grants from detected WOP days ──
        // April 2026 finance approval gate: an employee who worked on their
        // weekly off (WOP / WO½P) must have the day approved by BOTH HR
        // and Finance before it flows into salary. Auto-creating the PENDING
        // row here means HR doesn't have to manually raise a grant every
        // time — they just approve/reject what the biometric already caught.
        // Idempotent via UQ (employee_code, grant_date, month, year): reruns
        // of calculate-days never produce duplicates.
        // Contractors get no grants (they're paid daily and never enter the
        // OT/extra-duty pipeline).
        if (!isContract) {
          const wopInsert = db.prepare(`
            INSERT OR IGNORE INTO extra_duty_grants
              (employee_code, employee_id, grant_date, month, year, company,
               grant_type, duty_days, verification_source, remarks,
               linked_attendance_id, status, finance_status, requested_by)
            VALUES (?, ?, ?, ?, ?, ?, 'OVERNIGHT_STAY', ?, 'BIOMETRIC_AUTO',
                    'Auto-detected from attendance WOP status', ?, 'PENDING',
                    'UNREVIEWED', 'system')
          `);
          for (const rec of records) {
            const status = rec.status_final || rec.status_original || '';
            if (status !== 'WOP' && status !== 'WO½P') continue;
            const dutyDays = status === 'WO½P' ? 0.5 : 1.0;
            wopInsert.run(
              empCode, emp?.id, rec.date, parseInt(month), parseInt(year),
              company || rec.company || '', dutyDays, rec.id
            );
          }
        }

        // Get fully-approved extra duty grants for this employee
        let manualExtraDutyDays = 0;
        try {
          const grants = db.prepare("SELECT SUM(duty_days) as total FROM extra_duty_grants WHERE employee_code = ? AND month = ? AND year = ? AND status = 'APPROVED' AND finance_status = 'FINANCE_APPROVED'").get(empCode, month, year);
          manualExtraDutyDays = grants?.total || 0;
        } catch {}

        // ── Finance-approved ED days (display-only on Stage 6) ──
        // Count grant days that DON'T overlap with WOP/punch-OT dates so the
        // Stage 6 box shows only the truly-extra finance grants. Anti-double-
        // counting by date — a grant on 2026-03-15 is excluded if that day's
        // attendance record is WOP/WO½P (already counted in extra_duty_days).
        // Contractors never accrue ED grants.
        let financeEDDays = 0;
        if (!isContract) {
          try {
            const wopDates = new Set(
              records
                .filter(r => {
                  const s = r.status_final || r.status_original || '';
                  return s === 'WOP' || s === 'WO½P';
                })
                .map(r => r.date)
            );
            const approvedGrants = db.prepare(`
              SELECT grant_date, duty_days FROM extra_duty_grants
              WHERE employee_code = ? AND month = ? AND year = ?
                AND status = 'APPROVED' AND finance_status = 'FINANCE_APPROVED'
            `).all(empCode, month, year);
            financeEDDays = approvedGrants
              .filter(g => !wopDates.has(g.grant_date))
              .reduce((sum, g) => sum + (g.duty_days || 0), 0);
          } catch {}
        }

        const calcResult = calculateDays(
          empCode, parseInt(month), parseInt(year), company || '',
          records, leaveBalances, holidays,
          {
            isContractor: isContract,
            weeklyOffDay: empFull?.weekly_off_day ?? 0,
            employmentType: empFull?.employment_type || 'Permanent',
            manualExtraDutyDays,
            financeEDDays,
            // DOJ-based holiday eligibility (April 2026): mid-month joiners
            // must NOT receive paid credit for holidays before their DOJ.
            dateOfJoining: empFull?.date_of_joining || null
          }
        );
        calcResult.employeeId = emp?.id;
        saveDayCalculation(db, calcResult);

        if (emp && (calcResult.clUsed > 0 || calcResult.elUsed > 0)) {
          if (calcResult.clUsed > 0) {
            db.prepare(`
              UPDATE leave_balances SET used = used + ?, balance = balance - ?
              WHERE employee_id = ? AND year = ? AND leave_type = 'CL'
            `).run(calcResult.clUsed, calcResult.clUsed, emp.id, year);
          }
          if (calcResult.elUsed > 0) {
            db.prepare(`
              UPDATE leave_balances SET used = used + ?, balance = balance - ?
              WHERE employee_id = ? AND year = ? AND leave_type = 'EL'
            `).run(calcResult.elUsed, calcResult.elUsed, emp.id, year);
          }
        }

        results.push({ employeeCode: empCode, ...calcResult });
      } catch (err) {
        errors.push({ employeeCode: empCode, error: err.message });
      }
    }
  });

  txn();
  db.prepare(`UPDATE monthly_imports SET stage_6_done = 1 WHERE month = ? AND year = ?`).run(month, year);

  res.json({
    success: true,
    message: `Day calculation complete for ${results.length} employees`,
    processed: results.length,
    errors: errors.length,
    errorDetails: errors,
    summary: {
      totalPresent: results.reduce((s, r) => s + r.daysPresent, 0),
      totalAbsent: results.reduce((s, r) => s + r.daysAbsent, 0),
      totalPaidSundays: results.reduce((s, r) => s + r.paidSundays, 0),
      totalLOP: results.reduce((s, r) => s + r.lopDays, 0),
      avgPayableDays: results.length ? results.reduce((s, r) => s + r.totalPayableDays, 0) / results.length : 0
    }
  });
});

/**
 * GET /api/payroll/day-calculations
 */
router.get('/day-calculations', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;

  const records = db.prepare(`
    SELECT dc.*,
      COALESCE(NULLIF(e.name, ''), ar_name.employee_name, dc.employee_code) as employee_name,
      COALESCE(NULLIF(e.department, ''), ar_name.department) as department,
      e.designation, e.status as employee_status,
      e.date_of_joining, e.date_of_exit,
      ss.gross_salary,
      -- Phase 2: finance-approved late coming deduction info for this month
      COALESCE((
        SELECT SUM(deduction_days) FROM late_coming_deductions lcd
        WHERE lcd.employee_code = dc.employee_code
          AND lcd.month = dc.month AND lcd.year = dc.year
          AND lcd.finance_status = 'approved'
      ), 0) AS finance_approved_late_days,
      (
        SELECT finance_remark FROM late_coming_deductions lcd
        WHERE lcd.employee_code = dc.employee_code
          AND lcd.month = dc.month AND lcd.year = dc.year
          AND lcd.finance_status = 'approved'
        ORDER BY finance_reviewed_at DESC LIMIT 1
      ) AS finance_late_remark
    FROM day_calculations dc
    LEFT JOIN employees e ON dc.employee_code = e.code
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id AND ss.id = (
      SELECT id FROM salary_structures WHERE employee_id = e.id ORDER BY effective_from DESC LIMIT 1
    )
    LEFT JOIN (
      SELECT employee_code, employee_name, department
      FROM attendance_raw
      WHERE employee_name IS NOT NULL AND employee_name != ''
      GROUP BY employee_code
    ) ar_name ON dc.employee_code = ar_name.employee_code
    WHERE dc.month = ? AND dc.year = ?
    ${company ? 'AND dc.company = ?' : ''}
    AND (e.status IS NULL OR e.status NOT IN ('Exited'))
    ORDER BY department, employee_name
  `).all(...[month, year, company].filter(Boolean));

  res.json({ success: true, data: records });
});

/**
 * GET /api/payroll/day-calculations/:code
 */
router.get('/day-calculations/:code', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  const { code } = req.params;

  const record = db.prepare(`
    SELECT dc.*,
      COALESCE(NULLIF(e.name, ''), ar_name.employee_name, dc.employee_code) as employee_name,
      COALESCE(NULLIF(e.department, ''), ar_name.department) as department
    FROM day_calculations dc
    LEFT JOIN employees e ON dc.employee_code = e.code
    LEFT JOIN (
      SELECT employee_code, employee_name, department
      FROM attendance_raw
      WHERE employee_name IS NOT NULL AND employee_name != ''
      GROUP BY employee_code
    ) ar_name ON dc.employee_code = ar_name.employee_code
    WHERE dc.employee_code = ? AND dc.month = ? AND dc.year = ?
  `).get(code, month, year);

  if (!record) return res.status(404).json({ success: false, error: 'Day calculation not found' });

  if (record.week_breakdown) {
    try { record.week_breakdown = JSON.parse(record.week_breakdown); } catch (e) {}
  }

  res.json({ success: true, data: record });
});

/**
 * POST /api/payroll/compute-salary
 * Compute salary for all employees — with zero-day exclusion, gross change, holds
 */
router.post('/compute-salary', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.body;

  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  // Include ALL employees with day calculations (even returning 'Left' employees)
  const employees = db.prepare(`
    SELECT DISTINCT e.*
    FROM employees e
    INNER JOIN day_calculations dc ON e.code = dc.employee_code
    WHERE dc.month = ? AND dc.year = ?
    ${company ? 'AND dc.company = ?' : ''}
    AND (e.status IS NULL OR e.status NOT IN ('Exited'))
  `).all(...[month, year, company].filter(Boolean));

  const results = [];
  const errors = [];
  const excluded = [];
  const held = [];

  const txn = db.transaction(() => {
    for (const emp of employees) {
      try {
        const comp = computeEmployeeSalary(db, emp, parseInt(month), parseInt(year), company || '');
        if (comp.success) {
          saveSalaryComputation(db, comp);
          results.push(comp);
          if (comp.salaryHeld) held.push({ code: emp.code, name: emp.name, reason: comp.holdReason });
        } else if (comp.excluded) {
          excluded.push({ code: comp.employeeCode, name: emp.name, reason: comp.reason });
        } else if (comp.silentSkip) {
          // Zero attendance — don't show as error, just count
        } else {
          errors.push({ employeeCode: emp.code, error: comp.error });
        }
      } catch (perEmpErr) {
        // Per-employee try/catch so ONE bad employee's SQL error doesn't roll
        // back the entire batch and leave Stage 7 stale.
        console.error(`[compute-salary] employee ${emp.code} failed: ${perEmpErr.message}`);
        if (perEmpErr.stack) console.error(perEmpErr.stack.split('\n').slice(0, 5).join('\n'));
        errors.push({ employeeCode: emp.code, error: perEmpErr.message });
      }
    }
  });
  txn();

  db.prepare('UPDATE monthly_imports SET stage_7_done = 1 WHERE month = ? AND year = ?').run(month, year);

  const totalNetSalary = results.reduce((s, r) => s + r.netSalary, 0);
  const totalGross = results.reduce((s, r) => s + r.grossEarned, 0);
  const grossChangedCount = results.filter(r => r.grossChanged).length;
  const heldCount = results.filter(r => r.salaryHeld).length;

  res.json({
    success: true,
    processed: results.length,
    errors: errors.length,
    errorDetails: errors,
    excluded,
    held,
    summary: {
      totalNetSalary: Math.round(totalNetSalary * 100) / 100,
      totalGrossSalary: Math.round(totalGross * 100) / 100,
      totalOTPay: Math.round(results.reduce((s, r) => s + (r.otPay || 0), 0) * 100) / 100,
      totalEDPay: Math.round(results.reduce((s, r) => s + (r.edPay || 0), 0) * 100) / 100,
      totalPayable: Math.round(results.reduce((s, r) => s + (r.totalPayable || 0), 0) * 100) / 100,
      totalTakeHome: Math.round(results.reduce((s, r) => s + (r.takeHome || 0), 0) * 100) / 100,
      edEmployees: results.filter(r => (r.edPay || 0) > 0).length,
      totalPFEmployee: Math.round(results.reduce((s, r) => s + r.pfEmployee, 0) * 100) / 100,
      totalPFEmployer: Math.round(results.reduce((s, r) => s + r.pfEmployer, 0) * 100) / 100,
      totalESIEmployee: Math.round(results.reduce((s, r) => s + r.esiEmployee, 0) * 100) / 100,
      totalESIEmployer: Math.round(results.reduce((s, r) => s + r.esiEmployer, 0) * 100) / 100,
      grossChangedCount,
      heldCount,
      excludedCount: excluded.length
    }
  });
});

/**
 * GET /api/payroll/salary-register
 * Includes new fields: gross_changed, salary_held, hold_reason, prev_month_gross, loan_recovery
 */
router.get('/salary-register', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;

  const records = db.prepare(`
    SELECT sc.*,
           COALESCE(NULLIF(e.name, ''), ar_name.employee_name, sc.employee_code) as employee_name,
           COALESCE(NULLIF(e.department, ''), ar_name.department) as department,
           e.designation, e.employment_type, e.is_contractor as employee_is_contractor,
           e.bank_account, e.ifsc, e.was_left_returned, e.status as employee_status,
           e.date_of_joining,
           dc.total_payable_days, dc.days_present, dc.days_absent, dc.lop_days, dc.paid_sundays,
           dc.days_half_present, dc.ot_hours,
           dc.late_count, dc.late_deduction_days, dc.late_deduction_remark,
           dc.holidays_before_doj, dc.is_mid_month_joiner, dc.finance_ed_days
    FROM salary_computations sc
    LEFT JOIN employees e ON sc.employee_code = e.code
    LEFT JOIN day_calculations dc ON sc.employee_code = dc.employee_code AND sc.month = dc.month AND sc.year = dc.year
    LEFT JOIN (
      SELECT employee_code, employee_name, department
      FROM attendance_raw
      WHERE employee_name IS NOT NULL AND employee_name != ''
      GROUP BY employee_code
    ) ar_name ON sc.employee_code = ar_name.employee_code
    WHERE sc.month = ? AND sc.year = ?
    ${company ? 'AND sc.company = ?' : ''}
    AND (e.status IS NULL OR e.status NOT IN ('Exited'))
    ORDER BY department, employee_name
  `).all(...[month, year, company].filter(Boolean));

  const activeRecords = records.filter(r => !r.salary_held);
  const heldRecords = records.filter(r => r.salary_held);

  const totals = records.length > 0 ? {
    totalGross: records.reduce((s, r) => s + (r.gross_earned || 0), 0),
    totalDeductions: records.reduce((s, r) => s + (r.total_deductions || 0), 0),
    totalNet: activeRecords.reduce((s, r) => s + (r.net_salary || 0), 0),
    totalPFEmployee: records.reduce((s, r) => s + (r.pf_employee || 0), 0),
    totalPFLiability: records.reduce((s, r) => s + (r.pf_employee || 0) + (r.pf_employer || 0), 0),
    totalESI: records.reduce((s, r) => s + (r.esi_employee || 0) + (r.esi_employer || 0), 0),
    totalLoanRecovery: records.reduce((s, r) => s + (r.loan_recovery || 0), 0),
    totalAdvanceRecovery: records.reduce((s, r) => s + (r.advance_recovery || 0), 0),
    totalOTPay: records.reduce((s, r) => s + (r.ot_pay || 0), 0),
    totalEDPay: records.reduce((s, r) => s + (r.ed_pay || 0), 0),
    totalTakeHome: activeRecords.reduce((s, r) => s + (r.take_home || r.total_payable || r.net_salary || 0), 0),
    edEmployees: records.filter(r => (r.ed_pay || 0) > 0).length,
    count: records.length,
    heldCount: heldRecords.length,
    grossChangedCount: records.filter(r => r.gross_changed).length,
    bankTransferTotal: activeRecords.reduce((s, r) => s + (r.net_salary || 0), 0)
  } : {};

  res.json({ success: true, data: records, totals });
});

/**
 * PUT /api/payroll/salary/:code/hold-release
 * Finance releases a held salary. Gated by requireFinanceOrAdmin so HR
 * cannot self-release a hold they themselves placed (or that the
 * pipeline auto-imposed).
 *
 * April 2026: `release_notes` is now a REQUIRED body param (the paper-
 * verification reference — e.g. "Approved by HR manager, sign-off form
 * #2026-04-08-07"). A row is written to `salary_hold_releases` on
 * success, creating a queryable audit trail independent of
 * salary_computations (which only stores the latest release state).
 */
router.put('/salary/:code/hold-release', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const { code } = req.params;
  const { month, year, release_notes } = req.body;
  const user = req.user?.username || 'finance';

  if (!release_notes || !String(release_notes).trim()) {
    return res.status(400).json({
      success: false,
      error: 'Release notes are required (paper verification reference)'
    });
  }
  const trimmedNotes = String(release_notes).trim();

  const before = db.prepare(`
    SELECT sc.id, sc.salary_held, sc.hold_reason, sc.net_salary, sc.company,
           e.name AS employee_name, e.department
    FROM salary_computations sc
    LEFT JOIN employees e ON e.code = sc.employee_code
    WHERE sc.employee_code = ? AND sc.month = ? AND sc.year = ?
  `).get(code, month, year);
  if (!before) return res.status(404).json({ success: false, error: 'Salary record not found' });
  if (before.salary_held !== 1) {
    return res.status(400).json({ success: false, error: 'Salary is not currently held' });
  }

  db.prepare(`
    UPDATE salary_computations SET
      salary_held = 0, hold_released = 1, hold_released_by = ?, hold_released_at = datetime('now')
    WHERE employee_code = ? AND month = ? AND year = ?
  `).run(user, code, month, year);

  // Write the audit row. Wrapped in try/catch so an audit failure
  // never blocks the release itself — mirrors archiveRejection() in
  // extraDutyGrants.js. A successful release + failed audit is still
  // better than a failed release.
  try {
    db.prepare(`
      INSERT INTO salary_hold_releases
        (employee_code, employee_name, department, month, year, company,
         hold_reason, hold_amount, released_by, release_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      code, before.employee_name || '', before.department || '',
      parseInt(month), parseInt(year), before.company || '',
      before.hold_reason || '', before.net_salary || 0,
      user, trimmedNotes
    );
  } catch (e) {
    console.error('[salary_hold_releases] audit insert failed:', e.message);
  }

  try {
    logAudit('salary_computations', before.id, 'salary_held', '1', '0',
      'FINANCE_HOLD_RELEASE', `${code} ${month}/${year}: ${trimmedNotes}`);
  } catch (e) { /* logAudit failures should never block the release */ }

  res.json({ success: true, message: `Salary released for ${code}` });
});

/**
 * GET /api/payroll/salary/hold-releases
 * Finance audit trail of every released hold. Powers the Held Salaries
 * Register "Released History" tab. Gated by requireFinanceOrAdmin — the
 * release audit is finance-sensitive.
 */
router.get('/salary/hold-releases', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const { month, year, employee_code, company, limit = 500 } = req.query;
  let q = 'SELECT * FROM salary_hold_releases WHERE 1=1';
  const p = [];
  if (month) { q += ' AND month = ?'; p.push(parseInt(month)); }
  if (year) { q += ' AND year = ?'; p.push(parseInt(year)); }
  if (employee_code) { q += ' AND employee_code = ?'; p.push(employee_code); }
  if (company) { q += ' AND company = ?'; p.push(company); }
  q += ' ORDER BY released_at DESC LIMIT ?';
  p.push(Math.min(parseInt(limit) || 500, 2000));
  res.json({ success: true, data: db.prepare(q).all(...p) });
});

/**
 * GET /api/payroll/salary/hold-releases/report
 * Range export — returns all releases between (startMonth/startYear) and
 * (endMonth/endYear) inclusive with totals. The frontend turns this into
 * an xlsx download. Gated by requireFinanceOrAdmin.
 */
router.get('/salary/hold-releases/report', requireFinanceOrAdmin, (req, res) => {
  const db = getDb();
  const { startMonth, startYear, endMonth, endYear, company } = req.query;
  if (!startMonth || !startYear || !endMonth || !endYear) {
    return res.status(400).json({ success: false, error: 'startMonth, startYear, endMonth, endYear are all required' });
  }
  const startKey = parseInt(startYear) * 12 + parseInt(startMonth);
  const endKey   = parseInt(endYear)   * 12 + parseInt(endMonth);
  let q = `SELECT * FROM salary_hold_releases WHERE (year*12 + month) BETWEEN ? AND ?`;
  const p = [startKey, endKey];
  if (company) { q += ' AND company = ?'; p.push(company); }
  q += ' ORDER BY released_at DESC';
  const rows = db.prepare(q).all(...p);
  const totals = {
    count: rows.length,
    amount: rows.reduce((s, r) => s + (r.hold_amount || 0), 0)
  };
  res.json({ success: true, data: rows, totals });
});

/**
 * GET /api/payroll/day-calc-staleness
 * Detects whether a Stage 6 recompute is required for the given
 * month/year/company. Returns a count of miss punches whose finance
 * status changed (approved / rejected) AFTER the latest
 * day_calculations.updated_at for the month. If count > 0, the
 * frontend shows a "Recalculate Days" banner prompting the user to
 * re-run Stage 6 so the new finance verdicts flow into payroll.
 *
 * April 2026: the Stage 6 gate on miss_punch_finance_status means
 * day calcs can drift out of sync with reality when finance
 * approves/rejects after the last compute. This endpoint gives the
 * frontend a cheap way to detect that drift without recomputing
 * everything on every page load.
 */
router.get('/day-calc-staleness', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;
  if (!month || !year) {
    return res.status(400).json({ success: false, error: 'month and year required' });
  }

  // Most-recent day_calculations.updated_at for the month (per-company
  // if filtered; else the max across companies). If no day_calculations
  // exist yet, the banner shows `stale=false` — user will run Stage 6
  // for the first time anyway.
  let lastQ = 'SELECT MAX(updated_at) AS last_calc FROM day_calculations WHERE month = ? AND year = ?';
  const lastP = [month, year];
  if (company) { lastQ += ' AND company = ?'; lastP.push(company); }
  const lastRow = db.prepare(lastQ).get(...lastP);
  const lastCalc = lastRow?.last_calc;

  if (!lastCalc) {
    return res.json({ success: true, stale: false, changedMissPunches: 0, lastCalc: null });
  }

  // Count miss punches whose finance review happened AFTER lastCalc.
  // We use miss_punch_finance_reviewed_at as the "when finance acted"
  // timestamp — set by both approve and reject endpoints.
  let changedQ = `
    SELECT COUNT(*) AS n
    FROM attendance_processed
    WHERE is_miss_punch = 1
      AND month = ? AND year = ?
      AND miss_punch_finance_status IN ('approved', 'rejected')
      AND miss_punch_finance_reviewed_at > ?
  `;
  const changedP = [month, year, lastCalc];
  if (company) { changedQ += ' AND company = ?'; changedP.push(company); }
  const changed = db.prepare(changedQ).get(...changedP);

  res.json({
    success: true,
    stale: (changed?.n || 0) > 0,
    changedMissPunches: changed?.n || 0,
    lastCalc
  });
});

/**
 * GET /api/payroll/payslip/:code
 */
router.get('/payslip/:code', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  const payslip = generatePayslipData(db, req.params.code, parseInt(month), parseInt(year));

  if (!payslip) return res.status(404).json({ success: false, error: 'Payslip not found. Generate salary first.' });
  res.json({ success: true, data: payslip });
});

/**
 * PUT /api/payroll/salary/:code/manual-deductions
 */
router.put('/salary/:code/manual-deductions', (req, res) => {
  const db = getDb();
  const { code } = req.params;
  const { month, year, advanceRecovery, tds, otherDeductions } = req.body;

  // Recalculate total_deductions, net_salary, total_payable, take_home
  //   net          = gross_earned − deductions   (base only, no OT/ED)
  //   total_payable = net + ot_pay + holiday_duty_pay
  //   take_home    = total_payable + ed_pay
  db.prepare(`
    UPDATE salary_computations SET
      advance_recovery = ?, tds = ?, other_deductions = ?,
      total_deductions = pf_employee + esi_employee + professional_tax + ? + ? + lop_deduction + ? + COALESCE(loan_recovery, 0),
      net_salary = MAX(0, gross_earned - (pf_employee + esi_employee + professional_tax + ? + ? + lop_deduction + ? + COALESCE(loan_recovery, 0))),
      total_payable = MAX(0, gross_earned - (pf_employee + esi_employee + professional_tax + ? + ? + lop_deduction + ? + COALESCE(loan_recovery, 0))) + COALESCE(ot_pay, 0) + COALESCE(holiday_duty_pay, 0),
      take_home = MAX(0, gross_earned - (pf_employee + esi_employee + professional_tax + ? + ? + lop_deduction + ? + COALESCE(loan_recovery, 0))) + COALESCE(ot_pay, 0) + COALESCE(holiday_duty_pay, 0) + COALESCE(ed_pay, 0)
    WHERE employee_code = ? AND month = ? AND year = ?
  `).run(
    advanceRecovery || 0, tds || 0, otherDeductions || 0,
    advanceRecovery || 0, tds || 0, otherDeductions || 0,
    advanceRecovery || 0, tds || 0, otherDeductions || 0,
    advanceRecovery || 0, tds || 0, otherDeductions || 0,
    advanceRecovery || 0, tds || 0, otherDeductions || 0,
    code, month, year
  );

  res.json({ success: true });
});

/**
 * POST /api/payroll/finalise
 */
router.post('/finalise', (req, res) => {
  const db = getDb();
  const { month, year } = req.body;

  // Check finance sign-off
  try {
    const signoff = db.prepare("SELECT status FROM finance_month_signoff WHERE month = ? AND year = ? AND status = 'approved'").get(month, year);
    if (!signoff) {
      return res.status(403).json({
        success: false,
        error: 'Cannot finalise — finance audit sign-off is pending. The finance team must approve before finalisation.',
        requiresFinanceApproval: true
      });
    }
  } catch {} // table may not exist yet

  // Check extra duty grants reviewed
  try {
    const unreviewed = db.prepare("SELECT COUNT(*) as cnt FROM extra_duty_grants WHERE month = ? AND year = ? AND status = 'APPROVED' AND finance_status IN ('UNREVIEWED', 'FINANCE_FLAGGED')").get(month, year);
    if (unreviewed?.cnt > 0) {
      return res.status(400).json({ success: false, error: `Cannot finalise: ${unreviewed.cnt} extra duty grant(s) pending finance review.`, pendingGrants: unreviewed.cnt });
    }
  } catch {}

  // Check miss-punch finance verification complete (April 2026)
  try {
    const pendingMP = db.prepare(`
      SELECT COUNT(*) as cnt FROM attendance_processed
      WHERE month = ? AND year = ?
        AND is_miss_punch = 1
        AND miss_punch_resolved = 1
        AND miss_punch_finance_status = 'pending'
    `).get(month, year);
    if (pendingMP?.cnt > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot finalise: ${pendingMP.cnt} miss-punch resolution(s) pending finance review.`,
        pendingMissPunches: pendingMP.cnt
      });
    }
  } catch {}

  db.prepare(`UPDATE salary_computations SET is_finalised = 1, finalised_at = datetime('now') WHERE month = ? AND year = ?`).run(month, year);
  db.prepare(`UPDATE monthly_imports SET is_finalised = 1, finalised_at = datetime('now') WHERE month = ? AND year = ?`).run(month, year);

  res.json({ success: true, message: 'Salary finalised' });
});

/**
 * PUT /api/payroll/day-calculations/:code/late-deduction
 * HR can apply late deduction for employees with >5 late days
 */
router.put('/day-calculations/:code/late-deduction', (req, res) => {
  const db = getDb();
  const { code } = req.params;
  const { month, year, deductionDays, remark } = req.body;

  // Validate
  if (deductionDays < 0 || deductionDays > 5) {
    return res.status(400).json({ success: false, error: 'Deduction must be 0-5 days' });
  }

  // Update day calculation
  const dc = db.prepare('SELECT * FROM day_calculations WHERE employee_code = ? AND month = ? AND year = ?').get(code, month, year);
  if (!dc) return res.status(404).json({ success: false, error: 'Day calculation not found' });

  const newPayable = Math.max(0, (dc.total_payable_days || 0) - deductionDays + (dc.late_deduction_days || 0));
  const newLOP = Math.max(0, (dc.lop_days || 0) + deductionDays - (dc.late_deduction_days || 0));

  db.prepare(`
    UPDATE day_calculations SET
      late_deduction_days = ?,
      late_deduction_remark = ?,
      total_payable_days = ?,
      lop_days = ?
    WHERE employee_code = ? AND month = ? AND year = ?
  `).run(deductionDays, remark || `Late deduction: ${deductionDays} day(s) for ${dc.late_count || 0} late arrivals`, newPayable, newLOP, code, month, year);

  res.json({ success: true, message: `Late deduction of ${deductionDays} day(s) applied for ${code}` });
});

/**
 * GET /api/payroll/payslips/bulk
 * DISABLED per company policy (April 2026). Employees do not receive payslips
 * and the bulk-download workflow is retired. The endpoint is retained and
 * returns HTTP 403 so existing clients fail loudly and individual payslip
 * generation (/payslip/:code) continues to work for internal review.
 */
router.get('/payslips/bulk', (req, res) => {
  return res.status(403).json({
    success: false,
    error: 'Bulk payslip download is disabled per company policy'
  });
});

/**
 * GET /api/payroll/month-end-checklist
 * Pre-finalization validation checklist
 */
router.get('/month-end-checklist', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;

  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  const items = [];

  // 1. Check pipeline stages by verifying actual data existence (more reliable than stage flags)
  const imports = db.prepare('SELECT * FROM monthly_imports WHERE month = ? AND year = ?').all(month, year);
  if (imports.length === 0) {
    items.push({ id: 'import', label: 'Attendance data imported', status: 'error', count: 0, detail: 'No import found for this month', link: '/pipeline/import' });
  } else {
    // Check actual data presence rather than per-row flags (flags may not be set on all import rows)
    const hasAttendance = db.prepare('SELECT COUNT(*) as cnt FROM attendance_processed WHERE month = ? AND year = ?').get(month, year).cnt > 0;
    const hasDayCalc = db.prepare('SELECT COUNT(*) as cnt FROM day_calculations WHERE month = ? AND year = ?').get(month, year).cnt > 0;
    const hasSalary = db.prepare('SELECT COUNT(*) as cnt FROM salary_computations WHERE month = ? AND year = ?').get(month, year).cnt > 0;

    if (hasAttendance) {
      items.push({ id: 'pipeline_import', label: 'Attendance data imported', status: 'ok', count: imports.length, detail: `${imports.length} import(s) for this month` });
    }
    if (!hasDayCalc) {
      items.push({ id: 'pipeline_daycalc', label: 'Day Calculation (Stage 6)', status: 'warning', count: 0, detail: 'Run day calculation before salary', link: '/pipeline/day-calc' });
    } else {
      items.push({ id: 'pipeline_daycalc', label: 'Day calculation completed', status: 'ok', count: 0 });
    }
    if (!hasSalary) {
      items.push({ id: 'pipeline_salary', label: 'Salary Computation (Stage 7)', status: 'warning', count: 0, detail: 'Run salary computation', link: '/pipeline/salary' });
    } else {
      items.push({ id: 'pipeline_salary', label: 'Salary computed', status: 'ok', count: 0 });
    }
  }

  // 2. Unresolved miss punches
  const unresolvedMP = db.prepare(`
    SELECT COUNT(*) as cnt FROM attendance_processed
    WHERE month = ? AND year = ? AND is_miss_punch = 1 AND miss_punch_resolved = 0
  `).get(month, year);
  items.push({
    id: 'miss_punches',
    label: 'Unresolved miss punches',
    status: unresolvedMP.cnt > 0 ? 'warning' : 'ok',
    count: unresolvedMP.cnt,
    detail: unresolvedMP.cnt > 0 ? `${unresolvedMP.cnt} miss punches need resolution` : 'All miss punches resolved',
    link: '/pipeline/miss-punch'
  });

  // 3. Unconfirmed night shifts
  const unconfirmedNS = db.prepare(`
    SELECT COUNT(*) as cnt FROM night_shift_pairs
    WHERE month = ? AND year = ? AND is_confirmed = 0 AND is_rejected = 0
  `).get(month, year);
  items.push({
    id: 'night_shifts',
    label: 'Unconfirmed night shift pairs',
    status: unconfirmedNS.cnt > 0 ? 'warning' : 'ok',
    count: unconfirmedNS.cnt,
    detail: unconfirmedNS.cnt > 0 ? `${unconfirmedNS.cnt} night shift pairs need confirmation` : 'All night shifts confirmed',
    link: '/pipeline/night-shift'
  });

  // 4. Employees missing salary structure — include names
  const missingSSRows = db.prepare(`
    SELECT DISTINCT dc.employee_code, COALESCE(e.name, dc.employee_code) as employee_name, e.department
    FROM day_calculations dc
    LEFT JOIN employees e ON dc.employee_code = e.code
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id
    WHERE dc.month = ? AND dc.year = ? AND ss.id IS NULL
    ORDER BY e.department, e.name
  `).all(month, year);
  const missingSS = { cnt: missingSSRows.length };
  const missingSSNames = missingSSRows.slice(0, 10).map(r => `${r.employee_name} (${r.employee_code})`).join(', ');
  items.push({
    id: 'salary_structure',
    label: 'Employees missing salary structure',
    status: missingSS.cnt > 0 ? 'warning' : 'ok',
    count: missingSS.cnt,
    detail: missingSS.cnt > 0 ? `${missingSSNames}${missingSSRows.length > 10 ? ` +${missingSSRows.length - 10} more` : ''}` : 'All employees have salary structures',
    link: '/employees',
    employees: missingSSRows,
  });

  // 5. Employees missing bank details
  const missingBank = db.prepare(`
    SELECT COUNT(*) as cnt FROM salary_computations sc
    LEFT JOIN employees e ON sc.employee_code = e.code
    WHERE sc.month = ? AND sc.year = ? AND sc.net_salary > 0 AND sc.salary_held = 0
    AND (e.account_number IS NULL OR e.account_number = '') AND (e.bank_account IS NULL OR e.bank_account = '')
  `).get(month, year);
  items.push({
    id: 'bank_details',
    label: 'Employees missing bank details',
    status: missingBank.cnt > 0 ? 'warning' : 'ok',
    count: missingBank.cnt,
    detail: missingBank.cnt > 0 ? `${missingBank.cnt} employees need bank details for NEFT` : 'All employees have bank details',
    link: '/employees'
  });

  // 6. Held salaries
  const heldSalaries = db.prepare(`
    SELECT COUNT(*) as cnt FROM salary_computations
    WHERE month = ? AND year = ? AND salary_held = 1 AND (hold_released IS NULL OR hold_released = 0)
  `).get(month, year);
  items.push({
    id: 'held_salaries',
    label: 'Held salaries not released',
    status: heldSalaries.cnt > 0 ? 'warning' : 'ok',
    count: heldSalaries.cnt,
    detail: heldSalaries.cnt > 0 ? `${heldSalaries.cnt} salaries are on hold` : 'No held salaries',
    link: '/pipeline/salary'
  });

  // 7a. Late coming deductions pending finance review (Phase 2)
  try {
    const pendingLate = db.prepare(`
      SELECT COUNT(*) as cnt FROM late_coming_deductions
      WHERE month = ? AND year = ? AND finance_status = 'pending'
    `).get(month, year);
    if (pendingLate.cnt > 0) {
      items.push({
        id: 'late-deductions-pending',
        label: 'Late coming deductions pending finance review',
        status: 'warning',
        count: pendingLate.cnt,
        detail: `${pendingLate.cnt} late coming deduction(s) awaiting finance review`,
        link: '/finance-audit?tab=late-coming'
      });
    } else {
      items.push({
        id: 'late-deductions-reviewed',
        label: 'All late coming deductions reviewed',
        status: 'ok',
        count: 0,
        detail: 'No pending late coming deductions'
      });
    }
  } catch (e) {}

  // 7b. Approved late deductions not yet applied to salary
  try {
    const approvedNotApplied = db.prepare(`
      SELECT COUNT(*) as cnt FROM late_coming_deductions
      WHERE month = ? AND year = ? AND finance_status = 'approved' AND is_applied_to_salary = 0
    `).get(month, year);
    if (approvedNotApplied.cnt > 0) {
      items.push({
        id: 'late-deductions-unapplied',
        label: 'Approved late deductions not yet in salary',
        status: 'warning',
        count: approvedNotApplied.cnt,
        detail: `${approvedNotApplied.cnt} approved deduction(s) need salary recomputation`,
        link: '/pipeline/salary'
      });
    }
  } catch (e) {}

  // 8. Already finalised check
  const finalised = db.prepare(`
    SELECT COUNT(*) as cnt FROM salary_computations
    WHERE month = ? AND year = ? AND is_finalised = 1
  `).get(month, year);
  if (finalised.cnt > 0) {
    items.push({
      id: 'finalised',
      label: 'Salary already finalised',
      status: 'ok',
      count: finalised.cnt,
      detail: `${finalised.cnt} records already finalised`
    });
  }

  const warnings = items.filter(i => i.status === 'warning').length;
  const errors = items.filter(i => i.status === 'error').length;

  res.json({ success: true, data: items, summary: { total: items.length, ok: items.filter(i => i.status === 'ok').length, warnings, errors } });
});

/**
 * GET /api/payroll/salary-comparison
 * Month-over-month salary comparison for anomaly detection
 */
router.get('/salary-comparison', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;

  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  // Calculate previous month
  let prevMonth = parseInt(month) - 1;
  let prevYear = parseInt(year);
  if (prevMonth === 0) { prevMonth = 12; prevYear--; }

  const currentData = db.prepare(`
    SELECT sc.employee_code, e.name as employee_name, e.department,
           sc.gross_salary, sc.gross_earned, sc.net_salary, sc.payable_days,
           sc.pf_employee, sc.esi_employee, sc.total_deductions,
           sc.gross_changed, sc.salary_held
    FROM salary_computations sc
    LEFT JOIN employees e ON sc.employee_code = e.code
    WHERE sc.month = ? AND sc.year = ?
    ${company ? 'AND sc.company = ?' : ''}
  `).all(...[month, year, company].filter(Boolean));

  const prevData = db.prepare(`
    SELECT sc.employee_code, sc.gross_salary as prev_gross, sc.net_salary as prev_net,
           sc.payable_days as prev_payable_days, sc.gross_earned as prev_gross_earned
    FROM salary_computations sc
    WHERE sc.month = ? AND sc.year = ?
    ${company ? 'AND sc.company = ?' : ''}
  `).all(...[prevMonth, prevYear, company].filter(Boolean));

  const prevMap = {};
  for (const p of prevData) prevMap[p.employee_code] = p;

  const comparisons = [];
  for (const curr of currentData) {
    const prev = prevMap[curr.employee_code];
    const flags = [];

    if (!prev) {
      flags.push('NEW');
    } else {
      const netChange = prev.prev_net > 0 ? ((curr.net_salary - prev.prev_net) / prev.prev_net) * 100 : 0;
      if (Math.abs(netChange) > 30) flags.push('LARGE_CHANGE');
      else if (Math.abs(netChange) > 20) flags.push('MODERATE_CHANGE');
      if (curr.gross_changed) flags.push('GROSS_CHANGED');

      curr.prev_net = prev.prev_net;
      curr.prev_gross = prev.prev_gross;
      curr.prev_payable_days = prev.prev_payable_days;
      curr.net_change_pct = Math.round(netChange * 100) / 100;
    }

    if (curr.salary_held) flags.push('HELD');
    curr.flags = flags;

    if (flags.length > 0) comparisons.push(curr);
  }

  // Check for employees in previous month but missing this month
  const currentCodes = new Set(currentData.map(c => c.employee_code));
  for (const prev of prevData) {
    if (!currentCodes.has(prev.employee_code)) {
      const emp = db.prepare('SELECT name, department FROM employees WHERE code = ?').get(prev.employee_code);
      comparisons.push({
        employee_code: prev.employee_code,
        employee_name: emp?.name || prev.employee_code,
        department: emp?.department || '',
        net_salary: 0,
        prev_net: prev.prev_net,
        prev_gross: prev.prev_gross,
        net_change_pct: -100,
        flags: ['MISSING'],
      });
    }
  }

  // Sort by severity
  const flagOrder = { MISSING: 0, LARGE_CHANGE: 1, HELD: 2, NEW: 3, GROSS_CHANGED: 4, MODERATE_CHANGE: 5 };
  comparisons.sort((a, b) => {
    const aMin = Math.min(...a.flags.map(f => flagOrder[f] ?? 99));
    const bMin = Math.min(...b.flags.map(f => flagOrder[f] ?? 99));
    return aMin - bMin;
  });

  res.json({
    success: true,
    data: comparisons,
    summary: {
      total: comparisons.length,
      new: comparisons.filter(c => c.flags.includes('NEW')).length,
      missing: comparisons.filter(c => c.flags.includes('MISSING')).length,
      largeChange: comparisons.filter(c => c.flags.includes('LARGE_CHANGE')).length,
      held: comparisons.filter(c => c.flags.includes('HELD')).length,
    },
    period: { current: { month, year }, previous: { month: prevMonth, year: prevYear } }
  });
});

/**
 * GET /api/payroll/salary-slip-excel
 * Generate single Excel file with all salary slips — 4 per page, with summary sheet
 */
router.get('/salary-slip-excel', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;
  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  const MONTHS = ['', 'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

  // Fetch all salary data — include held employees so the finance team has a
  // complete paper record. `sc.*` brings in salary_held / hold_reason /
  // finance_remark which the summary sheet prefixes with ⚠ and follows up
  // with an inline note row for each held row.
  const rows = db.prepare(`
    SELECT sc.*, e.name, e.department, e.designation, e.date_of_joining,
      dc.total_payable_days, dc.days_present, dc.days_absent, dc.paid_sundays, dc.days_wop, dc.ot_hours
    FROM salary_computations sc
    LEFT JOIN employees e ON sc.employee_code = e.code
    LEFT JOIN day_calculations dc ON sc.employee_code = dc.employee_code AND sc.month = dc.month AND sc.year = dc.year
    WHERE sc.month = ? AND sc.year = ?
      AND (sc.net_salary > 0 OR sc.salary_held = 1)
    ${company ? 'AND sc.company = ?' : ''}
    AND (e.status IS NULL OR e.status NOT IN ('Exited'))
    ORDER BY sc.salary_held DESC, e.department, e.name
  `).all(...[parseInt(month), parseInt(year), company].filter(Boolean));

  if (rows.length === 0) return res.status(404).json({ success: false, error: 'No salary records found' });

  const companyName = company || 'ASIAN LAKTO IND LTD.';
  const monthTitle = `SALARY SLIP ${MONTHS[parseInt(month)]} ${year}`;

  const wb = XLSX.utils.book_new();

  // Shared helpers
  const fmtDOJ = (iso) => {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };
  const isHeld = (r) => (r.salary_held === 1 || r.salary_held === true);
  const holdNote = (r) => {
    const bits = [];
    if (r.hold_reason) bits.push(r.hold_reason);
    if (r.finance_remark && r.finance_remark !== r.hold_reason) bits.push(`Finance: ${r.finance_remark}`);
    return bits.length ? bits.join(' | ') : 'Salary held — reason not recorded';
  };

  // ── Sheet 1: SUMMARY ──────────────────────────────────────

  const SUMMARY_COLS = 19; // S.No … DAYS
  const summaryData = [
    [companyName],
    [`SALARY SUMMARY — ${MONTHS[parseInt(month)]} ${year}`],
    [],
    ['S.No', 'EMP', 'NAME', 'DEPARTMENT', 'DESIGNATION', 'DOJ', 'GROSS', 'EARNED', 'OT PAY', 'ED PAY',
     'PF', 'ESI', 'ADVANCE', 'LOAN', 'LOP', 'TOT DED', 'NET PAYABLE', 'TAKE HOME', 'DAYS']
  ];
  // Track rows that need merge/note styling. Header is rows 0..3, data starts at row 4.
  const summaryMerges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: SUMMARY_COLS - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: SUMMARY_COLS - 1 } }
  ];
  const heldEmployees = [];

  // Track caution-cell coordinates for held employees so we can attach Excel
  // cell comments to the TOT DED / NET PAYABLE / TAKE HOME columns after the
  // sheet is built. The xlsx community edition does not honour cell fill
  // styling on write, but cell comments (the `c` field) DO survive the round
  // trip and render as the standard Excel red-corner-triangle indicator.
  const heldCautionRows = []; // [{ rowIdx, note }]

  rows.forEach((r, i) => {
    const takeHome = r.take_home || ((r.total_payable || r.net_salary || 0) + (r.ed_pay || 0));
    const held = isHeld(r);
    const namePrefix = held ? '⚠ HELD — ' : '';
    const dataRowIdx = summaryData.length; // 0-based index of the row we're about to push
    summaryData.push([
      i + 1, r.employee_code, namePrefix + (r.name || ''), r.department || '', r.designation || '',
      fmtDOJ(r.date_of_joining),
      r.gross_salary || 0, r.gross_earned || 0,
      r.ot_pay || 0, r.ed_pay || 0,
      r.pf_employee || 0, r.esi_employee || 0,
      r.advance_recovery || 0, r.loan_recovery || 0, r.lop_deduction || 0,
      r.total_deductions || 0, r.net_salary || 0, takeHome, r.total_payable_days || 0
    ]);

    if (held) {
      // Insert a note row immediately after the held employee's salary row.
      // Column 0 carries the note text; the remaining cells are filled with
      // empty strings so XLSX can merge them into a single visual cell.
      const noteRowIdx = summaryData.length; // 0-based index of the row we're about to push
      const note = `    ↳ HOLD REASON: ${holdNote(r)}`;
      const row = new Array(SUMMARY_COLS).fill('');
      row[0] = note;
      summaryData.push(row);
      summaryMerges.push({ s: { r: noteRowIdx, c: 0 }, e: { r: noteRowIdx, c: SUMMARY_COLS - 1 } });
      heldEmployees.push(r);
      heldCautionRows.push({ rowIdx: dataRowIdx, note: holdNote(r) });
    }
  });

  // Totals row — only sums non-held-note rows. Held rows ARE included because
  // total_payable/take_home still reflect what would be paid IF released; finance
  // reviewing the sheet wants to see the financial scale of the holds.
  const totals = rows.reduce((t, r) => {
    t.gross += r.gross_salary || 0; t.earned += r.gross_earned || 0;
    t.ot += r.ot_pay || 0; t.ed += r.ed_pay || 0;
    t.pf += r.pf_employee || 0; t.esi += r.esi_employee || 0;
    t.adv += r.advance_recovery || 0; t.loan += r.loan_recovery || 0; t.lop += r.lop_deduction || 0;
    t.ded += r.total_deductions || 0; t.net += r.net_salary || 0;
    t.takeHome += r.take_home || ((r.total_payable || r.net_salary || 0) + (r.ed_pay || 0));
    return t;
  }, { gross: 0, earned: 0, ot: 0, ed: 0, pf: 0, esi: 0, adv: 0, loan: 0, lop: 0, ded: 0, net: 0, takeHome: 0 });

  summaryData.push([
    '', '', 'TOTAL', '', '', '',
    Math.round(totals.gross), Math.round(totals.earned),
    Math.round(totals.ot), Math.round(totals.ed),
    Math.round(totals.pf), Math.round(totals.esi),
    Math.round(totals.adv), Math.round(totals.loan), Math.round(totals.lop),
    Math.round(totals.ded), Math.round(totals.net), Math.round(totals.takeHome), ''
  ]);

  // Footer: held-count summary so finance can see at a glance how many holds
  // are in the register without scanning the whole sheet.
  if (heldEmployees.length > 0) {
    summaryData.push([]);
    const footerRow = summaryData.length;
    summaryData.push([`⚠ ${heldEmployees.length} employee(s) marked HELD — see inline notes above and the HELD EMPLOYEES sheet for the full paper record`]);
    summaryMerges.push({ s: { r: footerRow, c: 0 }, e: { r: footerRow, c: SUMMARY_COLS - 1 } });
  }

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  summarySheet['!cols'] = [
    { wch: 5 }, { wch: 8 }, { wch: 28 }, { wch: 18 }, { wch: 16 }, { wch: 11 },
    { wch: 10 }, { wch: 10 }, { wch: 9 }, { wch: 9 },
    { wch: 8 }, { wch: 8 }, { wch: 8 },
    { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 6 }
  ];
  summarySheet['!merges'] = summaryMerges;

  // Attach Excel cell comments (red corner triangle) to the financial cells
  // for held employees. Excel renders these as the same red caution triangle
  // the company's salary summaries use, so finance can spot held salaries while
  // scanning the TOT DED / NET PAYABLE / TAKE HOME columns. The xlsx community
  // edition does not write fill colours, so cell comments are the most
  // reliable visual indicator across versions.
  const CAUTION_COLS = [15, 16, 17]; // TOT DED, NET PAYABLE, TAKE HOME (0-indexed)
  for (const { rowIdx, note } of heldCautionRows) {
    for (const colIdx of CAUTION_COLS) {
      const cellRef = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
      const cell = summarySheet[cellRef];
      if (!cell) continue;
      cell.c = [{ a: 'Payroll System', t: `⚠ Salary Held: ${note}` }];
      // Mark the comment as hidden by default so Excel only shows the corner
      // triangle until the user hovers (matches the company spreadsheet UX).
      cell.c.hidden = true;
    }
  }

  XLSX.utils.book_append_sheet(wb, summarySheet, 'SUMMARY');

  // ── Sheet 1.5: HELD EMPLOYEES (paper record) ──────────────
  // Dedicated sheet listing only the held employees with full salary breakdown
  // and hold reason. Finance prints this separately for their audit binder.
  if (heldEmployees.length > 0) {
    const HELD_COLS = 8;
    const heldData = [
      [companyName],
      [`HELD SALARIES — ${MONTHS[parseInt(month)]} ${year}`],
      [`${heldEmployees.length} employee(s) held for finance review`],
      [],
      ['S.No', 'EMP', 'NAME', 'DEPARTMENT', 'GROSS', 'NET (held)', 'TAKE HOME', 'HOLD REASON']
    ];
    const heldMerges = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: HELD_COLS - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: HELD_COLS - 1 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: HELD_COLS - 1 } }
    ];

    heldEmployees.forEach((r, i) => {
      const takeHome = r.take_home || ((r.total_payable || r.net_salary || 0) + (r.ed_pay || 0));
      heldData.push([
        i + 1,
        r.employee_code,
        r.name || '',
        r.department || '',
        Math.round(r.gross_salary || 0),
        Math.round(r.net_salary || 0),
        Math.round(takeHome),
        holdNote(r)
      ]);
    });

    // Paper-record footer: signatures block for the finance team binder.
    heldData.push([]);
    heldData.push(['NOTE: Each held salary has been reviewed and flagged by the salary computation pipeline.']);
    heldData.push(['Release requires an explicit action via Stage 7 "Release Hold" button, logged in the audit trail.']);
    heldData.push([]);
    heldData.push(['Reviewed by Finance: ____________________________', '', '', '', 'Date: __________']);
    heldData.push(['Approved by HR:      ____________________________', '', '', '', 'Date: __________']);

    const heldSheet = XLSX.utils.aoa_to_sheet(heldData);
    heldSheet['!cols'] = [
      { wch: 5 }, { wch: 8 }, { wch: 28 }, { wch: 18 },
      { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 60 }
    ];
    heldSheet['!merges'] = heldMerges;
    XLSX.utils.book_append_sheet(wb, heldSheet, 'HELD EMPLOYEES');
  }

  // ── Sheet 2: SALARY SLIP ──────────────────────────────────
  const slipData = [];
  const slipMerges = [];
  let currentRow = 0;

  // Process employees in groups of 4
  for (let g = 0; g < rows.length; g += 4) {
    const group = rows.slice(g, g + 4);

    // Header rows for this page
    slipData.push([companyName]);
    slipMerges.push({ s: { r: currentRow, c: 0 }, e: { r: currentRow, c: 11 } });
    currentRow++;

    slipData.push([monthTitle]);
    slipMerges.push({ s: { r: currentRow, c: 0 }, e: { r: currentRow, c: 11 } });
    currentRow++;

    // Column headers
    slipData.push(['S.No', 'EMP', 'NAME', 'DESIGNATION', 'DATE.D', 'GROSS SALARY', 'TOTAL EARNED', 'ADVANCE', 'Total Days', 'PAYABLE', 'Net Payable', 'Signature']);
    currentRow++;

    // Employee rows (4 per page, with blank row between each)
    for (let i = 0; i < group.length; i++) {
      const r = group[i];
      const doj = r.date_of_joining ? r.date_of_joining.replace(/-/g, '/').replace(/^(\d{4})\/(\d{2})\/(\d{2})$/, '$2/$3/$1').replace(/^0/, '') : '';
      const held = isHeld(r);

      // Blank row before employee
      slipData.push([]);
      currentRow++;

      slipData.push([
        g + i + 1,
        r.employee_code,
        (held ? '⚠ HELD — ' : '') + (r.name || ''),
        (r.designation || '') + (r.department ? ` ${r.department}` : ''),
        doj,
        r.gross_salary || 0,
        r.gross_earned ? Math.round(r.gross_earned * 100) / 100 : 0,
        r.advance_recovery || 0,
        r.total_payable_days ? Math.round(r.total_payable_days * 100) / 100 : 0,
        r.net_salary ? Math.round((r.net_salary + (r.advance_recovery || 0)) * 100) / 100 : 0,
        r.net_salary ? Math.round(r.net_salary) : 0,
        ''
      ]);
      currentRow++;

      // Hold-reason note row (merged across the whole slip width) so the
      // finance team printing the payslip page sees WHY the salary is held
      // directly under that employee's figures — no cross-referencing needed.
      if (held) {
        const noteRow = [`    ↳ HOLD REASON: ${holdNote(r)}`, '', '', '', '', '', '', '', '', '', '', ''];
        slipData.push(noteRow);
        slipMerges.push({ s: { r: currentRow, c: 0 }, e: { r: currentRow, c: 11 } });
        currentRow++;
      }
    }

    // Yellow separator (blank row marker — will need styling in Excel)
    slipData.push([]);
    currentRow++;
    slipData.push(['─', '─', '─', '─', '─', '─', '─', '─', '─', '─', '─', '─']);
    currentRow++;
  }

  const slipSheet = XLSX.utils.aoa_to_sheet(slipData);
  slipSheet['!cols'] = [
    { wch: 5 }, { wch: 8 }, { wch: 22 }, { wch: 20 }, { wch: 10 },
    { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }
  ];
  slipSheet['!merges'] = slipMerges;

  // Set print area and page breaks
  slipSheet['!print'] = { area: true };

  XLSX.utils.book_append_sheet(wb, slipSheet, 'SALARY SLIP');

  // Generate buffer and send
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `Salary_Slip_${MONTHS[parseInt(month)]}_${year}.xlsx`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(buf));
});

/**
 * GET /api/payroll/debug-advance/:code
 * Debug endpoint to trace advance recovery chain
 */
router.get('/debug-advance/:code', (req, res) => {
  const db = getDb();
  const { code } = req.params;
  const { month, year } = req.query;

  const advByMonth = db.prepare('SELECT * FROM salary_advances WHERE employee_code = ? AND month = ? AND year = ?').all(code, month, year);
  const advByRecovery = db.prepare('SELECT * FROM salary_advances WHERE employee_code = ? AND recovery_month = ? AND recovery_year = ?').all(code, month, year);
  const allAdv = db.prepare('SELECT id, employee_code, month, year, advance_amount, paid, recovered, recovery_month, recovery_year, remark, is_eligible FROM salary_advances WHERE employee_code = ?').all(code);
  const salComp = db.prepare('SELECT employee_code, company, advance_recovery, total_deductions, net_salary, gross_earned FROM salary_computations WHERE employee_code = ? AND month = ? AND year = ?').all(code, month, year);

  // Simulate the query
  let simulated = 0;
  let simError = null;
  try {
    db.prepare(`UPDATE salary_advances SET recovered = 0 WHERE employee_code = ? AND recovered = 1
      AND ((recovery_month = ? AND recovery_year = ?) OR (month = ? AND year = ? AND recovery_month IS NULL))`).run(code, month, year, month, year);
    const adv = db.prepare(`SELECT SUM(advance_amount) as total FROM salary_advances
      WHERE employee_code = ? AND recovered = 0 AND advance_amount > 0
      AND (remark IS NULL OR remark != 'NO_ADVANCE')
      AND ((recovery_month = ? AND recovery_year = ?) OR (month = ? AND year = ? AND recovery_month IS NULL))`).get(code, month, year, month, year);
    simulated = adv?.total || 0;
  } catch (e) { simError = e.message; }

  const totalAdvCount = db.prepare('SELECT COUNT(*) as cnt FROM salary_advances WHERE month = ? AND year = ?').get(month, year);

  res.json({
    employee_code: code, month, year,
    advances_by_month: advByMonth,
    advances_by_recovery_month: advByRecovery,
    all_advances_for_employee: allAdv,
    salary_computations: salComp,
    simulated_recovery: simulated,
    simulated_error: simError,
    total_advances_this_month: totalAdvCount?.cnt || 0
  });
});

// ═══════════════════════════════════════════════════════════════
// PAYABLE OT / EXTRA DUTY REGISTER
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/payroll/payable-ot
 * OT register — all employees with OT details for a month
 */
router.get('/payable-ot', (req, res) => {
  const db = getDb();
  const { month, year, company } = req.query;
  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });

  const m = parseInt(month);
  const y = parseInt(year);

  const rawRecords = db.prepare(`
    SELECT
      sc.employee_code,
      COALESCE(NULLIF(e.name, ''), sc.employee_code) as employee_name,
      e.department, e.designation, e.employment_type,
      dc.days_present, dc.days_half_present, dc.days_wop,
      dc.paid_sundays, dc.paid_holidays, dc.extra_duty_days, dc.total_payable_days,
      dc.finance_ed_days,
      sc.gross_salary, sc.ot_pay, sc.ot_days, sc.ot_daily_rate,
      sc.punch_based_ot, sc.finance_extra_duty, sc.ot_note,
      sc.ed_days, sc.ed_pay, sc.take_home,
      sc.gross_earned, sc.net_salary, sc.total_payable,
      sc.is_finalised, sc.is_contractor, sc.company
    FROM salary_computations sc
    LEFT JOIN employees e ON sc.employee_code = e.code
    LEFT JOIN day_calculations dc ON sc.employee_code = dc.employee_code
      AND sc.month = dc.month AND sc.year = dc.year
    WHERE sc.month = ? AND sc.year = ?
    ${company ? 'AND sc.company = ?' : ''}
    AND (e.status IS NULL OR e.status != 'Left')
    ORDER BY sc.ed_pay DESC, sc.ot_pay DESC, e.department, e.name
  `).all(...(company ? [m, y, company] : [m, y]));

  // Synthesise the per-row total_due (= ot_pay + ed_pay) so the UI doesn't have
  // to repeat the addition. Done in JS — adding it to the SELECT would require
  // ORDER BY column gymnastics on a SQLite UNION-style derived field.
  const records = rawRecords.map(r => ({
    ...r,
    punch_ot_days: Math.round(((r.ot_days || r.punch_based_ot || 0)) * 100) / 100,
    fin_ed_days: Math.round(((r.ed_days || 0)) * 100) / 100,
    total_ot_ed_days: Math.round((((r.ot_days || 0) + (r.ed_days || 0))) * 100) / 100,
    total_due: Math.round((((r.ot_pay || 0) + (r.ed_pay || 0))) * 100) / 100
  }));

  const daysInMonth = new Date(y, m, 0).getDate();
  let sundaysInMonth = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(y, m - 1, d).getDay() === 0) sundaysInMonth++;
  }
  const standardWorkingDays = daysInMonth - sundaysInMonth;

  // A row is on the OT/ED register if it has either bucket populated. The
  // legacy "no OT" group is anything that has neither.
  const otRecords = records.filter(r => (r.ot_pay || 0) > 0 || (r.ed_pay || 0) > 0);

  const totalOTDays = otRecords.reduce((s, r) => s + (r.ot_days || 0), 0);
  const totalEDDays = otRecords.reduce((s, r) => s + (r.ed_days || 0), 0);
  const totalOTPay = otRecords.reduce((s, r) => s + (r.ot_pay || 0), 0);
  const totalEDPay = otRecords.reduce((s, r) => s + (r.ed_pay || 0), 0);
  const totalCombinedPay = totalOTPay + totalEDPay;
  const totalPunchOT = otRecords.reduce((s, r) => s + (r.punch_based_ot || 0), 0);
  const totalFinanceED = otRecords.reduce((s, r) => s + (r.finance_extra_duty || 0), 0);
  const employeesWithOT = otRecords.filter(r => (r.ot_pay || 0) > 0).length;
  const employeesWithED = otRecords.filter(r => (r.ed_pay || 0) > 0).length;

  res.json({
    success: true,
    data: records,
    otRecords,
    summary: {
      totalEmployees: records.length,
      employeesWithOT,
      employeesWithED,
      employeesWithoutOT: records.length - otRecords.length,
      totalOTDays: Math.round(totalOTDays * 100) / 100,
      totalEDDays: Math.round(totalEDDays * 100) / 100,
      totalOTPay: Math.round(totalOTPay * 100) / 100,
      totalEDPay: Math.round(totalEDPay * 100) / 100,
      totalCombinedPay: Math.round(totalCombinedPay * 100) / 100,
      totalPunchOT: Math.round(totalPunchOT * 100) / 100,
      totalFinanceED: Math.round(totalFinanceED * 100) / 100,
      daysInMonth, sundaysInMonth, standardWorkingDays,
      avgOTDailyRate: otRecords.length > 0
        ? Math.round(otRecords.reduce((s, r) => s + (r.ot_daily_rate || 0), 0) / otRecords.length)
        : 0
    }
  });
});

/**
 * POST /api/payroll/grant-extra-duty
 * Finance grants extra duty days to an employee. Stored in day_corrections
 * with correction_type='extra_duty' + finance_verified=1. Reuses the existing
 * correction_delta column for the day count so the NOT NULL constraints on
 * the table are satisfied.
 */
router.post('/grant-extra-duty', (req, res) => {
  const db = getDb();
  const { employeeCode, month, year, days, remark } = req.body;

  if (!employeeCode || !month || !year || !days) {
    return res.status(400).json({ success: false, error: 'employeeCode, month, year, days required' });
  }
  const n = parseFloat(days);
  if (isNaN(n) || n <= 0 || n > 10) {
    return res.status(400).json({ success: false, error: 'days must be a number 1..10' });
  }

  const emp = db.prepare('SELECT id, company FROM employees WHERE code = ?').get(employeeCode);
  if (!emp) return res.status(404).json({ success: false, error: 'Employee not found' });
  const user = req.user?.username || 'finance';

  try {
    // day_corrections has a UNIQUE(employee_code, month, year, company) constraint.
    // To allow multiple extra-duty grants per employee/month, we must UPDATE the
    // existing row's delta instead of inserting a duplicate. For a fresh employee,
    // INSERT the row with correction_type='extra_duty'.
    const existing = db.prepare(
      "SELECT id, correction_delta, correction_type FROM day_corrections WHERE employee_code = ? AND month = ? AND year = ? AND COALESCE(company, '') = COALESCE(?, '')"
    ).get(employeeCode, month, year, emp.company || '');

    if (existing) {
      // Only add to delta if the existing row is already an extra_duty grant;
      // otherwise refuse to avoid clobbering an unrelated day correction.
      if (existing.correction_type !== 'extra_duty') {
        return res.status(409).json({
          success: false,
          error: 'An existing day correction (non-extra-duty) blocks this grant. Review the Corrections page first.'
        });
      }
      db.prepare(`
        UPDATE day_corrections SET
          correction_delta = COALESCE(correction_delta, 0) + ?,
          corrected_days = COALESCE(corrected_days, 0) + ?,
          remark = ?,
          finance_verified = 1,
          correction_type = 'extra_duty'
        WHERE id = ?
      `).run(n, n, remark || `Extra duty: +${n} day(s) granted by ${user}`, existing.id);
    } else {
      db.prepare(`
        INSERT INTO day_corrections (
          employee_id, employee_code, month, year, company,
          original_system_days, corrected_days, correction_delta,
          correction_reason, correction_notes, corrected_by,
          correction_type, finance_verified, remark
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'EXTRA_DUTY', ?, ?, 'extra_duty', 1, ?)
      `).run(
        emp.id, employeeCode, month, year, emp.company || '',
        n, n,
        remark || `Extra duty: ${n} day(s) granted by finance`,
        user,
        remark || `Extra duty: ${n} day(s) granted by ${user}`
      );
    }

    res.json({ success: true, message: `${n} extra duty day(s) granted to ${employeeCode}. Re-run salary computation to apply.` });
  } catch (e) {
    console.error('grant-extra-duty error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * DELETE /api/payroll/revoke-extra-duty/:id
 */
router.delete('/revoke-extra-duty/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM day_corrections WHERE id = ? AND correction_type = 'extra_duty'").get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'Extra duty grant not found' });
  db.prepare('DELETE FROM day_corrections WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Extra duty revoked. Re-run salary computation to apply.' });
});

/**
 * GET /api/payroll/extra-duty-grants
 * List finance-verified extra duty grants for a month.
 */
router.get('/extra-duty-grants', (req, res) => {
  const db = getDb();
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ success: false, error: 'month and year required' });
  const grants = db.prepare(`
    SELECT dc.id, dc.employee_code, dc.month, dc.year, dc.company,
      dc.correction_delta AS days, dc.remark, dc.correction_notes,
      dc.corrected_by AS granted_by, dc.corrected_at,
      COALESCE(e.name, dc.employee_code) as employee_name, e.department
    FROM day_corrections dc
    LEFT JOIN employees e ON dc.employee_code = e.code
    WHERE dc.month = ? AND dc.year = ? AND dc.correction_type = 'extra_duty'
    ORDER BY dc.corrected_at DESC
  `).all(month, year);
  res.json({ success: true, data: grants });
});

module.exports = router;

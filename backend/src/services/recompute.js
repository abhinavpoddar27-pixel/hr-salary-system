/**
 * Shared Stage 6 / Stage 7 orchestration.
 *
 * Lifted verbatim out of `routes/payroll.js` (POST /calculate-days and
 * POST /compute-salary) so the route, the job queue and the reimport path all
 * run the same code instead of three drifting copies. Behaviour is unchanged
 * apart from two deliberate additions, both documented at their call sites:
 *
 *   1. HR's late deduction is re-applied after saveDayCalculation(). The UPSERT
 *      in dayCalculation.js rewrites total_payable_days and lop_days from
 *      `excluded` but leaves late_deduction_days alone, so before this every
 *      Stage 6 re-run silently handed back days HR had deducted.
 *   2. Rows written by recomputeDays are marked salary_stale = 1; recomputeSalary
 *      clears the flag for the employees it recomputes. That drives the
 *      "needs recompute" banner on Stage 7 — salary never recomputes by itself.
 */

const { calculateDays, saveDayCalculation } = require('./dayCalculation');
const { computeEmployeeSalary, saveSalaryComputation } = require('./salaryComputation');
const { isContractorForPayroll } = require('../utils/employeeClassification');

/**
 * Stage 6 for a company-month.
 *
 * @param {object}   db
 * @param {object}   opts
 * @param {string}  [opts.company]        blank/undefined = every company
 * @param {number}   opts.month
 * @param {number}   opts.year
 * @param {string[]}[opts.employeeCodes]  limit the run to these codes
 * @param {string}  [opts.requestId]
 * @param {boolean} [opts.markStale=true] set salary_stale on the rows written
 * @param {boolean} [opts.stampStage=true] stamp monthly_imports.stage_6_done
 * @param {boolean} [opts.scopeStampToCompany=false] add the company filter to
 *        that stamp. payroll.js has always stamped month+year only and
 *        import.js has always scoped by company; each caller keeps its shape.
 */
function recomputeDays(db, {
  company, month, year, employeeCodes = null, requestId = '',
  markStale = true, stampStage = true, scopeStampToCompany = false,
} = {}) {
  month = parseInt(month, 10);
  year = parseInt(year, 10);
  if (!month || !year) throw new Error('recomputeDays: month and year are required');

  // ── Ghost attendance cleanup ──
  // Rows with no status AND no in_time AND no out_time are "ghost" records.
  // dayCalculation.js already counts them as absent; normalising them here
  // keeps the Stage 5 UI and every other consumer consistent.
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

  // Every employee with attendance this month, including 'Left' ones who came
  // back (they get auto-reactivated below).
  let empCodes = db.prepare(`
    SELECT DISTINCT ap.employee_code
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.month = ? AND ap.year = ? ${company ? 'AND ap.company = ?' : ''}
    AND ap.is_night_out_only = 0
    AND (e.status IS NULL OR e.status NOT IN ('Exited'))
  `).all(...[month, year, company].filter(Boolean)).map((r) => r.employee_code);

  if (Array.isArray(employeeCodes) && employeeCodes.length) {
    const want = new Set(employeeCodes);
    empCodes = empCodes.filter((c) => want.has(c));
  }

  if (empCodes.length) {
    db.prepare(`
      UPDATE employees SET status = 'Active', was_left_returned = 1, updated_at = datetime('now')
      WHERE code IN (${empCodes.map(() => '?').join(',')})
      AND status = 'Left'
    `).run(...empCodes);
  }

  const monthStr = String(month).padStart(2, '0');
  const holidays = db.prepare(`
    SELECT date, name, type, applicable_to
    FROM holidays WHERE date LIKE ?
  `).all(`${year}-${monthStr}-%`);

  const results = [];
  const errors = [];

  console.log(`[${requestId}] Starting day calculation: ${empCodes.length} employees, month=${month} year=${year} company=${company || 'all'}`);

  const wopInsert = db.prepare(`
    INSERT OR IGNORE INTO extra_duty_grants
      (employee_code, employee_id, grant_date, month, year, company,
       grant_type, duty_days, verification_source, remarks,
       linked_attendance_id, status, finance_status, requested_by)
    VALUES (?, ?, ?, ?, ?, ?, 'OVERNIGHT_STAY', ?, 'BIOMETRIC_AUTO',
            'Auto-detected from attendance WOP status', ?, 'PENDING',
            'UNREVIEWED', 'system')
  `);
  const readLate = db.prepare(`
    SELECT total_payable_days, lop_days, late_deduction_days
    FROM day_calculations WHERE employee_code = ? AND month = ? AND year = ?
  `);
  const applyLate = db.prepare(`
    UPDATE day_calculations SET total_payable_days = ?, lop_days = ?
    WHERE employee_code = ? AND month = ? AND year = ?
  `);
  const markStaleStmt = db.prepare(`
    UPDATE day_calculations
    SET salary_stale = 1, leave_recomputed_at = datetime('now')
    WHERE employee_code = ? AND month = ? AND year = ?
  `);

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
          for (const lb of lbs) leaveBalances[lb.leave_type] = lb.balance || 0;
        }

        const empFull = db.prepare('SELECT * FROM employees WHERE code = ?').get(empCode);
        const isContract = isContractorForPayroll(empFull);

        // ── Auto-create PENDING extra_duty_grants from detected WOP days ──
        // Idempotent via UQ (employee_code, grant_date, month, year).
        // Contractors are paid daily and never enter the OT/ED pipeline.
        if (!isContract) {
          for (const rec of records) {
            const status = rec.status_final || rec.status_original || '';
            if (status !== 'WOP' && status !== 'WO½P') continue;
            const dutyDays = status === 'WO½P' ? 0.5 : 1.0;
            wopInsert.run(
              empCode, emp?.id, rec.date, month, year,
              company || rec.company || '', dutyDays, rec.id
            );
          }
        }

        // Finance-approved grants are paid solely through ed_pay in
        // salaryComputation.js — they must never inflate Stage 6's payable days.
        const manualExtraDutyDays = 0;

        // Display-only ED count: grants that don't land on a WOP/WO½P date
        // (those are already inside extra_duty_days). PBA grants are excluded —
        // their days flow through daysPresent via the placeholder row.
        let financeEDDays = 0;
        if (!isContract) {
          try {
            const wopDates = new Set(
              records
                .filter((r) => {
                  const s = r.status_final || r.status_original || '';
                  return s === 'WOP' || s === 'WO½P';
                })
                .map((r) => r.date)
            );
            const approvedGrants = db.prepare(`
              SELECT grant_date, duty_days FROM extra_duty_grants
              WHERE employee_code = ? AND month = ? AND year = ?
                AND status = 'APPROVED' AND finance_status = 'FINANCE_APPROVED'
                AND grant_type != 'PRE_BIOMETRIC_ACTIVATION'
            `).all(empCode, month, year);
            financeEDDays = approvedGrants
              .filter((g) => !wopDates.has(g.grant_date))
              .reduce((sum, g) => sum + (g.duty_days || 0), 0);
          } catch { /* table may predate the grants feature */ }
        }

        // Approved leave + finance-approved comp-off overlapping this month.
        // Balance debiting happens at approval time in leaves.js — Stage 6 is
        // read-only with respect to leave balances.
        const monthStartDate = `${year}-${monthStr}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const monthEndDate = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

        const approvedLeaves = db.prepare(`
          SELECT leave_type, start_date, end_date, days, status
          FROM leave_applications
          WHERE employee_code = ?
            AND status = 'Approved'
            AND start_date <= ?
            AND end_date >= ?
        `).all(empCode, monthEndDate, monthStartDate);

        const approvedCompOff = db.prepare(`
          SELECT start_date, end_date, finance_status
          FROM compensatory_off_requests
          WHERE employee_code = ?
            AND month = ? AND year = ?
            AND finance_status = 'approved'
        `).all(empCode, month, year);

        const calcResult = calculateDays(
          empCode, month, year, company || '',
          records, leaveBalances, holidays,
          {
            isContractor: isContract,
            weeklyOffDay: empFull?.weekly_off_day ?? 0,
            employmentType: empFull?.employment_type || 'Permanent',
            manualExtraDutyDays,
            financeEDDays,
            dateOfJoining: empFull?.date_of_joining || null,
            approvedLeaves,
            approvedCompOff,
          },
          requestId
        );
        calcResult.employeeId = emp?.id;
        saveDayCalculation(db, calcResult);

        // ── Re-apply HR's late deduction ──
        // saveDayCalculation rewrote total_payable_days and lop_days from
        // scratch but left late_deduction_days untouched, so without this the
        // deduction HR entered is silently handed back on every re-run.
        // Mirrors PUT /day-calculations/:code/late-deduction exactly; the
        // subtraction is safe to repeat because payable was just rebuilt.
        const after = readLate.get(empCode, month, year);
        const lateDays = Number(after?.late_deduction_days) || 0;
        if (after && lateDays > 0) {
          applyLate.run(
            Math.max(0, (after.total_payable_days || 0) - lateDays),
            Math.max(0, (after.lop_days || 0) + lateDays),
            empCode, month, year
          );
        }

        if (markStale) markStaleStmt.run(empCode, month, year);

        results.push({ employeeCode: empCode, ...calcResult });
      } catch (err) {
        errors.push({ employeeCode: empCode, error: err.message });
      }
    }
  });
  txn();

  console.log(`[${requestId}] Day calculation complete: ${results.length} OK, ${errors.length} failed`);

  if (stampStage) {
    if (scopeStampToCompany && company) {
      db.prepare('UPDATE monthly_imports SET stage_6_done = 1 WHERE month = ? AND year = ? AND company = ?')
        .run(month, year, company);
    } else {
      db.prepare('UPDATE monthly_imports SET stage_6_done = 1 WHERE month = ? AND year = ?')
        .run(month, year);
    }
  }

  return {
    results,
    errors,
    employeeCount: empCodes.length,
    summary: {
      totalPresent: results.reduce((s, r) => s + (r.daysPresent || 0), 0),
      totalAbsent: results.reduce((s, r) => s + (r.daysAbsent || 0), 0),
      totalPaidSundays: results.reduce((s, r) => s + (r.paidSundays || 0), 0),
      totalLOP: results.reduce((s, r) => s + (r.lopDays || 0), 0),
      avgPayableDays: results.length
        ? results.reduce((s, r) => s + (r.totalPayableDays || 0), 0) / results.length
        : 0,
    },
  };
}

/**
 * Stage 7 for a company-month. Only ever runs because a human asked —
 * nothing in the automation calls this.
 */
function recomputeSalary(db, {
  company, month, year, employeeCodes = null, requestId = '',
  stampStage = true, scopeStampToCompany = false,
} = {}) {
  month = parseInt(month, 10);
  year = parseInt(year, 10);
  if (!month || !year) throw new Error('recomputeSalary: month and year are required');

  let employees = db.prepare(`
    SELECT DISTINCT e.*
    FROM employees e
    INNER JOIN day_calculations dc ON e.code = dc.employee_code
    WHERE dc.month = ? AND dc.year = ?
    ${company ? 'AND dc.company = ?' : ''}
    AND (e.status IS NULL OR e.status NOT IN ('Exited'))
  `).all(...[month, year, company].filter(Boolean));

  if (Array.isArray(employeeCodes) && employeeCodes.length) {
    const want = new Set(employeeCodes);
    employees = employees.filter((e) => want.has(e.code));
  }

  const results = [];
  const errors = [];
  const excluded = [];
  const held = [];

  console.log(`[${requestId}] Starting salary computation: ${employees.length} employees, month=${month} year=${year} company=${company || 'all'}`);

  const clearStale = db.prepare(`
    UPDATE day_calculations SET salary_stale = 0
    WHERE employee_code = ? AND month = ? AND year = ?
  `);

  const txn = db.transaction(() => {
    for (const emp of employees) {
      try {
        const comp = computeEmployeeSalary(db, emp, month, year, company || '', requestId);
        if (comp.success) {
          saveSalaryComputation(db, comp);
          clearStale.run(emp.code, month, year);
          results.push(comp);
          if (comp.salaryHeld) held.push({ code: emp.code, name: emp.name, reason: comp.holdReason });
        } else if (comp.excluded) {
          excluded.push({ code: comp.employeeCode, name: emp.name, reason: comp.reason });
        } else if (comp.silentSkip) {
          // Zero attendance — not an error, just not payable.
        } else {
          errors.push({ employeeCode: emp.code, error: comp.error });
        }
      } catch (perEmpErr) {
        // Per-employee try/catch so one bad row can't roll back the batch and
        // leave Stage 7 stale.
        console.error(`[compute-salary] employee ${emp.code} failed: ${perEmpErr.message}`);
        if (perEmpErr.stack) console.error(perEmpErr.stack.split('\n').slice(0, 5).join('\n'));
        errors.push({ employeeCode: emp.code, error: perEmpErr.message });
      }
    }
  });
  txn();

  if (stampStage) {
    if (scopeStampToCompany && company) {
      db.prepare('UPDATE monthly_imports SET stage_7_done = 1 WHERE month = ? AND year = ? AND company = ?')
        .run(month, year, company);
    } else {
      db.prepare('UPDATE monthly_imports SET stage_7_done = 1 WHERE month = ? AND year = ?')
        .run(month, year);
    }
  }

  console.log(`[${requestId}] Computation complete: ${results.length} OK, ${errors.length} failed, ${held.length} held`);
  return { results, errors, excluded, held, employeeCount: employees.length };
}

/** How many Stage 6 rows are waiting for a Stage 7 recompute. */
function countStaleSalary(db, { company, month, year } = {}) {
  const where = ['salary_stale = 1'];
  const args = [];
  if (month) { where.push('month = ?'); args.push(parseInt(month, 10)); }
  if (year) { where.push('year = ?'); args.push(parseInt(year, 10)); }
  if (company) { where.push('company = ?'); args.push(company); }
  const rows = db.prepare(
    `SELECT employee_code FROM day_calculations WHERE ${where.join(' AND ')} ORDER BY employee_code`
  ).all(...args);
  return { count: rows.length, employeeCodes: rows.map((r) => r.employee_code) };
}

module.exports = { recomputeDays, recomputeSalary, countStaleSalary };

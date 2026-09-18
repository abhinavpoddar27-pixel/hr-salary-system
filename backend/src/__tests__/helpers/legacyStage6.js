/**
 * GOLDEN REFERENCE — generated, do not edit by hand.
 *
 * A verbatim transcription of the Stage 6 orchestration that lived inside
 * `routes/payroll.js` POST /calculate-days on origin/main @3806a6d (lines
 * 34-249), lifted out of the Express handler. The only edits are the function
 * wrapper, `req.requestId` -> 'legacy', and the two `../` require paths
 * rebased for this directory.
 *
 * recomputeParity.test.js runs this and services/recompute.js against two
 * copies of the same database and asserts day_calculations matches field for
 * field, so the extraction can be proved to have changed nothing.
 */
const { calculateDays, saveDayCalculation } = require('../../services/dayCalculation');

function legacyRecomputeDays(db, month, year, company) {
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

  console.log(`[${'legacy'}] Starting day calculation: ${empCodes.length} employees, month=${month} year=${year} company=${company || 'all'}`);

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
        const { isContractorForPayroll } = require('../../utils/employeeClassification');
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

        // ── manualExtraDutyDays retired (April/May 2026) ──
        // Finance-approved extra_duty_grants are now paid SOLELY via the
        // ed_pay bucket in salaryComputation.js. They must NOT inflate
        // Stage 6's totalPayableDays or extra_duty_days, otherwise the
        // same physical duty is paid twice (once via ot_pay from inflated
        // extra_duty_days, again via ed_pay).
        //
        // OT (ot_pay) covers biometric-detected WOP/WO½P overflow only.
        // ED (ed_pay) covers all finance-approved grants — including
        // grants on WOP dates (legitimate day+night dual duty).
        //
        // The financeEDDays block below (display-only) remains untouched.
        const manualExtraDutyDays = 0;

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
            // PBA (PRE_BIOMETRIC_ACTIVATION) grants are excluded: their days
            // already flow through daysPresent via the placeholder
            // attendance_processed row, so counting them here would double-pay.
            const approvedGrants = db.prepare(`
              SELECT grant_date, duty_days FROM extra_duty_grants
              WHERE employee_code = ? AND month = ? AND year = ?
                AND status = 'APPROVED' AND finance_status = 'FINANCE_APPROVED'
                AND grant_type != 'PRE_BIOMETRIC_ACTIVATION'
            `).all(empCode, month, year);
            financeEDDays = approvedGrants
              .filter(g => !wopDates.has(g.grant_date))
              .reduce((sum, g) => sum + (g.duty_days || 0), 0);
          } catch {}
        }

        // ── Phase 2 (April 2026): fetch approved leaves + comp-off grants ──
        // Approved leave_applications that overlap this month and finance-approved
        // compensatory_off_requests for this month. Passed into calculateDays so
        // the pipeline can restore absences (EL → paid, OD → present) and
        // reclassify CL/SL/LWP days as informed-but-unpaid. Balance debiting is
        // already handled at leave-approval time in leaves.js — Stage 6 is read-only.
        const monthStrLeave = String(month).padStart(2, '0');
        const monthStartDate = `${year}-${monthStrLeave}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const monthEndDate = `${year}-${monthStrLeave}-${String(lastDay).padStart(2,'0')}`;

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
        `).all(empCode, parseInt(month), parseInt(year));

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
            dateOfJoining: empFull?.date_of_joining || null,
            // Phase 2 leave integration (April 2026)
            approvedLeaves,
            approvedCompOff
          },
          'legacy'
        );
        calcResult.employeeId = emp?.id;
        saveDayCalculation(db, calcResult);

        // NOTE: The old leave_balances UPDATE block that used to run here
        // (debiting CL/EL on every calculate-days) has been removed in Phase 2.
        // It would now double-debit because leaves.js POST /approve already
        // debits leave_balances at approval time. Stage 6 is read-only w.r.t.
        // leave balances — it only consumes approved leaves to adjust day counts.

        results.push({ employeeCode: empCode, ...calcResult });
      } catch (err) {
        errors.push({ employeeCode: empCode, error: err.message });
      }
    }
  });

  txn();
  console.log(`[${'legacy'}] Day calculation complete: ${results.length} OK, ${errors.length} failed`);
  db.prepare(`UPDATE monthly_imports SET stage_6_done = 1 WHERE month = ? AND year = ?`).run(month, year);
  return { results, errors };
}

module.exports = { legacyRecomputeDays };

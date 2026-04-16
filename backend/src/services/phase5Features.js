/**
 * Phase 5 Features Service
 *
 * 1. Leave accrual (auto-accrue CL/EL after salary finalization)
 * 2. Compliance alerts (statutory deadline detection)
 * 3. Attrition risk scoring
 */

// ── Leave eligibility config (Apr 2026) ──
// Only these employment_types get CL + EL accrual. To extend later (e.g., add
// 'Sales'), append to this array — no other code changes required.
const LEAVE_ELIGIBLE_TYPES = ['Permanent'];

const { isContractorForPayroll } = require('../utils/employeeClassification');

/**
 * CL entitlement for a given year based on effective join month.
 * Effective month = DOJ month (if DOJ day === 1) or DOJ month + 1 (mid-month join).
 * Pre-year joiners treated as January joiners.
 *
 * Table (2026 policy):
 *   Jan-Feb=7, Mar-Apr=6, May-Jun=5, Jul-Aug=4, Sep-Oct=3, Nov-Dec=2
 *
 * Formula: 7 - floor((effectiveMonth - 1) / 2)
 * Edge case: mid-month Dec joiner rolls to Jan of next year → 0 CL.
 */
function computeClEntitlement(dateOfJoining, year) {
  if (!dateOfJoining) return 7;
  const doj = new Date(dateOfJoining);
  if (isNaN(doj)) return 7;
  const dojYear = doj.getUTCFullYear();
  if (dojYear < year) return 7;
  if (dojYear > year) return 0;
  const dojMonth = doj.getUTCMonth() + 1;
  const dojDay = doj.getUTCDate();
  const effectiveMonth = dojDay === 1 ? dojMonth : dojMonth + 1;
  if (effectiveMonth > 12) return 0;
  return Math.max(0, 7 - Math.floor((effectiveMonth - 1) / 2));
}

function _prevMonth(month, year) {
  if (month === 1) return { month: 12, year: year - 1 };
  return { month: month - 1, year };
}

function _getPolicyNumber(db, key, fallback) {
  const row = db.prepare('SELECT value FROM policy_config WHERE key = ?').get(key);
  const v = parseFloat(row?.value);
  return isNaN(v) ? fallback : v;
}

/**
 * 1. LEAVE ACCRUAL (Phase 1 rewrite — April 2026)
 *
 * BUSINESS RULES:
 *  - CL: Opening-balance model. Granted as a year-start block (7 at Jan
 *    for full-year employees, pro-rata for DOJ mid-year) via initCLOpening.
 *    runLeaveAccrual does NOT accrue CL — it only mirrors monthly CL usage
 *    into the ledger.
 *  - EL: Paid-days-driven. The employee must be past their DOJ-based
 *    eligibility floor (policy_config.el_eligibility_days, default 180).
 *    Earned = floor(paid_days_ytd / 20) × rate (policy_config.el_accrual_rate,
 *    default 1). This month's accrual is delta vs the running earned total.
 *  - SL: not accrued here (fixed annual entitlement — handled via Settings).
 *  - Contractors skipped entirely.
 *
 * paid_days_this_month = days_present + days_wop + paid_sundays +
 *                        paid_holidays + (EL days used) + od_days
 *
 * UPSERTs into leave_accrual_ledger so re-running the same (month, year) is
 * idempotent; UPDATEs leave_balances to the new closing balance directly.
 */
function runLeaveAccrual(db, month, year) {
  const results = { accrued: 0, skipped: 0, errors: [] };

  const elRate = _getPolicyNumber(db, 'el_accrual_rate', 1);
  const elEligibilityDays = _getPolicyNumber(db, 'el_eligibility_days', 180);

  // Leave-eligible employees only (see LEAVE_ELIGIBLE_TYPES). Contractors
  // inside these types are still filtered via isContractorForPayroll below.
  const eligiblePlaceholders = LEAVE_ELIGIBLE_TYPES.map(() => '?').join(',');
  const employees = db.prepare(`
    SELECT id, code, date_of_joining, employment_type, is_contractor,
           category, department, company
    FROM employees
    WHERE status = 'Active'
      AND employment_type IN (${eligiblePlaceholders})
  `).all(...LEAVE_ELIGIBLE_TYPES);

  const upsertLedger = db.prepare(`
    INSERT INTO leave_accrual_ledger
      (employee_code, employee_id, year, month, leave_type,
       opening_balance, accrued, used, lapsed, closing_balance,
       paid_days_this_month, paid_days_ytd, el_earned_ytd, company)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_code, year, month, leave_type) DO UPDATE SET
      opening_balance = excluded.opening_balance,
      accrued = excluded.accrued,
      used = excluded.used,
      closing_balance = excluded.closing_balance,
      paid_days_this_month = excluded.paid_days_this_month,
      paid_days_ytd = excluded.paid_days_ytd,
      el_earned_ytd = excluded.el_earned_ytd
  `);

  const upsertBalance = db.prepare(`
    INSERT INTO leave_balances (employee_id, year, leave_type, opening, accrued, used, balance)
    VALUES (?, ?, ?, 0, 0, 0, 0)
    ON CONFLICT(employee_id, year, leave_type) DO NOTHING
  `);
  // CL is a one-time DOJ-based seed per year. ON CONFLICT DO NOTHING ensures
  // subsequent runs don't overwrite an opening that may have been edited.
  const seedClBalance = db.prepare(`
    INSERT INTO leave_balances (employee_id, year, leave_type, opening, accrued, used, balance)
    VALUES (?, ?, 'CL', ?, 0, 0, ?)
    ON CONFLICT(employee_id, year, leave_type) DO NOTHING
  `);
  const updateBalance = db.prepare(`
    UPDATE leave_balances
    SET accrued = ?, used = ?, balance = ?
    WHERE employee_id = ? AND year = ? AND leave_type = ?
  `);

  const prev = _prevMonth(month, year);

  const txn = db.transaction(() => {
    for (const emp of employees) {
      try {
        if (isContractorForPayroll(emp)) { results.skipped++; continue; }

        // Day calculation for this month (no row → nothing to accrue against)
        const dayCalc = db.prepare(`
          SELECT days_present, days_half_present, days_wop, paid_sundays,
                 paid_holidays, COALESCE(od_days, 0) AS od_days
          FROM day_calculations
          WHERE employee_code = ? AND month = ? AND year = ? AND (company = ? OR ? IS NULL)
          LIMIT 1
        `).get(emp.code, month, year, emp.company, emp.company);

        // EL days used this month from approved leave applications
        const elUsed = db.prepare(`
          SELECT COALESCE(SUM(days), 0) AS d
          FROM leave_applications
          WHERE employee_code = ?
            AND leave_type = 'EL'
            AND status = 'Approved'
            AND strftime('%Y-%m', start_date) = ?
        `).get(emp.code, `${year}-${String(month).padStart(2, '0')}`).d || 0;

        const clUsed = db.prepare(`
          SELECT COALESCE(SUM(days), 0) AS d
          FROM leave_applications
          WHERE employee_code = ?
            AND leave_type = 'CL'
            AND status = 'Approved'
            AND strftime('%Y-%m', start_date) = ?
        `).get(emp.code, `${year}-${String(month).padStart(2, '0')}`).d || 0;

        const paidDaysThisMonth = dayCalc
          ? ((dayCalc.days_present || 0)
             + (dayCalc.days_wop || 0)
             + (dayCalc.paid_sundays || 0)
             + (dayCalc.paid_holidays || 0)
             + elUsed
             + (dayCalc.od_days || 0))
          : 0;

        // Previous month's EL ledger row — carries paid_days_ytd + el_earned_ytd
        const prevElRow = db.prepare(`
          SELECT closing_balance, paid_days_ytd, el_earned_ytd
          FROM leave_accrual_ledger
          WHERE employee_code = ? AND year = ? AND month = ? AND leave_type = 'EL'
          LIMIT 1
        `).get(emp.code, prev.year, prev.month);

        // For January, look at prev-year December's closing to carry forward
        // (in practice yearEndLapse zeroes this out, but the code is
        //  defensive — if lapse wasn't run, we keep the running balance).
        const prevElClosing = prevElRow?.closing_balance || 0;
        const prevPaidYtd = prevElRow?.paid_days_ytd || 0;
        const prevElEarnedYtd = prevElRow?.el_earned_ytd || 0;

        // EL eligibility — skip accrual (but still record used) if employee
        // is within the DOJ-based floor.
        let elEligible = true;
        if (emp.date_of_joining) {
          const doj = new Date(emp.date_of_joining);
          const monthStart = new Date(Date.UTC(year, month - 1, 1));
          const daysSinceDoj = (monthStart - doj) / (1000 * 60 * 60 * 24);
          if (daysSinceDoj < elEligibilityDays) elEligible = false;
        }

        const newPaidYtd = prevPaidYtd + paidDaysThisMonth;
        const newElEarnedYtd = elEligible
          ? Math.floor(newPaidYtd / 20) * elRate
          : prevElEarnedYtd;
        const elAccrued = Math.max(0, newElEarnedYtd - prevElEarnedYtd);

        const elOpening = prevElClosing;
        const elClosing = elOpening + elAccrued - elUsed;

        upsertLedger.run(
          emp.code, emp.id, year, month, 'EL',
          elOpening, elAccrued, elUsed, elClosing,
          paidDaysThisMonth, newPaidYtd, newElEarnedYtd, emp.company || null
        );
        upsertBalance.run(emp.id, year, 'EL');
        // The balance row tracks cumulative accrued/used for the year — we
        // derive these from the ledger so re-runs stay idempotent.
        const elYear = db.prepare(`
          SELECT COALESCE(SUM(accrued), 0) AS acc, COALESCE(SUM(used), 0) AS usd
          FROM leave_accrual_ledger
          WHERE employee_code = ? AND year = ? AND leave_type = 'EL'
        `).get(emp.code, year);
        const elBalance = (db.prepare(`
          SELECT opening FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = 'EL'
        `).get(emp.id, year)?.opening || 0) + (elYear.acc || 0) - (elYear.usd || 0);
        updateBalance.run(elYear.acc || 0, elYear.usd || 0, elBalance, emp.id, year, 'EL');

        // ── CL ledger (no accrual here — just mirror usage) ────────
        // First-time-this-year seed of the CL opening via DOJ-based pro-ration.
        // ON CONFLICT DO NOTHING — subsequent months/runs are no-ops, so the
        // opening stays stable (and any manual edit via /adjust is preserved).
        const clEntitlement = computeClEntitlement(emp.date_of_joining, year);
        seedClBalance.run(emp.id, year, clEntitlement, clEntitlement);

        const prevClRow = db.prepare(`
          SELECT closing_balance FROM leave_accrual_ledger
          WHERE employee_code = ? AND year = ? AND month = ? AND leave_type = 'CL'
          LIMIT 1
        `).get(emp.code, prev.year, prev.month);

        // For January, fall back to the current-year opening balance from
        // leave_balances (set by initCLOpening).
        let clOpening = prevClRow?.closing_balance;
        if (clOpening == null) {
          const clBalRow = db.prepare(`
            SELECT opening FROM leave_balances
            WHERE employee_id = ? AND year = ? AND leave_type = 'CL'
          `).get(emp.id, year);
          clOpening = clBalRow?.opening || 0;
        }
        const clClosing = clOpening - clUsed;

        upsertLedger.run(
          emp.code, emp.id, year, month, 'CL',
          clOpening, 0, clUsed, clClosing,
          0, 0, 0, emp.company || null
        );
        upsertBalance.run(emp.id, year, 'CL');
        const clYear = db.prepare(`
          SELECT COALESCE(SUM(used), 0) AS usd
          FROM leave_accrual_ledger
          WHERE employee_code = ? AND year = ? AND leave_type = 'CL'
        `).get(emp.code, year);
        const clOpeningYear = db.prepare(`
          SELECT opening FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = 'CL'
        `).get(emp.id, year)?.opening || 0;
        updateBalance.run(0, clYear.usd || 0, clOpeningYear - (clYear.usd || 0), emp.id, year, 'CL');

        results.accrued++;
      } catch (err) {
        results.errors.push({ code: emp.code, error: err.message });
      }
    }
  });
  txn();

  return results;
}

/**
 * Init CL opening balances for a calendar year.
 *
 * @param {number} year             target year
 * @param {number} deploymentMonth  month at which this system goes live for
 *                                  this tenant — controls pro-rata for
 *                                  existing employees. Defaults to 1 (Jan)
 *                                  meaning a full 7-day grant.
 *
 * For each active permanent employee:
 *   - If DOJ is within `year`, pro-rata by DOJ month.
 *   - Else (employee joined before `year`), pro-rata by deploymentMonth.
 *
 * Writes leave_balances (UPSERT) and seeds leave_accrual_ledger at
 * (year, deploymentMonth, 'CL') with the opening balance.
 */
function initCLOpening(db, year, deploymentMonth = 1) {
  const results = { seeded: 0, skipped: 0, errors: [] };
  const depMonth = Math.max(1, Math.min(12, parseInt(deploymentMonth) || 1));

  // Once-per-year guard — prevents accidental re-runs from wiping audit state.
  // Pattern matches the existing `migration_contractor_flags_v1` guard in schema.js.
  const guardKey = `cl_seed_${year}_v1`;
  const alreadySeeded = db.prepare(
    "SELECT value FROM policy_config WHERE key = ?"
  ).get(guardKey);
  if (alreadySeeded) {
    return {
      seeded: 0,
      skipped: 0,
      errors: [],
      alreadyCompleted: true,
      guardKey,
      completedAt: alreadySeeded.value
    };
  }

  const employees = db.prepare(`
    SELECT id, code, date_of_joining, employment_type, is_contractor,
           category, department, company
    FROM employees
    WHERE status = 'Active'
  `).all();

  // ON CONFLICT DO NOTHING — preserves any manual adjustments made via /adjust
  // or subsequent accrual between two calls of /init-cl-opening. A re-run is
  // safe: it's a no-op for rows that already exist.
  const seedBalance = db.prepare(`
    INSERT INTO leave_balances (employee_id, year, leave_type, opening, accrued, used, balance)
    VALUES (?, ?, 'CL', ?, 0, 0, ?)
    ON CONFLICT(employee_id, year, leave_type) DO NOTHING
  `);
  const seedLedger = db.prepare(`
    INSERT INTO leave_accrual_ledger
      (employee_code, employee_id, year, month, leave_type,
       opening_balance, accrued, used, lapsed, closing_balance,
       paid_days_this_month, paid_days_ytd, el_earned_ytd, company)
    VALUES (?, ?, ?, ?, 'CL', ?, 0, 0, 0, ?, 0, 0, 0, ?)
    ON CONFLICT(employee_code, year, month, leave_type) DO NOTHING
  `);

  const txn = db.transaction(() => {
    for (const emp of employees) {
      try {
        if (isContractorForPayroll(emp)) { results.skipped++; continue; }

        // Ledger month = where the grant is booked; keep existing semantics
        // (DOJ month when joining in target year, else deploymentMonth).
        let ledgerMonth;
        if (emp.date_of_joining) {
          const doj = new Date(emp.date_of_joining);
          if (!isNaN(doj) && doj.getUTCFullYear() === year) {
            ledgerMonth = doj.getUTCMonth() + 1;
          } else {
            ledgerMonth = depMonth;
          }
        } else {
          ledgerMonth = depMonth;
        }

        // Entitlement value uses DOJ-based pro-ration (mid-month rolls forward).
        // Pre-year joiners get the full `depMonth` grant as before.
        const opening = emp.date_of_joining && new Date(emp.date_of_joining).getUTCFullYear() === year
          ? computeClEntitlement(emp.date_of_joining, year)
          : Math.max(0, 7 - Math.floor((depMonth - 1) / 2));
        seedBalance.run(emp.id, year, opening, opening);
        seedLedger.run(
          emp.code, emp.id, year, ledgerMonth,
          opening, opening, emp.company || null
        );
        results.seeded++;
      } catch (err) {
        results.errors.push({ code: emp.code, error: err.message });
      }
    }
  });
  txn();

  // Mark seed complete so /init-cl-opening becomes a no-op on re-runs.
  // Admins can force a re-seed by deleting this row from policy_config.
  // Gated on error-free run only — write happens even when seeded=0 (i.e.
  // rows already existed from a pre-guard deploy) so the UX is clean.
  if (results.errors.length === 0) {
    db.prepare(`
      INSERT OR REPLACE INTO policy_config (key, value, description)
      VALUES (?, ?, ?)
    `).run(
      guardKey,
      new Date().toISOString(),
      `CL opening seed for year ${year} (completed ${results.seeded} employees)`
    );
    results.guardKey = guardKey;
  }

  return results;
}

/**
 * Year-end lapse: both CL and EL lapse. The remaining balance at month 12 is
 * marked as lapsed in leave_accrual_ledger and zeroed in leave_balances. A
 * Year-End Lapse row is written to leave_transactions for audit.
 */
function yearEndLapse(db, year) {
  const results = { lapsed: 0, errors: [] };

  const targets = db.prepare(`
    SELECT lb.employee_id, e.code AS employee_code, lb.leave_type, lb.balance, e.company
    FROM leave_balances lb
    JOIN employees e ON e.id = lb.employee_id
    WHERE lb.year = ?
      AND lb.leave_type IN ('CL', 'EL')
      AND lb.balance > 0
  `).all(year);

  const upsertLedger = db.prepare(`
    INSERT INTO leave_accrual_ledger
      (employee_code, employee_id, year, month, leave_type,
       opening_balance, accrued, used, lapsed, closing_balance,
       paid_days_this_month, paid_days_ytd, el_earned_ytd, company)
    VALUES (?, ?, ?, 12, ?, ?, 0, 0, ?, 0, 0, 0, 0, ?)
    ON CONFLICT(employee_code, year, month, leave_type) DO UPDATE SET
      lapsed = excluded.lapsed,
      closing_balance = 0
  `);
  const zeroBalance = db.prepare(`
    UPDATE leave_balances SET balance = 0
    WHERE employee_id = ? AND year = ? AND leave_type = ?
  `);
  const insertTxn = db.prepare(`
    INSERT INTO leave_transactions
      (employee_id, employee_code, company, leave_type, transaction_type, days,
       balance_after, reference_month, reference_year, reason, approved_by)
    VALUES (?, ?, ?, ?, 'Year-End Lapse', ?, 0, 12, ?, ?, 'system')
  `);

  const txn = db.transaction(() => {
    for (const t of targets) {
      try {
        const lapsed = t.balance;
        upsertLedger.run(
          t.employee_code, t.employee_id, year, t.leave_type,
          lapsed, lapsed, t.company || null
        );
        zeroBalance.run(t.employee_id, year, t.leave_type);
        insertTxn.run(
          t.employee_id, t.employee_code, t.company || null, t.leave_type,
          lapsed, year,
          `Year-end lapse for ${year}: ${lapsed} day(s) of ${t.leave_type}`
        );
        results.lapsed++;
      } catch (err) {
        results.errors.push({ code: t.employee_code, leave_type: t.leave_type, error: err.message });
      }
    }
  });
  txn();

  return results;
}

/**
 * 2. COMPLIANCE ALERTS
 * Check for upcoming statutory deadlines and generate alerts
 */
function generateComplianceAlerts(db, month, year) {
  const alerts = [];
  const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // PF ECR due date: 15th of following month
  const pfDueMonth = month === 12 ? 1 : month + 1;
  const pfDueYear = month === 12 ? year + 1 : year;
  const pfDueDate = `${pfDueYear}-${String(pfDueMonth).padStart(2,'0')}-15`;
  const today = new Date().toISOString().slice(0, 10);
  const daysUntilPF = Math.ceil((new Date(pfDueDate) - new Date(today)) / 86400000);

  if (daysUntilPF <= 10 && daysUntilPF > 0) {
    alerts.push({
      type: 'COMPLIANCE', severity: 'High',
      title: `PF ECR Filing Due in ${daysUntilPF} days`,
      description: `PF ECR for ${MONTH_NAMES[month]} ${year} is due on ${pfDueDate}. Ensure all PF-applicable employees are covered.`
    });
  }

  // ESI contribution due date: 15th of following month
  if (daysUntilPF <= 10 && daysUntilPF > 0) {
    alerts.push({
      type: 'COMPLIANCE', severity: 'High',
      title: `ESI Contribution Due in ${daysUntilPF} days`,
      description: `ESI contribution for ${MONTH_NAMES[month]} ${year} is due on ${pfDueDate}.`
    });
  }

  // Gratuity eligibility: employees approaching 5 years
  const gratuityEmps = db.prepare(`
    SELECT code, name, department, date_of_joining,
      CAST((julianday('now') - julianday(date_of_joining)) / 365.25 AS REAL) as years_of_service
    FROM employees
    WHERE status = 'Active' AND date_of_joining IS NOT NULL AND date_of_joining != ''
    AND CAST((julianday('now') - julianday(date_of_joining)) / 365.25 AS REAL) BETWEEN 4.5 AND 5.0
  `).all();

  for (const emp of gratuityEmps) {
    alerts.push({
      type: 'COMPLIANCE', severity: 'Medium',
      title: `Gratuity Eligibility Approaching: ${emp.name}`,
      description: `${emp.name} (${emp.department}) has ${Math.round(emp.years_of_service * 10) / 10} years of service. Will become gratuity-eligible at 5 years.`,
      employee_code: emp.code
    });
  }

  // Bonus applicability: employees with >30 days service in the year
  const bonusMonth = 3; // March — annual bonus calculation period
  if (month === bonusMonth) {
    const bonusCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM employees
      WHERE status = 'Active' AND date_of_joining IS NOT NULL
      AND date_of_joining <= ? AND gross_salary <= 21000
    `).get(`${year}-${String(bonusMonth).padStart(2,'0')}-31`);

    if (bonusCount.cnt > 0) {
      alerts.push({
        type: 'COMPLIANCE', severity: 'Medium',
        title: `Bonus Calculation Due for ${bonusCount.cnt} Employees`,
        description: `${bonusCount.cnt} employees with gross <= 21,000 are eligible for statutory bonus calculation for FY ${year-1}-${year}.`
      });
    }
  }

  // Save to alerts table
  const insertAlert = db.prepare(`
    INSERT OR IGNORE INTO alerts (type, severity, employee_code, month, year, title, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const a of alerts) {
    insertAlert.run(a.type, a.severity, a.employee_code || null, month, year, a.title, a.description);
  }

  return alerts;
}

/**
 * 3. ATTRITION RISK SCORING
 * Score 0-100 based on behavioral patterns:
 * - Declining regularity (30%)
 * - Increasing absence (25%)
 * - Declining hours (20%)
 * - High late rate (15%)
 * - Tenure <6 months (10%)
 */
function computeAttritionRisk(db, month, year) {
  const employees = db.prepare(`
    SELECT DISTINCT ap.employee_code, e.name, e.department, e.company,
           e.date_of_joining, e.employment_type
    FROM attendance_processed ap
    LEFT JOIN employees e ON ap.employee_code = e.code
    WHERE ap.month = ? AND ap.year = ? AND ap.is_night_out_only = 0
    AND e.status = 'Active'
  `).all(month, year);

  const results = [];

  // Previous 3 months for trend comparison
  const prevMonths = [];
  for (let i = 1; i <= 3; i++) {
    let m = month - i, y = year;
    while (m <= 0) { m += 12; y--; }
    prevMonths.push({ month: m, year: y });
  }

  for (const emp of employees) {
    let score = 0;
    const factors = [];

    // Current month stats
    const curr = db.prepare(`
      SELECT
        COUNT(CASE WHEN strftime('%w', date) != '0' THEN 1 END) as total_days,
        SUM(CASE WHEN (status_final IN ('P','WOP') OR status_original IN ('P','WOP')) THEN 1.0
                 WHEN (status_final IN ('½P','WO½P') OR status_original IN ('½P','WO½P')) THEN 0.5 ELSE 0 END) as present,
        SUM(CASE WHEN is_late_arrival = 1 THEN 1 ELSE 0 END) as late,
        AVG(CASE WHEN actual_hours > 0 THEN actual_hours END) as avg_hours
      FROM attendance_processed
      WHERE employee_code = ? AND month = ? AND year = ? AND is_night_out_only = 0
    `).get(emp.employee_code, month, year);

    if (!curr || curr.total_days < 5) continue;

    const currAttRate = curr.total_days > 0 ? curr.present / curr.total_days : 0;
    const currLateRate = curr.present > 0 ? curr.late / curr.present : 0;

    // Previous months average
    let prevAttSum = 0, prevLateSum = 0, prevHoursSum = 0, prevCount = 0;
    for (const pm of prevMonths) {
      const prev = db.prepare(`
        SELECT
          COUNT(CASE WHEN strftime('%w', date) != '0' THEN 1 END) as total_days,
          SUM(CASE WHEN (status_final IN ('P','WOP') OR status_original IN ('P','WOP')) THEN 1.0
                   WHEN (status_final IN ('½P','WO½P') OR status_original IN ('½P','WO½P')) THEN 0.5 ELSE 0 END) as present,
          SUM(CASE WHEN is_late_arrival = 1 THEN 1 ELSE 0 END) as late,
          AVG(CASE WHEN actual_hours > 0 THEN actual_hours END) as avg_hours
        FROM attendance_processed
        WHERE employee_code = ? AND month = ? AND year = ? AND is_night_out_only = 0
      `).get(emp.employee_code, pm.month, pm.year);
      if (prev && prev.total_days > 5) {
        prevAttSum += (prev.present / prev.total_days);
        prevLateSum += (prev.present > 0 ? prev.late / prev.present : 0);
        prevHoursSum += (prev.avg_hours || 0);
        prevCount++;
      }
    }

    // Factor 1: Declining attendance (25%)
    if (prevCount >= 2) {
      const prevAvgAtt = prevAttSum / prevCount;
      const attDecline = prevAvgAtt - currAttRate;
      if (attDecline > 0.15) { score += 25; factors.push('Attendance dropped significantly'); }
      else if (attDecline > 0.05) { score += 15; factors.push('Attendance declining'); }
    }

    // Factor 2: Low current attendance (25% absolute)
    if (currAttRate < 0.50) { score += 25; factors.push('Very low attendance (<50%)'); }
    else if (currAttRate < 0.70) { score += 15; factors.push('Below average attendance'); }

    // Factor 3: Declining hours (20%)
    if (prevCount >= 2 && curr.avg_hours) {
      const prevAvgHrs = prevHoursSum / prevCount;
      if (prevAvgHrs > 0 && curr.avg_hours < prevAvgHrs * 0.85) {
        score += 20; factors.push('Working hours declining');
      }
    }

    // Factor 4: High late rate (15%)
    if (currLateRate > 0.50) { score += 15; factors.push('Frequently late (>50%)'); }
    else if (currLateRate > 0.30) { score += 8; factors.push('Often late'); }

    // Factor 5: Short tenure (10%)
    if (emp.date_of_joining) {
      const tenureMonths = (new Date() - new Date(emp.date_of_joining)) / (1000 * 60 * 60 * 24 * 30);
      if (tenureMonths < 6) { score += 10; factors.push('Short tenure (<6 months)'); }
      else if (tenureMonths < 12) { score += 5; factors.push('Relatively new (<12 months)'); }
    }

    score = Math.min(100, score);

    if (score >= 30) {
      results.push({
        code: emp.employee_code,
        name: emp.name,
        department: emp.department,
        company: emp.company,
        employmentType: emp.employment_type,
        riskScore: score,
        riskLevel: score >= 70 ? 'High' : score >= 50 ? 'Medium' : 'Low',
        factors,
        attendanceRate: Math.round(currAttRate * 100),
        lateRate: Math.round(currLateRate * 100),
        avgHours: curr.avg_hours ? Math.round(curr.avg_hours * 10) / 10 : null
      });
    }
  }

  return results.sort((a, b) => b.riskScore - a.riskScore);
}

// TEMP TEST BLOCK — remove after verification
// console.log('CL entitlement tests (year=2026):');
// console.log('  Pre-2026 (2024-05-10):', computeClEntitlement('2024-05-10', 2026), '→ expected 7');
// console.log('  Jan 1 2026:', computeClEntitlement('2026-01-01', 2026), '→ expected 7');
// console.log('  Jan 15 2026:', computeClEntitlement('2026-01-15', 2026), '→ expected 7 (Feb start)');
// console.log('  Feb 1 2026:', computeClEntitlement('2026-02-01', 2026), '→ expected 7');
// console.log('  Mar 1 2026:', computeClEntitlement('2026-03-01', 2026), '→ expected 6');
// console.log('  Mar 25 2026:', computeClEntitlement('2026-03-25', 2026), '→ expected 6 (Apr start)');
// console.log('  Jul 1 2026:', computeClEntitlement('2026-07-01', 2026), '→ expected 4');
// console.log('  Dec 1 2026:', computeClEntitlement('2026-12-01', 2026), '→ expected 2');
// console.log('  Dec 15 2026:', computeClEntitlement('2026-12-15', 2026), '→ expected 0 (rolls to Jan 2027)');
// console.log('  Null DOJ:', computeClEntitlement(null, 2026), '→ expected 7 (treated as pre-year)');
// console.log('  2027 DOJ:', computeClEntitlement('2027-03-01', 2026), '→ expected 0');

module.exports = {
  runLeaveAccrual,
  initCLOpening,
  yearEndLapse,
  generateComplianceAlerts,
  computeAttritionRisk
};

/**
 * Leave Engine (Sept 2026)
 * ────────────────────────────────────────────────────────────────────────────
 * One place that decides what every permanent employee's CL and EL balance
 * should be. Split deliberately into:
 *
 *   computeLeavePlan()  pure — reads, never writes. Recomputes the whole year
 *                       from January on every call, so a skipped month can
 *                       never reset a running total.
 *   applyLeavePlan()    the only writer. Refuses to run unless the owner has
 *                       switched automation on (or the caller passes
 *                       allowWrite) AND the outside-the-system EL list has
 *                       either been uploaded or explicitly acknowledged empty.
 *
 * Rules implemented (owner rulings, Sept 2026):
 *   • Days worked = days_present + 0.5 × days_half_present + days_wop + el_used.
 *     Paid Sundays and paid holidays do NOT count. od_days is NOT added —
 *     dayCalculation.js:437 already folds approved comp-off into days_present.
 *   • EL: nothing accrues until `el_eligibility_days` (180) days worked in the
 *     same calendar year. At or above it,
 *     earned = floor(days_worked_ytd / el_days_per_leave) × el_accrual_rate.
 *   • CL: a single yearly opening from computeClEntitlement(), pro-rated by
 *     joining month off `cl_entitlement_base` (7). No monthly accrual.
 *   • CL and EL both lapse on 31 Dec. No carry-forward, no encashment.
 */

const { isContractorForPayroll } = require('../utils/employeeClassification');
const { computeClEntitlement } = require('./phase5Features');
const { getMonthDates, getDayOfWeek } = require('./dayCalculation');

/** employment_type values that get CL + EL. Mirrors phase5Features.js:12. */
const LEAVE_ELIGIBLE_TYPES = ['permanent'];
const LEAVE_TYPES = ['CL', 'EL'];

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function getPolicy(db, key, fallback) {
  const row = db.prepare('SELECT value FROM policy_config WHERE key = ?').get(key);
  return row ? String(row.value) : fallback;
}

function getPolicyNumber(db, key, fallback) {
  const v = parseFloat(getPolicy(db, key, null));
  return Number.isNaN(v) ? fallback : v;
}

function getPolicyBool(db, key, fallback) {
  const v = getPolicy(db, key, null);
  if (v === null || v === undefined) return fallback;
  return String(v).trim().toLowerCase() === 'true';
}

/** Server clock is UTC; the plant runs on IST. Anchor "today" to IST. */
function istNow() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

function istToday() {
  const d = istNow();
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    iso: d.toISOString().slice(0, 10),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Employee selection
// ────────────────────────────────────────────────────────────────────────────

function selectEligibleEmployees(db, employeeCodes) {
  let sql = `
    SELECT id, code, name, date_of_joining, employment_type, is_contractor,
           department, company, weekly_off_day, status
    FROM employees
    WHERE status = 'Active'
      AND LOWER(TRIM(COALESCE(employment_type, ''))) IN (${LEAVE_ELIGIBLE_TYPES.map(() => '?').join(',')})
  `;
  const args = [...LEAVE_ELIGIBLE_TYPES];
  if (Array.isArray(employeeCodes) && employeeCodes.length) {
    sql += ` AND code IN (${employeeCodes.map(() => '?').join(',')})`;
    args.push(...employeeCodes);
  }
  sql += ' ORDER BY code';
  return db.prepare(sql).all(...args).filter((e) => !isContractorForPayroll(e));
}

// ────────────────────────────────────────────────────────────────────────────
// Finance-correction rows inside leave_transactions
// ────────────────────────────────────────────────────────────────────────────
/**
 * `leave_transactions` has four writers: the year-end lapse, /adjust,
 * /bulk-adjust and the finance apply-leave screen. Only the first three are
 * "manual adjustments"; the finance screen's rows mirror an attendance
 * correction that day_calculations already counts, so counting them again
 * would debit the employee twice.
 *
 * Finance rows always look the same: transaction_type='Debit', days=1, written
 * alongside an attendance_processed row stamped correction_source='leave_correction'.
 * So for each (employee, type, month, year) we count those attendance rows and
 * consume that many Debit/days=1 transactions. Everything left is manual.
 *
 * Deliberately NOT keyed on approved_by: leaves.js hardcodes 'admin' there, and
 * a real admin user would collide with it.
 */
function partitionTransactions(db, year, codes) {
  const inList = codes.length ? ` AND employee_code IN (${codes.map(() => '?').join(',')})` : '';
  const rows = db.prepare(`
    SELECT id, employee_code, leave_type, transaction_type, days,
           reference_month, reference_year, reason, approved_by, created_at
    FROM leave_transactions
    WHERE reference_year = ?
      AND transaction_type IN ('Credit', 'Debit')
      AND leave_type IN ('CL', 'EL')${inList}
    ORDER BY employee_code, leave_type, reference_month, id
  `).all(year, ...codes);

  const financeCount = new Map(); // code|type|month -> remaining finance rows to absorb
  const countStmt = db.prepare(`
    SELECT COUNT(*) AS c FROM attendance_processed
    WHERE employee_code = ?
      AND correction_source = 'leave_correction'
      AND status_final = ?
      AND date LIKE ?
  `);

  const manual = [];
  const finance = [];
  for (const t of rows) {
    const month = Number(t.reference_month) || 0;
    const looksFinance = t.transaction_type === 'Debit' && Number(t.days) === 1 && month >= 1 && month <= 12;
    if (!looksFinance) { manual.push(t); continue; }
    const key = `${t.employee_code}|${t.leave_type}|${month}`;
    if (!financeCount.has(key)) {
      const like = `${year}-${String(month).padStart(2, '0')}-%`;
      financeCount.set(key, countStmt.get(t.employee_code, t.leave_type, like)?.c || 0);
    }
    const left = financeCount.get(key);
    if (left > 0) { financeCount.set(key, left - 1); finance.push(t); }
    else manual.push(t);
  }
  return { manual, finance };
}

// ────────────────────────────────────────────────────────────────────────────
// Day-by-day expansion of approved applications (months with no Stage-6 row)
// ────────────────────────────────────────────────────────────────────────────

function expandApplications(apps, month, year, weeklyOffDay, holidaySet) {
  const perType = { CL: 0, EL: 0 };
  const monthDates = new Set(getMonthDates(month, year));
  for (const app of apps) {
    if (!LEAVE_TYPES.includes(app.leave_type)) continue;
    const start = String(app.start_date || '').slice(0, 10);
    const end = String(app.end_date || start).slice(0, 10);
    if (!start) continue;
    for (const date of eachDate(start, end)) {
      if (!monthDates.has(date)) continue;
      if (getDayOfWeek(date) === weeklyOffDay) continue;
      if (holidaySet.has(date)) continue;
      perType[app.leave_type] += 1;
    }
  }
  return perType;
}

/** Inclusive YYYY-MM-DD walk. Local to this module so dayCalculation.js stays untouched. */
function eachDate(start, end) {
  const out = [];
  const s = new Date(`${start}T12:00:00Z`);
  const e = new Date(`${end}T12:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return out;
  const cur = new Date(s);
  let guard = 0;
  while (cur <= e && guard < 400) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard += 1;
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// computeLeavePlan — pure
// ────────────────────────────────────────────────────────────────────────────

function computeLeavePlan(db, { year, employeeCodes = null } = {}) {
  const yr = Number(year);
  if (!yr) throw new Error('computeLeavePlan: year is required');

  const elRate = getPolicyNumber(db, 'el_accrual_rate', 1);
  const elEligibilityDays = getPolicyNumber(db, 'el_eligibility_days', 180);
  const elDaysPerLeave = getPolicyNumber(db, 'el_days_per_leave', 20) || 20;
  const clBase = getPolicyNumber(db, 'cl_entitlement_base', 7);

  const employees = selectEligibleEmployees(db, employeeCodes);
  const codes = employees.map((e) => e.code);

  const holidaySet = new Set(
    db.prepare(`SELECT date FROM holidays WHERE date LIKE ? AND COALESCE(is_active, 1) = 1`)
      .all(`${yr}-%`)
      .map((h) => String(h.date).slice(0, 10))
  );

  const { manual, finance } = partitionTransactions(db, yr, codes);
  const adjIndex = new Map(); // code|type|month -> net days
  for (const t of manual) {
    const key = `${t.employee_code}|${t.leave_type}|${Number(t.reference_month) || 0}`;
    const signed = (t.transaction_type === 'Credit' ? 1 : -1) * (Number(t.days) || 0);
    adjIndex.set(key, (adjIndex.get(key) || 0) + signed);
  }

  // How far into the year to walk. Never past the current IST month, but always
  // far enough to cover any month that actually carries data.
  const today = istToday();
  let maxMonth = yr < today.year ? 12 : yr > today.year ? 0 : today.month;
  const dataMax = db.prepare(`
    SELECT MAX(m) AS m FROM (
      SELECT MAX(month) AS m FROM day_calculations WHERE year = ?
      UNION ALL SELECT MAX(month) FROM leave_external_grants WHERE year = ? AND is_active = 1
      UNION ALL SELECT MAX(CAST(strftime('%m', start_date) AS INTEGER))
                FROM leave_applications WHERE status = 'Approved' AND strftime('%Y', start_date) = ?
    )
  `).get(yr, yr, String(yr))?.m;
  if (dataMax && dataMax > maxMonth) maxMonth = Math.min(12, dataMax);

  const dayCalcStmt = db.prepare(`
    SELECT COALESCE(SUM(days_present), 0)      AS days_present,
           COALESCE(SUM(days_half_present), 0) AS days_half_present,
           COALESCE(SUM(days_wop), 0)          AS days_wop,
           COALESCE(SUM(el_used), 0)           AS el_used,
           COALESCE(SUM(cl_used), 0)           AS cl_used,
           COUNT(*)                            AS row_count
    FROM day_calculations
    WHERE employee_code = ? AND month = ? AND year = ?
  `); // deliberately NOT filtered by company — employees stored with a blank or
      // 'null' company used to earn nothing (defect e).

  const appsStmt = db.prepare(`
    SELECT leave_type, start_date, end_date, days
    FROM leave_applications
    WHERE employee_code = ? AND status = 'Approved'
      AND date(start_date) <= date(?) AND date(COALESCE(end_date, start_date)) >= date(?)
  `);

  const extStmt = db.prepare(`
    SELECT leave_type, mode, COALESCE(SUM(days), 0) AS days
    FROM leave_external_grants
    WHERE employee_code = ? AND year = ? AND month = ? AND is_active = 1
    GROUP BY leave_type, mode
  `);

  const balStmt = db.prepare(
    'SELECT opening, accrued, used, balance FROM leave_balances WHERE employee_id = ? AND year = ? AND leave_type = ?'
  );

  const ledgerRows = [];
  const summaries = [];

  for (const emp of employees) {
    const weeklyOffDay = Number.isInteger(emp.weekly_off_day) ? emp.weekly_off_day : 0;
    const computedClOpening = computeClEntitlement(emp.date_of_joining, yr, clBase);
    const storedCl = balStmt.get(emp.id, yr, 'CL');
    const storedEl = balStmt.get(emp.id, yr, 'EL');
    // Respect an opening HR set by hand; only fall back to the computed
    // entitlement when there is no row yet (see DECISION D4).
    const clOpening = storedCl ? Number(storedCl.opening) || 0 : computedClOpening;
    const elOpening = storedEl ? Number(storedEl.opening) || 0 : 0;

    const acc = {
      daysWorkedYtd: 0,
      elEarnedYtd: 0,
      used: { CL: 0, EL: 0 },
      external: { CL: 0, EL: 0 },
      adj: { CL: 0, EL: 0 },
    };
    const reasons = [];
    let monthsWithoutDayCalc = 0;

    for (let m = 1; m <= maxMonth; m += 1) {
      const dc = dayCalcStmt.get(emp.code, m, yr);
      const hasDayCalc = (dc?.row_count || 0) > 0;

      // External grants for this month.
      const ext = { CL: 0, EL: 0 };
      let extWorked = 0;
      for (const row of extStmt.all(emp.code, yr, m)) {
        const t = LEAVE_TYPES.includes(row.leave_type) ? row.leave_type : 'EL';
        ext[t] += Number(row.days) || 0;
        if (row.mode === 'leave_taken') extWorked += Number(row.days) || 0;
      }

      let elUsed = 0;
      let clUsed = 0;
      if (hasDayCalc) {
        elUsed = Number(dc.el_used) || 0;
        clUsed = Number(dc.cl_used) || 0;
      } else {
        monthsWithoutDayCalc += 1;
        const first = `${yr}-${String(m).padStart(2, '0')}-01`;
        const last = getMonthDates(m, yr).slice(-1)[0] || first;
        const apps = appsStmt.all(emp.code, last, first);
        const exp = expandApplications(apps, m, yr, weeklyOffDay, holidaySet);
        elUsed = exp.EL;
        clUsed = exp.CL;
      }

      // Ruling 1. od_days is intentionally absent — comp-off is already inside
      // days_present (dayCalculation.js:437).
      const daysWorkedMonth = hasDayCalc
        ? (Number(dc.days_present) || 0)
          + 0.5 * (Number(dc.days_half_present) || 0)
          + (Number(dc.days_wop) || 0)
          + elUsed
        : 0;
      const workedThisMonth = r2(daysWorkedMonth + extWorked);

      const beforeEarned = acc.elEarnedYtd;
      acc.daysWorkedYtd = r2(acc.daysWorkedYtd + workedThisMonth);
      acc.elEarnedYtd = acc.daysWorkedYtd >= elEligibilityDays
        ? r2(Math.floor(acc.daysWorkedYtd / elDaysPerLeave) * elRate)
        : 0;
      const accruedThisMonth = r2(acc.elEarnedYtd - beforeEarned);

      acc.used.EL = r2(acc.used.EL + elUsed);
      acc.used.CL = r2(acc.used.CL + clUsed);
      acc.external.EL = r2(acc.external.EL + ext.EL);
      acc.external.CL = r2(acc.external.CL + ext.CL);
      acc.adj.EL = r2(acc.adj.EL + (adjIndex.get(`${emp.code}|EL|${m}`) || 0));
      acc.adj.CL = r2(acc.adj.CL + (adjIndex.get(`${emp.code}|CL|${m}`) || 0));

      const elClosing = r2(elOpening + acc.elEarnedYtd - acc.used.EL - acc.external.EL + acc.adj.EL);
      const clClosing = r2(clOpening - acc.used.CL - acc.external.CL + acc.adj.CL);

      ledgerRows.push({
        employee_code: emp.code,
        employee_id: emp.id,
        year: yr,
        month: m,
        leave_type: 'EL',
        opening_balance: r2(elOpening + beforeEarned - (acc.used.EL - elUsed) - (acc.external.EL - ext.EL)
          - (acc.adj.EL - (adjIndex.get(`${emp.code}|EL|${m}`) || 0))),
        accrued: accruedThisMonth,
        used: r2(elUsed + ext.EL),
        closing_balance: elClosing,
        paid_days_this_month: workedThisMonth,
        paid_days_ytd: acc.daysWorkedYtd,
        el_earned_ytd: acc.elEarnedYtd,
        company: emp.company || null,
      });
      ledgerRows.push({
        employee_code: emp.code,
        employee_id: emp.id,
        year: yr,
        month: m,
        leave_type: 'CL',
        opening_balance: r2(clOpening - (acc.used.CL - clUsed) - (acc.external.CL - ext.CL)
          - (acc.adj.CL - (adjIndex.get(`${emp.code}|CL|${m}`) || 0))),
        accrued: 0,
        used: r2(clUsed + ext.CL),
        closing_balance: clClosing,
        paid_days_this_month: workedThisMonth,
        paid_days_ytd: acc.daysWorkedYtd,
        el_earned_ytd: acc.elEarnedYtd,
        company: emp.company || null,
      });
    }

    const newEl = r2(elOpening + acc.elEarnedYtd - acc.used.EL - acc.external.EL + acc.adj.EL);
    const newCl = r2(clOpening - acc.used.CL - acc.external.CL + acc.adj.CL);
    const eligible = acc.daysWorkedYtd >= elEligibilityDays;

    if (!eligible) {
      reasons.push(`${r2(elEligibilityDays - acc.daysWorkedYtd)} more days worked needed before EL accrues`);
    }
    if (storedCl && Number(storedCl.opening) !== computedClOpening) {
      reasons.push(`CL opening on file is ${Number(storedCl.opening)}; entitlement for this DOJ is ${computedClOpening} — opening left untouched`);
    }
    if (monthsWithoutDayCalc > 0) {
      reasons.push(`${monthsWithoutDayCalc} month(s) had no Stage 6 row; leave read from approved applications instead`);
    }
    if (acc.external.EL > 0) reasons.push(`${acc.external.EL} EL day(s) recorded as given outside the system`);
    if (acc.adj.EL !== 0 || acc.adj.CL !== 0) {
      reasons.push(`manual adjustments applied: EL ${acc.adj.EL > 0 ? '+' : ''}${acc.adj.EL}, CL ${acc.adj.CL > 0 ? '+' : ''}${acc.adj.CL}`);
    }

    summaries.push({
      employee_code: emp.code,
      employee_id: emp.id,
      company: emp.company || null,
      department: emp.department || null,
      date_of_joining: emp.date_of_joining || null,
      days_worked_ytd: acc.daysWorkedYtd,
      eligible,
      days_to_eligibility: eligible ? 0 : r2(elEligibilityDays - acc.daysWorkedYtd),
      el: {
        opening: r2(elOpening),
        computed_opening: 0,
        earned: acc.elEarnedYtd,
        used: acc.used.EL,
        external: acc.external.EL,
        adjustments: acc.adj.EL,
        current_balance: r2(storedEl?.balance || 0),
        new_balance: newEl,
        delta: r2(newEl - (storedEl?.balance || 0)),
      },
      cl: {
        opening: r2(clOpening),
        computed_opening: computedClOpening,
        earned: 0,
        used: acc.used.CL,
        external: acc.external.CL,
        adjustments: acc.adj.CL,
        current_balance: r2(storedCl?.balance || 0),
        new_balance: newCl,
        delta: r2(newCl - (storedCl?.balance || 0)),
      },
      current_balance: r2((storedEl?.balance || 0) + (storedCl?.balance || 0)),
      new_balance: r2(newEl + newCl),
      delta: r2(newEl + newCl - ((storedEl?.balance || 0) + (storedCl?.balance || 0))),
      reasons,
    });
  }

  return {
    year: yr,
    months_covered: maxMonth,
    policy: { elRate, elEligibilityDays, elDaysPerLeave, clBase },
    employees: summaries,
    ledger: ledgerRows,
    unresolved_finance_rows: finance.map((t) => ({
      id: t.id,
      employee_code: t.employee_code,
      leave_type: t.leave_type,
      days: t.days,
      reference_month: t.reference_month,
      reference_year: t.reference_year,
    })),
    totals: {
      employees: summaries.length,
      changed: summaries.filter((s) => Math.abs(s.delta) > 0.001).length,
      eligible: summaries.filter((s) => s.eligible).length,
      net_delta: r2(summaries.reduce((a, s) => a + s.delta, 0)),
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// applyLeavePlan — the only writer
// ────────────────────────────────────────────────────────────────────────────

function externalGrantsReady(db) {
  const has = db.prepare('SELECT COUNT(*) AS c FROM leave_external_grants WHERE is_active = 1').get()?.c || 0;
  if (has > 0) return true;
  return getPolicyBool(db, 'leave_external_grants_acknowledged', false);
}

function recordRun(db, { scope, company, month, year, employee_count, status, message, started_at }) {
  const info = db.prepare(`
    INSERT INTO leave_recompute_runs
      (scope, company, month, year, employee_count, started_at, finished_at, status, message)
    VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'), ?, ?)
  `).run(scope || 'manual', company || null, month || null, year || null,
    employee_count || 0, started_at || null, status || 'ok', message || null);
  return info.lastInsertRowid;
}

function applyLeavePlan(db, plan, { actor = 'system', allowWrite = false, scope = 'manual', company = null, startedAt = null } = {}) {
  const automationOn = getPolicyBool(db, 'leave_automation_enabled', false);
  if (!automationOn && allowWrite !== true) {
    const runId = recordRun(db, {
      scope, company, year: plan.year, employee_count: plan.employees.length,
      status: 'skipped_disabled', message: 'leave_automation_enabled is false', started_at: startedAt,
    });
    return { applied: false, reason: 'automation_disabled', run_id: runId, written: { ledger: 0, balances: 0 } };
  }
  if (!externalGrantsReady(db)) {
    const runId = recordRun(db, {
      scope, company, year: plan.year, employee_count: plan.employees.length,
      status: 'blocked_external_grants',
      message: 'No outside-the-system EL list uploaded and none acknowledged', started_at: startedAt,
    });
    return { applied: false, reason: 'external_grants_not_acknowledged', run_id: runId, written: { ledger: 0, balances: 0 } };
  }

  // INSERT carries 14 columns; the DO UPDATE list carries every one of them
  // except the four conflict keys and `lapsed` — year-end lapse rows must
  // survive a later recompute.
  const upsertLedger = db.prepare(`
    INSERT INTO leave_accrual_ledger
      (employee_code, employee_id, year, month, leave_type,
       opening_balance, accrued, used, lapsed, closing_balance,
       paid_days_this_month, paid_days_ytd, el_earned_ytd, company)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_code, year, month, leave_type) DO UPDATE SET
      employee_id          = excluded.employee_id,
      opening_balance      = excluded.opening_balance,
      accrued              = excluded.accrued,
      used                 = excluded.used,
      closing_balance      = excluded.closing_balance,
      paid_days_this_month = excluded.paid_days_this_month,
      paid_days_ytd        = excluded.paid_days_ytd,
      el_earned_ytd        = excluded.el_earned_ytd,
      company              = excluded.company
  `);

  const insertBalance = db.prepare(`
    INSERT INTO leave_balances (employee_id, year, leave_type, opening, accrued, used, balance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id, year, leave_type) DO UPDATE SET
      accrued = excluded.accrued,
      used    = excluded.used,
      balance = excluded.balance
  `);

  let ledgerWrites = 0;
  let balanceWrites = 0;
  const txn = db.transaction(() => {
    for (const row of plan.ledger) {
      upsertLedger.run(
        row.employee_code, row.employee_id, row.year, row.month, row.leave_type,
        row.opening_balance, row.accrued, row.used, row.closing_balance,
        row.paid_days_this_month, row.paid_days_ytd, row.el_earned_ytd, row.company
      );
      ledgerWrites += 1;
    }
    for (const s of plan.employees) {
      insertBalance.run(s.employee_id, plan.year, 'EL',
        s.el.opening, s.el.earned, r2(s.el.used + s.el.external), s.el.new_balance);
      insertBalance.run(s.employee_id, plan.year, 'CL',
        s.cl.opening, 0, r2(s.cl.used + s.cl.external), s.cl.new_balance);
      balanceWrites += 2;
    }
  });
  txn();

  const runId = recordRun(db, {
    scope, company, year: plan.year, employee_count: plan.employees.length,
    status: 'ok',
    message: `${ledgerWrites} ledger rows, ${balanceWrites} balance rows, ${plan.totals.changed} employees changed by ${actor}`,
    started_at: startedAt,
  });

  return { applied: true, run_id: runId, written: { ledger: ledgerWrites, balances: balanceWrites } };
}

// ────────────────────────────────────────────────────────────────────────────

function recomputeLeaves(db, { year, employeeCodes = null, dryRun = true, scope = 'manual', actor = 'system', allowWrite = false, company = null } = {}) {
  const startedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const yr = Number(year) || istToday().year;
  const plan = computeLeavePlan(db, { year: yr, employeeCodes });
  if (dryRun) {
    return { dryRun: true, plan, applied: false, reason: 'dry_run', written: { ledger: 0, balances: 0 } };
  }
  const result = applyLeavePlan(db, plan, { actor, allowWrite, scope, company, startedAt });
  return { dryRun: false, plan, ...result };
}

// ────────────────────────────────────────────────────────────────────────────
// Year end
// ────────────────────────────────────────────────────────────────────────────

function runYearEndLapse(db, year, { dryRun = true, actor = 'system' } = {}) {
  const yr = Number(year);
  if (!yr) throw new Error('runYearEndLapse: year is required');

  const targets = db.prepare(`
    SELECT lb.id, lb.employee_id, lb.leave_type, lb.balance, e.code AS employee_code, e.company
    FROM leave_balances lb
    JOIN employees e ON e.id = lb.employee_id
    WHERE lb.year = ? AND lb.leave_type IN ('CL', 'EL') AND lb.balance > 0
    ORDER BY e.code, lb.leave_type
  `).all(yr);

  const report = targets.map((t) => ({
    employee_code: t.employee_code,
    company: t.company || null,
    leave_type: t.leave_type,
    days_lapsed: r2(t.balance),
  }));
  const totals = {
    rows: report.length,
    cl_days: r2(report.filter((r) => r.leave_type === 'CL').reduce((a, r) => a + r.days_lapsed, 0)),
    el_days: r2(report.filter((r) => r.leave_type === 'EL').reduce((a, r) => a + r.days_lapsed, 0)),
  };
  if (dryRun) return { dryRun: true, applied: false, year: yr, totals, report };

  const upsertLedger = db.prepare(`
    INSERT INTO leave_accrual_ledger
      (employee_code, employee_id, year, month, leave_type,
       opening_balance, accrued, used, lapsed, closing_balance,
       paid_days_this_month, paid_days_ytd, el_earned_ytd, company)
    VALUES (?, ?, ?, 12, ?, ?, 0, 0, ?, 0, 0, 0, 0, ?)
    ON CONFLICT(employee_code, year, month, leave_type) DO UPDATE SET
      lapsed          = excluded.lapsed,
      closing_balance = 0
  `);
  const insertTxn = db.prepare(`
    INSERT INTO leave_transactions
      (employee_id, employee_code, company, leave_type, transaction_type, days,
       balance_after, reference_month, reference_year, reason, approved_by)
    VALUES (?, ?, ?, ?, 'Year-End Lapse', ?, 0, 12, ?, ?, ?)
  `);
  const zero = db.prepare('UPDATE leave_balances SET balance = 0 WHERE id = ?');

  const txn = db.transaction(() => {
    for (const t of targets) {
      const lapsed = r2(t.balance);
      upsertLedger.run(t.employee_code, t.employee_id, yr, t.leave_type, lapsed, lapsed, t.company || null);
      insertTxn.run(t.employee_id, t.employee_code, t.company || null, t.leave_type, lapsed, yr,
        `Year-end lapse ${yr} — no carry-forward`, actor);
      zero.run(t.id);
    }
  });
  txn();

  recordRun(db, {
    scope: 'manual', year: yr, employee_count: new Set(targets.map((t) => t.employee_code)).size,
    status: 'ok', message: `Year-end lapse: ${totals.rows} rows, CL ${totals.cl_days}d, EL ${totals.el_days}d by ${actor}`,
  });
  return { dryRun: false, applied: true, year: yr, totals, report };
}

/** CL openings for a fresh year. Idempotent — guarded and INSERT OR IGNORE. */
function seedYearOpenings(db, year, { force = false } = {}) {
  const yr = Number(year);
  if (!yr) throw new Error('seedYearOpenings: year is required');
  const guard = `cl_seed_${yr}_v1`;
  const done = db.prepare('SELECT value FROM policy_config WHERE key = ?').get(guard);
  if (done && !force) return { seeded: 0, skipped: true, reason: 'already_seeded' };

  const clBase = getPolicyNumber(db, 'cl_entitlement_base', 7);
  const employees = selectEligibleEmployees(db, null);
  const ins = db.prepare(`
    INSERT OR IGNORE INTO leave_balances (employee_id, year, leave_type, opening, accrued, used, balance)
    VALUES (?, ?, ?, ?, 0, 0, ?)
  `);
  let seeded = 0;
  const txn = db.transaction(() => {
    for (const emp of employees) {
      const cl = computeClEntitlement(emp.date_of_joining, yr, clBase);
      if (ins.run(emp.id, yr, 'CL', cl, cl).changes) seeded += 1;
      if (ins.run(emp.id, yr, 'EL', 0, 0).changes) seeded += 1;
    }
    db.prepare(
      'INSERT OR REPLACE INTO policy_config (key, value, description) VALUES (?, ?, ?)'
    ).run(guard, '1', `CL/EL openings seeded for ${yr}`);
  });
  txn();
  return { seeded, skipped: false, employees: employees.length };
}

module.exports = {
  computeLeavePlan,
  applyLeavePlan,
  recomputeLeaves,
  runYearEndLapse,
  seedYearOpenings,
  selectEligibleEmployees,
  partitionTransactions,
  getPolicy,
  getPolicyNumber,
  getPolicyBool,
  istToday,
  LEAVE_ELIGIBLE_TYPES,
};

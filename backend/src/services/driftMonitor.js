/**
 * Drift Monitor — Phase 1 (read-only observation)
 *
 * Runs a bank of SQL invariant checks against the live database every
 * 10 minutes (when DRIFT_MONITOR_ENABLED='true'). Each check writes one
 * row to system_health_checks tagged pass / fail / error. Phase 1 is
 * inert: nothing reads these rows yet — they exist for human inspection
 * via GET /api/admin/health-checks until Phase 4 wires alerting.
 *
 * Adding a new invariant: append a descriptor to INVARIANTS. Each one
 * runs in its own try/catch so a broken check (e.g. "no such column")
 * never aborts the run — it logs status='error' and the rest continue.
 */

const cron = require('node-cron');
const { getDb } = require('../database/db');

// ── Invariant catalog ────────────────────────────────────────────────────────

const INVARIANTS = [
  {
    name: 'salary_identity_holds',
    severity: 'critical',
    countSql: `
      SELECT COUNT(*) AS c FROM salary_computations
      WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1
    `,
    exampleSql: `
      SELECT id, employee_code, month, year, gross_earned, total_deductions, net_salary
      FROM salary_computations
      WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1
      ORDER BY id DESC LIMIT 20
    `,
  },
  {
    name: 'attendance_month_matches_date',
    severity: 'critical',
    countSql: `
      SELECT COUNT(*) AS c FROM attendance_processed
      WHERE date IS NOT NULL
        AND month IS NOT NULL
        AND CAST(strftime('%m', date) AS INTEGER) != month
    `,
    exampleSql: `
      SELECT id, employee_code, date, month, year
      FROM attendance_processed
      WHERE date IS NOT NULL
        AND month IS NOT NULL
        AND CAST(strftime('%m', date) AS INTEGER) != month
      ORDER BY id DESC LIMIT 20
    `,
  },
  {
    name: 'no_duplicate_salary_rows',
    severity: 'critical',
    countSql: `
      SELECT COUNT(*) AS c FROM (
        SELECT employee_code, month, year, COUNT(*) AS rc
        FROM salary_computations
        WHERE employee_code IS NOT NULL
        GROUP BY employee_code, month, year
        HAVING COUNT(*) > 1
      )
    `,
    exampleSql: `
      SELECT employee_code, month, year, COUNT(*) AS dup_count
      FROM salary_computations
      WHERE employee_code IS NOT NULL
      GROUP BY employee_code, month, year
      HAVING COUNT(*) > 1
      ORDER BY dup_count DESC LIMIT 20
    `,
  },
  {
    name: 'no_orphan_salary_rows',
    severity: 'high',
    countSql: `
      SELECT COUNT(*) AS c FROM salary_computations sc
      LEFT JOIN employees e ON sc.employee_code = e.code
      WHERE e.id IS NULL
    `,
    exampleSql: `
      SELECT sc.id, sc.employee_code, sc.month, sc.year
      FROM salary_computations sc
      LEFT JOIN employees e ON sc.employee_code = e.code
      WHERE e.id IS NULL
      ORDER BY sc.id DESC LIMIT 20
    `,
  },
  {
    name: 'earned_ratio_cap',
    severity: 'critical',
    // gross_earned is capped at gross_salary inside computeEmployeeSalary
    // (Math.min in salaryComputation.js). OT and holiday-duty pay are stored
    // in separate columns (ot_pay, holiday_duty_pay) and never feed
    // gross_earned. Any row where gross_earned > gross_salary therefore
    // signals a corruption of the cap (e.g. an earnedRatio > 1.0 leak).
    countSql: `
      SELECT COUNT(*) AS c FROM salary_computations
      WHERE gross_salary > 0
        AND gross_earned > gross_salary * 1.0001
    `,
    exampleSql: `
      SELECT id, employee_code, month, year, gross_salary, gross_earned
      FROM salary_computations
      WHERE gross_salary > 0
        AND gross_earned > gross_salary * 1.0001
      ORDER BY id DESC LIMIT 20
    `,
  },
];

// ── Core run loop ────────────────────────────────────────────────────────────

function runChecks(db) {
  const dbHandle = db || getDb();
  const runId = Date.now();
  const results = [];

  const insert = dbHandle.prepare(`
    INSERT INTO system_health_checks (check_name, status, severity, details_json)
    VALUES (?, ?, ?, ?)
  `);

  for (const inv of INVARIANTS) {
    let status, details;
    try {
      const row = dbHandle.prepare(inv.countSql).get();
      const count = (row && row.c) || 0;
      if (count === 0) {
        status = 'pass';
        details = JSON.stringify({ count: 0 });
      } else {
        status = 'fail';
        let examples = [];
        try {
          examples = dbHandle.prepare(inv.exampleSql).all();
        } catch (e) {
          examples = [{ _example_capture_error: e.message }];
        }
        details = JSON.stringify({ count, examples });
      }
    } catch (e) {
      status = 'error';
      details = JSON.stringify({ error: e.message });
    }

    try {
      insert.run(inv.name, status, inv.severity, details);
    } catch (e) {
      console.error(`[Drift] Failed to write health-check row for ${inv.name}:`, e.message);
    }
    results.push({ check_name: inv.name, status, severity: inv.severity, details });
  }

  return { run_id: runId, results };
}

// ── Cron registration ────────────────────────────────────────────────────────

function registerCron(db) {
  const enabled = process.env.DRIFT_MONITOR_ENABLED === 'true';
  if (!enabled) {
    console.log("[Drift] disabled (DRIFT_MONITOR_ENABLED != 'true')");
    return;
  }
  cron.schedule('*/10 * * * *', () => {
    try {
      const { results } = runChecks(db);
      const pass = results.filter((r) => r.status === 'pass').length;
      const fail = results.filter((r) => r.status === 'fail').length;
      const errored = results.filter((r) => r.status === 'error').length;
      console.log(`[Drift] run complete — pass=${pass} fail=${fail} error=${errored}`);
    } catch (e) {
      console.error('[Drift] run failed:', e.message);
    }
  });
  console.log('[Drift] cron registered (every 10 min)');
}

module.exports = { runChecks, registerCron };

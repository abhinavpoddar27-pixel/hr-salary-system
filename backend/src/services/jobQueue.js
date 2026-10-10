/**
 * Simple in-process job queue using SQLite.
 * Jobs run sequentially in the background via setInterval.
 */
const { getDb } = require('../database/db');

/**
 * The jobs table lives here rather than in schema.js. `ensureJobsTable(db)` lets
 * callers that already hold a handle (leaveTriggers, tests) create it without
 * reaching for getDb().
 */
function ensureJobsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      params TEXT,
      status TEXT DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      result TEXT,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT
    )
  `);
}

function initJobQueue() {
  ensureJobsTable(getDb());
}

function enqueue(type, params) {
  const db = getDb();
  const result = db.prepare('INSERT INTO jobs (type, params) VALUES (?, ?)').run(type, JSON.stringify(params));
  return result.lastInsertRowid;
}

function getJob(id) {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (job && job.result) {
    try { job.result = JSON.parse(job.result); } catch {}
  }
  if (job && job.params) {
    try { job.params = JSON.parse(job.params); } catch {}
  }
  return job;
}

function updateJob(id, fields) {
  const db = getDb();
  const sets = Object.entries(fields).map(([k, v]) => `${k} = ?`);
  const vals = Object.values(fields);
  db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
}

/**
 * Employees whose attendance for a month sits under one company label.
 *
 * Stage 6 writes ONE day_calculations row per employee-month
 * (UNIQUE(employee_code, month, year)), but a month's attendance can arrive
 * under several import labels ('Asian Lakto Ind Ltd', 'Default', 'null',
 * 'Sheet1' …) — e.g. 1–5 Sept in an early file and 6–30 Sept in the full one.
 * A Stage 6 run filtered to one label only sees part of the month and
 * overwrites the whole-month row with it. So the automatic paths use the
 * company only to decide WHO to recompute, and always recompute them across
 * every label — the same shape as HR's "All companies" Stage 6 run.
 */
function employeesForCompanyMonth(db, company, month, year) {
  return db.prepare(`
    SELECT DISTINCT employee_code FROM attendance_processed
    WHERE month = ? AND year = ? AND company = ? AND is_night_out_only = 0
  `).all(parseInt(month, 10), parseInt(year, 10), company).map((r) => r.employee_code);
}

/**
 * Stage 6 for an automatic job. `company` narrows the population only; the
 * recompute itself never filters attendance by company (see above).
 * Returns null when a company-scoped run finds nobody to recompute.
 */
function recomputeDaysAllLabels(db, { company, month, year, employeeCodes, requestId }) {
  const { recomputeDays } = require('./recompute');
  let codes = Array.isArray(employeeCodes) && employeeCodes.length ? employeeCodes : null;
  if (!codes && company) {
    codes = employeesForCompanyMonth(db, company, month, year);
    // recomputeDays treats an empty list as "everyone" — never pass one.
    if (!codes.length) return null;
  }
  return recomputeDays(db, {
    company: undefined, month, year, employeeCodes: codes, requestId,
  });
}

/**
 * Run one job against `db`. Pulled out of processNext so it can be tested
 * against a fixture database.
 */
function executeJob(db, type, params = {}, jobId = 0) {
  let result;

  if (type === 'salary_compute') {
    // Shared with POST /api/payroll/compute-salary — see services/recompute.js.
    const { recomputeSalary } = require('./recompute');
    const { month, year, company, employeeCodes } = params;
    const out = recomputeSalary(db, {
      month, year, company, employeeCodes: employeeCodes || null, requestId: `job-${jobId}`,
    });
    result = {
      processed: out.results.length,
      excluded: out.excluded,
      errors: out.errors.length,
      held: out.held.length,
    };

  } else if (type === 'day_calculate') {
    // Automatic first Stage 6 (checkAutoStage6). Company picks who; the
    // recompute spans every company label — see recomputeDaysAllLabels.
    const { month, year, company, employeeCodes } = params;
    const out = recomputeDaysAllLabels(db, {
      month, year, company, employeeCodes: employeeCodes || null, requestId: `job-${jobId}`,
    });
    result = { processed: out ? out.results.length : 0, errors: out ? out.errors.length : 0 };

  } else if (type === 'leave_recalc') {
    // Re-run Stage 6 for whatever changed, then recompute the year's leave.
    // Stage 7 is deliberately NOT touched — salary only recomputes when a
    // human clicks Compute (owner ruling 5). The Stage 6 rows are left marked
    // salary_stale so the Stage 7 screen can say so.
    const { recomputeLeaves } = require('./leaveEngine');
    const { company, month, year, employeeCodes, skipDays, actor } = params;
    let dayRows = 0;
    let dayErrors = 0;
    if (!skipDays && month && year) {
      const dayOut = recomputeDaysAllLabels(db, {
        company, month, year, employeeCodes: employeeCodes || null, requestId: `job-${jobId}`,
      });
      dayRows = dayOut ? dayOut.results.length : 0;
      dayErrors = dayOut ? dayOut.errors.length : 0;
    }
    const leaveOut = recomputeLeaves(db, {
      year, employeeCodes: employeeCodes || null, dryRun: false,
      scope: 'trigger', company: company || null, actor: actor || 'job',
    });
    result = {
      dayCalcRows: dayRows,
      dayCalcErrors: dayErrors,
      leaveApplied: leaveOut.applied,
      leaveReason: leaveOut.reason || null,
      employeesEvaluated: leaveOut.plan?.employees?.length || 0,
      changed: leaveOut.plan?.totals?.changed || 0,
    };

  } else if (type === 'leave_nightly') {
    // Nightly sweep: every non-finalized month of the year gets its Stage 6
    // refreshed ONCE across all company labels, then the year's leave is
    // recomputed once. It used to loop per monthly_imports row and filter
    // attendance by that label, so the last label (often 'null', holding a
    // few days) overwrote each employee's whole-month row — 10 Oct 2026.
    const { recomputeDays } = require('./recompute');
    const { recomputeLeaves } = require('./leaveEngine');
    const year = params.year || new Date().getUTCFullYear();
    const months = db.prepare(`
      SELECT month, year FROM monthly_imports
      WHERE year = ?
      GROUP BY month, year
      HAVING MAX(COALESCE(is_finalised, 0)) = 0 AND MAX(COALESCE(stage_6_done, 0)) = 1
      ORDER BY month
    `).all(year);
    let refreshed = 0;
    for (const p of months) {
      try {
        recomputeDays(db, {
          company: undefined, month: p.month, year: p.year, requestId: `nightly-${jobId}`,
        });
        refreshed += 1;
      } catch (e) {
        console.error(`[leave_nightly] ${p.month}/${p.year} failed: ${e.message}`);
      }
    }
    const leaveOut = recomputeLeaves(db, {
      year, dryRun: false, scope: 'nightly', actor: 'scheduler',
    });
    const drift = db.prepare(`
      SELECT COUNT(*) AS c FROM salary_computations
      WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1
    `).get()?.c || 0;
    if (drift > 0) console.error(`[leave_nightly] salary drift detected on ${drift} row(s)`);
    result = {
      periodsRefreshed: refreshed,
      leaveApplied: leaveOut.applied,
      leaveReason: leaveOut.reason || null,
      driftRows: drift,
    };

  } else {
    result = { error: `Unknown job type: ${type}` };
  }
  return result;
}

async function processNext() {
  const db = getDb();
  const job = db.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1").get();
  if (!job) return;

  updateJob(job.id, { status: 'running', started_at: new Date().toISOString() });

  try {
    const params = JSON.parse(job.params || '{}');
    const result = executeJob(db, job.type, params, job.id);
    updateJob(job.id, { status: 'completed', progress: 100, result: JSON.stringify(result), completed_at: new Date().toISOString() });
  } catch (err) {
    updateJob(job.id, { status: 'failed', error: err.message, completed_at: new Date().toISOString() });
  }
}

function startWorker() {
  initJobQueue();
  setInterval(() => {
    try { processNext(); } catch (e) { console.error('[JobQueue] Worker error:', e.message); }
  }, 2000);
  console.log('🔄 Job queue worker started');
}

module.exports = {
  enqueue, getJob, startWorker, initJobQueue, ensureJobsTable,
  executeJob, employeesForCompanyMonth,
};

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

async function processNext() {
  const db = getDb();
  const job = db.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1").get();
  if (!job) return;

  updateJob(job.id, { status: 'running', started_at: new Date().toISOString() });

  try {
    const params = JSON.parse(job.params || '{}');
    let result;

    if (job.type === 'salary_compute') {
      // Shared with POST /api/payroll/compute-salary — see services/recompute.js.
      const { recomputeSalary } = require('./recompute');
      const { month, year, company, employeeCodes } = params;
      const out = recomputeSalary(db, {
        month, year, company, employeeCodes: employeeCodes || null, requestId: `job-${job.id}`,
      });
      result = {
        processed: out.results.length,
        excluded: out.excluded,
        errors: out.errors.length,
        held: out.held.length,
      };

    } else if (job.type === 'day_calculate') {
      // Shared with POST /api/payroll/calculate-days — see services/recompute.js.
      const { recomputeDays } = require('./recompute');
      const { month, year, company, employeeCodes } = params;
      const out = recomputeDays(db, {
        month, year, company, employeeCodes: employeeCodes || null, requestId: `job-${job.id}`,
      });
      result = { processed: out.results.length, errors: out.errors.length };

    } else if (job.type === 'leave_recalc') {
      // Re-run Stage 6 for whatever changed, then recompute the year's leave.
      // Stage 7 is deliberately NOT touched — salary only recomputes when a
      // human clicks Compute (owner ruling 5). The Stage 6 rows are left marked
      // salary_stale so the Stage 7 screen can say so.
      const { recomputeDays } = require('./recompute');
      const { recomputeLeaves } = require('./leaveEngine');
      const { company, month, year, employeeCodes, skipDays, actor } = params;
      let dayRows = 0;
      let dayErrors = 0;
      if (!skipDays && month && year) {
        const dayOut = recomputeDays(db, {
          company, month, year, employeeCodes: employeeCodes || null, requestId: `job-${job.id}`,
        });
        dayRows = dayOut.results.length;
        dayErrors = dayOut.errors.length;
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

    } else if (job.type === 'leave_nightly') {
      // Nightly sweep: every non-finalized month of the year gets its Stage 6
      // refreshed, then the year's leave is recomputed once.
      const { recomputeDays } = require('./recompute');
      const { recomputeLeaves } = require('./leaveEngine');
      const year = params.year || new Date().getUTCFullYear();
      const periods = db.prepare(`
        SELECT month, year, company FROM monthly_imports
        WHERE year = ? AND COALESCE(is_finalised, 0) = 0 AND COALESCE(stage_6_done, 0) = 1
        ORDER BY month
      `).all(year);
      let refreshed = 0;
      for (const p of periods) {
        try {
          recomputeDays(db, {
            company: p.company, month: p.month, year: p.year, requestId: `nightly-${job.id}`,
          });
          refreshed += 1;
        } catch (e) {
          console.error(`[leave_nightly] ${p.month}/${p.year} ${p.company || 'all'} failed: ${e.message}`);
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
      result = { error: `Unknown job type: ${job.type}` };
    }

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

module.exports = { enqueue, getJob, startWorker, initJobQueue, ensureJobsTable };

/**
 * Simple in-process job queue using SQLite.
 * Jobs run sequentially in the background via setInterval.
 */
const { getDb } = require('../database/db');

function initJobQueue() {
  const db = getDb();
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

module.exports = { enqueue, getJob, startWorker, initJobQueue };

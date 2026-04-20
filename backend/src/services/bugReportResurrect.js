const { getDb } = require('../database/db');

// Boot-time rescue: containers restart mid-pipeline, leaving rows stuck in
// pending status with no active worker. This runs once on server start and
// re-queues them. Runs async fire-and-forget so it doesn't delay bootstrap.
//
// Two buckets per plan §4.10:
//   A) Claude pending, transcription succeeded → re-run Claude only
//   B) REST transcription pending (crashed mid-call), no batch job queued →
//      re-run the full pipeline
//
// Bucket C (batch jobs stuck) is handled by sarvamBatchPoller — this function
// is a no-op for those. 24-hour cutoff avoids resurrecting rows that the
// admin has already given up on.
async function resurrectStuckRows() {
  const db = getDb();

  const stuckClaude = db.prepare(`
    SELECT id FROM bug_reports
     WHERE claude_run_status = 'pending'
       AND transcription_status = 'success'
       AND datetime(created_at) > datetime('now', '-24 hours')
  `).all();

  const stuckRest = db.prepare(`
    SELECT id FROM bug_reports
     WHERE transcription_status = 'pending'
       AND sarvam_job_id IS NULL
       AND datetime(created_at) > datetime('now', '-24 hours')
  `).all();

  if (stuckClaude.length === 0 && stuckRest.length === 0) {
    console.log('[bug-reporter-resurrect] no stuck rows');
    return;
  }

  // Lazy-require to avoid any chance of a circular dep at boot — analyzer
  // also pulls in sarvamTranscription, which touches env-dependent clients.
  const { runClaudeExtraction, processBugReport } = require('./bugReportAnalyzer');

  for (const { id } of stuckClaude) {
    setImmediate(() => {
      runClaudeExtraction(id).catch((e) =>
        console.error(`[bug-reporter-resurrect A ${id}] ${e.message}`));
    });
  }
  for (const { id } of stuckRest) {
    setImmediate(() => {
      processBugReport(id).catch((e) =>
        console.error(`[bug-reporter-resurrect B ${id}] ${e.message}`));
    });
  }

  console.log(
    `[bug-reporter-resurrect] re-queued: claude=${stuckClaude.length} rest=${stuckRest.length}`
  );
}

module.exports = { resurrectStuckRows };

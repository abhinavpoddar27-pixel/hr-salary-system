const { getDb } = require('../database/db');
const { fetchJobResult } = require('./sarvamTranscription');

// Env-tunable. Defaults match plan §4.8: 2-min cadence, 30-min timeout.
const POLL_INTERVAL_SEC = parseInt(process.env.BUG_REPORT_SARVAM_POLL_FALLBACK_INTERVAL_SEC, 10) || 120;
const MAX_AGE_MIN       = parseInt(process.env.BUG_REPORT_SARVAM_POLL_FALLBACK_MAX_AGE_MIN, 10) || 30;

// Safety-net cron: resolves batch jobs whose webhook never arrived. Race with
// the webhook handler is acceptable — both writes agree on the transcript, so
// last-write-wins is correct. `sarvam_poll_fallback_used=1` lets us measure
// webhook reliability after the fact.
async function pollStuckJobs() {
  const db = getDb();

  const stuck = db.prepare(`
    SELECT id, sarvam_job_id
      FROM bug_reports
     WHERE sarvam_job_id IS NOT NULL
       AND transcription_status IN ('batch_queued', 'batch_polling')
       AND sarvam_webhook_received_at IS NULL
       AND (julianday('now') - julianday(sarvam_job_created_at)) * 1440 < ?
  `).all(MAX_AGE_MIN);

  const expired = db.prepare(`
    SELECT id
      FROM bug_reports
     WHERE sarvam_job_id IS NOT NULL
       AND transcription_status IN ('batch_queued', 'batch_polling')
       AND sarvam_webhook_received_at IS NULL
       AND (julianday('now') - julianday(sarvam_job_created_at)) * 1440 >= ?
  `).all(MAX_AGE_MIN);

  for (const row of expired) {
    db.prepare(`
      UPDATE bug_reports
         SET transcription_status = 'failed',
             transcription_error  = 'Sarvam job timed out without webhook or poll resolution',
             sarvam_job_status    = 'expired'
       WHERE id = ?
    `).run(row.id);
    console.warn(`[sarvam-poller] expired job for report ${row.id}`);
  }

  let resolved = 0;
  for (const row of stuck) {
    try {
      // Optimistic transition — narrows the window where a concurrent webhook
      // and this loop both see 'batch_queued'. Only flips if still queued.
      db.prepare(`
        UPDATE bug_reports
           SET transcription_status = 'batch_polling'
         WHERE id = ? AND transcription_status = 'batch_queued'
      `).run(row.id);

      const result = await fetchJobResult(row.sarvam_job_id);

      if (result.success) {
        // Do NOT set sarvam_webhook_received_at — that column is webhook-only.
        db.prepare(`
          UPDATE bug_reports
             SET transcript_english = ?,
                 transcript_detected_language = ?,
                 transcription_status = 'success',
                 sarvam_job_status    = 'completed',
                 sarvam_job_completed_at = datetime('now'),
                 sarvam_poll_fallback_used = 1
           WHERE id = ?
        `).run(result.text, result.detected_language, row.id);

        // Lazy-require so step 9 can drop in bugReportAnalyzer without
        // touching this file. Until then the catch just logs-and-skips.
        setImmediate(() => {
          try {
            const { runClaudeExtraction } = require('./bugReportAnalyzer');
            runClaudeExtraction(row.id).catch((err) =>
              console.error(`[poller] claude failed for ${row.id}: ${err.message}`));
          } catch (_e) {
            console.log(`[poller] step 9 not yet installed; skipping claude for ${row.id}`);
          }
        });

        resolved++;
      } else if (result.status === 'Failed') {
        // Sarvam explicitly says the job failed — terminal, mark failed now.
        db.prepare(`
          UPDATE bug_reports
             SET transcription_status = 'failed',
                 transcription_error  = ?,
                 sarvam_job_status    = 'failed'
           WHERE id = ?
        `).run(result.error || 'sarvam reported failed', row.id);
      } else {
        // Either pending (still running) or a transient fetch error (network,
        // 403/404, etc.). Fail-soft: leave row alone. Next cycle retries; the
        // expired-age branch eventually catches permanently-stuck rows.
      }
    } catch (err) {
      // Transient failure (network, Sarvam 5xx). Leave row as-is; retry next
      // cycle. The expired branch eventually catches permanently-stuck jobs.
      console.error(`[sarvam-poller] cycle error for report ${row.id}: ${err.message}`);
    }
  }

  if (stuck.length || expired.length) {
    console.log(
      `[sarvam-poller] cycle: stuck=${stuck.length} resolved=${resolved} expired=${expired.length}`
    );
  }
}

let _interval;
function startPollerCron() {
  if (_interval) return;
  _interval = setInterval(() => {
    pollStuckJobs().catch((err) => console.error('[sarvam-poller] uncaught:', err.message));
  }, POLL_INTERVAL_SEC * 1000);
  console.log(`[sarvam-poller] started, interval=${POLL_INTERVAL_SEC}s max_age=${MAX_AGE_MIN}min`);
}

function stopPollerCron() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}

module.exports = { pollStuckJobs, startPollerCron, stopPollerCron };

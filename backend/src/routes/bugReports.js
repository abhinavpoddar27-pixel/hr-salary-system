const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { verifyWebhook, SIGNATURE_HEADER_NAME } = require('../services/sarvamWebhookVerify');
const { fetchJobResult } = require('../services/sarvamTranscription');
const { runClaudeExtraction } = require('../services/bugReportAnalyzer');
const { getDb } = require('../database/db');

// Webhook router — no auth. HMAC signature + per-report token + idempotency
// verification happens inside the handler. Mounted BEFORE the authed router
// so requests bypass requireAuth.
const webhookRouter = express.Router();

// express.raw is scoped to THIS route only — we need unparsed bytes for the
// HMAC check. Global express.json() continues to serve every other route.
webhookRouter.post(
  '/sarvam-webhook/:id(\\d+)',
  express.raw({ type: '*/*', limit: '1mb' }),
  async (req, res) => {
    const reportId = Number(req.params.id);
    const db = getDb();

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (rawBody.length === 0) {
      return res.status(400).send('empty body');
    }

    let payloadObj;
    try {
      payloadObj = JSON.parse(rawBody.toString('utf8'));
    } catch (_err) {
      return res.status(400).send('invalid json');
    }

    const signatureHeader =
      req.headers[SIGNATURE_HEADER_NAME] ||
      req.headers['x-sarvam-signature'] ||
      '';

    const v = verifyWebhook({
      rawBody, signatureHeader, reportId, payloadObj, db,
    });

    if (!v.ok) {
      if (v.code === 'SIGNATURE_INVALID') return res.status(401).send('invalid signature');
      if (v.code === 'TOKEN_MISMATCH')    return res.status(403).send('token mismatch');
      if (v.code === 'ALREADY_PROCESSED') {
        // Dedup: 200 so Sarvam stops retrying.
        console.log(`[webhook] dedup: report ${reportId} already processed`);
        return res.status(200).send('ok (dedup)');
      }
      if (v.code === 'REPORT_NOT_FOUND')  return res.status(404).send('not found');
      if (v.code === 'SERVER_MISCONFIGURED') {
        console.error('[webhook] SERVER_MISCONFIGURED:', v.message);
        return res.status(500).send('server error');
      }
      console.error('[webhook] unknown verify failure:', v.code);
      return res.status(500).send('server error');
    }

    try {
      // Transcript may arrive inline, or only as a job_id to download.
      let transcript = payloadObj.transcript ?? payloadObj.result?.transcript ?? null;
      let detectedLanguage =
        payloadObj.language_code ?? payloadObj.result?.language_code ?? null;

      if (!transcript && payloadObj.job_id) {
        const fetched = await fetchJobResult(payloadObj.job_id);
        if (!fetched.success) {
          db.prepare(`
            UPDATE bug_reports
               SET transcription_status = 'failed',
                   transcription_error  = ?,
                   sarvam_job_status    = 'failed',
                   sarvam_webhook_received_at = datetime('now')
             WHERE id = ?
          `).run(fetched.error || 'unknown fetch failure', reportId);
          return res.status(200).send('ok (fetch failed, row updated)');
        }
        transcript = fetched.text;
        detectedLanguage = fetched.detected_language;
      }

      if (!transcript) {
        db.prepare(`
          UPDATE bug_reports
             SET transcription_status = 'failed',
                 transcription_error  = 'empty transcript in webhook',
                 sarvam_job_status    = 'completed',
                 sarvam_webhook_received_at = datetime('now')
           WHERE id = ?
        `).run(reportId);
        return res.status(200).send('ok (empty transcript recorded)');
      }

      db.prepare(`
        UPDATE bug_reports
           SET transcript_english = ?,
               transcript_detected_language = ?,
               transcription_status = 'success',
               sarvam_job_status    = 'completed',
               sarvam_job_completed_at = datetime('now'),
               sarvam_webhook_received_at = datetime('now')
         WHERE id = ?
      `).run(transcript, detectedLanguage, reportId);

      setImmediate(() => {
        runClaudeExtraction(reportId).catch((err) => {
          console.error(`[webhook] claude kick failed for report ${reportId}:`, err.message);
        });
      });

      return res.status(200).send('ok');
    } catch (err) {
      console.error('[webhook] process failure:', err.message);
      return res.status(500).send('server error');
    }
  },
);

// Authed router — all other /api/bug-reports/* paths. requireAuth applied at
// the router level so mount-site code doesn't need to wrap it.
const authedRouter = express.Router();
authedRouter.use(requireAuth);

function stub(name) {
  return (req, res) => res.status(501).json({ error: 'not_implemented', endpoint: name });
}

authedRouter.post ('/',                       stub('create'));
authedRouter.get  ('/',                       stub('list'));
authedRouter.get  ('/:id',                    stub('read'));
authedRouter.patch('/:id',                    stub('update'));
authedRouter.get  ('/:id/attachment/:kind',   stub('attachment'));

module.exports = { authedRouter, webhookRouter };

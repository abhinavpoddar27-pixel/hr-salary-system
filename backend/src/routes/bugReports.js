const express = require('express');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const { verifyWebhook, SIGNATURE_HEADER_NAME } = require('../services/sarvamWebhookVerify');
const { fetchJobResult } = require('../services/sarvamTranscription');
const { runClaudeExtraction, processBugReport } = require('../services/bugReportAnalyzer');
const { writeScreenshot, writeAudio } = require('../services/bugReportStorage');
const { bugReportUpload, SCREENSHOT_MAX_BYTES } = require('../middleware/uploadBugReport');
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

// Per-user sliding-hour rate limit. In-memory; resets on deploy. A distributed
// deployment would need Redis, but Railway is single-instance for this app.
const RATE_LIMIT_PER_HOUR = parseInt(process.env.BUG_REPORT_RATE_LIMIT_PER_USER_PER_HOUR, 10) || 10;
const rateBuckets = new Map(); // username → { count, windowStart }

function rateLimitCreate(req, res, next) {
  const key = req.user?.username || `id:${req.user?.id}` || 'anon';
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, windowStart: now };
  if (now - bucket.windowStart > 3_600_000) {
    bucket.count = 0;
    bucket.windowStart = now;
  }
  bucket.count++;
  rateBuckets.set(key, bucket);
  if (bucket.count > RATE_LIMIT_PER_HOUR) {
    res.setHeader('Retry-After', '3600');
    return res.status(429).json({ success: false, error: 'rate limit exceeded; try again in an hour' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}

const ALLOWED_ADMIN_STATUS  = ['new', 'triaged', 'in_progress', 'resolved', 'wont_fix', 'duplicate'];
const ALLOWED_QUALITY       = ['good', 'acceptable', 'bad'];
const ALLOWED_INPUT_METHODS = ['recorded', 'uploaded', 'typed'];
const ALLOWED_AUDIO_SOURCES = ['recorded', 'uploaded'];

// POST /api/bug-reports — create. Rate-limited FIRST so abusive clients don't
// even get multipart-parsed. Multer then parses the two file fields and the
// `payload` JSON blob in form-data. We insert with placeholder paths (the
// schema's compound CHECK needs a non-null audio_path for recorded/uploaded),
// write the files to disk using the new row id, then UPDATE with real paths.
// Fire-and-forget kick of the analyzer.
authedRouter.post(
  '/',
  rateLimitCreate,
  (req, res, next) => {
    bugReportUpload(req, res, (err) => {
      if (!err) return next();
      if (err instanceof require('multer').MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ success: false, error: 'file too large' });
        }
        return res.status(400).json({ success: false, error: err.message });
      }
      // fileFilter-thrown errors land here
      return res.status(400).json({ success: false, error: err.message });
    });
  },
  async (req, res) => {
    try {
      const shotFile = req.files?.screenshot?.[0];
      const audFile  = req.files?.audio?.[0];
      if (!shotFile) {
        return res.status(400).json({ success: false, error: 'screenshot required' });
      }
      if (shotFile.size > SCREENSHOT_MAX_BYTES) {
        return res.status(413).json({ success: false, error: 'screenshot exceeds 10MB' });
      }

      let payload = {};
      try {
        payload = req.body.payload ? JSON.parse(req.body.payload) : {};
      } catch (_) {
        return res.status(400).json({ success: false, error: 'payload must be valid JSON' });
      }

      const inputMethod = payload.input_method;
      if (!ALLOWED_INPUT_METHODS.includes(inputMethod)) {
        return res.status(400).json({ success: false, error: `invalid input_method (expected one of ${ALLOWED_INPUT_METHODS.join(',')})` });
      }
      if (inputMethod === 'typed') {
        if (!payload.user_typed_comment?.trim()) {
          return res.status(400).json({ success: false, error: 'user_typed_comment required for typed reports' });
        }
        if (audFile) {
          return res.status(400).json({ success: false, error: 'audio not allowed on typed reports' });
        }
      } else {
        if (!audFile) {
          return res.status(400).json({ success: false, error: `audio file required for input_method=${inputMethod}` });
        }
        if (!payload.audio_duration_sec || payload.audio_duration_sec <= 0) {
          return res.status(400).json({ success: false, error: 'audio_duration_sec required and must be > 0' });
        }
      }

      const audioSource = inputMethod === 'typed' ? null : inputMethod;
      if (audioSource && !ALLOWED_AUDIO_SOURCES.includes(audioSource)) {
        return res.status(400).json({ success: false, error: 'invalid audio_source' });
      }

      const db = getDb();
      const insertResult = db.prepare(`
        INSERT INTO bug_reports (
          reporter_username, reporter_role,
          page_url, page_name,
          selected_month, selected_year, selected_company,
          screenshot_path, screenshot_mime, screenshot_size_bytes,
          audio_path, audio_mime, audio_duration_sec, audio_size_bytes, audio_source,
          user_typed_comment, input_method, auto_context_json,
          transcription_status, claude_run_status, admin_status
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          'pending:screenshot', ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          'pending', 'pending', 'new'
        )
      `).run(
        req.user.username, req.user.role,
        payload.page_url || null, payload.page_name || null,
        payload.selected_month || null, payload.selected_year || null, payload.selected_company || null,
        shotFile.mimetype, shotFile.size,
        audFile ? 'pending:audio' : null,
        audFile ? audFile.mimetype : null,
        payload.audio_duration_sec || null,
        audFile ? audFile.size : null,
        audioSource,
        payload.user_typed_comment?.trim() || null,
        inputMethod,
        payload.auto_context_json ? JSON.stringify(payload.auto_context_json) : null,
      );
      const id = Number(insertResult.lastInsertRowid);

      try {
        const shotPath = await writeScreenshot(id, shotFile.buffer, shotFile.mimetype);
        let audPath = null;
        if (audFile) {
          audPath = await writeAudio(id, audFile.buffer, audFile.mimetype);
        }
        db.prepare('UPDATE bug_reports SET screenshot_path=?, audio_path=? WHERE id=?')
          .run(shotPath, audPath, id);
      } catch (writeErr) {
        console.error(`[bug-reports] file write failed for ${id}: ${writeErr.message}`);
        db.prepare(`
          UPDATE bug_reports
             SET transcription_status='failed',
                 transcription_error=?
           WHERE id=?
        `).run(`file write failed: ${writeErr.message}`, id);
        return res.status(500).json({ success: false, id, error: 'file write failed after row created' });
      }

      setImmediate(() => {
        processBugReport(id).catch((err) =>
          console.error(`[bug-reports] analyzer kick failed for ${id}: ${err.message}`));
      });

      return res.status(201).json({ success: true, id, status: 'created' });
    } catch (err) {
      console.error('[bug-reports] create failed:', err.message);
      return res.status(500).json({ success: false, error: 'create failed' });
    }
  },
);

// GET /api/bug-reports — admin list, paginated, status-filtered.
authedRouter.get('/', requireAdmin, (req, res) => {
  const db = getDb();
  const status = req.query.status;
  const limit  = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  let where = '1=1';
  const params = [];
  if (status && status !== 'all') {
    if (!ALLOWED_ADMIN_STATUS.includes(status)) {
      return res.status(400).json({ success: false, error: 'invalid status filter' });
    }
    where += ' AND admin_status = ?';
    params.push(status);
  }

  const rows = db.prepare(`
    SELECT id, reporter_username, reporter_role, page_name, page_url,
           selected_month, selected_year, selected_company,
           input_method, transcription_status, claude_run_status,
           claude_summary_confidence, admin_status, created_at
      FROM bug_reports
     WHERE ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM bug_reports WHERE ${where}`).get(...params).n;
  return res.json({ success: true, data: rows, total, limit, offset });
});

// GET /api/bug-reports/count — admin badge polling. Cheap count query.
authedRouter.get('/count', requireAdmin, (req, res) => {
  const db = getDb();
  const status = req.query.status;
  let sql = 'SELECT COUNT(*) AS n FROM bug_reports';
  const params = [];
  if (status && status !== 'all') {
    if (!ALLOWED_ADMIN_STATUS.includes(status)) {
      return res.status(400).json({ success: false, error: 'invalid status filter' });
    }
    sql += ' WHERE admin_status = ?';
    params.push(status);
  }
  const n = db.prepare(sql).get(...params).n;
  return res.json({ success: true, count: n });
});

// GET /api/bug-reports/:id — admin detail, full row.
authedRouter.get('/:id(\\d+)', requireAdmin, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM bug_reports WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ success: false, error: 'not found' });
  return res.json({ success: true, data: row });
});

// GET /api/bug-reports/:id/screenshot — streams the image bytes inline.
authedRouter.get('/:id(\\d+)/screenshot', requireAdmin, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT screenshot_path, screenshot_mime FROM bug_reports WHERE id = ?')
    .get(Number(req.params.id));
  if (!row) return res.status(404).json({ success: false, error: 'not found' });
  if (!row.screenshot_path || row.screenshot_path.startsWith('pending:') || !fs.existsSync(row.screenshot_path)) {
    return res.status(404).json({ success: false, error: 'screenshot file missing' });
  }
  res.setHeader('Content-Type', row.screenshot_mime || 'application/octet-stream');
  return res.sendFile(row.screenshot_path);
});

// GET /api/bug-reports/:id/audio — streams the audio bytes inline.
authedRouter.get('/:id(\\d+)/audio', requireAdmin, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT audio_path, audio_mime FROM bug_reports WHERE id = ?')
    .get(Number(req.params.id));
  if (!row) return res.status(404).json({ success: false, error: 'not found' });
  if (!row.audio_path || row.audio_path.startsWith('pending:') || !fs.existsSync(row.audio_path)) {
    return res.status(404).json({ success: false, error: 'audio file missing' });
  }
  res.setHeader('Content-Type', row.audio_mime || 'application/octet-stream');
  return res.sendFile(row.audio_path);
});

// PUT /api/bug-reports/:id — admin triage fields. Dynamic UPDATE of the
// non-undefined subset so partial PATCH-style usage works despite the verb.
authedRouter.put('/:id(\\d+)', requireAdmin, (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const exists = db.prepare('SELECT id FROM bug_reports WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ success: false, error: 'not found' });

  const { admin_status, admin_notes, admin_extraction_quality, admin_feedback_on_extraction } = req.body || {};

  if (admin_status !== undefined && !ALLOWED_ADMIN_STATUS.includes(admin_status)) {
    return res.status(400).json({ success: false, error: `invalid admin_status (expected one of ${ALLOWED_ADMIN_STATUS.join(',')})` });
  }
  if (
    admin_extraction_quality !== undefined &&
    admin_extraction_quality !== null &&
    !ALLOWED_QUALITY.includes(admin_extraction_quality)
  ) {
    return res.status(400).json({ success: false, error: `invalid admin_extraction_quality (expected one of ${ALLOWED_QUALITY.join(',')})` });
  }

  const sets = [];
  const params = [];
  if (admin_status !== undefined) { sets.push('admin_status = ?'); params.push(admin_status); }
  if (admin_notes !== undefined)  { sets.push('admin_notes = ?');  params.push(admin_notes); }
  if (admin_extraction_quality !== undefined) {
    sets.push('admin_extraction_quality = ?'); params.push(admin_extraction_quality);
  }
  if (admin_feedback_on_extraction !== undefined) {
    sets.push('admin_feedback_on_extraction = ?'); params.push(admin_feedback_on_extraction);
  }
  if (admin_status === 'resolved' || admin_status === 'wont_fix') {
    sets.push("resolved_at = datetime('now')");
    sets.push('resolved_by = ?');
    params.push(req.user.username);
  }

  if (sets.length === 0) {
    return res.status(400).json({ success: false, error: 'no fields to update' });
  }
  params.push(id);

  db.prepare(`UPDATE bug_reports SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  const row = db.prepare('SELECT * FROM bug_reports WHERE id = ?').get(id);
  return res.json({ success: true, data: row });
});

// POST /api/bug-reports/:id/reanalyze — admin kicks a forced re-run. Uses
// forceReanalyze so existing transcript is reused (saves Sarvam cost); only
// Claude extraction re-runs in the common case.
authedRouter.post('/:id(\\d+)/reanalyze', requireAdmin, (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const exists = db.prepare('SELECT id FROM bug_reports WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ success: false, error: 'not found' });

  setImmediate(() => {
    processBugReport(id, { forceReanalyze: true }).catch((e) =>
      console.error(`[bug-reports] reanalyze ${id} failed: ${e.message}`));
  });
  return res.status(202).json({ success: true, status: 'reanalysis_started' });
});

module.exports = { authedRouter, webhookRouter };

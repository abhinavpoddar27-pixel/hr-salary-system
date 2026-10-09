/**
 * /api/statutory-flags — the only way PF / ESI / LWF flags change (ruling R10).
 * Admin only (router-level guard). Files stay in memory and are never written
 * to disk; the undo file is generated on demand from the batch row (N9).
 *
 *   POST /preview   multipart file + scope + effectiveMonth → plan + sha256
 *   POST /apply     same + expectedSha256 → applied batch (409 on hash mismatch or duplicate)
 *   GET  /batches                 recent batches (no-cache)
 *   GET  /batches/:id/undo-file   before-values in the upload layout (.xlsx)
 */
const express = require('express');
const multer = require('multer');
const { getDb } = require('../database/db');
const { requireAdmin } = require('../middleware/roles');
const SF = require('../services/statutoryFlags');

const router = express.Router();
router.use(requireAdmin);

const MAX_BYTES = 2 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname || '');
    if (ok) return cb(null, true);
    const e = new Error('Only .xlsx, .xls or .csv files are accepted');
    e.status = 400;
    return cb(e, false);
  },
});

function receiveFile(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 2 MB' : err.message;
      return res.status(400).json({ success: false, error: msg });
    }
    return res.status(err.status || 400).json({ success: false, error: err.message });
  });
}

function readRequest(req) {
  const scope = String(req.body?.scope || '').trim().toLowerCase();
  const effectiveMonth = String(req.body?.effectiveMonth || '').trim();
  if (!req.file) return { error: 'No file uploaded (field name: file)' };
  if (scope !== SF.PLANT && scope !== SF.SALES) return { error: "scope must be 'plant' or 'sales'" };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(effectiveMonth)) return { error: 'effectiveMonth must be YYYY-MM' };
  const parsed = SF.parseFlagFile(req.file.buffer, scope);
  return { scope, effectiveMonth, parsed, sha256: SF.sha256(req.file.buffer), fileName: req.file.originalname };
}

router.post('/preview', receiveFile, (req, res) => {
  try {
    const r = readRequest(req);
    if (r.error) return res.status(400).json({ success: false, error: r.error });
    if (!r.parsed.ok) return res.status(400).json({ success: false, error: 'The file cannot be read', errors: r.parsed.errors });
    const plan = SF.planFlagChanges(getDb(), { scope: r.scope, effectiveMonth: r.effectiveMonth, rows: r.parsed.rows });
    const dup = getDb().prepare(`SELECT id FROM statutory_flag_batches WHERE scope = ? AND effective_month = ? AND file_sha256 = ? AND status = 'applied'`)
      .get(r.scope, r.effectiveMonth, r.sha256);
    res.json({
      success: true,
      scope: r.scope, effectiveMonth: r.effectiveMonth, fileName: r.fileName, sha256: r.sha256,
      canApply: plan.ok && !dup, alreadyAppliedBatchId: dup ? dup.id : null,
      blocking: plan.blocking, totals: plan.totals, keys: plan.keys, rows: plan.rows,
    });
  } catch (err) {
    console.error('[statutory-flags/preview]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/apply', receiveFile, (req, res) => {
  try {
    const r = readRequest(req);
    if (r.error) return res.status(400).json({ success: false, error: r.error });
    if (!r.parsed.ok) return res.status(400).json({ success: false, error: 'The file cannot be read', errors: r.parsed.errors });
    const expectedSha256 = String(req.body?.expectedSha256 || '').trim();
    if (!expectedSha256) return res.status(400).json({ success: false, error: 'expectedSha256 is required (preview the file first)' });
    const out = SF.applyFlagChanges(getDb(), {
      scope: r.scope, effectiveMonth: r.effectiveMonth, rows: r.parsed.rows,
      user: req.user?.username || 'admin', fileName: r.fileName, sha256: r.sha256, expectedSha256,
    });
    if (!out.ok) {
      return res.status(out.status || 400).json({ success: false, error: out.error, code: out.code, blocking: out.blocking, batchId: out.batchId });
    }
    res.json({ success: true, batchId: out.batchId, summary: out.summary });
  } catch (err) {
    console.error('[statutory-flags/apply]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/batches', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, batches: SF.listBatches(getDb(), { limit: 50 }) });
  } catch (err) {
    console.error('[statutory-flags/batches]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/batches/:id/undo-file', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Bad batch id' });
    const out = SF.buildUndoWorkbook(getDb(), id);
    if (!out.ok) return res.status(out.status || 400).json({ success: false, error: out.error });
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${out.fileName}"`);
    res.send(out.buffer);
  } catch (err) {
    console.error('[statutory-flags/undo-file]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

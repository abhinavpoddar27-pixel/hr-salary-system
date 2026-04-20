const multer = require('multer');

// Memory storage — the bugReportStorage service writes files to disk using a
// reportId-keyed directory layout, so we buffer uploads in RAM and let the
// route handler do the final write. Screenshot cap 10MB, audio cap 25MB per
// plan §4.5; ceiling is the audio cap and we enforce the screenshot-specific
// cap inside the handler so the error message is actionable.
const SCREENSHOT_MAX_BYTES = 10 * 1024 * 1024;
const AUDIO_MAX_BYTES      = 25 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AUDIO_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'screenshot') {
      if (!file.mimetype?.startsWith('image/')) {
        return cb(new Error('screenshot must be image/*'));
      }
    } else if (file.fieldname === 'audio') {
      if (!file.mimetype?.startsWith('audio/')) {
        return cb(new Error('audio must be audio/*'));
      }
    } else {
      return cb(new Error(`unexpected field: ${file.fieldname}`));
    }
    cb(null, true);
  },
});

const bugReportUpload = upload.fields([
  { name: 'screenshot', maxCount: 1 },
  { name: 'audio',      maxCount: 1 },
]);

module.exports = { bugReportUpload, SCREENSHOT_MAX_BYTES, AUDIO_MAX_BYTES };

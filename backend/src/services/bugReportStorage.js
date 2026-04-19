const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const BASE_DIR = process.env.BUG_REPORT_STORAGE_DIR
  || path.resolve(__dirname, '../../../uploads/bug-reports');

// Ensure the base directory exists at module load. If it can't be created,
// throw — this is a fatal misconfiguration, not something to defer.
try {
  fs.mkdirSync(BASE_DIR, { recursive: true });
} catch (err) {
  throw new Error(`[bugReportStorage] cannot create base dir ${BASE_DIR}: ${err.message}`);
}

function getReportDir(reportId) {
  if (!Number.isInteger(reportId) || reportId <= 0) {
    throw new Error(`[bugReportStorage] invalid reportId: ${reportId}`);
  }
  return path.join(BASE_DIR, String(reportId));
}

async function ensureDir(reportId) {
  const dir = getReportDir(reportId);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

function extensionForMime(mime) {
  const map = {
    'image/png':               '.png',
    'image/jpeg':              '.jpg',
    'image/jpg':               '.jpg',
    'image/webp':              '.webp',
    'audio/webm':              '.webm',
    'audio/webm;codecs=opus':  '.webm',
    'audio/mp4':               '.m4a',
    'audio/x-m4a':             '.m4a',
    'audio/mpeg':              '.mp3',
    'audio/mp3':               '.mp3',
    'audio/wav':               '.wav',
    'audio/x-wav':             '.wav',
    'audio/ogg':               '.ogg',
    'audio/opus':              '.opus',
    'audio/aac':               '.aac',
  };
  const ext = map[mime?.toLowerCase?.()];
  if (!ext) throw new Error(`[bugReportStorage] unsupported mime type: ${mime}`);
  return ext;
}

async function writeScreenshot(reportId, buffer, mime) {
  if (!Buffer.isBuffer(buffer)) throw new Error('[bugReportStorage] writeScreenshot: buffer required');
  if (!mime?.startsWith('image/')) throw new Error(`[bugReportStorage] writeScreenshot: non-image mime: ${mime}`);
  const dir = await ensureDir(reportId);
  const ext = extensionForMime(mime);
  const abspath = path.join(dir, `screenshot${ext}`);
  await fsp.writeFile(abspath, buffer);
  return abspath;
}

async function writeAudio(reportId, buffer, mime) {
  if (!Buffer.isBuffer(buffer)) throw new Error('[bugReportStorage] writeAudio: buffer required');
  if (!mime?.startsWith('audio/')) throw new Error(`[bugReportStorage] writeAudio: non-audio mime: ${mime}`);
  const dir = await ensureDir(reportId);
  const ext = extensionForMime(mime);
  const abspath = path.join(dir, `audio${ext}`);
  await fsp.writeFile(abspath, buffer);
  return abspath;
}

async function readScreenshot(reportId, abspath, mime) {
  try {
    const stat = await fsp.stat(abspath);
    return { path: abspath, mime, size: stat.size };
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function readAudio(reportId, abspath, mime) {
  try {
    const stat = await fsp.stat(abspath);
    return { path: abspath, mime, size: stat.size };
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

module.exports = {
  BASE_DIR,
  getReportDir,
  ensureDir,
  extensionForMime,
  writeScreenshot,
  writeAudio,
  readScreenshot,
  readAudio,
};

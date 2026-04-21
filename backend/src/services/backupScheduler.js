const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Repo root is 3 levels up from backend/src/services/
const REPO_ROOT = path.resolve(__dirname, '../../..');
const BACKUP_DIR = path.join(REPO_ROOT, 'backups');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/hr_system.db');
const KEEP_COUNT = 7;

function makeBackupFilename() {
  // ISO: 2026-04-11T23:30:00.000Z  →  hr_salary_2026-04-11_23-30.db
  const iso = new Date().toISOString();
  const stamp = iso
    .replace(/:/g, '-')
    .replace(/\..+$/, '')   // drop milliseconds + Z
    .replace('T', '_')
    .slice(0, 16);          // YYYY-MM-DD_HH-MM
  return `hr_salary_${stamp}.db`;
}

function copyDbFile(destPath) {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`DB file not found at ${DB_PATH}`);
  }
  fs.copyFileSync(DB_PATH, destPath);
}

function cleanupOldBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .sort(); // lexicographic sort works since filenames encode date
  if (files.length <= KEEP_COUNT) return 0;
  const toDelete = files.slice(0, files.length - KEEP_COUNT);
  for (const f of toDelete) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (e) { /* ignore */ }
  }
  return toDelete.length;
}

function gitCommitAndPush() {
  const execOpts = { stdio: 'pipe', cwd: REPO_ROOT };
  const dateStr = new Date().toISOString().slice(0, 10);
  const commitMsg = `chore: nightly DB backup ${dateStr} [skip ci]`;

  try {
    // -f required because backups/*.db is in .gitignore for manual workflow;
    // only the cron is allowed to commit them.
    execSync('git add -f backups/', execOpts);
  } catch (e) {
    console.error('[Backup] git add failed:', e.message);
    return;
  }
  try {
    execSync(`git commit -m "${commitMsg}" --allow-empty`, execOpts);
  } catch (e) {
    console.error('[Backup] git commit failed:', e.message);
    return;
  }
  try {
    execSync('git push origin HEAD', execOpts);
  } catch (e) {
    console.error('[Backup] git push failed:', e.message);
    return;
  }
  console.log('[Backup] Git commit + push complete');
}

function runBackup() {
  try {
    console.log('[Backup] Starting nightly backup...');

    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const filename = makeBackupFilename();
    const destPath = path.join(BACKUP_DIR, filename);
    copyDbFile(destPath);
    console.log(`[Backup] File copied: backups/${filename}`);

    cleanupOldBackups();
    console.log(`[Backup] Cleaned up old backups (kept ${KEEP_COUNT})`);

    gitCommitAndPush();

    console.log('[Backup] Complete ✅');
  } catch (e) {
    console.error(`[Backup] FAILED: ${e.message}`);
  }
}

function initBackupScheduler() {
  const BACKUP_ENABLED = process.env.BACKUP_CRON_ENABLED === 'true';
  if (!BACKUP_ENABLED) {
    console.log('[Backup] cron disabled via BACKUP_CRON_ENABLED=false');
    return;
  }
  // 11:30 PM daily
  cron.schedule('30 23 * * *', () => {
    runBackup();
  });
  console.log('[Backup] Scheduler initialized (23:30 daily)');
}

module.exports = { initBackupScheduler };

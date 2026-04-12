// ── Crash handlers (must be first) ────────────────────────────
console.log('[BOOT] Starting HR Salary System...');
console.log('[BOOT] Node version:', process.version);
console.log('[BOOT] Platform:', process.platform, process.arch);
console.log('[BOOT] CWD:', process.cwd());
console.log('[BOOT] ENV: NODE_ENV=%s PORT=%s DATA_DIR=%s', process.env.NODE_ENV, process.env.PORT, process.env.DATA_DIR);
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err.message);
  console.error(err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
  process.exit(1);
});

try { require('express-async-errors'); } catch (e) { console.warn('⚠️  express-async-errors not found, async errors may not be caught'); }
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { requestIdMiddleware } = require('./src/middleware/requestId');
console.log('[BOOT] Core modules loaded');

// ── Directory setup ───────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
console.log('[BOOT] DATA_DIR:', DATA_DIR, 'exists:', fs.existsSync(DATA_DIR));
console.log('[BOOT] UPLOADS_DIR:', uploadsDir);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
console.log('[BOOT] Directories ensured');

// ── Database init (must be before routes) ─────────────────────
console.log('[BOOT] Loading better-sqlite3...');
const { getDb } = require('./src/database/db');
console.log('[BOOT] Initializing database...');
const db = getDb();
console.log('[BOOT] Database initialized');

// ── Seed admin user (create if missing, never overwrite custom password) ──
(function seedAdmin() {
  const adminUser = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (!adminUser) {
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
    const hash = bcrypt.hashSync(adminPassword, 10);
    db.prepare("INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, 'admin', 1)")
      .run('admin', hash);
    console.log('👤 Admin user created (username: admin)');
  } else {
    // Ensure admin is active but don't touch password
    db.prepare("UPDATE users SET is_active = 1 WHERE username = 'admin'").run();
    console.log('👤 Admin user exists (is_active ensured)');
  }
})();

// ── Seed HR user (create if missing, reset password on every start) ──────
(function seedHRUser() {
  const hrPassword = process.env.HR_PASSWORD || 'Indriyan@2025';
  const hash = bcrypt.hashSync(hrPassword, 10);
  const hrUser = db.prepare("SELECT id FROM users WHERE username = 'hr'").get();
  if (!hrUser) {
    db.prepare("INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, 'hr', 1)")
      .run('hr', hash);
    console.log('👤 HR user created (username: hr)');
  } else {
    db.prepare("UPDATE users SET password_hash = ?, role = 'hr', is_active = 1 WHERE username = 'hr'")
      .run(hash);
    console.log('👤 HR user password reset');
  }
})();

// ── Seed Finance user ──────
(function seedFinanceUser() {
  const finHash = bcrypt.hashSync(process.env.FINANCE_PASSWORD || 'Finance@2025', 10);
  const finUser = db.prepare("SELECT id FROM users WHERE username = 'finance'").get();
  if (!finUser) {
    db.prepare("INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, 'finance', 1)").run('finance', finHash);
    console.log('👤 Finance user created (username: finance)');
  }
})();

const app = express();
const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV === 'production';

// ── CORS ──────────────────────────────────────────────────────
let allowedOrigins;
if (IS_PROD) {
  const envOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (envOrigins.length > 0) {
    allowedOrigins = envOrigins;
  } else if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    allowedOrigins = [`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`];
  } else {
    console.warn('⚠️  CORS: No ALLOWED_ORIGINS set in production — defaulting to same-origin only');
    allowedOrigins = [];
  }
} else {
  allowedOrigins = ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:3000'];
}

app.use(cors({
  origin: (origin, cb) => {
    // In prod: allow if in list OR if no origin (same-origin / server-side)
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true
}));

// ── Security: hide server identity ───────────────────────────
app.disable('x-powered-by');

// ── Performance: Compression ─────────────────────────────────
app.use(compression({
  level: 6,
  threshold: 1024,        // Only compress responses > 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Performance: API response caching for GET endpoints ──────
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' && !req.path.includes('/health')) {
    // Cache GET API responses for 5 seconds (short but prevents redundant hits)
    res.setHeader('Cache-Control', 'private, max-age=5');
  }
  next();
});

// ── Request-ID Middleware ─────────────────────────────────────
app.use('/api', requestIdMiddleware);

// ── Auth middleware ────────────────────────────────────────────
const { requireAuth } = require('./src/middleware/auth');

// ── Usage Logging Middleware ─────────────────────────────────────
app.use('/api', (req, res, next) => {
  // Log all API requests after auth resolves
  const start = Date.now();
  res.on('finish', () => {
    try {
      if (req.user && req.path !== '/health') {
        db.prepare(`
          INSERT INTO usage_logs (user_id, username, role, action, method, path, ip_address, user_agent, details)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          req.user.id, req.user.username, req.user.role,
          `${req.method} ${req.path}`, req.method, req.originalUrl,
          req.ip || req.connection?.remoteAddress || '',
          (req.headers['user-agent'] || '').substring(0, 200),
          JSON.stringify({ status: res.statusCode, duration: Date.now() - start })
        );
      }
    } catch (e) { /* ignore logging errors */ }
  });
  next();
});

// ── API Routes ─────────────────────────────────────────────────
// Auth is public (with rate limiting on login)
const rateLimit = require('express-rate-limit');
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts, please try again in 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});
app.post('/api/auth/login', loginLimiter);
app.use('/api/auth', require('./src/routes/auth'));

// All other API routes require authentication
app.use('/api/import',     requireAuth, require('./src/routes/import'));
app.use('/api/attendance', requireAuth, require('./src/routes/attendance'));
app.use('/api/employees',  requireAuth, require('./src/routes/employees'));
app.use('/api/payroll',    requireAuth, require('./src/routes/payroll'));
app.use('/api/analytics',  requireAuth, require('./src/routes/analytics'));
app.use('/api/reports',    requireAuth, require('./src/routes/reports'));
app.use('/api/settings',   requireAuth, require('./src/routes/settings'));
app.use('/api/advance',    requireAuth, require('./src/routes/advance'));
app.use('/api/salary-input', requireAuth, require('./src/routes/salary-input'));
app.use('/api/daily-mis',   requireAuth, require('./src/routes/daily-mis'));
app.use('/api/loans',       requireAuth, require('./src/routes/loans'));
app.use('/api/leaves',      requireAuth, require('./src/routes/leaves'));
app.use('/api/notifications', requireAuth, require('./src/routes/notifications'));
app.use('/api/lifecycle',   requireAuth, require('./src/routes/lifecycle'));
app.use('/api/usage-logs',  requireAuth, require('./src/routes/usage-logs'));
app.use('/api/finance-audit', requireAuth, require('./src/routes/financeAudit'));
app.use('/api/session-analytics', requireAuth, require('./src/routes/sessionAnalytics'));
app.use('/api/features',          requireAuth, require('./src/routes/phase5'));
app.use('/api/jobs',              requireAuth, require('./src/routes/jobs'));
app.use('/api/notifications',    requireAuth, require('./src/routes/notifications'));
app.use('/api/tax-declarations', requireAuth, require('./src/routes/taxDeclarations'));
app.use('/api/portal',           requireAuth, require('./src/routes/employeePortal'));
app.use('/api/finance-verify',   requireAuth, require('./src/routes/financeVerification'));
app.use('/api/extra-duty-grants', requireAuth, require('./src/routes/extraDutyGrants'));
app.use('/api/late-coming',      requireAuth, require('./src/routes/lateComing'));
app.use('/api/daily-wage',       requireAuth, require('./src/routes/dailyWage'));
app.use('/api/short-leaves',     requireAuth, require('./src/routes/short-leaves'));
app.use('/api/early-exits',      requireAuth, require('./src/routes/early-exits'));
// Alias — range report + MTD endpoints are also exposed under the singular path.
app.use('/api/early-exit',       requireAuth, require('./src/routes/early-exits'));
app.use('/api/early-exit-deductions', requireAuth, require('./src/routes/early-exit-deductions'));

// Health check (public)
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'HR Salary System API running', timestamp: new Date().toISOString() });
});

// Version endpoint (public) — for deployment diagnostics
app.get('/api/version', (req, res) => {
  const distIndex = path.join(__dirname, '../frontend/dist/index.html');
  let frontendBundle = 'unknown';
  try {
    const html = fs.readFileSync(distIndex, 'utf8');
    const m = html.match(/index-([A-Za-z0-9_-]+)\.js/);
    if (m) frontendBundle = m[1];
  } catch (e) {}
  res.json({
    version: '1.1.0',
    deployedAt: new Date().toISOString(),
    commit: 'bebc936',
    frontendBundle,
    nodeEnv: process.env.NODE_ENV || 'development'
  });
});

// ── Serve React frontend in production ────────────────────────
if (IS_PROD) {
  const distPath = path.join(__dirname, '../frontend/dist');
  if (fs.existsSync(distPath)) {
    // Serve static assets with long cache (Vite hashed filenames)
    app.use(express.static(distPath, {
      maxAge: '30d',          // Cache hashed assets for 30 days
      immutable: true,
      etag: true,
      lastModified: true,
      setHeaders: (res, filePath) => {
        // index.html should NOT be cached (SPA entry)
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      }
    }));
    // SPA fallback — send index.html for navigation requests only
    // Do NOT serve index.html for missing static assets (.js, .css, .png, etc.)
    // as this causes "text/html is not a valid JavaScript MIME type" errors
    app.get('*', (req, res) => {
      const ext = path.extname(req.path);
      if (ext && ext !== '.html') {
        // This is a request for a static asset that doesn't exist (stale cache)
        return res.status(404).send('Not found');
      }
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log(`📦 Serving frontend from ${distPath}`);
  } else {
    console.warn('⚠️  Frontend dist/ not found. Run: npm run build --prefix frontend');
  }
}

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  // Verbose log so we can identify which endpoint and column the SQL error
  // came from when "no such column" surfaces in production.
  console.error('API Error:', req.method, req.originalUrl);
  console.error('  message:', err.message);
  if (err.stack) console.error('  stack:', err.stack.split('\n').slice(0, 6).join('\n'));
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    stack: IS_PROD ? undefined : err.stack
  });
});

app.listen(PORT, () => {
  console.log(`\n✅ HR Salary System running on http://localhost:${PORT}`);
  console.log(`   Mode:     ${IS_PROD ? 'production' : 'development'}`);
  console.log(`   Data dir: ${DATA_DIR}`);
  if (IS_PROD) console.log(`   Frontend: served from /frontend/dist`);
  console.log('');

  // Start background job queue worker
  try { require('./src/services/jobQueue').startWorker(); } catch (e) { console.error('Job queue init failed:', e.message); }
  // Start month-end scheduler
  try { require('./src/services/monthEndScheduler').startScheduler(); } catch (e) { console.error('Scheduler init failed:', e.message); }
});

module.exports = app;

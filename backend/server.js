require('express-async-errors');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// ── Directory setup ───────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── Database init (must be before routes) ─────────────────────
const { getDb } = require('./src/database/db');
const db = getDb();

// ── Seed admin user on first run ──────────────────────────────
(function seedAdmin() {
  const existing = db.prepare('SELECT id FROM users LIMIT 1').get();
  if (!existing) {
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
    const hash = bcrypt.hashSync(adminPassword, 10);
    db.prepare("INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, 'admin')")
      .run('admin', hash);
    console.log('\n👤 Default admin user created:');
    console.log(`   Username: admin`);
    console.log(`   Password: ${adminPassword}`);
    console.log('   ⚠️  Change this password after first login!\n');
  }
})();

const app = express();
const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV === 'production';

// ── CORS ──────────────────────────────────────────────────────
const allowedOrigins = IS_PROD
  ? (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  : ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:3000'];

app.use(cors({
  origin: (origin, cb) => {
    // In prod: allow if in list OR if no origin (same-origin / server-side)
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true
}));

app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Auth middleware ────────────────────────────────────────────
const { requireAuth } = require('./src/middleware/auth');

// ── API Routes ─────────────────────────────────────────────────
// Auth is public
app.use('/api/auth', require('./src/routes/auth'));

// All other API routes require authentication
app.use('/api/import',     requireAuth, require('./src/routes/import'));
app.use('/api/attendance', requireAuth, require('./src/routes/attendance'));
app.use('/api/employees',  requireAuth, require('./src/routes/employees'));
app.use('/api/payroll',    requireAuth, require('./src/routes/payroll'));
app.use('/api/analytics',  requireAuth, require('./src/routes/analytics'));
app.use('/api/reports',    requireAuth, require('./src/routes/reports'));
app.use('/api/settings',   requireAuth, require('./src/routes/settings'));

// Health check (public)
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'HR Salary System API running', timestamp: new Date().toISOString() });
});

// ── Serve React frontend in production ────────────────────────
if (IS_PROD) {
  const distPath = path.join(__dirname, '../frontend/dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    // SPA fallback — send index.html for all non-API routes
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log(`📦 Serving frontend from ${distPath}`);
  } else {
    console.warn('⚠️  Frontend dist/ not found. Run: npm run build --prefix frontend');
  }
}

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('API Error:', err.message);
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
});

module.exports = app;

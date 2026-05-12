// ── Sentry instrumentation (must be imported before everything else) ──────────
const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

// PII fields to scrub from HR data
const SCRUB_FIELDS = [
  'salary', 'basic', 'hra', 'da', 'pf', 'esi', 'pt', 'tds', 'net_pay',
  'gross', 'deduction', 'pan', 'pan_number', 'uan', 'uan_number',
  'aadhaar', 'aadhar', 'bank_account', 'account_number', 'ifsc',
  'biometric', 'attendance_raw', 'password', 'token',
];

function scrubSensitive(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (SCRUB_FIELDS.some(f => k.toLowerCase().includes(f))) {
      out[k] = '[Filtered]';
    } else if (typeof v === 'object') {
      out[k] = scrubSensitive(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  release: process.env.SENTRY_RELEASE,
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.2'),
  profilesSampleRate: 1.0,
  integrations: [
    nodeProfilingIntegration(),
  ],
  beforeSend(event) {
    // Scrub PII from request body
    if (event.request && event.request.data) {
      event.request.data = scrubSensitive(
        typeof event.request.data === 'string'
          ? JSON.parse(event.request.data)
          : event.request.data
      );
    }
    // Scrub PII from extra context
    if (event.extra) {
      event.extra = scrubSensitive(event.extra);
    }
    return event;
  },
});

module.exports = Sentry;

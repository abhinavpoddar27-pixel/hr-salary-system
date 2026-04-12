/**
 * Request-ID Middleware
 *
 * Stamps every incoming HTTP request with a unique short ID.
 * The ID is:
 *   - Attached to req.requestId for use in route handlers and services
 *   - Sent back in the x-request-id response header so the frontend can log it
 *   - Logged on request arrival AND response completion with method, path,
 *     status code, and duration
 *
 * Log format (arrival):
 *   [req-a3f9b2c1] → POST /api/payroll/compute-salary company=Asian Lakto month=3 year=2026
 *
 * Log format (completion):
 *   [req-a3f9b2c1] ← 200 OK (8432ms)
 *   [req-a3f9b2c1] ← 500 ERROR (412ms)
 *   [req-a3f9b2c1] ← 404 WARN (23ms)
 */

const { v4: uuidv4 } = require('uuid');

function requestIdMiddleware(req, res, next) {
  const requestId = req.headers['x-request-id'] || `req-${uuidv4().slice(0, 8)}`;
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  // Skip logging for health checks to avoid noise
  if (req.path === '/health' || req.path.includes('/health')) {
    return next();
  }

  const ctx = [
    req.query.company ? `company=${req.query.company}` : '',
    req.query.month   ? `month=${req.query.month}`     : '',
    req.query.year    ? `year=${req.query.year}`       : '',
    req.params?.code  ? `code=${req.params.code}`      : '',
  ].filter(Boolean).join(' ');

  console.log(`[${requestId}] → ${req.method} ${req.path}${ctx ? ' ' + ctx : ''}`);

  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'ERROR'
                : res.statusCode >= 400 ? 'WARN'
                : 'OK';
    console.log(`[${requestId}] ← ${res.statusCode} ${level} (${duration}ms)`);
  });

  next();
}

module.exports = { requestIdMiddleware };

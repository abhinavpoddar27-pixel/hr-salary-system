const crypto = require('crypto');

// Expected signature header name per Sarvam webhook docs. All header lookups
// are lowercased (Node normalizes to lowercase in req.headers but callers may
// pass arbitrary casing from req.get() etc., so we accept either).
const SIGNATURE_HEADER_NAME = 'x-sarvam-signature';

// HMAC-SHA256 of the raw body bytes, hex-encoded. Must be called with the
// UNPARSED body (Buffer) — re-serializing parsed JSON changes whitespace and
// breaks verification. Step 7 wires this to express.raw({ type: ... }).
function computeSignature(rawBody, secret) {
  if (!Buffer.isBuffer(rawBody)) throw new Error('rawBody must be a Buffer');
  if (!secret) throw new Error('secret required');
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

// Constant-time compare of two hex strings. Length mismatch short-circuits
// without timingSafeEqual (which throws on mismatched buffers); the early
// return is still O(1) w.r.t. the secret so it's not a side channel.
function safeHexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let ba;
  let bb;
  try {
    ba = Buffer.from(a, 'hex');
    bb = Buffer.from(b, 'hex');
  } catch (_) {
    return false;
  }
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Must match the algorithm in sarvamTranscription.generateCallbackToken —
// same secret, same stringified reportId input, same digest.
function expectedAuthToken(reportId, secret) {
  return crypto.createHmac('sha256', secret).update(String(reportId)).digest('hex');
}

// Order: signature (fail the cheap+broad attack first) → token (proves the
// payload targets THIS report, not a neighbour's) → DB read (most expensive;
// also serves the idempotency + existence gate).
function verifyWebhook({ rawBody, signatureHeader, reportId, payloadObj, db }) {
  const secret = process.env.SARVAM_WEBHOOK_SECRET;
  if (!secret) {
    return { ok: false, code: 'SERVER_MISCONFIGURED', message: 'webhook secret not set' };
  }

  if (!Buffer.isBuffer(rawBody)) {
    return { ok: false, code: 'SIGNATURE_INVALID', message: 'rawBody required' };
  }

  if (!signatureHeader || typeof signatureHeader !== 'string') {
    return { ok: false, code: 'SIGNATURE_INVALID', message: 'missing signature header' };
  }
  const expectedSig = computeSignature(rawBody, secret);
  const providedSig = signatureHeader.trim().toLowerCase();
  if (!safeHexEqual(expectedSig, providedSig)) {
    return { ok: false, code: 'SIGNATURE_INVALID', message: 'signature mismatch' };
  }

  const payloadToken = payloadObj?.auth_token ?? payloadObj?.callback_auth_token ?? null;
  if (!payloadToken || typeof payloadToken !== 'string') {
    return { ok: false, code: 'TOKEN_MISMATCH', message: 'missing auth_token in payload' };
  }
  const expectedTok = expectedAuthToken(reportId, secret);
  if (!safeHexEqual(expectedTok, payloadToken.trim().toLowerCase())) {
    return { ok: false, code: 'TOKEN_MISMATCH', message: 'auth token mismatch' };
  }

  let row;
  try {
    row = db.prepare(
      'SELECT id, transcription_status FROM bug_reports WHERE id = ?'
    ).get(reportId);
  } catch (err) {
    const code = err.code ?? 'UNKNOWN';
    return { ok: false, code: 'SERVER_ERROR', message: `db read failed: ${code}` };
  }

  if (!row) {
    return { ok: false, code: 'REPORT_NOT_FOUND', message: `no report with id ${reportId}` };
  }
  if (row.transcription_status === 'success' || row.transcription_status === 'failed') {
    return { ok: false, code: 'ALREADY_PROCESSED', message: `already ${row.transcription_status}` };
  }

  return { ok: true };
}

module.exports = {
  verifyWebhook,
  computeSignature,
  expectedAuthToken,
  safeHexEqual,
  SIGNATURE_HEADER_NAME,
};

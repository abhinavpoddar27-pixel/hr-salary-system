const fs = require('fs');
const { SarvamAIClient } = require('sarvamai');

const MODEL = process.env.SARVAM_MODEL || 'saaras:v3';
const REST_DURATION_LIMIT_SEC = 28;

function getClient() {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new Error('[sarvamTranscription] SARVAM_API_KEY not set');
  return new SarvamAIClient({ apiSubscriptionKey: key });
}

// Sarvam: ~₹30/hour = ₹0.5/min ≈ 0.6 cents/min at INR/USD ~83. Partial minutes
// round up; clamp to a minimum of 1 minute so a 0-length call is not free.
function costCentsFor(durationSec) {
  const minutes = Math.max(1, Math.ceil(durationSec / 60));
  return minutes * 0.6;
}

async function transcribe(absolutePath, mime, audioDurationSec) {
  if (typeof absolutePath !== 'string' || !absolutePath) {
    return { success: false, error: 'absolutePath required' };
  }
  if (typeof audioDurationSec !== 'number' || audioDurationSec <= 0) {
    return { success: false, error: 'audioDurationSec must be positive number' };
  }
  if (!fs.existsSync(absolutePath)) {
    return { success: false, error: `file not found: ${absolutePath}` };
  }

  if (audioDurationSec > REST_DURATION_LIMIT_SEC) {
    return {
      success: false,
      error: '[sarvamTranscription] batch path not implemented until step 5',
      pending: false,
    };
  }

  if (!process.env.SARVAM_API_KEY) {
    return {
      success: false,
      error: '[sarvamTranscription] SARVAM_API_KEY not set',
      model_used: MODEL,
      path: 'rest',
    };
  }

  try {
    const client = getClient();
    // saaras:v3 with mode=translate produces English output directly. In the
    // current SDK (sarvamai@1.x) that combination is exposed through the
    // `transcribe()` method — `translate()` only allows saaras:v2.5. Response
    // shape is identical either way: { transcript, language_code, ... }.
    const result = await client.speechToText.transcribe({
      file: fs.createReadStream(absolutePath),
      model: MODEL,
      mode: 'translate',
    });

    const text = result.transcript ?? result.text ?? '';
    const detectedLanguage = result.language_code ?? result.detected_language ?? null;

    if (!text) {
      return {
        success: false,
        error: 'Sarvam returned empty transcript',
        model_used: MODEL,
        path: 'rest',
      };
    }

    return {
      success: true,
      text,
      detected_language: detectedLanguage,
      model_used: MODEL,
      cost_cents: costCentsFor(audioDurationSec),
      path: 'rest',
      error: null,
    };
  } catch (err) {
    const code = err.code ?? err.statusCode ?? 'UNKNOWN';
    const status = err.status ?? err.statusCode ?? 'N/A';
    console.error(`[sarvamTranscription] REST failed: code=${code} status=${status}`);
    return {
      success: false,
      error: `Sarvam REST failed: ${code}`,
      model_used: MODEL,
      path: 'rest',
    };
  }
}

async function fetchJobResult(_jobId) {
  throw new Error('[sarvamTranscription] fetchJobResult not implemented until step 5');
}

module.exports = { transcribe, fetchJobResult, costCentsFor, REST_DURATION_LIMIT_SEC };

const fs = require('fs');
const crypto = require('crypto');
const { SarvamAIClient } = require('sarvamai');

const MODEL = process.env.SARVAM_MODEL || 'saaras:v3';
const REST_DURATION_LIMIT_SEC = 28;

// Used when creating a batch job. Webhook callback path is
// "<base>/<reportId>" so a single registered URL serves all reports.
const WEBHOOK_URL_BASE = process.env.SARVAM_BATCH_WEBHOOK_URL
  || 'https://hr-app-production-681b.up.railway.app/api/bug-reports/sarvam-webhook';

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

// Per-report HMAC. Sarvam echoes this back in the webhook payload; Step 6
// recomputes it and compares in constant time. Stable for a given (reportId,
// secret) pair — rotating the secret invalidates in-flight jobs, which is why
// the safety-net poller (Step 8) exists.
function generateCallbackToken(reportId) {
  const secret = process.env.SARVAM_WEBHOOK_SECRET;
  if (!secret) throw new Error('[sarvamTranscription] SARVAM_WEBHOOK_SECRET not set');
  return crypto
    .createHmac('sha256', secret)
    .update(String(reportId))
    .digest('hex');
}

async function createBatchJob(absolutePath, mime, audioDurationSec, reportId) {
  if (!Number.isInteger(reportId) || reportId <= 0) {
    return { success: false, error: 'valid reportId required for batch jobs', path: 'batch' };
  }

  if (!process.env.SARVAM_API_KEY) {
    return {
      success: false,
      error: '[sarvamTranscription] SARVAM_API_KEY not set',
      model_used: MODEL,
      path: 'batch',
    };
  }

  // Compute callback token BEFORE the SDK call so missing-secret fails fast
  // without uploading any audio.
  let callbackToken;
  try {
    callbackToken = generateCallbackToken(reportId);
  } catch (err) {
    return {
      success: false,
      error: err.message,
      model_used: MODEL,
      path: 'batch',
    };
  }

  try {
    const client = getClient();
    const callbackUrl = `${WEBHOOK_URL_BASE}/${reportId}`;

    // createJob() does not expose `mode`, so we call initialise() directly —
    // mode=translate on saaras:v3 is the whole point of this service.
    const initResp = await client.speechToTextJob.initialise({
      job_parameters: {
        model: MODEL,
        mode: 'translate',
      },
      callback: {
        url: callbackUrl,
        auth_token: callbackToken,
      },
    });

    const jobId = initResp?.job_id ?? initResp?.data?.job_id ?? null;
    if (!jobId) {
      return {
        success: false,
        error: 'Sarvam did not return a job_id',
        model_used: MODEL,
        path: 'batch',
      };
    }

    // Grab a handle and run the two-step upload → start flow. uploadFiles
    // fetches presigned URLs, PUTs the bytes to S3, then start() kicks off
    // processing.
    const instance = client.speechToTextJob.getJob(jobId);
    await instance.uploadFiles([absolutePath]);
    await instance.start();

    return {
      success: false,      // transcription not yet complete
      pending: true,       // caller should await webhook (or poller in Step 8)
      job_id: jobId,
      path: 'batch',
      model_used: MODEL,
      cost_cents: costCentsFor(audioDurationSec),
      error: null,
    };
  } catch (err) {
    const code = err.code ?? err.statusCode ?? 'UNKNOWN';
    const status = err.status ?? err.statusCode ?? 'N/A';
    console.error(`[sarvamTranscription] batch create failed: code=${code} status=${status}`);
    return {
      success: false,
      pending: false,
      error: `Sarvam batch create failed: ${code}`,
      model_used: MODEL,
      path: 'batch',
    };
  }
}

async function transcribe(absolutePath, mime, audioDurationSec, reportId = null) {
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
    if (reportId === null || reportId === undefined) {
      return {
        success: false,
        error: 'reportId required for batch jobs (audio > 28s)',
        path: 'batch',
      };
    }
    return createBatchJob(absolutePath, mime, audioDurationSec, reportId);
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

async function fetchJobResult(jobId) {
  if (!jobId) return { success: false, error: 'jobId required' };

  if (!process.env.SARVAM_API_KEY) {
    return { success: false, error: '[sarvamTranscription] SARVAM_API_KEY not set' };
  }

  try {
    const client = getClient();
    const instance = client.speechToTextJob.getJob(jobId);
    const jobStatus = await instance.getStatus();
    const state = jobStatus?.job_state ?? 'Unknown';

    if (state !== 'Completed') {
      return {
        success: false,
        pending: state === 'Running' || state === 'Pending' || state === 'Accepted',
        status: state,
        error: `job not yet complete: ${state}`,
      };
    }

    // Single-file job — grab the output mapping, presign a download URL,
    // fetch the JSON result, extract transcript + language. Output shape
    // matches the REST response: { transcript, language_code, ... }.
    const mappings = await instance.getOutputMappings();
    const mapping = mappings?.[0];
    if (!mapping || !mapping.output_file) {
      return {
        success: false,
        error: 'completed job has no output file',
        status: state,
      };
    }

    const linksResp = await client.speechToTextJob.getDownloadLinks({
      job_id: jobId,
      files: [mapping.output_file],
    });
    const fileUrl = linksResp?.download_urls?.[mapping.output_file]?.file_url;
    if (!fileUrl) {
      return {
        success: false,
        error: 'could not resolve download URL for output file',
        status: state,
      };
    }

    const res = await fetch(fileUrl);
    if (!res.ok) {
      return {
        success: false,
        error: `output download failed: HTTP ${res.status}`,
        status: state,
      };
    }
    const payload = await res.json();
    const text = payload.transcript ?? payload.text ?? '';
    const detectedLanguage = payload.language_code ?? payload.detected_language ?? null;

    if (!text) {
      return {
        success: false,
        error: 'completed job returned empty transcript',
        status: state,
      };
    }

    return {
      success: true,
      text,
      detected_language: detectedLanguage,
      status: state,
    };
  } catch (err) {
    const code = err.code ?? err.statusCode ?? 'UNKNOWN';
    console.error(`[sarvamTranscription] fetchJobResult failed: code=${code}`);
    return { success: false, error: `fetch failed: ${code}` };
  }
}

module.exports = { transcribe, fetchJobResult, costCentsFor, REST_DURATION_LIMIT_SEC };

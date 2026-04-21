const fs = require('fs');
const { getDb } = require('../database/db');
const { transcribe } = require('./sarvamTranscription');

// Match the model already in use for the Salary Explainer (ai.js) so the
// HR team only has ONE model-version to think about when iterating.
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';

// Loaded at runtime from policy_config so admins can hot-swap the prompt via
// the Query Tool without a redeploy. {{KNOWN_PAGES}} is expanded to a bullet
// list so the model sees the same canonical page names the app uses.
function loadPromptConfig(db) {
  const promptRow  = db.prepare("SELECT value FROM policy_config WHERE key='bug_report_extraction_prompt'").get();
  const versionRow = db.prepare("SELECT value FROM policy_config WHERE key='bug_report_extraction_prompt_version'").get();
  const pagesRow   = db.prepare("SELECT value FROM policy_config WHERE key='bug_report_known_pages_json'").get();
  if (!promptRow || !versionRow || !pagesRow) {
    throw new Error('policy_config seeds missing — run step 1');
  }
  const knownPages = JSON.parse(pagesRow.value);
  const pagesBlock = knownPages.map((p) => `- ${p}`).join('\n');
  const prompt = promptRow.value.replace('{{KNOWN_PAGES}}', pagesBlock);
  return { prompt, version: versionRow.value };
}

// Back-of-envelope Sonnet pricing (cents). Used for the admin observability
// column; no billing logic depends on this.
function estimateClaudeCostCents(usage) {
  const inCost  = (usage.input_tokens  || 0) / 1000 * 0.3;
  const outCost = (usage.output_tokens || 0) / 1000 * 1.5;
  return Math.round((inCost + outCost) * 100) / 100;
}

async function callClaude({ system, userContent }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error('ANTHROPIC_API_KEY not set');
    err.code = 'NO_API_KEY';
    throw err;
  }
  const res = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Anthropic HTTP ${res.status}: ${body.slice(0, 200)}`);
    err.code = `HTTP_${res.status}`;
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Claude-only entry point — used by the Sarvam webhook handler (step 7) and
// the batch poller (step 8) after transcription already landed in the row.
// NEVER throws: every failure mode writes claude_run_status='failed' with
// claude_error populated. PII (transcript, username) is NOT logged.
async function runClaudeExtraction(reportId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM bug_reports WHERE id = ?').get(reportId);
  if (!row) return { success: false, error: 'row not found' };

  db.prepare("UPDATE bug_reports SET claude_run_status='pending' WHERE id=?").run(reportId);

  let version = null;
  try {
    const cfg = loadPromptConfig(db);
    version = cfg.version;

    // Typed reports have no audio → description comes from the typed comment.
    // Audio reports have a translated English transcript from Sarvam.
    const description = row.user_typed_comment || row.transcript_english || '';
    if (!description) {
      db.prepare(`UPDATE bug_reports
         SET claude_run_status='failed',
             claude_error='no description available (no transcript or typed comment)',
             claude_prompt_version=?
       WHERE id=?`).run(version, reportId);
      return { success: false, error: 'no description' };
    }

    if (!row.screenshot_path || !fs.existsSync(row.screenshot_path)) {
      db.prepare(`UPDATE bug_reports
         SET claude_run_status='failed',
             claude_error=?,
             claude_prompt_version=?
       WHERE id=?`).run(`screenshot not found on disk: ${row.screenshot_path}`, version, reportId);
      return { success: false, error: 'screenshot missing' };
    }

    const imgB64 = fs.readFileSync(row.screenshot_path).toString('base64');
    const ctx = row.auto_context_json ? (() => { try { return JSON.parse(row.auto_context_json); } catch (_) { return {}; } })() : {};

    const userContent = [
      { type: 'image', source: { type: 'base64', media_type: row.screenshot_mime, data: imgB64 } },
      { type: 'text', text:
`DESCRIPTION: ${description}

AUTO-CONTEXT:
- Page: ${row.page_name || row.page_url || 'unknown'}
- Month/Year: ${row.selected_month || '?'}/${row.selected_year || '?'}
- Company: ${row.selected_company || '?'}
- Reporter role: ${row.reporter_role}
- Recent API calls: ${(ctx.recent_api_calls || []).length}

Produce the structured JSON intake now.`
      },
    ];

    const resp = await callClaude({ system: cfg.prompt, userContent });
    const textBlock = Array.isArray(resp.content) ? resp.content.find((b) => b.type === 'text') : null;
    const raw = textBlock ? textBlock.text : '';

    // Strict JSON parse — the prompt forbids markdown fences. Anything else
    // means the model broke format and the admin needs to see the raw output.
    let parsed;
    try {
      parsed = JSON.parse(raw.trim());
    } catch (_e) {
      db.prepare(`UPDATE bug_reports
         SET claude_run_status='failed',
             claude_error=?,
             claude_prompt_version=?
       WHERE id=?`).run(`JSON parse failure. Raw: ${raw.slice(0, 2000)}`, version, reportId);
      return { success: false, error: 'parse' };
    }

    const confidence = ['high', 'medium', 'low'].includes(parsed.summary_confidence)
      ? parsed.summary_confidence
      : 'medium';
    const costCents = estimateClaudeCostCents(resp.usage || {});

    db.prepare(`UPDATE bug_reports
       SET claude_extraction_json=?,
           claude_summary_confidence=?,
           claude_run_status='success',
           claude_error=NULL,
           claude_cost_cents=?,
           claude_prompt_version=?
     WHERE id=?`).run(JSON.stringify(parsed), confidence, costCents, version, reportId);

    return { success: true };
  } catch (err) {
    const code = err.code || err.status || 'UNKNOWN';
    const msg = (err.message || '').slice(0, 500);
    db.prepare(`UPDATE bug_reports
       SET claude_run_status='failed',
           claude_error=?,
           claude_prompt_version=?
     WHERE id=?`).run(`Claude call failed: ${code} — ${msg}`, version, reportId);
    return { success: false, error: code };
  }
}

// Full pipeline entry point — transcription (Sarvam REST or Batch) followed
// by Claude extraction. Used by the POST /api/bug-reports handler (step 11)
// and by the boot-time resurrector (step 10). Batch path returns early with
// `pending: 'batch'` — the webhook/poller drives the Claude kick later.
async function processBugReport(reportId, { forceReanalyze = false } = {}) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM bug_reports WHERE id=?').get(reportId);
  if (!row) return { success: false, error: 'not found' };

  if (row.input_method === 'typed') {
    db.prepare("UPDATE bug_reports SET transcription_status='skipped' WHERE id=?").run(reportId);
  } else if (row.transcript_english && !forceReanalyze) {
    // Already transcribed; Reanalyze flow reuses it to save Sarvam cost.
  } else {
    db.prepare("UPDATE bug_reports SET transcription_status='pending' WHERE id=?").run(reportId);
    const result = await transcribe(
      row.audio_path, row.audio_mime, row.audio_duration_sec, reportId
    );

    if (result.pending) {
      db.prepare(`UPDATE bug_reports
         SET transcription_status='batch_queued',
             transcription_path=?,
             transcription_model=?,
             transcription_cost_cents=?,
             sarvam_job_id=?,
             sarvam_job_status='created',
             sarvam_job_created_at=datetime('now')
       WHERE id=?`).run('batch', result.model_used, result.cost_cents, result.job_id, reportId);
      return { success: true, pending: 'batch' };
    }

    if (!result.success) {
      db.prepare(`UPDATE bug_reports
         SET transcription_status='failed',
             transcription_error=?,
             transcription_path=?
       WHERE id=?`).run(result.error || 'unknown', result.path || 'rest', reportId);
      return { success: false, error: result.error };
    }

    db.prepare(`UPDATE bug_reports
       SET transcript_english=?,
           transcript_detected_language=?,
           transcription_status='success',
           transcription_path='rest',
           transcription_model=?,
           transcription_cost_cents=?
     WHERE id=?`).run(
        result.text, result.detected_language, result.model_used, result.cost_cents, reportId
    );
  }

  return runClaudeExtraction(reportId);
}

module.exports = { processBugReport, runClaudeExtraction };

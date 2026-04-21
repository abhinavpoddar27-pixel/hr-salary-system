# Bug Reporter — Plan Document (v3, Sarvam + webhooks)

**Owner:** Abhinav
**Status:** Approved for build (all-at-once deploy)
**Author:** Claude (planning session, April 2026)
**Revision:** v3 — replaces OpenAI with Sarvam Saaras v3, single `translate` mode call, webhook-based batch job completion, Claude no longer translates

---

## 1. Summary

A bug-reporting feature for HR and finance users. Inputs: required screenshot + required description (voice OR uploaded audio OR typed text). Outputs: structured ticket in `/admin/bug-reports`, with Claude-generated English summary grounded in the screenshot + Sarvam-translated English transcript.

**Design intent:** structure of the form is the primary product. AI (Sarvam translation + Claude extraction) is a multiplier. If both work, bug-triage time drops from "WhatsApp screenshot + 20-min back-and-forth" to "10-second triage in the inbox."

**Changes from v2:**
- Transcription provider: OpenAI → **Sarvam** (`saaras:v3` model, `translate` mode)
- Single Sarvam call per report — returns English text directly, skipping Claude's translation step
- Long audio (>30s) routed through Sarvam's Batch API via **webhooks** (with polling safety net)
- Claude extraction prompt simplified — no translation logic
- New public webhook endpoint with signature verification and idempotency
- New risks: public endpoint attack surface, signature verification correctness, webhook delivery failure recovery

**Explicitly out of scope:**
- Hypothesis generation about root cause
- Suggestions for code fixes
- Auto-routing or auto-labelling
- Storing original-language (Hinglish) transcript — we only store the English translation

---

## 2. User-facing flow

### 2.1 Reporter (any role)
1. Click **Report an issue** (sidebar, bottom, all roles)
2. Modal opens — auto-context snapshotted immediately
3. Attach screenshot — required
4. Describe the issue, choosing one path:
   - **Record now** (primary) — in-browser, max 2 min
   - **Upload audio** (secondary) — file picker, max 25MB (UI says "keep under 4 min")
   - **Type instead** (tertiary) — textarea fallback
5. Review collapsed "What we're sending" panel (auto-context preview)
6. Submit → toast "Reported, thanks" → modal closes
7. Backend processes asynchronously (Sarvam translation → Claude extraction)

### 2.2 Admin (you)
1. Sidebar badge shows `new` count (polled every 60s)
2. `/admin/bug-reports` list view
3. Click row → detail view, ordered top-to-bottom:
   1. Header — reporter, role, page, when, status
   2. Quick actions — `▶ Listen` button, status dropdown, save notes, **Copy ticket summary**
   3. **English summary** (Claude) with confidence pill — yellow if low/medium
   4. Screenshot (full size, click to expand)
   5. Audio player + **English transcript** (Sarvam's translation)
   6. Visible data (employees, amounts, dates — Claude extraction)
   7. Open questions Claude flagged
   8. Auto-context (collapsed)
   9. Admin notes + status dropdown
   10. Extraction quality feedback — `good / acceptable / bad` + free-text (for prompt iteration)

---

## 3. Database schema

One new table. Files on disk, paths in DB. CHECK constraints enforce enum + row consistency at DB layer.

```sql
CREATE TABLE IF NOT EXISTS bug_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Reporter
  reporter_username TEXT NOT NULL,
  reporter_role TEXT NOT NULL,

  -- Page context at time of report
  page_url TEXT,
  page_name TEXT,
  selected_month INTEGER,
  selected_year INTEGER,
  selected_company TEXT,

  -- Screenshot (REQUIRED) — disk-stored
  screenshot_path TEXT NOT NULL,
  screenshot_mime TEXT NOT NULL,
  screenshot_size_bytes INTEGER NOT NULL,

  -- Audio (OPTIONAL) — disk-stored
  audio_path TEXT,
  audio_mime TEXT,
  audio_duration_sec REAL,
  audio_size_bytes INTEGER,
  audio_source TEXT CHECK (audio_source IN ('recorded', 'uploaded') OR audio_source IS NULL),

  -- Sarvam transcription (single call, translate mode)
  transcript_english TEXT,                 -- populated by Sarvam's translate output
  transcript_detected_language TEXT,       -- Sarvam's detected source language ISO
  transcription_status TEXT CHECK (transcription_status IN ('pending','rest_sync','batch_queued','batch_polling','success','failed','skipped') OR transcription_status IS NULL),
  transcription_error TEXT,
  transcription_model TEXT,                -- 'saaras:v3'
  transcription_path TEXT,                 -- 'rest' | 'batch' (for observability)
  transcription_cost_cents REAL,

  -- Sarvam batch job tracking (only used when audio > 30s)
  sarvam_job_id TEXT,                      -- NULL if REST sync was used
  sarvam_job_status TEXT CHECK (sarvam_job_status IN ('none','created','in_progress','completed','failed','expired') OR sarvam_job_status IS NULL),
  sarvam_job_created_at TEXT,
  sarvam_job_completed_at TEXT,
  sarvam_webhook_received_at TEXT,         -- when we got the callback
  sarvam_poll_fallback_used INTEGER DEFAULT 0,  -- 1 if safety-net polling resolved instead of webhook

  -- Typed fallback (when no audio)
  user_typed_comment TEXT,

  -- Input method
  input_method TEXT NOT NULL CHECK (input_method IN ('recorded','uploaded','typed')),

  -- Auto-context (snapshotted when modal opened)
  auto_context_json TEXT,

  -- Claude extraction (no translation — Sarvam already did that)
  claude_extraction_json TEXT,
  claude_summary_confidence TEXT CHECK (claude_summary_confidence IN ('high','medium','low') OR claude_summary_confidence IS NULL),
  claude_run_status TEXT CHECK (claude_run_status IN ('pending','success','failed','skipped') OR claude_run_status IS NULL),
  claude_error TEXT,
  claude_cost_cents REAL,
  claude_prompt_version TEXT,

  -- Admin workflow
  admin_status TEXT NOT NULL DEFAULT 'new'
    CHECK (admin_status IN ('new','triaged','in_progress','resolved','wont_fix','duplicate')),
  admin_notes TEXT,
  resolved_at TEXT,
  resolved_by TEXT,

  -- Prompt iteration feedback
  admin_extraction_quality TEXT
    CHECK (admin_extraction_quality IN ('good','acceptable','bad') OR admin_extraction_quality IS NULL),
  admin_feedback_on_extraction TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- COMPOUND CONSISTENCY CHECK
  CHECK (
    (input_method = 'recorded' AND audio_path IS NOT NULL AND audio_source = 'recorded') OR
    (input_method = 'uploaded' AND audio_path IS NOT NULL AND audio_source = 'uploaded') OR
    (input_method = 'typed'    AND user_typed_comment IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_bug_reports_status         ON bug_reports(admin_status);
CREATE INDEX IF NOT EXISTS idx_bug_reports_created        ON bug_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bug_reports_reporter       ON bug_reports(reporter_username);
CREATE INDEX IF NOT EXISTS idx_bug_reports_admin_status   ON bug_reports(admin_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bug_reports_sarvam_job     ON bug_reports(sarvam_job_id) WHERE sarvam_job_id IS NOT NULL;
```

### 3.1 policy_config seeds

```sql
INSERT OR IGNORE INTO policy_config (key, value, description) VALUES
  ('bug_report_extraction_prompt', <<prompt from Section 5>>,
   'Hot-swappable extraction prompt. Edit via Query Tool to iterate without deploy.'),
  ('bug_report_extraction_prompt_version', 'v3-2026-04-19',
   'Manual version tag. Update when prompt changes.'),
  ('bug_report_known_pages_json', <<JSON array from Section 5.1>>,
   'Known pages list injected into extraction prompt at runtime.'),
  ('bug_report_sarvam_webhook_secret', <<random 32-byte hex>>,
   'Shared secret for verifying Sarvam webhook signatures. Rotate quarterly.');
```

### 3.2 Disk storage layout

```
/app/uploads/bug-reports/<id>/
  screenshot.{png|jpeg|webp}
  audio.{webm|mp4|mp3|m4a|ogg|opus|wav}
```

Backup: DB included in GitHub nightly. `/app/uploads/bug-reports/` excluded (documented acceptance of loss-on-volume-failure).

---

## 4. Backend

### 4.1 New env vars (Railway)
```
SARVAM_API_KEY=<key>
SARVAM_MODEL=saaras:v3
SARVAM_BATCH_WEBHOOK_URL=https://hr-app-production-681b.up.railway.app/api/bug-reports/sarvam-webhook
BUG_REPORT_MAX_AUDIO_MB=25
BUG_REPORT_STORAGE_DIR=/app/uploads/bug-reports
BUG_REPORT_RATE_LIMIT_PER_USER_PER_HOUR=10
BUG_REPORT_SARVAM_POLL_FALLBACK_INTERVAL_SEC=120   # safety-net poll frequency for missed webhooks
BUG_REPORT_SARVAM_POLL_FALLBACK_MAX_AGE_MIN=30     # give up after this long
```

### 4.2 Sarvam key discipline
- Store in Railway env var only; never in code or logs
- Rotate quarterly; document rotation steps in CLAUDE.md
- Log only `error.status` and `error.code`; never log request body or key
- Check monthly usage on Sarvam dashboard against expected volume

### 4.3 New files
- `backend/src/routes/bugReports.js` — all CRUD + webhook + reanalyze
- `backend/src/services/sarvamTranscription.js` — unified facade: choose REST vs Batch, handle webhook parsing, cost calc
- `backend/src/services/sarvamWebhookVerify.js` — HMAC signature verification + idempotency check
- `backend/src/services/sarvamBatchPoller.js` — safety-net poller for jobs stuck without webhook delivery
- `backend/src/services/bugReportAnalyzer.js` — orchestrator (transcription → Claude extraction → row update)
- `backend/src/services/bugReportStorage.js` — disk I/O helpers
- `backend/src/services/bugReportResurrect.js` — boot-time rescue for stuck rows
- `backend/src/middleware/uploadBugReport.js` — multer (disk storage)
- `backend/test/fixtures/bug-reporter/sample-hinglish.m4a` — committed fixture (22s, already supplied)
- `backend/test/bugReporter.test.js` — integration tests

### 4.4 Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/bug-reports` | any auth, rate-limited | create report |
| GET | `/api/bug-reports` | admin | paginated list |
| GET | `/api/bug-reports/count?status=new` | admin | sidebar badge |
| GET | `/api/bug-reports/:id` | admin | detail |
| GET | `/api/bug-reports/:id/screenshot` | admin | streams file |
| GET | `/api/bug-reports/:id/audio` | admin | streams file |
| PUT | `/api/bug-reports/:id` | admin | update status, notes, quality grade |
| POST | `/api/bug-reports/:id/reanalyze` | admin | re-run Claude extraction (preserves transcript) |
| POST | `/api/bug-reports/sarvam-webhook/:id` | **public, signature-verified** | Sarvam batch completion callback |

**Critical mounting detail:** the webhook route MUST be mounted OUTSIDE `requireAuth` middleware — Sarvam can't authenticate as a user. It's protected by signature verification instead (Section 4.6).

### 4.5 sarvamTranscription.js

```js
async function transcribe(absolutePath, mime, audioDurationSec) {
  // Decision point:
  //   - duration ≤ 28s (buffer below 30s limit): REST sync path
  //   - duration > 28s: Batch path (returns { pending: true, job_id })
  //
  // REST path:
  //   - Upload file stream to Sarvam's /speech-to-text-translate endpoint
  //   - Model: saaras:v3, mode: translate
  //   - Returns: { success, transcript_english, detected_language, cost_cents, path: 'rest' }
  //
  // Batch path:
  //   - Create job via Sarvam SDK with:
  //       model: 'saaras:v3'
  //       mode: 'translate'
  //       callback: { url: SARVAM_BATCH_WEBHOOK_URL + '/' + reportId,
  //                   auth_token: <per-report token derived from webhook secret + reportId> }
  //   - Upload file to job
  //   - Returns: { pending: true, job_id, path: 'batch' }
  //   - Downstream: wait for webhook OR safety-net poll to complete
}

async function fetchJobResult(jobId) {
  // Used by safety-net poller AND webhook handler (if webhook payload doesn't
  // include result inline). Fetches final transcript from Sarvam.
}
```

Cost: ₹30/hr = roughly $0.36/hr. At current INR/USD: `cost_cents = Math.ceil(duration_sec / 60) * 0.6`. Same math as OpenAI. Treat as identical for budgeting.

### 4.6 sarvamWebhookVerify.js

Non-negotiable security layer. Three checks, in order:

```js
function verifyWebhook(req, reportId) {
  // 1. Signature check:
  //    - Read X-Sarvam-Signature header (or whatever Sarvam's current header is)
  //    - Compute HMAC-SHA256 of raw body using webhook secret from policy_config
  //    - Constant-time comparison; reject on mismatch → 401
  //
  // 2. Per-report auth token check:
  //    - When we created the job, we sent a token = HMAC(reportId, secret)
  //    - Webhook payload must echo this token in the 'auth_token' field
  //    - Rejects cross-report payload confusion → 403
  //
  // 3. Idempotency check:
  //    - Look up report row; if transcription_status already in ('success','failed'), skip
  //    - Still return 200 OK (Sarvam will stop retrying)
  //    - Log duplicate delivery for observability
}
```

Uses raw body — Express `bodyParser.json()` must be swapped for `express.raw({ type: 'application/json' })` scoped to this route, since we need the unparsed bytes for HMAC. Parse JSON manually after verification.

### 4.7 Webhook endpoint body

```js
router.post('/sarvam-webhook/:id', express.raw({ type: 'application/json' }), async (req, res) => {
  const reportId = Number(req.params.id);
  try {
    await verifyWebhook(req, reportId);          // 401/403/200-dedup as appropriate
    const payload = JSON.parse(req.body.toString('utf8'));

    // Sarvam sends job_id + status + (optionally) transcript inline.
    // If transcript not inline, call fetchJobResult(payload.job_id).
    const result = payload.transcript
      ? { transcript_english: payload.transcript, detected_language: payload.language }
      : await fetchJobResult(payload.job_id);

    // Atomic row update — transcript_english, transcription_status='success',
    //   sarvam_job_status='completed', sarvam_webhook_received_at=now()
    updateTranscriptionResult(reportId, result);

    // Kick off Claude extraction
    setImmediate(() => runClaudeExtraction(reportId).catch(noop));

    res.status(200).send('ok');
  } catch (err) {
    if (err.code === 'SIGNATURE_INVALID') return res.status(401).send('invalid signature');
    if (err.code === 'TOKEN_MISMATCH')    return res.status(403).send('token mismatch');
    console.error('[sarvam-webhook] error:', err.message);
    res.status(500).send('server error');        // Sarvam will retry
  }
});
```

### 4.8 sarvamBatchPoller.js (safety net for missed webhooks)

Cron running every `BUG_REPORT_SARVAM_POLL_FALLBACK_INTERVAL_SEC` (default 120s):

```js
// Find jobs that:
//  - have sarvam_job_id set
//  - transcription_status IN ('batch_queued', 'batch_polling')
//  - sarvam_webhook_received_at IS NULL
//  - sarvam_job_created_at > (now - BUG_REPORT_SARVAM_POLL_FALLBACK_MAX_AGE_MIN minutes)
//
// For each: call fetchJobResult(). If completed, same atomic update as webhook
// handler + set sarvam_poll_fallback_used=1 (observability: tells us how often
// webhooks fail).
//
// Jobs older than max_age_min: mark transcription_status='failed',
// transcription_error='Sarvam job timed out without webhook or poll result'.
```

This exists because webhook delivery can fail for legitimate reasons (Railway deploy bounced the server for 30s, network blip between Sarvam and us). Without this, a missed webhook means a permanently stuck row. With it, we self-heal within 2 min + whatever polling takes to catch up.

### 4.9 bugReportAnalyzer.js (simplified from v2)

```js
async function processBugReport(reportId, { forceReanalyze = false } = {}) {
  // 1. Load row
  // 2. Transcription phase:
  //    - If input_method='typed': transcription_status='skipped'
  //    - Else if transcript_english already exists AND !forceReanalyze: skip
  //    - Else:
  //        result = await sarvamTranscription.transcribe(audio_path, audio_mime, audio_duration_sec)
  //        if result.pending: update to 'batch_queued'; return. Webhook/poll resumes later.
  //        else: update row with transcript_english, status='success', continue to step 3
  // 3. Claude extraction phase (NO translation — prompt simplified):
  //    - Load prompt + known_pages + version from policy_config
  //    - Build message: screenshot (base64) + transcript_english OR user_typed_comment + auto_context
  //    - Call Anthropic Sonnet 4
  //    - Parse strict JSON; on failure store raw in claude_error
  //    - Update claude_extraction_json, claude_summary_confidence, claude_prompt_version, claude_cost_cents
  // 4. Never throws — all failures land in status/error columns
}
```

When the webhook handler receives a completed transcription, it calls step 3 only (step 2 already done).

### 4.10 bugReportResurrect.js (updated)

```js
// On boot, after schema migration:

// Bucket A: Claude extraction pending/orphaned
const stuck_claude = db.prepare(`
  SELECT id FROM bug_reports
  WHERE claude_run_status = 'pending'
    AND transcription_status = 'success'
    AND datetime(created_at) > datetime('now', '-24 hours')
`).all();
for (const { id } of stuck_claude) setImmediate(() => runClaudeExtraction(id).catch(noop));

// Bucket B: Sarvam REST path pending (unusual — means container died mid-call)
const stuck_rest = db.prepare(`
  SELECT id FROM bug_reports
  WHERE transcription_status = 'pending'
    AND sarvam_job_id IS NULL
    AND datetime(created_at) > datetime('now', '-24 hours')
`).all();
for (const { id } of stuck_rest) setImmediate(() => processBugReport(id).catch(noop));

// Bucket C: Sarvam batch jobs — safety poller handles them, no-op here
// (poller runs every 2 min, will pick these up naturally)
```

### 4.11 POST /api/bug-reports — request shape

(unchanged from v2)

```
multipart/form-data:
  screenshot: File (required, image/*, ≤ 10MB)
  audio:      File (optional, audio/*, ≤ 25MB)
  payload: JSON string:
    {
      page_url, page_name,
      selected_month, selected_year, selected_company,
      input_method, audio_source, user_typed_comment,
      auto_context: {
        viewport: { width, height },
        recent_api_calls: [ ...up to 5 ]
      }
    }
```

Server validation + file writes + setImmediate orchestrator kick-off → 201.

### 4.12 Rate limiting
10 POSTs per user per rolling hour. In-memory Map. 429 with `Retry-After` on excess.

---

## 5. Claude extraction prompt (v3 — translation stripped)

Stored in `policy_config.bug_report_extraction_prompt`. `{{KNOWN_PAGES}}` replaced at runtime.

```
You are a bug-report intake assistant for an internal HR/payroll system. You will receive:
1. A screenshot (the user took it at the moment they decided to report a bug)
2. An English description of what is wrong — this is either a typed comment from the user OR an English translation of an audio recording the user made
3. Auto-captured context: the page the user was on, month/year/company selected, their role, and a summary of the last 5 API calls the page made

Your job is to produce a STRUCTURED INTAKE. You MUST NOT:
- Speculate about root causes
- Suggest which code module is broken
- Suggest fixes
- Diagnose the bug
- Re-translate the description (it is already English)

You MUST:
- Describe what is visible in the screenshot factually
- Identify which page of the system the screenshot is from, using the "Known pages" list
- Extract specific values (employee codes, names, amounts, dates) visible in the screenshot
- Flag what the screenshot does NOT show that the developer would need to investigate

EXAMPLE OF WHAT NOT TO DO:
Bad structured_summary: "The user is reporting that Rakesh's salary is wrong. This looks like it could be a stale-shift-assignment issue from the recent pipeline change."
Good structured_summary: "The user reports that Rakesh (22970) shows a net salary of ₹8,400 for April 2026 on the Salary Computation page and says this is lower than expected. The user did not state what value was expected."

KNOWN PAGES OF THE SYSTEM:
{{KNOWN_PAGES}}

CONFIDENCE RUBRIC for `summary_confidence`:
- For audio-origin English descriptions: evaluate whether the English description is specific and coherent, and whether it clearly relates to what is shown in the screenshot. (The user said it in another language and it has been auto-translated; if the English reads as vague or generic in ways that don't match a specific screenshot, the translation may have flattened detail.)
- For typed English descriptions: evaluate screenshot legibility and coherence between description and screenshot.
- "high":   description is specific and clearly references what is visible; screenshot is readable.
- "medium": description is partially specific; some ambiguity about what part of the screenshot is being referenced.
- "low":    description is vague or generic, screenshot is unreadable for specifics, or description and screenshot appear unrelated.

OUTPUT — strict JSON only, no markdown fences, no preamble, no trailing prose:

{
  "page_identified": "<one of Known pages, or 'Other / Cannot identify'>",
  "page_confidence": "high" | "medium" | "low",
  "user_description": "<the English description verbatim as received>",
  "structured_summary": "<2-3 sentences in clear English, grounded in BOTH the screenshot and the description. No speculation.>",
  "summary_confidence": "high" | "medium" | "low",
  "visible_data": {
    "employees_mentioned": ["<NAME (CODE) or just NAME if no code visible>"],
    "amounts_visible": ["<₹12,345 etc. — specific monetary values>"],
    "dates_visible": ["<2026-04-15 etc.>"],
    "key_values": [
      { "label": "<field label as shown>", "value": "<value as shown>" }
    ]
  },
  "open_questions": [
    "<specific question a developer would want answered>"
  ]
}

If description and screenshot are incoherent or unrelated, set summary_confidence='low' and put an honest observation in structured_summary (e.g., "User uploaded a Settings screenshot but the description is about payslips. Unclear which is the actual concern.").
```

### 5.1 bug_report_known_pages_json (initial seed)
(unchanged from v2 — same 19 entries)

```json
[
  "Salary Computation (Stage 7 results, list of employees with net/gross/deductions)",
  "Day Calculation (Stage 6, per-employee day-by-day attendance)",
  "Attendance Register (raw attendance, calendar grid view)",
  "Miss Punch Resolution (Stage 2, list of incomplete punches)",
  "Finance Audit Dashboard (3-tab view: audit / employee review / red flags)",
  "Finance Verification (miss-punch and extra-duty review queues)",
  "Payslip Viewer / PDF preview",
  "Late Coming Management (Analytics → Punctuality)",
  "Employee Master (employee list, edit modal)",
  "Salary Advance / Loan Recovery",
  "Settings → Shifts (shift master)",
  "Daily MIS (today's attendance summary)",
  "Held Salaries Register",
  "Extra Duty Grants",
  "OT & ED Payable Register",
  "Reports / Exports (PF ECR, ESI, Bank NEFT)",
  "Query Tool (admin SQL workbench)",
  "Session Analytics (admin)",
  "Other / Cannot identify"
]
```

---

## 6. Frontend

(Structure unchanged from v2; only the admin detail view content changes.)

### 6.1 New files
- `frontend/src/components/BugReporter/BugReportButton.jsx`
- `frontend/src/components/BugReporter/BugReportModal.jsx`
- `frontend/src/components/BugReporter/VoiceRecorder.jsx`
- `frontend/src/components/BugReporter/AudioUploader.jsx`
- `frontend/src/components/BugReporter/ScreenshotInput.jsx`
- `frontend/src/components/BugReporter/AutoContextPreview.jsx`
- `frontend/src/pages/admin/BugReportsInbox.jsx`
- `frontend/src/pages/admin/BugReportDetail.jsx`
- `frontend/src/utils/apiContextBuffer.js`
- `frontend/src/hooks/useNewBugReportCount.js`
- `frontend/src/api/bugReports.js`
- `frontend/src/utils/copyTicketSummary.js`

### 6.2 apiContextBuffer.js (unchanged from v2)
Snapshot-on-open, exclusion list, redaction. See v2 §6.2.

### 6.3 VoiceRecorder.jsx (unchanged from v2)
MediaRecorder with format fallback chain (webm-opus → mp4 → webm), 120s cap, waveform, permission UX.

### 6.4 AudioUploader.jsx (unchanged from v2)
25MB hard cap, 4-min UX guidance only (no block).

### 6.5 BugReportModal.jsx (unchanged from v2)

### 6.6 Sidebar entry (unchanged from v2)

### 6.7 BugReportDetail.jsx — view changes
- Audio player section label changes: **"English transcript (auto-translated)"** — makes translation layer explicit
- Removes the "raw vs English" side-by-side — only one transcript exists now
- Everything else per v2 §6.9

---

## 7. Build sequence

13 ordered commits (one more than v2 for the webhook + poller separation).

| # | What | Gate before next step |
|---|---|---|
| 1 | Schema + policy_config seeds (incl. webhook secret) | `sqlite3 .schema bug_reports` confirms all CHECKs |
| 2 | `bugReportStorage.js` — disk I/O helpers + unit tests | File round-trip test passes |
| 3 | `bugReports.js` route file with 501 stubs + mounting | `curl` returns 501 |
| 4 | `sarvamTranscription.js` REST path (≤28s) + committed fixture + `npm run test:transcribe` | Script transcribes `sample-hinglish.m4a` to English |
| 5 | `sarvamTranscription.js` Batch path (job create only, no completion handling yet) | Job creates, Sarvam accepts, job_id returned |
| 6 | `sarvamWebhookVerify.js` + unit tests (signature correctness, token mismatch, replay) | All 3 defense layers exercised |
| 7 | `POST /sarvam-webhook/:id` endpoint wired + express.raw body parser scoped | Manually POST a signed payload, row updates |
| 8 | `sarvamBatchPoller.js` + cron wire-up | Kill webhook delivery manually, poller resolves within 2 min |
| 9 | `bugReportAnalyzer.js` orchestrator + `runClaudeExtraction` | Insert row, run analyzer, Claude extraction populates |
| 10 | `bugReportResurrect.js` + boot-time wire-up | Restart with stuck row in each bucket, confirm resurrection |
| 11 | Wire all POST/GET/PUT/reanalyze/screenshot/audio endpoints + rate limiter | Full backend curl smoke |
| 12 | Frontend: `apiContextBuffer.js` + all components + pages + sidebar entry + badge | File reports of each input type, inbox renders correctly |
| 13 | CLAUDE.md updates (Section 0, Section 3, Section 6, Section 8) + `/ship` checklist update | Diff reviewed |

---

## 8. Post-deploy verification

### 8.1 Backend smoke
```bash
# Sanity
curl https://hr-app-production-681b.up.railway.app/api/bug-reports/count?status=new \
  -H "Cookie: token=..."
# → {"success": true, "count": 0}

# Webhook rejection: unsigned request should be 401
curl -X POST https://hr-app-production-681b.up.railway.app/api/bug-reports/sarvam-webhook/999 \
  -H "Content-Type: application/json" \
  -d '{"fake": "payload"}'
# → 401 invalid signature (CRITICAL — if this succeeds, your webhook is unprotected)
```

### 8.2 Reporter smoke (3 real reports, one per input method)
Same as v2 §8.2.

### 8.3 Admin smoke (with Sarvam live)
- 3 rows appear in `/admin/bug-reports`
- Each detail view:
  - Audio plays via `▶ Listen`
  - **English transcript label visible** (confirms v3 UI change)
  - Claude summary with confidence pill
  - Auto-context present
- Typed report: `transcription_status='skipped'`, no Sarvam call made
- Recorded (short, ≤28s): `transcription_path='rest'`, `sarvam_job_id IS NULL`
- Uploaded (long): `transcription_path='batch'`, `sarvam_job_id` populated, `sarvam_webhook_received_at` populated (or `sarvam_poll_fallback_used=1` if webhook missed)

### 8.4 SQL verification

```sql
-- Sanity
SELECT id, reporter_username, input_method, transcription_status,
       transcription_path, sarvam_job_status, claude_run_status,
       admin_status, created_at
FROM bug_reports ORDER BY id DESC LIMIT 10;

-- Drift check — stuck rows
SELECT id, transcription_status, claude_run_status,
       sarvam_job_status, sarvam_webhook_received_at,
       CAST((julianday('now') - julianday(created_at)) * 1440 AS INTEGER) AS age_min
FROM bug_reports
WHERE (transcription_status = 'pending'
       OR transcription_status LIKE 'batch_%'
       OR claude_run_status = 'pending')
  AND (julianday('now') - julianday(created_at)) * 1440 > 10;
-- Expect: 0 rows for completed reports. If batch jobs are >30 min old without
--   webhook or poll resolution, mark as failed manually and investigate Sarvam.

-- Webhook health — what fraction relied on safety-net polling?
SELECT
  COUNT(*) AS batch_reports,
  SUM(CASE WHEN sarvam_webhook_received_at IS NOT NULL THEN 1 ELSE 0 END) AS via_webhook,
  SUM(sarvam_poll_fallback_used) AS via_fallback_poll
FROM bug_reports
WHERE transcription_path = 'batch';
-- If via_fallback_poll > 20% of batch_reports, webhook delivery is unhealthy —
--   investigate Railway uptime, Sarvam retries, signature rejections.

-- Cost tracking
SELECT COUNT(*) AS reports,
       ROUND(SUM(COALESCE(transcription_cost_cents, 0)) / 100.0, 2) AS sarvam_usd,
       ROUND(SUM(COALESCE(claude_cost_cents, 0)) / 100.0, 2) AS claude_usd
FROM bug_reports WHERE created_at >= date('now', '-7 days');

-- Disk-vs-DB consistency (run monthly)
SELECT id, screenshot_path, audio_path FROM bug_reports;
-- Verify each path exists on disk. Orphans = broken refs.

-- Prompt version distribution
SELECT claude_prompt_version, COUNT(*) FROM bug_reports GROUP BY claude_prompt_version;

-- Extraction quality
SELECT admin_extraction_quality, COUNT(*) FROM bug_reports
WHERE admin_extraction_quality IS NOT NULL GROUP BY admin_extraction_quality;
```

### 8.5 CHECK constraint verification

```sql
-- Invalid insert should fail
INSERT INTO bug_reports (reporter_username, reporter_role, input_method,
                        screenshot_path, screenshot_mime, screenshot_size_bytes)
VALUES ('test', 'admin', 'recorded', '/tmp/x.png', 'image/png', 100);
-- Expect: CHECK constraint failed
```

### 8.6 Webhook signature attack drill
After deploy: manually POST unsigned, wrong-signature, and replay payloads. Verify all three rejected. **This is a security-critical test — do not skip.**

### 8.7 Stale frontend dist check
Hard-refresh incognito after deploy. Confirm sidebar shows "Report an issue."

---

## 9. Prompt iteration workflow
(unchanged from v2 — use Query Tool to update policy_config, hit Reanalyze, compare)

---

## 10. Risks (v3)

| Risk | Mitigation | Severity |
|---|---|---|
| Container restart mid-REST-call leaves row stuck | `bugReportResurrect.js` Bucket B on boot | Fixed |
| Sarvam key leak | Railway env var + never-log discipline + quarterly rotation | Mitigated |
| Input_method/audio inconsistency | Compound CHECK constraint | Fixed |
| Blobs inflate SQLite | Disk storage | Fixed |
| Accidental POST storm | 10/user/hr rate limit | Mitigated |
| Ring buffer contaminated by polling | Exclusion list + snapshot-on-open | Fixed |
| Prompt iteration requires deploy | policy_config + hot-swap | Fixed |
| Known-pages list rots | policy_config entry + `/ship` checklist | Mitigated |
| Reanalyze burns transcription cost | Analyzer preserves existing transcript | Fixed |
| Browser mic permission denied | Upload-audio fallback | Mitigated |
| iOS Safari format mismatch | MediaRecorder fallback chain — **must test on real iOS** | Open |
| PII to Sarvam + Anthropic | Same exposure envelope as existing Salary Explainer; document in CLAUDE.md | Accepted |
| Attachments not backed up off-Railway | Documented acceptance | Accepted |
| Malformed Claude JSON | Strict parse, store raw in `claude_error` | Mitigated |
| **NEW v3 risks:** | | |
| **Public webhook endpoint is attack surface** | HMAC signature + per-report token + idempotency; 401/403 on any failed check; signature drill in §8.6 | Mitigated |
| **Webhook signature implementation bug could allow forged payloads** | Unit tests for signature correctness (§7 step 6); constant-time compare; explicit attack drill post-deploy | Open until §8.6 passes |
| **Sarvam webhook delivery failure (network / deploy bounce)** | Safety-net poller (§4.8) resolves within 2 min; `sarvam_poll_fallback_used` column exposes frequency | Mitigated |
| **Sarvam batch job stuck / expired without resolution** | 30-min max age → mark failed; visible in drift check §8.4 | Mitigated |
| **Sarvam translation layer mistranslates; you have no intermediate to catch it** | Always-prominent `▶ Listen` button; confidence pill flags mismatch between English transcript and screenshot; accept that fidelity = audio, not transcript | Accepted |
| **Raw body parsing conflicts with global JSON middleware** | `express.raw()` scoped to webhook route only; explicit mounting order test in §7 step 7 | Mitigated |
| **Latency: batch path introduces 30s-2min delay before admin sees extraction** | Acceptable for async inbox workflow; documented here so it isn't surprising | Accepted |
| Stale frontend dist | §8.7 check | Recurring |

---

## 11. CLAUDE.md updates after deploy

### Section 0 (Last Session):
- **Files added:** bug_reports schema, bugReports.js route (incl. webhook), sarvamTranscription.js, sarvamWebhookVerify.js, sarvamBatchPoller.js, bugReportAnalyzer.js, bugReportStorage.js, bugReportResurrect.js, uploadBugReport.js middleware, BugReportModal + VoiceRecorder + AudioUploader + ScreenshotInput components, BugReportsInbox + BugReportDetail pages, apiContextBuffer.js, copyTicketSummary.js, sample-hinglish.m4a fixture
- **What shipped:** Bug reporter — screenshot + (voice/upload/typed) + Sarvam translation + Claude extraction → admin inbox. Sarvam batch jobs use webhook + safety-net polling.
- **What's fragile:** VoiceRecorder iOS Safari compatibility (needs real-device test), Sarvam webhook signature verification (never remove this layer; forged payloads could inject fake bug reports), webhook route MUST be mounted outside requireAuth but inside signature middleware, disk-vs-DB consistency (no enforcer)
- **Known issues remaining:** none at deploy; iterate extraction prompt against real reports

### Section 3 (Pipeline Dependency Map):
Add "Consumer: Bug Reporter — read-only against rest of system, writes only to `bug_reports` table and `/app/uploads/bug-reports/` directory. One public endpoint (`/sarvam-webhook/:id`) protected by HMAC signature + per-report token + idempotency check — if you edit this endpoint, every defense layer must remain."

### Section 6 (Shared State):
Add: "Bug-report attachments on Railway persistent volume at `/app/uploads/bug-reports/<id>/`. Not in nightly GitHub backup. Acceptable loss on volume failure."

### Section 8 (Rules for Claude Code Sessions):
Add: "If you add a new top-level page, update `policy_config.bug_report_known_pages_json`. If you modify the webhook route for bug-reports, confirm all three defense layers (signature, token, idempotency) are still in place and §8.6 drill still passes. Never mount the webhook route inside requireAuth — Sarvam cannot authenticate as a user."

---

## 12. Success criteria (unchanged from v2, all measurable)

1. ≥ 5 reports filed by HR/finance in 2 weeks
2. ≥ 70% use voice (recorded + uploaded combined) — from `input_method`
3. ≥ 70% resolved without admin playing audio — needs play-tracking endpoint (20 LOC, include in v1)
4. 0 reports stuck >10 min post-creation (drift query)
5. 0 infrastructure-cause transcription failures
6. ≥ 60% graded good/acceptable on `admin_extraction_quality`

### v3-specific ops criteria:
7. Webhook delivery success ≥ 80% (measured by `sarvam_poll_fallback_used` — if >20% of batch reports rely on fallback polling, investigate Sarvam or Railway uptime)
8. Zero forged webhook payloads accepted — if any row lands via signature bypass, revoke webhook secret immediately and rotate

---

## 13. Deferred (Phase 2+)

- Cross-reference `session_events` in admin detail
- Link bug report to employee_code + month
- Email notification to admin
- Hypothesis-generation tier (after 20+ reports)
- GitHub link from inbox ("fixed in commit X")
- "My reports" view for reporters
- `bug_report_analysis_runs` audit history table
- Weekly off-Railway backup of `/app/uploads/bug-reports/`
- Per-row reanalyze counter
- Automated ffprobe duration validation server-side
- Hinglish (codemix) raw transcript alongside English translation — reconsider if translation drift becomes a real problem
- Migration to a job queue (BullMQ / Agenda) if volume grows 10x and `setImmediate` becomes insufficient

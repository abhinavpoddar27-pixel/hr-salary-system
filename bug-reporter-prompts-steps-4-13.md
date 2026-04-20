# Bug Reporter — Claude Code Prompts (Step 1 patch + Steps 4–13)

Copy each prompt block exactly into Claude Code, one at a time, sequentially. Do not batch. Do not run in parallel. Each ends in a verification gate — it must pass before you proceed.

The reference plan is `bug-reporter-plan-v3.md`. Every prompt assumes Claude Code has that document in context. If you start a fresh session, paste the plan first.

The file `bug-reporter-prompts-steps-1-3.md` contains Steps 1–3. This file contains:
- **Patch to Step 1** (webhook secret moves from DB to env var)
- **Steps 4 through 13**

---

============================================================
PATCH TO STEP 1 — webhook secret moves to env var
============================================================

If you have **not yet run Step 1**, apply this patch to the Step 1 prompt in `bug-reporter-prompts-steps-1-3.md` BEFORE running it.

If you have **already run Step 1** (i.e., the webhook secret is already in policy_config), follow the "post-hoc patch" section below instead.

## Pre-run patch (Step 1 not yet executed)

In the BUILD section of Step 1, item 5 (policy_config seeds), **REMOVE** the fourth bullet about `bug_report_sarvam_webhook_secret`. That is, keep only three seeds:

- `bug_report_extraction_prompt`
- `bug_report_extraction_prompt_version`
- `bug_report_known_pages_json`

Also remove the Node crypto snippet that generated the secret at runtime.

**In its place, add a new item 6 to Step 1's BUILD section:**

6. Document the required env var. Add to `backend/.env.example`:
   ```
   # Sarvam webhook verification secret. Set in Railway dashboard before first
   # deploy. Must be a cryptographically random string, at least 32 hex chars.
   # Generate locally with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   # Rotation: quarterly. When rotating, update Railway env var AND notify
   # Sarvam of the new callback auth token format (see sarvamTranscription.js).
   SARVAM_WEBHOOK_SECRET=
   ```
   Leave the value blank in .env.example — this is a secret, it never gets committed.

**Update Step 1's SUBAGENT — VERIFICATION section:**

- REMOVE verification check #9 (the one about `SELECT LENGTH(value) FROM policy_config WHERE key='bug_report_sarvam_webhook_secret'`).
- Verification check #4 (count of `bug_report_*` keys in policy_config) now expects **3 rows**, not 4.

**Update Step 1's USER-SIMULATION PASS:**

- Remove the bullet about webhook-secret existence-check / generation in both scenarios. Replace with a single new bullet in the "Happy path — fresh DB boot" section: "No webhook secret generated in DB — that lives in SARVAM_WEBHOOK_SECRET env var, provisioned in Railway dashboard separately."

**Update Step 1's commit message:**

Change the fourth bullet from `- policy_config seeds: ... sarvam_webhook_secret (generated at first boot, idempotent)` to:
`- policy_config seeds: extraction_prompt, prompt_version, known_pages_json (3 total)`

Add a new bullet: `- Documented SARVAM_WEBHOOK_SECRET env var in .env.example (must be set in Railway before first deploy)`

## Post-hoc patch (Step 1 already executed)

If Step 1 already ran and `bug_report_sarvam_webhook_secret` is in the DB, run this prompt as a small standalone step:

```
Minor patch: move Sarvam webhook secret from policy_config to Railway env var.

1. Read the current value:
   SELECT value FROM policy_config WHERE key = 'bug_report_sarvam_webhook_secret';
   Copy this value. You'll paste it into Railway dashboard next.

2. Add to backend/.env.example:
   # Sarvam webhook verification secret. Set in Railway dashboard.
   # Rotation: quarterly.
   SARVAM_WEBHOOK_SECRET=

3. Set the env var in Railway dashboard:
   - Open the project's Railway dashboard
   - Navigate to Variables
   - Add SARVAM_WEBHOOK_SECRET with the value from step 1
   - Save and redeploy

4. After Railway confirms the env var is live, delete the DB row:
   DELETE FROM policy_config WHERE key = 'bug_report_sarvam_webhook_secret';

5. Commit with message:
   chore(bug-reporter): move Sarvam webhook secret from DB to env var

   - Better secret hygiene: secret not in SQLite backups
   - Matches existing key governance (ANTHROPIC_API_KEY, SARVAM_API_KEY)
   - Rotation procedure: update Railway env var, no DB migration needed
```

Do not proceed to Step 4 until the patch is applied.

---

============================================================
STEP 4 of 13 — sarvamTranscription.js (REST path) + test fixture
============================================================

## CONTEXT

Steps 1–3 gave us: the DB table, the disk-I/O service, and the route stubs. Step 4 is the first substantive service: the transcription wrapper around Sarvam's Saaras v3 API.

Step 4 implements ONLY the REST sync path (audio ≤ 28 seconds). The Batch path (for longer audio) is Step 5. Splitting the two halves makes the REST path independently testable — we can transcribe the committed fixture and see English come out.

Per `bug-reporter-plan-v3.md` §4.5: the service has two functions — `transcribe(absolutePath, mime, audioDurationSec)` and `fetchJobResult(jobId)`. In Step 4 we implement `transcribe` only for the REST path (≤28s). For longer audio, it should throw a clear error saying "batch path not yet implemented" until Step 5 fills it in.

Per §4.5, model is `saaras:v3` with `mode: 'translate'`. Returns English directly. Cost: `Math.ceil(duration_sec / 60) * 0.6` cents.

The committed test fixture `sample-hinglish.m4a` lives at `backend/test/fixtures/bug-reporter/sample-hinglish.m4a` (copy from the file I staged at `/home/claude/fixtures/sample-hinglish.m4a` — the user already provided it). It is 22 seconds, so it fits the REST path.

Read: `bug-reporter-plan-v3.md` §4.1 (env vars), §4.2 (Sarvam key discipline), §4.3 (file list), §4.5 (transcription service), §10 (risks — especially the logging discipline one).

## DO NOT MODIFY

- `backend/src/database/schema.js` — Step 1's schema is final for this feature
- `backend/src/services/bugReportStorage.js` — Step 2's storage helpers
- `backend/src/routes/bugReports.js` — Step 3's stubs
- `backend/src/index.js` — mount order is final
- `backend/src/middleware/auth.js`
- Any existing service file — no cross-cutting changes
- `backend/package.json` — EXCEPT to add `sarvamai` as a dependency (see build step 2)

## SUBAGENT — EXPLORATION (read-only)

Spawn ONE subagent with this task:

> Read the following and report back:
> 1. `backend/package.json` — report current `dependencies` and `devDependencies`. Confirm `sarvamai` is not already installed.
> 2. Look for any service that makes outbound HTTP calls to an external API (candidates: `backend/src/services/salaryExplainer.js`, or anything that calls Anthropic). Quote the pattern used for:
>    (a) import style (fetch / axios / SDK-specific)
>    (b) API key retrieval (process.env.X with fallback?)
>    (c) error handling (try/catch + structured return vs thrown errors)
>    (d) logging (what's logged on success, what on error — ESPECIALLY: are request bodies or keys ever logged?)
>    (e) cost calculation pattern, if any
> 3. Check whether the project uses CommonJS (`require`) or ES modules (`import`). Report the dominant pattern.
> 4. Check whether there is an existing test runner configured (`jest`, `mocha`, or a custom `npm run test:*` script in package.json). Report findings. Report whether any existing `test:` scripts exist that we should mirror (e.g., `test:lint`).
> 5. Verify the fixture location: run `ls -la backend/test/fixtures/` and report what's there. If `backend/test/fixtures/bug-reporter/` does not exist, note it.
> 6. Check https://www.npmjs.com/package/sarvamai package page (via web_fetch if available, otherwise use `npm view sarvamai version description`) and report:
>    (a) latest published version
>    (b) main export pattern — is it `const { SarvamAIClient } = require('sarvamai')` or an ES-module-only package?
>    (c) the exact method name for the speech-to-text translate endpoint (candidates: `client.speechToText.translate(...)`, `client.speechToTextTranslate(...)`, something else)
>    (d) the expected response shape (what fields are returned?)
> 7. Fetch https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe (or the current equivalent URL) and report:
>    (a) the exact REST endpoint URL
>    (b) the exact request parameter name for the translate mode (is it `mode: 'translate'` or `model: 'saaras:v3'` with a separate translate parameter?)
>    (c) whether the REST endpoint has a 30-second limit or something different
>    (d) the exact name of the response field carrying the transcript text

Report back. Do not install anything. Do not modify anything.

## PLAN GATE (STOP HERE)

Present this plan and WAIT for user confirmation:

```
Files to create:
  - backend/src/services/sarvamTranscription.js
    - transcribe(absolutePath, mime, audioDurationSec):
      * If audioDurationSec > 28: throw 'batch path not implemented until step 5'
      * Else: call Sarvam REST translate endpoint, return
        { success, text, detected_language, model_used, cost_cents, path: 'rest', error }
    - fetchJobResult(jobId): throw 'not implemented until step 5'
    - Uses sarvamai SDK (per subagent findings) OR raw fetch (fallback)

  - backend/test/fixtures/bug-reporter/sample-hinglish.m4a
    - Copy from user-provided file at /home/claude/fixtures/sample-hinglish.m4a
    - 22 seconds, m4a/AAC

  - backend/test/transcribe-fixture.js
    - Simple Node script that calls transcribe() on the fixture
    - Prints the result
    - Validates: result.success === true, result.text is a non-empty string,
      result.detected_language is set, result.cost_cents > 0
    - Exits 0 on success, 1 on failure

Files to modify:
  - backend/package.json — add sarvamai dependency (exact version per subagent)
  - backend/package.json — add "test:transcribe" script: "node test/transcribe-fixture.js"
  - backend/.env.example — add SARVAM_API_KEY and SARVAM_MODEL

No DB changes. No route changes. Pure service.
```

Also flag to user: "The transcribe-fixture.js test will make a real API call to Sarvam and cost ~₹0.20. You'll need a valid SARVAM_API_KEY in .env before running. Confirm you have that before approving."

After user confirms, proceed.

## BUILD

1. Copy the fixture file. The user provided `sample-hinglish.m4a` earlier. Move it to:
   ```
   cp /home/claude/fixtures/sample-hinglish.m4a backend/test/fixtures/bug-reporter/sample-hinglish.m4a
   ```
   (Create the directory path first with `mkdir -p`.) If `/home/claude/fixtures/` is not accessible in the Claude Code environment, instruct the user to copy the file manually from their local machine into the target path, and gate this step on the file existing.

2. Install the SDK (use the exact version from subagent findings; if the subagent couldn't determine it, default to `^1.1.5` which was current as of the planning session):
   ```
   cd backend && npm install sarvamai@^1.1.5
   ```
   Verify `package.json` now lists it in `dependencies`.

3. Add env vars to `backend/.env.example` (keep values blank):
   ```
   # Sarvam AI — speech-to-text translation for bug reports
   SARVAM_API_KEY=
   SARVAM_MODEL=saaras:v3
   ```

4. Create `backend/src/services/sarvamTranscription.js` with this structure (adjust SDK calls per subagent findings):

   ```js
   const fs = require('fs');
   const { SarvamAIClient } = require('sarvamai');

   const MODEL = process.env.SARVAM_MODEL || 'saaras:v3';
   const REST_DURATION_LIMIT_SEC = 28;

   function getClient() {
     const key = process.env.SARVAM_API_KEY;
     if (!key) throw new Error('[sarvamTranscription] SARVAM_API_KEY not set');
     return new SarvamAIClient({ apiSubscriptionKey: key });
   }

   function costCentsFor(durationSec) {
     // Sarvam: ₹30/hour = ₹0.5/min. At ~INR/USD 83, that is ~$0.006/min
     // = 0.6 cents/min. Round up partial minutes.
     const minutes = Math.max(1, Math.ceil(durationSec / 60));
     return minutes * 0.6;
   }

   async function transcribe(absolutePath, mime, audioDurationSec) {
     // Input validation
     if (typeof absolutePath !== 'string' || !absolutePath) {
       return { success: false, error: 'absolutePath required' };
     }
     if (typeof audioDurationSec !== 'number' || audioDurationSec <= 0) {
       return { success: false, error: 'audioDurationSec must be positive number' };
     }
     if (!fs.existsSync(absolutePath)) {
       return { success: false, error: `file not found: ${absolutePath}` };
     }

     // Route to REST vs Batch based on duration
     if (audioDurationSec > REST_DURATION_LIMIT_SEC) {
       // Step 5 implements this
       return {
         success: false,
         error: '[sarvamTranscription] batch path not implemented until step 5',
         pending: false,
       };
     }

     // REST sync path
     try {
       const client = getClient();
       const result = await client.speechToText.translate({
         // EXACT PARAMETER NAMES PER SUBAGENT FINDINGS — adjust this block
         // to match the actual SDK method signature.
         file: fs.createReadStream(absolutePath),
         model: MODEL,
       });

       // EXACT RESPONSE FIELD NAMES PER SUBAGENT FINDINGS — adjust field access
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
       // CRITICAL: log only error code/status. Never log request body,
       // never log the API key. See plan §4.2.
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
   ```

5. Create `backend/test/transcribe-fixture.js`:

   ```js
   // Test: transcribe the committed Hinglish fixture and validate the result.
   // Usage: node test/transcribe-fixture.js
   //
   // Requires: SARVAM_API_KEY set in env or .env
   // Loads .env automatically if dotenv is present in the project.

   try { require('dotenv').config(); } catch (_) { /* optional */ }

   const path = require('path');
   const { transcribe } = require('../src/services/sarvamTranscription');

   const FIXTURE = path.join(__dirname, 'fixtures/bug-reporter/sample-hinglish.m4a');
   const DURATION_SEC = 22; // known value; plan §4.3 committed fixture

   (async () => {
     console.log('[test:transcribe] calling Sarvam with fixture:', FIXTURE);
     const t0 = Date.now();
     const result = await transcribe(FIXTURE, 'audio/mp4', DURATION_SEC);
     const elapsedMs = Date.now() - t0;

     console.log('[test:transcribe] elapsed:', elapsedMs, 'ms');
     console.log('[test:transcribe] result:', JSON.stringify(result, null, 2));

     // Validations (degrade gracefully — we don't know exact content)
     const checks = [
       { name: 'success=true', ok: result.success === true },
       { name: 'text is non-empty string', ok: typeof result.text === 'string' && result.text.length > 0 },
       { name: 'path=rest', ok: result.path === 'rest' },
       { name: 'cost_cents > 0', ok: typeof result.cost_cents === 'number' && result.cost_cents > 0 },
       { name: 'model_used set', ok: !!result.model_used },
       { name: 'detected_language set (optional, warn-only)', ok: true,
         warn: !result.detected_language ? 'language not detected (non-fatal)' : null },
     ];

     let failed = 0;
     for (const c of checks) {
       if (c.ok) {
         const tag = c.warn ? 'WARN' : 'OK';
         console.log(`  [${tag}] ${c.name}${c.warn ? ' — ' + c.warn : ''}`);
       } else {
         console.log(`  [FAIL] ${c.name}`);
         failed++;
       }
     }

     if (failed > 0) {
       console.error(`[test:transcribe] ${failed} check(s) failed`);
       process.exit(1);
     }
     console.log('[test:transcribe] all checks passed');
     process.exit(0);
   })();
   ```

6. Add the test script to `backend/package.json`:
   ```json
   "scripts": {
     ...existing...,
     "test:transcribe": "node test/transcribe-fixture.js"
   }
   ```

## SUBAGENT — VERIFICATION (read-only)

Spawn ONE subagent with this task:

> Run the following checks:
>
> 1. Confirm fixture exists:
>    `ls -la backend/test/fixtures/bug-reporter/sample-hinglish.m4a`
>    Expect: file present, size ~199KB (±10KB).
>
> 2. Confirm sarvamai installed:
>    `cd backend && node -e "require('sarvamai'); console.log('ok')"`
>    Expect: prints "ok". If it errors with MODULE_NOT_FOUND, npm install did not complete.
>
> 3. Confirm the service module loads without API key (should not throw at require time):
>    `cd backend && node -e "const s = require('./src/services/sarvamTranscription'); console.log(Object.keys(s));"`
>    Expect: prints an array with transcribe, fetchJobResult, costCentsFor, REST_DURATION_LIMIT_SEC.
>
> 4. Unit-test cost calculation (no API call):
>    ```
>    cd backend && node -e "
>    const { costCentsFor } = require('./src/services/sarvamTranscription');
>    console.log('22s:', costCentsFor(22));         // 1 min = 0.6c
>    console.log('60s:', costCentsFor(60));         // 1 min = 0.6c
>    console.log('90s:', costCentsFor(90));         // 2 min = 1.2c
>    console.log('0s:',  costCentsFor(0));          // clamped to 1 min = 0.6c
>    "
>    ```
>    Expect: 0.6, 0.6, 1.2, 0.6.
>
> 5. Unit-test batch-path guard (no API call):
>    ```
>    cd backend && node -e "
>    const { transcribe } = require('./src/services/sarvamTranscription');
>    transcribe('/tmp/fake.m4a', 'audio/mp4', 60).then(r => console.log(JSON.stringify(r)));
>    "
>    ```
>    Expect: `{"success":false,"error":"[sarvamTranscription] batch path not implemented until step 5","pending":false}`.
>
> 6. Unit-test missing-file guard (no API call):
>    ```
>    cd backend && node -e "
>    const { transcribe } = require('./src/services/sarvamTranscription');
>    transcribe('/tmp/does-not-exist.m4a', 'audio/mp4', 10).then(r => console.log(JSON.stringify(r)));
>    "
>    ```
>    Expect: `{"success":false,"error":"file not found: /tmp/does-not-exist.m4a"}`.
>
> 7. Unit-test missing-API-key guard (no API call):
>    ```
>    cd backend && SARVAM_API_KEY= node -e "
>    const { transcribe } = require('./src/services/sarvamTranscription');
>    transcribe('./test/fixtures/bug-reporter/sample-hinglish.m4a', 'audio/mp4', 22)
>      .then(r => console.log(JSON.stringify(r)));
>    "
>    ```
>    Expect: result has success=false and error mentions SARVAM_API_KEY.
>    (The getClient() call throws; transcribe's catch block turns it into a structured failure — verify this path exists.)
>
> 8. **REAL API CALL — the main test:**
>    ```
>    cd backend && npm run test:transcribe
>    ```
>    Expect:
>    - Exits 0
>    - Prints a non-empty English transcript in the result
>    - All validation checks pass (one may WARN about language detection — that's OK)
>
>    Take note of the transcript Sarvam returned. Report it verbatim to the user so they can judge whether the translation quality is acceptable.
>
> 9. Confirm no logging leaks secrets. Grep the service file for dangerous patterns:
>    ```
>    cd backend && grep -E "(console\\.(log|error).*(API_KEY|apiKey|Bearer|password|secret))" src/services/sarvamTranscription.js
>    ```
>    Expect: no matches. If any match, the secret might leak to logs — fix before committing.
>
> 10. Lint:
>     `cd backend && npm run lint`
>     Expect: 0 errors.

Report all 10 outputs. If the real API call (#8) failed, capture the exact error and stop — do not proceed to next step. Check whether: (a) SARVAM_API_KEY is valid, (b) the fixture was copied correctly, (c) the SDK method names in sarvamTranscription.js match the actual SDK (subagent may have gotten them wrong; adjust and retry).

## SELF-DEBUG PASS

1. Re-read `sarvamTranscription.js`. Confirm:
   - No API key, request body, file content, or full error object is passed to `console.log` / `console.error`. Only error code and status.
   - Missing-key case is handled (getClient() throws inside transcribe's try, caught, returns structured failure).
   - Batch-path guard (>28s) returns BEFORE attempting any API call.
   - File-not-found guard uses synchronous `fs.existsSync` for speed (we're about to stream it anyway).
   - The return shape is stable across success and failure paths — caller can always read `result.success` without crashing.
2. Re-read `transcribe-fixture.js`. Confirm:
   - It loads dotenv if available (catches absence gracefully)
   - It degrades gracefully if language detection doesn't fire (warn-only, not fail)
   - It prints the actual transcript so the user can see what Sarvam produced
   - Exit codes are right: 0 on all checks pass, 1 otherwise
3. Run the real API call test yourself (not via subagent) if the subagent had trouble with env vars. Confirm the service works end-to-end against a real Sarvam response.

## USER-SIMULATION PASS

**Happy path — step 11 calls transcribe on a 20-second recorded audio:**
- `transcribe('/app/uploads/bug-reports/47/audio.webm', 'audio/webm', 20)`
- Passes all guards
- Calls SDK
- SDK returns `{ transcript: 'The salary for Sharma is incorrect', language_code: 'hi' }`
- Service returns `{ success: true, text: '...', detected_language: 'hi', cost_cents: 0.6, path: 'rest' }`
- ✅

**Edge case — 45-second audio (should route to batch, not yet implemented):**
- `transcribe(..., ..., 45)` → returns `{ success: false, error: 'batch path not implemented until step 5', pending: false }`
- Caller (future step 9 orchestrator) sees success=false AND pending=false → knows it's a hard failure, not a pending job
- ✅ Step 5 will change this to `{ success: false, pending: true, job_id: '...' }` — caller code in step 9 must handle both.

**Edge case — Sarvam API returns 401 (bad key):**
- SDK throws; catch block logs `code=UNAUTHORIZED status=401` (no key in the log)
- Returns `{ success: false, error: 'Sarvam REST failed: UNAUTHORIZED' }`
- Caller logs to `transcription_error` column; row still usable
- ✅

**Edge case — Sarvam returns 200 but empty transcript (rare, corrupted audio):**
- text === '' → returns `{ success: false, error: 'Sarvam returned empty transcript', ... }`
- Caller logs failure; admin inbox can still play audio to verify
- ✅

**Edge case — container has no internet (DNS resolution fails):**
- SDK throws `ENOTFOUND` or similar; catch block logs `code=ENOTFOUND`
- Returns structured failure
- ✅ (resurrection job won't help here — this is a persistent outage, not a crash)

## DELIVERABLES

**Files created:**
- `backend/src/services/sarvamTranscription.js`
- `backend/test/transcribe-fixture.js`
- `backend/test/fixtures/bug-reporter/sample-hinglish.m4a`

**Files modified:**
- `backend/package.json` (+sarvamai dep, +test:transcribe script)
- `backend/package-lock.json` (auto-updated by npm install)
- `backend/.env.example` (+2 lines for SARVAM vars)

**Commit message:**
```
feat(bug-reporter): add sarvamTranscription.js REST path + fixture (step 4/13)

- New service: transcribe() for audio ≤ 28s via Sarvam Saaras v3 REST API,
  translate mode returning English directly
- fetchJobResult() throws until step 5 implements Batch path
- Logging discipline: only error code/status logged, never request body or keys
- Committed 22s Hinglish fixture at test/fixtures/bug-reporter/sample-hinglish.m4a
- npm run test:transcribe validates real API call end-to-end

Part of Bug Reporter feature per bug-reporter-plan-v3.md
```

**Report back:**
- All 10 verification checks result
- The actual transcript Sarvam returned for the fixture (verbatim)
- Confirmation that no secret-logging grep matches
- A statement: "Step 4 complete. Ready for Step 5 (sarvamTranscription.js Batch path)."

---

============================================================
STEP 5 of 13 — sarvamTranscription.js (Batch path)
============================================================

## CONTEXT

Step 4 gave us the REST path. Step 5 adds the Batch path for audio > 28 seconds. The Batch API is job-based: we upload, get a job_id, and completion is delivered via webhook (Step 7 handles webhook receipt) or safety-net polling (Step 8).

Per plan §4.5: when we create a batch job, we pass a callback URL and a per-report auth token (HMAC(reportId, SARVAM_WEBHOOK_SECRET)). This token is echoed by Sarvam in the webhook payload — verified in Step 7.

Per plan §4.7: if the webhook delivers a result inline, we use it directly. If it only sends a job_id + completion status, we call fetchJobResult to download the result.

Step 5 implements: (a) Batch-job creation inside `transcribe` for audio > 28s, (b) `fetchJobResult(jobId)` for downloading completed results, (c) per-report auth token generation.

Step 5 does NOT implement: webhook receipt (Step 7), safety-net poller (Step 8), the orchestrator that ties these together (Step 9).

Read: plan §4.5, §4.6 (understand the auth token format — we generate it here, verify in Step 7), §4.7 (understand what the webhook will expect).

## DO NOT MODIFY

- `backend/src/database/schema.js`
- `backend/src/services/bugReportStorage.js`
- `backend/src/routes/bugReports.js`
- `backend/src/index.js`
- `backend/test/fixtures/` (the fixture is already correct)

Within `sarvamTranscription.js`:
- DO NOT CHANGE the REST path code from Step 4
- DO NOT CHANGE the existing `costCentsFor` or module exports (add to them, don't modify)
- DO NOT CHANGE the logging discipline — same rules apply

## SUBAGENT — EXPLORATION (read-only)

Spawn ONE subagent with this task:

> 1. Re-fetch https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/speech-to-text/batch-api (or current equivalent) and report:
>    (a) the exact SDK method for creating a batch job (candidates: `client.speechToText.batch.create(...)`, `client.speechToTextBatch.createJob(...)`, etc.)
>    (b) whether the SDK supports passing a `callback` object with `url` and `auth_token` at job creation
>    (c) the exact SDK method for retrieving job results (candidates: `client.speechToText.batch.get(...)`, `fetchResult`, `download`, etc.)
>    (d) the expected response shape of a completed batch job (what fields hold the transcript, language, etc.)
>    (e) whether the SDK's batch call requires uploading the file separately from creating the job, or if the file is uploaded as part of job creation
> 2. Read the existing `backend/src/services/sarvamTranscription.js` from Step 4. Quote lines 1-20 (imports + module-level constants) so we know what's already in scope.
> 3. Check if `crypto` is already required in the file. If yes, we'll reuse; if no, we'll add it.

Report back. Do not modify anything.

## PLAN GATE (STOP HERE)

Present this plan and WAIT:

```
Files to modify:
  - backend/src/services/sarvamTranscription.js
    Add:
    - require('crypto') at top (if not already)
    - generateCallbackToken(reportId) function: HMAC-SHA256 of reportId using SARVAM_WEBHOOK_SECRET
    - createBatchJob(absolutePath, mime, audioDurationSec, reportId) internal function
    - Replace the "batch path not implemented" stub inside transcribe() with
      a real call to createBatchJob, returning
      { success: false, pending: true, job_id, path: 'batch', ... }
    - Replace fetchJobResult(jobId) stub with a real SDK call that downloads
      completed results

Do not touch:
  - The REST path code
  - Module exports (we add new internal helpers but the exports don't need to change
    UNLESS the orchestrator in Step 9 needs generateCallbackToken directly —
    review the plan and decide now)

Decision point — does generateCallbackToken need to be exported?
  - Step 7 (webhook receipt) verifies the token. It recomputes HMAC(reportId, secret).
    It does NOT need generateCallbackToken exported.
  - Step 5 (this step) uses it internally in createBatchJob.
  - Verdict: keep it internal (not exported).
```

After user confirms, proceed.

## BUILD

1. In `backend/src/services/sarvamTranscription.js`, add near the top (after `fs` import):
   ```js
   const crypto = require('crypto');
   ```

2. Add module-level constants:
   ```js
   const WEBHOOK_URL_BASE = process.env.SARVAM_BATCH_WEBHOOK_URL
     || 'https://hr-app-production-681b.up.railway.app/api/bug-reports/sarvam-webhook';
   // e.g., SARVAM_BATCH_WEBHOOK_URL + '/' + reportId → full callback URL
   ```

3. Add internal helper after `costCentsFor`:
   ```js
   function generateCallbackToken(reportId) {
     const secret = process.env.SARVAM_WEBHOOK_SECRET;
     if (!secret) throw new Error('[sarvamTranscription] SARVAM_WEBHOOK_SECRET not set');
     return crypto
       .createHmac('sha256', secret)
       .update(String(reportId))
       .digest('hex');
   }
   ```

4. Add `createBatchJob` internal function (adjust SDK calls per subagent findings):
   ```js
   async function createBatchJob(absolutePath, mime, audioDurationSec, reportId) {
     if (!Number.isInteger(reportId) || reportId <= 0) {
       return { success: false, error: 'valid reportId required for batch jobs' };
     }
     try {
       const client = getClient();
       const callbackToken = generateCallbackToken(reportId);
       const callbackUrl = `${WEBHOOK_URL_BASE}/${reportId}`;

       // EXACT SDK METHOD NAMES PER SUBAGENT — adjust to match reality.
       // The conceptual steps: upload file, create job with callback config,
       // return job_id immediately.
       const job = await client.speechToText.batch.create({
         file: fs.createReadStream(absolutePath),
         model: MODEL,
         mode: 'translate',
         callback: {
           url: callbackUrl,
           auth_token: callbackToken,
         },
       });

       const jobId = job.job_id ?? job.id ?? null;
       if (!jobId) {
         return {
           success: false,
           error: 'Sarvam did not return a job_id',
           path: 'batch',
         };
       }

       return {
         success: false,        // transcription not yet complete
         pending: true,         // caller should poll or await webhook
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
         path: 'batch',
         model_used: MODEL,
       };
     }
   }
   ```

5. Update the existing `transcribe` function: replace the batch-path-not-implemented block with a real call to `createBatchJob`:

   ```js
   // OLD (step 4):
   // if (audioDurationSec > REST_DURATION_LIMIT_SEC) {
   //   return { success: false, error: 'batch path not implemented until step 5', pending: false };
   // }

   // NEW (step 5):
   if (audioDurationSec > REST_DURATION_LIMIT_SEC) {
     // transcribe() signature does not currently include reportId. Callers must
     // switch to transcribeWithReportId for batch jobs (see below), OR this
     // function gains a fourth optional parameter. Choose: add 4th param.
     //
     // Updated signature: transcribe(absolutePath, mime, audioDurationSec, reportId = null)
     //                                                                    ^^^^^^^^^^^^^^^
     // If reportId is null and duration > 28s: return a structured failure
     // indicating the caller must supply reportId.
     // ...
   }
   ```

   So the final signature change: `transcribe` takes an optional 4th param `reportId`. If `audioDurationSec > 28` AND `reportId` is null/undefined → return `{ success: false, error: 'reportId required for batch jobs (audio > 28s)' }`. If `reportId` present → call `createBatchJob(absolutePath, mime, audioDurationSec, reportId)`.

   Rewrite the full `transcribe` function accordingly. The REST-path code is UNCHANGED.

6. Replace `fetchJobResult` stub with real implementation:
   ```js
   async function fetchJobResult(jobId) {
     if (!jobId) return { success: false, error: 'jobId required' };
     try {
       const client = getClient();
       // EXACT SDK METHOD PER SUBAGENT — adjust
       const job = await client.speechToText.batch.get(jobId);

       if (job.status !== 'completed' && job.status !== 'COMPLETED') {
         return {
           success: false,
           pending: true,
           status: job.status,
           error: `job not yet complete: ${job.status}`,
         };
       }

       // Extract transcript from job result — field names per subagent
       const text = job.result?.transcript ?? job.transcript ?? '';
       const detectedLanguage = job.result?.language_code ?? job.language_code ?? null;

       if (!text) {
         return {
           success: false,
           error: 'completed job returned empty transcript',
           status: job.status,
         };
       }

       return {
         success: true,
         text,
         detected_language: detectedLanguage,
         status: job.status,
       };
     } catch (err) {
       const code = err.code ?? err.statusCode ?? 'UNKNOWN';
       console.error(`[sarvamTranscription] fetchJobResult failed: code=${code}`);
       return { success: false, error: `fetch failed: ${code}` };
     }
   }
   ```

7. Update the test script `backend/test/transcribe-fixture.js` — the 22-second fixture still uses REST, so no behavioral change. But add a comment at the top documenting that batch-path testing requires a longer fixture (deferred):
   ```js
   // Note: this fixture is 22s, so it tests the REST sync path only.
   // Batch path (>28s) will be tested manually via a longer recording in step 11 smoke test.
   ```

8. Update `backend/.env.example`:
   ```
   # Sarvam batch webhook URL (used when audio > 28s). In production, must
   # match exactly what's registered with Sarvam. In dev, use ngrok or similar
   # for webhook delivery testing; or rely on the safety-net poller in step 8.
   SARVAM_BATCH_WEBHOOK_URL=https://hr-app-production-681b.up.railway.app/api/bug-reports/sarvam-webhook
   ```

## SUBAGENT — VERIFICATION (read-only)

Spawn ONE subagent:

> 1. Confirm the module still loads:
>    `cd backend && node -e "const s = require('./src/services/sarvamTranscription'); console.log(Object.keys(s));"`
>    Expect: same exports as before (fetchJobResult is no longer a stub but interface is unchanged).
>
> 2. Confirm REST path still works — re-run the fixture test:
>    `cd backend && npm run test:transcribe`
>    Expect: same as step 4 — all checks pass. If not, the REST path code got modified; revert.
>
> 3. Unit-test HMAC token generation (no API call):
>    ```
>    cd backend && SARVAM_WEBHOOK_SECRET=test_secret node -e "
>    const s = require('./src/services/sarvamTranscription');
>    // generateCallbackToken is internal — if it's not exported, test via createBatchJob
>    // indirectly, or temporarily export it for the test and remove after.
>    // Alternative: compute expected HMAC in Node's built-in crypto and compare.
>    const crypto = require('crypto');
>    const expected = crypto.createHmac('sha256', 'test_secret').update('42').digest('hex');
>    console.log('expected HMAC for reportId=42:', expected);
>    console.log('expected length:', expected.length);  // should be 64
>    "
>    ```
>    Expect: a 64-char hex string printed. This verifies the algorithm we'll use is right; Step 7 will verify it matches on the receive side.
>
> 4. Unit-test batch path missing-reportId guard:
>    ```
>    cd backend && node -e "
>    const { transcribe } = require('./src/services/sarvamTranscription');
>    transcribe('/tmp/fake.m4a', 'audio/mp4', 60).then(r => console.log(JSON.stringify(r)));
>    "
>    ```
>    Expect: success=false, error mentions 'reportId required'.
>
> 5. Unit-test batch path missing-webhook-secret guard:
>    ```
>    cd backend && SARVAM_WEBHOOK_SECRET= SARVAM_API_KEY=fake node -e "
>    const { transcribe } = require('./src/services/sarvamTranscription');
>    // reportId provided, duration triggers batch, but no secret → generateCallbackToken throws
>    transcribe('./test/fixtures/bug-reporter/sample-hinglish.m4a', 'audio/mp4', 60, 42)
>      .then(r => console.log(JSON.stringify(r)));
>    "
>    ```
>    Expect: structured failure mentioning SARVAM_WEBHOOK_SECRET. (Must not crash the process; must be caught and returned.)
>
> 6. Unit-test fetchJobResult with invalid jobId (no API call needed to fail-fast):
>    ```
>    cd backend && node -e "
>    const { fetchJobResult } = require('./src/services/sarvamTranscription');
>    fetchJobResult('').then(r => console.log(JSON.stringify(r)));
>    fetchJobResult(null).then(r => console.log(JSON.stringify(r)));
>    "
>    ```
>    Expect: both return `{ success: false, error: 'jobId required' }`.
>
> 7. **Optional real API call** — if user agrees to spend ~₹0.50 and has a longer audio file available: create a batch job manually and confirm a job_id comes back. Skip if no longer audio is readily available; we test end-to-end in Step 11.
>    ```
>    cd backend && SARVAM_WEBHOOK_SECRET=$(openssl rand -hex 32) node -e "
>    // Provide a longer audio path in the env, e.g.:
>    //   TEST_AUDIO=/path/to/60s.mp3
>    const { transcribe } = require('./src/services/sarvamTranscription');
>    const file = process.env.TEST_AUDIO;
>    if (!file) { console.log('skip — no TEST_AUDIO set'); process.exit(0); }
>    transcribe(file, 'audio/mpeg', 60, 99999).then(r => console.log(JSON.stringify(r)));
>    "
>    ```
>    Expect if run: success=false, pending=true, job_id set. Take note of the job_id — in step 7 we'll test the webhook against it.
>
> 8. Grep for secret-logging regressions:
>    `cd backend && grep -E "console\\.(log|error).*(API_KEY|webhook_secret|secret|Bearer)" src/services/sarvamTranscription.js`
>    Expect: no matches.
>
> 9. Lint: `cd backend && npm run lint`
>    Expect: 0 errors.

Report all results.

## SELF-DEBUG PASS

1. Re-read `sarvamTranscription.js` end-to-end (including unchanged REST code). Confirm:
   - REST path is byte-identical to step 4 (a regression here is silent)
   - Batch path creates the callback token BEFORE attempting the SDK call (we want the secret-missing case to fail fast before any upload attempt)
   - `generateCallbackToken` is deterministic: same reportId + same secret → same hash every time
   - `fetchJobResult` distinguishes "not yet complete" (success=false, pending=true) from "complete but empty" (success=false, no pending)
2. Trace the cost model: at REST, cost is computed on success only? Or always? Confirm: currently both REST and batch return `cost_cents` in their result shapes — even on pending batch, because the job has been accepted and billing has started. If an error occurs BEFORE the SDK call, cost should not be returned. Verify.
3. Re-run `npm run test:transcribe` to prove the REST path still works.

## USER-SIMULATION PASS

**Happy path — 60s audio report submitted at 14:30:**
- orchestrator calls `transcribe('/app/uploads/bug-reports/47/audio.webm', 'audio/webm', 60, 47)`
- Duration > 28 → batch path
- generateCallbackToken(47) → stable HMAC
- Job creation SDK call → returns `{ job_id: 'sarv-abc123' }`
- Service returns `{ success: false, pending: true, job_id: 'sarv-abc123', path: 'batch', cost_cents: 0.6 }`
- Orchestrator updates DB: transcription_status='batch_queued', sarvam_job_id='sarv-abc123', cost_cents=0.6
- Hands off to webhook/poller for completion
- ✅

**Edge case — container restarts 3 seconds after job creation:**
- Job is live at Sarvam with the callback URL
- When complete (~45s later), Sarvam attempts webhook delivery
- If our new container is ready: webhook lands, step 7 handles it
- If container still bouncing: webhook fails, Sarvam retries; if retries all miss, safety-net poller (step 8) resolves it within 2 min
- ✅ (verified in later steps)

**Edge case — webhook secret rotated mid-job:**
- Old jobs have callback tokens from OLD secret
- New webhook verifier uses NEW secret
- Old-job webhooks fail signature verification → rejected
- Safety-net poller (step 8) fetches the completed job via API directly (no webhook needed) → resolves
- ✅ (this is why the safety-net poller exists — it's immune to secret rotation)

## DELIVERABLES

**Files modified:**
- `backend/src/services/sarvamTranscription.js` (added batch path + fetchJobResult)
- `backend/.env.example` (added SARVAM_BATCH_WEBHOOK_URL)
- `backend/test/transcribe-fixture.js` (1-line comment added)

**No files created.** No new deps.

**Commit message:**
```
feat(bug-reporter): add Sarvam Batch path to transcription service (step 5/13)

- transcribe() now routes audio > 28s to Batch API via createBatchJob
- generateCallbackToken: HMAC-SHA256(reportId, SARVAM_WEBHOOK_SECRET) for webhook auth
- fetchJobResult(jobId): downloads completed job results for webhook/poller use
- transcribe() signature gains optional 4th param reportId (required for batch)
- REST path unchanged (byte-identical to step 4; fixture test passes)
- All logging continues to redact secrets — verified via grep

Part of Bug Reporter feature per bug-reporter-plan-v3.md
```

**Report back:**
- All 9 verification checks result
- Confirmation REST fixture test still passes (regression gate)
- A statement: "Step 5 complete. Ready for Step 6 (sarvamWebhookVerify.js)."

---

============================================================
STEP 6 of 13 — sarvamWebhookVerify.js (signature + token + idempotency)
============================================================

## CONTEXT

Step 5 generates a per-report auth token sent with each batch job. Step 6 implements the verification side — called by the webhook handler (Step 7) to confirm every incoming webhook is legitimate.

Three defense layers (plan §4.6):

1. **HMAC signature of the raw body** — proves the payload came from Sarvam (not a random internet attacker).
2. **Per-report auth token** — proves THIS webhook is for THIS report (not cross-report confusion).
3. **Idempotency** — proves we haven't already processed this completion (prevents double-processing on retry).

Step 6 implements the verifier AS A PURE SERVICE — no Express, no routing. Step 7 wires it into the route.

CRITICAL: this is security-critical code. Bugs here could let an attacker inject fake bug reports into your inbox. The verification subagent in this step runs adversarial drills.

Read: plan §4.6, §4.7, §10 (the "public webhook endpoint is attack surface" risk).

## DO NOT MODIFY

- `backend/src/services/sarvamTranscription.js` (Step 4–5 is final for transcription)
- `backend/src/routes/bugReports.js` (Step 7 wires the route; Step 6 is service only)
- `backend/src/database/schema.js`
- Anything else previously built

## SUBAGENT — EXPLORATION (read-only)

Spawn ONE subagent:

> 1. Re-fetch https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/speech-to-text/batch-api (or current equivalent) and report the exact format of:
>    (a) the signature header Sarvam sends on webhook requests (is it `X-Sarvam-Signature`, `X-Webhook-Signature`, something else? what's the exact header name?)
>    (b) how the signature is computed (HMAC-SHA256 of raw body? Hex or base64 encoding? Any timestamp included?)
>    (c) what "auth_token" looks like in the webhook payload — which JSON field?
>    (d) whether Sarvam includes a timestamp in the signed payload (to enable replay-window checks)
> 2. Look for any existing webhook-verification code in the project (grep for `createHmac`, `timingSafeEqual`). Report findings and patterns.
> 3. Read `backend/src/database/db.js` and report the exact API for safe prepared-statement reads (e.g., `db.prepare('SELECT ...').get()`).

Report back.

## PLAN GATE (STOP HERE)

Present this plan:

```
Files to create:
  - backend/src/services/sarvamWebhookVerify.js
    Exports:
    - verifyWebhook({ rawBody, signatureHeader, reportId, payloadObj, db }):
        Runs all three defense layers in order.
        Returns:
          { ok: true }  — payload is legit, proceed to process
          { ok: false, code: 'SIGNATURE_INVALID' }    — 401
          { ok: false, code: 'TOKEN_MISMATCH' }       — 403
          { ok: false, code: 'ALREADY_PROCESSED' }    — 200 (dedup; Sarvam stops retrying)
          { ok: false, code: 'REPORT_NOT_FOUND' }     — 404
    - computeSignature(rawBody, secret): helper (reused in test code)
    - Uses crypto.timingSafeEqual for constant-time comparisons (prevents
      timing side-channels; required for signature checks).

Files to modify: none
```

After user confirms, proceed.

## BUILD

Create `backend/src/services/sarvamWebhookVerify.js`:

```js
const crypto = require('crypto');

// Expected signature header name per Sarvam docs (subagent confirms exact name)
const SIGNATURE_HEADER_NAME = 'x-sarvam-signature'; // lowercased for comparison

/**
 * Compute HMAC-SHA256 of a raw body buffer, hex-encoded.
 * @param {Buffer} rawBody - unparsed request body
 * @param {string} secret - SARVAM_WEBHOOK_SECRET env var value
 * @returns {string} 64-char lowercase hex
 */
function computeSignature(rawBody, secret) {
  if (!Buffer.isBuffer(rawBody)) throw new Error('rawBody must be a Buffer');
  if (!secret) throw new Error('secret required');
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Constant-time comparison of two hex strings. Returns true iff equal.
 * Buffers of different length return false (without side-channel risk).
 */
function safeHexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Expected per-report auth token — MUST match what sarvamTranscription.js
 * generates at job creation. Same algorithm, same secret.
 */
function expectedAuthToken(reportId, secret) {
  return crypto.createHmac('sha256', secret).update(String(reportId)).digest('hex');
}

/**
 * Main verifier.
 *
 * @param {Object} opts
 * @param {Buffer} opts.rawBody - raw request body (from express.raw())
 * @param {string} opts.signatureHeader - value of x-sarvam-signature header
 * @param {number} opts.reportId - from URL path param
 * @param {Object} opts.payloadObj - parsed JSON body
 * @param {Object} opts.db - db singleton from getDb()
 * @returns {Object} { ok: boolean, code?: string, message?: string }
 */
function verifyWebhook({ rawBody, signatureHeader, reportId, payloadObj, db }) {
  const secret = process.env.SARVAM_WEBHOOK_SECRET;
  if (!secret) {
    return { ok: false, code: 'SERVER_MISCONFIGURED', message: 'webhook secret not set' };
  }

  // Layer 1: signature
  if (!signatureHeader) {
    return { ok: false, code: 'SIGNATURE_INVALID', message: 'missing signature header' };
  }
  const expected = computeSignature(rawBody, secret);
  if (!safeHexEqual(expected, signatureHeader.trim().toLowerCase())) {
    return { ok: false, code: 'SIGNATURE_INVALID', message: 'signature mismatch' };
  }

  // Layer 2: per-report auth token
  const payloadToken = payloadObj?.auth_token ?? payloadObj?.callback_auth_token ?? null;
  if (!payloadToken) {
    return { ok: false, code: 'TOKEN_MISMATCH', message: 'missing auth_token in payload' };
  }
  const expectedToken = expectedAuthToken(reportId, secret);
  if (!safeHexEqual(expectedToken, payloadToken.trim().toLowerCase())) {
    return { ok: false, code: 'TOKEN_MISMATCH', message: 'auth token mismatch' };
  }

  // Layer 3: idempotency + existence
  let row;
  try {
    row = db.prepare(
      'SELECT id, transcription_status FROM bug_reports WHERE id = ?'
    ).get(reportId);
  } catch (err) {
    return { ok: false, code: 'SERVER_ERROR', message: `db read failed: ${err.code}` };
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
```

## SUBAGENT — VERIFICATION (read-only)

Spawn ONE subagent with this task:

> Write and run a test script at `/tmp/test-webhook-verify.js` that exercises every code path. Do not commit this test file — it's ad-hoc.
>
> ```js
> process.env.SARVAM_WEBHOOK_SECRET = 'test_secret_1234';
> const { verifyWebhook, computeSignature, expectedAuthToken } = require('/ABSOLUTE/PATH/TO/backend/src/services/sarvamWebhookVerify');
>
> // Fake DB stub
> const fakeDb = {
>   _rows: {
>     42: { id: 42, transcription_status: 'batch_queued' },
>     99: { id: 99, transcription_status: 'success' },
>     // 100 does not exist
>   },
>   prepare() {
>     return {
>       get: (id) => fakeDb._rows[id],
>     };
>   },
> };
>
> const reportId = 42;
> const rawBody = Buffer.from(JSON.stringify({
>   job_id: 'sarv-abc123',
>   status: 'completed',
>   auth_token: expectedAuthToken(reportId, process.env.SARVAM_WEBHOOK_SECRET),
>   transcript: 'The salary is wrong for Sharma.',
> }));
> const goodSig = computeSignature(rawBody, process.env.SARVAM_WEBHOOK_SECRET);
>
> const results = [];
>
> // Test 1: happy path
> results.push(['happy path',
>   verifyWebhook({
>     rawBody, signatureHeader: goodSig, reportId,
>     payloadObj: JSON.parse(rawBody), db: fakeDb,
>   }),
>   'ok:true',
> ]);
>
> // Test 2: wrong signature
> results.push(['wrong signature',
>   verifyWebhook({
>     rawBody, signatureHeader: '00'.repeat(32), reportId,
>     payloadObj: JSON.parse(rawBody), db: fakeDb,
>   }),
>   'code:SIGNATURE_INVALID',
> ]);
>
> // Test 3: missing signature header
> results.push(['missing signature',
>   verifyWebhook({
>     rawBody, signatureHeader: '', reportId,
>     payloadObj: JSON.parse(rawBody), db: fakeDb,
>   }),
>   'code:SIGNATURE_INVALID',
> ]);
>
> // Test 4: tampered body (sig computed on different body)
> const otherBody = Buffer.from('{"different":"content"}');
> results.push(['tampered body',
>   verifyWebhook({
>     rawBody: otherBody, signatureHeader: goodSig, reportId,
>     payloadObj: JSON.parse(rawBody), db: fakeDb,
>   }),
>   'code:SIGNATURE_INVALID',
> ]);
>
> // Test 5: wrong auth token (right report, wrong token)
> const badTokenBody = Buffer.from(JSON.stringify({
>   job_id: 'sarv-abc123',
>   status: 'completed',
>   auth_token: 'ff'.repeat(32),
>   transcript: '...',
> }));
> const badTokenSig = computeSignature(badTokenBody, process.env.SARVAM_WEBHOOK_SECRET);
> results.push(['wrong token',
>   verifyWebhook({
>     rawBody: badTokenBody, signatureHeader: badTokenSig, reportId,
>     payloadObj: JSON.parse(badTokenBody), db: fakeDb,
>   }),
>   'code:TOKEN_MISMATCH',
> ]);
>
> // Test 6: cross-report token confusion (token for report 99, URL says 42)
> const crossBody = Buffer.from(JSON.stringify({
>   job_id: 'sarv-abc123',
>   status: 'completed',
>   auth_token: expectedAuthToken(99, process.env.SARVAM_WEBHOOK_SECRET),
>   transcript: '...',
> }));
> const crossSig = computeSignature(crossBody, process.env.SARVAM_WEBHOOK_SECRET);
> results.push(['cross-report token',
>   verifyWebhook({
>     rawBody: crossBody, signatureHeader: crossSig, reportId: 42,
>     payloadObj: JSON.parse(crossBody), db: fakeDb,
>   }),
>   'code:TOKEN_MISMATCH',
> ]);
>
> // Test 7: already processed (idempotency)
> const body99 = Buffer.from(JSON.stringify({
>   auth_token: expectedAuthToken(99, process.env.SARVAM_WEBHOOK_SECRET),
>   status: 'completed',
> }));
> const sig99 = computeSignature(body99, process.env.SARVAM_WEBHOOK_SECRET);
> results.push(['already processed',
>   verifyWebhook({
>     rawBody: body99, signatureHeader: sig99, reportId: 99,
>     payloadObj: JSON.parse(body99), db: fakeDb,
>   }),
>   'code:ALREADY_PROCESSED',
> ]);
>
> // Test 8: report not found
> const body100 = Buffer.from(JSON.stringify({
>   auth_token: expectedAuthToken(100, process.env.SARVAM_WEBHOOK_SECRET),
>   status: 'completed',
> }));
> const sig100 = computeSignature(body100, process.env.SARVAM_WEBHOOK_SECRET);
> results.push(['report not found',
>   verifyWebhook({
>     rawBody: body100, signatureHeader: sig100, reportId: 100,
>     payloadObj: JSON.parse(body100), db: fakeDb,
>   }),
>   'code:REPORT_NOT_FOUND',
> ]);
>
> // Test 9: server misconfigured (secret unset)
> delete process.env.SARVAM_WEBHOOK_SECRET;
> results.push(['missing secret',
>   verifyWebhook({
>     rawBody, signatureHeader: goodSig, reportId,
>     payloadObj: JSON.parse(rawBody), db: fakeDb,
>   }),
>   'code:SERVER_MISCONFIGURED',
> ]);
>
> // Print results
> let failed = 0;
> for (const [name, actual, expectedSummary] of results) {
>   const ok = (expectedSummary === 'ok:true' && actual.ok) ||
>              (expectedSummary.startsWith('code:') && actual.code === expectedSummary.slice(5));
>   console.log(`${ok ? 'PASS' : 'FAIL'} — ${name} — got: ${JSON.stringify(actual)}`);
>   if (!ok) failed++;
> }
> process.exit(failed === 0 ? 0 : 1);
> ```
>
> Run this script. All 9 tests must PASS. If any fail, the security layer is broken — do not proceed to Step 7.
>
> Additionally, run `cd backend && npm run lint`.

Report all results.

## SELF-DEBUG PASS

1. Re-read `sarvamWebhookVerify.js`. Confirm:
   - `crypto.timingSafeEqual` is used for BOTH signature comparison AND token comparison (not `===`, not `.equals()`).
   - `safeHexEqual` handles different-length inputs without panicking (returns false).
   - The order of checks: signature first (cheapest, protects the rest), then token, then DB read. This is important: DB reads are the most expensive; do them last.
   - No code path prints the secret, the signature, or the auth_token to logs.
   - The module does not require the DB at load time — db is passed in by the caller. This keeps the service unit-testable.
2. Re-read the test results. Confirm all 9 passed. If test 4 passed (tampered body) but test 2 or 3 didn't, there's subtle bug — go back.
3. Trace an adversarial scenario mentally: attacker POSTs with a correctly-computed signature but using the SECRET-NOT-THE-SECRET (i.e., they stole an env var from a lower environment).
   - They'd have to have SARVAM_WEBHOOK_SECRET from OUR environment to compute a valid signature.
   - If they do, it's a secret-leak problem, not a verifier problem. This is why the secret lives in Railway env vars (not committed, not in DB backups).
   - ✅ out of scope for the verifier.

## USER-SIMULATION PASS

**Happy path — Sarvam delivers a webhook for report 47:**
- Sarvam POSTs with correct sig + correct auth_token for 47
- Router (step 7) calls verifyWebhook({ rawBody, signatureHeader, reportId: 47, payloadObj, db })
- Layer 1 passes
- Layer 2 passes
- Layer 3: report 47 has transcription_status='batch_queued' → not-yet-processed → passes
- Returns `{ ok: true }`
- Router proceeds to update row. ✅

**Attack 1 — random internet scanner hits the URL:**
- No signature header
- Layer 1: `{ ok: false, code: 'SIGNATURE_INVALID' }` → 401
- ✅

**Attack 2 — attacker replays a legitimately-captured old webhook:**
- Sig passes, token passes, but row is already `success`
- Layer 3: `{ ok: false, code: 'ALREADY_PROCESSED' }` → 200 (so Sarvam stops retrying, even though it's a rejection)
- ✅

**Attack 3 — attacker who has the secret but POSTs with a made-up reportId:**
- They compute a valid signature and a valid auth_token for reportId 9999
- URL is `/sarvam-webhook/9999`
- Layers 1 and 2 pass
- Layer 3: report 9999 doesn't exist → `{ ok: false, code: 'REPORT_NOT_FOUND' }` → 404
- They can't create fake reports via the webhook even with the secret — the report row must pre-exist (inserted by POST /api/bug-reports, which is auth-gated).
- ✅ — this is a meaningful additional defense.

## DELIVERABLES

**Files created:**
- `backend/src/services/sarvamWebhookVerify.js`

**No files modified.** No new deps.

**Commit message:**
```
feat(bug-reporter): add sarvamWebhookVerify.js (step 6/13)

- Three-layer defense for public webhook endpoint:
  1. HMAC-SHA256 signature of raw body (constant-time compared)
  2. Per-report auth token (HMAC(reportId, secret))
  3. Idempotency via transcription_status + report existence check
- Uses crypto.timingSafeEqual to prevent timing side-channels
- Pure service — no Express, no routing; callable with any db-like object
- 9 adversarial unit tests all pass (happy path, wrong sig, missing sig,
  tampered body, wrong token, cross-report token, replay, not-found,
  missing-secret server misconfig)

Part of Bug Reporter feature per bug-reporter-plan-v3.md
```

**Report back:**
- All 9 test results verbatim
- Lint clean
- A statement: "Step 6 complete. Ready for Step 7 (wire webhook route + express.raw body parser)."

---

============================================================
STEP 7 of 13 — POST /sarvam-webhook/:id endpoint wired
============================================================

## CONTEXT

Step 3 stubbed the webhook route to 501. Step 6 built the verifier. Step 7 fills in the real handler: parse raw body, run verifier, on success update the row and kick off Claude extraction, on failure return appropriate HTTP status.

CRITICAL: this step introduces `express.raw()` for body parsing scoped to the webhook route ONLY. Do not change the global `express.json()` middleware.

Per plan §4.7: on webhook success, after updating the transcript columns, we kick off Claude extraction via `setImmediate(() => runClaudeExtraction(id))`. Step 9 implements `runClaudeExtraction`. For Step 7, we can import it as a stub if Step 9 hasn't shipped (or leave it as a no-op with a TODO — NO, don't do that; better: write a tiny no-op function locally that logs "TODO step 9" and gets replaced in step 9).

Read: plan §4.7, §4.4 (webhook auth exception), §10.

## DO NOT MODIFY

- Global `express.json()` middleware (scope `express.raw()` only to the webhook route)
- `requireAuth` application anywhere
- `sarvamWebhookVerify.js` (step 6)
- `sarvamTranscription.js` (step 4–5)
- Any other route file
- Any route other than the webhook in `bugReports.js`

## SUBAGENT — EXPLORATION (read-only)

> 1. Read `backend/src/routes/bugReports.js`. Quote the webhookRouter stub from Step 3.
> 2. Check how `db.prepare(...)` is used in other routes — especially UPDATE patterns. Find a canonical example.
> 3. Report whether there is an existing pattern for atomic row updates inside transactions (e.g., `db.transaction(...)`). If yes, quote.
> 4. Confirm `express` version from backend/package.json supports `express.raw()` middleware (it has since Express 4.17; report the version).

## PLAN GATE (STOP HERE)

```
Files to modify:
  - backend/src/routes/bugReports.js
    - Add imports: sarvamWebhookVerify, sarvamTranscription.fetchJobResult, getDb
    - Replace webhookRouter.post('/:id(\\d+)', notImplemented(7)) with a real handler
    - Handler uses express.raw({ type: '*/*', limit: '1mb' }) middleware
      scoped to THIS route only
    - On success: update bug_reports row atomically (transcript_english,
      transcript_detected_language, transcription_status='success',
      sarvam_job_status='completed', sarvam_webhook_received_at=now())
      then setImmediate to kick Claude extraction (stub-safe until step 9)
    - Responses:
      ok=true                          → 200 'ok'
      SIGNATURE_INVALID                → 401
      TOKEN_MISMATCH                   → 403
      ALREADY_PROCESSED                → 200 'ok' (dedup response so Sarvam stops)
      REPORT_NOT_FOUND                 → 404
      SERVER_MISCONFIGURED / ERROR     → 500 (Sarvam will retry)
    - Local placeholder: runClaudeExtractionStub(reportId) that logs
      'TODO step 9' — replaced in step 9 with real import

Files to create: none
No schema changes. No new deps.
```

Confirm.

## BUILD

1. At the top of `backend/src/routes/bugReports.js`, add imports:
   ```js
   const express = require('express');  // already present
   const { verifyWebhook, SIGNATURE_HEADER_NAME } = require('../services/sarvamWebhookVerify');
   const { fetchJobResult } = require('../services/sarvamTranscription');
   const { getDb } = require('../database/db');
   ```

2. Define the placeholder for Claude extraction (will be replaced in Step 9):
   ```js
   // TODO step 9: replace this stub with a real import from bugReportAnalyzer
   async function runClaudeExtractionStub(reportId) {
     console.log(`[webhook] TODO step 9: run Claude extraction for report ${reportId}`);
   }
   ```

3. Replace the webhookRouter stub. The final webhook handler:

   ```js
   // Express.raw body parser scoped to this route only.
   // We need the raw bytes to verify the HMAC signature BEFORE JSON parsing.
   // Global express.json() runs on other routes normally.
   webhookRouter.post(
     '/:id(\\d+)',
     express.raw({ type: '*/*', limit: '1mb' }),
     async (req, res) => {
       const reportId = Number(req.params.id);
       const db = getDb();

       // Raw body: Buffer from express.raw. If empty (e.g., a scanner), reject 400.
       const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
       if (rawBody.length === 0) {
         return res.status(400).send('empty body');
       }

       // Parse JSON AFTER we have the raw bytes saved
       let payloadObj;
       try {
         payloadObj = JSON.parse(rawBody.toString('utf8'));
       } catch (_err) {
         // Don't leak parse details; scanner probe
         return res.status(400).send('invalid json');
       }

       // Case-insensitive header lookup (Node lowercases by default but be defensive)
       const signatureHeader =
         req.headers[SIGNATURE_HEADER_NAME] ||
         req.headers['x-sarvam-signature'] ||
         '';

       const v = verifyWebhook({
         rawBody, signatureHeader, reportId, payloadObj, db,
       });

       if (!v.ok) {
         if (v.code === 'SIGNATURE_INVALID')     return res.status(401).send('invalid signature');
         if (v.code === 'TOKEN_MISMATCH')        return res.status(403).send('token mismatch');
         if (v.code === 'ALREADY_PROCESSED') {
           // Dedup: 200 so Sarvam stops retrying. Log for observability.
           console.log(`[webhook] dedup: report ${reportId} already processed`);
           return res.status(200).send('ok (dedup)');
         }
         if (v.code === 'REPORT_NOT_FOUND')      return res.status(404).send('not found');
         if (v.code === 'SERVER_MISCONFIGURED') {
           console.error('[webhook] SERVER_MISCONFIGURED:', v.message);
           return res.status(500).send('server error');
         }
         // Any other failure: 500 so Sarvam retries
         console.error('[webhook] unknown verify failure:', v);
         return res.status(500).send('server error');
       }

       // Verified. Process the payload.
       try {
         // Sarvam payload may contain the transcript inline OR just a job_id
         let transcript = payloadObj.transcript ?? payloadObj.result?.transcript ?? null;
         let detectedLanguage = payloadObj.language_code ?? payloadObj.result?.language_code ?? null;

         if (!transcript && payloadObj.job_id) {
           const fetched = await fetchJobResult(payloadObj.job_id);
           if (!fetched.success) {
             db.prepare(`
               UPDATE bug_reports
                  SET transcription_status = 'failed',
                      transcription_error  = ?,
                      sarvam_job_status    = 'failed',
                      sarvam_webhook_received_at = datetime('now')
                WHERE id = ?
             `).run(fetched.error || 'unknown fetch failure', reportId);
             return res.status(200).send('ok (fetch failed, row updated)');
           }
           transcript = fetched.text;
           detectedLanguage = fetched.detected_language;
         }

         if (!transcript) {
           db.prepare(`
             UPDATE bug_reports
                SET transcription_status = 'failed',
                    transcription_error  = 'empty transcript in webhook',
                    sarvam_job_status    = 'completed',
                    sarvam_webhook_received_at = datetime('now')
              WHERE id = ?
           `).run(reportId);
           return res.status(200).send('ok (empty transcript recorded)');
         }

         // Atomic update — single prepared statement
         db.prepare(`
           UPDATE bug_reports
              SET transcript_english = ?,
                  transcript_detected_language = ?,
                  transcription_status = 'success',
                  sarvam_job_status    = 'completed',
                  sarvam_job_completed_at = datetime('now'),
                  sarvam_webhook_received_at = datetime('now')
            WHERE id = ?
         `).run(transcript, detectedLanguage, reportId);

         // Kick Claude extraction (async, best-effort)
         setImmediate(() => {
           runClaudeExtractionStub(reportId).catch(err => {
             console.error(`[webhook] claude kick failed for report ${reportId}:`, err.message);
           });
         });

         return res.status(200).send('ok');
       } catch (err) {
         console.error('[webhook] process failure:', err.message);
         // Return 500 so Sarvam retries
         return res.status(500).send('server error');
       }
     }
   );
   ```

4. Do NOT touch the authedRouter or any other route.

## SUBAGENT — VERIFICATION (read-only)

Spawn ONE subagent to run a manual smoke test. Requires a running server with SARVAM_WEBHOOK_SECRET set.

> Use a throwaway script to POST signed payloads to the local server.
>
> ```js
> // /tmp/test-webhook-live.js
> const crypto = require('crypto');
> const http = require('http');
>
> const SECRET = process.env.SARVAM_WEBHOOK_SECRET;
> if (!SECRET) { console.error('set SARVAM_WEBHOOK_SECRET'); process.exit(1); }
>
> function post(reportId, body, sig) {
>   return new Promise((resolve, reject) => {
>     const req = http.request({
>       host: 'localhost', port: 3000,
>       path: `/api/bug-reports/sarvam-webhook/${reportId}`,
>       method: 'POST',
>       headers: {
>         'Content-Type': 'application/json',
>         'Content-Length': Buffer.byteLength(body),
>         'X-Sarvam-Signature': sig || '',
>       },
>     }, res => {
>       let chunks = [];
>       res.on('data', c => chunks.push(c));
>       res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
>     });
>     req.on('error', reject);
>     req.write(body);
>     req.end();
>   });
> }
>
> function tokenFor(id) {
>   return crypto.createHmac('sha256', SECRET).update(String(id)).digest('hex');
> }
> function sigFor(body) {
>   return crypto.createHmac('sha256', SECRET).update(body).digest('hex');
> }
>
> // Insert a test row first via SQLite:
> //   INSERT INTO bug_reports (id, reporter_username, reporter_role, input_method, screenshot_path, screenshot_mime, screenshot_size_bytes, user_typed_comment, transcription_status)
> //   VALUES (99901, 'test_webhook', 'hr', 'typed', '/tmp/fake.png', 'image/png', 100, 'test', 'batch_queued');
> // (Or use a 'recorded' row with a fake audio_path. Step 11 creates rows via POST; for now hand-insert.)
> // Before the tests, ensure this row exists. Before each test that expects 'ALREADY_PROCESSED', update transcription_status='success' first.
>
> (async () => {
>   // Test A: no signature → 401
>   let r = await post(99901, JSON.stringify({ auth_token: tokenFor(99901), transcript: 'test' }));
>   console.log('A:', r.status, r.body);  // expect 401
>
>   // Test B: wrong signature → 401
>   const body = JSON.stringify({ auth_token: tokenFor(99901), transcript: 'test' });
>   r = await post(99901, body, '00'.repeat(32));
>   console.log('B:', r.status, r.body);  // expect 401
>
>   // Test C: right signature but wrong token → 403
>   const badTokenBody = JSON.stringify({ auth_token: 'ff'.repeat(32), transcript: 'test' });
>   r = await post(99901, badTokenBody, sigFor(badTokenBody));
>   console.log('C:', r.status, r.body);  // expect 403
>
>   // Test D: right sig + right token, valid row → 200 'ok'
>   const goodBody = JSON.stringify({
>     auth_token: tokenFor(99901),
>     job_id: 'test-job-1',
>     transcript: 'This is a test transcript',
>     language_code: 'en'
>   });
>   r = await post(99901, goodBody, sigFor(goodBody));
>   console.log('D:', r.status, r.body);  // expect 200 'ok'
>
>   // Verify DB row updated
>   // sqlite3 database.sqlite "SELECT transcript_english, transcription_status FROM bug_reports WHERE id=99901;"
>
>   // Test E: replay (same request) → 200 'ok (dedup)'
>   r = await post(99901, goodBody, sigFor(goodBody));
>   console.log('E:', r.status, r.body);  // expect 200 ok (dedup)
>
>   // Test F: nonexistent report → 404
>   const body100 = JSON.stringify({ auth_token: tokenFor(999999), transcript: 'x' });
>   r = await post(999999, body100, sigFor(body100));
>   console.log('F:', r.status, r.body);  // expect 404
>
>   // Test G: empty body → 400
>   r = await post(99901, '', sigFor(Buffer.from('')));
>   console.log('G:', r.status, r.body);  // expect 400
>
>   // Clean up
>   // sqlite3 database.sqlite "DELETE FROM bug_reports WHERE id=99901;"
> })();
> ```
>
> Run this against a local server with SARVAM_WEBHOOK_SECRET set. Report each of A–G's status and body verbatim.
>
> Also confirm:
> - Global express.json() on OTHER routes still works (hit `/api/employees` or similar — no regression)
> - `cd backend && npm run lint` passes

Report all results.

## SELF-DEBUG PASS

1. Re-read the webhook handler. Confirm:
   - express.raw is scoped to THIS route via route-level middleware (not app-level)
   - The rawBody is read as Buffer BEFORE any JSON.parse
   - Signature verification happens BEFORE any DB read
   - The DB UPDATE is a single atomic prepared statement (no partial updates)
   - setImmediate for Claude extraction catches errors locally — doesn't throw back
   - No payload content is logged (a transcript could contain PII; we don't log transcripts)
   - The response on ALREADY_PROCESSED is 200, not 4xx — this is deliberate (Sarvam must stop retrying)
2. Trace a failure scenario: verifier passes but fetchJobResult fails. Does the row get updated to 'failed'? Does it return 200 (prevent Sarvam retry)? Yes on both — ✅.
3. Confirm the test row hand-insert in the subagent test script still respects the CHECK constraints from Step 1 (the test uses input_method='typed' + user_typed_comment, which is valid).

## USER-SIMULATION PASS

**Happy path — real Sarvam webhook at 14:32:**
- Sarvam POSTs to /sarvam-webhook/47 with sig + token + inline transcript
- express.raw reads body as Buffer
- verifyWebhook passes all 3 layers
- DB row 47 updated atomically: transcript_english, status='success', completed_at=now
- setImmediate kicks Claude extraction (stub for now)
- 200 'ok' → Sarvam considers delivered, no retry
- ✅

**Edge — Sarvam delivers job_id only, no inline transcript:**
- Verifier passes
- transcript === null → fallback to fetchJobResult(job_id)
- fetchJobResult returns `{ success: true, text: '...', detected_language: 'hi' }`
- Row updated, 200 ok
- ✅

**Edge — Sarvam retries after network blip; our handler gets same payload twice:**
- First call succeeds, transcription_status='success'
- Second call: layers 1+2 pass, layer 3 sees 'success' → 200 ok (dedup)
- Sarvam stops retrying
- ✅

**Edge — attacker probes with random POST:**
- No signature → 401
- No DB impact. No log of payload.
- ✅

**Edge — our DB is temporarily unreachable mid-handler:**
- DB prepare throws
- Caught by outer try/catch around the DB UPDATE, returns 500
- Sarvam will retry; next attempt succeeds when DB recovers
- ✅

## DELIVERABLES

**Files modified:**
- `backend/src/routes/bugReports.js` (replaced webhook stub with real handler)

**Commit message:**
```
feat(bug-reporter): wire Sarvam webhook endpoint with 3-layer verification (step 7/13)

- POST /api/bug-reports/sarvam-webhook/:id now verifies signature + token +
  idempotency before processing
- express.raw() scoped to webhook route ONLY; global express.json() unchanged
- On ok: atomically updates transcript_english, transcription_status, sarvam_job_*
  columns, then setImmediate kicks Claude extraction (stub until step 9)
- On SIGNATURE_INVALID → 401, TOKEN_MISMATCH → 403, ALREADY_PROCESSED → 200 (dedup),
  REPORT_NOT_FOUND → 404, other errors → 500 (so Sarvam retries)
- No payload content logged (PII protection)
- 7 live curl smoke checks pass (A-G: no sig, wrong sig, wrong token, happy,
  replay dedup, not found, empty body)

Part of Bug Reporter feature per bug-reporter-plan-v3.md §4.7
```

**Report back:**
- A–G statuses verbatim
- Confirmation other routes unaffected (json parsing still works elsewhere)
- Lint clean
- A statement: "Step 7 complete. Ready for Step 8 (sarvamBatchPoller safety net)."

---

============================================================
STEP 8 of 13 — sarvamBatchPoller.js safety net
============================================================

## CONTEXT

Webhooks can fail. Railway deploys bounce servers for 30s. Network blips. Sarvam's retry schedule might give up. Step 8 implements a cron that runs every 2 min and resolves batch jobs whose webhook never arrived.

Per plan §4.8: find rows where `sarvam_job_id IS NOT NULL AND transcription_status IN ('batch_queued','batch_polling') AND sarvam_webhook_received_at IS NULL` and age < max_age. For each, call `fetchJobResult` and — if complete — apply the same atomic update the webhook handler does. Mark `sarvam_poll_fallback_used=1` so we can measure webhook health.

Jobs older than max_age → mark failed with "timed out waiting for webhook/poll."

Read: plan §4.8, §10 (the risk about batch jobs stuck forever).

## DO NOT MODIFY

- Webhook handler (step 7)
- sarvamTranscription (steps 4–5)
- sarvamWebhookVerify (step 6)
- Any other existing file

## SUBAGENT — EXPLORATION

> 1. Check if the project has an existing cron/scheduler pattern (node-cron is in package.json per CLAUDE.md — backup cron uses it). Quote an existing cron usage.
> 2. Report whether there's a clean "once on boot, then every N min" pattern.
> 3. Check `backend/src/index.js` or a dedicated file like `backend/src/cron/` for where crons are registered.

## PLAN GATE (STOP HERE)

```
Files to create:
  - backend/src/services/sarvamBatchPoller.js
    Exports:
    - pollStuckJobs(): runs one poll cycle (find stuck rows, fetch, update)
    - startPollerCron(): schedules pollStuckJobs to run every
      BUG_REPORT_SARVAM_POLL_FALLBACK_INTERVAL_SEC seconds

Files to modify:
  - backend/src/index.js — call startPollerCron() after app bootstrap
```

Confirm.

## BUILD

Create `backend/src/services/sarvamBatchPoller.js`:

```js
const { getDb } = require('../database/db');
const { fetchJobResult } = require('./sarvamTranscription');

const POLL_INTERVAL_SEC = parseInt(process.env.BUG_REPORT_SARVAM_POLL_FALLBACK_INTERVAL_SEC, 10) || 120;
const MAX_AGE_MIN       = parseInt(process.env.BUG_REPORT_SARVAM_POLL_FALLBACK_MAX_AGE_MIN, 10) || 30;

async function pollStuckJobs() {
  const db = getDb();

  // Find stuck rows — webhook not received, job created, not too old
  const stuck = db.prepare(`
    SELECT id, sarvam_job_id, created_at
      FROM bug_reports
     WHERE sarvam_job_id IS NOT NULL
       AND transcription_status IN ('batch_queued', 'batch_polling')
       AND sarvam_webhook_received_at IS NULL
       AND (julianday('now') - julianday(sarvam_job_created_at)) * 1440 < ?
  `).all(MAX_AGE_MIN);

  // Find expired rows — too old, give up
  const expired = db.prepare(`
    SELECT id
      FROM bug_reports
     WHERE sarvam_job_id IS NOT NULL
       AND transcription_status IN ('batch_queued', 'batch_polling')
       AND sarvam_webhook_received_at IS NULL
       AND (julianday('now') - julianday(sarvam_job_created_at)) * 1440 >= ?
  `).all(MAX_AGE_MIN);

  for (const row of expired) {
    db.prepare(`
      UPDATE bug_reports
         SET transcription_status = 'failed',
             transcription_error  = 'Sarvam job timed out without webhook or poll resolution',
             sarvam_job_status    = 'expired'
       WHERE id = ?
    `).run(row.id);
    console.warn(`[sarvam-poller] expired job for report ${row.id}`);
  }

  let resolved = 0;
  for (const row of stuck) {
    try {
      // Mark polling in-progress (cheap optimistic flag)
      db.prepare(`
        UPDATE bug_reports
           SET transcription_status = 'batch_polling'
         WHERE id = ? AND transcription_status = 'batch_queued'
      `).run(row.id);

      const result = await fetchJobResult(row.sarvam_job_id);

      if (result.success) {
        db.prepare(`
          UPDATE bug_reports
             SET transcript_english = ?,
                 transcript_detected_language = ?,
                 transcription_status = 'success',
                 sarvam_job_status    = 'completed',
                 sarvam_job_completed_at = datetime('now'),
                 sarvam_poll_fallback_used = 1
           WHERE id = ?
        `).run(result.text, result.detected_language, row.id);

        // Kick Claude extraction (same pattern as webhook)
        setImmediate(() => {
          try {
            // Step 9 replaces this import with real analyzer
            const { runClaudeExtraction } = require('./bugReportAnalyzer');
            runClaudeExtraction(row.id).catch(err =>
              console.error(`[poller] claude failed for ${row.id}: ${err.message}`));
          } catch (_e) {
            console.log(`[poller] step 9 not yet installed; skipping claude for ${row.id}`);
          }
        });

        resolved++;
      } else if (result.pending) {
        // Still in progress, leave alone for next cycle
      } else {
        // Fetch said failed
        db.prepare(`
          UPDATE bug_reports
             SET transcription_status = 'failed',
                 transcription_error  = ?,
                 sarvam_job_status    = 'failed'
           WHERE id = ?
        `).run(result.error || 'unknown', row.id);
      }
    } catch (err) {
      console.error(`[sarvam-poller] cycle error for report ${row.id}: ${err.message}`);
      // Leave row as-is; try again next cycle
    }
  }

  if (stuck.length || expired.length) {
    console.log(
      `[sarvam-poller] cycle: stuck=${stuck.length} resolved=${resolved} expired=${expired.length}`
    );
  }
}

let _interval;
function startPollerCron() {
  if (_interval) return;
  _interval = setInterval(() => {
    pollStuckJobs().catch(err => console.error('[sarvam-poller] uncaught:', err.message));
  }, POLL_INTERVAL_SEC * 1000);
  console.log(`[sarvam-poller] started, interval=${POLL_INTERVAL_SEC}s max_age=${MAX_AGE_MIN}min`);
}

function stopPollerCron() { if (_interval) { clearInterval(_interval); _interval = null; } }

module.exports = { pollStuckJobs, startPollerCron, stopPollerCron };
```

Wire into `backend/src/index.js`, late in bootstrap (after DB ready, after routes mounted):
```js
const { startPollerCron } = require('./services/sarvamBatchPoller');
startPollerCron();
```

## SUBAGENT — VERIFICATION

> 1. Module loads: `cd backend && node -e "require('./src/services/sarvamBatchPoller')"` — no error
> 2. With no stuck rows, a poll cycle completes silently:
>    ```
>    cd backend && node -e "
>    require('dotenv').config();
>    const { pollStuckJobs } = require('./src/services/sarvamBatchPoller');
>    pollStuckJobs().then(() => console.log('done'));
>    "
>    ```
>    Expect: 'done' printed with no stuck/expired logs.
> 3. Hand-insert a stuck row (typed-like but with fake sarvam_job_id to trigger the query):
>    ```
>    sqlite3 backend/database.sqlite "
>    INSERT INTO bug_reports (reporter_username, reporter_role, input_method, screenshot_path,
>                             screenshot_mime, screenshot_size_bytes, user_typed_comment,
>                             transcription_status, sarvam_job_id, sarvam_job_created_at)
>    VALUES ('poller_test', 'hr', 'typed', '/tmp/x.png', 'image/png', 100, 'test',
>            'batch_queued', 'fake-job-never-exists', datetime('now','-1 minutes'));
>    "
>    ```
>    Then run pollStuckJobs — it will call fetchJobResult('fake-job-never-exists') which will 404/fail at Sarvam. Verify the row is left alone (still 'batch_queued' or 'batch_polling'; not marked 'failed' unless Sarvam explicitly returns a failure result).
> 4. Age out that row:
>    ```
>    sqlite3 backend/database.sqlite "
>    UPDATE bug_reports SET sarvam_job_created_at = datetime('now','-45 minutes')
>    WHERE reporter_username='poller_test';
>    "
>    ```
>    Run pollStuckJobs. Row should now be transcription_status='failed' and sarvam_job_status='expired'.
> 5. Clean up: `sqlite3 backend/database.sqlite "DELETE FROM bug_reports WHERE reporter_username='poller_test';"`
> 6. Lint.

## SELF-DEBUG

1. Confirm that pollStuckJobs is safe to run concurrently with the webhook handler. Both update the same row, but in different conditions:
   - Webhook: updates when `sarvam_webhook_received_at IS NULL`
   - Poller: finds rows with `sarvam_webhook_received_at IS NULL`, transitions to `batch_polling`, then updates
   - Race: webhook arrives WHILE poller is in fetchJobResult. Both try to update. Last-write-wins — both writes agree on the transcript (same source), so the end state is correct. `sarvam_poll_fallback_used=1` might or might not be set depending on order; acceptable.
2. Confirm poller imports of `bugReportAnalyzer` are lazy (`require` inside setImmediate) so step 9 can install it without touching step 8.
3. Confirm the poller does NOT set `sarvam_webhook_received_at`; that column is webhook-specific.

## USER-SIMULATION

**Happy path:** report 47 created 14:30, webhook never arrives. 14:32 poller runs, fetches job, sees 'completed', updates row, sets `sarvam_poll_fallback_used=1`, kicks Claude. ✅

**Edge:** report 47 created 14:30, STILL pending at Sarvam at 14:32. Poller sees `result.pending=true`, leaves row alone. Next cycle at 14:34 also pending. Eventually done. ✅

**Edge:** report 47 created 14:30, Sarvam lost the job entirely. Poller fetches, gets error. Leaves row alone (fail soft) until 15:00 when age exceeds 30 min → marked 'failed'/'expired'. ✅

## DELIVERABLES

**Files created:** `sarvamBatchPoller.js`
**Files modified:** `backend/src/index.js` (+startPollerCron call)

**Commit message:**
```
feat(bug-reporter): add sarvamBatchPoller safety net (step 8/13)

- Runs every BUG_REPORT_SARVAM_POLL_FALLBACK_INTERVAL_SEC (default 120s)
- Finds batch jobs where sarvam_webhook_received_at IS NULL and age < 30 min
- Fetches job result; on success, applies same atomic update as webhook handler
  AND sets sarvam_poll_fallback_used=1 for observability
- Expired rows (>30 min) marked 'failed' with 'timed out' error
- Race-safe: optimistic transition to 'batch_polling' before fetch
- Concurrent with webhook handler: last-write-wins is correct (same transcript)

Part of Bug Reporter feature per bug-reporter-plan-v3.md §4.8
```

**Report:** expired test pass, lint clean. Ready for Step 9.

---

============================================================
STEP 9 of 13 — bugReportAnalyzer.js (orchestrator + Claude extraction)
============================================================

## CONTEXT

Step 9 is the beating heart. It orchestrates: transcription (Sarvam REST or Batch), then Claude extraction. It exports `processBugReport(id, { forceReanalyze })` for POST handler use, and `runClaudeExtraction(id)` for webhook/poller use (Claude-only, skip transcription).

The Claude extraction prompt lives in `policy_config.bug_report_extraction_prompt` with `{{KNOWN_PAGES}}` placeholder replaced at runtime.

Read: plan §4.9 (analyzer), §5 (prompt).

## DO NOT MODIFY

- Webhook handler (beyond replacing `runClaudeExtractionStub` with real import)
- Poller (beyond the require inside setImmediate — no change needed, step 8 already uses lazy require)
- Sarvam services
- Schema, storage, routes (except route stubs in step 11)

## SUBAGENT — EXPLORATION

> 1. Find an existing service that calls Anthropic API (e.g., Salary Explainer). Quote how it:
>    (a) builds messages with image content blocks (base64)
>    (b) calls the model (`claude-sonnet-4-...`) and reads the response
>    (c) parses JSON responses
>    (d) handles errors
> 2. Confirm the exact model name used elsewhere (per userMemories: `claude-sonnet-4-20250514`). Use the same.
> 3. Report the exact imports/setup needed (API key env var, client construction).
> 4. Read `backend/src/services/bugReportStorage.js` — note `readScreenshot` is for metadata only; to get the actual bytes we need `fs.readFileSync(path)` directly OR add a read function. Decide.

## PLAN GATE (STOP HERE)

```
Files to create:
  - backend/src/services/bugReportAnalyzer.js
    Exports:
    - processBugReport(id, { forceReanalyze = false }): full pipeline
    - runClaudeExtraction(id): Claude-only (called post-transcription)
    - All errors caught — never throws; all failure modes land in DB columns

Files to modify:
  - backend/src/routes/bugReports.js — replace runClaudeExtractionStub with
    real import from bugReportAnalyzer

No schema changes. No new deps (assumes anthropic SDK already in package.json
via Salary Explainer).
```

## BUILD

Create `backend/src/services/bugReportAnalyzer.js`:

```js
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk'); // or whatever existing pattern uses
const { getDb } = require('../database/db');
const { transcribe } = require('./sarvamTranscription');

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

function anthropicClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  return new Anthropic({ apiKey: key });
}

function loadPromptConfig(db) {
  const promptRow = db.prepare("SELECT value FROM policy_config WHERE key='bug_report_extraction_prompt'").get();
  const versionRow = db.prepare("SELECT value FROM policy_config WHERE key='bug_report_extraction_prompt_version'").get();
  const pagesRow = db.prepare("SELECT value FROM policy_config WHERE key='bug_report_known_pages_json'").get();
  if (!promptRow || !versionRow || !pagesRow) {
    throw new Error('policy_config seeds missing — run step 1');
  }
  const knownPages = JSON.parse(pagesRow.value);
  const pagesBlock = knownPages.map(p => `- ${p}`).join('\n');
  const prompt = promptRow.value.replace('{{KNOWN_PAGES}}', pagesBlock);
  return { prompt, version: versionRow.value };
}

function estimateClaudeCostCents(usage) {
  // Rough: Sonnet 4 input ~$0.003/1k tok, output ~$0.015/1k tok
  // usage = { input_tokens, output_tokens }
  const inCost  = (usage.input_tokens  || 0) / 1000 * 0.3;
  const outCost = (usage.output_tokens || 0) / 1000 * 1.5;
  return Math.round((inCost + outCost) * 100) / 100;
}

async function runClaudeExtraction(reportId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM bug_reports WHERE id = ?').get(reportId);
  if (!row) return { success: false, error: 'row not found' };

  db.prepare("UPDATE bug_reports SET claude_run_status='pending' WHERE id=?").run(reportId);

  try {
    const { prompt, version } = loadPromptConfig(db);

    // Build description: either English transcript OR typed comment
    const description = row.user_typed_comment || row.transcript_english || '';
    if (!description) {
      db.prepare(`UPDATE bug_reports
        SET claude_run_status='failed', claude_error='no description available'
        WHERE id=?`).run(reportId);
      return { success: false, error: 'no description' };
    }

    // Read screenshot as base64
    const imgBytes = fs.readFileSync(row.screenshot_path);
    const imgB64 = imgBytes.toString('base64');

    // Auto-context summary
    const ctx = row.auto_context_json ? JSON.parse(row.auto_context_json) : {};

    const userMessage = [
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

    const client = anthropicClient();
    const resp = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: prompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = resp.content.find(b => b.type === 'text');
    const raw = textBlock ? textBlock.text : '';

    // Strict parse
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

    const confidence = parsed.summary_confidence || 'medium';
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
    db.prepare(`UPDATE bug_reports
      SET claude_run_status='failed', claude_error=?
      WHERE id=?`).run(`Claude call failed: ${code} — ${err.message?.slice(0, 500)}`, reportId);
    return { success: false, error: code };
  }
}

async function processBugReport(reportId, { forceReanalyze = false } = {}) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM bug_reports WHERE id=?').get(reportId);
  if (!row) return { success: false, error: 'not found' };

  // TRANSCRIPTION phase
  if (row.input_method === 'typed') {
    db.prepare("UPDATE bug_reports SET transcription_status='skipped' WHERE id=?").run(reportId);
  } else if (row.transcript_english && !forceReanalyze) {
    // Already transcribed; skip (reanalyze path saves cost)
  } else {
    db.prepare("UPDATE bug_reports SET transcription_status='pending' WHERE id=?").run(reportId);
    const result = await transcribe(
      row.audio_path, row.audio_mime, row.audio_duration_sec, reportId
    );

    if (result.pending) {
      // Batch job kicked; webhook/poller will finish it. Save job id.
      db.prepare(`UPDATE bug_reports
        SET transcription_status='batch_queued',
            transcription_path=?,
            transcription_model=?,
            transcription_cost_cents=?,
            sarvam_job_id=?,
            sarvam_job_status='created',
            sarvam_job_created_at=datetime('now')
        WHERE id=?`).run(
          'batch', result.model_used, result.cost_cents, result.job_id, reportId
        );
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

    // REST success — store and proceed
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

  // CLAUDE phase
  return await runClaudeExtraction(reportId);
}

module.exports = { processBugReport, runClaudeExtraction };
```

Update `backend/src/routes/bugReports.js`: remove `runClaudeExtractionStub`, replace the `setImmediate(() => runClaudeExtractionStub(reportId))` call with:
```js
const { runClaudeExtraction } = require('../services/bugReportAnalyzer');
setImmediate(() => runClaudeExtraction(reportId).catch(err => console.error('[webhook] claude err:', err.message)));
```

## SUBAGENT — VERIFICATION

> 1. Module loads
> 2. Hand-insert a 'typed' row with screenshot and description, run processBugReport, verify claude_extraction_json populated with valid JSON matching the plan §5 shape
> 3. Hand-insert a row where screenshot_path doesn't exist → analyzer returns failure with `claude_run_status='failed'` (not crashed)
> 4. With an invalid prompt (temporarily corrupt policy_config) → JSON parse failure captured in claude_error
> 5. Real webhook end-to-end: manually POST a signed payload to the webhook handler (reusing step 7 test harness), verify Claude extraction kicks off and row gets claude_extraction_json populated within ~10s
> 6. Lint

Clean up test rows after.

## SELF-DEBUG

- Verify `runClaudeExtraction` never throws — all errors land in DB columns
- Verify the JSON parse is strict (no markdown-fence stripping — plan says prompt forbids fences)
- Verify PII is not logged (transcript, description, user names)
- Verify `claude_prompt_version` is stamped on every successful extraction

## USER-SIMULATION

- Typed report: skip transcription → Claude runs immediately → success
- Recorded short (22s): REST transcription → Claude runs → success
- Recorded long (60s): batch transcription returns pending → row marked batch_queued → webhook arrives later → Claude runs → success
- Claude API 429 rate limited: falls into catch, row marked failed with 429 code, admin can Reanalyze

## DELIVERABLES

Commit:
```
feat(bug-reporter): add bugReportAnalyzer.js orchestrator (step 9/13)

- processBugReport: transcription + Claude extraction pipeline
- runClaudeExtraction: Claude-only path for webhook/poller use
- Loads prompt from policy_config at runtime (hot-swappable)
- Replaces {{KNOWN_PAGES}} with current known-pages list
- forceReanalyze path preserves existing transcript (saves Sarvam cost)
- Strict JSON parse; parse failure stores raw response in claude_error
- Stamps claude_prompt_version on every run for iteration tracking
- Never throws — all failures land in DB columns; row remains usable

Part of Bug Reporter feature per bug-reporter-plan-v3.md §4.9
```

Ready for Step 10.

---

============================================================
STEP 10 of 13 — bugReportResurrect.js boot-time rescue
============================================================

## CONTEXT

Containers restart. Rows get stuck in `pending` status with no active worker. Step 10 runs at boot and re-queues them.

Two buckets (plan §4.10):
- Bucket A: Claude extraction pending but transcription succeeded — re-run just Claude
- Bucket B: Sarvam REST pending (container crashed mid-call) — re-run full pipeline

Bucket C (batch jobs) is handled by the poller — no-op here.

## DO NOT MODIFY

- Poller
- Analyzer beyond import
- Webhook handler

## PLAN GATE

```
Files to create:
  - backend/src/services/bugReportResurrect.js
    Exports: resurrectStuckRows()

Files to modify:
  - backend/src/index.js — call resurrectStuckRows() at boot after DB ready
```

## BUILD

```js
// backend/src/services/bugReportResurrect.js
const { getDb } = require('../database/db');

async function resurrectStuckRows() {
  const db = getDb();

  const stuckClaude = db.prepare(`
    SELECT id FROM bug_reports
     WHERE claude_run_status = 'pending'
       AND transcription_status = 'success'
       AND datetime(created_at) > datetime('now', '-24 hours')
  `).all();

  const stuckRest = db.prepare(`
    SELECT id FROM bug_reports
     WHERE transcription_status = 'pending'
       AND sarvam_job_id IS NULL
       AND datetime(created_at) > datetime('now', '-24 hours')
  `).all();

  if (stuckClaude.length === 0 && stuckRest.length === 0) {
    console.log('[bug-reporter-resurrect] no stuck rows');
    return;
  }

  // Lazy require to avoid circular deps at boot
  const { runClaudeExtraction, processBugReport } = require('./bugReportAnalyzer');

  for (const { id } of stuckClaude) {
    setImmediate(() => runClaudeExtraction(id).catch(e => console.error(`[resurrect A ${id}]`, e.message)));
  }
  for (const { id } of stuckRest) {
    setImmediate(() => processBugReport(id).catch(e => console.error(`[resurrect B ${id}]`, e.message)));
  }

  console.log(`[bug-reporter-resurrect] re-queued: claude=${stuckClaude.length} rest=${stuckRest.length}`);
}

module.exports = { resurrectStuckRows };
```

Wire in `backend/src/index.js` after DB init:
```js
const { resurrectStuckRows } = require('./services/bugReportResurrect');
resurrectStuckRows();  // fire-and-forget
```

## VERIFICATION

- Module loads
- Hand-insert a stuck bucket A row, call resurrectStuckRows, verify setImmediate fires and runClaudeExtraction is called
- Same for bucket B
- Rows older than 24h are ignored
- Lint

## DELIVERABLES

Commit: "feat(bug-reporter): add boot-time resurrection (step 10/13)"

Ready for Step 11.

---

============================================================
STEP 11 of 13 — wire all CRUD endpoints + rate limiter
============================================================

## CONTEXT

Stubs from Step 3 become real. Plan §4.4 lists all 8 authed endpoints. Rate limit per §4.5 (10/user/hour).

Read: plan §4.4, §4.5, §4.6, §4.11.

## DO NOT MODIFY

- Webhook handler (step 7)
- Any service file

## SUBAGENT — EXPLORATION

- Find existing rate-limit pattern (maybe express-rate-limit in package.json, or custom Map-based)
- Find existing multer pattern for file uploads
- Find existing list/count/detail route patterns for admin endpoints

## PLAN GATE

```
Files to modify:
  - backend/src/routes/bugReports.js — implement all 8 authed handlers
  - backend/src/middleware/uploadBugReport.js — multer config (new)

Routes:
  POST   /api/bug-reports                         — create (rate-limited, multipart)
  GET    /api/bug-reports                         — admin list (paginated, status filter)
  GET    /api/bug-reports/count?status=new        — admin badge polling
  GET    /api/bug-reports/:id                     — admin detail
  GET    /api/bug-reports/:id/screenshot          — admin streams file
  GET    /api/bug-reports/:id/audio               — admin streams file
  PUT    /api/bug-reports/:id                     — admin update (status/notes/quality)
  POST   /api/bug-reports/:id/reanalyze           — admin forceReanalyze
```

## BUILD

Create `backend/src/middleware/uploadBugReport.js` — multer with memory storage (we write to disk ourselves via bugReportStorage). Size limits: screenshot ≤10MB, audio ≤25MB. `upload.fields([{ name: 'screenshot', maxCount: 1 }, { name: 'audio', maxCount: 1 }])`.

In `bugReports.js`, add rate limiter:
```js
// Simple per-user counter
const rateBuckets = new Map();  // username → { count, windowStart }
const RATE_LIMIT = parseInt(process.env.BUG_REPORT_RATE_LIMIT_PER_USER_PER_HOUR, 10) || 10;

function rateLimit(req, res, next) {
  const user = req.user?.username || req.user?.id || 'anon';
  const now = Date.now();
  const bucket = rateBuckets.get(user) || { count: 0, windowStart: now };
  if (now - bucket.windowStart > 3600_000) { bucket.count = 0; bucket.windowStart = now; }
  bucket.count++;
  rateBuckets.set(user, bucket);
  if (bucket.count > RATE_LIMIT) {
    res.setHeader('Retry-After', '3600');
    return res.status(429).json({ success: false, error: 'rate limit exceeded' });
  }
  next();
}
```

Implement each handler. Key points:

**POST /**:
- upload.fields middleware first, then rateLimit
- Parse payload JSON (`req.body.payload`)
- Validate input_method enum, required fields, audio-if-present
- Insert row with screenshot_path=null, audio_path=null initially
- Call `bugReportStorage.writeScreenshot(row.id, req.files.screenshot[0].buffer, mime)` — get path
- Same for audio if present
- UPDATE row with paths
- setImmediate(() => processBugReport(id)) — fire-and-forget
- Return 201 { id, status: 'created' }

**GET /**:
- Admin only
- Query params: status (optional, default=all), limit=25, offset=0
- Returns list with relevant columns (not the blob paths, not full JSON — just summary)

**GET /count**:
- Admin only
- Returns { success, count } for the given status

**GET /:id**:
- Admin only
- Returns full row (all columns)

**GET /:id/screenshot** and `/audio`:
- Admin only
- Read row, get path, `res.sendFile(path)` with the stored mime

**PUT /:id**:
- Admin only
- Body: { admin_status?, admin_notes?, admin_extraction_quality?, admin_feedback_on_extraction? }
- Validate enums on admin_status and admin_extraction_quality
- Build dynamic UPDATE of non-undefined fields; always sets resolved_at/resolved_by when moving to 'resolved'/'wont_fix'

**POST /:id/reanalyze**:
- Admin only
- Call `processBugReport(id, { forceReanalyze: true })` via setImmediate
- Return 202 { success, status: 'reanalysis_started' }

## VERIFICATION

- Curl each endpoint with admin auth, HR auth, no auth — expected status codes
- POST with valid screenshot + typed_comment → row created, file on disk, Claude extraction runs
- POST with screenshot + audio (short) → row created, transcription runs
- POST without screenshot → 400
- POST 11 times within an hour → 11th returns 429
- GET /count returns correct number
- PUT with invalid status enum → 400 (CHECK constraint or explicit validation)
- Reanalyze re-runs Claude without re-running transcription
- Lint

## DELIVERABLES

Commit: "feat(bug-reporter): wire CRUD endpoints + rate limiter (step 11/13)"

Report count of routes wired, rate-limit behavior verified. Ready for Step 12.

---

============================================================
STEP 12 of 13 — frontend (full)
============================================================

## CONTEXT

12 frontend files per plan §6.1. Break this into sub-steps WITHIN this single commit to keep moving pieces testable. Subagent pattern: parallel exploration (read-only), sequential build.

## DO NOT MODIFY

- Existing Zustand store shape
- Existing axios client (only ADD interceptor)
- Sidebar structure (only ADD one entry at the bottom)
- Any backend

## SUBAGENT — EXPLORATION (parallel OK for read-only)

Spawn THREE subagents in parallel:
1. Read the Zustand store, existing auth context, existing role-gate pattern (used elsewhere like Salary Explainer render gate per memory)
2. Read the existing axios client setup, current interceptor structure, any existing CSRF/auth header injection
3. Read the existing sidebar component, current nav entries, routing setup (react-router version, lazy loading pattern)

Report back with specific patterns to mirror.

## PLAN GATE

Present comprehensive plan listing all 12 files to create and the 2-3 files to modify (sidebar, axios client, App routes). Get approval.

## BUILD

Implement per plan §6:
- apiContextBuffer.js + axios interceptor with snapshot-on-open and exclusion list
- ScreenshotInput, AudioUploader, VoiceRecorder — tested in isolation first if possible
- BugReportModal with three-path chooser and submit flow
- Sidebar BugReportButton — opens modal, visible all roles
- useNewBugReportCount hook — 60s poll of /count endpoint
- BugReportsInbox page, BugReportDetail page — admin only
- copyTicketSummary utility
- Route registration in App.jsx (both admin pages lazy-loaded)

## VERIFICATION

Manual smoke (HR user account): open page → sidebar → modal → screenshot + recorded audio → submit → see toast.
Admin user: open /admin/bug-reports → see the row → click → full detail renders.
Test iOS Safari specifically — record audio, confirm it uploads and plays back.
Test uploaded audio path: export a voice note from WhatsApp, upload, confirm transcription succeeds.
Test typed path: fill out form → submit → admin sees it with transcription_status=skipped.
Lint (both eslint and tsc if TS is used).
Build (npm run build) must succeed; check the generated dist for the new routes.

## DELIVERABLES

Commit: "feat(bug-reporter): frontend — modal, components, admin inbox (step 12/13)"

Report: all three smoke tests pass, iOS Safari tested. Ready for Step 13.

---

============================================================
STEP 13 of 13 — CLAUDE.md updates + /ship checklist
============================================================

## CONTEXT

Final step. Doc-only. Updates CLAUDE.md to reflect the new feature and adds a checklist item to `.claude/commands/ship.md`.

## DO NOT MODIFY

- Any code
- Any service
- Any config
Only CLAUDE.md and .claude/commands/ship.md (and maybe docs/).

## BUILD

Edit `CLAUDE.md`:

**Section 0 (Last Session):**
```
Files added: schema.js additions for bug_reports, bugReports.js route,
voiceTranscription/sarvamTranscription.js, sarvamWebhookVerify.js,
sarvamBatchPoller.js, bugReportAnalyzer.js, bugReportStorage.js,
bugReportResurrect.js, uploadBugReport.js middleware, BugReportModal +
VoiceRecorder + AudioUploader + ScreenshotInput components, BugReportsInbox +
BugReportDetail pages, apiContextBuffer.js, copyTicketSummary.js,
sample-hinglish.m4a fixture

What shipped: Bug reporter — screenshot + (voice/upload/typed) + Sarvam
translation + Claude extraction → admin inbox. Sarvam batch jobs use webhook
(HMAC + token + idempotency) + safety-net polling.

What's fragile: VoiceRecorder iOS Safari compatibility, Sarvam webhook
signature verification (never remove any of the 3 defense layers), webhook
route mounted outside requireAuth but inside signature middleware, disk-vs-DB
consistency (no enforcer), Sarvam's payload shape assumptions (if Sarvam
changes their API, sarvamTranscription.js and sarvamWebhookVerify.js must
update together).

Known issues remaining: none at deploy; iterate extraction prompt against
real reports using Section 9 of bug-reporter-plan-v3.md.
```

**Section 3 (Pipeline Dependency Map):** add "Consumer: Bug Reporter" with read-only note + webhook security note.

**Section 6:** add attachments-not-backed-up note.

**Section 8:** add two rules:
1. If you add a new top-level page, update `policy_config.bug_report_known_pages_json`.
2. If you modify the webhook route, preserve all 3 defense layers. Run §8.6 attack drill post-deploy.
3. Never mount `/sarvam-webhook` inside requireAuth.

Edit `.claude/commands/ship.md`: add a new checklist item in the cascade audit:

> 10. **Bug Reporter**: If this change adds a new top-level user-facing page, update `policy_config.bug_report_known_pages_json` via Query Tool or the extraction prompt will misclassify screenshots of the new page.

## VERIFICATION

Subagent re-reads both files end-to-end, confirms all new sections present and coherent. Lint (markdown).

## DELIVERABLES

Commit: "docs(bug-reporter): CLAUDE.md + /ship checklist updates (step 13/13)"

Report: final sign-off list — all 13 steps shipped, 8 new backend files, 12 new frontend files, 1 new table, 3 new policy_config entries, 1 new public route (signature-verified), 1 new sidebar entry. Deploy when ready.

**POST-DEPLOY checklist (run AFTER Railway confirms live):**
1. SARVAM_WEBHOOK_SECRET set in Railway env vars ✅
2. SARVAM_API_KEY set ✅
3. ANTHROPIC_API_KEY already set (existing) ✅
4. `curl -X POST https://hr-app-production-681b.up.railway.app/api/bug-reports/sarvam-webhook/999 -i` → 401 (attack drill) ✅
5. Sidebar "Report an issue" visible in incognito window ✅
6. File one real report of each input method, confirm admin inbox renders ✅
7. Run `sqlite3 ... "SELECT COUNT(*) FROM bug_reports"` matches expectations ✅
8. Update bug-reporter-plan-v3.md status from "Approved for build" to "Shipped [date]" ✅

---

## END OF ALL 13 STEPS

Run them in order, one at a time. Do not batch. Do not parallelize. Each ends with a commit; each commit should be independently revertable. When all 13 are green, the feature is live.

If anything goes sideways during the build: stop at that step, report the failure, and I'll help you diagnose before moving forward. Do not push on through a failing step.

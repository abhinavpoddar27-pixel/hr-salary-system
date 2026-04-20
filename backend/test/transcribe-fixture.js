// Test: transcribe the committed Hinglish fixture and validate the result.
// Usage: npm run test:transcribe   (invokes `node --env-file=.env ...`)
// Or:    SARVAM_API_KEY=xxx node test/transcribe-fixture.js
//
// The dotenv require below is a harmless no-op when the package isn't
// installed (this project doesn't add dotenv as a dep) — env loading is
// handled by Node's native --env-file flag via the npm script.

try { require('dotenv').config(); } catch (_) { /* optional */ }

const path = require('path');
const { transcribe } = require('../src/services/sarvamTranscription');

const FIXTURE = path.join(__dirname, 'fixtures/bug-reporter/sample-hinglish.m4a');
const DURATION_SEC = 22;

(async () => {
  console.log('[test:transcribe] calling Sarvam with fixture:', FIXTURE);
  const t0 = Date.now();
  const result = await transcribe(FIXTURE, 'audio/mp4', DURATION_SEC);
  const elapsedMs = Date.now() - t0;

  console.log('[test:transcribe] elapsed:', elapsedMs, 'ms');
  console.log('[test:transcribe] result:', JSON.stringify(result, null, 2));

  const checks = [
    { name: 'success=true', ok: result.success === true },
    { name: 'text is non-empty string', ok: typeof result.text === 'string' && result.text.length > 0 },
    { name: 'path=rest', ok: result.path === 'rest' },
    { name: 'cost_cents > 0', ok: typeof result.cost_cents === 'number' && result.cost_cents > 0 },
    { name: 'model_used set', ok: !!result.model_used },
    {
      name: 'detected_language set (optional, warn-only)',
      ok: true,
      warn: !result.detected_language ? 'language not detected (non-fatal)' : null,
    },
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

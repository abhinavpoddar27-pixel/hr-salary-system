# P2-09 — PROGRESS

## RESUME
Branch feat/errorboundary-sentry (base 80934af4, origin/main merged in), worktree /home/claude/wt-p2-09, port 3209.
Owned: components/ui/ErrorBoundary.jsx + new files. BUILD DONE — only the hand-off report remains.

## Steps
- [x] Phase 0: read code, Sentry counts (frontend 0 errors / 0 spans 90d), live bundle DSN diagnosis, jest baseline 105/1649
- [x] PLAN.md + PROGRESS.md committed
- [x] planner "go" (rulings below)
- [x] ErrorBoundary.jsx change
- [x] check script `backend/scripts/errorboundary-sentry-check.py` — fix 36/36, `--base` on an 80934af4 build 3/3
- [x] merge origin/main (clean, no conflict), rebuild, check 36/36 again, jest 107 suites / 1669 (all pass)
- [x] push, report

## Rulings (planner, 11 Oct 2026)
- Q1 page name = Header `<h1>` text read at render time, fallback "this page". App.jsx NOT edited (P2-08 owns it).
- Q2 yes — the error clears on a path change.
- Q3 yes — the Sentry reference id in "Show details" is enough (bug modal not changed).
- Q4 wording: "Nothing was saved by this error."
- Q5 the Railway DSN fix is an owner step (below), not part of this PR's acceptance.

## Owner task — fix the frontend Sentry DSN on Railway (seven fields)
Why: the live bundle's DSN has three other variable names glued onto its end, so the Sentry SDK switches itself off.
Sentry project hr-salary-frontend has 0 events and 0 spans in 90 days. Until this is fixed, P2-09's reports go nowhere.
1. **Surface:** Railway dashboard (GUI) in a browser — railway.app → the HR app project → the service that serves
   hr-app-production-681b.up.railway.app → **Variables** tab. Then Mac Terminal for the check.
2. **Preflight (Terminal):** confirms the bug is still live — prints `1` while the glued text is in the bundle:
   `curl -s https://hr-app-production-681b.up.railway.app/ | grep -o 'assets/index-[^"]*\.js' | head -1 | xargs -I{} curl -s https://hr-app-production-681b.up.railway.app/{} | grep -c 'sentry.io/[0-9]*VITE_SENTRY'`
3. **Action (GUI):** Variables → row `VITE_SENTRY_DSN` → ⋯ → Edit. The value must end right after the number that
   follows `.ingest.de.sentry.io/` — delete everything after that number (the text starting `VITE_SENTRY_ENVIRONMENT…`).
   Save. Check `VITE_SENTRY_ENVIRONMENT` exists as its own row with value `production` (add
   `VITE_SENTRY_TRACES_SAMPLE_RATE` = `0.2` as its own row only if wanted; release can stay unset).
   Railway offers to deploy the change → **Deploy** (Vite reads the value at BUILD time, so a redeploy is required).
   Do not paste the DSN anywhere else (chat, files).
4. **Expected:** the new deploy goes green; the app works as before.
5. **Verify (Terminal, after the deploy is live):** the Preflight command must now print `0`. Then use the app for a
   minute; in Sentry → project hr-salary-frontend → Explore → Traces, page-load spans appear (count > 0).
6. **Undo:** Railway → Deployments → the previous deployment → ⋯ → Redeploy (restores the old build); the variable can be
   edited back in Variables. Nothing in the database is touched.
7. **Return:** the number the Verify command prints (`0` expected), and "ok" once Sentry shows frontend spans.

## Build notes
- `ErrorBoundary.jsx`: `componentDidCatch` → `Sentry.captureException(error, {tags:{boundary:'page', page:<path>},
  contexts:{react:{componentStack}}})` in try/catch; returned event id kept in state. Fallback: "Something went wrong on
  <header h1 text | this page>." + "Nothing was saved by this error. …"; buttons Try again / Reload page / Report bug
  (`useAppStore.getState().openBugReportModal()`); "Show details" reveals the raw message + "Reference: <event id>".
  `componentDidUpdate` clears the error when `window.location.pathname` differs from the path at catch time.
- Check script forces the crash with no app test code: Playwright replaces `assets/Employees-*.js` with a throwing
  module; frontend built with a FAKE DSN on a `.invalid` host; Sentry envelope POSTs are intercepted (never leave the box).

## CLAUDE.md entry
## Last Session — 2026-10-11 (P2-09: page crashes reach Sentry; plain message; Report bug)
**Branch `feat/errorboundary-sentry`, NOT merged.** Frontend only (`components/ui/ErrorBoundary.jsx`). Plan + log:
`docs/ux-bulk/prs/P2-09/PLAN.md`, `PROGRESS.md`. Finding X-4. Rulings Q1–Q5 (11 Oct).
- **Bug:** the page ErrorBoundary (Layout, FinanceAudit, SessionAnalytics) only console.error'd and showed the raw
  error; the outer `Sentry.ErrorBoundary` in main.jsx never sees errors it catches → page crashes were never reported.
- **Fix:** `Sentry.captureException` in `componentDidCatch` (tags boundary=page + path, React component stack; never
  throws); plain message naming the page (Header `<h1>`, fallback "this page"), "Nothing was saved by this error.";
  Try again / Reload page / Report bug (opens the existing bug reporter); raw error + Sentry reference id behind
  "Show details"; the error clears on navigation to another path.
- **Production finding (owner step, not code):** Railway `VITE_SENTRY_DSN` has three other variables glued onto its end
  → the SDK disables itself; hr-salary-frontend had 0 errors / 0 spans in 90 days. Until the owner fixes the variable
  and redeploys (seven-field task in PROGRESS.md), no frontend event reaches Sentry — this PR's included.
- **Fragile:** page name depends on Header rendering its title in `header h1`. Class component, no router hooks: the path
  reset reads `window.location.pathname` in componentDidUpdate (runs because Layout re-renders with new children).
- **Verified:** `backend/scripts/errorboundary-sentry-check.py` (Chromium, built dist with a fake `.invalid` DSN, hr,
  port 3209, forced crash by swapping the Employees chunk) 36/36 — control: no fallback/no event; crash: title names
  "Employee Master", raw text hidden until details, exactly 1 intercepted Sentry event with message + tags + component
  stack, details shows its event id, Report bug opens "Report an issue", Try again → 2nd event, sidebar to Daily MIS
  clears it, 390 px, 0 page errors, 0 unexpected console errors, 0 API ≥ 400. `--base` on an 80934af4 build 3/3: raw
  message, no Report bug, no event. jest 105/1649 before; 107/1669 after merging origin/main (growth from main), all pass.
- **Not tested:** Railway; real Sentry ingestion (blocked by the DSN variable); Safari/Firefox; a crash in Layout itself.

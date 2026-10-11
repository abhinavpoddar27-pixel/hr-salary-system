# P2-09 — PLAN (Phase 0)

Base origin/main 80934af4 · branch feat/errorboundary-sentry · finding X-4.

## 1. What is there today (read, not guessed)
- `frontend/src/components/ui/ErrorBoundary.jsx` (52 lines): `componentDidCatch` only `console.error`s; the fallback shows
  the RAW `error.message` + "Try Again" / "Reload Page". No Sentry call, no bug report.
- Used in 3 places: `App.jsx` Layout (wraps every page's `<Suspense>{children}`), `FinanceAudit.jsx`, `SessionAnalytics.jsx`.
  `<BugReportButton/>` and `<BugReportModal/>` sit in Layout OUTSIDE the boundary, so they still render after a page crash.
- Sentry IS initialised: `main.jsx` `Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN, … beforeSend scrubs extra/request })`,
  plus an outer `Sentry.ErrorBoundary` around `<App/>`. A page error is caught by the inner boundary first, so the outer one
  never sees it → page crashes never reach Sentry today (confirms X-4).
- Bug reporter: zustand `useAppStore.getState().openBugReportModal()` (appStore.js L99). The modal snapshots its own
  auto-context (path, API ring) on open.

## 2. Production diagnosis (read-only, counts only) — IMPORTANT
- Sentry org `asian-lakto-industries-ltd` (de region), project `hr-salary-frontend`: **0 error events and 0 spans in 90 days.**
  So not only page crashes — NOTHING from the frontend has ever arrived.
- Cause (found in the live bundle `assets/index-BYQkZJMo.js`, key redacted):
  `dsn:"https://<key>@o….ingest.de.sentry.io/<projectId>VITE_SENTRY_ENVIRONMENTproductionVITE_SENTRY_RELEASEVITE_SENTRY_TRACES_SAMPLE_RATE0.2"`
  The Railway variable `VITE_SENTRY_DSN` has the next three variable names/values glued onto its end (a bulk paste that lost
  the line breaks). The project id is no longer all digits → the SDK rejects the DSN and silently disables itself.
- This is a Railway variable, not code. **ErrorBoundary.jsx cannot fix it.** After this PR ships, page crashes will be
  sent the moment the variable is corrected (and the frontend rebuilt). Owner step (GUI): Railway → hr-app service →
  Variables → `VITE_SENTRY_DSN` → value must end at the numeric project id (…sentry.io/<digits>), nothing after; check
  `VITE_SENTRY_ENVIRONMENT` = production as its own row; redeploy (Vite bakes the value at build). No secret goes in chat.

## 3. Smallest change (ErrorBoundary.jsx only)
- `componentDidCatch(error, info)`: `const eventId = Sentry.captureException(error, { tags: { boundary: 'page', page: <path> },
  contexts: { react: { componentStack: info?.componentStack } } })` inside try/catch (reporting must never break the
  fallback); keep the console.error; store `eventId` in state.
- Fallback (plain words, no raw error up front):
  "Something went wrong on <page name>. Your data is safe — nothing was saved by this error." (wording to confirm, Q4)
  Buttons: **Try again** (reset), **Reload page**, **Report bug** → `useAppStore.getState().openBugReportModal()`.
  A "Show details" toggle reveals the raw message + Sentry reference id (if any) in a small monospace box.
- Page name (Q1): needs the Layout `title`. Options below.
- Reset on navigation (Q2): `componentDidUpdate` — if `hasError` and `window.location.pathname` differs from the path
  stored at catch time → clear the error, so clicking another page in the sidebar works without "Try again".
- No new dependency (`@sentry/react` already in package.json). No DSN, no secret.

## 4. Tests / checks
- New `backend/scripts/errorboundary-sentry-check.py` (Chromium, local build, scratch DB, real hr login, port 3209).
  Forced render error with ZERO test code in the app: Playwright `page.route` replaces one lazy page chunk
  (e.g. `assets/Dashboard-*.js`) with `export default function(){ throw new Error('forced test error') }`.
  Local build with a FAKE DSN `VITE_SENTRY_DSN=https://public@o0.ingest.invalid/1` and Playwright intercepting
  `**/api/1/envelope/**` → assert one envelope with the exception "forced test error" + tag boundary=page (Sentry call
  observed without any network/secret). Checks: new screen text + page name, no raw message until "Show details",
  details shows it, Report bug opens the bug modal, Try again re-renders, navigate to another page clears the error,
  390 px, 0 page errors other than the forced one, 0 API ≥ 400. A clean run (no route swap) → no fallback, no envelope.
- `--base` on an origin/main build: raw message shown, no Report bug, no envelope (proves the bug).
- jest (backend) before: **105 suites / 1649 tests** — after: must be identical (frontend-only change).

## 5. Risks
- React prod still `console.error`s a caught render error → the check must whitelist exactly the forced one.
- Sentry `beforeSend` scrubs `extra` but not the exception message; crash messages are code text (no payroll data),
  replay is `maskAllText`. Tags carry only the path, never ids/codes.
- The check DSN is fake (`.invalid` host, intercepted), so nothing leaves the machine.
- Does not cover a crash in Layout/Sidebar/Header itself (outer Sentry boundary in main.jsx, not owned — it already
  reports once the DSN is fixed).

## 6. Questions for the planner
- **Q1 page name.** Best: one-line change in App.jsx `<ErrorBoundary pageName={title}>` (App.jsx not owned). Without it,
  the boundary reads the Header `<h1>` text at render time (Header is outside the boundary, still on screen), falling
  back to "this page". OK to use the h1 read, or may I touch App.jsx (1 line)?
- **Q2** reset the error on route change (componentDidUpdate path check) — yes/no? Today a crashed page stays crashed
  after clicking another sidebar link until Try again.
- **Q3** the bug modal does not receive the error text (modal not owned); I show the Sentry reference id in details so
  the user can type it. Enough?
- **Q4** fallback wording — "Your data is safe — nothing was saved by this error" is true for a render crash; keep or
  drop?
- **Q5** the Railway `VITE_SENTRY_DSN` fix (§2) goes to the owner as a GUI step in the hand-off — confirm it is not part
  of this PR's acceptance (production Sentry count stays 0 until he fixes it).

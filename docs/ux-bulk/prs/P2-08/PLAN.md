# P2-08 — Session-timeout modal + return path; useDraft hook — PLAN
Base origin/main 80934af4 · branch feat/timeout-modal-drafts · port 3208. Findings X-3, U-DR.

## 1. What is there today (read, not assumed)
- `hooks/useInactivityTimeout.js` (mounted once by `InactivityGuard` in App.jsx, inside BrowserRouter): 15 min limit,
  checks every 30 s, one toast at ~13 min ("Move your mouse"), then `clearAuth()` + toast + `window.location.href='/login'`
  (the toast dies with the reload — never seen). Any mousemove resets the timer. Heartbeat every 5 min; heartbeat 401 → same logout.
- `pages/Login.jsx`: always `navigate('/')` after login. No returnTo.
- Other paths to /login (NOT owned): `utils/api.js` 401 interceptor (`location.href='/login'`), `RequireAuth`
  `<Navigate to="/login">` in App.jsx, Header manual logout (`navigate('/login')`).
- No sessionStorage / draft code anywhere. `sessionTracker.js` has its own beforeunload (beacon, no prompt).

## 2. Change (smallest)
### A. `hooks/useInactivityTimeout.js` (rewrite of the timer part; heartbeat kept as is)
- Tick every 1 s (cheap Date.now compare) so the countdown is exact; constants unchanged (15 min / warn at 2 min).
- Returns `{ warningOpen, secondsLeft, staySignedIn }` and renders nothing itself.
- While the warning is open, passive activity (mousemove/scroll/keydown) does NOT dismiss it — only "Stay signed in"
  (or Enter on the focused button) resets the timer and sends one heartbeat. (Q1) Before the warning, activity resets as today.
- Forced logout (`reason: 'idle'` or heartbeat 401 `'expired'`): `saveReturnTo()` → sessionStorage
  `hr_return_to = {path: pathname+search+hash, user: username, reason, at}`, `allowUnload()` (see C), `clearAuth()`,
  `location.href='/login'` (hard reload kept on purpose: wipes in-memory react-query data of the old session).
- Test knob (documented, can only SHORTEN): localStorage `hr_idle_test_ms` / `hr_idle_test_warn_ms`, read at mount,
  clamped to [5 s, 15 min] / [2 s, limit−1 s]; ignored otherwise. Harmless in prod (a user can only shorten their own idle).
- Cross-tab (Q2, proposed): write last activity to localStorage `hr_last_activity` (throttled 5 s) and use the max of
  local + shared, so an idle tab no longer signs out a user who is working in another tab (today it does: clearAuth wipes
  the shared token). Listen to `storage` so the modal closes in tab A when tab B is used.
### B. `SessionTimeoutDialog` — small own dialog (not components/ui/Modal.jsx, P2-01 owns it)
- Rendered from `InactivityGuard` in App.jsx (one-line change there: `const s = useInactivityTimeout(); return <SessionTimeoutDialog {...s}/>`).
  Lives in the hook file as an exported component, or a new `components/SessionTimeoutDialog.jsx` (new file) — I'd use the new file.
- `role="alertdialog"`, aria-modal, aria-live countdown "You'll be signed out in 2:00", focus on "Stay signed in",
  secondary "Sign out now". z-index above app modals/toasts. No Esc-to-dismiss (Esc ≠ consent to stay). 390 px OK.
### C. Return path — `pages/Login.jsx`
- On mount read `hr_return_to`; show a banner "You were signed out after 15 minutes without activity" (idle) /
  "Your session expired" (expired).
- After login: `safeReturnTo(saved)` → navigate there (replace) if path starts with "/" (not "//", not "/login", no
  "://") AND saved.user === logged-in username (Q3); otherwise "/". Remove the key in both cases.
- Also honour `location.state.from` if RequireAuth passes it (needs App.jsx `<Navigate to="/login" state={{from: location}}>`
  — 1 line, Q4) so a deep link opened while signed out returns too.
### D. `hooks/useDraft.js` (new)
- `useDraft(key, initialValue, { userScoped = true })` → `{ value, setValue, dirty, restored, discard, clear, markSaved }`.
  Storage key `hr_draft:<username>:<key>`; JSON in sessionStorage, every read/write in try/catch (blocked storage → in-memory only).
  Restore on mount → `restored = true`. `discard()` → initialValue + remove key; `clear()`/`markSaved()` after a successful
  save → remove key, dirty false. Writes debounced 300 ms; empty/equal-to-initial value removes the key.
- `beforeunload` registered only while dirty; a module flag `allowUnload()` (exported) lets forced logout navigate
  without the "Leave site?" prompt — otherwise the browser prompt would BLOCK the idle logout and keep the page open.
- Exported `<DraftRestoredBanner draft={d}/>` ("Draft restored · Discard"), written with React.createElement (file is .js).
- Not adopted by any page in this PR (P3-01 does).

## 3. Files
Owned: `hooks/useInactivityTimeout.js`, `pages/Login.jsx`, `App.jsx` (InactivityGuard render line; + Q4 one line).
New: `hooks/useDraft.js`, `components/SessionTimeoutDialog.jsx`, `backend/scripts/session-timeout-check.py`,
harness for useDraft (Q5), `docs/ux-bulk/prs/P2-08/*`. Not touched: Modal.jsx, api.js, Header.jsx, appStore.js, backend.

## 4. Tests (Playwright, Chromium, local build, scratch DB, port 3208, fictional users)
1. knob 20 s / warn 10 s: dialog appears ~10 s, countdown decreases, focus on Stay; mousemove does not close it (Q1).
2. Stay → dialog gone, still signed in after the original expiry time, one heartbeat POST.
3. expiry on `/analytics/punctuality?x=1` → /login with idle banner, hr_token gone → log in same user → lands on the same
   path+query. Different user → "/". Tampered `hr_return_to` ("//evil", "https://…", "/login") → "/".
4. Heartbeat 401 (route intercept) → expired banner + returnTo kept.
5. Two tabs (Q2): activity in tab B keeps tab A signed in.
6. useDraft harness: type → reload → value restored + banner; Discard clears; dirty → beforeunload handler present;
   `allowUnload()` → forced logout with no dialog; blocked sessionStorage → no crash.
7. 390 px; 0 page/console errors; no API ≥ 400 except intended. `--base` on an 80934af4 build: no dialog, lands on "/".
jest full suite before/after (frontend has no unit runner; backend unaffected — expect identical counts).

## 5. Risks
- Hard reload on logout stays (security); beforeunload of an adopting page would block it → `allowUnload()` is the guard.
  The api.js 401 redirect has the same problem and does NOT save returnTo (not owned) — Q6.
- 1 s interval: negligible cost; cleared on unmount/logout.
- Cross-tab sharing changes behaviour (an idle tab now stays signed in while another is used) — owner-visible, hence Q2.
- returnTo to a page the user cannot open: same-user check (Q3) makes that a non-issue.

## 6. Questions for the planner
- Q1 While the countdown shows, ignore passive mouse movement (only the button keeps you in)? Proposed yes.
- Q2 Share last-activity across tabs via localStorage? Proposed yes (fixes "idle tab signs out the busy tab").
- Q3 Restore returnTo only for the same username? Proposed yes.
- Q4 One extra line in App.jsx RequireAuth to pass `state.from` (deep link while signed out)? Proposed yes.
- Q5 useDraft harness: no app route is added. Proposed: a standalone harness (own index.html + tiny vite config under
  `backend/scripts/p2-08-harness/`, built to a scratch dir by the check script) that imports `frontend/src/hooks/useDraft.js`.
  Alternative: a DEV-only route in App.jsx. Which?
- Q6 api.js 401 interceptor (not owned): leave as is (no returnTo, would hit an adopting page's beforeunload prompt), or may I
  add 2 lines there (saveReturnTo + allowUnload)? Otherwise list as follow-up for P2-01/P3-01 owner.
- Q7 New file `components/SessionTimeoutDialog.jsx` OK (vs. putting the component in the hook file)?

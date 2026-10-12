# P2-02 PROGRESS

## RESUME
Branch fix/toast-dedup, worktree /home/claude/wt-p2-02, port 3404. Read PLAN.md. Never redo a ticked step.

## Steps
- [x] Phase 0: read interceptor, main.jsx Toaster/QueryClient, survey 209 toast.error calls in 52 files; PLAN.md written
- [x] Planner go + rulings Q1–Q3
- [x] jest baseline (full, flock): 115 suites / 2040 tests
- [x] toastDedup.js + interceptor change (api.js: import line + interceptor line; unused toast import removed)
- [x] unit check 10/10
- [x] build (flock) + browser check 29/29 (3 clean runs) + --base on 8abee969 26/26 (doubles reproduced)
- [x] self-debug (login limiter → one login reused; retry timing → poll max toasts at once), user sim, v2 (state on the toast object so a Vite HMR copy shares it)
- [x] merge origin/main (already up to date at 8abee969), jest 115/2040 after, push, verify ls-remote

## Rulings
Q1 page text wins. Q2 1500 ms. Q3 remove unused toast import (done — nothing else in api.js used it). Verify R4 timer in browser check.

## CLAUDE.md entry
## Last Session — 2026-10-12 (P2-02: one API failure, one error toast)
**Branch `fix/toast-dedup`, NOT merged.** Frontend only. Plan + log: `docs/ux-bulk/prs/P2-02/PLAN.md`, `PROGRESS.md`.
Finding X-17. Rulings Q1 page text wins, Q2 1500 ms window, Q3 unused toast import removed from api.js.
- **Bug:** the api.js response interceptor toasted every non-401 error AND most pages toast again in onError/catch
  (52 files, 209 `toast.error` calls) → two toasts per failure (two different texts for blob downloads, e.g. the
  axios "Request failed with status code 500" + "Download failed"); a failing react-query query with retry 1 toasted twice.
- **Fix (zero page edits):** new `utils/toastDedup.js`. The interceptor calls `apiErrorToast(msg)` → toast id
  `api-error:<msg>` (a repeat of the same failure updates it in place). `toast.error` is wrapped once: a call with no
  id of its own within 1500 ms of the last unclaimed API error toast reuses that id → the page's text replaces the
  interceptor's in the SAME toast (one-shot claim). Calls with an id, or outside the window, are unchanged.
  api.js: import line + the interceptor line only.
- **Fragile:** (1) a page's non-API `toast.error` within 1.5 s of an unrelated background API failure replaces that
  failure's toast. (2) Promise.all of several DIFFERENT failures: the page toast claims only the last one. (3) To opt
  out of the dedup, pass `{ id }`. (4) State lives on `toast.__p202State` (shared across HMR copies). (5) The replaced
  toast's timer restarts from the page call (react-hot-toast upsert), so it is never shortened.
- **Verified:** `node backend/scripts/toast-dedup-unit-check.mjs` 10/10 (fake toast + clock).
  `backend/scripts/toast-dedup-check.py` (Chromium, built dist, scratch DB, one real hr login reused, failures forced
  with page.route, port 3404) 29/29 ×3 — Stage 6 Run 409/403/500 → 1 toast; toast still visible 3.5 s later and gone
  by 7.5 s; Stage 3 shifts query 500 with retry → 2 requests, 1 toast; network error → 1 ("Calculation failed");
  401 → /login, only the session-expired notice; Reports leave-register blob download 500 → 1 "Download failed";
  two different failures 2 s apart → 2; Sales TA/DA upload 400 with row errors → row in the result table + 1 summary
  toast; validation-only toast → 1; 390 px → 1; 0 page errors. `--base` on an 8abee969 build 26/26: 2 toasts in every
  API case (4 for the two-failures case). jest 115/2040 before and after (no backend change).
- **Not tested:** Railway; Safari/Firefox; every one of the 52 toasting files individually (the mechanism is global).

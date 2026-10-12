# P2-02 — one failure, one error toast (finding X-17)

Branch `fix/toast-dedup` on origin/main 8abee969 · port 3404 · Phase 0 (plan only).

## 1. What is wrong (FACT, read in code)
- `frontend/src/utils/api.js` response interceptor (L25–49): every non-401 error → `toast.error(msg)` where
  `msg = err.response.data.error || err.message`.
- 52 files call `toast.error` (209 calls). Most mutation `onError`s and `try/catch`es around API calls toast again,
  usually with the same text (`err.response?.data?.error || 'X failed'`) → **two identical toasts** for one failure.
  Where the page uses its own text (blob downloads "Download failed", Sales TA/DA "Already resolved by someone else",
  "N parser error(s) — see below") the user sees **two different toasts** (the interceptor one is usually the generic
  axios "Request failed with status code 500").
- A second source: react-query `retry: 1` (main.jsx) — a failing QUERY makes two requests → the interceptor toasts
  twice (same text, two toasts).
- 401: interceptor does not toast, redirects to /login (P2-08 banner there). Pages with onError may still toast once.

## 2. Chosen approach — ZERO page edits
New `frontend/src/utils/toastDedup.js` (self-contained, ~40 lines):
- `apiErrorToast(msg)` — used by the interceptor instead of `toast.error(msg)`. Shows the toast with a fixed id
  `api-error:<msg>` (react-hot-toast 2.6: same id = update in place, not a second toast → the retry duplicate and a
  burst of identical failures collapse to one). Records `{ id, at }` as the "last API error toast".
- `installToastDedup()` (runs once when the module is first imported) wraps `toast.error`: a call WITHOUT its own
  `id`, made within **1500 ms** of the last API error toast that nobody has claimed yet, reuses that toast's id →
  the page's message REPLACES the interceptor's text in the same toast (page text wins: it is the one the page author
  chose — 409 "already resolved", "see below", "Download failed"). The claim is one-shot (cleared after use).
  Calls with their own `id`, and every call outside the window, behave exactly as today.
- Net: an API failure shows exactly one toast — the page's text when the page handles it, else the server's text.

Why not the alternatives:
- "Interceptor skips when the request opts out" needs a flag on ~150 call sites / helpers → many page or api.js hunks.
- "`err.__toasted` marker" — pages never read it; would need page edits to honour it.
- Removing page toasts — 52 files, most owned by other builders.

## 3. Files touched
| File | Change |
|---|---|
| `frontend/src/utils/toastDedup.js` | NEW — `apiErrorToast`, `installToastDedup`, `__resetToastDedupForTest` |
| `frontend/src/utils/api.js` | 1 import line + interceptor `toast.error(msg)` → `apiErrorToast(msg)`. The existing `import toast` becomes unused there; left as is unless the planner wants it removed (keeps the diff to the interceptor). |
| `frontend/src/main.jsx` | NOT touched (api.js is imported before any page renders, and the module self-installs). |
| `backend/scripts/toast-dedup-check.py` | NEW browser check (+ `--base`) |
| `backend/scripts/toast-dedup-unit-check.mjs` | NEW node check of the helper with a fake toast (window, one-shot claim, id pass-through) |
| `docs/ux-bulk/prs/P2-02/*` | plan + log |
No page file, no backend app file, no DO-NOT-MODIFY file.

## 4. Tests
- Unit (`node backend/scripts/toast-dedup-unit-check.mjs`, injected fake clock + fake toast): claim inside window,
  no claim after window, one-shot claim, caller `id` passes through untouched, options (duration) kept, identical
  API messages share one id.
- Browser (`toast-dedup-check.py`, Chromium, built dist, scratch DB, real hr/finance logins, fictional T96xx data,
  port 3404, `page.route` to force the failure; toasts counted as `[role=status]` inside the Toaster):
  1. mutation with page onError — forced 409, 403, 500 → exactly 1 toast, page text.
  2. query with no onError — forced 500 → 1 toast with server text (retry duplicate collapsed).
  3. network error (`route.abort`) on a mutation → 1 toast.
  4. 401 on an API call → redirected to /login, 0 error toasts left on the old page, login banner shown.
  5. blob download failure (Reports "Download failed") → 1 toast, page text.
  6. validation-only toast (no API call) → 1 toast; two separate failures 3 s apart → 2 toasts (no over-merge).
  7. bulk preview with row errors (Sales TA/DA upload 400 `errors[]`) → rows in the table, 1 summary toast.
  8. 390 px, 0 page errors.
  `--base` on an 8abee969 build: case 1 shows 2 toasts, case 2 shows 2, case 5 shows 2 different texts.
- jest full suite before/after (no backend change expected → same counts). `flock` for the build + full jest.

## 5. Risks
- R1 (accepted by design): a page's NON-API `toast.error` (e.g. a validation message) fired within 1.5 s of an
  unrelated background API failure replaces that failure's toast. Needs two events in 1.5 s; the replaced one was a
  background error. Window can be narrowed (e.g. 800 ms) if the planner prefers — react-query onError and catch blocks
  fire within a few ms of the rejection.
- R2: Promise.all of several DIFFERENT failures → the page toast claims only the last one; the others still show
  (each different failure keeps its own toast — today there are N+1).
- R3: global monkey-patch of `toast.error` — guarded (installs once, marks the wrapper). Anyone later passing an `id`
  opts out automatically.
- R4: the replaced toast keeps its position; react-hot-toast updates text in place (no flash expected; verify the
  timer is not shortened — check in the browser test).
- R5: non-axios `fetch` callers (14 in .jsx) never hit the interceptor → unaffected, still one toast.

## 6. Questions for the planner
- Q1: page text wins over server text when both exist (my default) — OK? Alternative: keep the interceptor's text,
  drop the page's (loses "see below" / 409 wording and keeps generic axios text for blob errors).
- Q2: window 1500 ms OK, or narrower?
- Q3: remove the now-unused `import toast` in api.js (1 more line outside the interceptor) — yes/no?

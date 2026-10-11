# N-FRESH — PLAN (Phase 0)
Base origin/main c942563f · branch fix/fresh-reads-after-actions · port 3133 · findings N-7, N-9, N-15.

## 1. What the code does today (read, not guessed)
- `backend/server.js` L146: every `/api` GET answers `Cache-Control: private, max-age=5`.
- `frontend/src/utils/api.js`: `const fresh = { headers: { 'Cache-Control': 'no-cache' } }` (L159, read at call time —
  helpers above it already use it, e.g. getAttendanceRegister L74). Without it:
  - L65 `getMissPunches` — no `fresh`. Callers: MissPunch.jsx L105, Dashboard.jsx L89/L131 (read-only; extra no-cache is harmless).
  - L68 `getNightShifts` — no `fresh`. Caller: NightShift.jsx L36 only.
  - L102 `getDayCalculations` — no `fresh`. Caller: DayCalculation.jsx L53 only.
- React Query v5 (`^5.25.0`), global `staleTime: 30000`, `refetchOnWindowFocus: false` (main.jsx L74–75).
- After an action each page calls only `refetch()` of the CURRENT query:
  - MissPunch.jsx: resolve / bulk / finance approve / finance reject → `refetch()` (key
    `['miss-punches', month, year, dept, type, state, company]`). Other status chips stay cached up to 30 s.
    `refetch()` inside the 5 s window gets the browser's pre-action copy → row still shows old state (N-9).
  - NightShift.jsx: confirm / reject → `refetch()` only. Reject also sends the IN day back to Miss Punches
    (MISSING_OUT), but `['miss-punches']` is not invalidated (N-9, F-e from P1-10).
  - DayCalculation.jsx calcMutation → `refetch()` + `invalidateQueries(['org-overview'])` +
    `invalidateQueries(['day-calc-staleness'])` (N-7: register shows pre-run rows up to 5 s).
    Note: in v5 the bare-array form is read as a filters object with no `queryKey`, i.e. it invalidates EVERY
    query — works by accident, broad.
- N-15: MissPunch.jsx L149–154 runs `getLeaveAutomationStatus({ year })` (refetchInterval 30 s) for every role;
  route `GET /features/leave-automation/status` is `requireHrOrAdmin` (phase5.js L614) → finance/viewer get 403 +
  console error on load and every 30 s. The only consumer is the auto-Stage-6 banner (L251+), meaningful to HR/admin.

## 2. Smallest change (owned files only)
1. `utils/api.js` (3 lines + 1 comment each, nothing else in the file):
   - `getMissPunches = (params) => api.get('/attendance/miss-punches', { params, ...fresh })`
   - `getNightShifts  = (params) => api.get('/attendance/night-shifts', { params, ...fresh })`
   - `getDayCalculations = (params) => api.get('/payroll/day-calculations', { params, ...fresh })`
2. `pages/MissPunch.jsx`
   - autoStatus query: `enabled: canHR` (canHR = hr/admin, same gate as the route). Finance/viewer → no call.
   - All 4 mutations: replace bare `refetch()` with `queryClient.invalidateQueries({ queryKey: ['miss-punches'] })`
     (prefix → current chip refetches now, every other chip/dept/type refetches when shown). Keep `afterResolve()`.
     Finance approve/reject also invalidate `['day-calculations']` (Stage 6 becomes stale) — Q2.
3. `pages/NightShift.jsx` (invalidation only)
   - confirm: `invalidateQueries({ queryKey: ['night-shifts'] })`.
   - reject: same + `invalidateQueries({ queryKey: ['miss-punches'] })` (the record moved there).
4. `pages/DayCalculation.jsx` calcMutation onSuccess
   - `invalidateQueries({ queryKey: ['day-calculations'] })` (all company views) instead of bare `refetch()`;
     convert `['org-overview']` / `['day-calc-staleness']` to the `{ queryKey }` form (scoped, not "everything") — Q3.

No backend change. No other file.

## 3. Tests / verification
- New `backend/scripts/fresh-reads-check.py` (Chromium, local build, scratch DB, port 3133, real hr + finance
  logins, fictional codes T98xx). Cases:
  A. Stage 6: load register (row X days = N), alter attendance in DB, click Run, assert list shows new value
     within < 5 s of the first load (no reload).
  B. Miss Punch hr: resolve a row on "All" < 5 s after load → row shows resolved immediately; switch to
     Finance Pending chip → row present (chip opened before the action, so it was cached).
  C. Miss Punch finance: approve on Finance Pending → row gone; Approved chip (opened earlier) shows it.
  D. Night Shift: confirm < 5 s after load → Confirmed; reject → Rejected; Miss Punch page then lists the
     MISSING_OUT row without reload.
  E. Finance opens Miss Punch: 0 console errors, 0 API ≥ 400, no request to leave-automation/status; hr still
     sees the auto-Stage-6 banner call (200).
  F. 390 px smoke, 0 page errors.
  `--base` on an origin/main c942563f worktree build: A/B/C/D show the stale value, E shows the 403.
- Request-header assertion: the three GETs carry `Cache-Control: no-cache`.
- jest full suite before/after (frontend-only change; expect identical counts).

## 4. Risks
- `fresh` adds a server hit on every read of those three lists (Dashboard included) — same trade the loans/leave
  reads already make; lists are small (one month).
- Invalidating the prefix refetches only ACTIVE queries now; inactive ones on next mount — no request storm.
- Finance loses nothing: the banner never loaded for them (403).
- `getDayCalcStaleness` (not owned) still lacks `fresh`, so the Stage 6 stale banner can lag ≤ 5 s after Run.

## 5. Questions for the planner
- Q1: `getDayCalcStaleness` (api.js L152) has the same gap and feeds the banner right next to Run. Not in my owned
  helper list — may I add `fresh` to it too (1 line), or leave it as a finding?
- Q2: finance approve/reject on Miss Punch — also invalidate `['day-calculations']` (like HR resolve does)? I propose yes.
- Q3: OK to convert DayCalculation's two bare-array `invalidateQueries([...])` calls to `{ queryKey }` form? Today they
  invalidate every cached query (v5 semantics); scoping is the intent but slightly changes behaviour (e.g. any
  other cached query would no longer be refetched after Run). I propose yes, plus `['salary-stale']`-style keys are
  not touched.
- Q4: leave-automation gate — `canHR` (hr/admin) matches the route exactly. Confirm viewer/supervisor also skip (yes by this rule).

# P1-09 — Miss Punch "all resolved" banner — PLAN (Phase 0)
Base origin/main 3d20021 · Branch `fix/misspunch-all-resolved-banner` · Finding P-5 · Frontend only.

## What the code does today (read, not assumed)
- `pages/MissPunch.jsx` L102–113: ONE query `GET /attendance/miss-punches?month&year&department&state&company`
  returns both the rows (`res.data.data`, filtered by the `state` chip + department) and `res.data.summary`.
  `filterType` / `filterDate` are applied client-side to the rows only.
- L216–218: `pendingCount` / `resolvedCount` / `progress` count `records` = the CURRENT filter slice.
- L581: the green "All miss punches resolved! Proceed to Stage 3" card renders when
  `pendingCount === 0 && records.length > 0`. On the **Approved** (or Rejected-and-re-resolved, or Finance Pending)
  chip every row has `miss_punch_resolved = 1` → pendingCount 0 → banner shows while HR/finance still have work. (Bug P-5.)
- Backend `routes/attendance.js` L84–131: `summary` is computed over the whole month **ignoring `state`** but
  **respecting `department` and `company`**. Buckets: `hrPending` (resolved=0 and not rejected), `financePending`
  (resolved=1, status null/''/pending), `approved`, `rejected`; plus legacy `pending` = count(resolved = 0).

## Catch found in Phase 0 (deviation from the prompt's formula — needs planner OK)
A finance REJECT (`financeAudit.js` ~L1972) sets `miss_punch_resolved = 0` AND `miss_punch_finance_status = 'rejected'`.
`classify()` puts that row in `rejected`, NOT `hrPending` — yet it is back in the HR queue (the `hr-pending` chip
filter is `resolved = 0`, and `leaveTriggers.missPunchBacklog` counts it as `awaitingHr`). HR re-resolve sets the
status back to `'pending'` (`services/missPunch.js` L119).
So the prompt's `hrPending + financePending === 0` would show "all resolved" while rejected rows wait for HR.
**Proposed rule uses `summary.pending` (= every resolved=0 row, rejected included) instead of `hrPending`** — it is
exactly the Stage-6 backlog definition (`awaitingHr + awaitingFinance`).

## Change (one file: `frontend/src/pages/MissPunch.jsx`)
```js
const { data: res, isLoading, isError, refetch } = useQuery(...)        // + isError (already-used hook, no new call)
const summaryLoaded = !!res?.data?.summary && !isError
const outstanding = (summary.pending || 0) + (summary.financePending || 0)
const allDone = summaryLoaded && (summary.total || 0) > 0 && outstanding === 0 && !filterDept
```
- Banner condition L581 → `allDone`.
- `!filterDept`: the summary is department-scoped, and "Proceed to Stage 3" is a month-level claim; with a
  department filter we hide the card rather than claim the month is done (see Q2).
- While the query refetches after a chip change `res` is undefined (no keepPreviousData) → summary {} → no banner;
  on error (`retry: 0`) → no banner.
- `pendingCount` stays (still drives nothing else? — it is only used by the banner; it will be removed if unused
  after the edit, otherwise left). `resolvedCount`/`progress` "X of Y resolved" stay filter-based (prompt allows);
  they never say "all done". Not touching L417 stray "0" (P1-24).

## Verify
- New `backend/scripts/misspunch-banner-check.py` (pattern of salary-register-report-check.py; port 3109, scratch
  DATA_DIR, built dist, real hr + finance logins, PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers). Fictional month
  Sep 2026, codes T97xx, "TEST EMP n": 2 HR-pending + 1 finance-pending + 3 approved (+ 1 rejected-awaiting-HR
  for the edge case). Checks:
  1. All chip: no banner. 2. Approved chip: no banner (the bug). 3. Finance Pending chip: no banner.
  4. Rejected-only outstanding (resolve/approve the rest, leave 1 rejected): no banner on any chip.
  5. Everything resolved + approved (via the real UI/API with hr then finance login): banner shows on All AND on
     the Approved chip. 6. Department filter set: no banner. 7. Summary route intercepted → 500: no banner.
  8. 0 page errors, 0 console errors, 0 API ≥ 400 (except the deliberate 500).
  `--base` (APP_ROOT = a 3d20021 build): records the banner wrongly shown on the Approved chip.
- jest full suite before/after: baseline **85 suites / 1380 tests** (Phase 0, 10 Oct).
- `npm run build --prefix frontend`; dist in its own commit.

## Questions for the planner
- Q1: OK to use `summary.pending + summary.financePending` (includes finance-rejected rows awaiting HR) instead of
  `hrPending + financePending`? Recommended — otherwise the bug survives for rejected rows.
- Q2: With a department filter active, hide the banner (proposed) or show it scoped ("all resolved in this
  department")? Hiding is the smaller, safer change.
- Q3: Progress label "X of Y resolved" on a filtered chip (e.g. Approved → "3 of 3 resolved", 100 % bar) — leave
  as is (prompt allows) or add "(this filter)"? Proposed: leave, out of scope.

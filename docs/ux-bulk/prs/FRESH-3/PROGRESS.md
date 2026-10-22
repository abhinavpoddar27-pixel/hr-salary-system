# FRESH-3 — PROGRESS

## State
Phases 1–3 are done. Built, verified and pushed. No PR opened, as ruled.

## Rulings (planner, 22 Oct 2026)
Q1 yes · Q1b yes · Q2 yes · Q3 salary window refreshes the detail only (`['employee-detail', code]`) · Q4 yes · Q5 yes ·
Q5b leave it, put it on the register (below) · Q6 yes (`fresh` on getEmployees) · Q7 yes.

## Done
- 18 bare-array calls changed to `invalidateQueries({ queryKey: [...] })`, each keeping the same prefix.
  0 left in frontend/src.
- Keys added by ruling:
  - Employee edit: `['departments']`, `['employee-detail', code]`.
  - Bulk shift: `['employee-detail']`.
  - Import add-to-master and dept fix: `['employees']`, `['departments']`.
  - Detect inactive: `['attrition']`.
- **Found in build:** the row drill-down on Employee Master is `EmployeeQuickView`. Its key is `['employee-quick', code]`
  (staleTime 120 s), not `employee-detail`. Before this PR it was refreshed only by accident. To meet the intent of Q1/Q2
  ("open drill-down shows the edit"), the edit also invalidates `['employee-quick', code]` and bulk shift invalidates the
  `['employee-quick']` prefix. Both are in Employees.jsx, which this PR owns.
- `fresh` (no-cache) added to these api.js helpers: getUsers, getEmployees, getEmployee, getDepartments, getOrgOverview,
  getHeadcountTrend, getAttritionData, getInactiveEmployees, getImportReconciliation, getShifts, getHolidays,
  getPolicyConfig, getComplianceItems.
- New check script `backend/scripts/fresh3-check.py`, port 3501.

## Verified
- `fresh3-check.py` fix mode: 48/48, run three times.
- `--base` on a b2badcab build: 23/23. Every action fires unrelated GETs, and a holiday added < 5 s after load does not
  show (the read is served from the browser cache). The fix-mode checks would fail on base.
- Regression scripts: fresh-reads 39/39, finance-audit-fresh 38/38, employee-edit-gross-guard 16/16.
- jest full suite: 130 suites, 2309 tests, all pass (no backend change).
- vite build clean.

## Register (not fixed)
- **Q5b:** WorkforceAnalytics `reactivateMutation` only calls `refetchInactive()`. It does not refresh org-overview,
  headcount-trend or attrition.
- **Holiday removal:** Settings → Holidays → Remove on a **National** holiday always fails with 400 "Reason required to
  delete a national holiday". The page sends no reason. This bug was there before this PR.
- **Detect inactive toast:** the page reads `res.data.markedInactive`, but `POST /analytics/detect-inactive` returns
  `markedLeft`. So the toast always says "Detected 0 inactive employees". This bug was there before this PR.

## RESUME
Worktree /home/claude/wt-fresh3 · branch fix/fresh3-prefix-invalidation · port 3501.
Done; next step is planner review / PR.

## CLAUDE.md entry
## Last Session — 2026-10-22 (FRESH-3: last 18 bare-array invalidations → prefix filters; fresh on the reads they refresh)
**Branch `fix/fresh3-prefix-invalidation`, NOT merged.** Frontend only. Plan + log: `docs/ux-bulk/prs/FRESH-3/PLAN.md`, `PROGRESS.md`.
Rulings Q1–Q7 (22 Oct).
- **Bug:** TanStack Query v5 reads `invalidateQueries(['x'])` as "invalidate everything". After every save on Settings
  (shifts, holidays, policy, users), Employees (salary window, edit, bulk shift), Compliance, Finance Verification bulk
  verify, Import reconciliation and Workforce detect-inactive, every active query refetched. Those refetches fell inside the
  server's 5 s browser cache, so the changed list could still show the old copy (a new holiday did not appear).
- **Fix:** all 18 calls → `{ queryKey: [prefix] }`. Extra keys:
  - Employee edit: departments, employee-detail and employee-quick (the row drill-down).
  - Bulk shift: employee-detail and employee-quick prefixes.
  - Import: employees and departments.
  - Detect inactive: attrition.
  - 13 api.js read helpers send `fresh`.
  - 0 bare-array calls remain in frontend/src.
- **Fragile:** the Employee Master drill-down key is `['employee-quick', code]` (EmployeeQuickView, staleTime 120 s), not
  `employee-detail`. A new write that changes what it shows must invalidate it. `getEmployees` / `getEmployee` are now
  no-cache for every page (ETag → 304 when unchanged).
- **Verified:**
  - `backend/scripts/fresh3-check.py` (Chromium, built dist, scratch DB, admin/hr/finance, fictional T95xx, port 3501)
    48/48 ×3: each action re-reads its list with no-cache, the change shows at once inside the 5 s window, no unrelated GET,
    Employee Master current after Import add-to-master, Headcount tab re-reads after detect-inactive, 390 px,
    0 page errors, 0 API ≥ 400.
  - `--base` on b2badcab 23/23: unrelated GETs on every action; a new holiday is not shown.
  - Regression scripts: fresh-reads 39/39, finance-audit-fresh 38/38, employee-edit-gross-guard 16/16.
  - jest 130/2309 (no backend change).
- **Not tested:** Railway; Safari/Firefox (`no-cache` request header); the salary-window save path in the browser (one-line
  conversion, read in code).
- **Found, not fixed:** (1) Remove on a National holiday → 400 (the UI sends no reason). (2) The detect-inactive toast reads
  `markedInactive`, but the route returns `markedLeft`, so it always says 0. (3) Reactivate does not refresh
  overview/headcount/attrition.

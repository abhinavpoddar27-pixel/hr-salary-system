# FRESH-2 PROGRESS

## RESUME
Branch fix/finance-audit-fresh-reads (base 892f7f73), worktree /home/claude/wt-fresh2 (node_modules symlinked to
hr-salary-system), port 3503. Read PLAN.md + this file. State: BUILD DONE, verified, pushed. Nothing open on this branch.

## Planner rulings (17 Oct 2026)
- Q1 yes: day correction also refreshes correction-history, corrections-summary, salary-manual-flags, readiness.
- Q2 yes: FinanceEarlyExitApprovals approve/reject refresh early-exit-finance-pending + readiness (mutation onSuccess lines ONLY);
  comp-off mutations add readiness.
- Q3 no: the 18 bare-array calls in other pages -> registered as FRESH-3 (below).
- Q4 getVarianceReport / getStatutoryCrosscheck stay without fresh. Q5 no staleTime changes.
- COLLISION: builder E (STAGE-BTN) edits FinanceAudit.jsx + FinanceEarlyExitApprovals.jsx (button render conditions, comp-off
  badge `enabled`). Keep hunks to mutation onSuccess blocks + api.js; no reformat / import reorder / moves.

## Register (FRESH-3, not fixed here)
Bare-array invalidateQueries([...]) on 892f7f73: Settings 7, Employees 3, Compliance 2, FinanceVerification 2, Import 2,
WorkforceAnalytics 2 (18). v5 treats each as invalidate + refetch every active query.

## Steps
- [x] P0 re-count: 10 reads without `fresh` confirmed; 18 bare-array calls in FinanceAudit.jsx (not 16), 0 in imported
      components; TanStack 5.90.20 source read — bare array = invalidate + refetch EVERYTHING active
- [x] P0 PLAN.md (map of every invalidation → key), prod counts
- [x] B1 api.js `...fresh` on 10 helpers
- [x] B2 FinanceAudit.jsx 18 calls → `{ queryKey }` (+ readiness on comp-off; Q1 extras on corrMutation)
- [x] B3 (Q2) FinanceEarlyExitApprovals.jsx approve/reject onSuccess + early-exit-finance-pending + readiness
- [x] B4 `backend/scripts/finance-audit-fresh-check.py` 38/38; --base 13/13; fix checks against 892f7f73 → 20 fail;
      regression manual-flags-fresh 20/20, finance-audit-readiness 31/31, interventions-reject-all 56/56, fresh-reads 39/39;
      jest 125 suites / 2230; vite build OK

## CLAUDE.md entry
## Last Session — 2026-10-17 (FRESH-2: Finance Audit reads no-cache; decisions refresh exactly what they change)
**Branch `fix/finance-audit-fresh-reads`, NOT merged.** Frontend only (`utils/api.js` 10 reads, `pages/FinanceAudit.jsx`
mutation onSuccess lines, `components/FinanceEarlyExitApprovals.jsx` 2 onSuccess blocks). Plan + log:
`docs/ux-bulk/prs/FRESH-2/PLAN.md`, `PROGRESS.md`. Register item from FRESH (#170). Rulings Q1–Q5 (17 Oct).
- **Before:** 10 Finance Audit reads had no `fresh` (server GET max-age=5 → a refetch inside 5 s got the old copy); 18
  bare-array `invalidateQueries([...])` calls — TanStack 5.90.20 reads an array as an empty filter → invalidates and refetches
  EVERY active query (companies, every tab badge, …); day correction refreshed only the report; Early Exit approve/reject
  left the page badge (60 s staleTime) and Readiness stale.
- **Now:** getFinanceReport, getCorrectionHistory, getCorrectionsSummary, getSalaryManualFlags, getReadinessCheck,
  getFinancePendingDeductions, getEarlyExitPendingFinance, getEarlyExitDeductions, getCompOffPending, getCompOffList send
  `fresh` (Dashboard + Leave Management callers get no-cache too — harmless). All 18 calls are `{ queryKey: [prefix] }`;
  comp-off review/bulk also hit `readiness`; day correction also hits `correction-history`, `corrections-summary`,
  `salary-manual-flags`, `readiness`; Early Exit approve/reject also hit `early-exit-finance-pending`, `readiness`.
- **Fragile:** bare arrays used to refresh everything by accident — any new mutation must name every key it changes
  (Readiness counts flags, punch/day corrections, late, early exit, comp-off, leave requests, salary rows).
  getVarianceReport / getStatutoryCrosscheck deliberately stay cached (Q4).
- **Verified:** `backend/scripts/finance-audit-fresh-check.py` (Chromium, built dist, scratch DB, finance/admin/hr, fictional
  T960x, port 3503) 38/38 — every one of the 10 reads no-cache, approve on Interventions/Late re-reads only its own lists
  (no /settings/companies etc.), badges drop at once (incl. Early Exit page badge), Readiness re-read after comp-off, day
  correction shows Correction History + Interventions badge without reload, 390 px, 0 page errors, 0 API ≥ 400;
  `--base` on 892f7f73 13/13 (stale behaviour recorded) and the fix checks on 892f7f73 fail 20. Regression manual-flags-fresh
  20/20, finance-audit-readiness 31/31, interventions-reject-all 56/56, fresh-reads 39/39. jest 125/2230 (no backend change).
- **Not tested:** Railway; Safari/Firefox (`no-cache` request header).
- **Register (FRESH-3):** 18 bare-array calls in other pages (Settings 7, Employees 3, Compliance 2, FinanceVerification 2,
  Import 2, WorkforceAnalytics 2).

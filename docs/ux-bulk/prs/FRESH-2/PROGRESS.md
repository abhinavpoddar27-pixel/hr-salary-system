# FRESH-2 PROGRESS

## RESUME
Branch fix/finance-audit-fresh-reads (base 892f7f73), worktree /home/claude/wt-fresh2 (node_modules symlinked to
hr-salary-system), port 3503. Read PLAN.md + this file. State: GO received (rulings below). Phase 1 build in progress.

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
- [ ] B1 api.js `...fresh` on 10 helpers
- [ ] B2 FinanceAudit.jsx 18 calls → `{ queryKey }` (+ readiness on comp-off; Q1 extras)
- [ ] B3 (Q2) FinanceEarlyExitApprovals.jsx badge + readiness
- [ ] B4 check script + --base, regression scripts, jest, build; push

## CLAUDE.md entry
(written at hand-off)

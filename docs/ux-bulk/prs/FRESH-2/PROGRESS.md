# FRESH-2 PROGRESS

## RESUME
Branch fix/finance-audit-fresh-reads (base 892f7f73), worktree /home/claude/wt-fresh2 (node_modules symlinked to
hr-salary-system), port 3503. Read PLAN.md + this file. State: PHASE 0 DONE — PLAN.md pushed, waiting for planner "go"
and rulings Q1–Q5. No code written.

## Planner rulings
(none yet)

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

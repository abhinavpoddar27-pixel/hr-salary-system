# N-13 — PROGRESS

## State
Phase 0 done (plan only, no code). Waiting for planner rulings on PLAN.md Q1–Q10.

## Done
- Re-grepped POST /employees (employees.js:290), bulk-import (:1065), PUT /:code, PUT /:code/salary, salary-input.js
  approve/reject, Finance Verification tabs (P5-01 "Bulk batches" last), statusMap, permissions.
- Production read-only counts (HR SQL Console) — see PLAN §2. Key: create-path structures ever = 0; 49/49 recent
  joiners finance-approved; POST /employees used 14×, bulk-import 1× (Mar 2026).
- PLAN.md written.

## Next
- On "go": schema helper → service → routes + mount → POST /employees hook → jest → FV tab + queue → check script.

## Rulings
(none yet)

## RESUME
Branch feat/n13-new-salary-review off 892f7f73, worktree /home/claude/wt-n13, port 3502. Read PLAN.md §3–§8,
then the planner's rulings (add them above). Stage files by name; never touch schema.js / salaryComputation.js /
payroll.js / salary-input.js.

## CLAUDE.md entry
(filled at hand-off)

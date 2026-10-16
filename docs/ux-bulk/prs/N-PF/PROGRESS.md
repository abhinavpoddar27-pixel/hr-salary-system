# N-PF — PROGRESS (branch fix/pf-ceiling-approval)

## RESUME
Read PLAN.md + this file, then `git log --oneline origin/main..HEAD`. Port 3502. Then continue at "Next".

## Rulings (planner, 16 Oct 2026)
- Q1 governance only; salaryComputation.js NOT touched (planner registers "Stage 7 ignores per-employee ceiling").
- Q2 moneyPermissionBatch4.test.js l.157 flipped to expect a pending request (changed on purpose).
- Q3 SalaryInput.jsx shared with F151 (different hunk) — OK.
- Q4 no audit_log row on ceiling approval; the request records it.
- F151-Q2: F-6 MOVED here — `alreadyPending: true` in the employees.js "already pending" reply + Employees.jsx toast reads it
  (tight hunk; builder C edits elsewhere in that file).

## Done
0. Phase 0 plan — fea1cb6

## Next
1. employees.js PUT /:code/salary (ceiling → request; alreadyPending flag)

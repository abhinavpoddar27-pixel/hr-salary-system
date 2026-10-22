# N-PF-LOWS — PROGRESS (branch fix/pf-ceiling-input-checks, from main b2badcab)

## RESUME
Read PLAN.md + this file, then `git log --oneline origin/main..HEAD`. State: PHASE 1 code written (step 1), tests next.
Port 3504. Worktree /home/claude/wt-npf-lows (node_modules symlinks — stage by name). No PR (planner opens it).

## Rulings (planner, 22 Oct 2026)
- Q1 PF_CEILING_MAX = ₹1,00,000. Q3 a ceiling of 0 is refused (PF off = statutory flag).
- Q2 text in a number field → 400 NOT_A_NUMBER. `moneyPermissionBatch4.test.js` pin "unreadable text keeps the stored
  value" changed ON PURPOSE to expect 400 NOT_A_NUMBER.
- Q4 gross text → 400 NOT_A_NUMBER, negative → 400 GROSS_OUT_OF_RANGE. Q5 gross blank/0 + changed split/ceiling → 400
  GROSS_REQUIRED, whole save refused, nothing written.
- Q6 register (not fixed): split adds up to more than the gross (1 active latest row); basic+hra+da > 100 on 17 rows.
- Q7 already pending: bank/IDs still saved, reply `notSaved: true` + message says so.
- Q8 request-change reuses `raiseSalaryChangeRequest` (one Pending per employee). Q9 min/max on the ceiling input.

## Done
0. Phase 0 plan — 5e49128
1. Code — salarySplit.js (strict reads, PF_CEILING_MAX, splitDiffers, checkRequestStructure), salaryChange.js
   (raiseSalaryChangeRequest moved here; requestedCeiling in range only), employees.js PUT /:code/salary (gross checks,
   GROSS_REQUIRED, notSaved, "Saved — bank and ID details"), salary-input.js request-change (checks + one-pending),
   Employees.jsx (min/max, server message on save), SalaryInput.jsx (already-pending info toast).

## Next
2 tests (new pfCeilingInputChecks.test.js + flip moneyPermissionBatch4 pin) → full jest → build → check script + --base → drift.

## CLAUDE.md entry
(filled at hand-off)

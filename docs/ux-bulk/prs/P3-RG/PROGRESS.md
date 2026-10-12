# P3-RG PROGRESS

## RESUME
Branch fix/role-gaps-taxdecl-verify · worktree /home/claude/wt-rg · port 3406. Read PLAN.md. Phase 0 done → waiting for planner "go".
Owned: backend/src/routes/taxDeclarations.js (guard lines), frontend/src/pages/FinanceAudit.jsx (flags lines),
NEW taxDeclarationReadGuard.test.js, backend/scripts/role-gaps-check.py, this folder.

## Steps
- [x] Phase 0: code read, PLAN.md written (SQL A–D + Q1–Q4 for planner)
- [x] planner go + SQL answers
- [x] jest baseline 115 suites / 2040 tests
- [x] test file written, 9 of 25 fail on 8abee969
- [x] backend guards (25/25 + route guards 291 green)
- [ ] FinanceAudit canVerify + isFlagVerified
- [ ] build + role-gaps-check.py (+ --base)
- [ ] jest after, self-debug, v2
- [ ] merge origin/main, re-run, push, report

## Rulings
Planner 12 Oct: GO. SQL A = 0 calls ever to /api/tax-declarations*; C = 0 disagreeing flag rows; D = 0 verify calls.
Q1 yes (parent badge uses helper). Q2 keep verified_by fallback. Q3 "Awaiting finance". Q4 no self-read exception.

## CLAUDE.md entry
(to write at the end)

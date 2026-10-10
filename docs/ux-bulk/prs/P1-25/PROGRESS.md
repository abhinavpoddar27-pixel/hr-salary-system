# P1-25 — PROGRESS

## RESUME (re-read after any compaction)
- Branch: `fix/employee-edit-no-direct-gross` (base origin/main 0ea1409). Worktree /home/claude/wt-p1-25 only.
  Never push to main; never open/merge a PR; never write to production; never kill processes you did not start.
- Spec: `docs/ux-bulk/prs/P1-25/PROMPT.md`. Plan: `docs/ux-bulk/prs/P1-25/PLAN.md`.
- Current phase: **Build — planner GO received (11 Oct 2026).**
- Continue from the first step whose status is not `done`; never redo a done step.
- Targets: `backend/src/routes/employees.js` PUT /:code only (+ new test, + new verify script, + test edits if Q1/Q2 OK).
  No frontend change (Edit modal never sends gross — PLAN). Server port 3125. Fictional data only (repo public).

## Steps
| # | Step | Status | Result / sha |
|---|---|---|---|
| 0 | Phase 0 PLAN + PROGRESS | done | ca20513 |
| 1 | jest full suite BEFORE (record suites/tests) | done | 92 suites / 1478 pass (base 0ea1409 + docs) |
| 2 | employees.js: requireHrOrAdmin on PUT /:code + gross refusal | done | +20/−1, PUT /:code only |
| 3 | new employeeEditGrossGuard.test.js; prove fails on origin/main | done | 23/23 on branch; on origin/main worktree 12 fail / 11 pass (all refusal + 403 cases fail; regression guards pass) |
| 4 | adjust statutoryWriters (T9a, T8b) + markLeftRoleGuard (view1/fin1) per Q1/Q2 | done | 3 suites 85/85 |
| 5 | jest full suite AFTER | todo | |
| 6 | verify script (port 3125) + `--base` on origin/main worktree | todo | |
| 7 | self-debug + user-simulation pass; git diff --stat (salaryComputation.js untouched) | todo | |
| 8 | CLAUDE.md Last Session entry | todo | |
| 9 | final push, HEAD == origin | todo | |

## Rulings
- GO 11 Oct 2026: Q1 yes (T9a resend same gross, T8b seed + resend), Q2 yes (viewer/finance → 403), Q3 yes (first gross refused), Q4 yes (admin no bypass). MONEY PR: stop and report after checks; planner runs independent review.

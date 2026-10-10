# P1-25 — PROGRESS

## RESUME (re-read after any compaction)
- Branch: `fix/employee-edit-no-direct-gross` (base origin/main 0ea1409). Worktree /home/claude/wt-p1-25 only.
  Never push to main; never open/merge a PR; never write to production; never kill processes you did not start.
- Spec: `docs/ux-bulk/prs/P1-25/PROMPT.md`. Plan: `docs/ux-bulk/prs/P1-25/PLAN.md`.
- Current phase: **Phase 0 done — WAITING for planner "go" / corrections on Q1–Q4.** Do not start step 1 before that.
- Continue from the first step whose status is not `done`; never redo a done step.
- Targets: `backend/src/routes/employees.js` PUT /:code only (+ new test, + new verify script, + test edits if Q1/Q2 OK).
  No frontend change (Edit modal never sends gross — PLAN). Server port 3125. Fictional data only (repo public).

## Steps
| # | Step | Status | Result / sha |
|---|---|---|---|
| 0 | Phase 0 PLAN + PROGRESS | done | this commit |
| 1 | jest full suite BEFORE (record suites/tests) | todo | |
| 2 | employees.js: requireHrOrAdmin on PUT /:code + gross refusal | todo | |
| 3 | new employeeEditGrossGuard.test.js; prove fails on origin/main | todo | |
| 4 | adjust statutoryWriters (T9a, T8b) + markLeftRoleGuard (view1/fin1) per Q1/Q2 | todo | |
| 5 | jest full suite AFTER | todo | |
| 6 | verify script (port 3125) + `--base` on origin/main worktree | todo | |
| 7 | self-debug + user-simulation pass; git diff --stat (salaryComputation.js untouched) | todo | |
| 8 | CLAUDE.md Last Session entry | todo | |
| 9 | final push, HEAD == origin | todo | |

## Rulings
- (pending planner) Q1–Q4 in PLAN.md.

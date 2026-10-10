# P1-05 — PROGRESS

## RESUME (re-read after any compaction)
- Branch: `fix/stage6-leave-form-reset` (base origin/main 18bef07). Worktree /home/claude/wt-p1-05. Never push to main;
  never open/merge a PR. Spec `PROMPT.md`, plan `PLAN.md` (this folder).
- Current phase: **BUILD (planner GO on 405d963).**
- Only `frontend/src/pages/DayCalculation.jsx` (Apply Leave open/close handlers) may change in frontend/src
  (+ new check script + docs + dist). Do NOT touch P1-04's calcMutation/header. Fictional data only (repo public).
  Server port 3105 only. Base build/jest in a /tmp worktree of 18bef07.
- Done steps are not redone; continue from the first step whose status is not `done`.

## Steps
| # | Step | Status | Result / sha |
|---|---|---|---|
| 0 | Phase 0 plan + progress | done | 405d963 |
| 1 | jest before (18bef07 worktree) | done | 89 suites / 1430 tests pass (/tmp/p105-main) |
| 2 | Source edit DayCalculation.jsx (EMPTY_LEAVE_FORM, open/closeLeaveModal, 4 call sites) | done | +18/−6; f97ad6e |
| 3 | dist rebuild (own commit) | done | vs fresh 18bef07 build (hash-normalised) only the DayCalculation chunk differs; 0301dd5 |
| 4 | check script written | done | backend/scripts/stage6-leave-form-reset-check.py (T9501/T9502, hr, port 3105, --base + APP_ROOT) |
| 5 | script on branch dist | done | v1 44/44; v2 53/53 (step 8) |
| 6 | `--base` on origin/main dist | done | 4/4 on /tmp/p105-main (18bef07): B's window shows A's EL/date/reason, submit enabled |
| 7 | jest after | todo | |
| 8 | self-debug + user simulation + v2 | todo | |
| 9 | CLAUDE.md Last Session entry | todo | |
| 10 | final push + HEAD == origin | todo | |

## Rulings
- R-P0: Phase 0 gate (planner approves); never push to main.
- GO 11 Oct 2026 on 405d963: Q1 reset on every open (same employee too); Q2 success goes through closeLeaveModal();
  Q3 late error toast after close left as is (note in CLAUDE.md).

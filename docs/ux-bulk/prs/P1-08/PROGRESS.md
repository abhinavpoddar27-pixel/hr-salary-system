# P1-08 — PROGRESS

## RESUME (re-read after any compaction)
- Branch: `fix/stage5-grid-refresh` (base origin/main 2d96842). Never push to main; no PR open/merge.
- Spec: `docs/ux-bulk/prs/P1-08/PROMPT.md`. Plan: `docs/ux-bulk/prs/P1-08/PLAN.md`.
- Current phase: **Phase 0 done — waiting for planner "go" + rulings Q1/Q2.**
- Continue from the first step whose status is not `done`. Never redo a done step.
- Work only in /home/claude/wt-p1-08; other builders use other worktrees — never touch them. Server port 3108 only.
- Only `frontend/src/pages/AttendanceRegister.jsx` (updateMutation + recalcMutation) may change in frontend/src
  (+ `utils/api.js` getAttendanceRegister ONLY if Q1 = yes). Fictional data only (repo public).
- `frontend/node_modules` / `backend/node_modules` are symlinks — never `git add` them (use explicit paths).

## Steps
| # | Step | Status | Result / sha |
|---|---|---|---|
| 0 | Phase 0 plan + progress | done | this commit |
| 1 | jest before | done | 85 suites / 1377 pass (branch = 2d96842 + docs) |
| 2 | Source edit (updateMutation + recalcMutation invalidate prefix) | pending | |
| 3 | dist rebuild (own commit) | pending | |
| 4 | check script written | pending | |
| 5 | script on branch dist (incl. fast-save / 5 s cache case) | pending | |
| 6 | `--base` on origin/main dist (worktree /tmp) | pending | |
| 7 | self-debug + user simulation + v2 | pending | |
| 8 | jest after | pending | |
| 9 | CLAUDE.md Last Session entry | pending | |
| 10 | final push + HEAD == origin | pending | |

## Rulings
- Programme "go" from owner 10 Oct 2026; planner approves Phase 0.
- Q1 (fresh on getAttendanceRegister if 5 s cache serves stale): pending.
- Q2 (Calendar View invalidation): pending.

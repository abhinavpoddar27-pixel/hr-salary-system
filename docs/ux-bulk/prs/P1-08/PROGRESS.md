# P1-08 — PROGRESS

## RESUME (re-read after any compaction)
- Branch: `fix/stage5-grid-refresh` (base origin/main 2d96842). Never push to main; no PR open/merge.
- Spec: `docs/ux-bulk/prs/P1-08/PROMPT.md`. Plan: `docs/ux-bulk/prs/P1-08/PLAN.md`.
- Current phase: **BUILD (planner GO 10 Oct 2026).**
- Continue from the first step whose status is not `done`. Never redo a done step.
- Work only in /home/claude/wt-p1-08; other builders use other worktrees — never touch them. Server port 3108 only.
- Only `frontend/src/pages/AttendanceRegister.jsx` (updateMutation + recalcMutation) may change in frontend/src
  (+ `utils/api.js` getAttendanceRegister ONLY if Q1 = yes). Fictional data only (repo public).
- `frontend/node_modules` / `backend/node_modules` are symlinks — never `git add` them (use explicit paths).

## Steps
| # | Step | Status | Result / sha |
|---|---|---|---|
| 0 | Phase 0 plan + progress | done | 87d9e5b |
| 1 | jest before | done | 85 suites / 1377 pass (branch = 2d96842 + docs) |
| 2 | Source edit (updateMutation + recalcMutation invalidate prefix) | done | grid prefix + edited employee's ['daily-attendance'] (update); grid prefix + ['daily-attendance'] prefix (recalc — calendar shows NH from is_night_shift); mutate passes code; 9cf… see git log |
| 3 | dist rebuild (own commit) | pending | |
| 4 | check script written | done | backend/scripts/stage5-grid-refresh-check.py — cases A–F, fictional T9801/T9802, weekday-aware days, port 3108 |
| 5 | script on branch dist (incl. fast-save / 5 s cache case) | in progress | invalidate-only build: 30/31 — B FAILS (quick save 1.0 s after grid GET → cell stale: browser served the max-age=5 copy). Q1 proven → add `fresh` |
| 6 | `--base` on origin/main dist (worktree /tmp) | pending | |
| 7 | self-debug + user simulation + v2 | pending | |
| 8 | jest after | pending | |
| 9 | CLAUDE.md Last Session entry | pending | |
| 10 | final push + HEAD == origin | pending | |

## Rulings
- Programme "go" from owner 10 Oct 2026; planner approves Phase 0.
- Q1: YES — add `fresh` to getAttendanceRegister in utils/api.js IF the quick-save case is proven stale (script before + after).
- Q2: INCLUDE — invalidate ['daily-attendance', code, month, year] for the edited employee in the same onSuccess.
- Miss-punch cell stays red after a generic edit → CLAUDE.md "found, not fixed".

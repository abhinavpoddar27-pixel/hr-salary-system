# P1-17 — PROGRESS

## RESUME (re-read after any compaction)
- Branch: `fix/import-month-and-dead-checkbox` (base origin/main 868f5389). Worktree /home/claude/wt-p1-17 only.
  Never push to main; no PR open/merge. Port 3117 only.
- Spec: `docs/ux-bulk/prs/P1-17/PROMPT.md`. Plan: `docs/ux-bulk/prs/P1-17/PLAN.md`.
- Current phase: **Phase 0 done — waiting for planner "go".**
- Done steps are not redone; continue from the first step whose status is not `done`.
- Only `frontend/src/pages/Import.jsx` may change in frontend/src (+ dist, + new check script). Backend untouched.
  Fictional data only (repo public). node_modules are symlinks — never commit them.
- Builds: `flock /tmp/vite.lock npm run build --prefix frontend`; full jest: `flock /tmp/jest.lock npx jest`.
  Kill only PIDs you started.

## Steps
| # | Step | Status | Result / sha |
|---|---|---|---|
| 0 | Phase 0 plan + progress | done | (this commit) |
| 1 | jest before | done | 96 suites / 1537 pass (tree = 868f5389 + docs) |
| 2 | Source edit Import.jsx | pending | |
| 3 | dist rebuild (own commit) | pending | |
| 4 | jest after | pending | |
| 5 | check script written | pending | |
| 6 | script on branch dist | pending | |
| 7 | `--base` on origin/main dist | pending | |
| 8 | self-debug + user simulation | pending | |
| 9 | CLAUDE.md Last Session entry | pending | |
| 10 | final push + HEAD == origin | pending | |

## Rulings
- Programme-level owner "go" 10 Oct 2026; planner approves Phase 0 (pending — Q1–Q3 in PLAN §5).

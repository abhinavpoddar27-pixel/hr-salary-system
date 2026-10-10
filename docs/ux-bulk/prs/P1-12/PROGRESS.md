# P1-12 — PROGRESS

## RESUME (re-read after any compaction)
- Branch: `fix/sidebar-header-hook-order` (base origin/main 3d20021). Never push to main; no PR open/merge.
- Spec: `docs/ux-bulk/prs/P1-12/PROMPT.md`. Plan: `docs/ux-bulk/prs/P1-12/PLAN.md`.
- Current phase: **Phase 0 done — waiting for planner "go" / corrections.** Do not start step 1 before that.
- Continue from the first step whose status is not `done`; never redo a done step.
- Only Sidebar.jsx + Header.jsx in frontend/src may change; dist in its own commit; check script port 3112.
  Fictional data only (repo public). main dist is built in a git worktree under /tmp, never in this tree.

## Steps
| # | Step | Status | Result / sha |
|---|---|---|---|
| 0 | Phase 0 plan + progress | done | this commit |
| 1 | jest baseline (3d20021 worktree /tmp) | pending | |
| 2 | Source edit (NavItem hidden flag + Header selector lifted) | pending | |
| 3 | dist rebuild (own commit) + hash-normalised compare | pending | |
| 4 | check script `backend/scripts/layout-hook-order-check.py` | pending | |
| 5 | script on branch dist | pending | |
| 6 | `--base` on 3d20021 dist | pending | |
| 7 | jest after | pending | |
| 8 | self-debug + user simulation + v2 | pending | |
| 9 | CLAUDE.md Last Session entry | pending | |
| 10 | final push + HEAD == origin | pending | |

## Rulings
- Programme-level owner "go" 10 Oct 2026; planner approves Phase 0 (pending).
- Open: Q1 (effect byte-identical), Q2 (test switch mechanism), Q3 (no merge of Header store calls) — see PLAN §6.

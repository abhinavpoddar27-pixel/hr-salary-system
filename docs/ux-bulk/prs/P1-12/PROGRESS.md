# P1-12 — PROGRESS

## RESUME (re-read after any compaction)
- Branch: `fix/sidebar-header-hook-order` (base origin/main 3d20021). Never push to main; no PR open/merge.
- Spec: `docs/ux-bulk/prs/P1-12/PROMPT.md`. Plan: `docs/ux-bulk/prs/P1-12/PLAN.md`.
- Current phase: **COMPLETE — handed off.** Nothing to redo. Do NOT open or merge a PR.
- Continue from the first step whose status is not `done`; never redo a done step.
- Only Sidebar.jsx + Header.jsx in frontend/src may change; dist in its own commit; check script port 3112.
  Fictional data only (repo public). main dist is built in a git worktree under /tmp, never in this tree.

## Steps
| # | Step | Status | Result / sha |
|---|---|---|---|
| 0 | Phase 0 plan + progress | done | 16c2d76 |
| 1 | jest baseline (3d20021 worktree /tmp) | done | /tmp/p112-main: 85 suites / 1380 pass |
| 2 | Source edit (NavItem hidden flag + Header selector lifted) | done | Sidebar +19/−13, Header +3/−1; 02e073b |
| 3 | dist rebuild (own commit) + hash-normalised compare | done | only the index chunk differs vs fresh 3d20021 build; 479b76f |
| 4 | check script `backend/scripts/layout-hook-order-check.py` | done | one real UI login per role (login rate limit 5), sessions reused; /auth/me intercept = in-place switch |
| 5 | script on branch dist | done | 52/52 (A 4 roles, B 6 switches, C 390px). Reload sends a 401 session-analytics beacon + role-mismatch 403s in B — printed, not asserted |
| 6 | `--base` on 3d20021 dist | done | 15/15: all 6 in-place switches crash the layout (React #300 / #310); per-role labels + selector identical main vs branch |
| 7 | jest after | done | 85 suites / 1380 pass (unchanged) |
| 8 | self-debug + user simulation + v2 | done | v2 script 58/58 (+ after each switch a menu link still opens). Self-debug: diff vs 3d20021 in frontend/src+backend = 2 targets + script; no other hook-after-return in the 2 files; NotificationBell clean. Login rate limit (5) forced session reuse in the script |
| 9 | CLAUDE.md Last Session entry | done | prepended at top (incl. no-ESLint follow-up) |
| 10 | final push + HEAD == origin | done | this commit; verified with ls-remote |

## Rulings
- Programme-level owner "go" 10 Oct 2026; planner approves Phase 0 (pending).
- Planner GO 10 Oct 2026: Q1 keep useEffect as-is (comment above the hidden return); Q2 one switch per load per pair OK;
  Q3 do not merge the two useAppStore calls; no-ESLint → CLAUDE.md follow-up.

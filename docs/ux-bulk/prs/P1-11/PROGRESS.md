# P1-11 — PROGRESS

## RESUME (re-read after any compaction)
- Branch: `fix/dashboard-failed-call-not-all-clear` (base origin/main 3d20021). Never push to main; no PR open/merge.
- Spec: `docs/ux-bulk/prs/P1-11/PROMPT.md`. Plan: `docs/ux-bulk/prs/P1-11/PLAN.md`.
- Current phase: **COMPLETE — handed off** (planner "go" 10 Oct 2026). Nothing left to redo. Do NOT open or merge a PR.
- Continue from the first step whose status is not `done`. Never redo a done step.
- Only `frontend/src/pages/Dashboard.jsx` (action-items code) may change in frontend/src. Fictional data only (repo public).
  Port 3111 only. Base dist is built in a git worktree under /tmp, never in this tree. node_modules are symlinks — never commit.

## Steps
| # | Step | Status | Result / sha |
|---|---|---|---|
| 0 | Phase 0 plan + progress | done | 07a8a11 |
| 1 | jest before (3d20021) | done | 85 suites / 1380 pass |
| 2 | Source edit (failed flags, retryAction, admin list, finance cards+banner per Q1) | done | ca5dcc9 (+74/−14); v2 stale-retry guard (step 8) |
| 3 | dist rebuild (own commit) | done | d18133d; v2 6470af2. Hash-normalised vs fresh 3d20021 build: only Dashboard chunk differs (index only chunk hashes) |
| 4 | jest after | done | 85 / 1380 pass (no backend change) |
| 5 | check script `backend/scripts/dashboard-failed-call-check.py` | done | fictional T97xx, admin + finance, port 3111, one login per user (login is rate-limited) |
| 6 | script on branch dist | done | 66/66 (v1 and v2 dist) |
| 7 | `--base` on 3d20021 dist (worktree /tmp) | done | /tmp/p111-main 3/3: admin "All clear", finance green 0 ×4 + "All caught up" |
| 8 | self-debug + user simulation + v2 | done | self-debug: console filter matched /api prefix only (api.js logs path without /api) → fixed; login rate limit → session reuse; race: Retry resolving after month change could overwrite new month → v2 `financeFetchSeq` guard. User sim: finance opens dashboard with one check down → sees "—", banner, retries, real value; edge all 4 down + retry while still down |
| 9 | CLAUDE.md Last Session entry | done | prepended |
| 10 | final push + HEAD == origin | done | see report |

## Rulings
- R11: Phase 0 gate; never push to main.
- Q1 yes (finance workbench too), Q2 held count only, Q3 yes (200 + success:false = Couldn't check) — planner, 10 Oct 2026.

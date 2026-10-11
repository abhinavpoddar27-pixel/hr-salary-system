# P1-16 — PROGRESS

## RESUME (re-read after any compaction)
- Branch: `fix/interventions-reject-all-confirm` (base origin/main 868f5389). Worktree /home/claude/wt-p1-16. Port 3116.
- Spec: `docs/ux-bulk/prs/P1-16/PROMPT.md`. Plan: `docs/ux-bulk/prs/P1-16/PLAN.md`.
- Current phase: **COMPLETE — handed off.** Nothing to redo. Do NOT open or merge a PR.
- Only `frontend/src/pages/FinanceAudit.jsx` (Interventions tab) may change in source. Fictional data only. Never push to main.
- Builds: `flock /tmp/vite.lock npm run build --prefix frontend`; full jest: `flock /tmp/jest.lock npx jest`.

## Steps
| # | Step | Status | Result / sha |
|---|---|---|---|
| 0 | Phase 0 plan + progress | done | b16d225 |
| 1 | jest before | done | 96 suites / 1537 pass |
| 2 | Source edit (selectable set, header box, selection clear, Reject All + Approve All confirm, gross left out) | done | 52d436c; dblclick ref guard 8241aef |
| 3 | dist rebuild (own commit) | done | b2d4691, 6f6a019; hash-normalised vs 868f5389 only FinanceAudit chunk differs |
| 4 | check script | done | backend/scripts/interventions-reject-all-check.py, 86720426 |
| 5 | script on branch | done | 56/56 ×3 |
| 6 | `--base` on 868f5389 | done | 8/8 (worktree /tmp/p116-main): one-click reject, no reason, approved row flipped, gross not reverted |
| 7 | self-debug + user simulation | done | caught: dblclick sent 2 PUTs (isPending lags) → ref guard; script q() lacked commit. User sim: reject gross row by row → gross reverted; Approve All in Aug; phone |
| 8 | jest after | done | 96 / 1537 pass |
| 9 | CLAUDE.md Last Session entry | done | prepended |
| 10 | final push + HEAD == origin | done | this commit |

## Rulings
- Planner "go" 11 Oct 2026: Q1 (a) gross-change rows left out of Reject All with a note; Q2 only pending non-live rows tickable; Q3 Approve All gets a count confirm (no reason).

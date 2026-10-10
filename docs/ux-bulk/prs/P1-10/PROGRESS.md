# P1-10 — PROGRESS

## RESUME (re-read after any compaction)
- Branch: `fix/nightshift-undo-relabel` (base origin/main 3d20021). Worktree /home/claude/wt-p1-10. Never push to main;
  never open/merge a PR. Spec `PROMPT.md`, plan `PLAN.md` (this folder).
- Current phase: **build** (planner GO 10 Oct 2026 on 915910f). Base build/jest worktree: /tmp/p110-main (3d20021).
- Only `frontend/src/pages/NightShift.jsx` may change in frontend/src (+ new check script + docs + dist).
  Fictional data only (repo public). Server port 3110 only. origin/main dist built in a /tmp worktree.
- Done steps are not redone; continue from the first step whose status is not `done`.

## Steps
| # | Step | Status | Result / sha |
|---|---|---|---|
| 0 | Phase 0 plan + progress | done | 915910f |
| 1 | jest before (3d20021 worktree) | done | 85 suites / 1380 tests pass (/tmp/p110-main) |
| 2 | Source edit NightShift.jsx (relabel, aria/title, ConfirmDialog, stopPropagation) | done | +15/−2; 75743ec |
| 3 | dist rebuild (own commit) | done | build clean; vs fresh 3d20021 build (hash-normalised) only NightShift chunk + index preload list (adds ConfirmDialog dep) differ; 1064a5a |
| 4 | check script written | done | backend/scripts/nightshift-reject-confirm-check.py (T9601–T9605, hr, port 3110, --base + APP_ROOT) |
| 5 | script on branch dist | done | 44/44 (v2, see step 8) |
| 6 | `--base` on origin/main dist | done | 9/9: "Undo" present, ✕ no aria-label, one click → POST + is_rejected=1 + MISSING_OUT, no dialog |
| 7 | jest after | done | 85 / 1380 pass (no backend change) |
| 8 | self-debug + user simulation + v2 | done | v1 43/44: status cell still "Pending" right after reject — pre-existing (GET /night-shifts max-age=5, refetch reads stale copy; same on --base) → F-e, not fixed (api.js outside Targets). v2 checks status after a 6 s wait + reload. Sim: cancel / reject / double-click / backdrop / 390px. Diff vs 3d20021 in src+backend = NightShift.jsx + script |
| 9 | CLAUDE.md Last Session entry | pending | |
| 10 | final push + HEAD == origin | pending | |

## Rulings
- R-P0: Phase 0 gate (planner approves); never push to main.
- GO 10 Oct 2026: Q1 stopPropagation yes; Q2 keep ✕ with aria-label/title; Q3 "This cannot be undone here" OK.
  F-a..F-d → CLAUDE.md found-not-fixed (F-c role guard belongs to P2-11).

# P1-02 — PROGRESS

## RESUME (re-read after any compaction)
- Branch: `fix/salary-register-report-fields` (base origin/main 96ee482). Never push to main; no PR open/merge.
- Spec: `docs/ux-bulk/prs/P1-02/PROMPT.md`. Plan: `docs/ux-bulk/prs/P1-02/PLAN.md`.
- Current phase: **Phase 0 DONE — STOPPED at the gate, waiting for the owner's "go".**
- Next step: #1 source edit (Reports.jsx Salary Register block only, per PLAN §3–§4). Done steps are never redone;
  continue from the first step whose status is not `done`.
- Only `frontend/src/pages/Reports.jsx` (L568–643) may change in frontend/src. Fictional data only (repo public).
  origin/main dist is built in a git worktree under /tmp, never in the main tree.

## Steps
| # | Step | Status | Result / sha |
|---|---|---|---|
| 0 | Phase 0 plan + progress | done | this commit |
| 1 | Source edit (4 keys, PT column out, colSpan 11→10, CSV map) | pending — needs "go" | |
| 2 | dist rebuild (own commit) | pending | |
| 3 | jest before/after | pending | |
| 4 | check script written | pending | |
| 5 | script on branch dist | pending | |
| 6 | `--base` on origin/main dist (worktree /tmp) | pending | |
| 7 | self-debug + user simulation + v2 | pending | |
| 8 | CLAUDE.md Last Session entry | pending | |
| 9 | final push + HEAD == origin | pending | |

## Rulings
- R11: Phase 0 gate; never push to main.
- PT disabled (always 0, Apr 2026) → PT column + CSV entry removed.
- Open questions: PLAN §9 (Q1 drop CSV Basic/HRA; Q2 held marker N-4).

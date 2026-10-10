# P1-02 — PROGRESS

## RESUME (re-read after any compaction)
- Branch: `fix/salary-register-report-fields` (base origin/main 96ee482). Never push to main; no PR open/merge.
- Spec: `docs/ux-bulk/prs/P1-02/PROMPT.md`. Plan: `docs/ux-bulk/prs/P1-02/PLAN.md`.
- Current phase: **Phase 1 build** (owner "go" 10 Oct 2026 20:17 IST).
- Next step is #1 source edit (Reports.jsx Salary Register block only, per PLAN §3–§4). Done steps are not to be redone;
  continue from the first step whose status is not `done`.
- Another builder uses worktree /home/claude/wt-p1-03 — never touch it, never remove worktrees, never checkout another
  branch here. Own server port 3101.
- Only `frontend/src/pages/Reports.jsx` (L568–643) may change in frontend/src. Fictional data only (repo public).
  origin/main dist is built in a git worktree under /tmp, never in the main tree.

## Steps
| # | Step | Status | Result / sha |
|---|---|---|---|
| 0 | Phase 0 plan + progress | done | 55337b2 |
| 1 | Source edit (4 keys, PT column out, colSpan 11→10, CSV map) | pending | |
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
- R12 (10 Oct 2026 20:17 IST): YES drop the CSV Basic/HRA monthly columns.
- R13 (10 Oct 2026 20:17 IST): held-row marking (N-4) NOT in this PR — later, separate.

# P1-21 — PROGRESS

## RESUME (re-read after any compaction)
- Branch: `fix/reports-bulk-payslips-403` (base origin/main 868f5389). Worktree /home/claude/wt-p1-21. Port 3121 only.
- Spec: `docs/ux-bulk/prs/P1-21/PROMPT.md`. Plan: `docs/ux-bulk/prs/P1-21/PLAN.md`.
- Current phase: **Build — planner "go" received 11 Oct 2026.** Never push to main; no PR open/merge.
- Continue from the first step whose status is not `done`. Never redo a done step.
- Targets only: frontend/src/pages/Reports.jsx + frontend/src/utils/api.js (dead `getBulkPayslips`). Fictional data only.
- Builds: `flock /tmp/vite.lock npm run build --prefix frontend`; full jest: `flock /tmp/jest.lock npx jest`. Kill only own PIDs.

## Steps
| # | Step | Status | Result / sha |
|---|---|---|---|
| 0 | Phase 0 plan + progress | done | 1ab5eb07 |
| 1 | jest baseline | pending | |
| 2 | Source edit (Reports.jsx button/handler/imports out, note in; api.js helper out) | pending | |
| 3 | dist rebuild (own commit) | pending | |
| 4 | check script written | pending | |
| 5 | script on branch dist | pending | |
| 6 | `--base` on origin/main dist | pending | |
| 7 | jest after + self-debug + user simulation | pending | |
| 8 | CLAUDE.md Last Session entry | pending | |
| 9 | final push + HEAD == origin | pending | |

## Rulings
- Q1: keep the tab with the note; label simply "Payslips" (the note carries the explanation).
- Q2: leave payslipPdf.js (dead `downloadBulkPayslipsPDF` export) — log as found-not-fixed.
- Q3: yes, "Open Stage 7" link to /pipeline/salary.

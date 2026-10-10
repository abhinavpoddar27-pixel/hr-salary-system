# P1-02 — PROGRESS

## RESUME (re-read after any compaction)
- Branch: `fix/salary-register-report-fields` (base origin/main 96ee482). Never push to main; no PR open/merge.
- Spec: `docs/ux-bulk/prs/P1-02/PROMPT.md`. Plan: `docs/ux-bulk/prs/P1-02/PLAN.md`.
- Current phase: **Phase 1 build** (owner "go" 10 Oct 2026 20:17 IST).
- Next step is #6 --base run on origin/main dist (worktree /tmp/p102-main). Done steps are not to be redone;
  continue from the first step whose status is not `done`.
- Another builder uses worktree /home/claude/wt-p1-03 — never touch it, never remove worktrees, never checkout another
  branch here. Own server port 3101.
- Only `frontend/src/pages/Reports.jsx` (L568–643) may change in frontend/src. Fictional data only (repo public).
  origin/main dist is built in a git worktree under /tmp, never in the main tree.

## Steps
| # | Step | Status | Result / sha |
|---|---|---|---|
| 0 | Phase 0 plan + progress | done | 55337b2 |
| 1 | Source edit (4 keys, PT column out, colSpan 11→10, CSV map) | done | Reports.jsx +10/−14 (4 keys, PT th+td out, colSpan 11→10 ×2, CSV 15→12 keys); 1e8e4e4 |
| 2 | dist rebuild (own commit) | done | build clean 23 s; Reports chunk has net_salary/gross_earned, no total_earned/earned_basic/professional_tax (employee_pf ×5 = PF Statement block, aliased, correct); f4683dc |
| 3 | jest before/after | done | before (96ee482 worktree /tmp/p102-main) 81 suites / 1332 pass; after (branch) 81 / 1332 pass; 0 red (no backend change) |
| 4 | check script written | done | backend/scripts/salary-register-report-check.py (fictional T950x: PF, ESI, PF+ESI, held, neither; hr+finance; port 3101; --base + APP_ROOT) |
| 5 | script on branch dist | done | 52/52 pass (hr + finance: 10 headers, no PT, every row = DB, Σ Earned = Gross Payroll card, Σ non-held Net = Net Payroll card, Σ Ded = Total Deductions card, CSV 12-col header + non-empty + values, drill-down colspan 10 full width, 0 page/console errors, 0 API ≥ 400; 390px). Script fix: headers read via textContent (CSS uppercases inner_text) |
| 6 | `--base` on origin/main dist (worktree /tmp) | pending | |
| 7 | self-debug + user simulation + v2 | pending | |
| 8 | CLAUDE.md Last Session entry | pending | |
| 9 | final push + HEAD == origin | pending | |

## Rulings
- R11: Phase 0 gate; never push to main.
- PT disabled (always 0, Apr 2026) → PT column + CSV entry removed.
- R12 (10 Oct 2026 20:17 IST): YES drop the CSV Basic/HRA monthly columns.
- R13 (10 Oct 2026 20:17 IST): held-row marking (N-4) NOT in this PR — later, separate.

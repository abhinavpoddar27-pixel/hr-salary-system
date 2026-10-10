# P1-04 PROGRESS — Stage 6 always runs for all companies

## RESUME
Read PROMPT.md + PLAN.md. Never redo a ticked step. Worktree /home/claude/wt-p1-04, branch fix/stage6-company-scope-guard.
Push after every step. DO-NOT-MODIFY: payroll.js, recompute.js, dayCalculation.js, everything outside DayCalculation.jsx
calcMutation + header (plus the new check script + docs + dist).

## Steps
- [x] P0.1 Clean tree at 2d96842 + PROMPT (e0cdf50); remote branch exists.
- [x] P0.2 Read calcMutation (L110–119), header (L245–262), stale-banner button (L280–286), api.js L97,
      payroll.js /calculate-days, recompute.js company handling — '' / omitted = all companies (confirmed by reading).
- [x] P0.3 jest baseline: 85 suites / 1377 tests pass.
- [x] P0.4 PLAN.md + PROGRESS.md written, committed, pushed. **STOP — waiting for planner "go".**
- [x] P1 calcMutation company '' + toast
- [x] P2 note under Run button
- [x] P3 build dist (own commit)
- [x] P4 stage6-all-companies-check.py on branch: 28/28 (hr A selected, All Companies, restricted hra, 390px)
- [x] P5 --base on a 2d96842 worktree (fresh build): 4/4 — body company=A, T9605 30→15, B rows absent
- [x] P6 jest after: 85/1377 (identical). dist vs fresh 2d96842 build: only the DayCalculation chunk differs (hash-normalised)
- [x] P7 self-debug + user simulation. Caught: header did not wrap → Run button (and note) off-screen at 390px → flex-wrap gap-3 on the header row (own commit)
- [x] P8 CLAUDE.md Last Session entry, push, HEAD == origin

## Owner / planner rulings
- Q4 (planner default): always run for All companies, one-line note on screen.
- GO 10 Oct (planner, on 01aaf4d). Q1: accept — restricted user's run also recalculates the other company; add a line to CLAUDE.md fragile. Q2: PROMPT wording as-is.

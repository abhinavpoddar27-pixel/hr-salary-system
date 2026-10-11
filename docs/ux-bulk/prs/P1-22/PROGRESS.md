# P1-22 PROGRESS
## RESUME
Branch fix/salary-change-approver-view · worktree /home/claude/wt-p1-22 · port 3122 · read PLAN.md first.
DONE — handed off. Never redo a ticked step.

## Steps
- [x] 0.1 Read PROMPT, SalaryInput.jsx pending card, salary-input.js routes, employees.js writer
- [x] 0.2 PLAN.md written (diagnosis, fix, verify, Q1–Q3, found-not-fixed)
- [x] 0.3 Planner "go" (11 Oct 2026)
- [x] 1 jest baseline: 96 suites / 1537
- [x] 2 Edit SalaryInput.jsx (componentRows + table + effective note + 390px)
- [x] 3 Build dist (flock), own commit
- [x] 4 `backend/scripts/salary-change-approver-view-check.py` 57/57; `--base` on 868f5389 build 9/9
- [x] 5 jest after 96 / 1537; self-debug + user simulation (finance approve in the UI after the view → applied)
- [x] 6 CLAUDE.md entry, push, verify HEAD == origin

## Rulings
- Q1: Proposed gross = stored req.new_gross.
- Q2: missing proposed key → ₹0 highlighted + row note "not in this request — approval sets it to 0".
- Q3: Special allowance row only when non-zero on either side.
- F-a (Employee Master approval zeroes conveyance) logged prominently as a MONEY finding.

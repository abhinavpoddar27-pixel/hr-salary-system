# P6-06 PROGRESS

## RESUME
Branch feat/destructive-confirms (base b0ed242), worktree /home/claude/wt-p6-06, port 3503. Read PLAN.md + this file.
State: BUILD in progress. Next step = first unchecked box below.

## Planner rulings (16 Oct 2026)
- Q1: A3 (document delete) is done in P6-06. Touch ONLY the document-delete lines in Employees.jsx (builder B edits the
  salary-save toast lines in the same file; planner merge-checks both).
- Q2: include E1 (Automatic day calculation toggle) and E2 ("There is none"). Skip E3 (flag Clear).
- Q3: rate approve = amber (`warning`; first focus on Confirm per P2-01).
- Q4: yes — say it plainly: "New rates apply from today. The effective date is recorded but not used yet."
- G1–G4 registered by the planner (not fixed here).

## Steps
- [ ] B1 DailyWageContractors: A1 deactivate + A2 rate approve confirms
- [ ] B2 LeaveAutomationTab: A4 grant remove, A5 automation toggle, E1 auto day-calc toggle, E2 "There is none"
- [ ] B3 Employees.jsx: A3 document delete confirm (document-delete lines only; ConfirmDialog nested in the profile Modal)
- [ ] B4 build + destructive-confirms-check.py + --base
- [ ] B5 jest before/after; regression scripts; self-debug + v2
- [ ] B6 push, hand-off

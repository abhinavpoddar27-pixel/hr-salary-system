# P1-19 PROGRESS
## RESUME
Read PROMPT.md, PLAN.md, then this file. Never redo a ticked step. Planner approval needed before step 3.

## Steps
- [x] 1. Diagnosis: route already reads `body.dol`; page sends `{}` (PLAN §1)
- [x] 2. PLAN.md + PROGRESS.md committed + pushed; STOP for planner "go"
- [x] 3. jest baseline (flock /tmp/jest.lock)
- [x] 4. MarkLeftDialog in SalesEmployeeMaster.jsx + mutation sends {dol}
- [x] 5. dist rebuild (flock /tmp/vite.lock), own commit
- [x] 6. check script + run; --base on 868f5389 build
- [x] 7. jest after; self-debug + user sim
- [x] 8. CLAUDE.md Last Session entry; push; HEAD == origin

## Rulings
Planner 11 Oct 2026: GO. Q1 backend untouched, found-not-fixed. Q2 date only, no reason box. Q3 browser local date.

## Results
- jest 96 suites / 1537 before and after.
- `backend/scripts/sales-mark-left-date-check.py` 40/40 (fix); `--base` on 868f5389 4/4 (no field, DOL = today).
- Self-debug caught: a double click sent two PUTs (second → 400 "already Left") → ref guard; with the guard
  removed the check fails 4 (2nd PUT, console error, 400 status, API ≥ 400).
- Check-script note: Playwright sync events only pump during Playwright calls — use pg.wait_for_timeout, not time.sleep.

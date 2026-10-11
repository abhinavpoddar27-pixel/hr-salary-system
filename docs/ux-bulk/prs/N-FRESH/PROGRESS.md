# N-FRESH — PROGRESS
## State
- [x] Phase 0: code read, PLAN.md written (questions Q1–Q4)
- [x] baseline jest: 99 suites / 1566 tests
- [x] api.js fresh: getMissPunches, getNightShifts, getDayCalculations, getDayCalcStaleness (Q1), getDWEntries (added scope)
- [x] MissPunch.jsx: status query enabled only for canHR (Q4); prefix invalidation; finance decisions mark Stage 6 stale (Q2)
- [x] NightShift.jsx: invalidate ['night-shifts'] (+ ['miss-punches'] on reject)
- [x] DayCalculation.jsx: Run invalidates ['day-calculations'] prefix; { queryKey } form (Q3)
- [x] backend/scripts/fresh-reads-check.py: fix 39/39, --base on c942563f 30/30 (every stale read + finance 403 shown)
- [ ] merge origin/main, jest after, re-run check, push

## Owner/planner rulings
- Q1 yes (fresh on getDayCalcStaleness) · Q2 yes · Q3 yes · Q4 yes (gate on canHR)
- Added scope: this builder owns ALL of frontend/src/utils/api.js for the batch; add fresh to getDWEntries (P1-18).

## CLAUDE.md entry
(written at the end)

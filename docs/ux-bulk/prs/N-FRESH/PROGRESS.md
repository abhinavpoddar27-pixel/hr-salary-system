# N-FRESH — PROGRESS
## State
- [x] Phase 0: code read, PLAN.md written (questions Q1–Q4)
- [x] baseline jest: 99 suites / 1566 tests
- [x] api.js fresh: getMissPunches, getNightShifts, getDayCalculations, getDayCalcStaleness (Q1), getDWEntries (added scope)
- [x] MissPunch.jsx: status query enabled only for canHR (Q4); prefix invalidation; finance decisions mark Stage 6 stale (Q2)
- [x] NightShift.jsx: invalidate ['night-shifts'] (+ ['miss-punches'] on reject)
- [x] DayCalculation.jsx: Run invalidates ['day-calculations'] prefix; { queryKey } form (Q3)
- [x] backend/scripts/fresh-reads-check.py: fix 39/39, --base on c942563f 30/30 (every stale read + finance 403 shown)
- [x] merge origin/main (already up to date at c942563f), jest after 99/1566, check 39/39, pushed

## Owner/planner rulings
- Q1 yes (fresh on getDayCalcStaleness) · Q2 yes · Q3 yes · Q4 yes (gate on canHR)
- Added scope: this builder owns ALL of frontend/src/utils/api.js for the batch; add fresh to getDWEntries (P1-18).

## CLAUDE.md entry
## Last Session — 2026-10-11 (N-FRESH: lists stale up to 5 s after an action; finance 403 on Miss Punch)
**Branch `fix/fresh-reads-after-actions`, NOT merged.** Frontend only. Findings N-7, N-9, N-15. Plan + log:
`docs/ux-bulk/prs/N-FRESH/PLAN.md`, `PROGRESS.md`. Rulings Q1–Q4 (11 Oct).
- **Bug:** server.js sends `private, max-age=5` on every GET, so a refetch < 5 s after the last read got the browser's
  pre-action copy (Stage 6 list after Run, Miss Punch after resolve/approve/reject, Night Shift after confirm/reject).
  The pages refetched only the current filter, so other Miss Punch chips stayed stale up to 30 s (react-query staleTime),
  and a Night Shift reject never refreshed the Miss Punch list. Miss Punch called the hr/admin-only
  `GET /features/leave-automation/status` for every role → finance got a 403 + console error on load and every 30 s.
- **Fix:** `utils/api.js` adds `fresh` (no-cache) to getMissPunches, getNightShifts, getDayCalculations,
  getDayCalcStaleness and getDWEntries (for P1-18). MissPunch: status query `enabled: canHR`; every action invalidates the
  `['miss-punches']` prefix; finance approve/reject also invalidate `['day-calculations']` + `['day-calc-staleness']`.
  NightShift: invalidate `['night-shifts']` (+ `['miss-punches']` on reject). DayCalculation Run: `['day-calculations']`
  prefix; the two bare-array `invalidateQueries([...])` calls (v5 reads them as "invalidate everything") now use `{ queryKey }`.
- **Fragile:** any new action on these pages must invalidate the query-key PREFIX, not call `refetch()`. getMissPunches is
  also read by Dashboard (now no-cache there too — harmless). Finance no longer loads the auto-Stage-6 status (never could).
- **Verified:** `backend/scripts/fresh-reads-check.py` (Chromium, built dist, scratch DB, hr + finance, fictional T98xx,
  port 3133) 39/39 — every action read < 5 s after the list load shows the change; cached chips updated; rejected night
  day appears in Miss Punch without reload; no-cache on all five GETs; finance 0 console errors / 0 API ≥ 400; 390 px.
  `--base` on c942563f 30/30: every stale read reproduced + finance 403. jest 99 suites / 1566 before and after.
- **Not tested:** Railway; Safari/Firefox (`no-cache` request header); P1-18's Submit-all flow itself.

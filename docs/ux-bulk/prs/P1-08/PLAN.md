# P1-08 — PLAN (Phase 0)
Stage 5 (Attendance Register) daily grid does not refresh after a correction is saved. Finding P-4.
Base origin/main 2d96842 · branch `fix/stage5-grid-refresh` · worktree /home/claude/wt-p1-08 · server port 3108.

## What the code does today (read, 10 Oct 2026)
- Grid query — `ExpandedEmployeeDetail` (L129–133): key `['attendance-register', month, year, emp.employee_code]`,
  `getAttendanceRegister({ month, year, employeeCode })` → `GET /api/attendance/register`. One query per expanded row.
- Cell click → `onEditRecord(rec)` → `editRecord` state in the page → `CellEditor` → `updateMutation.mutate({ id: editRecord.id, data })`.
  The edited record is a row of the employee's grid, so its grid key is `['attendance-register', month, year, <that code>]`.
- `updateMutation` (L303–310) → `PUT /api/attendance/record/:id` writes `status_final`, `in_time_final`, `out_time_final`,
  `correction_remark`, `stage_5_done = 1` (attendance.js L276). onSuccess: toast, close editor, `refetchSummary()` only.
  The grid query is never invalidated → old status/time/colour until reload (or the 30 s global staleTime + a remount).
- `recalcMutation` (L312–318) → `POST /api/attendance/recalculate-metrics` UPDATEs `is_night_shift` directly (plus late /
  early / OT / shift fields). The grid's `cellClass()` paints `is_night_shift && !is_night_out_only` purple, so a recalc
  CAN change a visible cell colour → justified to invalidate too. onSuccess today: `refetchSummary()` only.
- `pbaMutation` (L320–330) already does `qc.invalidateQueries({ queryKey: ['attendance-register', month, year, code] })` — the pattern to copy.
- `Import.jsx:256` already invalidates the `['attendance-register']` prefix after an upload (no change there).

## Change (smallest)
`frontend/src/pages/AttendanceRegister.jsx` only:
1. `updateMutation.onSuccess`: add `qc.invalidateQueries({ queryKey: ['attendance-register', month, year] })` (prefix →
   every open employee grid of this month; the edited one is always among them). Keep toast / close / refetchSummary.
2. `recalcMutation.onSuccess`: the same line (recalc touches every record of the month, so the prefix is the right scope).
No other line. `qc` already exists in the component. Then `npm run build --prefix frontend`, dist in its own commit.

## Risk to check — the server's 5 s GET cache
`server.js` L143–148 sends `Cache-Control: private, max-age=5` on every `/api` GET and `getAttendanceRegister` sends no
`no-cache`. A refetch within 5 s of the previous fetch of the same URL can be answered from the BROWSER's HTTP cache with
the pre-save copy (same trap as Loans PR-4, leave lists, ED lists). Realistic: open grid → fix a day in < 5 s, or two
quick consecutive edits on one employee. The check script tests both a slow save (> 5 s after load) and a fast save
(< 5 s after load / back-to-back edits). If the fast case is stale, the fix needs `...fresh` on `getAttendanceRegister`
in `frontend/src/utils/api.js` (1 line, the house pattern) — **outside Targets → planner ruling Q1.**

## Verification
- jest full suite before (done: 85 suites / 1377 pass) and after (expect identical — no backend change).
- New `backend/scripts/stage5-grid-refresh-check.py` (pattern: salary-register-report-check.py): scratch DB, fictional
  employees T980x (one plant permanent, one second employee for the multi-grid case), fictional Sep 2026 attendance rows
  seeded after boot, real hr + admin logins, built dist, Chromium, port 3108. Checks:
  1. expand T9801, click a day showing `A` → CellEditor → status `P`, times, remark → Save → the cell shows `P` + times +
     amber "corrected" class WITHOUT reload (poll ≤ 3 s); DB row = new values.
  2. fast case: save within < 5 s of the grid load, then a second edit back-to-back → cell shows the second value.
  3. two grids open (T9801 + T9802): edit one → the edited grid updates, the other still renders correctly.
  4. Recalculate Metrics: seed a record whose stored `is_night_shift` disagrees with its punch → click → cell colour
     follows without reload.
  5. 0 page errors, 0 console errors, 0 API ≥ 400; 390 px pass for case 1.
- `--base` on an origin/main 2d96842 worktree build under /tmp: case 1 cell stays stale (proves the bug).
- Self-debug + user-simulation pass (HR fixes a miss day, edits two days quickly, recalcs) before hand-off; then v2 if needed.

## Not in scope (will report, not fix)
- Calendar View (`CalendarView`, key `['daily-attendance', code, month, year]`) on the same expanded row is also not
  invalidated after a save — same bug class, different file/key. Q2.
- A miss-punch cell edited via the generic editor keeps its red class: `PUT /record/:id` sets `stage_5_done` but not
  `miss_punch_resolved`, and `cellClass()` checks miss-punch first (pre-existing semantics; Miss Punch page owns resolution).

## Questions for the planner
- Q1: If the fast-save case is stale because of the 5 s browser cache, may I add `...fresh` to `getAttendanceRegister`
  in `utils/api.js` (one line)? Recommendation: yes — the bug otherwise survives for quick edits.
- Q2: Invalidate `['daily-attendance']` for the Calendar View in the same onSuccess (one more line, same file), or leave
  for later? Recommendation: leave (keep the PR to the finding) unless you say include.

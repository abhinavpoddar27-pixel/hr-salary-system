# P1-20 — Progress
## RESUME
Branch fix/leave-form-type-and-dates · worktree /home/claude/wt-p1-20 · port 3120 · plan: PLAN.md. Re-read this file after any compaction; never redo a ticked step.
Next step: done — handed off.

## Steps
- [x] 1. Diagnose (PROMPT, LeaveManagement.jsx ApplyLeaveModal, routes/leaves.js POST /, prod counts read-only)
- [x] 2. PLAN.md + PROGRESS.md committed + pushed — STOP for planner
- [x] 3. jest baseline (full suite, flock)
- [x] 4. Edit ApplyLeaveModal (types + date guard) — own commit
- [x] 5. Build dist (flock) — own commit
- [x] 6. Browser check script + run (+ --base on 868f5389)
- [x] 7. jest after; self-debug + user-sim pass
- [x] 8. CLAUDE.md Last Session entry; push; HEAD == origin

## Rulings
- 11 Oct 2026 planner: go. Q1 Applications filter left as is. Q2 Days keeps its value on end < start.

## Log
- jest before: 96 suites / 1537 tests; after: 96 / 1537.
- Fix commit (types + date guard), dist commit, check script committed.
- `backend/scripts/leave-form-type-dates-check.py` 28/28 (two runs). First run 27/28: the test filled start then end, so it
  passed through a valid 1-day range and Days became 1 — test sequencing, not the app; now edits only the end date.
- `--base` on an 868f5389 worktree build 7/7: Comp Off offered + submit enabled → POST 400; end < start shows Days 1,
  Submit enabled, row saved with reversed dates (days 1). First base run missed the 400 (fixed sleep raced the response;
  now waits on the response).
- Self-debug: manual Days (0.5) still works on a valid range; balance check / HR remark unchanged; picking a start after
  the end also blocks (checked); Cancel sends nothing.

## CLAUDE.md entry (moved here 11 Oct 2026 — feature PRs no longer edit CLAUDE.md)
## Last Session — 2026-10-11 (P1-20: Apply Leave offered Comp Off and accepted an end date before the start)
**Branch `fix/leave-form-type-and-dates`, NOT merged.** Frontend only (`pages/LeaveManagement.jsx`, `ApplyLeaveModal`). Plan + log:
`docs/ux-bulk/prs/P1-20/PLAN.md`, `PROGRESS.md`. Finding H-7. Rulings Q1 (Applications type filter left as is), Q2 (Days keeps its value on a reversed range).
- **Bug:** the Apply Leave type list offered "Comp Off", which `POST /api/leaves` refuses (accepts CL/EL/LWP only) → 400 on
  submit. An end date before the start showed "1 day" (`Math.max(1, diff)`) and submitted; the server has no end ≥ start
  check, so the row was saved with reversed dates as 1 day (prod: 0 such rows, 0 Comp Off rows ever).
- **Fix:** `APPLY_LEAVE_TYPES` (CL/EL/LWP, commented to match routes/leaves.js) feeds the form's select; the Applications
  filter still uses `LEAVE_TYPES`. `dateRangeInvalid` (ISO string compare) → red hint "End date must be on or after the start
  date." (`data-testid="leave-date-hint"`) + Submit disabled; Days recomputed only for a valid range; end input `min=start`.
  Comp-off tab untouched. Server untouched. dist rebuilt (own commit).
- **Fragile:** the accepted type list now lives in two places (server L105 + `APPLY_LEAVE_TYPES`) — change both. The end ≥
  start rule is UI-only.
- **Verified:** `backend/scripts/leave-form-type-dates-check.py` (Chromium, built dist, scratch DB, real hr login, fictional
  T9651–T9654, port 3120) 28/28 twice — types exactly CL/EL/LWP, hint + disabled + forced click sends no POST, Days kept,
  fixed range submits 3 days, same-day LWP 1 day, start moved after end blocks, 390px EL submit, 0 page/console errors,
  0 API ≥ 400. `--base` on an 868f5389 worktree 7/7: Comp Off → 400, reversed range saved as 1 day. jest 96 suites / 1537
  before and after.
- **Not tested:** Railway; Safari/Firefox date inputs; real production data.
- **Found, not fixed:** (1) `POST /api/leaves` has no end ≥ start check (API callers). (2) its 400 text says "Must be CL or EL"
  though LWP is allowed. (3) the Days field is free-editable and never checked against the date range.

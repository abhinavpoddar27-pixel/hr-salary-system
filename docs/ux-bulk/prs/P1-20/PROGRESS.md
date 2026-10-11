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

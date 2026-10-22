# P3-IST-BE — PROGRESS

State: **Phase 1 building (planner said go).**

## Done
- Re-grep of backend/src (92 raw hits), each classified A / B / C / D (PLAN §2).
- Production read-only counts (PLAN §6): window writes ~1 % of traffic; 0 known wrong money rows.

## Next (after "go")
1. `backend/src/utils/istDate.js` + unit tests.
2. Money sites M1–M8, then non-money sites, one commit per group.
3. `istDateFallbacks.test.js` (fake clock), `--base` on origin/main worktree, full jest, drift query.

## Rulings (planner, 22 Oct 2026)
- Q1 leave the 5 private IST copies (dailyWage, salaryChange, missPunch, attendanceReviewService, loans/close) — later clean-up.
- Q2 M7 leave /adjust + /bulk-adjust use the IST year.
- Q3 jest with pinned clock + --base proof; no Playwright.
- Q4 usage-logs stays UTC. Q5 accept "no balance" refusal 00:00–00:05 IST 1 Jan. Q6 notification de-dup stays UTC.
- Q7 no action on schema.js:3042. Q8 planner runs independent review of M1, M2, M3, M7. No PR.

## RESUME
Worktree /home/claude/wt-ist-be, branch fix/backend-ist-today (base b2badcab). Read PLAN.md §2 (site list) and the
Rulings above. If no rulings: Phase 0 is complete — wait. Never `git add -A`.

## CLAUDE.md entry
(filled at hand-off)

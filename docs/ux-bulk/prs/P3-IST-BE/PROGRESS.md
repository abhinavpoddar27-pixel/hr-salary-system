# P3-IST-BE — PROGRESS

State: **Phase 0 done — PLAN.md pushed, waiting for planner "go" + rulings Q1–Q8.**

## Done
- Re-grep of backend/src (92 raw hits), each classified A / B / C / D (PLAN §2).
- Production read-only counts (PLAN §6): window writes ~1 % of traffic; 0 known wrong money rows.

## Next (after "go")
1. `backend/src/utils/istDate.js` + unit tests.
2. Money sites M1–M8, then non-money sites, one commit per group.
3. `istDateFallbacks.test.js` (fake clock), `--base` on origin/main worktree, full jest, drift query.

## Rulings
(none yet)

## RESUME
Worktree /home/claude/wt-ist-be, branch fix/backend-ist-today (base b2badcab). Read PLAN.md §2 (site list) and the
Rulings above. If no rulings: Phase 0 is complete — wait. Never `git add -A`.

## CLAUDE.md entry
(filled at hand-off)

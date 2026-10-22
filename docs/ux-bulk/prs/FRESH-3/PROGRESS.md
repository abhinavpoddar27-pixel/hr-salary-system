# FRESH-3 — PROGRESS

## State
Phase 0 done: PLAN.md written. Waiting for the planner's rulings (Q1–Q7). No code written.

## Done
- Re-grepped `frontend/src`: exactly 18 bare-array invalidate/refetch calls, all in the 6 owned pages. None found anywhere else.
- Mapped each call to the useQuery key it refreshes, and to the read helper behind that key (`fresh` yes/no).
- Production counts, read-only (PLAN §7).

## Next
After "go": convert the 18 calls, add the extra keys the planner rules in, add `fresh` to the ruled api.js helpers,
write `backend/scripts/fresh3-check.py` (port 3501), build, run checks + `--base`, update this file.

## Rulings
(pending)

## RESUME
Worktree /home/claude/wt-fresh3 · branch fix/fresh3-prefix-invalidation · base b2badcab · port 3501.
Read PLAN.md §2 (the 18 calls), §3 (extra keys), §4 (`fresh` helpers). Owned files: Settings/Employees/Compliance/
FinanceVerification/Import/WorkforceAnalytics .jsx, the named api.js helper lines, backend/scripts/fresh3-check.py.
Stage files by name. Never use `git add -A`.

## CLAUDE.md entry
(filled in at hand-off)

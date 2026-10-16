# FRESH PROGRESS

## RESUME
Branch fix/manual-flags-fresh (base b0ed242), worktree /home/claude/wt-fresh (node_modules symlinked to wt-p6-06), port 3503.
Read PLAN.md + this file. State: BUILD — code done, checks next.

## Planner rulings (16 Oct 2026)
- Q1 yes: delete the local copy in FinanceAudit.jsx; use the api.js helper with `fresh`; keep the instant cache patch;
  replace the 6 s timer with an immediate re-read.
- Q2 not now: the other 10 reads without `fresh` and the 16 bare-array `invalidateQueries([...])` calls are registered by
  the planner as a separate PR.
- Build after P6-06.

## Steps
- [x] B1 api.js L380 `...fresh` + comment
- [x] B2 FinanceAudit.jsx: local `getManualAttendanceFlagsFresh` removed, both queries use `getManualAttendanceFlags`,
      timer → immediate `invalidateQueries({ queryKey: ['manual-flags'] })`, unused `import api` removed
- [ ] B3 build + manual-flags-fresh-check.py (+ --base) + regression (role-gaps, attendance-flags-verify-role)
- [ ] B4 jest; push; hand-off

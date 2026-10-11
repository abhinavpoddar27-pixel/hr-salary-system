# P2-11 — PROGRESS

## RESUME
Branch fix/backend-route-guards (base origin/main 80934af4), worktree /home/claude/wt-p2-11, port 3211.
State: GO received (planner, 11 Oct). Building.

## Steps
- [x] Phase 0: scan every write route behind requireAuth only (208 routes, 38 routers) → 35 unguarded + payroll.js list
- [x] Phase 0: production usage_logs counts by role/route (90 days + older), read-only
- [x] Phase 0: PLAN.md (table, change, tests, risks, Q1–Q7)
- [x] Planner "go" + rulings
- [ ] Baseline full jest (flock)
- [ ] Guards per file + backendRouteGuards.test.js
- [ ] Full jest after; live check script (+ --base)
- [ ] merge origin/main, push, report

## Rulings (planner, 11 Oct 2026)
- Q1 go with the 35-route table. Q2 DELETE /import/:id admin only. Q3 KEEP finance on PUT /attendance/record/:id and
  POST /attendance/recalculate-metrics (hr/finance/admin) — never drop a role that has ever used a route.
  Q4 POST /jobs admin only. Q5 POST /employees guard only. Q6 manual-flags verify finance+admin. Q7 payroll.js listed for owner.
- Do NOT touch dailyWage.js (P2-03). Check stageNum validation in POST /import/stage/:stage/complete; one-line whitelist + test
  allowed if it can inject, else report.

## CLAUDE.md entry
(to write at the end)

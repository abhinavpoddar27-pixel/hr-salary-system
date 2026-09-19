# PROGRESS — Contractor Report 2.1 — `feat/contractor-report-2-1`

## STATE
Phase 1 COMPLETE — all 11 acceptance checks reproduce on production **exactly, zero drift**.
Branch off main `3f0041f` (PR #44 squash merge of PR-2). Proceeding to Phase 2 (build).

## DONE
- **Preflight** — clean tree; `git fetch`; `main` fast-forwarded 23 commits to `3f0041f`
  (`Merge pull request #44 … feat/contractor-report`). PR-2 files confirmed present on main
  (config, service, route, 50-test suite, page + 5 components). SQL Console MCP `SELECT 1` → `ok=1`.
- **Branch** `feat/contractor-report-2-1` created at `3f0041f`.
- **Prompt copy** → `docs/prompts/contractor-report-2-1.md`.
- **`effectiveStatusForDay` read (read-only)** — see RULING 2.
- **Phase 1 — all 11 acceptance checks verified on production (read-only).** See NUMBERS.
  Zero drift: September, May and April all landed on the expected values on the first run.

## NEXT
Phase 2 — build A/B/C, unit tests, full backend suite, rebuild + commit `frontend/dist`,
self-debug pass, browser user-simulation pass.

## RULINGS

### RULING 1 — STOP gates are checkpoints, not pauses (owner, 19 Sep 2026)
Every STOP gate in the prompt is a checkpoint: print the gate summary, commit PROGRESS, carry
straight on. Run through Phase 3 (push the branch, verify `HEAD == origin/feat/contractor-report-2-1`,
print the PR link) and stop only there. **Never merge.**

Stop early and wait for the owner ONLY on:
1. Any April or May number differs from PR-2 acceptance, or a September number differs and the
   cause cannot be shown.
2. A backend test fails beyond the known baseline (3 TDS + flaky `protectedWrite`), or a browser
   simulation check still fails after two fix attempts.
3. The work would need a change to any DO-NOT-MODIFY file, `server.js`, `App.jsx`, `Sidebar.jsx`,
   the schema, a lockfile, or a new dependency.
4. `effectiveStatusForDay` cannot be reused and its rule is ambiguous to mirror (if clear → mirror
   it with a comment and a test and carry on).
5. Anything that would write to the database, or any access-control doubt.
6. The code review finds something that cannot be fixed within this PR's scope.

When stopping, say which number triggered it, what was found, and the recommendation.

### RULING 2 — `effectiveStatusForDay` is imported, not mirrored
`backend/src/services/dayCalculation.js:96` defines it and **line 752 exports it**:
`module.exports = { calculateDays, saveDayCalculation, getMonthDates, getDayOfWeek, WEEKLY_OFF_LENIENCY, effectiveStatusForDay };`

It is **pure** — one plain row argument, no DB handle, no I/O, no closure over mutable state,
no mutation of the argument. Body:

```js
function effectiveStatusForDay(r) {
  const isMp = r.is_miss_punch === 1;
  if (!isMp) return r.status_final || r.status_original || '';
  const fs = r.miss_punch_finance_status;
  if (fs === 'approved') return r.status_final || r.status_original || '';
  if (fs === 'rejected') return '½P';
  // 'pending' / '' / null — HR's resolution hasn't cleared finance yet
  return r.status_original || '';
}
```

Therefore the prompt's first branch applies: **import it** into the contractor report service.
No mirror copy in `contractorReportConfig.js`, no edit to `dayCalculation.js` (it stays on the
DO-NOT-MODIFY list — this is a read-only `require`).

Consequence for the build: the payroll tie-out query must return **per-day rows** (carrying
`is_miss_punch`, `status_final`, `status_original`, `miss_punch_finance_status`) so the function
can be applied per row in JS, rather than aggregating man-days in SQL off `status_final`.

## NUMBERS — Phase 1, production, read-only, 19 Sep 2026 (server `date('now')` = 2026-09-19)

Every check matched on the first run. **No drift to explain.**

| # | Check | Expected | Actual | |
|---|---|---|---|---|
| 1 | Sept: the 10 current "mismatches" (status_final rule) | 10, then 0 unexplained | 10 → **0** | ✅ |
| 2 | Sept: pending correction days for those 10 | 11 days, exact dates | **11**, exact | ✅ |
| 3 | Sept: why each gap is 1 or 2 | = that person's pending P/WOP→A count | confirmed | ✅ |
| 4 | Sept: company-wide P/WOP→A pending Finance | 20 | **20** | ✅ |
| 5 | May: unexplained mismatches | 1 — 60298 RANI 19 vs 22 | **1**, 19 vs 22 | ✅ |
| 6 | April: unexplained mismatches | 0 | **0** | ✅ |
| 7 | PR-2 acceptance April/May heads + man-days | 2278/1951/327, 2238; 2590/2197/393, 2587.5/2195/392.5 | all exact | ✅ |
| 8 | Active contract employees (excl. SECURITY, BISLERI WORKERS) | 320 | **320** (of 334 total) | ✅ |
| 9 | No punch for 30+ days (as of 19 Sep) | 231, incl. 7 never punched | **231**, **7** never | ✅ |
| 10 | Gangs with no September punch at all | 9 gangs, listed counts | exact, all 9 | ✅ |
| 11 | Meera, September grid | 51 worked · 124 no punch | **51** · **124** | ✅ |

### Detail — check 2, the 11 pending correction days
All eleven are `status_original = 'P'` → `status_final = 'A'`, `correction_source = 'Gate Register'`,
`miss_punch_finance_status = 'pending'`, `is_miss_punch = 1`:

| code | name | date(s) |
|---|---|---|
| 10026 | LALIT SADA | 1 Sep, 7 Sep |
| 10008 | LAL TUN SADA | 7 Sep |
| 10024 | VIJAY DASS | 7 Sep |
| 10039 | GANESH RAM | 7 Sep |
| 10040 | LAVKUSH RAM | 7 Sep |
| 10043 | JAI NARAYAN | 7 Sep |
| 10046 | RAM KUMAR | 7 Sep |
| 60294 | RAKSHA PAL | 7 Sep |
| 60170 | DHIRAJ KUMAR | 9 Sep |
| 60231 | ARVIND KUMAR | 1 Sep |

HR marked each worker absent from the Gate Register; Finance has not ruled, so
`effectiveStatusForDay` keeps paying `status_original = 'P'`. The report read `status_final = 'A'`,
so each showed as a false 1-day (10026: 2-day) shortfall. Applying the payroll rule closes all ten.

### Detail — check 10, gangs with nobody working in September
Moti Lal 18 · Ranjit 12 · Pappu 10 · Davinder 7 · Rajendra 4 · Jiwan Lal 3 · Sajan 3 · Amar 1 · Sonu 1
(59 Active heads across 9 gangs, zero September punches between them.)

### Detail — check 9, the 30-day rule boundary
`days_since > 30` (strictly more than 30, i.e. last punch before 2026-08-20) → **231**.
`>= 30` would give 240. The prompt's "more than 30 days before today" is therefore `> 30`.

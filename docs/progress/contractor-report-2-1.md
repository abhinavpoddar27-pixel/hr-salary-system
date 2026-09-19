# PROGRESS — Contractor Report 2.1 — `feat/contractor-report-2-1`

## STATE
Phase 0 (plan) in progress. Branch created off main `3f0041f` (PR #44 squash merge of PR-2).

## DONE
- **Preflight** — clean tree; `git fetch`; `main` fast-forwarded 23 commits to `3f0041f`
  (`Merge pull request #44 … feat/contractor-report`). PR-2 files confirmed present on main
  (config, service, route, 50-test suite, page + 5 components). SQL Console MCP `SELECT 1` → `ok=1`.
- **Branch** `feat/contractor-report-2-1` created at `3f0041f`.
- **Prompt copy** → `docs/prompts/contractor-report-2-1.md`.
- **`effectiveStatusForDay` read (read-only)** — see RULING 2.

## NEXT
Phase 1 — prove the A/B/C numbers on production for Sept (to date), May, April against ACCEPTANCE.

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

## NUMBERS
_(Phase 1 fills this in.)_

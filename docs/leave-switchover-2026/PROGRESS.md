# Leave switchover 2026 — PROGRESS

## RESUME (verbatim from PROMPT.md §9)
> Leave switchover 2026 on `feat/leave-switchover-2026`. Read `docs/leave-switchover-2026/PROGRESS.md` §Next first. Rulings R-A…R-H in §2 of PROMPT.md are final. Five changes (§3), DO-NOT-MODIFY (§4), Phase 0 gate already passed only if PROGRESS.md says "GO received". Never apply balances, never switch automation on, never push to main.

**Gate status: GO received (9 Oct 2026) with decisions 1-8 and amendments A-G below.**

## Owner rulings (verbatim from PROMPT.md §2)
- R-A **Retype**: the 98 codes in `docs/leave-switchover-2026/permanent-codes.json` become `employment_type='Permanent'`. Change a row only if `status='Active'` AND its current type equals `old_type` in the file (case-insensitive); otherwise skip and report. No other employee is touched. Salary is unaffected (salary only distinguishes contractor vs non-contractor via `isContractorForPayroll`) — prove this in tests.
- R-B **EL** = 1 per **21** days worked, rounded **down**, nothing until **180** days worked in the calendar year (`el_days_per_leave=21`, `el_eligibility_days=180`). Days worked = present + 0.5×half + worked-on-weekly-off + EL taken (unchanged R1).
- R-C **CL** = **4** for a full year (`cl_entitlement_base=4`, `cl_annual_entitlement=4`), pro-rated by effective joining **quarter**: Jan–Mar 4 · Apr–Jun 3 · Jul–Sep 2 · Oct–Dec 1. Keep the existing effective-month rule (DOJ day>1 → next month; Dec mid-month → 0). Formula: `eff>12 ? 0 : Math.ceil(base*(13-eff)/12)`.
- R-D **CL taken outside the app counts as CL used, never as days worked.** EL taken outside counts as days worked (existing behaviour).
- R-E **Outside-system leave** is uploaded by the owner through the existing grants upload, extended with an optional `Leave Type` column (EL default, CL allowed) and a `Days` column (alias of `EL Days`).
- R-F **Hand credits superseded**: `leave_transactions` ids **1** (19954 EL Credit 10), **3** (23700 EL Credit 9), **2** (23700 CL Credit 3) were HR's manual accrual estimates; the engine now computes accrual. Neutralise each with an offsetting `Debit` row (same employee/type/month/year, same days, reason `Superseded by computed accrual — leave switchover 2026 (offsets txn #N)`). Never delete or edit the originals. Leave every other transaction row alone.
- R-G **CL openings**: for every Active Permanent employee (after retype) with a 2026 `leave_balances` CL row, set `opening` = new entitlement; set 2026 EL `opening` = 0. Do not touch `used`/`balance` (the engine recomputes them). Do not create rows (the engine inserts missing rows with the computed opening). Other years untouched.
- R-H Negative balances are left visible (engine is deliberately not floored); report them. CL and EL still lapse 31 Dec. Sales are excluded (no change).

## Log
- 2026-10-09 Phase 0. Branch `feat/leave-switchover-2026` @ 94fbda6 (origin/main, PR #53 loans-pr2). Tree clean except untracked `docs/leave-switchover-2026/`.
- Baseline backend jest: **29 suites / 588 tests, 588 pass, 0 fail** (`npx jest`, 34 s). The documented TDS failures are no longer present on main.
- Frontend: `npx vite build --outDir <scratchpad>` succeeds (vite 5.4.21, 14 s, chunk-size warning only). Repo `frontend/dist` untouched.
- Production read-only check via HR SQL Console MCP (audited SELECTs, aggregates/codes only): see "Production facts" below.

## 1. Confirmed anchors (current tree, 94fbda6)
| What | file:line |
|---|---|
| `LEAVE_ELIGIBLE_TYPES` (engine, lower-case) | backend/src/services/leaveEngine.js:40 |
| `LEAVE_ELIGIBLE_TYPES` (legacy copy, unused by engine) | backend/src/services/phase5Features.js:12 |
| `selectEligibleEmployees` | leaveEngine.js:80-97 (Active + type IN list + `!isContractorForPayroll`) |
| `partitionTransactions` (DO NOT MODIFY) | leaveEngine.js:115-152 |
| `computeLeavePlan` | leaveEngine.js:196-455; policy reads :200-203 |
| extWorked block | leaveEngine.js:292-300 (`let extWorked` :295, `+=` :299, used :325) |
| CL opening logic | leaveEngine.js:271-277 (stored opening wins, computed only when no row) |
| `applyLeavePlan` (DO NOT MODIFY) | leaveEngine.js:486 |
| `seedYearOpenings` (uses clBase) | leaveEngine.js:658-667 |
| `computeClEntitlement` | backend/src/services/phase5Features.js:27-42 (doc :16-26, default base 7 :30) |
| `initCLOpening` | phase5Features.js:124; hard-coded 7 at :189-192 |
| commented examples | phase5Features.js:494-504 |
| `validateGrantRow` | backend/src/routes/phase5.js:402-441 (`el days` :418, error text :419, dupe check :427-431 keyed `leave_type='EL'`) |
| grants insert | phase5.js:466-482 (`'EL'` literal in VALUES :471) |
| route file end / mount | phase5.js:694; mounted `/api/features` with `requireAuth` at backend/server.js:212 |
| existing preview/apply routes (pattern to mirror) | phase5.js:300, :332 |
| help text | frontend/src/components/leave/LeaveAutomationTab.jsx:476-478 (modal :472-473, button :242) |
| api helpers | frontend/src/utils/api.js:206-216 |
| slRemoval CL expectations | backend/src/__tests__/slRemoval.test.js:78-96 |
| **also breaks**: leaveEngine.test.js CL | leaveEngine.test.js:330-339 (K003 Nov-20 DOJ expects 2; quarterly@base7 gives 1); :341-350 & :382 stay 7 (pre-year joiner = full base) |

Other callers (all pick up the new formula automatically, none hard-code a number):
- `computeClEntitlement`: employees.js:307-308 (new employee), :930/:1008 (bulk import), leaveEngine.js:271, :667; scripts/reseed-leave-balances-2026.js:85 (one-off script, no base → default changes 7→4; leave as-is, note it).
- `cl_entitlement_base` read: leaveEngine.js:203, :658; employees.js:307, :930; Settings.jsx:321 (hint text "one day less every two months" becomes wrong).
- `el_days_per_leave` / `el_eligibility_days`: leaveEngine.js:201-202; Settings.jsx:322-323. `runLeaveAccrual` comments only.
- `cl_annual_entitlement`: only schema.js (seed :597, migration :3325). Read by nothing.
- External grants summed into days worked: **only** leaveEngine.js:299. reports.js:493-497 reads grants but already filters `leave_type='EL'` and reports them as "EL Given Outside System", not days worked.

## 2. Policy keys
Seeded in schema.js with `INSERT OR IGNORE` (`insertPolicyIfMissing`): `el_eligibility_days` 180 (:1581, :3311), `el_days_per_leave` 20 (:3312), `cl_entitlement_base` 7 (:3313), `el_accrual_rate` 1 (:3310); `cl_annual_entitlement` 12 in the first-boot block (:597) then one-time migration `migration_cl_entitlement_7_v1` sets it to 7 (:3320-3335). Engine reads via `getPolicyNumber` with fallbacks 180 / 20 / 7.
Switchover changes them only from the apply route: `UPDATE policy_config SET value=?, updated_at=datetime('now') WHERE key=?` for the four keys (INSERT if a key is somehow missing). Re-boot cannot revert: INSERT OR IGNORE never overwrites, and the 12→7 migration is guarded by `migration_cl_entitlement_7_v1`, which is set on prod. schema.js untouched.

## 3. Columns
- audit_log: id, table_name, record_id, field_name, old_value, new_value, changed_by (default 'HR Operator'), changed_at, stage, remark, employee_code, action_type. Switchover writes these directly on the passed `db` handle (not `db.js logAudit`, which uses `getDb()`), stage=`leave_switchover_2026`.
- leave_transactions: id, employee_id, employee_code NOT NULL, company, leave_type NOT NULL, transaction_type NOT NULL, days NOT NULL, balance_after, reference_month, reference_year, reason, approved_by, created_at. No CHECK, no triggers.
- leave_balances: id, employee_id, year NOT NULL, leave_type NOT NULL, opening/accrued/used/balance REAL default 0; UNIQUE(employee_id, year, leave_type).
- leave_external_grants: … leave_type TEXT NOT NULL DEFAULT 'EL' (no CHECK), days, mode CHECK IN ('leave_taken','paid_salary','paid_cash'); UNIQUE(employee_code, year, month, leave_type, mode) — so CL+EL in the same month already fits the key.
- DATA_DIR: db.js:9 `process.env.DATA_DIR || path.join(__dirname,'../../../data')`, file `hr_system.db`. Backup dir = `(process.env.DATA_DIR || path.dirname(db.name))/backups` — identical in prod, and lets tests use a temp-file DB. `db.backup()` is async (better-sqlite3); refuse with 500 for `:memory:`.

## 4. Files and commits
Create: `backend/src/services/leaveSwitchover2026.js`; tests `leaveSwitchover2026.test.js`, `clQuarterly.test.js` (or extend slRemoval), `grantsUploadLeaveType.test.js`, `switchoverSalaryNeutral.test.js`; `backend/scripts/leave-switchover-simulation.js`.
Modify: phase5Features.js (`computeClEntitlement`, `initCLOpening`, comments), leaveEngine.js (extWorked block :292-300 + header comments :27-31 only), phase5.js (`validateGrantRow`, insert, 2 routes), LeaveAutomationTab.jsx, api.js (+2 helpers), slRemoval.test.js, leaveEngine.test.js (K003), Settings.jsx hint (amendment, if approved), `frontend/dist`, CLAUDE.md, docs/leave-automation/{OPEN_ITEMS,HOW_IT_WORKS}.md.
Commits: (1) CL quarterly — phase5Features + tests; (2) extWorked EL-only — leaveEngine + test; (3) grants Leave Type/Days — phase5 validate/insert + help text + tests; (4) switchover service + routes + tests + simulation; (5) UI card + api + Settings hint + dist; (6) docs.
DO-NOT-MODIFY md5 baseline: salaryComputation.js 9bfb9686…, dayCalculation.js ab31bcd3…, schema.js 739676a3…, payroll.js 6da31969…, recompute.js 4cd5e1b7…, leaveBalanceGuard.js 2560b27a…; plus `applyLeavePlan`/`partitionTransactions` bodies diffed by function before report.

## Production facts (read-only, 9 Oct 2026)
- 98/98 codes found, Active, current type == old_type (82 SILP, 16 Worker) → all 98 would change, 0 skips. 2 carry legacy `is_contractor=1` but non-empty type short-circuits `isContractorForPayroll` → non-contractor before and after.
- All 98 have 2026 CL (openings 6×17, 7×71, 12×10; stale `used` up to 13, balance 0) and EL (opening 0) rows. 35 joined in 2026, 12 have null DOJ.
- day_calculations 2026 for the 98: cl_used 0, el_used 0 (stale `leave_balances.used` is not from Stage 6), months to 9; 77 already ≥180 worked; 14686=260, 17575=228.5, 23540=156, 19954=214 (match the JSON).
- leave_transactions: 12 rows. #1/#2/#3 as R-F, all ref 8/2026. #4-#11 Debit days=1 Aug (23700 EL, 23725 5 EL + 2 CL) and #12 23700 CL Debit 1 Sep.
- Policy now: 20 / 180 / 7 / 7; automation false; grants_acknowledged false; 0 grants; 0 ledger rows 2026; Active Permanent 106 (only 25 with 2026 CL rows).

## Simulation expected values (R-B: EL taken outside adds to days worked)
- 14686: 260 → floor(260/21)=12 → EL 12; CL 4.
- 17575: 228.5+5=233.5 → 11 → EL 11−5=6; CL 4−4=0.
- 23540: 156+5=161 <180 → 0 → EL −5; CL 0.
- 19954: 214+6=220 → 10 → EL 10−6 (+10 txn#1 −10 offset)=4; CL 0.
(Fixture DOJs pre-2026 so CL opening=4; October has no Stage-6 row and no applications.)

## Risks / ambiguities (proposed resolutions)
1. (a) Engine reads all four keys from policy_config (fallbacks 180/20/7); no code default change needed beyond `computeClEntitlement` default base 7→4.
2. (b) CL opening: stored row opening wins; computed entitlement only for employees with no row (applyLeavePlan inserts those). So R-G must rewrite openings for the 98 + the 25 existing Permanent rows; the 81 Active Permanent without a 2026 row get the computed value at the owner's apply.
3. Between merge and switchover apply, base stays 7 but the formula is quarterly (e.g. Oct joiner 2 instead of 3). Short window; preview/apply sets 4. Accept, note in docs.
4. `initCLOpening` pre-year/null-DOJ branch is deployment-month based. Proposal: `computeClEntitlement(\`${year}-${MM(depMonth)}-01\`, year, base)` with base from policy. Guard `cl_seed_<year>_v1` makes it a no-op on prod.
5. Preview rollback: better-sqlite3 transactions auto-commit, so run inside `db.transaction` and throw a sentinel to force ROLLBACK, return the captured result. Test with md5 of 4 tables.
6. Apply has an async gap (`await db.backup`) before the sync txn; another request could write in between. The txn re-checks the guard key inside; acceptable.
7. Grants for CL with mode Paid in salary/cash: no ruling. Proposal: CL accepts only "Leave taken" (reject others with a clear message). Also add in-file duplicate detection (two identical keys in one sheet currently crash the insert on UNIQUE → 500).
8. Names in preview: phase5.js:257 says "codes and aggregates only, no names"; §3.4 asks for name. Proposal: include name (admin-only route, owner asked); state it in the code comment. Planner to confirm.
9. Double count risk (fragile, not fixable here): 23725 (5 EL + 2 CL) and 23700 (1 EL) Aug leave are in the grants file AND in attendance_processed `leave_correction` rows; partitionTransactions absorbs txns #4-#11 as finance, and Aug day_calculations el/cl_used are 0 today. If Aug Stage 6 is re-run and counts those statuses, the leave is counted twice (Stage 6 + external). Report in docs/OPEN_ITEMS.
10. Bulk employee import (employees.js:954-958) derives employment_type from `category`; the 98 still carry category SILP/Worker, so a later bulk import could retype them back. Not fixed (out of scope); document.
11. Salary neutrality: dayCalculation ignores leaveBalances for WO logic and only echoes employmentType (not persisted); salaryComputation keys on `isContractorForPayroll` only. Proof test runs Stage 6+7 before/after retype on SILP + Worker fixtures.
12. Fixture mirrors prod from the read-only facts above (types, openings 6/7/12 with used 12, 12 txns verbatim, the 44-row grants xlsx, JSON days worked); no prod writes ever.
13. Frontend build works here; dist will be rebuilt with `npm run build` in commit 5.
14. Offsets are Debit days 10/9/3 (≠1), so partitionTransactions classifies them manual — they net to 0 in month 8 against #1/#2/#3. A test asserts this.

## GO received — planner decisions
1. CL accepts only "Leave taken"; other modes → per-row error "CL can only be 'Leave taken'".
2. In-sheet duplicates (code, year, month, leave_type, mode) → per-row error, never 500; dry run reports them.
3. Names included in switchover preview; update phase5.js:257 comment (exception + why).
4. Settings.jsx hint → "CL 4 for a full year, pro-rated by joining quarter: Jan–Mar 4, Apr–Jun 3, Jul–Sep 2, Oct–Dec 1" (commit 5).
5. Merge→switchover window accepted; document in CLAUDE.md + OPEN_ITEMS.
6. initCLOpening proposal, sentinel-throw rollback, guard re-check inside apply txn: approved.
7. leaveEngine.test.js K003: update expectation + one-line comment (quarterly rule, R-C).
8. reseed-leave-balances-2026.js untouched; record in OPEN_ITEMS.
Amendments:
A. Preview + per-employee reasons flag employees with a leave_external_grants row AND an attendance_processed correction_source='leave_correction' row in same month/year: "Possible double count: outside-app leave uploaded for M/YYYY and the app also has leave corrections that month. Confirm with HR before applying." Totals counter `double_count_flags`. Info only, never blocks. Test it.
B. Document category revert risk (employees.js:954-958) in CLAUDE.md fragile + OPEN_ITEMS; preview counts retyped employees still category SILP/Worker. Never change category.
C. Salary-neutral proof includes a SILP fixture with is_contractor=1: non-contractor, identical money before/after, leave-eligible after retype.
D. Simulation asserts the 4 rows (EL earned/closing, CL closing), offsets net 0 per (emp,type,month 8), second apply refused with balances unchanged; prints compact table.
E. Commit 6 includes PROMPT.md, PROGRESS.md, permanent-codes.json, leave-outside-system-2026.xlsx; simulation reads json+xlsx from that path. Every commit ends with the two trailer lines (Co-Authored-By / Claude-Session).
F. Do NOT push. Local commits only; report local SHA.
G. No more prod queries.

## Next
Build complete (commits 1-6 + review-fix commit). Planner verifies, then pushes. Builder does not push.

## Build log
- Commit 1 4d4dd4a CL quarterly. Suite 588→593 green. Next: commit 2 extWorked EL-only (leaveEngine.js:292-300).
- Commit 2 e1b9b07 extWorked EL-only (leaveEngine.js:299 guard + header comments). New R-D test fails on old engine, passes now. Next: commit 3 grants Leave Type/Days (phase5.js:402-482, LeaveAutomationTab.jsx:476).
- Commit 3 8998519 grants Leave Type/Days + CL leave-taken only + in-sheet dups; 7 new tests. Next: commit 4 switchover service + routes.
- Commit 4 6daf07e switchover service + routes + 12 tests + simulation (19/19 PASS). Suite 613/613 (32 suites). Next: commit 5 UI card + api + Settings hint + dist.
- Commit 5 fe678c9 LeaveSwitchoverCard + api helpers + Settings hint + dist rebuilt (bundle grep confirms SWITCHOVER 2026, quarterly hint, Leave Type help). Next: commit 6 docs.
- Commit 9430cea review fixes v2 (type labels, Already Permanent, card refresh, dead dup check) + dist. Next: v2 full re-run (suite x3, simulation), then commit docs.
- v2 re-run after review fixes: suite 613/613 x3 (32 suites); simulation 19/19 PASS; DO-NOT-MODIFY md5 unchanged
  (salaryComputation 9bfb9686, dayCalculation ab31bcd3, schema 739676a3, payroll 6da31969, recompute 4cd5e1b7,
  leaveBalanceGuard 2560b27a); applyLeavePlan md5 6cfea971 and partitionTransactions md5 6c748d52 identical at
  94fbda6 and HEAD; no sales source file changed (dist chunks only rehashed).
- Review findings fixed in v2: EL-only labels on grants table/dry run/delete audit; "Already Permanent" skip
  reason after apply; card stale after re-preview; dead duplicate-code query. Not fixed (documented): OI-15
  soft-deleted grants block re-upload.
- Commit 6 docs: CLAUDE.md Section 0, OPEN_ITEMS (rulings + OI-11..15), HOW_IT_WORKS rules + switch-on 1a/2,
  this pack (PROMPT.md, PROGRESS.md, permanent-codes.json, leave-outside-system-2026.xlsx).


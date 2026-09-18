# LEAVE AUTOMATION — FULL BUILD

Fresh session; analyse the plan, then build it end to end, backend + UI, without stopping.
Work through every phase in order, in one session, on one branch, one commit per phase.
No questions. No waiting for approval. Owner rulings below are final; anything not covered,
pick the safest option, record it in `docs/leave-automation/PROGRESS.md` under DECISIONS, keep going.

## CONTEXT

### Repo and stack
- Private repo `abhinavpoddar27-pixel/hr-salary-system`. Owner: Abhinav Poddar, Operations Director,
  Indriyan Beverages Pvt. Ltd. / Asian Lakto Industries Ltd., Ludhiana.
- `backend/` — Node 20 + Express, SQLite via better-sqlite3 (synchronous: `db.prepare(...).run/get/all`,
  `db.transaction(fn)`). README/project description say PostgreSQL — they are WRONG; it is SQLite.
  No ORM, no async DB calls.
- `frontend/` — React 18 + Vite + Tailwind, `@tanstack/react-query`, `react-hot-toast`, zustand
  (`useAppStore.selectedMonth/selectedYear` shared month/year slot).
- Railway serves the committed `frontend/dist/` directly — a frontend source change with no rebuilt,
  committed dist is invisible in production.
- Tests: jest in backend — `cd backend && npx jest`, specs in `backend/src/__tests__/`. TDS specs are
  already red on `main` (deliberate owner decision); report only NEW failures.
- Every test/simulation builds its own DB: `const {initSchema} = require('./src/database/schema')` then
  `initSchema(new Database(':memory:'))` or an `fs.mkdtempSync` file. `NODE_ENV=test`.
- Never touch the production database, never call the production URL, never run
  `backend/scripts/reseed-leave-balances-2026.js`.

### The business
- Two companies, ~265-300 employees, ~25 departments. Monthly plant payroll on the calendar month,
  from EESL biometric exports. Contractors are daily-wage and excluded from all leave.
- Seven-stage pipeline per (month, year, company), tracked by `monthly_imports.stage_1_done …
  stage_7_done` and `is_finalised`: 1 Import · 2 Miss Punches · 3 Shift Check · 4 Night Shift ·
  5 Corrections · 6 Day Calc · 7 Salary.
- `attendance_processed.status_final`: `P`, `A`, `WO`, `WOP`, `½P`/`HP`, `WO½P`, `NH`. Anything
  unrecognised counts as absent (the "ghost status" catch-all).
- Day calculation (`services/dayCalculation.js`):
  `payable = workingDays + paidWeeklyOffs + paidHolidays − (absent + halfDays + unpaidLeave) + WOP + manualGrants`.
  EL restores a payable day; CL, LWP and SL reclassify an absence without restoring pay; comp-off (OD)
  restores the day as present and is folded into `days_present`; a miss punch counts only once finance
  has decided it (`effectiveStatusForDay`, ~:96-105 — HR's fix alone is ignored).
- Money never moves without a human: HR computes Stage 7 and finalizes.

### The leave system as it exists today
- Tables: `leave_balances` · `leave_accrual_ledger` · `leave_applications` (no `created_at`) ·
  `leave_transactions` · `compensatory_off_requests` · `short_leaves` · `holidays`.
- Columns: `day_calculations.cl_used / el_used / sl_used / lop_days / od_days / short_leave_days /
  uninformed_absent`; `salary_computations.cl_days / el_days / lwp_days / od_days / short_leave_days /
  uninformed_absent_days` (display only — pay flows through `total_payable_days`).
- Engine: `services/phase5Features.js` — `runLeaveAccrual`, `initCLOpening`, `yearEndLapse`,
  `computeClEntitlement`. Called from exactly one place: `POST /accrue-leaves` in `routes/phase5.js`,
  mounted at `/api/features`. Nothing calls it at finalize, no scheduler, no UI button.
- Routes: `routes/leaves.js` (`/api/leaves`, 15 endpoints, no role guard) · `routes/compensatoryOff.js` ·
  `routes/short-leaves.js` · `routes/phase5.js` (`/api/features`) · leave-touching parts of `payroll.js`,
  `import.js`, `financeAudit.js`, `reports.js`, `employeePortal.js`, `employees.js`.
- UI: `pages/LeaveManagement.jsx` · `components/GatePasses.jsx` · `pages/DayCalculation.jsx` ·
  `pages/SalaryComputation.jsx` · `pages/DailyMIS.jsx` · `pages/EmployeeProfile.jsx` · `pages/Settings.jsx` ·
  `pages/MissPunch.jsx` · `pages/Import.jsx` · `pages/Reports.jsx` · `components/ui/CalendarView.jsx` ·
  `utils/api.js` · `utils/abbreviations.js` · `utils/payslipPdf.js`.
- Dead-but-shipping helpers in `utils/api.js`: `getLeaveAccrualLedger`, `getLeaveAnnualSummary`,
  `accrueLeaves`, `bulkAdjustLeaves`.

### House rules (non-negotiable)
- Feature branch only, never commit to `main`, never `push --force`, never open or merge a PR.
- Fragile files — change only where a phase explicitly says so, never opportunistically:
  `services/salaryComputation.js`, `services/dayCalculation.js`, `database/schema.js`, `routes/payroll.js`.
- UPSERT completeness: every `ON CONFLICT DO UPDATE SET` list must cover every column in its INSERT list
  (minus deliberate exceptions stated in a phase).
- Any change touching salary or day calculation ends with the drift check —
  `SELECT employee_code, net_salary, gross_earned, total_deductions,
   ABS(net_salary-(gross_earned-total_deductions)) d FROM salary_computations
   WHERE month=? AND year=? ORDER BY d DESC LIMIT 20` — any `d > 1` means stop and fix, never commit.
- Smallest possible change; targeted edits, never a rewrite of a core file.
- PII: never put a name, PAN, Aadhaar, bank account, address or phone into a response, log line, CSV,
  doc or commit message. Employee codes and aggregates only.
- Auth/roles: `middleware/roles.js` exports `roleIn`, `requireHrOrAdmin`, `requireFinanceOrAdmin`,
  `requireAdmin`, `requirePermission`, all normalising through `normalizeRole` from `routes/auth.js`.
  Roles: admin, hr, finance, viewer, supervisor, employee. `config/permissions.js` is enforced nowhere.
- Audit: `logAudit(table, recordId, field, oldValue, newValue, stage, remark, changedBy)`.
  Notifications: `INSERT INTO notifications (role_target, type, title, message, link, action_url)`.
- Server clock is UTC; owner is IST (UTC+5:30). Existing nightly cron `'30 3 * * *'` = 09:00 IST.
  Any date arithmetic on "today" must be done in IST.
- Excel/CSV for humans: UTF-8 with BOM; never emit `DD-MM-YYYY` strings — use separate year and month
  integer columns.

### Context budget
- Read this file once, then load only the phase you are working on:
  `sed -n '/^## PHASE 4/,/^## PHASE 5/p' docs/leave-automation/PROMPT.md`.
  Re-read the rules: `sed -n '/^## NEVER-STOP/,/^## PHASE 0/p' …`.
- Exploratory reading through parallel Explore subagents. Anchor maps only (file, symbol, line range,
  one-line note), capped at 40 lines. Never let a subagent paste file bodies back.
- In your own context, read with `sed -n 'START,ENDp' file`, never `cat` a file over ~200 lines.
- Never paste code or query output into PROGRESS.md. Keep it under 150 lines.
- Commit after every sub-step.

### RESUME BLOCK
- Branch `feat/leave-automation` · prompt `docs/leave-automation/PROMPT.md` ·
  state `docs/leave-automation/PROGRESS.md` · plan `docs/leave-automation/BUILD_PLAN.md`.
- PROGRESS.md sections: PHASE STATUS (P0–P9) · FILES TOUCHED · DECISIONS · OPEN ITEMS ·
  TEST RESULTS · NEXT.

## NEVER-STOP RULES
- No question to the owner, ever. No "should I…". No waiting.
- Blocked (a test won't pass after 3 attempts, a change needs data you don't have, two rulings conflict):
  revert or reset only that sub-step, write it under OPEN ITEMS with the exact file/line and what it
  would need, move to the next phase. Never abandon the run.
- Never merge or open a PR. Push the branch, print the final report, stop.

## OWNER RULINGS (final — do not reopen)
1. EL accrues on DAYS WORKED = `days_present + 0.5 × days_half_present + days_wop + el_used`.
   Paid Sundays and paid holidays do NOT count. Do NOT add `od_days` — `dayCalculation.js` already
   folds approved comp-off into `days_present` (~:436-438), so adding it double-counts.
2. EL eligibility = 180 days worked in the same calendar year (`policy_config.el_eligibility_days`).
   Below it: earned = 0, but still show days worked and days remaining. At or above it:
   `earned = floor(days_worked_ytd / 20) × el_accrual_rate`.
3. Year end: CL and EL both lapse on 31 Dec. No carry-forward, no encashment.
4. Finalized months are never recalculated. A change that would affect one raises a flag for HR instead.
5. Salary (Stage 7) never recomputes automatically. The salary page shows a "needs recompute" banner;
   HR clicks Compute.
6. Stage 6's first run for a month is automatic once every miss punch for that company-month is resolved
   by HR and decided by finance (approved or rejected).
7. CL = 7 days, pro-rated by joining month (Jan-Feb 7, Mar-Apr 6, May-Jun 5, Jul-Aug 4, Sep-Oct 3,
   Nov-Dec 2, via `computeClEntitlement`). The hard-coded `12` in `routes/employees.js` must go.
8. SL is abolished. Remove it from every write path, form and setting. Keep the `sl_used` column and all
   historical display so old records still render.
9. No automatic backfill of balances. Ship with automation OFF
   (`policy_config.leave_automation_enabled='false'`); the engine's apply path must refuse to write
   balances until either the external-grants list is uploaded or an explicit "no external grants"
   acknowledgement exists. Switching on is a one-click owner action in the new Automation tab.
10. Past Day-Calculation-screen leave edits are not converted. HR re-enters September leaves through
    Leave Management.

## KNOWN DEFECTS THIS BUILD MUST FIX
a. EL chains off the previous ledger row → a skipped month restarts the running total at 0
   (`phase5Features.js` ~:169-200).
b. Half days contribute 0 instead of 0.5 (`days_half_present` selected and never used, ~:133).
c. Comp-off counted twice (ruling 1).
d. EL used taken from `leave_applications` by start-date month (~:147) while day calc counts day by day
   (~:442-472) → disagreement for leave spanning a month end.
e. The day-calc lookup filters on the employee's `company` (~:136) → employees stored with company
   `'null'` or blank earn nothing.
f. `runLeaveAccrual` rewrites `leave_balances.balance` from its own ledger → wipes manual adjustments
   and any finance-screen debit.
g. `saveDayCalculation` overwrites `total_payable_days` / `lop_days` but not `late_deduction_days`
   (~:636-730) → every Stage 6 re-run silently undoes HR's late deduction
   (route that sets it: `payroll.js` ~:1083-1110).
h. `financeAudit.js` apply-leave (~:552-640) hand-patches `day_calculations` (`payable + 1` for CL),
   has no role guard, allows negative balances, writes no leave application.
i. `employeePortal.js` leave-history (~:69-74) orders by `created_at`, which `leave_applications`
   doesn't have → the page 500s. Its leave-apply (~:57) validates nothing.
j. `POST /accrue-leaves` (`routes/phase5.js` ~:33) has no role guard.
k. `routes/leaves.js` has no role guard anywhere.
l. `cl_annual_entitlement` seeded `'12'` (`schema.js` ~:633) and read by nothing; Settings exposes
   `cl_per_year`, `el_per_year`, `sl_per_year`, none of which the engine reads.

## PHASE 0 — ANALYSE, THEN WRITE THE BUILD PLAN (no code)
- `git status --porcelain --untracked-files=no | wc -l` must be 0. Then
  `git fetch --all --prune --quiet && git switch -c feat/leave-automation origin/main`.
- Create `docs/leave-automation/`, save this prompt as `PROMPT.md`, create `PROGRESS.md`.
- Dispatch four parallel Explore subagents, each returning an anchor map only (≤40 lines, no file bodies):
  1. leave engine + schema: `services/phase5Features.js`, the leave tables and policy seeds in
     `database/schema.js`, `safeAddColumn`, the `migration_*_v1` guard pattern, `config/schemaReference.js`.
  2. pipeline: `routes/payroll.js` (`/calculate-days`, `/compute-salary`, `/finalise`, readiness checklist
     ~:1140-1200, late-deduction route), `services/dayCalculation.js` (leave block, contractor branch,
     `saveDayCalculation`, exported helpers), `routes/import.js` (`runReimportRecompute`, confirm path),
     `services/jobQueue.js`, `services/monthEndScheduler.js`.
  3. leave routes: `routes/leaves.js`, `routes/compensatoryOff.js`, `routes/short-leaves.js`,
     `routes/attendance.js` (miss-punch resolve/bulk-resolve), `services/missPunch.js`,
     `routes/financeAudit.js` (apply-leave, miss-punch finance review), `routes/employeePortal.js`,
     `routes/employees.js` leave seeds, `middleware/roles.js`.
  4. frontend: every page/component listed in CONTEXT — for each, the sections that touch leave, with
     line ranges, plus the file's conventions (query keys, toast usage, role checks).
- Then write `docs/leave-automation/BUILD_PLAN.md`: per phase, exact files/functions to change, new files,
  new tables/columns, every trigger call site with file:line, every UI change by component and section,
  and the test list. Note any conflict between a ruling and the code as a DECISION. Commit.

## PHASE 1 — SCHEMA (idempotent, additive only)
In `schema.js`, following its existing `safeAddColumn` / `safeCreateIndex` / `migration_*_v1` conventions:
- New table `leave_external_grants`: id, employee_code, employee_id, year, month,
  leave_type (default 'EL'), days REAL, mode TEXT (`leave_taken` | `paid_salary` | `paid_cash`),
  paid_month, paid_year, remark, source_file, uploaded_by, uploaded_at, is_active INTEGER DEFAULT 1.
  UNIQUE(employee_code, year, month, leave_type, mode). Index on (employee_code, year).
- New table `leave_change_flags`: id, employee_code, company, month, year, reason TEXT, detail TEXT,
  created_at, cleared_at, cleared_by. Index on (year, month, cleared_at).
- New table `leave_recompute_runs`: id, scope TEXT (`trigger`|`nightly`|`manual`|`auto_stage6`), company,
  month, year, employee_count, started_at, finished_at, status, message.
- `safeAddColumn('day_calculations','salary_stale','INTEGER DEFAULT 0')`,
  `('day_calculations','leave_recomputed_at','TEXT')`, `('monthly_imports','stage_6_auto_at','TEXT')`.
- Policy keys, each `INSERT OR IGNORE` OUTSIDE the `if (policyCount.cnt === 0)` block:
  `el_accrual_rate`='1', `el_eligibility_days`='180', `el_days_per_leave`='20',
  `cl_entitlement_base`='7', `leave_automation_enabled`='false', `leave_auto_stage6_enabled`='true',
  `leave_recompute_debounce_seconds`='45', `leave_external_grants_acknowledged`='false'.
- Guarded one-time `migration_cl_entitlement_7_v1`: set `cl_annual_entitlement` to '7', and delete the
  unused `sl_per_year` row only if it still holds its seeded value — otherwise leave it and note it in
  OPEN ITEMS.
- Update `config/schemaReference.js` with the leave tables and every leave column on `day_calculations`
  and `salary_computations`.
- Never rebuild or drop a table. Verify: a fresh temp DB boots clean, and booting a second time adds
  nothing and errors nowhere. Commit.

## PHASE 2 — LEAVE ENGINE (new file: pure compute + explicit apply)
New `backend/src/services/leaveEngine.js`:
- `computeLeavePlan(db, { year, employeeCodes })` — pure, no writes. Recomputes from January every time;
  never reads a previous ledger row for state (fixes a).
  - Employees: `status='Active'` AND `LOWER(TRIM(employment_type))='permanent'` AND not
    `isContractorForPayroll(emp)` (`utils/employeeClassification.js`).
  - Day-calc lookup on `employee_code + month + year` only (fixes e).
  - Days worked per ruling 1, half days at 0.5 (fixes b, c); running total across the year;
    earned per ruling 2.
  - `used`: `day_calculations.el_used` / `cl_used` for months that have a row; for months without one,
    expand approved `leave_applications` day by day, skipping the weekly off and holidays (reuse exported
    `getDayOfWeek` / `getMonthDates`; if the date-expansion helper isn't exported, write a small local one
    — do not edit `dayCalculation.js` for this). Fixes d.
  - `external`: `leave_external_grants` where `is_active=1`, per month. `mode='leave_taken'` also counts
    as days worked for accrual; `paid_salary` and `paid_cash` do not.
  - `adjustments`: net of the manual `leave_transactions` rows written by `leaves.js` `/adjust` and
    `/bulk-adjust` (~:397, ~:517). Rows from the finance apply-leave path (`financeAudit.js` ~:622, also
    type `'Debit'`) must be excluded — choose the discriminator from the data, record it in DECISIONS,
    and return those rows as `unresolved_finance_rows`.
  - CL: opening = `computeClEntitlement(doj, year)` reading `cl_entitlement_base`; used as above;
    no monthly accrual.
  - Balance = opening + earned − used − external + adjustments, 2 dp (fixes f). Returns per-employee-
    per-month rows plus a per-employee summary: `days_worked_ytd`, `eligible`, `days_to_eligibility`,
    `current_balance`, `new_balance`, `delta`, `reasons[]`.
- `applyLeavePlan(db, plan, { actor, allowWrite })` — one transaction. Upserts `leave_accrual_ledger`
  (the `DO UPDATE` list carries every INSERT column except `lapsed`) and updates `leave_balances`
  (accrued, used, balance); writes a `leave_recompute_runs` row. Refuses to write when
  `leave_automation_enabled='false'` and `allowWrite` isn't explicitly true, and refuses when
  `leave_external_grants` is empty and `leave_external_grants_acknowledged='false'` (ruling 9).
- `recomputeLeaves(db, { year, employeeCodes, dryRun = true, scope, actor })`.
- `runYearEndLapse(db, year, { dryRun })` — CL and EL to 0, `lapsed` recorded in the ledger, a
  `Year-End Lapse` row in `leave_transactions`, and a report.
- `seedYearOpenings(db, year)` — CL openings for a new year, idempotent.
- Rewrite `phase5Features.js` `runLeaveAccrual` as a thin wrapper over
  `recomputeLeaves({ dryRun:false, allowWrite:true, scope:'manual' })`, keeping its export name and return
  shape. Keep `computeClEntitlement` but have it read `cl_entitlement_base`. Touch nothing else there.
- Tests `backend/src/__tests__/leaveEngine.test.js`: five months of full attendance · half days 0.5 ·
  comp-off counted once · Sundays and holidays excluded · a skipped month doesn't reset the total ·
  leave spanning a month end · 179 vs 180 days worked · a manual credit survives a recompute ·
  external `leave_taken` counts as worked while `paid_salary` doesn't · an employee with company `'null'`
  is still matched · contractor and non-permanent skipped · a dry run writes nothing · two runs identical ·
  apply refused while automation is off with nothing acknowledged. Commit.

## PHASE 3 — ONE SHARED STAGE 6 + LATE-DEDUCTION PRESERVATION
- New `backend/src/services/recompute.js`: `recomputeDays(db, { company, month, year, employeeCodes,
  requestId })` lifted verbatim from `payroll.js POST /calculate-days` orchestration (auto-WOP grants,
  manual extra duty, finance ED, approved leave, approved comp-off, `calculateDays`, `saveDayCalculation`),
  plus `recomputeSalary(db, …)` lifted from `POST /compute-salary`. No behaviour change.
- Re-point `payroll.js /calculate-days`, `jobQueue.js day_calculate` and `import.js runReimportRecompute`
  at it and delete the duplicated bodies. This is the one sanctioned edit to `payroll.js`.
- Fix defect g: inside `recomputeDays`, after `saveDayCalculation`, re-apply any stored
  `late_deduction_days` for that employee-month exactly as the late-deduction route computes it.
  Cover with a test.
- `recomputeDays` sets `salary_stale=1` and `leave_recomputed_at` on every row it writes, except when
  called from the salary-compute path.
- Golden proof `backend/src/__tests__/recomputeParity.test.js`: seed a month, run the original
  orchestration and the new service against two copies of the same temp DB, assert `day_calculations`
  rows match field by field except the late-deduction fix and the new columns. Commit.

## PHASE 4 — TRIGGERS, AUTOMATIC STAGE 6, FLAGS
New `backend/src/services/leaveTriggers.js`:
- `queueLeaveRecalc(db, { company, month, year, employeeCodes, reason, actor })` — de-duplicates against
  a pending job for the same company-month inside `leave_recompute_debounce_seconds`, merging employee
  codes; when `leave_automation_enabled='false'` it writes a `leave_recompute_runs` row with status
  `skipped_disabled` and queues nothing.
- `isMonthFinalized(db, company, month, year)` from `monthly_imports.is_finalised`. If finalized: write a
  `leave_change_flags` row and do not queue (ruling 4).
- `checkAutoStage6(db, company, month, year)` — ruling 6. Green when zero rows with `is_miss_punch=1 AND
  (miss_punch_resolved=0 OR miss_punch_finance_status IS NULL OR miss_punch_finance_status='' OR
  miss_punch_finance_status='pending')`, `stage_6_done=0`, not finalized, and
  `leave_auto_stage6_enabled='true'`. On green: queue a full-month `day_calculate` then `leave_recalc`,
  stamp `monthly_imports.stage_6_auto_at`, insert a notification.
- New `jobQueue.js` job types `leave_recalc` and `leave_nightly`; existing types keep working.
- Wire triggers after the caller's transaction commits, never inside it, and never let a trigger failure
  fail the request: `leaves.js` approve/reject/cancel/adjust/bulk-adjust · `financeAudit.js` apply-leave
  and miss-punch finance review · `attendance.js` miss-punch resolve and bulk-resolve (then
  `checkAutoStage6`) · `compensatoryOff.js` finance-review, bulk-review, delete · `import.js` confirm,
  both first import and reimport (then `checkAutoStage6`) · `employees.js` create and update when DOJ or
  employment type changes.
- Scheduler (`monthEndScheduler.js`): extend the existing 09:00 IST cron (`'30 3 * * *'`) with a sweep
  that recomputes leave for every non-finalized month of the current year, runs the drift query and logs
  the outcome. Add a 00:05 IST daily check (`'35 18 * * *'`) that calls `seedYearOpenings` on 1 Jan and
  `runYearEndLapse` on 31 Dec, both guarded so a restart can't double-run.
- Tests: two events merge into one job · a finalized month raises a flag and queues nothing · auto Stage 6
  fires only when both miss-punch counters are zero · a throwing trigger doesn't break its caller ·
  automation off records `skipped_disabled`. Commit.

## PHASE 5 — API
In `routes/phase5.js` (mount `/api/features`; import `requireAdmin` / `requireHrOrAdmin` from
`middleware/roles.js` instead of the local helper, and delete the local one):
- `GET /leave-recompute/preview?year=&company=&format=json|csv` (admin) — dry-run summary + per-employee
  rows: code, current, new, delta, days worked, eligibility, reasons, `unresolved_finance_rows`.
  CSV UTF-8 with BOM. Codes only, no names.
- `POST /leave-recompute/apply` (admin) — body `{ year, confirm: true, note }`; refuses per ruling 9;
  writes a run row and an `audit_log` entry naming the actor.
- `POST /leave-external-grants/upload` (admin, multipart) — `.xlsx`/`.csv` with columns Employee Code,
  Employee Name, Company, Year, Month, EL Days, How Given, Paid In Salary Month, Paid In Salary Year,
  Remark; "How Given" maps Leave taken→`leave_taken`, Paid in salary→`paid_salary`,
  Paid in cash→`paid_cash`. Reuse the repo's existing `xlsx@0.18.5` parsing style. `?dryRun=true`
  (default) returns per-row accept/reject with reasons; `dryRun=false` inserts and sets
  `leave_external_grants_acknowledged='true'`.
- `GET /leave-external-grants?year=` · `DELETE /leave-external-grants/:id` (soft, `is_active=0`) ·
  `POST /leave-external-grants/acknowledge-none` (all admin, audited).
- `GET /leave-automation/status` (hr+admin) — automation and auto-Stage-6 flags, queue depth, last run per
  scope, last nightly sweep, `stage_6_auto_at` per month, open flag count, stale-salary count per month.
- `POST /leave-automation/settings` (admin) — toggles the two policy keys, audited.
- `GET /leave-change-flags?year=&month=` · `POST /leave-change-flags/:id/clear` (hr+admin).
- `GET /leave-lapse-report?year=&format=json|csv` (hr+admin).
- `GET /salary-stale?month=&year=&company=` (hr+admin) — count plus employee codes.
Also in this phase: `POST /accrue-leaves` → `requireHrOrAdmin` (defect j). `routes/leaves.js` →
router-level guard: reads for hr/finance/admin/viewer, every write for hr/admin (defect k).
`financeAudit.js` apply-leave → `requireFinanceOrAdmin`, rewritten to create an approved
`leave_application` (mandatory remark, balance hard-block, finalized-month block) and queue a recalc
instead of hand-patching (defect h). `employeePortal.js` → leave-history `ORDER BY applied_at DESC`;
leave-apply validates type ∈ {CL, EL, LWP}, checks balance, blocks finalized months, sets `employee_id`
(defect i). Commit.

## PHASE 6 — SL REMOVAL + CL 7
- `dayCalculation.js`: delete the `SL` consumption branch (~:464-466) so an SL row can no longer change
  pay; keep the `sl_used` field and column; leave the contractor branch alone.
- `routes/employees.js`: delete both hard-coded CL `12` writes and seed through `computeClEntitlement`.
- Reject `SL` in every remaining write path (`leaves.js` submit/approve/adjust, portal, finance
  apply-leave) with the message already used at `leaves.js:354`.
- Leave every historical read path that renders SL intact, except the live inputs removed in Phase 7.
- Tests: an SL application no longer changes payable days; a new employee gets 7 pro-rated by joining
  month. Commit.

## PHASE 7 — UI / UX (source and a rebuilt, committed `frontend/dist`)
Keep existing conventions: Tailwind `card`/`label` classes, react-query with
`queryClient.invalidateQueries`, react-hot-toast, `normalizeRole` for role checks, no browser storage.
Add every new endpoint to `utils/api.js`.
- **LeaveManagement.jsx**
  - Applications: send the logged-in user on approve/reject (currently hardcodes `'admin'`). Approve
    dialog shows balance now → balance after; approve disabled when short. Toast + invalidate day-calc,
    balances and automation-status queries.
  - Balances: columns Opening · Earned YTD · Used (app) · Used (outside) · Adjustments · Balance ·
    Days worked YTD · Eligibility chip · Last recalculated. Search, company filter, CSV export.
    Row expands into the month-by-month ledger (wire `getLeaveAccrualLedger`).
  - Adjustments: reason mandatory; live "resulting balance"; negative result blocked behind an explicit
    "Allow negative" checkbox plus reason.
  - New "Automation" tab, admin only: status cards (Automation ON/OFF toggle, Auto Stage 6 ON/OFF toggle,
    queue depth, last nightly sweep, last recompute per scope) · the flag list with Clear buttons ·
    buttons: Preview EL recompute (modal with summary, per-employee table, CSV download, Apply disabled
    until a grants list exists or "No external grants" is acknowledged, typed confirmation),
    Upload EL-given list (drag-and-drop → dry-run table → Commit), Download lapse report.
    Loading, empty and error states for every card.
  - Comp Off tab: switch its role check to `normalizeRole`.
- **DayCalculation.jsx**: Apply-Leave modal loses the SL option and SL tile (CL/EL/LWP only), shows
  balance now → after, requires a remark, creates a leave application through the rewritten endpoint →
  toast plus invalidation. Add an OD column. Amber dot + tooltip "Salary needs recompute" where
  `salary_stale=1`. Update legend and tooltips (no SL).
- **SalaryComputation.jsx**: amber banner when stale count > 0 — "Day calculation changed for N employees
  since salary was computed. Click Compute Salary to refresh." — with an expander listing codes and a
  Compute shortcut. Finalize blocked while stale > 0, with an admin-only override requiring a reason
  (audited). Banner clears at 0.
- **EmployeeProfile.jsx** leave tab: replace the SL card with "Days worked YTD" and an EL-eligibility
  card; show Opening / Earned / Used / Outside / Adjustments; monthly table gains Days worked and
  EL earned; historical SL stays visible in the timeline.
- **MissPunch.jsx**: status strip — "Pending: X awaiting HR · Y awaiting finance. Stage 6 runs
  automatically when both reach 0." — turning green with the timestamp once `stage_6_auto_at` is set;
  toast after resolve/bulk-resolve.
- **Import.jsx**: after confirm, an "Automatic Stage 6" card — waiting on miss punches / queued /
  done at HH:MM IST.
- **Settings.jsx**: drop `sl_per_year`; rename the group to "Leave Rules"; expose `cl_entitlement_base`,
  `el_days_per_leave`, `el_eligibility_days` and the two automation toggles, each with a plain-language
  hint; remove `cl_per_year` / `el_per_year` if nothing reads them (record in DECISIONS).
- **Reports.jsx** Leave Reports: relabel the SL column "SL (historical)"; add Days worked, EL earned and
  Outside-system EL; keep the xlsx export working.
- **DailyMIS.jsx**: drop SL from the on-leave display order; keep CL/EL/LWP/OD and their colours.
- **CalendarView.jsx**: add CL / EL / LWP / OD styles, labels and legend entries.
- **Sidebar.jsx**: a small count badge on Leave Management for open flags (hr/admin only).
- Every changed screen works at 1280px and tablet width, keeps contrast on amber and green chips, and has
  a sensible empty state.
- Then `cd frontend && npm run build` and commit `frontend/dist`. Commit.

## PHASE 8 — SELF-DEBUG, SIMULATION, V2 PASS
1. Self-debug: re-read the whole diff. Check every `DO UPDATE` list against its INSERT list; every new
   query's columns against `schema.js`; the 180 boundary; 2-dp rounding; IST vs UTC in both crons; that no
   trigger runs inside a transaction; that no response, log, CSV or commit message contains a name, PAN,
   Aadhaar, bank detail or phone.
2. `cd backend && npx jest` — all new specs green; report any NEW failure.
3. End-to-end simulation `backend/scripts/leave-automation-simulation.js`, temp DB only, asserting every
   step: seed 2 companies, ~20 employees (permanent, contractor, non-permanent, blank company, mid-year
   joiner, an employee under 180 days), holidays, a month of attendance with miss punches.
   - happy path: import → HR resolves miss punches → finance decides → automatic Stage 6 fires →
     EL/CL computed → approve a leave → day calc and balance both move → compute salary → stale banner
     count returns to 0 → finalize.
   - edge cases: leave approved in a finalized month raises a flag and changes nothing · bulk-resolving
     50 miss punches queues exactly one job · a manual credit survives the next recompute · leave spanning
     a month end lands in both months · 179 earns 0 and 180 earns the full floor · an external
     `paid_salary` grant reduces the balance without adding worked days · automation OFF writes nothing ·
     a second identical run changes nothing · year-end lapse zeroes both types and produces the report.
   - the drift query after every salary step; any `d > 1` fails the simulation.
4. Fix everything both passes find, then run both again until clean. That rerun is the v2 pass.
5. Docs: `docs/leave-automation/HOW_IT_WORKS.md`, `OPEN_ITEMS.md`, and a CLAUDE.md Section 0 entry.
   Commit.

## PHASE 9 — SHIP
- `git diff --stat origin/main` — nothing outside the files named in BUILD_PLAN.md, plus
  `docs/leave-automation/**` and `frontend/dist`.
- `git push -u origin feat/leave-automation`; confirm `git rev-parse HEAD` equals
  `git rev-parse origin/feat/leave-automation`. No PR.

## FINAL REPORT (this shape, nothing else)
- branch + SHA (local = remote?)
- commits, one line each
- files created / modified, grouped backend / frontend / docs
- schema additions (tables, columns, policy keys)
- every trigger call site, file:line
- UI changes, screen by screen, one line each
- tests: names and pass/fail; simulation step results; maximum drift seen
- DECISIONS
- OPEN ITEMS, each with what it needs
- the owner's switch-on procedure

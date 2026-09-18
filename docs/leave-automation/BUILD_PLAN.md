# LEAVE AUTOMATION — BUILD PLAN
Branch `feat/leave-automation` off `origin/main` @ 3806a6d.
All line numbers verified against that SHA by Phase-0 anchor maps.

## VERIFIED GROUND TRUTH (differences from the prompt's assumptions)
- `cl_per_year` / `el_per_year` / `sl_per_year` **do not exist** in `schema.js` — defect (l) is only
  half true. `cl_annual_entitlement`='12' IS seeded (schema.js:633) and read by nothing.
  `el_eligibility_days`='180' is ALREADY seeded idempotently at schema.js:1617.
- `leaves.js:354-357` **already rejects SL** in `/adjust`: "Invalid leave_type. Must be CL or EL.
  SL is no longer supported." — reuse this string verbatim.
- Only four writers of `leave_transactions`: `phase5Features.js:421` (Year-End Lapse),
  `leaves.js:397` (/adjust), `leaves.js:517` (/bulk-adjust), `financeAudit.js:622` (finance apply-leave).
  `leaves.js` create/approve/delete move `leave_balances` directly and write **no** transaction row —
  so applications are not double-counted through the transactions table.
- `payroll.js:151` hardcodes `manualExtraDutyDays = 0`; there is no manual-extra-duty query to lift.
- `jobQueue.js:50-160` dispatches with an if/else chain (`'salary_compute'` 61-83,
  `'day_calculate'` 85-151), not a switch. Jobs table is created in `jobQueue.js:9-22`, not `schema.js`.
- `monthEndScheduler.js:101-103` has exactly one cron: `'30 3 * * *'` (09:00 IST).
  `createNotification(roleTarget, type, message, link)` at :20-32.
- `dayCalculation.js:747` exports `calculateDays, saveDayCalculation, getMonthDates, getDayOfWeek,
  WEEKLY_OFF_LENIENCY, effectiveStatusForDay` — `getMonthDates` / `getDayOfWeek` ARE exported, so the
  engine can reuse them without editing the file.
- `payroll.js:249` and `:407` stamp `stage_6_done` / `stage_7_done` filtered by month+year only
  (no company); `import.js:1117` / `:1146` filter by company. Preserve each call site's existing shape.
- `middleware/roles.js` has **no** `requireHrFinanceOrAdmin`; `compensatoryOff.js` and
  `short-leaves.js` each define one locally. Reuse `roleIn` for the new hr+finance+admin reads.

## PHASE 1 — SCHEMA (`backend/src/database/schema.js`, `backend/src/config/schemaReference.js`)
Insert one block immediately before `console.log('✅ Database schema initialized')` (schema.js:3278).
Helpers already in scope at that point: `safeAddColumn` (697), `safeCreateIndex` (1080),
`insertPolicyIfMissing` (739).
- `CREATE TABLE IF NOT EXISTS leave_external_grants` — id, employee_code, employee_id, year, month,
  leave_type DEFAULT 'EL', days REAL, mode TEXT CHECK in (leave_taken,paid_salary,paid_cash),
  paid_month, paid_year, remark, source_file, uploaded_by, uploaded_at, is_active INTEGER DEFAULT 1,
  UNIQUE(employee_code, year, month, leave_type, mode). Index `idx_leave_ext_grants_emp_year`.
- `CREATE TABLE IF NOT EXISTS leave_change_flags` — id, employee_code, company, month, year, reason,
  detail, created_at, cleared_at, cleared_by. Index `idx_leave_change_flags_open (year,month,cleared_at)`.
- `CREATE TABLE IF NOT EXISTS leave_recompute_runs` — id, scope, company, month, year, employee_count,
  started_at, finished_at, status, message. Index `idx_leave_recompute_runs_scope`.
- `safeAddColumn('day_calculations','salary_stale','INTEGER DEFAULT 0')`,
  `('day_calculations','leave_recomputed_at','TEXT')`, `('monthly_imports','stage_6_auto_at','TEXT')`.
- 8 `insertPolicyIfMissing.run(...)` calls (outside the `policyCount.cnt === 0` block at 609-642):
  el_accrual_rate=1, el_eligibility_days=180, el_days_per_leave=20, cl_entitlement_base=7,
  leave_automation_enabled=false, leave_auto_stage6_enabled=true,
  leave_recompute_debounce_seconds=45, leave_external_grants_acknowledged=false.
- Guarded `migration_cl_entitlement_7_v1` (idiom of schema.js:834-850): UPDATE `cl_annual_entitlement`
  to '7'; delete `sl_per_year` only if present AND unchanged from its seed (it is absent — no-op, logged).
- `schemaReference.js`: append leave tables at :86 (between `leave_balances` and `audit_log`) and extend
  the `day_calculations` / `salary_computations` entries with their leave columns.

## PHASE 2 — LEAVE ENGINE (`backend/src/services/leaveEngine.js` NEW; `phase5Features.js` edit)
- `computeLeavePlan(db,{year,employeeCodes})` pure. Employee filter mirrors
  `phase5Features.js:12` (`LEAVE_ELIGIBLE_TYPES=['Permanent']`) + `isContractorForPayroll`.
  Day-calc lookup drops the `company` predicate (defect e). Days worked =
  `days_present + 0.5*days_half_present + days_wop + el_used` (ruling 1; no `od_days` — folded at
  dayCalculation.js:437). Running YTD total computed from January every call (defect a).
  `earned = days_worked_ytd >= el_eligibility_days ? floor(days_worked_ytd/el_days_per_leave)*el_accrual_rate : 0`.
  Used: `day_calculations.el_used/cl_used` where a row exists, else day-by-day expansion of approved
  `leave_applications` via exported `getMonthDates`/`getDayOfWeek` skipping weekly-off + holidays (defect d).
  External: `leave_external_grants` is_active=1 (`leave_taken` also adds worked days).
  Adjustments: `leave_transactions` where `transaction_type IN ('Credit','Debit')` minus the
  finance-correction shape (see DECISION D1) — those return as `unresolved_finance_rows`.
  CL opening from `computeClEntitlement` reading `cl_entitlement_base`.
  Balance = opening + earned − used − external + adjustments, 2 dp (defect f).
- `applyLeavePlan(db, plan, {actor, allowWrite})` — one txn; ledger UPSERT `DO UPDATE` list covers every
  INSERT column except `lapsed`; `leave_balances` UPDATE/INSERT; `leave_recompute_runs` row.
  Refuses when automation off and `allowWrite !== true`; refuses when no external grants and
  `leave_external_grants_acknowledged='false'` (ruling 9).
- `recomputeLeaves`, `runYearEndLapse`, `seedYearOpenings`.
- `phase5Features.js`: `runLeaveAccrual` becomes a thin wrapper (same export name + return shape);
  `computeClEntitlement` reads `cl_entitlement_base`. Nothing else in that file changes.
- Spec `backend/src/__tests__/leaveEngine.test.js` — 14 cases from the prompt.

## PHASE 3 — SHARED STAGE 6 (`backend/src/services/recompute.js` NEW)
- `recomputeDays(db,{company,month,year,employeeCodes,requestId,markStale=true})` lifted from
  `payroll.js:14-272` (ghost cleanup 34-53, empCodes 55-65, reactivate 66-70, holidays 75-79,
  loop 86-245, wopInsert 119-131, financeED 173-183, leaves 196-203, compOff 205-211,
  calculateDays 213-232, stage stamp 249).
- `recomputeSalary(db,{company,month,year,employeeCodes,requestId})` lifted from `payroll.js:358-421`.
- Call sites re-pointed: `payroll.js` /calculate-days (14-272) and /compute-salary (358-421);
  `jobQueue.js:85-151` `day_calculate`; `import.js:946-1155` `runReimportRecompute`.
- Defect g: after `saveDayCalculation`, re-apply stored `late_deduction_days` exactly as
  `payroll.js:1083-1110` does (`payable -= d`, `lop += d`), inside the same txn.
- `salary_stale=1` + `leave_recomputed_at` stamped on every row written by `recomputeDays`
  (not by `recomputeSalary`, which clears `salary_stale=0`).
- Spec `backend/src/__tests__/recomputeParity.test.js`.

## PHASE 4 — TRIGGERS (`backend/src/services/leaveTriggers.js` NEW)
- `queueLeaveRecalc`, `isMonthFinalized`, `checkAutoStage6`, `flagFinalizedChange`.
- `jobQueue.js`: add `leave_recalc` + `leave_nightly` branches to the if/else chain at :61-154.
- Trigger call sites (all AFTER commit, all in try/catch):
  `leaves.js` POST / (:119), PUT /:id/approve (:169), PUT /:id/reject (:247), DELETE /:id (:231),
  POST /adjust (:404), POST /bulk-adjust (:532);
  `financeAudit.js` apply-leave (:552-656 end), miss-punch approve (:1550), reject (:1601),
  bulk-approve (:1631) + `checkAutoStage6`;
  `attendance.js` resolve (:153), bulk-resolve (:169) + `checkAutoStage6`;
  `compensatoryOff.js` finance-review (:269), bulk-review (:334), delete (:376);
  `import.js` fresh import (:512-519 region) and `runReimportRecompute` tail (:1155) + `checkAutoStage6`;
  `employees.js` POST / (:306), PUT /:code (:483) when DOJ or employment_type changed.
- `monthEndScheduler.js`: extend the `'30 3 * * *'` job with a leave sweep + drift log; add
  `'35 18 * * *'` (00:05 IST) for `seedYearOpenings` (1 Jan) / `runYearEndLapse` (31 Dec), guarded by
  policy keys so a restart can't double-run.
- Spec `backend/src/__tests__/leaveTriggers.test.js`.

## PHASE 5 — API (`routes/phase5.js`, `routes/leaves.js`, `routes/financeAudit.js`, `routes/employeePortal.js`)
- `phase5.js`: delete local guard (:23-31), import from `middleware/roles.js`; guard every endpoint;
  add 11 new endpoints (preview, apply, grants upload/list/delete/acknowledge-none, automation
  status/settings, change-flags list/clear, lapse report, salary-stale).
- `leaves.js`: `router.use` guard — reads hr/finance/admin/viewer, writes hr/admin (defect k).
- `financeAudit.js` apply-leave: `requireFinanceOrAdmin`, rewritten to create an approved
  `leave_application` + queue a recalc; no hand-patch of `day_calculations` (defect h).
- `employeePortal.js`: `ORDER BY applied_at DESC` (:72), leave-apply validation (:57-66) (defect i).
- Spec `backend/src/__tests__/leaveApi.test.js`.

## PHASE 6 — SL + CL 7
- `dayCalculation.js:464-466` — SL branch deleted (keeps `slUsed` field/column).
- `employees.js:302` and `:942` — `computeClEntitlement(doj, year)` instead of hardcoded 12.
- SL rejected in `leaves.js` POST / + approve, `employeePortal.js` leave-apply, finance apply-leave.
- Spec additions in `leaveEngine.test.js` / new `slRemoval.test.js`.

## PHASE 7 — UI (see FRONTEND ANCHORS below) + `npm run build` + commit `frontend/dist`.

## PHASE 8 — self-debug, jest, `backend/scripts/leave-automation-simulation.js`, docs.
## PHASE 9 — push `feat/leave-automation`, no PR.

## FRONTEND ANCHORS (verified @3806a6d; root = `frontend/src`)
| File (lines) | Anchor | Phase-7 change |
|---|---|---|
| `pages/LeaveManagement.jsx` (1102) | `MAIN_TABS` :173-180 | add `automation` tab (admin only) |
| | approve mut :253-260 (`approved_by:'admin'` hardcoded at :254) | send logged-in user; balance-now→after in dialog |
| | reject mut :262-270 | send logged-in user |
| | Balances tab :508-558 (query :220-224) | new columns + expandable ledger row + CSV |
| | Adjustments tab :604-707 (mut :236-243) | mandatory reason, live resulting balance, Allow-negative gate |
| | `CompOffTab` role check :731-733 (`user?.role` raw) | use `normalizeRole` |
| | tab bar render :314-325 | render Automation pill for admin |
| `pages/DayCalculation.jsx` (858) | leave modal :524-627; type `<select>` :578-586 (SL at :585) | drop SL, add LWP; balance now→after; mandatory remark |
| | SL tile :555-558 | remove tile |
| | `<thead>` :313-360 / `<tbody>` :361-441 / `<tfoot>` :442-462 / `colSpan={18}` :374 | add OD column, bump colSpan/tfoot |
| | `AbbreviationLegend keys` :520 | drop `SL` |
| `pages/SalaryComputation.jsx` (1006) | banner precedents :493-513, :515-538 | new amber stale banner after :299 |
| | Finalise button :281-284 | block while stale>0 + admin override w/ reason |
| `pages/EmployeeProfile.jsx` (610) | balance tiles :373-375 (SL :375) | swap SL tile → Days worked YTD + EL eligibility |
| | Monthly Leave Breakdown :423-455 (SL th :434) | add Days worked / EL earned columns; keep SL |
| `pages/MissPunch.jsx` (603) | header :196-211; muts :146-160 | status strip + post-resolve toast |
| `pages/Import.jsx` (477) | results section :364-424 | "Automatic Stage 6" card |
| `pages/Settings.jsx` (931) | `POLICY_GROUPS` :304-349, 'Sunday & Leave Rules' :314-322 (`cl_per_year` 318, `el_per_year` 319, `sl_per_year` 320) | rename group "Leave Rules"; drop the three dead keys; expose cl_entitlement_base / el_days_per_leave / el_eligibility_days + 2 toggles |
| `pages/Reports.jsx` (1247) | leave table header :1139-1151 | "SL (historical)", + Days worked / EL earned / Outside EL |
| `pages/DailyMIS.jsx` (1158) | order array :927; style map :890-896 | drop SL from order (keep style for history) |
| `components/ui/CalendarView.jsx` (182) | `STATUS_STYLES` :9-16, `STATUS_LABELS` :19-22, legend :159-179 | add CL/EL/LWP/OD |
| `components/layout/Sidebar.jsx` (315) | nav :30-136, Leave entry :50, badge precedent `TaDaPendingBadge` :13-27 + render :228 | `leaveFlagBadge: true` + `<LeaveFlagBadge/>` |
| `utils/api.js` (616) | leave helpers :187-200, comp-off :203-208 | add ~12 new helpers for the Phase-5 endpoints |
| `utils/abbreviations.js` (164) | :17-20, :104-106 | add OD; keep SL |

### Frontend conventions to follow
- Query keys: flat arrays, name-first — `['leave-transactions', code, year]`; gate with `enabled:`;
  invalidate with `queryClient.invalidateQueries({ queryKey: [...] })` in `onSuccess`.
- `import toast from 'react-hot-toast'`; `toast.error(err?.response?.data?.error || 'fallback')`.
- Roles: `useAppStore()` → `user`; roles are already lowercase-normalised by
  `healUser`/`normalizeRole` (`store/appStore.js:8-20`) — import `normalizeRole` where a raw
  `user?.role` compare exists today.
- Modals: `components/ui/Modal` (`ModalBody`, `ModalFooter`), `components/ui/ConfirmDialog`.
- Tailwind semantic classes: `card`, `card-header`, `section-title`, `btn-primary`/`btn-ghost`,
  `input`, `select`, `table-compact`, `badge-*`, `animate-fade-in`; `clsx` for conditionals.
- Page shell: `<div className="animate-fade-in">` → `PipelineProgress` → `p-4 md:p-6 space-y-5 max-w-screen-xl`.
- `EmployeeProfile.jsx` is the outlier (raw `bg-white rounded-lg shadow` / gray-*) — match its local style there.

## TEST LIST
- `leaveEngine.test.js` — 14 cases (prompt Phase 2).
- `recomputeParity.test.js` — field-by-field parity + late-deduction preservation.
- `leaveTriggers.test.js` — debounce merge, finalized flag, auto-Stage-6 gate, throwing trigger, automation-off.
- `slRemoval.test.js` — SL no longer changes payable days; CL seed = pro-rated 7.
- `leaveApi.test.js` — role guards on phase5/leaves; portal ORDER BY; finance apply-leave creates an application.
- `scripts/leave-automation-simulation.js` — happy path + 9 edge cases + drift after every salary step.

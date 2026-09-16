# 02 — Leave Backend

Branch `docs/leave-inventory` off `origin/main@3806a6d`. Every FACT cites a line read in this session. No source file was modified; no script or server was run.

## A. Route inventory

All routers below are mounted with `requireAuth` only (`server.js:195-230`); any finer gate is a *router-local* function, noted per row. There is no `router.use(...)` role gate in any leave file (`grep router.use( src/routes/*.js` → only healthChecks, queryTool, recordHistory, sales, sqlConsole).

### `routes/leaves.js` — mounted `/api/leaves` (server.js:206, `requireAuth`) — **no role guard anywhere in the file** (FACT: zero `require*OrAdmin` helpers defined or used in leaves.js)

| METHOD | PATH | file:line | guard | READS | WRITES |
|---|---|---|---|---|---|
| GET | /api/leaves | leaves.js:9 | auth only | leave_applications, employees | — |
| POST | /api/leaves | leaves.js:51 | auth only | employees, leave_balances, monthly_imports | leave_applications, notifications |
| PUT | /api/leaves/:id/approve | leaves.js:128 | auth only | leave_applications, employees, leave_balances | leave_applications, leave_balances |
| DELETE | /api/leaves/:id | leaves.js:178 | auth only | leave_applications, monthly_imports, employees | leave_applications, leave_balances, audit_log |
| PUT | /api/leaves/:id/reject | leaves.js:236 | auth only | — | leave_applications |
| GET | /api/leaves/summary | leaves.js:253 | auth only | leave_applications, employees | — |
| GET | /api/leaves/balances | leaves.js:288 | auth only | employees, leave_balances | — |
| GET | /api/leaves/balances/:code | leaves.js:319 | auth only | leave_balances, employees | — |
| POST | /api/leaves/adjust | leaves.js:343 | auth only | employees, leave_balances | leave_balances, leave_transactions, audit_log |
| GET | /api/leaves/transactions/:code | leaves.js:410 | auth only | leave_transactions | — |
| GET | /api/leaves/register | leaves.js:429 | auth only | leave_transactions, employees | — |
| POST | /api/leaves/bulk-adjust | leaves.js:457 | auth only | employees, leave_balances | leave_balances, leave_transactions, audit_log |
| GET | /api/leaves/accrual-ledger/:code | leaves.js:539 | auth only | leave_accrual_ledger | — |
| GET | /api/leaves/annual-summary/:code | leaves.js:559 | auth only | leave_accrual_ledger, day_calculations | — |
| GET | /api/leaves/on-leave-today | leaves.js:639 | auth only | leave_applications, employees | — |

### `routes/phase5.js` — mounted **`/api/features`** (server.js:212)

| METHOD | PATH | file:line | guard | READS | WRITES |
|---|---|---|---|---|---|
| POST | /api/features/accrue-leaves | phase5.js:33 | **auth only — no role guard** | employees, day_calculations, leave_applications, leave_accrual_ledger, leave_balances, policy_config | leave_accrual_ledger, leave_balances |
| POST | /api/features/init-cl-opening | phase5.js:51 | `requireHrOrAdmin` (phase5.js:23) | employees, policy_config | leave_balances, leave_accrual_ledger, policy_config |
| POST | /api/features/year-end-lapse | phase5.js:76 | `requireHrOrAdmin` | leave_balances, employees | leave_accrual_ledger, leave_balances, leave_transactions |

### `routes/compensatoryOff.js` — mounted `/api/comp-off` (server.js:219)

| METHOD | PATH | file:line | guard | READS | WRITES |
|---|---|---|---|---|---|
| POST | /api/comp-off | compensatoryOff.js:68 | requireHrOrAdmin (:19) | employees, monthly_imports | compensatory_off_requests, audit_log |
| GET | /api/comp-off | :161 | requireHrFinanceOrAdmin (:26) | compensatory_off_requests, employees | — |
| GET | /api/comp-off/pending | :188 | requireFinanceOrAdmin (:33) | compensatory_off_requests, employees | — |
| PUT | /api/comp-off/:id/finance-review | :212 | requireFinanceOrAdmin | compensatory_off_requests | compensatory_off_requests, finance_approvals, audit_log |
| PUT | /api/comp-off/bulk-review | :272 | requireFinanceOrAdmin | compensatory_off_requests | compensatory_off_requests, finance_approvals, audit_log |
| DELETE | /api/comp-off/:id | :339 | requireHrOrAdmin | compensatory_off_requests, monthly_imports | compensatory_off_requests (DELETE), audit_log |

### `routes/short-leaves.js` — mounted `/api/short-leaves` (server.js:221)

| METHOD | PATH | file:line | guard | READS | WRITES |
|---|---|---|---|---|---|
| POST | /api/short-leaves | short-leaves.js:44 | requireHrOrAdmin (:12) | employees, shifts, attendance_processed, short_leaves | short_leaves, audit_log |
| GET | /api/short-leaves | :173 | requireHrFinanceOrAdmin (:20) | short_leaves | — |
| GET | /api/short-leaves/quota/:employeeCode | :212 | requireHrFinanceOrAdmin | short_leaves | — |
| GET | /api/short-leaves/:id | :249 | requireHrFinanceOrAdmin | short_leaves | — |
| PUT | /api/short-leaves/:id/cancel | :264 | requireHrOrAdmin | short_leaves, attendance_processed | short_leaves, audit_log |

### `routes/payroll.js` — mounted `/api/payroll` (server.js:198)

| METHOD | PATH | file:line | guard | READS (leave-relevant) | WRITES |
|---|---|---|---|---|---|
| POST | /api/payroll/calculate-days | payroll.js:14 | auth only | leave_balances (:95-99, unused downstream), leave_applications (:196-203), compensatory_off_requests (:205-211), attendance_processed, holidays, employees, extra_duty_grants | attendance_processed (ghost cleanup :34-48), employees (:65-69), day_calculations (via saveDayCalculation) |
| POST | /api/payroll/compute-salary | :358 | auth only | day_calculations (cl_used/el_used/lop_days/od_days/short_leave_days/uninformed_absent) | salary_computations; monthly_imports.stage_7_done (:407) |
| GET | /api/payroll/salary-register | :462 | auth only | day_calculations.lop_days (:473) | — |
| GET | /api/payroll/payslip/:code | :987 | auth only | salary_computations + day_calculations via generatePayslipData | — |
| GET | /api/payroll/payslips/bulk | :1119 | auth only | — (hard 403, disabled) | — |
| POST | /api/payroll/finalise | :1031 | auth only | finance_month_signoff, extra_duty_grants, attendance_processed | salary_computations, monthly_imports — **no leave writes, no accrual** |
| PUT | /api/payroll/day-calculations/:code/late-deduction | :1083 | auth only | day_calculations | day_calculations.lop_days (:1098-1105) |

### Other leave-touching routes

| METHOD | PATH | mount (server.js) | file:line | guard | READS | WRITES |
|---|---|---|---|---|---|---|
| POST | /api/import/upload | :195 | import.js:41 → helper import.js:946 | auth only | leave_balances (:1013-16), leave_applications (:1072-79), compensatory_off_requests (:1085) | day_calculations, salary_computations |
| GET | /api/employees/:code | :197 | employees.js:246 | auth only | leave_balances (:272) | — |
| POST | /api/employees | :197 | employees.js:278 | auth only | — | leave_balances (CL opening **12**, :302) |
| GET | /api/employees/:code/leaves | :197 | employees.js:486 | **auth only** | leave_balances | — |
| PUT | /api/employees/:code/leaves | :197 | employees.js:497 | **auth only** | — | leave_balances (:506-510) |
| POST | /api/employees/bulk-import | :197 | employees.js:802 | auth only | — | leave_balances CL=12 for years 2025 & 2026 (:942-943) |
| GET | /api/portal/leave-balance | :215 | employeePortal.js:47 | requireEmployee (:6) | leave_balances | — |
| POST | /api/portal/leave-apply | :215 | employeePortal.js:57 | requireEmployee | — | leave_applications (**no validation**, :63-64) |
| GET | /api/portal/leave-history | :215 | employeePortal.js:69 | requireEmployee | leave_applications (ORDER BY `created_at`) | — |
| GET | /api/finance-audit/report | :210 | financeAudit.js:41 | auth only | salary_computations cl_days/el_days/lwp_days/od_days/short_leave_days/uninformed_absent_days (:68-73) | — |
| POST | /api/finance-audit/corrections/apply-leave | :210 | financeAudit.js:552 | **auth only** | employees, leave_balances, attendance_processed | attendance_processed, leave_balances, leave_transactions, day_calculations, audit_log |
| GET | /api/analytics/employee/:code | :199 | analytics.js:289 | auth only | leave_balances (:330-332) | — |
| GET | /api/analytics/patterns, /employee/:code/profile | :199 | analytics.js:551, :569 | auth only | day_calculations leave cols via behavioralPatterns; leave_balances + leave_applications via patternEngine | — |
| GET | /api/reports/leave-register | :200 | reports.js:445 | requireHrFinanceOrAdmin (reports.js:8) | day_calculations, leave_accrual_ledger, employees | — |
| GET | /api/reports/attendance-summary | :200 | reports.js:17 | auth only | dc.lop_days/cl_used/el_used (:35-38) | — |
| GET | /api/reports/pf-ecr | :200 | reports.js:243 | auth only | payable_days → NCP (exportFormats.js:40-50) | — |
| POST | /api/attendance/miss-punches/:id/resolve | :196 | attendance.js:146 | auth only | attendance_processed | attendance_processed.status_final = leaveType (missPunch.js:125-126) |
| POST | /api/early-exits/detect, /detect-range | :222/:224 | early-exits.js:75, :116 | requireHrOrAdmin | short_leaves (earlyExitDetection.js:73-77) | attendance_processed, early_exit_detections |
| GET | /api/early-exits/*, /api/early-exit-deductions/* | :222-225 | early-exits.js:399, :902; early-exit-deductions.js:163 | requireHrFinanceOrAdmin | short_leaves (LEFT JOIN) | — |

**Absences stated explicitly:** `routes/settings.js` has **no** leave route (grep `-i leave` → one unrelated comment at `settings.js:99`). `routes/sales.js` has **no** leave route (one unrelated comment at `sales.js:1194`). `routes/daily-mis.js` and `services/dailyMIS.js` contain **zero** leave references (grep `-i leav` returns nothing in either). [FACT]

## B. Function inventory + caller graph

| Function | file:line | What it does | EVERY caller (repo-wide grep, node_modules excluded) |
|---|---|---|---|
| `computeClEntitlement(doj, year)` | phase5Features.js:27 | CL entitlement 7→2 by effective join month; `7 - floor((effMonth-1)/2)` | phase5Features.js:224 (inside runLeaveAccrual); phase5Features.js:355 (initCLOpening); scripts/reseed-leave-balances-2026.js:85. **No route calls it directly.** |
| `_prevMonth` | phase5Features.js:41 | prev month/year | phase5Features.js:124 only |
| `_getPolicyNumber` | phase5Features.js:46 | policy_config numeric read | phase5Features.js:76, :77 only |
| `runLeaveAccrual(db,month,year)` | phase5Features.js:73 | EL paid-days accrual + CL usage mirror into leave_accrual_ledger; updates leave_balances | **routes/phase5.js:38 — the only call site in the repo.** (Other hits are comments: schema.js:1573, :1616; phase5Features.js:58; reseed script:314.) |
| `initCLOpening(db,year,depMonth)` | phase5Features.js:288 | Seeds CL opening per year, guarded by `policy_config.cl_seed_<year>_v1` | **routes/phase5.js:58 only.** No frontend caller (grep `init-cl-opening` in frontend/src → 0 hits). |
| `yearEndLapse(db,year)` | phase5Features.js:394 | Zeroes CL+EL, writes lapse ledger + `Year-End Lapse` transactions | **routes/phase5.js:82 only.** No frontend caller (grep `year-end-lapse` in frontend/src → 0 hits). |
| `generateComplianceAlerts` | phase5Features.js:456 | Statutory alerts (no leave data) | routes/phase5.js:202 |
| `computeAttritionRisk` | phase5Features.js:541 | Attrition score from attendance only (no leave data) | routes/phase5.js:217 |
| `calculateDays(...)` | dayCalculation.js:141 | Payable-day engine; consumes `options.approvedLeaves` / `approvedCompOff` | routes/payroll.js:213; routes/import.js:1092; services/jobQueue.js:133; scripts/phase5-simulation.js:173; src/__tests__/dayCalculation.test.js:33,39,46,54,68 |
| `saveDayCalculation` | dayCalculation.js:638 | Upserts day_calculations incl. cl_used/el_used/sl_used/lop_days/od_days/short_leave_days/uninformed_absent | payroll.js:232; import.js (same helper); jobQueue.js:146; phase5-simulation.js:180 |
| `effectiveStatusForDay` | dayCalculation.js:96 | Miss-punch finance gate → effective status | dayCalculation.js:111, :242, :409; exported at :747 |
| `expandLeaveDates` (inner) | dayCalculation.js:386 | Expands leave start→end to date list | dayCalculation.js:444 only |
| `computeEmployeeSalary` | salaryComputation.js (contains leave reads at :430, :795-800) | Copies day-calc leave buckets into salary row (display-only) | payroll.js:384; import.js:1132; jobQueue.js:76 |
| `saveSalaryComputation` | salaryComputation.js:~840 | Persists cl_days/el_days/lwp_days/od_days/short_leave_days/uninformed_absent_days (:842, :905-910, :928) | payroll.js; import.js; jobQueue.js |
| `generatePayslipData` | salaryComputation.js:1063 | Builds `leaveSummary{cl,el,lwp,od,shortLeave,uninformedAbsent}` (:1090-1097) | routes/payroll.js:990 only |
| `isContractorForPayroll` | utils/employeeClassification.js:47 | employment_type → is_contractor → dept keyword | phase5Features.js:129, :336; compensatoryOff.js:98; dayCalculation caller sites payroll.js:217 / jobQueue.js:137; salaryComputation.js:444 |
| `resolveMissPunch` | services/missPunch.js:107 | `convertToLeave` sets `status_final = leaveType` (:125-126) | routes/attendance.js:151 |
| `detectSuddenLeaveBurn` | patternEngine/flightRiskPatterns.js:105 | Reads leave_balances (:113) + leave_applications (:122) | exported :271, dispatched by patternEngine index → analytics.js:569, aiReviewService.js:296 |
| `detectPatterns` (leave-discipline block) | behavioralPatterns.js:229-259 | Informed-leave ratio from day_calculations | employeeProfileService.js:2; analytics.js:9 |
| `runReimportRecompute` | routes/import.js:946 | Re-runs day-calc + salary after re-upload, re-reading approved leaves/comp-off | import.js:514 only |
| `detectEarlyExits` | earlyExitDetection.js (short_leaves read :73-77) | Gate-pass exemption for early exit | early-exits.js:75, :116 |

## C. Direct answers

### (a) Is accrual ever automatic? — **NO.**
Repo-wide `grep -rn runLeaveAccrual` (excluding node_modules) returns exactly 6 hits and only **one is a call**: `routes/phase5.js:38`. The others are the definition (`phase5Features.js:73`), the export (`:671`), the import (`phase5.js:14`), and two comments (`schema.js:1573`, `reseed-leave-balances-2026.js:314`). [FACT]

Checked specifically, all negative:
- **Stage 7 finalize** `payroll.js:1031-1077` — does finance-signoff, ED-grant and miss-punch checks, then two UPDATEs (`:1073-1074`) and returns. No accrual, no leave write. [FACT]
- **`services/monthEndScheduler.js`** — the only `node-cron` registration in the file is `cron.schedule('30 3 * * *', …)` at `:101`, whose callback is `checkPipelineStatus()`. `grep -n "leave|accru"` in that file returns **zero** hits. [FACT]
- **`services/jobQueue.js`** — two job types only: `salary_compute` (`:61`) and `day_calculate` (`:85`); unknown types error at `:153`. It *reads* leave data for day-calc (`:112-131`) but never accrues. [FACT]
- **server.js boot** (`:339-349`) starts jobQueue, monthEndScheduler, backupScheduler, sarvamBatchPoller, bugReportResurrect, driftMonitor — none of which references leave. [FACT]

**Plain answer:** `POST /api/features/accrue-leaves` (phase5.js:33) is the only way accrual ever runs, and it has **no role guard** — any authenticated user (incl. an `employee`-role portal login) can mutate every employee's `leave_balances` and `leave_accrual_ledger`. `init-cl-opening` and `year-end-lapse` are HR/admin-gated but have **no frontend caller at all** (grep in `frontend/src` → 0 hits), so in practice they can only be fired by hand with curl/Postman. [FACT + INFERENCE]

**Note on the path:** the task text says `/api/phase5/accrue-leaves`; the actual mount is `app.use('/api/features', requireAuth, require('./src/routes/phase5'))` at **server.js:212**. The frontend agrees: `frontend/src/utils/api.js:353 → api.post('/features/accrue-leaves', …)`. [FACT]

### (b) How Stage 6 consumes CL / EL / LWP / OD
`calculateDays` signature: `dayCalculation.js:141`. The 6th positional parameter is `leaveBalances`, documented at **`dayCalculation.js:126`** as:
> `@param {Object} leaveBalances  { CL, EL, SL } — retained for backward compat, unused by WO logic`

That is accurate to the letter: `leaveBalances` appears **nowhere** in the function body — it is a dead argument. [FACT]

Real leave input is `options.approvedLeaves` / `options.approvedCompOff`, defaulted to `[]` at **`dayCalculation.js:161-162`**. Supplier and source tables (`routes/payroll.js:196-211`):
- `approvedLeaves` ← `leave_applications` where `status='Approved' AND start_date <= monthEnd AND end_date >= monthStart` (`payroll.js:196-203`)
- `approvedCompOff` ← `compensatory_off_requests` where `month/year` match and `finance_status='approved'` (`payroll.js:205-211`)
Identical queries in `jobQueue.js:119-131` and `import.js:1072-1090`. `leave_balances` is still fetched at `payroll.js:95-99` and passed in, but has no effect. [FACT]

Mechanics (`dayCalculation.js:364-472`):
- `absentDates` set rebuilt at `:401-418`.
- **OD first** (`:424-439`): only if the date was genuinely absent (`:433`) — then `daysAbsent--`, `daysPresent++`, `odDays++`.
- **Leaves** (`:442-472`): weekly-off and holiday dates skipped (`:449-451`); `consumedDates` prevents double consumption (`:448`); if the date was absent, `daysAbsent--` (`:453-457`).
  - `EL` → `leaveElUsed++` only; payable rises via the `daysAbsent--` (`:458-460`)
  - `CL` → `leaveClUsed++` **and** `unpaidLeaveDays++` (`:461-463`) → payable unchanged
  - `SL` → same as CL (`:464-466`)
  - `LWP` → `leaveLwpUsed++` + `unpaidLeaveDays++` (`:467-470`)
- Baseline math: `dayCalculation.js:514-519`
  `baseEntitlement = workingDays + paidWeeklyOffs + paidHolidays`
  `totalAbsences = daysAbsent + daysHalfPresent + unpaidLeaveDays`
  `finalPayable = max(0, base − totalAbsences + daysWOP + manualGrantDays)`
- Integrity assertion including `leaveElUsed`: `:534-542`.
- Persisted at `:603-609` → `cl_used / el_used / sl_used / lop_days / od_days / short_leave_days / uninformed_absent`, written by `saveDayCalculation` (`:646, :653, :682-685, :708-710, :720, :739-741`).

**`calculateDays` never reads `leave_applications` — it only receives pre-fetched rows. It never reads `leave_balances` at all.** [FACT]

### (c) Contractor exclusion
- **`dayCalculation.js:294-356`** — the contractor branch `if (contractorMode) { … return {…} }` sits **before** the leave/comp-off post-processing block (which starts at `:364`). Consequently contractors return the literals `clUsed: 0, elUsed: 0, slUsed: 0, lopDays: 0` (`:327`), `odDays: 0` (`:328`). **Skipped for contractors: approved-leave consumption, OD restoration, unpaid-leave reclassification, paid weekly offs (`:322-325`), paid holidays (`:326`), extra-duty (`:339`).** `shortLeaveDays` is still set (`:329`) but is just `daysHalfPresent`. [FACT]
- **`salaryComputation.js:444`** `const isContract = isContractorForPayroll(employee);` with an explicit comment (`:440-443`) that `dayCalc.is_contractor` must NOT be trusted. Contractor gates at `:454` (daily-wage earned), `:496` (OT block), `:559` (holiday-duty pay), `:658`, `:679`. The leave display buckets at `:795-800` are copied for **everyone** — for contractors they are the hardcoded zeros from day-calc. So contractors carry zero leave through salary by construction, not by a gate in salaryComputation. [FACT/INFERENCE]
- **`phase5Features.js:12`** `LEAVE_ELIGIBLE_TYPES = ['Permanent']` filters the accrual population (`:81-88`), and `:129` `if (isContractorForPayroll(emp)) { results.skipped++; continue; }`. `initCLOpening` repeats the gate at `:336`. [FACT]
- **`compensatoryOff.js:98-103`** rejects comp-off for contractors with 400. [FACT]
- **`short-leaves.js`** has **no** contractor gate — a contractor can be issued a gate pass. [FACT]

### (d) Downstream consumers

| Consumer | What it does with leave | Evidence |
|---|---|---|
| Payslip (`generatePayslipData`) | Emits `leaveSummary {cl, el, lwp, od, shortLeave, uninformedAbsent}` read from `salary_computations`. No earning/deduction line. | salaryComputation.js:1089-1097 |
| Payslip endpoints | `GET /api/payroll/payslip/:code` → payroll.js:987-990. `GET /payslips/bulk` (payroll.js:1119) is a hard 403 "disabled per company policy". | payroll.js:987, :1119-1124 |
| `salaryComputation` (salary math) | Leave is **display-only** — explicit comment at `:792-794`: "These are DISPLAY-ONLY. All salary math already flowed through payable_days". `lopDeduction = 0` hardcoded at `:608` ("Pro-rating handles absent days; no separate LOP needed"); `lopDays` read at `:430` is never used in any formula. | salaryComputation.js:430, :608, :697, :792-800 |
| `services/exportFormats.js` (PF ECR) | NCP days = `calendarDays − sundays − holidays − payable_days` (`:49-50`), with a comment (`:41-47`) stating EL/OD already lifted payable in Stage 6 and CL/SL/LWP deliberately do not. No leave table read. | exportFormats.js:40-50 |
| `routes/reports.js` | `GET /leave-register` (`:445`, HR/finance/admin): monthly mode from `day_calculations` (`:471-476`); annual mode also aggregates `leave_accrual_ledger` for CL/EL opening/accrued/used/lapsed/closing (`:521-547`), with a fallback to `cl_used_ytd/el_used_ytd` when no ledger row exists (`:558-559`). `GET /attendance-summary` surfaces lop_days/cl_used/el_used (`:35-38`). | reports.js:445-630 |
| `routes/financeAudit.js` | Read side: `GET /report` pulls the six salary leave columns (`:68-73`) and re-exposes them (`:175-180`). Write side: `POST /corrections/apply-leave` (`:552`) is a full parallel leave-consumption path — see Finding 6. `financeRedFlags.js:224-240` raises `high_uninformed_absent` at `uninformed_absent_days >= 3`. | financeAudit.js:41, :68-73, :175-180, :552; financeRedFlags.js:224-240 |
| Pattern engine (`patternEngine/*`) | `flightRiskPatterns.js:105 detectSuddenLeaveBurn` reads `leave_balances` (`:113`) and `leave_applications` incl. **Pending** rows (`:122-124`); fires when burn > 3× historical and `totalBalance < 3` (`:149`). `individualPatterns.js:26, :265, :379` and `flightRiskPatterns.js:57, :215` classify raw attendance statuses `['A','CL','SL','EL','L']`. | as cited |
| `services/behavioralPatterns.js` | Informed-leave ratio from `day_calculations` (`:230-235`); `LEAVE_DISCIPLINE_HIGH` ≥80% (`:241`), `LEAVE_DISCIPLINE_LOW` <50% with ≥3 uninformed (`:248`); trend compare at `:307-324`. | behavioralPatterns.js:229-330 |
| Daily MIS (`services/dailyMIS.js`, `routes/daily-mis.js`) | **Nothing.** `grep -i leav` returns zero hits in both files. `GET /api/leaves/on-leave-today` (leaves.js:639) is documented as "Daily MIS helper" but is consumed by the frontend directly (`frontend/src/utils/api.js:388`), not by dailyMIS.js. | FACT (absence) |
| `routes/employeePortal.js` | `GET /leave-balance` (`:47`) reads `leave_balances`; `POST /leave-apply` (`:57`) inserts straight into `leave_applications` with **zero** validation; `GET /leave-history` (`:69`) orders by `created_at`. | employeePortal.js:47-74 |
| SALES module | Sales has its **own, disconnected** earned-leave concept: `salesSalaryComputation.js:264` `const earnedLeaveDays = 0; // EL manual entry — future Phase 3.5+`, fed into `totalDays` at `:265`, persisted as `earned_leave_days` (`:336, :385, :417, :457`) and exported as an "Earned Leave" column (`salesExportFormats.js:56, :85`). It is **always literally 0** and never touches `leave_balances` / `leave_applications` / `leave_accrual_ledger`. `grep -in leave` in `routes/sales.js` returns only one unrelated comment (`:1194`). | FACT |

### (e) Comp-off / OD lifecycle
1. **Request** — `POST /api/comp-off` (compensatoryOff.js:68, HR/admin). Validates non-empty `reason` + `hr_remark` (`:72-80`), days > 0 (`:81-84`), ISO dates (`:85-87`), start ≤ end (`:88-90`), contractor block (`:98-103`), days ≤ calendar days (`:107-112`), finalized-month block (`:115-120`). Inserts with `finance_status='pending'` (`:124-133`), UNIQUE conflict → 409 (`:135-141`), audit row (`:144-155`).
2. **Approve** — `PUT /:id/finance-review` (`:212`, finance/admin) or `PUT /bulk-review` (`:272`). `finance_remark` mandatory for approve *and* reject (`:221-223`); only `pending` rows transition (`:227-229`); single txn writes `compensatory_off_requests` + `finance_approvals` + `audit_log` (`:234-266`).
3. **Becomes a paid day** — only inside Stage 6. `payroll.js:205-211` selects the approved rows; `dayCalculation.js:424-439` converts each to `daysAbsent--` / `daysPresent++` / `odDays++`, and **only if that date was actually flagged absent** (`:433`). Weekly-off and holiday dates are skipped (`:430-432`).
4. **Becomes a salary line** — it does **not**. There is no OD earning component anywhere. `od_days` lands in `salary_computations` as a display bucket (`salaryComputation.js:798`, `:842`, `:908`) and on the payslip (`:1094`). The money effect is entirely indirect, via the one extra payable day. [FACT]
5. **Dead column:** `compensatory_off_requests.is_applied_to_salary` / `applied_to_salary_at` exist (schema.js:1561-1562) but `grep -rn is_applied_to_salary src/` returns **only** the schema definition — nothing ever reads or writes them. The header comment at `compensatoryOff.js:9-11` claims it "prevents double counting on Stage 7 recompute"; it does nothing. [FACT — code wins]

### (f) Short leave / gate pass
- **Quota rule:** 2 active (non-cancelled) gate passes per employee per calendar month — `short-leaves.js:120-134`. Breach returns HTTP 422 with `quota_warning: true` **unless** `force_quota_breach` is truthy; when forced, the row is stored with `quota_breach = 1` (`:136`). Quota surfaced read-only at `GET /quota/:employeeCode` (`:212-239`, `limit: 2` hardcoded at `:235`).
- **Other enforcement:** `leave_type ∈ {short_leave, half_day}` (`:52-54`), mandatory remark (`:55-57`), date not >7 days past (`:59-66`), UNIQUE per (employee, date) → 409 (`:159-161`). Cancellation blocked once the employee has punched out (`:272-280`).
- **Pay impact: none.** `short_leaves` is read in exactly one non-CRUD place — `earlyExitDetection.js:73-77` — where an active gate pass either fully exempts an early exit (`:88-92`) or reduces `flaggedMinutes` to the overage (`:94-96`). Early-exit *deductions* are a separate manual workflow (`routes/early-exit-deductions.js`) that joins `short_leaves` only for display (`:163`). The `short_leave_days` column on `day_calculations`/`salary_computations` is **not** gate-pass derived — it is `daysHalfPresent` (`dayCalculation.js:329`, `:608`). So a gate pass can only *avoid* a deduction; it never creates one, and it never changes payable days. [FACT]

### (g) Residual SL references (SL was supposedly removed)
Removed/blocked paths (FACT): `leaves.js:351-356` and `:478-481` reject non-CL/EL with "SL is no longer supported"; `financeAudit.js:562-565` same; `employees.js:299` comment "CL + EL only — SL abolished Apr 2026"; `reseed-leave-balances-2026.js:23` deletes 2026 SL rows.

Still-live SL residue:

| file:line | What |
|---|---|
| `services/dayCalculation.js:380` | `let leaveSlUsed = 0;` |
| `services/dayCalculation.js:464-466` | **live branch** `else if (leaveType === 'SL') { leaveSlUsed += 1; unpaidLeaveDays += 1; }` — an SL row in `leave_applications` still changes payable-day math |
| `services/dayCalculation.js:327` | contractor return `slUsed: 0` |
| `services/dayCalculation.js:605` | `slUsed:` in the result object |
| `services/dayCalculation.js:646, :684, :720` | `sl_used` column written/updated by `saveDayCalculation` |
| `services/dayCalculation.js:372-375` (comment) | "SL → same as CL (treated as informed but unpaid)" |
| `routes/financeAudit.js:626-627` | comment + `const leaveColumn = leave_type.toLowerCase() + '_used'; // cl_used, el_used, sl_used` — string-built column name; the route itself now rejects SL at `:562-565`, so the SL arm is dead but the mechanism survives |
| `routes/payroll.js:95`, `routes/import.js:1013`, `services/jobQueue.js:112` | `const leaveBalances = { CL: 0, EL: 0, SL: 0 };` |
| `services/phase5Features.js:64` | comment "SL: not accrued here (fixed annual entitlement — handled via Settings)" — stale; no Settings SL path exists |
| `database/schema.js:246` | `sl_used REAL DEFAULT 0` column still on `day_calculations` |
| `config/schemaReference.js:34` | `sl_used REAL` in the reference schema |
| `services/patternEngine/individualPatterns.js:26, :265, :379` | `['A','CL','SL','EL','L']` status classifiers |
| `services/patternEngine/flightRiskPatterns.js:57, :215` | same status arrays |
| `scripts/seed-test-data.js:135`, `scripts/phase5-simulation.js:175` | `sl_used`, `{CL:0,EL:0,SL:0}` |
| `src/__tests__/dayCalculation.test.js:33,39,46,54,68` | `{ CL: 12, EL: 0, SL: 0 }` |

**No CHECK constraint** exists on `leave_applications.leave_type`, `leave_balances.leave_type`, or `leave_transactions.leave_type` — all are bare `TEXT NOT NULL` (schema.js:100, :114, :407). SL (and any arbitrary string) is insertable at the DB layer; only the application layer rejects it, and `POST /api/portal/leave-apply` (employeePortal.js:57-65) does **not**. [FACT]

## D. Scripts (read only — none executed)

### `backend/scripts/reseed-leave-balances-2026.js` (412 lines)
- **Does:** One-off Apr-2026 policy reseed of 2026 leave balances for `status='Active' AND employment_type='Permanent'` (`:59-64`). CL = `computeClEntitlement(doj, 2026)` (`:85`) clamped by existing usage: `newBalance = max(0, entitlement − existing_used)` with a `grandfathered` flag when negative (`:87-89`). EL recomputed as `Σ over months 1..4 of floor(days_present/20) × el_accrual_rate` (`:91-97`).
- **WRITES (execute mode only):** `DELETE FROM leave_balances WHERE year=2026` — **all rows, not just permanents** (`:259`, `:290`); `DELETE FROM leave_accrual_ledger WHERE year=2026` (`:260`, `:291`); inserts 2 `leave_balances` rows/employee (`:299-311`); 2 `leave_accrual_ledger` rows/employee booked to month 1 (`:316-329`); 2 `audit_log` rows/employee (`:338-350`); 1 `policy_config` guard row `reseed_2026_v1` (`:353-357`). All inside one `db.transaction` (`:289-364`).
- **Idempotent?** Yes by guard, not by construction: a second `--execute-after-review` aborts at `:248-257`. Delete-all-then-reinsert means a re-run after manually deleting the guard would be destructive to any post-reseed manual adjustments. Dry-run opens the DB `{ readonly: true }` (`:382`) so it physically cannot write.
- **Auto-invoked?** No. `grep -rn reseed-leave-balances` outside docs returns only the script's own usage comments (`:6, :7, :238`). Not in root `package.json` scripts, not in `backend/package.json`, not in `start.sh`, not in `.github/workflows/ci.yml`. [FACT]

### `backend/scripts/phase5-simulation.js` (200 lines)
- **Does:** Self-contained assertion harness for the parser + the re-import recompute path. Points `DATA_DIR` at a fresh `fs.mkdtempSync` temp dir (`:17-20`) and sets `NODE_ENV=test`.
- **WRITES:** Only into that throwaway DB — `employees`, `monthly_imports`, `attendance_processed`, `day_calculations`, `salary_computations` (`:132-151`), then DELETEs and re-inserts via `calculateDays`/`saveDayCalculation` (`:163-181`). Calls `calculateDays` with `{CL:0,EL:0,SL:0}` and empty `approvedLeaves`/`approvedCompOff` (`:173-179`) — it does **not** exercise the leave path. Temp dir removed at exit.
- **Idempotent?** Yes — fresh temp DB each run; production DB untouched. Exits non-zero on failure.
- **Auto-invoked?** No (referenced only by its own header comment `:9` and CLAUDE.md prose).

### `backend/scripts/investigate-manoj.js` (179 lines)
- **Does:** Read-only diagnostic dump for one employee code for Mar-2026 — employee master, day-by-day attendance, `day_calculations` fields incl. `cl_used`/`el_used`/`lop_days` (`:89`, `:115`), and a hand-recomputation of payable days (`:122-123`).
- **WRITES:** No `INSERT`/`UPDATE`/`DELETE` statements (`grep` → zero hits). **However** it calls `getDb()` (`:14-15`), and `db.js:26` runs `initSchema(db)` — so the process will apply pending migrations, `safeAddColumn`s and `insertPolicyIfMissing` rows against the **production** DB (it `process.chdir`s to `backend/` at `:13`). It is therefore not strictly read-only. [FACT + INFERENCE]
- **Idempotent?** Effectively yes (schema init is idempotent), but it embeds a real employee code and should be treated as a one-off.
- **Auto-invoked?** No.

### Other leave-touching scripts
`backend/scripts/seed-test-data.js:135` writes `cl_used/el_used/sl_used/lop_days` into `day_calculations` for fixtures. `check-contractor-mismatches.js` and `insert-sales-master-2026-05-07.js` contain no leave references. None are auto-invoked. [FACT]

## E. Business rules as implemented

| Rule | file:line | Note |
|---|---|---|
| CL/EL hard-blocked at insufficient balance on **submission** | leaves.js:75-87 | `currentBalance < leaveDays` → 400. LWP/OD exempt (comment `:74`) |
| CL/EL hard-blocked at insufficient balance on **approval** | leaves.js:138-150 | Second, independent check |
| `hr_remark` mandatory for CL / EL / LWP | leaves.js:66-71 | 400 if blank |
| No new leave into a finalized month | leaves.js:92-102 | Reads `monthly_imports.is_finalised` |
| No cancellation inside a finalized month | leaves.js:195-203 | |
| Cancel is a soft status change; only Pending/Approved cancellable | leaves.js:186-191, :209-213 | Audit row at `:227` |
| Balance credit-back on cancelling an Approved CL/EL | leaves.js:216-222 | `used = MAX(0, used − days)` |
| Balance debit happens **once**, at approval | leaves.js:158-164 | Stage 6 is explicitly read-only w.r.t. balances — payroll.js:234-238 |
| Adjust/bulk-adjust restricted to CL/EL | leaves.js:351-356, :478-481 | "SL is no longer supported" |
| Adjust transaction_type allow-list | leaves.js:358-361 | Credit / Debit / Manual Adjustment / Opening Balance / Carry Forward |
| Adjust **can drive balance negative** | leaves.js:381-385, :503-507 | `newBalance = oldBalance − abs(days)`, no floor |
| CL entitlement pro-rated by DOJ | phase5Features.js:27-39 | `7 − floor((effMonth−1)/2)`; mid-month DOJ rolls to next month; pre-year/null DOJ ⇒ 7; DOJ after year ⇒ 0 |
| CL is opening-grant only, never accrued monthly | phase5Features.js:220-259 | `upsertLedger(... 'CL', clOpening, 0, clUsed, clClosing …)` — accrued hardcoded 0 |
| CL seed is conflict-safe (manual edits survive) | phase5Features.js:113-117, :225 | `ON CONFLICT … DO NOTHING` |
| EL eligibility floor from DOJ | phase5Features.js:185-191 | `policy_config.el_eligibility_days`, default 180 (schema.js:1617) |
| EL accrual = `floor(paid_days_ytd / 20) × rate` | phase5Features.js:193-197 | rate from `policy_config.el_accrual_rate`, default 1 (schema.js:632); accrual is the delta vs running earned total |
| `paid_days_this_month` definition | phase5Features.js:159-166 | `days_present + days_wop + paid_sundays + paid_holidays + EL_used + od_days` |
| Accrual is idempotent per (month, year) | phase5Features.js:96-104, :210-218 | Ledger UPSERT; balances re-derived by summing the ledger |
| Accrual population restricted | phase5Features.js:12, :81-88, :129 | `employment_type IN ('Permanent')` + contractor skip |
| `initCLOpening` once-per-year guard | phase5Features.js:294-307, :374-384 | `policy_config.cl_seed_<year>_v1`; returns `alreadyCompleted` |
| Year-end lapse: **both** CL and EL lapse to 0 | phase5Features.js:394-450 | Ledger month 12 lapse row + `Year-End Lapse` transaction + `balance = 0` |
| EL restores payable; CL/SL/LWP only reclassify | dayCalculation.js:458-470, :514-517 | `unpaidLeaveDays` added back into `totalAbsences` |
| OD only fires on a genuinely absent day | dayCalculation.js:433 | Prevents double-count on an already-present day |
| One date consumed once (comp-off vs leave) | dayCalculation.js:384, :429, :448 | `consumedDates` set |
| Weekly-off / holiday dates never consume leave | dayCalculation.js:430-432, :449-451 | |
| Pre-DOJ dates excluded from everything | dayCalculation.js:152-153, :168, :227, :428, :447 | Mid-month-joiner rule |
| **LOP fallback: there is none** | salaryComputation.js:608 | `const lopDeduction = 0; // Pro-rating handles absent days` — flows into `totalDeductions` at `:697` as a literal zero |
| Negative-balance handling in finance correction | financeAudit.js:582-585, :609-611 | Logs a warning, sets `isLWP=true`, **proceeds anyway**, and can insert a row with `used=1, balance=-1` |
| Comp-off: finance remark mandatory both ways | compensatoryOff.js:221-223 | |
| Comp-off: approved rows immutable | compensatoryOff.js:347-352 | Only `pending` deletable |
| Gate-pass quota 2/month, force-breachable | short-leaves.js:127-136 | |
| Gate pass ≤ 7 days retro | short-leaves.js:59-66 | |
| Gate pass duration: short_leave = 3.0h; half_day = ½ shift | short-leaves.js:102-110 | |

## F. Findings

1. **[FACT — phase5.js:38 + repo-wide grep]** Leave accrual is 100% manual and unscheduled. `runLeaveAccrual` has exactly one call site (`routes/phase5.js:38`). Stage 7 finalize (`payroll.js:1031-1077`), `monthEndScheduler` (single cron at `:101` → `checkPipelineStatus`), `jobQueue` (types `salary_compute`/`day_calculate` only) and server boot (`server.js:339-349`) never invoke it. If nobody clicks the button, `leave_accrual_ledger` simply has no rows for that month.
2. **[FACT — server.js:212 vs phase5.js:33]** `POST /accrue-leaves` is mounted at **`/api/features`**, not `/api/phase5`, and unlike its two siblings (`:51`, `:76`) it carries **no `requireHrOrAdmin`**. Any authenticated principal — including an `employee`-role portal user — can rewrite every employee's `leave_balances` and `leave_accrual_ledger` for any month. This is the single highest-severity authorization gap found.
3. **[FACT — employees.js:302 and :942 vs phase5Features.js:27-39]** Contradiction inside the backend itself: employee creation and bulk-import seed `leave_balances` with **CL opening = 12** (and bulk-import does it for both 2025 *and* 2026), while the Apr-2026 policy function caps CL at **7** and pro-rates by DOJ. A newly created employee therefore starts with 12 CL; `initCLOpening`/`runLeaveAccrual` will not correct it because both use `ON CONFLICT … DO NOTHING` (`phase5Features.js:116, :322`). **Code wins over CLAUDE.md** here — CLAUDE.md's leave section (`:1528`) lists the tables but never states the entitlement.
4. **[FACT — employeePortal.js:57-65]** `POST /api/portal/leave-apply` bypasses every rule enforced in `leaves.js`: no balance check, no `hr_remark`, no finalized-month lock, no `leave_type` whitelist (SL or any arbitrary string is accepted), and it does **not** populate `employee_id` (the column exists, schema.js:405). An employee can self-file unlimited leave of any type into a locked month.
5. **[FACT — employeePortal.js:71 vs schema.js:402-418 + :1613]** `GET /api/portal/leave-history` runs `ORDER BY created_at`, but `leave_applications` has no `created_at` column — its timestamp is `applied_at` (schema.js:412), and the only later `safeAddColumn` on that table is `hr_remark` (schema.js:1613). **[INFERENCE]** This endpoint will throw `SQLITE_ERROR: no such column: created_at` at runtime unless the production DB acquired the column out-of-band. (Not verified against the live DB — I did not open it.)
6. **[FACT — financeAudit.js:552-656]** `POST /corrections/apply-leave` is a **second, parallel leave-consumption engine** that bypasses `leave_applications` entirely: it flips `attendance_processed.status_final` to `'CL'`/`'EL'` (`:598-600`), debits `leave_balances` (`:603-612`), writes a `leave_transactions` Debit (`:621-624`), and then hand-patches `day_calculations` with `days_absent − 1`, `<type>_used + 1`, `total_payable_days + 1` (`:628-634`). Three consequences: (i) it is **unguarded** — no `requireFinanceOrAdmin` despite the middleware being imported at `:17`; (ii) it happily drives the balance to `-1` (`:609-611`) after only a `console.warn` (`:582-585`); (iii) its `day_calculations` patch is **destroyed by the next Stage 6 run**, and worse — because `status_final='CL'` is not a recognised status in `dayCalculation.js:263-285`, the re-run falls into the ghost catch-all at `:284` and counts that day as **absent** again. Note also it credits `total_payable_days + 1` for CL, whereas the canonical Stage 6 rule says CL does *not* increase payable (`dayCalculation.js:461-463`). The two engines disagree on the core business rule.
7. **[FACT — missPunch.js:125-126 + dayCalculation.js:263-285]** Same class of bug via a different door: `resolveMissPunch({convertToLeave:true, leaveType})` writes `status_final = leaveType` (e.g. `'CL'`) with no validation. `dayCalculation` has no branch for `CL/EL/SL/LWP` statuses, so the day lands in the ghost catch-all (`:284`) and is counted absent. Converting a miss punch to leave silently *costs* the employee a day unless a matching `leave_applications` row also exists.
8. **[FACT — dayCalculation.js:126, :141, :161-162; payroll.js:95-99]** The `leaveBalances` parameter of `calculateDays` is dead — declared, documented "unused", passed by all four production callers, and referenced nowhere in the body. `payroll.js:95-99` and `jobQueue.js:112-116` each run a per-employee `SELECT * FROM leave_balances` purely to feed it. **[OPINION]** Wasted query per employee per run, and a misleading signature that invites future authors to think balances gate the day calc.
9. **[FACT — dayCalculation.js:442-472]** Stage 6 consumes approved leave **without any balance check and without any quantity cap**. A 30-day approved EL application restores 30 absences. The only balance gate lives at submission/approval time in `leaves.js` — which `employeePortal.js:57` and `financeAudit.js:552` both bypass (Findings 4, 6). **[INFERENCE]** A leave row created through either bypass becomes paid days with no balance ever having been checked.
10. **[FACT — leaves.js:381-392 and :503-513]** `POST /leaves/adjust` and `/bulk-adjust` compute `newBalance = oldBalance − abs(days)` with no floor, so a Debit adjustment can push `leave_balances.balance` negative — the exact state the `:75-87` / `:138-150` hard blocks exist to prevent.
11. **[FACT — leaves.js:366, :489 vs :76, :139]** `/adjust` and `/bulk-adjust` hardcode `currentYear = new Date().getFullYear()` and ignore any year in the request, while submit/approve derive the year from `start_date`. **[INFERENCE]** Adjusting a prior-year balance is impossible, and a December adjustment for a January leave lands in the wrong year's row.
12. **[FACT — phase5Features.js:141-157 vs dayCalculation.js:442-472]** Two different definitions of "leave used in month M". Accrual attributes a whole application to `strftime('%Y-%m', start_date)` (`:147`, `:156`) — a leave spanning Mar 30 → Apr 3 counts entirely in March. Stage 6 expands it day-by-day and skips weekly offs/holidays (`:444-451`). So `leave_accrual_ledger.used` and `day_calculations.cl_used`/`el_used` will disagree for any cross-month or weekend-spanning leave, and the annual summary (`leaves.js:559-632`) mixes both sources.
13. **[FACT — phase5Features.js:169-181, :199-200]** EL accrual chains off the *previous month's* ledger row. If a month is skipped (which is the default, per Finding 1), `prevElRow` is undefined, `prevPaidYtd`/`prevElEarnedYtd`/`prevElClosing` all fall back to 0, and the YTD chain silently restarts from zero. **[INFERENCE]** Running accrual for June without having run it for May yields a wrong, lower EL entitlement — and because the ledger UPSERT makes it look authoritative, the error is not visible.
14. **[FACT — phase5Features.js:186-190]** EL eligibility uses `new Date(emp.date_of_joining)` (local parse) subtracted from `Date.UTC(...)` (`:188`). **[INFERENCE]** Mixed local/UTC arithmetic — off-by-hours, which only matters for a DOJ sitting exactly on the 180-day boundary, but it is inconsistent with `computeClEntitlement`, which is carefully all-UTC (`:31-35`).
15. **[FACT — schema.js:1561-1562 + grep]** `compensatory_off_requests.is_applied_to_salary` / `applied_to_salary_at` are never read or written anywhere in `src/`. The file header (`compensatoryOff.js:9-11`) advertises them as the Stage-7 double-count guard. **Code wins: the guard does not exist.** In practice re-running Stage 6 is idempotent anyway because `saveDayCalculation` UPSERTs, so there is no live double-count — but the comment is false.
16. **[FACT — compensatoryOff.js:6-7 vs dayCalculation.js:424-439]** The same header says "Approved rows are picked up by Stage 6 / Stage 7 **in later phases** — nothing here touches day_calculations or salary_computations." That later phase has shipped: `payroll.js:205-211` + `dayCalculation.js:424-439` consume comp-off today. Stale comment.
17. **[FACT — short-leaves.js:127-136; dayCalculation.js:329, :608]** Gate passes have **zero** pay impact, and the `short_leave_days` column that reaches the payslip (`salaryComputation.js:799`, `:1095`) is *not* gate-pass data — it is `daysHalfPresent`. **[OPINION]** Two unrelated concepts share a column name that surfaces on the payslip as "Short Leave"; anyone reconciling the payslip against `/api/short-leaves/quota/:code` will get different numbers.
18. **[FACT — short-leaves.js:44]** No contractor gate on gate passes, unlike comp-off (`compensatoryOff.js:98`), OT, ED and late-coming. Inconsistent with the stated Apr-2026 contractor policy.
19. **[FACT — dayCalculation.js:464-466 + 14 other sites listed in §C(g)]** SL removal is incomplete. The removal was done at the *validation* layer only (`leaves.js:351`, `:478`; `financeAudit.js:562`); the *consumption* layer still has a fully live SL branch, `sl_used` is still computed, persisted and exposed, and there is **no CHECK constraint** on any `leave_type` column (schema.js:100, :114, :407). An SL row entering via `POST /api/portal/leave-apply` (Finding 4) or via a direct DB write is processed normally end-to-end.
20. **[FACT — salaryComputation.js:608, :697]** `lopDeduction` is a hardcoded `0` that is still summed into `totalDeductions` and persisted (`:786`, `:918`). LWP reduces pay only by *not* restoring an absence. **[OPINION]** Correct arithmetic, but the surviving `lop_deduction` column will read as a bug to any auditor comparing LWP days against a zero LOP deduction — and `payroll.js:1083-1105` (late-deduction) writes into `day_calculations.lop_days`, mixing a *late-coming* penalty into the *leave-without-pay* counter that the payslip labels "LWP" (`salaryComputation.js:797`, `:1093`).
21. **[FACT — salesSalaryComputation.js:264]** Sales has its own `earned_leave_days`, permanently `0`, wired into `totalDays` (`:265`), persisted (`:336`, `:385`, `:417`, `:457`) and shipped as a populated-looking "Earned Leave" column in the HR Excel export (`salesExportFormats.js:56`, `:85`). It never reads `leave_balances` / `leave_applications` / `leave_accrual_ledger`. **Sales employees accrue and consume no leave in this system.**
22. **[FACT — phase5.js:51, :76 + frontend grep]** `init-cl-opening` and `year-end-lapse` have no caller in `frontend/src` (0 hits for either path). **[INFERENCE]** Two balance-mutating, year-boundary-critical operations are reachable only by hand-crafted HTTP calls, which makes the annual CL grant and the annual lapse dependent on someone remembering to curl them.
23. **[FACT — reseed-leave-balances-2026.js:259, :290]** The reseed's `DELETE FROM leave_balances WHERE year = ?` is **unscoped by employee type** — it removes 2026 rows for *every* employee, then re-inserts only for active permanents. Non-permanent 2026 balances are destroyed, not migrated. The script's own header (`:11-12`) states this is intended; the guard `reseed_2026_v1` (`:248-257`) makes it one-shot. Flagging because it is irreversible and the guard is deletable by hand (`:253-254`).
24. **[FACT — investigate-manoj.js:13-15 + db.js:26]** Described as an investigation script, but `getDb()` triggers `initSchema()` against the production DB, so it is not read-only. It also hardcodes a live employee code and name in comments.
25. **[FACT — phase5Features.js:656-668]** ~13 lines of commented-out "TEMP TEST BLOCK — remove after verification" `console.log` assertions sit at the bottom of the accrual service. **[OPINION]** Harmless, but these are real test cases for `computeClEntitlement` that belong in `src/__tests__/` — there is currently **no** test file covering any leave function (`src/__tests__/` contains only `dayCalculation.test.js`, which passes empty leave arrays).
26. **[FACT — leaves.js:116]** The `LEAVE_REQUEST` notification message is built as `` `${emp.id}: ${employeeCode} requested …` `` — it prefixes the internal DB id, almost certainly meant to be the employee name. Cosmetic, but it leaks an internal identifier into a user-visible string.

---

## Provenance note (added by orchestrator, not the agent)

This file was produced by the backend Explore subagent, which ran without `Write` in its toolset
and handed its report back as text (persisted by the harness, then transcribed here verbatim).
Independent spot-checks of a sample of these `file:line` references are recorded in the VERIFY
section of `LEAVE_INVENTORY.md`.

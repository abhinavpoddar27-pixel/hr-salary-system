# HR Intelligence & Salary Processing Platform
- Stack: React (Vite) + Tailwind frontend, Node.js/Express backend, SQLite (better-sqlite3, WAL mode)
- Companies: Indriyan Beverages, Asian Lakto Ind. Ltd. (global company filter)
- Data source: EESL biometric attendance XLS (uploaded monthly)
- Pipeline: 7-stage attendance-to-salary processing
- Deployment: Railway | GitHub: abhinavpoddar27-pixel/hr-salary-system

## Section 2: Directory Map
```
backend/
├── server.js                                  Express bootstrap, auth seeding, route mounting
├── src/
│   ├── database/
│   │   ├── schema.js                          43 tables, all CREATE TABLE definitions, migrations
│   │   └── db.js                              better-sqlite3 wrapper, logAudit() helper
│   ├── middleware/auth.js                     JWT verify, requireAuth, requireAdmin
│   ├── config/permissions.js                  Role → page access matrix
│   ├── utils/employeeClassification.js        isContractor() — dept keywords + flag
│   ├── utils/pagination.js                    Server-side pagination helper
│   ├── routes/
│   │   ├── auth.js              Login, JWT, user CRUD, permissions
│   │   ├── import.js            Stage 1: EESL XLS upload, parse, deduplication
│   │   ├── attendance.js        Stages 2-5: miss-punch, shift-check, night-shift, corrections
│   │   ├── payroll.js           Stages 6-7: day calc, salary compute, finalise, payslip
│   │   ├── employees.js         Employee CRUD, salary structure, leave balances
│   │   ├── salary-input.js      Manual salary inputs (loans, deductions, advances)
│   │   ├── advance.js           Salary advance calc, mark-paid, recovery
│   │   ├── loans.js             Loan disbursal, EMI tracking, recovery
│   │   ├── leaves.js            Leave applications, approve/reject, balance check
│   │   ├── reports.js           Bank NEFT, PF ECR, ESI returns, month-end exports
│   │   ├── financeAudit.js      16 endpoints: report, corrections, manual flags, bias
│   │   ├── financeVerification.js  11 endpoints: red flag review, signoff workflow
│   │   ├── extraDutyGrants.js   Dual HR+Finance approval for overnight shifts
│   │   ├── settings.js          Shifts, holidays, policy_config, companies
│   │   ├── analytics.js         Workforce + attendance analytics
│   │   ├── compliance.js        PF/ESI/PT compliance dashboard
│   │   ├── notifications.js     User notification CRUD
│   │   ├── jobs.js              Background job queue
│   │   ├── taxDeclarations.js   FY tax declarations for TDS auto-calc
│   │   ├── employeePortal.js    Employee self-service API
│   │   ├── daily-mis.js         Daily attendance MIS dashboard
│   │   ├── lifecycle.js         Hire/exit lifecycle events
│   │   ├── sessionAnalytics.js  User session tracking
│   │   ├── usage-logs.js        Admin usage audit
│   │   ├── phase5.js            Leave accrual, shift roster, attrition
│   │   └── analytics.js         Workforce analytics
│   └── services/
│       ├── parser.js                 EESL XLS parsing — dynamic column detection
│       ├── missPunch.js              Stage 2: detect missing IN/OUT, NIGHT_UNPAIRED
│       ├── nightShift.js             Stage 4: pair IN day D + OUT day D+1
│       ├── dayCalculation.js         Stage 6: payable days, Sunday rule, contractor mode
│       ├── salaryComputation.js      Stage 7: earned salary, deductions, net
│       ├── advanceCalculation.js     Salary advance eligibility (50% rule)
│       ├── loanService.js            Loan EMI generation
│       ├── tdsCalculation.js         Indian tax slabs FY 2025-26
│       ├── financeRedFlags.js        8 red flag detectors for finance review
│       ├── jobQueue.js               SQLite-backed background job worker
│       ├── monthEndScheduler.js      node-cron pipeline status notifications
│       ├── analytics.js              Workforce analytics calculations
│       ├── dailyMIS.js               Daily MIS report generation
│       ├── exportFormats.js          PF ECR, ESI, NEFT, bank file generators
│       ├── behavioralPatterns.js     Late/absenteeism pattern detection
│       └── phase5Features.js         Leave accrual, attrition risk

frontend/
├── src/
│   ├── App.jsx                       Routes, Layout, RequireAuth wrapper
│   ├── main.jsx                      React entry
│   ├── store/appStore.js             Zustand global store (user, company, sidebar)
│   ├── pages/
│   │   ├── Login.jsx                 Auth
│   │   ├── Dashboard.jsx             Overview
│   │   ├── DailyMIS.jsx              Daily MIS
│   │   ├── Import.jsx                Stage 1
│   │   ├── MissPunch.jsx             Stage 2
│   │   ├── ShiftVerification.jsx     Stage 3
│   │   ├── NightShift.jsx            Stage 4
│   │   ├── AttendanceRegister.jsx    Stage 5 (corrections)
│   │   ├── DayCalculation.jsx        Stage 6
│   │   ├── SalaryComputation.jsx     Stage 7
│   │   ├── Employees.jsx             Employee master
│   │   ├── SalaryInput.jsx           Manual salary inputs
│   │   ├── SalaryAdvance.jsx         Advance management
│   │   ├── Loans.jsx                 Loans management
│   │   ├── LeaveManagement.jsx       Leaves
│   │   ├── Reports.jsx               Bank, PF, ESI exports
│   │   ├── FinanceAudit.jsx          Finance audit (7 tabs)
│   │   ├── FinanceVerification.jsx   Finance red flag verify + signoff
│   │   ├── ExtraDutyGrants.jsx       Dual-approval overnight grants
│   │   ├── Settings.jsx              Shifts, holidays, policy, users
│   │   ├── Compliance.jsx            PF/ESI compliance
│   │   ├── Analytics.jsx             Attendance analytics
│   │   ├── WorkforceAnalytics.jsx    Workforce metrics
│   │   ├── SessionAnalytics.jsx      User session analytics
│   │   └── Alerts.jsx                System alerts
│   ├── components/
│   │   ├── layout/{Sidebar,Header,NotificationBell}.jsx
│   │   ├── pipeline/PipelineProgress.jsx
│   │   ├── shared/CompanyFilter.jsx
│   │   ├── common/{DataTable,DateSelector,StatCard}.jsx
│   │   └── ui/{Modal,ConfirmDialog,Tooltip,CalendarView,...}.jsx
│   ├── hooks/
│   │   ├── useDateSelector.js        Month/year picker with store sync
│   │   ├── useExpandableRows.js
│   │   └── useInactivityTimeout.js
│   └── utils/{api,formatters,abbreviations,payslipPdf,sessionTracker}.js
```

## Section 3: Pipeline Stage Dependency Map

## Stage 1: Import (EESL biometric upload)
- Route: `backend/src/routes/import.js` → `POST /upload`, `GET /history`, `GET /summary/:month/:year`, `POST /reconciliation/*`
- Service: `backend/src/services/parser.js` → `parseEESLFile()`, `findLandmarks()`, `parseSheet()`, `normalizeTime()`
- Tables read: `employees` (lookup by code for company fallback), `monthly_imports`
- Tables written: `monthly_imports` (one row per file), `attendance_raw` (~9000 rows/month), `attendance_processed` (deduped, status_original set)
- Input contract: EESL .xls file uploaded via multipart; valid month/year extracted from sheet
- Output contract: `attendance_processed` row per (employee_code, date) with `in_time_original`, `out_time_original`, `status_original`, `is_night_out_only` flags. Auto-detects night shifts (in_time >= 19:00 OR < 6:00).
- Downstream consumers: Stages 2-7 ALL read `attendance_processed`
- Business rules: dynamic column scanning for "Emp. Name" header (handles format variations), company fallback from employee master if EESL company column empty, dedup on (employee_code, date)
- Edge cases: month boundary handling, empty company column, multi-sheet files

## Stage 2: Miss Punch Detection
- Route: `backend/src/routes/attendance.js` → `GET /miss-punches`, `POST /miss-punches/:id/resolve`, `POST /miss-punches/bulk-resolve`
- Service: `backend/src/services/missPunch.js` → `detectMissPunches()`, `applyMissPunchFlags()`
- Tables read: `attendance_processed`
- Tables written: `attendance_processed` (sets `is_miss_punch=1`, `miss_punch_type`, `miss_punch_status`)
- Input contract: Stage 1 complete (attendance_processed populated)
- Output contract: Records flagged as MISSING_IN, MISSING_OUT, NIGHT_UNPAIRED, NO_PUNCH
- Downstream consumers: Stage 6 day calculation reads status_final
- Business rules: Detects ~145 cases/month. Manual resolution updates status_final and in_time_final/out_time_final
- Edge cases: Night shift unpaired, weekly off worked

## Stage 3: Shift Check
- Route: `backend/src/routes/attendance.js` → `GET /shift-mismatches`, `PUT /record/:id`
- Service: Inline in attendance.js
- Tables read: `attendance_processed`, `shifts`, `employees`
- Tables written: `attendance_processed` (shift_id, shift_detected)
- Input contract: Stage 2 complete (miss punches resolved)
- Output contract: Each record has shift assigned (auto from punch time or manual override)
- Downstream consumers: Stage 4 night shift pairing, Stage 6 day calc
- Business rules: Auto-detect night shift if in_time >= 19:00 or < 06:00

## Stage 4: Night Shift Pairing
- Route: `backend/src/routes/attendance.js` → `GET /night-shifts`, `POST /night-shifts/:id/confirm`, `POST /night-shifts/:id/reject`
- Service: `backend/src/services/nightShift.js` → `pairNightShifts()`, `applyPairingToDb()`
- Tables read: `attendance_processed`
- Tables written: `night_shift_pairs`, `attendance_processed` (sets `is_night_out_only=1` on the OUT-only record so it's not double-counted)
- Input contract: Stage 3 complete
- Output contract: Pairs of IN day D with OUT day D+1 form a single shift
- Downstream consumers: Stage 6 day calc (skips records with is_night_out_only=1)
- Business rules: ~190 pairs/month. IN >= 18:00 day D + OUT <= 12:00 day D+1
- Edge cases: Cross-month boundary (Dec 31 → Jan 1)

## Stage 5: Manual Corrections
- Route: `backend/src/routes/attendance.js` → `PUT /record/:id`, `POST /miss-punches/:id/resolve`; `backend/src/routes/financeAudit.js` → `POST /day-correction`, `POST /punch-correction`, `POST /corrections/apply-leave`, `POST /corrections/mark-present`
- Service: Inline + financeAudit.js
- Tables read: `attendance_processed`, `day_corrections`, `punch_corrections`
- Tables written: `day_corrections` (audit trail), `punch_corrections` (audit trail), `attendance_processed` (status_final updated), `manual_attendance_flags`
- Input contract: Stages 1-4 complete
- Output contract: Final attendance state ready for day calculation
- Downstream consumers: Stage 6 day calc reads `status_final`
- Business rules: Every correction logged with reason + user
- Edge cases: Apply leave (A → CL/EL/SL with balance check), mark present with evidence

## Stage 6: Day Calculation
- Route: `backend/src/routes/payroll.js` → `POST /calculate-days`, `GET /day-calculations`, `GET /day-calculations/:code`, `PUT /day-calculations/:code/late-deduction`
- Service: `backend/src/services/dayCalculation.js` → `calculateDays(empCode, month, year, company, records, leaveBalances, holidays, options)`, `saveDayCalculation()`
- Tables read: `attendance_processed`, `holidays`, `leave_balances`, `employees`, `extra_duty_grants` (manual grants with both approvals)
- Tables written: `day_calculations` (one row per employee per month per company)
- Input contract: Stages 1-5 complete; `is_contractor` flag set on employee
- Output contract: `day_calculations` row with: total_payable_days, days_present, days_half_present, days_wop, days_absent, paid_sundays, paid_holidays, lop_days, ot_hours, extra_duty_days, holiday_duty_days, week_breakdown (JSON)
- Downstream consumers: Stage 7 salary computation, Finance Audit, Reports
- Business rules:
  - Sunday rule (permanent only): worked >=6 Mon-Sat → paid Sunday; 4-5 → CL/EL fallback or LOP if shortage <=1.5; <4 → unpaid Sunday
  - WOP days (worked on Sunday) → always paid
  - Half-day (½P) = 0.5 working day
  - Contractor mode: payable = present + WOP + halfPresent (no Sunday eligibility, no CL/EL)
  - LOP waived if total worked days >= total working days OR rawPayableDays >= calendar days
  - Manual extra duty grants added when both HR + Finance approved
- Edge cases: Cross-month night shifts, holidays on Sundays, partial weeks at month boundary

## Stage 7: Salary Computation
- Route: `backend/src/routes/payroll.js` → `POST /compute-salary`, `GET /salary-register`, `POST /finalise`, `GET /payslip/:code`, `GET /salary-slip-excel`
- Service: `backend/src/services/salaryComputation.js` → `computeEmployeeSalary()`, `saveSalaryComputation()`, `generatePayslipData()`, `getAdvanceRecovery()`, `getLoanDeductions()`
- Tables read: `day_calculations`, `salary_structures`, `employees`, `salary_advances`, `loan_repayments`, `tax_declarations`, `policy_config`
- Tables written: `salary_computations` (one row per employee per month per company), `salary_manual_flags` (auto-populated for finance audit), `salary_advances` (marked recovered)
- Input contract: Stage 6 complete; salary_structures populated; `employees.gross_salary` set
- Output contract: salary_computations row with: gross_salary, gross_earned, basic/da/hra/conveyance/other_allowances_earned, ot_pay, holiday_duty_pay, pf_employee/employer, esi_employee/employer, professional_tax, tds, advance_recovery, loan_recovery, lop_deduction, total_deductions, net_salary, salary_held, hold_reason, finance_remark
- Downstream consumers: Finance Audit, Finance Verify, Payslip PDF, Bank NEFT export, PF ECR, ESI returns
- Business rules:
  - divisor = 26 (from policy_config.salary_divisor)
  - earnedRatio = min(actualWorkDays / totalWorkingDays, 1.0) — capped to prevent overcalculation
  - grossEarned = min(sum of components, grossMonthly) + otPay + holidayDutyPay
  - PF: 12% of min(basic+da, 15000 ceiling), only if pf_applicable
  - ESI: 0.75% employee / 3.25% employer of grossEarned, only if grossMonthly <= 21000
  - PT: Punjab slabs — 0/150/200 for <=15K/15-25K/>25K
  - LOP: pro-rating handles it (no separate deduction)
  - Auto-hold: payable_days < 5 OR 7+ end-of-month consecutive absent days
  - Finance sign-off gate blocks finalisation
- Edge cases: SILP/contract employees skip pf_applicable check, gross changed flag, returning employees

## Consumer: Finance Audit
- Route: `backend/src/routes/financeAudit.js` → 16 endpoints (`/report`, `/day-correction`, `/punch-correction`, `/corrections/:code`, `/corrections-summary`, `/corrections/apply-leave`, `/corrections/mark-present`, `/manual-flags`, `/salary-manual-flags`, `/approve-flag/:id`, `/bulk-approve`, `/readiness-check`, `/variance-report`, `/statutory-crosscheck`)
- Tables read: `salary_computations`, `day_calculations`, `day_corrections`, `punch_corrections`, `manual_attendance_flags`, `salary_manual_flags`, `finance_approvals`, `audit_log`
- What it produces: 7-tab UI (Readiness, Manual Interventions, Variance, Statutory, Report, Attendance Flags, Corrections Summary)
- Sensitivity: Any change to salary_computations columns or day_calculations columns breaks report queries

## Consumer: Finance Verification
- Route: `backend/src/routes/financeVerification.js` → 11 endpoints (`/dashboard`, `/employees`, `/employee/:code`, `/red-flags`, `/status`, `/bulk-verify`, `/comment`, `/comments`, `/comment/:id/resolve`, `/signoff`, `/signoff-status`)
- Service: `backend/src/services/financeRedFlags.js` → `detectRedFlags()` with 8 detectors
- Tables read: `salary_computations`, `day_calculations`, `salary_advances`, `salary_structures`, `employees`, `finance_audit_status`, `finance_audit_comments`
- Tables written: `finance_audit_status`, `finance_audit_comments`, `finance_month_signoff`
- What it produces: 3-tab dashboard (Audit Dashboard, Employee Review, Red Flags) + sign-off workflow
- Sensitivity: Red flag detection queries assume specific column names on salary_computations

## Consumer: Payslip PDF
- Route: `backend/src/routes/payroll.js` → `GET /payslip/:code`, `GET /payslips/bulk`, `GET /salary-slip-excel`
- Service: `salaryComputation.js → generatePayslipData()`; `frontend/src/utils/payslipPdf.js`
- Tables read: `salary_computations`, `day_calculations`, `employees`, `salary_structures`, `company_config`
- What it produces: Individual PDF per employee + bulk Excel salary slip (4 per page)
- Sensitivity: Field name changes in salary_computations break PDF rendering

## Consumer: Salary Advance
- Route: `backend/src/routes/advance.js` → `GET /`, `POST /calculate`, `PUT /:id/mark-paid`, `GET /recovery`, `PUT /:id/set-remark`
- Service: `backend/src/services/advanceCalculation.js → calculateAdvances()`
- Tables read: `attendance_processed` (1st-15th working days), `employees`, `salary_structures`
- Tables written: `salary_advances`
- What it produces: Mid-month advance eligibility (50% of pro-rata salary if 15+ working days in 1st half)
- Sensitivity: Stage 7 reads `salary_advances` for recovery — schema must remain stable

## Consumer: Loans
- Route: `backend/src/routes/loans.js` → `GET /`, `POST /`, `POST /:id/disburse`, `POST /:id/recover`, `GET /monthly-recovery/:month/:year`
- Service: `backend/src/services/loanService.js`
- Tables read/written: `loans`, `loan_repayments`
- What it produces: EMI schedules; Stage 7 reads pending EMIs for the month
- Sensitivity: `loan_repayments` schema feeds salary computation deductions

## Consumer: Reports / Exports
- Route: `backend/src/routes/reports.js` → `GET /pf-ecr`, `GET /esi-return`, `GET /bank-neft`, `GET /attendance-summary`
- Service: `backend/src/services/exportFormats.js`
- Tables read: `salary_computations`, `employees`, `salary_structures`
- What it produces: PF ECR text file, ESI return CSV, Bank NEFT CSV, monthly attendance summary
- Sensitivity: Any column rename in salary_computations breaks exports

## Consumer: Analytics + Compliance + Daily MIS
- Routes: `analytics.js`, `compliance.js` (in settings.js), `daily-mis.js`
- Tables read: `attendance_processed`, `day_calculations`, `salary_computations`, `employees`
- Sensitivity: Read-only consumers; column changes break dashboard widgets

## Section 4: Database Schema Summary
- Total tables: **43** (in `backend/src/database/schema.js`)
- Attendance: `attendance_raw`, `attendance_processed`, `night_shift_pairs`, `monthly_imports`, `manual_attendance_flags`, `day_corrections`, `punch_corrections`
- Employee/salary: `employees`, `salary_structures`, `salary_computations`, `salary_advances`, `salary_change_requests`, `salary_manual_flags`, `loans`, `loan_repayments`, `tax_declarations`, `extra_duty_grants`
- Processing: `day_calculations`, `holidays`, `holiday_audit_log`, `shifts`, `shift_roster`, `leave_balances`, `leave_transactions`, `leave_applications`
- Audit: `audit_log`, `usage_logs`, `finance_audit_status`, `finance_audit_comments`, `finance_month_signoff`, `finance_approvals`
- System: `users`, `policy_config`, `company_config`, `notifications`, `compliance_items`, `alerts`, `employee_documents`, `employee_lifecycle`, `monthly_dept_stats`, `monthly_employee_stats`, `session_events`, `session_daily_summary`
- **Critical UNIQUE constraints**:
  - `employees(code)`, `shifts(code)`
  - `day_calculations(employee_code, month, year, company)` ← prevents duplicate stage-6 runs
  - `salary_computations(employee_code, month, year, company)` ← prevents duplicate stage-7 runs
  - `salary_advances(employee_code, month, year)`
  - `attendance_processed(employee_code, date)` (unique index, post-dedup migration)
  - `monthly_imports(month, year, company)`
  - `salary_manual_flags(employee_code, month, year, flag_type)`
  - `tax_declarations(employee_code, financial_year)`
  - `finance_audit_status(employee_code, month, year)`
  - `finance_month_signoff(month, year, company)`
  - `extra_duty_grants(employee_code, grant_date, month, year)`
- **FK pattern**: `employee_id INTEGER REFERENCES employees(id)` on most child tables. Pipeline tables also use `employee_code` as the join key.
- **Composite key pattern**: `(employee_code, month, year, company)` is the universal join key across day_calculations, salary_computations, leave_balances. Drives every monthly query.
- **JSON in TEXT columns**: `day_calculations.week_breakdown` (Sunday rule per-week JSON), `salary_change_requests.old_structure`/`new_structure`, `holiday_audit_log.old_values`/`new_values`, `salary_manual_flags` notes

## Section 5: Salary Calculation Engine
- File: `backend/src/services/salaryComputation.js`
- **Salary divisor: 26** (line 223: `getPolicyValue('salary_divisor', 26)`). Configurable via `policy_config` table. Force-reset to defaults on startup (admin-only override).
- **earnedRatio formula**: `Math.min(actualWorkDays / totalWorkingDays, 1.0)` (lines 274, 283). The cap is critical — without it, payable_days > 26 produces ratio > 1.0 and inflates all base components.
- **Pro-rated components**: basic, da, hra, conveyance, other_allowances (each multiplied by earnedRatio, lines 275-279, 284-288)
- **Independent components**: `otPay = otHours × basicHourlyRate × otRate` (line 298, default 2x); `holidayDutyPay = holidayDutyDays × perDayRate` (line 303); both NOT subject to earnedRatio cap
- **grossEarned formula**: `min(baseEarned, grossMonthly) + otPay + holidayDutyPay` (lines 308-309)
- **PF**: 12% of `min(basic + da, 15000)` for both employee and employer (lines 312-318). EPS split: `min(pfWageBase × 0.0833, 1250)` (line 319). Rates from `policy_config`.
- **ESI**: 0.75% employee / 3.25% employer of `grossEarned`, only if `grossMonthly <= 21000` threshold (lines 322-327). Applicability gated by `salStruct.esi_applicable`.
- **Professional Tax**: Punjab slabs in `calcProfessionalTax()` (lines 17-27). 0 (≤15K), 150 (≤25K), 200 (>25K). Applied to ALL employees with grossMonthly > 0 (statutory in Punjab).
- **TDS**: Auto-calculated from `tax_declarations` table; falls back to manually entered TDS preserved across recomputations.
- **LOP**: NOT a separate deduction — pro-rating handles missed days via earnedRatio (line 338).
- **Net salary formula**: `Math.max(0, grossEarned - totalDeductions)` (line 383). totalDeductions = pf + esi + pt + tds + advance + lop + other + loan (line 374).
- **Rounding**: `Math.round(x * 100) / 100` everywhere (2 decimal precision).
- **Salary hold logic**: Auto-hold if (a) `rawPayableDays < 5`, OR (b) 7+ consecutive absent days at month-end (unless approved leave exists). Hold reason stored in `salary_computations.hold_reason`.
- **Finance gate**: `POST /finalise` blocked unless `finance_month_signoff.status = 'approved'` AND no unreviewed extra_duty_grants.

## Section 6: Shared State & Cross-Cutting Dependencies
- **Employee model**: `code` (string, unique business key), `id` (integer FK target), `name`, `department`, `company`, `status` (Active/Left/Exited), `is_contractor`, `gross_salary`, `date_of_joining`, `was_left_returned`. Used across all pipeline stages and consumers.
- **Company filter**: Passed as `?company=X` query param on every endpoint. SQL queries use `WHERE company = ?` with optional fallthrough. RBAC restricts via `users.allowed_companies`.
- **Month/year context**: URL query params + Zustand store sync via `useDateSelector({ syncToStore: true })`. Stored in `useAppStore.selectedMonth/selectedYear`.
- **State management**: **Zustand** (`frontend/src/store/appStore.js`). Single store for: user, isAuthenticated, selectedCompany, selectedMonth, selectedYear, sidebarCollapsed, alertCount. No Redux, no Context API.
- **Authentication**: `backend/src/middleware/auth.js` (`requireAuth`, `requireAdmin`, `getCompanyFilter`). JWT issued by `routes/auth.js`. Token in httpOnly cookie + Bearer header. 12h expiry, sliding refresh via heartbeat.
- **Audit logging**: `backend/src/database/db.js` exports `logAudit(table, recordId, field, oldValue, newValue, user, reason)` writing to `audit_log` table. Called from corrections, status changes, finance approvals.
- **EESL parser**: `backend/src/services/parser.js` — handles EESL format variations via dynamic landmark scanning (`findLandmarks()` line 93). Company column may be empty → falls back to employee master lookup. Status codes: P, A, WO, WOP, ½P, HP, NH, ED.

## Section 7: Known Gotchas & Domain Rules
- **Salary overcalculation**: Without `Math.min(earnedRatio, 1.0)`, employees working 28-31 days produce ratio > 1.0 and inflate all base components by 8-19%. Cap is in BOTH contractor (line 274) and permanent (line 283) paths. OT/holiday duty are legitimately uncapped.
- **Sunday rule complexity**: 3-tier in `dayCalculation.js` (lines 220-275). ≥6 worked → paid. 4-5 → CL/EL fallback or LOP (if shortage <=1.5). <4 → unpaid. WOP days (employee actually worked the Sunday) are ALWAYS paid regardless of Mon-Sat count.
- **Night shift pairing**: IN ≥ 18:00 day D + OUT ≤ 12:00 day D+1 → single shift. ~190 cases/month. Stage 4 sets `is_night_out_only=1` on the OUT record so Stage 6 doesn't double-count.
- **EESL format variations**: Column positions vary between companies/months. Parser scans for "Emp. Name" header to detect column index dynamically. Company column may be empty → fallback to employee master.
- **Miss punches**: ~145/month. MUST be resolved before Stage 6 or absent count is inflated. NIGHT_UNPAIRED edge case requires Stage 4 first.
- **Decimal precision**: Working days are fractional (0.5 for half days). Use `Math.round(x * 100) / 100` consistently. Never `Math.floor` or `parseInt`.
- **PF/ESI threshold crossings**: Wages crossing ₹15,000 (PF) or ₹21,000 (ESI) mid-year change applicability. Salary computation reads `pf_applicable`/`esi_applicable` from latest salary_structure each month — manual override needed if threshold crossed.
- **Contractor vs permanent paths**: Contractor mode skips Sunday eligibility entirely. `is_contractor` flag on `employees` table OR department-keyword detection in `utils/employeeClassification.js`. COM. HELPER is NOT contractor (permanent staff). MANPREET CON IS contractor.
- **SQLite WAL mode**: Concurrent reads OK, writes serialized. Bulk operations use transactions (`db.transaction()`) for atomicity.
- **Railway deployment**: `DATA_DIR` and `UPLOADS_DIR` env vars control file paths. Production uses persistent volume mount. SQLite file MUST live in persistent volume, not container fs.
- **Salary advance recovery loop**: `getAdvanceRecovery()` resets `recovered=0` flag before query so re-runs find advances; ON CONFLICT UPDATE on `salary_computations` includes `advance_recovery` so the value persists.
- **Holiday duty pay**: National holidays (Mar 4 etc) auto-detected. If employee works the holiday, paid extra at per_day_rate. Tracked separately from OT.

## Section 8: Rules for Claude Code Sessions
- Before changing ANY pipeline stage: ALWAYS read every downstream stage's service file AND every consumer (finance audit, payslips, exports, analytics) that reads this stage's output tables.
- Before changing salary computation: read dayCalculation.js (input) AND every route/component that displays salary data (payroll.js, financeAudit.js, salary-advance, payslip PDF).
- Use subagents for codebase exploration. Keep the main context window clean for implementation.
- Never change database schema without checking all routes that query the affected table. SQLite has no runtime schema validation — broken queries fail silently with NULL.
- After changing any pipeline stage: verify the stage's output table schema hasn't changed in a way that breaks downstream consumers.
- Financial calculations: always verify rounding, check for divide-by-zero on salary divisor, and ensure earned ratio is capped at 1.0 for base components.
- Run lint before marking any task complete.
- Update this CLAUDE.md file after completing any major feature or pipeline change.

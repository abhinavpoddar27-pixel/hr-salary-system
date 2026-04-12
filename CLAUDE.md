## Section 0: Last Session
- **Date:** 2026-04-12
- **Branch:** `claude/session-start-tMDNw`
- **Last commit:** `3b2ccde` docs: session handoff 2026-04-12
- **Files changed this session:** None — this was a read-only audit session. No code was written or modified.
- **What was fixed/built:** Performed a comprehensive codebase audit covering all 41 backend files, 66 frontend files, full schema (1737 lines), and 25+ targeted greps. Produced a tiered feature recommendation report (Tier 1 compliance gaps, Tier 2 operational wins, Tier 3 UX, Tier 4 engineering hygiene, quick wins table, dependency map). Key discovery: the Daily Wage System (1551-line route, 8 frontend pages, 7 DB tables: `dw_contractors`, `dw_entries`, `dw_payments`, etc.) is entirely absent from CLAUDE.md.
- **What's fragile:** Nothing changed this session. Carry-forward fragility from previous session: `deduction_amount: computedAmount || undefined` in `EarlyExitDetection.jsx handleSubmit` — zero gross employee will still fail.
- **Unfinished work:** None — audit delivered in full.
- **Known issues remaining:** (1) `min_wage_*` values are seeded in `policy_config` but read nowhere in business logic — unenforced. (2) Daily Wage System undocumented in CLAUDE.md (Section 2 + Section 4 missing). (3) `early_exit_deductions` pipeline still untested in production (no finance-approved deductions exist yet).
- **Next session should:** Pick a Tier 1 item from the audit report (T1.4 LWF is the quickest; T1.2 min-wage compliance requires only a `safeAddColumn` + one red-flag detector). OR update CLAUDE.md Section 2/4 to document the Daily Wage System (1h, zero risk).

---

## Section 0: Recent Changes
**2026-04-12 | Branch: claude/fix-early-exit-deduction-gh1DU | Early Exit Deduction Amount Fix**

Files modified:
- `frontend/src/components/EarlyExitDetection.jsx` — 3 changes: (1) added `getEmployee` import, (2) replaced broken `detection.daily_gross_at_time`-based `dailyGross` (always 0) with a `getEmployee()` query to fetch actual `gross_salary`, then compute `dailyRate = gross / daysInDetMonth`; `halfDayAmount`/`fullDayAmount` now 2-decimal floats; (3) dropdown labels updated to show `Math.round(amount)` display

What was broken: `early_exit_detections` table has no `gross_salary` column; the range-report query also doesn't join `employees`. So `detection.daily_gross_at_time` was always `undefined` → `computedAmount = 0` → `0 || undefined = undefined` → backend rejected with "deduction_amount is required for non-warning deductions" → zero rows ever inserted into `early_exit_deductions`.

What was fixed: `getEmployee(detection.employee_code)` fetches current gross; daily rate computed from detection date's actual month. Submit payload now sends the correct `deduction_amount` (e.g., ₹214.29 for Half-Day, ₹428.57 for Full-Day on gross 12000 / Feb 28 days).

What's fragile: The salary pipeline integration in `salaryComputation.js` for `earlyExitDeduction` is already coded (see Section 5) but was untested because `early_exit_deductions` had zero rows. Now that deductions can be created, the pipeline will pick them up on next Stage 7 compute after finance approval. Verify Stage 7 shows the early_exit_deduction column correctly once real deductions exist.

Notes:
- `deduction_amount: computedAmount || undefined` in the submit payload is intentional — passes `undefined` for `warning` type (backend ignores amount for warnings) and the computed float for half_day/full_day/custom
- Detection date's month (not selectedMonth prop) is used for days-in-month, matching the backend's `daysInMonth(detection.date)` calculation
- Pending: none for this task

---

**2026-04-12 | Branch: claude/admin-sql-query-tool-L9lm8 | Admin SQL Query Tool**

Files created:
- `backend/src/config/schemaReference.js` — static schema reference text sent to Anthropic API for English→SQL translation
- `backend/src/routes/queryTool.js` — admin-only route: POST /run (natural language + raw SQL), GET /saved (5 diagnostic queries), SELECT-only validation, 100-row limit
- `frontend/src/pages/QueryTool.jsx` — admin-only page at /admin/query-tool: English + SQL tabs, saved query buttons, sortable results table, CSV export

Files modified:
- `backend/server.js` — 1 line: mount `/api/query-tool` route
- `frontend/src/App.jsx` — 2 lines: lazy import + Route entry for /admin/query-tool
- `frontend/src/components/layout/Sidebar.jsx` — 1 line: "Query Tool" nav item with `adminOnly: true`

Notes:
- Natural language mode requires ANTHROPIC_API_KEY env var (not set locally — Railway only)
- Raw SQL paste mode works without API key
- Admin-only: backend middleware checks `req.user.role === 'admin'`, returns 403 for non-admin
- SQL validation blocks INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/TRUNCATE/REPLACE/ATTACH/DETACH/PRAGMA/VACUUM/REINDEX
- 5 saved diagnostic queries: drift check, payable days > 31, zero deductions, stuck ED grants, present vs payable gap
- Pending: none

---

**2026-04-12 | Branch: claude/wire-notifications-end-to-end-5zVTq | Tier 3.4 — Notifications End-to-End**

Files modified:
- `backend/server.js` — removed duplicate `/api/notifications` route mount (was mounted twice at lines 197 and 204; second mount deleted)
- `backend/src/routes/payroll.js` — 3 `createNotification()` trigger-points added: `DAY_CALC_COMPLETE` (hr, after calculate-days), `SALARY_COMPUTED` (finance, after compute-salary), `SALARY_HELD` (hr, per-employee, iterates `held` array after compute-salary)
- `backend/src/routes/financeVerification.js` — `FINANCE_SIGNOFF` (admin) trigger added after `POST /signoff` succeeds with `status='approved'`; gated so rejection does not fire
- `backend/src/routes/extraDutyGrants.js` — `ED_GRANT_APPROVED` (hr) trigger added after `POST /:id/finance-approve`
- `backend/src/routes/lateComing.js` — `LATE_DED_APPROVED` (hr) trigger added after `PUT /finance-review/:id` when `status='approved'`
- `frontend/src/components/layout/NotificationBell.jsx` — fully rewritten: SVG bell icon (no emoji/library), manual `useState` + `useEffect` + `setInterval` polling every 60s (replaces React Query), `useRef`-based click-outside handler, coloured left-border by type (red for urgencies, green for completions, grey for others), relative timestamps ("X min/hour/day ago"), unread dot + bold title, mark-one-read + mark-all-read, navigate-on-click via `useNavigate`, loading state on first fetch only

Notes:
- All `createNotification()` calls wrapped in `try/catch` — notification failure never crashes a route
- `createNotification()` imported inline via `require('../services/monthEndScheduler')` inside each try block
- Role filtering: HR sees `role_target IN ('hr', 'all')`; Finance sees `finance+all`; Admin sees everything. Fallback query (no `role_target` column) returns all 50 for old DBs
- FINANCE_SIGNOFF fires only on approval — `status === 'approved'` guard prevents false positive on rejection
- SALARY_HELD fires per-employee (one row per held salary) — HR can address each hold individually
- `financeVerification.js` is mounted at `/api/finance-verify` (not `/api/finance-audit`); signoff endpoint is here, not in `financeAudit.js`
- Pending: none for this task

---

**2026-04-12 | Branch: claude/abbreviation-legend-HLrmz | Tier 3.5 — Abbreviation Legend**

Files modified:
- `frontend/src/utils/abbreviations.js` — added named `ABBREVIATIONS` export (7 categories, 30+ entries); internal dict renamed to `_dict`; all 3 helpers (`getAbbreviation`, `getPageAbbreviations`, `getAllAbbreviations`) preserved — `Tooltip.jsx` and all existing per-page usages continue to work
- `frontend/src/components/ui/AbbreviationLegend.jsx` — full rewrite: global floating `?` button (fixed bottom-right, `z-50`), searchable modal with real-time category filtering, keyboard shortcut (`?` key outside inputs), ESC + overlay click to close; `keys` prop guard (`keys.length > 0 → return null`) makes the 12 existing per-page usages silently become no-ops
- `frontend/src/App.jsx` — 1 import line + 1 JSX line: `<AbbreviationLegend />` added as last child inside the `Layout` wrapper function

Pending: none

Notes:
- Legend only visible on authenticated pages (inside `Layout`), not on `/login`
- Keyboard shortcut: press `?` anywhere outside an input/textarea to toggle the modal
- Search filters live across all 7 categories simultaneously; "No results for X" shown when nothing matches
- Per-page collapsible panels (12 pages) silently become no-ops via the `keys` prop guard — no page files modified

---

**2026-04-12 | Branch: claude/request-id-middleware-HLqLt | Tier 3.3 — Request-ID Middleware**

Files created:
- `backend/src/middleware/requestId.js` — stamps every `/api` request with `req-xxxxxxxx` (8 hex chars from uuid v4); sets `x-request-id` response header; logs arrival (`→`) and completion (`←`) with method/path/status/duration. Health endpoint excluded from logging.

Files modified:
- `backend/server.js` — `require('./src/middleware/requestId')` + `app.use('/api', requestIdMiddleware)` inserted after cache-control block, before usage logger
- `backend/src/services/salaryComputation.js` — `computeEmployeeSalary()` signature extended with `requestId = ''` (6th param); `const RID = ...` at top; `[salary]` prefixes replaced with `${RID}` in existing warns; 5 checkpoint logs added: dayCalc lookup, earnedRatio, PF/ESI, totalDeductions/net/takeHome, salary-held
- `backend/src/services/dayCalculation.js` — `calculateDays()` signature extended with `requestId = ''` (9th param); `const RID = ...` at top; `[DayCalc]` prefix in integrity-warning log replaced with `${RID}`
- `backend/src/routes/payroll.js` — `POST /calculate-days` and `POST /compute-salary` pass `req.requestId` as last arg to respective service calls; before/after loop logs added with employee counts
- `frontend/src/utils/api.js` — axios error interceptor reads `err.response?.headers?.['x-request-id']` and `console.error`s the Trace ID alongside endpoint URL and HTTP status

Notes:
- `req.requestId` is available in ALL route handlers (set before auth middleware runs)
- Salary computation emits one RID-prefixed trace block per employee — grep by `req-xxxxxxxx` to isolate a single computation run from concurrent traffic
- Health endpoint (`/health`) is excluded from req-ID logging to prevent noise in production monitoring
- Pending: none for this task

---

# HR Intelligence & Salary Processing Platform
- Stack: React (Vite) + Tailwind frontend, Node.js/Express backend, SQLite (better-sqlite3, WAL mode)
- Companies: Indriyan Beverages, Asian Lakto Ind. Ltd. (global company filter)
- Data source: EESL biometric attendance XLS (uploaded monthly)
- Pipeline: 7-stage attendance-to-salary processing
- Deployment: Railway | GitHub: abhinavpoddar27-pixel/hr-salary-system

## Section 0: Last Session
- Date: 2026-04-11
- Branch: `claude/nightly-db-backup-git-xKhvM`
- Task: Tier 3.2 — Nightly DB backup scheduler with git push
- Files changed:
  - `backend/src/services/backupScheduler.js` (created)
  - `backend/server.js` (+2 lines: require + `initBackupScheduler()`)
  - `.gitignore` (+1 entry: `backups/*.db`)
  - `backups/.gitkeep` (new directory placeholder)
- Pending: none for this task
- Notes: Backup cron runs at 23:30 daily via `node-cron`. Copies
  `backend/data/hr_system.db` → `backups/hr_salary_YYYY-MM-DD_HH-MM.db`,
  enforces a rolling 7-file window, then runs
  `git add -f backups/ && git commit --allow-empty && git push origin HEAD`.
  `git add -f` is required because `backups/*.db` is in `.gitignore` (manual
  workflow blocks .db adds; only cron is allowed to commit them). Each git
  step is wrapped in its own try/catch — push failure logs and continues, it
  never crashes the server. The whole cron callback is wrapped in a top-level
  try/catch. Tested: single run, double run, and 10→7 rolling window cleanup.
  No temporary test call remains in `initBackupScheduler()`.

## Section 2: Directory Map
```
backend/
├── server.js                                  Express bootstrap, auth seeding, route mounting
├── src/
│   ├── database/
│   │   ├── schema.js                          56 tables, all CREATE TABLE definitions, migrations
│   │   └── db.js                              better-sqlite3 wrapper, logAudit() helper
│   ├── middleware/auth.js                     JWT verify, requireAuth, requireAdmin
│   ├── middleware/requestId.js               Request-ID stamp, x-request-id header, arrival/completion logging
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
│   │   ├── lateComing.js        Late Coming: analytics, deductions, finance approval (Phase 1+2)
│   │   ├── short-leaves.js     Gate pass / short leave CRUD, quota check
│   │   ├── early-exits.js      Early exit detection trigger, list, summary, analytics
│   │   ├── early-exit-deductions.js  HR deduction submit/revise + finance approve/reject
│   │   └── dailyWage.js         Daily Wage: contractor CRUD, daily entries, HR→Finance approval, payments, reports (mounted at /api/daily-wage)
│   └── services/
│       ├── earlyExitDetection.js     Detect employees who punched out before shift end
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
│   │   ├── Alerts.jsx                System alerts
│   │   ├── DailyWageDashboard.jsx    Finance KPI dashboard — pending liability, review queue depth, flagged entries, recent activity
│   │   ├── DailyWageEntry.jsx        Create/edit single daily wage entry with department allocation
│   │   ├── DailyWageRecords.jsx      List all entries with status filter, bulk submit to finance
│   │   ├── DailyWageContractors.jsx  Contractor master CRUD + rate proposal/approval workflow
│   │   ├── DailyWageBatchImport.jsx  XLSX/CSV batch import up to 500 entries with validation preview
│   │   ├── DailyWageFinanceReview.jsx Finance review queue — approve/reject/flag/reopen entries
│   │   ├── DailyWagePayments.jsx     Process payments for approved entries, view payment history
│   │   ├── DailyWageReports.jsx      Monthly rollup, department cost, contractor summary, seasonal trends
│   │   └── DailyWageAuditLog.jsx     Paginated, filterable audit log of all DW operations
│   ├── components/
│   │   ├── layout/{Sidebar,Header,NotificationBell}.jsx
│   │   ├── pipeline/PipelineProgress.jsx
│   │   ├── shared/CompanyFilter.jsx
│   │   ├── common/{DataTable,DateSelector,StatCard}.jsx
│   │   ├── GatePasses.jsx                     Gate pass tab (Leave Management)
│   │   ├── EarlyExitDetection.jsx             Early exit detection tab (Analytics)
│   │   ├── FinanceEarlyExitApprovals.jsx      Finance approval tab (Finance Audit)
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
- Input contract: Stages 1-5 complete; `is_contractor` flag set on employee; `employees.date_of_joining` set for new joiners
- Output contract: `day_calculations` row with: total_payable_days, days_present, days_half_present, days_wop, days_absent, paid_sundays, paid_holidays, lop_days, ot_hours, extra_duty_days, holiday_duty_days, week_breakdown (JSON), date_of_joining, holidays_before_doj, is_mid_month_joiner, finance_ed_days (display-only count of finance-approved ED grants minus WOP overlap)
- Downstream consumers: Stage 7 salary computation, Finance Audit, Reports
- Business rules:
  - Sunday rule (permanent only): worked >=6 Mon-Sat → paid Sunday; 4-5 → CL/EL fallback or LOP if shortage <=1.5; <4 → unpaid Sunday
  - WOP days (worked on Sunday) → always paid
  - Half-day (½P) = 0.5 working day
  - Contractor mode: payable = present + WOP + halfPresent (no Sunday eligibility, no CL/EL)
  - LOP waived if total worked days >= total working days OR rawPayableDays >= calendar days
  - Manual extra duty grants added when both HR + Finance approved
  - **DOJ-based holiday eligibility (April 2026)**: pre-DOJ dates are skipped in
    the attendance loop (no absent), pre-DOJ holidays are excluded from
    `paidHolidays` (counted in `holidaysBeforeDOJ`), pre-DOJ weekly offs are
    excluded from `totalWeeklyOffs`, and `totalCalendarDays`/`totalWorkingDays`
    are scoped to DOJ→month-end. `dateOfJoining` is threaded via
    `options.dateOfJoining` (`null` ⇒ legacy / no filtering, all backward compat).
    `is_mid_month_joiner=1` flags rows for finance review.
- Edge cases: Cross-month night shifts, holidays on Sundays, partial weeks at month boundary, mid-month joiners (pre-DOJ days never counted), DOJ-on-holiday (eligible), DOJ-on-weekly-off (weekly off counts), returning employees (DOJ in past ⇒ no-op)

## Stage 7: Salary Computation
- Route: `backend/src/routes/payroll.js` → `POST /compute-salary`, `GET /salary-register`, `POST /finalise`, `GET /payslip/:code`, `GET /salary-slip-excel`
- Service: `backend/src/services/salaryComputation.js` → `computeEmployeeSalary()`, `saveSalaryComputation()`, `generatePayslipData()`, `getAdvanceRecovery()`, `getLoanDeductions()`
- Tables read: `day_calculations`, `salary_structures`, `employees`, `salary_advances`, `loan_repayments`, `tax_declarations`, `policy_config`, `extra_duty_grants` (April 2026 — for `ed_pay` bucket), `attendance_processed` (for WOP overlap detection)
- Tables written: `salary_computations` (one row per employee per month per company; includes new `ed_days`/`ed_pay`/`take_home`/`late_coming_deduction`), `salary_manual_flags` (auto-populated for finance audit), `salary_advances` (marked recovered), `late_coming_deductions` (is_applied_to_salary flag flipped after compute)
- Input contract: Stage 6 complete; salary_structures populated; `employees.gross_salary` set
- Output contract: salary_computations row with: gross_salary, gross_earned, basic/da/hra/conveyance/other_allowances_earned, ot_pay, holiday_duty_pay, ed_days, ed_pay, take_home, pf_employee/employer, esi_employee/employer, professional_tax, tds, advance_recovery, loan_recovery, lop_deduction, total_deductions, net_salary, total_payable, salary_held, hold_reason, finance_remark
- Downstream consumers: Finance Audit, Finance Verify, Payslip PDF, Bank NEFT export, PF ECR, ESI returns
- Business rules:
  - divisor = 26 (from policy_config.salary_divisor) — used for BASE salary pro-rata when payableDays ≤ 26
  - **Hybrid divisor** (April 2026 fix): `effectiveDivisor = payableDays > 26 ? calendarDays : 26`,
    `earnedRatio = min(payableDays / effectiveDivisor, 1.0)`. Matches HR's calc:
    Amit ₹24,000 × 28/31 = ₹21,677; Preeti ₹24,700 × 28/31 = ₹22,310; Sonu 31/31 = full;
    SONU 70059 20/26 = ₹10,769.
  - Base components (basic/da/hra/conv/other) × earnedRatio — capped so never exceed monthly gross
  - Component scaling: if `salary_structures` component sum ≠ stated gross, scale components
    proportionally to honour stated gross (preserves existing ratios)
  - OT / extra duty rate uses CALENDAR DAYS not divisor: `grossMonthly / calendarDays`
    (Sundays do NOT inflate the OT per-day rate)
  - otPay = otDays × (grossMonthly / calendarDays) + otHours × (grossMonthly / (calendarDays × 8)) × otRate
  - holidayDutyPay uses calendar-day rate too
  - grossEarned = (sum of base components capped at grossMonthly) + otPay + holidayDutyPay
  - PF: 12% of min(basic+da, 15000 ceiling), only if pf_applicable
  - ESI: 0.75% employee / 3.25% employer of grossEarned, only if grossMonthly <= 21000
  - **Professional Tax: DISABLED** (per HR directive April 2026) — always 0
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
- Service: `backend/src/services/financeRedFlags.js` → `detectRedFlags()` with 9 detectors (incl. `doj_holiday_exclusion` for mid-month joiners)
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
- Total tables: **56** (in `backend/src/database/schema.js`) — 48 core tables + 8 Daily Wage tables
- Attendance: `attendance_raw`, `attendance_processed` (now with `is_left_late`/`left_late_minutes` for late coming tracking + `is_early_departure`/`early_by_minutes` for early exit), `night_shift_pairs`, `monthly_imports`, `manual_attendance_flags`, `day_corrections`, `punch_corrections`
- Employee/salary: `employees`, `salary_structures`, `salary_computations` (now with `early_exit_deduction`), `salary_advances`, `salary_change_requests`, `salary_manual_flags`, `loans`, `loan_repayments`, `tax_declarations`, `extra_duty_grants`, `late_coming_deductions`, `short_leaves` (NEW, April 2026), `early_exit_detections` (NEW), `early_exit_deductions` (NEW), `early_exit_deduction_audit` (NEW)
- Processing: `day_calculations`, `holidays`, `holiday_audit_log`, `shifts` (now with `duration_hours` + seeded 12HR/10HR/9HR rows), `shift_roster`, `leave_balances`, `leave_transactions`, `leave_applications`
- Audit: `audit_log`, `usage_logs`, `finance_audit_status`, `finance_audit_comments`, `finance_month_signoff`, `finance_approvals`
- System: `users`, `policy_config`, `company_config`, `notifications`, `compliance_items`, `alerts`, `employee_documents`, `employee_lifecycle`, `monthly_dept_stats`, `monthly_employee_stats`, `session_events`, `session_daily_summary`
- Daily Wage: `dw_contractors` (contractor master, rates), `dw_rate_history` (rate change proposals + approval), `dw_entries` (daily work entries, status flow), `dw_department_allocations` (per-entry dept breakdown, CASCADE on entry delete), `dw_approvals` (entry state-transition log), `dw_payments` (payment records, UNIQUE payment_reference), `dw_payment_entries` (payment↔entry junction), `dw_audit_log` (full entity audit trail)
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
- **Salary divisor: 26** — used for base salary pro-rata ONLY. Never change.
- **earnedRatio formula** (hybrid divisor): `effectiveDivisor = payableDays > 26 ? calendarDays : 26`,
  `earnedRatio = min(payableDays / effectiveDivisor, 1.0)`. Under-26 days prorate on
  divisor 26; over-26 days prorate on calendar days of the month. Applied to both
  contractor and permanent paths.
- **Component scaling** (April 2026): If `salary_structures` components exist but don't
  sum to the stated gross (`employees.gross_salary` or `salary_structures.gross_salary`),
  components are scaled by `scaleFactor = statedGross / rawComponentSum` so the sum
  matches stated gross while preserving ratios. If no components exist, fall back to
  percentage-based derivation from `basic_percent`/`hra_percent`.
- **OT / Extra Duty rate** (April 2026): Uses CALENDAR DAYS, not divisor.
  `otPerDayRate = grossMonthly / calendarDays` — Sundays don't inflate the rate.
  `otPay = otDays × otPerDayRate + otHours × (grossMonthly / (calendarDays × 8)) × otRate`.
  `otDays = dayCalc.extra_duty_days` (pure punch-based, since the ED-integration overhaul).
  Finance-approved grants now flow into a SEPARATE `ed_pay` bucket — see ED Integration below.
- **Extra Duty (ED) Integration** (April 2026): `ed_pay` is a NEW bucket, separate from
  `ot_pay`. Sourced from `extra_duty_grants` rows with `status='APPROVED' AND
  finance_status='FINANCE_APPROVED'`, MINUS any grant whose `grant_date` overlaps with a
  WOP/WO½P attendance day (anti-double-counting — those days are already paid via punch OT).
  Same per-day rate (`gross / calendarDays`). Persisted in `salary_computations.ed_days`,
  `ed_pay`, `take_home`. ED is NOT part of `gross_earned` (deductions don't apply to it).
  - `take_home = total_payable + ed_pay = net_salary + ot_pay + holiday_duty_pay + ed_pay`
  - `total_payable` is unchanged (existing exports stay stable); new reports use `take_home`
  - Stage 6 also persists `day_calculations.finance_ed_days` for the UI breakdown
  - Contractors get zero ED (same gate as OT)
- **Holiday Duty Pay**: Also uses calendar-day rate.
- **Professional Tax: DISABLED** (April 2026, HR directive). Hard-coded to 0 regardless of
  gross or pt_applicable flag. Column/row removed from Stage 7 UI, payslip PDF, Excel export.
  `calcProfessionalTax()` helper retained for backward compat but never invoked.
- **Pro-rated components**: basic, da, hra, conveyance, other_allowances (× earnedRatio)
- **Independent components**: `otPay = otDays × otPerDayRate + otHours × otHourlyRate × otRate` where
  `otPerDayRate = grossMonthly / calendarDays` and `otHourlyRate = grossMonthly / (calendarDays × 8)`;
  `holidayDutyPay = holidayDutyDays × otPerDayRate`. Uncapped, NOT gated on workedFullMonth.
  `otDays = dayCalc.extra_duty_days` (pure biometric overflow). Finance-approved
  grants now feed `ed_pay` separately, with date-level anti-double-counting against
  WOP/WO½P attendance days.
- **Extra Duty Pay (ED, April 2026)**: `edPay = edDays × otPerDayRate` where
  `edDays = sum(extra_duty_grants.duty_days WHERE status='APPROVED' AND
  finance_status='FINANCE_APPROVED' AND grant_date NOT IN (WOP/WO½P dates))`.
  Capped at calendarDays. Excluded from `grossEarned`/PF/ESI. Not paid for contractors.
  `take_home = total_payable + ed_pay`.
- **grossEarned formula**: `min(baseEarned, grossMonthly) + otPay + holidayDutyPay`
- **PF**: 12% of `min(basic + da, 15000)` for both employee and employer. EPS split: `min(pfWageBase × 0.0833, 1250)`. Rates from `policy_config`. Gated by `salStruct.pf_applicable`.
- **ESI**: 0.75% employee / 3.25% employer of `grossEarned`, only if `grossMonthly <= 21000` threshold. Gated by `salStruct.esi_applicable`.
- **Professional Tax**: **DISABLED** (April 2026). Always 0. `calcProfessionalTax()` helper retained but never invoked.
- **TDS**: Auto-calculated from `tax_declarations` table; falls back to manually entered TDS preserved across recomputations.
- **LOP**: NOT a separate deduction — pro-rating handles missed days via earnedRatio (line 338).
- **Early Exit Deduction** (April 2026): Finance-approved deductions for leaving before shift end.
  Summed from `early_exit_deductions` where `finance_status='approved'` and `deduction_type != 'warning'`.
  Stored as rupee amount (not days × rate). Contractors excluded. `salary_applied` flag prevents
  double-counting on recompute (same pattern as late coming). Column: `salary_computations.early_exit_deduction`.
- **Net salary formula**: `Math.max(0, grossEarned - totalDeductions)`. totalDeductions = pf + esi + tds + advance + lop + other + loan + lateComingDeduction + earlyExitDeduction (PT always 0).
- **Take-home formula** (April 2026 ED integration): `take_home = net_salary + ot_pay + holiday_duty_pay + ed_pay` (= `total_payable + ed_pay`). New ED bucket sits OUTSIDE deductions and the existing total_payable, so older bank/PF/ESI exports stay stable while the take-home figure on payslips and the OT&ED Payable register reflects everything the employee actually receives.
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
- **Salary overcalculation**: Without `Math.min(earnedRatio, 1.0)`, employees working 28-31 days produce ratio > 1.0 and inflate all base components by 8-19%. Cap applied uniformly to both contractor and permanent paths. OT/holiday duty are legitimately uncapped but use calendar-day rate, not divisor.
- **Component mismatch**: `salary_structures` components (basic+da+hra+conv+other) may not sum to the stated gross_salary. When mismatched, salaryComputation.js scales components by `scaleFactor = statedGross / rawComponentSum` to honour the stated gross. Diagnostic query: `SELECT e.code, e.name, COALESCE(e.gross_salary, ss.gross_salary, 0) AS stated, (basic+da+hra+conveyance+other_allowances) AS sum FROM employees e LEFT JOIN salary_structures ss ON ss.employee_id=e.id WHERE e.status='Active' AND ABS(stated - sum) > 1`.
- **Mark Left preservation**: Manual "Mark Left" actions (via `PUT /employees/:code/mark-left`) set `auto_inactive=0` AND `inactive_since=exit_date` so reimports do NOT resurrect them. Four code paths respect this: (1) import.js auto-reactivation checks `auto_inactive=1` before reactivating, (2) `POST /reconciliation/add-to-master` preserves Left status via CASE WHEN, (3) `POST /bulk-import` preserves Left via CASE WHEN, (4) auto-detect-Left in import.js only marks auto_inactive=1 (never touches manual marks).
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
- **Early exit detection**: Runs after attendance import (POST /api/early-exits/detect). If detection is not triggered, `is_early_departure` stays 0 and deductions cannot be created. Gate passes in `short_leaves` provide exemption or reduce flagged minutes. Detection is idempotent (UPSERT on employee_code+date).
- **Gate pass quota**: 2 per employee per calendar month. Breachable with `force_quota_breach: true`. Cancelled gate passes don't count toward quota. Cancellation blocked after employee punches out.

## Late Coming Management System (April 2026 — Phase 1 + Phase 2 complete)
- **Three canonical shifts** seeded in `shifts` table: `12HR` (08:00–20:00, 12h),
  `10HR` (09:00–19:00, 10h), `9HR` (09:30–18:30, 9h). All shifts have
  `grace_minutes=9` per plant policy (including legacy DAY/NIGHT/GEN).
- **Grace period policy**: 9 minutes for ALL shifts. HR cannot change grace —
  the `PUT /api/settings/shifts/:id` endpoint gates `grace_minutes` writes
  behind `req.user.role === 'admin'`. HR can edit `start_time` + `duration_hours`,
  and `end_time` is auto-derived server-side (`calcEndTime()` helper in settings.js).
- **New columns on `attendance_processed`**: `is_left_late` (INTEGER 0/1),
  `left_late_minutes` (INTEGER). Calculated alongside late-arrival detection
  in `import.js` post-processing + `attendance.js POST /recalculate-metrics`.
  Threshold: 20+ minutes past shift end time. Overnight shifts handle end-time
  wraparound correctly. These columns are PURELY ADDITIVE — the late-arrival
  logic, status fields, and all downstream pipeline stages are untouched.
- **New table `late_coming_deductions`** (April 2026): HR-initiated discretionary
  deductions with finance review queue. Columns: `employee_code`, `month`, `year`,
  `company`, `late_count`, `deduction_days` (0.5–5), `remark` (NOT NULL),
  `applied_by`, `applied_at`, `finance_status` ('pending' | 'approved' |
  'rejected'), `finance_reviewed_by`, `finance_reviewed_at`, `finance_remark`,
  `is_applied_to_salary`, `applied_to_salary_at`. UNIQUE constraint:
  `(employee_code, month, year, company, applied_at)`. Indexed on
  `(employee_code, month, year)` and `finance_status`.
- **New routes file `backend/src/routes/lateComing.js`** mounted at `/api/late-coming`:
  - `GET /analytics` — per-employee late coming with trend vs last month (params: month, year, company, shiftCode)
  - `GET /department-summary` — per-department rollup with trend + worst offender
  - `GET /daily-detail` — late arrivals for a specific date (used by Daily MIS)
  - `GET /employee-history` — N-month late coming history incl. deductions
  - `POST /deduction` — HR applies deduction (requires HR or admin role; validates days in [0.5, 5] and non-empty remark)
  - `GET /deductions` — list deductions filtered by status (pending/approved/rejected/all)
  - `GET /export` — xlsx download (HR/finance/admin)
  - `GET /finance-pending` (Phase 2) — pending deductions enriched with 6-month history + current-month stats (HR/finance/admin)
  - `PUT /finance-review/:id` (Phase 2) — finance approve/reject single deduction; writes `finance_approvals` + `audit_log`
  - `PUT /finance-bulk-review` (Phase 2) — same, transactional for multiple ids
- **New route on `daily-mis.js`**: `GET /late-coming-summary` returns today's
  late arrivals with MTD counts, trend, department breakdown, and "left late
  yesterday" flag.
- **Frontend additions**:
  - Analytics → Punctuality tab: new "Late Coming Management" section with
    summary cards, shift/dept filters, Excel export, department summary,
    employee detail table with trend arrows, `LateComingDeductionModal`
    (HR-only), and a "Pending Deductions" sub-table.
  - Daily MIS → `LateComingTodaySection` (between Worker Type Breakdown and
    sub-tabs): department chips, per-employee late minutes + MTD + trend +
    "Stayed X min late yesterday" badge.
  - Employee Master: shift dropdown on edit modal (driven by real shifts from
    `/settings/shifts`), checkbox column + "Assign Shift" toolbar +
    `BulkShiftModal` (HR/admin only).
  - Settings → Shifts: end_time field is read-only (auto-calculated from
    start + duration), grace_minutes disabled for non-admin.
  - Sidebar: new top-level "Late Coming" entry linking to `/analytics/punctuality`.
- **Permissions**: `late-coming` page added to `hr` and `finance` roles in
  `backend/src/config/permissions.js`. HR has full access (view + deduction);
  finance can view analytics, plus approve/reject deductions and review them
  from the Finance Audit → Late Coming tab.
- **Employee shift audit**: every shift change on `employees` (via PUT /:code
  or PUT /bulk-shift) writes an `audit_log` row with `field_name='shift_assignment'`,
  `action_type='shift_change'`, and `changed_by` set to the actual username.
- **New API endpoint `PUT /api/employees/bulk-shift`** (HR/admin): body
  `{ employeeCodes: [...], shiftId, shiftCode }`. Transactional update + one
  audit row per employee. Declared BEFORE `PUT /:code` in the router so Express
  doesn't interpret "bulk-shift" as an employee code.
- **Phase 2 (April 2026) — shipped**. Closes the loop from HR-initiated
  deduction to salary impact:
  - **Finance approval endpoints** on `lateComing.js`:
    - `GET /finance-pending` — pending deductions enriched with current-month
      stats + 6-month history + left-late totals (single round-trip for the
      review UI).
    - `PUT /finance-review/:id` — approve/reject a single deduction
      (`finance` or `admin` role). Mandatory remark on rejection. Writes to
      `finance_approvals` and `audit_log` (`action_type='finance_review'`,
      `field_name='finance_status'`, `old_value='pending'`).
    - `PUT /finance-bulk-review` — same logic for multiple rows, transactional.
  - **New column**: `salary_computations.late_coming_deduction REAL DEFAULT 0`
    (migrated via `safeAddColumn`). Persisted alongside PF/ESI/TDS/etc.
  - **Salary pipeline integration** in `salaryComputation.js`:
    - Top of `computeEmployeeSalary()` resets `is_applied_to_salary=0` for
      approved rows so every recompute re-reads them.
    - After TDS/advance/loan derivation, SUMs `deduction_days` of approved &
      unapplied rows and multiplies by `otPerDayRateDisplay = gross /
      calendarDays` (same rate as OT/ED/holiday duty). Gated on `!isContract`
      — contractors mirror the OT/ED exclusion rule.
    - `lateComingDeduction` is added into `totalDeductions`. `net_salary`
      math is unchanged — the new bucket just joins the existing sum.
    - `saveSalaryComputation()` INSERT + ON CONFLICT UPDATE + parameter list
      were extended with the new column (same pattern as `advance_recovery`).
    - After the INSERT the function flips `is_applied_to_salary=1` on the
      matching rows and writes a `logAudit()` entry
      (`action_type='applied_to_salary'`, `stage='salary_compute'`).
    - `generatePayslipData()` surfaces a new `Late Coming Deduction` line
      item in `payslip.deductions` (auto-filtered when zero).
  - **Stage 6 (DayCalculation.jsx)**: `GET /api/payroll/day-calculations`
    now returns `finance_approved_late_days` + `finance_late_remark` via
    subqueries. The day calc detail panel shows a "★ Finance-approved late
    deduction" info row with the remark directly below.
  - **Stage 7 (SalaryComputation.jsx)**: new "Late" column between Loan and
    Ded in the salary register table (amber highlight when > 0). Drill-down
    deductions list shows "Late Coming" as a separate line item. tfoot
    column totals include the new bucket.
  - **Finance Audit → new "Late Coming" tab** (`FinanceAudit.jsx →
    LateComingAuditTab`): summary KPI cards (Pending / Approved / Rejected /
    Total Days), expandable pending table revealing 6-month history per
    employee + Approve/Reject buttons + bulk-action toolbar, history table
    of already-reviewed deductions for the month. Tab badge shows the pending
    count.
  - **Finance Audit → Report tab**: `/finance-audit/report` now joins
    `late_coming_deductions` (sum of approved days + status) and the UI
    shows a new "Late Ded" column (amber highlight) between Gross and Net.
  - **Month-end checklist** (`/payroll/month-end-checklist`): two new items
    — `late-deductions-pending` (WARNING) and `late-deductions-unapplied`
    (WARNING, links to `/pipeline/salary`). If neither is present the
    checklist shows an OK "All late coming deductions reviewed" row.
  - **Readiness check** (`/finance-audit/readiness-check`): mirrors the two
    checklist items as WARNINGs (`LATE_DEDUCTIONS_PENDING`,
    `LATE_DEDUCTIONS_UNAPPLIED`). Not blockers — they reduce the readiness
    score but don't prevent finalisation.
  - **Finance red flag detector** `late_deduction_high` (WARNING) in
    `financeRedFlags.js`: surfaces employees whose approved deduction days
    exceed 2 for the month.
  - **Employee profile → new "Late Coming" tab**: 12-month history with
    trend arrows, summary cards (late this/last month, left-late count),
    and a full deduction history table showing status badges and the
    "applied to salary" flag.
  - **Analytics → Punctuality → view toggle**: new Employees/Departments
    toggle. Department view renders a report sorted by total late
    instances with top 5 latecomers per row and an expandable employee
    list per department.
  - **Bulk payslip download disabled**: `GET /payroll/payslips/bulk`
    returns HTTP 403 with a policy error message. The Stage 7 Bulk PDF
    button, its handler, and the `getBulkPayslips` import were removed
    from `SalaryComputation.jsx`. Individual payslip generation
    (`/payslip/:code`) remains functional for internal review.
  - **Audit trail**: every state transition is logged —
    `deduction_applied` (HR), `finance_review` (finance approve/reject),
    `applied_to_salary` (Stage 7 compute), `shift_change` (employee
    shift assignment). All write to `audit_log` with `stage='late_coming'`
    or `stage='salary_compute'`.

## Early Exit Detection & Gate Pass Management (April 2026)
- **4 new tables**: `short_leaves` (gate pass records), `early_exit_detections`
  (per-employee per-date detection results), `early_exit_deductions` (HR-initiated,
  finance-approved deductions), `early_exit_deduction_audit` (state transition log).
- **New routes**: `short-leaves.js` (5 endpoints at `/api/short-leaves`),
  `early-exits.js` (5 endpoints at `/api/early-exits`),
  `early-exit-deductions.js` (8 endpoints at `/api/early-exit-deductions`).
- **Detection service**: `earlyExitDetection.js` — compares punch-out time against
  shift end_time. Gate passes provide full exemption (left after authorized time)
  or partial credit (overage = authorized - punchOut). Upserts into
  `early_exit_detections` with UNIQUE(employee_code, date). Updates
  `attendance_processed.is_early_departure` and `early_by_minutes`.
- **Deduction flow**: HR submits deduction (warning/half_day/full_day/custom) →
  finance approves or rejects → approved deductions feed into Stage 7 salary
  computation via `early_exit_deduction` column on `salary_computations`.
  `salary_applied` flag prevents double-counting (same pattern as late coming).
- **Salary impact**: `earlyExitDeduction` added to `totalDeductions` in
  `computeEmployeeSalary()`. Contractors excluded (mirrors OT/ED gate). UPSERT
  includes `early_exit_deduction = excluded.early_exit_deduction` for safe recompute.
- **Frontend**: Gate Passes tab in Leave Management, Early Exit tab in Analytics,
  Early Exit Deductions tab in Finance Audit, Early Exits card in Daily MIS.
- **Permissions**: `early-exit` added to `hr` and `finance` roles.

## Early Exit Date Range Report (April 2026)
- **No schema changes** — all new endpoints read from the existing
  `early_exit_detections` table which already caches one row per
  employee/date with shift/punch/minutes metadata.
- **New endpoints** on `backend/src/routes/early-exits.js` (mounted at both
  `/api/early-exits` and alias `/api/early-exit`):
  - `GET /range-report` — arbitrary date range (startDate, endDate YYYY-MM-DD;
    optional company, employeeCode, department, minMinutes). Validates
    `startDate <= endDate` and enforces 90-day max. LEFT JOINs `short_leaves`
    so gate-pass context is returned alongside each row. Response includes
    row data plus a `summary` object with totalIncidents, uniqueEmployees,
    avgMinutesEarly, totalFlaggedMinutes, withGatePass / withoutGatePass,
    and dateRange `{ start, end, days }`. Exempted rows are still returned
    in `data` but excluded from the "non-exempt" aggregates.
  - `GET /mtd-summary` — per-employee MTD counts for a month/year with
    previous-month comparison. Uses the same `trendLabel()` helper as
    `lateComing.js` (up/down/stable with 10% relative threshold). Returns
    a `totals` block for header KPI cards and a per-employee `data` array.
  - `GET /department-summary` — per-department rollup for month/year with
    employee_count, total_incidents, prev_incidents, avg_minutes_early,
    trend and `worst_offender` (same shape as late coming's dept summary).
  - `GET /export` — XLSX via SheetJS. Sheet 1 "Summary" (date range +
    filter criteria + aggregates) and Sheet 2 "Early Exit Details" (all
    filtered rows). Column widths are pre-sized. Filename format:
    `EarlyExitReport_STARTDATE_to_ENDDATE.xlsx`. All filters that apply to
    `range-report` also apply to export.
  - All four endpoints gated by `requireHrFinanceOrAdmin`, so HR, Finance
    and Admin roles can read and export. The existing single-day
    `POST /detect` endpoint is unchanged (backwards compatible).
- **Frontend — `EarlyExitDetection.jsx` redesign**:
  - Mirrors Late Coming layout: header + KPI cards grid + department
    breakdown cards + filter toolbar + sortable detail table.
  - MTD KPI cards: Early Exits (MTD) with trend arrow vs last month,
    Unique Employees, Avg Minutes Early (range-scoped), With Gate Pass.
  - Department breakdown card grid (top 6 departments) shows total exits,
    employee count, avg minutes early, trend arrow, worst offender.
  - Date range picker with preset buttons: Today / This Week / This Month
    (default) / Last Month / Last 3 Months / Custom. Selecting a preset
    highlights it; manual date edits switch to "custom". 90-day inline
    validation prevents the query from firing.
  - Client-side filters stack: employee search (code or name), department
    dropdown (populated from result set), min-minutes numeric input.
    Sortable column headers use the `useSortable` helper copied from
    Analytics.jsx.
  - "Export Excel" button calls `GET /early-exits/export` with the
    currently-active filters so the XLSX matches what's on screen. Button
    is disabled during the download and when the range is invalid.
  - Empty state: friendly icon + message when no rows match the range.
  - Detail panel / HR deduction workflow / finance-approval modal from the
    previous version is preserved unchanged (no pipeline impact).
- **API helpers** in `frontend/src/utils/api.js`:
  `getEarlyExitRangeReport`, `getEarlyExitMtdSummary`,
  `getEarlyExitDeptSummary`, `exportEarlyExitReport`
  (the last returns `responseType: 'blob'` for XLSX download).

## Daily Wage System (fully implemented)
- **Mount point**: `/api/daily-wage` (`backend/src/routes/dailyWage.js`, 1551 lines)
- **8 DB tables**: `dw_contractors`, `dw_rate_history`, `dw_entries`, `dw_department_allocations`, `dw_approvals`, `dw_payments`, `dw_payment_entries`, `dw_audit_log`
- **9 frontend pages**: `DailyWageDashboard` (`/daily-wage/finance/dashboard`), `DailyWageEntry` (`/daily-wage/new`), `DailyWageRecords` (`/daily-wage`), `DailyWageContractors` (`/daily-wage/contractors`), `DailyWageBatchImport` (`/daily-wage/import`), `DailyWageFinanceReview` (`/daily-wage/finance/review`), `DailyWagePayments` (`/daily-wage/finance/payments`), `DailyWageReports` (`/daily-wage/reports`), `DailyWageAuditLog` (`/daily-wage/audit`)
- **Entry status flow**:
  ```
  hr_entered
    ↓ (HR submits)
  pending_finance
    ├→ (Finance approves)  approved → (payment processed) paid
    │                         └→ (Finance reopens) pending_finance
    ├→ (Finance rejects)   hr_entered
    ├→ (Finance corrects)  needs_correction → (HR re-submits) pending_finance
    └→ (Finance flags)     flagged
  ```
- **Rate change flow**: `pending` → `approved` (rates applied to contractor) / `rejected`
- **Business rules**:
  - Rates are **snapshotted at entry creation time** (`wage_rate_applied`, `commission_rate_applied`) — changing a contractor's rate does NOT retroactively affect already-created entries
  - **Duplicate guard**: same contractor + date + overlapping in/out time is rejected; `POST /entries/check-duplicates` must be called before `POST /entries`
  - **Liability formula**: `total_liability = (worker_count × wage_rate) + (worker_count × commission_rate)`
  - **Department allocation invariant**: sum of `dw_department_allocations.worker_count` must equal `dw_entries.total_worker_count` — validated on create/update
  - **Payment gate**: only `approved` entries can be paid; attempting to pay `hr_entered`/`pending_finance`/`flagged` entries returns an error
  - **Audit trail**: every state transition (create, update, approve, reject, flag, reopen, paid) writes to `dw_audit_log` with `old_values`/`new_values` JSON
- **Permissions**:
  - `requireHrOrAdmin`: contractor create/update/deactivate, entry create/update/submit, batch import
  - `requireFinanceOrAdmin`: rate approve/reject, entry approve/reject/flag/reopen/batch-approve, payment processing, dashboard, audit log
  - Authenticated (no role gate): GET contractors, GET entries, GET reports
  - Visibility in sidebar: `daily-wage` page key is in `hr`, `finance`, and `admin` roles in `permissions.js`
- **Reports available**: daily MIS (per-contractor per-date), monthly rollup (by contractor), department cost breakdown, contractor summary with 6-month trend, seasonal trends (12 months), pending liability, payment sheet (printable)
- **Batch import**: up to 500 entries via XLSX/CSV upload; `POST /entries/batch-import` validates each row independently and returns per-row errors; partial import is NOT supported (all-or-nothing transaction)
- **No link to permanent employee payroll pipeline**: Daily Wage is a fully independent subsystem. `dw_*` tables have no FK relationship to `employees`, `salary_computations`, or any Stage 1–7 pipeline table. Costs are tracked separately via `dw_entries` and paid directly to contractors.

## Section 8: Rules for Claude Code Sessions
- Before changing ANY pipeline stage: ALWAYS read every downstream stage's service file AND every consumer (finance audit, payslips, exports, analytics) that reads this stage's output tables.
- Before changing salary computation: read dayCalculation.js (input) AND every route/component that displays salary data (payroll.js, financeAudit.js, salary-advance, payslip PDF).
- Use subagents for codebase exploration. Keep the main context window clean for implementation.
- Never change database schema without checking all routes that query the affected table. SQLite has no runtime schema validation — broken queries fail silently with NULL.
- After changing any pipeline stage: verify the stage's output table schema hasn't changed in a way that breaks downstream consumers.
- Financial calculations: always verify rounding, check for divide-by-zero on salary divisor, and ensure earned ratio is capped at 1.0 for base components.
- Run lint before marking any task complete.
- Update this CLAUDE.md file after completing any major feature or pipeline change.
- **Use curl for all API/endpoint diagnostic and verification queries** — never build a UI/HTML page for tests that can be done with curl. Start the backend server, run curl commands, check headers and response bodies directly. This applies to this project and any other project where curl can reach the server.

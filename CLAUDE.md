# Session Context - Last updated: 2026-04-03

## Project: hr-salary-system
**Branch:** main
**Repo:** https://github.com/abhinavpoddar27-pixel/hr-salary-system.git

## Improvements Implemented (2026-04-03 Session)

### Salary & Day Calculation Fixes
- Auto-create salary_structures when employee has gross_salary but no structure
- Employee master gross_salary is now the source of truth (rescale components)
- LOP waiver: waive per-week LOP when monthly attendance is adequate
- Sunday WOP fix: always pay Sunday if employee actually worked (WOP status)
- Advance recovery: now picks up eligible advances even if not marked paid
- Net salary cap: deductions capped at gross earned (net never negative)
- Returning employees: included in salary computation with caution flag

### Mobile & UI
- Mobile sidebar: hamburger menu, slide-in drawer, backdrop, auto-close
- Overnight shift: auto-detected from start/end times and punch data
- Settings page: admin-only access, policy defaults force-reset on startup
- Confirmation dialog for salary finalisation
- Abbreviation legend auto-expands for first-time users
- Pipeline stage tooltips explaining each step

### Finance Audit Module (Major Upgrade)
- salary_manual_flags + finance_approvals tables for tracking interventions
- Auto-populate flags during salary computation (TDS, deductions, corrections)
- Readiness dashboard with score 0-100, blockers, warnings, passed checks
- Variance report: employees with >10% net salary change
- Statutory cross-check: PF/ESI/PT totals verification
- 7-tab Finance Audit page: Readiness, Manual Interventions, Variance, Statutory, Report, Flags, Corrections

### Excel Salary Slip Export
- Single .xlsx file with SUMMARY sheet and SALARY SLIP sheet
- 4 employees per page group, matching company format
- Columns: S.No, EMP, NAME, DESIGNATION, DATE.D, GROSS, EARNED, ADVANCE, Days, PAYABLE, Net Payable, Signature

### Tier 1 Quick Wins (QW-1 through QW-10)
- QW-1: Rate limiting on login (5 attempts/15min)
- QW-2: ConfirmDialog component for destructive operations
- QW-3: Net salary non-negative cap with warning flag
- QW-4: Skipped employees alert panel with links to set salary
- QW-5: User-friendly parser error messages
- QW-6: CORS locked to Railway domain in production
- QW-7: Leave balance warning on approval
- QW-9: Abbreviation legend auto-expand for first-time users
- QW-10: Pipeline stage tooltips

### Tier 2 High-Impact (HI-1 through HI-7)
- HI-1: Server-side pagination utility + employees endpoint
- HI-2: Background job queue (SQLite-backed, salary/day calc as jobs)
- HI-3: 7-step onboarding wizard for new users
- HI-5: Month-end scheduler (node-cron) with pipeline status notifications
- HI-6: Dynamic company filter from database (auto-seeded)
- HI-7: TDS auto-calculation (FY 2025-26 slabs, new/old regime)

### Tier 3 Strategic (SU-2, SU-5, SU-6)
- SU-2: Employee self-service portal backend (profile, attendance, payslip, leave, loans)
- SU-5: Jest test suite (14 tests: TDS, day calculation, pagination)
- SU-6: Role-based permission matrix (admin, hr, finance, supervisor, viewer, employee)

## Key Files
- `backend/src/services/salaryComputation.js` — salary computation with auto-flags
- `backend/src/services/dayCalculation.js` — day calculation with LOP waiver
- `backend/src/services/tdsCalculation.js` — TDS auto-calculation
- `backend/src/services/jobQueue.js` — background job queue
- `backend/src/services/monthEndScheduler.js` — cron-based notifications
- `backend/src/config/permissions.js` — role-based permission matrix
- `backend/src/routes/financeAudit.js` — enhanced finance audit endpoints
- `backend/src/routes/employeePortal.js` — employee self-service API
- `frontend/src/pages/FinanceAudit.jsx` — 7-tab finance audit UI
- `frontend/src/components/OnboardingWizard.jsx` — onboarding wizard
- `frontend/src/components/ui/ConfirmDialog.jsx` — confirmation dialog

## Resume instructions
You are continuing work on the **hr-salary-system** project (branch: main).
All Tier 1 and Tier 2 improvements are implemented. Tier 3 strategic items
(SU-2, SU-5, SU-6) backend is done. Remaining: SU-2 frontend portal pages,
SU-1 PostgreSQL migration (complex), SU-3 auto-import, SU-4 multi-tenant.

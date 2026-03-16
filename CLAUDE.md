# HR Intelligence & Salary Processing Platform

## Project Overview
Full-stack HR/payroll platform for Indriyan Beverages / Asian Lakto. Built with React 18 + Express 4 + better-sqlite3. Deployed on Railway from GitHub.

## Deployment
- **Live URL**: https://hr-app-production-681b.up.railway.app
- **Login**: admin / Indriyan@2025
- **GitHub**: https://github.com/abhinavpoddar27-pixel/hr-salary-system
- **Railway Project ID**: 1f5de136-63be-41d1-9721-4def1dc01298
- **Railway Service ID**: 157752ba-da62-476a-93ab-bbf6b3f325b9
- **Railway Environment ID**: baee0a91-ba8c-4f77-893f-d36b6a4c6fb0
- **Railway Token**: d37fef8a-8bbb-4969-9082-d98731141b1e
- Push to GitHub triggers Railway auto-deploy. Can also trigger via Railway GraphQL API.
- **gh CLI** installed at: `/tmp/gh_extracted/gh_2.67.0_macOS_arm64/bin/gh` (may need re-download after reboot)

## Tech Stack
- **Frontend**: React 18, React Router 6, Zustand (state), React Query 5 (TanStack), Tailwind CSS, react-hot-toast, clsx
- **Backend**: Express 4, better-sqlite3, JWT auth (cookie + Bearer), multer (file uploads), bcryptjs
- **No Node.js installed locally** — builds/tests happen on Railway only

## Architecture

### 7-Stage Salary Pipeline
1. Import (Excel upload) → 2. Miss Punch Detection → 3. Shift Verification → 4. Night Shift Pairing → 5. Manual Corrections → 6. Day Calculation & Leave → 7. Salary Computation

### Indian Payroll Rules
- Salary divisor: 26 days (configurable)
- PF: 12% employee + 12% employer on PF wages (ceiling ₹15,000)
- ESI: 0.75% employee + 3.25% employer (threshold ₹21,000 gross)
- PT: Punjab slabs (0/150/200)
- Sunday grant: based on working days in week (6 = full, 4-5 = partial, <4 = unpaid)

### Key Database Tables
- `employees`, `shifts`, `holidays`, `salary_structures`, `leave_balances`
- `attendance_raw`, `attendance_processed`, `night_shift_pairs`
- `day_calculations`, `salary_computations`, `salary_advances`
- `loans`, `loan_repayments`, `leave_applications`, `notifications`
- `employee_documents`, `employee_lifecycle`, `compliance_items`
- `alerts`, `audit_log`, `policy_config`, `users`

## File Structure
```
backend/
  server.js                     # Express app, route mounting
  src/
    database/db.js              # SQLite connection singleton
    database/schema.js          # All CREATE TABLE + migrations
    middleware/auth.js           # JWT auth middleware
    routes/
      auth.js, import.js, attendance.js, employees.js
      payroll.js, analytics.js, reports.js, settings.js
      advance.js, salary-input.js, daily-mis.js
      loans.js, leaves.js, notifications.js, lifecycle.js
    services/
      analytics.js              # computeOrgOverview, headcountTrend, overtime, hours, dept deep-dive
      loanService.js            # Loan CRUD, EMI calculation, repayment schedules

frontend/
  src/
    App.jsx                     # Router with lazy-loaded pages
    store/appStore.js           # Zustand global state
    utils/api.js                # All API functions (axios)
    utils/formatters.js         # Date/currency/month helpers
    components/
      layout/Sidebar.jsx, Header.jsx, NotificationBell.jsx
      ui/Modal.jsx, CalendarView.jsx, Abbr.jsx
    pages/
      Dashboard.jsx, Login.jsx
      Import.jsx, MissPunch.jsx, ShiftVerification.jsx
      NightShift.jsx, AttendanceRegister.jsx
      DayCalculation.jsx, SalaryComputation.jsx
      Analytics.jsx (5 sub-tabs), WorkforceAnalytics.jsx
      Employees.jsx (with EmployeeProfileModal)
      Loans.jsx, LeaveManagement.jsx
      Reports.jsx, Alerts.jsx, Compliance.jsx
      SalaryAdvance.jsx, SalaryInput.jsx, DailyMIS.jsx
      Settings.jsx
```

## Completed Features (Phases 1-7)
1. ✅ Glass-morphism UI with Tailwind, sidebar navigation, month/year selector
2. ✅ 7-stage salary pipeline with stage-by-stage processing
3. ✅ Daily MIS, Salary Advance, Salary Input/Change tracking
4. ✅ Analytics: Overview, Absenteeism, Punctuality, Overtime, Working Hours (5 sub-tabs)
5. ✅ Workforce Analytics: Headcount, Attrition, Contractor management
6. ✅ Loan Management: Create/Approve/Reject/Close, EMI schedules, monthly deductions
7. ✅ Employee Database: Profile modal (5 tabs), document upload/download
8. ✅ Leave Management: Apply/Approve/Reject with balance deduction
9. ✅ Notification system: Auto-generate, bell dropdown with unread count
10. ✅ Employee Lifecycle tracking
11. ✅ Compliance calendar (PF/ESI/Labour Law)

## Common Patterns
- API functions in `frontend/src/utils/api.js` — all use axios instance with JWT interceptor
- New routes: create in `backend/src/routes/`, mount in `server.js` with `requireAuth`
- New pages: create in `frontend/src/pages/`, lazy-import in `App.jsx`, add to `Sidebar.jsx`
- Schema changes: add to `schema.js` using `safeAddColumn()` for migrations
- All modals use `<Modal>` component from `components/ui/Modal.jsx`

## Known Issues / Notes
- `getOvertimeReport` in api.js points to `/analytics/overtime`; reports version renamed to `getOvertimeReportData`
- SSH key generated at `~/.ssh/id_ed25519` — added to GitHub for push access
- Git credential helper: `osxkeychain` + `gh auth setup-git` configured

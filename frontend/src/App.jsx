import React, { Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Sidebar from './components/layout/Sidebar'
import Header from './components/layout/Header'
import ErrorBoundary from './components/ui/ErrorBoundary'
import AbbreviationLegend from './components/ui/AbbreviationLegend'
import SalaryExplainer from './components/SalaryExplainer'
import { useAppStore } from './store/appStore'
import { getMe } from './utils/api'
import { tracker } from './utils/sessionTracker'
import useInactivityTimeout from './hooks/useInactivityTimeout'

// Public page
const Login = React.lazy(() => import('./pages/Login'))

// Protected pages (lazy-loaded)
const Dashboard = React.lazy(() => import('./pages/Dashboard'))
const Import = React.lazy(() => import('./pages/Import'))
const MissPunch = React.lazy(() => import('./pages/MissPunch'))
const ShiftVerification = React.lazy(() => import('./pages/ShiftVerification'))
const NightShift = React.lazy(() => import('./pages/NightShift'))
const AttendanceRegister = React.lazy(() => import('./pages/AttendanceRegister'))
const DayCalculation = React.lazy(() => import('./pages/DayCalculation'))
const SalaryComputation = React.lazy(() => import('./pages/SalaryComputation'))
const HeldSalariesRegister = React.lazy(() => import('./pages/HeldSalariesRegister'))
const Analytics = React.lazy(() => import('./pages/Analytics'))
const WorkforceAnalytics = React.lazy(() => import('./pages/WorkforceAnalytics'))
const Compliance = React.lazy(() => import('./pages/Compliance'))
const Reports = React.lazy(() => import('./pages/Reports'))
const Employees = React.lazy(() => import('./pages/Employees'))
const Settings = React.lazy(() => import('./pages/Settings'))
const Alerts = React.lazy(() => import('./pages/Alerts'))
const SalaryAdvance = React.lazy(() => import('./pages/SalaryAdvance'))
const PayableOT = React.lazy(() => import('./pages/PayableOT'))
const SalaryInput = React.lazy(() => import('./pages/SalaryInput'))
const DailyMIS = React.lazy(() => import('./pages/DailyMIS'))
const Loans = React.lazy(() => import('./pages/Loans'))
const LeaveManagement = React.lazy(() => import('./pages/LeaveManagement'))
const FinanceAudit = React.lazy(() => import('./pages/FinanceAudit'))
const FinanceVerification = React.lazy(() => import('./pages/FinanceVerification'))
const ExtraDutyGrants = React.lazy(() => import('./pages/ExtraDutyGrants'))
const SessionAnalytics = React.lazy(() => import('./pages/SessionAnalytics'))
const DailyWageContractors = React.lazy(() => import('./pages/DailyWageContractors'))
const DailyWageEntry = React.lazy(() => import('./pages/DailyWageEntry'))
const DailyWageBatchImport = React.lazy(() => import('./pages/DailyWageBatchImport'))
const DailyWageRecords = React.lazy(() => import('./pages/DailyWageRecords'))
const DailyWageFinanceReview = React.lazy(() => import('./pages/DailyWageFinanceReview'))
const DailyWagePayments = React.lazy(() => import('./pages/DailyWagePayments'))
const DailyWageDashboard = React.lazy(() => import('./pages/DailyWageDashboard'))
const DailyWageReports = React.lazy(() => import('./pages/DailyWageReports'))
const DailyWageAuditLog = React.lazy(() => import('./pages/DailyWageAuditLog'))
const QueryTool = React.lazy(() => import('./pages/QueryTool'))
const DeptAnalytics = React.lazy(() => import('./pages/DeptAnalytics'))
const EmployeeProfile = React.lazy(() => import('./pages/EmployeeProfile'))
const SalesEmployeeMaster = React.lazy(() => import('./pages/Sales/SalesEmployeeMaster'))
const SalesHolidayMaster = React.lazy(() => import('./pages/Sales/SalesHolidayMaster'))
const SalesUpload = React.lazy(() => import('./pages/Sales/SalesUpload'))

function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-screen">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        <p className="text-sm text-slate-500">Loading...</p>
      </div>
    </div>
  )
}

function Layout({ children, title }) {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title={title} />
        <main className="flex-1 overflow-y-auto">
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              {children}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <AbbreviationLegend />
      <SalaryExplainer />
    </div>
  )
}

// Module-level cache so we only hit /auth/me once per token, not on
// every route navigation (RequireAuth remounts per <Route element>).
// Keyed by token so a logout-then-login flow refetches for the new user.
let lastRefreshedToken = null

// ── Auth guard: redirects to /login if not authenticated ──────
// On first authenticated render, refresh the stored user from /auth/me
// so a stale localStorage role (e.g. a legacy "Finance Team" that pre-
// dates backend role normalization) heals automatically. The backend's
// normalizeRole() runs on that endpoint, so the refreshed object is
// guaranteed to have a canonical lowercase `role`.
function RequireAuth({ children }) {
  const isAuthenticated = useAppStore(s => s.isAuthenticated)
  const token = useAppStore(s => s.token)
  const refreshUser = useAppStore(s => s.refreshUser)

  useEffect(() => {
    if (!isAuthenticated || !token || lastRefreshedToken === token) return
    lastRefreshedToken = token
    let cancelled = false
    getMe()
      .then((res) => {
        if (cancelled) return
        const u = res?.data?.user
        if (u) refreshUser(u)
      })
      .catch(() => { /* 401 interceptor already handles redirect */ })
    return () => { cancelled = true }
  }, [isAuthenticated, token, refreshUser])

  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

// ── Session tracker: init/destroy on auth, track route changes ──
function RouteTracker() {
  const location = useLocation()
  const isAuthenticated = useAppStore(s => s.isAuthenticated)

  useEffect(() => {
    try {
      if (isAuthenticated) { tracker.init() }
      else { tracker.destroy() }
    } catch (e) { /* silent */ }
    return () => { try { tracker.destroy() } catch (e) { /* silent */ } }
  }, [isAuthenticated])

  useEffect(() => {
    try { if (isAuthenticated) tracker.trackPageView(location.pathname) } catch (e) { /* silent */ }
  }, [location.pathname, isAuthenticated])

  return null
}

function InactivityGuard() {
  useInactivityTimeout()
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <InactivityGuard />
      <RouteTracker />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />

          {/* Protected routes */}
          <Route path="/" element={<RequireAuth><Layout title="Organisation Dashboard"><Dashboard /></Layout></RequireAuth>} />
          <Route path="/pipeline" element={<RequireAuth><Navigate to="/pipeline/import" replace /></RequireAuth>} />
          <Route path="/pipeline/import" element={<RequireAuth><Layout title="Stage 1: Import Attendance Data"><Import /></Layout></RequireAuth>} />
          <Route path="/pipeline/miss-punch" element={<RequireAuth><Layout title="Stage 2: Miss Punch Detection & Rectification"><MissPunch /></Layout></RequireAuth>} />
          <Route path="/pipeline/shift-check" element={<RequireAuth><Layout title="Stage 3: Shift Verification"><ShiftVerification /></Layout></RequireAuth>} />
          <Route path="/pipeline/night-shift" element={<RequireAuth><Layout title="Stage 4: Night Shift Pairing"><NightShift /></Layout></RequireAuth>} />
          <Route path="/pipeline/corrections" element={<RequireAuth><Layout title="Stage 5: Manual Corrections"><AttendanceRegister /></Layout></RequireAuth>} />
          <Route path="/pipeline/day-calc" element={<RequireAuth><Layout title="Stage 6: Day Calculation & Leave Adjustment"><DayCalculation /></Layout></RequireAuth>} />
          <Route path="/pipeline/salary" element={<RequireAuth><Layout title="Stage 7: Salary Computation"><SalaryComputation /></Layout></RequireAuth>} />
          <Route path="/held-salaries" element={<RequireAuth><Layout title="Held Salaries Register"><HeldSalariesRegister /></Layout></RequireAuth>} />
          <Route path="/salary-advance" element={<RequireAuth><Layout title="Salary Advance"><SalaryAdvance /></Layout></RequireAuth>} />
          <Route path="/payable-ot" element={<RequireAuth><Layout title="Payable OT / Extra Duty"><PayableOT /></Layout></RequireAuth>} />
          <Route path="/salary-input" element={<RequireAuth><Layout title="Salary Input & Changes"><SalaryInput /></Layout></RequireAuth>} />
          <Route path="/daily-mis" element={<RequireAuth><Layout title="Daily MIS"><DailyMIS /></Layout></RequireAuth>} />
          <Route path="/loans" element={<RequireAuth><Layout title="Loan Management"><Loans /></Layout></RequireAuth>} />
          <Route path="/leave-management" element={<RequireAuth><Layout title="Leave Management"><LeaveManagement /></Layout></RequireAuth>} />
          <Route path="/workforce/*" element={<RequireAuth><Layout title="Workforce Analytics"><WorkforceAnalytics /></Layout></RequireAuth>} />
          <Route path="/analytics/*" element={<RequireAuth><Layout title="Attendance Analytics"><Analytics /></Layout></RequireAuth>} />
          <Route path="/compliance/*" element={<RequireAuth><Layout title="Compliance"><Compliance /></Layout></RequireAuth>} />
          <Route path="/reports" element={<RequireAuth><Layout title="Reports"><Reports /></Layout></RequireAuth>} />
          <Route path="/finance-audit" element={<RequireAuth><Layout title="Finance Audit"><FinanceAudit /></Layout></RequireAuth>} />
          <Route path="/finance-verification" element={<RequireAuth><Layout title="Finance Verification"><FinanceVerification /></Layout></RequireAuth>} />
          <Route path="/extra-duty-grants" element={<RequireAuth><Layout title="Extra Duty Grants"><ExtraDutyGrants /></Layout></RequireAuth>} />
          <Route path="/daily-wage/contractors" element={<RequireAuth><Layout title="Contractor Master"><DailyWageContractors /></Layout></RequireAuth>} />
          <Route path="/daily-wage/new" element={<RequireAuth><Layout title="New Daily Wage Entry"><DailyWageEntry /></Layout></RequireAuth>} />
          <Route path="/daily-wage/import" element={<RequireAuth><Layout title="Batch Import"><DailyWageBatchImport /></Layout></RequireAuth>} />
          <Route path="/daily-wage/finance/review" element={<RequireAuth><Layout title="Daily Wage Finance Review"><DailyWageFinanceReview /></Layout></RequireAuth>} />
          <Route path="/daily-wage/finance/payments" element={<RequireAuth><Layout title="Daily Wage Payments"><DailyWagePayments /></Layout></RequireAuth>} />
          <Route path="/daily-wage/finance/dashboard" element={<RequireAuth><Layout title="Daily Wage Dashboard"><DailyWageDashboard /></Layout></RequireAuth>} />
          <Route path="/daily-wage/reports" element={<RequireAuth><Layout title="Daily Wage Reports"><DailyWageReports /></Layout></RequireAuth>} />
          <Route path="/daily-wage/audit" element={<RequireAuth><Layout title="Daily Wage Audit Log"><DailyWageAuditLog /></Layout></RequireAuth>} />
          <Route path="/daily-wage" element={<RequireAuth><Layout title="Daily Wage Records"><DailyWageRecords /></Layout></RequireAuth>} />
          <Route path="/session-analytics" element={<RequireAuth><Layout title="Session Analytics"><SessionAnalytics /></Layout></RequireAuth>} />
          <Route path="/admin/query-tool" element={<RequireAuth><Layout title="Database Query Tool"><QueryTool /></Layout></RequireAuth>} />
          <Route path="/dept-analytics" element={<RequireAuth><Layout title="Department & Org Analytics"><DeptAnalytics /></Layout></RequireAuth>} />
          <Route path="/employee-profile" element={<RequireAuth><Layout title="Employee Intelligence Profile"><EmployeeProfile /></Layout></RequireAuth>} />
          <Route path="/employees" element={<RequireAuth><Layout title="Employee Master"><Employees /></Layout></RequireAuth>} />
          <Route path="/sales/employees" element={<RequireAuth><Layout title="Sales Employees"><SalesEmployeeMaster /></Layout></RequireAuth>} />
          <Route path="/sales/holidays" element={<RequireAuth><Layout title="Sales Holidays"><SalesHolidayMaster /></Layout></RequireAuth>} />
          <Route path="/sales/upload" element={<RequireAuth><Layout title="Upload Coordinator Sheet"><SalesUpload /></Layout></RequireAuth>} />
          <Route path="/alerts" element={<RequireAuth><Layout title="Alerts"><Alerts /></Layout></RequireAuth>} />
          <Route path="/settings/*" element={<RequireAuth><Layout title="Settings"><Settings /></Layout></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

import React, { Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/layout/Sidebar'
import Header from './components/layout/Header'
import { useAppStore } from './store/appStore'

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
const Analytics = React.lazy(() => import('./pages/Analytics'))
const WorkforceAnalytics = React.lazy(() => import('./pages/WorkforceAnalytics'))
const Compliance = React.lazy(() => import('./pages/Compliance'))
const Reports = React.lazy(() => import('./pages/Reports'))
const Employees = React.lazy(() => import('./pages/Employees'))
const Settings = React.lazy(() => import('./pages/Settings'))
const Alerts = React.lazy(() => import('./pages/Alerts'))

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
          <Suspense fallback={<PageLoader />}>
            {children}
          </Suspense>
        </main>
      </div>
    </div>
  )
}

// ── Auth guard: redirects to /login if not authenticated ──────
function RequireAuth({ children }) {
  const isAuthenticated = useAppStore(s => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
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
          <Route path="/workforce/*" element={<RequireAuth><Layout title="Workforce Analytics"><WorkforceAnalytics /></Layout></RequireAuth>} />
          <Route path="/analytics/*" element={<RequireAuth><Layout title="Attendance Analytics"><Analytics /></Layout></RequireAuth>} />
          <Route path="/compliance/*" element={<RequireAuth><Layout title="Compliance"><Compliance /></Layout></RequireAuth>} />
          <Route path="/reports" element={<RequireAuth><Layout title="Reports"><Reports /></Layout></RequireAuth>} />
          <Route path="/employees" element={<RequireAuth><Layout title="Employee Master"><Employees /></Layout></RequireAuth>} />
          <Route path="/alerts" element={<RequireAuth><Layout title="Alerts"><Alerts /></Layout></RequireAuth>} />
          <Route path="/settings/*" element={<RequireAuth><Layout title="Settings"><Settings /></Layout></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

import axios from 'axios'
import toast from 'react-hot-toast'

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
  withCredentials: true
})

// Attach JWT token from localStorage to every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('hr_token')
  if (token) config.headers['Authorization'] = `Bearer ${token}`
  return config
})

// Handle responses: 401 → redirect to login; others → toast error
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      // Don't toast on auth errors — just redirect to login
      localStorage.removeItem('hr_token')
      localStorage.removeItem('hr_user')
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login'
      }
      return Promise.reject(err)
    }
    const msg = err.response?.data?.error || err.message || 'Request failed'
    toast.error(msg)
    return Promise.reject(err)
  }
)

// ── Auth ────────────────────────────────────────────────
export const login = (username, password) => api.post('/auth/login', { username, password })
export const logout = () => api.post('/auth/logout')
export const getMe = () => api.get('/auth/me')
export const changePassword = (data) => api.post('/auth/change-password', data)
export const getUsers = () => api.get('/auth/users')
export const createUser = (data) => api.post('/auth/users', data)

// ── Import ──────────────────────────────────────────────
export const uploadFiles = (formData) => api.post('/import/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
export const getImportHistory = (params = {}) => api.get('/import/history', { params })
export const getImportSummary = (month, year) => api.get(`/import/summary/${month}/${year}`)
export const markStageComplete = (stage, month, year, company) => api.post(`/import/stage/${stage}/complete`, { month, year, company })
export const deleteImport = (id) => api.delete(`/import/${id}`)

// ── Attendance ─────────────────────────────────────────
export const getProcessedRecords = (params) => api.get('/attendance/processed', { params })
export const getMissPunches = (params) => api.get('/attendance/miss-punches', { params })
export const resolveMissPunch = (id, data) => api.post(`/attendance/miss-punches/${id}/resolve`, data)
export const bulkResolveMissPunches = (data) => api.post('/attendance/miss-punches/bulk-resolve', data)
export const getNightShifts = (params) => api.get('/attendance/night-shifts', { params })
export const confirmNightShift = (id) => api.post(`/attendance/night-shifts/${id}/confirm`)
export const rejectNightShift = (id) => api.post(`/attendance/night-shifts/${id}/reject`)
export const updateAttendanceRecord = (id, data) => api.put(`/attendance/record/${id}`, data)
export const getAttendanceRegister = (params) => api.get('/attendance/register', { params })
export const getMonthlyAttendanceSummary = (month, year, company) => api.get('/attendance/monthly-summary', { params: { month, year, ...(company ? { company } : {}) } })
export const getValidationStatus = (params) => api.get('/attendance/validation-status', { params })
export const getEmployeeDailyAttendance = (code, month, year) => api.get(`/attendance/daily/${code}`, { params: { month, year } })
export const updateRecordShift = (id, data) => api.put(`/attendance/record/${id}/shift`, data)
export const recalculateMetrics = (month, year) => api.post('/attendance/recalculate-metrics', { month, year })

// ── Employees ──────────────────────────────────────────
export const getEmployees = (params) => api.get('/employees', { params })
export const getEmployee = (code) => api.get(`/employees/${code}`)
export const createEmployee = (data) => api.post('/employees', data)
export const updateEmployee = (code, data) => api.put(`/employees/${code}`, data)
export const updateSalaryStructure = (code, data) => api.put(`/employees/${code}/salary`, data)
export const getEmployeeLeaves = (code, year) => api.get(`/employees/${code}/leaves`, { params: { year } })
export const getLeaveBalances = (code, year) => api.get(`/employees/${code}/leaves`, { params: { year } })
export const updateEmployeeLeaves = (code, data) => api.put(`/employees/${code}/leaves`, data)
export const updateLeaveBalance = (code, data) => api.put(`/employees/${code}/leaves`, data)
export const getDepartments = () => api.get('/employees/meta/departments')
export const getEmployeeDocuments = (code) => api.get(`/employees/${code}/documents`)
export const uploadEmployeeDocument = (code, formData) => api.post(`/employees/${code}/documents`, formData, { headers: { 'Content-Type': 'multipart/form-data' } })
export const downloadEmployeeDocument = (id) => api.get(`/employees/documents/${id}/download`, { responseType: 'blob' })
export const deleteEmployeeDocument = (id) => api.delete(`/employees/documents/${id}`)
export const markEmployeeLeft = (code, data) => api.put(`/employees/${code}/mark-left`, data)

// ── Payroll ────────────────────────────────────────────
export const calculateDays = (data) => api.post('/payroll/calculate-days', data)
export const getDayCalculations = (params) => api.get('/payroll/day-calculations', { params })
export const getDayCalculation = (code, month, year) => api.get(`/payroll/day-calculations/${code}`, { params: { month, year } })
export const applyLateDeduction = (code, data) => api.put(`/payroll/day-calculations/${code}/late-deduction`, data)
export const computeSalary = (data) => api.post('/payroll/compute-salary', data)
export const getSalaryRegister = (month, year, company) => api.get('/payroll/salary-register', { params: { month, year, company } })
export const getPayslip = (code, month, year) => api.get(`/payroll/payslip/${code}`, { params: { month, year } })
export const updateManualDeductions = (code, data) => api.put(`/payroll/salary/${code}/manual-deductions`, data)
export const finaliseSalary = (data) => api.post('/payroll/finalise', data)

// ── Payable OT / Extra Duty ──────────────────────────
export const getPayableOT = (month, year, company) =>
  api.get('/payroll/payable-ot', { params: { month, year, company } })
export const grantExtraDuty = (data) => api.post('/payroll/grant-extra-duty', data)
export const revokeExtraDuty = (id) => api.delete(`/payroll/revoke-extra-duty/${id}`)
export const listExtraDutyGrants = (month, year) =>
  api.get('/payroll/extra-duty-grants', { params: { month, year } })

// ── Daily MIS ────────────────────────────────────────
export const getDailyShiftBreakdown = (date, opts = {}) => api.get('/daily-mis/shift-breakdown', { params: { date, ...opts } })
export const getDailyWorkerBreakdown = (date, opts = {}) => api.get('/daily-mis/worker-breakdown', { params: { date, ...opts } })
export const getPreviousDayReport = (date, opts = {}) => api.get('/daily-mis/previous-day-report', { params: { date, ...opts } })

// ── Analytics ──────────────────────────────────────────
export const getOrgOverview = (month, year, startDateOrOpts, endDate, company) => {
  const params = { month, year }
  if (typeof startDateOrOpts === 'object' && startDateOrOpts !== null) {
    Object.assign(params, startDateOrOpts)
  } else {
    if (startDateOrOpts) params.startDate = startDateOrOpts
    if (endDate) params.endDate = endDate
  }
  if (company) params.company = company
  return api.get('/analytics/overview', { params })
}
export const getHeadcountTrend = (month, year, months, company, opts = {}) => api.get('/analytics/headcount-trend', { params: { month, year, months, ...(company ? { company } : {}), ...opts } })
export const getAttritionData = (month, year, company) => api.get('/analytics/attrition', { params: { month, year, ...(company ? { company } : {}) } })
export const getAttrition = (month, year) => api.get('/analytics/attrition', { params: { month, year } })
export const getChronicAbsentees = (month, year, startDate, endDate, company) => api.get('/analytics/absentees', { params: { month, year, startDate, endDate, ...(company ? { company } : {}) } })
export const getAbsentees = (month, year) => api.get('/analytics/absentees', { params: { month, year } })
export const getPunctualityReport = (month, year, startDate, endDate, company) => api.get('/analytics/punctuality', { params: { month, year, startDate, endDate, ...(company ? { company } : {}) } })
export const getDepartmentStats = (month, year) => api.get('/analytics/departments', { params: { month, year } })
export const getAttendanceHeatmap = (month, year, startDate, endDate) => api.get('/analytics/heatmap', { params: { month, year, startDate, endDate } })
export const getOvertimeReport = (month, year, startDate, endDate, company) => api.get('/analytics/overtime', { params: { month, year, startDate, endDate, ...(company ? { company } : {}) } })
export const getWorkingHoursReport = (month, year, startDate, endDate, company) => api.get('/analytics/working-hours', { params: { month, year, startDate, endDate, ...(company ? { company } : {}) } })
export const getDepartmentDeepDive = (dept, month, year, startDate, endDate, company) => api.get(`/analytics/department/${encodeURIComponent(dept)}`, { params: { month, year, startDate, endDate, ...(company ? { company } : {}) } })
// April 2026: release_notes is now REQUIRED by the backend endpoint.
// Callers that don't pass a note get a clean 400 — the shared
// ReleaseHoldModal component is the only legitimate entry point.
export const releaseHeldSalary = (code, month, year, releaseNotes) =>
  api.put(`/payroll/salary/${code}/hold-release`, { month, year, release_notes: releaseNotes })
export const getHoldReleases = (params = {}) => api.get('/payroll/salary/hold-releases', { params })
export const getHoldReleasesReport = (params) => api.get('/payroll/salary/hold-releases/report', { params })
// Stage 6/7 recompute-required banner — detects miss punches whose
// finance status changed since the last day_calculations.updated_at
export const getDayCalcStaleness = (month, year, company) =>
  api.get('/payroll/day-calc-staleness', { params: { month, year, company } })

// ── Loans ────────────────────────────────────────────────
export const getLoans = (params) => api.get('/loans', { params })
export const getLoanTypes = () => api.get('/loans/types')
export const getLoanStats = () => api.get('/loans/stats')
export const getLoanDeductions = (month, year) => api.get('/loans/deductions', { params: { month, year } })
export const createLoan = (data) => api.post('/loans', data)
export const getLoanDetails = (id) => api.get(`/loans/${id}`)
export const approveLoan = (id, data) => api.put(`/loans/${id}/approve`, data)
export const rejectLoan = (id, data) => api.put(`/loans/${id}/reject`, data)
export const closeLoan = (id, data) => api.put(`/loans/${id}/close`, data)
export const getEmployeeLoans = (code) => api.get(`/loans/employee/${code}`)
export const processLoanDeductions = (month, year) => api.post('/loans/process-deductions', { month, year })
export const recoverLoanInstallment = (id, data) => api.post(`/loans/${id}/recover`, data)
export const skipLoanInstallment = (id, data) => api.post(`/loans/${id}/skip`, data)
export const getMonthlyLoanRecovery = (month, year) => api.get(`/loans/monthly-recovery/${month}/${year}`)
export const getAlerts = (month, year, unread, opts = {}) => api.get('/analytics/alerts', { params: { month, year, ...(unread ? { unread: 'true' } : {}), ...opts } })
export const generateAlerts = (month, year) => api.post('/analytics/alerts/generate', { month, year })
export const markAlertRead = (id) => api.put(`/analytics/alerts/${id}/read`)
export const getEmployeeProfile = (code) => api.get(`/analytics/employee/${code}`)
export const getEmployeeBehavioralProfile = (code, month, year) => api.get(`/analytics/employee/${code}/profile`, { params: { month, year } })
export const getBehavioralPatterns = (month, year) => api.get('/analytics/patterns', { params: { month, year } })
export const getWorkingHoursByDept = (month, year) => api.get('/analytics/working-hours-by-dept', { params: { month, year } })
export const detectInactiveEmployees = (month, year, inactiveDays) => api.post('/analytics/detect-inactive', { month, year, inactiveDays })
export const getInactiveEmployees = (company) => api.get('/analytics/inactive-employees', { params: { ...(company ? { company } : {}) } })
export const reactivateEmployee = (code) => api.post('/analytics/reactivate-employee', { code })

// ── Usage Logs (admin only) ──────────────────────────
export const getUsageLogs = (params) => api.get('/usage-logs', { params })
export const getUsageLogsSummary = () => api.get('/usage-logs/summary')

// ── Leaves ────────────────────────────────────────────
export const getLeaveApplications = (params) => api.get('/leaves', { params })
export const submitLeaveApplication = (data) => api.post('/leaves', data)
export const approveLeave = (id, data) => api.put(`/leaves/${id}/approve`, data)
export const rejectLeave = (id, data) => api.put(`/leaves/${id}/reject`, data)
export const getLeaveSummary = (params) => api.get('/leaves/summary', { params })
export const getLeaveBalancesList = (params) => api.get('/leaves/balances', { params })
export const getEmployeeLeaveBalance = (code) => api.get(`/leaves/balances/${code}`)
export const adjustLeave = (data) => api.post('/leaves/adjust', data)
export const getLeaveTransactions = (code, params) => api.get(`/leaves/transactions/${code}`, { params })
export const getLeaveRegister = (params) => api.get('/leaves/register', { params })
export const bulkAdjustLeaves = (data) => api.post('/leaves/bulk-adjust', data)

// ── Notifications ────────────────────────────────────────
export const getNotifications = (unread) => api.get('/notifications', { params: unread ? { unread: 'true' } : {} })
export const markNotificationRead = (id) => api.patch(`/notifications/${id}/read`)
export const markAllNotificationsRead = () => api.patch('/notifications/mark-all-read')
export const generateNotifications = () => api.post('/notifications/generate')

// ── Employee Lifecycle ────────────────────────────────────
export const getLifecycleEvents = (code) => api.get(`/lifecycle/employee/${code}`)
export const addLifecycleEvent = (data) => api.post('/lifecycle', data)

// ── Reports ────────────────────────────────────────────
export const getAttendanceSummaryReport = (month, year, company) => api.get('/reports/attendance-summary', { params: { month, year, company } })
export const getMissPunchReport = (month, year, company) => api.get('/reports/miss-punch-report', { params: { month, year, ...(company ? { company } : {}) } })
export const getLateComingReport = (month, year) => api.get('/reports/late-coming', { params: { month, year } })
export const getOvertimeReportData = (month, year) => api.get('/reports/overtime', { params: { month, year } })
export const getPFStatement = (month, year, company) => api.get('/reports/pf-statement', { params: { month, year, ...(company ? { company } : {}) } })
export const getESIStatement = (month, year, company) => api.get('/reports/esi-statement', { params: { month, year, ...(company ? { company } : {}) } })
export const getBankTransferSheet = (month, year, company) => api.get('/reports/bank-transfer', { params: { month, year, company } })
export const getBankTransfer = (month, year, company) => api.get('/reports/bank-transfer', { params: { month, year, company } })
export const getHeadcountReport = (month, year) => api.get('/reports/headcount', { params: { month, year } })
export const getAuditTrail = (month, year, company) => api.get('/reports/audit-trail', { params: { month, year, ...(company ? { company } : {}) } })

// ── Government Export Files ─────────────────────────────
export const getPFECR = (month, year, company) => api.get('/reports/pf-ecr', { params: { month, year, company } })
export const downloadPFECR = (month, year, company) => api.get('/reports/pf-ecr', { params: { month, year, company, download: 'true' }, responseType: 'blob' })
export const getESIContribution = (month, year, company) => api.get('/reports/esi-contribution', { params: { month, year, company } })
export const downloadESIContribution = (month, year, company) => api.get('/reports/esi-contribution', { params: { month, year, company, download: 'true' }, responseType: 'blob' })
export const getBankSalaryFile = (month, year, company) => api.get('/reports/bank-salary-file', { params: { month, year, company } })
export const downloadBankSalaryFile = (month, year, company) => api.get('/reports/bank-salary-file', { params: { month, year, company, download: 'true' }, responseType: 'blob' })
export const getCompanyConfig = (company) => api.get('/reports/company-config', { params: { company } })
export const updateCompanyConfig = (id, data) => api.put(`/reports/company-config/${id}`, data)

// ── Payroll Extended ──────────────────────────────────
export const getBulkPayslips = (month, year, company) => api.get('/payroll/payslips/bulk', { params: { month, year, company } })
export const downloadSalarySlipExcel = (month, year, company) => api.get('/payroll/salary-slip-excel', { params: { month, year, company }, responseType: 'blob' })
export const getMonthEndChecklist = (month, year, company) => api.get('/payroll/month-end-checklist', { params: { month, year, company } })
export const getSalaryComparison = (month, year, company) => api.get('/payroll/salary-comparison', { params: { month, year, company } })

// ── Import Reconciliation ─────────────────────────────
export const getImportReconciliation = (month, year, company) => api.get(`/import/reconciliation/${month}/${year}`, { params: { company } })
export const updateDepartmentsFromReconciliation = (corrections) => api.post('/import/reconciliation/update-departments', { corrections })
export const addEmployeesToMaster = (employees) => api.post('/import/reconciliation/add-to-master', { employees })

// ── User Management Extended ──────────────────────────
export const updateUser = (id, data) => api.put(`/auth/users/${id}`, data)

// ── Settings ───────────────────────────────────────────
export const getShifts = () => api.get('/settings/shifts')
export const createShift = (data) => api.post('/settings/shifts', data)
export const updateShift = (id, data) => api.put(`/settings/shifts/${id}`, data)
export const getHolidays = (year) => api.get('/settings/holidays', { params: { year } })
export const createHoliday = (data) => api.post('/settings/holidays', data)
export const deleteHoliday = (id) => api.delete(`/settings/holidays/${id}`)
export const getPolicyConfig = () => api.get('/settings/policy')
export const getPolicy = () => api.get('/settings/policy')
export const updatePolicyConfig = (data) => api.put('/settings/policy', data)
export const updatePolicy = (data) => api.put('/settings/policy', data)
export const getComplianceItems = (year, company) => api.get('/settings/compliance', { params: { year, ...(company ? { company } : {}) } })
export const updateComplianceItem = (id, data) => api.put(`/settings/compliance/${id}`, data)
export const generateComplianceCalendar = (year) => api.post(`/settings/compliance/generate/${year}`)

// ── Finance Audit ────────────────────────────────────────
export const getFinanceReport = (month, year, company) => api.get('/finance-audit/report', { params: { month, year, company } })
export const submitDayCorrection = (data) => api.post('/finance-audit/day-correction', data)
export const submitPunchCorrection = (data) => api.post('/finance-audit/punch-correction', data)
export const getCorrectionHistory = (code, month, year) => api.get(`/finance-audit/corrections/${code}`, { params: { month, year } })
export const getCorrectionsSummary = (month, year) => api.get('/finance-audit/corrections-summary', { params: { month, year } })
export const getCorrectionReasons = () => api.get('/finance-audit/reasons')
export const applyLeaveCorrection = (data) => api.post('/finance-audit/corrections/apply-leave', data)
export const markPresentCorrection = (data) => api.post('/finance-audit/corrections/mark-present', data)
export const getManualAttendanceFlags = (params) => api.get('/finance-audit/manual-flags', { params })
export const verifyManualFlag = (id, data) => api.put(`/finance-audit/manual-flags/${id}/verify`, data)
export const getSalaryManualFlags = (month, year, company) => api.get('/finance-audit/salary-manual-flags', { params: { month, year, company } })
export const approveManualFlag = (flagId, data) => api.put(`/finance-audit/approve-flag/${flagId}`, data)
export const bulkApproveFlags = (data) => api.put('/finance-audit/bulk-approve', data)
export const getReadinessCheck = (month, year) => api.get('/finance-audit/readiness-check', { params: { month, year } })
export const getVarianceReport = (month, year) => api.get('/finance-audit/variance-report', { params: { month, year } })
export const getStatutoryCrosscheck = (month, year, company) => api.get('/finance-audit/statutory-crosscheck', { params: { month, year, company } })

// ── Jobs ─────────────────────────────────────────────────
export const createJob = (type, params) => api.post('/jobs', { type, params })
export const getJobStatus = (id) => api.get(`/jobs/${id}`)
export const getUserPermissions = () => api.get('/auth/permissions')

// ── Finance Verification ─────────────────────────────────
export const getFinanceAuditDashboard = (month, year) => api.get('/finance-verify/dashboard', { params: { month, year } })
export const getFinanceAuditEmployees = (month, year, params) => api.get('/finance-verify/employees', { params: { month, year, ...params } })
export const getFinanceAuditEmployee = (code, month, year) => api.get(`/finance-verify/employee/${code}`, { params: { month, year } })
export const getFinanceRedFlags = (month, year) => api.get('/finance-verify/red-flags', { params: { month, year } })
export const setFinanceAuditStatus = (data) => api.post('/finance-verify/status', data)
export const bulkVerifyEmployees = (data) => api.post('/finance-verify/bulk-verify', data)
export const addFinanceComment = (data) => api.post('/finance-verify/comment', data)
export const getFinanceComments = (month, year, code) => api.get('/finance-verify/comments', { params: { month, year, employeeCode: code } })
export const resolveFinanceComment = (id) => api.put(`/finance-verify/comment/${id}/resolve`)
export const submitFinanceSignoff = (data) => api.post('/finance-verify/signoff', data)
export const getFinanceSignoffStatus = (month, year) => api.get('/finance-verify/signoff-status', { params: { month, year } })

// ── Extra Duty Grants ────────────────────────────────────
export const getExtraDutyGrants = (month, year, params) => api.get('/extra-duty-grants', { params: { month, year, ...params } })
export const getExtraDutyGrantsSummary = (month, year) => api.get('/extra-duty-grants/summary', { params: { month, year } })
export const createExtraDutyGrant = (data) => api.post('/extra-duty-grants', data)
export const approveExtraDutyGrant = (id) => api.post(`/extra-duty-grants/${id}/approve`)
export const rejectExtraDutyGrant = (id, reason) => api.post(`/extra-duty-grants/${id}/reject`, { rejection_reason: reason })
export const financeApproveGrant = (id) => api.post(`/extra-duty-grants/${id}/finance-approve`)
export const financeFlagGrant = (id, reason, notes) => api.post(`/extra-duty-grants/${id}/finance-flag`, { finance_flag_reason: reason, finance_notes: notes })
export const financeRejectGrant = (id, reason) => api.post(`/extra-duty-grants/${id}/finance-reject`, { finance_flag_reason: reason })
export const bulkFinanceApproveGrants = (ids) => api.post('/extra-duty-grants/bulk-finance-approve', { ids })
export const getFinanceReviewQueue = (month, year) => api.get('/extra-duty-grants/finance-review', { params: { month, year } })

// ── Miss Punch Finance Review (April 2026) ─────────────
// HR resolves miss punches in Stage 2; finance must approve the
// resolution before salary finalisation. Endpoints already exist on
// the backend (financeAudit.js:1310-1452); these helpers wire them
// to the new "Miss Punch Review" tab on FinanceVerification.jsx.
export const getMissPunchPending = (month, year) => api.get('/finance-audit/miss-punch/pending', { params: { month, year } })
export const approveMissPunch = (id, notes) => api.post(`/finance-audit/miss-punch/${id}/approve`, { notes })
export const rejectMissPunch = (id, reason) => api.post(`/finance-audit/miss-punch/${id}/reject`, { rejection_reason: reason })
export const bulkApproveMissPunch = (ids, notes) => api.post('/finance-audit/miss-punch/bulk-approve', { ids, notes })

// ── Salary Change Request review (April 2026) ──────────
// Pending gross-salary changes raised by HR; finance approves/rejects.
// Reuses existing salary-input endpoints (now gated by middleware).
export const getPendingSalaryChanges = () => api.get('/salary-input/pending-changes')
export const approveSalaryChange = (id, effectiveFrom) => api.put(`/salary-input/approve/${id}`, { effectiveFrom })
export const rejectSalaryChange = (id, reason) => api.put(`/salary-input/reject/${id}`, { reason })

// ── Held Salary Release (April 2026) ───────────────────
// `releaseHeldSalary` is defined earlier in this file (line ~131).
// The backend endpoint is now gated by requireFinanceOrAdmin so HR
// users that previously held the call get a clean 403.
// New helper for the held-salary listing used by the FinanceVerification
// "Held Salaries" tab and dashboard widget.
export const getHeldSalaries = (month, year) => api.get('/payroll/salary-register', { params: { month, year } })

// ── Holiday Master ───────────────────────────────────────
export const updateHoliday = (id, data) => api.put(`/settings/holidays/${id}`, data)
export const getHolidayAuditLog = (params) => api.get('/settings/holidays/audit-log', { params })
export const reviewHolidayChange = (id, data) => api.put(`/settings/holidays/audit-log/${id}/review`, data)
export const bulkSeedHolidays = (data) => api.post('/settings/holidays/bulk-seed', data)

// ── Phase 5 Features ────────────────────────────────────
export const accrueLeaves = (month, year) => api.post('/features/accrue-leaves', { month, year })
export const getShiftRoster = (params) => api.get('/features/shift-roster', { params })
export const saveShiftRoster = (assignments) => api.post('/features/shift-roster', { assignments })
export const autoGenerateRoster = (weekStart, pattern) => api.post('/features/shift-roster/auto-generate', { weekStart, pattern })
export const generateComplianceAlerts = (month, year) => api.post('/features/compliance-alerts', { month, year })
export const getAttritionRisk = (month, year) => api.get('/features/attrition-risk', { params: { month, year } })

// ── Session Analytics (admin only) ──────────────────────
export const getSessionOverview = (days) => api.get('/session-analytics/overview', { params: { days } })
export const getSessionUsers = (days) => api.get('/session-analytics/users', { params: { days } })
export const getSessionPages = (days) => api.get('/session-analytics/pages', { params: { days } })
export const getSessionErrors = (days) => api.get('/session-analytics/errors', { params: { days } })

// ── Late Coming Management (Phase 1) ───────────────────
// NOTE: the existing `applyLateDeduction` helper (line ~88) hits the Stage 6
// day-calculations late-deduction endpoint. The new late-coming workflow uses
// `applyLateComingDeduction` to avoid colliding with that legacy name.
export const getLateComingAnalytics = (month, year, params) =>
  api.get('/late-coming/analytics', { params: { month, year, ...params } })
export const getLateComingDeptSummary = (month, year, company) =>
  api.get('/late-coming/department-summary', { params: { month, year, ...(company ? { company } : {}) } })
export const getLateComingDailyDetail = (date, company) =>
  api.get('/late-coming/daily-detail', { params: { date, ...(company ? { company } : {}) } })
export const getLateComingEmployeeHistory = (employeeCode, months) =>
  api.get('/late-coming/employee-history', { params: { employeeCode, months } })
export const applyLateComingDeduction = (data) =>
  api.post('/late-coming/deduction', data)
export const getLateComingDeductions = (month, year, params) =>
  api.get('/late-coming/deductions', { params: { month, year, ...params } })
export const exportLateComingReport = (month, year, company) =>
  api.get('/late-coming/export', { params: { month, year, ...(company ? { company } : {}) }, responseType: 'blob' })
export const getDailyMISLateComingSummary = (date, company) =>
  api.get('/daily-mis/late-coming-summary', { params: { date, ...(company ? { company } : {}) } })
// Phase 2 — finance approval workflow
export const getFinancePendingDeductions = (month, year, company) =>
  api.get('/late-coming/finance-pending', { params: { month, year, ...(company ? { company } : {}) } })
export const reviewLateDeduction = (id, data) =>
  api.put(`/late-coming/finance-review/${id}`, data)
export const bulkReviewLateDeductions = (data) =>
  api.put('/late-coming/finance-bulk-review', data)
// Bulk shift assignment for Employee Master
export const bulkAssignShift = (employeeCodes, shiftId, shiftCode) =>
  api.put('/employees/bulk-shift', { employeeCodes, shiftId, shiftCode })

// Phase 6: Advanced analytics
export const getUserSessions = (username, days) => api.get('/session-analytics/user-sessions', { params: { username, days } })
export const getSessionReplay = (sessionId) => api.get('/session-analytics/session-replay', { params: { sessionId } })
export const getUserJourneys = (days) => api.get('/session-analytics/user-journeys', { params: { days } })
export const getTimeOnPage = (days) => api.get('/session-analytics/time-on-page', { params: { days } })
export const getFeatureMatrix = (days) => api.get('/session-analytics/feature-matrix', { params: { days } })
export const getHeatmap = (days) => api.get('/session-analytics/heatmap', { params: { days } })
export const getLiveActivity = () => api.get('/session-analytics/live-activity')
export const getClickDetails = (page, days) => api.get('/session-analytics/click-details', { params: { page, days } })
export const getUserEngagement = (days) => api.get('/session-analytics/user-engagement', { params: { days } })

// ── Daily Wage Worker Module ───────────────────────────────
export const getDWContractors = (params) => api.get('/daily-wage/contractors', { params })
export const getDWContractor = (id) => api.get(`/daily-wage/contractors/${id}`)
export const createDWContractor = (data) => api.post('/daily-wage/contractors', data)
export const updateDWContractor = (id, data) => api.put(`/daily-wage/contractors/${id}`, data)
export const deactivateDWContractor = (id) => api.put(`/daily-wage/contractors/${id}/deactivate`)
export const reactivateDWContractor = (id) => api.put(`/daily-wage/contractors/${id}/reactivate`)
export const getDWContractorSummary = (id) => api.get(`/daily-wage/contractors/${id}/summary`)
export const getDWContractorRates = (id) => api.get(`/daily-wage/contractors/${id}/rates`)
export const proposeDWRateChange = (id, data) => api.post(`/daily-wage/contractors/${id}/rates`, data)
export const approveDWRateChange = (id) => api.put(`/daily-wage/rates/${id}/approve`)
export const rejectDWRateChange = (id, remarks) => api.put(`/daily-wage/rates/${id}/reject`, { remarks })
export const getPendingDWRateChanges = () => api.get('/daily-wage/rates/pending')
export const getDWAuditLog = (params) => api.get('/daily-wage/audit', { params })
// DW Entries
export const getDWEntries = (params) => api.get('/daily-wage/entries', { params })
export const getDWEntry = (id) => api.get(`/daily-wage/entries/${id}`)
export const createDWEntry = (data) => api.post('/daily-wage/entries', data)
export const updateDWEntry = (id, data) => api.put(`/daily-wage/entries/${id}`, data)
export const batchImportDWEntries = (entries, company) => api.post('/daily-wage/entries/batch-import', { entries, company: company || '' })
export const checkDWDuplicates = (data) => api.post('/daily-wage/entries/check-duplicates', data)
export const getDWEntryTemplate = () => api.get('/daily-wage/entries/template')
// DW Submit + Finance Approval
export const submitDWEntry = (id, remarks) => api.put(`/daily-wage/entries/${id}/submit`, { remarks })
export const batchSubmitDWEntries = (entry_ids, remarks) => api.post('/daily-wage/entries/batch-submit', { entry_ids, remarks })
export const getDWFinancePending = () => api.get('/daily-wage/finance/pending')
export const approveDWEntry = (id, remarks) => api.put(`/daily-wage/entries/${id}/approve`, { remarks })
export const rejectDWEntry = (id, remarks) => api.put(`/daily-wage/entries/${id}/reject`, { remarks })
export const needsCorrectionDWEntry = (id, remarks) => api.put(`/daily-wage/entries/${id}/needs-correction`, { remarks })
export const flagDWEntry = (id, remarks) => api.put(`/daily-wage/entries/${id}/flag`, { remarks })
export const reopenDWEntry = (id, remarks) => api.put(`/daily-wage/entries/${id}/reopen`, { remarks })
export const batchApproveDWEntries = (entry_ids, remarks) => api.post('/daily-wage/entries/batch-approve', { entry_ids, remarks })
// DW Payments
export const getDWPendingLiability = () => api.get('/daily-wage/payments/pending-liability')
export const processDWPayment = (data) => api.post('/daily-wage/payments', data)
export const getDWPayments = (params) => api.get('/daily-wage/payments', { params })
export const getDWPayment = (id) => api.get(`/daily-wage/payments/${id}`)
export const getDWContractorPaymentHistory = (id) => api.get(`/daily-wage/contractors/${id}/payment-history`)
// DW Dashboard + Audit
export const getDWDashboard = () => api.get('/daily-wage/dashboard')
export const getDWAuditLogPaginated = (params) => api.get('/daily-wage/audit-log', { params })
// DW Reports
export const getDWDailyMIS = (date) => api.get('/daily-wage/reports/daily-mis', { params: { date } })
export const getDWMonthlyReport = (month, year, company) => api.get('/daily-wage/reports/monthly', { params: { month, year, ...(company ? { company } : {}) } })
export const getDWDepartmentCost = (month, year, company) => api.get('/daily-wage/reports/department-cost', { params: { month, year, ...(company ? { company } : {}) } })
export const getDWContractorReport = (id) => api.get(`/daily-wage/reports/contractor-summary/${id}`)
export const getDWPaymentSheet = (contractorId, entryIds) => api.get(`/daily-wage/reports/payment-sheet/${contractorId}`, { params: { entry_ids: entryIds.join(',') } })
export const getDWPendingLiabilities = () => api.get('/daily-wage/reports/pending-liabilities')
export const getDWSeasonalTrends = () => api.get('/daily-wage/reports/seasonal-trends')

// ── Short Leaves / Gate Passes ─────────────────────────────
export const getShortLeaves = (params) => api.get('/short-leaves', { params })
export const createShortLeave = (data) => api.post('/short-leaves', data)
export const getShortLeaveQuota = (code, params) => api.get(`/short-leaves/quota/${code}`, { params })
export const cancelShortLeave = (id, data) => api.put(`/short-leaves/${id}/cancel`, data)

// ── Early Exit Detection ──────────────────────────────────
export const detectEarlyExits = (data) => api.post('/early-exits/detect', data)
export const getEarlyExits = (params) => api.get('/early-exits', { params })
export const getEarlyExitSummary = (params) => api.get('/early-exits/summary', { params })
export const getEarlyExitEmployeeAnalytics = (code) => api.get(`/early-exits/employee/${code}/analytics`)

// ── Early Exit Deductions ─────────────────────────────────
export const submitEarlyExitDeduction = (data) => api.post('/early-exit-deductions', data)
export const getEarlyExitDeductions = (params) => api.get('/early-exit-deductions', { params })
export const getEarlyExitDeduction = (id) => api.get(`/early-exit-deductions/${id}`)
export const reviseEarlyExitDeduction = (id, data) => api.put(`/early-exit-deductions/${id}`, data)
export const cancelEarlyExitDeduction = (id) => api.delete(`/early-exit-deductions/${id}`)
export const getEarlyExitPendingFinance = (params) => api.get('/early-exit-deductions/finance/pending', { params })
export const approveEarlyExitDeduction = (id) => api.put(`/early-exit-deductions/${id}/approve`)
export const rejectEarlyExitDeduction = (id, data) => api.put(`/early-exit-deductions/${id}/reject`, data)

export default api

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
export const getImportHistory = () => api.get('/import/history')
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
export const getMonthlyAttendanceSummary = (month, year) => api.get('/attendance/monthly-summary', { params: { month, year } })
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

// ── Daily MIS ────────────────────────────────────────
export const getDailyShiftBreakdown = (date) => api.get('/daily-mis/shift-breakdown', { params: { date } })
export const getDailyWorkerBreakdown = (date) => api.get('/daily-mis/worker-breakdown', { params: { date } })
export const getPreviousDayReport = (date) => api.get('/daily-mis/previous-day-report', { params: { date } })

// ── Analytics ──────────────────────────────────────────
export const getOrgOverview = (month, year, startDate, endDate) => api.get('/analytics/overview', { params: { month, year, startDate, endDate } })
export const getHeadcountTrend = (month, year, months) => api.get('/analytics/headcount-trend', { params: { month, year, months } })
export const getAttritionData = (month, year) => api.get('/analytics/attrition', { params: { month, year } })
export const getAttrition = (month, year) => api.get('/analytics/attrition', { params: { month, year } })
export const getChronicAbsentees = (month, year, startDate, endDate) => api.get('/analytics/absentees', { params: { month, year, startDate, endDate } })
export const getAbsentees = (month, year) => api.get('/analytics/absentees', { params: { month, year } })
export const getPunctualityReport = (month, year, startDate, endDate) => api.get('/analytics/punctuality', { params: { month, year, startDate, endDate } })
export const getDepartmentStats = (month, year) => api.get('/analytics/departments', { params: { month, year } })
export const getAttendanceHeatmap = (month, year, startDate, endDate) => api.get('/analytics/heatmap', { params: { month, year, startDate, endDate } })
export const getOvertimeReport = (month, year, startDate, endDate) => api.get('/analytics/overtime', { params: { month, year, startDate, endDate } })
export const getWorkingHoursReport = (month, year, startDate, endDate) => api.get('/analytics/working-hours', { params: { month, year, startDate, endDate } })
export const getDepartmentDeepDive = (dept, month, year, startDate, endDate) => api.get(`/analytics/department/${encodeURIComponent(dept)}`, { params: { month, year, startDate, endDate } })
export const releaseHeldSalary = (code, month, year) => api.put(`/payroll/salary/${code}/hold-release`, { month, year })

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
export const getAlerts = (month, year, unread) => api.get('/analytics/alerts', { params: { month, year, ...(unread ? { unread: 'true' } : {}) } })
export const generateAlerts = (month, year) => api.post('/analytics/alerts/generate', { month, year })
export const markAlertRead = (id) => api.put(`/analytics/alerts/${id}/read`)
export const getEmployeeProfile = (code) => api.get(`/analytics/employee/${code}`)
export const getEmployeeBehavioralProfile = (code, month, year) => api.get(`/analytics/employee/${code}/profile`, { params: { month, year } })
export const getBehavioralPatterns = (month, year) => api.get('/analytics/patterns', { params: { month, year } })
export const getWorkingHoursByDept = (month, year) => api.get('/analytics/working-hours-by-dept', { params: { month, year } })
export const detectInactiveEmployees = (month, year, inactiveDays) => api.post('/analytics/detect-inactive', { month, year, inactiveDays })
export const getInactiveEmployees = () => api.get('/analytics/inactive-employees')
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

// ── Notifications ────────────────────────────────────────
export const getNotifications = (unread) => api.get('/notifications', { params: unread ? { unread: 'true' } : {} })
export const markNotificationRead = (id) => api.put(`/notifications/${id}/read`)
export const markAllNotificationsRead = () => api.put('/notifications/read-all')
export const generateNotifications = () => api.post('/notifications/generate')

// ── Employee Lifecycle ────────────────────────────────────
export const getLifecycleEvents = (code) => api.get(`/lifecycle/employee/${code}`)
export const addLifecycleEvent = (data) => api.post('/lifecycle', data)

// ── Reports ────────────────────────────────────────────
export const getAttendanceSummaryReport = (month, year, company) => api.get('/reports/attendance-summary', { params: { month, year, company } })
export const getMissPunchReport = (month, year) => api.get('/reports/miss-punch-report', { params: { month, year } })
export const getLateComingReport = (month, year) => api.get('/reports/late-coming', { params: { month, year } })
export const getOvertimeReportData = (month, year) => api.get('/reports/overtime', { params: { month, year } })
export const getPFStatement = (month, year) => api.get('/reports/pf-statement', { params: { month, year } })
export const getESIStatement = (month, year) => api.get('/reports/esi-statement', { params: { month, year } })
export const getBankTransferSheet = (month, year, company) => api.get('/reports/bank-transfer', { params: { month, year, company } })
export const getBankTransfer = (month, year, company) => api.get('/reports/bank-transfer', { params: { month, year, company } })
export const getHeadcountReport = (month, year) => api.get('/reports/headcount', { params: { month, year } })
export const getAuditTrail = (month, year) => api.get('/reports/audit-trail', { params: { month, year } })

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
export const getMonthEndChecklist = (month, year) => api.get('/payroll/month-end-checklist', { params: { month, year } })
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
export const getComplianceItems = (year) => api.get('/settings/compliance', { params: { year } })
export const updateComplianceItem = (id, data) => api.put(`/settings/compliance/${id}`, data)
export const generateComplianceCalendar = (year) => api.post(`/settings/compliance/generate/${year}`)

// ── Finance Audit ────────────────────────────────────────
export const getFinanceReport = (month, year, company) => api.get('/finance-audit/report', { params: { month, year, company } })
export const submitDayCorrection = (data) => api.post('/finance-audit/day-correction', data)
export const submitPunchCorrection = (data) => api.post('/finance-audit/punch-correction', data)
export const getCorrectionHistory = (code, month, year) => api.get(`/finance-audit/corrections/${code}`, { params: { month, year } })
export const getCorrectionsSummary = (month, year) => api.get('/finance-audit/corrections-summary', { params: { month, year } })
export const getCorrectionReasons = () => api.get('/finance-audit/reasons')

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

export default api

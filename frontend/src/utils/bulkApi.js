// P3-01 — API helpers for bulk entry (kept out of utils/api.js, which another builder owns).
import api from './api'

// Reads right after a save/undo must not get the server's 5 s GET cache.
const fresh = { headers: { 'Cache-Control': 'no-cache' } }

export const bulkPreview = (kind, data) => api.post(`/bulk/${kind}/preview`, data)
export const bulkApply = (kind, data) => api.post(`/bulk/${kind}/apply`, data)
export const getBulkBatches = (params) => api.get('/bulk/batches', { params, ...fresh })
export const getBulkBatch = (id) => api.get(`/bulk/batches/${id}`, fresh)
export const undoBulkBatch = (id, reason) => api.post(`/bulk/batches/${id}/undo`, { reason })
export const getEdEmployeesLite = () => api.get('/bulk/extra-duty/employees', fresh)
export const getEdPeopleOnDate = (date) => api.get('/bulk/extra-duty/people', { params: { date }, ...fresh })
// Existing HR bulk approve route (no helper in api.js yet) — used by the HR Queue bar (F-11).
export const hrBulkApproveGrants = (ids) => api.post('/extra-duty-grants/bulk-approve', { ids })

// P5-01 — approval stage (submit + finance decisions on batches).
export const bulkSubmit = (kind, data) => api.post(`/bulk/${kind}/submit`, data)
export const getBulkQueue = (params = {}) => api.get('/bulk/batches', { params: { approval: 1, status: 'submitted,returned,rejected,applied', sinceDays: 30, limit: 100, ...params }, ...fresh })
export const approveBulkBatch = (id) => api.post(`/bulk/batches/${id}/approve`, {})
export const rejectBulkBatch = (id, reason) => api.post(`/bulk/batches/${id}/reject`, { reason })
export const returnBulkBatch = (id, note) => api.post(`/bulk/batches/${id}/return`, { note })
// P5-04 / H1 b: default effective date for a salary revision (1st of the first open payroll month).
export const getSalaryRevisionDefaults = () => api.get('/bulk/salary-revision/defaults', fresh)

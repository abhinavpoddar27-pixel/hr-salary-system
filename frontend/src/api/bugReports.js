import api from '../utils/api'

// Thin wrappers over the /api/bug-reports endpoints. The backend gates every
// read/update/reanalyze behind `role === 'admin'`; POST / is open to any
// authenticated user.
export const submitBugReport = (formData) =>
  api.post('/bug-reports', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // The /count poller also uses the shared axios instance, so we keep the
    // submit call close to the same config shape. No timeout override here —
    // an uploaded audio can realistically take 10-30s to transit.
  })

export const getBugReports = (params = {}) =>
  api.get('/bug-reports', { params })

export const getBugReportCount = (status = 'new') =>
  api.get('/bug-reports/count', { params: { status } })

export const getBugReport = (id) =>
  api.get(`/bug-reports/${id}`)

export const updateBugReport = (id, data) =>
  api.put(`/bug-reports/${id}`, data)

export const reanalyzeBugReport = (id) =>
  api.post(`/bug-reports/${id}/reanalyze`)

// Attachments — these are streamed as files by the backend. The caller gets
// the URL and renders it inside an <img>/<audio> tag; axios isn't involved
// for the actual fetch so we can leverage browser-level caching and range
// requests for the audio player.
export const bugReportScreenshotUrl = (id, token) =>
  `/api/bug-reports/${id}/screenshot${token ? `?t=${encodeURIComponent(token)}` : ''}`

export const bugReportAudioUrl = (id, token) =>
  `/api/bug-reports/${id}/audio${token ? `?t=${encodeURIComponent(token)}` : ''}`

// Ring buffer of the last 5 API calls made by the app, used as auto-context
// for bug reports. Snapshotted when the reporter modal opens so the admin
// sees what the page was actually fetching at the moment the user hit the
// report button (not whatever scrolls past during report composition).
//
// The buffer hooks into the existing axios client via installContextBufferInterceptors.
// Heuristic redaction on URLs/params only — bodies aren't captured to avoid
// logging PII the user typed into a form.

const MAX_ENTRIES = 5

// Never record these; they're either noise or privacy-sensitive.
const EXCLUDE_PATTERNS = [
  /\/auth\/login/i,
  /\/auth\/change-password/i,
  /\/bug-reports(\/|$)/i, // don't record the reporter's own traffic
  /\/ai\/explain-salary/i, // body-heavy, not useful as context
]

const ring = []

function redactUrl(url) {
  if (!url) return url
  // Strip query values but keep keys — "?q=abhi&year=2026" → "?q=…&year=…"
  return String(url).replace(/([?&][^=]+=)[^&]*/g, '$1…')
}

function shouldExclude(url) {
  if (!url) return true
  return EXCLUDE_PATTERNS.some((re) => re.test(url))
}

export function recordApiCall({ method, url, status, durationMs }) {
  if (shouldExclude(url)) return
  const entry = {
    at: new Date().toISOString(),
    method: (method || 'GET').toUpperCase(),
    url: redactUrl(url),
    status: status ?? null,
    duration_ms: durationMs ?? null,
  }
  ring.push(entry)
  if (ring.length > MAX_ENTRIES) ring.shift()
}

// Returns a shallow copy so the caller can freely mutate/serialize.
export function snapshotApiCalls() {
  return ring.slice()
}

export function clearApiCallBuffer() {
  ring.length = 0
}

// Attach request-start/response-finish hooks to the shared axios instance.
// Called once from utils/api.js so every call flows through.
export function installContextBufferInterceptors(axiosInstance) {
  axiosInstance.interceptors.request.use((config) => {
    // eslint-disable-next-line no-param-reassign
    config.__ctxStart = Date.now()
    return config
  })
  axiosInstance.interceptors.response.use(
    (res) => {
      try {
        const start = res.config?.__ctxStart
        recordApiCall({
          method: res.config?.method,
          url: res.config?.url,
          status: res.status,
          durationMs: start ? Date.now() - start : null,
        })
      } catch (_e) { /* never let context tracking break a request */ }
      return res
    },
    (err) => {
      try {
        const start = err.config?.__ctxStart
        recordApiCall({
          method: err.config?.method,
          url: err.config?.url,
          status: err.response?.status ?? 0,
          durationMs: start ? Date.now() - start : null,
        })
      } catch (_e) { /* swallow */ }
      return Promise.reject(err)
    }
  )
}

// Build the full auto-context object embedded in the POST body. Separated so
// BugReportModal can preview it before submit without reaching into internals.
export function buildAutoContext() {
  return {
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    user_agent: navigator.userAgent,
    page_url: window.location.href,
    path: window.location.pathname,
    recent_api_calls: snapshotApiCalls(),
  }
}

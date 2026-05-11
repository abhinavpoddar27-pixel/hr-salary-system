import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import * as Sentry from '@sentry/react'
import { browserTracingIntegration, replayIntegration } from '@sentry/react'
import App from './App'
import './index.css'

// PII fields to scrub from HR data
const SCRUB_FIELDS = [
  'salary', 'basic', 'hra', 'da', 'pf', 'esi', 'pt', 'tds', 'net_pay',
  'gross', 'deduction', 'pan', 'pan_number', 'uan', 'uan_number',
  'aadhaar', 'aadhar', 'bank_account', 'account_number', 'ifsc',
  'biometric', 'password', 'token',
]

function scrubSensitive(obj) {
  if (!obj || typeof obj !== 'object') return obj
  const out = Array.isArray(obj) ? [] : {}
  for (const [k, v] of Object.entries(obj)) {
    if (SCRUB_FIELDS.some(f => k.toLowerCase().includes(f))) {
      out[k] = '[Filtered]'
    } else if (typeof v === 'object') {
      out[k] = scrubSensitive(v)
    } else {
      out[k] = v
    }
  }
  return out
}

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'development',
  release: import.meta.env.VITE_SENTRY_RELEASE,
  tracesSampleRate: parseFloat(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || '0.2'),
  integrations: [
    browserTracingIntegration(),
    replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  beforeSend(event) {
    if (event.request && event.request.data) {
      try {
        const parsed = typeof event.request.data === 'string'
          ? JSON.parse(event.request.data)
          : event.request.data
        event.request.data = scrubSensitive(parsed)
      } catch (_) {}
    }
    if (event.extra) {
      event.extra = scrubSensitive(event.extra)
    }
    return event
  },
})

// Dev-only: trigger a test error to confirm Sentry is wired up
if (import.meta.env.DEV) {
  window.__triggerSentryTest = () => {
    throw new Error('[Sentry test] HR Salary frontend — manual trigger')
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30000
    }
  }
})

const SentryErrorBoundary = Sentry.ErrorBoundary

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SentryErrorBoundary fallback={<div style={{padding:'2rem',color:'red'}}>Something went wrong. Our team has been notified.</div>}>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: { fontSize: '14px', maxWidth: '400px' }
          }}
        />
      </QueryClientProvider>
    </SentryErrorBoundary>
  </React.StrictMode>
)

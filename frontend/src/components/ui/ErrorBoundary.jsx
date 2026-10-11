import React from 'react'
import * as Sentry from '@sentry/react'
import { useAppStore } from '../../store/appStore'

/**
 * ErrorBoundary — catches React render errors on a page and shows a plain
 * recovery screen instead of a blank white one.
 *
 * P2-09:
 *  - every caught error is sent to Sentry (captureException) — the outer
 *    Sentry.ErrorBoundary in main.jsx never sees errors caught here;
 *  - the message is plain words with the page name (read from the Header
 *    <h1>, which sits outside this boundary and stays on screen);
 *  - "Report bug" opens the existing bug reporter;
 *  - the raw error and the Sentry reference id are behind "Show details";
 *  - the error clears when the user navigates to another page.
 */

function currentPath() {
  try { return window.location.pathname } catch (_) { return '' }
}

function readPageName() {
  try {
    const h1 = document.querySelector('header h1')
    const text = (h1?.textContent || '').trim()
    return text || 'this page'
  } catch (_) {
    return 'this page'
  }
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, eventId: null, errorPath: null, showDetails: false }
    this.reset = this.reset.bind(this)
    this.openBugReport = this.openBugReport.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error, eventId: null, errorPath: currentPath(), showDetails: false }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
    let eventId = null
    try {
      eventId = Sentry.captureException(error, {
        tags: { boundary: 'page', page: currentPath() },
        contexts: { react: { componentStack: errorInfo?.componentStack || '' } },
      }) || null
    } catch (_) {
      // Reporting must never break the recovery screen.
    }
    if (eventId) this.setState({ eventId })
  }

  componentDidUpdate() {
    // Navigating to another page (sidebar link) clears the error.
    if (this.state.hasError && this.state.errorPath !== null && currentPath() !== this.state.errorPath) {
      this.reset()
    }
  }

  reset() {
    this.setState({ hasError: false, error: null, eventId: null, errorPath: null, showDetails: false })
  }

  openBugReport() {
    try { useAppStore.getState().openBugReportModal() } catch (_) {}
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const pageName = readPageName()
    const { error, eventId, showDetails } = this.state
    return (
      <div className="flex items-center justify-center min-h-[200px] p-4 md:p-6" data-testid="error-boundary">
        <div className="text-center max-w-md w-full">
          <div className="text-4xl mb-3">⚠️</div>
          <h3 className="text-lg font-bold text-slate-800 mb-2" data-testid="error-boundary-title">
            Something went wrong on {pageName}.
          </h3>
          <p className="text-sm text-slate-500 mb-4">
            Nothing was saved by this error. Try again, reload the page, or report it so it can be fixed.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              onClick={this.reset}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
            >
              Reload page
            </button>
            <button
              onClick={this.openBugReport}
              data-testid="error-boundary-report"
              className="px-4 py-2 bg-amber-100 text-amber-800 rounded-lg text-sm font-medium hover:bg-amber-200 transition-colors"
            >
              Report bug
            </button>
          </div>
          <button
            onClick={() => this.setState(s => ({ showDetails: !s.showDetails }))}
            data-testid="error-boundary-details-toggle"
            className="mt-4 text-xs text-slate-500 underline hover:text-slate-700"
          >
            {showDetails ? 'Hide details' : 'Show details'}
          </button>
          {showDetails && (
            <div
              data-testid="error-boundary-details"
              className="mt-2 text-left text-xs font-mono bg-slate-100 text-slate-700 rounded-lg p-3 break-words"
            >
              <div>{error?.message || String(error || 'Unknown error')}</div>
              {eventId && <div className="mt-1 text-slate-500">Reference: {eventId}</div>}
            </div>
          )}
        </div>
      </div>
    )
  }
}

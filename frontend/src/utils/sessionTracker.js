/**
 * SessionTracker — Non-blocking client-side event tracking
 *
 * Architecturally isolated from the React app:
 * - Standalone class, not a React component
 * - All methods wrapped in try/catch — tracking errors never affect the app
 * - Events buffered in memory, flushed every 30s or 20 events
 * - Uses navigator.sendBeacon on page unload for reliability
 * - Only active when user is authenticated
 */

import api from './api'

const FLUSH_INTERVAL_MS = 30000  // 30 seconds
const FLUSH_BATCH_SIZE = 20      // flush when buffer reaches this size
const MAX_BUFFER_SIZE = 500      // drop oldest events if buffer exceeds this
const IDLE_TIMEOUT_MS = 120000   // 2 minutes

class SessionTracker {
  constructor() {
    this.buffer = []
    this.sessionId = this._generateSessionId()
    this.currentPage = null
    this.pageEnteredAt = null
    this.flushTimer = null
    this.idleTimer = null
    this.isIdle = false
    this.isInitialized = false
  }

  /**
   * Initialize tracking. Call once after user is authenticated.
   */
  init() {
    if (this.isInitialized) return
    try {
      this.isInitialized = true
      this._track('session_start', { page: window.location.pathname })

      // Periodic flush
      this.flushTimer = setInterval(() => this._flush(), FLUSH_INTERVAL_MS)

      // Page visibility change (tab switch)
      document.addEventListener('visibilitychange', this._onVisibilityChange)

      // Before unload — flush remaining events
      window.addEventListener('beforeunload', this._onBeforeUnload)

      // Idle detection
      this._resetIdleTimer()
      document.addEventListener('mousemove', this._onActivity, { passive: true })
      document.addEventListener('keydown', this._onActivity, { passive: true })
      document.addEventListener('click', this._onClick, { passive: true })

      // Global error handler
      window.addEventListener('error', this._onError)
    } catch (e) {
      // Silent failure — tracking must never break the app
    }
  }

  /**
   * Stop tracking and flush remaining events.
   */
  destroy() {
    try {
      if (!this.isInitialized) return
      this._track('session_end', { page: this.currentPage })
      this._flush()
      clearInterval(this.flushTimer)
      clearTimeout(this.idleTimer)
      document.removeEventListener('visibilitychange', this._onVisibilityChange)
      window.removeEventListener('beforeunload', this._onBeforeUnload)
      document.removeEventListener('mousemove', this._onActivity)
      document.removeEventListener('keydown', this._onActivity)
      document.removeEventListener('click', this._onClick)
      window.removeEventListener('error', this._onError)
      this.isInitialized = false
    } catch (e) { /* silent */ }
  }

  /**
   * Track a page navigation.
   */
  trackPageView(path) {
    try {
      // Record exit from previous page
      if (this.currentPage && this.pageEnteredAt) {
        const duration = Date.now() - this.pageEnteredAt
        this._track('page_exit', { page: this.currentPage, durationMs: duration })
      }
      this.currentPage = path
      this.pageEnteredAt = Date.now()
      this._track('page_view', { page: path })
    } catch (e) { /* silent */ }
  }

  /**
   * Track a feature usage (export, compute, import, etc.)
   */
  trackFeature(feature, page) {
    try {
      this._track('feature_use', { page: page || this.currentPage, label: feature })
    } catch (e) { /* silent */ }
  }

  // ── Internal methods ──────────────────────────────────

  _track(type, data = {}) {
    try {
      this.buffer.push({
        type,
        sessionId: this.sessionId,
        page: data.page || this.currentPage,
        elementId: data.elementId || null,
        elementType: data.elementType || null,
        label: data.label || null,
        data: data.extra || null,
        timestamp: new Date().toISOString()
      })

      // Cap buffer size
      if (this.buffer.length > MAX_BUFFER_SIZE) {
        this.buffer = this.buffer.slice(-MAX_BUFFER_SIZE)
      }

      // Auto-flush at batch size
      if (this.buffer.length >= FLUSH_BATCH_SIZE) {
        this._flush()
      }
    } catch (e) { /* silent */ }
  }

  async _flush() {
    try {
      if (this.buffer.length === 0) return
      const events = [...this.buffer]
      this.buffer = []
      await api.post('/session-analytics/events', { events }).catch(() => {
        // On failure, put events back (up to max)
        this.buffer = [...events, ...this.buffer].slice(-MAX_BUFFER_SIZE)
      })
    } catch (e) { /* silent */ }
  }

  _onClick = (e) => {
    try {
      const el = e.target?.closest('button, a, [data-track], tr[class*="cursor"], select, input[type="submit"]')
      if (!el) return
      const trackId = el.getAttribute('data-track')
      const label = trackId || el.textContent?.trim().slice(0, 50) || el.tagName
      const type = el.tagName.toLowerCase()
      this._track('click', {
        elementId: trackId || el.id || null,
        elementType: type,
        label
      })
      this._resetIdleTimer()
    } catch (e) { /* silent */ }
  }

  _onActivity = () => {
    try {
      if (this.isIdle) {
        this.isIdle = false
        this._track('idle_end', { page: this.currentPage })
      }
      this._resetIdleTimer()
    } catch (e) { /* silent */ }
  }

  _resetIdleTimer() {
    try {
      clearTimeout(this.idleTimer)
      this.idleTimer = setTimeout(() => {
        this.isIdle = true
        this._track('idle_start', { page: this.currentPage })
      }, IDLE_TIMEOUT_MS)
    } catch (e) { /* silent */ }
  }

  _onVisibilityChange = () => {
    try {
      if (document.hidden) {
        this._track('tab_hidden', { page: this.currentPage })
        this._flush()
      } else {
        this._track('tab_visible', { page: this.currentPage })
      }
    } catch (e) { /* silent */ }
  }

  _onBeforeUnload = () => {
    try {
      this._track('session_end', { page: this.currentPage })
      // Use sendBeacon for reliable delivery on unload
      if (this.buffer.length > 0 && navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify({ events: this.buffer })], { type: 'application/json' })
        navigator.sendBeacon('/api/session-analytics/events', blob)
        this.buffer = []
      }
    } catch (e) { /* silent */ }
  }

  _onError = (event) => {
    try {
      this._track('error', {
        label: event.message || 'Unknown error',
        extra: { filename: event.filename, lineno: event.lineno, colno: event.colno }
      })
    } catch (e) { /* silent */ }
  }

  _generateSessionId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }
}

// Singleton instance
export const tracker = new SessionTracker()
export default tracker

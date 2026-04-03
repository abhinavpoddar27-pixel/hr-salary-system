import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const now = new Date()

// Rehydrate auth from localStorage on startup
const storedUser = (() => { try { return JSON.parse(localStorage.getItem('hr_user')) } catch { return null } })()
const storedToken = localStorage.getItem('hr_token') || null

export const useAppStore = create(
  persist(
    (set, get) => ({
      // ── Auth ────────────────────────────────────────────────
      user: storedUser,
      token: storedToken,
      isAuthenticated: !!(storedToken && storedUser),
      setAuth: (user, token) => {
        localStorage.setItem('hr_token', token)
        localStorage.setItem('hr_user', JSON.stringify(user))
        // Auto-set company if user has only one allowed company
        const ac = user.allowedCompanies || ['*']
        const autoCompany = (ac.length === 1 && ac[0] !== '*') ? ac[0] : ''
        set({ user, token, isAuthenticated: true, selectedCompany: autoCompany })
      },
      clearAuth: () => {
        localStorage.removeItem('hr_token')
        localStorage.removeItem('hr_user')
        set({ user: null, token: null, isAuthenticated: false })
      },

      // ── Month selector ──────────────────────────────────────
      selectedMonth: now.getMonth() + 1,
      selectedYear: now.getFullYear(),
      setSelectedMonth: (month) => set({ selectedMonth: month }),
      setSelectedYear: (year) => set({ selectedYear: year }),
      setMonthYear: (month, year) => set({ selectedMonth: month, selectedYear: year }),

      // ── Date range (for reports) ────────────────────────────
      dateRangeMode: 'month', // 'month' | 'custom'
      dateRangeStart: '',
      dateRangeEnd: '',
      setDateRangeMode: (mode) => set({ dateRangeMode: mode }),
      setDateRange: (start, end) => set({ dateRangeStart: start, dateRangeEnd: end }),

      // ── Company filter ──────────────────────────────────────
      selectedCompany: '',
      setSelectedCompany: (company) => set({ selectedCompany: company }),

      // ── Pipeline stage ──────────────────────────────────────
      currentStage: 1,
      stageStatus: { 1: 'active', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'pending', 6: 'pending', 7: 'pending' },
      setStageComplete: (stage) => set(state => ({
        currentStage: stage + 1,
        stageStatus: {
          ...state.stageStatus,
          [stage]: 'done',
          [stage + 1]: 'active'
        }
      })),

      // ── UI state ────────────────────────────────────────────
      sidebarCollapsed: typeof window !== 'undefined' && window.innerWidth < 768,
      toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      // ── Alert count ─────────────────────────────────────────
      alertCount: 0,
      setAlertCount: (count) => set({ alertCount: count }),

      // ── Import history (for quick access) ───────────────────
      lastImport: null,
      setLastImport: (imp) => set({ lastImport: imp }),
    }),
    {
      name: 'hr-system-store',
      partialize: (state) => ({
        selectedMonth: state.selectedMonth,
        selectedYear: state.selectedYear,
        sidebarCollapsed: state.sidebarCollapsed,
        selectedCompany: state.selectedCompany,
        dateRangeMode: state.dateRangeMode,
        dateRangeStart: state.dateRangeStart,
        dateRangeEnd: state.dateRangeEnd
        // Note: auth is handled via localStorage directly (token + user), not via persist
      })
    }
  )
)

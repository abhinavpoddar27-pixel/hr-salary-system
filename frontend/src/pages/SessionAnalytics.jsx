import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import { getSessionOverview, getSessionUsers, getSessionPages, getSessionErrors } from '../utils/api'
import { useAppStore } from '../store/appStore'
import ErrorBoundary from '../components/ui/ErrorBoundary'
import clsx from 'clsx'

const PERIOD_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
]

function KPI({ label, value, sub, color = 'blue' }) {
  const colors = { blue: 'text-blue-700', green: 'text-green-700', red: 'text-red-700', amber: 'text-amber-700', purple: 'text-purple-700' }
  return (
    <div className="card p-4">
      <div className={clsx('text-2xl font-bold', colors[color])}>{value}</div>
      <div className="text-[10px] text-slate-400 uppercase font-medium">{label}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════
function OverviewTab({ days }) {
  const { data: res, isLoading } = useQuery({
    queryKey: ['session-overview', days],
    queryFn: () => getSessionOverview(days),
    retry: 0
  })
  const data = res?.data?.data || {}

  const hourData = (data.peakHours || []).map(h => ({
    hour: `${String(h.hour).padStart(2, '0')}:00`,
    events: h.events
  }))

  return (
    <div className="space-y-5">
      {isLoading && <div className="text-center py-8 text-slate-400">Loading session data...</div>}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KPI label="Total Sessions" value={data.totalSessions || 0} color="blue" />
        <KPI label="Unique Users" value={data.uniqueUsers || 0} color="green" />
        <KPI label="Total Events" value={(data.totalEvents || 0).toLocaleString()} color="purple" />
        <KPI label="Errors" value={data.errorCount || 0} color={data.errorCount > 0 ? 'red' : 'green'} />
        <KPI label="Top Page" value={data.topPages?.[0]?.page?.replace(/\//g, ' / ').trim() || '—'} sub={`${data.topPages?.[0]?.views || 0} views`} color="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Top Pages */}
        {(data.topPages || []).length > 0 && (
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-slate-700">Most Visited Pages</h3></div>
            <div className="p-4">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={(data.topPages || []).slice(0, 10).map(p => ({
                  name: p.page?.split('/').pop() || p.page,
                  views: p.views, users: p.unique_users
                }))} margin={{ bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" angle={-30} textAnchor="end" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} /><Tooltip />
                  <Bar dataKey="views" name="Views" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Peak Hours */}
        {hourData.length > 0 && (
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-slate-700">Activity by Hour</h3></div>
            <div className="p-4">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={hourData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} /><Tooltip />
                  <Bar dataKey="events" name="Events" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Daily Trend */}
      {(data.dailyTrend || []).length > 2 && (
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-slate-700">Daily Activity Trend</h3></div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={data.dailyTrend.map(d => ({
                date: d.date?.slice(5),
                events: d.events, users: d.users, sessions: d.sessions
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} /><Tooltip />
                <Line type="monotone" dataKey="events" name="Events" stroke="#3b82f6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="sessions" name="Sessions" stroke="#22c55e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Feature Usage */}
      {(data.features || []).length > 0 && (
        <div className="card overflow-hidden">
          <div className="card-header"><h3 className="font-semibold text-slate-700">Feature Usage</h3></div>
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead><tr><th>Feature</th><th className="text-center">Uses</th><th className="text-center">Unique Users</th></tr></thead>
              <tbody>
                {data.features.map((f, i) => (
                  <tr key={i}><td className="font-medium text-slate-700">{f.label}</td><td className="text-center">{f.uses}</td><td className="text-center">{f.unique_users}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(data.totalEvents || 0) === 0 && !isLoading && (
        <div className="text-center py-12 text-slate-400">
          <div className="text-4xl mb-2">📊</div>
          <p>No session data yet. Data will appear as users interact with the app.</p>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// USERS TAB
// ═══════════════════════════════════════════════════════════
function UsersTab({ days }) {
  const { data: res, isLoading } = useQuery({
    queryKey: ['session-users', days],
    queryFn: () => getSessionUsers(days),
    retry: 0
  })
  const users = res?.data?.data || []

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table-compact w-full">
          <thead><tr>
            <th>User</th><th className="text-center">Sessions</th><th className="text-center">Events</th>
            <th className="text-center">Pages</th><th className="text-center">Active Days</th>
            <th className="text-center">Errors</th><th>Last Seen</th><th>Top Pages</th>
          </tr></thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="text-center py-8 text-slate-400">Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8 text-slate-400">No user activity data</td></tr>
            ) : users.map((u, i) => (
              <tr key={i}>
                <td className="font-semibold text-slate-800">{u.username}</td>
                <td className="text-center">{u.sessions}</td>
                <td className="text-center">{u.total_events}</td>
                <td className="text-center">{u.unique_pages}</td>
                <td className="text-center">{u.active_days}</td>
                <td className="text-center">{u.errors > 0 ? <span className="text-red-600 font-bold">{u.errors}</span> : 0}</td>
                <td className="text-xs text-slate-400">{u.last_seen?.slice(0, 16)?.replace('T', ' ')}</td>
                <td className="text-xs text-slate-500">{(u.topPages || []).map(p => p.page?.split('/').pop()).filter(Boolean).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// PAGES TAB
// ═══════════════════════════════════════════════════════════
function PagesTab({ days }) {
  const { data: res, isLoading } = useQuery({
    queryKey: ['session-pages', days],
    queryFn: () => getSessionPages(days),
    retry: 0
  })
  const pages = res?.data?.data || []

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table-compact w-full">
          <thead><tr>
            <th>Page</th><th className="text-center">Views</th><th className="text-center">Unique Users</th>
            <th className="text-center">Sessions</th><th>Top Interactions</th>
          </tr></thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="text-center py-8 text-slate-400">Loading...</td></tr>
            ) : pages.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-slate-400">No page data</td></tr>
            ) : pages.map((p, i) => (
              <tr key={i}>
                <td className="font-medium text-slate-800">{p.page}</td>
                <td className="text-center font-bold">{p.total_views}</td>
                <td className="text-center">{p.unique_users}</td>
                <td className="text-center">{p.unique_sessions}</td>
                <td className="text-xs text-slate-500">{(p.topClicks || []).slice(0, 3).map(c => `${c.label} (${c.clicks})`).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// ERRORS TAB
// ═══════════════════════════════════════════════════════════
function ErrorsTab({ days }) {
  const { data: res, isLoading } = useQuery({
    queryKey: ['session-errors', days],
    queryFn: () => getSessionErrors(days),
    retry: 0
  })
  const errors = res?.data?.data || []

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table-compact w-full">
          <thead><tr><th>Time</th><th>User</th><th>Page</th><th>Error</th></tr></thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={4} className="text-center py-8 text-slate-400">Loading...</td></tr>
            ) : errors.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-8 text-green-500">No errors recorded</td></tr>
            ) : errors.map((e, i) => (
              <tr key={i}>
                <td className="text-xs text-slate-400 whitespace-nowrap">{e.timestamp?.slice(0, 16)?.replace('T', ' ')}</td>
                <td className="text-sm">{e.username}</td>
                <td className="text-sm text-slate-600">{e.page}</td>
                <td className="text-xs text-red-600 max-w-xs truncate">{e.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
export default function SessionAnalytics() {
  const { user } = useAppStore()
  const [activeTab, setActiveTab] = useState('overview')
  const [days, setDays] = useState(30)

  // Admin-only check
  if (user?.role !== 'admin') {
    return (
      <div className="p-6 text-center py-20">
        <div className="text-4xl mb-3">🔒</div>
        <h2 className="text-lg font-semibold text-slate-700">Admin Access Required</h2>
        <p className="text-sm text-slate-400 mt-1">Session analytics is only available to administrators.</p>
      </div>
    )
  }

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'User Activity' },
    { id: 'pages', label: 'Page Analytics' },
    { id: 'errors', label: 'Errors' },
  ]

  return (
    <ErrorBoundary>
      <div className="p-6 space-y-5 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="section-title">Session Analytics</h2>
            <p className="section-subtitle mt-1">How users interact with the app — admin only</p>
          </div>
          <select value={days} onChange={e => setDays(parseInt(e.target.value))}
            className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            {PERIOD_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        <div className="border-b border-slate-200 flex gap-0">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={clsx('px-5 py-2.5 text-sm font-medium border-b-2 transition-colors',
                activeTab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700')}>
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && <OverviewTab days={days} />}
        {activeTab === 'users' && <UsersTab days={days} />}
        {activeTab === 'pages' && <PagesTab days={days} />}
        {activeTab === 'errors' && <ErrorsTab days={days} />}
      </div>
    </ErrorBoundary>
  )
}

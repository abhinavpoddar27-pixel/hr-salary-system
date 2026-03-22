import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import {
  getSessionOverview, getSessionUsers, getSessionPages, getSessionErrors,
  getUserSessions, getSessionReplay, getUserJourneys, getTimeOnPage,
  getFeatureMatrix, getHeatmap, getLiveActivity, getClickDetails, getUserEngagement
} from '../utils/api'
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

// Helper: format seconds to human-readable
function fmtDuration(sec) {
  if (sec < 60) return `${Math.round(sec)}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

// Helper: format ms offset to mm:ss
function fmtOffset(ms) {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `+${m}:${String(s).padStart(2, '0')}`
}

const EVENT_COLORS = {
  page_view: { dot: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700', label: 'View' },
  page_exit: { dot: 'bg-slate-400', badge: 'bg-slate-100 text-slate-600', label: 'Exit' },
  click: { dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700', label: 'Click' },
  feature_use: { dot: 'bg-purple-500', badge: 'bg-purple-100 text-purple-700', label: 'Feature' },
  error: { dot: 'bg-red-500', badge: 'bg-red-100 text-red-700', label: 'Error' },
  idle_start: { dot: 'bg-slate-300', badge: 'bg-slate-50 text-slate-500', label: 'Idle' },
  idle_end: { dot: 'bg-slate-400', badge: 'bg-slate-100 text-slate-500', label: 'Active' },
  search: { dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700', label: 'Search' },
  export: { dot: 'bg-indigo-500', badge: 'bg-indigo-100 text-indigo-700', label: 'Export' },
}

// ═══════════════════════════════════════════════════════════
// OVERVIEW TAB (original — unchanged)
// ═══════════════════════════════════════════════════════════
function OverviewTab({ days }) {
  const { data: res, isLoading } = useQuery({
    queryKey: ['session-overview', days],
    queryFn: () => getSessionOverview(days),
    retry: 0
  })
  const data = res?.data?.data || {}

  const { data: engRes } = useQuery({
    queryKey: ['user-engagement', days],
    queryFn: () => getUserEngagement(days),
    retry: 0
  })
  const engagements = engRes?.data?.data || []

  const { data: liveRes } = useQuery({
    queryKey: ['live-activity'],
    queryFn: getLiveActivity,
    refetchInterval: 30000,
    retry: 0
  })
  const liveCount = liveRes?.data?.data?.length || 0

  const hourData = (data.peakHours || []).map(h => ({
    hour: `${String(h.hour).padStart(2, '0')}:00`,
    events: h.events
  }))

  return (
    <div className="space-y-5">
      {isLoading && <div className="text-center py-8 text-slate-400">Loading session data...</div>}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <KPI label="Total Sessions" value={data.totalSessions || 0} color="blue" />
        <KPI label="Unique Users" value={data.uniqueUsers || 0} color="green" />
        <KPI label="Total Events" value={(data.totalEvents || 0).toLocaleString()} color="purple" />
        <KPI label="Errors" value={data.errorCount || 0} color={data.errorCount > 0 ? 'red' : 'green'} />
        <KPI label="Top Page" value={data.topPages?.[0]?.page?.replace(/\//g, ' / ').trim() || '—'} sub={`${data.topPages?.[0]?.views || 0} views`} color="amber" />
        <div className="card p-4">
          <div className="flex items-center gap-2">
            {liveCount > 0 && <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />}
            <div className="text-2xl font-bold text-green-700">{liveCount}</div>
          </div>
          <div className="text-[10px] text-slate-400 uppercase font-medium">Active Now</div>
        </div>
      </div>

      {/* Engagement Score Cards */}
      {engagements.length > 0 && (
        <div className="card overflow-hidden">
          <div className="card-header"><h3 className="font-semibold text-slate-700">User Engagement Scores</h3></div>
          <div className="p-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
            {engagements.slice(0, 4).map(e => (
              <div key={e.username} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                <div className={clsx('w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white', {
                  'bg-green-500': e.score >= 70, 'bg-amber-500': e.score >= 40 && e.score < 70, 'bg-red-500': e.score < 40
                })}>{e.score}</div>
                <div>
                  <div className="text-sm font-semibold text-slate-700">{e.username}</div>
                  <div className="text-[10px] text-slate-400">F:{e.frequency_score} R:{e.recency_score} B:{e.breadth_score} D:{e.depth_score}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
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

      {(data.dailyTrend || []).length > 2 && (
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-slate-700">Daily Activity Trend</h3></div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={data.dailyTrend.map(d => ({
                date: d.date?.slice(5), events: d.events, users: d.users, sessions: d.sessions
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
// USERS TAB (enhanced with engagement scores)
// ═══════════════════════════════════════════════════════════
function UsersTab({ days, onSelectUser }) {
  const { data: res, isLoading } = useQuery({
    queryKey: ['session-users', days],
    queryFn: () => getSessionUsers(days),
    retry: 0
  })
  const users = res?.data?.data || []

  const { data: engRes } = useQuery({
    queryKey: ['user-engagement', days],
    queryFn: () => getUserEngagement(days),
    retry: 0
  })
  const engMap = {}
  for (const e of engRes?.data?.data || []) engMap[e.username] = e

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table-compact w-full">
          <thead><tr>
            <th>User</th><th className="text-center">Score</th><th className="text-center">Sessions</th><th className="text-center">Events</th>
            <th className="text-center">Pages</th><th className="text-center">Active Days</th>
            <th className="text-center">Errors</th><th>Last Seen</th><th>Top Pages</th>
          </tr></thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={9} className="text-center py-8 text-slate-400">Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-8 text-slate-400">No user activity data</td></tr>
            ) : users.map((u, i) => {
              const eng = engMap[u.username]
              return (
                <tr key={i} className="cursor-pointer hover:bg-blue-50/60 transition-colors" onClick={() => onSelectUser?.(u.username)}>
                  <td className="font-semibold text-slate-800">{u.username}</td>
                  <td className="text-center">
                    {eng ? (
                      <span className={clsx('inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold text-white', {
                        'bg-green-500': eng.score >= 70, 'bg-amber-500': eng.score >= 40 && eng.score < 70, 'bg-red-500': eng.score < 40
                      })}>{eng.score}</span>
                    ) : '—'}
                  </td>
                  <td className="text-center">{u.sessions}</td>
                  <td className="text-center">{u.total_events}</td>
                  <td className="text-center">{u.unique_pages}</td>
                  <td className="text-center">{u.active_days}</td>
                  <td className="text-center">{u.errors > 0 ? <span className="text-red-600 font-bold">{u.errors}</span> : 0}</td>
                  <td className="text-xs text-slate-400">{u.last_seen?.slice(0, 16)?.replace('T', ' ')}</td>
                  <td className="text-xs text-slate-500">{(u.topPages || []).map(p => p.page?.split('/').pop()).filter(Boolean).join(', ')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {users.length > 0 && <div className="p-3 text-xs text-slate-400 text-center">Click a user to view their session replay</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// SESSION REPLAY TAB
// ═══════════════════════════════════════════════════════════
function ReplayTab({ days, initialUser }) {
  const [selectedUser, setSelectedUser] = useState(initialUser || '')
  const [selectedSession, setSelectedSession] = useState(null)
  const [typeFilter, setTypeFilter] = useState({ page_view: true, click: true, feature_use: true, error: true, idle_start: true, idle_end: true, page_exit: false, search: true, export: true })

  // Users list for dropdown
  const { data: usersRes } = useQuery({
    queryKey: ['session-users', days],
    queryFn: () => getSessionUsers(days),
    retry: 0
  })
  const usernames = (usersRes?.data?.data || []).map(u => u.username)

  // Sessions for selected user
  const { data: sessionsRes, isLoading: sessionsLoading } = useQuery({
    queryKey: ['user-sessions', selectedUser, days],
    queryFn: () => getUserSessions(selectedUser, days),
    enabled: !!selectedUser,
    retry: 0
  })
  const sessions = sessionsRes?.data?.data || []

  // Event stream for selected session
  const { data: replayRes, isLoading: replayLoading } = useQuery({
    queryKey: ['session-replay', selectedSession],
    queryFn: () => getSessionReplay(selectedSession),
    enabled: !!selectedSession,
    retry: 0
  })
  const replayData = replayRes?.data?.data || { events: [] }

  const filteredEvents = useMemo(() =>
    replayData.events.filter(e => typeFilter[e.event_type] !== false),
    [replayData.events, typeFilter]
  )

  return (
    <div className="space-y-4">
      {/* User picker + type filters */}
      <div className="card p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Select User</label>
            <select className="input text-sm w-48" value={selectedUser}
              onChange={e => { setSelectedUser(e.target.value); setSelectedSession(null) }}>
              <option value="">Choose user...</option>
              {usernames.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="flex gap-2 flex-wrap items-end">
            {Object.entries(EVENT_COLORS).filter(([k]) => k !== 'page_exit').map(([type, c]) => (
              <label key={type} className={clsx('flex items-center gap-1 px-2 py-1 rounded-lg text-xs cursor-pointer transition-all border', {
                [c.badge + ' border-transparent']: typeFilter[type],
                'bg-slate-50 text-slate-400 border-slate-200': !typeFilter[type]
              })}>
                <input type="checkbox" className="sr-only"
                  checked={typeFilter[type] !== false}
                  onChange={() => setTypeFilter(f => ({ ...f, [type]: !f[type] }))} />
                {c.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Sessions list */}
      {selectedUser && !selectedSession && (
        <div className="card overflow-hidden">
          <div className="card-header"><h3 className="font-semibold text-slate-700">Sessions for {selectedUser}</h3></div>
          {sessionsLoading ? (
            <div className="p-6 text-center text-slate-400">Loading sessions...</div>
          ) : sessions.length === 0 ? (
            <div className="p-6 text-center text-slate-400">No sessions found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-compact w-full">
                <thead><tr><th>Start</th><th className="text-center">Duration</th><th className="text-center">Events</th><th className="text-center">Pages</th><th className="text-center">Clicks</th><th className="text-center">Errors</th><th>Pages Visited</th></tr></thead>
                <tbody>
                  {sessions.map(s => (
                    <tr key={s.session_id} className="cursor-pointer hover:bg-blue-50/60 transition-colors" onClick={() => setSelectedSession(s.session_id)}>
                      <td className="text-sm text-slate-700 whitespace-nowrap">{s.start_time?.slice(0, 16)?.replace('T', ' ')}</td>
                      <td className="text-center text-sm">{s.duration_minutes}m</td>
                      <td className="text-center font-bold text-slate-700">{s.event_count}</td>
                      <td className="text-center">{s.pages_visited}</td>
                      <td className="text-center">{s.clicks}</td>
                      <td className="text-center">{s.errors > 0 ? <span className="text-red-600 font-bold">{s.errors}</span> : 0}</td>
                      <td className="text-xs text-slate-500">{(s.pages || []).slice(0, 4).map(p => p.split('/').pop()).join(' → ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Event timeline */}
      {selectedSession && (
        <div className="card overflow-hidden">
          <div className="card-header flex items-center justify-between">
            <h3 className="font-semibold text-slate-700">Session Timeline — {filteredEvents.length} events</h3>
            <button onClick={() => setSelectedSession(null)} className="text-xs text-blue-600 hover:text-blue-800">← Back to sessions</button>
          </div>
          {replayLoading ? (
            <div className="p-6 text-center text-slate-400">Loading timeline...</div>
          ) : (
            <div className="p-4 max-h-[600px] overflow-y-auto">
              <div className="relative pl-8">
                {/* Timeline spine */}
                <div className="absolute left-3 top-0 bottom-0 w-px bg-slate-200" />
                {filteredEvents.map((evt, i) => {
                  const ec = EVENT_COLORS[evt.event_type] || EVENT_COLORS.click
                  const desc = evt.event_type === 'page_view' ? `Opened ${evt.page}`
                    : evt.event_type === 'page_exit' ? `Left ${evt.page}`
                    : evt.event_type === 'click' ? `Clicked "${evt.label || evt.element_id}" (${evt.element_type || ''})`
                    : evt.event_type === 'feature_use' ? `Used: ${evt.label}`
                    : evt.event_type === 'error' ? `Error: ${evt.label}`
                    : evt.event_type === 'idle_start' ? 'Went idle'
                    : evt.event_type === 'idle_end' ? 'Returned from idle'
                    : evt.event_type === 'search' ? `Searched: "${evt.label}"`
                    : evt.event_type === 'export' ? `Exported: ${evt.label}`
                    : evt.event_type
                  return (
                    <div key={i} className="relative flex items-start gap-3 pb-3 group" style={{ animationDelay: `${i * 15}ms` }}>
                      <div className={clsx('absolute left-[-20px] top-1 w-2.5 h-2.5 rounded-full ring-2 ring-white z-10', ec.dot)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono text-slate-400 w-14 flex-shrink-0">{fmtOffset(evt.time_offset_ms)}</span>
                          <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium', ec.badge)}>{ec.label}</span>
                          <span className="text-sm text-slate-700 truncate">{desc}</span>
                        </div>
                        {evt.page && evt.event_type !== 'page_view' && evt.event_type !== 'page_exit' && (
                          <div className="text-[10px] text-slate-400 ml-16">on {evt.page}</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {!selectedUser && (
        <div className="text-center py-12 text-slate-400">
          <div className="text-4xl mb-2">🔄</div>
          <p>Select a user to view their session replay</p>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// USER JOURNEYS TAB
// ═══════════════════════════════════════════════════════════
function JourneysTab({ days }) {
  const { data: res, isLoading } = useQuery({
    queryKey: ['user-journeys', days],
    queryFn: () => getUserJourneys(days),
    retry: 0
  })
  const data = res?.data?.data || { flows: [], entry_pages: [], exit_pages: [] }

  return (
    <div className="space-y-5">
      {isLoading && <div className="text-center py-8 text-slate-400">Loading journey data...</div>}

      {/* Flow table */}
      {data.flows.length > 0 && (
        <div className="card overflow-hidden">
          <div className="card-header"><h3 className="font-semibold text-slate-700">Page-to-Page Transitions</h3></div>
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead><tr><th>From</th><th className="text-center">→</th><th>To</th><th className="text-center">Count</th><th className="w-48">Flow</th></tr></thead>
              <tbody>
                {data.flows.slice(0, 30).map((f, i) => {
                  const maxCount = data.flows[0]?.count || 1
                  const pct = Math.round(f.count / maxCount * 100)
                  return (
                    <tr key={i}>
                      <td className="text-sm font-medium text-slate-700">{f.from_page}</td>
                      <td className="text-center text-slate-400">→</td>
                      <td className="text-sm font-medium text-slate-700">{f.to_page}</td>
                      <td className="text-center font-bold">{f.count}</td>
                      <td>
                        <div className="w-full bg-slate-100 rounded-full h-2">
                          <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Entry pages */}
        {data.entry_pages.length > 0 && (
          <div className="card overflow-hidden">
            <div className="card-header"><h3 className="font-semibold text-slate-700">Entry Pages (where sessions start)</h3></div>
            <div className="p-4 space-y-2">
              {data.entry_pages.map((p, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-sm text-slate-700">{p.page}</span>
                  <span className="text-sm font-bold text-green-600">{p.count} sessions</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Exit pages */}
        {data.exit_pages.length > 0 && (
          <div className="card overflow-hidden">
            <div className="card-header"><h3 className="font-semibold text-slate-700">Exit Pages (where sessions end)</h3></div>
            <div className="p-4 space-y-2">
              {data.exit_pages.map((p, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-sm text-slate-700">{p.page}</span>
                  <span className="text-sm font-bold text-red-600">{p.count} exits</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {!isLoading && data.flows.length === 0 && (
        <div className="text-center py-12 text-slate-400"><div className="text-4xl mb-2">🗺️</div><p>No journey data available</p></div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// PAGES TAB (original — unchanged)
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
// CLICK MAP TAB
// ═══════════════════════════════════════════════════════════
function ClickMapTab({ days }) {
  const [selectedPage, setSelectedPage] = useState('')

  const { data: pagesRes } = useQuery({
    queryKey: ['session-pages', days],
    queryFn: () => getSessionPages(days),
    retry: 0
  })
  const pages = (pagesRes?.data?.data || []).map(p => p.page).filter(Boolean)

  const { data: clickRes, isLoading } = useQuery({
    queryKey: ['click-details', selectedPage, days],
    queryFn: () => getClickDetails(selectedPage, days),
    enabled: !!selectedPage,
    retry: 0
  })
  const clickData = clickRes?.data?.data || { elements: [] }

  const chartData = (clickData.elements || []).slice(0, 10).map(e => ({
    name: e.label || e.element_id || 'unknown',
    clicks: e.clicks
  }))

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <label className="text-xs text-slate-500 block mb-1">Select Page</label>
        <select className="input text-sm w-64" value={selectedPage} onChange={e => setSelectedPage(e.target.value)}>
          <option value="">Choose page...</option>
          {pages.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {selectedPage && !isLoading && clickData.elements.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <KPI label="Total Clicks" value={clickData.total_clicks} color="blue" />
            <KPI label="Unique Clickers" value={clickData.unique_clickers} color="green" />
          </div>

          {chartData.length > 0 && (
            <div className="card">
              <div className="card-header"><h3 className="font-semibold text-slate-700">Top Clicked Elements</h3></div>
              <div className="p-4">
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={chartData} layout="vertical" margin={{ left: 100 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} />
                    <Tooltip />
                    <Bar dataKey="clicks" fill="#22c55e" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-compact w-full">
                <thead><tr><th>Element</th><th>Type</th><th>Label</th><th className="text-center">Clicks</th><th className="text-center">Users</th><th>Last Clicked</th></tr></thead>
                <tbody>
                  {clickData.elements.map((e, i) => (
                    <tr key={i}>
                      <td className="text-xs font-mono text-slate-500">{e.element_id || '—'}</td>
                      <td><span className="px-2 py-0.5 bg-slate-100 rounded text-xs">{e.element_type || '—'}</span></td>
                      <td className="text-sm font-medium text-slate-700">{e.label || '—'}</td>
                      <td className="text-center font-bold">{e.clicks}</td>
                      <td className="text-center">{e.unique_users}</td>
                      <td className="text-xs text-slate-400">{e.last_clicked?.slice(0, 16)?.replace('T', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!selectedPage && (
        <div className="text-center py-12 text-slate-400"><div className="text-4xl mb-2">🖱️</div><p>Select a page to view click breakdown</p></div>
      )}
      {selectedPage && isLoading && <div className="text-center py-8 text-slate-400">Loading click data...</div>}
      {selectedPage && !isLoading && clickData.elements.length === 0 && (
        <div className="text-center py-8 text-slate-400">No click data for this page</div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// DEEP METRICS TAB (Time on Page + Feature Matrix + Engagement)
// ═══════════════════════════════════════════════════════════
function MetricsTab({ days }) {
  const { data: topRes, isLoading: topLoading } = useQuery({
    queryKey: ['time-on-page', days],
    queryFn: () => getTimeOnPage(days),
    retry: 0
  })
  const timeData = topRes?.data?.data || []

  const { data: matRes, isLoading: matLoading } = useQuery({
    queryKey: ['feature-matrix', days],
    queryFn: () => getFeatureMatrix(days),
    retry: 0
  })
  const matrix = matRes?.data?.data || { features: [], users: [] }

  const { data: engRes, isLoading: engLoading } = useQuery({
    queryKey: ['user-engagement', days],
    queryFn: () => getUserEngagement(days),
    retry: 0
  })
  const engagements = engRes?.data?.data || []

  return (
    <div className="space-y-6">
      {/* Time on Page */}
      <div className="card overflow-hidden">
        <div className="card-header"><h3 className="font-semibold text-slate-700">Time on Page</h3></div>
        {topLoading ? <div className="p-6 text-center text-slate-400">Loading...</div> : (
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead><tr><th>Page</th><th className="text-center">Avg</th><th className="text-center">Median</th><th className="text-center">Max</th><th className="text-center">Visits</th><th className="text-center">Bounces</th><th className="text-center">Bounce %</th></tr></thead>
              <tbody>
                {timeData.map((t, i) => {
                  const bounceRate = t.total_visits > 0 ? Math.round(t.bounce_count / t.total_visits * 100) : 0
                  return (
                    <tr key={i}>
                      <td className="font-medium text-slate-700">{t.page}</td>
                      <td className="text-center text-sm">{fmtDuration(t.avg_duration_sec)}</td>
                      <td className="text-center text-sm">{fmtDuration(t.median_duration_sec)}</td>
                      <td className="text-center text-xs text-slate-400">{fmtDuration(t.max_duration_sec)}</td>
                      <td className="text-center font-bold">{t.total_visits}</td>
                      <td className="text-center">{t.bounce_count}</td>
                      <td className="text-center">
                        <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', {
                          'bg-green-100 text-green-700': bounceRate < 20,
                          'bg-amber-100 text-amber-700': bounceRate >= 20 && bounceRate < 50,
                          'bg-red-100 text-red-700': bounceRate >= 50
                        })}>{bounceRate}%</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Feature Adoption Matrix */}
      {matrix.features.length > 0 && (
        <div className="card overflow-hidden">
          <div className="card-header"><h3 className="font-semibold text-slate-700">Feature Adoption Matrix</h3></div>
          {matLoading ? <div className="p-6 text-center text-slate-400">Loading...</div> : (
            <div className="overflow-x-auto">
              <table className="table-compact w-full">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-white z-10">User</th>
                    {matrix.features.map(f => (
                      <th key={f} className="text-center text-[10px] px-1 writing-vertical" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', minWidth: 28, height: 80 }}>{f}</th>
                    ))}
                    <th className="text-center">Adoption</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.users.map(u => (
                    <tr key={u.username}>
                      <td className="font-semibold text-slate-700 sticky left-0 bg-white">{u.username}</td>
                      {matrix.features.map(f => (
                        <td key={f} className="text-center px-1">
                          {u.adopted.includes(f) ? (
                            <div className="w-5 h-5 rounded bg-green-500 mx-auto flex items-center justify-center">
                              <span className="text-white text-[10px]">✓</span>
                            </div>
                          ) : (
                            <div className="w-5 h-5 rounded bg-red-100 mx-auto" />
                          )}
                        </td>
                      ))}
                      <td className="text-center">
                        <span className={clsx('px-2 py-0.5 rounded-full text-xs font-bold', {
                          'bg-green-100 text-green-700': u.adoption_pct >= 70,
                          'bg-amber-100 text-amber-700': u.adoption_pct >= 40 && u.adoption_pct < 70,
                          'bg-red-100 text-red-700': u.adoption_pct < 40
                        })}>{u.adoption_pct}%</span>
                      </td>
                    </tr>
                  ))}
                  {/* Per-feature adoption footer */}
                  <tr className="bg-slate-50 font-medium">
                    <td className="sticky left-0 bg-slate-50 text-xs text-slate-500">Adoption Rate</td>
                    {matrix.features.map(f => {
                      const rate = matrix.users.length > 0
                        ? Math.round(matrix.users.filter(u => u.adopted.includes(f)).length / matrix.users.length * 100) : 0
                      return <td key={f} className="text-center text-[10px]">{rate}%</td>
                    })}
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Engagement Scores */}
      <div className="card overflow-hidden">
        <div className="card-header"><h3 className="font-semibold text-slate-700">Engagement Scores</h3></div>
        {engLoading ? <div className="p-6 text-center text-slate-400">Loading...</div> : (
          <div className="overflow-x-auto">
            <table className="table-compact w-full">
              <thead><tr><th>User</th><th className="text-center">Score</th><th className="text-center">Frequency</th><th className="text-center">Recency</th><th className="text-center">Breadth</th><th className="text-center">Depth</th><th>Details</th></tr></thead>
              <tbody>
                {engagements.map(e => (
                  <tr key={e.username}>
                    <td className="font-semibold text-slate-700">{e.username}</td>
                    <td className="text-center">
                      <div className="relative inline-flex items-center justify-center">
                        <svg width="44" height="44" className="-rotate-90">
                          <circle cx="22" cy="22" r="18" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                          <circle cx="22" cy="22" r="18" fill="none"
                            stroke={e.score >= 70 ? '#22c55e' : e.score >= 40 ? '#f59e0b' : '#ef4444'}
                            strokeWidth="3" strokeLinecap="round"
                            strokeDasharray={`${e.score * 1.13} 200`} />
                        </svg>
                        <span className="absolute text-xs font-bold">{e.score}</span>
                      </div>
                    </td>
                    <td className="text-center text-sm">{e.frequency_score}/30</td>
                    <td className="text-center text-sm">{e.recency_score}/20</td>
                    <td className="text-center text-sm">{e.breadth_score}/25</td>
                    <td className="text-center text-sm">{e.depth_score}/25</td>
                    <td className="text-xs text-slate-400">{e.breakdown.active_days}d active, {e.breakdown.sessions} sessions, {e.breakdown.avg_events_per_session} avg events</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// HEATMAP TAB (Day×Hour + Live Activity)
// ═══════════════════════════════════════════════════════════
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function HeatmapTab({ days }) {
  const { data: hmRes, isLoading } = useQuery({
    queryKey: ['heatmap', days],
    queryFn: () => getHeatmap(days),
    retry: 0
  })
  const heatData = hmRes?.data?.data || []

  const { data: liveRes } = useQuery({
    queryKey: ['live-activity'],
    queryFn: getLiveActivity,
    refetchInterval: 30000,
    retry: 0
  })
  const liveUsers = liveRes?.data?.data || []

  // Build 7×24 matrix
  const matrix = useMemo(() => {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0))
    let maxVal = 1
    for (const h of heatData) {
      grid[h.day_of_week][h.hour] = h.events
      if (h.events > maxVal) maxVal = h.events
    }
    return { grid, maxVal }
  }, [heatData])

  function heatColor(val) {
    if (val === 0) return 'bg-slate-50'
    const intensity = val / matrix.maxVal
    if (intensity < 0.2) return 'bg-blue-100'
    if (intensity < 0.4) return 'bg-blue-200'
    if (intensity < 0.6) return 'bg-blue-400 text-white'
    if (intensity < 0.8) return 'bg-blue-600 text-white'
    return 'bg-purple-700 text-white'
  }

  return (
    <div className="space-y-5">
      {/* Heatmap Grid */}
      <div className="card overflow-hidden">
        <div className="card-header"><h3 className="font-semibold text-slate-700">Activity Heatmap (Day × Hour)</h3></div>
        {isLoading ? <div className="p-6 text-center text-slate-400">Loading heatmap...</div> : (
          <div className="p-4 overflow-x-auto">
            <div className="min-w-[700px]">
              {/* Hour labels */}
              <div className="flex gap-px ml-12 mb-1">
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="w-7 text-center text-[9px] text-slate-400">{String(h).padStart(2, '0')}</div>
                ))}
              </div>
              {/* Grid rows */}
              {matrix.grid.map((row, dayIdx) => (
                <div key={dayIdx} className="flex items-center gap-px mb-px">
                  <div className="w-10 text-right text-xs text-slate-500 pr-2 font-medium">{DAY_LABELS[dayIdx]}</div>
                  {row.map((val, hourIdx) => (
                    <div key={hourIdx}
                      className={clsx('w-7 h-7 rounded-sm flex items-center justify-center text-[9px] font-medium transition-all cursor-default', heatColor(val))}
                      title={`${DAY_LABELS[dayIdx]} ${String(hourIdx).padStart(2, '0')}:00 — ${val} events`}>
                      {val > 0 ? val : ''}
                    </div>
                  ))}
                </div>
              ))}
              {/* Legend */}
              <div className="flex items-center gap-2 ml-12 mt-3">
                <span className="text-[10px] text-slate-400">Less</span>
                {['bg-slate-50', 'bg-blue-100', 'bg-blue-200', 'bg-blue-400', 'bg-blue-600', 'bg-purple-700'].map((c, i) => (
                  <div key={i} className={clsx('w-4 h-4 rounded-sm', c)} />
                ))}
                <span className="text-[10px] text-slate-400">More</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Live Activity Feed */}
      <div className="card overflow-hidden">
        <div className="card-header flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <h3 className="font-semibold text-slate-700">Live Activity ({liveUsers.length} active)</h3>
          <span className="text-xs text-slate-400 ml-auto">Auto-refreshes every 30s</span>
        </div>
        <div className="p-4">
          {liveUsers.length === 0 ? (
            <div className="text-center text-sm text-slate-400 py-4">No users active in the last 5 minutes</div>
          ) : (
            <div className="space-y-2">
              {liveUsers.map(u => (
                <div key={u.username} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold text-sm">
                    {u.username[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-700">{u.username}</div>
                    <div className="text-xs text-slate-500">
                      on {u.current_page} — {u.last_event}{u.last_label ? `: ${u.last_label}` : ''}
                    </div>
                  </div>
                  <div className="text-xs text-slate-400">{u.seconds_ago}s ago</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// ERRORS TAB (original — unchanged)
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
  const [replayUser, setReplayUser] = useState('')

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
    { id: 'users', label: 'Users' },
    { id: 'replay', label: 'Session Replay' },
    { id: 'journeys', label: 'Journeys' },
    { id: 'pages', label: 'Pages' },
    { id: 'clicks', label: 'Click Map' },
    { id: 'metrics', label: 'Deep Metrics' },
    { id: 'heatmap', label: 'Heatmap' },
    { id: 'errors', label: 'Errors' },
  ]

  return (
    <ErrorBoundary>
      <div className="p-6 space-y-5 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="section-title">Session Analytics</h2>
            <p className="section-subtitle mt-1">User behavior intelligence — admin only</p>
          </div>
          <select value={days} onChange={e => setDays(parseInt(e.target.value))}
            className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            {PERIOD_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        <div className="border-b border-slate-200 flex gap-0 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={clsx('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeTab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700')}>
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && <OverviewTab days={days} />}
        {activeTab === 'users' && <UsersTab days={days} onSelectUser={(u) => { setReplayUser(u); setActiveTab('replay') }} />}
        {activeTab === 'replay' && <ReplayTab days={days} initialUser={replayUser} />}
        {activeTab === 'journeys' && <JourneysTab days={days} />}
        {activeTab === 'pages' && <PagesTab days={days} />}
        {activeTab === 'clicks' && <ClickMapTab days={days} />}
        {activeTab === 'metrics' && <MetricsTab days={days} />}
        {activeTab === 'heatmap' && <HeatmapTab days={days} />}
        {activeTab === 'errors' && <ErrorsTab days={days} />}
      </div>
    </ErrorBoundary>
  )
}

import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../utils/api';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const TABS = ['overview', 'attendance', 'salary', 'leaveRegister', 'patterns', 'aiReview'];
const TAB_LABELS = { overview: 'Overview', attendance: 'Attendance', salary: 'Salary', leaveRegister: 'Leave Register', patterns: 'Patterns', aiReview: 'AI Review' };

function fmt(n) { return n != null ? Number(n).toLocaleString('en-IN') : '—'; }
function pct(n) { return n != null ? `${n}%` : '—'; }
function hrs(n) { return n != null ? `${n}h` : '—'; }
function inr(n) { return n != null ? `₹${Number(n).toLocaleString('en-IN')}` : '—'; }

function KpiCard({ label, value, sub, color = 'blue' }) {
  const border = { blue: 'border-blue-500', green: 'border-green-500', red: 'border-red-500', amber: 'border-amber-500', indigo: 'border-indigo-500', purple: 'border-purple-500', teal: 'border-teal-500', orange: 'border-orange-500' };
  return (
    <div className={`bg-white rounded-lg shadow p-4 border-l-4 ${border[color] || border.blue}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

// API returns capitalized severity: 'High', 'Medium', 'Low', 'Critical', 'Info'
function SeverityBadge({ s }) {
  const map = {
    Critical: 'bg-red-100 text-red-800',
    High:     'bg-red-100 text-red-700',
    Medium:   'bg-amber-100 text-amber-700',
    Low:      'bg-yellow-100 text-yellow-700',
    Info:     'bg-blue-100 text-blue-700',
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[s] || map.Info}`}>{s}</span>;
}

export default function EmployeeProfile() {
  const today = new Date().toISOString().split('T')[0];
  const sixAgo = (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().split('T')[0]; })();

  const [employees, setEmployees]   = useState([]);
  const [selectedCode, setSelected] = useState('');
  const [searchTerm, setSearch]     = useState('');
  const [showDropdown, setDropdown] = useState(false);
  const [fromDate, setFrom]         = useState(sixAgo);
  const [toDate, setTo]             = useState(today);
  const [profileData, setProfile]   = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [activeTab, setTab]         = useState('overview');
  // AI Review state
  const [aiReview, setAiReview]     = useState(null);
  const [aiLoading, setAiLoading]   = useState(false);
  const [aiError, setAiError]       = useState('');
  const dropRef = useRef(null);

  // Load employee list once
  useEffect(() => {
    api.get('/employees?status=Active&limit=500').then(r => {
      setEmployees(r.data?.employees || r.data?.data || []);
    }).catch(() => {});
  }, []);

  // Click-outside to close dropdown
  useEffect(() => {
    function handler(e) { if (dropRef.current && !dropRef.current.contains(e.target)) setDropdown(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Reset AI review when employee or dates change
  useEffect(() => { setAiReview(null); setAiError(''); }, [selectedCode, fromDate, toDate]);

  const filtered = employees.filter(e =>
    !searchTerm || e.name?.toLowerCase().includes(searchTerm.toLowerCase()) || e.code?.toLowerCase().includes(searchTerm.toLowerCase())
  ).slice(0, 30);

  const fetchProfile = useCallback(async () => {
    if (!selectedCode) return;
    setLoading(true); setError('');
    try {
      const r = await api.get(`/analytics/employee/${selectedCode}/profile-range?from=${fromDate}&to=${toDate}`);
      setProfile(r.data?.data || r.data);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }, [selectedCode, fromDate, toDate]);

  useEffect(() => { if (selectedCode) fetchProfile(); }, [selectedCode, fromDate, toDate, fetchProfile]);

  const generateAiReview = async () => {
    setAiLoading(true); setAiError(''); setAiReview(null);
    try {
      const r = await api.post(`/analytics/employee/${selectedCode}/ai-review`, { from: fromDate, to: toDate });
      // Backend returns { success, data: { narrative, sections: {...}, generatedAt, model, usage } }
      const payload = r.data?.data || r.data;
      if (payload && (payload.sections || payload.narrative)) {
        setAiReview(payload);
      } else {
        setAiError('No review content returned');
      }
    } catch (e) {
      const status = e.response?.status;
      if (status === 503) setAiError('AI review unavailable — ANTHROPIC_API_KEY not configured on this server.');
      else setAiError(e.response?.data?.error || e.message);
    } finally { setAiLoading(false); }
  };

  const emp = profileData?.employee;
  const kpis = profileData?.kpis;
  const streaks = profileData?.streaks;
  const monthly = profileData?.monthlyBreakdown || [];
  const deptComp = profileData?.departmentComparison;
  const salary = profileData?.salaryHistory;
  const patterns = profileData?.patternAnalysis;
  const corrections = profileData?.corrections;
  const leaveUsage = profileData?.leaveUsage;

  const tenure = emp?.date_of_joining
    ? (() => { const m = Math.round((new Date() - new Date(emp.date_of_joining)) / (1000 * 60 * 60 * 24 * 30)); return m >= 12 ? `${Math.floor(m/12)}y ${m%12}m` : `${m}m`; })()
    : null;

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold">Employee Intelligence Profile</h1>

      {/* Controls */}
      <div className="bg-white rounded-lg shadow p-4 flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-48 relative" ref={dropRef}>
          <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
          <input
            type="text" placeholder="Search name or code…"
            value={searchTerm}
            onChange={e => { setSearch(e.target.value); setDropdown(true); }}
            onFocus={() => setDropdown(true)}
            className="w-full border rounded px-3 py-2 text-sm"
          />
          {showDropdown && filtered.length > 0 && (
            <ul className="absolute z-20 top-full left-0 right-0 bg-white border rounded shadow-lg max-h-52 overflow-y-auto mt-0.5">
              {filtered.map(e => (
                <li key={e.code}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-indigo-50"
                  onMouseDown={() => { setSelected(e.code); setSearch(`${e.name} (${e.code})`); setDropdown(false); }}>
                  <span className="font-medium">{e.name}</span>
                  <span className="text-gray-400 ml-2">{e.code}</span>
                  <span className="text-gray-400 ml-2 text-xs">{e.department}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">From</label>
          <input type="date" value={fromDate} onChange={e => setFrom(e.target.value)} className="border rounded px-3 py-2 text-sm" /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">To</label>
          <input type="date" value={toDate} onChange={e => setTo(e.target.value)} className="border rounded px-3 py-2 text-sm" /></div>
        <button onClick={fetchProfile} disabled={!selectedCode || loading}
          className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm disabled:opacity-50">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700">{error}</div>}
      {!selectedCode && <div className="bg-white rounded-lg shadow p-12 text-center text-gray-400">Select an employee to view their intelligence profile</div>}

      {emp && (
        <>
          {/* Identity card */}
          <div className="bg-white rounded-lg shadow p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-xl font-bold text-gray-900">{emp.name}</div>
              <div className="text-sm text-gray-500 mt-1">{emp.code} · {emp.designation || emp.department}</div>
            </div>
            <div className="text-sm space-y-1 text-gray-600">
              <div><span className="text-gray-400">Dept:</span> {emp.department || '—'}</div>
              <div><span className="text-gray-400">Company:</span> {emp.company || '—'}</div>
              <div><span className="text-gray-400">Type:</span> {emp.is_contractor ? 'Contractor' : 'Permanent'}</div>
              <div><span className="text-gray-400">Shift:</span> {emp.shift_code || '—'}</div>
            </div>
            <div className="text-sm space-y-1 text-gray-600">
              <div><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${emp.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{emp.status}</span></div>
              {emp.date_of_joining && <div><span className="text-gray-400">DOJ:</span> {emp.date_of_joining}</div>}
              {tenure && <div><span className="text-gray-400">Tenure:</span> {tenure}</div>}
              <div><span className="text-gray-400">Gross:</span> {inr(emp.gross_salary)}/mo</div>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto">
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${activeTab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>

          {/* ── Overview ── */}
          {activeTab === 'overview' && kpis && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard label="Attendance Rate"   value={pct(kpis.attendanceRate)}  sub={`${kpis.presentDays}/${kpis.workingDays} days`} color="green" />
                <KpiCard label="Late Arrivals"     value={kpis.lateCount}             sub={`${pct(kpis.lateRate)} of present`}            color="amber" />
                <KpiCard label="Avg Hours/Day"     value={hrs(kpis.avgHoursWorked)}   sub="from punch times"                              color="blue" />
                <KpiCard label="Regularity"        value={pct(profileData?.regularityScore?.score)} sub="consistency score"              color="indigo" />
                <KpiCard label="Absences"          value={kpis.totalAbsences}         sub={`${pct(kpis.absenteeismRate)} rate`}           color="red" />
                <KpiCard label="OT Days"           value={kpis.otDays}                sub={`${kpis.wopDays} WOP days`}                    color="teal" />
                <KpiCard label="Miss Punches"      value={kpis.missPunchCount}        sub={`${kpis.missPunchResolved} resolved`}          color="orange" />
                <KpiCard label="Early Exits"       value={kpis.earlyExitCount}        sub={kpis.avgEarlyMinutes ? `avg ${kpis.avgEarlyMinutes}m early` : null} color="purple" />
              </div>

              {streaks && (
                <div className="bg-white rounded-lg shadow p-4 flex gap-6 text-sm flex-wrap">
                  <div><span className="text-gray-500">Best streak:</span> <span className="font-bold text-green-700">{streaks.maxPresentStreak}d present</span></div>
                  <div><span className="text-gray-500">Longest absence run:</span> <span className="font-bold text-red-700">{streaks.maxAbsentStreak}d</span></div>
                  {streaks.currentStreak?.days > 0 && (
                    <div><span className="text-gray-500">Current:</span> <span className="font-bold">{streaks.currentStreak.days}d {streaks.currentStreak.type}</span></div>
                  )}
                </div>
              )}

              {monthly.length > 1 && (
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold mb-3 text-sm">Monthly Attendance Trend</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={monthly.map(m => ({ name: `${m.year}-${String(m.month).padStart(2,'0')}`, att: m.attendanceRate, late: m.lateRate }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 100]} />
                      <Tooltip formatter={v => v + '%'} />
                      <Legend />
                      <Line type="monotone" dataKey="att"  name="Attendance%" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="late" name="Late%"        stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {deptComp && (
                <div className="bg-white rounded-lg shadow p-4 overflow-x-auto">
                  <h3 className="font-semibold mb-3 text-sm">Vs Department & Org</h3>
                  <table className="w-full text-sm"><thead><tr className="text-left text-gray-500 border-b">
                    <th className="py-2">Metric</th><th>This Employee</th><th>{deptComp.departmentName || 'Dept'}</th><th>Org</th>
                  </tr></thead><tbody>
                    {[
                      ['Attendance%', deptComp.employee?.attendanceRate, deptComp.department?.attendanceRate, deptComp.org?.attendanceRate],
                      ['Late%',       deptComp.employee?.lateRate,       deptComp.department?.lateRate,       deptComp.org?.lateRate],
                      ['Avg Hours',   deptComp.employee?.avgHours,       deptComp.department?.avgHours,       deptComp.org?.avgHours],
                    ].map(([label, e, d, o]) => (
                      <tr key={label} className="border-b even:bg-gray-50">
                        <td className="py-1.5 font-medium">{label}</td>
                        <td className="font-bold">{e != null ? e : '—'}</td>
                        <td className="text-gray-600">{d != null ? d : '—'}</td>
                        <td className="text-gray-600">{o != null ? o : '—'}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              )}
            </div>
          )}

          {/* ── Attendance ── */}
          {activeTab === 'attendance' && kpis && (
            <div className="space-y-4">
              <div className="bg-white rounded-lg shadow p-4 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
                {[
                  ['Working Days', kpis.workingDays], ['Present Days', kpis.presentDays],
                  ['Absences', kpis.totalAbsences], ['Half Days', kpis.halfDayCount],
                  ['WOP Days', kpis.wopDays], ['Night Shift', kpis.nightShiftDays],
                  ['Holiday Duty', kpis.holidayDutyDays], ['ED Approved', kpis.edDaysApproved],
                  ['Late Count', kpis.lateCount], ['Avg Late Min', kpis.avgLateMinutes ?? '—'],
                  ['Early Exits', kpis.earlyExitCount], ['Avg Early Min', kpis.avgEarlyMinutes ?? '—'],
                  ['OT Days', kpis.otDays], ['Total OT Min', kpis.totalOTMinutes],
                  ['Miss Punches', kpis.missPunchCount], ['Resolved', kpis.missPunchResolved],
                ].map(([l, v]) => (
                  <div key={l}><span className="text-gray-400">{l}: </span><span className="font-medium">{v ?? '—'}</span></div>
                ))}
              </div>

              {monthly.length > 0 && (
                <div className="bg-white rounded-lg shadow p-4 overflow-x-auto">
                  <h3 className="font-semibold mb-3 text-sm">Monthly Breakdown</h3>
                  <table className="w-full text-sm min-w-[600px]"><thead><tr className="text-left text-gray-500 border-b">
                    <th className="py-2">Month</th><th>Att%</th><th>Present</th><th>Absent</th><th>Late</th><th>Early</th><th>Avg Hrs</th><th>OT</th>
                  </tr></thead><tbody>
                    {monthly.map(m => (
                      <tr key={`${m.year}-${m.month}`} className="border-b even:bg-gray-50">
                        <td className="py-1.5">{m.year}-{String(m.month).padStart(2,'0')}</td>
                        <td className={`font-bold ${m.attendanceRate >= 90 ? 'text-green-700' : m.attendanceRate >= 75 ? 'text-yellow-700' : 'text-red-700'}`}>{m.attendanceRate}%</td>
                        <td>{m.presentDays}</td><td>{m.absences}</td>
                        <td>{m.lateCount}</td><td>{m.earlyExitCount}</td>
                        <td>{m.avgHours ?? '—'}</td><td>{m.otDays}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              )}

              {corrections?.dayCorrections?.length > 0 && (
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold mb-3 text-sm">Day Corrections ({corrections.dayCorrections.length})</h3>
                  <div className="space-y-1 text-sm max-h-48 overflow-y-auto">
                    {corrections.dayCorrections.map((c, i) => (
                      <div key={i} className="flex justify-between border-b py-1">
                        <span>{c.date} — {c.reason || c.correction_type}</span>
                        <span className="text-gray-400">{c.applied_by}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Salary ── */}
          {activeTab === 'salary' && salary && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard label="Total Gross Earned"  value={inr(salary.totals?.totalGrossEarned)}  color="green" />
                <KpiCard label="Total Net Salary"    value={inr(salary.totals?.totalNetSalary)}    color="blue" />
                <KpiCard label="Total Deductions"    value={inr(salary.totals?.totalDeductions)}   color="red" />
                <KpiCard label="Total Take-Home"     value={inr(salary.totals?.totalTakeHome)}     color="indigo" />
              </div>
              {salary.months?.length > 0 && (
                <div className="bg-white rounded-lg shadow p-4 overflow-x-auto">
                  <h3 className="font-semibold mb-3 text-sm">Monthly Salary History</h3>
                  <table className="w-full text-sm min-w-[600px]"><thead><tr className="text-left text-gray-500 border-b">
                    <th className="py-2">Month</th><th>Gross Earned</th><th>Net</th><th>Take-Home</th><th>Deductions</th><th>PF</th><th>ESI</th>
                  </tr></thead><tbody>
                    {salary.months.map(m => (
                      <tr key={`${m.year}-${m.month}`} className="border-b even:bg-gray-50">
                        <td className="py-1.5">{m.year}-{String(m.month).padStart(2,'0')}</td>
                        <td>{inr(m.gross_earned)}</td>
                        <td>{inr(m.net_salary)}</td>
                        <td className="font-medium">{inr(m.take_home ?? m.total_payable)}</td>
                        <td className="text-red-700">{inr(m.total_deductions)}</td>
                        <td>{inr(m.pf_employee)}</td>
                        <td>{inr(m.esi_employee)}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              )}
              {salary.months?.length > 1 && (
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold mb-3 text-sm">Net Salary Trend</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={salary.months.map(m => ({ name: `${m.year}-${String(m.month).padStart(2,'0')}`, net: m.net_salary, gross: m.gross_earned }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                      <Tooltip formatter={v => `₹${Number(v).toLocaleString('en-IN')}`} />
                      <Legend />
                      <Bar dataKey="gross" name="Gross Earned" fill="#6366f1" radius={[3,3,0,0]} />
                      <Bar dataKey="net"   name="Net Salary"   fill="#22c55e" radius={[3,3,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* ── Leave Register ── */}
          {activeTab === 'leaveRegister' && (
            <div className="space-y-4">
              {/* Current balances */}
              <div>
                <h3 className="font-semibold mb-2 text-sm text-gray-700">Current Leave Balances</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {(() => {
                    const thisYear = new Date().getFullYear();
                    const balRows = (leaveUsage?.balances || []).filter(b => b.year === thisYear);
                    const byType = Object.fromEntries(balRows.map(b => [b.leave_type, b]));
                    const types = [
                      { key: 'CL', color: 'amber' },
                      { key: 'EL', color: 'green' },
                      { key: 'SL', color: 'teal' }
                    ];
                    return types.map(({ key, color }) => {
                      const b = byType[key] || {};
                      return (
                        <KpiCard
                          key={key}
                          label={`${key} Balance (${thisYear})`}
                          value={b.balance ?? 0}
                          sub={`Opening ${b.opening ?? 0} + Accrued ${b.accrued ?? 0} − Used ${b.used ?? 0}`}
                          color={color}
                        />
                      );
                    });
                  })()}
                  <KpiCard
                    label="Total Applications"
                    value={(leaveUsage?.applications || []).length}
                    sub={`In range ${fromDate} → ${toDate}`}
                    color="blue"
                  />
                </div>
              </div>

              {/* YTD totals from monthlyBreakdown */}
              {monthly.length > 0 && (() => {
                const sum = (k) => monthly.reduce((s, m) => s + Number(m[k] || 0), 0);
                const cards = [
                  { k: 'cl_used',              label: 'CL Used (range)',        color: 'amber' },
                  { k: 'el_used',              label: 'EL Used (range)',        color: 'green' },
                  { k: 'lwp_days',             label: 'LWP Days (range)',       color: 'orange' },
                  { k: 'od_days',              label: 'OD / Comp-Off (range)',  color: 'blue' },
                  { k: 'short_leave_days',     label: 'Short Leaves (range)',   color: 'teal' },
                  { k: 'uninformed_absent',    label: 'Uninformed Absent',      color: 'red' }
                ];
                return (
                  <div>
                    <h3 className="font-semibold mb-2 text-sm text-gray-700">Range Leave Summary</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                      {cards.map(c => (
                        <KpiCard key={c.k} label={c.label} value={fmt(sum(c.k))} color={c.color} />
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Month-by-month breakdown */}
              {monthly.length > 0 && (
                <div className="bg-white rounded-lg shadow p-4 overflow-x-auto">
                  <h3 className="font-semibold mb-3 text-sm">Monthly Leave Breakdown</h3>
                  <table className="w-full text-sm min-w-[720px]">
                    <thead>
                      <tr className="text-left text-gray-500 border-b">
                        <th className="py-2">Month</th>
                        <th className="text-center text-amber-700">CL</th>
                        <th className="text-center text-green-700">EL</th>
                        <th className="text-center text-orange-700">LWP</th>
                        <th className="text-center text-blue-700">OD</th>
                        <th className="text-center text-teal-700">SL</th>
                        <th className="text-center text-red-700">UA</th>
                        <th className="text-center">Payable Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthly.map(m => (
                        <tr key={`${m.year}-${m.month}`} className="border-b even:bg-gray-50">
                          <td className="py-1.5">{m.year}-{String(m.month).padStart(2, '0')}</td>
                          <td className="text-center">{fmt(m.cl_used)}</td>
                          <td className="text-center">{fmt(m.el_used)}</td>
                          <td className="text-center">{fmt(m.lwp_days)}</td>
                          <td className="text-center">{fmt(m.od_days)}</td>
                          <td className="text-center">{fmt(m.short_leave_days)}</td>
                          <td className="text-center">{fmt(m.uninformed_absent)}</td>
                          <td className="text-center font-medium">{fmt(m.payable_days)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Leave applications timeline */}
              <div className="bg-white rounded-lg shadow p-4">
                <h3 className="font-semibold mb-3 text-sm">Leave Applications Timeline</h3>
                {(!leaveUsage?.applications || leaveUsage.applications.length === 0) ? (
                  <div className="text-center py-6 text-gray-400 text-sm">No leave applications in this range</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[720px]">
                      <thead>
                        <tr className="text-left text-gray-500 border-b">
                          <th className="py-2">Type</th>
                          <th>From</th>
                          <th>To</th>
                          <th className="text-center">Days</th>
                          <th>Reason</th>
                          <th>Status</th>
                          <th>Applied</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leaveUsage.applications.map(a => (
                          <tr key={a.id} className="border-b even:bg-gray-50">
                            <td className="py-1.5">
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                                {a.leave_type}
                              </span>
                            </td>
                            <td>{a.start_date}</td>
                            <td>{a.end_date}</td>
                            <td className="text-center font-medium">{a.days}</td>
                            <td className="max-w-64 truncate" title={a.reason}>{a.reason || '-'}</td>
                            <td>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                a.status === 'Approved' ? 'bg-green-100 text-green-700' :
                                a.status === 'Rejected' ? 'bg-red-100 text-red-700' :
                                'bg-amber-100 text-amber-700'
                              }`}>
                                {a.status}
                              </span>
                            </td>
                            <td className="text-xs text-gray-500">
                              {a.applied_at ? new Date(a.applied_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Patterns ── */}
          {activeTab === 'patterns' && (
            <div className="space-y-4">
              {!patterns ? (
                <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">Pattern analysis not available for this range</div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <KpiCard label="Flight Risk"  value={`${patterns.compositeScores?.flightRisk ?? 0}/100`}  color={patterns.compositeScores?.flightRisk > 60 ? 'red' : 'green'} />
                    <KpiCard label="Engagement"   value={`${patterns.compositeScores?.engagement ?? 0}/100`}  color={patterns.compositeScores?.engagement > 60 ? 'green' : 'amber'} />
                    <KpiCard label="Reliability"  value={`${patterns.compositeScores?.reliability ?? 0}/100`} color={patterns.compositeScores?.reliability > 60 ? 'green' : 'amber'} />
                  </div>
                  {patterns.patterns?.length > 0 ? (
                    <div className="bg-white rounded-lg shadow p-4 space-y-3">
                      <h3 className="font-semibold text-sm">Detected Patterns ({patterns.patterns.length})</h3>
                      {patterns.patterns.map((p, i) => (
                        <div key={i} className="border rounded p-3 space-y-1">
                          <div className="flex justify-between items-center gap-3">
                            <span className="font-medium text-sm text-gray-900">{p.label}</span>
                            <div className="flex items-center gap-2 shrink-0">
                              {p.score != null && <span className="text-xs text-gray-500">score: {p.score}</span>}
                              <SeverityBadge s={p.severity} />
                            </div>
                          </div>
                          {p.detail && <div className="text-xs text-gray-600">{p.detail}</div>}
                          {p.hrAction && <div className="text-xs text-indigo-700 italic">HR: {p.hrAction}</div>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-green-50 rounded-lg shadow p-6 text-center text-green-700">
                      <div className="text-2xl mb-2">✓</div>
                      <p className="font-medium">No concerning patterns detected</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── AI Review ── */}
          {activeTab === 'aiReview' && (
            <div className="space-y-4">
              {!aiReview && !aiLoading && (
                <div className="bg-white rounded-lg shadow p-8 text-center space-y-4">
                  <div className="text-4xl">🤖</div>
                  <h3 className="font-semibold text-lg">AI Narrative Review</h3>
                  <p className="text-sm text-gray-500 max-w-md mx-auto">Generate a qualitative AI-powered analysis of attendance patterns, behavioral signals, and performance indicators for the selected date range.</p>
                  {aiError && <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">{aiError}</div>}
                  <button onClick={generateAiReview} disabled={aiLoading}
                    className="px-6 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm disabled:opacity-50">
                    Generate AI Review
                  </button>
                </div>
              )}

              {aiLoading && (
                <div className="bg-white rounded-lg shadow p-12 text-center">
                  <div className="animate-spin h-8 w-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full mx-auto mb-4" />
                  <p className="text-sm text-gray-500">Analysing {emp?.name}'s data with Claude AI…</p>
                </div>
              )}

              {aiReview && !aiLoading && (
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <button onClick={generateAiReview} className="px-4 py-1.5 border border-indigo-600 text-indigo-600 rounded hover:bg-indigo-50 text-sm">
                      Regenerate
                    </button>
                  </div>
                  {aiError && <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">{aiError}</div>}

                  {[
                    { key: 'executiveSummary', title: 'Executive Summary', color: 'border-indigo-500 bg-indigo-50' },
                    { key: 'strengths',        title: 'Key Strengths',     color: 'border-green-500 bg-green-50' },
                    { key: 'concerns',         title: 'Areas of Concern',  color: 'border-red-500 bg-red-50' },
                    { key: 'riskAssessment',   title: 'Risk Assessment',   color: 'border-amber-500 bg-amber-50' },
                    { key: 'recommendations',  title: 'Recommendations',   color: 'border-blue-500 bg-blue-50' },
                    { key: 'departmentContext',title: 'Department Context', color: 'border-gray-400 bg-gray-50' },
                  ].filter(s => aiReview.sections?.[s.key]).map(s => (
                    <div key={s.key} className={`rounded-lg shadow p-4 border-l-4 ${s.color}`}>
                      <h3 className="font-semibold text-sm mb-2 text-gray-800">{s.title}</h3>
                      <div className="text-sm text-gray-700 whitespace-pre-line">{aiReview.sections[s.key]}</div>
                    </div>
                  ))}
                  {/* Fallback: show raw narrative if sections didn't parse */}
                  {!aiReview.sections && aiReview.narrative && (
                    <div className="rounded-lg shadow p-4 border-l-4 border-gray-400 bg-gray-50">
                      <h3 className="font-semibold text-sm mb-2 text-gray-800">AI Review</h3>
                      <div className="text-sm text-gray-700 whitespace-pre-line">{aiReview.narrative}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

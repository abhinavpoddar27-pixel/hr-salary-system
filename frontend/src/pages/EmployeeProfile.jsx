import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import { LineChart, Line, BarChart, Bar, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function EmployeeProfile() {
  const [employees, setEmployees] = useState([]);
  const [selectedCode, setSelectedCode] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [profileData, setProfileData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const dropRef = useRef(null);
  const [aiReview, setAiReview] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  useEffect(() => {
    api.get('/employees?status=Active&limit=500').then(r => setEmployees(r.data?.data || [])).catch(() => {});
    const t = new Date(), s = new Date();
    s.setMonth(t.getMonth() - 6);
    setToDate(t.toISOString().split('T')[0]);
    setFromDate(s.toISOString().split('T')[0]);
  }, []);

  useEffect(() => {
    const handler = (e) => { if (dropRef.current && !dropRef.current.contains(e.target)) setShowDropdown(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchProfile = useCallback(async () => {
    if (!selectedCode || !fromDate || !toDate) return;
    setLoading(true); setError('');
    try {
      const r = await api.get('/analytics/employee/' + selectedCode + '/profile-range?from=' + fromDate + '&to=' + toDate);
      if (r.data?.success) setProfileData(r.data.data);
      else setError(r.data?.error || 'Failed');
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }, [selectedCode, fromDate, toDate]);

  useEffect(() => { if (selectedCode && fromDate && toDate) fetchProfile(); }, [selectedCode, fromDate, toDate, fetchProfile]);

  const fmt = (n) => n != null ? Number(n).toLocaleString('en-IN') : '-';
  const fmtPct = (n) => n != null ? n.toFixed(1) + '%' : '-';
  const filtered = employees.filter(e => { const t = searchTerm.toLowerCase(); return e.code?.toLowerCase().includes(t) || e.name?.toLowerCase().includes(t); }).slice(0, 25);
  const kpis = profileData?.kpis || {};
  const emp = profileData?.employee || {};
  const tabs = ['overview', 'attendance', 'salary', 'patterns', 'aiReview'];

  const KPI = ({ label, value, sub }) => (
    <div className="bg-white rounded-lg shadow p-4 border-l-4 border-indigo-400">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Employee Profile</h1>
      <div className="bg-white rounded-lg shadow p-4 mb-4 flex flex-wrap gap-4 items-end">
        <div className="relative flex-1 min-w-[220px]" ref={dropRef}>
          <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
          <input type="text" placeholder="Search name or code..." value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            className="w-full border rounded px-3 py-2 text-sm" />
          {showDropdown && filtered.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-white border rounded shadow-lg max-h-60 overflow-y-auto">
              {filtered.map(e => (
                <button key={e.code} className="w-full text-left px-3 py-2 hover:bg-indigo-50 text-sm border-b"
                  onClick={() => { setSelectedCode(e.code); setSearchTerm(e.code + ' - ' + e.name); setShowDropdown(false); }}>
                  <div className="font-medium">{e.code} — {e.name}</div>
                  <div className="text-xs text-gray-400">{e.department}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">From</label><input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="border rounded px-3 py-2 text-sm" /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">To</label><input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="border rounded px-3 py-2 text-sm" /></div>
        <button onClick={fetchProfile} className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm">Refresh</button>
      </div>

      {!selectedCode && <div className="bg-white rounded-lg shadow p-12 text-center text-gray-400">Select an employee to view their profile</div>}
      {loading && <div className="bg-white rounded-lg shadow p-12 text-center"><div className="animate-spin h-8 w-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full mx-auto" /></div>}
      {error && <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700 mb-4">{error}</div>}

      {profileData && !loading && (
        <>
          <div className="bg-white rounded-lg shadow p-5 mb-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><div className="text-xl font-bold">{emp.name}</div><div className="text-sm text-gray-500">{emp.code} · {emp.designation}</div></div>
            <div className="text-sm text-gray-600"><div>{emp.department} · {emp.company}</div><div>{emp.employment_type} · Shift: {emp.shift_code}</div></div>
            <div className="text-right"><span className={'inline-block px-3 py-1 rounded-full text-xs font-medium ' + (emp.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800')}>{emp.status}</span>
              {emp.date_of_joining && <div className="text-xs text-gray-500 mt-1">DOJ: {emp.date_of_joining}</div>}
              {emp.tenureMonths != null && <div className="text-xs text-gray-500">{Math.floor(emp.tenureMonths / 12)}y {emp.tenureMonths % 12}m tenure</div>}
            </div>
          </div>

          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4 overflow-x-auto">
            {tabs.map(t => <button key={t} onClick={() => setActiveTab(t)} className={'px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap ' + (activeTab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500')}>{t === 'aiReview' ? 'AI Review' : t.charAt(0).toUpperCase() + t.slice(1)}</button>)}
          </div>

          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KPI label="Attendance Rate" value={fmtPct(kpis.attendanceRate)} />
                <KPI label="Late Rate" value={fmtPct(kpis.lateRate)} sub={kpis.avgLateMinutes ? 'Avg ' + kpis.avgLateMinutes + ' min' : ''} />
                <KPI label="Avg Hours" value={kpis.avgHoursWorked?.toFixed(1) || '-'} />
                <KPI label="Regularity" value={(profileData.regularityScore ?? '-') + '/100'} />
                <KPI label="Absences" value={kpis.totalAbsences ?? '-'} />
                <KPI label="OT Days" value={kpis.otDays ?? '-'} />
                <KPI label="Miss Punches" value={kpis.missPunchCount ?? '-'} sub={kpis.missPunchResolutionRate ? fmtPct(kpis.missPunchResolutionRate) + ' resolved' : ''} />
                <KPI label="Early Exits" value={kpis.earlyExitCount ?? '-'} />
              </div>
              {profileData.streaks && (
                <div className="bg-white rounded-lg shadow p-4 flex gap-6 text-sm">
                  <span>Best streak: <b className="text-green-700">{profileData.streaks.maxPresentStreak}d</b></span>
                  <span>Worst absence: <b className="text-red-700">{profileData.streaks.maxAbsentStreak}d</b></span>
                  {profileData.streaks.currentStreak && <span>Current: <b>{profileData.streaks.currentStreak.days}d {profileData.streaks.currentStreak.type}</b></span>}
                </div>
              )}
              {profileData.departmentComparison && (
                <div className="bg-white rounded-lg shadow p-4 overflow-x-auto">
                  <h3 className="font-semibold mb-2">Department Comparison</h3>
                  <table className="w-full text-sm"><thead><tr className="text-left text-gray-500 border-b"><th className="py-1">Metric</th><th>Employee</th><th>Dept Avg</th><th>Org Avg</th></tr></thead>
                    <tbody>
                      {[['Attendance', kpis.attendanceRate, profileData.departmentComparison.department?.attendanceRate, profileData.departmentComparison.org?.attendanceRate, '%'],
                        ['Late Rate', kpis.lateRate, profileData.departmentComparison.department?.lateRate, profileData.departmentComparison.org?.lateRate, '%'],
                        ['Avg Hours', kpis.avgHoursWorked, profileData.departmentComparison.department?.avgHours, profileData.departmentComparison.org?.avgHours, 'h']
                      ].map(([label, emp, dept, org, unit]) => (
                        <tr key={label} className="border-b"><td className="py-1 text-gray-600">{label}</td>
                          <td className="font-medium">{emp?.toFixed(1)}{unit}</td>
                          <td>{dept?.toFixed(1)}{unit}</td><td>{org?.toFixed(1)}{unit}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(profileData.monthlyBreakdown || []).length > 1 && (
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold text-gray-900 mb-3">Monthly Trends</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={(profileData.monthlyBreakdown || []).map(m => ({
                      period: new Date(m.year, m.month - 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
                      'Attendance %': m.attendanceRate,
                      'Late %': m.lateRate,
                      'Avg Hours': m.avgHours
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="period" />
                      <YAxis yAxisId="left" domain={[0, 100]} />
                      <YAxis yAxisId="right" orientation="right" domain={[0, 14]} />
                      <Tooltip />
                      <Legend />
                      <Line yAxisId="left" type="monotone" dataKey="Attendance %" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                      <Line yAxisId="left" type="monotone" dataKey="Late %" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                      <Line yAxisId="right" type="monotone" dataKey="Avg Hours" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              {profileData.departmentComparison && (
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold text-gray-900 mb-3">Performance Radar</h3>
                  <ResponsiveContainer width="100%" height={320}>
                    <RadarChart data={[
                      { metric: 'Attendance', employee: kpis.attendanceRate || 0, department: profileData.departmentComparison.department?.attendanceRate || 0, org: profileData.departmentComparison.org?.attendanceRate || 0 },
                      { metric: 'Punctuality', employee: 100 - (kpis.lateRate || 0), department: 100 - (profileData.departmentComparison.department?.lateRate || 0), org: 100 - (profileData.departmentComparison.org?.lateRate || 0) },
                      { metric: 'Hours', employee: ((kpis.avgHoursWorked || 0) / 12) * 100, department: ((profileData.departmentComparison.department?.avgHours || 0) / 12) * 100, org: ((profileData.departmentComparison.org?.avgHours || 0) / 12) * 100 },
                      { metric: 'Regularity', employee: profileData.regularityScore || 0, department: 65, org: 60 },
                      { metric: 'Low Absence', employee: 100 - (kpis.absenteeismRate || 0), department: 100 - (100 - (profileData.departmentComparison.department?.attendanceRate || 85)), org: 100 - (100 - (profileData.departmentComparison.org?.attendanceRate || 85)) }
                    ]}>
                      <PolarGrid />
                      <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
                      <Radar name="Employee" dataKey="employee" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
                      <Radar name="Dept Avg" dataKey="department" stroke="#9ca3af" fill="none" strokeDasharray="5 5" />
                      <Radar name="Org Avg" dataKey="org" stroke="#d1d5db" fill="none" strokeDasharray="3 3" />
                      <Legend />
                      <Tooltip />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {activeTab === 'attendance' && (
            <div className="space-y-4">
              <div className="bg-white rounded-lg shadow p-4 grid grid-cols-2 md:grid-cols-4 gap-y-3 gap-x-6 text-sm">
                {[['Working Days', kpis.workingDays], ['Present Days', kpis.presentDays?.toFixed(1)], ['Absences', kpis.totalAbsences], ['Half Days', kpis.halfDayCount],
                  ['Late Arrivals', kpis.lateCount], ['Avg Late', (kpis.avgLateMinutes || '-') + ' min'], ['Early Exits', kpis.earlyExitCount], ['Avg Early', (kpis.avgEarlyMinutes || '-') + ' min'],
                  ['OT Days', kpis.otDays], ['Total OT', Math.round((kpis.totalOTMinutes || 0) / 60) + 'h'], ['WOP Days', kpis.wopDays], ['Night Shifts', kpis.nightShiftDays],
                  ['Miss Punches', kpis.missPunchCount], ['Resolved', fmtPct(kpis.missPunchResolutionRate)], ['Holiday Duty', kpis.holidayDutyDays], ['ED Approved', kpis.edDaysApproved]
                ].map(([l, v]) => <div key={l}><span className="text-gray-500">{l}: </span><span className="font-medium">{v ?? '-'}</span></div>)}
              </div>
              {(profileData.arrivalDeparture?.dailyTimes || []).length > 0 && (() => {
                const arrData = (profileData.arrivalDeparture.dailyTimes || []).slice(-90).map(d => {
                  if (!d.inTime) return null;
                  const parts = d.inTime.split(':');
                  const h = parseInt(parts[0]), m = parseInt(parts[1] || '0');
                  if (isNaN(h)) return null;
                  return { date: d.date.slice(5), minutes: h * 60 + m, isLate: d.isLate };
                }).filter(Boolean);
                const onTime = arrData.filter(d => !d.isLate);
                const late = arrData.filter(d => d.isLate);
                const fmtTime = (v) => { const hh = Math.floor(v / 60); const mm = v % 60; return hh + ':' + String(mm).padStart(2, '0'); };
                return (
                  <div className="bg-white rounded-lg shadow p-4">
                    <h3 className="font-semibold text-gray-900 mb-3">Daily Arrival Times (last 90 days)</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <ScatterChart>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" type="category" allowDuplicatedCategory={false}
                          data={[...onTime, ...late].sort((a, b) => a.date.localeCompare(b.date))}
                          tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                        <YAxis dataKey="minutes" type="number" domain={['auto', 'auto']}
                          tickFormatter={fmtTime} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(v, name) => name === 'minutes' ? fmtTime(v) : v}
                          labelFormatter={(l) => 'Date: ' + l} />
                        <Legend />
                        <Scatter name="On Time" data={onTime} fill="#22c55e" />
                        <Scatter name="Late" data={late} fill="#ef4444" />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()}
              {(profileData.monthlyBreakdown || []).length > 0 && (
                <div className="bg-white rounded-lg shadow p-4 overflow-x-auto">
                  <h3 className="font-semibold mb-2">Monthly Breakdown</h3>
                  <table className="w-full text-sm"><thead><tr className="text-left text-gray-500 border-b"><th className="py-1">Period</th><th>Att%</th><th>Absent</th><th>Late</th><th>Late%</th><th>Hrs</th><th>OT</th></tr></thead>
                    <tbody>{profileData.monthlyBreakdown.map((m, i) => (
                      <tr key={i} className="border-b even:bg-gray-50"><td className="py-1">{m.year}-{String(m.month).padStart(2, '0')}</td>
                        <td className={'font-medium ' + (m.attendanceRate >= 90 ? 'text-green-700' : m.attendanceRate >= 75 ? 'text-yellow-700' : 'text-red-700')}>{m.attendanceRate?.toFixed(1)}%</td>
                        <td>{m.absences}</td><td>{m.lateCount}</td><td>{m.lateRate?.toFixed(1)}%</td><td>{m.avgHours?.toFixed(1)}</td><td>{m.otDays}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              <div className="bg-white rounded-lg shadow p-4">
                <h3 className="font-semibold mb-2">Corrections ({(profileData.corrections?.dayCorrections?.length || 0) + (profileData.corrections?.punchCorrections?.length || 0) + (profileData.corrections?.lateDeductions?.length || 0)})</h3>
                {(profileData.corrections?.dayCorrections?.length || 0) === 0 && (profileData.corrections?.punchCorrections?.length || 0) === 0 && (profileData.corrections?.lateDeductions?.length || 0) === 0
                  ? <p className="text-gray-400 text-sm">No corrections in this period</p>
                  : <div className="text-sm space-y-2">
                      {(profileData.corrections?.dayCorrections || []).map((c, i) => <div key={'dc' + i} className="p-2 bg-gray-50 rounded">Day correction {c.month}/{c.year}: {c.correction_delta > 0 ? '+' : ''}{c.correction_delta} days — {c.remark || c.correction_reason} (by {c.corrected_by})</div>)}
                      {(profileData.corrections?.lateDeductions || []).map((c, i) => <div key={'ld' + i} className="p-2 bg-yellow-50 rounded">Late deduction {c.month}/{c.year}: {c.deduction_days} days — {c.remark} ({c.finance_status})</div>)}
                    </div>
                }
              </div>
            </div>
          )}

          {activeTab === 'salary' && (
            <div className="space-y-4">
              {profileData.salaryHistory?.totals && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <KPI label="Total Gross Earned" value={'₹' + fmt(profileData.salaryHistory.totals.totalGrossEarned)} />
                  <KPI label="Total Net Salary" value={'₹' + fmt(profileData.salaryHistory.totals.totalNetSalary)} />
                  <KPI label="Total Take Home" value={'₹' + fmt(profileData.salaryHistory.totals.totalTakeHome)} />
                  <KPI label="Total Deductions" value={'₹' + fmt(profileData.salaryHistory.totals.totalDeductions)} />
                </div>
              )}
              {(profileData.salaryHistory?.months || []).length > 1 && (
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold text-gray-900 mb-3">Monthly Salary Breakdown</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={(profileData.salaryHistory?.months || []).map(m => ({
                      period: new Date(m.year, m.month - 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
                      'Gross Earned': m.gross_earned || 0,
                      'Deductions': m.total_deductions || 0,
                      'OT + ED': (m.ot_pay || 0) + (m.ed_pay || 0)
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="period" />
                      <YAxis tickFormatter={v => '\u20B9' + (v / 1000).toFixed(0) + 'k'} />
                      <Tooltip formatter={v => '\u20B9' + Number(v).toLocaleString('en-IN')} />
                      <Legend />
                      <Bar dataKey="Gross Earned" fill="#93c5fd" />
                      <Bar dataKey="Deductions" fill="#fca5a5" />
                      <Bar dataKey="OT + ED" fill="#86efac" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {(profileData.salaryHistory?.months || []).length > 0 && (
                <div className="bg-white rounded-lg shadow p-4 overflow-x-auto">
                  <table className="w-full text-sm"><thead><tr className="text-left text-gray-500 border-b"><th className="py-1">Period</th><th>Gross</th><th>Net</th><th>Take Home</th><th>Deductions</th><th>OT</th><th>ED</th></tr></thead>
                    <tbody>{profileData.salaryHistory.months.map((m, i) => (
                      <tr key={i} className="border-b even:bg-gray-50"><td className="py-1">{m.year}-{String(m.month).padStart(2, '0')}</td>
                        <td>₹{fmt(m.gross_earned)}</td><td>₹{fmt(m.net_salary)}</td><td className="font-medium">₹{fmt(m.take_home)}</td>
                        <td>₹{fmt(m.total_deductions)}</td><td>₹{fmt(m.ot_pay)}</td><td>₹{fmt(m.ed_pay)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'patterns' && (
            <div className="space-y-6">
              {profileData.patternAnalysis ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                      ['Flight Risk', profileData.patternAnalysis.compositeScores?.flightRisk, v => v >= 60 ? 'red' : v >= 30 ? 'yellow' : 'green'],
                      ['Engagement', profileData.patternAnalysis.compositeScores?.engagement, v => v >= 75 ? 'green' : v >= 50 ? 'yellow' : 'red'],
                      ['Reliability', profileData.patternAnalysis.compositeScores?.reliability, v => v >= 80 ? 'green' : v >= 60 ? 'yellow' : 'red']
                    ].map(([label, score, colorFn]) => {
                      const s = score ?? 0;
                      const c = colorFn(s);
                      const border = c === 'green' ? 'border-green-500 bg-green-50 text-green-700' : c === 'yellow' ? 'border-yellow-500 bg-yellow-50 text-yellow-700' : 'border-red-500 bg-red-50 text-red-700';
                      const barColor = c === 'green' ? '#22c55e' : c === 'yellow' ? '#eab308' : '#ef4444';
                      return (
                        <div key={label} className={`rounded-lg border-l-4 p-4 ${border}`}>
                          <div className="text-sm font-medium opacity-75">{label}</div>
                          <div className="text-3xl font-bold">{Math.round(s)}<span className="text-lg">/100</span></div>
                          <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500" style={{ width: Math.min(s, 100) + '%', backgroundColor: barColor }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap gap-2 text-sm">
                    {(profileData.patternAnalysis.summary?.criticalCount > 0) && <span className="px-2 py-1 bg-red-100 text-red-800 rounded-full">{profileData.patternAnalysis.summary.criticalCount} Critical</span>}
                    {(profileData.patternAnalysis.summary?.highCount > 0) && <span className="px-2 py-1 bg-orange-100 text-orange-800 rounded-full">{profileData.patternAnalysis.summary.highCount} High</span>}
                    {(profileData.patternAnalysis.summary?.mediumCount > 0) && <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full">{profileData.patternAnalysis.summary.mediumCount} Medium</span>}
                    {(profileData.patternAnalysis.summary?.lowCount > 0) && <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full">{profileData.patternAnalysis.summary.lowCount} Low</span>}
                    {(profileData.patternAnalysis.patterns || []).length === 0 && <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full">No patterns flagged</span>}
                  </div>

                  <div className="space-y-3">
                    {(profileData.patternAnalysis.patterns || [])
                      .sort((a, b) => {
                        const sev = { Critical: 0, High: 1, Medium: 2, Low: 3 };
                        return (sev[a.severity] ?? 4) - (sev[b.severity] ?? 4);
                      })
                      .map((p, i) => {
                        const styles = {
                          Critical: 'border-red-500 bg-red-50',
                          High: 'border-orange-400 bg-orange-50',
                          Medium: 'border-yellow-400 bg-yellow-50',
                          Low: 'border-blue-300 bg-blue-50'
                        };
                        const badges = {
                          Critical: 'bg-red-600 text-white',
                          High: 'bg-orange-500 text-white',
                          Medium: 'bg-yellow-500 text-white',
                          Low: 'bg-blue-500 text-white'
                        };
                        return (
                          <div key={i} className={`rounded-lg border-l-4 p-4 ${styles[p.severity] || 'border-gray-300 bg-gray-50'}`}>
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${badges[p.severity]}`}>{p.severity}</span>
                                <span className="font-semibold text-gray-900">{p.label}</span>
                                {p.category && <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded">{p.category}</span>}
                              </div>
                              <span className="text-lg font-bold text-gray-700">{p.score}/100</span>
                            </div>
                            <p className="mt-1 text-sm text-gray-700">{p.detail}</p>
                            {p.hrAction && <p className="mt-2 text-xs text-gray-500 italic">Recommended: {p.hrAction}</p>}
                          </div>
                        );
                      })}
                  </div>
                </>
              ) : (
                <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">Pattern analysis not available</div>
              )}
            </div>
          )}

          {activeTab === 'aiReview' && (
            <div className="space-y-4">
              {!aiReview && !aiLoading && (
                <div className="bg-white rounded-lg shadow p-8 text-center">
                  <div className="text-4xl mb-3">🤖</div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">AI-Powered Employee Review</h3>
                  <p className="text-gray-500 text-sm mb-4 max-w-md mx-auto">
                    Generate a qualitative assessment powered by Claude AI. Analyzes attendance patterns, behavioral signals, salary data, and department benchmarks.
                  </p>
                  <button onClick={async () => {
                    setAiLoading(true); setAiError('');
                    try {
                      const r = await api.post('/analytics/employee/' + selectedCode + '/ai-review', { from: fromDate, to: toDate });
                      if (r.data?.success) setAiReview(r.data.data);
                      else setAiError(r.data?.error || 'Failed');
                    } catch (e) { setAiError(e.response?.data?.error || e.message || 'Failed to generate AI review'); }
                    finally { setAiLoading(false); }
                  }} className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium">
                    Generate AI Review
                  </button>
                  {aiError && <p className="mt-3 text-red-600 text-sm">{aiError}</p>}
                </div>
              )}

              {aiLoading && (
                <div className="bg-white rounded-lg shadow p-8 text-center">
                  <div className="animate-spin h-8 w-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full mx-auto mb-4" />
                  <p className="text-gray-600">Analyzing employee data and generating review...</p>
                  <p className="text-gray-400 text-sm mt-1">This typically takes 5-10 seconds</p>
                </div>
              )}

              {aiReview && !aiLoading && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2 text-sm text-gray-500 flex-wrap gap-2">
                    <span>Generated {new Date(aiReview.generatedAt).toLocaleString('en-IN')}</span>
                    <span>Tokens: {(aiReview.usage?.input_tokens || 0) + (aiReview.usage?.output_tokens || 0)}</span>
                    <button onClick={async () => {
                      setAiLoading(true); setAiError('');
                      try {
                        const r = await api.post('/analytics/employee/' + selectedCode + '/ai-review', { from: fromDate, to: toDate });
                        if (r.data?.success) setAiReview(r.data.data);
                        else setAiError(r.data?.error || 'Failed');
                      } catch (e) { setAiError(e.response?.data?.error || e.message); }
                      finally { setAiLoading(false); }
                    }} className="text-indigo-600 hover:text-indigo-800 font-medium">Regenerate</button>
                  </div>

                  {[
                    ['Executive Summary', aiReview.sections?.executiveSummary, '📋', 'border-gray-400'],
                    ['Key Strengths', aiReview.sections?.strengths, '💪', 'border-green-500'],
                    ['Areas of Concern', aiReview.sections?.concerns, '⚠️', 'border-orange-500'],
                    ['Risk Assessment', aiReview.sections?.riskAssessment, '📊', 'border-blue-500'],
                    ['Recommendations', aiReview.sections?.recommendations, '💡', 'border-indigo-500'],
                    ['Department Context', aiReview.sections?.departmentContext, '👥', 'border-gray-400']
                  ].filter(([, content]) => content).map(([title, content, icon, border]) => (
                    <div key={title} className={`bg-white rounded-lg shadow border-l-4 ${border} p-5`}>
                      <h3 className="font-semibold text-gray-900 mb-2">{icon} {title}</h3>
                      <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{content}</div>
                    </div>
                  ))}

                  {!aiReview.sections?.executiveSummary && aiReview.narrative && (
                    <div className="bg-white rounded-lg shadow p-6">
                      <div className="text-sm text-gray-700 whitespace-pre-wrap">{aiReview.narrative}</div>
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

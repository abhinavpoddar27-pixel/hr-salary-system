import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function DeptAnalytics() {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [deptData, setDeptData] = useState(null);
  const [orgData, setOrgData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('health');

  useEffect(() => {
    const t = new Date(), s = new Date();
    s.setMonth(t.getMonth() - 6);
    setToDate(t.toISOString().split('T')[0]);
    setFromDate(s.toISOString().split('T')[0]);
  }, []);

  const fetchData = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setLoading(true); setError('');
    try {
      const [dR, oR] = await Promise.all([
        api.get('/analytics/department-dashboard?from=' + fromDate + '&to=' + toDate),
        api.get('/analytics/org-metrics?from=' + fromDate + '&to=' + toDate)
      ]);
      if (dR.data?.success) setDeptData(dR.data.data);
      if (oR.data?.success) setOrgData(oR.data.data);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }, [fromDate, toDate]);

  useEffect(() => { if (fromDate && toDate) fetchData(); }, [fromDate, toDate, fetchData]);

  const fmt = (n) => n != null ? Number(n).toLocaleString('en-IN') : '-';
  const tabs = ['health', 'overtime', 'org', 'costs', 'alerts'];

  return (
    <div className="max-w-7xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Department & Organization Analytics</h1>
      <div className="bg-white rounded-lg shadow p-4 mb-4 flex flex-wrap gap-4 items-end">
        <div><label className="block text-sm font-medium text-gray-700 mb-1">From</label><input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="border rounded px-3 py-2 text-sm" /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">To</label><input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="border rounded px-3 py-2 text-sm" /></div>
        <button onClick={fetchData} className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm">Refresh</button>
      </div>

      {loading && <div className="bg-white rounded-lg shadow p-12 text-center"><div className="animate-spin h-8 w-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full mx-auto" /></div>}
      {error && <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700 mb-4">{error}</div>}

      {(deptData || orgData) && !loading && (
        <>
          {orgData && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
                <div className="text-xs text-gray-500">Workforce Utilization</div>
                <div className="text-2xl font-bold">{orgData.workforceUtilization?.utilizationRate || 0}%</div>
              </div>
              <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
                <div className="text-xs text-gray-500">Stability Index</div>
                <div className="text-2xl font-bold">{orgData.stabilityIndex?.stabilityIndex || 0}/100</div>
                <div className="text-xs text-gray-400">{orgData.stabilityIndex?.interpretation}</div>
              </div>
              <div className="bg-white rounded-lg shadow p-4 border-l-4 border-red-500">
                <div className="text-xs text-gray-500">Absenteeism Cost</div>
                <div className="text-2xl font-bold">₹{fmt(orgData.absenteeismCost?.totalAbsenteeismCost)}</div>
              </div>
              <div className="bg-white rounded-lg shadow p-4 border-l-4 border-indigo-500">
                <div className="text-xs text-gray-500">On-Time Rate</div>
                <div className="text-2xl font-bold">{orgData.punctualityCurve?.pctOnTime || 0}%</div>
              </div>
            </div>
          )}

          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4 overflow-x-auto">
            {tabs.map(t => <button key={t} onClick={() => setActiveTab(t)} className={'px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap ' + (activeTab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500')}>{t === 'org' ? 'Org Trends' : t.charAt(0).toUpperCase() + t.slice(1)}</button>)}
          </div>

          {activeTab === 'health' && deptData?.departments && (
            <div className="space-y-4">
              <div className="bg-white rounded-lg shadow p-4 overflow-x-auto">
                <h3 className="font-semibold mb-3">Department Health Ranking</h3>
                <table className="w-full text-sm"><thead><tr className="text-left text-gray-500 border-b">
                  <th className="py-2">Rank</th><th>Department</th><th>Score</th><th>Head</th><th>Att%</th><th>Punct%</th><th>Hrs</th><th>Late%</th><th>Trend</th><th>Contr.</th>
                </tr></thead><tbody>
                  {deptData.departments.map(d => (
                    <tr key={d.department} className="border-b even:bg-gray-50">
                      <td className="py-2 font-medium">#{d.rank}</td>
                      <td className="font-medium">{d.department}</td>
                      <td className={'font-bold ' + (d.healthScore >= 80 ? 'text-green-700' : d.healthScore >= 60 ? 'text-yellow-700' : 'text-red-700')}>{d.healthScore}</td>
                      <td>{d.headcount}</td>
                      <td>{d.attendanceRate}%</td>
                      <td>{d.punctualityRate}%</td>
                      <td>{d.avgHours}</td>
                      <td>{d.lateRate}%</td>
                      <td>{d.trend === 'improving' ? '↑' : d.trend === 'declining' ? '↓' : '→'}</td>
                      <td>{d.contractorCount}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
              {deptData.departments.length > 1 && (
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold mb-3">Health Score Comparison</h3>
                  <ResponsiveContainer width="100%" height={Math.max(200, deptData.departments.length * 40)}>
                    <BarChart layout="vertical" data={deptData.departments.map(d => ({ name: d.department, score: d.healthScore }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" domain={[0, 100]} />
                      <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="score" fill="#6366f1" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {activeTab === 'overtime' && deptData && (
            <div className="space-y-4">
              {(deptData.otConcentration || []).length > 0 && (
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold mb-3">OT Concentration (Gini Coefficient)</h3>
                  <p className="text-xs text-gray-500 mb-3">0 = perfectly equal OT distribution, 1 = one person does all OT. Above 0.6 = highly concentrated.</p>
                  <ResponsiveContainer width="100%" height={Math.max(200, deptData.otConcentration.length * 40)}>
                    <BarChart layout="vertical" data={deptData.otConcentration.map(d => ({ name: d.department, gini: d.giniCoefficient }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" domain={[0, 1]} />
                      <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={v => v.toFixed(2)} />
                      <Bar dataKey="gini" radius={[0, 4, 4, 0]}>
                        {deptData.otConcentration.map((d, i) => (
                          <Cell key={i} fill={d.giniCoefficient > 0.6 ? '#ef4444' : d.giniCoefficient > 0.4 ? '#f59e0b' : '#22c55e'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {(deptData.nightShiftBurden || []).length > 0 && (
                <div className="bg-white rounded-lg shadow p-4 overflow-x-auto">
                  <h3 className="font-semibold mb-3">Night Shift Burden</h3>
                  <table className="w-full text-sm"><thead><tr className="text-left text-gray-500 border-b">
                    <th className="py-2">Department</th><th>Night Ratio</th><th>Org Avg</th><th>Burden</th><th>Status</th>
                  </tr></thead><tbody>
                    {deptData.nightShiftBurden.map(d => (
                      <tr key={d.department} className="border-b even:bg-gray-50">
                        <td className="py-2 font-medium">{d.department}</td>
                        <td>{d.nightRatio}%</td><td>{d.orgAvgNightRatio}%</td>
                        <td className="font-medium">{d.burden}x</td>
                        <td>{d.flagged ? <span className="text-red-600 font-medium">⚠ Overburdened</span> : <span className="text-green-600">Normal</span>}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              )}
              {(deptData.attendanceInequality || []).length > 0 && (
                <div className="bg-white rounded-lg shadow p-4 overflow-x-auto">
                  <h3 className="font-semibold mb-3">Attendance Inequality</h3>
                  <p className="text-xs text-gray-500 mb-2">CV &gt; 1.0 or range &gt; 25pp suggests unequal attendance standards within the department.</p>
                  <table className="w-full text-sm"><thead><tr className="text-left text-gray-500 border-b">
                    <th className="py-2">Department</th><th>CV</th><th>Range</th><th>Mean Absence</th><th>Status</th>
                  </tr></thead><tbody>
                    {deptData.attendanceInequality.map(d => (
                      <tr key={d.department} className="border-b even:bg-gray-50">
                        <td className="py-2 font-medium">{d.department}</td>
                        <td>{d.cv}</td><td>{d.range}pp</td><td>{d.meanAbsenceRate}%</td>
                        <td>{d.flagged ? <span className="text-red-600 font-medium">⚠ Unequal</span> : <span className="text-green-600">Fair</span>}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'org' && orgData && (
            <div className="space-y-4">
              {orgData.punctualityCurve?.bins && (
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold mb-1">Arrival Time Distribution</h3>
                  <p className="text-xs text-gray-500 mb-3">Minutes relative to shift start. Median offset: {orgData.punctualityCurve.medianOffset} min. Late &gt;15min: {orgData.punctualityCurve.pctLate15Plus}%</p>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={orgData.punctualityCurve.bins}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="offset" tickFormatter={v => (v > 0 ? '+' : '') + v} tick={{ fontSize: 10 }} />
                      <YAxis />
                      <Tooltip labelFormatter={v => (v > 0 ? '+' : '') + v + ' min'} />
                      <Bar dataKey="count">
                        {orgData.punctualityCurve.bins.map((b, i) => (
                          <Cell key={i} fill={b.offset >= -5 && b.offset <= 5 ? '#22c55e' : b.offset <= 15 ? '#f59e0b' : '#ef4444'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {orgData.contractorPermanentGap?.monthly?.length > 1 && (
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold mb-1">Contractor vs Permanent Attendance</h3>
                  <p className="text-xs text-gray-500 mb-3">Avg gap: {orgData.contractorPermanentGap.avgGap}pp {orgData.contractorPermanentGap.flagged ? '⚠ Significant' : ''}</p>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={orgData.contractorPermanentGap.monthly.map(m => ({
                      period: m.year + '-' + String(m.month).padStart(2, '0'),
                      Permanent: m.permRate,
                      Contractor: m.contractorRate
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="period" />
                      <YAxis domain={[0, 100]} />
                      <Tooltip formatter={v => v != null ? v + '%' : 'N/A'} />
                      <Legend />
                      <Line type="monotone" dataKey="Permanent" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="Contractor" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              {orgData.workforceUtilization && (
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold mb-3">Workforce Utilization Breakdown</h3>
                  <div className="flex h-8 rounded-full overflow-hidden text-xs text-white font-medium">
                    {[
                      ['Actual', orgData.workforceUtilization.actualHours, '#22c55e'],
                      ['Absence', orgData.workforceUtilization.absenceLoss, '#ef4444'],
                      ['Late', orgData.workforceUtilization.lateLoss, '#f59e0b'],
                      ['Early', orgData.workforceUtilization.earlyLoss, '#fb923c'],
                      ['Other', orgData.workforceUtilization.otherLoss, '#9ca3af']
                    ].filter(([, v]) => v > 0).map(([label, val, color]) => {
                      const pct = orgData.workforceUtilization.expectedHours > 0 ? (val / orgData.workforceUtilization.expectedHours * 100) : 0;
                      return pct > 2 ? <div key={label} style={{ width: pct + '%', backgroundColor: color }} className="flex items-center justify-center">{label} {Math.round(pct)}%</div> : null;
                    })}
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-gray-500">
                    <span>Expected: {orgData.workforceUtilization.expectedHours?.toLocaleString()}h</span>
                    <span>Actual: {orgData.workforceUtilization.actualHours?.toLocaleString()}h</span>
                    <span>Employees: {orgData.workforceUtilization.activeEmployees}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'costs' && orgData && (
            <div className="space-y-4">
              {orgData.absenteeismCost && (
                <>
                  <div className="bg-white rounded-lg shadow p-6 text-center">
                    <div className="text-sm text-gray-500 mb-1">Total Absenteeism Cost</div>
                    <div className="text-4xl font-bold text-red-700">₹{Number(orgData.absenteeismCost.totalAbsenteeismCost || 0).toLocaleString('en-IN')}</div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-white rounded-lg shadow p-4"><div className="text-xs text-gray-500">Direct Absence Cost</div><div className="text-xl font-bold">₹{Number(orgData.absenteeismCost.directAbsenceCost || 0).toLocaleString('en-IN')}</div></div>
                    <div className="bg-white rounded-lg shadow p-4"><div className="text-xs text-gray-500">Lateness Cost</div><div className="text-xl font-bold">₹{Number(orgData.absenteeismCost.latenessCost || 0).toLocaleString('en-IN')}</div></div>
                    <div className="bg-white rounded-lg shadow p-4"><div className="text-xs text-gray-500">Absent Days</div><div className="text-xl font-bold">{orgData.absenteeismCost.totalAbsentDays}</div></div>
                    <div className="bg-white rounded-lg shadow p-4"><div className="text-xs text-gray-500">Avg Cost / Absent Day</div><div className="text-xl font-bold">₹{Number(orgData.absenteeismCost.avgCostPerAbsentDay || 0).toLocaleString('en-IN')}</div></div>
                  </div>
                  {(orgData.absenteeismCost.topDepartmentsByAbsenteeismCost || []).length > 0 && (
                    <div className="bg-white rounded-lg shadow p-4 overflow-x-auto">
                      <h3 className="font-semibold mb-3">Top 5 Departments by Absenteeism Cost</h3>
                      <table className="w-full text-sm"><thead><tr className="text-left text-gray-500 border-b">
                        <th className="py-2">#</th><th>Department</th><th>Cost</th><th>Absent Days</th>
                      </tr></thead><tbody>
                        {orgData.absenteeismCost.topDepartmentsByAbsenteeismCost.map((d, i) => (
                          <tr key={d.department} className="border-b even:bg-gray-50">
                            <td className="py-2">{i + 1}</td><td className="font-medium">{d.department}</td>
                            <td className="font-bold text-red-700">₹{Number(d.cost || 0).toLocaleString('en-IN')}</td>
                            <td>{d.absentDays}</td>
                          </tr>
                        ))}
                      </tbody></table>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {activeTab === 'alerts' && (
            <div className="space-y-4">
              {(orgData?.coordinatedAbsenceAlerts || []).length > 0 ? (
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold mb-3 text-red-700">Coordinated Absence Alerts</h3>
                  <p className="text-xs text-gray-500 mb-3">Days where &gt;40% of a department was absent without notice. May indicate informal protest or grievance.</p>
                  <div className="space-y-2">
                    {orgData.coordinatedAbsenceAlerts.map((a, i) => (
                      <div key={i} className="border-l-4 border-red-500 bg-red-50 rounded p-3 flex justify-between items-center flex-wrap gap-2">
                        <div>
                          <span className="font-medium text-gray-900">{a.department}</span>
                          <span className="text-sm text-gray-500 ml-2">{a.date}</span>
                        </div>
                        <div className="text-sm">
                          <span className="font-bold text-red-700">{a.absentCount}/{a.deptSize}</span>
                          <span className="text-gray-500 ml-1">({a.rate}% absent)</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-green-50 rounded-lg shadow p-6 text-center text-green-700">
                  <div className="text-2xl mb-2">✓</div>
                  <p className="font-medium">No coordinated absence alerts</p>
                  <p className="text-sm text-green-600">No department had &gt;40% unplanned absence on any single day</p>
                </div>
              )}

              {(deptData?.nightShiftBurden || []).filter(d => d.flagged).length > 0 && (
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold mb-3 text-orange-700">Overburdened Night Shift Departments</h3>
                  <div className="space-y-2">
                    {deptData.nightShiftBurden.filter(d => d.flagged).map(d => (
                      <div key={d.department} className="border-l-4 border-orange-400 bg-orange-50 rounded p-3 flex justify-between">
                        <span className="font-medium">{d.department}</span>
                        <span className="text-sm">{d.burden}x org average ({d.nightRatio}% vs {d.orgAvgNightRatio}%)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(deptData?.attendanceInequality || []).filter(d => d.flagged).length > 0 && (
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold mb-3 text-yellow-700">Unequal Attendance Standards</h3>
                  <div className="space-y-2">
                    {deptData.attendanceInequality.filter(d => d.flagged).map(d => (
                      <div key={d.department} className="border-l-4 border-yellow-400 bg-yellow-50 rounded p-3 flex justify-between">
                        <span className="font-medium">{d.department}</span>
                        <span className="text-sm">CV: {d.cv} | Range: {d.range}pp | Mean absence: {d.meanAbsenceRate}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(deptData?.departments || []).filter(d => d.healthScore < 60).length > 0 && (
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold mb-3 text-red-700">Low Health Score Departments</h3>
                  <div className="space-y-2">
                    {deptData.departments.filter(d => d.healthScore < 60).map(d => (
                      <div key={d.department} className="border-l-4 border-red-400 bg-red-50 rounded p-3 flex justify-between">
                        <span className="font-medium">{d.department}</span>
                        <span className="text-sm font-bold text-red-700">Score: {d.healthScore}/100 ({d.trend})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

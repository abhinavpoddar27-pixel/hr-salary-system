import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

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

          {activeTab !== 'health' && (
            <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">
              {activeTab} tab — content coming in next prompt
            </div>
          )}
        </>
      )}
    </div>
  );
}

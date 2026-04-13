import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import { fmtINR, fmtDate } from '../utils/formatters';

const pct1 = v => `${(+(v || 0)).toFixed(1)}%`;
const kpiColor = (value, t) => t.green(value) ? 'border-green-500 bg-green-50' : t.yellow(value) ? 'border-yellow-500 bg-yellow-50' : 'border-red-500 bg-red-50';
const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'salary', label: 'Salary' },
  { key: 'patterns', label: 'Patterns' },
  { key: 'aiReview', label: 'AI Review' },
];

// ── Sub-Components ───────────────────────────────────────────────────────────

const IdentityCard = ({ emp }) => {
  const tenure = emp.tenureMonths != null
    ? `${Math.floor(emp.tenureMonths / 12)}y ${emp.tenureMonths % 12}m`
    : null;
  const isActive = emp.status === 'Active';

  return (
    <div className="bg-white rounded-lg shadow p-6 grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
      <div>
        <p className="text-xl font-bold text-gray-900">{emp.name}</p>
        <p className="text-sm text-gray-500">{emp.code}</p>
        <p className="text-sm text-gray-600">{emp.designation || '—'}</p>
      </div>
      <div className="text-sm space-y-1">
        <p><span className="text-gray-500">Department:</span> <span className="font-medium">{emp.department || '—'}</span></p>
        <p><span className="text-gray-500">Company:</span> <span className="font-medium">{emp.company || '—'}</span></p>
        <p><span className="text-gray-500">Type:</span> <span className="font-medium">{emp.employment_type || '—'}</span></p>
        <p><span className="text-gray-500">Shift:</span> <span className="font-medium">{emp.shift_code || '—'}</span></p>
        <p><span className="text-gray-500">Weekly Off:</span> <span className="font-medium">{emp.weekly_off_day || '—'}</span></p>
      </div>
      <div className="text-sm space-y-1 md:text-right">
        <p>
          <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${
            isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>{emp.status}</span>
        </p>
        <p><span className="text-gray-500">DOJ:</span> <span className="font-medium">{fmtDate(emp.date_of_joining)}</span></p>
        {tenure && <p><span className="text-gray-500">Tenure:</span> <span className="font-medium">{tenure}</span></p>}
        {emp.date_of_exit && <p><span className="text-gray-500">Exit:</span> <span className="font-medium">{fmtDate(emp.date_of_exit)}</span></p>}
      </div>
    </div>
  );
};

const KPICard = ({ label, value, thresholds }) => {
  const cls = thresholds ? kpiColor(parseFloat(value) || 0, thresholds) : 'border-blue-500 bg-blue-50';
  return (
    <div className={`bg-white rounded-lg shadow p-4 border-l-4 ${cls}`}>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value ?? '—'}</p>
    </div>
  );
};

const KPICards = ({ kpis, regularityScore }) => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
    <KPICard label="Attendance Rate" value={pct1(kpis.attendanceRate)}
      thresholds={{ green: v => v > 90, yellow: v => v > 75 }} />
    <KPICard label="Late Rate" value={pct1(kpis.lateRate)}
      thresholds={{ green: v => v < 10, yellow: v => v < 20 }} />
    <KPICard label="Avg Hours" value={kpis.avgHoursWorked != null ? kpis.avgHoursWorked.toFixed(1) : '—'}
      thresholds={{ green: v => v > 9, yellow: v => v > 7 }} />
    <KPICard label="Regularity Score" value={regularityScore != null ? `${regularityScore}/100` : '—'}
      thresholds={{ green: v => v > 80, yellow: v => v > 60 }} />
    <KPICard label="Absences" value={kpis.totalAbsences} />
    <KPICard label="OT Days" value={kpis.otDays} />
    <KPICard label="Miss Punches" value={`${kpis.missPunchCount}${kpis.missPunchResolutionRate != null ? ` (${pct1(kpis.missPunchResolutionRate)} resolved)` : ''}`} />
    <KPICard label="Early Exits" value={kpis.earlyExitCount} />
  </div>
);

const StreaksCard = ({ streaks }) => (
  <div className="bg-white rounded-lg shadow p-4 mb-4">
    <h3 className="text-sm font-semibold text-gray-700 mb-2">Streaks</h3>
    <div className="flex flex-wrap gap-6 text-sm">
      <span className="text-green-700">Best present streak: <strong>{streaks.maxPresentStreak}</strong> days</span>
      <span className="text-red-700">Longest absence streak: <strong>{streaks.maxAbsentStreak}</strong> days</span>
      {streaks.currentStreak?.type && (
        <span className={streaks.currentStreak.type === 'present' ? 'text-green-600' : 'text-red-600'}>
          Current: <strong>{streaks.currentStreak.type}</strong> for {streaks.currentStreak.days} days
        </span>
      )}
    </div>
  </div>
);

const DeptComparison = ({ dc }) => {
  if (!dc) return null;
  const rows = [
    { label: 'Attendance Rate', emp: dc.employee.attendanceRate, dept: dc.department.attendanceRate, org: dc.org.attendanceRate, unit: '%', higher: true },
    { label: 'Late Rate', emp: dc.employee.lateRate, dept: dc.department.lateRate, org: dc.org.lateRate, unit: '%', higher: false },
    { label: 'Avg Hours', emp: dc.employee.avgHours, dept: dc.department.avgHours, org: dc.org.avgHours, unit: '', higher: true },
    { label: 'Early Exit Rate', emp: dc.employee.earlyExitRate, dept: dc.department.earlyExitRate, org: dc.org.earlyExitRate, unit: '%', higher: false },
  ];

  const cellColor = (emp, dept, higherIsBetter) => {
    if (emp == null || dept == null) return '';
    if (higherIsBetter) return emp >= dept ? 'text-green-700 font-semibold' : 'text-red-600';
    return emp <= dept ? 'text-green-700 font-semibold' : 'text-red-600';
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">
        Department Comparison {dc.departmentName ? `(${dc.departmentName})` : ''}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-gray-500">
            <th className="text-left py-1 pr-4">Metric</th>
            <th className="text-right py-1 px-2">Employee</th>
            <th className="text-right py-1 px-2">Dept Avg</th>
            <th className="text-right py-1 px-2">Org Avg</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label} className="border-b last:border-0">
                <td className="py-1.5 pr-4 text-gray-600">{r.label}</td>
                <td className={`text-right py-1.5 px-2 ${cellColor(r.emp, r.dept, r.higher)}`}>
                  {r.emp != null ? `${r.emp}${r.unit}` : '—'}
                </td>
                <td className="text-right py-1.5 px-2 text-gray-600">{r.dept != null ? `${r.dept}${r.unit}` : '—'}</td>
                <td className="text-right py-1.5 px-2 text-gray-500">{r.org != null ? `${r.org}${r.unit}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const OverviewTab = ({ profileData }) => (
  <>
    <KPICards kpis={profileData.kpis} regularityScore={profileData.regularityScore} />
    <StreaksCard streaks={profileData.streaks} />
    <DeptComparison dc={profileData.departmentComparison} />
  </>
);

const DetailMetrics = ({ kpis }) => {
  const items = [
    ['Working Days', kpis.workingDays],
    ['Present Days', kpis.presentDays],
    ['Absences', kpis.totalAbsences],
    ['Half Days', kpis.halfDayCount],
    ['Late Arrivals', kpis.lateCount],
    ['Avg Late', kpis.avgLateMinutes != null ? `${kpis.avgLateMinutes} min` : '—'],
    ['Early Exits', kpis.earlyExitCount],
    ['Avg Early', kpis.avgEarlyMinutes != null ? `${kpis.avgEarlyMinutes} min` : '—'],
    ['OT Days', kpis.otDays],
    ['Total OT', kpis.totalOTMinutes != null ? `${Math.floor(kpis.totalOTMinutes / 60)}h ${kpis.totalOTMinutes % 60}m` : '—'],
    ['WOP Days', kpis.wopDays],
    ['Night Shifts', kpis.nightShiftDays],
    ['Miss Punches', kpis.missPunchCount],
    ['Resolution', kpis.missPunchResolutionRate != null ? pct1(kpis.missPunchResolutionRate) : '—'],
    ['Holiday Duty', kpis.holidayDutyDays],
    ['ED Approved', kpis.edDaysApproved],
  ];
  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Detailed Metrics</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-sm">
        {items.map(([label, val]) => (
          <div key={label} className="flex justify-between py-1 border-b border-gray-100">
            <span className="text-gray-500">{label}</span>
            <span className="font-semibold text-gray-900">{val ?? '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const MonthlyBreakdownTable = ({ months }) => {
  if (!months?.length) return <p className="text-sm text-gray-400">No monthly data available.</p>;
  const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto mb-4">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            {['Period', 'Attendance', 'Absences', 'Late', 'Late%', 'Avg Hrs', 'OT Days', 'Early Exit'].map(h => (
              <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.map((m, i) => (
            <tr key={i} className="border-t even:bg-gray-50">
              <td className="px-3 py-2 font-medium">{MONTHS[m.month]} {m.year}</td>
              <td className={`px-3 py-2 font-semibold ${m.attendanceRate >= 90 ? 'text-green-700' : m.attendanceRate >= 75 ? 'text-yellow-600' : 'text-red-600'}`}>
                {pct1(m.attendanceRate)}
              </td>
              <td className="px-3 py-2">{m.absences}</td>
              <td className="px-3 py-2">{m.lateCount}</td>
              <td className="px-3 py-2">{pct1(m.lateRate)}</td>
              <td className="px-3 py-2">{m.avgHours != null ? m.avgHours.toFixed(1) : '—'}</td>
              <td className="px-3 py-2">{m.otDays}</td>
              <td className="px-3 py-2">{m.earlyExitCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const CorrectionsSection = ({ corrections }) => {
  const { dayCorrections = [], punchCorrections = [], lateDeductions = [] } = corrections || {};
  const [openSection, setOpenSection] = useState(null);

  const Section = ({ title, count, sectionKey, children }) => (
    <div className="border rounded-lg mb-2">
      <button className="w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        onClick={() => setOpenSection(openSection === sectionKey ? null : sectionKey)}>
        <span>{title} <span className="text-xs bg-gray-200 rounded-full px-2 py-0.5 ml-1">{count}</span></span>
        <span className="text-xs">{openSection === sectionKey ? '▲' : '▼'}</span>
      </button>
      {openSection === sectionKey && <div className="px-4 pb-3">{children}</div>}
    </div>
  );

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Corrections History</h3>
      <Section title="Day Corrections" count={dayCorrections.length} sectionKey="day">
        {dayCorrections.length === 0 ? <p className="text-xs text-gray-400">No corrections</p> : (
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500 border-b">
              <th className="text-left py-1">Month</th><th className="text-left py-1">Type</th>
              <th className="text-right py-1">Delta</th><th className="text-left py-1">Reason</th>
              <th className="text-left py-1">By</th>
            </tr></thead>
            <tbody>
              {dayCorrections.map(c => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="py-1">{c.month}/{c.year}</td>
                  <td className="py-1">{c.correction_type || '—'}</td>
                  <td className="text-right py-1">{c.correction_delta}</td>
                  <td className="py-1 max-w-[200px] truncate">{c.correction_reason}</td>
                  <td className="py-1">{c.corrected_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <Section title="Punch Corrections" count={punchCorrections.length} sectionKey="punch">
        {punchCorrections.length === 0 ? <p className="text-xs text-gray-400">No corrections</p> : (
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500 border-b">
              <th className="text-left py-1">Date</th><th className="text-left py-1">In</th>
              <th className="text-left py-1">Out</th><th className="text-left py-1">Reason</th>
              <th className="text-left py-1">By</th>
            </tr></thead>
            <tbody>
              {punchCorrections.map(c => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="py-1">{fmtDate(c.correction_date)}</td>
                  <td className="py-1">{c.original_in_time || '—'} &rarr; {c.corrected_in_time || '—'}</td>
                  <td className="py-1">{c.original_out_time || '—'} &rarr; {c.corrected_out_time || '—'}</td>
                  <td className="py-1 max-w-[200px] truncate">{c.correction_reason}</td>
                  <td className="py-1">{c.corrected_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <Section title="Late Deductions" count={lateDeductions.length} sectionKey="late">
        {lateDeductions.length === 0 ? <p className="text-xs text-gray-400">No deductions</p> : (
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500 border-b">
              <th className="text-left py-1">Month</th><th className="text-right py-1">Days</th>
              <th className="text-left py-1">Status</th><th className="text-left py-1">Remark</th>
            </tr></thead>
            <tbody>
              {lateDeductions.map(d => (
                <tr key={d.id} className="border-b last:border-0">
                  <td className="py-1">{d.month}/{d.year}</td>
                  <td className="text-right py-1">{d.deduction_days}</td>
                  <td className="py-1">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${
                      d.finance_status === 'approved' ? 'bg-green-100 text-green-700' :
                      d.finance_status === 'rejected' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>{d.finance_status}</span>
                  </td>
                  <td className="py-1 max-w-[200px] truncate">{d.remark}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
};

const AttendanceTab = ({ profileData }) => (
  <>
    <DetailMetrics kpis={profileData.kpis} />
    <MonthlyBreakdownTable months={profileData.monthlyBreakdown} />
    <CorrectionsSection corrections={profileData.corrections} />
  </>
);

const SalaryTotals = ({ totals }) => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
    {[
      ['Total Gross Earned', totals.totalGrossEarned],
      ['Total Net Salary', totals.totalNetSalary],
      ['Total Take Home', totals.totalTakeHome],
      ['Total Deductions', totals.totalDeductions],
    ].map(([label, val]) => (
      <div key={label} className="bg-white rounded-lg shadow p-4">
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-xl font-bold text-gray-900">{fmtINR(val)}</p>
      </div>
    ))}
    <div className="col-span-2 md:col-span-4 bg-white rounded-lg shadow p-3 flex flex-wrap gap-6 text-sm">
      <span className="text-gray-500">OT Pay: <strong className="text-gray-900">{fmtINR(totals.totalOTPay)}</strong></span>
      <span className="text-gray-500">ED Pay: <strong className="text-gray-900">{fmtINR(totals.totalEDPay)}</strong></span>
      <span className="text-gray-500">Holiday Duty Pay: <strong className="text-gray-900">{fmtINR(totals.totalHolidayDutyPay)}</strong></span>
    </div>
  </div>
);

const SalaryMonthsTable = ({ months }) => {
  if (!months?.length) return <p className="text-sm text-gray-400">No salary data available.</p>;
  const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            {['Period', 'Gross Earned', 'Net Salary', 'Take Home', 'Deductions', 'OT Pay', 'ED Pay', 'Status'].map(h => (
              <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.map((m, i) => (
            <tr key={i} className="border-t even:bg-gray-50">
              <td className="px-3 py-2 font-medium">{MONTHS[m.month]} {m.year}</td>
              <td className="px-3 py-2">{fmtINR(m.gross_earned)}</td>
              <td className="px-3 py-2">{fmtINR(m.net_salary)}</td>
              <td className="px-3 py-2 font-semibold">{fmtINR(m.take_home || m.total_payable)}</td>
              <td className="px-3 py-2">{fmtINR(m.total_deductions)}</td>
              <td className="px-3 py-2">{fmtINR(m.ot_pay)}</td>
              <td className="px-3 py-2">{fmtINR(m.ed_pay)}</td>
              <td className="px-3 py-2">
                {m.salary_held ? <span className="text-amber-600" title={m.hold_reason || ''}>Held</span> : <span className="text-green-600">OK</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const HeldSalaryNotes = ({ months }) => {
  const held = (months || []).filter(m => m.salary_held);
  if (!held.length) return null;
  const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mt-4 text-sm">
      <p className="font-medium text-amber-800 mb-1">Held Salaries</p>
      {held.map((m, i) => (
        <p key={i} className="text-amber-700">
          {MONTHS[m.month]} {m.year}: {m.hold_reason || 'No reason specified'}
        </p>
      ))}
    </div>
  );
};

const SalaryTab = ({ salaryHistory }) => {
  if (!salaryHistory) return <p className="text-sm text-gray-400">No salary data.</p>;
  return (
    <>
      <SalaryTotals totals={salaryHistory.totals} />
      <SalaryMonthsTable months={salaryHistory.months} />
      <HeldSalaryNotes months={salaryHistory.months} />
    </>
  );
};

const PatternsTab = ({ patternAnalysis }) => (
  <div className="bg-white rounded-lg shadow p-6">
    <h3 className="text-lg font-semibold text-gray-800 mb-3">Pattern Analysis</h3>
    {patternAnalysis ? (
      <div>
        <div className="flex flex-wrap gap-6 mb-4 text-sm">
          <span>Detected: <strong>{patternAnalysis.summary?.totalPatternsDetected || 0}</strong> patterns</span>
          <span>Flight Risk: <strong>{patternAnalysis.compositeScores?.flightRisk || 0}</strong>/100</span>
          <span>Engagement: <strong>{patternAnalysis.compositeScores?.engagement || 0}</strong>/100</span>
          <span>Reliability: <strong>{patternAnalysis.compositeScores?.reliability || 0}</strong>/100</span>
        </div>
        {(patternAnalysis.patterns || []).map((p, i) => (
          <div key={i} className="mt-2 p-3 bg-gray-50 rounded text-sm border-l-3">
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium mr-2 ${
              p.severity === 'Critical' ? 'bg-red-100 text-red-800' :
              p.severity === 'High' ? 'bg-orange-100 text-orange-800' :
              p.severity === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
              'bg-blue-100 text-blue-800'
            }`}>{p.severity}</span>
            <span className="font-medium">{p.label}</span>: {p.detail}
          </div>
        ))}
        {(patternAnalysis.patterns || []).length === 0 && (
          <p className="text-gray-400 text-sm">No patterns detected in this range.</p>
        )}
      </div>
    ) : (
      <p className="text-gray-400">Pattern analysis not available.</p>
    )}
  </div>
);

const AIReviewTab = () => (
  <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
    <p className="text-lg font-medium">AI Qualitative Review</p>
    <p className="text-sm mt-1">Will be enhanced in Phase 4b with full AI-powered narrative generation.</p>
    <button className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 opacity-50 cursor-not-allowed" disabled>
      Generate AI Review
    </button>
  </div>
);

// ── Main Component ───────────────────────────────────────────────────────────

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
  const dropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Load employee list + default dates
  useEffect(() => {
    api.get('/employees?status=Active&limit=500').then(res => {
      setEmployees(res.data?.data || res.data || []);
    }).catch(() => {});
    const today = new Date();
    const sixAgo = new Date();
    sixAgo.setMonth(today.getMonth() - 6);
    setToDate(today.toISOString().split('T')[0]);
    setFromDate(sixAgo.toISOString().split('T')[0]);
  }, []);

  const fetchProfile = useCallback(async () => {
    if (!selectedCode || !fromDate || !toDate) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/analytics/employee/${selectedCode}/profile-range?from=${fromDate}&to=${toDate}`);
      if (res.data?.success) setProfileData(res.data.data);
      else setError(res.data?.error || 'Failed to load profile');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [selectedCode, fromDate, toDate]);

  useEffect(() => {
    if (selectedCode && fromDate && toDate) fetchProfile();
  }, [selectedCode, fromDate, toDate, fetchProfile]);

  const filtered = employees.filter(e => {
    const t = searchTerm.toLowerCase();
    return e.code?.toLowerCase().includes(t) || e.name?.toLowerCase().includes(t) || e.department?.toLowerCase().includes(t);
  }).slice(0, 30);

  const selectEmployee = (emp) => {
    setSelectedCode(emp.code);
    setSearchTerm(`${emp.code} - ${emp.name}`);
    setShowDropdown(false);
  };

  return (
    <div className="max-w-7xl mx-auto p-4">
      {/* Controls Bar */}
      <div className="bg-white rounded-lg shadow p-4 mb-4 flex flex-wrap gap-4 items-end sticky top-0 z-10">
        <div className="relative flex-1 min-w-[250px]" ref={dropdownRef}>
          <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
          <input type="text" placeholder="Search by name, code, or department..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
          />
          {showDropdown && filtered.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {filtered.map(emp => (
                <button key={emp.code} className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b border-gray-50 last:border-0"
                  onClick={() => selectEmployee(emp)}>
                  <span className="font-medium">{emp.code}</span> - {emp.name}
                  {emp.department && <span className="text-xs text-gray-400 ml-2">{emp.department}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
          <input type="date" className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
          <input type="date" className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={toDate} onChange={e => setToDate(e.target.value)} />
        </div>
        <button onClick={fetchProfile}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
          disabled={!selectedCode || loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Empty state */}
      {!selectedCode && !loading && (
        <div className="bg-white rounded-lg shadow p-12 text-center text-gray-400">
          <p className="text-lg">Select an employee to view their profile</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 mb-4 text-sm">{error}</div>
      )}

      {/* Loading spinner */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        </div>
      )}

      {/* Profile content */}
      {profileData && !loading && (
        <>
          <IdentityCard emp={profileData.employee} />

          {/* Tab bar */}
          <div className="mb-4">
            <div className="inline-flex bg-gray-100 rounded-lg p-1">
              {TABS.map(tab => (
                <button key={tab.key}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === tab.key ? 'bg-white shadow text-blue-700' : 'text-gray-600 hover:text-gray-900'
                  }`}
                  onClick={() => setActiveTab(tab.key)}>
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          {activeTab === 'overview' && <OverviewTab profileData={profileData} />}
          {activeTab === 'attendance' && <AttendanceTab profileData={profileData} />}
          {activeTab === 'salary' && <SalaryTab salaryHistory={profileData.salaryHistory} />}
          {activeTab === 'patterns' && <PatternsTab patternAnalysis={profileData.patternAnalysis} />}
          {activeTab === 'aiReview' && <AIReviewTab />}
        </>
      )}
    </div>
  );
}

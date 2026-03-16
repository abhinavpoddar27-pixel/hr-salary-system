import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getDayCalculations, calculateDays } from '../utils/api'
import { useAppStore } from '../store/appStore'
import PipelineProgress from '../components/pipeline/PipelineProgress'
import { Abbr, Tip } from '../components/ui/Tooltip'
import AbbreviationLegend from '../components/ui/AbbreviationLegend'
import CalendarView from '../components/ui/CalendarView'
import clsx from 'clsx'

function SortIcon({ field, sortField, sortDir }) {
  if (sortField !== field) return <span className="text-slate-300 ml-1">↕</span>
  return <span className="text-blue-500 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
}

export default function DayCalculation() {
  const { selectedMonth, selectedYear } = useAppStore()
  const queryClient = useQueryClient()
  const [expandedRow, setExpandedRow] = useState(null)
  const [calendarEmployee, setCalendarEmployee] = useState(null)
  const [search, setSearch] = useState('')
  const [filterDept, setFilterDept] = useState('')
  const [sortField, setSortField] = useState('employee')
  const [sortDir, setSortDir] = useState('asc')

  const { data: res, isLoading, refetch } = useQuery({
    queryKey: ['day-calculations', selectedMonth, selectedYear],
    queryFn: () => getDayCalculations({ month: selectedMonth, year: selectedYear }),
    retry: 0
  })

  const rawCalcs = res?.data?.data || []

  const calcs = useMemo(() => {
    let result = [...rawCalcs]
    // Search filter
    if (search) {
      const s = search.toLowerCase()
      result = result.filter(r =>
        (r.employee_name || '').toLowerCase().includes(s) ||
        (r.employee_code || '').toLowerCase().includes(s)
      )
    }
    // Department filter
    if (filterDept) {
      result = result.filter(r => (r.department || '').toLowerCase().includes(filterDept.toLowerCase()))
    }
    // Sort
    result.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'employee':
          cmp = (a.employee_name || a.employee_code || '').localeCompare(b.employee_name || b.employee_code || '')
          break
        case 'present':
          cmp = (a.days_present || 0) - (b.days_present || 0)
          break
        case 'absent':
          cmp = (a.days_absent || 0) - (b.days_absent || 0)
          break
        case 'payable':
          cmp = (a.total_payable_days || 0) - (b.total_payable_days || 0)
          break
        case 'lop':
          cmp = (a.lop_days || 0) - (b.lop_days || 0)
          break
        case 'working':
          cmp = (a.total_working_days || 0) - (b.total_working_days || 0)
          break
        default: cmp = 0
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
    return result
  }, [rawCalcs, search, filterDept, sortField, sortDir])

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const calcMutation = useMutation({
    mutationFn: () => calculateDays({ month: selectedMonth, year: selectedYear }),
    onSuccess: (res) => {
      toast.success(`Day calculation complete for ${res.data.processed} employees`)
      refetch()
      queryClient.invalidateQueries(['org-overview'])
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Calculation failed')
  })

  const totals = calcs.reduce((acc, r) => ({
    present: acc.present + (r.days_present || 0),
    half: acc.half + (r.days_half_present || 0),
    absent: acc.absent + (r.days_absent || 0),
    paidSundays: acc.paidSundays + (r.paid_sundays || 0),
    holidays: acc.holidays + (r.paid_holidays || 0),
    cl: acc.cl + (r.cl_used || 0),
    el: acc.el + (r.el_used || 0),
    lop: acc.lop + (r.lop_days || 0),
    payable: acc.payable + (r.total_payable_days || 0),
  }), { present: 0, half: 0, absent: 0, paidSundays: 0, holidays: 0, cl: 0, el: 0, lop: 0, payable: 0 })

  const zeroDayCount = rawCalcs.filter(r => (r.days_present || 0) === 0 && (r.days_half_present || 0) === 0).length
  const lopCount = rawCalcs.filter(r => (r.lop_days || 0) > 0).length

  return (
    <div className="animate-fade-in">
      <PipelineProgress stageStatus={{ 1: 'done', 2: 'done', 3: 'done', 4: 'done', 5: 'done', 6: 'active' }} />

      <div className="p-6 space-y-5 max-w-screen-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="section-title">Stage 6: Day Calculation & Leave Adjustment</h2>
            <p className="section-subtitle mt-1">Calculate paid days using Sunday granting rules, leave deductions, and holiday adjustments.</p>
          </div>
          <button
            onClick={() => calcMutation.mutate()}
            disabled={calcMutation.isPending}
            className="btn-primary"
          >
            {calcMutation.isPending ? '⏳ Calculating...' : '▶ Run Day Calculation'}
          </button>
        </div>

        {/* Summary Stats */}
        {rawCalcs.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {[
              { label: 'Total Employees', value: rawCalcs.length, color: 'blue' },
              { label: 'Avg Present Days', value: (totals.present / (calcs.length || 1)).toFixed(1), color: 'green' },
              { label: 'Total Paid Sundays', value: totals.paidSundays.toFixed(0), color: 'indigo' },
              { label: 'Total LOP Days', value: totals.lop.toFixed(1), color: 'red' },
              { label: 'Avg Payable Days', value: (totals.payable / (calcs.length || 1)).toFixed(1), color: 'emerald' },
              { label: '0-Day Employees', value: zeroDayCount, color: zeroDayCount > 0 ? 'red' : 'slate' },
            ].map(s => (
              <div key={s.label} className={clsx('stat-card border-l-4', `border-l-${s.color}-400`)}>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{s.label}</span>
                <span className={clsx('text-2xl font-bold', `text-${s.color}-700`)}>{s.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        {rawCalcs.length > 0 && (
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <label className="label">Search Employee</label>
              <input type="text" placeholder="Name or code..." value={search} onChange={e => setSearch(e.target.value)} className="input w-48" />
            </div>
            <div>
              <label className="label"><Abbr code="Dept">Dept</Abbr> Filter</label>
              <input type="text" placeholder="Filter dept..." value={filterDept} onChange={e => setFilterDept(e.target.value)} className="input w-40" />
            </div>
            <div className="text-xs text-slate-500 py-2">
              Showing {calcs.length} of {rawCalcs.length} employees
              {lopCount > 0 && <span className="ml-2 text-amber-600">| {lopCount} with LOP</span>}
              {zeroDayCount > 0 && <span className="ml-2 text-red-600">| {zeroDayCount} with 0 days</span>}
            </div>
          </div>
        )}

        {/* Calendar Panel */}
        {calendarEmployee && (
          <div className="card p-5 animate-slide-up">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-700">
                Daily Attendance: {calendarEmployee.name} ({calendarEmployee.code})
              </h3>
              <button onClick={() => setCalendarEmployee(null)} className="btn-ghost text-xs">Close</button>
            </div>
            <CalendarView employeeCode={calendarEmployee.code} month={selectedMonth} year={selectedYear} />
          </div>
        )}

        {/* Empty State */}
        {rawCalcs.length === 0 && !isLoading && (
          <div className="card p-8 text-center">
            <div className="text-4xl mb-3">📅</div>
            <h3 className="font-semibold text-slate-700 mb-2">No day calculations yet</h3>
            <p className="text-slate-500 mb-4">Click "Run Day Calculation" to compute payable days for all employees.</p>
          </div>
        )}

        {/* Main Table */}
        {calcs.length > 0 && (
          <div className="card overflow-hidden">
            <div className="card-header">
              <span className="font-semibold text-slate-700">Day Calculation Register — {calcs.length} employees</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full table-compact text-xs">
                <thead>
                  <tr>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort('employee')}>
                      <Tip text="Employee name and code"><span>Employee</span></Tip>
                      <SortIcon field="employee" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th><Abbr code="Dept">Dept</Abbr></th>
                    <th><Tip text="Total calendar days in the month">Cal Days</Tip></th>
                    <th><Tip text="Total Sundays in the month (excluded from working days)">Sun</Tip></th>
                    <th><Tip text="Working days = Calendar days - Sundays - Holidays. Sundays are NOT counted as absent.">Work Days</Tip></th>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort('present')}>
                      <Tip text="Full days present (with both IN and OUT punch)"><Abbr code="P">Present</Abbr></Tip>
                      <SortIcon field="present" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th><Tip text="Half-day present (only partial attendance)"><Abbr code="½P">½ Day</Abbr></Tip></th>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort('absent')}>
                      <Tip text="Absent days (working days with no attendance). Sundays and holidays are NOT counted as absent."><Abbr code="A">Absent</Abbr></Tip>
                      <SortIcon field="absent" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th><Tip text="Paid Sundays granted based on weekly attendance (6 days = free, 4-5 = CL/EL deducted, <4 = unpaid)">Paid Sun</Tip></th>
                    <th><Tip text="Paid holidays (gazetted holidays falling in the month)">Hol</Tip></th>
                    <th><Tip text="Casual Leave used to cover Sunday granting shortfall"><Abbr code="CL">CL</Abbr></Tip></th>
                    <th><Tip text="Earned Leave used to cover Sunday granting shortfall"><Abbr code="EL">EL</Abbr></Tip></th>
                    <th className="cursor-pointer select-none" onClick={() => toggleSort('lop')}>
                      <Tip text="Loss of Pay days — remaining absent days after leave adjustment"><Abbr code="LOP">LOP</Abbr></Tip>
                      <SortIcon field="lop" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th className="cursor-pointer select-none bg-blue-50 text-blue-700" onClick={() => toggleSort('payable')}>
                      <Tip text="Total Payable Days = Present + ½Days×0.5 + Paid Sundays + Holidays + CL + EL">Payable</Tip>
                      <SortIcon field="payable" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th><Tip text="View weekly breakdown and daily attendance calendar">Actions</Tip></th>
                  </tr>
                </thead>
                <tbody>
                  {calcs.map(r => {
                    const isZeroDay = (r.days_present || 0) === 0 && (r.days_half_present || 0) === 0
                    const hasLOP = (r.lop_days || 0) > 0
                    return (
                      <React.Fragment key={r.id}>
                        <tr className={clsx(
                          'transition-colors',
                          isZeroDay && 'bg-red-50/60',
                          !isZeroDay && hasLOP && 'bg-amber-50/40'
                        )}>
                          <td>
                            <div className="flex items-center gap-1.5">
                              {isZeroDay && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="0 working days" />}
                              <div>
                                <div className="font-medium text-sm">{r.employee_name || r.employee_code}</div>
                                <div className="text-xs text-slate-400 font-mono">{r.employee_code}</div>
                              </div>
                            </div>
                          </td>
                          <td className="text-slate-600">{r.department}</td>
                          <td>{r.total_calendar_days}</td>
                          <td>{r.total_sundays}</td>
                          <td className="font-medium text-slate-700">{r.total_working_days || (r.total_calendar_days - r.total_sundays - (r.paid_holidays || 0))}</td>
                          <td className="text-green-600 font-medium">{r.days_present}</td>
                          <td className="text-yellow-600">{r.days_half_present}</td>
                          <td className={clsx('font-medium', r.days_absent > 0 ? 'text-red-600' : 'text-slate-400')}>{r.days_absent}</td>
                          <td className="text-blue-600">{r.paid_sundays}</td>
                          <td className="text-purple-600">{r.paid_holidays}</td>
                          <td className="text-orange-600">{r.cl_used || 0}</td>
                          <td className="text-orange-600">{r.el_used || 0}</td>
                          <td className={clsx('font-medium', r.lop_days > 0 ? 'text-red-600' : 'text-slate-400')}>{r.lop_days}</td>
                          <td className="bg-blue-50 font-bold text-blue-700 text-sm">{r.total_payable_days}</td>
                          <td>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setExpandedRow(expandedRow === r.id ? null : r.id)}
                                className="btn-ghost text-xs px-1.5 py-0.5 text-blue-600"
                                title="Week breakdown"
                              >
                                {expandedRow === r.id ? '▲' : '▼'}
                              </button>
                              <button
                                onClick={() => setCalendarEmployee({ code: r.employee_code, name: r.employee_name || r.employee_code })}
                                className="btn-ghost text-xs px-1.5 py-0.5 text-blue-600"
                                title="Daily attendance calendar"
                              >
                                📅
                              </button>
                            </div>
                          </td>
                        </tr>
                        {expandedRow === r.id && r.week_breakdown && (
                          <tr>
                            <td colSpan={15} className="bg-slate-50 px-6 py-3">
                              <p className="text-xs font-semibold text-slate-600 mb-2">Week-by-Week Sunday Granting:</p>
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                                {(() => {
                                  try {
                                    const weeks = typeof r.week_breakdown === 'string' ? JSON.parse(r.week_breakdown) : r.week_breakdown
                                    return weeks.map((w, i) => (
                                      <div key={i} className={clsx('rounded-lg p-2 text-xs border', w.sundayPaid ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200')}>
                                        <div className="font-semibold mb-1">Sunday: {w.sundayDate}</div>
                                        <div>Worked: <strong>{w.workedDays}/{w.availableDays}</strong></div>
                                        {w.clUsed > 0 && <div>CL used: {w.clUsed}</div>}
                                        {w.elUsed > 0 && <div>EL used: {w.elUsed}</div>}
                                        {w.lop > 0 && <div className="text-red-600">LOP: {w.lop}</div>}
                                        <div className={clsx('font-medium mt-1', w.sundayPaid ? 'text-green-600' : 'text-red-600')}>
                                          {w.sundayPaid ? '✓ Paid Sunday' : '✗ Unpaid Sunday'}
                                        </div>
                                      </div>
                                    ))
                                  } catch (e) { return <div className="text-slate-400">No breakdown data</div> }
                                })()}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold text-xs">
                    <td colSpan={2}>TOTAL ({calcs.length})</td>
                    <td />
                    <td />
                    <td />
                    <td className="text-green-600">{totals.present}</td>
                    <td className="text-yellow-600">{totals.half}</td>
                    <td className="text-red-600">{totals.absent}</td>
                    <td className="text-blue-600">{totals.paidSundays}</td>
                    <td className="text-purple-600">{totals.holidays}</td>
                    <td className="text-orange-600">{totals.cl}</td>
                    <td className="text-orange-600">{totals.el}</td>
                    <td className="text-red-600">{totals.lop.toFixed(1)}</td>
                    <td className="bg-blue-100 text-blue-700">{totals.payable.toFixed(1)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Explanation Card */}
        {rawCalcs.length > 0 && (
          <div className="card p-5">
            <h3 className="text-sm font-bold text-slate-700 mb-3">How Day Calculation Works</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600">
              <div>
                <p className="font-semibold text-slate-700 mb-1">Working Days</p>
                <p>Working Days = Calendar Days − Sundays − Holidays</p>
                <p className="text-slate-500 mt-1">Sundays and holidays are <strong>never</strong> counted as absent. They are handled separately through the Sunday granting system.</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-1">Sunday Granting Rules</p>
                <p>Each week (Mon–Sat), if employee worked:</p>
                <ul className="list-disc list-inside mt-1 space-y-0.5">
                  <li><strong>6 days</strong> → Free paid Sunday</li>
                  <li><strong>4–5 days</strong> → Paid Sunday but CL/EL deducted for gap</li>
                  <li><strong>&lt;4 days</strong> → Unpaid Sunday (no pay, no leave deduction)</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-1">Payable Days Formula</p>
                <p>Payable = Present + (½Days × 0.5) + Paid Sundays + Holidays + CL + EL</p>
                <p className="text-slate-500 mt-1">LOP = Absent days that could not be covered by CL/EL.</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-1">Row Highlights</p>
                <p className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-red-100 border border-red-200" /> 0-day employees (no attendance at all)</p>
                <p className="flex items-center gap-2 mt-1"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-200" /> Employees with LOP days</p>
              </div>
            </div>
          </div>
        )}

        <AbbreviationLegend keys={['P', 'A', '½P', 'WO', 'WOP', 'CL', 'EL', 'SL', 'LOP', 'LWP', 'OT', 'PF', 'ESI', 'PT', 'Dept', 'Att', 'Hrs']} />
      </div>
    </div>
  )
}

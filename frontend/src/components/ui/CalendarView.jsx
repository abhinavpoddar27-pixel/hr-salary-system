import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getEmployeeDailyAttendance } from '../../utils/api';
import Skeleton from './Skeleton';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STATUS_STYLES = {
  P:      'bg-emerald-100 text-emerald-700 border-emerald-200',
  A:      'bg-red-100 text-red-600 border-red-200',
  WO:     'bg-slate-100 text-slate-400 border-slate-200',
  WOP:    'bg-teal-100 text-teal-700 border-teal-200',
  '\u00bdP':   'bg-amber-100 text-amber-700 border-amber-200',
  'WO\u00bdP': 'bg-teal-50 text-teal-600 border-teal-200',
  NH:     'bg-purple-100 text-purple-700 border-purple-200',
};

const STATUS_LABELS = {
  P: 'Present', A: 'Absent', WO: 'Week Off', WOP: 'Work on Week Off',
  '\u00bdP': 'Half Day', 'WO\u00bdP': 'WO + Half Day', NH: 'Night Shift',
};

/**
 * CalendarView — Month calendar showing daily attendance status with detailed tooltips.
 */
export default function CalendarView({ employeeCode, month, year, data: externalData, compact = false }) {
  const [hoveredDay, setHoveredDay] = useState(null);
  const [hoverPos, setHoverPos] = useState({ top: 0, left: 0 });

  const { data: fetchedData, isLoading, error } = useQuery({
    queryKey: ['daily-attendance', employeeCode, month, year],
    queryFn: () => getEmployeeDailyAttendance(employeeCode, month, year),
    enabled: !externalData && !!employeeCode && !!month && !!year,
    staleTime: 60000,
    retry: 1,
  });

  const rawData = externalData || fetchedData?.data?.data || fetchedData?.data || [];
  const safeData = Array.isArray(rawData) ? rawData : (Array.isArray(rawData?.data) ? rawData.data : []);

  if (isLoading) return <Skeleton variant="card" />;
  if (error) return <div className="text-xs text-red-500 p-2">Failed to load calendar data</div>;
  if (!month || !year) return <div className="text-xs text-slate-400 p-2">Select a month and year</div>;

  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const dayMap = {};
  for (const rec of safeData) {
    const day = parseInt(rec.date?.split('-')[2], 10);
    if (day) dayMap[day] = rec;
  }

  const handleHover = (day, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverPos({ top: rect.bottom + 6, left: Math.min(rect.left + rect.width / 2, window.innerWidth - 160) });
    setHoveredDay(day);
  };

  const cellSize = compact ? 'w-8 h-8 text-[10px]' : 'w-10 h-10 text-xs';

  return (
    <div className="inline-block">
      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAY_NAMES.map(d => (
          <div key={d} className={`${compact ? 'w-8' : 'w-10'} text-center text-[10px] font-semibold text-slate-400 uppercase`}>
            {d.charAt(0)}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`empty-${i}`} className={cellSize} />
        ))}

        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const rec = dayMap[day];
          const status = rec?.status_final || rec?.status_original || '';
          const isNight = rec?.is_night_shift;
          const isLate = rec?.is_late_arrival;
          const isMissPunch = rec?.is_miss_punch && !rec?.miss_punch_resolved;
          const displayStatus = isNight ? 'NH' : status;
          const style = STATUS_STYLES[displayStatus] || 'bg-slate-50 text-slate-300 border-slate-100';

          return (
            <div
              key={day}
              className={`${cellSize} flex flex-col items-center justify-center
                rounded-lg border cursor-default font-medium relative
                transition-all duration-100 hover:scale-110 hover:shadow-sm
                ${style}
                ${isMissPunch ? 'ring-2 ring-red-400' : ''}
                ${isLate ? 'ring-1 ring-amber-400' : ''}`}
              onMouseEnter={(e) => handleHover(day, e)}
              onMouseLeave={() => setHoveredDay(null)}
            >
              <span className="leading-none">{day}</span>
              {!compact && status && (
                <span className="text-[8px] font-bold leading-none mt-0.5 opacity-70">
                  {displayStatus}
                </span>
              )}
              {/* Late dot indicator */}
              {isLate && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-amber-500 rounded-full" />}
              {/* Miss punch dot */}
              {isMissPunch && <span className="absolute top-0.5 left-0.5 w-1.5 h-1.5 bg-red-500 rounded-full" />}
            </div>
          );
        })}
      </div>

      {/* Hover tooltip — detailed */}
      {hoveredDay && (
        <div
          className="fixed z-[100] bg-slate-800 text-white text-xs rounded-lg px-3 py-2
            shadow-xl animate-fade-in pointer-events-none min-w-[180px]"
          style={{ top: hoverPos.top, left: hoverPos.left, transform: 'translateX(-50%)' }}
        >
          {dayMap[hoveredDay] ? (() => {
            const rec = dayMap[hoveredDay];
            const st = rec.status_final || rec.status_original || '';
            const inT = rec.in_time_final || rec.in_time_original;
            const outT = rec.out_time_final || rec.out_time_original;
            const displaySt = rec.is_night_shift ? 'NH' : st;
            return (
              <>
                <div className="font-bold mb-1">
                  Day {hoveredDay} — {STATUS_LABELS[displaySt] || displaySt || 'No data'}
                  <span className="ml-1 opacity-60">({displaySt})</span>
                </div>
                <div className="space-y-0.5">
                  {inT && <div className="text-slate-300">IN: <span className="text-white font-mono">{inT}</span></div>}
                  {outT && <div className="text-slate-300">OUT: <span className="text-white font-mono">{outT}</span></div>}
                  {!inT && !outT && st !== 'WO' && st !== 'A' && <div className="text-slate-400">No punch recorded</div>}
                  {rec.actual_hours > 0 && <div className="text-blue-300 font-medium">Hours: {Number(rec.actual_hours).toFixed(1)}h</div>}
                  {rec.is_late_arrival ? <div className="text-amber-300">Late by {rec.late_by_minutes || 0} min</div> : null}
                  {rec.overtime_minutes > 0 && <div className="text-green-300">OT: {Math.round(rec.overtime_minutes / 60 * 10) / 10}h</div>}
                  {rec.is_miss_punch && !rec.miss_punch_resolved ? (
                    <div className="text-red-300 font-medium">Miss Punch: {rec.miss_punch_type || 'Unresolved'}</div>
                  ) : null}
                  {rec.is_miss_punch && rec.miss_punch_resolved ? (
                    <div className="text-green-300">Miss Punch: Resolved</div>
                  ) : null}
                  {rec.correction_remark ? <div className="text-slate-400 italic mt-0.5">{rec.correction_remark}</div> : null}
                </div>
              </>
            );
          })() : (
            <div className="text-slate-400">Day {hoveredDay} — No attendance data</div>
          )}
        </div>
      )}

      {/* Legend */}
      {!compact && (
        <div className="flex flex-wrap gap-1.5 mt-3 text-[10px]">
          {[
            { key: 'P', label: 'Present', color: 'bg-emerald-100 text-emerald-700' },
            { key: 'A', label: 'Absent', color: 'bg-red-100 text-red-600' },
            { key: 'WO', label: 'Week Off', color: 'bg-slate-100 text-slate-400' },
            { key: 'WOP', label: 'WO Present', color: 'bg-teal-100 text-teal-700' },
            { key: '\u00bdP', label: 'Half Day', color: 'bg-amber-100 text-amber-700' },
            { key: 'NH', label: 'Night Shift', color: 'bg-purple-100 text-purple-700' },
          ].map(l => (
            <span key={l.key} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${l.color} font-medium`}>
              {l.key} {l.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-slate-500">
            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full inline-block" /> Late
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-slate-500">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full inline-block" /> Miss Punch
          </span>
        </div>
      )}
    </div>
  );
}

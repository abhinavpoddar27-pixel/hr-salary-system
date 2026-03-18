import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getEmployeeDailyAttendance } from '../../utils/api';
import { Abbr } from './Tooltip';
import Skeleton from './Skeleton';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STATUS_STYLES = {
  P:    'bg-emerald-100 text-emerald-700 border-emerald-200',
  A:    'bg-red-100 text-red-600 border-red-200',
  WO:   'bg-slate-100 text-slate-400 border-slate-200',
  WOP:  'bg-teal-100 text-teal-700 border-teal-200',
  '½P': 'bg-amber-100 text-amber-700 border-amber-200',
  'WO½P': 'bg-teal-50 text-teal-600 border-teal-200',
  NH:   'bg-purple-100 text-purple-700 border-purple-200',
};

/**
 * CalendarView — Compact month calendar showing daily attendance status.
 *
 * Usage: <CalendarView employeeCode="EMP001" month={3} year={2026} />
 */
export default function CalendarView({ employeeCode, month, year, data: externalData, compact = false }) {
  const [hoveredDay, setHoveredDay] = useState(null);
  const [hoverPos, setHoverPos] = useState({ top: 0, left: 0 });

  const { data: fetchedData, isLoading } = useQuery({
    queryKey: ['daily-attendance', employeeCode, month, year],
    queryFn: () => getEmployeeDailyAttendance(employeeCode, month, year),
    enabled: !externalData && !!employeeCode,
    staleTime: 60000,
  });

  const attendanceData = externalData || fetchedData?.data?.data || fetchedData?.data || [];
  // Ensure attendanceData is always an array (API returns { success, data: [...] })
  const safeData = Array.isArray(attendanceData) ? attendanceData : [];

  if (isLoading) return <Skeleton variant="card" />;

  // Build calendar grid
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  // Build lookup map
  const dayMap = {};
  for (const rec of safeData) {
    const day = parseInt(rec.date?.split('-')[2], 10);
    if (day) dayMap[day] = rec;
  }

  const handleHover = (day, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverPos({ top: rect.bottom + 4, left: rect.left + rect.width / 2 });
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
        {/* Empty cells before the 1st */}
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`empty-${i}`} className={cellSize} />
        ))}

        {/* Day cells */}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const rec = dayMap[day];
          const status = rec?.status_final || rec?.status_original || '';
          const isNight = rec?.is_night_shift;
          const displayStatus = isNight ? 'NH' : status;
          const style = STATUS_STYLES[displayStatus] || 'bg-slate-50 text-slate-300 border-slate-100';

          return (
            <div
              key={day}
              className={`${cellSize} flex flex-col items-center justify-center
                rounded-lg border cursor-default font-medium
                transition-all duration-100 hover:scale-110 hover:shadow-sm
                ${style}`}
              onMouseEnter={(e) => handleHover(day, e)}
              onMouseLeave={() => setHoveredDay(null)}
            >
              <span className="leading-none">{day}</span>
              {!compact && status && (
                <span className="text-[8px] font-bold leading-none mt-0.5 opacity-70">
                  {displayStatus}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Hover tooltip */}
      {hoveredDay && dayMap[hoveredDay] && (
        <div
          className="fixed z-[100] bg-slate-800 text-white text-xs rounded-lg px-3 py-2
            shadow-xl animate-fade-in pointer-events-none"
          style={{ top: hoverPos.top, left: hoverPos.left, transform: 'translateX(-50%)' }}
        >
          <div className="font-bold mb-1">
            Day {hoveredDay} — {dayMap[hoveredDay].status_final || dayMap[hoveredDay].status_original || 'No data'}
          </div>
          {dayMap[hoveredDay].in_time_final && (
            <div className="text-slate-300">In: {dayMap[hoveredDay].in_time_final}</div>
          )}
          {dayMap[hoveredDay].out_time_final && (
            <div className="text-slate-300">Out: {dayMap[hoveredDay].out_time_final}</div>
          )}
          {dayMap[hoveredDay].actual_hours > 0 && (
            <div className="text-blue-300 font-medium mt-0.5">
              {Number(dayMap[hoveredDay].actual_hours).toFixed(1)} hrs
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      {!compact && (
        <div className="flex flex-wrap gap-2 mt-3 text-[10px]">
          {[
            { key: 'P', label: 'Present', color: 'bg-emerald-100 text-emerald-700' },
            { key: 'A', label: 'Absent', color: 'bg-red-100 text-red-600' },
            { key: 'WO', label: 'Week Off', color: 'bg-slate-100 text-slate-400' },
            { key: '½P', label: 'Half Day', color: 'bg-amber-100 text-amber-700' },
            { key: 'NH', label: 'Night', color: 'bg-purple-100 text-purple-700' },
          ].map(l => (
            <span key={l.key} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${l.color} font-medium`}>
              {l.key} {l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

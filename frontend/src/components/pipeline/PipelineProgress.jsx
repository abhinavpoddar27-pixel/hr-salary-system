import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import clsx from 'clsx'

const STAGES = [
  { num: 1, label: 'Import', short: 'Import', path: '/pipeline/import', tip: 'Upload the EESL biometric .xls file. This parses attendance data for all employees.' },
  { num: 2, label: 'Miss Punches', short: 'Miss Punch', path: '/pipeline/miss-punch', tip: 'Review and correct missing IN/OUT punches detected from biometric data.' },
  { num: 3, label: 'Shift Check', short: 'Shifts', path: '/pipeline/shift-check', tip: 'Verify and reassign shift codes for flagged attendance records.' },
  { num: 4, label: 'Night Shift', short: 'Night', path: '/pipeline/night-shift', tip: 'Review auto-paired night shift records that cross midnight.' },
  { num: 5, label: 'Corrections', short: 'Correct', path: '/pipeline/corrections', tip: 'Make final manual corrections to the attendance register.' },
  { num: 6, label: 'Day Calc', short: 'Days', path: '/pipeline/day-calc', tip: 'Calculate payable days using Sunday-granting rule and leave adjustments.' },
  { num: 7, label: 'Salary', short: 'Salary', path: '/pipeline/salary', tip: 'Compute final salary with all statutory deductions and generate outputs.' },
]

export default function PipelineProgress({ stageStatus = {} }) {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <div className="bg-white border-b border-slate-200 px-6 py-3 no-print">
      <div className="flex items-center gap-0">
        {STAGES.map((stage, idx) => {
          const status = stageStatus[stage.num] || 'pending'
          const isActive = location.pathname.includes(stage.path.split('/').pop())
          const isDone = status === 'done'
          const isLocked = status === 'locked'
          const canClick = !isLocked

          return (
            <React.Fragment key={stage.num}>
              <button
                onClick={() => canClick && navigate(stage.path)}
                disabled={isLocked}
                title={stage.tip}
                className={clsx(
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                  isDone && 'bg-green-50 text-green-700 hover:bg-green-100',
                  isActive && !isDone && 'bg-blue-600 text-white shadow-sm',
                  !isDone && !isActive && !isLocked && 'text-slate-500 hover:bg-slate-50',
                  isLocked && 'text-slate-300 cursor-not-allowed'
                )}
              >
                <span className={clsx(
                  'w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                  isDone && 'bg-green-500 text-white',
                  isActive && !isDone && 'bg-white text-blue-600',
                  !isDone && !isActive && !isLocked && 'bg-slate-200 text-slate-600',
                  isLocked && 'bg-slate-100 text-slate-300'
                )}>
                  {isDone ? '✓' : stage.num}
                </span>
                <span className="hidden lg:block">{stage.label}</span>
                <span className="lg:hidden">{stage.short}</span>
              </button>
              {idx < STAGES.length - 1 && (
                <div className={clsx('h-px flex-1 mx-1', isDone ? 'bg-green-300' : 'bg-slate-200')} />
              )}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}

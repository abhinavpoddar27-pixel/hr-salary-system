import React from 'react'
import clsx from 'clsx'
import { statusInfo } from '../../utils/statusMap'

/**
 * StatusBadge — a coloured pill for a workflow state (P2-04).
 *
 *   <StatusBadge domain="ed_finance" status={g.finance_status} size="xs" />
 *
 * domain/status are looked up in utils/statusMap.js. size: xs (the 10px pill the ED page has
 * always used) | sm (12px). `data-status` carries the raw status for tests.
 */
export default function StatusBadge({ domain, status, size = 'sm', className, title }) {
  const { label, className: toneCls } = statusInfo(domain, status)
  return (
    <span
      data-status={status ?? ''}
      title={title}
      className={clsx(
        size === 'xs' ? 'text-[10px] px-1.5 py-0.5 rounded-full' : 'inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium',
        toneCls,
        className
      )}
    >
      {label}
    </span>
  )
}

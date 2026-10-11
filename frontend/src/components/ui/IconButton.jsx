import React, { forwardRef } from 'react'
import clsx from 'clsx'

/**
 * IconButton — a button that shows only an icon (P2-04).
 *
 *   <IconButton label="Close" icon="✕" onClick={…} />
 *   <IconButton label="Show details for 1234" onClick={…}><ChevronIcon /></IconButton>
 *
 * `label` is REQUIRED: it becomes aria-label (what a screen reader says) and title (the
 * hover tooltip). The icon itself is aria-hidden. If a caller forgets the label, a console
 * error is logged and the button falls back to showing "?" so it is never silent.
 * size: sm (default, 24px) | md (32px).
 */
const IconButton = forwardRef(function IconButton(
  { label, icon, children, size = 'sm', type = 'button', className, title, ...rest },
  ref
) {
  const name = typeof label === 'string' ? label.trim() : ''
  if (!name && typeof console !== 'undefined') {
    console.error('IconButton: the `label` prop is required (it is the button\'s accessible name).')
  }
  return (
    <button
      ref={ref}
      type={type}
      aria-label={name || '?'}
      title={title || name || undefined}
      className={clsx(
        'inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-40 disabled:cursor-not-allowed',
        size === 'md' ? 'h-8 w-8 text-base' : 'h-6 w-6 text-xs',
        className
      )}
      {...rest}
    >
      <span aria-hidden="true">{icon ?? children ?? '?'}</span>
    </button>
  )
})

export default IconButton

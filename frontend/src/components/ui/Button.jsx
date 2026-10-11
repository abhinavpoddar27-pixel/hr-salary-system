import React, { forwardRef } from 'react'
import clsx from 'clsx'

/**
 * Button — one button for new code (P2-04).
 *
 *   <Button variant="primary" onClick={…}>Save</Button>
 *   <Button variant="danger" busy={m.isPending} busyLabel="Rejecting...">Reject</Button>
 *   <Button variant="link" tone="green">✓ Approve</Button>   // small inline row action
 *
 * variant: primary | secondary | ghost | danger | success | warning | link
 * size:    md (default) | sm   (link has one size)
 * tone:    only for variant="link": green | red | amber | blue | indigo | slate
 * busy:    disables the button, sets aria-busy, shows busyLabel (or the children) instead.
 * type defaults to "button" so a Button inside a form never submits by accident.
 * The visible text is the accessible name — for an icon-only button use <IconButton label>.
 */
const VARIANT = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  success: 'btn-success',
  // index.css has no .btn-warning class, so warning is spelled out here.
  warning: 'inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150',
}

const LINK_TONE = {
  green: 'text-green-600 hover:bg-green-50',
  red: 'text-red-600 hover:bg-red-50',
  amber: 'text-amber-600 hover:bg-amber-50',
  blue: 'text-blue-600 hover:bg-blue-50',
  indigo: 'text-indigo-600 hover:bg-indigo-50',
  slate: 'text-slate-500 hover:text-slate-800',
}

export function buttonClass({ variant = 'primary', size = 'md', tone = 'blue' } = {}) {
  if (variant === 'link') {
    return clsx(LINK_TONE[tone] || LINK_TONE.blue, 'px-1.5 py-0.5 rounded text-[10px] font-medium disabled:opacity-50 disabled:cursor-not-allowed')
  }
  return clsx(VARIANT[variant] || VARIANT.primary, size === 'sm' && 'btn-sm')
}

const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', tone, busy = false, busyLabel, disabled, type = 'button', className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={clsx(buttonClass({ variant, size, tone }), className)}
      {...rest}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  )
})

export default Button

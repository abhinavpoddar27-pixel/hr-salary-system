// Record History Timeline — single field row (piece #4 of 5).
//
// Pure presentation. Renders the server-prepared `field.rendered` string AS-IS.
// Backend §6 already applied PII masking; frontend does NO masking, NO substring,
// NO regex. If field.masked is true, field.rendered already reads like
// "fieldname: ••••••• (set | changed | no change)" — trust it.
//
// diffCase styling:
//   noop   → grey, italic (no semantic change)
//   set    → emerald (first-fill / onboarding)
//   scalar → default (rendered already contains "old → new")
//   json   → mono font for structured diff

import React from 'react'
import clsx from 'clsx'

const DIFF_CLASSES = {
  noop:   'text-slate-400 italic',
  set:    'text-emerald-700',
  scalar: 'text-slate-700',
  json:   'text-slate-700 font-mono text-[12px]',
}

export default function TimelineField({ field }) {
  if (!field) return null
  const cls = DIFF_CLASSES[field.diffCase] || DIFF_CLASSES.scalar
  return (
    <li className={clsx('text-sm leading-snug break-words', cls)}>
      {field.rendered || ''}
    </li>
  )
}

// TA/DA Class Labels (Phase 2, April 2026).
// Kept in lockstep with backend taDaChangeRequest.js VALID_CLASSES (0..5).
// Class semantics from sales_consolidated_design.md.

export const TA_DA_CLASS_LABELS = {
  0: 'Flag for Review',
  1: 'Fixed TA/DA Package',
  2: 'Tiered DA, No TA',
  3: 'Flat DA + Per-km TA',
  4: 'Tiered DA + Per-km TA',
  5: 'Tiered DA + Dual-Vehicle TA',
}

export function classLabel(n) {
  if (n === null || n === undefined) return '—'
  const label = TA_DA_CLASS_LABELS[Number(n)]
  return label ? `Class ${n}: ${label}` : `Class ${n}`
}

// Which rate fields are relevant per class. Used by the request modal
// to show/hide inputs and by the employee-master view to render only
// the meaningful rates per class. Aligned with sales_consolidated_design.md
// §2.1 / §3 — irrelevant fields stay NULL on the employee row.
//   Class 0  Flag for Review        — no rate fields apply
//   Class 1  Fixed TA/DA Package    — single DA value (per day)
//   Class 2  Tiered DA, no TA       — DA in-city + DA outstation
//   Class 3  Flat DA + per-km TA    — DA (per day) + TA primary
//   Class 4  Tiered DA + per-km TA  — DA in-city + DA outstation + TA primary
//   Class 5  Dual-vehicle           — all 4 (TA primary = bike, secondary = car)
export function ratesForClass(n) {
  const c = Number(n)
  switch (c) {
    case 0: return []
    case 1: return ['da_rate']
    case 2: return ['da_rate', 'da_outstation_rate']
    case 3: return ['da_rate', 'ta_rate_primary']
    case 4: return ['da_rate', 'da_outstation_rate', 'ta_rate_primary']
    case 5: return ['da_rate', 'da_outstation_rate', 'ta_rate_primary', 'ta_rate_secondary']
    default: return []
  }
}

// Generic, class-neutral labels. Kept for backward compat (e.g. for any
// future generic display where class context isn't available).
export const RATE_FIELD_LABELS = {
  da_rate: 'DA Rate (in-city)',
  da_outstation_rate: 'DA Rate (outstation)',
  ta_rate_primary: 'TA Rate (primary vehicle, per km)',
  ta_rate_secondary: 'TA Rate (secondary vehicle, per km)',
}

// Class-aware label for rate inputs in the Request modal. Falls back to
// the generic label when the class doesn't override.
//   Class 1: da_rate           → "DA Rate (per day)"      (no in-city/outstation split)
//   Class 3: da_rate           → "DA Rate (per day)"      (single flat DA)
//   Class 3/4: ta_rate_primary → "TA Rate (₹ per km)"     (no "primary vehicle" prefix)
//   Class 5: ta_rate_primary   → "TA Rate (bike, ₹ per km)"
//   Class 5: ta_rate_secondary → "TA Rate (car, ₹ per km)"
export function labelForRate(rateKey, classNum) {
  const c = Number(classNum)
  if ((c === 1 || c === 3) && rateKey === 'da_rate') return 'DA Rate (per day)'
  if ((c === 3 || c === 4) && rateKey === 'ta_rate_primary') return 'TA Rate (₹ per km)'
  if (c === 5 && rateKey === 'ta_rate_primary')   return 'TA Rate (bike, ₹ per km)'
  if (c === 5 && rateKey === 'ta_rate_secondary') return 'TA Rate (car, ₹ per km)'
  return RATE_FIELD_LABELS[rateKey] || rateKey
}

export const STATUS_BADGE = {
  pending:    { label: 'Pending',    classes: 'bg-amber-100 text-amber-800 border-amber-300' },
  approved:   { label: 'Approved',   classes: 'bg-green-100 text-green-800 border-green-300' },
  rejected:   { label: 'Rejected',   classes: 'bg-red-100 text-red-800 border-red-300' },
  superseded: { label: 'Superseded', classes: 'bg-slate-100 text-slate-600 border-slate-300' },
  cancelled:  { label: 'Cancelled',  classes: 'bg-slate-100 text-slate-500 border-slate-300' },
}

// Computation status (Phase 3) — used on the TA/DA register and employee
// detail to show where a row sits in the compute → review → paid lifecycle.
// Kept in lockstep with backend status enum on sales_ta_da_computations:
// 'computed' | 'partial' | 'flag_for_review' | 'paid'. Color tokens match
// STATUS_BADGE above so HR sees the same visual language as Phase 2.
export const COMPUTATION_STATUS_BADGE = {
  computed:        { label: 'Computed',        classes: 'bg-green-100 text-green-800 border-green-300' },
  partial:         { label: 'Partial',         classes: 'bg-amber-100 text-amber-800 border-amber-300' },
  flag_for_review: { label: 'Flag for Review', classes: 'bg-red-100 text-red-800 border-red-300' },
  paid:            { label: 'Paid',            classes: 'bg-slate-100 text-slate-600 border-slate-300' },
}

export function computationStatusLabel(status) {
  return COMPUTATION_STATUS_BADGE[status]?.label ?? 'Unknown'
}

export function computationStatusBadgeClass(status) {
  return COMPUTATION_STATUS_BADGE[status]?.classes ?? 'bg-slate-100 text-slate-500 border-slate-300'
}

export function relativeTime(isoOrNull) {
  if (!isoOrNull) return '—'
  const then = new Date(isoOrNull)
  if (Number.isNaN(then.getTime())) return isoOrNull
  const secs = Math.round((Date.now() - then.getTime()) / 1000)
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  const days = Math.floor(secs / 86400)
  if (days < 30) return `${days}d ago`
  return then.toLocaleDateString()
}

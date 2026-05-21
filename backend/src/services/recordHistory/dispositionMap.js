'use strict';

/**
 * Disposition map for audit_log rows on the Record History Timeline (Design C, v3).
 *
 * Pure function. No I/O, no DB. Classifies a single audit_log row into a
 * timeline-friendly disposition: category + label + severity + countsAsHumanWork.
 *
 * Resolution order (most-specific first):
 *   1. Attendance special case (table='attendance_processed') — dispatched by
 *      field_name, NOT by changed_by. `changed_by` is always 'HR Operator' for
 *      attendance regardless of whether the writer was a human or a service.
 *   2. Exact triple (table_name, action_type, field_name).
 *   3. Pair fallback (table_name, action_type, *).
 *   4. Table default (table_name, *, *).
 *   5. Unknown fallback — human_change + flaggedForReview:true. Surfaces, never hides.
 */

// 2. Exact triple lookup. Key format: "table|action|field" with literal "null" for null action.
const TRIPLE_MAP = {
  // employees
  'employees|shift_change|shift_assignment':           { category: 'human_change', label: 'Shift changed',                          severity: 'normal' },
  'employees|null|status':                             { category: 'human_change', label: 'Employee status changed',                severity: 'normal' },

  // extra_duty_grants
  'extra_duty_grants|null|status':                     { category: 'human_change', label: 'Extra-duty status set',                  severity: 'normal' },
  'extra_duty_grants|null|finance_status':             { category: 'human_change', label: 'Extra-duty finance status set',          severity: 'normal' },

  // late_coming_deductions
  'late_coming_deductions|null|applied_to_salary':                       { category: 'system_write',  label: 'Late-coming applied to salary', severity: 'low'    },
  'late_coming_deductions|finance_review|finance_status':                { category: 'human_change',  label: 'Late-coming finance review',    severity: 'normal' },
  'late_coming_deductions|late_deduction_applied|deduction_applied':     { category: 'human_change',  label: 'Late deduction applied',        severity: 'normal' },

  // early_exit_deductions
  'early_exit_deductions|null|finance_status':         { category: 'human_change', label: 'Early-exit finance status set',          severity: 'normal' },
  'early_exit_deductions|null|salary_applied':         { category: 'system_write', label: 'Early-exit applied to salary',           severity: 'low'    },

  // salary_computations
  'salary_computations|null|salary_held':              { category: 'human_change', label: 'Salary hold toggled',                    severity: 'high'   },

  // salary_manual_flags
  'salary_manual_flags|null|finance_approved':         { category: 'human_change', label: 'Manual flag finance-approved',           severity: 'normal' },

  // sales_salary_computations
  'sales_salary_computations|status_change|status':    { category: 'human_change', label: 'Sales salary status changed',            severity: 'normal' },
  'sales_salary_computations|compute|compute_run':     { category: 'system_write', label: 'Sales salary computed',                  severity: 'low'    },
  'sales_salary_computations|neft_export|neft_exported': { category: 'human_change', label: 'Sales NEFT exported',                  severity: 'normal' },

  // sales_ta_da_*
  'sales_ta_da_monthly_inputs|tada_inputs_patch|inputs_patch': { category: 'human_change', label: 'TA/DA inputs patched', severity: 'normal' },
  'sales_ta_da_computations|tada_compute_manual|recompute':    { category: 'human_change', label: 'TA/DA recomputed',     severity: 'normal' },
  'sales_ta_da_computations|tada_neft_export|neft_export':     { category: 'human_change', label: 'TA/DA NEFT exported',  severity: 'normal' },

  // sales_monthly_input
  'sales_monthly_input|manual_match|employee_code':    { category: 'human_change', label: 'Sales row manually matched',             severity: 'normal' },

  // sales_employees (exact triples — update/* goes through pair fallback)
  'sales_employees|create|created':                    { category: 'human_change', label: 'Sales employee created',                  severity: 'normal' },
  'sales_employees|mark_left|status':                  { category: 'human_change', label: 'Sales employee marked left',              severity: 'normal' },

  // sales_uploads
  'sales_uploads|create|uploaded':                     { category: 'human_change', label: 'Sales file uploaded',                     severity: 'normal' },
  'sales_uploads|confirm|status':                      { category: 'human_change', label: 'Sales upload confirmed',                   severity: 'normal' },

  // sales_holidays
  'sales_holidays|create|created':                     { category: 'human_change', label: 'Sales holiday created',                   severity: 'normal' },

  // sales_salary_structures
  'sales_salary_structures|backfill_create|salary_structure': { category: 'system_write', label: 'Salary structure backfilled (migration)', severity: 'low' },

  // policy_config
  'policy_config|policy_change|sales_leniency':        { category: 'human_change', label: 'Policy changed',                          severity: 'normal' },
  'policy_config|policy_read|sales_leniency':          { category: 'excluded',     label: '(read event)',                            severity: 'low'    },

  // diagnostic
  'diagnostic|null|health':                            { category: 'excluded',     label: '(diagnostic)',                            severity: 'low'    },
  'diagnostic|null|query':                             { category: 'excluded',     label: '(diagnostic)',                            severity: 'low'    },
  'diagnostic|null|query_rejected':                    { category: 'excluded',     label: '(diagnostic)',                            severity: 'low'    },
};

// 3. Pair fallback. Used when (table, action) is defined but the field isn't in TRIPLE_MAP.
const PAIR_MAP = {
  'sales_employees|update':                  { category: 'human_change', label: 'Sales employee field updated', severity: 'normal' },
  'sales_salary_computations|manual_override': { category: 'human_change', label: 'Sales salary overridden',     severity: 'normal' },
};

// 4. Table default. Used when only the table matches.
const TABLE_MAP = {
  'sales_data_correction': { category: 'human_change', label: 'Bulk data correction', severity: 'high' },
};

// 1. Attendance dispatch by field_name (changed_by is non-discriminating for this table).
const ATTENDANCE_FIELDS = {
  reimport:                  { category: 'system_write', label: 'Attendance reimported',                       severity: 'low'    },
  reimport_replay:           { category: 'system_write', label: 'Manual correction restored after reimport',   severity: 'low'    },
  actual_hours:              { category: 'system_write', label: 'Hours recomputed',                            severity: 'low'    },
  stage_5_done:              { category: 'system_write', label: 'Stage 5 marked done',                         severity: 'low'    },
  in_time:                   { category: 'human_change', label: 'In-time corrected (miss-punch)',              severity: 'normal' },
  out_time:                  { category: 'human_change', label: 'Out-time corrected (miss-punch)',             severity: 'normal' },
  in_time_final:             { category: 'human_change', label: 'In-time finalised (Stage 5)',                 severity: 'normal' },
  out_time_final:            { category: 'human_change', label: 'Out-time finalised (Stage 5)',                severity: 'normal' },
  status_final:              { category: 'human_change', label: 'Status finalised (Stage 5)',                  severity: 'normal' },
  shift_id:                  { category: 'human_change', label: 'Shift reassigned (day)',                      severity: 'normal' },
  correction_remark:         { category: 'human_change', label: 'Correction remark added',                     severity: 'normal' },
  miss_punch_finance_status: { category: 'human_change', label: 'Miss-punch finance status set',               severity: 'normal' },
};

function humanize(tableName) {
  if (!tableName || typeof tableName !== 'string') return 'Unknown';
  const cleaned = tableName.replace(/_/g, ' ').trim();
  if (!cleaned) return 'Unknown';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function finalize(d) {
  // Fresh object each call so lookup tables stay immutable to callers.
  const out = {
    category: d.category,
    label: d.label,
    severity: d.severity,
    countsAsHumanWork: d.category === 'human_change',
  };
  if (d.flaggedForReview) out.flaggedForReview = true;
  return out;
}

function unknownFallback(table) {
  return finalize({
    category: 'human_change',
    label: humanize(table),
    severity: 'normal',
    flaggedForReview: true,
  });
}

function classifyDisposition(row) {
  const table = row && row.table_name;
  const action = row && row.action_type;
  const field = row && row.field_name;

  // 1. Attendance special case.
  if (table === 'attendance_processed') {
    const hit = ATTENDANCE_FIELDS[field];
    if (hit) return finalize(hit);
    return unknownFallback(table);
  }

  // Normalize null/undefined action to literal "null" for keying.
  const actionKey = (action === null || action === undefined) ? 'null' : action;

  // 2. Exact triple.
  const tripleHit = TRIPLE_MAP[`${table}|${actionKey}|${field}`];
  if (tripleHit) return finalize(tripleHit);

  // 3. Pair fallback.
  const pairHit = PAIR_MAP[`${table}|${actionKey}`];
  if (pairHit) return finalize(pairHit);

  // 4. Table default.
  const tableHit = TABLE_MAP[table];
  if (tableHit) return finalize(tableHit);

  // 5. Unknown fallback.
  return unknownFallback(table);
}

module.exports = { classifyDisposition };

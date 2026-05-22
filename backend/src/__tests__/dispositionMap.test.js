'use strict';

const { classifyDisposition } = require('../services/recordHistory/dispositionMap');

// Live audit_log vocabulary as of 2026-05-21.
// Every triple Claude can encounter today, with the expected category.
// (Severity is asserted in section D; countsAsHumanWork in section E.)
const LIVE_VOCABULARY = [
  // --- Attendance: system_write (4) ---
  { table: 'attendance_processed', action: null, field: 'reimport',        category: 'system_write' },
  { table: 'attendance_processed', action: null, field: 'reimport_replay', category: 'system_write' },
  { table: 'attendance_processed', action: null, field: 'actual_hours',    category: 'system_write' },
  { table: 'attendance_processed', action: null, field: 'stage_5_done',    category: 'system_write' },

  // --- Attendance: human_change (8) ---
  { table: 'attendance_processed', action: null, field: 'in_time',                   category: 'human_change' },
  { table: 'attendance_processed', action: null, field: 'out_time',                  category: 'human_change' },
  { table: 'attendance_processed', action: null, field: 'in_time_final',             category: 'human_change' },
  { table: 'attendance_processed', action: null, field: 'out_time_final',            category: 'human_change' },
  { table: 'attendance_processed', action: null, field: 'status_final',              category: 'human_change' },
  { table: 'attendance_processed', action: null, field: 'shift_id',                  category: 'human_change' },
  { table: 'attendance_processed', action: null, field: 'correction_remark',         category: 'human_change' },
  { table: 'attendance_processed', action: null, field: 'miss_punch_finance_status', category: 'human_change' },

  // --- employees (2) ---
  { table: 'employees', action: 'shift_change', field: 'shift_assignment', category: 'human_change' },
  { table: 'employees', action: null,           field: 'status',           category: 'human_change' },

  // --- extra_duty_grants (2) ---
  { table: 'extra_duty_grants', action: null, field: 'status',         category: 'human_change' },
  { table: 'extra_duty_grants', action: null, field: 'finance_status', category: 'human_change' },

  // --- late_coming_deductions (3) ---
  { table: 'late_coming_deductions', action: null,                       field: 'applied_to_salary',  category: 'system_write' },
  { table: 'late_coming_deductions', action: 'finance_review',           field: 'finance_status',     category: 'human_change' },
  { table: 'late_coming_deductions', action: 'late_deduction_applied',   field: 'deduction_applied',  category: 'human_change' },

  // --- early_exit_deductions (2) ---
  { table: 'early_exit_deductions', action: null, field: 'finance_status', category: 'human_change' },
  { table: 'early_exit_deductions', action: null, field: 'salary_applied', category: 'system_write' },

  // --- salary_computations (1) ---
  { table: 'salary_computations', action: null, field: 'salary_held', category: 'human_change' },

  // --- salary_manual_flags (1) ---
  { table: 'salary_manual_flags', action: null, field: 'finance_approved', category: 'human_change' },

  // --- sales_salary_computations exact triples (3) ---
  { table: 'sales_salary_computations', action: 'status_change', field: 'status',         category: 'human_change' },
  { table: 'sales_salary_computations', action: 'compute',       field: 'compute_run',    category: 'system_write' },
  { table: 'sales_salary_computations', action: 'neft_export',   field: 'neft_exported',  category: 'human_change' },

  // --- sales_ta_da_* (3) ---
  { table: 'sales_ta_da_monthly_inputs', action: 'tada_inputs_patch',   field: 'inputs_patch', category: 'human_change' },
  { table: 'sales_ta_da_computations',   action: 'tada_compute_manual', field: 'recompute',    category: 'human_change' },
  { table: 'sales_ta_da_computations',   action: 'tada_neft_export',    field: 'neft_export',  category: 'human_change' },

  // --- sales_monthly_input (1) ---
  { table: 'sales_monthly_input', action: 'manual_match', field: 'employee_code', category: 'human_change' },

  // --- sales_employees exact triples (2) ---
  { table: 'sales_employees', action: 'create',    field: 'created', category: 'human_change' },
  { table: 'sales_employees', action: 'mark_left', field: 'status',  category: 'human_change' },

  // --- sales_uploads (2) ---
  { table: 'sales_uploads', action: 'create',  field: 'uploaded', category: 'human_change' },
  { table: 'sales_uploads', action: 'confirm', field: 'status',   category: 'human_change' },

  // --- sales_holidays (1) ---
  { table: 'sales_holidays', action: 'create', field: 'created', category: 'human_change' },

  // --- sales_salary_structures (1) ---
  { table: 'sales_salary_structures', action: 'backfill_create', field: 'salary_structure', category: 'system_write' },

  // --- policy_config (2) ---
  { table: 'policy_config', action: 'policy_change', field: 'sales_leniency', category: 'human_change' },
  { table: 'policy_config', action: 'policy_read',   field: 'sales_leniency', category: 'excluded'     },

  // --- diagnostic: excluded (3) ---
  { table: 'diagnostic', action: null, field: 'health',         category: 'excluded' },
  { table: 'diagnostic', action: null, field: 'query',          category: 'excluded' },
  { table: 'diagnostic', action: null, field: 'query_rejected', category: 'excluded' },

  // --- sales_employees pair-fallback (update/*) — 14 fields ---
  { table: 'sales_employees', action: 'update', field: 'aadhaar',            category: 'human_change' },
  { table: 'sales_employees', action: 'update', field: 'account_no',         category: 'human_change' },
  { table: 'sales_employees', action: 'update', field: 'bank_name',          category: 'human_change' },
  { table: 'sales_employees', action: 'update', field: 'designation',        category: 'human_change' },
  { table: 'sales_employees', action: 'update', field: 'dob',                category: 'human_change' },
  { table: 'sales_employees', action: 'update', field: 'gross_salary',       category: 'human_change' },
  { table: 'sales_employees', action: 'update', field: 'headquarters',       category: 'human_change' },
  { table: 'sales_employees', action: 'update', field: 'ifsc',               category: 'human_change' },
  { table: 'sales_employees', action: 'update', field: 'pan',                category: 'human_change' },
  { table: 'sales_employees', action: 'update', field: 'personal_contact',   category: 'human_change' },
  { table: 'sales_employees', action: 'update', field: 'reporting_manager',  category: 'human_change' },
  { table: 'sales_employees', action: 'update', field: 'state',              category: 'human_change' },
  { table: 'sales_employees', action: 'update', field: 'status',             category: 'human_change' },
  { table: 'sales_employees', action: 'update', field: 'working_hours',      category: 'human_change' },

  // --- sales_salary_computations pair-fallback (manual_override/*) — 3 fields ---
  { table: 'sales_salary_computations', action: 'manual_override', field: 'diwali_bonus',     category: 'human_change' },
  { table: 'sales_salary_computations', action: 'manual_override', field: 'incentive_amount', category: 'human_change' },
  { table: 'sales_salary_computations', action: 'manual_override', field: 'other_deductions', category: 'human_change' },

  // --- sales_data_correction table fallback (1) ---
  { table: 'sales_data_correction', action: 'apply_correction', field: 'value', category: 'human_change' },
];

describe('classifyDisposition', () => {
  describe('A. live vocabulary categories', () => {
    LIVE_VOCABULARY.forEach(({ table, action, field, category }) => {
      const actionStr = action === null ? 'null' : action;
      it(`${table} / ${actionStr} / ${field} → ${category}`, () => {
        const r = classifyDisposition({ table_name: table, action_type: action, field_name: field });
        expect(r.category).toBe(category);
      });
    });
  });

  describe('B. attendance discrimination (Section 3.2 heart)', () => {
    it('out_time at Stage 2 with Gate Register remark → human_change (despite HR Operator)', () => {
      const r = classifyDisposition({
        table_name: 'attendance_processed',
        action_type: null,
        field_name: 'out_time',
        stage: 'Stage 2',
        remark: 'Gate Register: ...',
        changed_by: 'HR Operator',
      });
      expect(r.category).toBe('human_change');
    });

    it('in_time_final at Stage 5 → human_change', () => {
      const r = classifyDisposition({
        table_name: 'attendance_processed',
        action_type: null,
        field_name: 'in_time_final',
        stage: 'Stage 5',
        remark: 'Manual correction',
        changed_by: 'HR Operator',
      });
      expect(r.category).toBe('human_change');
    });

    it('actual_hours at Stage 5 with same writer → system_write (the discriminator is field, not writer)', () => {
      const r = classifyDisposition({
        table_name: 'attendance_processed',
        action_type: null,
        field_name: 'actual_hours',
        stage: 'Stage 5',
        remark: 'Manual correction',
        changed_by: 'HR Operator',
      });
      expect(r.category).toBe('system_write');
    });

    it('stage_5_done → system_write', () => {
      const r = classifyDisposition({
        table_name: 'attendance_processed',
        action_type: null,
        field_name: 'stage_5_done',
        remark: 'Manual correction',
        changed_by: 'HR Operator',
      });
      expect(r.category).toBe('system_write');
    });

    it('reimport → system_write', () => {
      const r = classifyDisposition({
        table_name: 'attendance_processed',
        action_type: null,
        field_name: 'reimport',
        changed_by: 'HR Operator',
      });
      expect(r.category).toBe('system_write');
    });

    it('reimport_replay → system_write', () => {
      const r = classifyDisposition({
        table_name: 'attendance_processed',
        action_type: null,
        field_name: 'reimport_replay',
        remark: 'Restored manual correction (source: Gate Register)',
      });
      expect(r.category).toBe('system_write');
    });

    it('unknown attendance field routes to flagged unknown-fallback', () => {
      const r = classifyDisposition({
        table_name: 'attendance_processed',
        action_type: null,
        field_name: 'some_new_field_someone_added',
        changed_by: 'HR Operator',
      });
      expect(r.category).toBe('human_change');
      expect(r.flaggedForReview).toBe(true);
    });
  });

  describe('C. unknown fallback', () => {
    it('fully unknown triple → human_change with flaggedForReview', () => {
      const r = classifyDisposition({
        table_name: 'some_future_table',
        action_type: 'whatever',
        field_name: 'x',
      });
      expect(r.category).toBe('human_change');
      expect(r.flaggedForReview).toBe(true);
    });

    it('humanizes table_name in the label', () => {
      const r = classifyDisposition({
        table_name: 'some_future_table',
        action_type: 'whatever',
        field_name: 'x',
      });
      expect(r.label).toBe('Some future table');
    });

    it('known triple does NOT get flaggedForReview', () => {
      const r = classifyDisposition({
        table_name: 'employees',
        action_type: 'shift_change',
        field_name: 'shift_assignment',
      });
      expect(r.flaggedForReview).toBeUndefined();
    });
  });

  describe('D. severity', () => {
    it('salary_computations / salary_held → high', () => {
      const r = classifyDisposition({
        table_name: 'salary_computations',
        action_type: null,
        field_name: 'salary_held',
      });
      expect(r.severity).toBe('high');
    });

    it('sales_data_correction (any action/field) → high', () => {
      const r = classifyDisposition({
        table_name: 'sales_data_correction',
        action_type: 'apply_correction',
        field_name: 'value',
      });
      expect(r.severity).toBe('high');
    });

    it('every system_write in the live vocabulary is low severity', () => {
      const systemWrites = LIVE_VOCABULARY.filter(v => v.category === 'system_write');
      expect(systemWrites.length).toBeGreaterThan(0);
      systemWrites.forEach(({ table, action, field }) => {
        const r = classifyDisposition({ table_name: table, action_type: action, field_name: field });
        expect(r.severity).toBe('low');
      });
    });

    it('every excluded row in the live vocabulary is low severity', () => {
      const excluded = LIVE_VOCABULARY.filter(v => v.category === 'excluded');
      expect(excluded.length).toBeGreaterThan(0);
      excluded.forEach(({ table, action, field }) => {
        const r = classifyDisposition({ table_name: table, action_type: action, field_name: field });
        expect(r.severity).toBe('low');
      });
    });
  });

  describe('E. countsAsHumanWork invariant', () => {
    it('matches (category === human_change) across the full live vocabulary', () => {
      LIVE_VOCABULARY.forEach(({ table, action, field }) => {
        const r = classifyDisposition({ table_name: table, action_type: action, field_name: field });
        expect(r.countsAsHumanWork).toBe(r.category === 'human_change');
      });
    });

    it('unknown fallback countsAsHumanWork is true', () => {
      const r = classifyDisposition({ table_name: 'whatever', action_type: 'x', field_name: 'y' });
      expect(r.countsAsHumanWork).toBe(true);
    });

    it('excluded row countsAsHumanWork is false', () => {
      const r = classifyDisposition({ table_name: 'diagnostic', action_type: null, field_name: 'health' });
      expect(r.countsAsHumanWork).toBe(false);
    });

    it('system_write row countsAsHumanWork is false', () => {
      const r = classifyDisposition({
        table_name: 'attendance_processed',
        action_type: null,
        field_name: 'reimport',
      });
      expect(r.countsAsHumanWork).toBe(false);
    });
  });
});

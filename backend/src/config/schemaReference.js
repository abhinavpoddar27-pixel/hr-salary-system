/**
 * Schema reference for the natural language query tool.
 * This text is sent to Claude API as context for English→SQL translation.
 * Update this file whenever schema.js adds/removes tables or columns.
 */

const SCHEMA_REFERENCE = `
DATABASE: SQLite (better-sqlite3)
COMPANIES: "Indriyan Beverages", "Asian Lakto Ind. Ltd."
MONTH/YEAR: Most queries use month (INTEGER 1-12) and year (INTEGER like 2026)

=== KEY TABLES ===

employees (employee master — ~300 rows)
  code TEXT UNIQUE, name TEXT, father_name TEXT, department TEXT, designation TEXT,
  company TEXT, employment_type TEXT ('Permanent'/'Contractor'), date_of_joining TEXT,
  date_of_exit TEXT, status TEXT ('Active'/'Left'/'Inactive'), gross_salary REAL,
  pf_applicable INTEGER, esi_applicable INTEGER, weekly_off_day INTEGER (0=Sun..6=Sat),
  shift_code TEXT, bank_name TEXT, account_number TEXT, ifsc_code TEXT,
  pf_number TEXT, uan TEXT, esi_number TEXT, aadhaar_masked TEXT, pan TEXT

salary_structures (versioned salary breakdown per employee)
  employee_id INTEGER FK→employees(id), effective_from TEXT,
  gross_salary REAL, basic REAL, da REAL, hra REAL, conveyance REAL,
  special_allowance REAL, other_allowances REAL,
  basic_percent REAL, da_percent REAL, hra_percent REAL,
  pf_applicable INTEGER, esi_applicable INTEGER

day_calculations (Stage 6 output — one row per employee per month)
  employee_code TEXT, month INTEGER, year INTEGER, company TEXT,
  total_calendar_days INTEGER, total_sundays INTEGER, total_holidays INTEGER,
  total_working_days INTEGER, days_present REAL, days_half_present REAL,
  days_wop REAL, days_absent INTEGER, paid_sundays REAL, unpaid_sundays INTEGER,
  paid_holidays INTEGER, cl_used REAL, el_used REAL, sl_used REAL,
  lop_days REAL, total_payable_days REAL, ot_hours REAL, ot_days REAL,
  cl_used REAL, el_used REAL, sl_used REAL (historical only — SL abolished Sept 2026),
  lop_days REAL, od_days REAL, short_leave_days REAL, uninformed_absent REAL,
  late_deduction_days REAL, late_deduction_remark TEXT,
  salary_stale INTEGER (1 = Stage 7 needs recompute), leave_recomputed_at TEXT,
  UNIQUE(employee_code, month, year, company)

salary_computations (Stage 7 output — one row per employee per month)
  employee_code TEXT, month INTEGER, year INTEGER, company TEXT,
  payable_days REAL, per_day_rate REAL, gross_salary REAL,
  basic_earned REAL, da_earned REAL, hra_earned REAL,
  conveyance_earned REAL, other_allowances_earned REAL,
  ot_pay REAL, gross_earned REAL,
  pf_wages REAL, esi_wages REAL,
  pf_employee REAL, pf_employer REAL, eps REAL,
  esi_employee REAL, esi_employer REAL,
  professional_tax REAL, tds REAL,
  advance_recovery REAL, lop_deduction REAL, other_deductions REAL,
  total_deductions REAL, net_salary REAL,
  is_finalised INTEGER, salary_held INTEGER, hold_reason TEXT,
  late_coming_deduction REAL, early_exit_deduction REAL,
  cl_days REAL, el_days REAL, lwp_days REAL, od_days REAL,
  short_leave_days REAL, uninformed_absent_days REAL (all display-only — pay flows through payable_days),
  UNIQUE(employee_code, month, year, company)

attendance_processed (daily attendance records — ~31 rows per employee per month)
  employee_code TEXT, date TEXT, employee_name TEXT, department TEXT, company TEXT,
  status_original TEXT, status_final TEXT ('P'/'A'/'WO'/'HO'/'WOP'/'HP'/'L'),
  in_time_original TEXT, out_time_original TEXT,
  in_time_final TEXT, out_time_final TEXT,
  shift_code TEXT, is_miss_punch INTEGER, is_night_out_only INTEGER,
  is_left_late INTEGER, left_late_minutes INTEGER,
  UNIQUE(employee_code, date) via index

extra_duty_grants (HR-initiated extra duty for OT/ED pay)
  employee_code TEXT, grant_date TEXT, month INTEGER, year INTEGER, company TEXT,
  grant_type TEXT, duty_days REAL, status TEXT ('PENDING'/'APPROVED'/'REJECTED'),
  finance_status TEXT ('UNREVIEWED'/'FINANCE_APPROVED'/'FINANCE_FLAGGED'/'FINANCE_REJECTED'),
  requested_by TEXT, approved_by TEXT, salary_impact_amount REAL,
  UNIQUE(employee_code, grant_date, month, year)

salary_advances (mid-month advance per employee)
  employee_code TEXT, month INTEGER, year INTEGER,
  eligible_amount REAL, approved_amount REAL, is_paid INTEGER,
  recovery_status TEXT, recovered_in_month INTEGER, recovered_in_year INTEGER

loans (employee loans with EMI tracking)
  employee_id INTEGER, employee_code TEXT, loan_type TEXT,
  principal REAL, emi_amount REAL, total_emis INTEGER,
  emis_remaining INTEGER, status TEXT

holidays (national holiday master)
  date TEXT, name TEXT, type TEXT, applicable_to TEXT

leave_balances (leave balance per employee per year — the live figure HR sees)
  employee_id INTEGER, year INTEGER, leave_type TEXT ('CL'/'EL'),
  opening REAL, accrued REAL, used REAL, balance REAL,
  UNIQUE(employee_id, year, leave_type)

leave_applications (one row per leave request)
  employee_id INTEGER, employee_code TEXT, leave_type TEXT ('CL'/'EL'/'LWP'),
  start_date TEXT, end_date TEXT, days REAL, reason TEXT, hr_remark TEXT,
  status TEXT ('Pending'/'Approved'/'Rejected'), applied_at TEXT,
  approved_by TEXT, approved_at TEXT, rejection_reason TEXT
  NOTE: there is NO created_at column — order by applied_at.

leave_accrual_ledger (per employee per year per month per leave type)
  employee_code TEXT, employee_id INTEGER, year INTEGER, month INTEGER, leave_type TEXT,
  opening_balance REAL, accrued REAL, used REAL, lapsed REAL, closing_balance REAL,
  paid_days_this_month REAL, paid_days_ytd REAL, el_earned_ytd REAL, company TEXT,
  UNIQUE(employee_code, year, month, leave_type)

leave_transactions (audit trail of balance movements)
  employee_id INTEGER, employee_code TEXT, company TEXT, leave_type TEXT,
  transaction_type TEXT ('Credit'/'Debit'/'Year-End Lapse'), days REAL,
  balance_after REAL, reference_month INTEGER, reference_year INTEGER,
  reason TEXT, approved_by TEXT, created_at TEXT

leave_external_grants (EL given outside the system — owner-uploaded)
  employee_code TEXT, employee_id INTEGER, year INTEGER, month INTEGER,
  leave_type TEXT, days REAL, mode TEXT ('leave_taken'/'paid_salary'/'paid_cash'),
  paid_month INTEGER, paid_year INTEGER, remark TEXT, source_file TEXT,
  uploaded_by TEXT, uploaded_at TEXT, is_active INTEGER,
  UNIQUE(employee_code, year, month, leave_type, mode)

leave_change_flags (a change that would have hit a finalized month)
  employee_code TEXT, company TEXT, month INTEGER, year INTEGER,
  reason TEXT, detail TEXT, created_at TEXT, cleared_at TEXT, cleared_by TEXT

leave_recompute_runs (log of every leave recompute)
  scope TEXT ('trigger'/'nightly'/'manual'/'auto_stage6'), company TEXT,
  month INTEGER, year INTEGER, employee_count INTEGER,
  started_at TEXT, finished_at TEXT, status TEXT, message TEXT

compensatory_off_requests (comp-off / OD — HR creates, finance approves)
  employee_code TEXT, start_date TEXT, end_date TEXT, days REAL,
  month INTEGER, year INTEGER, company TEXT, reason TEXT, hr_remark TEXT,
  finance_status TEXT ('pending'/'approved'/'rejected'), finance_remark TEXT

short_leaves (gate passes — quota 2 per employee per calendar month)
  employee_code TEXT, date TEXT, company TEXT, duration_hours REAL,
  authorized_leave_until TEXT, quota_breach INTEGER, cancelled_at TEXT

audit_log (change audit trail)
  table_name TEXT, record_id INTEGER, field_name TEXT,
  old_value TEXT, new_value TEXT, changed_by TEXT, changed_at TEXT

usage_logs (API request log)
  username TEXT, role TEXT, action TEXT, method TEXT, path TEXT,
  request_id TEXT, details TEXT, created_at TEXT

late_coming_deductions (HR-initiated deductions for chronic tardiness)
  employee_code TEXT, month INTEGER, year INTEGER,
  deduction_days REAL, reason TEXT,
  finance_status TEXT ('pending'/'approved'/'rejected'),
  is_applied_to_salary INTEGER

finance_audit_status (per-employee finance review status)
  employee_code TEXT, month INTEGER, year INTEGER,
  status TEXT, reviewed_by TEXT

finance_month_signoff (monthly finance sign-off)
  month INTEGER, year INTEGER, company TEXT,
  status TEXT, signed_by TEXT

=== COMMON JOIN PATTERNS ===
- employees.code = salary_computations.employee_code
- employees.code = day_calculations.employee_code
- employees.code = attendance_processed.employee_code
- employees.code = extra_duty_grants.employee_code
- employees.id = salary_structures.employee_id
- day_calculations and salary_computations join on (employee_code, month, year, company)

=== IMPORTANT NOTES ===
- Dates are stored as TEXT in 'YYYY-MM-DD' format
- Money values are REAL (not INTEGER)
- company is either 'Indriyan Beverages' or 'Asian Lakto Ind. Ltd.'
- employment_type is 'Permanent' or 'Contractor'
- status_final values: P=Present, A=Absent, WO=Weekly Off, HO=Holiday, WOP=Without Pay present, HP=Half Present, L=Leave
- The current active month is usually the latest in monthly_imports
`;

module.exports = { SCHEMA_REFERENCE };

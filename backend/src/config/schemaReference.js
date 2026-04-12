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
  late_coming_deduction REAL,
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

leave_balances (leave balance per employee per year)
  employee_id INTEGER, year INTEGER, leave_type TEXT,
  opening REAL, accrued REAL, used REAL, balance REAL

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

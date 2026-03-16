function initSchema(db) {
  db.exec(`
    -- ─────────────────────────────────────────────────────────
    -- MASTER TABLES
    -- ─────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      grace_minutes INTEGER DEFAULT 30,
      is_overnight INTEGER DEFAULT 0,
      break_minutes INTEGER DEFAULT 0,
      min_hours_full_day REAL DEFAULT 10.0,
      min_hours_half_day REAL DEFAULT 4.0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      father_name TEXT,
      dob TEXT,
      gender TEXT,
      department TEXT,
      designation TEXT,
      company TEXT,
      employment_type TEXT DEFAULT 'Permanent',
      contractor_group TEXT,
      date_of_joining TEXT,
      date_of_exit TEXT,
      exit_reason TEXT,
      default_shift_id INTEGER REFERENCES shifts(id),
      shift_code TEXT DEFAULT 'DAY',
      weekly_off_day INTEGER DEFAULT 0,
      bank_account TEXT,
      account_number TEXT,
      ifsc TEXT,
      ifsc_code TEXT,
      bank_name TEXT,
      pf_number TEXT,
      uan TEXT,
      esi_number TEXT,
      aadhaar_masked TEXT,
      aadhar TEXT,
      pan TEXT,
      phone TEXT,
      email TEXT,
      gross_salary REAL DEFAULT 0,
      pf_applicable INTEGER DEFAULT 1,
      esi_applicable INTEGER DEFAULT 1,
      pt_applicable INTEGER DEFAULT 1,
      status TEXT DEFAULT 'Active',
      is_data_complete INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'National',
      is_recurring INTEGER DEFAULT 0,
      applicable_to TEXT DEFAULT 'All',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS salary_structures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER REFERENCES employees(id),
      effective_from TEXT NOT NULL,
      gross_salary REAL DEFAULT 0,
      basic REAL DEFAULT 0,
      da REAL DEFAULT 0,
      hra REAL DEFAULT 0,
      conveyance REAL DEFAULT 0,
      special_allowance REAL DEFAULT 0,
      other_allowances REAL DEFAULT 0,
      basic_percent REAL DEFAULT 50,
      da_percent REAL DEFAULT 0,
      hra_percent REAL DEFAULT 20,
      pf_applicable INTEGER DEFAULT 1,
      esi_applicable INTEGER DEFAULT 1,
      pt_applicable INTEGER DEFAULT 1,
      pf_wage_ceiling REAL DEFAULT 15000,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS leave_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER REFERENCES employees(id),
      year INTEGER NOT NULL,
      leave_type TEXT NOT NULL,
      opening REAL DEFAULT 0,
      accrued REAL DEFAULT 0,
      used REAL DEFAULT 0,
      balance REAL DEFAULT 0,
      UNIQUE(employee_id, year, leave_type)
    );

    -- ─────────────────────────────────────────────────────────
    -- MONTHLY PROCESSING TABLES
    -- ─────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS monthly_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      file_name TEXT,
      imported_at TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'imported',
      record_count INTEGER DEFAULT 0,
      employee_count INTEGER DEFAULT 0,
      sheet_name TEXT,
      company TEXT,
      stage_1_done INTEGER DEFAULT 0,
      stage_2_done INTEGER DEFAULT 0,
      stage_3_done INTEGER DEFAULT 0,
      stage_4_done INTEGER DEFAULT 0,
      stage_5_done INTEGER DEFAULT 0,
      stage_6_done INTEGER DEFAULT 0,
      stage_7_done INTEGER DEFAULT 0,
      is_finalised INTEGER DEFAULT 0,
      finalised_at TEXT,
      UNIQUE(month, year, company)
    );

    CREATE TABLE IF NOT EXISTS attendance_raw (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER REFERENCES monthly_imports(id),
      employee_code TEXT NOT NULL,
      employee_name TEXT,
      department TEXT,
      company TEXT,
      date TEXT NOT NULL,
      day_of_week TEXT,
      status_code TEXT,
      in_time TEXT,
      out_time TEXT,
      total_hours_eesl TEXT
    );

    CREATE TABLE IF NOT EXISTS attendance_processed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_id INTEGER REFERENCES attendance_raw(id),
      employee_id INTEGER REFERENCES employees(id),
      employee_code TEXT NOT NULL,
      date TEXT NOT NULL,
      status_original TEXT,
      status_final TEXT,
      in_time_original TEXT,
      in_time_final TEXT,
      out_time_original TEXT,
      out_time_final TEXT,
      actual_hours REAL,
      shift_id INTEGER REFERENCES shifts(id),
      shift_detected TEXT,
      is_night_shift INTEGER DEFAULT 0,
      night_pair_date TEXT,
      night_pair_confidence TEXT,
      is_night_out_only INTEGER DEFAULT 0,
      is_miss_punch INTEGER DEFAULT 0,
      miss_punch_type TEXT,
      miss_punch_resolved INTEGER DEFAULT 0,
      correction_source TEXT,
      correction_remark TEXT,
      is_late_arrival INTEGER DEFAULT 0,
      late_by_minutes INTEGER DEFAULT 0,
      is_early_departure INTEGER DEFAULT 0,
      early_by_minutes INTEGER DEFAULT 0,
      is_overtime INTEGER DEFAULT 0,
      overtime_minutes INTEGER DEFAULT 0,
      stage_2_done INTEGER DEFAULT 0,
      stage_3_done INTEGER DEFAULT 0,
      stage_4_done INTEGER DEFAULT 0,
      stage_5_done INTEGER DEFAULT 0,
      month INTEGER,
      year INTEGER,
      company TEXT
    );

    CREATE TABLE IF NOT EXISTS night_shift_pairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT NOT NULL,
      in_record_id INTEGER REFERENCES attendance_processed(id),
      out_record_id INTEGER REFERENCES attendance_processed(id),
      in_date TEXT,
      out_date TEXT,
      in_time TEXT,
      out_time TEXT,
      calculated_hours REAL,
      confidence TEXT DEFAULT 'high',
      is_confirmed INTEGER DEFAULT 0,
      is_rejected INTEGER DEFAULT 0,
      month INTEGER,
      year INTEGER,
      company TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS day_calculations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER REFERENCES employees(id),
      employee_code TEXT,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      company TEXT,
      total_calendar_days INTEGER,
      total_sundays INTEGER,
      total_holidays INTEGER,
      total_working_days INTEGER,
      days_present REAL DEFAULT 0,
      days_half_present REAL DEFAULT 0,
      days_wop REAL DEFAULT 0,
      days_absent INTEGER DEFAULT 0,
      paid_sundays REAL DEFAULT 0,
      unpaid_sundays INTEGER DEFAULT 0,
      paid_holidays INTEGER DEFAULT 0,
      cl_used REAL DEFAULT 0,
      el_used REAL DEFAULT 0,
      sl_used REAL DEFAULT 0,
      lop_days REAL DEFAULT 0,
      total_payable_days REAL DEFAULT 0,
      ot_hours REAL DEFAULT 0,
      ot_days REAL DEFAULT 0,
      is_approved INTEGER DEFAULT 0,
      week_breakdown TEXT,
      UNIQUE(employee_code, month, year, company)
    );

    CREATE TABLE IF NOT EXISTS salary_computations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER REFERENCES employees(id),
      employee_code TEXT,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      company TEXT,
      payable_days REAL,
      per_day_rate REAL,
      gross_salary REAL DEFAULT 0,
      basic_earned REAL DEFAULT 0,
      da_earned REAL DEFAULT 0,
      hra_earned REAL DEFAULT 0,
      conveyance_earned REAL DEFAULT 0,
      other_allowances_earned REAL DEFAULT 0,
      ot_pay REAL DEFAULT 0,
      gross_earned REAL DEFAULT 0,
      pf_wages REAL DEFAULT 0,
      esi_wages REAL DEFAULT 0,
      pf_employee REAL DEFAULT 0,
      pf_employer REAL DEFAULT 0,
      eps REAL DEFAULT 0,
      esi_employee REAL DEFAULT 0,
      esi_employer REAL DEFAULT 0,
      professional_tax REAL DEFAULT 0,
      tds REAL DEFAULT 0,
      advance_recovery REAL DEFAULT 0,
      lop_deduction REAL DEFAULT 0,
      other_deductions REAL DEFAULT 0,
      total_deductions REAL DEFAULT 0,
      net_salary REAL DEFAULT 0,
      is_finalised INTEGER DEFAULT 0,
      finalised_at TEXT,
      UNIQUE(employee_code, month, year, company)
    );

    -- ─────────────────────────────────────────────────────────
    -- COMPLIANCE
    -- ─────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS compliance_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      month INTEGER,
      year INTEGER,
      due_date TEXT,
      status TEXT DEFAULT 'Pending',
      challan_number TEXT,
      filing_date TEXT,
      amount REAL,
      receipt_path TEXT,
      remarks TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────────────────────
    -- ALERTS
    -- ─────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      severity TEXT DEFAULT 'Warning',
      employee_id INTEGER,
      employee_code TEXT,
      department TEXT,
      month INTEGER,
      year INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      is_read INTEGER DEFAULT 0,
      is_resolved INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────────────────────
    -- AUDIT
    -- ─────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT,
      record_id INTEGER,
      field_name TEXT,
      old_value TEXT,
      new_value TEXT,
      changed_by TEXT DEFAULT 'HR Operator',
      changed_at TEXT DEFAULT (datetime('now')),
      stage TEXT,
      remark TEXT
    );

    -- ─────────────────────────────────────────────────────────
    -- POLICY CONFIG
    -- ─────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS policy_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      description TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────────────────────
    -- AUTH
    -- ─────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    );

    -- ─────────────────────────────────────────────────────────
    -- ANALYTICS (pre-computed)
    -- ─────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS monthly_dept_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      department TEXT,
      company TEXT,
      month INTEGER,
      year INTEGER,
      headcount INTEGER,
      new_joins INTEGER DEFAULT 0,
      exits INTEGER DEFAULT 0,
      total_man_days_available INTEGER,
      total_man_days_utilised REAL,
      attendance_rate REAL,
      punctuality_rate REAL,
      avg_hours_per_day REAL,
      total_ot_hours REAL,
      chronic_absentee_count INTEGER,
      habitual_late_count INTEGER,
      total_salary_cost REAL,
      UNIQUE(department, company, month, year)
    );

    CREATE TABLE IF NOT EXISTS monthly_employee_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER,
      employee_code TEXT,
      month INTEGER,
      year INTEGER,
      days_present REAL,
      days_absent INTEGER,
      days_half REAL,
      days_wo INTEGER,
      days_wop REAL,
      late_count INTEGER,
      early_departure_count INTEGER,
      avg_hours REAL,
      total_hours REAL,
      ot_hours REAL,
      attendance_rate REAL,
      punctuality_rate REAL,
      net_salary REAL,
      UNIQUE(employee_code, month, year)
    );
  `);

  // Insert default shifts if not exists
  const shiftCount = db.prepare('SELECT COUNT(*) as cnt FROM shifts').get();
  if (shiftCount.cnt === 0) {
    db.prepare(`INSERT INTO shifts (name, code, start_time, end_time, grace_minutes, is_overnight, min_hours_full_day, min_hours_half_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('Day Shift', 'DAY', '08:00', '20:00', 30, 0, 10.0, 4.0);
    db.prepare(`INSERT INTO shifts (name, code, start_time, end_time, grace_minutes, is_overnight, min_hours_full_day, min_hours_half_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('Night Shift', 'NIGHT', '20:00', '08:00', 30, 1, 10.0, 4.0);
    db.prepare(`INSERT INTO shifts (name, code, start_time, end_time, grace_minutes, is_overnight, min_hours_full_day, min_hours_half_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('General Shift', 'GEN', '09:00', '18:00', 30, 0, 7.0, 3.0);
  }

  // Insert default policy config
  const policyCount = db.prepare('SELECT COUNT(*) as cnt FROM policy_config').get();
  if (policyCount.cnt === 0) {
    const policies = [
      ['salary_divisor', '26', 'Days divisor for per-day rate (26, 30, or calendar)'],
      ['grace_minutes', '30', 'Grace period in minutes for shift start/end'],
      ['min_hours_full_day', '10', 'Minimum hours for full working day'],
      ['min_hours_half_day', '4', 'Minimum hours for half working day'],
      ['ot_threshold_hours', '12', 'Hours after which OT starts for production'],
      ['ot_rate_multiplier', '2', 'OT pay multiplier (1 or 2)'],
      ['pf_employee_rate', '0.12', 'PF employee contribution rate'],
      ['pf_employer_rate', '0.12', 'PF employer contribution rate'],
      ['pf_wage_ceiling', '15000', 'PF wage ceiling (0 = no ceiling)'],
      ['esi_employee_rate', '0.0075', 'ESI employee contribution rate'],
      ['esi_employer_rate', '0.0325', 'ESI employer contribution rate'],
      ['esi_threshold', '21000', 'ESI applicability gross salary threshold'],
      ['sunday_grant_threshold', '6', 'Working days needed for full paid Sunday'],
      ['sunday_partial_min', '4', 'Min working days for partial Sunday grant'],
      ['sandwich_rule', '0', 'Apply sandwich rule for absences between holidays'],
      ['wop_as_ot', '0', 'Treat WOP as overtime day'],
      ['late_threshold_minutes', '30', 'Minutes after shift start considered late'],
      ['early_departure_minutes', '30', 'Minutes before shift end considered early departure'],
      ['min_wage_unskilled', '9000', 'Punjab minimum wage - unskilled (per month)'],
      ['min_wage_semi_skilled', '10000', 'Punjab minimum wage - semi-skilled'],
      ['min_wage_skilled', '12000', 'Punjab minimum wage - skilled'],
      ['el_accrual_rate', '1', 'EL days accrued per 20 working days'],
      ['cl_annual_entitlement', '12', 'CL days per year'],
      ['pt_slab_1_limit', '15000', 'Punjab PT slab 1 upper limit'],
      ['pt_slab_1_amount', '0', 'Punjab PT for income up to slab 1'],
      ['pt_slab_2_limit', '25000', 'Punjab PT slab 2 upper limit'],
      ['pt_slab_2_amount', '150', 'Punjab PT for income in slab 2'],
      ['pt_slab_3_amount', '200', 'Punjab PT for income above slab 2'],
    ];
    const insertPolicy = db.prepare('INSERT OR IGNORE INTO policy_config (key, value, description) VALUES (?, ?, ?)');
    policies.forEach(p => insertPolicy.run(...p));
  }

  // Insert default holidays for 2025-2026
  const holidayCount = db.prepare('SELECT COUNT(*) as cnt FROM holidays').get();
  if (holidayCount.cnt === 0) {
    const holidays2025 = [
      ['2025-01-26', 'Republic Day', 'National', 1],
      ['2025-03-17', 'Holi', 'National', 0],
      ['2025-04-14', 'Ambedkar Jayanti', 'National', 0],
      ['2025-04-18', 'Good Friday', 'National', 0],
      ['2025-08-15', 'Independence Day', 'National', 1],
      ['2025-10-02', 'Gandhi Jayanti', 'National', 1],
      ['2025-10-02', 'Dussehra', 'National', 0],
      ['2025-10-20', 'Diwali', 'National', 0],
      ['2025-11-05', 'Guru Nanak Jayanti', 'National', 0],
      ['2025-12-25', 'Christmas', 'National', 0],
      ['2026-01-26', 'Republic Day', 'National', 1],
    ];
    const insertHoliday = db.prepare('INSERT OR IGNORE INTO holidays (date, name, type, is_recurring) VALUES (?, ?, ?, ?)');
    holidays2025.forEach(h => insertHoliday.run(...h));
  }

  console.log('✅ Database schema initialized');
}

module.exports = { initSchema };

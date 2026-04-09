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
      grace_minutes INTEGER DEFAULT 9,
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
      pf_applicable INTEGER DEFAULT 0,
      esi_applicable INTEGER DEFAULT 0,
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
      pf_applicable INTEGER DEFAULT 0,
      esi_applicable INTEGER DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS leave_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER REFERENCES employees(id),
      employee_code TEXT NOT NULL,
      company TEXT,
      leave_type TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      days REAL NOT NULL,
      balance_after REAL,
      reference_month INTEGER,
      reference_year INTEGER,
      reason TEXT,
      approved_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_leave_transactions_employee ON leave_transactions(employee_code);

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
    -- SALARY ADVANCES
    -- ─────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS salary_advances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER REFERENCES employees(id),
      employee_code TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      working_days_1_to_15 INTEGER DEFAULT 0,
      is_eligible INTEGER DEFAULT 0,
      advance_amount REAL DEFAULT 0,
      calculation_date TEXT,
      paid INTEGER DEFAULT 0,
      paid_date TEXT,
      payment_mode TEXT DEFAULT 'Bank Transfer',
      recovered INTEGER DEFAULT 0,
      recovery_month INTEGER,
      recovery_year INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(employee_code, month, year)
    );

    -- ─────────────────────────────────────────────────────────
    -- SALARY CHANGE REQUESTS
    -- ─────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS salary_change_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER REFERENCES employees(id),
      employee_code TEXT NOT NULL,
      requested_by TEXT,
      old_gross REAL,
      new_gross REAL,
      old_structure TEXT,
      new_structure TEXT,
      reason TEXT,
      status TEXT DEFAULT 'Pending',
      approved_by TEXT,
      approved_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────────────────────
    -- LOANS & ADVANCE REGISTER
    -- ─────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER REFERENCES employees(id),
      employee_code TEXT NOT NULL,
      loan_type TEXT NOT NULL,
      principal_amount REAL NOT NULL,
      interest_rate REAL DEFAULT 0,
      total_amount REAL NOT NULL,
      emi_amount REAL NOT NULL,
      tenure_months INTEGER NOT NULL,
      start_month INTEGER,
      start_year INTEGER,
      status TEXT DEFAULT 'Active',
      approved_by TEXT,
      approved_at TEXT,
      disbursed_date TEXT,
      disbursement_mode TEXT DEFAULT 'Bank Transfer',
      total_recovered REAL DEFAULT 0,
      remaining_balance REAL DEFAULT 0,
      remarks TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS loan_repayments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id INTEGER REFERENCES loans(id),
      employee_code TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      emi_amount REAL NOT NULL,
      principal_component REAL DEFAULT 0,
      interest_component REAL DEFAULT 0,
      deducted_from_salary INTEGER DEFAULT 0,
      deduction_date TEXT,
      status TEXT DEFAULT 'Pending',
      remarks TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────────────────────
    -- EMPLOYEE DOCUMENTS
    -- ─────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS employee_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER REFERENCES employees(id),
      employee_code TEXT NOT NULL,
      document_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_by TEXT,
      remarks TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────────────────────
    -- LEAVE APPLICATIONS
    -- ─────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS leave_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER REFERENCES employees(id),
      employee_code TEXT NOT NULL,
      leave_type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      days REAL NOT NULL,
      reason TEXT,
      status TEXT DEFAULT 'Pending',
      applied_at TEXT DEFAULT (datetime('now')),
      approved_by TEXT,
      approved_at TEXT,
      rejection_reason TEXT,
      remarks TEXT
    );

    -- ─────────────────────────────────────────────────────────
    -- NOTIFICATIONS
    -- ─────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      action_url TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────────────────────
    -- EMPLOYEE LIFECYCLE
    -- ─────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS employee_lifecycle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER REFERENCES employees(id),
      employee_code TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      details TEXT,
      from_value TEXT,
      to_value TEXT,
      remarks TEXT,
      processed_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
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
    -- USAGE LOGS (admin-only visibility)
    -- ─────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      role TEXT,
      action TEXT NOT NULL,
      method TEXT,
      path TEXT,
      ip_address TEXT,
      user_agent TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
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

  // ── Company Configuration ────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL UNIQUE,
      short_name TEXT,
      pf_establishment_code TEXT,
      esi_code TEXT,
      address_line1 TEXT,
      address_line2 TEXT,
      city TEXT,
      state TEXT,
      pin TEXT,
      pan TEXT,
      tan TEXT,
      bank_name TEXT,
      bank_account TEXT,
      bank_ifsc TEXT,
      logo_path TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seed company config if empty
  const companyCount = db.prepare('SELECT COUNT(*) as cnt FROM company_config').get();
  if (companyCount.cnt === 0) {
    const insertCompany = db.prepare(`INSERT OR IGNORE INTO company_config (company_name, short_name, state, city) VALUES (?, ?, ?, ?)`);
    insertCompany.run('Indriyan Beverages Pvt Ltd', 'IBPL', 'Punjab', 'Mohali');
    insertCompany.run('Asian Lakto Ind Ltd', 'ALIL', 'Punjab', 'Mohali');
  }

  // ── Migrations: Add new columns to existing tables ──────────────

  const safeAddColumn = (table, column, type) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    } catch (e) {
      // Column already exists — ignore
    }
  };

  // salary_computations: gross change detection + salary hold + loan recovery
  safeAddColumn('salary_computations', 'prev_month_gross', 'REAL DEFAULT 0');
  safeAddColumn('salary_computations', 'gross_changed', 'INTEGER DEFAULT 0');
  safeAddColumn('salary_computations', 'salary_held', 'INTEGER DEFAULT 0');
  safeAddColumn('salary_computations', 'hold_reason', 'TEXT');
  safeAddColumn('salary_computations', 'hold_released', 'INTEGER DEFAULT 0');
  safeAddColumn('salary_computations', 'hold_released_by', 'TEXT');
  safeAddColumn('salary_computations', 'hold_released_at', 'TEXT');
  safeAddColumn('salary_computations', 'loan_recovery', 'REAL DEFAULT 0');

  // employees: enhanced personal info + document support
  safeAddColumn('employees', 'blood_group', 'TEXT');
  safeAddColumn('employees', 'emergency_contact_name', 'TEXT');
  safeAddColumn('employees', 'emergency_contact_phone', 'TEXT');
  safeAddColumn('employees', 'address_current', 'TEXT');
  safeAddColumn('employees', 'address_permanent', 'TEXT');
  safeAddColumn('employees', 'marital_status', 'TEXT');
  safeAddColumn('employees', 'spouse_name', 'TEXT');
  safeAddColumn('employees', 'qualification', 'TEXT');
  safeAddColumn('employees', 'experience_years', 'REAL DEFAULT 0');
  safeAddColumn('employees', 'previous_employer', 'TEXT');
  safeAddColumn('employees', 'probation_end_date', 'TEXT');
  safeAddColumn('employees', 'confirmation_date', 'TEXT');
  safeAddColumn('employees', 'category', 'TEXT');
  safeAddColumn('employees', 'photo_path', 'TEXT');
  safeAddColumn('employees', 'notes', 'TEXT');
  safeAddColumn('employees', 'inactive_since', 'TEXT');
  safeAddColumn('employees', 'auto_inactive', 'INTEGER DEFAULT 0');
  safeAddColumn('employees', 'was_left_returned', 'INTEGER DEFAULT 0');

  // monthly_imports: daily vs monthly import type
  safeAddColumn('monthly_imports', 'import_type', "TEXT DEFAULT 'monthly'");

  // ── Add new policy config keys if missing ─────────────────────
  const insertPolicyIfMissing = db.prepare('INSERT OR IGNORE INTO policy_config (key, value, description) VALUES (?, ?, ?)');
  insertPolicyIfMissing.run('salary_hold_min_days', '5', 'Minimum payable days below which salary is held');
  insertPolicyIfMissing.run('advance_cutoff_date', '20', 'Attendance data cutoff date for advance calculation (1st to 20th)');
  insertPolicyIfMissing.run('advance_min_working_days', '0', 'Minimum working days for advance eligibility (0 = any working days)');
  insertPolicyIfMissing.run('advance_fraction', '0.50', 'Fraction of gross salary paid as advance (>=15 days)');
  insertPolicyIfMissing.run('advance_process_date', '19', 'Date of month when advance processing starts');

  // salary_advances: add remark column for advance actions
  safeAddColumn('salary_advances', 'remark', "TEXT DEFAULT ''");

  // Update advance policy config
  const insertPolicyIfMissing2 = db.prepare('INSERT OR IGNORE INTO policy_config (key, value, description) VALUES (?, ?, ?)');
  insertPolicyIfMissing2.run('advance_fraction', '0.55', 'Fraction of gross salary paid as advance (>=15 days) — 55%');
  insertPolicyIfMissing2.run('advance_fraction_low', '0.80', 'Fraction of pro-rata salary for advance (<15 days) — 80%');
  // Update existing advance_fraction from 0.50 to 0.55
  db.prepare("UPDATE policy_config SET value = '0.55', description = 'Fraction of gross salary paid as advance (>=15 days) — 55%' WHERE key = 'advance_fraction' AND value = '0.50'").run();

  // ── Force-reset policy config to known defaults (undo any HR-user modifications) ──
  const policyDefaults = [
    ['salary_divisor', '26'],
    ['pf_employee_rate', '0.12'],
    ['pf_employer_rate', '0.12'],
    ['pf_wage_ceiling', '15000'],
    ['esi_employee_rate', '0.0075'],
    ['esi_employer_rate', '0.0325'],
    ['esi_threshold', '21000'],
    ['ot_rate_multiplier', '2'],
    ['ot_threshold_hours', '12'],
    ['pt_slab_1_limit', '15000'],
    ['pt_slab_1_amount', '0'],
    ['pt_slab_2_limit', '25000'],
    ['pt_slab_2_amount', '150'],
    ['pt_slab_3_amount', '200'],
    ['salary_hold_min_days', '5'],
    ['advance_fraction', '0.55'],
    ['advance_fraction_low', '0.80'],
    ['sunday_grant_threshold', '6'],
    ['sunday_partial_min', '4'],
  ];
  const resetPolicy = db.prepare("UPDATE policy_config SET value = ? WHERE key = ?");
  for (const [key, value] of policyDefaults) {
    resetPolicy.run(value, key);
  }

  // shifts: add duration_hours column for auto-calculated end time (Late Coming Phase 1)
  safeAddColumn('shifts', 'duration_hours', 'REAL');

  // shifts: update grace to 9 minutes for ALL shifts (per actual plant policy, Late Coming Phase 1)
  db.prepare("UPDATE shifts SET grace_minutes = 9 WHERE grace_minutes != 9").run();

  // Late Coming Phase 1: Insert three canonical shifts if they don't already exist.
  // 12HR, 10HR, 9HR — these are the three employee shift types used by HR to
  // assign punctuality expectations. Grace is 9 min for all (plant policy).
  db.prepare(`INSERT OR IGNORE INTO shifts (name, code, start_time, end_time, grace_minutes, is_overnight, break_minutes, min_hours_full_day, min_hours_half_day, duration_hours)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('12-Hour Shift', '12HR', '08:00', '20:00', 9, 0, 0, 10.0, 4.0, 12);
  db.prepare(`INSERT OR IGNORE INTO shifts (name, code, start_time, end_time, grace_minutes, is_overnight, break_minutes, min_hours_full_day, min_hours_half_day, duration_hours)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('10-Hour Shift', '10HR', '09:00', '19:00', 9, 0, 0, 8.0, 4.0, 10);
  db.prepare(`INSERT OR IGNORE INTO shifts (name, code, start_time, end_time, grace_minutes, is_overnight, break_minutes, min_hours_full_day, min_hours_half_day, duration_hours)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('9-Hour Shift', '9HR', '09:30', '18:30', 9, 0, 0, 7.0, 4.0, 9);

  // Backfill duration_hours on shifts that don't have it yet (derive from start/end times).
  // Handles overnight shifts correctly by adding 24 to the end when it wraps midnight.
  try {
    const shiftsNeedingDuration = db.prepare("SELECT id, start_time, end_time, is_overnight FROM shifts WHERE duration_hours IS NULL OR duration_hours = 0").all();
    const updDuration = db.prepare("UPDATE shifts SET duration_hours = ? WHERE id = ?");
    for (const s of shiftsNeedingDuration) {
      const [sh, sm] = String(s.start_time || '').split(':').map(Number);
      const [eh, em] = String(s.end_time || '').split(':').map(Number);
      if (isNaN(sh) || isNaN(eh)) continue;
      let startMin = sh * 60 + (sm || 0);
      let endMin = eh * 60 + (em || 0);
      if (endMin <= startMin) endMin += 24 * 60; // overnight
      const hrs = Math.round((endMin - startMin) / 60 * 100) / 100;
      updDuration.run(hrs, s.id);
    }
  } catch (e) {
    console.warn('[schema] duration_hours backfill failed:', e.message);
  }

  // PF/ESI: disabled by default — set all existing records to 0 unless explicitly set via master import
  // This runs idempotently on every startup but only affects defaults
  db.prepare("UPDATE employees SET pf_applicable = 0 WHERE pf_applicable = 1 AND (uan IS NULL OR uan = '') AND (pf_number IS NULL OR pf_number = '')").run();
  db.prepare("UPDATE employees SET esi_applicable = 0 WHERE esi_applicable = 1 AND (esi_number IS NULL OR esi_number = '')").run();
  db.prepare("UPDATE salary_structures SET pf_applicable = 0 WHERE pf_applicable = 1 AND employee_id IN (SELECT id FROM employees WHERE (uan IS NULL OR uan = '') AND (pf_number IS NULL OR pf_number = ''))").run();
  db.prepare("UPDATE salary_structures SET esi_applicable = 0 WHERE esi_applicable = 1 AND employee_id IN (SELECT id FROM employees WHERE (esi_number IS NULL OR esi_number = ''))").run();

  // users: RBAC company access
  safeAddColumn('users', 'allowed_companies', "TEXT DEFAULT '*'");
  safeAddColumn('users', 'last_active', 'TEXT');
  safeAddColumn('users', 'onboarding_completed', 'INTEGER DEFAULT 0');
  safeAddColumn('users', 'department', 'TEXT');
  safeAddColumn('users', 'employee_code', 'TEXT');

  // ── Role normalisation migration (April 2026) ──
  // The permission layer requires canonical lowercase roles ('admin', 'hr',
  // 'finance', 'supervisor', 'viewer', 'employee'). Historically the user
  // create/update endpoints trusted the admin's input verbatim, so any user
  // created with "Finance" (capitalised from a dropdown label) silently lost
  // finance-only features because the case-sensitive `includes('finance')`
  // check failed. Run a one-time idempotent normalisation on startup:
  //   1. trim whitespace
  //   2. lowercase
  //   3. coerce unknown values to 'viewer' so we don't leak perms.
  try {
    const rows = db.prepare('SELECT id, role FROM users').all();
    const VALID = new Set(['admin', 'hr', 'finance', 'supervisor', 'viewer', 'employee']);
    const upd = db.prepare('UPDATE users SET role = ? WHERE id = ?');
    let fixed = 0;
    for (const u of rows) {
      const trimmed = String(u.role || '').trim().toLowerCase();
      let canonical = 'viewer';
      if (VALID.has(trimmed)) canonical = trimmed;
      else for (const v of VALID) if (trimmed.split(/[\s_-]+/).includes(v)) { canonical = v; break; }
      if (canonical !== u.role) { upd.run(canonical, u.id); fixed++; }
    }
    if (fixed > 0) console.log(`[schema] Normalised ${fixed} user role(s) to canonical lowercase form`);
  } catch (e) {
    console.warn('[schema] user role normalisation failed:', e.message);
  }

  // ── April 2026: rescue the 'finance' user account ──
  // The Settings → Users dropdown historically only offered viewer / hr /
  // admin (Settings.jsx:667-671), so the account named "finance" was
  // created with role='hr' and silently lost every finance-only
  // permission (extra-duty approval, finance verification, OT payable,
  // miss-punch finance review, gross-salary change approval).
  //
  // Fix it once, never re-run, never touch a role that the admin has
  // intentionally set to 'admin'. Tracked via policy_config so a later
  // admin demotion of the finance account isn't fought on the next deploy.
  const financeUserMigrationDone = db.prepare(
    "SELECT value FROM policy_config WHERE key = 'migration_finance_user_role_v1'"
  ).get();
  if (!financeUserMigrationDone) {
    try {
      const u = db.prepare("SELECT id, role FROM users WHERE username = 'finance'").get();
      if (u && u.role !== 'finance' && u.role !== 'admin') {
        db.prepare("UPDATE users SET role = 'finance' WHERE id = ?").run(u.id);
        console.log(`[MIGRATION] Reset 'finance' user role from '${u.role}' → 'finance'`);
      }
      db.prepare(
        "INSERT OR REPLACE INTO policy_config (key, value, description) VALUES ('migration_finance_user_role_v1', '1', 'One-time April 2026 finance user role correction (complete)')"
      ).run();
    } catch (e) {
      console.warn('[MIGRATION] finance-user role correction failed:', e.message);
    }
  }

  // ── April 2026: backfill the miss-punch finance review queue ──
  // resolveMissPunch() now stamps miss_punch_finance_status='pending' on
  // every fresh HR resolution, but historical resolutions (made before
  // that stamp existed) still have finance_status='' (the TEXT column
  // default). Those invisible records never show up in the new
  // Finance Verification → Miss Punch Review tab, which was the user-
  // reported bug: "HR already corrected miss punches but they don't
  // appear for finance verify".
  //
  // Promote every resolved-but-unstamped row into the pending queue so
  // finance can review + bulk approve the backlog. Idempotent via
  // policy_config flag so it never re-runs on subsequent deploys.
  const missPunchQueueMigrationDone = db.prepare(
    "SELECT value FROM policy_config WHERE key = 'migration_miss_punch_finance_queue_v1'"
  ).get();
  if (!missPunchQueueMigrationDone) {
    try {
      const res = db.prepare(
        "UPDATE attendance_processed SET miss_punch_finance_status = 'pending' WHERE is_miss_punch = 1 AND miss_punch_resolved = 1 AND (miss_punch_finance_status IS NULL OR miss_punch_finance_status = '')"
      ).run();
      if (res.changes > 0) {
        console.log(`[MIGRATION] Promoted ${res.changes} resolved miss punches to 'pending' finance review`);
      }
      db.prepare(
        "INSERT OR REPLACE INTO policy_config (key, value, description) VALUES ('migration_miss_punch_finance_queue_v1', '1', 'One-time April 2026 miss-punch finance queue backfill (complete)')"
      ).run();
    } catch (e) {
      console.warn('[MIGRATION] miss-punch finance queue backfill failed:', e.message);
    }
  }

  // notifications: add columns for month-end scheduler
  safeAddColumn('notifications', 'role_target', 'TEXT');
  safeAddColumn('notifications', 'user_id', 'INTEGER');
  safeAddColumn('notifications', 'link', 'TEXT');
  safeAddColumn('day_calculations', 'is_contractor', 'INTEGER DEFAULT 0');
  safeAddColumn('employees', 'is_contractor', 'INTEGER DEFAULT 0');
  safeAddColumn('salary_computations', 'finance_remark', "TEXT DEFAULT ''");

  // ── Holiday Master enhancements ─────────────────────────────
  safeAddColumn('holidays', 'added_by', "TEXT DEFAULT 'System'");
  safeAddColumn('holidays', 'added_at', "TEXT DEFAULT (datetime('now'))");
  safeAddColumn('holidays', 'is_active', 'INTEGER DEFAULT 1');
  safeAddColumn('day_calculations', 'holiday_duty_days', 'REAL DEFAULT 0');

  // ── April 2026 salary overhaul: monthly leniency model + contractor split ──
  safeAddColumn('day_calculations', 'sunday_threshold', 'INTEGER');
  safeAddColumn('day_calculations', 'sunday_note', 'TEXT');
  safeAddColumn('salary_computations', 'is_contractor', 'INTEGER DEFAULT 0');
  safeAddColumn('salary_computations', 'days_in_month', 'INTEGER');
  safeAddColumn('salary_computations', 'regular_days', 'REAL DEFAULT 0');
  safeAddColumn('salary_computations', 'ot_days', 'REAL DEFAULT 0');
  safeAddColumn('salary_computations', 'ot_daily_rate', 'REAL DEFAULT 0');
  safeAddColumn('salary_computations', 'manual_extra_duty', 'REAL DEFAULT 0');
  safeAddColumn('salary_computations', 'punch_based_ot', 'REAL DEFAULT 0');
  safeAddColumn('salary_computations', 'finance_extra_duty', 'REAL DEFAULT 0');
  safeAddColumn('salary_computations', 'ot_note', 'TEXT');
  safeAddColumn('salary_computations', 'total_payable', 'REAL DEFAULT 0');
  // NOTE: day_corrections CREATE TABLE runs LATER in this file (~line 919).
  // Its safeAddColumn migrations live AFTER the create statement — see below.
  safeAddColumn('salary_computations', 'holiday_duty_pay', 'REAL DEFAULT 0');

  // ── Extra Duty (ED) integration (April 2026) ──
  // ED grants are finance-approved manual entries (overnight stay, gate-record-only,
  // missed-punch reconciliation) that are NOT auto-detected by the biometric WOP
  // overflow logic. They are paid SEPARATELY from punch-based OT — same per-day rate
  // (gross / calendarDays) but a distinct column on salary_computations so the
  // payable-OT register and Stage 7 can show OT and ED side by side without
  // double-counting. take_home = total_payable + ed_pay (= net + ot + holidayDuty + ed).
  safeAddColumn('salary_computations', 'ed_days', 'REAL DEFAULT 0');
  safeAddColumn('salary_computations', 'ed_pay', 'REAL DEFAULT 0');
  safeAddColumn('salary_computations', 'take_home', 'REAL DEFAULT 0');

  // ── Late Coming deduction (April 2026 — Phase 2) ──
  // Finance-approved HR discretionary deduction for chronic late arrivals.
  // Rupees amount = deduction_days × (grossMonthly / calendarDays). Sourced from
  // late_coming_deductions rows with finance_status='approved' and is_applied_to_salary=0
  // at compute time, then the flag flips to 1 so recomputes don't double-count.
  safeAddColumn('salary_computations', 'late_coming_deduction', 'REAL DEFAULT 0');

  db.exec(`
    CREATE TABLE IF NOT EXISTS holiday_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      holiday_id INTEGER,
      action TEXT NOT NULL,
      holiday_date TEXT,
      holiday_name TEXT,
      old_values TEXT,
      new_values TEXT,
      changed_by TEXT NOT NULL,
      changed_at TEXT DEFAULT (datetime('now')),
      reason TEXT,
      affects_months TEXT,
      finance_reviewed INTEGER DEFAULT 0,
      finance_reviewed_by TEXT,
      finance_reviewed_at TEXT,
      finance_review_notes TEXT
    )
  `);

  // Seed 2026 national holidays (only if LOHRI doesn't exist yet)
  const lohriExists = db.prepare("SELECT id FROM holidays WHERE date = '2026-01-13' AND name = 'LOHRI'").get();
  if (!lohriExists) {
    // Remove old 2026 generic entries
    db.prepare("DELETE FROM holidays WHERE date LIKE '2026-%' AND added_by = 'System'").run();
    const holidays2026 = [
      ['2026-01-13', 'LOHRI'], ['2026-01-26', 'REPUBLIC DAY'], ['2026-03-04', 'HOLI'],
      ['2026-08-15', 'INDEPENDENCE DAY'], ['2026-09-04', 'JANMASHTAMI'], ['2026-10-02', 'GANDHI JAYANTI'],
      ['2026-10-20', 'DUSSEHRA'], ['2026-11-08', 'DIWALI'], ['2026-11-09', 'VISHWAKARMA DAY'], ['2026-11-24', 'GURUPURAV']
    ];
    const ins = db.prepare("INSERT OR IGNORE INTO holidays (date, name, type, is_recurring, applicable_to, added_by) VALUES (?, ?, 'National', 0, 'All', 'System')");
    holidays2026.forEach(([d, n]) => ins.run(d, n));
  }

  // day_calculations: late deduction support
  safeAddColumn('day_calculations', 'late_count', 'INTEGER DEFAULT 0');
  safeAddColumn('day_calculations', 'late_deduction_days', 'REAL DEFAULT 0');
  safeAddColumn('day_calculations', 'late_deduction_remark', "TEXT DEFAULT ''");

  // day_calculations: extra duty (payable > calendar days)
  safeAddColumn('day_calculations', 'extra_duty_days', 'REAL DEFAULT 0');

  // ── April 2026 day calculation overhaul: weekly off generalisation + baseline model ──
  safeAddColumn('day_calculations', 'weekly_off_day', 'INTEGER DEFAULT 0');
  safeAddColumn('day_calculations', 'base_entitlement', 'REAL DEFAULT 0');
  safeAddColumn('day_calculations', 'total_absences', 'REAL DEFAULT 0');
  safeAddColumn('day_calculations', 'effective_present', 'REAL DEFAULT 0');
  safeAddColumn('day_calculations', 'days_per_weekly_off', 'REAL DEFAULT 0');
  safeAddColumn('day_calculations', 'weekly_off_threshold', 'REAL');
  safeAddColumn('day_calculations', 'weekly_off_tier', 'TEXT');
  safeAddColumn('day_calculations', 'weekly_off_note', 'TEXT');

  // ── April 2026: DOJ-based holiday eligibility ──
  // Pre-DOJ holidays must NOT be paid for new joiners. Persisted for audit + finance review.
  safeAddColumn('day_calculations', 'date_of_joining', 'TEXT');
  safeAddColumn('day_calculations', 'holidays_before_doj', 'INTEGER DEFAULT 0');
  safeAddColumn('day_calculations', 'is_mid_month_joiner', 'INTEGER DEFAULT 0');

  // ── Finance-approved Extra Duty days (April 2026) ──
  // Display-only count of finance-approved extra_duty_grants for the month, after
  // excluding dates that overlap with WOP/punch-based OT. Stage 6 UI shows this
  // separately from `extra_duty_days` (which is the system-detected payable-overflow);
  // the two are independent reportable concepts.
  safeAddColumn('day_calculations', 'finance_ed_days', 'REAL DEFAULT 0');

  // ── Phase 1: Data integrity & deduplication ─────────────────────

  // monthly_imports: track reimports
  safeAddColumn('monthly_imports', 'reimport_count', 'INTEGER DEFAULT 0');
  safeAddColumn('monthly_imports', 'last_reimported_at', 'TEXT');

  // Unique indexes to prevent duplicate attendance records
  const safeCreateIndex = (sql) => {
    try { db.exec(sql); } catch (e) { /* index already exists — ignore */ }
  };

  // Within a single import, one record per employee per date
  safeCreateIndex(`CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_raw_dedup
    ON attendance_raw(import_id, employee_code, date)`);

  // Across all imports, one processed record per employee per date (regardless of company)
  // Migrate from old (employee_code, date, company) index to stricter (employee_code, date)
  try {
    // Check if stricter index already exists
    const strictIdx = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_attendance_processed_dedup'"
    ).get();
    const needsMigration = !strictIdx || (strictIdx.sql && strictIdx.sql.includes('company'));

    if (needsMigration) {
      console.log('[SCHEMA] Migrating attendance dedup index (removing company from unique constraint)...');
      db.pragma('foreign_keys = OFF');

      // Batch delete: delete all duplicates in one SQL (keep highest ID per employee+date)
      const delResult = db.prepare(`
        DELETE FROM attendance_processed
        WHERE id NOT IN (
          SELECT MAX(id) FROM attendance_processed
          GROUP BY employee_code, date
        )
      `).run();
      console.log(`[SCHEMA] Removed ${delResult.changes} duplicate records`);

      // Drop old index and create stricter one
      db.exec('DROP INDEX IF EXISTS idx_attendance_processed_dedup');
      db.exec(`CREATE UNIQUE INDEX idx_attendance_processed_dedup ON attendance_processed(employee_code, date)`);
      console.log('[SCHEMA] Stricter unique index created (employee_code, date)');

      db.pragma('foreign_keys = ON');
    }
  } catch (e) {
    console.warn('[SCHEMA] Dedup migration error (non-fatal):', e.message);
    // Ensure FK is back on even if migration fails — app should still start
    try { db.pragma('foreign_keys = ON'); } catch (_) {}
    // Fall back to old index if new one can't be created
    safeCreateIndex(`CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_processed_dedup
      ON attendance_processed(employee_code, date, company)`);
  }

  // Performance indexes for audit queries
  safeCreateIndex(`CREATE INDEX IF NOT EXISTS idx_audit_log_employee
    ON audit_log(table_name, changed_at)`);
  safeCreateIndex(`CREATE INDEX IF NOT EXISTS idx_audit_log_changed_by
    ON audit_log(changed_by, changed_at)`);

  // ── Phase 3: Finance Audit Module ───────────────────────────────

  // Day corrections: HR adjustments to system-computed payable days
  db.exec(`
    CREATE TABLE IF NOT EXISTS day_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER REFERENCES employees(id),
      employee_code TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      company TEXT,
      original_system_days REAL NOT NULL,
      corrected_days REAL NOT NULL,
      correction_delta REAL NOT NULL,
      correction_reason TEXT NOT NULL,
      correction_notes TEXT,
      corrected_by TEXT NOT NULL,
      corrected_at TEXT DEFAULT (datetime('now')),
      is_applied INTEGER DEFAULT 0,
      applied_at TEXT,
      UNIQUE(employee_code, month, year, company)
    );
  `);

  // Punch corrections: manual punch additions for missing biometric data
  db.exec(`
    CREATE TABLE IF NOT EXISTS punch_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER REFERENCES employees(id),
      employee_code TEXT NOT NULL,
      date TEXT NOT NULL,
      original_in_time TEXT,
      original_out_time TEXT,
      corrected_in_time TEXT,
      corrected_out_time TEXT,
      punch_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence_notes TEXT,
      added_by TEXT NOT NULL,
      added_at TEXT DEFAULT (datetime('now')),
      applied_to_processed INTEGER DEFAULT 0,
      attendance_processed_id INTEGER,
      UNIQUE(employee_code, date)
    );
  `);

  // Audit log: add employee_code and action_type for faster lookups
  safeAddColumn('audit_log', 'employee_code', 'TEXT');
  safeAddColumn('audit_log', 'action_type', 'TEXT');

  // Finance audit indexes
  safeCreateIndex(`CREATE INDEX IF NOT EXISTS idx_day_corrections_month
    ON day_corrections(month, year, company)`);
  safeCreateIndex(`CREATE INDEX IF NOT EXISTS idx_day_corrections_employee
    ON day_corrections(employee_code, month, year)`);
  safeCreateIndex(`CREATE INDEX IF NOT EXISTS idx_punch_corrections_date
    ON punch_corrections(date, employee_code)`);

  // ── day_corrections migrations (must run AFTER CREATE TABLE above) ──
  // Extra duty grant workflow reuses this table with correction_type='extra_duty'
  // + finance_verified=1. These columns are nullable with defaults so existing
  // rows keep working.
  safeAddColumn('day_corrections', 'correction_type', "TEXT DEFAULT 'day'");
  safeAddColumn('day_corrections', 'finance_verified', 'INTEGER DEFAULT 0');
  safeAddColumn('day_corrections', 'remark', 'TEXT');

  safeCreateIndex(`CREATE INDEX IF NOT EXISTS idx_audit_log_emp_code
    ON audit_log(employee_code, changed_at)`);
  safeCreateIndex(`CREATE INDEX IF NOT EXISTS idx_audit_log_action_type
    ON audit_log(action_type, changed_at)`);

  // ── Phase 3b: Manual attendance flags for finance verification ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS manual_attendance_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT NOT NULL,
      employee_name TEXT,
      company TEXT,
      date TEXT NOT NULL,
      month INTEGER,
      year INTEGER,
      evidence_type TEXT NOT NULL,
      reason TEXT,
      marked_by TEXT,
      marked_at TEXT DEFAULT (datetime('now')),
      finance_verified INTEGER DEFAULT 0,
      verified_by TEXT,
      verified_at TEXT,
      finance_remarks TEXT,
      UNIQUE(employee_code, date)
    );
  `);
  safeCreateIndex(`CREATE INDEX IF NOT EXISTS idx_manual_attendance_flags_month
    ON manual_attendance_flags(month, year, company)`);

  // ── Phase 4: Session tracking for user behavior analytics ──────

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      page TEXT,
      element_id TEXT,
      element_type TEXT,
      label TEXT,
      data TEXT,
      timestamp TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_daily_summary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      date TEXT NOT NULL,
      total_sessions INTEGER DEFAULT 0,
      total_duration_ms INTEGER DEFAULT 0,
      total_events INTEGER DEFAULT 0,
      pages_visited TEXT,
      top_features TEXT,
      error_count INTEGER DEFAULT 0,
      UNIQUE(username, date)
    );
  `);

  safeCreateIndex(`CREATE INDEX IF NOT EXISTS idx_session_events_user
    ON session_events(username, timestamp)`);
  safeCreateIndex(`CREATE INDEX IF NOT EXISTS idx_session_events_session
    ON session_events(session_id, timestamp)`);
  safeCreateIndex(`CREATE INDEX IF NOT EXISTS idx_session_events_type
    ON session_events(event_type, timestamp)`);
  safeCreateIndex(`CREATE INDEX IF NOT EXISTS idx_session_events_page
    ON session_events(page, event_type, timestamp)`);
  safeCreateIndex(`CREATE INDEX IF NOT EXISTS idx_session_events_username_ts
    ON session_events(username, timestamp)`);

  // ── Phase 5: Shift roster for rotating shift management ────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS shift_roster (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT NOT NULL,
      week_start TEXT NOT NULL,
      shift_id INTEGER REFERENCES shifts(id),
      shift_code TEXT NOT NULL,
      assigned_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(employee_code, week_start)
    );
  `);

  safeCreateIndex(`CREATE INDEX IF NOT EXISTS idx_shift_roster_employee
    ON shift_roster(employee_code, week_start)`);
  safeCreateIndex(`CREATE INDEX IF NOT EXISTS idx_shift_roster_week
    ON shift_roster(week_start, shift_code)`);

  // ── Phase 5: Finance Audit — Manual Intervention Tracking ────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS salary_manual_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      flag_type TEXT NOT NULL,
      field_name TEXT,
      system_value REAL DEFAULT 0,
      manual_value REAL DEFAULT 0,
      delta REAL DEFAULT 0,
      changed_by TEXT,
      changed_at TEXT DEFAULT (datetime('now')),
      finance_approved INTEGER DEFAULT 0,
      approved_by TEXT,
      approved_at TEXT,
      notes TEXT,
      UNIQUE(employee_code, month, year, flag_type)
    );
  `);

  safeCreateIndex(`CREATE INDEX IF NOT EXISTS idx_salary_manual_flags_month
    ON salary_manual_flags(employee_code, month, year)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      flag_id INTEGER REFERENCES salary_manual_flags(id),
      status TEXT DEFAULT 'PENDING',
      reviewed_by TEXT,
      reviewed_at TEXT,
      comments TEXT
    );
  `);

  // ── Tax Declarations ─────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS tax_declarations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT NOT NULL,
      financial_year TEXT NOT NULL,
      regime TEXT DEFAULT 'new',
      section_80c REAL DEFAULT 0,
      section_80d REAL DEFAULT 0,
      hra_exemption REAL DEFAULT 0,
      other_exemptions REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(employee_code, financial_year)
    )
  `);

  // ── Finance Verification Tables ─────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_audit_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      company TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      flag_reason TEXT,
      flag_category TEXT,
      verified_by TEXT,
      verified_at TEXT,
      notes TEXT,
      UNIQUE(employee_code, month, year)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_audit_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      comment TEXT NOT NULL,
      category TEXT,
      severity TEXT DEFAULT 'info',
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      resolved INTEGER DEFAULT 0,
      resolved_by TEXT,
      resolved_at TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_month_signoff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      company TEXT,
      status TEXT NOT NULL,
      total_employees INTEGER,
      verified_count INTEGER,
      flagged_count INTEGER,
      rejected_count INTEGER,
      total_net_salary REAL,
      rejection_reason TEXT,
      signed_by TEXT NOT NULL,
      signed_at TEXT DEFAULT (datetime('now')),
      UNIQUE(month, year, company)
    )
  `);

  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_finance_audit_status_month ON finance_audit_status(month, year)');
  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_finance_audit_comments_month ON finance_audit_comments(month, year)');

  // ── Extra Duty Grants ──────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS extra_duty_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT NOT NULL,
      employee_id INTEGER,
      grant_date TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      company TEXT,
      grant_type TEXT NOT NULL DEFAULT 'OVERNIGHT_STAY',
      duty_days REAL NOT NULL DEFAULT 1.0,
      verification_source TEXT NOT NULL,
      reference_number TEXT,
      remarks TEXT,
      linked_attendance_id INTEGER,
      original_punch_date TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      requested_by TEXT,
      requested_at TEXT DEFAULT (datetime('now')),
      approved_by TEXT,
      approved_at TEXT,
      rejection_reason TEXT,
      finance_status TEXT NOT NULL DEFAULT 'UNREVIEWED',
      finance_reviewed_by TEXT,
      finance_reviewed_at TEXT,
      finance_flag_reason TEXT,
      finance_notes TEXT,
      salary_impact_amount REAL,
      is_processed INTEGER NOT NULL DEFAULT 0,
      processed_at TEXT,
      UNIQUE(employee_code, grant_date, month, year)
    )
  `);
  // Schema-drift safety: production DBs created from earlier table versions
  // may be missing columns added later. Use safeAddColumn for every nullable
  // field so the route queries never throw "no such column" on prod.
  safeAddColumn('extra_duty_grants', 'company', 'TEXT');
  safeAddColumn('extra_duty_grants', 'grant_type', "TEXT NOT NULL DEFAULT 'OVERNIGHT_STAY'");
  safeAddColumn('extra_duty_grants', 'duty_days', 'REAL NOT NULL DEFAULT 1.0');
  safeAddColumn('extra_duty_grants', 'verification_source', 'TEXT');
  safeAddColumn('extra_duty_grants', 'reference_number', 'TEXT');
  safeAddColumn('extra_duty_grants', 'remarks', 'TEXT');
  safeAddColumn('extra_duty_grants', 'linked_attendance_id', 'INTEGER');
  safeAddColumn('extra_duty_grants', 'original_punch_date', 'TEXT');
  safeAddColumn('extra_duty_grants', 'status', "TEXT NOT NULL DEFAULT 'PENDING'");
  safeAddColumn('extra_duty_grants', 'requested_by', 'TEXT');
  safeAddColumn('extra_duty_grants', 'requested_at', 'TEXT');
  safeAddColumn('extra_duty_grants', 'approved_by', 'TEXT');
  safeAddColumn('extra_duty_grants', 'approved_at', 'TEXT');
  safeAddColumn('extra_duty_grants', 'rejection_reason', 'TEXT');
  safeAddColumn('extra_duty_grants', 'finance_status', "TEXT NOT NULL DEFAULT 'UNREVIEWED'");
  safeAddColumn('extra_duty_grants', 'finance_reviewed_by', 'TEXT');
  safeAddColumn('extra_duty_grants', 'finance_reviewed_at', 'TEXT');
  safeAddColumn('extra_duty_grants', 'finance_flag_reason', 'TEXT');
  safeAddColumn('extra_duty_grants', 'finance_notes', 'TEXT');
  safeAddColumn('extra_duty_grants', 'salary_impact_amount', 'REAL');
  safeAddColumn('extra_duty_grants', 'is_processed', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('extra_duty_grants', 'processed_at', 'TEXT');

  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_edg_employee_month ON extra_duty_grants(employee_code, month, year)');
  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_edg_status ON extra_duty_grants(status, finance_status)');

  // ── Finance Rejections Archive (April 2026) ────────────────
  // Unified archive for anything rejected by HR or Finance across the
  // manual-intervention workflows (extra duty, miss punch, future types).
  // When a line item is rejected, the original payload is serialised here
  // so there is ONE canonical place to audit past rejections — queries
  // don't have to union across multiple source tables or chase soft-deleted
  // rows. The source table/id is kept for traceability.
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_rejections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rejection_type TEXT NOT NULL,          -- EXTRA_DUTY_HR | EXTRA_DUTY_FINANCE | MISS_PUNCH_FINANCE
      source_table TEXT NOT NULL,            -- extra_duty_grants | attendance_processed
      source_record_id INTEGER NOT NULL,
      employee_code TEXT,
      employee_name TEXT,
      department TEXT,
      month INTEGER,
      year INTEGER,
      company TEXT,
      original_details TEXT,                 -- JSON snapshot of the source row at rejection time
      rejection_reason TEXT NOT NULL,
      rejected_by TEXT NOT NULL,
      rejected_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_finrej_employee_month ON finance_rejections(employee_code, month, year)');
  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_finrej_type ON finance_rejections(rejection_type, rejected_at)');
  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_finrej_source ON finance_rejections(source_table, source_record_id)');

  // ── Late Coming Phase 1 (April 2026) ────────────────────────
  // Track when employees left 20+ minutes past their shift end time. Fed by
  // import post-processing and recalculate-metrics. NEVER modifies late-arrival
  // or status fields — purely additive columns.
  safeAddColumn('attendance_processed', 'is_left_late', 'INTEGER DEFAULT 0');
  safeAddColumn('attendance_processed', 'left_late_minutes', 'INTEGER DEFAULT 0');

  // Late Coming Phase 1: HR-initiated discretionary deductions for chronic late
  // comings. Pending rows sit in a finance review queue before hitting salary.
  // Immutable: no row is ever deleted, only its finance_status progresses.
  db.exec(`
    CREATE TABLE IF NOT EXISTS late_coming_deductions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT NOT NULL,
      employee_id INTEGER REFERENCES employees(id),
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      company TEXT,
      late_count INTEGER NOT NULL,
      deduction_days REAL NOT NULL,
      remark TEXT NOT NULL,
      applied_by TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now')),
      finance_status TEXT DEFAULT 'pending',
      finance_reviewed_by TEXT,
      finance_reviewed_at TEXT,
      finance_remark TEXT,
      is_applied_to_salary INTEGER DEFAULT 0,
      applied_to_salary_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(employee_code, month, year, company, applied_at)
    )
  `);
  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_late_deductions_employee ON late_coming_deductions(employee_code, month, year)');
  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_late_deductions_status ON late_coming_deductions(finance_status)');

  // ── Miss-punch finance verification (April 2026) ───────────
  // After HR resolves a miss punch, finance must verify before the salary
  // month can be finalised. Columns live on attendance_processed to keep
  // the data next to the resolved fields (status_final, in_time_final).
  safeAddColumn('attendance_processed', 'miss_punch_finance_status', "TEXT DEFAULT ''");
  safeAddColumn('attendance_processed', 'miss_punch_finance_reviewed_by', 'TEXT');
  safeAddColumn('attendance_processed', 'miss_punch_finance_reviewed_at', 'TEXT');
  safeAddColumn('attendance_processed', 'miss_punch_finance_notes', 'TEXT');
  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_ap_mp_fin_status ON attendance_processed(miss_punch_finance_status, month, year)');

  // ── Salary hold release audit trail (April 2026) ───────────
  // Every time finance releases a held salary, write one row here with
  // a paper-verification note. Powers the Held Salaries Register page's
  // "Released History" and "Release Report" tabs and gives finance a
  // queryable audit trail independent of salary_computations (which only
  // stores the latest release state, not the history). Release notes are
  // REQUIRED at the endpoint level — the column is NOT NULL so bad data
  // can never land here.
  db.exec(`
    CREATE TABLE IF NOT EXISTS salary_hold_releases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT NOT NULL,
      employee_name TEXT,
      department TEXT,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      company TEXT,
      hold_reason TEXT,
      hold_amount REAL,
      released_by TEXT NOT NULL,
      released_at TEXT NOT NULL DEFAULT (datetime('now')),
      release_notes TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_hold_releases_month    ON salary_hold_releases(month, year)');
  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_hold_releases_employee ON salary_hold_releases(employee_code)');
  safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_hold_releases_date     ON salary_hold_releases(released_at)');

  // ── March 2026 Reconciliation: Set contractor flags ──────────
  // ONE-TIME migration. Previously ran on every app boot, which re-stamped
  // is_contractor=1 on employees whose employment_type was later corrected
  // via Employee Master (e.g. GURMUKH SINGH 22970). Now guarded by a
  // policy_config flag so it runs exactly once, regardless of deploy count.
  const contractorMigrationDone = db.prepare(
    "SELECT value FROM policy_config WHERE key = 'migration_contractor_flags_v1'"
  ).get();

  if (!contractorMigrationDone) {
    console.log('[MIGRATION] Running one-time contractor flag migration (March 2026)...');
    const contractorCodes = [
      '10001','10002','10003','10004','10005','10006','10007','10008','10010','10011',
      '10012','10013','10014','10015','10501','10502','10505','10507','11001','11002',
      '11003','11004','11005','11006','11007','11012','11013','11501','11502','11503',
      '19366','19954','21498','22283','22970','23388','23406','23427','23484','23644',
      '23663','23709','56594','56638','56663','56684','56717','56744','56761','56762',
      '56767','56768','56769','60001','60052','60097','60102','60123','60125','60126',
      '60128','60131','60136','60139','60140','60169','60170','60190','60208','60209',
      '60215','60216','60217','60225','60227','60228','60229','60230','60231','60239',
      '60241','60242','60244','60245','60246','60250','60251','60253','60256','60258',
      '60261','60262','60263','60264','60265','60266','60267','60268','60270','60273',
      '60275','60276','60278','60279','60280','70004','70036','70059','70077','70078',
      '70079','70080','70082','9004','9005'
    ];
    const setContractor = db.prepare('UPDATE employees SET is_contractor = 1 WHERE code = ? AND is_contractor != 1');
    for (const code of contractorCodes) setContractor.run(code);
    // Also flag all MANPREET CON department employees
    db.prepare("UPDATE employees SET is_contractor = 1 WHERE department LIKE '%MANPREET%CON%' AND is_contractor != 1").run();
    // Ensure COM. HELPER employees are NOT flagged as contractor
    db.prepare("UPDATE employees SET is_contractor = 0 WHERE code IN ('23540','23551','23657','23679','23677')").run();

    // Mark migration as done so it never re-runs and doesn't clobber
    // subsequent Employee Master edits.
    db.prepare(
      "INSERT OR REPLACE INTO policy_config (key, value, description) VALUES ('migration_contractor_flags_v1', '1', 'One-time March 2026 contractor flag reconciliation (complete)')"
    ).run();
    console.log('[MIGRATION] Contractor flag migration complete — will not re-run.');
  }

  console.log('✅ Database schema initialized');
}

module.exports = { initSchema };

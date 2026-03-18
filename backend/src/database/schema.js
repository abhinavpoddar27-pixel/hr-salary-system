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

  // shifts: update grace from 30 to 9 minutes (per actual plant policy)
  db.prepare("UPDATE shifts SET grace_minutes = 9 WHERE grace_minutes = 30").run();

  // PF/ESI: disabled by default — set all existing records to 0 unless explicitly set via master import
  // This runs idempotently on every startup but only affects defaults
  db.prepare("UPDATE employees SET pf_applicable = 0 WHERE pf_applicable = 1 AND (uan IS NULL OR uan = '') AND (pf_number IS NULL OR pf_number = '')").run();
  db.prepare("UPDATE employees SET esi_applicable = 0 WHERE esi_applicable = 1 AND (esi_number IS NULL OR esi_number = '')").run();
  db.prepare("UPDATE salary_structures SET pf_applicable = 0 WHERE pf_applicable = 1 AND employee_id IN (SELECT id FROM employees WHERE (uan IS NULL OR uan = '') AND (pf_number IS NULL OR pf_number = ''))").run();
  db.prepare("UPDATE salary_structures SET esi_applicable = 0 WHERE esi_applicable = 1 AND employee_id IN (SELECT id FROM employees WHERE (esi_number IS NULL OR esi_number = ''))").run();

  // users: RBAC company access
  safeAddColumn('users', 'allowed_companies', "TEXT DEFAULT '*'");

  // day_calculations: late deduction support
  safeAddColumn('day_calculations', 'late_count', 'INTEGER DEFAULT 0');
  safeAddColumn('day_calculations', 'late_deduction_days', 'REAL DEFAULT 0');
  safeAddColumn('day_calculations', 'late_deduction_remark', "TEXT DEFAULT ''");

  // day_calculations: extra duty (payable > calendar days)
  safeAddColumn('day_calculations', 'extra_duty_days', 'REAL DEFAULT 0');

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

  // Across all imports, one processed record per employee per date per company
  safeCreateIndex(`CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_processed_dedup
    ON attendance_processed(employee_code, date, company)`);

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
  safeCreateIndex(`CREATE INDEX IF NOT EXISTS idx_audit_log_emp_code
    ON audit_log(employee_code, changed_at)`);
  safeCreateIndex(`CREATE INDEX IF NOT EXISTS idx_audit_log_action_type
    ON audit_log(action_type, changed_at)`);

  console.log('✅ Database schema initialized');
}

module.exports = { initSchema };

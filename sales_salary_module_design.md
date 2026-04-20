# Sales Salary Module — Design Document

**Project:** HR Intelligence & Salary Processing Platform
**Companies:** Indriyan Beverages Pvt Ltd. / Asian Lakto Ind. Ltd.
**Module:** Sales Team Salary Pipeline
**Status:** Locked — ready for Phase 1 build
**Date:** 20 April 2026
**Last updated:** 20 April 2026 (post-review; all 8 open questions resolved — see §4A and §13)
**Author:** Abhinav Poddar (with Claude as technical reviewer)

---

## 1. Executive Summary

This document proposes a new salary pipeline for sales employees that runs in parallel to the existing plant pipeline. Plant payroll is biometric-driven and goes through a 7-stage processing chain; sales payroll is instead driven by a monthly Excel sheet from the sales coordinator's team, who supplies the authoritative "days worked" per employee. The system will auto-compute paid Sundays, apply holiday credits, derive earned salary, apply deductions (PF/ESI/PT/TDS/advance/loan/diwali), and produce bank NEFT-ready output.

The design treats sales as a **parallel, isolated module** that shares minimal code with plant (only the Sunday rule logic, via a shared pure-function module). This isolation is deliberate: it guarantees zero risk to the stable, production plant pipeline while the sales module matures.

**Status as of 20 April 2026:** All eight open questions from the original draft have been resolved in internal review. See §4A for the locked decisions and §13 for the review log. The design is ready for Phase 1 implementation.

---

## 2. Background & Motivation

### Current state (plant)

- ~265–300 plant employees across two companies
- Biometric attendance imported from EESL system (monthly XLS)
- 7-stage processing pipeline: Import → Miss Punch → Shift Check → Night Shift → Corrections → Day Calc → Salary
- Salary engine uses hybrid divisor (`26` floor / `calendarDays` cap) with `earnedRatio = min(payableDays / effectiveDivisor, 1.0)`
- Deductions: PF/ESI/PT (currently disabled)/TDS, plus advance/loan recovery
- Output: payslip PDF, salary register, bank NEFT, PF ECR, ESI return

### Why sales can't use the plant pipeline

1. **No biometric data** — sales people work in the field, not at a fixed location
2. **Source of truth is the coordinator's spreadsheet** — a manual, managerial summary, not a system-generated attendance log
3. **Different employee attributes matter** — headquarters, city of operation, territory, reporting manager; whereas plant cares about shift, biometric code, contractor flag
4. **Different salary structure** — sales uses Basic/HRA/CCA/Conveyance (4 components); plant uses Basic/DA/HRA/Conveyance/Other (5 components)
5. **No OT, no night shift, no shift roster** — sales is a flat day-based model

### Current pain (the problem to solve)

HR manually computes sales salaries in Excel every month for ~120–180 employees per company. This is error-prone, time-consuming, and produces no auditable trail beyond the spreadsheet itself. There is no single source of truth for the sales employee master, holiday calendar, or pay history.

---

## 3. Scope

### In scope

- Sales employee master (CRUD)
- Sales-specific holiday master
- Monthly Excel upload from the sales coordinator with name/manager/city based auto-matching
- Sunday-rule-aware day calculation (reusing plant's 3-tier logic with leniency 2)
- Salary computation (earned components, statutory deductions, advance/loan/diwali recovery)
- Salary register view + manual HR overrides with audit trail
- Status workflow (computed → reviewed → finalized → paid / hold)
- Excel export matching HR's current format
- Bank NEFT CSV export
- Individual payslip PDF

### Out of scope (for v1)

- Sales coordinator self-service upload (HR uploads on their behalf in v1)
- Incentive / commission / target-based pay (base + fixed allowances only)
- Automated plant↔sales transitions (handled as exit-and-rehire manually in v1; automated transition endpoint added in Phase 5)
- Sales-specific finance audit workflow (v1 piggybacks on existing audit patterns)
- Territory/beat management, visit logs, sales reporting (separate module, future)

---

## 4. Key Decisions (with rationale)

### 4.1 Separate tables (not a type flag on existing `employees`)

**Decision:** Create new `sales_employees` and `sales_salary_structures` tables rather than adding `employment_type` to existing `employees`.

**Rationale:**
- Physically impossible for plant pipeline queries (parser, Stage 2–7, finance audit, payslips, compliance) to accidentally pick up sales rows
- Avoids a cross-codebase audit of 95+ API endpoints to add `WHERE employment_type='plant'` filters
- Plant and sales have genuinely divergent fields (shift_id, biometric code vs headquarters, reporting manager) — a shared table would carry many nullable columns

**Trade-off accepted:**
- Rehires (plant→sales or sales→plant) split an employee's history across two tables. Tenure, loan carry-forward, PF continuity need an explicit transition endpoint (Phase 5). Expected to be rare per HR input.

### 4.2 Earned salary divisor = calendar days of the month

**Decision:** `earnedRatio = min(totalDays / calendarDays, 1.0)`, where `calendarDays` is 28/29/30/31.

**Rationale:**
- Business owner's call based on HR's current practice
- Stored in `policy_config` as `sales_salary_divisor_mode` with alternate values `'fixed_28'` and `'hybrid'` to allow tuning via SQL without a code deploy

**Trade-off accepted:**
- Takes-home pay for identical attendance will differ across months (e.g., 28 "Total Days" earns 100% in February but 90.3% in March). Reviewed again after March 2026 HR salary data is available.

### 4.3 Sunday rule — same 3-tier logic as plant, leniency = 2

**Decision:** Reuse the plant Sunday-rule formula (3 tiers based on effective present days) via a new shared module `backend/src/services/sundayRule.js`. Sales uses `leniency = 2` (same as plant's `WEEKLY_OFF_LENIENCY`).

**Rationale:**
- Consistency with plant's worked-out logic
- Extracting the function to a shared module also solves the known "formula duplication across 3 files" gap (Gap 6 in the shift model notes) as a side benefit
- Per-month policy tuning possible via `policy_config`

**Trade-off accepted:**
- Feb 2026 HR practice appears to have used leniency ≈ 3 (employees with 3 absences still got all Sundays). Some employees will earn fewer paid Sundays under leniency = 2 than they have historically. Reviewed again after additional months of data.

### 4.4 Salary structure components — Basic / HRA / CCA / Conveyance (4 components)

**Decision:** Sales gets a dedicated `sales_salary_structures` table with 4 components. No DA, no "other allowances" umbrella.

**Rationale:**
- Matches the column structure in HR's current Feb 2026 salary sheet
- Cleaner than forcing sales into plant's 5-component model with perpetual zeros or renamed columns

### 4.5 Employee matching — composite (name + reporting manager + city)

**Decision:** Auto-match Excel rows to sales employee master using normalized composite of name + reporting manager + city. Tiered confidence: Exact punch-code > High (composite match) > Medium (partial) > Low (ambiguous — flag for HR review) > Unmatched (manual link or create).

**Rationale:**
- Punch codes are optional in the sheet and missing for many employees
- Names alone have duplicates (e.g., two "AYUSH BHATIA", two "SACHIN KUMAR")
- Manager + city adds enough context to disambiguate in practice
- Low/unmatched rows always require HR confirmation before computation — nothing auto-commits

### 4.6 Deductions — same rules as plant (PF/ESI/PT/TDS)

**Decision:** Apply the same statutory deduction logic to sales as plant.

**Rationale:**
- Consistency with company-wide payroll compliance
- Applicability flags (`pf_applicable`, `esi_applicable`, `pt_applicable`) per employee allow opt-out where statutory thresholds are crossed

### 4.7 Diwali bonus — one-time annual (Oct/Nov)

**Decision:** Diwali is a one-time festival bonus paid in October/November. The "diwali" column on monthly sheets represents either the bonus itself (in the festival month) or recovery of festival advances in subsequent months.

**Open question for reviewer:** Feb 2026 sheets show non-zero "diwali" values (₹3000–₹10000) for many employees. This needs clarification — is Feb showing recovery of an advance previously given, or something else? Confirm before Phase 3.

### 4.8 Who uploads — HR only

**Decision:** The sales coordinator emails the sheet to HR; HR uploads via the system. No separate sales coordinator login in v1.

**Rationale:**
- Mirrors plant's existing workflow (HR uploads EESL files)
- One source of truth for who touches payroll data
- Future migration path: if self-service is needed, add a `sales_coordinator` role restricted to upload-only

---

## 4A. Decisions Locked (Post-Review)

Following internal review on 20 April 2026, the eight open questions originally listed in §13 are all resolved. This section is the authoritative record; §13 below has been converted to a closed-questions log.

| # | Question (short form) | Decision | One-line rationale |
|---|----------------------|----------|-------------------|
| Q1 | Day's Given override authority | **Never overridden** — read-only in preview, used directly in compute | Coordinator's number is final; no override UI, no audit log for edits, simplest possible preview flow |
| Q2 | Dual-company employee codes | **`UNIQUE(code, company)`** — per-company scoping | Strictly more permissive than global UNIQUE; handles data errors, per-company namespaces, and dual-company edge case without blocking valid inserts |
| Q3 | Implicit exit via omission | **Manual only** — no auto-inactive job | `status='Left'` set explicitly by HR via the master page; no `last_seen_in_sheet` column, no background job, no silent behavior |
| Q4 | "Working Days as Per AI" column | **Dropped entirely** — parser ignores | Not authoritative, not consumed in compute, keeping it adds noise; only `Day's Given` is captured |
| Q5 | Diwali column in monthly sheet | **Rolling deduction toward annual Diwali bonus** — accrues into `sales_diwali_ledger`, payout disbursed outside monthly compute in Oct/Nov | Gives finance a queryable liability trail; monthly net_salary correctly reduces by the deduction; annual payout is a separate finance event |
| Q6 | Incentives and commissions | **Schema space reserved** — `incentive_amount REAL DEFAULT 0` column on `sales_salary_computations`, HR manual entry in v1; full incentive model deferred to v2 | Variable pay is on the roadmap; reserving the column now avoids a destructive migration later. v1 treats it as a manual line item on the register |
| Q7 | Territory / beat / route model | **City is enough** — no territory field, no hierarchy | Reaffirmed as explicit non-goal; territory module, if built, is a future separate design doc |
| Q8 | Coordinator self-service | **HR-only in v1**, clean migration path to v2 | Architecture already supports adding a `sales_coordinator` role later as a one-file permission change; no v1 code impact |

### Consequences captured elsewhere in the doc

- Q2 → §6.1 schema now uses `UNIQUE(code, company)` instead of `code TEXT UNIQUE`; §7 API routes now require `?company=` query param on every `:code` endpoint
- Q3 → §6.1 schema retains manual `status` transitions; no `last_seen_in_sheet` column added
- Q4 → §6.4 schema drops `sheet_working_days_ai` and `sheet_working_days_manual` columns; §8 parser drops these from the captured-columns list
- Q5 → New §6.7 `sales_diwali_ledger` table; §9 Step 6 Diwali recovery now writes an accrual row to the ledger on every compute with `diwali_recovery > 0`; §11 Phase 3 explicitly creates the ledger table and "Diwali Accrual Report" sub-page
- Q6 → §6.5 schema adds `incentive_amount REAL DEFAULT 0`; §9 Step 7 `net_salary` formula updated; §10 notes editable Incentive column on `SalesSalaryCompute.jsx`
- Q7 → Reaffirmed in §14 Non-Goals
- Q8 → Reaffirmed in §14 Non-Goals

### Open architectural follow-up (not a blocker)

**Diwali accrual visibility:** Because the Diwali ledger accrues month-over-month and pays out once annually, HR and finance need to see running balances between accrual events. Phase 3 must include a lightweight reporting view ("Diwali Accrual Report") that lists per-employee current balance, YTD accrual, and last-payout date. Without this, the Oct/Nov payout amount can surprise employees and create support load. This is in scope for Phase 3.

---

## 5. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                  EXISTING PLANT PIPELINE                    │
│           (untouched — firewalled from sales)               │
│                                                             │
│  EESL XLS → parser → Stage 1-7 → salary_computations        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ imports only
                              │ sundayRule.js
                              ▼
                    ┌──────────────────┐
                    │  sundayRule.js   │  ← shared pure function
                    │  (extracted)     │  ← plant migration is Phase 5
                    └──────────────────┘
                              ▲
                              │
┌─────────────────────────────┴───────────────────────────────┐
│                  NEW SALES PIPELINE                         │
│                                                             │
│  Coordinator XLS → salesCoordinatorParser.js                │
│       ↓                                                     │
│  sales_monthly_input (matched/unmatched preview)            │
│       ↓                                                     │
│  HR confirms matches                                        │
│       ↓                                                     │
│  salesSalaryComputation.js                                  │
│       ↓                                                     │
│  sales_salary_computations (the output)                     │
│       ↓                                                     │
│  Salary register / Bank NEFT / Payslips                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Database Schema

### 6.1 `sales_employees` — employee master

```sql
CREATE TABLE sales_employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,                     -- 'S' prefix (S001, S002, …); unique per company, not globally
    name TEXT NOT NULL,

    -- Identity
    aadhaar TEXT, pan TEXT, dob TEXT,
    doj TEXT, dol TEXT,
    contact TEXT, personal_contact TEXT,

    -- Sales-specific
    state TEXT,
    headquarters TEXT,
    city_of_operation TEXT,
    reporting_manager TEXT,
    designation TEXT,                       -- SO/SSO/ASE/ASM/TSI/SR ASM/RSM/PSR
    punch_no TEXT,                          -- optional
    working_hours TEXT,

    -- Salary & statutory
    gross_salary REAL DEFAULT 0,
    pf_applicable INTEGER DEFAULT 0,
    esi_applicable INTEGER DEFAULT 0,
    pt_applicable INTEGER DEFAULT 0,

    -- Bank (mandatory at app layer)
    bank_name TEXT, account_no TEXT, ifsc TEXT,

    company TEXT NOT NULL,

    -- Status (Q3: transitions are manual only — HR clicks "Mark Left" on the master page)
    status TEXT DEFAULT 'Active'
        CHECK(status IN ('Active','Inactive','Left','Exited')),

    -- Rehire linkage
    predecessor_type TEXT
        CHECK(predecessor_type IN ('plant','sales','none')
              OR predecessor_type IS NULL),
    predecessor_id INTEGER,
    predecessor_code TEXT,

    -- Audit
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    updated_by TEXT,

    -- Per-company scoping (Q2): codes are unique within a company,
    -- not globally. Allows Asian Lakto and Indriyan to independently
    -- namespace sales codes without cross-company collisions.
    UNIQUE(code, company)
);
```

### 6.2 `sales_salary_structures` — salary components

```sql
CREATE TABLE sales_salary_structures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    effective_from TEXT NOT NULL,           -- YYYY-MM
    effective_to TEXT,
    basic REAL DEFAULT 0,
    hra REAL DEFAULT 0,
    cca REAL DEFAULT 0,
    conveyance REAL DEFAULT 0,
    gross_salary REAL DEFAULT 0,
    pf_applicable INTEGER DEFAULT 0,
    esi_applicable INTEGER DEFAULT 0,
    pt_applicable INTEGER DEFAULT 0,
    pf_wage_ceiling_override REAL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT,
    FOREIGN KEY (employee_id) REFERENCES sales_employees(id),
    UNIQUE(employee_id, effective_from)
);
```

### 6.3 `sales_uploads` — file upload tracking

```sql
CREATE TABLE sales_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    company TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_hash TEXT,
    total_rows INTEGER,
    matched_rows INTEGER,
    unmatched_rows INTEGER,
    status TEXT DEFAULT 'uploaded'
        CHECK(status IN ('uploaded','matched','computed','finalized','superseded')),
    uploaded_by TEXT NOT NULL,
    uploaded_at TEXT DEFAULT (datetime('now')),
    notes TEXT,
    UNIQUE(month, year, company, file_hash)
);
```

### 6.4 `sales_monthly_input` — parsed sheet rows

```sql
CREATE TABLE sales_monthly_input (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    company TEXT NOT NULL,
    upload_id INTEGER NOT NULL,

    -- From sheet (as-typed)
    sheet_row_number INTEGER,
    sheet_state TEXT,
    sheet_reporting_manager TEXT,
    sheet_employee_name TEXT NOT NULL,
    sheet_designation TEXT,
    sheet_city TEXT,
    sheet_punch_no TEXT,
    sheet_doj TEXT,
    sheet_dol TEXT,
    -- Q4: "Working Days as Per AI" and "Working Days Manual" columns are
    -- explicitly NOT captured. Only Day's Given is authoritative for compute.
    sheet_days_given REAL NOT NULL,         -- authoritative
    sheet_remarks TEXT,

    -- Match result
    employee_code TEXT,
    match_confidence TEXT
        CHECK(match_confidence IN
              ('exact','high','medium','low','unmatched','manual')),
    match_method TEXT,

    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT,
    FOREIGN KEY (upload_id) REFERENCES sales_uploads(id)
);
```

### 6.5 `sales_salary_computations` — the output

```sql
CREATE TABLE sales_salary_computations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_code TEXT NOT NULL,
    month INTEGER NOT NULL, year INTEGER NOT NULL,
    company TEXT NOT NULL,

    -- Days
    days_given REAL NOT NULL,
    sundays_paid REAL DEFAULT 0,
    gazetted_holidays_paid REAL DEFAULT 0,
    earned_leave_days REAL DEFAULT 0,
    total_days REAL NOT NULL,
    calendar_days INTEGER NOT NULL,
    earned_ratio REAL NOT NULL,

    -- Stated components
    basic_monthly REAL DEFAULT 0,
    hra_monthly REAL DEFAULT 0,
    cca_monthly REAL DEFAULT 0,
    conveyance_monthly REAL DEFAULT 0,
    gross_monthly REAL DEFAULT 0,

    -- Earned (pro-rated) components
    basic_earned REAL DEFAULT 0,
    hra_earned REAL DEFAULT 0,
    cca_earned REAL DEFAULT 0,
    conveyance_earned REAL DEFAULT 0,
    gross_earned REAL DEFAULT 0,

    -- Deductions
    pf_employee REAL DEFAULT 0,
    pf_employer REAL DEFAULT 0,
    esi_employee REAL DEFAULT 0,
    esi_employer REAL DEFAULT 0,
    professional_tax REAL DEFAULT 0,
    tds REAL DEFAULT 0,
    advance_recovery REAL DEFAULT 0,
    loan_recovery REAL DEFAULT 0,
    diwali_recovery REAL DEFAULT 0,
    other_deductions REAL DEFAULT 0,
    total_deductions REAL DEFAULT 0,

    -- One-time additions
    diwali_bonus REAL DEFAULT 0,

    -- Variable pay (Q6): HR manually enters in v1; future v2 incentive
    -- engine will populate this column. Reserved now to avoid a
    -- destructive migration once production data accumulates.
    incentive_amount REAL DEFAULT 0,

    -- Net
    net_salary REAL NOT NULL,

    -- Sunday rule trace
    sunday_rule_trace TEXT,

    -- Status
    status TEXT DEFAULT 'computed'
        CHECK(status IN ('computed','reviewed','finalized','paid','hold')),
    hold_reason TEXT,

    -- Audit
    computed_at TEXT DEFAULT (datetime('now')),
    computed_by TEXT,
    finalized_at TEXT, finalized_by TEXT,

    UNIQUE(employee_code, month, year, company)
);
```

### 6.6 `sales_holidays` — separate holiday master

```sql
CREATE TABLE sales_holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    holiday_date TEXT NOT NULL,
    holiday_name TEXT NOT NULL,
    company TEXT NOT NULL,
    applicable_states TEXT,                 -- JSON, NULL = all
    is_gazetted INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(holiday_date, company)
);
```

### 6.7 `sales_diwali_ledger` — Diwali accrual tracking

Per Q5, the monthly Diwali column is a **deduction** that accrues toward the annual Diwali bonus, which is disbursed as a single payout event in Oct/Nov. This ledger gives finance a queryable liability trail independent of salary computations.

```sql
CREATE TABLE sales_diwali_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_code TEXT NOT NULL,
    company TEXT NOT NULL,
    month INTEGER NOT NULL,                 -- 1-12
    year INTEGER NOT NULL,
    entry_type TEXT NOT NULL
        CHECK(entry_type IN ('accrual','payout','adjustment')),
    accrual_amount REAL DEFAULT 0,          -- positive = deduction from salary that month
    payout_amount REAL DEFAULT 0,           -- positive = disbursed in Oct/Nov payout event
    adjustment_amount REAL DEFAULT 0,       -- corrections, + or -
    running_balance REAL NOT NULL,          -- computed at write-time; invariant: = sum(accruals) - sum(payouts) + sum(adjustments) for this employee up to and including this row
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT NOT NULL,
    source_computation_id INTEGER,          -- FK to sales_salary_computations.id for accrual rows; NULL for payout/adjustment
    UNIQUE(employee_code, company, month, year, entry_type)
);
```

**Write path:**
- `accrual` rows: written automatically by `salesSalaryComputation.js` whenever `diwali_recovery > 0` for an employee in a given month
- `payout` rows: written by a dedicated finance action ("Trigger Diwali Payout") that HR/Finance runs manually in Oct/Nov; disburses the running balance as a separate cheque/NEFT entry outside the monthly salary
- `adjustment` rows: written by HR for corrections (e.g., refund to a departed employee, manual top-up)

**Read path:**
- Phase 3 ships a "Diwali Accrual Report" page listing per-employee running balance, YTD accrual, last payout date — mandatory to avoid surprising employees at annual payout time.

**Edge case — employee exits mid-accrual:** If an employee is marked `Left` before the annual payout event, their accumulated balance does not vanish. Phase 3 must include an explicit "Settle on Exit" flow: when HR marks an employee Left, the UI prompts "Employee has ₹X accrued toward Diwali. Settle now?" and, on confirm, writes an `adjustment` ledger row zeroing the balance plus a corresponding entry in the employee's final salary run (or as a separate exit payment). Without this flow, exited employees' balances drift forever and distort the liability reporting.

### 6.8 Explicitly NOT changed

- `employees` — no new columns, no backfill, no migration risk
- `salary_structures` — untouched
- `salary_computations` — untouched
- `attendance_processed`, `day_calculations`, `night_shift_pairs`, `monthly_imports`, `manual_attendance_flags` — untouched
- `holidays` (plant) — untouched
- All Stage 2–7 service files — untouched
- `parser.js` — untouched

---

## 7. API Routes

All new endpoints live under `/api/sales/*` in a new file `backend/src/routes/sales.js`. None modify existing routes.

**Per-company scoping (Q2):** Because codes are unique per company (not globally), every `:code` path parameter is ambiguous on its own. Endpoints that take `:code` MUST also accept a `?company=` query parameter; the handler resolves `(code, company)` together. If `?company=` is missing, the handler returns HTTP 400 with `{ error: 'company query param required' }`. The only exception is `POST /api/sales/upload` and children, where `company` is part of the upload's own identity.

### Employee master
- `GET /api/sales/employees` — list, filters: status, state, manager, HQ, company
- `GET /api/sales/employees/:code?company=X` — single
- `POST /api/sales/employees` — create (body includes `company`)
- `PUT /api/sales/employees/:code?company=X` — update (immutable: `code`, `company`, `created_at`)
- `PUT /api/sales/employees/:code/mark-left?company=X` — exit
- `POST /api/sales/employees/bulk-import` — Excel master upload

### Salary structures
- `GET /api/sales/employees/:code/structures?company=X` — history
- `POST /api/sales/employees/:code/structures?company=X` — new structure row (supersedes previous)

### Holidays
- `GET /api/sales/holidays?company=X&year=2026`
- `POST /api/sales/holidays`
- `PUT /api/sales/holidays/:id`
- `DELETE /api/sales/holidays/:id`

### Upload & matching
- `POST /api/sales/upload` — multipart; parses, stores rows, auto-matches
- `GET /api/sales/upload/:uploadId/preview` — matched/low/unmatched
- `PUT /api/sales/upload/:uploadId/match/:inputRowId` — manual override
- `POST /api/sales/upload/:uploadId/confirm` — lock matches

### Computation & review
- `POST /api/sales/compute?month=M&year=Y&company=C` — idempotent
- `GET /api/sales/salary-register?month=M&year=Y&company=C`
- `PUT /api/sales/salary/:id` — HR manual override (audit trail)
- `PUT /api/sales/salary/:id/status` — hold/paid/finalize

### Exports
- `GET /api/sales/export/salary-register?month=M&year=Y&company=C` — XLSX
- `GET /api/sales/export/bank-neft?month=M&year=Y&company=C` — CSV
- `GET /api/sales/payslip/:code?month=M&year=Y&company=X` — PDF

### Permissions
All endpoints: `hr` or `admin` role required. Enforced in `backend/src/config/permissions.js`.

---

## 8. Parser Specification

**File:** `backend/src/services/salesCoordinatorParser.js`

**Input formats:** `.xls` (xlrd via a Python subprocess or SheetJS), `.xlsx` (exceljs/SheetJS natively)

**Header detection:**
- Scans rows 0–10 for cell containing "Sales Person Name" and "Day's Given" (case-insensitive, trim)
- Column indices set dynamically from the detected header row

**Required columns:** `Sales Person Name`, `Day's Given`

**Optional columns (captured when present):** `S.No`, `State`, `Reporting Manager`, `Desig`, `City`, `PUNCH NO.`, `D.O.J.`, `Contact No.`, `Personal Contact`, `D.O.L.`, remarks

**Columns explicitly NOT captured (Q4 resolution):** `Working Days as Per AI`, `Working Days Manual` — these are produced by the coordinator's external tracking tool, are not authoritative, and add noise without informing compute. Parser skips them even when present in the sheet.

**Row filtering:**
- Skip if `Sales Person Name` is empty
- Skip if `Day's Given` is empty or non-numeric
- Skip total/subtotal rows

**Normalization (before matching):**
- Names: UPPER, TRIM, collapse internal whitespace
- Manager: strip leading `"01 "`, `"02 "` prefixes; UPPER, TRIM
- Cities: UPPER, TRIM; lookup table for common typos (GHAZIYABAD → GHAZIABAD, MUZAFFARNAGAR vs MUZAFARNAGAR, etc.)

**Matching strategy (tiered):**
1. **Exact** — `sales_employees.punch_no = sheet.punch_no` (when both present)
2. **High** — normalized(name + manager + city) matches exactly one active sales employee
3. **Medium** — normalized(name + city) matches exactly one active sales employee
4. **Low** — name match only, multiple candidates → HR reviews
5. **Unmatched** — no candidate → HR creates or links manually

Low and unmatched rows do NOT auto-commit; they surface on the preview screen.

---

## 9. Computation Engine

**File:** `backend/src/services/salesSalaryComputation.js`

### Inputs
- `sales_monthly_input` row (confirmed, matched)
- `sales_employees` + latest `sales_salary_structures` for the employee
- `sales_holidays` for the month
- `policy_config` values (rates, ceilings, divisor mode)

### Step-by-step

**Step 1 — Days aggregation**
```
days_given       = input.sheet_days_given  (from coordinator)
totalSundays     = count of Sundays in the month
totalHolidays    = count of sales_holidays in the month (excluding Sundays)
workingDays      = calendarDays - totalSundays - totalHolidays
```

**Step 2 — Sunday rule** (calls shared `sundayRule.js`)
```js
const { paidSundays, tier, note } = calculateSundayCredit({
    effectivePresent: days_given,
    workingDays,
    totalSundays,
    leniency: 2
});
```

**Step 3 — Gazetted holidays**
- For each sales holiday in the month, the employee is credited with the holiday only if they would have worked that day (i.e., the holiday falls on a non-Sunday and the employee was "around" — has days_given > 0 for that range)
- Simplification for v1: credit all gazetted holidays in the month as paid, regardless of day-of-week and attendance. Revisit if this causes issues.

**Step 4 — Total days and earned ratio**
```
total_days        = days_given + paidSundays + gazettedHolidays + EL (manual)
calendar_days     = daysInMonth(month, year)
earned_ratio      = min(total_days / calendar_days, 1.0)
```

**Step 5 — Earned components**
```
basic_earned      = basic_monthly × earned_ratio
hra_earned        = hra_monthly × earned_ratio
cca_earned        = cca_monthly × earned_ratio
conveyance_earned = conveyance_monthly × earned_ratio
gross_earned      = sum of the above (capped at gross_monthly)
```

**Step 6 — Deductions** (same rules as plant)
- PF: 12% of (basic + DA) capped at ₹15,000 ceiling, when `pf_applicable`
- ESI: 0.75% employee, 3.25% employer of gross_earned, when `esi_applicable` and `gross_monthly <= 21000`
- PT: per Punjab slabs (currently disabled per HR directive — matches plant behavior)
- TDS: via `tdsCalculation.js` if tax declaration exists
- Advance recovery: from `salary_advances` (shared table — if sales uses the same advance module) OR from a separate mechanism TBD
- Loan recovery: from `loan_repayments`
- **Diwali recovery (Q5)**: deduction amount typed by HR on the register, persisted in `sales_salary_computations.diwali_recovery`. After the salary row is saved, an **accrual entry** is written to `sales_diwali_ledger` with `entry_type='accrual'`, `accrual_amount = diwali_recovery`, and the new `running_balance` computed as `previous_running_balance + accrual_amount`. Payout is a separate manual finance action in Oct/Nov — NOT part of the monthly compute.

**Step 7 — Net salary**
```
total_deductions  = PF_e + ESI_e + PT + TDS + advance + loan + diwali_recovery + other
net_salary        = gross_earned + diwali_bonus + incentive_amount - total_deductions
```

Notes:
- `diwali_bonus` is typically 0 in most months; non-zero only in Oct/Nov if HR chooses to route the annual Diwali payout through the regular salary run (usually it's handled as a separate cheque/NEFT via the `sales_diwali_ledger` payout event, so `diwali_bonus` stays 0 here).
- `incentive_amount` (Q6) is HR-entered on the salary register in v1. Defaults to 0. Future v2 incentive engine will populate it automatically.

**Step 8 — Persistence**
- `INSERT OR REPLACE INTO sales_salary_computations` (by unique key)
- Full sunday_rule_trace stored as JSON
- Audit log row for the compute event

**⚠ UPSERT completeness note:** The INSERT OR REPLACE must preserve HR-entered values on recompute. Specifically, `incentive_amount`, `diwali_recovery` (if HR-entered), `other_deductions`, and any manual override fields must be **read from the existing row before the REPLACE** and re-written into the new row — otherwise a recompute silently wipes HR's entries to 0. This is the same pattern that caused the plant-side salary_computations regression documented in CLAUDE.md (advance_recovery/tds/other_deductions were omitted from the INSERT ON CONFLICT UPDATE clause). Phase 3 build MUST grep every UPSERT for completeness before merging.

---

## 10. Frontend Pages

All new, under `frontend/src/pages/Sales/`:

1. **SalesEmployeeMaster.jsx** — CRUD. Filters by state/manager/HQ/status. Bank details mandatory at form level.
2. **SalesHolidayMaster.jsx** — Calendar + list. Per-company.
3. **SalesUpload.jsx** — Drag-drop + preview with three tabs (matched/low/unmatched). **Day's Given column is read-only (Q1)** — coordinator's figure is final; no override UI, no audit trail for edits.
4. **SalesSalaryCompute.jsx** — Post-confirm view; compute trigger; salary register with inline edits, status toggles, Excel export. **Incentive column is editable (Q6)** — HR types monthly incentive amount; defaults to 0; recomputes net_salary on save. **Diwali Accrual Report sub-page (Q5)** — per-employee running balance, YTD accrual, last payout date.
5. **SalesPayslip.jsx** — Individual payslip view with download. Shows Incentive as a separate earnings line item when non-zero.

**Sidebar:** New top-level "Sales" section with the 5 entries above. Gated to `hr` and `admin`.

**State management:** Existing Zustand `useAppStore` — no changes. Month/year/company context reused.

**Component reuse:** Existing table, filter, export, and modal components from plant pages. No new design system elements needed.

---

## 11. Build Phases

Each phase is independently shippable, independently testable, and reversible without affecting plant.

### Phase 1 — Schema + Sales Employee Master (~1 day)
- All CREATE TABLE statements (idempotent, via `safeAddColumn`-style guards)
- `/api/sales/employees` CRUD endpoints
- `SalesEmployeeMaster.jsx` page with list/create/edit
- Sidebar entry under "Sales"
- **Regression check:**
  - `SELECT COUNT(*) FROM employees` unchanged
  - `SELECT COUNT(*) FROM sales_employees` equals newly-entered test count
  - No plant endpoint broken (smoke test: run a plant salary computation, verify unchanged)

### Phase 2 — Holiday master + Upload parser (~1 day)
- `sales_holidays`, `sales_uploads`, `sales_monthly_input` tables
- `SalesHolidayMaster.jsx`
- `/api/sales/upload` + parser
- `SalesUpload.jsx` with preview UI
- **Regression check:** Parse the March 2026 attendance sheet; ≥ 95% match rate on rows where the employee exists in master

### Phase 3 — Compute engine + Salary Register (~2 days)
- `sundayRule.js` shared module (NOT yet consumed by plant)
- `salesSalaryComputation.js`
- `sales_salary_computations` table (includes `incentive_amount` column per Q6)
- `sales_diwali_ledger` table (per Q5) + accrual write on every compute where `diwali_recovery > 0`
- "Diwali Accrual Report" sub-page under `SalesSalaryCompute.jsx` (per Q5; mandatory — prevents Oct/Nov payout surprises)
- `/api/sales/compute` + `/api/sales/salary-register` + `/api/sales/diwali-ledger` (read-only in v1)
- `SalesSalaryCompute.jsx` with editable Incentive column
- **Regression check:**
  - Feb 2026 parity: compute sales salaries from a constructed Feb coordinator input, compare net_salary against HR's PAYABLE column per row; ≤ ±₹5 drift acceptable for rounding. **Row-level drift dump required** (per-employee table, not just summary average — single catastrophic miss can hide in an average).
  - Diwali ledger parity: for each employee with a Feb diwali_recovery, verify `sales_diwali_ledger` has a matching accrual row with correct `running_balance`.
  - Plant Feb 2026 regression: full plant pipeline produces byte-identical `salary_computations`.
- **Phase 5 prerequisite (capture before Phase 3 ends):** Snapshot plant's March 2026 `day_calculations` rows to disk as an immutable baseline. Phase 5 will diff against this to prove byte-identical behavior after the Sunday rule extraction. If the snapshot isn't captured now, Phase 5's parity gate has nothing to compare to.

### Phase 4 — Exports + status workflow (~1 day)
- Excel export matching HR's column order
- Bank NEFT CSV (format matches plant's existing NEFT CSV)
- Status workflow (hold/paid/finalize)
- Payslip PDF for sales
- **Regression check:** Plant bank NEFT export still produces identical output

### Phase 5 — Plant Sunday rule migration (Gap 6) + transition endpoints (optional)
- `dayCalculation.js` refactored to call `sundayRule.js`
- Behavior-preservation test: March 2026 output byte-identical before/after
- `POST /api/transitions/plant-to-sales/:code` + inverse
- **Gate:** If even 1 row diverges, do not merge. Diagnose before proceeding.

---

## 12. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Coordinator sheet format changes month-to-month | Parser uses dynamic header detection (same pattern as plant's EESL parser) |
| Name-based matching produces false positives | Preview-and-confirm UI required before compute; low/unmatched rows flagged |
| Divisor choice (calendar days) produces pay drops in long months | Divisor stored in `policy_config`; switchable via SQL |
| Leniency = 2 produces lower Sundays than HR's Feb practice | Leniency also in `policy_config`; compare March output to HR |
| Diwali logic unclear (Feb values exist despite "Oct/Nov only" rule) | Blocker for Phase 3; clarify with HR before compute engine ships |
| Plant pipeline regression during Phase 5 (Gap 6) | Behavior-preservation gate: any divergence blocks merge |
| Rehire across plant↔sales splits history | Explicit transition endpoint in Phase 5; in v1, HR handles manually with a note in both employee records |

---

## 13. Closed Questions (Review Log)

All eight open questions from the draft have been resolved in internal review on 20 April 2026. Recorded here for future reference so the rationale isn't lost; the authoritative summary lives in §4A.

1. **Day's Given authority** — *RESOLVED (Q1): Never overridden.* HR does not edit the coordinator's figure. Preview screen shows Day's Given read-only; compute uses it directly. No override UI, no edit audit trail. If HR spots a coordinator error, they request a corrected sheet from the coordinator and re-upload (supersedes the prior upload via the `sales_uploads.status='superseded'` mechanism).

2. **Dual-company employees** — *RESOLVED (Q2): `UNIQUE(code, company)`.* Codes are scoped per company, not globally. Asian Lakto's `87061` and Indriyan's `87061` are treated as independent employees. Every lookup query includes `AND company = ?`. Global uniqueness is strictly stricter and can be added later as a one-line tightening if HR ever ratifies it; starting permissive is safer.

3. **Implicit exit via omission** — *RESOLVED (Q3): Manual only.* `status='Left'` is set explicitly by HR via the "Mark Left" button on `SalesEmployeeMaster.jsx`. No `last_seen_in_sheet` column, no background inactivity job, no silent inference from missing sheet rows. If an employee stops appearing in sheets, they remain `Active` in the master until HR explicitly marks them Left — which is a documented HR responsibility.

4. **"Working Days as Per AI" column** — *RESOLVED (Q4): Dropped entirely.* Parser does not capture this column (or "Working Days Manual"). Only Day's Given is authoritative. The coordinator's internal tracking tool remains external to our system.

5. **Diwali column in Feb sheet** — *RESOLVED (Q5): Rolling deduction toward annual Diwali bonus.* Monthly values are deductions that accrue in `sales_diwali_ledger`. Annual payout (Oct/Nov) is a separate finance-triggered event that disburses the running balance and writes a `payout` entry. Phase 3 includes a "Diwali Accrual Report" page so HR/finance can see running balances between accrual events.

6. **Incentives and commissions** — *RESOLVED (Q6): Schema space reserved now, model deferred to v2.* `sales_salary_computations.incentive_amount REAL DEFAULT 0` is added in Phase 3. v1 allows HR to type the incentive manually on the register. A future v2 incentive engine (targets, formulas, approvals) will populate this column automatically and introduce a `sales_incentives` ledger table analogous to the Diwali ledger.

7. **Territory / beat / route** — *RESOLVED (Q7): City is enough for v1.* No territory field, no hierarchy, no changes to `sales_employees`. Reaffirmed as explicit non-goal in §14. Territory module, if ever built, is a future separate design.

8. **Sales coordinator self-service** — *RESOLVED (Q8): HR-only in v1.* The architecture supports a future `sales_coordinator` role as a one-file permission change in `backend/src/config/permissions.js`. v1 does not build it; v2+ decision.

---

## 14. Non-Goals (explicit)

- This system does not track sales visits, beats, routes, or calls. **(Reaffirmed per Q7.)**
- This system does not compute incentives, commissions, or target-based pay in v1. **(Q6: schema space is reserved via `incentive_amount` column; v1 accepts HR manual entry only; automated incentive engine is v2.)**
- This system does not replace the coordinator's own tracking tool ("Working Days as Per AI" column is explicitly ignored per Q4).
- This system does not automate employee onboarding from HRMS; new sales employees are created manually.
- This system does not handle field expense reimbursement (separate module, future).
- This system does not provide a sales coordinator login in v1. **(Q8: HR-only upload; `sales_coordinator` role is a future v2 addition if demand emerges.)**
- This system does not auto-mark employees as Left based on sheet omission. **(Q3: HR explicitly triggers exit via the master page.)**
- This system does not allow HR to edit the coordinator's "Day's Given" figure. **(Q1: read-only in preview; corrected sheets are re-uploaded as supersedes.)**

---

## 15. Glossary

- **Calendar days** — Total days in the month (28/29/30/31)
- **CCA** — City Compensatory Allowance
- **Coordinator sheet** — Monthly Excel from the sales coordinator's team giving "Day's Given" per employee
- **Day's Given** — The authoritative count of days an employee is to be paid for, as determined by the sales coordinator
- **Diwali bonus / recovery** — One-time annual festival bonus (Oct/Nov); may be recovered from subsequent months if paid as an advance
- **Earned ratio** — Fraction of stated salary an employee earns, based on `total_days / calendar_days`
- **EESL** — The biometric attendance system used for plant employees
- **Effective present** — Days P + ½P + WOP + paid holidays (for Sunday rule calc)
- **Gap 6** — Known technical debt: the Sunday rule formula is duplicated across 3 files in the plant codebase
- **HQ** — Headquarters (the city where a sales employee is based)
- **Leniency** — The number of absent working days permitted before any Sundays start being lost
- **Punch No.** — Biometric code; may exist for sales employees who also swipe in at the plant occasionally
- **Total Days** — days_given + paid Sundays + gazetted holidays + earned leave
- **WOP** — Worked on weekly Off; plant term for an employee who came in on their Sunday

---

*End of document.*

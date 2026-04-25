# Sales Module — Consolidated Design Doc (Cycle + TA/DA v2)

**Status:** For Claude Code build reference. Abhinav-approved, scope frozen.
**Date:** 2026-04-24
**Supersedes:** `sales_salary_module_design.md` (Q5 hotfix version) for the sections it touches. Earlier decisions preserved unless explicitly contradicted here.
**Build target:** ~2 days, 4 Claude Code phases. Path B: salary cycle + E2E first, TA/DA after.

---

## 0. What This Document Covers

This doc bundles three interrelated changes to the sales module:
1. **Salary cycle redefinition** — sales salary cycle is 26-to-25, not calendar month.
2. **TA/DA rate management with finance-approval workflow** — master-level schema + approval flow.
3. **TA/DA monthly compute + payable register** — 5 employee classes, class-specific inputs, NEFT export.

It does NOT cover:
- Plant pipeline (calendar-month; untouched by this work)
- Incentive computation (remains manual entry)
- Loan/advance/diwali modules (unchanged)
- Any change to salary components other than cycle handling

---

## 1. Cycle Rule — Canonical Definition

**Rule:** The sales salary cycle ending in month M of year Y is the inclusive date range **(M−1)-26 through M-25**. Holidays falling within those dates belong to that cycle. Cycle boundaries are fixed at the 25th/26th; no weekend or holiday floating.

**Mid-cycle joiner:** paid pro-rata from DOJ to cycle end.

**Examples:**
- Feb 2026 cycle: Jan 26 – Feb 25 (31 days)
- Mar 2026 cycle: Feb 26 – Mar 25 (28 days in non-leap 2027; **28 days in 2026** because Feb 2026 has 28 days → Feb 26–Mar 25 includes Feb 26, 27, 28 + Mar 1–25 = 28 days)
- Apr 2026 cycle: Mar 26 – Apr 25 (31 days)

**Holiday inclusion rule (normal behavior):** Coordinator reports only days worked, excluding holidays. System adds +1 day for each gazetted holiday falling in the cycle that was NOT a Sunday.

**Feb 2026 anomaly (known):** Coordinator accidentally included Republic Day (Jan 26) in DAYS for every employee. For E2E testing only, the DAYS input for Feb 2026 must be interpreted as "includes Jan 26 holiday". Going forward from Mar 2026 onwards, the coordinator reverts to the normal convention and the system adds holidays. This anomaly is a **data caveat only, not a code branch** — we do not hard-code Feb 2026 behavior into the system. The E2E test handler documents the expected +1 inflation.

---

## 2. Schema Changes

All schema changes are additive. Use `safeAddColumn` / `CREATE TABLE IF NOT EXISTS` patterns.

### 2.1 `sales_employees` — TA/DA extension + legacy_code

```sql
ALTER TABLE sales_employees ADD COLUMN legacy_code TEXT;
CREATE INDEX IF NOT EXISTS idx_sales_employees_legacy_code ON sales_employees(legacy_code);

ALTER TABLE sales_employees ADD COLUMN ta_da_class INTEGER
    CHECK (ta_da_class IN (0, 1, 2, 3, 4, 5));
  -- 0 = flag_for_review (needs HR resolution)
  -- 1 = Fixed TA/DA package
  -- 2 = Tiered DA, no TA
  -- 3 = Flat DA + per-km TA
  -- 4 = Tiered DA + per-km TA
  -- 5 = Tiered DA + dual-vehicle TA

ALTER TABLE sales_employees ADD COLUMN da_rate REAL;
  -- For Class 1, 3: the single DA rate per day.
  -- For Class 2, 4, 5: the in-city DA rate per day.

ALTER TABLE sales_employees ADD COLUMN da_outstation_rate REAL;
  -- For Class 2, 4, 5: the outstation DA rate per day. NULL for Class 1, 3.

ALTER TABLE sales_employees ADD COLUMN ta_rate_primary REAL;
  -- For Class 3, 4: the ₹/km rate. For Class 5: the BIKE rate. NULL for Class 1, 2.

ALTER TABLE sales_employees ADD COLUMN ta_rate_secondary REAL;
  -- For Class 5: the CAR rate. NULL for others.

ALTER TABLE sales_employees ADD COLUMN ta_da_notes TEXT;
ALTER TABLE sales_employees ADD COLUMN ta_da_updated_at TEXT;
ALTER TABLE sales_employees ADD COLUMN ta_da_updated_by TEXT;
```

**Why rename `da_in_city → da_rate`:** For Class 1 and Class 3 employees (145 of 167 = 87%), there's no city/outstation distinction. `da_rate` is the neutral name. For tiered classes, `da_rate` is the in-city rate and `da_outstation_rate` is the higher rate. Clearer than `da_in_city` which implies tiering even when none exists.

### 2.2 `sales_salary_computations` — cycle dates

```sql
ALTER TABLE sales_salary_computations ADD COLUMN cycle_start_date TEXT;
ALTER TABLE sales_salary_computations ADD COLUMN cycle_end_date TEXT;
```

The existing `month` and `year` columns are retained and continue to mean "cycle ending in month M of year Y". `cycle_start_date` and `cycle_end_date` are derived values stored redundantly for auditability and simpler query logic. Backfill: for existing rows, compute and populate these from (month, year) using the canonical rule.

### 2.3 `sales_holidays` — unchanged

No schema change. Cycle membership is computed at compute time, not stored. Logic: a holiday on date D belongs to the cycle with `cycle_start_date <= D <= cycle_end_date`.

### 2.4 `sales_ta_da_change_requests` — new table

```sql
CREATE TABLE IF NOT EXISTS sales_ta_da_change_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    employee_code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
      -- pending | approved | rejected | cancelled | superseded
    new_ta_da_class INTEGER,
    new_da_rate REAL,
    new_da_outstation_rate REAL,
    new_ta_rate_primary REAL,
    new_ta_rate_secondary REAL,
    new_ta_da_notes TEXT,
    old_ta_da_class INTEGER,
    old_da_rate REAL,
    old_da_outstation_rate REAL,
    old_ta_rate_primary REAL,
    old_ta_rate_secondary REAL,
    old_ta_da_notes TEXT,
    reason TEXT,
    requested_by TEXT NOT NULL,
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_by TEXT,
    resolved_at TEXT,
    rejection_reason TEXT,
    superseded_by_request_id INTEGER,
    FOREIGN KEY (employee_id) REFERENCES sales_employees(id),
    FOREIGN KEY (superseded_by_request_id) REFERENCES sales_ta_da_change_requests(id)
);
CREATE INDEX IF NOT EXISTS idx_tadar_employee ON sales_ta_da_change_requests(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_tadar_status ON sales_ta_da_change_requests(status, requested_at);
```

### 2.5 `sales_ta_da_monthly_inputs` — new table

Monthly inputs per employee per cycle. Class-specific fields; unused fields stay NULL.

```sql
CREATE TABLE IF NOT EXISTS sales_ta_da_monthly_inputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_code TEXT NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    cycle_start_date TEXT NOT NULL,
    cycle_end_date TEXT NOT NULL,
    days_worked INTEGER NOT NULL,            -- from attendance; denormalized for convenience
    in_city_days INTEGER,                    -- Class 2, 4, 5
    outstation_days INTEGER,                 -- Class 2, 4, 5
    total_km REAL,                           -- Class 3, 4 (single vehicle)
    bike_km REAL,                            -- Class 5
    car_km REAL,                             -- Class 5
    source TEXT NOT NULL,                    -- 'attendance_auto' | 'upload' | 'manual'
    source_detail TEXT,                      -- filename if upload, user if manual
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    updated_by TEXT,
    UNIQUE(employee_code, month, year)
);
CREATE INDEX IF NOT EXISTS idx_tada_inputs_cycle ON sales_ta_da_monthly_inputs(month, year);
```

### 2.6 `sales_ta_da_computations` — new table

Computed output per employee per cycle.

```sql
CREATE TABLE IF NOT EXISTS sales_ta_da_computations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_code TEXT NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    cycle_start_date TEXT NOT NULL,
    cycle_end_date TEXT NOT NULL,
    ta_da_class_at_compute INTEGER NOT NULL, -- snapshot of class at compute time
    da_rate_at_compute REAL,
    da_outstation_rate_at_compute REAL,
    ta_rate_primary_at_compute REAL,
    ta_rate_secondary_at_compute REAL,
    da_amount REAL NOT NULL DEFAULT 0,
    ta_amount REAL NOT NULL DEFAULT 0,
    total_payable REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'computed',
      -- computed | partial | flag_for_review | paid
    computation_notes TEXT,
    computed_at TEXT DEFAULT (datetime('now')),
    computed_by TEXT,
    neft_exported_at TEXT,
    neft_exported_by TEXT,
    paid_at TEXT,
    UNIQUE(employee_code, month, year)
);
CREATE INDEX IF NOT EXISTS idx_tada_comp_cycle ON sales_ta_da_computations(month, year, status);
```

**Key: rates are snapshotted at compute time** (`*_at_compute` columns). If the master rate changes after compute, the old computation's values remain correct. Re-compute needed to apply new rates.

### 2.7 Permissions — 4 new permission strings

- `sales-tada-request` — HR submits rate change requests
- `sales-tada-approve` — Finance approves/rejects rate change requests
- `sales-tada-compute` — HR runs monthly TA/DA compute and edits monthly inputs
- `sales-tada-payable-export` — Finance/HR exports NEFT and payable sheets

Add `sales-tada-request`, `sales-tada-compute`, `sales-tada-payable-export` to `hr` role.
Add `sales-tada-approve`, `sales-tada-payable-export` to `finance` role.

---

## 3. TA/DA Compute Engine — Class-by-Class Formulas

All DA/TA compute is independent of salary compute. Output is ₹ per month per employee.

### Class 1 — Fixed TA/DA package (65 employees)
- **Inputs:** days_worked (from attendance)
- **Formula:** `DA = da_rate × days_worked; TA = 0`
- **Total payable:** `DA`
- **Status:** `computed` immediately after attendance upload triggers auto-compute.
- **Monthly input row in `sales_ta_da_monthly_inputs`:** auto-created from attendance; `in_city_days`, `outstation_days`, and all km fields stay NULL.

### Class 2 — Tiered DA, no TA (0 employees currently; future-proof)
- **Inputs:** days_worked + in_city_days + outstation_days
- **Validation:** `in_city_days + outstation_days <= days_worked`. Missing days fallback: remaining → `in_city_days`.
- **Formula:** `DA = (in_city_days × da_rate) + (outstation_days × da_outstation_rate); TA = 0`
- **Status after attendance upload only:** `partial` (awaiting in/out split).
- **Status after day-split entry:** `computed`.

### Class 3 — Flat DA + per-km TA (77 employees)
- **Inputs:** days_worked + total_km
- **Formula:** `DA = da_rate × days_worked; TA = total_km × ta_rate_primary`
- **Total:** `DA + TA`
- **Status after attendance upload:** `partial` (DA known, TA=0 pending km).
- **Status after km entry:** `computed`.

### Class 4 — Tiered DA + per-km TA (23 employees)
- **Inputs:** days_worked + in_city_days + outstation_days + total_km
- **Formula:** `DA = (in_city_days × da_rate) + (outstation_days × da_outstation_rate); TA = total_km × ta_rate_primary`
- **Total:** `DA + TA`
- **Status after attendance upload:** `partial` (DA computed using fallback "all in-city"; TA=0).
- **Status after full input:** `computed`.
- **Fallback DA if only attendance known:** `days_worked × da_rate` (treats all days as in-city).

### Class 5 — Tiered DA + dual-vehicle TA (2 employees)
- **Inputs:** days_worked + in_city_days + outstation_days + bike_km + car_km
- **Formula:** `DA = (in_city_days × da_rate) + (outstation_days × da_outstation_rate); TA = (bike_km × ta_rate_primary) + (car_km × ta_rate_secondary)`
- **Total:** `DA + TA`
- **Status after attendance upload:** `partial`.
- **Status after full input:** `computed`.

### Class 0 — Flag for Review
- **No compute.** Status = `flag_for_review`. `total_payable = 0`.
- Monthly input row can exist but doesn't trigger compute.

---

## 4. Compute Workflow — Two-Phase Trigger

### Phase α — Automatic on attendance upload

When attendance is uploaded and salary compute runs, the sales parser ALSO populates `sales_ta_da_monthly_inputs` with `days_worked` per employee (source='attendance_auto'). Then triggers:

```
for each employee in the uploaded cycle:
    class = employee.ta_da_class
    if class == 1:
        compute full TA/DA; status='computed'
    if class in (2, 4, 5):
        compute DA with fallback (all in-city); TA=0; status='partial'
    if class == 3:
        compute DA; TA=0; status='partial'
    if class == 0:
        create computation row with status='flag_for_review', total_payable=0
```

This is a single DB transaction per employee per cycle. Idempotent — re-running produces the same result.

### Phase β — On-demand via upload or manual entry

When HR uploads a class-specific template OR edits a row in the register UI:
```
for each affected (employee, cycle):
    update sales_ta_da_monthly_inputs with the new fields
    recompute sales_ta_da_computations per that class's formula
    if all required fields now populated: status='computed'
    else: remain 'partial'
```

Source field distinguishes: `upload` (class template upload), `manual` (UI edit).

**Key property:** The compute engine has no knowledge of "where did this input come from". It just reads the monthly inputs row and applies the class formula. This keeps the engine testable independent of ingestion pathways.

---

## 5. Monthly TA/DA Input Templates — 4 Upload Formats

HR picks which template to upload based on the class being processed. Each template's header row documents which class it's for.

### Template A — Class 1 (Fixed TA/DA)
Not applicable. Class 1 requires no monthly input. Attendance upload alone suffices.

### Template B — Class 2 (Tiered DA, no TA)
```
employee_code | name | in_city_days | outstation_days
```
Validation:
- employee_code must exist AND `ta_da_class = 2`
- in_city_days + outstation_days ≤ days_worked (from attendance). Excess → error, missing → in_city fallback.

### Template C — Class 3 (Flat DA + per-km TA)
```
employee_code | name | total_km
```
Validation:
- employee_code must exist AND `ta_da_class = 3`
- total_km ≥ 0 (zero allowed; means DA-only for this month).

### Template D — Class 4 (Tiered DA + per-km TA)
```
employee_code | name | in_city_days | outstation_days | total_km
```
Validation: combination of Template B and Template C rules.

### Template E — Class 5 (Dual-vehicle)
```
employee_code | name | in_city_days | outstation_days | bike_km | car_km
```
Validation: as Template D plus both km fields must be provided (zero allowed).

Parser validates class match. Uploading a Class 3 row in a Class 4 template → error. This is a class-strict format.

**File format:** .xlsx. Parser reads sheet 1 only. Header row is auto-detected (first row with `employee_code` or equivalent header).

---

## 6. Change-Request Workflow — Unchanged from Earlier Memo

(Full rules preserved from `sales_ta_da_design.md`; restating the non-obvious ones.)

- Status lifecycle: `pending → approved | rejected | cancelled | superseded`
- On new request for employee with pending request: old request → `superseded`, new request → `pending`, linked via `superseded_by_request_id`.
- Finance cannot approve their own request. Backend enforces `requester_id != approver_id`.
- **On approval**: ALL 6 `new_*` fields from the change request are copied to the employee row in a single UPDATE. Fields not being changed should have been pre-filled with current values when the request was submitted (the frontend does this), so they write the same value back. This ensures atomicity and a complete snapshot.
- `ta_da_updated_at` / `ta_da_updated_by` on the employee row get the APPROVER's identity and timestamp.
- Rejection requires `rejection_reason`; employee row unchanged.
- HR can cancel own pending request anytime before resolution.
- Employee inactivation auto-cancels pending requests.
- Approving a superseded request: 409 with "This request was superseded by #N".

### Bootstrap mode

Initial master import sets `ta_da_updated_by = 'master_import_2026-04-24'` directly; no change request rows. First edit post-import triggers the workflow normally.

---

## 7. API Surface

### 7.1 Change-request endpoints (Phase 2 of build)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/sales/ta-da-requests?status=pending` | `sales-tada-approve` | Approval queue |
| GET | `/api/sales/ta-da-requests/employee/:code` | either request/approve | Per-employee history |
| GET | `/api/sales/ta-da-requests/:id` | either | Single request detail |
| POST | `/api/sales/ta-da-requests` | `sales-tada-request` | Supersedes existing pending in same txn |
| POST | `/api/sales/ta-da-requests/:id/approve` | `sales-tada-approve` | 403 if self; 409 if already resolved |
| POST | `/api/sales/ta-da-requests/:id/reject` | `sales-tada-approve` | Body: rejection_reason (required) |
| POST | `/api/sales/ta-da-requests/:id/cancel` | `sales-tada-request` | Only if owner AND status=pending |

### 7.2 TA/DA compute endpoints (Phase 3 of build)

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/sales/ta-da/compute?month=&year=` | `sales-tada-compute` | Full recompute for cycle |
| GET | `/api/sales/ta-da/register?month=&year=&status=` | `sales-tada-compute` | Paginated; status filter (computed/partial/flag_for_review/paid) |
| GET | `/api/sales/ta-da/employee/:code?month=&year=` | `sales-tada-compute` | Single employee compute detail |
| PATCH | `/api/sales/ta-da/inputs/:code?month=&year=` | `sales-tada-compute` | Manual edit; triggers recompute |
| POST | `/api/sales/ta-da/upload/:class` | `sales-tada-compute` | Class-specific template upload |
| GET | `/api/sales/ta-da/export/excel?month=&year=` | `sales-tada-payable-export` | Excel payable sheet |
| GET | `/api/sales/ta-da/export/neft?month=&year=&mode=` | `sales-tada-payable-export` | NEFT CSV; mode=`computed_only` or `all` |
| GET | `/api/sales/ta-da/export/payslip/:code?month=&year=` | `sales-tada-payable-export` | Per-employee TA/DA PDF |

### 7.3 Cycle-related salary endpoints

No new endpoints. Existing salary compute endpoints internally pass cycle dates instead of (month, year) to the compute functions.

---

## 8. Frontend Pages

### 8.1 Modified: `SalesEmployeeMaster.jsx`

New TA/DA block on the employee detail view:
- Shows class label + relevant rate fields
- Edit button (permission: `sales-tada-request`) opens a change-request form with class + rate fields + required reason textarea
- Pending-request badge (red dot) if `status='pending'` request exists; click expands details; HR can cancel own
- New "TA/DA History" tab showing all requests chronologically

### 8.2 New: `SalesTaDaApprovals.jsx`

Route: `/sales/ta-da-approvals`. Permission: `sales-tada-approve`.
- Pending queue, newest first
- Row expansion: side-by-side old/new diff, highlighted changed fields
- Approve / Reject (requires reason) buttons
- View History tab for each employee

### 8.3 New: `SalesTaDaRegister.jsx`

Route: `/sales/ta-da-register`. Permission: `sales-tada-compute`.
- Cycle picker (month/year)
- Table: one row per employee, columns: code, name, class, status, days, inputs, DA, TA, total
- Status filter: All / Computed / Partial / Flag for Review / Paid
- Class filter
- Row-level inline edit for inputs (triggers recompute on save)
- Compute-all button (triggers full recompute for cycle)
- Export buttons: Excel, NEFT (with mode toggle), per-employee PDF

### 8.4 New: `SalesTaDaUpload.jsx`

Route: `/sales/ta-da-upload`. Permission: `sales-tada-compute`.
- 4 upload tabs (Class 2, 3, 4, 5) — each with its own template download + upload form
- Per-row preview + error flagging before commit
- On commit: parser runs, recompute triggered, redirect to register filtered by that class

### 8.5 Navbar badges

Both `sales-tada-approve` and `sales-tada-compute` users see a red dot on their nav item when there's pending work (pending requests / partial rows in current cycle).

---

## 9. Data Load Plan — Master Regeneration

The master CSV and SQL generated earlier are stale. Need regeneration reflecting:
1. `legacy_code` column added to schema
2. TA/DA columns added
3. 6 outliers REMOVED from load (HR re-adds via UI)
4. Final count: **167 employees** (176 − 3 merges − 6 outliers)

Regeneration is mechanical once schema is in place. Parser classification rule:

| Source TA | Source DA | Class | da_rate | da_outstation_rate | ta_rate_primary | ta_rate_secondary |
|---|---|---|---|---|---|---|
| 0/NULL | single N | 1 | N | NULL | NULL | NULL |
| 0/NULL | range X-Y | 2 | X | Y | NULL | NULL |
| 0/NULL | NULL | OUTLIER | skip from load | | | |
| numeric T | single N | 3 | N | NULL | T | NULL |
| numeric T | range X-Y | 4 | X | Y | T | NULL |
| "T1/T2" or "T1_T2" | single N | 5 | N | N | T1 | T2 |
| "T1/T2" or "T1_T2" | range X-Y | 5 | X | Y | T1 | T2 |
| 100 | any | OUTLIER | skip from load | | | |

`ta_rate_primary` for Class 3/4 = the TA numeric value (e.g., 3 means ₹3/km). For Class 5 = the bike rate. Column name is neutral because the class determines interpretation.

---

## 10. Phase Execution Plan (4 Phases for Claude Code)

### Phase 1 — Cycle + All Schema (2.5 hrs)

**Scope:**
- All schema changes from §2: sales_employees extensions, sales_salary_computations cycle columns, sales_ta_da_change_requests table, sales_ta_da_monthly_inputs table, sales_ta_da_computations table, permissions registry updates
- `salesSalaryComputation.js` refactor to use cycle dates (derived from month/year via canonical rule)
- `sundayRule.js` interface change: accept `(cycleStart, cycleEnd)` instead of `(month, year)`
- Holiday matching by cycle membership in salary compute
- Mid-cycle DOJ pro-ration
- Frontend month picker: add cycle-date subtitle to month selector ("Feb 2026 — Jan 26 to Feb 25")
- Backfill existing sales_salary_computations rows with cycle dates
- **Regression test:** run Feb 2026 compute with existing test data; verify no unexpected drift in employees that HAD been computed (the cycle interpretation changes will cause drift; document expected direction).

**Files touched:**
- `backend/src/db/migrations/*` (or equivalent)
- `backend/src/services/salesSalaryComputation.js`
- `backend/src/services/sundayRule.js`
- `backend/src/services/cycleUtil.js` — **NEW** module. Single authoritative function `deriveCycle(month, year) → {start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', length_days: N}`. All cycle date computation goes through this. Compute engine, holiday matching, UI labels, and SQL backfill all call the same function.
- `backend/src/routes/sales.js` (compute/register endpoints wire cycle dates through)
- `frontend/src/pages/SalesSalaryCompute.jsx` (cycle subtitle)
- `backend/src/auth/permissions.js` (4 new strings, role mappings)

**DO NOT MODIFY:** `backend/src/services/salaryComputation.js` (plant), plant `routes/*`, any non-sales files.

**Validation SQL after Phase 1:**
```sql
-- Schema check
PRAGMA table_info(sales_employees);  -- verify legacy_code, ta_da_class, etc. present
PRAGMA table_info(sales_salary_computations);  -- verify cycle_*_date columns present

-- Backfill check
SELECT COUNT(*) FROM sales_salary_computations WHERE cycle_start_date IS NULL;
-- Expected: 0

-- Permission strings
SELECT * FROM permissions WHERE name LIKE 'sales-tada-%';
-- Expected: 4 rows
```

### Phase 2 — TA/DA Module 1 (Rates + Approval Workflow) + Master Load (3 hrs)

**Scope:**
- All 7 change-request endpoints from §7.1
- Backend guards: no self-approval; transactional supersede; concurrency via status=pending check
- Frontend: TA/DA block on employee detail; approval queue page; navbar badge; history tab
- Master data load: 167 employees with TA/DA fields populated from source per §9 rule

**Validation SQL after Phase 2:**
```sql
SELECT COUNT(*) FROM sales_employees WHERE legacy_code IS NOT NULL;
-- Expected: 167

SELECT ta_da_class, COUNT(*) FROM sales_employees GROUP BY ta_da_class;
-- Expected: class 1=65, class 3=77, class 4=23, class 5=2, NULL=0, flag-for-review (class 0) cases not loaded

SELECT COUNT(*) FROM sales_holidays;
-- Expected: 6
```

### Phase 3 — TA/DA Module 2 (Compute + Payable Register) (3 hrs)

**Scope:**
- Compute engine `salesTaDaComputation.js` implementing all 5 class formulas + Phase α/β logic
- Auto-trigger hook in sales attendance upload: after attendance parses, call `computeAll(cycle)` for TA/DA
- 8 endpoints from §7.2
- 4 class templates + parser for each
- 3 new frontend pages: Register, Upload, and the approval queue already done in Phase 2
- NEFT export (reuse plant's NEFT format; bank + account + ifsc from sales_employees). **Validation:** rows with missing bank_name OR account_no OR ifsc are EXCLUDED from the CSV; a warning banner shows these employee codes with "missing bank details" so HR can fix before re-export.
- Excel export (mirror the salary Excel export style, simpler columns)
- PDF TA/DA statement (reuse jsPDF setup from salary payslip)

**Validation after Phase 3:**
- Upload Feb 2026 attendance → verify all 167 employees get a computation row
- Class 1 rows should have status='computed' immediately
- Class 3/4/5 rows should have status='partial'
- Upload a Template C (Class 3) file with 5 rows → those 5 should flip to 'computed'
- Manual edit of a Class 4 row → recomputed correctly
- NEFT export in `computed_only` mode → only rows with status='computed'; NEFT export in `all` mode → all rows including partial (finance's choice)

### Phase 4 — E2E Test + Bug Fixes (2+ hrs, open-ended)

**Scope:**
- Manual UI walkthrough of: salary upload → compute → verify against HR PAYABLE → triage drift
- TA/DA walkthrough: same cycle, verify DA/TA per class
- Bug triage: any drift > ₹5 on salary gets a focused fix prompt
- Update CLAUDE.md with the session's changes

**Gate:** salary drift ≤ ₹5 per employee OR documented explanation for every drift > ₹5.

---

## 11. Edge Cases and Explicit Decisions

| Case | Decision |
|---|---|
| Feb 2026 coordinator error (included holiday in DAYS) | For E2E only: expect +1 day inflation per employee. Not a code branch; document in test report. |
| Mid-cycle DOJ pro-ration denominator | `earnedRatio = days_present / cycle_length`, where cycle_length is the calendar-day count of the full cycle (e.g., 31 for Feb cycle, 28 for Mar cycle). A mid-cycle joiner naturally has fewer `days_present`, so their earnedRatio is smaller. Denominator does NOT change per-employee. This matches Q1's salary compute rule and is consistent with existing plant behavior. |
| `sales_ta_da_monthly_inputs.days_worked` semantics | Stores COORDINATOR'S raw DAYS (excluding holidays in normal operation). Salary compute internally adds holidays for its own day count; TA/DA does NOT add holidays because holidays are not travel days. **Salary and TA/DA intentionally use different day counts.** Document this in code comments on both sides. |
| TA/DA class change for an employee mid-cycle | Uses class at compute time. If class changed mid-cycle via approved request, the class as of `computed_at` applies to the whole cycle. No mid-cycle split. |
| Employee has pending TA/DA change request during compute | Compute uses current (not pending) values. Pending request stays pending. |
| Partial TA/DA paid, remainder later | Each cycle is independent. No carry-forward. If Feb TA/DA is paid partially and km arrives for March, Feb's remainder is a separate Feb NEFT. No co-mingling. |
| Employee marked inactive mid-cycle | Salary compute: normal pro-ration to DOL. TA/DA: compute uses days_worked and km as reported. No special handling. |
| Holiday on a Sunday | Not treated as an additional paid holiday (Sunday already is non-working). Gazetted holiday rule excludes Sundays. |
| Coordinator sheet has a non-existent employee code | Row flagged as "unmatched"; not processed; does not block the rest of the upload. |
| Re-upload of class template with overlapping employees | Latest wins; previous monthly_inputs row for that employee+cycle is overwritten (timestamped in `updated_at`). |
| Running salary compute with no TA/DA data (e.g., before TA/DA Module 2 ships) | Salary compute is independent. Zero impact. |
| Running TA/DA compute with no salary compute yet | Fine; `days_worked` comes from attendance table, which populates independent of salary compute status. |
| NEFT export row missing bank details (account_no, ifsc, or bank_name) | Row EXCLUDED from export. Warning panel shows employee codes with missing details. Exporter can fix in master and re-run. |

---

## 12. Out of Scope (Explicit — do NOT build in this initiative)

- Km report "variance" handling (mid-cycle rate changes, approval for exceptional km) — v1.1
- Per-km tier thresholds (distance-based rate breaks) — v1.1
- Multi-approver / escalation workflows — v2
- Bulk change requests (one employee per request only) — v2
- Comments/conversation thread on change requests — v2
- Retroactive rate adjustments crossing cycles — v2
- Plant TA/DA compute (no plant TA/DA policy defined) — not planned
- Mobile UI optimization — v1.1

---

## 13. Success Criteria for the 2-Day Push

End of Day 2 (after Phase 4):
1. Salary compute passes Feb 2026 E2E within ±₹5 per employee. Drift explained for any outliers.
2. TA/DA Phase α executes on attendance upload without error; Class 1 employees are `computed`, others are `partial`.
3. At least one class-template upload (Class 3 preferred — most employees) has been exercised end-to-end.
4. Change-request workflow has been exercised at least once (one request submitted, one approved).
5. CLAUDE.md is updated with the session's changes, with particular focus on:
   - The cycle rule (canonical definition)
   - The 5-class TA/DA model
   - The Feb 2026 coordinator-error caveat

If any of these fails, the system is NOT ready for March-April production use. Honest assessment required.

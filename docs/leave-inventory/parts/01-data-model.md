# 01 — Leave Data Model

Audit scope: every leave-related table, column, index, migration and `policy_config` key.
Primary source: `backend/src/database/schema.js` (3281 lines, single function `initSchema(db)` — FACT, schema.js:3 and schema.js:3281).
`initSchema` is invoked once at DB open — FACT, `backend/src/database/db.js:3` (require) and `backend/src/database/db.js:26` (`initSchema(db)`).

Structural note (FACT): `initSchema` is one long linear function. Everything at its top level runs on **every boot**, in file-line order. Tables in the first `db.exec(...)` template literal (schema.js:4–~695) are all `CREATE TABLE IF NOT EXISTS` inside one statement batch; later tables are individual `db.exec()` calls. Only the explicitly gated blocks (Section C) are conditional.

---

## A. Tables

### leave_balances — schema.js:96-106
Purpose: aggregate per employee × year × leave type (the "current balance" row the UI reads).

| column | type | default | notes |
|---|---|---|---|
| id | INTEGER | — | PRIMARY KEY AUTOINCREMENT (schema.js:97) |
| employee_id | INTEGER | — | REFERENCES employees(id) (schema.js:98) — FK is by `id`, not `code` |
| year | INTEGER | — | NOT NULL (schema.js:99) |
| leave_type | TEXT | — | NOT NULL (schema.js:100), free text — no CHECK constraint |
| opening | REAL | 0 | schema.js:101 |
| accrued | REAL | 0 | schema.js:102 |
| used | REAL | 0 | schema.js:103 |
| balance | REAL | 0 | schema.js:104 |

- Constraints: `UNIQUE(employee_id, year, leave_type)` — FACT, schema.js:105.
- Indexes: **none** beyond the implicit UNIQUE index. `grep "ON leave_balances" schema.js` returns 0 hits — FACT.
- Created where: unconditionally, inside the top master `db.exec` block — FACT, schema.js:96.
- No `company` column — FACT. Cross-company reporting must join `employees`.
- Listed in `PAYROLL_TABLES` (DELETE requires `forceLargeChange`) — FACT, `backend/src/services/protectedWrite.js:44`.

### leave_transactions — schema.js:108-122
Purpose: append-only movement log for leave (grant / use / adjustment), keyed by employee **code**.

| column | type | default | notes |
|---|---|---|---|
| id | INTEGER | — | PRIMARY KEY AUTOINCREMENT (schema.js:109) |
| employee_id | INTEGER | — | REFERENCES employees(id) (schema.js:110) |
| employee_code | TEXT | — | NOT NULL (schema.js:111) |
| company | TEXT | — | nullable (schema.js:112) |
| leave_type | TEXT | — | NOT NULL (schema.js:113) |
| transaction_type | TEXT | — | NOT NULL (schema.js:114), no CHECK |
| days | REAL | — | NOT NULL (schema.js:115) |
| balance_after | REAL | — | nullable (schema.js:116) |
| reference_month | INTEGER | — | schema.js:117 |
| reference_year | INTEGER | — | schema.js:118 |
| reason | TEXT | — | schema.js:119 |
| approved_by | TEXT | — | schema.js:120 |
| created_at | TEXT | `datetime('now')` | schema.js:121 |

- Constraints: **no UNIQUE constraint at all** — FACT (schema.js:108-122 contains no UNIQUE line). Nothing at the schema level prevents a duplicate transaction row.
- Indexes: `idx_leave_transactions_employee ON leave_transactions(employee_code)` — FACT, schema.js:124.
- Created where: unconditional, top master block — FACT, schema.js:108.
- In `PAYROLL_TABLES` — FACT, `backend/src/services/protectedWrite.js:45`.

### leave_applications — schema.js:402-417
Purpose: CL/EL/LWP leave request rows with an approval workflow.

| column | type | default | notes |
|---|---|---|---|
| id | INTEGER | — | PRIMARY KEY AUTOINCREMENT (schema.js:403) |
| employee_id | INTEGER | — | REFERENCES employees(id) (schema.js:404) |
| employee_code | TEXT | — | NOT NULL (schema.js:405) |
| leave_type | TEXT | — | NOT NULL (schema.js:406), no CHECK |
| start_date | TEXT | — | NOT NULL (schema.js:407) |
| end_date | TEXT | — | NOT NULL (schema.js:408) |
| days | REAL | — | NOT NULL (schema.js:409) |
| reason | TEXT | — | schema.js:410 |
| status | TEXT | `'Pending'` | schema.js:411, no CHECK on allowed values |
| applied_at | TEXT | `datetime('now')` | schema.js:412 |
| approved_by | TEXT | — | schema.js:413 |
| approved_at | TEXT | — | schema.js:414 |
| rejection_reason | TEXT | — | schema.js:415 |
| remarks | TEXT | — | schema.js:416 |
| **hr_remark** | TEXT | — | **added later by migration** — FACT, schema.js:1613 (`safeAddColumn('leave_applications','hr_remark','TEXT')`). Comment at schema.js:1612 says it is "hard-gated in routes/leaves". |

- Constraints: **no UNIQUE** — FACT. Nothing prevents two overlapping applications for the same employee/date range at the schema level.
- Indexes: **none**. `grep "ON leave_applications" schema.js` returns 0 hits — FACT.
- Created where: unconditional, top master block — FACT, schema.js:402.
- NOT in `PAYROLL_TABLES` (protectedWrite.js:39-49) — FACT; deletes are not extra-gated.

### leave_accrual_ledger — schema.js:1576-1595
Purpose: canonical per employee × year × month × leave_type audit trail behind the `leave_balances` aggregate (comment, schema.js:1570-1574).

| column | type | default | notes |
|---|---|---|---|
| id | INTEGER | — | PRIMARY KEY AUTOINCREMENT (schema.js:1577) |
| employee_code | TEXT | — | NOT NULL (schema.js:1578) |
| employee_id | INTEGER | — | **no FK** (schema.js:1579) — unlike leave_balances |
| year | INTEGER | — | NOT NULL (schema.js:1580) |
| month | INTEGER | — | NOT NULL (schema.js:1581) |
| leave_type | TEXT | — | NOT NULL (schema.js:1582) |
| opening_balance | REAL | 0 | schema.js:1583 |
| accrued | REAL | 0 | schema.js:1584 |
| used | REAL | 0 | schema.js:1585 |
| lapsed | REAL | 0 | schema.js:1586 |
| closing_balance | REAL | 0 | schema.js:1587 |
| paid_days_this_month | REAL | 0 | schema.js:1588 |
| paid_days_ytd | REAL | 0 | schema.js:1589 |
| el_earned_ytd | REAL | 0 | schema.js:1590 |
| company | TEXT | — | schema.js:1591 |
| created_at | TEXT | `datetime('now')` | schema.js:1592 |

- Constraints: `UNIQUE(employee_code, year, month, leave_type)` — FACT, schema.js:1593. This is the ON CONFLICT target used by the upsert in `backend/src/services/phase5Features.js` (`ON CONFLICT(employee_code, year, month, leave_type) DO UPDATE SET ...`) — FACT.
- Indexes: `idx_accrual_ledger_employee ON leave_accrual_ledger(employee_code, year)` — FACT, schema.js:1596.
- Created where: unconditional `db.exec()` at top level of `initSchema` — FACT, schema.js:1575-1595.
- NOT in `PAYROLL_TABLES` — FACT, protectedWrite.js:39-49.
- Note (FACT): the UPSERT's DO UPDATE clause in phase5Features.js does **not** update `lapsed` or `company` on conflict — re-running a month cannot correct a lapsed value.

### compensatory_off_requests — schema.js:1543-1566
Purpose: HR-initiated Comp-Off / On-Duty (OD) day grant requiring Finance approval before it counts in payroll (comment, schema.js:1537-1541).

| column | type | default | notes |
|---|---|---|---|
| id | INTEGER | — | PRIMARY KEY AUTOINCREMENT (schema.js:1544) |
| employee_code | TEXT | — | NOT NULL (schema.js:1545) |
| employee_id | INTEGER | — | REFERENCES employees(id) (schema.js:1546) |
| start_date | TEXT | — | NOT NULL (schema.js:1547) |
| end_date | TEXT | — | NOT NULL (schema.js:1548) |
| days | REAL | — | NOT NULL (schema.js:1549) |
| month | INTEGER | — | NOT NULL (schema.js:1550) |
| year | INTEGER | — | NOT NULL (schema.js:1551) |
| company | TEXT | — | schema.js:1552 |
| reason | TEXT | — | NOT NULL (schema.js:1553) |
| hr_remark | TEXT | — | NOT NULL (schema.js:1554) |
| applied_by | TEXT | — | NOT NULL (schema.js:1555) |
| applied_at | TEXT | `datetime('now')` | schema.js:1556 |
| finance_status | TEXT | `'pending'` | schema.js:1557, no CHECK |
| finance_reviewed_by | TEXT | — | schema.js:1558 |
| finance_reviewed_at | TEXT | — | schema.js:1559 |
| finance_remark | TEXT | — | schema.js:1560 |
| is_applied_to_salary | INTEGER | 0 | schema.js:1561 — double-count guard |
| applied_to_salary_at | TEXT | — | schema.js:1562 |
| created_at | TEXT | `datetime('now')` | schema.js:1563 |

- Constraints: `UNIQUE(employee_code, start_date, month, year, company)` — FACT, schema.js:1564.
- Indexes: `idx_comp_off_status ON compensatory_off_requests(finance_status)` — schema.js:1567; `idx_comp_off_employee ON compensatory_off_requests(employee_code, month, year)` — schema.js:1568. Both FACT.
- Created where: unconditional `db.exec()` — FACT, schema.js:1542-1566.
- Zero `safeAddColumn` calls target this table — FACT (`grep "safeAddColumn('compensatory_off_requests'" schema.js` → 0 hits).

### short_leaves (gate pass) — schema.js:1623-1649
Purpose: authorised early-departure / gate-pass records, one per employee per date per leave_type (comment, schema.js:1620-1621; route header `backend/src/routes/short-leaves.js:3` "CRUD for gate passes (short_leaves table)").

| column | type | default | notes |
|---|---|---|---|
| id | INTEGER | — | PRIMARY KEY AUTOINCREMENT (schema.js:1624) |
| employee_id | INTEGER | — | REFERENCES employees(id) (schema.js:1625) |
| employee_code | TEXT | — | NOT NULL (schema.js:1626) |
| employee_name | TEXT | — | schema.js:1627 — denormalised snapshot |
| department | TEXT | — | schema.js:1628 |
| company | TEXT | — | schema.js:1629 |
| date | TEXT | — | NOT NULL (schema.js:1630) |
| leave_type | TEXT | `'short_leave'` | NOT NULL (schema.js:1631). Route restricts to `short_leave` / `half_day` — FACT, short-leaves.js:52-53 — but there is **no DB CHECK**. |
| duration_hours | REAL | 3.0 | NOT NULL (schema.js:1632) |
| shift_code | TEXT | — | schema.js:1633 |
| shift_end_time | TEXT | — | schema.js:1634 |
| authorized_leave_until | TEXT | — | schema.js:1635 |
| remark | TEXT | — | NOT NULL (schema.js:1636) |
| quota_breach | INTEGER | 0 | schema.js:1637 |
| calendar_month | INTEGER | — | schema.js:1638 |
| calendar_year | INTEGER | — | schema.js:1639 |
| created_by | INTEGER | — | schema.js:1640 |
| created_by_name | TEXT | — | schema.js:1641 |
| created_at | TEXT | `datetime('now')` | schema.js:1642 |
| cancelled_at | TEXT | — | schema.js:1643 |
| cancelled_by | INTEGER | — | schema.js:1644 |
| cancelled_by_name | TEXT | — | schema.js:1645 |
| cancel_reason | TEXT | — | schema.js:1646 |

- Constraints: `UNIQUE(employee_code, date, leave_type)` — FACT, schema.js:1647. INFERENCE: an employee can hold both a `short_leave` and a `half_day` row on the same date, since `leave_type` is part of the key.
- Indexes: `idx_short_leaves_employee ON short_leaves(employee_code, calendar_month, calendar_year)` — schema.js:1650; `idx_short_leaves_date ON short_leaves(date, company)` — schema.js:1651. Both FACT.
- Created where: unconditional `db.exec()` — FACT, schema.js:1622-1648.
- The monthly quota of 2 is **hardcoded in the route**, not a `policy_config` key — FACT, `backend/src/routes/short-leaves.js:127` (`if (used >= 2 && !force_quota_breach)`) and `:136` (`const quotaBreach = used >= 2 ? 1 : 0;`).

### holidays — schema.js:64-72
Purpose: holiday master used by paid-holiday day calculation.

| column | type | default | notes |
|---|---|---|---|
| id | INTEGER | — | PRIMARY KEY AUTOINCREMENT (schema.js:65) |
| date | TEXT | — | NOT NULL (schema.js:66) — **not unique** |
| name | TEXT | — | NOT NULL (schema.js:67) |
| type | TEXT | `'National'` | schema.js:68 |
| is_recurring | INTEGER | 0 | schema.js:69 |
| applicable_to | TEXT | `'All'` | schema.js:70 |
| created_at | TEXT | `datetime('now')` | schema.js:71 |
| **added_by** | TEXT | `'System'` | migration — FACT, schema.js:961 |
| **added_at** | TEXT | `datetime('now')` | migration — FACT, schema.js:962 |
| **is_active** | INTEGER | 1 | migration — FACT, schema.js:963 |

- Constraints: **none** — no UNIQUE on `date` — FACT (schema.js:64-72). The 2025 seed at schema.js:604-614 in fact contains two rows for `2025-10-02` (Gandhi Jayanti and Dussehra) — FACT.
- Indexes: **none**. `grep "ON holidays" schema.js` → 0 hits — FACT.
- Created where: unconditional, top master block — FACT, schema.js:64.
- Seeded twice: 2025-26 block gated on `COUNT(*)===0` — FACT, schema.js:~601-616; 2026 block gated on the existence of a LOHRI row — FACT, schema.js:1021-1032 (see Section C).

### holiday_audit_log — schema.js:1002-1018
Purpose: audit trail for holiday master edits, with a Finance-review lane.

| column | type | default | notes |
|---|---|---|---|
| id | INTEGER | — | PRIMARY KEY AUTOINCREMENT (schema.js:1003) |
| holiday_id | INTEGER | — | **no FK declared** (schema.js:1004) |
| action | TEXT | — | NOT NULL (schema.js:1005) |
| holiday_date | TEXT | — | schema.js:1006 |
| holiday_name | TEXT | — | schema.js:1007 |
| old_values | TEXT | — | JSON blob (schema.js:1008) |
| new_values | TEXT | — | JSON blob (schema.js:1009) |
| changed_by | TEXT | — | NOT NULL (schema.js:1010) |
| changed_at | TEXT | `datetime('now')` | schema.js:1011 |
| reason | TEXT | — | schema.js:1012 |
| affects_months | TEXT | — | schema.js:1013 |
| finance_reviewed | INTEGER | 0 | schema.js:1014 |
| finance_reviewed_by | TEXT | — | schema.js:1015 |
| finance_reviewed_at | TEXT | — | schema.js:1016 |
| finance_review_notes | TEXT | — | schema.js:1017 |

- Constraints: none. Indexes: none (`grep "ON holiday_audit_log"` → 0 hits) — FACT.
- Created where: unconditional `db.exec()` — FACT, schema.js:1001-1018.

### early_exit_detections — schema.js:1656-1677 (gate-pass adjacent)
Purpose: one row per employee/date where punch-out preceded shift end; links to a gate pass if one exists.
Leave-relevant columns: `minutes_early INTEGER DEFAULT 0` (schema.js:1667), `has_gate_pass INTEGER DEFAULT 0` (1668), `short_leave_id INTEGER REFERENCES short_leaves(id)` (1669), `authorized_leave_until TEXT` (1670), `gate_pass_overage_minutes INTEGER DEFAULT 0` (1671), `flagged_minutes INTEGER DEFAULT 0` (1672), `detection_status TEXT DEFAULT 'flagged'` (1673). All FACT.
- Constraints: `UNIQUE(employee_code, date)` — FACT, schema.js:1676.
- Indexes: schema.js:1679, 1680, 1681 — FACT.
- Created where: unconditional `db.exec()` — FACT, schema.js:1655-1677.
- This is the only FK into `short_leaves` — FACT (schema.js:1669).

### early_exit_deductions — schema.js:1686-1714
Purpose: HR-initiated, Finance-approved deduction attached to an `early_exit_detections` row.
Key columns: `early_exit_detection_id INTEGER NOT NULL REFERENCES early_exit_detections(id)` (schema.js:1688), `deduction_type TEXT NOT NULL DEFAULT 'half_day'` (1695), `deduction_amount REAL` (1696), `payroll_month`/`payroll_year` (1698-1699), `hr_remark TEXT NOT NULL` (1700), `finance_status TEXT DEFAULT 'pending'` (1706), `salary_applied INTEGER DEFAULT 0` (1711). All FACT.
- Constraints: no UNIQUE — FACT (schema.js:1686-1714 has no UNIQUE line). Nothing stops two deductions against the same detection.
- Indexes: schema.js:1716, 1717, 1718 — FACT.

### early_exit_deduction_audit — schema.js:1722-1736
State-transition log for the above. Index `idx_early_exit_audit_ded` — FACT, schema.js:1738.

### Tables that do NOT exist
- No `gate_passes` table — FACT: `grep -i "gate_?pass" schema.js` matches only `has_gate_pass` (1668) and `gate_pass_overage_minutes` (1671), both columns on `early_exit_detections`. Gate passes live in `short_leaves`.
- No `leave_types` master / lookup table — FACT: no `CREATE TABLE ... leave_types` in schema.js. Every `leave_type` column is free TEXT with no CHECK and no FK.
- No `leave_encashment`, `leave_lapse` or `leave_policy` table — FACT: 0 grep hits in schema.js.
- No leave tables are defined outside `schema.js`. FACT: `grep -rn "CREATE TABLE" backend/src backend/scripts | grep -v database/schema.js` returns only `notifications` (monthEndScheduler.js:7), `jobs` (jobQueue.js:10), `companies` (routes/settings.js:322), `sql_console_audit`/`sql_console_write_snapshots` (routes/sqlConsole.js:73, :542) and test fixtures.

---

## B. Leave columns on shared tables

### day_calculations — base table schema.js:226-254
Leave-relevant columns **in the base CREATE TABLE** (all FACT):

| column | type | default | line |
|---|---|---|---|
| days_present | REAL | 0 | 236 |
| days_half_present | REAL | 0 | 237 |
| days_wop | REAL | 0 | 238 |
| days_absent | INTEGER | 0 | 239 |
| paid_sundays | REAL | 0 | 240 |
| unpaid_sundays | INTEGER | 0 | 241 |
| paid_holidays | INTEGER | 0 | 242 |
| **cl_used** | REAL | 0 | **243** |
| **el_used** | REAL | 0 | **244** |
| **sl_used** | REAL | 0 | **245** |
| **lop_days** | REAL | 0 | **246** |
| total_payable_days | REAL | 0 | 247 |

Leave-relevant columns **added by migration** (all FACT):

| column | type | default | line |
|---|---|---|---|
| holiday_duty_days | REAL | 0 | 964 |
| sunday_threshold | INTEGER | (none) | 967 |
| sunday_note | TEXT | (none) | 968 |
| date_of_joining | TEXT | (none) | 1055 |
| holidays_before_doj | INTEGER | 0 | 1056 |
| is_mid_month_joiner | INTEGER | 0 | 1057 |
| **od_days** | REAL | 0 | **1601** |
| **short_leave_days** | REAL | 0 | **1602** |
| **uninformed_absent** | INTEGER | 0 | **1603** |

- `UNIQUE(employee_code, month, year, company)` at schema.js:253; later narrowed to `(employee_code, month, year)` by the gated migration at schema.js:3129-3220 — FACT.
- FACT: `cl_used`, `el_used`, `sl_used`, `lop_days` are original base columns (243-246); `od_days`, `short_leave_days`, `uninformed_absent` are Phase-1 additive migrations (1601-1603). The comment at schema.js:1599-1600 states they were added in Phase 1 so Phase 2/3 code could emit them.
- FACT: `day_calculations` has `sl_used` (245) but `salary_computations` has **no** `sl_days` counterpart.

### salary_computations — base table schema.js:256-290
Base table has **no** leave-day columns. It has `payable_days REAL` (schema.js:263) and `lop_deduction REAL DEFAULT 0` (schema.js:284) — FACT. All leave day counts arrive via migration.

Leave-relevant columns added by migration (all FACT):

| column | type | default | line |
|---|---|---|---|
| holiday_duty_pay | REAL | 0 | 981 |
| ed_days | REAL | 0 | 990 |
| ed_pay | REAL | 0 | 991 |
| late_coming_deduction | REAL | 0 | 999 |
| **cl_days** | REAL | 0 | **1605** |
| **el_days** | REAL | 0 | **1606** |
| **lwp_days** | REAL | 0 | **1607** |
| **od_days** | REAL | 0 | **1608** |
| **short_leave_days** | REAL | 0 | **1609** |
| **uninformed_absent_days** | REAL | 0 | **1610** |
| early_exit_deduction | REAL | 0 | 1741 |

- FACT: naming is inconsistent across the pair — `day_calculations.uninformed_absent` is `INTEGER DEFAULT 0` (1603) while `salary_computations.uninformed_absent_days` is `REAL DEFAULT 0` (1610). Different name AND different type affinity for the same concept.
- FACT: `day_calculations.lop_days` (246) vs `salary_computations.lwp_days` (1607) — different names for the LOP/LWP concept across the two stage tables.
- FACT: there is no `sl_days` on `salary_computations` (33 `safeAddColumn('salary_computations', ...)` calls, none named `sl_days`; base table 256-290 has none either).
- `UNIQUE(employee_code, month, year, company)` at schema.js:289; narrowed by the gated migration at 3129-3220.
- Trigger `invalidate_salary_ai_cache` — its `OF` column list at schema.js:1753-1759 covers pay/deduction columns (`lop_deduction`, `late_coming_deduction`, `early_exit_deduction`, `ed_pay`, `ed_days`, `holiday_duty_pay`, …) — FACT, schema.js:1755-1759, `ON salary_computations` at 1760. It does **not** list `cl_days`, `el_days`, `lwp_days`, `od_days`, `short_leave_days` or `uninformed_absent_days`. INFERENCE: editing only those leave-day columns will not invalidate the cached AI salary explanation.

### employees — base table schema.js:23-61
Leave-relevant columns (all FACT):

| column | type | default | line | relevance |
|---|---|---|---|---|
| **date_of_joining** | TEXT | (none, nullable) | **34** | drives CL pro-rating and the EL eligibility floor |
| date_of_exit | TEXT | (none) | 35 | |
| employment_type | TEXT | `'Permanent'` | 32 | `LEAVE_ELIGIBLE_TYPES = ['Permanent']` — FACT, `backend/src/services/phase5Features.js:12` |
| weekly_off_day | INTEGER | 0 | 40 | |
| status | TEXT | `'Active'` | 57 | accrual filters `status='Active'` |
| probation_end_date | TEXT | (none) | 726 (migration) | not referenced by accrual |
| confirmation_date | TEXT | (none) | 727 (migration) | not referenced by accrual |
| category | TEXT | (none) | 728 (migration) | selected by the accrual query |
| is_contractor | INTEGER | 0 | 957 (migration) | contractors excluded from accrual |

- FACT: `date_of_joining` is **nullable with no default** (schema.js:34). `computeClEntitlement` handles a null by returning the full 7 — FACT, `backend/src/services/phase5Features.js:28` (`if (!dateOfJoining) return 7;`).
- FACT: there are **no** leave-quota/entitlement columns on `employees` (no `cl_quota`, `el_quota`, `sl_quota`). All 19 `safeAddColumn('employees', ...)` calls (schema.js:716-733, 957) were checked.

### sales_salary_computations — schema.js:2480+
FACT: has `earned_leave_days REAL DEFAULT 0` at schema.js:2489. This is the sales-vertical parallel and is unrelated to `leave_accrual_ledger` (sales has its own model; see the comment at schema.js:2893 "…not a monthly accrual. The ledger is dropped.").

---

## C. Migrations in schema.js line order

### C.1 `safeAddColumn` — definition and semantics
FACT, schema.js:697-703:
```js
const safeAddColumn = (table, column, type) => {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); }
  catch (e) { /* Column already exists — ignore */ }
};
```
OPINION: the bare `catch {}` swallows *every* error, not just "duplicate column" — a typo'd table name or an invalid type would fail silently on every boot with no log line. There is no verification step that the column actually exists afterwards.

FACT, schema.js:1080-1082: `safeCreateIndex` has the same swallow-everything shape.

### C.2 Leave-touching `safeAddColumn` calls, in line order
| line | table | column | type/default |
|---|---|---|---|
| 961 | holidays | added_by | `TEXT DEFAULT 'System'` |
| 962 | holidays | added_at | `TEXT DEFAULT (datetime('now'))` |
| 963 | holidays | is_active | `INTEGER DEFAULT 1` |
| 964 | day_calculations | holiday_duty_days | `REAL DEFAULT 0` |
| 967 | day_calculations | sunday_threshold | `INTEGER` |
| 968 | day_calculations | sunday_note | `TEXT` |
| 981 | salary_computations | holiday_duty_pay | `REAL DEFAULT 0` |
| 1055 | day_calculations | date_of_joining | `TEXT` |
| 1056 | day_calculations | holidays_before_doj | `INTEGER DEFAULT 0` |
| 1057 | day_calculations | is_mid_month_joiner | `INTEGER DEFAULT 0` |
| **1601** | day_calculations | **od_days** | `REAL DEFAULT 0` |
| **1602** | day_calculations | **short_leave_days** | `REAL DEFAULT 0` |
| **1603** | day_calculations | **uninformed_absent** | `INTEGER DEFAULT 0` |
| **1605** | salary_computations | **cl_days** | `REAL DEFAULT 0` |
| **1606** | salary_computations | **el_days** | `REAL DEFAULT 0` |
| **1607** | salary_computations | **lwp_days** | `REAL DEFAULT 0` |
| **1608** | salary_computations | **od_days** | `REAL DEFAULT 0` |
| **1609** | salary_computations | **short_leave_days** | `REAL DEFAULT 0` |
| **1610** | salary_computations | **uninformed_absent_days** | `REAL DEFAULT 0` |
| **1613** | leave_applications | **hr_remark** | `TEXT` |
| 1741 | salary_computations | early_exit_deduction | `REAL DEFAULT 0` |
All FACT (verified by direct read of each cited line).

FACT: **zero** `safeAddColumn` calls target `leave_balances`, `leave_transactions`, `leave_accrual_ledger`, `compensatory_off_requests` or `short_leaves`. Those five tables are exactly as first written.

### C.3 Gated one-time migrations that touch leave-adjacent data

**(a) 2026 holiday reseed — schema.js:1021-1032. Gate: existence of a LOHRI row, NOT a policy flag.**
FACT, schema.js:1021: `const lohriExists = db.prepare("SELECT id FROM holidays WHERE date = '2026-01-13' AND name = 'LOHRI'").get();`
FACT, schema.js:1024: inside the `if (!lohriExists)` branch it runs `DELETE FROM holidays WHERE date LIKE '2026-%' AND added_by = 'System'` before inserting 10 named 2026 holidays (schema.js:1025-1031).
**HAZARD (INFERENCE):** this is a destructive `DELETE` gated only on a sentinel row, not on a `migration_*_v1` policy flag like every other one-time block in this file. If an operator ever deletes the LOHRI row, the next boot silently wipes every System-attributed 2026 holiday and re-inserts the canned list.
Ordering note (FACT): this block runs at 1021, i.e. **after** `safeAddColumn('holidays','added_by',...)` at 961, so `added_by` exists by then. Correct order.

**(b) `migration_drop_company_from_unique_v1` — schema.js:3129-3220. REBUILDS `salary_computations` AND `day_calculations`.**
FACT, schema.js:3136: gate `SELECT value FROM policy_config WHERE key = 'migration_drop_company_from_unique_v1'`.
FACT, schema.js:3213: flag written on success.
FACT, schema.js:3144-3155: pre-flight aborts if duplicate `(employee_code, month, year)` groups exist; the flag is not set, so it retries next boot.
FACT, schema.js:3173-3196: the rebuild does `ALTER TABLE … RENAME TO <backup>`, then reads the **live** create SQL back out of `sqlite_master` (`SELECT sql FROM sqlite_master WHERE type='table' AND name='<backup>'`), string-replaces the table name and the `UNIQUE(...,company)` clause, `db.exec`s that, then `INSERT INTO <table> SELECT * FROM <backup>`.

**This is the rebuild-after-safeAddColumn hazard the audit asked about. Verdict: NOT a column-dropping hazard, because the rebuild is schema-derived, not hardcoded.** FACT: SQLite's `ALTER TABLE ADD COLUMN` rewrites the stored `sqlite_master.sql`, so by line 3179 the captured DDL already contains `od_days`, `short_leave_days`, `uninformed_absent` (added at 1601-1603) and `cl_days … uninformed_absent_days` (1605-1610). No leave column is lost.

Two real hazards remain in that same block (both INFERENCE from the code at 3173-3196):
- **Index loss.** The block explicitly re-creates the `invalidate_salary_ai_cache` trigger (schema.js:3196-3200) but never re-creates indexes. In SQLite, `ALTER TABLE … RENAME TO` carries indexes over to the renamed (backup) table, so any index on `salary_computations`/`day_calculations` ends up attached to the backup and the new live table has none. Mitigating FACT: `grep "ON day_calculations\|ON salary_computations" schema.js` returns exactly one hit — schema.js:1760, which is the trigger's `ON salary_computations`, not an index. So today there are **no** non-implicit indexes on either table and nothing is actually lost. The hazard is latent: any future `safeCreateIndex` on these tables added *before* line 3129 would be silently dropped on a fresh DB.
- **`INSERT … SELECT *` is column-position-dependent.** Safe here only because the new DDL is derived verbatim from the old one.

**(c) No other gated migration touches leave data.** FACT: the full set of `migration_*` flags in schema.js is — `migration_shift_night_variants_v1` (835/844), `migration_finance_user_role_v1` (904/914), `migration_miss_punch_finance_queue_v1` (934/945), `migration_contractor_flags_v1` (2140/2169), `migration_sales_upload_source_backfill_v1` (2356/2365), `migration_sales_uploads_add_rejected_status_v1` (2383/2392/2444), `migration_tada_schema_v2_done` (2687/2839), `migration_sales_cycle_backfill_v1` (2852/2872), `migration_drop_sales_diwali_ledger_v1` (2896/2903), `migration_sales_master_import_v1` (2920/2944), `migration_sales_structures_backfill_indriyan_v1` (2963/3026), `migration_sales_uploads_is_active_v1` (3052/3103), `migration_drop_company_from_unique_v1` (3136/3213). Only the last touches tables that carry leave columns.
FACT: **no backfill migration exists for the leave system.** There is no gated block that populates `leave_accrual_ledger` from history, seeds `leave_balances` openings, or backfills `cl_days`/`el_days` on existing `salary_computations` rows. The only such tool is an out-of-band script, `backend/scripts/reseed-leave-balances-2026.js` (reads `el_accrual_rate` at its line 391).

### C.4 Ordering sanity
FACT: every leave `safeAddColumn` (1601-1613) sits after its target table's CREATE (day_calculations 226, salary_computations 256, leave_applications 402) and before the only rebuild (3129). No ordering defect found among leave columns.

---

## D. Indexes summary

| index | table | columns | file:line | kind |
|---|---|---|---|---|
| implicit UNIQUE | leave_balances | (employee_id, year, leave_type) | schema.js:105 | UNIQUE |
| idx_leave_transactions_employee | leave_transactions | (employee_code) | schema.js:124 | plain |
| implicit UNIQUE | leave_accrual_ledger | (employee_code, year, month, leave_type) | schema.js:1593 | UNIQUE |
| idx_accrual_ledger_employee | leave_accrual_ledger | (employee_code, year) | schema.js:1596 | plain |
| implicit UNIQUE | compensatory_off_requests | (employee_code, start_date, month, year, company) | schema.js:1564 | UNIQUE |
| idx_comp_off_status | compensatory_off_requests | (finance_status) | schema.js:1567 | plain |
| idx_comp_off_employee | compensatory_off_requests | (employee_code, month, year) | schema.js:1568 | plain |
| implicit UNIQUE | short_leaves | (employee_code, date, leave_type) | schema.js:1647 | UNIQUE |
| idx_short_leaves_employee | short_leaves | (employee_code, calendar_month, calendar_year) | schema.js:1650 | plain |
| idx_short_leaves_date | short_leaves | (date, company) | schema.js:1651 | plain |
| implicit UNIQUE | early_exit_detections | (employee_code, date) | schema.js:1676 | UNIQUE |
| idx_early_exit_det_date | early_exit_detections | (date, company) | schema.js:1679 | plain |
| idx_early_exit_det_status | early_exit_detections | (detection_status) | schema.js:1680 | plain |
| idx_early_exit_det_employee | early_exit_detections | (employee_code, date) | schema.js:1681 | plain |
| idx_early_exit_ded_detection | early_exit_deductions | (early_exit_detection_id) | schema.js:1716 | plain |
| idx_early_exit_ded_employee | early_exit_deductions | (employee_code, payroll_month, payroll_year) | schema.js:1717 | plain |
| idx_early_exit_ded_status | early_exit_deductions | (finance_status) | schema.js:1718 | plain |
| idx_early_exit_audit_ded | early_exit_deduction_audit | (deduction_id) | schema.js:1738 | plain |
| implicit UNIQUE | day_calculations | (employee_code, month, year, company) → narrowed | schema.js:253 / 3129-3220 | UNIQUE |
| implicit UNIQUE | salary_computations | (employee_code, month, year, company) → narrowed | schema.js:289 / 3129-3220 | UNIQUE |

All FACT. Explicitly **absent** (all FACT, 0 grep hits):
- no index on `leave_applications` (any column) — a per-employee or per-status listing is a full scan;
- no index on `leave_balances` beyond the UNIQUE;
- no index on `holidays` — including none on `date`, which is the column every day-calculation lookup filters on;
- no index on `holiday_audit_log`;
- `idx_early_exit_det_employee (employee_code, date)` at schema.js:1681 duplicates the implicit UNIQUE index on `(employee_code, date)` at schema.js:1676 — redundant (OPINION: harmless but dead weight on writes).

---

## E. policy_config leave keys

`policy_config` table: schema.js:529-535 — `key TEXT NOT NULL UNIQUE` (531), `value TEXT NOT NULL` (532), `description TEXT` (533), `updated_at TEXT DEFAULT (datetime('now'))` (534). FACT.

| key | seeded value | schema.js:line | seed mechanism | READ BY |
|---|---|---|---|---|
| `el_accrual_rate` | `'1'` | **632** | bulk array, gated `if (policyCount.cnt === 0)` (schema.js:609) | **`backend/src/services/phase5Features.js:76`** — `const elRate = _getPolicyNumber(db, 'el_accrual_rate', 1);` Also `backend/scripts/reseed-leave-balances-2026.js:391`. FACT. |
| `cl_annual_entitlement` | `'12'` | **633** | bulk array, gated `if (policyCount.cnt === 0)` | **NOT READ ANYWHERE.** FACT — see finding 1. |
| `el_eligibility_days` | `'180'` | **1617** | `insertPolicyIfMissing.run(...)` — idempotent `INSERT OR IGNORE`, runs every boot | **`backend/src/services/phase5Features.js:77`** — `const elEligibilityDays = _getPolicyNumber(db, 'el_eligibility_days', 180);` FACT. |
| `sandwich_rule` | `'0'` | 625 | bulk array, gated | leave-adjacent (absence between holidays); reader out of scope for this part |
| `sunday_grant_threshold` | `'6'` | 623 | bulk array, gated | paid-Sunday grant; also referenced at schema.js:779 |
| `sunday_partial_min` | `'4'` | 624 | bulk array, gated | as above; also schema.js:780 |
| `early_departure_minutes` | `'30'` | 618 | bulk array, gated | gate-pass / early-exit adjacent |

FACT: **no** `sl_*`, `lwp_*`, `od_*`, `comp_off_*` or `short_leave_*` policy key is seeded anywhere. Exhaustive grep `grep -rnoE "'(sl|el|cl|lwp|od|comp_off|short_leave|leave|gate_pass|accrual|uninformed)_[a-z0-9_]+'" backend/src backend/scripts` returns only: `cl_annual_entitlement`, `el_accrual_rate`, `el_eligibility_days` (policy keys) plus column names (`cl_days`, `el_days`, `lwp_days`, `od_days`, `short_leave_days`, `uninformed_absent`, `uninformed_absent_days`, `cl_used`, `el_used`), table names (`leave_applications`, `leave_balances`, `leave_transactions`), and **audit action strings** — `comp_off_applied` (routes/compensatoryOff.js:147), `comp_off_deleted` (routes/compensatoryOff.js:365), `leave_adjustment` (routes/leaves.js:401), `leave_cancel` (routes/leaves.js:227), `leave_correction` (routes/financeAudit.js:600), `short_leave_create` (routes/short-leaves.js:155), `short_leave_cancel` (routes/short-leaves.js:290). All FACT.

FACT: the short-leave monthly quota (2) is hardcoded at `backend/src/routes/short-leaves.js:127` and `:136` — not a policy key, so HR cannot tune it without a deploy.

**Seeding-mechanism hazard (FACT + INFERENCE).** `el_accrual_rate` and `cl_annual_entitlement` live inside the array at schema.js:611-637 which is wrapped in `if (policyCount.cnt === 0)` — FACT, schema.js:608-609 (`const policyCount = db.prepare('SELECT COUNT(*) as cnt FROM policy_config').get(); if (policyCount.cnt === 0) {`). INFERENCE: on any database that already has ≥1 `policy_config` row — which includes every production DB, since later blocks at schema.js:740-744, 751-752, 1617, 2116, 2881 write rows unconditionally on every boot — that entire array is skipped. So on a long-lived DB, `el_accrual_rate` is present only if the DB was created before those later inserts existed. `_getPolicyNumber(db,'el_accrual_rate',1)` falls back to `1` when the row is missing (FACT, phase5Features.js:46-50), so behaviour is unaffected today — but the row is invisible in the Settings/Query tool, so an operator cannot tune it. By contrast `el_eligibility_days` at 1617 uses the idempotent `insertPolicyIfMissing` and is always present.

---

## F. schemaReference.js drift

`backend/src/config/schemaReference.js` is 126 lines and is the English→SQL prompt context sent to the Claude API (FACT, header comment lines 1-5, which explicitly says "Update this file whenever schema.js adds/removes tables or columns").

Drift found (all FACT, comparing schemaReference.js against schema.js):

1. **`day_calculations` is missing all leave-ish migration columns.** schemaReference.js:30-36 lists through `ot_days` and stops. Absent: `od_days` (schema.js:1601), `short_leave_days` (1602), `uninformed_absent` (1603), `holiday_duty_days` (964), `extra_duty_days` (1041), `late_deduction_days` (1037), `date_of_joining` (1055), `is_mid_month_joiner` (1057), `base_entitlement` (1045), `effective_present` (1047), and ~10 more.
2. **`salary_computations` is missing every leave-day column.** schemaReference.js:37-51 lists through `late_coming_deduction` but omits `cl_days`, `el_days`, `lwp_days`, `od_days`, `short_leave_days`, `uninformed_absent_days` (schema.js:1605-1610) and `early_exit_deduction` (1741), `ed_days`/`ed_pay` (990-991), `take_home` (992), `total_payable` (978).
3. **Stale UNIQUE constraints.** schemaReference.js:36 and :51 both document `UNIQUE(employee_code, month, year, company)`, and the join-pattern section (~line 118) documents "(employee_code, month, year, company)". The gated migration at schema.js:3129-3220 drops `company` from both. After that migration runs, the reference is wrong.
4. **Five leave tables are entirely absent from the reference.** `leave_applications`, `leave_transactions`, `leave_accrual_ledger`, `compensatory_off_requests`, `short_leaves` — zero mentions. Only `leave_balances` is documented (schemaReference.js:83-85), and only its four base counters.
5. **`holidays` under-documented.** schemaReference.js:80-81 lists `date, name, type, applicable_to` but omits `is_recurring` (schema.js:69) and the three migration columns `added_by`/`added_at`/`is_active` (schema.js:961-963). `holiday_audit_log` is absent entirely.
6. **`employees` omits leave-relevant fields.** schemaReference.js:15-21 has `date_of_joining` (good) but omits `is_contractor` (schema.js:957), `category` (728), `probation_end_date`/`confirmation_date` (726-727) — all of which gate leave eligibility in `phase5Features.js`.
7. `status_final` legend at schemaReference.js:122 documents `L=Leave` as a single bucket, with no CL/EL/SL/LWP distinction — INFERENCE: an NL query like "how many CL days last month" cannot be answered correctly from this reference alone.

OPINION: items 1, 2 and 4 mean any natural-language question about leave routed through this reference will either fail or silently query the wrong (or a non-existent) column. This is the highest-value low-risk fix in this part of the audit.

---

## G. Findings

1. **`cl_annual_entitlement` is seeded at 12 and is dead — the live CL number is a hardcoded 7 elsewhere. — FACT.**
   `['cl_annual_entitlement', '12', 'CL days per year']` at `backend/src/database/schema.js:633`. A repo-wide grep (`grep -rn "cl_annual_entitlement" --include=*.js --include=*.jsx --include=*.ts --include=*.json --include=*.md .`, excluding node_modules) returns exactly **two** hits: schema.js:633 and `docs/leave-inventory/PROMPT.md:18`. **No code path reads it** — not backend, not frontend, not scripts.
   The number actually used is hardcoded in `backend/src/services/phase5Features.js:27-39`:
   ```js
   function computeClEntitlement(dateOfJoining, year) {
     if (!dateOfJoining) return 7;
     ...
     return Math.max(0, 7 - Math.floor((effectiveMonth - 1) / 2));
   }
   ```
   called at phase5Features.js:224 → `seedClBalance.run(emp.id, year, clEntitlement, clEntitlement)` (:225). The docblock at phase5Features.js:56-58 confirms "7 at Jan for full-year employees, pro-rata for DOJ mid-year".
   So the spec's "7 CL pro-rated by DOJ" **is** what runs; the `12` in policy_config is a stale relic that is visible in the Settings/Query tool and will mislead anyone who edits it expecting a behaviour change. **This is the major finding.** OPINION: either delete the key or make `computeClEntitlement` read it (`_getPolicyNumber(db,'cl_annual_entitlement',7)`) and correct the seeded value to 7 — but note that changing the seed alone fixes nothing on existing DBs (finding 2).

2. **The bulk policy seed only runs on a virgin database. — FACT + INFERENCE.**
   FACT: schema.js:608-609 gates the 27-key array (611-637) behind `if (policyCount.cnt === 0)`. FACT: later blocks (schema.js:740-744, 751-752, 1617, 2116-2125, 2881-2887) insert policy rows unconditionally on every boot. INFERENCE: therefore on any DB that has booted once with those later blocks present, the count is never 0 again, so `el_accrual_rate` / `cl_annual_entitlement` will never be inserted if not already present. Both `el_accrual_rate` consumers use a fallback (phase5Features.js:76 default 1), so no behavioural bug today — but the keys are un-tunable via the UI. `el_eligibility_days` (schema.js:1617) does it correctly.

3. **CL pro-rating uses a 2-month step, coarser than "pro-rated by DOJ". — FACT.**
   `phase5Features.js:38`: `return Math.max(0, 7 - Math.floor((effectiveMonth - 1) / 2));` — a Jan-1 joiner gets 7, Mar 6, May 5, Jul 4, Sep 3, Nov 2. Combined with `phase5Features.js:36` (`const effectiveMonth = dojDay === 1 ? dojMonth : dojMonth + 1;`), joining on the 1st is worth up to a full step more than joining on the 2nd. OPINION: a cliff at the month boundary is a fairness edge case worth confirming against written policy; it is not derivable from any config.

4. **The rebuild-after-`safeAddColumn` hazard the audit hypothesised does NOT bite — the rebuild is schema-derived. — FACT.**
   `migration_drop_company_from_unique_v1` (schema.js:3129-3220) rebuilds `day_calculations`/`salary_computations` *after* the leave `safeAddColumn`s (1601-1610), but at schema.js:3175-3179 and 3187-3191 it reads live DDL from `sqlite_master` rather than using a hardcoded column list, so all seven leave columns survive.

5. **…but that rebuild does not restore indexes, a latent trap. — INFERENCE (mechanism), FACT (that only the trigger is restored).**
   schema.js:3196-3200 re-creates the `invalidate_salary_ai_cache` trigger; nothing re-creates indexes. FACT: today this costs nothing — `grep "ON day_calculations\|ON salary_computations" schema.js` yields one hit (schema.js:1760, the trigger). Any index added on those tables before line 3129 in future would be silently dropped.

6. **The 2026 holiday reseed is a destructive DELETE gated on a sentinel row, not a migration flag. — FACT (code) + INFERENCE (risk).**
   schema.js:1021 gates on a `2026-01-13 / LOHRI` row; schema.js:1024 then runs `DELETE FROM holidays WHERE date LIKE '2026-%' AND added_by = 'System'` and re-inserts 10 canned holidays (1025-1031). All 13 other one-time blocks use the `policy_config` `migration_*_v1` flag pattern. Deleting the LOHRI row re-arms the DELETE on the next boot.

7. **Three of the core leave tables have no UNIQUE constraint. — FACT.**
   `leave_transactions` (schema.js:108-122), `leave_applications` (402-417) and `early_exit_deductions` (1686-1714) contain no UNIQUE line. Nothing at the schema level prevents duplicate transactions, overlapping applications for the same employee/dates, or two deductions against one detection. Contrast `leave_balances` (105), `leave_accrual_ledger` (1593), `compensatory_off_requests` (1564), `short_leaves` (1647), `early_exit_detections` (1676).

8. **`leave_applications` has zero indexes and `holidays` has zero indexes — including none on `holidays.date`. — FACT.**
   `grep "ON leave_applications" schema.js` → 0 hits; `grep "ON holidays" schema.js` → 0 hits. OPINION: the holidays table is small so its scan is cheap; `leave_applications` will degrade as it grows.

9. **Naming and typing are inconsistent across the stage-6 / stage-7 pair. — FACT.**
   `day_calculations.lop_days` (schema.js:246) vs `salary_computations.lwp_days` (1607). `day_calculations.uninformed_absent INTEGER` (1603) vs `salary_computations.uninformed_absent_days REAL` (1610) — different name *and* type affinity. `day_calculations.sl_used` (245) has no `sl_days` counterpart.

10. **`leave_type` is unconstrained free text everywhere. — FACT.**
    No `leave_types` master table exists; `leave_type` is plain `TEXT NOT NULL` with no CHECK on `leave_balances` (100), `leave_transactions` (113), `leave_applications` (406), `leave_accrual_ledger` (1582) and `short_leaves` (1631, default `'short_leave'`). The only enforcement is in a route: `backend/src/routes/short-leaves.js:52-53`. INFERENCE: any direct SQL write or second code path can introduce a variant spelling that silently splits balances, since the UNIQUE keys include `leave_type`.

11. **No schema-level backfill for the leave system exists. — FACT.**
    None of the 13 gated `migration_*` blocks populates `leave_accrual_ledger`, seeds `leave_balances` openings, or backfills `cl_days`/`el_days`/`lwp_days` on historical `salary_computations` rows. The only tool is the manual script `backend/scripts/reseed-leave-balances-2026.js` (reads `el_accrual_rate` at its line 391). INFERENCE: months processed before the Phase-1 columns landed carry `0` in every leave-day column with no automated repair path.

12. **`leave_accrual_ledger` and `compensatory_off_requests` are not in the protected-write payroll set. — FACT.**
    `PAYROLL_TABLES` at `backend/src/services/protectedWrite.js:39-49` contains `leave_balances` (:44) and `leave_transactions` (:45) but not `leave_accrual_ledger`, `leave_applications`, `compensatory_off_requests` or `short_leaves`. OPINION: schema.js:1571-1572 calls the ledger "the canonical audit trail behind the leave_balances aggregate", so it arguably deserves the same DELETE guard as the aggregate it backs.

13. **`leave_accrual_ledger`'s upsert cannot correct a `lapsed` value on re-run. — FACT.**
    The `ON CONFLICT ... DO UPDATE SET` clause in `backend/src/services/phase5Features.js` updates `opening_balance`, `accrued`, `used`, `closing_balance`, `paid_days_this_month`, `paid_days_ytd`, `el_earned_ytd` — it omits `lapsed` and `company`. The INSERT arm hardcodes `lapsed` to the literal `0` in its VALUES list. INFERENCE: re-running accrual for a month that had a lapse silently keeps the stale value.

14. **`schemaReference.js` has drifted badly on leave. — FACT, detailed in §F.**
    Five of six leave tables undocumented; every leave-day column on both stage tables missing; documented UNIQUE constraints are the pre-migration ones. The file's own header (schemaReference.js:1-5) states it must be updated whenever schema.js changes.

15. **The short-leave quota of 2/month is hardcoded in a route, not configurable. — FACT.**
    `backend/src/routes/short-leaves.js:127` and `:136`. No `short_leave_*` policy key exists anywhere (§E).

16. **`employees.date_of_joining` is nullable with no default, and a NULL yields the maximum CL grant. — FACT.**
    Column at schema.js:34 (`date_of_joining TEXT`, no NOT NULL, no default); `phase5Features.js:28` returns the full `7` when it is falsy, and `phase5Features.js:30` (`if (isNaN(doj)) return 7;`) does the same for an unparseable date. INFERENCE: a record with a missing or malformed DOJ is granted a full year of CL regardless of actual join date — a data-quality gap that converts directly into a payroll overstatement.

---

## Agent verification notes

- The agent re-read and spot-verified every cited schema.js line (632, 633, 1601, 1613, 1617, 1543, 1576, 1623, 96, 108, 402, 64, 1002, 124) with a single `sed -n` multi-address pass; all matched their claimed content.
- No files were created, modified or deleted; no server run; no DB touched. Only `grep`/`sed`/`ls`/`wc`/`git log` were used.
- No employee names, phone, PAN, Aadhaar or bank data appear anywhere in the output.

## Provenance note (added by orchestrator, not the agent)

This file was produced by the data-model Explore subagent, which ran without `Write` in its
toolset and handed its report back as text. The orchestrator transcribed it here verbatim.
Independent spot-checks of a sample of these `file:line` references are recorded in the VERIFY
section of `LEAVE_INVENTORY.md`.

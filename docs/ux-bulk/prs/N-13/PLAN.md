# N-13 — New employee created with a salary: finance verifies after (PLAN, Phase 0)

Branch `feat/n13-new-salary-review` off origin/main `892f7f73`. MONEY governance PR. Port 3502.
Owner ruling (16 Oct 2026): an employee created WITH a salary is created exactly as now and payroll is never
blocked; finance gets a "new salary to verify" item; finance/admin mark it verified or raise a correction; the
creator never verifies their own (403, trimmed case-insensitive, admin included). Stage 7 pays exactly what it pays today.

## 1. What the code does today (re-grepped on 892f7f73)

- `backend/src/routes/employees.js:290` `POST /api/employees` (hr+admin, P2-11). Body takes
  `basic, da, hra, conveyance, otherAllowances` — **not** `gross_salary` (it is not destructured; a sent gross is
  silently dropped). If `basic > 0` it inserts one `salary_structures` row dated `date('now')` with those amounts,
  `gross_salary` NULL, flags 0/0/0. No request, no audit row, no notification. `employees.gross_salary` stays NULL.
- Stage 7 (`salaryComputation.js:363`, read only): gross = employees.gross → structure gross → **component sum**.
  So the salary set on create is paid as the component sum from the first Stage 7.
- Frontend: `Employees.jsx` EditEmployeeModal (`isNew`) sends NO salary fields. Creating with a salary is
  **API-only** today (scripts / direct calls). The normal new-joiner path is: create (no salary) → Salary window →
  `PUT /:code/salary` → `salary_change_requests` (old_gross 0) → finance approves (P1-23 no self-approval).
- Other employee-creating paths:
  - `POST /api/employees/bulk-import` (admin only, `employees.js:1065`): writes `employees.gross_salary` AND a
    structure directly. It uses its **own** INSERT/UPSERT, not the POST create code → **out of scope** per the brief.
    Last used 17 Mar 2026 (1 call ever). Register as follow-up N-13b.
  - `routes/import.js:392` / `:933` attendance import auto-create: code/name/dept/company only, no salary → not in scope.
  - `PUT /:code` refuses any gross / component change (P1-25). `PUT /:code/salary` with no structure and
    employees.gross > 0 creates a 2025-01-01 row directly (pre-existing N-19 carve-out; prod count of such rows on
    recent joiners = 0) → not in scope, noted only.

## 2. Production (read-only, HR SQL Console, 17 Oct 2026 — counts only)

| Query | Count |
|---|---|
| Employees created in last 90 days | 59 (33 Active) |
| … of those with a gross / a structure now | 49 / 49 |
| … whose gross came through an **Approved** salary_change_request | 49 |
| … with gross but no approved request | **0** |
| … approved where requester = approver (trimmed, case-insensitive) | 0 |
| … paid in Stage 7 at least once | 48 |
| … with a Pending salary change request now | 2 |
| Structures ever written in the POST-create shape (basic > 0, gross NULL/0, dated the create day) — **all time** | **0** |
| `POST /api/employees` calls ever (usage_logs) | 14 (5 May – 8 Oct 2026) |
| `POST /api/employees/bulk-import` calls ever | 1 (17 Mar 2026) |
| Audit rows on employees for a gross field, last-90-day joiners | 0 |
| Active users by role | admin 1, finance 1, hr 4, viewer 1 |

FACT: the uncontrolled path (create with salary) has never been used in production; every recent joiner's salary
was finance-approved. INFERENCE: this PR closes a hole before anyone uses it; there is nothing to backfill.

## 3. Design (smallest change)

### 3.1 Where the item is stored — new table, own schema helper
`backend/src/database/newSalaryReviewSchema.js` → `ensureNewSalaryReviewSchema(db)` (CREATE TABLE / INDEX IF NOT
EXISTS only; additive). schema.js is NOT touched, so it is called lazily at the top of the service functions
(cheap, idempotent — the `kinds/testApproval.js ensureTable` pattern).

```
new_salary_reviews (
  id INTEGER PK, employee_id INTEGER, employee_code TEXT NOT NULL,
  structure_id INTEGER,              -- the salary_structures row the create wrote
  snapshot_json TEXT NOT NULL,       -- {basic,da,hra,conveyance,other_allowances,component_sum,effective_from}
  created_by TEXT NOT NULL,          -- req.user.username of the creator
  created_at TEXT DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'to_verify'
     CHECK (status IN ('to_verify','verified','correction_raised')),
  decided_by TEXT, decided_at TEXT, note TEXT
)
UNIQUE INDEX on (employee_code) WHERE status='to_verify';  INDEX (status, created_at)
```
No column added to employees / salary_structures / salary_change_requests.

### 3.2 Raising it — `POST /api/employees` (employees.js, ~4 lines)
After the existing structure insert (inside `if (basic > 0)`), call
`raiseNewSalaryReview(db, { employeeId, code, structureId, components, user })` from new
`backend/src/services/newSalaryReview.js`. It writes the review row, one `audit_log` row
(table `new_salary_reviews`, action_type `NEW_SALARY_RAISED`, employee_code, changed_by = creator), and one
notification (role_target `finance`, link `/finance-verification?tab=new-salary`).
- Wrapped in try/catch: a failure is logged (console + Sentry if present) and **never** fails or changes the create
  (ruling: created exactly as now). Response gains one additive key `salaryReview: { id, status: 'to_verify' }`.
- Create with no salary (basic absent / 0) → nothing raised (nothing to verify). Behaviour of what is written
  (employee, structure, leave balances, leave recalc) is byte-identical.
- We do NOT start accepting `gross_salary` on create (Q2).

### 3.3 How finance sees it — reuse Finance Verification (no new page)
New tab after "Bulk batches": **"New salaries (N to verify)"**, finance/admin only (`canFinance`, same gate as P5-01),
deep link `?tab=new-salary`. Component `frontend/src/components/finance/NewSalaryReviewQueue.jsx` on the existing
`ReviewQueue`: chips To verify / Correction raised / Verified (decided ones for 30 days); columns code, name, dept,
company, created by, created on (`fmtDate`), basic / HRA / DA / other and monthly total (`fmtINR`), and a
"Changed since" cell (3.5). Row actions: **Verify** (ConfirmDialog with the ₹ total) and **Raise correction**
(note ≥ 5 chars). An item the viewer created shows both disabled with "another finance or admin user verifies it".
No permissions key / Sidebar / Guard change: the tab lives in the existing `finance-verification` page (as P5-01).
statusMap gains `new_salary_review` (to_verify "To verify" amber, verified green, correction_raised red).
Calls in new `frontend/src/utils/newSalaryReviewApi.js` (api.js untouched); list read sends `fresh`;
mutations invalidate `{ queryKey: ['new-salary-reviews'] }`.

### 3.4 Verify / correction flow — new `backend/src/routes/newSalaryReview.js`, mounted
`app.use('/api/new-salary-reviews', requireAuth, …)` (one line in server.js).
- `GET /` — hr/finance/admin 200 (`?status=`, `?sinceDays=30`); others 403.
- `PUT /:id/verify` — finance/admin; reviewer = `created_by` (trimmed, case-insensitive) → 403 `SELF_APPROVAL`
  (admin included); not `to_verify` → 409; else status `verified`, decided_by/at, audit `NEW_SALARY_VERIFIED`.
  Conditional UPDATE `… WHERE id=? AND status='to_verify'` so a double click gives one 200 + one 409.
- `PUT /:id/correction` — finance/admin, same self + 409 rules, note ≥ 5 → 400 otherwise; status
  `correction_raised`, note stored, audit `NEW_SALARY_CORRECTION`, notification to `hr` (link to the employee).
  **Money is not moved.** HR fixes it through the normal Salary window → salary_change_request → finance approves
  (existing P1-23 / N-19 path). The item stays `correction_raised` as history (Q4).
- No route writes salary_structures, employees or salary_computations. Stage 7 and finalise never read the table.

### 3.5 Salary changed again before verification
Any later change already goes through `salary_change_requests` (PUT /:code/salary). Recommended: **no write hook**
(salary-input.js untouched). The list joins, at read time, the newest salary_change_request for that employee created
after the review: "Change request ₹X → ₹Y — Pending / Approved by <user>". The item stays open; finance still
verifies or corrects what the create wrote (the audit question "was the starting salary right" is separate from
"is the new one right"). Alternative in Q5.

### 3.6 Backfill — none
0 structures ever written by the create path; 49/49 recent joiners' salaries were finance-approved (0 self). Nothing
to backfill (Q6).

## 4. Files (owned)
New: `backend/src/database/newSalaryReviewSchema.js`, `backend/src/services/newSalaryReview.js`,
`backend/src/routes/newSalaryReview.js`, `backend/src/__tests__/newSalaryReview.test.js`,
`frontend/src/components/finance/NewSalaryReviewQueue.jsx`, `frontend/src/utils/newSalaryReviewApi.js`,
`backend/scripts/new-salary-review-check.py`.
Edited: `backend/src/routes/employees.js` (POST / only, ~4 lines + require), `backend/server.js` (1 mount line),
`frontend/src/pages/FinanceVerification.jsx` (tab + deep link + count query), `frontend/src/utils/statusMap.js`.

**Not touched:** salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, salary-input.js,
Stage 7 register, ED finance review, loans, bulk engine, Employees.jsx (UI create sends no salary), bulk-import,
import.js, api.js, permissions.js, Sidebar, App.jsx.

## 5. Tests
`newSalaryReview.test.js` (real JWTs, harness used by bulkApproval.test.js):
create with components → employee + structure rows identical to base, one review `to_verify`, one audit row, one
finance notification; create without salary → no review; create response still 200 when the review insert throws
(forced) and the structure is still written; GET role matrix (hr/finance/admin 200, viewer/supervisor/employee 403);
verify by finance 200; admin creator → admin verify 403, " ADMIN " variant 403; finance creator (if possible via
admin-only? no — hr+admin create) covered by admin; correction note < 5 → 400; verify after verify → 409; concurrent
double verify → one 200 + one 409; correction → hr notification, no salary row changed; "changed since" join shows a
later request; **Stage 7**: compute for a joiner with an open review == compute with the review row deleted
(net/gross identical) — payroll not blocked. Then full jest under `flock /tmp/jest.lock`.
Drift query on the scratch DB after compute → 0.

## 6. Verification (browser)
`backend/scripts/new-salary-review-check.py` (Chromium, built dist, scratch DB, fictional T13xx codes, port 3502,
server restarted per role): admin creates T1301 with components via API → finance sees "New salaries (1 to verify)",
row ₹ total, Verify → DB verified + audit; admin creates T1302 → admin sees own row disabled + API 403; finance
raises correction (short note refused) → hr notification; hr opening Finance Verification: no tab, 0 API ≥ 400;
390 px no horizontal scroll; 0 page errors. `--base` on 892f7f73: no tab, no review row after create (must FAIL).

## 7. Risks
- POST /employees is not one transaction today; the review is written after the structure insert. A crash between
  them leaves an employee with salary and no item — accepted (ruling says creation must not change); logged.
- Read-time "changed since" join relies on `salary_change_requests.employee_code` + `created_at` ordering.
- Only 1 finance + 1 admin user exist: an admin-created item can only be verified by the finance user, and vice versa
  is impossible (finance cannot create employees). Fine, but if the finance user is away items wait (payroll not blocked).
- Lazy schema: the table appears on first create / first list read, not at boot.

## 8. Questions (recommended answer in brackets)
- **Q1** Trigger = POST /employees writes a salary structure (basic > 0). [Yes — that is the only "salary on create" the route stores.]
- **Q2** Start accepting `gross_salary` on create? [No — today it is dropped; keeping it dropped is "exactly as now". Record as a fact in the PROGRESS entry.]
- **Q3** Bulk-import (admin, own INSERT, gross direct) — out of scope since it does not use the create function. [Yes, out of scope; register N-13b "bulk-import writes gross with no review" — last used Mar 2026.]
- **Q4** "Raise correction" = note to HR + status, money unchanged; HR fixes via the normal Salary → request path. [Yes. Finance raising the change request itself would need a second finance/admin to approve it and there is only one of each.]
- **Q5** Salary changed again before verification: keep the item open and show the later request read-time (no hook in salary-input.js). [Yes. Alternative: auto-close as "superseded" when finance approves a later request — needs an edit in salary-input.js approve; not recommended.]
- **Q6** Backfill existing employees? [No — 0 rows ever created by this path; 49/49 recent joiners were finance-approved.]
- **Q7** Surface = new last tab in Finance Verification, finance/admin only, `?tab=new-salary`. [Yes — reuse, no new page/permission key. HR sees nothing new except the correction notification.]
- **Q8** GET list role gate: hr/finance/admin 200, others 403. [Yes — HR can open the page; read-only.]
- **Q9** Routes in a new file + one mount line in server.js (instead of adding to salary-input.js / employees.js). [Yes — avoids conflicts with other money PRs in salary-input.js and the `/:code` route order in employees.js.]
- **Q10** Review insert failure never fails the create (logged only). [Yes — ruling: create exactly as now, payroll never blocked.]

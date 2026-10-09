# Loans programme: progress tracker

Spec: [`SPEC.md`](SPEC.md). Update this file **after every step** of every loan PR, so that
after a context compaction or a new session there is a file to read and build from.

## RESUME (read this first)

- **As of:** 2026-10-09.
- **Current state:** P1 (#48), P2 (#49), P3 (#50), Loans PR-0 (#51), PR-1 (#52) and PR-2 (#53) are merged.
  PR-1 is verified on production: 6 tables, `loan_repayments` is a view, 17 flag + `loan%` keys, loans = 0,
  drift still the 1 known row. Loans PR-3 (API) is open on `feat/loans-pr3`, waiting for review.
- **Next PR:** Loans PR-4 (screens), branch `feat/loans-pr4`, after PR-3 is merged and its check below passes.
  PR-4 rebuilds `frontend/src/utils/api.js` L157–170 and `Loans.jsx` on the PR-3 API (list in "Loans PR-3" below).
- **Blockers:**
  - Loans PR-3 review and merge, then the "Loans PR-3 check" below.
  - Finance is checking the 35 re-held rows that were released to be paid, against what was
    actually paid. (There are 54 re-held rows in all: 35 released to be paid, 17 with notes
    saying already paid outside the app, 2 with nothing payable.)
  - HR is confirming the 98 Active employees who carry an exit date.
- **Disbursement is switched OFF** (`policy_config.loans_disbursement_enabled = '0'`, Loans PR-3). Loans can be
  raised, approved, rejected and cancelled, but no money can be recorded as paid out until the cutover step below.
- **HR data gap that will block borrowers (production, 9 Oct 2026):** 148 Active plant employees have no
  date of joining (47 Permanent, 11 SILP, 3 Worker) and 23 Active Permanent have no gross. The engine
  refuses them (`SERVICE_UNKNOWN`, `GROSS_UNKNOWN`) and does not guess. HR should backfill before the pilot.
- **Waiting on the owner:**
  1. Review and merge Loans PR-3.
  2. The accounts Excel of the 10–30 running loans (needed for PR-10).
  3. Labour consultant: what the 50% cap is measured on; whether the 2-working-day exit rule
     applies (SPEC §12, Q1–Q2).
  4. CA: the ₹20,000 perquisite threshold; TDS on write-offs (Q3–Q4).
  5. Whether advance recovery should be capped (Q5, after the consultant).
  6. Whether employees use the portal (Q6).
- **Owner and coordinator rulings already locked:** see SPEC §3 and §12.2. In short:
  - The admin approves every loan, defer, restructure and write-off.
  - Finance records disbursements and receipts only. HR raises.
  - Nobody approves their own request, and there is no backup approver.
  - Loans are interest-free.
  - Loan close runs on the 13th (IST), after the month's payroll is computed.
  - Settled at exit is automatic.
  - Shortfall extension is at most 3 months.

## PR table

| ID | Branch | Status | PR # | Merged | Post-merge check |
| --- | --- | --- | --- | --- | --- |
| P1 | `fix/hold-release-survives-recompute` | Merged | #48 | 2026-10-09 | planner |
| P2 | `fix/stage6-no-reactivate-leavers` | Merged | #49 | 2026-10-09 | planner |
| P3 | `fix/retire-manual-deductions-endpoint` | Merged | #50 | 2026-10-09 | planner |
| Loans PR-0 | `docs/loans-spec` | Merged | #51 | 2026-10-09 | n/a (docs only) |
| Loans PR-1 | `feat/loans-pr1` | Merged | #52 | 2026-10-09 | verified (planner) |
| Loans PR-2 | `feat/loans-pr2` | Merged | #53 | 2026-10-09 | none (engine not called yet) |
| Loans PR-3 | `feat/loans-pr3` | Open | see GitHub | — | "Loans PR-3 check" below |
| Loans PR-4 | `feat/loans-pr4` | Not started | — | — | — |
| Loans PR-5 | `feat/loans-pr5` | Not started | — | — | — |
| Loans PR-6 | `feat/loans-pr6` | Not started | — | — | — |
| Loans PR-7 | `feat/loans-pr7` | Not started | — | — | — |
| Loans PR-8 | `feat/loans-pr8` | Not started | — | — | — |
| Loans PR-9 | `feat/loans-pr9` | Not started | — | — | — |
| Loans PR-10 | `feat/loans-pr10` | Not started | — | — | — |
| PR-F | `feat/loans-prF` | Not started (after pilot) | — | — | — |

Milestones: **plant pilot** after PR-7 · **plant go-live** after PR-9 · **sales go-live** after
PR-8 + PR-9 · **cutover** in the payroll month after the pilot (PR-10).

## Loans PR-1 rulings (coordinator, 9 Oct 2026)

- `loan_repayments` becomes a zero-row VIEW (old 13 columns) until every reader moves off it.
  Owners: Stage 7 `getLoanDeductions` → PR-5; sales `getLoanRecovery` → PR-8; `loanService.js` →
  PR-2/PR-3; `routes/loans.js`, `employeePortal.js`, `ai.js`, `config/schemaReference.js` and the
  `sqlConsole.js` snippet → PR-3. Drop it with `DROP VIEW`, never `DROP TABLE`.
- Mark Left on a requested / approved loan: exit flag only, status unchanged, no auto-reject.
  PR-3 must refuse approve / disburse on a flagged loan.
- PR-1 sets `recover_at_exit`; PR-7 owns the actual recovery.
- No CHECK on instalment `origin`.
- `loan_events` is append-only (triggers). Deduction `reversed` = a provisional row superseded
  before the close only; a posted row is never edited, its correction is a new opposite entry (PR-6).
- `loan_closes` is unique per month + year + payroll.
- No `routes/loans.js` edit in PR-1: the old create path returns a raw SQLite 400 until PR-3.
- Mark Left role guard: its own small PR later (P4).
- **For PR-2:** "Sales" in `loan_eligible_employment_types` means sales-master borrowers only
  (`borrower_type='sales'`); plant-master rows typed "Sales" (190 active) are refused.
- Signed-agreement file storage stays open for PR-3 / PR-4.

### Loans PR-1 check (read-only, after deploy)

```sql
SELECT name, type FROM sqlite_master
 WHERE name IN ('loans','loan_instalments','loan_deductions','loan_receipts',
                'loan_closes','loan_events','loan_repayments') ORDER BY name;
-- expect 6 tables, loan_repayments = view
SELECT COUNT(*) FROM policy_config
 WHERE key = 'migration_loans_schema_v2_done' OR key LIKE 'loan%';     -- expect 17
SELECT (SELECT COUNT(*) FROM loans), (SELECT COUNT(*) FROM loan_repayments);  -- 0, 0
```
Then checks 1–3 below (drift = the 1 known row; component-short = the 5 known rows).

## Loans PR-2 rulings (coordinator, 9 Oct 2026)

1. Ledger functions in PR-2 are **building blocks only** (`recordProvisional`, `clearProvisional`,
   `postDeduction`, `moveInstalmentToEnd`). PR-5 / PR-6 own the loops, salary reads, closes, sweep and cron.
2. First EMI month = the month after the disbursement month, skipping any month already closed for that
   payroll. Later on request; never earlier.
3. Extension limit = instalments added automatically (origin shortfall / no_salary / held) since the latest
   restructure; approved defers do not count. At 3, nothing is added: the amount stays in the balance as
   "uncovered", an `extension_limit_reached` event is written and a structured alert
   (`type: 'loan_extension_limit_reached'`, `audience: 'finance'`, loan, employee, company, uncovered amount)
   is returned for PR-6 to notify. A receipt clears the uncovered amount first; a restructure folds it in.
4. Refuse if the employment type contains "contract" OR `is_contractor = 1`.
5. Missing DOJ / gross → `SERVICE_UNKNOWN` / `GROSS_UNKNOWN`; no guessing.
6. Top-up: recorded when the admin approves the restructure, with its own mode, reference, date and a fresh
   signed agreement; `disbursed_amount` and the balance rise; `principal_amount` keeps the original.
7. Receipt numbers `LR/<Indian FY>/<5-digit serial>`, e.g. `LR/2026-27/00001`.
8. Disbursement by the loan's requester is refused; a receipt by the requester is allowed with a warning.
9. `loanService.js` is left untouched in PR-2.
10. No `schema.js` edit in PR-2. Defer / restructure / write-off functions take both requester and approver.
11. Instalment rows are written at disbursement; approval stores the EMI and returns a preview.
12. No withdrawal state for an approved-not-disbursed loan in PR-2 (PR-3 item below).
13. Earned base (what the 50% cap is measured on) = plant `gross_earned − ot_pay − holiday_duty_pay`, sales
    `gross_earned`. **Dependency:** it is defined only in `services/loans/headroom.js`
    `EARNED_BASE_DEFINITION` and read only through `earnedBase()`. If the labour consultant (SPEC §12 Q1)
    redefines the cap base, change that table and nothing else.

### Carried to PR-3 (all done in Loans PR-3 — see its rulings below)

- **Pending-request storage.** Defer, restructure and write-off requests need somewhere to wait for the
  admin. `loan_events` has no payload column, so PR-3 decides storage (probably a small `loan_requests`
  table, which means a `schema.js` edit and a plan for it).
- **Cancel an approved-not-disbursed loan:** admin only, with a reason and a `loan_events` row.
- Delete `loanService.js` and rebuild `routes/loans.js` on `services/loans/`.
- Routes pass `normalizeRole(req.user.role)` into the engine. The engine must not require `routes/auth.js`,
  because that throws at load without `JWT_SECRET`.
- Map engine refusal codes to HTTP statuses: `ROLE_NOT_ALLOWED` / `SELF_*` → 403; `*_NOT_FOUND` → 404;
  `NOT_ELIGIBLE` and the rest → 400; `CONCURRENT_CHANGE` → 409.

## Loans PR-3 rulings (coordinator, 9 Oct 2026)

Plan approved with a wider file list: `schema.js` (`loan_requests` inside `loansSchemaV2Ddl` + one seed line),
`ai.js`, `config/schemaReference.js`, the `sqlConsole.js` snippet, `loanService.js` deleted, small engine edits
(`requests.js` new; `cancelLoan`; `validatePolicyValue`; `approved → rejected`), `permissions.js`.

- **A. Disbursement gate.** `policy_config.loans_disbursement_enabled`, seeded `'0'` (INSERT OR IGNORE). While it
  is not exactly `'1'`, `POST /api/loans/:id/disburse` and the approval of a restructure **top-up** refuse with
  **409 `DISBURSEMENT_DISABLED`**. `PUT /api/loans/policy` cannot set it (`POLICY_KEY_LOCKED`); it is not one of
  the 16 editable keys. Raise / approve / reject / cancel / change requests all stay allowed.
- **B. The admin cannot raise.** `POST /api/loans` and `POST /api/loans/:id/requests` by an admin →
  **403 `ADMIN_CANNOT_RAISE`, "HR raises loans; admin approves"**. Enforced in the route and in
  `requests.js requestChange`; the engine's `checkActor('request')` still lists admin (PR-2 tests, PR-10 import), so
  the self-approval guard stays as the backstop.
- Q1 `loan_requests` lives in `schema.js` inside `loansSchemaV2Ddl` (re-asserted every boot once migrated).
- Q2 one pending change request per loan (partial unique index → 409 `REQUEST_ALREADY_PENDING`).
- Q3 admin cancel of an approved-not-disbursed loan → status `rejected`, event `cancelled`, decision reason
  "Cancelled after approval: …". No `cancelled` state (CHECK). A requester cannot withdraw a requested loan.
- Q4 signed agreement = `agreementRef`, free text 3–200 characters, stored in `agreement_file_path`; required before
  disbursement and for a top-up. **No file upload** — storage is decided with the DMS question before PR-4.
- Q5 a top-up's mode / reference / date / agreementRef come in the admin's approve call.
- Q6 sales borrowers refused (`SALES_LOANS_NOT_YET_ENABLED`) until PR-8.
- Q8 `/deductions`, `/monthly-recovery/:m/:y` → 410, replaced by `GET /due`. Q9 `PUT /:id/approve|reject` kept,
  `PUT /:id/close` → 410 (with `process-deductions`, `recover`, `skip`).
- Q10 `GET/PUT /policy` in PR-3 (admin writes; one `audit_log` row per changed key). Q11 reads: admin, hr,
  finance, viewer; supervisor / employee 403. Q12 the requester may withdraw their own pending change request.
  Q13 receipts never pass `allowProvisional` (PR-6 decides). Q14 `users.allowed_companies` honoured.
  Q15 notifications: admin on every new loan / change request (URGENT for Emergency / medical); finance + hr on
  approvals; hr on rejection / cancel. Written directly to `notifications` (the scheduler helper de-duplicates
  across roles).

### Cutover and SOP items from Loans PR-3

- **Cutover (after PR-6 is merged and verified, never before):** the owner switches disbursement on with one
  deliberate write: `UPDATE policy_config SET value = '1' WHERE key = 'loans_disbursement_enabled'` — through the
  SQL Console write flow (preview → confirm), handed over in the seven-field form. There is no screen for it.
- **SOP:** HR (or finance) raises every loan and every defer / restructure / write-off request. The admin only
  approves or rejects, and cannot raise — so nothing ever waits on an approver who does not exist.
- **SOP:** the person who requested a loan cannot record its disbursement (finance must be a different user).
- **SOP:** the signed agreement's reference (DMS number or physical file number) is entered at disbursement.

### For PR-4 (screens): what PR-3 broke on purpose

`frontend/src/utils/api.js` L157–170 → `pages/Loans.jsx`:
- `createLoan` sends the old body (`principalAmount`, `tenureMonths`, `loanType: 'Personal Loan'`) → 400. New body:
  `{employeeCode, company, loanType, principal, tenure, reason}` (plant only).
- `approveLoan` / `rejectLoan` keep their paths (admin only; reject needs `reason`).
- `closeLoan`, `processLoanDeductions`, `recoverLoanInstallment`, `skipLoanInstallment`, `getLoanDeductions`,
  `getMonthlyLoanRecovery` → 410. Replacements: write-off request, loan close (PR-6), `POST /:id/receipts`,
  defer request, `GET /due`.
- `getLoans` / `getLoanStats` / `getLoanTypes` → 200 with new shapes (lower-case states; stats keys changed).
- `Employees.jsx` Loans tab still renders (`paidEmis`, `totalRecovered` kept; badges go grey for lower-case states).
  Mark Left dialog text ("close all active loans") is stale → PR-7.
- New for the screens: `GET /queue`, `GET /:id` (with `approvalCheck`, `reconciliation`), `GET /:id/statement`,
  `POST /eligibility`, `POST /:id/disburse|receipts|cancel|requests`, `POST /requests/:rid/approve|reject|withdraw`,
  `GET|PUT /policy`. Hide raise buttons for the admin (`ADMIN_CANNOT_RAISE`) and the disburse button while
  `stats.disbursementEnabled` is false.

### Loans PR-3 check (read-only, after deploy)

```sql
SELECT name, type FROM sqlite_master WHERE name IN ('loan_requests', 'uniq_loan_requests_one_pending');  -- table, index
SELECT value FROM policy_config WHERE key = 'loans_disbursement_enabled';                                -- '0'
SELECT COUNT(*) FROM policy_config WHERE key = 'migration_loans_schema_v2_done' OR key LIKE 'loan%';     -- 18 (17 + gate)
SELECT (SELECT COUNT(*) FROM loans), (SELECT COUNT(*) FROM loan_requests);                              -- 0, 0
```
Then drift check 1 (still the 1 known row). No salary code changed.

### Notes for PR-5 / PR-6

- Stage 7 uses `planLoanDeduction()` + `computeHeadroom()` + `earnedBase()` / `priorDeductions()`, then
  `recordProvisional()` per loan + month + payroll. A posted month returns `POSTED_FROZEN` with the posted
  amount, which the re-run must deduct exactly.
- An employee skipped on a re-run → `clearProvisional()` (the row becomes `reversed`).
- The close must **insert its `loan_closes` row before posting**: the engine never places a new last
  instalment in a month that is already closed, so writing the row first puts shortfalls after month M.
- No salary row in a computed payroll → `moveInstalmentToEnd(reason 'no_salary')`. Held past the wait →
  `moveInstalmentToEnd(reason 'held')`, which returns `staleDeductions` (the salary row is then stale, K28).
- Every mutator returns `alerts[]`; PR-6 sends them.

## Post-merge checks

Run after every PR that touches salary, and after every deploy. Both queries are read-only;
run them through the HR SQL Console connector. Report counts only, never names.

### 1. Drift sanity

The employee column is `employee_code`, not `code`.

```sql
SELECT month, year, company, COUNT(*) AS rows_drifting
FROM salary_computations
WHERE ABS(net_salary - (gross_earned - total_deductions)) > 1
GROUP BY month, year, company
ORDER BY year, month;
```

**Baseline (production, 9 Oct 2026):** 1 row, 2/2026. This is the acknowledged deliberate
`Math.max(0, …)` floor recorded in CLAUDE.md (2026-05-06). Any **new** row fails the check:
stop and report.

### 2. Deduction components

Checks that `total_deductions` equals the sum of its components.

```sql
SELECT month, year, company, COUNT(*) AS rows_off,
       ROUND(SUM((COALESCE(pf_employee,0) + COALESCE(esi_employee,0) + COALESCE(professional_tax,0)
         + COALESCE(tds,0) + COALESCE(advance_recovery,0) + COALESCE(lop_deduction,0)
         + COALESCE(other_deductions,0) + COALESCE(loan_recovery,0)
         + COALESCE(late_coming_deduction,0) + COALESCE(early_exit_deduction,0))
         - total_deductions), 2) AS components_minus_total
FROM salary_computations
WHERE ABS(total_deductions - (COALESCE(pf_employee,0) + COALESCE(esi_employee,0)
         + COALESCE(professional_tax,0) + COALESCE(tds,0) + COALESCE(advance_recovery,0)
         + COALESCE(lop_deduction,0) + COALESCE(other_deductions,0) + COALESCE(loan_recovery,0)
         + COALESCE(late_coming_deduction,0) + COALESCE(early_exit_deduction,0))) > 1
GROUP BY month, year, company
ORDER BY year, month;
```

**Baseline (production, 9 Oct 2026): 5 component-short rows.** In each, `total_deductions` is
below the component sum, because the total was capped at gross earned
(`DEDUCTIONS_EXCEED_EARNINGS`):

| Month | Rows | Components − total |
| --- | --- | --- |
| 3/2026 | 2 | ₹203.23 |
| 4/2026 | 1 | ₹2,900.00 |
| 5/2026 | 2 | ₹225.80 |

Any row outside this baseline fails the check. From Loans PR-5 onward, `loan_recovery` must
never make a row component-short: the loan takes only the headroom, so total deductions stay
at or below the cap without being clipped.

### 3. Unrelated totals unchanged

For each salary-touching PR, record one plant month total and one sales month total with no
loans, before and after. They must be identical.

```sql
SELECT COUNT(*), ROUND(SUM(net_salary),2), ROUND(SUM(total_deductions),2)
FROM salary_computations WHERE month = ? AND year = ?;

SELECT COUNT(*), ROUND(SUM(net_salary),2), ROUND(SUM(total_deductions),2)
FROM sales_salary_computations WHERE month = ? AND year = ?;
```

## Update log

| Date | PR | Step | Note |
| --- | --- | --- | --- |
| 2026-10-09 | Loans PR-0 | Spec + tracker written | Plan approved by the coordinator. 5 source-plan conflicts ruled (SPEC §12.2). 10 stale code references corrected (SPEC §12.3). Baselines for checks 1 and 2 confirmed read-only on production. |
| 2026-10-09 | Loans PR-1 | Plan approved | Production read-only: loans 0, loan_repayments 0, no indexes, no loan policy keys. 11 rulings recorded above. |
| 2026-10-09 | Loans PR-1 | Rebased onto `b738bea` | #48–#51 merged; line numbers unchanged in schema.js / employees.js. Baseline 19 suites / 421 tests. |
| 2026-10-09 | Loans PR-1 | Schema + Mark Left built | 2 commits; suite 421 → 453, 3 clean runs. Deploy simulation (origin/main schema → new code) rebuilds cleanly; real Stage 7 with a live loan: loan_recovery 0, drift 0, component-short 0. |
| 2026-10-09 | Loans PR-1 | Review fix: Mark Left guard | Loan block runs only when `migration_loans_schema_v2_done` is set; otherwise skip + warn + audit remark, Mark Left still 200. New test proves 500 → 200. Suite 454. |
| 2026-10-09 | Loans PR-2 | Plan approved | 13 rulings recorded above. Production read-only: 148 Active plant without DOJ, 23 Active Permanent without gross, 190 Active plant rows typed Sales, 73 Contract with is_contractor = 0, 2 Worker with is_contractor = 1. |
| 2026-10-09 | Loans PR-3 | Plan approved | Rulings A (disbursement gate) and B (admin cannot raise) added; Q1–Q16 defaults approved. |
| 2026-10-09 | Loans PR-3 | API built | `routes/loans.js` on the engine, `requests.js`, `loan_requests`, gate; `loanService.js` deleted. Suite 588 → 667 (31 suites). HTTP simulation on the real server: 55/55. |
| 2026-10-09 | Loans PR-2 | Engine built | `services/loans/` (15 files), 7 new suites, simulation script. Suite 454 → 588 (3 clean runs). Simulation: 13 loans × 12 months reconcile exactly, exit 0. |

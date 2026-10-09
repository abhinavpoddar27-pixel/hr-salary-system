# Loans programme: progress tracker

Spec: [`SPEC.md`](SPEC.md). Update this file **after every step** of every loan PR, so that
after a context compaction or a new session there is a file to read and build from.

## RESUME (read this first)

- **As of:** 2026-10-09.
- **Current state:** P1 (#48), P2 (#49), P3 (#50), Loans PR-0 (#51) and Loans PR-1 (#52) are merged.
  PR-1 is verified on production: 6 tables, `loan_repayments` is a view, 17 flag + `loan%` keys, loans = 0,
  drift still the 1 known row. Loans PR-2 (engine) is open on `feat/loans-pr2`, waiting for review.
- **Next PR:** Loans PR-3 (API), branch `feat/loans-pr3`, after PR-2 is merged. Read "Carried to PR-3" below first.
- **Blockers:**
  - Loans PR-2 review and merge (no post-merge check: nothing calls the engine yet).
  - Finance is checking the 35 re-held rows that were released to be paid, against what was
    actually paid. (There are 54 re-held rows in all: 35 released to be paid, 17 with notes
    saying already paid outside the app, 2 with nothing payable.)
  - HR is confirming the 98 Active employees who carry an exit date.
- **Do not create a loan through the old `POST /api/loans`:** it fails against the new schema (raw SQLite
  400) until PR-3 rebuilds the routes on `services/loans/`.
- **HR data gap that will block borrowers (production, 9 Oct 2026):** 148 Active plant employees have no
  date of joining (47 Permanent, 11 SILP, 3 Worker) and 23 Active Permanent have no gross. The engine
  refuses them (`SERVICE_UNKNOWN`, `GROSS_UNKNOWN`) and does not guess. HR should backfill before the pilot.
- **Waiting on the owner:**
  1. Review and merge Loans PR-2.
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
| Loans PR-2 | `feat/loans-pr2` | Open | see GitHub | — | none (engine not called yet) |
| Loans PR-3 | `feat/loans-pr3` | Not started | — | — | — |
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

### Carried to PR-3

- **Pending-request storage.** Defer, restructure and write-off requests need somewhere to wait for the
  admin. `loan_events` has no payload column, so PR-3 decides storage (probably a small `loan_requests`
  table, which means a `schema.js` edit and a plan for it).
- **Cancel an approved-not-disbursed loan:** admin only, with a reason and a `loan_events` row.
- Delete `loanService.js` and rebuild `routes/loans.js` on `services/loans/`.
- Routes pass `normalizeRole(req.user.role)` into the engine. The engine must not require `routes/auth.js`,
  because that throws at load without `JWT_SECRET`.
- Map engine refusal codes to HTTP statuses: `ROLE_NOT_ALLOWED` / `SELF_*` → 403; `*_NOT_FOUND` → 404;
  `NOT_ELIGIBLE` and the rest → 400; `CONCURRENT_CHANGE` → 409.

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
| 2026-10-09 | Loans PR-2 | Engine built | `services/loans/` (15 files), 7 new suites, simulation script. Suite 454 → 588 (3 clean runs). Simulation: 13 loans × 12 months reconcile exactly, exit 0. |

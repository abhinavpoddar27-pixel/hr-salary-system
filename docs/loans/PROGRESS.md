# Loans programme: progress tracker

Spec: [`SPEC.md`](SPEC.md). Update this file **after every step** of every loan PR, so that
after a context compaction or a new session there is a file to read and build from.

## RESUME (read this first)

- **As of:** 2026-10-10.
- **Current state:** P1–P3 and Loans PR-0 … PR-6 (#48–#54, #56, #58, #61) are merged. PR-5 verified on production (gate '0',
  loans 0, loan_deductions 0, no salary row with loan_recovery, drift = 1 known row, component-short = 5 known rows).
  Loans PR-7 (exit recovery, #63) and Loans PR-6b (close screen, reversal, Mark Left outstanding, #64) are merged
  (10 Oct 2026). Loans PR-8 (sales borrowers) is open on `feat/loans-pr8`, waiting for review.
- **Next PR:** plant pilot; sales go-live after PR-8 + PR-9.
- **Blockers:**
  - The PR-6 check below (nil loan impact: the 13 Oct run writes nothing); then the PR-7 check.
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
  1. Review and merge Loans PR-4.
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
| Loans PR-3 | `feat/loans-pr3` | Merged | #54 | 2026-10-09 | verified (planner) |
| Loans PR-4 | `feat/loans-pr4` | Merged | #56 | 2026-10-10 | browser look on Railway preview |
| Loans PR-5 | `feat/loans-pr5` | Merged | #58 | 2026-10-10 | verified (planner) |
| Loans PR-6 | `feat/loans-pr6` | Merged | #61 | 2026-10-10 | verified (planner) |
| Loans PR-6b | `feat/loans-pr6b` | Merged | #64 | 2026-10-10 | verified (planner) |
| Loans PR-7 | `feat/loans-pr7` | Merged | #63 | 2026-10-10 | verified (planner) |
| Loans PR-8 | `feat/loans-pr8` | Open | see GitHub | — | PR-8 check below + checks 1–3 |
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

## Loans PR-4 rulings (coordinator, 9 Oct 2026)

Plan approved with defaults Q1–Q10, Q12: detail is a route `/loans/:id`; `/due` names joined on screen; no Held tile until
PR-6; approval history shown as averages + load % (per-month table would need a backend addition); `LOAN_COMPANIES` mirrors
`VALID_COMPANIES`; modes = Bank transfer / Cheque / Cash (payout), Cash / Bank transfer / Cheque / UPI (receipt); agreement is
a text reference; admin raise buttons hidden; `loansRead` + admin badge in the sidebar; the Playwright check is committed;
optional later first-EMI month at disbursement. **Q11 changed:** the Mark Left dialog text is fixed in PR-4 (text only).
Screens for the owner: `docs/loans/screens/pr4/`. Repeat the browser check: `python3 backend/scripts/loans-ui-browser-check.py`.

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

## Loans PR-5 rulings (planner, 10 Oct 2026)

- **Q1:** plant earned base for the 50% cap = `gross_earned` (`minus: []`). Plant `gross_earned` never contained OT or
  holiday duty (production Jan–Sep 2026: 428 / 428 such rows), so the PR-2 formula subtracted them twice. Own commit;
  it also corrects the PR-4 approval screen's 3-month load %.
- **Q2:** diff, not clear-then-rewrite: same end state, and a re-run writes no loan events (tested: event count stable).
- **Q3:** an employee Stage 7 skips on a re-run keeps its old salary row (Stage 7 has never deleted one); its provisional
  loan rows are reversed and the row is reported in `loans.staleRows` + `console.warn LOAN STALE ROW <code> <M>/<Y>`.
- **Q4–Q15 defaults:** posted month frozen at the posted amount + `unborne` alert (opposite entry is PR-6); held salary
  recorded provisional like any other (PR-6 reads `salary_held` at close); actor `system`; only the instalment due exactly
  in M (lowest sequence); amount also capped at `remaining_balance`; frozen first, then oldest loan id; match by employee
  code only; schema not migrated → ₹0 + warning, any other loan error fails that employee; `recover_at_exit` loans deduct
  only their due instalment (exit recovery is PR-7); a failing employee keeps its previous salary row and provisional rows
  (savepoint); orphan sweep every run; run id = requestId or `stage7-<ISO>`.
- **Open (SPEC K8):** matching by code only means an employee with salary rows in two companies in one month would show
  the loan on both payslips while the ledger holds one row. 0 cases Jan–Sep 2026; worth a guard before go-live.

### For PR-6 (loan close)

- Stage 7 leaves exactly one `loan_deductions` row per loan + month + payroll; post only `state = 'provisional'`
  rows whose `run_id` is from the latest Stage 7 run of that month (K29).
- `planStage7Loans` returns `alerts` of type `loan_posted_unborne`; PR-6 owns the opposite entry and the notification.
- A ₹0 provisional row (no headroom) is deliberate: posting it defers the whole instalment (D-5).
- Simulation: `node backend/scripts/loans-stage7-simulation.js` (exit 0 = all checks pass);
  `--dump <file>` writes the no-loan month for an origin/main vs branch byte comparison.

## Loans PR-6 rulings (planner, 10 Oct 2026)

- **Q1** `loan_adjustments` (append-only, inside `loansSchemaV2Ddl`): the opposite entry for a posted deduction.
  Effective posted = `loan_deductions.amount` − Σ adjustments. Reconciliation: disbursed − (posted − adjusted) − receipts
  − written off = balance.
- **Q2** admin reversal (`POST /api/loans/deductions/:id/reverse`, reason ≥ 10) returns the amount to the schedule as a new
  last instalment (origin `reversal`, not counted toward the 3-month limit); live loans only. The month's next Stage 7
  re-run deducts the remaining effective posted amount (₹0 after a full reversal).
- **Q3** a Stage 7 re-run of a posted month that pay can no longer bear: a live loan deducts what fits and writes an
  `unborne` opposite entry in the same savepoint (origin `shortfall`, counts toward the limit); a loan no longer live keeps
  the full posted amount + finance alert.
- **Change to Q4 (coordinator):** the 60-day "salary row stale" marker is on the loan side — the deduction row
  `state = 'reversed'` with `reversal_reason = 'instalment moved to the end (held)'` (`HELD_MOVE_REVERSAL_REASON`).
  `day_calculations.salary_stale` (leave automation) is never touched. Hold release → 409 `LOAN_ROW_STALE` while that
  marker exists AND the salary row disagrees with the ledger; a Stage 7 re-run of the employee lifts it. No loans → no-op.
- **Q5** an empty ledger writes nothing (no `loan_closes` row, notification or audit row).
- **Q6** the close screen is a separate frontend-only PR-6b. **Q7** payrolls close separately; plant never waits for sales.
  **Q8** a due instalment with a salary row but no deduction moves to the end as `no_salary` with a note. **Q11** a close
  that breaks a reconciliation it found clean rolls back; a pre-existing mismatch is recorded (`reconciliation_ok = 0`).
  **Q12** drift monitor: `loan_balance_reconciles` (critical), `loan_payslip_matches_ledger` (medium).
- **Q10** cron `'45 0 * * *'` UTC = 06:15 IST daily + boot catch-up; the unique close row stops a same-day double close.
- **PR-5 gap fixed (own commit):** Stage 7 now reads posted months of loans that are no longer live (completed by the close).

### For PR-8 (sales)

- **K8 sales guard (planner ruling Q9):** `sales_salary_computations` is unique per (employee_code, month, year, company),
  so a sales rep can have two rows in one month. PR-8 must make the second company's Stage 7 plan ₹0 for a loan whose
  deduction for that loan + month + payroll already belongs to the other company's salary row (plant needs no such guard:
  its table is unique per employee-month; PR-6 added a hard check + the close-time payslip check).
- Replace the sales branch of `closeReadiness` (`SALES_CLOSE_NOT_WIRED`) with: active `computed` sales upload for M, and
  a row on Hold counts as held. `checkPayslipLedger` and the sweep are plant-only today.

### For PR-6b (close screen)

`GET /api/loans/close/preview?month&year` (readiness, would-post count/amount, held, shortfalls, no-salary, mismatches),
`POST /api/loans/close {month, year}` (finance / admin; 201; 409 `ALREADY_CLOSED`; 400 readiness codes
`NOT_NEEDED`, `STAGE7_NOT_COMPUTED`, `EARLIER_MONTH_OPEN`, `MONTH_NOT_ENDED`), `GET /api/loans/closes` (history, notes
parsed), `POST /api/loans/deductions/:id/reverse` (admin). Company-restricted users get 403 on preview / close.

## Loans PR-6b rulings (coordinator, 10 Oct 2026)

- **Q1 = A:** the only backend change — `GET /api/loans/:id` also returns `deductions` (each with `adjusted` and
  `effective_posted`) and `adjustments`. Read-only, confined to the `/:id` handler body (PR-7 adds routes above it).
- Close screen = a "Monthly close" tab on `/loans` (`?tab=close`); HR and viewer read-only; plant payroll only.
- Mark Left dialog shows the leaver's live loans and outstanding with the SPEC §5 r11 wording (true once PR-7 is
  merged, which happens before any loan can exist) plus the exit-month line (marked after that month's close → the
  whole balance is a residual for finance to collect in cash or write off).
- Held tile on the Loans page: not done (no existing API gives a ledger-wide held count; none added).
- `ReasonModal` gains an optional `minLength` (reversal: 10). Browser check extended (Pass 3).
- Screens: `docs/loans/screens/pr6b/`. Repeat: `python3 backend/scripts/loans-ui-browser-check.py <dir>` (Pass 3 shots go to `<dir>/pr6b`).

### Loans PR-6 check (read-only, after deploy)

```sql
SELECT name FROM sqlite_master WHERE name IN ('loan_adjustments','loan_adjustments_no_update','loan_adjustments_no_delete');  -- 3
SELECT (SELECT COUNT(*) FROM loan_closes), (SELECT COUNT(*) FROM loan_adjustments), (SELECT COUNT(*) FROM loans);              -- 0, 0, 0
SELECT value FROM policy_config WHERE key = 'loans_disbursement_enabled';                                                     -- '0'
-- after 13 Oct 2026 06:15 IST (00:45 UTC): still nothing written by the loan job
SELECT COUNT(*) FROM loan_closes;                                                                                             -- 0
SELECT COUNT(*) FROM notifications WHERE type LIKE 'LOAN_%';                                                                  -- 0
```
Then checks 1–3 below. Railway log line at boot: `[loans-close] daily job scheduled (45 0 * * * UTC = 06:15 IST)`.

**Cutover gate:** disbursement may be switched on only after this check passes (see "Cutover and SOP items" above).

## Loans PR-7 rulings (planner, 10 Oct 2026)

- **Final month F** = the month of the loan's own `exit_date` (else the IST month of `exit_flagged_at`). Never employee
  status, so a Stage 6 reactivation or a second Mark Left cannot move it. **"F is past"** (one helper,
  `isFinalMonthPast`): a `loan_closes` row for F, or a later month already closed.
- **The schedule carries it, not Stage 7** (`stage7.js` byte-unchanged): Mark Left collapses an active loan's schedule
  into one instalment due in F (`consolidateForExit`); any later shortfall / no-salary / held / reversal before F is
  added to it; once F is past nothing is added — the amount stays in the balance as the **exit residual**
  (= reconciliation "uncovered") and finance is alerted (`LOAN_EXIT_RESIDUAL`). Exit loans never use an extension month.
- **Q-A** TDS list (`GET /api/loans/write-offs`) keyed by write-off month (IST); each row carries `exitDate` and
  `finalMonth`; `basis=final` lists by the final month. CA Q4 still decides how TDS is applied.
- **Q-B** a held final salary keeps the 60-day wait (D-14); the close alert (`LOAN_EXIT_FINAL_HELD`) and
  `GET /api/loans/exit-residuals` show the held-pending amount.
- **Q-C** a returning leaver's loan stays `recover_at_exit`; the residual is cleared only by receipt or write-off.
- **Q-D** after a final month with no salary (or held past the wait) the instalment is `cancelled`; its amount is residual.
- `EXIT_FINAL_PAYROLL_SHORT`: non-blocking readiness warning; `computedBeforeExit` when Stage 7 for F last wrote the row
  before Mark Left (re-run Stage 7 first if the final salary has not been paid).
- Production (10 Oct 2026, read-only): of 126 Mark Lefts for 2026 exits, 66 came after the 13th of the month after the
  exit month (F already past); 7 of 12 exit-month salary rows are held, 0 released; 0 salary rows after an exit month;
  0 employees in status `Exited`.
- Mark Left reply gains `loans: [{loanId, status, outstanding, finalMonth, finalMonthPast, dueInFinalPayroll, residual}]`
  for the PR-6b dialog (optional consumer). Mark Left's role guard is still P4.

### Loans PR-7 check (read-only, after deploy)

```sql
SELECT COUNT(*) FROM loans WHERE status = 'recover_at_exit';                                     -- 0 (no loans yet)
SELECT COUNT(*) FROM loan_instalments WHERE origin = 'exit';                                     -- 0
SELECT COUNT(*) FROM loan_events WHERE event IN ('exit_consolidated', 'exit_residual');          -- 0
SELECT COUNT(*) FROM notifications WHERE type IN ('LOAN_EXIT_RESIDUAL', 'LOAN_EXIT_FINAL_HELD');  -- 0
```
Then checks 1–3 below (no salary code changed; Stage 7 untouched). `GET /api/loans/exit-residuals` → empty lists.

## Loans PR-8 rulings (planner, 10 Oct 2026 — all Phase 0 defaults approved)

- **Q1** ₹0 net floor (K22) only on a sales row that carries a loan deduction (`salesNetWithLoanFloor`). A blanket
  floor would change production row 8/2026 (other deductions ₹60,000 > earnings, net −₹1,935.48, no loan) on the next
  recompute. No-loan rows are byte-identical (simulation `--dump`).
- **Q2** a sales borrower is code + company: Stage 7 matches a sales loan on code AND the loan's company (the K8 guard
  for sales — never first-come by compute order); payslip ↔ ledger, the hold guards, the eligibility open-loan count and
  the 3-month history are scoped the same way.
- **Q3** sales first EMI = the sales cycle month after the disbursement's cycle month (day ≥ 26 → next month): paid
  28 Oct → first EMI Dec.
- **Q4** a sales exit's final payroll = the sales cycle containing the leaving date (`finalMonthOf`, sales only).
- **Q5** sales gross for eligibility = latest `sales_salary_structures` (effective by the as-of month, else latest);
  the master gross only as a fallback.
- **Q6** exit hook: `PUT /api/sales/employees/:code/mark-left` and `PUT /api/sales/employees/:code` with status Left /
  Exited (not Inactive) flag the rep's open sales loans in the same transaction.
- **Q7** mirrors plant PR-5 Q3: provisional rows of employees the sales compute did not pay (excluded, or not in the
  active upload) are reversed and listed (`loans.staleRows`); salary rows the run did not compute are never rewritten.
- **Q8 — risk, no override:** a sales month with NO sales upload at all (as 3/2026 in production) never becomes ready,
  so a sales instalment due in it makes that close wait — and every later sales close waits behind it
  (`EARLIER_MONTH_OPEN`), as plant does when Stage 7 never runs. Plant never waits for sales. If it happens, the way out
  today is a defer / restructure of that instalment (admin) before the close; an override would be its own PR.

**Pre-existing, report only (found in PR-8 Phase 0):** 5/2026 Indriyan has 58 `sales_salary_computations` rows whose
employee is not in the active upload (left behind by a superseded upload). Sales compute never deletes a row, so they
still appear in the register and the NEFT export.

### Loans PR-8 check (read-only, after deploy)

```sql
SELECT COUNT(*) FROM loans WHERE borrower_type = 'sales';                                        -- 0 until the first sales loan
SELECT COUNT(*) FROM loan_deductions WHERE payroll = 'sales';                                    -- 0
SELECT COUNT(*) FROM loan_closes WHERE payroll = 'sales';                                        -- 0 (empty ledger writes nothing)
SELECT COUNT(*) FROM notifications WHERE message LIKE '%SALES_CLOSE_NOT_WIRED%';                 -- 0
-- sales drift (formula verified in PR-8): expect 0 rows
SELECT month, year, company, COUNT(*) FROM sales_salary_computations
 WHERE ABS(net_salary - (gross_earned + COALESCE(diwali_bonus,0) + COALESCE(incentive_amount,0) - total_deductions)) > 1
 GROUP BY month, year, company;
-- the no-loan negative-net row is untouched (Q1): still 1 row, 8/2026
SELECT COUNT(*) FROM sales_salary_computations WHERE net_salary < 0;
```
Then checks 1–3 below (record one sales month total before and after: identical).

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
| 2026-10-09 | Loans PR-4 | Screens built | Frontend only. Dist on main = fresh build (0 diffs). Browser check 63/63 (scratch DB, real logins, gate 0 then 1). Self-debug: 5-second GET cache made mutations look ignored → loan reads send `Cache-Control: no-cache`. Backend 31/667. |
| 2026-10-09 | Loans PR-2 | Engine built | `services/loans/` (15 files), 7 new suites, simulation script. Suite 454 → 588 (3 clean runs). Simulation: 13 loans × 12 months reconcile exactly, exit 0. |
| 2026-10-10 | Loans PR-5 | Built | Q1 earned-base fix, per-employee savepoint, Stage 7 loan step (`services/loans/stage7.js`), simulation. Suite 692 → 713 (36 suites). No-loan simulation dump byte-identical on origin/main and the branch (210 rows); full mode (5 loans, re-run, reimport) all checks pass, drift 0, component-short 0. |
| 2026-10-10 | Loans PR-6 | Built | Loan close, sweep, daily job, opposite entries, hold-release guard, close API, drift invariants. Suite 713 → 753 (41 suites). Close simulation 7 loans × 4 months PASS; `--empty` 84 tables unchanged. |
| 2026-10-10 | Loans PR-7 | Built | Exit recovery: schedule collapses into the final month at Mark Left; residual after it; exit-residual and write-off (TDS) endpoints; Mark Left reply summary. Merged origin/main (#61). Suite 769 → 792 (44 suites). Exit simulation 5 leavers × 5 months PASS (reconciles daily, drift 0, component-short 0, payslip = ledger); `--empty` 84 tables unchanged. |
| 2026-10-10 | Loans PR-6b | Built | Close tab, admin reversal on the loan page, Mark Left outstanding; `GET /:id` gains `deductions` + `adjustments`. Suite 769 → 771 (42 suites). Browser check 103/103 (63 PR-4 + 40 Pass 3), 0 page errors. |
| 2026-10-10 | Loans PR-8 | Built | Sales borrowers: eligibility (structure gross, company-scoped), cycle first EMI, borrower search; sales Stage 7 within headroom matched on code + company; loan-only ₹0 floor; K30 edits, K31 hold block, K28 release guard; sales close / sweep / payslip check; sales exit hook. Suite 792 → 849 (49 suites, 3 clean runs). `loans-sales-simulation.js` 7 loans × 5 sales months PASS; `--dump` byte-identical vs PR-7 base and vs main after #63/#64 (232 rows); `--empty` writes nothing. Merged main: suite 851 / 49; dist rebuilt once; browser check 116/116 (Pass 4 sales, 13), 0 page errors. |

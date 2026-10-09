# Loan Management — Build Spec (Loans PR-0)

**Status:** owner-approved, 9 Oct 2026. Written 9 Oct 2026 on branch `docs/loans-spec`.
**Source:** "Loan Management — Assessment & Completion Plan", plan v2, 9 Oct 2026, with the
owner's rulings recorded the same day, plus the coordinator's rulings on five conflicts
inside that plan (see §12.2).
**Tracker:** [`PROGRESS.md`](PROGRESS.md), which records live state and holds the resume block.

> "Loans PR-0" is this spec. It is unrelated to the leave-safety "PR-0" (`fix/leave-safety-and-ci`)
> that appears in `CLAUDE.md`. Always write "Loans PR-n".

## 0. How to use this spec

- Every loan PR (Loans PR-1 … PR-10, PR-F) is held to this document. A PR that needs to
  depart from it must say so in its Phase 0 plan and get the owner's ruling first.
- **Precedence when two passages seem to disagree:** §3 Decisions → §5 Rules → §9 PR table →
  everything else.
- **"Pending" stays pending.** Anything marked *pending consultant* or *pending CA* is a
  default, not a ruling. Change it only when §12 is answered.
- **Code references** were verified against `origin/main` at `1aa6ca4` on 9 Oct 2026. Line
  numbers drift, so every PR re-verifies them in its own Phase 0.
- **No PII:** this document holds no names, PAN, Aadhaar, bank or phone details, and no
  real employee codes. Keep it that way.

---

## 1. Purpose and scope

### 1.1 Why

The loan module is fully built but has never been used, and it is not safe to switch on.
Two defects lose money silently (D1, D2), and the cash-repayment button fails every time (D3).
Nothing has ever been recorded, so every fix is forward-only and no history needs correcting.

| Live check (production, 9 Oct 2026) | Result |
| --- | --- |
| Loans ever created | 0 |
| Repayment instalments ever generated | 0 |
| Loan EMI deducted in any plant salary run (Jun 2025 – Sep 2026) | ₹0 |
| Loan EMI deducted in any sales salary run (Feb – Sep 2026) | ₹0 |
| Salary advances recovered through payroll, Sep 2026 | ₹8.80 lakh from 150 employees |
| Company column on the loans table | None |
| Database indexes on the two loan tables | None |

Salary advances are the recovery system actually in use today. **This programme does not
change them** (advance-cap question: §12, Decision 20).

Outside the app, accounts runs 10–30 loans in an Excel sheet. It recovers the EMIs by hand,
cutting each borrower's bank payment, so the app's net pay overstates what those borrowers
are actually paid (L4). Loans PR-10 brings them in.

### 1.2 In scope (all 14 missing capabilities, ruled in scope 9 Oct 2026)

| Capability | Why it matters | Built in |
| --- | --- | --- |
| Maker-checker approval | HR raises, admin approves, nobody approves their own request | PR-3 |
| Disbursement record | Today "disbursed" = approval time. Need mode, date, reference, who paid, signed agreement | PR-3, PR-4 |
| Statutory deduction cap | Total deductions capped at 50% of wages (Code on Wages 2019 s.18; formerly Payment of Wages Act s.7(3)). **Pending consultant** | PR-2 (headroom), PR-5 |
| Eligibility rules | Max amount, max tenure, min service, one active loan, EMI as % of gross | PR-2, PR-4 |
| Posting at monthly loan close; admin reversal | Balance moves once, on a known date, independent of payroll finalise | PR-6 |
| Cash receipts and prepayment | Part or full cash repayment; future EMIs shrink or end | PR-2, PR-4 |
| Defer an EMI (approved) | Replaces Skip; amount moves to the end of the schedule | PR-2, PR-4 |
| Exit handling | Outstanding shown at exit and recovered from final pay; residual by receipt or approved write-off | PR-7 |
| Employee loan statement | Opening, disbursed, recovered, closing per month; printable; portal view | PR-4, PR-9 |
| Reports | Outstanding register by company and department, 12-month recovery forecast, deferred and shortfall, leavers with balance | PR-9 |
| Finance Audit hooks | Readiness check for an unclosed month; red flags when EMI exceeds a set % of net or a posted amount can no longer be borne | PR-9 |
| Outstanding balance on payslip | Employee sees what is left after this month's EMI | PR-9 |
| Restructure | Change EMI or tenure, top-up, with approval and a regenerated schedule | PR-2, PR-4 |
| Tax perquisite flag | Interest-free loans above ₹20,000 aggregate may be a taxable perquisite. **Pending CA** | PR-9 |

Also in scope: loans for sales staff (PR-8), old-loan import and cutover (PR-10), and automated
tests plus a month-by-month simulation script (PR-2 onward; there are none today).

### 1.3 Out of scope for v1

- Interest-bearing loans (D-2). The interest code path is removed, not fixed.
- An NEFT disbursement file (D-18). Disbursement is **recorded only**.
- Employees requesting loans themselves. The portal is read-only, and only if it is in use (D-22).
- Capping advance recovery (D-20). That waits for the consultant and would be its own PR.
- A separate final-settlement run (D-21). Exit recovery uses the next monthly payroll.
- Changing how salary advances work.

---

## 2. Live payroll issues fixed first (Phase 0, before any loan PR)

| # | Issue | Evidence (production, 9 Oct 2026) | Fixed by |
| --- | --- | --- | --- |
| L1 | Re-running Stage 7 re-holds a salary finance already released | Upsert sets `salary_held` from attendance and never reads `hold_released` (`salaryComputation.js` L886). 54 released rows re-held (Mar 8, Apr 5, May 12, Aug 29), ₹1.95 lakh net. Reimport deletes the rows outright (`import.js` L968–973). Of the 54: 35 were released to be paid (₹2.35 lakh take-home), 17 carry notes saying already paid outside the app, 2 had nothing payable | P1, PR #48 |
| L2 | Re-running Stage 6 turns leavers back to Active | `recompute.js` L86–90 sets every Left employee with attendance that month to Active. 456 Active carry the returned flag; 98 of them have an exit date | P2, PR #49 |
| L3 | Any logged-in user can rewrite an employee's deductions | `PUT /payroll/salary/:code/manual-deductions` (`payroll.js` L727) has no role check, and recalculates net without late-coming or early-exit deductions | P3, PR #50 (retires the endpoint, 410 Gone) |
| L4 | For borrowers, the app's net pay is not what the bank pays | Accounts deducts loan EMIs from the bank payment by hand for 10–30 employees; the app shows ₹0 loan recovery for everyone | Loans PR-10 cutover |

These are row counts, not proof of underpayment. Finance is checking the 35 released-to-be-paid
rows against what was actually paid, and HR is checking the 98 leavers.

---

## 3. Decisions (locked)

Every item below is a ruling. The tag in brackets shows where it came from: the plan's
decision number or "R" for the 9 Oct rulings table. Where the plan's recommendation text and
a ruling differ, the ruling is what's written here.

1. **D-1 Keep loans in the app.** Complete the loan module. Do not run everything as advances:
   advances recover in one month, while loans span months on a schedule. [Decision 1]
2. **D-2 Interest-free only** in v1. This removes D4; interest can come later. [Decision 2]
3. **D-3 Approval: the admin approves everything.** The admin (owner) approves or rejects every
   loan, defer, restructure and write-off. HR raises loans. Finance records disbursements and
   cash receipts and **never approves anything**. **Nobody approves their own request.**
   **There is no backup approver:** urgent loans wait for the admin. [Decision 3, R, coordinator 9 Oct]
4. **D-4 Limits:** max 2× monthly gross, 12 months tenure, 6 months' service, 1 active loan,
   EMI ≤ 30% of gross. Total deductions are never above the deduction cap. [Decision 4]
5. **D-5 Shortfall:** when the EMI exceeds what the month can bear, deduct up to the cap and
   move the shortfall to the end of the schedule. [Decision 5]
6. **D-6 Held salary:** show the deduction, but post it only once the hold is released. [Decision 6]
7. **D-7 Leaver with a balance:** recover from final dues. Any residual is cleared by a numbered
   cash receipt or an **admin-approved** write-off. [Decision 7, as amended by D-3]
8. **D-8 Sales staff are included,** in the same module, from Phase C (PR-8). [Decision 8]
9. **D-9 Loans already outside the app are imported.** 10–30 loans run in an accounts Excel
   with names but no employee codes, recovered by accounts adjusting the bank payment by hand.
   They are imported after three steps: HR matches each name to a code, finance confirms each
   balance, and the admin approves the import. [Decision 9, R]
10. **D-10 Loan close timing.** The close runs automatically on the **13th of the next month
    (IST)**, but only once that month's plant Stage 7 and sales upload are computed; otherwise
    it waits and notifies finance. Finance (or admin) may close earlier. The salary payment date
    is "by the 10th", which is why the close falls on the 13th. [Decision 10, R]
11. **D-11 Deduction cap:** 50% of earned base pay, the most conservative reading and the base the
    app already deducts from. **Pending consultant** on what the cap is measured on. [Decision 11]
12. **D-12 Deduction order** when pay is short: PF, ESI, TDS → advance recovery → late-coming →
    early-exit → **loan EMI last**. [Decision 12]
13. **D-13 New loan during advance recovery:** allowed. The approval screen warns when the last
    3 months' deductions averaged above 30% of earned pay. [Decision 13]
14. **D-14 A held month's EMI** waits **60 days** after loan close, then moves to the end of
    the schedule. [Decision 14]
15. **D-15 Exit recovery** happens within the cap, in the final monthly payroll. The remainder is
    cleared by a numbered cash receipt or an admin-approved write-off. **Pending consultant.**
    [Decision 15, as amended by D-3]
16. **D-16 Payroll finalise lock** comes later, as its own PR (PR-F) after the loan pilot. It is
    not a loan prerequisite. [Decision 16]
17. **D-17 Who can borrow:** Permanent, SILP, Worker and Sales. **Not contract workers,**
    because their employer is the contractor. [Decision 17]
18. **D-18 Disbursement is recorded only:** mode, date, reference and who paid. No NEFT
    disbursement file in v1. [Decision 18]
19. **D-19 Shortfall extension: at most 3 months.** After that, finance must either restructure
    (which needs the admin's approval) or collect cash. [Decision 19, R: 3 months, not the
    recommended 6]
20. **D-20 Advance cap:** decide after the consultant. Capping advances would change live payroll
    for 150–180 people a month, so it would be its own PR. Until then, loans use only the
    headroom left after advances. [Decision 20]
21. **D-21 Exit timing:** final settlement happens in the **next monthly payroll**, as it does
    today. There is no separate settlement run. Whether the 2-working-day rule (Code on Wages
    s.17(2)) applies **stays with the consultant**. [Decision 21, R]
22. **D-22 Employee portal:** it is not known whether employees use it. PR-9 builds the
    printable statement first; the portal view is dropped if the portal turns out to be unused. [R]
23. **D-23 Loan types:** Personal, Emergency / medical, Festival advance, Education. "Salary
    Advance" is removed from loan types (K18). Festival advance stays a loan type only if it
    spans months. [R]
24. **D-24 Emergency / medical** gets a higher amount limit only: 3× monthly gross instead of 2×.
    3× is a proposal that can be changed in policy. All other rules are the same.
    Emergency / medical requests are flagged urgent at the top of the admin's queue. [R]
25. **D-25 Signed agreement** is required before disbursement. Disbursement is refused until a
    scanned signed agreement is attached. [R]
26. **D-26 Cutover** happens in the payroll month after the pilot. That month accounts stops the
    manual adjustment and confirms it in writing. [R]
27. **D-27 No other manual adjustments exist** besides loan EMIs. Once loans move in, the app's
    net pay should equal the bank payment for everyone. [R]
28. **D-28 Phase 0 timing:** start now, with L1. The L1 diagnosis started 9 Oct; Loans PR-0
    follows. [R]

---

## 4. Policy defaults

These live in the existing `policy_config` table (seeded by PR-1), so they can be changed
without code. The admin edits them from the Loan settings screen.

| Setting | Default | Source |
| --- | --- | --- |
| Loan close day of next month (after payroll is computed) | 13 | D-10 |
| Deduction cap, % of earned base pay | 50 | D-11, **pending consultant** |
| Maximum loan, multiple of monthly gross | 2 | D-4 |
| Maximum loan for Emergency / medical, multiple of monthly gross | 3 | D-24 (proposal) |
| Maximum tenure, months | 12 | D-4 |
| Minimum service, months | 6 | D-4 |
| Active loans per person | 1 | D-4 |
| EMI ceiling, % of monthly gross | 30 | D-4 |
| Deduction-load warning, % of earned pay (3-month average) | 30 | D-13 |
| Days a held month's EMI waits after close | 60 | D-14 |
| Maximum extension from shortfalls, months | 3 | D-19 |
| Eligible employment types | Permanent, SILP, Worker, Sales (not contract) | D-17 |
| Loan types | Personal, Emergency / medical, Festival advance, Education | D-23 |
| Signed agreement before disbursement | Required | D-25 |
| Interest rate | 0 (interest-free only) | D-2 |
| Perquisite reporting threshold | ₹20,000 | **pending CA** |

**Deduction priority (D-12):** PF / ESI / TDS → advance recovery → late-coming → early-exit →
**loan EMI (last)**. The loan takes only the headroom left inside the cap after everything
above it.

---

## 5. Architecture (target design)

### 5.1 The one rule

**Stage 7 only records a provisional deduction. The loan balance moves once, at that month's
loan close,** which runs on its own schedule and does not depend on payroll finalise. Every
other rule follows from this one. It exists because payroll finalise is not used: no plant
month from Jan to Sep 2026 is finalised, so posting at finalise would never have posted
anything (K1).

### 5.2 Rules

1. **Ownership.** A loan belongs to one borrower (a plant or sales employee) and one company,
   picked explicitly from the two valid companies. "Default", "null" and blank are refused (K7).
   The loan records who requested, approved and disbursed it, and holds the signed agreement.
2. **Eligibility** is checked at request and again at approval: employment type, service, amount
   and tenure limits, one active loan, and EMI as % of gross. The approval screen shows the last
   3 months of deductions and warns when projected recovery looks too low (K26).
3. **Schedule (interest-free):** EMI = principal ÷ tenure, rounded up to the rupee; the last EMI
   is the remainder. For example, ₹10,000 over 3 months = ₹3,334, ₹3,334, ₹3,332.
   **First EMI month** = the earliest month after disbursement whose loan close has not
   happened. Finance may push it later, never earlier (K11).
4. **Stage 7 (plant and sales)** works out the loan deduction only after every other deduction
   is known; on plant, that is after the early-exit step. Amount = the lower of what is due
   and the headroom under the cap.
   - Each employee's run first clears its own provisional loan rows, then writes the new one
     **after the salary row is saved**.
   - Rows are keyed by **loan + month + payroll**, never by salary row id, so re-runs and
     reimports give the same answer (fixes D1; K23, K24, K29).
5. **Savepoint per employee.** Each employee's Stage 7 runs in its own savepoint. Stage 7
   never moves a balance and never posts (fixes D2; K25).
6. **Loan close for month M** runs on the set day, but only once plant Stage 7 and the sales
   upload for M are computed; otherwise it waits and notifies finance. Finance may close earlier.
   - There is one close per month and payroll, covering all companies together, in a single
     transaction. A catch-up check runs at server start.
   - The close posts the provisional deductions whose salary is **not held at that moment**:
     the instalment becomes Posted, its amount is frozen, the balance falls, and the loan is
     Completed when the balance reaches ₹0.
   - Shortfalls, and due instalments with no salary in a computed payroll, become new last
     instalments, up to the extension limit. Beyond the limit, finance is alerted
     (fixes D5, D9; K27, K33).
7. **Frozen after posting.** After posting, a Stage 7 re-run for M deducts exactly the posted
   amount.
   - If pay can no longer bear it, the unborne part moves to a new last instalment through an
     opposite entry, and finance is flagged. The payslip and the loan ledger always agree.
   - A sales row with a posted deduction cannot be moved to Hold (K22, K31).
8. **Held salary.** The provisional EMI waits. A daily sweep posts it once the hold is released,
   checking that the hold is still released at that moment.
   - If the salary is still held the set number of days (60) after close, the instalment
     moves to the end of the schedule and the salary row is marked stale.
   - Release of that salary is refused until the employee is re-run (K5, K19, K28).
9. **Receipts and restructures.** A numbered cash receipt (recorded by finance) reduces the
   balance and removes instalments from the end (fixes D3). A restructure (new EMI, new tenure
   or a top-up) changes only unposted instalments, and the admin approves it like a new loan.
10. **Defer replaces Skip.** One unposted instalment moves to the end of the schedule, with a
    reason and admin approval (fixes D8).
11. **Exit.** Mark Left sets the **loan's own exit flag**, so a Stage 6 re-run that reactivates
    the employee cannot undo it (K20).
    - The whole outstanding falls due in the final monthly payroll, within headroom (D-15, D-21).
    - Any remainder is cleared by a numbered cash receipt (finance records it) or an
      **admin-approved** write-off. A write-off is reported for TDS.
    - The loan moves to **Settled at exit automatically** when its exit balance reaches zero
      (fixes D6; K32, K35).
12. **Immutable ledger.**
    - Every state change writes a loan event and an `audit_log` row.
    - Posted entries and events are never edited: a correction is a new opposite entry by the
      admin, with a reason.
    - The admin approves every loan, defer, restructure and write-off, and cannot approve a
      request they raised.
    - Finance records disbursements and receipts and cannot approve anything. HR raises
      (fixes D7; K35).
13. **Reconciliation:** disbursed − posted − receipts − write-offs = balance. It runs inside
    every loan close, on the loan screen, and in the drift monitor when that is switched on (K34).
14. **One path for deductions.** Every path that changes salary deductions goes through the
    engine. The manual-deductions endpoint is retired (P3), and sales edits re-run the engine (K30).

### 5.3 Sales month mapping (K12)

Sales month M is the cycle from the 26th of M−1 to the 25th of M. The instalment for month M is
deducted in the sales cycle ending on the 25th of M, and the loan close for M covers both
payrolls. A sales row on Hold counts as a held salary (K10).

### 5.4 Loan states

| State | Meaning | Who or what moves it there |
| --- | --- | --- |
| Requested | Raised, awaiting approval | HR (finance or admin may also raise) |
| Approved | Admin approved; schedule drafted | Admin (not on a request they raised) |
| Rejected | Admin declined, with reason | Admin |
| Active | Money paid out; schedule live | Finance or admin, recording the disbursement with the signed agreement attached |
| Recover at exit | Borrower marked Left; outstanding falls due from final pay | System, when HR marks the borrower Left |
| Completed | Balance reached ₹0 by deductions or cash | System (at loan close, or when a receipt clears it) |
| Settled at exit | Exit balance reached ₹0 | **System, automatically**, once the exit balance is cleared by final-payroll recovery, a numbered cash receipt recorded by finance, or a write-off approved by the admin |
| Written off | Residual cleared without recovery | Admin approves, reason required (HR or finance requests) |

Reading rule: a write-off that clears an exit balance ends in **Settled at exit** (coordinator
ruling, 9 Oct 2026). **Written off** is the end state for an admin-approved write-off of a loan
that is not in Recover at exit.

### 5.5 Instalment states

| State | Meaning |
| --- | --- |
| Scheduled | Due in its month |
| Provisional | Included in this month's Stage 7; can still change |
| Posted | Loan close done; balance reduced; amount frozen |
| Paid in cash | Covered by a receipt |
| Deferred | Approved to move to the end of the schedule |
| Cancelled | Removed by prepayment, exit settlement or write-off |

---

## 6. Data model

Six tables: the two existing loan tables are **rebuilt** (both hold 0 rows), and four are new.
**The salary tables need no schema change**, because `salary_computations.loan_recovery` and
`sales_salary_computations.loan_recovery` already exist. Policy lives in `policy_config` (§4).

| Table | Status | Key columns | Purpose |
| --- | --- | --- | --- |
| `loans` | Rebuilt | borrower type (plant or sales), employee code, company, loan type, principal, interest rate (0 in v1), tenure, EMI, status; requested by/at and reason; approved or rejected by/at and reason; disbursed amount, mode, reference, date, by; first EMI month; exit flag; signed agreement; balance; write-off amount, by, at, reason | One row per loan. The balance is a cached figure, checked by reconciliation |
| `loan_instalments` | Rebuilt (replaces `loan_repayments`) | loan, sequence, due month and year, amount due, status, origin (schedule, shortfall, deferred, no salary, restructure), posted amount, posted at, the loan close that posted it. **Unique on loan + sequence** | The schedule, including instalments added at the end |
| `loan_deductions` | New | loan, instalment, payroll (plant or sales), month, year, company, amount, state (provisional, posted, reversed), the run that wrote it. **No salary row id.** **Unique on loan + month + payroll** | The link between a loan and a salary row; what makes Stage 7 re-runs repeatable |
| `loan_receipts` | New | receipt number (serial), loan, amount, mode, reference, date, recorded by, instalments cleared, remarks | Cash repayments and exit settlements |
| `loan_closes` | New | month, year, payroll, run at, run by (automatic or a user), posted count and amount, deferred count, held count. One per month and payroll | One row per monthly loan close; proves what posted when |
| `loan_events` | New | loan, instalment, event, from state, to state, amount, user, reason, time | Full history for the statement and the audit; every row also goes to `audit_log` |

**Rebuild guard (K13):** PR-1 rebuilds `loans` and `loan_repayments` → `loan_instalments` only
after checking both tables are empty, and **refuses** otherwise. This is the same pattern as the
TA/DA table rebuild. The rebuild is idempotent and gated by a `policy_config` migration flag.
Indexes cover every loan, employee and month lookup. PR-1 also rewrites the Mark Left loan block
in `employees.js` (L733–738 today), which writes the old tables inside the Mark Left transaction
(K21).

**Readers of the old tables** that later PRs must move over:
- `salaryComputation.js` L206–215 (read) and L990–997 (mark): PR-5.
- `salesSalaryComputation.js` L60–69: PR-8.
- `loans.js`, `loanService.js`: PR-3, PR-2.
- `employeePortal.js` L119–124: PR-3.
- `employees.js` Mark Left: PR-1 / PR-7.

PR-1 must leave every one of these able to run, at minimum returning ₹0, until its owning PR lands.

---

## 7. Roles and screens

HR raises, the admin decides, finance pays out and records receipts, and nobody approves their
own request. **The server enforces every cell below**, not just the screen. Because every
approval waits for the admin, the approval queue notifies the admin, and the Loans page shows
how long each request has waited.

| Action | HR | Finance | Admin | Viewer | Employee |
| --- | --- | --- | --- | --- | --- |
| Request a loan | Yes | Yes | Yes | No | No (v1) |
| Approve or reject | No | No | Yes, not own request | No | No |
| Record disbursement (agreement attached) | No | Yes | Yes | No | No |
| Request a defer or restructure | Yes | Yes | Yes | No | No |
| Approve a defer or restructure | No | No | Yes, not own request | No | No |
| Record a cash receipt | No | Yes | Yes | No | No |
| Run loan close early | No | Yes | Yes | No | No |
| Write off a balance | Request | Request | Approves, with reason | No | No |
| Reverse a posted deduction | No | No | Yes, with reason | No | No |
| Change policy settings | No | No | Yes | No | No |
| Import old loans (PR-10) | Confirms name matches | Confirms balances | Approves the import | No | No |
| View all loans, statements, reports | Yes | Yes | Yes | Yes | No |
| View own loans and statement | — | — | — | — | Yes, in the portal (if used, D-22) |

**Separation (K35):** disbursement and receipts should be recorded by different people from
the requester. Every receipt is numbered, and the deduction register is kept.

**Screens**

1. **Loans** (rebuilt): the loan list, with tiles for outstanding, due this month, provisional,
   held and deferred.
2. **Request form:** one employee search across plant and sales (sales from PR-8), a live
   eligibility panel, and a schedule preview before saving.
3. **Approval queue** (admin): the request, the eligibility result, the last 3 months of
   deductions and the schedule; approve or reject with a reason. Emergency / medical requests
   appear at the top, flagged urgent.
4. **Loan detail:** the schedule with each instalment's state, the event history, and the actions
   (disburse, receipt, defer, restructure, write-off). Includes a printable statement.
5. **Monthly loan close** (finance): before closing, the month's due, provisional, held,
   shortfall and no-salary counts; a Close button; the history of past closes.
6. **Loan reports:** outstanding register by company and department, 12-month recovery forecast,
   deferred and shortfall list, leavers with balance, perquisite list.
7. **Loan settings** (admin): the policy values in §4.
8. **Existing screens touched:**
   - Stage 7 register (its Loan column already exists).
   - Payslip (a balance line is added).
   - Employee master Loans tab.
   - Mark Left dialog (shows the outstanding).
   - Finance Audit readiness and red flags.
   - Notifications.

---

## 8. Current-code baseline (what the PRs replace)

### 8.1 Component inventory

There are 15 parts: 1 works cleanly, 9 work with defects, and 4 are broken or unreachable. There
are no automated tests. File references are to `origin/main` at `1aa6ca4`.

| Part | Where | What it does | Status |
| --- | --- | --- | --- |
| Create loan | `POST /api/loans` → `loanService.createLoan` | Looks up the employee in the plant master, computes EMI, saves as Pending | Works for plant. No role check, no audit (D7). The screen's EMI preview ignores interest |
| List and stat tiles | `GET /api/loans`, `/stats` | Loan list plus tiles | Works. The company filter is ignored: there is no company column (D10) |
| Approve | `PUT /:id/approve` → `approveLoan` | Sets Active, stamps disbursed = approval time, generates the schedule (`loanService.js` L73–102) | Correct for interest-free loans. Interest schedule wrong (D4). One click, any role (D7) |
| Reject | `PUT /:id/reject` | Sets Rejected | Works. Reason hard-coded; no audit (D7) |
| Close | `PUT /:id/close` | Sets Closed, balance to ₹0, cancels the rest | A one-click write-off: no confirmation, no approval, no audit (D7) |
| Stage 7 deduction (plant) | `salaryComputation.js` L206–215 read (called at L615), L990–997 mark | Adds this month's Pending EMIs, then marks them Deducted | **Broken** on re-run (D1). Never moves the balance (D2) |
| Process Deductions | `POST /api/loans/process-deductions` (`loans.js` L171–217) | Marks instalments Deducted, reduces balance, completes loan | **Conflicts** with Stage 7 (D2) |
| Recover (cash) | `POST /:id/recover` (`loans.js` L224–288) | Records a cash repayment | **Broken**: writes two columns that do not exist (D3) |
| Skip | `POST /:id/skip` (`loans.js` L295–326) | Marks Skipped | The skipped amount is never rescheduled (D8) |
| Employee master → Loans tab | `GET /api/loans/employee/:code`; `Employees.jsx` L363–720 | Per-employee loans with EMIs paid | Counts payroll deductions only (`loanService.js` L161–170) (D12) |
| Mark Left | `employees.js` L733–738 (route L705) | Closes the leaver's loans, cancels instalments | Silent write-off (D6) |
| Employee portal | `GET /api/portal/loans` (`employeePortal.js` L119–124) | Employee's own loans | Also shows Rejected loans (L122 filters only `!= 'Closed'`) (D12) |
| Read-only consumers | Stage 7 register and Excel (`payroll.js`), payslip, Finance Audit report (`financeAudit.js` L67), Salary Explainer (`ai.js`) | Display `loan_recovery` | Work |
| Sales payroll | `salesSalaryComputation.js` L60–69 | Sums Pending EMIs by employee code | Reads only, never marks. **Unreachable**: sales loans cannot be created (§8.3) |
| Automated tests | `backend/src/__tests__` | — | None for loans |

Every Stage 7 path runs through one loop at `recompute.js` L328: the Compute Salary button,
the re-import auto-recompute, and the leave-automation job. So D1 affects all of them.

### 8.2 Defects

There are 12: 2 critical, 5 high, 4 medium and 1 low group. None has fired, because no loan exists.

| # | Severity | Defect | Evidence | Fixed in |
| --- | --- | --- | --- | --- |
| D1 | Critical | Re-running Stage 7 drops the EMI | L206–215 reads only `status='Pending'`; L990–997 flips them to Deducted; the upsert (L888) then writes `loan_recovery` = ₹0 on every re-run | PR-5 |
| D2 | Critical | Two competing recovery paths; payroll never moves the balance | Stage 7 never updates `total_recovered` / `remaining_balance` / status; `process-deductions` only touches unmarked instalments | PR-5, PR-6 (button retired PR-3) |
| D3 | High | Cash repayment always fails | `loans.js` L256 writes `amount_recovered`, `recovery_date`, neither of which exists in production | PR-1, PR-2 |
| D4 | High | Interest schedule overcharges | `loanService.js` L73–102: interest on principal plus interest; ₹1 lakh at 12% / 12 m = ₹1,13,916 instead of ₹1,06,620 | PR-2 (interest-free only) |
| D5 | High | No affordability or hold check | Full EMI goes into `totalDeductions` (L697); net floored at ₹0 (L700–707); still deducted when held (L731, L757) | PR-5 |
| D6 | High | Leavers' loans written off silently | Mark Left closes loans, cancels instalments | PR-1 (block), PR-7 |
| D7 | High | No access control, maker-checker or audit | Mounted with login only (`server.js` L205); no role checks; create/approve/reject/close write no audit (only L279, L319 do) | PR-3, PR-4 |
| D8 | Medium | Skip loses the amount | Skipped, then `process-deductions` completes and zeroes the loan (L201–205) | PR-2 (Defer) |
| D9 | Medium | Instalments in a month with no payroll stay Pending forever | Stage 7 runs only for employees with a day-calculation row (`recompute.js` L299–306) | PR-6 |
| D10 | Medium | Loans have no company | No `company` column; Stage 7 runs per company | PR-1 |
| D11 | Medium | Re-running Stage 7 un-finalises a month | Upsert sets `is_finalised = 0` (L911). January 2026 was finalised 18 Mar, now reads unfinalised | PR-F |
| D12 | Low | Smaller gaps | Portal shows Rejected; tab ignores cash; no indexes/uniqueness; "Salary Advance" type duplicates the advance module; employee code is typed free-text | PR-1, PR-3, PR-4 |

### 8.3 Sales staff gap

1. **Create fails.** `createLoan` looks the code up in the plant master. Sales staff live in
   `sales_employees` (332 rows, S-prefixed codes), and none of those codes exists in the plant
   master, so every attempt returns "Employee not found".
2. **There is a trap.** The plant master still holds 355 legacy rows typed "Sales" with numeric
   codes. A loan created against one of those would be deducted nowhere: plant Stage 7 has no
   Sales rows, and sales payroll matches on the S-code.
3. **Sales payroll reads but never posts.** The register, Excel export and payslip already show
   a Loan line.
4. **The month mapping needs stating:** see §5.3.

To complete it: each loan records whether the borrower is plant or sales (plus company), the
create screen searches the right master, and sales payroll follows the same read-and-post rules
as plant.

---

## 9. PR sequence

Each PR is merged and verified on production before the next one starts.
- **Plant pilot:** after PR-7.
- **Full plant go-live:** after PR-9.
- **Sales:** after PR-8 and PR-9.
- **Old loans move in:** the month after the pilot (PR-10).

Phase A builds the engine without touching payroll. Phase B connects it to plant payroll with
two small edits to fragile files. Phase C adds sales and visibility.

### 9.1 Phase 0: live payroll fixes

Each starts with diagnosis queries, then one prompt, one commit, verify.

| PR | Fix | Files | Fragile | Acceptance tests |
| --- | --- | --- | --- | --- |
| P1 (#48) | A finance-released hold survives Stage 7 re-runs and reimports; list the 54 re-held rows for finance | `salaryComputation.js` (upsert only), `import.js` | `salaryComputation.js` | Release a hold, re-run Stage 7 and reimport: the salary stays released and stays in the bank file |
| P2 (#49) | Stage 6 stops reactivating employees whose exit date is on or before that month; list the 98 for HR | `recompute.js` | — | A Left employee with an exit date in the month stays Left after Stage 6 |
| P3 (#50) | Manual-deductions endpoint retired (410 Gone) | `payroll.js` | `payroll.js` | Viewer and HR cannot change deductions through it; no path recalculates net without late-coming and early-exit |

### 9.2 Loan PRs

Branch pattern: **`feat/loans-prN`** (this PR is the one exception, on `docs/loans-spec`).

**Loans PR-0 (A) — this spec.** Adds `docs/loans/SPEC.md` and `docs/loans/PROGRESS.md`. No code.
- *Accepted when:* the owner merges it.

**Loans PR-1 (A) — schema.** Rebuild `loans` + `loan_repayments` → `loan_instalments`, refusing if
either holds a row. Add `loan_deductions`, `loan_receipts`, `loan_closes`, `loan_events`; indexes
and unique keys; policy defaults (§4) in `policy_config`. Rewrite the Mark Left loan block in
`employees.js` in the same PR (K21).
- Fixes D3, D10, D12 (schema side), K13.
- Files: `schema.js`, `employees.js` (Mark Left block only). **Fragile:** `schema.js`.
- *Acceptance:*
  - Rebuild refuses when either old table has a row.
  - Rebuild is idempotent on a second boot.
  - Unique keys reject a duplicate loan + sequence and a duplicate loan + month + payroll.
  - Policy keys are seeded once and never overwritten.
  - Mark Left no longer touches the old tables, and still completes.
  - Every old-table reader (§6) still runs and returns ₹0.
  - Full jest suite green.

**Loans PR-2 (A) — engine.** New service files under `services/loans/`: schedule, states,
eligibility, headroom (a pure function), receipts, defer, restructure, write-off, events and
audit. Unit tests plus a month-by-month simulation script.
- Fixes D4, D8.
- Files: new `services/loans/*`, tests, script. **Fragile:** none.
- *Acceptance:*
  - ₹10,000 over 3 months gives ₹3,334, ₹3,334, ₹3,332, summing to principal.
  - Headroom: an EMI of ₹5,000 against ₹3,000 of room deducts ₹3,000 and adds ₹2,000 as a new
    last instalment.
  - A cash receipt of ₹5,000 removes instalments from the end.
  - Defer moves one instalment to the end, and the loan still completes at ₹0.
  - Restructure changes only unposted instalments.
  - Eligibility refuses: over the amount limit (2×, or 3× for Emergency / medical), over tenure,
    a second active loan, a contract worker, under the minimum service.
  - Shortfalls reaching the 3-month extension limit alert finance and add no further instalment.
  - Reconciliation (disbursed − posted − cash − write-off = balance) holds for every loan.
  - The statement's closing balance equals the reconciliation figure.
  - A write-off is listed for TDS.
  - Loan company must be one of the two companies.
  - The simulation runs 12 months of scenarios (normal, re-run, shortfall, held, no salary,
    receipt, defer, restructure, exit, write-off) with reconciliation exact to the rupee.

**Loans PR-3 (A) — API.** Rebuilt on the engine: server-side role checks and maker-checker per
§7, notifications (the admin's approval queue). Retire Process Deductions, the old Recover and
Skip. Fix the portal filter.
- Fixes D7, D12.
- Files: `loans.js`, `permissions.js`, `employeePortal.js`. **Fragile:** none.
- *Acceptance:*
  - A viewer gets 403 on every write.
  - HR and finance get 403 on approve, reject, approve-defer, approve-restructure and
    approve-write-off.
  - The admin gets 403 approving their own request.
  - Every create, approve, reject, disburse, defer, receipt and write-off leaves an
    `audit_log` row with user and reason.
  - Disbursement is refused without a signed agreement attached.
  - "Default", "null" and blank companies are refused.
  - The old endpoints return a retired response.
  - The portal does not show Rejected loans.

**Loans PR-4 (A) — screens.** Loans, the request form (plant search), the approval queue
(urgent first), loan detail with a printable statement, and loan settings.
- Fixes D7 (screen), D12.
- Files: `Loans.jsx` plus new components, `api.js`, `frontend/dist` (rebuilt and committed).
  **Fragile:** none.
- *Acceptance:*
  - Each screen drives the PR-3 API.
  - The schedule preview matches the engine.
  - Role-gated buttons are hidden for roles the server refuses.
  - A browser check on Railway preview.

**Loans PR-5 (B) — plant Stage 7.**
- Move the loan step after advance, late-coming and early-exit (after L694).
- Write a provisional amount within headroom, after the save, keyed by loan + month.
- Freeze posted amounts, with automatic move of any unborne part.
- Remove the old marking block (L990–997).
- Add a per-employee savepoint in `recompute.js` (K22–K25, K29).
- Fixes D1, D5. Files: `salaryComputation.js`, `recompute.js`. **Fragile:** `salaryComputation.js`.
- *Acceptance:*
  - Run Compute Salary twice for one month: the loan deduction and instalment states are
    identical both times.
  - Re-import a month's attendance: the loan deduction is unchanged after the automatic recompute.
  - Cap applied in Stage 7.
  - Held salary: the deduction is shown, not posted.
  - One employee failing mid-Stage 7 leaves no loan rows of theirs.
  - An employee skipped on a re-run (zero attendance) has their old provisional row cleared.
  - Drift query: no row above ₹1 for the test month.
  - One plant month and one sales month with no loans: totals identical before and after.

**Loans PR-6 (B) — loan close.**
- Posting; a scheduled job (the IST day written as UTC); a manual close screen.
- A daily held-release sweep; no-salary deferral.
- Waits until the month's payroll is computed; catch-up at server start.
- One close per month and payroll; extension-limit alerts.
- Reconciliation in the close, on the screen and in the drift monitor (K27, K28, K33, K34).
- Fixes D2, D9; K1, K5, K6.
- Files: a new service, `server.js` (one job line), `driftMonitor.js`, the close screen.
  **Fragile:** none.
- *Acceptance:*
  - Loan close posts.
  - A later Stage 7 re-run deducts exactly the posted amount.
  - An admin reversal (a new opposite entry) returns the deduction to provisional.
  - A posted amount that no longer fits after a re-run becomes a new last instalment, and the
    payslip and ledger agree.
  - The automatic close runs on the 13th in IST, once per month.
  - If the close day arrives before payroll is computed, the close waits and finance is notified.
  - A server restart at close time: the catch-up runs the close once, never twice.
  - A held salary released after close is posted by the next daily sweep.
  - Still held past 60 days: the instalment moves to the end and the salary row is marked stale.
  - A month with no salary row: the instalment moves to the end with reason "no salary this month".
  - Reimport a month after its loan close: posted amounts come back exactly, nothing double-posts.
  - Reconciliation runs in every close.

**Loans PR-7 (B) — exit.**
- Mark Left sets Recover at exit, with the exit flag held on the loan.
- The Mark Left dialog shows the outstanding.
- Recovery happens in the final monthly payroll.
- Automatic Settled at exit at ₹0; write-off listed for TDS (K20, K32, K35).
- Fixes D6. Files: `employees.js`, `Employees.jsx` (+ dist). **Fragile:** none.
- *Acceptance:*
  - The outstanding appears in final dues, with no silent closure.
  - A Stage 6 reactivation does not clear the exit flag.
  - The loan settles automatically when the exit balance reaches ₹0, by payroll, by receipt
    or by an admin-approved write-off.
  - A write-off appears in the TDS list for the final month.

**→ Plant pilot.**

**Loans PR-8 (C) — sales.**
- The request form searches the sales master.
- Sales Stage 7 writes a provisional deduction within headroom.
- Loan close includes sales rows.
- Sales edits re-run the engine.
- A row with a posted deduction cannot go to Hold.
- ₹0 net floor (K22, K30, K31).
- Closes the sales gap; K10, K12.
- Files: `salesSalaryComputation.js`, `sales.js`, the loan screens. **Fragile:** treat both
  sales files as fragile.
- *Acceptance:*
  - A sales loan is deducted in the right cycle (§5.3), shown on the sales register, and
    **posted at loan close**.
  - A row with a posted loan deduction cannot be moved to Hold.
  - Sales net is never below ₹0.
  - A sales month with no loans has identical totals before and after.

**Loans PR-9 (C) — visibility.**
- Reports: outstanding, 12-month forecast, deferred and shortfall, leavers, perquisite.
- A payslip balance line, through a separate read, so `salaryComputation.js` is not touched again.
- Finance Audit readiness and red flags; the portal statement (D-22).
- Files: `reports.js`, `financeAudit.js`, `financeRedFlags.js`, the payslip screens.
  **Fragile:** none.
- *Acceptance:*
  - The perquisite report lists only borrowers above the threshold.
  - The payslip balance equals the statement.
  - The readiness check flags an unclosed month.
  - Red flags fire when EMI exceeds the set % of net, or when a posted amount can no longer
    be borne.

**→ Full plant go-live; sales go-live.**

**Loans PR-10 (C) — old loans and cutover.**
- Import the 10–30 loans from the accounts Excel.
- Name-to-code matching with a review screen: exact match first, then close spelling, filtered
  by company and department.
- HR confirms each match, finance confirms each balance, and the admin approves.
- One opening entry per loan.
- Cutover in the payroll month after the pilot (L4; K36, K37).
- Files: a script plus a review screen. **Fragile:** none.
- *Acceptance:*
  - Every imported name is matched and confirmed; unmatched rows stay out and are listed.
  - For every imported borrower, the app's EMI equals the Excel EMI before the bank file goes out.
  - The app's net pay equals the bank payment.
  - Accounts confirms in writing that manual loan adjustments stopped from the cutover month.

**PR-F (separate track) — payroll finalise lock.**
- Stage 7 refuses a finalised month; an audited admin un-finalise.
- Fixes D11; K14.
- Files: `recompute.js`, `payroll.js`, `salaryComputation.js`. **Fragile:** `payroll.js`,
  `salaryComputation.js`.
- Not a loan prerequisite (D-16); comes after the pilot.
- *Acceptance:*
  - Stage 7 on a finalised month is refused.
  - An admin un-finalise writes an audit row.
  - January 2026's state is reported, not silently changed.

### 9.3 Gates between phases

- **Phase 0 → A:** P1–P3 deployed and verified; finance has checked the 54 re-held rows, and HR
  the 98 reactivated leavers.
- **A → B:** the simulation script runs 12 months of scenarios with reconciliation exact to the
  rupee.
- **B → plant pilot:** a full sandbox dry run on a production snapshot; drift sanity query clean;
  unrelated plant month totals unchanged.
- **Pilot → go-live:** one real month with 2–3 loans tracked by hand alongside, then finance
  sign-off.
- **Pilot → cutover:** every imported name matched and confirmed; accounts confirms in writing
  that it stops the manual adjustment from the cutover month.

### 9.4 Rules for every PR

- Own branch `feat/loans-prN`; Phase 0 plan gate (list files, stop, wait for go); an explicit DO
  NOT MODIFY list; merge through the GitHub web UI only.
- The prompt lives in a repo file and is invoked by reference. Claude Code updates
  `docs/loans/PROGRESS.md` after each step, keeping the resume block current.
- Any PR touching salary ends with the drift sanity query and the deduction-component check
  (PROGRESS.md), and stops if any new row drifts by more than ₹1.
- Frontend changes rebuild and commit `frontend/dist`.
- After deploy, check the target and the unrelated items that must not change (a plant month
  total and a sales month total).
- Anything the owner runs himself (a migration check, a Railway variable, a production
  verification) is handed over in the seven-field task form: surface, preflight, action,
  expected, verify, undo, return.

---

## 10. Risk register (K1–K37)

The two planning passes found **37 kinks**. 34 are resolved in the design; one waits for the
accounts Excel (K36) and two for the consultant or CA (K15, K35).

| # | Kink | Resolution | Resolved in |
| --- | --- | --- | --- |
| K1 | Posting depended on payroll finalise, which is not used | Own monthly loan close (D-10) | PR-6 |
| K2 | Stage 7 re-run after posting | Posted amounts are frozen; a re-run deducts exactly that; a red flag if it can't be borne | PR-5, PR-6 |
| K3 | Deductions already crowd pay (4–61 employees a month above 50% of earned base, Jun–Sep 2026) | Loan takes only the headroom, last in order; the approval screen shows 3-month load | PR-2, PR-4, PR-5 |
| K4 | Deferring shortfall on every re-run | Stage 7 provisional only; shortfall deferred once, at close | PR-5, PR-6 |
| K5 | Held salaries are rarely released in the app (21–49 held a month) | Provisional waits; a daily sweep; deferred after 60 days | PR-6 |
| K6 | Months with no salary row | Deferred at close with reason "no salary this month", listed for finance | PR-6 |
| K7 | Employee company field unreliable (47% of active plant without a valid company) | Loan company picked explicitly; deduction matches on employee code | PR-1, PR-3 |
| K8 | One employee paid by two companies in a month (0 cases Jan–Sep 2026) | A provisional deduction links to one salary row; the other company's run skips it | PR-5 |
| K9 | No settlement module; Exited staff leave Stage 7 | Recover at exit; the final monthly payroll; residual by receipt or admin-approved write-off | PR-7 |
| K10 | Sales payroll rarely finalised or marked paid | Sales uses the same loan close; held = row status Hold | PR-8 |
| K11 | First EMI month | The earliest month after disbursement whose close has not happened; later only | PR-2, PR-3 |
| K12 | Sales month mapping | §5.3 | PR-8 |
| K13 | Schema changes in a fragile file | Clean rebuild guarded by an emptiness check | PR-1 |
| K14 | Finalise lock is plant-wide | Separate track | PR-F |
| K15 | Tax on interest-free loans | Monthly perquisite report for the CA; no TDS automation | PR-9; **CA** |
| K16 | Contract workers (331 of 783 active plant staff) | Eligibility by employment type (D-17) | PR-2 |
| K17 | Disbursement channel | Record mode, date and reference (D-18) | PR-3, PR-4 |
| K18 | "Salary Advance" loan type overlaps the advance module | Removed from loan types (D-23) | PR-1, PR-3 |
| K19 | Stage 7 re-run re-holds a released salary (L1) | P1 first; close and sweep re-check hold status at posting | P1, PR-6 |
| K20 | Stage 6 re-run reactivates leavers (L2) | P2 first; the exit flag lives on the loan | P2, PR-7 |
| K21 | PR-1 would break Mark Left | PR-1 rewrites the block in the same PR | PR-1 |
| K22 | A posted amount may not fit a later re-run; sales net can go negative | Unborne part → new last instalment, flagged; sales ₹0 floor | PR-5, PR-8 |
| K23 | Reimport deletes salary rows | Keyed by loan + month + payroll, never by salary row id | PR-1, PR-5 |
| K24 | No salary row id at compute time; loan step too early (L615) | Compute after all deductions; write after the save | PR-5 |
| K25 | One transaction for all employees, no savepoint (`recompute.js` L325–358) | Per-employee savepoint | PR-5 |
| K26 | Loans may starve under the cap (advance recovery uncapped, L187–196) | Extension limit of 3 months; projection and warning at approval | PR-2, PR-4, PR-6 |
| K27 | Closing before payroll is computed | Close waits for plant Stage 7 + sales upload; notifies finance | PR-6 |
| K28 | Deferring a held EMI leaves the old deduction on the salary row | Row marked stale; release refused until re-run | PR-6 |
| K29 | Stale rows from employees skipped on a re-run (`recompute.js` L334–343) | Each run clears its own provisional rows; close posts only rows from the latest run | PR-5 |
| K30 | Other screens change deductions without the engine | P3 retires manual-deductions; sales edits re-run the engine | P3, PR-8 |
| K31 | Sales hold is HR's to set and lift (`sales.js` L2442–2448: computed, reviewed and finalized → hold; hold → computed or reviewed) | A row with a posted loan deduction cannot move to Hold | PR-8 |
| K32 | Plant code never sets Exited | Drop the "before Exited" gate; the loan stays in Recover at exit until settled | PR-7 |
| K33 | Scheduled close and server restarts | Catch-up at boot; a unique close per month and payroll; one transaction | PR-6 |
| K34 | Reconciliation would depend on an off-by-default switch (`DRIFT_MONITOR_ENABLED`) | Reconcile in every close and on the screen as well | PR-6 |
| K35 | Audit and law | A write-off is a taxable benefit (TDS in the final month); the 2-working-day exit rule; reversals as opposite entries; separation of duties; signed agreement; numbered receipts; a deduction register | PR-3, PR-6, PR-7, PR-9; **consultant, CA** |
| K36 | Cutover of 10–30 manually recovered loans (L4) | One named cutover month; accounts stops the manual adjustment; opening entries; EMI checked against the Excel | PR-10; **accounts Excel** |
| K37 | Old loan records have names, not codes | Import screen proposes codes; nothing imports until HR confirms each match | PR-10 |

---

## 11. Go-live checklist (pilot and handover)

The per-PR acceptance tests in §9 are the sandbox gate. On top of them:

- [ ] Full sandbox dry run: 3 test loans through create → approve → disburse → Stage 7 twice →
      **loan close** → next month.
- [ ] A one-page HR and finance procedure written.
- [ ] A pilot with 2–3 real loans for one month, tracked in parallel by hand.
- [ ] Finance sign-off to open the module to everyone.
- [ ] Cutover month: for every imported borrower, the app's EMI equals the Excel EMI and the
      app's net pay equals the bank payment.
- [ ] Accounts' written confirmation that manual loan adjustments stopped from the cutover month.
- [ ] Disbursement refused without a signed agreement attached.

---

## 12. Open questions

### 12.1 Waiting on outside advice or input

| # | Question | Who | Blocks |
| --- | --- | --- | --- |
| Q1 | What is the 50% cap measured on: earned base pay, base plus OT and extra duty, or a lower internal cap? (default: earned base pay) | Labour consultant | Final cap value; PR-5 goes ahead on the default |
| Q2 | Does the 2-working-day exit-payment rule (Code on Wages s.17(2)) apply? If it does, a separate final-settlement run is needed and PR-7 grows | Labour consultant | PR-7 scope (D-21) |
| Q3 | Is ₹20,000 the right perquisite threshold for interest-free loans? | CA | PR-9 perquisite report |
| Q4 | How should TDS be applied to a written-off balance in the final month? | CA | PR-7, PR-9 |
| Q5 | Should advance recovery also respect the deduction cap? | Owner, after Q1 | Its own PR, if yes (D-20) |
| Q6 | Is the employee portal used? | Owner | PR-9 portal view (D-22) |
| Q7 | The accounts Excel of 10–30 running loans | Owner / accounts | PR-10 |

### 12.2 Conflicts in the source plan: resolved, recorded for traceability

The source plan was written before some rulings and kept older wording in places. The
coordinator ruled on each one on 9 Oct 2026, and this spec follows those rulings:

1. **Approvals.** The plan's loan-states table, Rule 11, the recommendation text of Decisions 7
   and 15, and the capability table say **finance** approves, rejects or approves write-offs.
   **Ruling:** ruling 3 everywhere. The admin approves every loan, defer, restructure and
   write-off; finance only records disbursements and receipts; HR raises; nobody approves their
   own request.
2. **"Settled at exit"** was listed as "HR, finance approves". **Ruling:** it is not a manual move.
   The loan settles automatically when the exit balance reaches zero, by final-payroll recovery,
   a numbered cash receipt (finance), or an admin-approved write-off (§5.4).
3. **"Posted on finalise"** in the plan's checklist and dry run is superseded by the monthly loan
   close.
4. **"Finance cannot approve a loan they raised"** is superseded: finance cannot approve at all.
5. **Kink count.** The plan's verdict says 35; the register runs K1–K37. **37 is correct.**

### 12.3 Stale code references corrected from the source plan (checked at `1aa6ca4`)

| Plan said | Now |
| --- | --- |
| `payroll.js` L728 (manual-deductions) | L727 (doc comment L725) |
| `loans.js` L171–221 (process-deductions) | L171–217 |
| `loans.js` L224–292 (recover) | L224–288 |
| `loans.js` L295–323 (skip) | L295–326 |
| `loanService.js` L68–94 (schedule) | L73–102 |
| `loanService.js` L170–176 (employee-tab count) | L161–170 |
| `employees.js` L728–733 / L729–734 (Mark Left loan block) | L733–738 (route L705; shifted by PR #46) |
| `financeAudit.js` L66 | L67 |
| `recompute.js` L85–90 | L86–90 |
| `sales.js` L2442–2448 "computed or finalized → hold and back" | computed, reviewed and finalized → hold; hold → computed or reviewed |

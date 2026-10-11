# N-MONEY — PROGRESS
## Steps
- [x] Phase 0: code read, prod counts (read-only), PLAN.md — waiting for planner "go"
- [ ] Baseline jest
- [x] financeAudit.js guard + shared decideManualFlag + one transaction (single + bulk), 409 GROSS_MOVED_SINCE
- [x] salary-input.js resolveApproval (absent keeps, gross explicit or sum) + istToday + approval_preview on pending list
- [x] SalaryInput.jsx approver card: kept note, write gross, red highlight when it differs
- [x] salaryFlagRevertAndApprove.test.js 18/18; on c942563f 13 fail / 5 pass (controls)
- [x] full suite: base c942563f 99/1566 green; branch 98/100, 3 fail (statutoryWriters T11b ×2, salaryChangeSelfApproval ×1) — old 'absent→0' expectations; asked planner to edit (not my files)
- [x] check script 29/29; --base 6/6 (gross not reverted, conveyance ₹0)
- [x] merged origin/main c0d03075 (84fde3bf)
- [x] planner yes: statutoryWriters NEW_SPLIT + salaryChangeSelfApproval raise() state every component; P1-22 script T2202/T2205 follow kept wording
- [x] after merge: jest 101 suites / 1593 all green; new check 29/29; P1-22 check 58/58 (rebuilt dist)
- [ ] scratch sim + drift 0
- [ ] merge origin/main, push, report
## Rulings (planner, 11 Oct)
- Q1 yes: 409 when current gross differs from flag manual_value by > ₹1, message says so.
- Q2 yes: single route all-or-nothing, 500, nothing written.
- Q3 (a): gross = sum of resolved components; SalaryInput.jsx approver card (owned now) shows kept value "not in this request — current value kept" + resulting gross, highlighted when it differs.
- Q4 report only. Q5 bulk all-or-nothing. employees.js untouched.
## CLAUDE.md entry
## Last Session — 2026-10-11 (N-MONEY: flag reject reverts in bulk; salary approval keeps components it was not given)
**Branch `fix/salary-flag-reject-revert`, NOT merged. MONEY PR — independent review before PR.** Plan: `docs/ux-bulk/prs/N-MONEY/PLAN.md`.
- **N-16:** `PUT /finance-audit/approve-flag/:id` + `/bulk-approve` now `requireFinanceOrAdmin` (prod reviewers: admin/finance only).
  Shared `decideManualFlag()` — bulk REJECT of a GROSS_STRUCTURE_CHANGE flag reverts employees.gross + latest structure, writes
  finance_rejections + FINANCE_FLAG_* + FINANCE_GROSS_REVERT audit exactly like the single route. Single = one txn, bulk = one
  txn for the batch (Q2/Q5: any failure → 500, nothing written). An already-rejected flag is never reverted twice. If the
  employee gross differs from the flag's new value by > ₹1 → 409 `GROSS_MOVED_SINCE` (Q1), nothing written.
- **N-17:** `PUT /salary-input/approve/:id` — `resolveApproval()`: a component absent from the request keeps the structure in force
  at effectiveFrom; present (0 incl.) written as sent; gross = explicit gross_salary, else sum of resolved components (Q3a).
  Default effectiveFrom = IST today. `GET /pending-changes` returns `approval_preview` {components, kept, gross, effective_from}
  from the same function; SalaryInput approver card shows kept values ("not in this request — current value kept") and the
  gross the approval writes, red when it differs from the request's gross.
- **Prod (counts, not repaired, Q4):** 43 employees had a non-zero conveyance zeroed by an approval; 1 GROSS flag rejected via
  bulk never reverted (gross has moved since).
- **Fragile:** Salary-Input requests carry no special/gross → approved gross = request sum + kept special (shown red on the card).
  `logAudit` writes through getDb() (same connection as the txn). P1-22 browser script updated to the kept-value wording.
- **Verified:** new `salaryFlagRevertAndApprove.test.js` 19 (13 fail on c942563f; the 6 that pass are controls); check script
  29/29, `--base` 6/6; Stage 7 drift 0; P1-22 check 58/58; jest 101 suites / 1593. **Not tested:** Railway; production data.

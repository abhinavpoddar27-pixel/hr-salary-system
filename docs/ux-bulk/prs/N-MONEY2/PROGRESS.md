# N-MONEY2 — money permission batch 4 (branch fix/money-permission-batch4, from origin/main 8abee96)

## RESUME
Read this file, then `git log --oneline origin/main..HEAD`. State: BUILT, verified, pushed. Nothing left but planner review.

## Rulings taken by the builder (planner to confirm)
- R1 (N-19): a split change at the same gross → salary_change_requests row (new_gross = old_gross = current gross),
  same builder as the gross path. pt_applicable and PF wage ceiling keep the direct write (statutory, per brief).
- R2 (N-19): no structure on record → the window's split is compared with the 50/20/0 default Stage 7 would
  auto-create; equal → created directly (as before), different → approval.
- R3 (N-19): split fields: missing / blank / unreadable → the stored value (0 is kept as 0); a percentage outside
  0–100 or a negative other allowance / ceiling → 400 SPLIT_OUT_OF_RANGE before anything is written.
- R4 (N-23): "who caused the flag" = salary_manual_flags.changed_by when it is a person (it is always 'system'
  today), and for GROSS_STRUCTURE_CHANGE the requested_by of the matching request: the employee's LATEST Approved
  request that changed the gross (new ≠ old), with new_gross = flag.manual_value ± ₹1. No match → no block.
- R5 (N-23): salary_change_requests.status has no CHECK constraint → a reverted request is set to 'Reverted'
  (only from 'Approved') + one audit_log row (stage FINANCE_GROSS_REVERT).
- R6 (ED): bulk-finance-approve reports ineligible grants in `skipped` (like bulk-finance-return); empty ids → 400.

## Done
1. employees.js PUT /:code/salary — dabeeb1
2. financeAudit.js approve-flag + bulk-approve — 6b4cdb0
3. extraDutyGrants.js finance-approve + bulk — 6d667ca
4. taxDeclarations.js GET guards — ba484dc
5. payroll.js guard lines (calculate-days, compute-salary, finalise) — a3e131a
6. FinanceAudit.jsx attendance flags — 9ea3c3c, 9e7cd18 (no-cache read so Verify clears at once)
7. Tests — 66e1105 (moneyPermissionBatch4.test.js 35; 24 fail on origin/main, the 11 that pass are controls)
8. F-1 (planner ruling 12 Oct: salary-input.js handed over) — `PUT /salary-input/approve/:id` writes the request's
   basic/hra/da_percent (0–100, present only) to the new row (insert path) and to a same-date row (update path);
   a request without them keeps the in-force row's percents. resolveApproval unchanged. +4 tests (3 fail on dffb8fe;
   the 4th — no-percent request — is the control).

## Verified
- jest 116 suites / 2079 (was 115 / 2040). employeeBankColumns "changed split writes" test changed on purpose.
- backend/scripts/attendance-flags-verify-role-check.py 21/21 twice; --base on origin/main 2/2 (hr sees Verify;
  a finance_verified=1 row without verified_by shows as unverified).
- Re-run: ed-return-simulation.py 29/29, salary-flag-revert-and-approve-check.py 31/31, salary-change-approver-view-check.py
  58/58 (after F-1). frontend build OK.

## CLAUDE.md entry
## Last Session — 2026-10-12 (N-MONEY2: money permission batch 4)
**Branch `fix/money-permission-batch4`, NOT merged. MONEY PR.** Plan + log: `docs/ux-bulk/prs/N-MONEY2/PROGRESS.md`.
- **N-19:** `PUT /employees/:code/salary` same gross + changed split → salary_change_requests (finance decides, P1-23 applies);
  untouched save still `structureUnchanged`; explicit 0 % kept (was 50/20); bad range → 400 SPLIT_OUT_OF_RANGE. PF ceiling + pt direct.
- **N-23:** approve-flag / bulk-approve refuse 403 SELF_APPROVAL when the decider requested the gross change behind the flag
  (bulk: whole batch). A gross revert sets the matching request to status 'Reverted' + audit row; reply says re-run Stage 7.
- **ED:** finance-approve only APPROVED + UNREVIEWED/FINANCE_FLAGGED (else 409; rejected → "Return to HR"); bulk → `skipped`.
- **Guards:** GET /tax-declarations/:code(+/calculate) and POST /payroll/calculate-days, compute-salary, finalise → hr/finance/admin.
- **UI:** Attendance Flags reads `finance_verified` (no `verified` column), Verify only for finance/admin, list read no-cache.
- **F-1:** `PUT /salary-input/approve/:id` writes the request's basic/hra/da_percent (Employee Master requests carry them);
  a request without them keeps the in-force row's % (Salary Input page). Later gross changes keep the approved split.
- **Fragile:** request match = latest Approved gross-changing request. 'Reverted' has no badge in SalaryInput history.
- **Verified:** jest 115/2040 → 116/2079; attendance-flags check 21/21, --base 2/2. **Not tested:** Railway; production data.

## Findings not fixed (outside owned files)
- F-1 FIXED on this branch (see Done 8).
- F-2 SalaryInput.jsx history has no badge for status 'Reverted' (renders nothing).
- F-3 ExtraDutyGrants.jsx bulk approve toast ignores `skipped`; single approve has no onError toast of its own.
- F-4 hr gets a 403 from GET /comp-off/pending on every Finance Audit load (Comp Off tab badge).
- F-5 manual-flags verify has no maker-checker; mark-present is finance/admin-only, so the same finance user can
  mark present and verify it.
- F-6 Employees.jsx shows "submitted for finance approval" even when the reply is "already pending" (nothing new raised).

## Open questions (owner / planner)
- Q1 N-23: should the finance user who APPROVED the gross request also be barred from deciding its flag?
- Q2 PF wage ceiling at the same gross is still a direct write (statutory per brief) — it moves PF; approval instead?
- Q3 (out of scope, N-13) POST /employees still accepts gross on create with no approval.

## Merge with main (12 Oct 2026, 23:55 IST)
#156 (payroll Stage 6/7/finalise guard) and #160 (tax-declaration guard, manual-flag Verify for finance only,
`finance_verified`) landed first and do items 4, 5 and the Verify half of 6. Conflicts resolved by taking main's
payroll.js, taxDeclarations.js and FinanceAudit.jsx; this PR keeps only the no-cache read for the flags list on top
(the row kept its Verify button for up to 5 s after a verify). Check script now expects main's "Awaiting finance"
note. jest 120 suites / 2161 green; attendance-flags-verify-role-check 21/21.
What this PR still adds: N-19 (split changes need approval, explicit 0 %, approved split sticks), N-23 (flag
maker-checker + Reverted status), ED finance-approve state check.

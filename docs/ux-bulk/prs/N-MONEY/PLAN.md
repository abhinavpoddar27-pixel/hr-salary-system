# N-MONEY — PLAN (Phase 0)
Branch fix/salary-flag-reject-revert on origin/main c942563f. MONEY PR. Owned: financeAudit.js (approve-flag + bulk-approve), salary-input.js (approve).

## 1. What the code does today (read, not guessed)
- GROSS_STRUCTURE_CHANGE flags are written by Stage 7 (`salaryComputation.populateManualFlags`, UPSERT on
  (code, month, year, flag_type); `system_value` = previous month's gross, `manual_value` = this month's gross). The UPSERT
  does NOT reset `finance_approved`.
- `PUT /finance-audit/approve-flag/:flagId` (L1341): no role guard (router behind requireAuth only). On REJECTED +
  GROSS_STRUCTURE_CHANGE: finance_rejections row, employees.gross_salary := system_value, `syncSalaryStructureFromEmployee`
  (scales the LATEST structure row in place), audit FINANCE_GROSS_REVERT. NOT in one transaction; revert errors are
  swallowed (flag still says rejected, gross not reverted). Rejecting the same flag twice reverts twice.
- `PUT /finance-audit/bulk-approve` (L1416): no role guard; updates flag + finance_approvals only. No revert, no
  finance_rejections, no audit row at all.
- `PUT /salary-input/approve/:id` (L158): every component = `parseFloat(newStructure.x) || 0`. Writers:
  Salary Input (`request-change`, UI form): keys basic/da/hra/conveyance/other_allowances — no special_allowance, no
  gross_salary. Employee Master (`PUT /employees/:code/salary`): gross_salary/basic/da/hra/special_allowance/other_allowances
  — no conveyance. `effectiveFrom` default = UTC date (`toISOString`), so 00:00–05:29 IST approvals are dated yesterday.

## 2. Production (read-only, counts only)
- salary_change_requests: Approved 290 (256 without conveyance key, 34 without special_allowance/gross key); Pending 2
  (both without conveyance); Rejected 8.
- Approved requests that dropped a NON-ZERO conveyance (old_structure.conveyance > 0): **43 employees**; on all 43 the
  latest structure has conveyance 0 AND components ≠ structure gross by > ₹1. Dropped non-zero special: 0.
- GROSS_STRUCTURE_CHANGE flags: 119 pending, 1 approved, **1 rejected — no FINANCE_FLAG_REJECT audit and no
  GROSS_STRUCTURE_CHANGE_REVERT row → rejected through bulk, never reverted** (Mar 2026). That employee's gross today equals
  NEITHER the flag's old nor new value (moved again since; 6 later salary rows).
- finance_approvals reviewers: admin 215, finance 56, nobody else → the role guard breaks no real caller.
- No data repair in this PR (owner's call; see Q4).

## 3. Smallest change
### financeAudit.js
1. `requireFinanceOrAdmin` on both routes (already imported; 403 before any read).
2. Extract `rejectGrossFlag(db, flag, reviewer, comments, user)` from the single route's block (same rows, same text);
   both routes call it. Each route's per-flag work (flag UPDATE + finance_approvals + audit + revert) runs in ONE
   db.transaction; bulk = one transaction for the whole batch (any revert failure → whole batch rolls back, 409/500 with
   the flag id). Single route stops swallowing revert errors (rolls back instead) — behaviour change, see Q2.
3. Bulk writes the same per-flag `logAudit` row the single route writes (FINANCE_FLAG_*), on the transaction's handle.
4. Revert only when the flag is not already rejected (no double revert) and — proposed guard, Q1 — only when the
   employee's current gross still equals `manual_value`; otherwise refuse that flag (409 GROSS_MOVED_SINCE) so a stale
   rejection never overwrites a newer approved salary.
### salary-input.js approve
5. Read the latest structure (`structureForDate` at effectiveFrom, else latest) inside the txn; for each of
   basic/da/hra/conveyance/special_allowance/other_allowances: key ABSENT (undefined/null) → keep current value; present
   (incl. 0) → parseFloat. Gross: explicit `gross_salary` if present, else sum of the resolved components (Q3).
6. effectiveFrom default = IST today (`new Date(Date.now()+330*60000).toISOString().slice(0,10)`, inline helper).
No other file. salaryComputation.js / employees.js / schema untouched.

## 4. Tests (jest, real JWTs, new file `salaryFlagRevertAndApprove.test.js`)
- viewer/hr/supervisor → 403 on approve-flag and bulk-approve; finance + admin 200.
- bulk REJECT of a gross flag: employees.gross + latest structure reverted, finance_rejections row, FINANCE_FLAG_REJECT +
  FINANCE_GROSS_REVERT audit — same rows as the single route (compared on twin DBs). Mixed batch (gross + TDS flags).
- second reject of same flag: no second revert/row. Gross moved since → 409, nothing written (Q1).
- forced revert failure → whole bulk batch unchanged.
- approve: Salary-Input-shaped request keeps current special; EM-shaped keeps current conveyance; explicit 0 stays 0;
  gross resolution per Q3; jest fake clock 2026-10-10T19:00Z (= 00:30 IST 11 Oct) → effective_from 2026-10-11.
- Fail-on-base proof for each; full suite before/after; scratch-DB sim: approve → Stage 7 → drift query 0.

## 5. Risks
- Keeping an absent component changes the money on the next Stage 7 for future approvals (that is the fix). Stage 7 scales
  components to the stated gross, so with an explicit gross the net gross paid is the same; the split (PF base) moves.
- Bulk becomes all-or-nothing; a single bad flag blocks the batch (clear error with id).
- `syncSalaryStructureFromEmployee` lives in employees.js (not mine) — used as is, not edited.

## 6. Questions for the planner
- Q1: Guard the revert when the employee's gross has moved since the flag (current ≠ manual_value) → refuse with 409?
  (The one prod rejected flag is exactly this case.) Alternative: revert anyway (today's single-route behaviour).
- Q2: Single route — make flag status + revert atomic (failure → 500, nothing written) instead of today's
  "flag rejected, gross not reverted, error logged"? Recommended yes.
- Q3 (money): Salary Input requests have no gross_salary and the screen's "new gross" EXCLUDES special allowance. Keeping
  the current special and summing makes approved gross = request.new_gross + current special (higher than what HR saw).
  Options: (a) sum resolved components (literal finding), (b) Salary-Input shape → keep special but gross = request's
  new_gross + kept special shown nowhere… recommend (a) plus the response/audit noting the kept components; or
  (c) treat a request with no gross_salary as stating gross = its own sum and keep special only as a component (sum ≠ gross).
  Prod impact today: 0 approved requests dropped a non-zero special, so (a) vs (c) only matters going forward.
- Q4: The 43 employees whose conveyance was zeroed and the 1 never-reverted rejected flag — leave as is (report only)?
- Q5: Bulk all-or-nothing vs skip-and-report per flag? Recommend all-or-nothing (money).

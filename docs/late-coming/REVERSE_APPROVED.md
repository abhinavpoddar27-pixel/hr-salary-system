# Reverse an approved late-coming deduction

**Branch** `feat/late-deduction-reverse`. Owner 12 Oct 2026: some people were wrongly penalised for late coming;
September salary not yet paid. No protected file touched, no schema change.

- **Gap:** `PUT /late-coming/finance-review/:id` only decides PENDING rows. An approved deduction could not be undone,
  and every Stage 7 run took it again.
- **New:** `PUT /api/late-coming/finance-reverse/:id { remark }` — finance/admin only (`requireFinanceOrAdmin`), reason
  ≥ 10 characters after trimming. Only an `approved` row; a month with any `monthly_imports.is_finalised = 1` → 409
  `MONTH_FINALISED` (paid salary is returned in a later month instead). One transaction: row → `rejected`,
  `finance_remark = "Reversed after approval: <reason>"`, `is_applied_to_salary = 0`; the person's `day_calculations`
  row(s) for that month → `salary_stale = 1` (Stage 7 banner + finalise blocked until recompute); `finance_approvals`
  row `reversed`; `audit_log` action `finance_reverse`; HR notification. UPDATE re-checks `approved` (a double call → 409).
- **Pay:** Stage 7 reads only approved rows, so re-running Compute Salary for the month drops the deduction and clears
  the stale flag. Net pay rises by the reversed amount.
- **UI:** Finance Audit → Late Coming → Reviewed History: "Reverse" on approved rows (finance/admin), dialog with the
  person, days, whether it is already in salary, a reason (10+ chars, counter), one request per click; the row then shows
  "Reversed". The deduction list read sends `no-cache` so the change shows at once.
- **Verified:** jest `lateDeductionReverse.test.js` 5 (real JWTs + real recomputeSalary: ₹1,500 deduction gone after
  re-run, net +1,500, stale cleared; hr/viewer/no login refused; short reason, pending/rejected, unknown id, finalised
  month, second call refused); full suite 114 / 2026. `backend/scripts/late-deduction-reverse-check.py` 30/30 (Chromium,
  built dist, finance + hr, 390 px, 0 page/console errors, 0 API ≥ 400); `--base` on main 2/2 (no Reverse button).
- **Production (read-only, 12 Oct):** Sep 2026 has 11 approved late deductions in salary (₹10,713), all entered through
  the retired Late Coming screen; Sep has 0 stale day calculations, so after a reversal the stale count = the people reversed.
- **Not tested:** Railway; a reversal on a month already partly finalised for one company only (refused for the month).

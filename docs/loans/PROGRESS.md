# Loans programme: progress tracker

Spec: [`SPEC.md`](SPEC.md). Update this file **after every step** of every loan PR, so that
after a context compaction or a new session there is a file to read and build from.

## RESUME (read this first)

- **As of:** 2026-10-09.
- **Current state:** Loans PR-0 (this spec) is open, docs only, branch `docs/loans-spec`.
  Phase 0 live-payroll fixes P1–P3 are open and not merged.
- **Next PR:** Loans PR-1 (schema), branch `feat/loans-pr1`. It starts only after the
  Phase 0 → A gate (SPEC §9.3).
- **Blockers:**
  - P1 (#48), P2 (#49) and P3 (#50) need to be merged, deployed and verified.
  - Finance is checking the 35 re-held rows that were released to be paid, against what was
    actually paid. (There are 54 re-held rows in all: 35 released to be paid, 17 with notes
    saying already paid outside the app, 2 with nothing payable.)
  - HR is confirming the 98 Active employees who carry an exit date.
- **Waiting on the owner:**
  1. Review and merge #48, #49, #50 and Loans PR-0.
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
| P1 | `fix/hold-release-survives-recompute` | Open | #48 | — | — |
| P2 | `fix/stage6-no-reactivate-leavers` | Open | #49 | — | — |
| P3 | `fix/retire-manual-deductions-endpoint` | Open | #50 | — | — |
| Loans PR-0 | `docs/loans-spec` | Open (this PR) | see GitHub | — | n/a (docs only) |
| Loans PR-1 | `feat/loans-pr1` | Not started | — | — | — |
| Loans PR-2 | `feat/loans-pr2` | Not started | — | — | — |
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

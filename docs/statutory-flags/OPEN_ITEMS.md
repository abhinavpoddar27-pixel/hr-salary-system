# STATUTORY FLAGS — OPEN ITEMS

## Owner decisions (build proceeds on the DEFAULT unless the owner says otherwise)
- D1 Sales ESI list. Owner said "the 49 we deducted" (August). The **September** sales register,
  which is the one actually paid, deducts ESI for **57**: adds S022, S038, S044, S054, S061, S121,
  S123, S135, S196, S201, S251; drops S058 (0 days), S089 (gross > ₹21k), S279, S291.
  DEFAULT: use the September 57 (file as built). Alternative: rebuild the file with the August 49.
- D2 Single path for flag changes (BUILD_PLAN 4.4). DEFAULT: yes.
- D3 **Sales September — what did the bank actually pay?** App rows have zero deductions and
  `neft_exported_at` = 7 Oct on 187 rows (the app NEFT file = full gross). The manual register's
  NET PAID is ₹1,19,786 lower on those 187 rows (ESI ₹6,541 · LWF ₹645 · TDS ₹2,000 ·
  other ₹1,10,600 — S150 ₹60,000, S163 ₹25,000, S158 ₹15,000, S230 ₹5,000, S157 ₹3,600,
  S021 ₹2,000; TDS ₹1,000 each S189, S240).
  - If the bank paid the **register** amounts → recompute sales Sep after PR-1+PR-2, then HR enters
    the other deductions / TDS so app net = NET PAID (RUNBOOK step 6A).
  - If the bank paid the **app NEFT file** → employees were paid gross; no recompute of Sep sales;
    statutory amounts for Sep become a company cost / recovery decision (RUNBOOK step 6B).
  BLOCKS: sales September recompute only. Does not block the build.
  (Register LWF: 139 × ₹5 = ₹695 = ₹645 on the 187 exported rows + ₹50 on 10 rows on hold.)
- D6 **Plant September — already paid?** App rows for September have no statutory deductions and are not
  finalised. If September wages were already paid (from the manual register or an app bank file), the
  September recompute (RUNBOOK T6) is for the record only — do not regenerate or re-send any bank file.
  If not yet paid, T6 is the live payroll run.
- D5 Timing. The September ESI challan is due 15 Oct 2026. Three PRs on fragile files will not be live
  and verified by then. DEFAULT: file September ESI from the manual registers as usual; the app takes
  over from the October wage month, with September recomputed in the app for the record.
- D4 OPT-1 EPS nil at age 58+ (18054 is 62). Needs DOB; touches salaryComputation.js PF block.
  DEFAULT: not in this build.

## Data HR must fix (not code)
- UAN for 19222 and 22331 (PF ON, no UAN — needed for the ECR, not for the calculation).
- DOJ and DOB for 22331.
- Plant ESI numbers (owner will supply) → re-upload the plant file with the `esi_number` column filled.
- Sales ESI numbers for the 11 people new in September (no number in the August register).

## Security — act separately, today
- `sales_master_import.sql` at the repo root holds 167 INSERT rows with names and bank account numbers
  (139 rows). This session's git proxy reported the repo as **public**. Confirm in GitHub → Settings →
  General → Danger Zone → visibility; if public, make it private first, then remove the file and plan a
  history rewrite. Same class of incident as April 2026 (CLAUDE.md, Bug Reporter exposure).

## Noted, out of scope
- `payroll.js` manual-deductions route omits late/early-exit from total_deductions (pre-existing; no UI caller).
- ESI rounding: registers round to the rupee, app to paise.
- Punjab LWF is being deducted for sales staff based in other states (Delhi, UP, Haryana) — owner ruling
  follows the register; flag to the compliance consultant.
- 22127 is Active with company `null`, not paid in Aug or Sep — likely should be marked Left.
- Manual "SUM" sheet (August plant) total deductions ₹7,94,454 vs its own lines ₹8,92,422.
- Salary approvals write structure rows dated the approval day (e.g. 2026-09-06, 2026-09-11); plant compute
  only uses a row from the month after (`<= YYYY-MM-01`). Gross still comes from `employees.gross_salary`, but
  component splits lag a month. Pre-existing.
- Plant compute takes the stated gross from `employees.gross_salary` for every month it computes (salaryComputation.js
  'Priority: employees.gross_salary'), so after any approved gross change a re-run of an EARLIER month is paid at the
  new gross (components re-scaled). Seen while testing review fix 1 (10 Oct 2026). Pre-existing; money logic in a
  DO-NOT-MODIFY file, not touched. Owner: decide whether a historical re-run should read the dated structure's gross.
- PF scope widening (EPF ceiling ₹25,000 from 17 Sep 2026, S.O. 5109(E)) — owner chose to keep the 6.

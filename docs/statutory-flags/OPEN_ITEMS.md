# STATUTORY FLAGS — OPEN ITEMS

## Owner decisions (build proceeds on the DEFAULT unless the owner says otherwise)
- D1 Sales ESI list. Owner said "the 49 we deducted" (August). The **September** sales register,
  which is the one actually paid, deducts ESI for **57**: adds S022, S038, S044, S054, S061, S121,
  S123, S135, S196, S201, S251; drops S058, S089, S279, S291 (reasons in the private claude.ai project doc).
  DEFAULT: use the September 57 (file as built). Alternative: rebuild the file with the August 49.
- D2 Single path for flag changes (BUILD_PLAN 4.4). DEFAULT: yes.
- D3 **Sales September — what did the bank actually pay?** App rows have zero deductions and
  `neft_exported_at` = 7 Oct on 187 rows (the app NEFT file = full gross). The manual register's
  NET PAID is ₹1,19,786 lower on those 187 rows (ESI ₹6,541 · LWF ₹645 · TDS ₹2,000 ·
  other ₹1,10,600 across 6 employees; TDS across 2 — per-person split in the private claude.ai project doc).
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
- D4 OPT-1 EPS nil at age 58+ (one of the 6 PF employees is past 58). Needs DOB; touches salaryComputation.js PF block.
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
- employees.js PUT /:code/salary same-gross split edit updates only the latest-dated row (~678–686). After an upload, an
  employee whose latest row is dated after the effective month's 1st (e.g. 2026-09-06 / 2026-09-11 — about 8 people,
  incl. one PF employee) keeps September on the upload's 2026-09-01 copy, so a split edit made now does not reach
  September's PF base. Same family as the 'splits lag a month' item. Follow-up PR; HR to avoid split-only edits for
  those employees until then.
- PF scope widening (EPF ceiling ₹25,000 from 17 Sep 2026, S.O. 5109(E)) — owner chose to keep the 6.

## Added by PR-2b (sales LWF, 10 Oct 2026)
- N3 Sales `paid` is terminal: `PUT /api/sales/salary/:id` refuses a `paid` (or `finalized`) row with 409 and there is
  no move out of `paid`. So Other Deductions / TDS can never be entered on a paid sales row. Production 11:45 IST
  (C2): September sales has 0 finalized, 0 paid (215 computed incl. 187 NEFT-exported + 15 hold), so a 6A run can
  still take them; any row moved to `paid` first cannot.
- N5 (review C5) A flagged sales row with a tiny earned gross and NO loan can go negative by the ₹5 LWF — e.g. 0 days
  given but a gazetted holiday in the cycle gives gross_earned > 0, so LWF is charged (R7 literal), and the ₹0 floor
  applies only to rows that carry a loan (PR-8 Q1). Pinned as current behaviour by `lwfSales.test.js` (C5 / N5 pin);
  no code change. The V8 identity still holds on such a row. Owner: decide whether LWF should need a minimum earned
  gross or days given.
- N9 The LWF amounts (`lwf_employee_amount` '5', `lwf_employer_amount` '20') are not on the Settings → Policy tab;
  change them only through the admin policy API or the SQL Console UI (with a remark). A non-numeric or negative value
  makes compute fall back to 5 / 20 (both payrolls); VERIFY V12 / V14 read the stored value and would list rows.
- N10 Employee Profile shows only total / PF / ESI deductions (the total includes LWF). Employee Quick View reads
  `ee_pf` / `ee_esi` / `basic_earned` / `net_salary`, which the payslip payload never returns — blank already,
  pre-existing, not touched.

## Added by PR-3 (filing, 10 Oct 2026)
- **PR-3b — portal formats, due before the October filing (ESI + PF challans for October wages are due 15 Nov 2026).**
  Owner ruling C2: PR-3 keeps the current line layouts byte-for-byte; fix them in PR-3b. [INFERENCE — confirm each against a
  file the portal actually accepted, or the portal's downloadable template, before building]
  - EPFO ECR 2.0 separates fields with `#~#`, not `|` (exportFormats.js ECR line builder).
  - ECR NCP days undercount (E6): exportFormats.js 48–49 subtracts Sundays and holidays from the calendar days AND then the
    payable days, which already include paid Sundays / holidays — 3 absences can show as NCP 0 (Reports.jsx 782 repeats the formula).
  - ESIC monthly contribution upload is an Excel template: IP number, IP name, days, total wages, reason code, last working day —
    no IP-contribution column (the app's file has one). Reason codes are ESIC's list (0 = none, 1 = on leave, 2 = left service,
    …): the app writes 1 for "joined this month" (plant: calendar month; sales: cycle) — that is not ESIC's code 1 (E7).
  - Amounts are rounded to the rupee per line (Math.round, e.g. ₹130.50 → 131); check the portal's rounding.
  Until PR-3b lands: download, then check against the template before uploading (RUNBOOK T7).
- **Missing must be 0 before filing** (N1, RUNBOOK T7). Rows without a valid UAN / ESI number are left out of the files (D-F2
  default: exclude + list + header + confirm). VERIFY V16 is HR's fix list. Today: plant ESI numbers are not in the app yet
  (data item above) → the plant ESI file would be empty and list every ESI employee as missing until the plant statutory file is
  re-uploaded with numbers; PF without UAN: the two under 'Data HR must fix'.
- ~~PUT `/api/reports/company-config/:id` had no role guard~~ — FIXED in the PR-3 review (D-16): admin only. It held the PF
  establishment / ESI codes, PAN / TAN and the company bank account that head the filing files; no screen edits it.
- N3: a number held by another sales employee is refused even when it is the same person under the other sales company (409
  heldBy) — same as the upload. The check is in-app only (no UNIQUE index), so two edits racing on one number are not stopped.
- The sales ESI file also lists a rep whose in-force structure has ESI on with gross ≤ ₹21,000 even when the cycle earned 0
  (an IP with 0 days, D-F6); the plant file lists contributors only. V16 counts contribution rows only; such a rep without a
  number is a ₹0 `missing` row — informational, it does not block filing (RUNBOOK T7, PR-3 review fix 2).
- Finance gets the sales ESI file through the API only (`/api/sales/export/esi-contribution`); the button sits on the sales
  register, which finance's sidebar does not show. Owner: put a copy on Reports if finance files sales ESI.

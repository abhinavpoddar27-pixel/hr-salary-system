# P1-14 — PLAN (Phase 0)

Finding H-2. Base origin/main c942563f. Branch fix/employee-bank-columns. Production read-only, counts only.

## 1. Every reader and writer of the two pairs (plant `employees`)

Pair A = `account_number` / `ifsc_code`. Pair B = `bank_account` / `ifsc`.

| File:line | R/W | Pair | Notes |
|---|---|---|---|
| services/exportFormats.js:155-156 `generateBankFile` (plant NEFT) | R | A first, then B | `COALESCE(account_number, bank_account)` — an EMPTY STRING in A wins over a set B |
| routes/reports.js:197-198 (bank transfer sheet) | R | A first, then B | same COALESCE (not owned) |
| services/salaryComputation.js:1118-1119 (payslip data) | R | B only | DO-NOT-MODIFY |
| routes/payroll.js:199 (register join) | R | B only | DO-NOT-MODIFY |
| routes/payroll.js:957 (missing-bank check) | R | A and B | "missing" only when both empty |
| routes/employeePortal.js:17 / :141-143 | R / W | B only | portal writes B only (not owned) |
| frontend Employees.jsx:69-71 SalaryModal form | R | A only | shows blank when only B is set |
| frontend Employees.jsx:501-503 drill-down | R | B first, then A | |
| routes/employees.js:291-301 POST / | W | B only | |
| routes/employees.js:458 PUT /:code allowlist | W | A or B, whichever is sent | no mirroring |
| routes/employees.js:614-645 PUT /:code/salary | W | B only | body keys are A-named (`account_number`, `ifsc_code`) but it writes columns B |
| routes/employees.js:962-1050 POST /bulk-import | W | A and B | both from the same file value (already mirrored) |
| recordHistory/groupAndDiff.js:46-48 | masks | both | PII masking only |
| sales tables (`sales_employees.ifsc` etc.) | — | — | separate table, out of scope |

## 2. Production counts (Active employees = 783; read-only, no values)

| | count |
|---|---|
| account: A and B both set, equal | 187 |
| account: both set, differ | 0 |
| account: only A set | 0 |
| account: only B set | 6 (A NULL 5, A = '' 1) |
| account: neither | 590 |
| IFSC: both set, equal | 74 · differ 0 · only A 0 · only B 5 (A NULL 4, A '' 1) · neither 704 |
| A = '' (empty string, not NULL): account_number 321, ifsc_code 434 |
| NEFT-eligible today (exportFormats COALESCE) | 78 |
| NEFT-eligible if '' were treated as missing (NULLIF) | 79 → **1 active employee with a full B pair is left out of the NEFT file today** because A = '' |
| has an account (either pair) but no IFSC in either pair | 114 |
| `PUT /api/employees/:code/salary` calls since 18 Mar 2026 | 727 |

Salary split (latest structure, active, 766 rows): percents not 50/20/0 = 332; `other_allowances` ≠ 0 = 33;
`special_allowance` ≠ 0 = 1; `conveyance` ≠ 0 = 44; stored amounts not equal to gross × stored % (±₹1) = 106.

## 3. What actually goes wrong (three bugs, one save)

1. **Edit never reaches NEFT** when A is set: the modal saves into B; NEFT reads A first. (Today A = B on all 187
   rows, so the next edit on any of them silently diverges — old account goes to the bank.)
2. **Edit WIPES the account** for the 6 B-only rows: the form shows A (blank), the save sends '' → B set NULL.
   Any save of the modal (even just to look at the split) does this.
3. **Split reset**: the form reads `emp.salary_structures?.…` (API key is `salaryStructure`) and is initialised once
   from the LIST row (no structure in it) before the detail query returns → always 50/20/0/0/0. Same-gross save then
   rewrites basic/da/hra/special/other_allowances of the latest structure with those defaults — for the 332
   non-default rows that is a silent salary-component change with no approval. Also `other_allowance` vs column
   `other_allowances`, and `special_allowance_percent` has no column (only the amount) → special/other zeroed.

## 4. Decision: canonical pair = A (`account_number` / `ifsc_code`), B mirrored on every write

Why A: the money readers (plant NEFT, bank transfer sheet) read A first; the modal's field names are A.
Why mirror instead of migrate: payslip (salaryComputation) and payroll.js read B and are DO-NOT-MODIFY. Writing both
means every reader sees the edit with no reader change and no data repair.

## 5. Smallest change (owned files only)

**backend/src/routes/employees.js**
- helper `bankPairWrite(body)` (account / IFSC values, trimmed; IFSC upper-cased? — Q3).
- PUT /:code/salary: accept `account_number`/`ifsc_code` (and legacy `bank_account`/`ifsc` as aliases); when a key
  is present write the value to BOTH columns; when absent keep stored values (A and B untouched). Unchanged
  uan/esi/bank_name/pt logic.
- PUT /:code: if `account_number` or `bank_account` is sent, write the value to both; same for `ifsc_code`/`ifsc`.
  If both of a pair are sent and differ → 400 `BANK_PAIR_MISMATCH` (Q4 — or A wins).
- POST /: write `bankAccount`/`ifsc` into both pairs.
- PUT /:code/salary same-gross branch: if the submitted %s and other allowance equal the stored structure (±0.01),
  do NOT rewrite the structure (Q2). Read special % as special_allowance / gross.
- bulk-import: already writes both — untouched.

**frontend/src/pages/Employees.jsx (SalaryModal only)**
- Render the form only after `getEmployee` returns (loading line until then); initialise from `salaryStructure`
  (basic/hra/da %, special % = special_allowance / gross × 100, other_allowance = other_allowances,
  pf_wage_ceiling).
- Bank fields: `account_number || bank_account`, `ifsc_code || ifsc` (treat '' as missing) so the 6 B-only rows show
  their value and a save no longer wipes them.

**exportFormats.js**: no change planned (Q1).

## 6. Tests

- jest `employeeBankColumns.test.js` (real JWTs, fictional codes): PUT /:code/salary with a new account → both pairs
  = new value, `generateBankFile` row shows it; same via PUT /:code (each key name); B-only employee saved without
  touching bank fields keeps B; omitted keys keep stored values; viewer 403 on both routes; same-gross save with stored
  split → structure byte-identical (incl. other_allowances / special / conveyance); mismatch body → 400 (if Q4 = 400).
  Each run against c942563f first (expect failures).
- NEFT md5 on a scratch DB: generateBankFile for unchanged data, base vs branch → identical.
- Playwright `backend/scripts/employee-bank-columns-check.py` (hr, built dist, port 3114, fictional T95xx): open modal →
  split shows stored values (e.g. 40/25/5) → edit account + IFSC → save → reopen shows new values + same split →
  DB both pairs, NEFT preview has the new account; B-only employee opens with value shown; 390px; 0 page errors.
  `--base` on c942563f: reopen shows 50/20, NEFT keeps old account, B-only save wipes.
- full jest before/after (flock).

## 7. Risks

- Mirroring changes what B-only readers (payslip) see after a PUT /:code that sends only A — intended.
- Same-gross "skip if unchanged" means HR can no longer use a no-op save to "re-normalise" amounts to percentages
  (106 rows differ today) — that re-normalisation was itself an unapproved component change.
- Existing data: 6 B-only rows and 321/434 '' in A stay as they are (no repair, by scope). The 1 row missing from NEFT
  today stays missing until its modal is saved (which will then mirror) or Q1 is taken.

## 8. Questions for the planner

- **Q1** NEFT read: change `exportFormats.generateBankFile` to `COALESCE(NULLIF(TRIM(account_number),''), bank_account)`
  (same for IFSC)? Unchanged-data bytes stay identical EXCEPT the 1 active employee who is wrongly left out today
  would appear. reports.js:197 has the same COALESCE but is not mine. Recommend: yes for exportFormats; reports.js
  to whoever owns it. Or leave both and let the owner repair the 1 row.
- **Q2** Same-gross save with an unchanged split: skip the structure write (recommended), or keep rewriting?
- **Q3** Normalise on write (trim; upper-case IFSC)? Recommend trim only + upper-case IFSC.
- **Q4** PUT /:code with both keys of a pair sent and different: 400 (recommended) or A wins?
- **Q5** employeePortal.js PUT bank writes B only (not my file; portal has 0 employee users). Leave, or hand to its owner?
- **Q6** Clearing the account (blank) in the modal: write NULL to both pairs (recommended), or ignore blanks?

## New findings (not fixed here)
- N-a `PUT /:code/salary` same-gross branch changes salary components with no finance approval (P1-25 closed this on
  PUT /:code only). Q2 narrows it; a real change of split is still direct.
- N-b 114 active employees have an account but no IFSC in either pair (never in NEFT).
- N-c reports.js bank transfer sheet: same '' COALESCE issue.

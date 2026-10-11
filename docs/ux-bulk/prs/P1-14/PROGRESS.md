# P1-14 PROGRESS

## RESUME
Read PROMPT.md, then PLAN.md. DONE — handed off for the planner's independent money review. Nothing left to build.

## Steps
- [x] P0-1 grep readers/writers of both bank pairs (PLAN §1)
- [x] P0-2 production counts, read-only (PLAN §2)
- [x] P0-3 PLAN.md written; committed + pushed
- [x] go received
- [x] B1 jest baseline
- [x] B2 backend employees.js mirror + Q2/Q3/Q4/Q6
- [x] B3 employeePortal.js mirror
- [x] B4 exportFormats NULLIF read
- [x] B5 Employees.jsx SalaryModal
- [x] B6 jest test + md5 proof
- [x] B7 browser check + --base
- [x] B8 merge main, full jest, push

## Results so far
- B1 jest baseline (c942563f): 99 suites / 1566 tests.
- B6 employeeBankColumns.test.js 18/18; on c942563f 12 fail / 6 pass (the 6 = role 403s, untouched-keys, changed split, changed gross, both-empty NEFT).
- md5 scratch DB (81 fictional bank-column combos): no A=''-with-B rows → base = branch 19c77f21…; with them → 16 → 25 file rows, all 16 common lines identical, the 9 added are exactly A=''/B-set rows.

## Owner / planner rulings
Q1 yes: exportFormats bank file reads COALESCE(NULLIF(TRIM(A),''), B) for account and IFSC; md5 unchanged rows, 1 extra row appears. reports.js done by N-REP builder.
Q2 yes: skip structure write when gross AND split unchanged; changed split at same gross = today's behaviour.
Q3 trim account; trim + upper-case IFSC. Q4 400 on mismatched pair. Q5 I now own employeePortal.js — mirror. Q6 blank → NULL both pairs.

- B7 browser check `backend/scripts/employee-bank-columns-check.py` 20/20 (before and after merging main); `--base` on c942563f 10/10.
- B8 merged origin/main; jest 100 suites / 1585 (base 99 / 1566 before the merge).

## CLAUDE.md entry
## Last Session — 2026-10-11 (P1-14: Employee bank edits wrote the wrong column pair; salary split reset on save)
**Branch `fix/employee-bank-columns`, NOT merged. MONEY PR — independent review by the planner.** Plan + log:
`docs/ux-bulk/prs/P1-14/PLAN.md`, `PROGRESS.md`. Finding H-2. Rulings Q1–Q6 (11 Oct 2026).
- **Bug:** employees has two bank pairs — A `account_number`/`ifsc_code` (read FIRST by the plant NEFT file + bank
  transfer sheet) and B `bank_account`/`ifsc` (payslip, payroll register). The Employee Master salary window
  (`PUT /:code/salary`) saved into B only → an edited account never reached NEFT (old account paid); it showed A only,
  so a save wiped the account of B-only employees (6 active); its split read `salary_structures` (API key is
  `salaryStructure`) from the LIST row → always 50/20 and a same-gross save rewrote basic/da/hra/special/other
  (special + other zeroed). NEFT also read `COALESCE(A, B)`, so A = '' hid a filled-in B (1 active person left out).
- **Fix:** new `services/bankPair.js` (`readBankPairs`, `normAccount` trim, `normIfsc` trim + upper, blank → NULL).
  Canonical A, mirror to B on EVERY write: `PUT /:code/salary`, `PUT /:code` (either name; both names with different
  values → 400 `BANK_PAIR_MISMATCH`, nothing written), `POST /`, portal `PATCH /bank-details`. A key left out keeps
  all stored columns. `PUT /:code/salary` same gross AND same split → structure NOT rewritten (`structureUnchanged`);
  a changed split at the same gross still writes (as before). `exportFormats.generateBankFile` reads
  `COALESCE(NULLIF(TRIM(A),''), B)` (Q1). `Employees.jsx` SalaryModal renders only after the no-cache detail fetch,
  form from `salaryStructure` (special % = special_allowance / gross, other = other_allowances), bank fields A else B.
  dist not committed.
- **Fragile:** a new writer of either pair must use `readBankPairs` and write all four columns. `splitUnchanged()`
  compares the fields the window sends — add any new split field there. reports.js bank transfer sheet still had the
  old COALESCE (N-REP builder). Production data NOT repaired: 321 '' in account_number, 434 '' in ifsc_code, 6 B-only
  accounts, 114 with an account and no IFSC — owner decision.
- **Verified:** new `employeeBankColumns.test.js` 18 (12 fail on c942563f; the 6 that pass are role 403s and
  unchanged behaviour). NEFT md5 on a scratch DB (81 fictional combos): without A=''/B-set rows base = branch; with them
  the 16 common lines are identical and only the 9 A=''/B-set rows are added. Browser check 20/20 (hr, built dist,
  port 3114: stored split shown, edit → NEFT has new account, structure byte-identical, reopen inside 5 s shows new
  values, B-only shown + kept + in NEFT, clear → NULL + out of NEFT, 390 px, 0 errors); `--base` 10/10 (50/20, NEFT
  old account, structure rewritten, B-only wiped). jest 99/1566 → 100/1585 (after merging main).
- **Not tested:** Railway; production data; Safari/Firefox.
- **Found, not fixed:** `PUT /:code/salary` same-gross split change still rewrites components with no finance
  approval (planner logged separately); 114 active employees have no IFSC in either pair.

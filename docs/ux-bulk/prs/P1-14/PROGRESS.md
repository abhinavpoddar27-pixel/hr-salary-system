# P1-14 PROGRESS

## RESUME
Read PROMPT.md, then PLAN.md. GO received 11 Oct. Rulings below. Build steps B1..B8.

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
- [ ] B7 browser check + --base
- [ ] B8 merge main, full jest, push

## Results so far
- B1 jest baseline (c942563f): 99 suites / 1566 tests.
- B6 employeeBankColumns.test.js 18/18; on c942563f 12 fail / 6 pass (the 6 = role 403s, untouched-keys, changed split, changed gross, both-empty NEFT).
- md5 scratch DB (81 fictional bank-column combos): no A=''-with-B rows → base = branch 19c77f21…; with them → 16 → 25 file rows, all 16 common lines identical, the 9 added are exactly A=''/B-set rows.

## Owner / planner rulings
Q1 yes: exportFormats bank file reads COALESCE(NULLIF(TRIM(A),''), B) for account and IFSC; md5 unchanged rows, 1 extra row appears. reports.js done by N-REP builder.
Q2 yes: skip structure write when gross AND split unchanged; changed split at same gross = today's behaviour.
Q3 trim account; trim + upper-case IFSC. Q4 400 on mismatched pair. Q5 I now own employeePortal.js — mirror. Q6 blank → NULL both pairs.

## CLAUDE.md entry
(to write at the end)

# N-REP — PROGRESS
## RESUME
DONE. Built, tested, merged origin/main (eed87161), pushed. Planner rulings 11 Oct: Q1 alias yes, Q2 keep cap +
"latest 1,000 of N", Q3 ignore company, Q4 held count/total line + PF/ESI keep held; ADDED P1-14 account/IFSC fallback.
## Steps
- [x] Phase 0 read + prod counts + PLAN.md (3085ca9f)
- [x] jest baseline 99 suites / 1566 (c942563f)
- [x] tests first: reportsCorrectness.test.js 11 — 11/11 fail on c942563f
- [x] backend fix (reports.js) → 11/11 pass; statutoryFilingPlant 20/20 unchanged
- [x] frontend (Reports.jsx: Bank / PF / ESI / Audit blocks)
- [x] browser check backend/scripts/reports-correctness-check.py 55/55; --base on c942563f 4/4 (all 3 bugs)
- [x] merge origin/main (clean, no overlap) → jest 101 suites / 1585 all pass; browser check 55/55 again
- [x] push
## CLAUDE.md entry
## Last Session — 2026-10-11 (N-REP: Reports — bank sheet held salaries, PF/ESI company, Audit Trail month + times)
**Branch `fix/reports-company-held-audit`, NOT merged.** Plan + log: `docs/ux-bulk/prs/N-REP/PLAN.md`, `PROGRESS.md`.
Findings N-3, N-2, N-1 (P1-02 review). Planner rulings Q1–Q4 + P1-14 account fallback (11 Oct).
- **N-3 bank sheet:** `GET /reports/bank-transfer` had no held filter → total included held salaries (prod: Jul 46 rows,
  Aug 16, Sep 19 ≈ ₹0.78 L). Now `COALESCE(sc.salary_held,0) = 0` (bank NEFT file rule); additive `held {count, amount}`;
  `totalAmount`/`count` = sheet rows only. Account / IFSC = `COALESCE(NULLIF(TRIM(e.account_number),''), e.bank_account)`
  (same for ifsc) — the expression P1-14 puts in exportFormats.js, so sheet and NEFT file list the same people.
  UI: total from the server + amber "N held salaries (₹X) are not in this sheet" line.
- **N-2 PF / ESI Statements:** now `${company ? 'AND sc.company = ?' : ''}` (blank = all). Held rows stay (contribution
  still due). Compliance.jsx (already sends company) gets the fix too. Rows with a blank company label drop out when a
  company is selected — same as ECR / ESI / bank files.
- **N-1 Audit Trail:** page read `created_at` (column is `changed_at`) → blank times; month/year ignored → last 1,000 of
  all time. Server: month+year → IST month as a UTC range on the stored column (`changed_at >= datetime(M-01,'-330
  minutes') AND < datetime(M+1-01,'-330 minutes')`); returns `changed_at AS created_at` too (Settings → Audit tab shows
  times without an edit), `total`, `truncated`; cap 1,000 kept (every prod month has > 1,000 rows); company ignored
  (no column). No month → unchanged. UI: IST "DD-MM-YYYY HH:MM", count line "latest 1,000 of N … Not filtered by company",
  CSV column "Timestamp (IST)".
- **Fragile:** the bank-sheet account/IFSC expression must stay identical to exportFormats.js `generateBankFile` (P1-14)
  or sheet and file disagree on who has a bank account. Settings → Audit tab relies on the `created_at` alias.
  `salary_held` NULL counts as not held here but is excluded by the file's `= 0` (prod: 0 NULL rows).
- **Verified:** new `reportsCorrectness.test.js` 11 (11/11 fail on c942563f); jest 99/1566 → 101/1585 after merging main.
  `backend/scripts/reports-correctness-check.py` (Chromium, built dist, hr + finance, port 3131) 55/55 — bank rows/total/
  held note per company, fallback account, CSVs, PF/ESI per company, audit IST month edges + times + count line, 1,003-row
  month cap line, alias, 390px, empty month, 0 page/console errors, 0 API ≥ 400. `--base` on c942563f 4/4.
- **Not tested:** Railway; Safari/Firefox; production data in the UI.

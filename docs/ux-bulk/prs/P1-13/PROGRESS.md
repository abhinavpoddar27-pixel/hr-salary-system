# P1-13 PROGRESS
## RESUME
Branch fix/finverify-company-scope · worktree /home/claude/wt-p1-13 · port 3113. Read PLAN.md. Phase 0 done, GO received (rulings below).
## Steps
- [x] Phase 0: code read, prod counts, PLAN.md written (11 Oct 2026)
- [ ] jest baseline (flock)
- [x] backend sign-off scope fix + jest (new test 9/9; 6 fail on c942563f). Baseline jest 99/1566
- [x] frontend note + modal line; sign-off POST reply drives the banner (no stale 5 s cache)
- [x] build + Playwright check 25/25 + --base 9/9 on c942563f; P1-15 check 32/32 re-run
- [x] merged origin/main 01c89070; jest 100/1576; checks re-run; pushed
## Owner/planner rulings
- 11 Oct: Option B. Q2 delete NULL-company rows for that month in the same txn. Q3 yes (latest row wins; payroll gate re-locks via upsert). Do NOT touch api.js. Owned: FinanceVerification.jsx + routes/financeVerification.js. Test copies the payroll gate query text verbatim.
## CLAUDE.md entry
## Last Session — 2026-10-11 (P1-13: Finance Verification company filter did nothing; sign-off kept the first decision)
**Branch `fix/finverify-company-scope`, NOT merged.** Plan + log: `docs/ux-bulk/prs/P1-13/PLAN.md`, `PROGRESS.md`. Finding F-4 (+ N-18).
Rulings 11 Oct: Option B (one month-wide sign-off for all companies), Q2 delete NULL-company rows in the same txn, Q3 latest decision wins.
- **Bug:** the page showed a company dropdown no read used (counts, red flags, sign-off all month-wide). The sign-off was
  written with company NULL; UNIQUE(month, year, company) never conflicts on NULL, so every sign-off appended a row and reads
  returned the FIRST one → approve then reject kept showing "Approved", and payroll.js's /finalise gate (any approved row for
  the month) stayed unlocked after a reject. Prod: 0 sign-off rows ever; salary rows carry dirty company labels (Aug+Sep 114
  of 556 blank), ~1 Indriyan row/month — per-company scoping would have hidden rows from both views.
- **Fix (`routes/financeVerification.js`):** sign-off row keyed on company '' (`SIGNOFF_SCOPE`), body company ignored; one
  transaction deletes that month's `company IS NULL` rows then upserts → one row per month, latest wins, a reject re-locks the
  finalise gate (payroll.js untouched). `latestSignoff()` (COALESCE(company,'')='' ORDER BY id DESC) feeds /dashboard and
  /signoff-status; replies carry `scope: 'all'`; POST /signoff returns the stored row. **UI (`FinanceVerification.jsx`):**
  page CompanyFilter → "All companies" chip (`finverify-scope-note`), subtitle + sign-off modal line "This sign-off covers all
  companies for <Month YYYY>". signoffMut sets the sign-off query from the POST reply and refetches only the dashboard
  (getFinanceSignoffStatus has no `fresh`; api.js not owned this batch). dist not committed.
- **Fragile:** the global top-bar company selector still exists and does nothing here (the chip says so). A per-company
  sign-off later needs payroll.js's gate changed too. The new test copies the payroll gate SQL verbatim — re-copy if it changes.
- **Verified:** jest `financeVerifySignoffScope.test.js` 9 (6 fail on c942563f); full jest 99/1566 → 100/1576 (after merging
  main 01c89070). Browser `backend/scripts/finverify-company-scope-check.py` 25/25 (finance + admin, 2 fictional companies +
  blank label, numbers = SQL, company chosen elsewhere changes nothing, approve → reject < 5 s banner Rejected, one row,
  gate empty, legacy NULL row replaced, 390px, 0 page/console errors). `--base` on c942563f 9/9: dropdown changes nothing,
  banner Approved after reject, 2 rows, gate still open. P1-15 `finverify-flag-reason-check.py` 32/32.
- **Not tested:** Railway; Safari/Firefox; production data.
- **Found, not fixed:** (1) GET /signoff-status has no `fresh` in api.js (works around via POST reply). (2) Global header company
  selector applies nowhere on this page. (3) Prod `monthly_imports` shows 2 finalised months in 2026 with 0 sign-off rows ever
  — finalise happened before the gate or via another path (unverified).

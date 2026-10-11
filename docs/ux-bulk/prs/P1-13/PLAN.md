# P1-13 — PLAN (Phase 0)
Base origin/main c942563f · branch fix/finverify-company-scope · port 3113 · Finding F-4 (+ N-18 "sign-off ignores company")

## 1. What the code does today (FACT, read on c942563f)
- `pages/FinanceVerification.jsx` L166 renders `<CompanyFilter />`, but none of its queries send `selectedCompany`
  (L53–59: dashboard, employees, red flags, sign-off status) and the sign-off modal (L602/L609) posts no company.
- `routes/financeVerification.js`: every read is `WHERE month=? AND year=?` only (dashboard L16–31, employees L70–75,
  red-flags L61, bulk-verify L149, signoff L198/L208–210, signoff-status L237). `detectRedFlags(db, month, year)` has no company arg.
- `finance_month_signoff` UNIQUE(month, year, company); POST /signoff writes `company || null` → always NULL from the
  screen. In SQLite NULLs are distinct in a UNIQUE index, so the `ON CONFLICT` never fires: **every sign-off INSERTs a new
  row**. Reads use `.get()` with no ORDER BY → the FIRST row ever written for the month.
  - Consequence 1 (bug, beyond F-4): approve → later reject shows "Approved" forever on the page.
  - Consequence 2 (bug): `payroll.js` L793 (/finalise gate, DO-NOT-MODIFY) unlocks on ANY approved row for month+year —
    a reject after an approve does not re-lock finalisation.
- `finance_audit_status` is UNIQUE(employee_code, month, year) — not company-keyed (its company column is never written).
- `payroll.js /finalise` sign-off gate is month-wide (no company). Per-company sign-off could therefore never gate a
  single company: approving company A would unlock finalise for B too — and payroll.js is out of bounds.

## 2. Production (read-only, counts only, 11 Oct 2026)
- `finance_month_signoff`: **0 rows ever**. usage_logs: 0 POSTs to /signoff ever; 399 GET /signoff-status, 440 GET
  /dashboard (last 10 Oct). Finance looks at the page; nobody has signed off yet.
- `finance_audit_status`: Mar 2026 115 rows (104 verified, 11 flagged), Apr 3 verified; nothing since.
- `salary_computations.company` per month (Apr–Sep 2026): Asian Lakto 129–259/month; **blank / 'null' / 'Default'
  labels 8–100/month** (Aug 100, Sep 14); Indriyan 0–2/month. Aug+Sep: 114 of 556 rows have a blank company; their
  employee-master company is 'Default'/'null'/''/'ASIAN'. No employee has two salary rows in one month (2026: 0 of 2,313).
- So in practice it is one payroll with dirty company labels. Scoping by `sc.company` would make 15–40 % of each month
  vanish from BOTH company views (they would show only under "All Companies").

## 3. Options
- **A — scope every read + sign-off by company.** Needs a company definition for blank rows (sc.company → employees.company
  → ?) that still loses the 'Default'/'null' rows; sign-off per company cannot gate /finalise (payroll.js month-wide,
  not ours to touch); finance_audit_status not company-keyed. Bigger, and gives a false sense of a per-company gate.
- **B (recommended) — one sign-off for the month, all companies; the page says so.** Smallest correct option.

## 4. Plan (Option B)
Backend `routes/financeVerification.js` only:
1. POST /signoff: ignore body `company`; key the row on `company = ''` (constant `SIGNOFF_SCOPE = ''` = all companies)
   so the UPSERT actually upserts → one row per month; a reject after an approve overwrites it, so payroll.js's existing
   gate re-locks (no change to payroll.js). Inside one transaction, first delete legacy `company IS NULL` rows for that
   month/year (prod has 0; they are the duplicate-append rows) — see Q2.
2. GET /signoff-status and the dashboard's signoffStatus: read `COALESCE(company,'')=''` ORDER BY id DESC LIMIT 1 (latest),
   and return `scope: 'all'`.
3. Reads (dashboard, employees, red flags, bulk-verify): unchanged — they already cover all companies; a stray `company`
   query param is ignored (documented in a comment).
Frontend `pages/FinanceVerification.jsx` only:
4. Replace `<CompanyFilter />` in the header with a read-only chip "All companies" + one line "Finance verification and
   sign-off cover every company for the month." (`data-testid="finverify-scope-note"`). The global store value is NOT
   changed (other pages keep their filter).
5. Sign-off modal: line "This sign-off covers all companies for <Month YYYY>."
6. Invalidate with `{ queryKey: [...] }` objects in signoffMut (current `invalidateQueries(['fin-signoff'])` is the v4
   positional form — check it works on the installed react-query v5; if not, the banner never refreshed → fix).
`utils/api.js`: no change expected (helpers already send no company). financeRedFlags.js: no change.
Untouched: Miss Punch / Held tabs (other routes, not owned) — they already show all companies, consistent with the note.

## 5. Tests
- jest `financeVerifySignoffScope.test.js` (real router + JWT pattern, scratch DB, fictional codes, companies "Test Co A"/"Test Co B"):
  approve → reject → status-status = rejected, exactly 1 row, `SELECT … status='approved'` (the payroll gate SQL) finds none;
  body company 'Test Co A' then 'Test Co B' → still 1 row, company ''; legacy NULL row is replaced; dashboard counts =
  both companies' rows; flagged gate still 400s. Expect ≥3 to fail on c942563f.
- Playwright `backend/scripts/finverify-company-scope-check.py` (finance login, built dist, port 3113, two fictional
  companies): no company select on the page, note visible, counts = SQL all-companies totals, switching the global company
  on another page and coming back changes nothing, approve → reject → banner shows Rejected, 390 px, 0 page/console errors.
  `--base`: company select present but switching it changes no number; approve→reject still shows Approved.
- jest full suite before/after (flock).

## 6. Risks
- If finance truly wants per-company sign-off later, it needs payroll.js's gate changed too (separate PR, planner).
- Deleting legacy NULL rows loses history of duplicate sign-offs (prod: 0 rows) — alternative in Q2.
- Hiding the filter here while the top bar shows a company elsewhere could confuse; the note addresses it.

## 7. Questions for the planner
- **Q1 (scope):** Option B (one month-wide sign-off for all companies, filter replaced by a note) — or Option A?
  Recommendation B: prod has 0 sign-offs, a dirty company column (114/556 Aug–Sep rows blank), ~1 Indriyan row/month,
  and a month-wide finalise gate we may not touch.
- **Q2:** legacy `company IS NULL` sign-off rows — delete on next sign-off (my plan; prod 0 rows), or keep them and only
  read the latest row (then payroll.js could still see an old approved NULL row after a reject)?
- **Q3:** include the approve→reject banner/finalise-gate fix (same handler, found here) in this PR? Recommendation: yes.

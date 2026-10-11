# N-REP — PLAN (Phase 0)
Base origin/main c942563f · branch fix/reports-company-held-audit · port 3131.
Owned: backend/src/routes/reports.js, frontend/src/pages/Reports.jsx (Bank / PF / ESI / Audit blocks only).

## 1. What the code does today (read, not guessed)
- **N-3 `GET /reports/bank-transfer`** (reports.js L190–215): `WHERE sc.month=? AND sc.year=? AND sc.net_salary > 0 [AND sc.company=?]`
  — no `salary_held` filter. The bank file `generateBankFile` (exportFormats.js L152–166) has `AND sc.salary_held = 0`.
  Response: `{data, totalAmount, count}`. UI (Reports.jsx ~L624) sums `bankData` itself for "Total Net Payable".
- **N-2 `GET /reports/pf-statement`, `/esi-statement`** (L134–187): read only `month, year`; the frontend already sends
  `company` (api.js L309–310). Both companies mixed. ECR / ESI file / bank file all use `${company ? 'AND sc.company = ?' : ''}`.
- **N-1 `GET /reports/audit-trail`** (L236–252): backend already ORDERs by `changed_at` and returns `al.*`; the blank
  timestamps are the FRONTEND reading `a.created_at` (Reports.jsx L1018 CSV key, L1046 cell, L1061 drill-down). No
  month/year filter: `month`/`year` are destructured but unused → last 1,000 rows of all time.
  `audit_log` has no company column (company param stays ignored — stated in UI? no; see Q3).
- **Other callers of these endpoints (not owned, behaviour change noted):**
  - `Compliance.jsx` L112–126 calls pf/esi-statement WITH `selectedCompany` → gets the company fix for free (correct).
  - `Settings.jsx` AuditTab L395 calls `getAuditTrail(selectedMonth, selectedYear)` and also reads `a.created_at`
    (L421, L433) → it will get the month filter (intended) but still shows blank times unless the backend also
    returns `created_at` (see Q1).
  - `getBankTransfer` (api.js L312) has no caller in src. `statutoryFilingPlant.test.js` L269 hits all four URLs for
    role gates only (shape-neutral).

## 2. Production read-only facts (HR SQL Console, counts/aggregates only)
- Held rows with net > 0 that the Bank Transfer Sheet wrongly includes: Jul 46 rows, Aug 16, Sep 19
  (Sep held ≈ ₹0.78 L across blank + Asian Lakto labels). `hold_released=1 AND salary_held=1` = 0 rows (release clears held).
- `salary_computations.company` has blank-label rows (Sep 14, Aug 100, Jul 48). With a company selected they drop out of
  PF/ESI/Bank — identical to the ECR / ESI / bank files today. Sep PF rows 6 / ESI rows 23 all on 'Asian Lakto Ind Ltd'.
- `audit_log.changed_at`: 50,715 rows, 0 NULL, all `YYYY-MM-DD HH:MM:SS` (SQLite UTC). Per IST month 584–21,585 rows
  (Sep 3,368, Oct 2,771) → EVERY month exceeds the 1,000-row cap (see Q2).

## 3. Smallest change
**reports.js**
1. bank-transfer: `AND COALESCE(sc.salary_held,0) = 0` in the main query (same predicate as the bank file; COALESCE
   for legacy NULL). Second small query, same WHERE but `salary_held = 1`, → additive `held: {count, amount}`.
   `totalAmount`/`count` now cover only rows in the sheet. Response stays `{success, data, totalAmount, count, month, year}` + `held`.
2. pf-statement / esi-statement: read `company`; `${company ? 'AND sc.company = ?' : ''}` + `.filter(Boolean)` params
   (exact pattern of bank-transfer / exportFormats). Blank = all. Held rows stay IN (PF/ESI are still due on held salary —
   not this finding; see Q4).
3. audit-trail: when month AND year are valid ints, filter by IST month via a UTC range on the stored column
   (index-friendly, no function on the column):
   `al.changed_at >= datetime(?, '-330 minutes') AND al.changed_at < datetime(?, '-330 minutes')` with
   `?` = 'YYYY-MM-01 00:00:00' of M and of M+1. Without month/year → unchanged (last 1,000 of all time).
   Select `al.*, al.changed_at AS created_at` (Q1) and return `total` (COUNT with the same filter) + `truncated`.
**Reports.jsx** (owned blocks only)
4. Audit block: `created_at` → `changed_at` (CSV key, cell, drill-down), shown as IST `DD-MM-YYYY HH:MM` (UTC+5:30
   conversion in a tiny local helper); a line "Showing latest 1,000 of N for <Month>" when truncated.
5. Bank block: total uses the server `totalAmount`/`count`; an amber line "N held salaries (₹X) are not in this sheet —
   release them in Stage 7 / Finance" when `held.count > 0`.
6. PF / ESI blocks: no code change needed (company already sent); heading shows "· <company>" when one is selected.

## 4. Tests
- New `backend/src/__tests__/reportsCorrectness.test.js` (jwtApiHarness + statutoryFixture, synthetic codes):
  N-3 held row excluded, totals = non-held only, `held` count/amount right, company filter still works, row equality
  with `generateBankFile` membership; N-2 PF and ESI per company A / B / blank = both; N-1 rows outside the IST month
  excluded (boundary rows at 18:29:59 / 18:30:00 UTC of the last day), `created_at`==`changed_at` present, no-month
  call unchanged, `total`/`truncated` with 1,005 seeded rows. Expect most to fail on c942563f.
- Browser `backend/scripts/reports-correctness-check.py` (Chromium, built dist, scratch DB, hr + finance, port 3131):
  Bank sheet without held row + held note, PF/ESI per company switch, Audit timestamps non-blank + only that month,
  CSV downloads, 390px, 0 page/console errors, 0 API ≥ 400. `--base` on a c942563f build proves all three bugs.
- jest full suite before/after (baseline being recorded now).

## 5. Risks
- Bank Transfer total will drop by the held amount (intended; matches the NEFT file). Anyone reconciling this sheet
  against Stage 7 "Net Payroll" now matches (card excludes held too).
- PF/ESI statement with a company selected now hides blank-label rows — same as the filing files; HR can pick "All".
- Settings → Audit tab changes from "all time" to "selected month" (intended by the finding; it already labels itself
  "for M/YYYY").
- Audit IST boundary: stored values are UTC `datetime('now')`; a row at 23:00 IST on the 30th is 17:30 UTC — included.

## 6. Questions for the planner
- Q1: Also return `changed_at AS created_at` from the backend so Settings → Audit tab (not owned) shows times without
  touching Settings.jsx? (Recommend yes — additive alias, zero risk.)
- Q2: Every month has > 1,000 audit rows. Keep the 1,000 cap + show "latest 1,000 of N" (recommended), or raise the cap
  (e.g. 5,000), or add paging?
- Q3: audit_log has no company column — leave company ignored for Audit Trail (recommended) and say so in the UI?
- Q4: Bank sheet: show held rows as a separate count/total only (recommended, per finding) — not as a second table?
  PF/ESI statements keep held rows (contribution still due) — agree?

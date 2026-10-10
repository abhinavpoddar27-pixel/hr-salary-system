# P1-03 — PLAN (Phase 0)
Branch `fix/sales-neft-finalized-only` on origin/main 96ee482 · Finding S-1 · Rulings R11, **Q12 = C** · MONEY PR
(independent reviewer reads the diff before push).

## What Phase 0 found (re-grep on 96ee482)
- Status strings (schema.js L2552 CHECK + `VALID_COMP_STATUSES` sales.js L2612): `computed`, `reviewed`,
  `finalized`, `paid`, `hold`. `ALLOWED_STATUS_MOVES` (sales.js L2616): computed→reviewed|hold;
  reviewed→computed|finalized|hold; finalized→paid|hold; paid terminal; hold→computed|reviewed.
- `generateSalesNEFT` (salesExportFormats.js L171–224): `WHERE … c.net_salary > 0 AND c.status != 'hold'`
  → **`paid` rows are written again on every re-download** (double payment). Rows with no account/IFSC go to
  `missing[]`; `eligibleIds` = written rows only.
- Route `GET /export/bank-neft` (sales.js L3300–3357): download = generate + stamp `neft_exported_at` on
  `eligibleIds` + one audit row, in one txn. Preview returns `{filename, employees, missing, totals}` — **`totals`
  is passed through as-is**, so new keys inside `totals` reach the browser with NO route change.
- Frontend `SalesSalaryCompute.jsx`: `handleExportNEFTPreview` (L220) opens the modal ONLY when `missing.length > 0`,
  otherwise downloads straight away (no confirm). `downloadNEFT` (L245). Modal L628–689 (title "NEFT Export — Missing
  Bank Details"). `count === 0` → toast "Nothing to export".
- Only callers of `generateSalesNEFT`: sales.js L3318 (download) and L3334 (preview). Only caller of `salesExportNEFT`:
  this page. The TA/DA NEFT (`/ta-da/export/neft`, sales.js L922) is a different function — untouched.

## Exact change
### 1. `backend/src/services/salesExportFormats.js` → `generateSalesNEFT` only
- Query: `AND c.status != 'hold'` → `AND c.status NOT IN ('hold','paid')`; add `c.neft_exported_at` to the SELECT.
- A second read-only count: `SELECT COUNT(*) n, COALESCE(SUM(net_salary),0) amt FROM sales_salary_computations
  WHERE month=? AND year=? AND company=? AND net_salary > 0 AND status='paid'`.
- `totals` gains (computed over the WRITTEN rows, i.e. the file; missing-bank rows stay in `missing[]` as today):
  - `byStatus: { computed, reviewed, finalized }` (counts; sum = `count`)
  - `notFinalized` = computed + reviewed
  - `alreadyExported` = written rows whose `neft_exported_at` is already set (still included — a lost-file
    re-download must keep working)
  - `excludedPaid` (count) and `excludedPaidAmount` (₹, 2-dp)
- Unchanged: CSV header, line format, narration, DOJ format, amount rounding, sort order, filename, `missing[]`,
  `eligibleIds` semantics, `employees`, existing `totals.count/totalAmount/missingCount`.
### 2. `backend/src/routes/sales.js` → **no change** (totals pass through; stamping stays on `eligibleIds`).
### 3. `frontend/src/pages/Sales/SalesSalaryCompute.jsx` → `handleExportNEFTPreview`, NEFT modal only
- Always `setNeftPreview(d)` after a successful preview with `count > 0` (remove the straight-to-download branch).
  `downloadNEFT` unchanged.
- `count === 0` toast: if `excludedPaid > 0` add "· {P} already paid, left out".
- Modal (same shell, buttons, Cancel = `setNeftPreview(null)`, no request):
  - Title: **Download bank (NEFT) file?**
  - Summary line: **{N} people · ₹{X}**
  - Bullets, each shown only when > 0:
    - "{M} not finalized yet (computed or reviewed)" (amber)
    - "{K} were already in an earlier NEFT file for this month — check the bank has not paid them" (amber)
    - "{P} marked paid — left out (₹{Y})" (grey)
    - "{H} have no bank account or IFSC — left out" + the existing table (unchanged)
  - File name line + total line kept. Button: "Download NEFT ({N} rows)" (unchanged text/behaviour).
  - Removed copy: the always-shown amber "missing bank details" paragraph becomes conditional (only with missing rows).
- dist rebuilt, own commit.

## Untouched (DO NOT MODIFY)
Global §10.4 (salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, Stage 7 register,
ED finance review, loans engine) + salesSalaryComputation.js, plant `exportFormats.js` (`generateBankFile`),
`generateSalesExcel`, TA/DA NEFT, `ALLOWED_STATUS_MOVES` / status route / paid guardrail, every other route in
sales.js, the register table, `utils/api.js`.

## Tests (engineering:testing-strategy)
- jest full suite before (baseline count) and after.
- NEW `backend/src/__tests__/salesNeftEligibility.test.js` (in-memory DB, real schema, fictional rows):
  1. paid excluded; hold excluded; net 0 / negative excluded; computed/reviewed/finalized included.
  2. `byStatus`, `notFinalized`, `alreadyExported`, `excludedPaid`, `excludedPaidAmount` exact.
  3. missing-bank row: in `missing`, not in byStatus/count.
  4. CSV header byte-identical to the plant header string; with NO paid rows the CSV equals the origin/main
     function's output byte-for-byte (old function copied verbatim into the test as the reference).
  5. Route download (real router, real requireAuth/JWT hr): stamps exactly `eligibleIds`; a paid row's
     `neft_exported_at` is unchanged; audit row count +1.
  6. Preview JSON carries the new totals (proves no route change needed).
- Plant bank file md5 identical before/after on a scratch DB.
- Browser `backend/scripts/sales-neft-confirm-check.py` (built dist, port 3103, hr login, fictional month with
  computed + reviewed + finalized + paid + hold + missing-bank + already-exported rows): modal ALWAYS appears (also with
  0 missing); numbers right; Cancel → no download, 0 stamps, 0 audit rows; Download → CSV data lines = N, paid code
  absent; 0 page/console errors; 0 API ≥ 400. `--base` on a main build: paid row in CSV + no confirm (record once).

## Risks
- **Who gets paid changes:** paid rows leave the file. Intended (S-1). Production Jul–Sep has 0 paid rows, so
  today's files are unaffected; a month with paid rows gets a shorter file and new Sr numbering.
- **CSV bytes:** identical whenever the month has no paid rows (test 4). Header never changes.
- A row paid outside the app but never marked `paid` is still included — unchanged; the "already in an earlier NEFT
  file" line is the only warning.
- Stamping: paid rows are no longer re-stamped on re-download (their stamp stays the original — fine for the paid
  guardrail, which only needs it set).
- Server GET cache (`max-age=5`): a preview opened within 5 s of a download may show a stale `alreadyExported`.
  Count only; download itself is not cached (download=true is a different URL). See Q1.

## Questions
- Q1: add `no-cache` to the preview call in `utils/api.js` (one line, out of listed targets)? Default: no, note only.
- Q2: also show held rows left out (count)? Default: no (not asked; hold is a deliberate HR action).
- Q3: copy OK as drafted above?

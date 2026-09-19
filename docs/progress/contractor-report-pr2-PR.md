# Contractor Report (PR-2) — read-only

Adds a read-only **Contractor Report** at `/workforce/contractor-report` that puts
biometric contract attendance and daily-wage gate entries side by side, so the same
gang being paid twice on one day becomes visible. Nothing in this PR writes to the
database.

## Scope

**In:** four tabs — Day Report (by contractor / by department, expandable to the
individual people present and the individual gate entries), Daily Wage Register (one
row per date), Grid View (employee × date grid for one contractor, with keyboard
navigation and a selection panel) and Exceptions (nine sections with a count badge).
Six stat cards, month + contractor selects, and a banner about workers with no valid
company. HR / finance / admin only.

**Out (later PRs):** the commission rates table and engine, Excel export, any Stage 7
hook, finalize freeze, merging duplicate daily-wage contractor records, voiding test
rows, fixing exit/joining dates, the contractor master, and naming daily wagers at the
gate.

**No** DB writes, **no** schema changes, **no** new npm dependencies. Lockfiles are
byte-identical to `main`.

Per AMENDMENT 1 there is **no Commission tab and no rate input anywhere**: contractor
commission rates are admin-set in the contractor master. No commission column is read
(`dw_contractors.current_commission_rate`, `dw_entries.commission_rate_applied`,
`total_commission_amount`, `total_liability`,
`dw_department_allocations.allocated_commission_amount`). The test fixture seeds those
columns with a distinctive `777` and the browser simulation asserts it never reaches
the page.

## Acceptance — 13 / 13, verified against production

Real April aggregates were pulled from production (de-identified: bucket counts only,
no names or codes), replayed into an in-memory database and run through the actual
service.

| Check | Expected | Actual |
|---|---|---|
| Apr biometric heads / day / night | 2,278 / 1,951 / 327 | ✅ exact |
| Apr man-days vs Σ `day_calculations` | 2,238 = 2,238, 0 mismatches | ✅ exact |
| Apr DW heads / cost | 699 / ₹4,44,930 | ✅ exact |
| Apr both-source days / max double pay | 21 (all Pappu) / ₹22,736 | ✅ ₹22,735.71 |
| Apr two-DW-record days | 1 — 4 Apr Pappu, PAPPU 12×₹600 + PAPPU CONT 2×₹650 | ✅ exact |
| Apr pre-joining | 3 workers; 60285 = 21 days | ✅ (+60287=14, 60296=1) |
| May biometric heads / day / night | 2,590 / 2,197 / 393 | ✅ exact |
| May man-days / day / night | 2,587.5 / 2,195 / 392.5 | ✅ exact |
| May DW heads / cost | 827 / ₹5,13,670 | ✅ exact |
| May both-source | 5 days, all Meera (8, 9, 13, 14, 23) / ₹12,000 | ✅ exact |
| May tie-out mismatches | 1 — 60298: 19 vs 22 | ✅ 60298 RANI |
| 23 May | bio 105 (88/17), DW 53, total 158; Meera 71 (65/6) + 10 | ✅ exact |
| 9 May DW departments | Utility 21, Zeera 13, Production·night 13, Godown 1 | ✅ exact |

## DO-NOT-MODIFY proof

```
git diff --stat main -- '**/salaryComputation.js' '**/dayCalculation.js' \
  '**/schema.js' '**/payroll.js' '**/exportFormats.js' \
  '**/employeeClassification.js' 'backend/src/routes/dailyWage.js' \
  'frontend/src/pages/DailyMIS.jsx' 'frontend/src/pages/AttendanceRegister.jsx' \
  'frontend/src/index.css'
→ (empty)
```

Existing files are touched on **4 lines total**: one route-mount in `backend/server.js`,
two in `frontend/src/App.jsx` (lazy import + `<Route>`), and two in
`frontend/src/components/layout/Sidebar.jsx` — the nav child, plus a missing
`hrFinanceOrAdmin` case in the *child* filter. The parent filter already handled that
flag but the child filter did not, so the flag alone would have been silently ignored
and the entry would have stayed visible to viewers.

## Tests

| | `main` | this branch |
|---|---|---|
| tests | 253 | **303** (+50) |
| `tdsCalculation` failures | 3 | 3 |
| `protectedWrite` failures | 0 or 3 (flaky) | 0 or 3 (flaky) |

Both pre-existing and documented (CLAUDE.md §12, OPEN_ITEMS OI-2); reproduced on a
clean `main` tree by stashing this branch. The 50 new tests pass in every run.

Beyond unit tests: **56 browser checks** driving the built page in Chromium (happy
path, all four tabs, every edge case) and **15 access checks** across hr / finance /
admin / viewer — nav visibility, direct-URL navigation and the API's own 403.

## Access

`hr`, `finance`, `admin` see the nav child and the page. A `viewer` does not see the
nav child, and navigating straight to the URL gives the app's standard access-denied
panel (the same shape the SQL Console uses) — not a blank page and not raw 403 text.
All three endpoints are gated server-side with `roleIn()` from `middleware/roles.js`,
which normalises legacy role strings.

## Known limits

- **Company data is poor.** Only **96 of 334** contract employees carry a valid
  company, so the unknown-company banner fires at **47% of April** and **59% of May**
  man-days. The `companies` table itself contains `Default` and `null` rows, which are
  therefore real selectable options. The report applies **no** company-mapping rules —
  `ASIAN` counts as invalid — because it must agree with the value payroll stores.
  Daily-wage entries are not company-split at all, so the filter narrows biometric
  workers only.
- **`employees.contractor_group` is empty** (345/345 contract employees on 19 Sep) and
  is deliberately not read.
- **`SAJJAN+JIWAN LAL (12-H)`** — one gate entry covering two gangs — has no live
  entries in April–May, so its both-source and Grid View behaviour is proven by unit
  fixtures rather than production data.
- **`SONU CONT`** is aliased but had no present days in April–May, so the "not mapped"
  badge path has not been exercised on live data.
- **`/vite.svg` 404** is pre-existing on `main`: `frontend/index.html` references a
  favicon that is absent from `dist`, so every page in the app emits it. Out of scope
  here — fixing it means editing `index.html`.
- **No index covers `attendance_processed.date`** for a bare range scan. The month
  queries are full scans of a table growing ~9,000 rows/month. Left alone deliberately:
  switching the predicate to the populated `month`/`year` columns would change what was
  verified above and needs its own re-verification pass.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01AcD3LXXYNNoGVNodbRzkCj

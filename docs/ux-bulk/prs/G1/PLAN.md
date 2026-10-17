# G1 — DW contractor rate change applies from its effective date (MONEY)
Branch `fix/dw-rate-effective-date` on origin/main 892f7f73 · worktree /home/claude/wt-dw-rates · port 3504 · Builder D.
Status: **Phase 0 ready. Waiting for "go". No code written.** G2 (maker-checker) is stacked on this branch.

## 1. Facts (re-grepped on 892f7f73)
- FACT `routes/dailyWage.js` L201–228 `PUT /rates/:id/approve`: sets `dw_rate_history` approved AND writes
  `dw_contractors.current_daily_wage_rate/current_commission_rate` at once. `effective_date` (NOT NULL, L172 required on
  propose) is read nowhere except ORDER BY in history lists (L154, L1389).
- FACT every place that reads "the rate" for money:
  | Reader | Line | Uses |
  |---|---|---|
  | `insertEntry()` (POST /entries + batch-import) | L390–430 | `c.current_*` → `wage_rate_applied`, totals, dept allocations |
  | `PUT /entries/:id` (HR edit of draft / needs_correction) | L733–772 | `contractor.current_*` → re-prices the entry + allocations |
  | `POST /entries` "no rates configured" gate | L551 | `current_*` both ≤ 0 → 400 |
  - Everything downstream reads the STORED `dw_entries.wage_rate_applied / total_*` (finance pending ctx L862, payments
    L1054–1067 sum `total_liability`, dashboard L1206, reports L1248–1541, contractorReport.js L272/L298). No commission
    column is read outside dailyWage.js. **So only 3 write sites decide money; payments/reports follow the stored value.**
  - Display only (no money): contractor list/detail (`DailyWageContractors.jsx` L277–279, L416), Entry page live preview
    (`DailyWageEntry.jsx` L82–83 — uses `current_*`, i.e. today's rate even for a back-dated entry), Reports header
    (`DailyWageReports.jsx` L301–302).
- FACT `DailyWageContractors.jsx` L335 (P6-06 #169) confirm text: "New rates apply from today. The effective date on the
  request (…) is recorded but not used yet." — must change.
- FACT entry dates can be back-dated (validateEntryRow only refuses future; no lower bound).

## 2. Production (read-only, counts only, 17 Oct)
- 15 contractors · 196 entries (2026-04-02 … 2026-10-15; approved 189, paid 2, hr_entered 2, needs_correction 1, flagged 1,
  rejected 1) · 2 payments.
- **Rate changes ever: 1** (pending; 0 approved, 0 rejected). **effective_date ≠ approval day: 0** (none approved yet). The
  pending one's effective_date = its proposal day (IST) = **2026-04-10, i.e. 190 days in the past**; wage up, commission same.
- **After that pending effective date, same contractor: 1 entry (status hr_entered = draft), 0 payments touching such
  entries, 1 payment dated after it** (pays earlier entries). That contractor has 3 entries in total.
- Entries whose stored rate ≠ contractor's current rate: 0 (no rate has ever moved).
- So: approving today under the current code would price that 1 draft at the new rate only if HR edits it; every NEW entry
  — including any back-dated to before 10 Apr — would get the new rate. Under G1 back-dated entries get the old rate.

## 3. Rule (proposed)
"Rate in force on date D" for a contractor = the approved change with the latest `effective_date ≤ D` (tie: highest id) →
its `new_*`. If no approved change is effective by D but approved changes exist → the earliest one's `old_*` (the rate before
any change). If none approved → `dw_contractors.current_*` (the master's rate).
- **Pricing uses the entry's own date** (`entry_date`), not the day it is typed — create, batch-import and draft edit.
- **`current_*` keeps meaning "in force today (IST)"**: approve with effective_date ≤ today → updated at approval (as now);
  future date → NOT updated at approval; it is promoted lazily by `refreshCurrentRates(db)` (idempotent UPDATE, 15 rows) at
  the start of GET /contractors, GET /contractors/:id and approve. No cron, no schema change.
- **Already-priced entries (past effective date) — Q1.** Recommended: status `pending_finance / approved / flagged / paid /
  rejected` are NEVER re-priced (finance has seen or paid them). Drafts (`hr_entered`, `needs_correction`) dated on/after
  the effective date ARE re-priced inside the approve transaction (one `dw_audit_log` row each, entity 'entry', action
  'reprice_rate_change', old/new rate + totals). The approve reply returns `{repriced, notRepriced:{count, byStatus}}` so finance
  sees which priced entries kept the old rate. Prod effect today: 1 draft re-priced, 0 others.

## 4. Smallest change
`backend/src/routes/dailyWage.js` only (+ UI copy):
1. New local helpers next to `dwAudit`: `istToday()` (same +330 min expression as L319, extracted — validateEntryRow L319 then
   calls it; behaviour identical), `rateOn(db, contractor, date)`, `refreshCurrentRates(db)`, `priceEntry(rates, wc, allocs)`
   (one price function — today the formula is copied in insertEntry and PUT /entries; extract, don't copy).
2. `insertEntry` + `PUT /entries/:id`: rates = `rateOn(db, c, row.entry_date)`. The L551 gate checks `rateOn(...)` of the entry
   date (the date's rate, not today's).
3. `PUT /rates/:id/approve`: in ONE transaction — approve row; if `effective_date ≤ istToday()` set `current_*`; re-price drafts
   per Q1; then `refreshCurrentRates`. Validate `effective_date` is YYYY-MM-DD (old rows always are; refuse 400 otherwise).
   Message: "Rate change approved — applies to entries dated {date} onward" (+ "from {date}; old rates until then" if future).
4. `POST /contractors/:id/rates`: validate `effective_date` is YYYY-MM-DD (currently any string; a bad string would break the
   ≤ compare). No other change.
5. GET `/contractors/:id/rate-on?date=` (read, every role that opens the page) → `{wage, commission, source}` — Q3.
6. `DailyWageContractors.jsx` L335 → "These rates apply to entries dated {fmtDate(eff)} onward. Entries already sent to finance
   or paid keep the rate they were saved with; drafts from that date are re-priced." (future: "Until then the current rates stay.")
   History line "Effective: … " → `fmtDate`. Approve toast uses the server message.
7. `DailyWageEntry.jsx` L82–83 preview (Q3): reads `rate-on` for the chosen date so the preview = what the server saves.

## 5. NOT touched
schema.js (no column needed), salaryComputation/dayCalculation/payroll/recompute, contractorReport.js, payments/reports
routes (they read stored values), `PUT /rates/:id/reject`, CLAUDE.md, statusMap.js.

## 6. Tests / verification
- New `backend/src/__tests__/dwRateEffectiveDate.test.js` (in-memory DB, real router, real JWTs): rateOn table (no history,
  past/future/tie/two changes/earliest-old fallback); entry before / on / after eff date priced old / new / new; back-dated
  entry after approval gets old rate; future-dated approval leaves `current_*` until the date (fake clock), then refresh promotes;
  draft re-priced + audit row; pending_finance/approved/paid untouched byte-identical (`dw_entries` + allocations); batch-import
  per-row date; PUT edit moving the date across the boundary re-prices; bad date 400; allocations sum = totals. Must fail on 892f7f73.
- Money invariant on scratch DB: `SELECT COUNT(*) FROM dw_entries WHERE ABS(total_liability-(total_wage_amount+total_commission_amount))>0.01`
  = 0 and `…WHERE ABS(total_wage_amount - total_worker_count*wage_rate_applied)>0.01` = 0; plant drift query unchanged (0 tables touched).
- `backend/scripts/dw-rate-effective-date-check.py` (Chromium, built dist, scratch DB, fictional "TEST GANG ALPHA", port 3504; hr
  proposes, finance approves; server restart per role): confirm text says "dated … onward"; past-dated approve → new entry dated
  before eff = old rate, after = new rate, draft re-priced, approved entry unchanged; future-dated approve → list still old rate,
  entry dated after eff priced new; Entry preview = saved rate; 390 px; 0 page errors. `--base` on 892f7f73 shows new rate on the
  back-dated entry + old copy.
- jest own suite, then full suite (flock); `npm run build --prefix frontend`; regression destructive-confirms-check.py,
  dw-drafts-visible-check.py.

## 7. Risks / fragile
- `old_*` on a history row is the rate at PROPOSAL time; with two overlapping proposals the "before any change" fallback uses the
  earliest approved row's old_* — correct for one chain, approximate if proposals were raised out of order (prod: 1 row ever).
- Lazy promotion: `current_*` is stale between midnight IST and the next contractor read — display only; pricing never reads it
  directly once history exists.
- A future effective date + an entry typed for that future date is impossible (future entries refused) — fine.

## 8. Questions
- **G1-Q1** Past effective date: re-price drafts (hr_entered / needs_correction) dated ≥ effective, never re-price anything finance
  has seen or paid; report counts in the reply. *Recommended: yes, as above.* (Alternative: re-price nothing; drafts pick it up on
  their next edit — leaves a draft showing a stale amount.)
- **G1-Q2** Should approve refuse an effective date older than N days (e.g. before the last DW payment for that contractor)?
  *Recommended: no refusal; show a line in the confirm "N entries dated after {date} are already with finance or paid and keep the
  old rate" (count from a read endpoint/preview).* Prod: the one pending row would show 0 such entries.
- **G1-Q3** Add `GET /contractors/:id/rate-on?date=` and use it in the Entry page preview (DailyWageEntry.jsx, 1 query)? *Recommended:
  yes — otherwise a back-dated entry previews today's rate and saves another.*
- **G1-Q4** The one pending production request (effective 10 Apr 2026) — leave as is for finance to decide after deploy? *Recommended:
  yes; owner tells finance it will apply from 10 Apr (1 draft re-priced, nothing paid moves).*

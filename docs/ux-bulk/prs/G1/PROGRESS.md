# G1 PROGRESS — DW rate change applies from its effective date (MONEY)
State: BUILT + VERIFIED. Waiting for the independent review.
Branch `fix/dw-rate-effective-date` on origin/main 892f7f73 · port 3504.

## Rulings (17 Oct)
- Q1 OWNER "drafts only": a past-dated approval re-prices hr_entered + needs_correction entries dated on/after the
  effective date (one `dw_audit_log` row each, action `reprice_rate_change`). pending_finance / approved / flagged /
  paid / rejected keep the old rate. Approve reply: `repriced {count, ids, liability_delta}`, `kept {count, byStatus}`.
- Q2 no refusal of old dates; confirm says "N entries dated after {date} are already with finance or paid and keep
  the old rate" + the re-price count. P6-06 "recorded but not used yet" sentence removed.
- Q3 `GET /contractors/:id/rate-on?date=` used by the Entry page preview.
- Q4 the production pending request (effective 10 Apr 2026) is left for finance after deploy.
- Extra: propose validates effective_date = real YYYY-MM-DD → 400.

## Done
- `routes/dailyWage.js`: `istToday`, `isRealIsoDate`, `rateOn(db, contractor, date)`, `refreshCurrentRates(db)`,
  `priceEntry(rates, workers, allocs)` (one price function; insertEntry + PUT /entries + re-price use it),
  `rateChangeImpact`. insertEntry / PUT /entries / POST /entries gate price at the entry's own date.
  approve: one txn — approve row, re-price drafts, refresh current_*. New `GET /rates/:id/impact`, `GET /contractors/:id/rate-on`.
  GET /contractors and /contractors/:id call refreshCurrentRates (future change promoted on its day).
- UI: `DailyWageContractors.jsx` confirm (impact query, new copy, server message toast, invalidates `['dw-entries']`);
  `DailyWageEntry.jsx` preview at the entry date's rate (`entry-rate-preview`, `entry-rate-note`); `utils/api.js` 2 helpers.
- `backend/scripts/destructive-confirms-check.py` A2 updated to the new copy (01-Nov is future → current rates stay).

## RESUME
Built and verified; next = reviewer. G2 stacked on this branch in /home/claude/wt-dw-rates2 — rebase it after any G1 fix.

## CLAUDE.md entry
**Branch `fix/dw-rate-effective-date`, NOT merged. MONEY PR.** Plan + log: `docs/ux-bulk/prs/G1/PLAN.md`, `PROGRESS.md`.
- **Bug:** `PUT /daily-wage/rates/:id/approve` applied new contractor rates at once; `effective_date` was stored, never used.
  Every new entry (even one back-dated before the change) took the latest rate; a future-dated change applied early.
- **Fix (`routes/dailyWage.js`):** rate for an entry = approved change with the latest effective_date ≤ entry_date (tie:
  highest id) → its new rates; before any approved change → the earliest change's old rates; no history → master.
  Approve (one txn): drafts (hr_entered/needs_correction) dated ≥ effective date re-priced + audit `reprice_rate_change`;
  everything else keeps its rate (owner ruling "drafts only"); reply `repriced`/`kept`. current_* = rate in force today
  (IST) — a future change is promoted lazily by `refreshCurrentRates` on GET /contractors(/:id) and approve. New
  `GET /rates/:id/impact`, `GET /contractors/:id/rate-on?date=`. Propose: effective_date must be a real date (400).
  UI: confirm states the date, re-price count and kept count; Entry preview = the rate the server saves.
- **Fragile:** (1) `old_*` on a history row is the rate at PROPOSAL time — the "before any change" fallback uses the
  earliest approved row's old_*; proposals raised out of order make that approximate. (2) GET /contractors writes
  (refreshCurrentRates) — only when a value differs. (3) Every new rate reader must call `rateOn`, never current_*.
  (4) The confirm's kept count includes rejected entries (they are not re-priced either).
- **Verified:** new `dwRateEffectiveDate.test.js` 10 (9 fail on 892f7f73); full jest 126 suites / 2240.
  `backend/scripts/dw-rate-effective-date-check.py` (Chromium, built dist, scratch DB, finance + hr, fictional TEST GANG
  GAMMA/DELTA, port 3504) 28/28: confirm copy + counts, 2 drafts re-priced, before/approved/paid byte-identical, DW total
  moved by exactly the drafts' delta (2 × ₹315), 2 audit rows, future change keeps current rates, Entry preview old/new by
  date, back-dated save at the old rate = preview, 390 px, 0 page errors, 0 API ≥ 400. `--base` on 892f7f73 10/10.
  Regression: destructive-confirms-check 115/115 (A2 copy updated), dw-drafts-visible-check 37/37.
- **Not tested:** Railway; production data; Safari/Firefox; a change approved exactly at IST midnight.
- **Production:** 1 rate change ever (pending, effective 2026-04-10, raised by an admin user); after deploy approving it
  re-prices 1 draft, moves nothing sent to finance or paid.

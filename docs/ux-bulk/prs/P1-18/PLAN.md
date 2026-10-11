# P1-18 — Daily wage: imported drafts are invisible (finding D-1) — PLAN

Base origin/main c942563f · branch fix/dw-drafts-visible · port 3118

## 1. What happens today (read from code)
- `POST /api/daily-wage/entries/batch-import` (routes/dailyWage.js L467–535) validates every row, then inserts all rows in
  one transaction via `insertEntry` (status hard-coded `'hr_entered'` = "Draft", L401). Reply: `{success, imported, ids}`.
- `DailyWageBatchImport.jsx` `importMut.onSuccess` (L105–110): toast "N entries imported successfully", step 3 shows
  "Import Complete — Redirecting to records…", and `setTimeout(navigate('/daily-wage'), 1500)`. Nothing says the rows are
  drafts that finance cannot see until HR submits them; the returned `ids` are thrown away.
- `DailyWageRecords.jsx` KPI cards (L117–123): Total / Pending Finance / Approved / Paid / Rejected. No Draft card and no
  Needs-correction card, although `GET /entries` already returns `summary.hr_entered` and `summary.needs_correction`
  (L652–662). Drafts are only reachable through the status dropdown. The list opens unfiltered (newest entry_date first),
  so imported back-dated drafts can sit pages deep.
- Existing submit endpoints (no new backend route needed):
  - `PUT /entries/:id/submit` (hr/admin; only `hr_entered`).
  - `POST /entries/batch-submit {entry_ids}` (hr/admin; all-or-nothing — 400 with `invalid_ids` if any id is not
    `hr_entered`; one transaction; `dw_approvals` 'submitted' + audit row per id). Frontend helper `batchSubmitDWEntries`.
- `needs_correction` rows cannot be submitted directly: HR edits (`PUT /entries/:id` puts them back to `hr_entered`,
  L737) then submits. The Records detail already has "Edit & Resubmit".

## 2. Production (read-only, counts only, 11 Oct 2026)
dw_entries by status: approved 185 · hr_entered (Draft) 2 · needs_correction 1 · flagged 1 · paid 2 · rejected 1 (total 192).
dw_audit_log: 0 `batch_create` rows → the batch import has never been used successfully in production; the 2 drafts and
the 1 needs-correction row came from single entry / finance correction. Draft dates Apr 2026 — old work nobody can see.

## 3. Smallest change (frontend only, two owned files)
### A. `pages/DailyWageBatchImport.jsx`
- Keep `res.data.ids` / `imported` in state (`importResult`). Remove the 1.5 s auto-redirect (it leaves no time to act).
- Done screen (step 3): "N entries created as **drafts**. Finance does not see them until they are submitted."
  - Primary button "Submit all N for finance review" → existing `batchSubmitDWEntries(ids)`; busy-disabled; a second click
    is impossible (button hidden after success; in-flight guard by `isPending`).
  - Success: "N entries sent to finance review" + "Go to records". Invalidate `['dw-entries']`.
  - Failure (e.g. a draft was edited/submitted from another tab → backend 400 `invalid_ids`): show the server message in
    the panel, nothing changes (backend is all-or-nothing), button "Open drafts" still available.
  - Secondary "Leave as drafts — open drafts list" → `/daily-wage?status=hr_entered`.
  - Success toast text changes to "N drafts created".
### B. `pages/DailyWageRecords.jsx`
- Two new KPI cards: **Draft** (`summary.hr_entered`, filter `hr_entered`) and **Needs Correction**
  (`summary.needs_correction`, filter `needs_correction`), using the same button/filter mechanism as the existing cards
  (grid → 7 columns on md, wraps on phone). Highlight (amber/red ring) when the count > 0.
- Initial `statusFilter` read from `?status=` (only known status keys; anything else ignored) so the import screen can link
  straight to drafts; changing the filter does not need to rewrite the URL (kept minimal).
- Small hint above the table when the Draft filter is on: "Drafts are not visible to finance until submitted — tick and
  Submit Selected"; when Needs Correction is on: "Open a row → Edit & Resubmit (finance's note is shown inside)".
- No change to mutations, selection logic or the existing cards.

No backend file, no api.js, no dist, no schema.

## 4. Tests
- New `backend/scripts/dw-drafts-visible-check.py` (Chromium, local build, scratch DB, port 3118, real hr login, fictional
  contractor "Test Gang Alpha" + fictional gate refs):
  1. Records: Draft and Needs-correction cards show the DB counts (seed 1 needs_correction + 1 draft via routes/SQL);
     clicking each filters the list to exactly those rows; Total card clears.
  2. Import an xlsx (3 rows) built in the script → done screen says "3 … drafts", no redirect after 3 s.
  3. Submit all → one POST /entries/batch-submit with the 3 ids → DB rows `pending_finance`, 3 `dw_approvals` 'submitted';
     success text; Records Draft count back to the seeded value.
  4. Edge: second import, then submit one of its drafts via API, then Submit all → 400 message shown, DB unchanged for
     the other drafts; "Open drafts" link lands on Records with Draft filter active.
  5. `/daily-wage?status=bogus` → unfiltered. Phone 390 px. 0 page/console errors, 0 API ≥ 400 except the intended one.
  - `--base` on an origin/main build: done screen has no draft count / submit button and redirects; Records has no Draft card.
- jest full suite before/after (frontend-only change, expected identical).

## 5. Risks / fragile
- `GET /entries` is cached by server.js (`private, max-age=5`) and `getDWEntries` does not send `no-cache` (api.js not
  owned). Records → Submit Selected → refetch within 5 s can show the old status (pre-existing, same class as P1-08/P1-09).
  The done-screen → Records path is normally > 5 s after any earlier Records load, but not guaranteed. See Q1.
- `summary` counts are global (ignore the other filters and company) — unchanged behaviour; the card counts may differ from
  the filtered list when a contractor/date filter is also set (existing cards have the same property).
- Batch-submit is all-or-nothing; if one imported draft was edited and submitted elsewhere, Submit all refuses the whole
  set (message shown; HR can use Records → Draft filter). Acceptable for a 1-click convenience.

## 6. Questions for the planner
- Q1. May I add `fresh` (no-cache) to `getDWEntries` in `frontend/src/utils/api.js` (1 line) so the list/cards are right
  straight after a submit? api.js is not in my owned list. Default if "no": leave it, record as found-not-fixed.
- Q2. Done screen: confirm removing the 1.5 s auto-redirect (needed so HR can press Submit all). Default: remove.
- Q3. Should "Submit all" ask for confirmation? Default: no confirm (it only moves drafts into the finance queue,
  finance can still mark needs-correction/reject; same as the existing "Submit Selected" which has no confirm).

# P1-18 PROGRESS

## RESUME
Read PROMPT.md, then PLAN.md. DONE — built, tested, pushed. Nothing left unless the planner asks.

## Steps
- [x] Phase 0: read code (BatchImport, Records, routes/dailyWage.js import/list/submit), prod counts, PLAN.md
- [x] go received (+ answers Q1–Q3)
- [x] jest baseline: 99 suites / 1566
- [x] A. BatchImport done screen (+ useRef double-click guard: dblclick sent 2 submits, the 400 replaced the success — caught by the check)
- [x] B. Records cards + ?status=
- [x] local build + check script 37/37 (twice) + --base on c942563f 7/7
- [x] self-debug / user sim / v2 (double-click guard added after the check caught it)
- [x] merge origin/main (already up to date at c942563f), jest 99/1566 before and after, push, report

## Rulings (planner, 11 Oct 2026)
- Q1 NO: do not edit api.js. The no-cache header on getDWEntries comes from the N-FRESH PR. Here: after Submit all / Submit Selected invalidate the ['dw-entries'] prefix so a refetch happens.
- Q2 YES: remove the 1.5 s auto-redirect.
- Q3 NO confirm on Submit all.
- Owned files: the two pages only.

## CLAUDE.md entry
## Last Session — 2026-10-11 (P1-18: Daily wage imported drafts were invisible)
**Branch `fix/dw-drafts-visible`, NOT merged.** Frontend only (`pages/DailyWageBatchImport.jsx`, `pages/DailyWageRecords.jsx`).
Plan + log: `docs/ux-bulk/prs/P1-18/PLAN.md`, `PROGRESS.md`. Finding D-1. Rulings Q1 (no api.js edit — no-cache comes from
N-FRESH), Q2 (auto-redirect removed), Q3 (no confirm).
- **Bug:** batch import creates every row as `hr_entered` (Draft); the done screen said "Import Complete" and redirected
  after 1.5 s, throwing away the returned ids; Records had no Draft / Needs-correction card (the API already returned both
  counts), so drafts — which finance never sees — sat unseen. Prod: 2 drafts + 1 needs-correction (Apr 2026), 0 batch imports ever.
- **Fix:** done screen "N entries created as drafts — finance does not see drafts" + "Submit all N for finance review" (existing
  `POST /entries/batch-submit` with the imported ids; useRef in-flight guard — a double click sent two submits and the
  second's 400 replaced the success) + "Leave as drafts — open drafts list" (`/daily-wage?status=hr_entered`). A refusal
  (all-or-nothing) shows the server message, nothing changes. Records: Draft + Needs Correction cards (filter the list, tinted
  when > 0), `?status=` honoured for known keys only, a hint line per filter. `['dw-entries']` invalidated after Submit all and
  after Submit Selected (success AND error). No backend change.
- **Fragile:** `getDWEntries` still lacks `no-cache` until N-FRESH lands — a refetch inside the server's 5 s cache window can
  show the old status. Card counts are global (ignore contractor/date/company filters), same as the existing cards.
- **Verified:** `backend/scripts/dw-drafts-visible-check.py` (Chromium, local build, scratch DB, hr, fictional "TEST GANG ALPHA",
  port 3118) 37/37 twice — cards = DB counts + filter, import 3 → done screen, no redirect, double-click = 1 POST with the 3
  ids, 3 rows pending_finance + 3 'submitted' approvals, edge (one draft submitted elsewhere → refusal shown, others stay
  drafts), Open drafts → Draft filter, Submit Selected, `?status=bogus` ignored, 390px card, 0 page errors.
  `--base` on c942563f 7/7: no cards, no draft wording, no Submit all, auto-redirect. jest 99 suites / 1566 before and after.
- **Not tested:** Railway; Safari/Firefox; finance/viewer view of the new cards (hint text omits the HR action for them, by code).

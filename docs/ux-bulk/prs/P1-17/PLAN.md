# P1-17 — PLAN (Phase 0)
Branch `fix/import-month-and-dead-checkbox` · base origin/main 868f5389 (+ d6558e14 PROMPT.md) · Findings P-7, P-8 ·
MASTER_PLAN §6/§9 row P1-17. Status: **Phase 0 ready — waiting for "go". No source file touched.**

## 1. Diagnosis (FACT, from the code)
- **P-7 dead checkbox.** `pages/Import.jsx` L200 `overwrite` state, L234 `fd.append('overwrite', …)`, L310–313 checkbox
  "Overwrite if month already imported". Server `routes/import.js` L188 reads `const overwrite = req.body.overwrite ===
  'true'` and never uses it; L190 `isReimport = !!existingAfterMigration` — a re-import ALWAYS upserts (snapshot +
  replay of manual corrections, then Stage 6 + 7 auto-recompute, L204/L518/L530). The tick changes nothing.
- **P-8 month not sent.** `handleUpload` (L232–234) appends only `files` + `overwrite`. Server L86–96 refuses a file
  whose month ≠ `req.body.month/year` with `error: 'UI/file month mismatch'` + a `userMessage` — but only when both are
  sent, so it never fires. The page's month picker (L194 `useDateSelector`) is used only for the reconciliation panel.
- **Also found (same block, in scope because the scope says "show the server's userMessage"):** failed rows render
  `result.error` (L401), never `result.userMessage`. So even once the month is sent, HR would see the raw
  "UI/file month mismatch" instead of the explanation. Same for the multi-month refusal and parse errors
  (`friendlyParseError`) — they get the friendly text for free.
- `uploadFiles` in `utils/api.js` (L56) passes the FormData through untouched → **api.js not changed.**
- `GET /import/history` returns every `monthly_imports` row (ignores the company param) with month, year, company.

## 2. Fix (Import.jsx only)
1. Delete the `overwrite` state, the `fd.append('overwrite', …)` line and the checkbox label.
2. `fd.append('month', String(month))`, `fd.append('year', String(year))` from the page's picker.
3. Above the drop zone, a line saying which month the files will be filed under: "Files will be checked against
   **{Mon YYYY}** — a file for another month is refused." (so the new refusal is never a surprise).
4. Re-import warning: `alreadyImported = history.filter(h => h.month === month && h.year === year)`. When non-empty,
   an amber box (`data-testid="reimport-warning"`): "This month is already imported ({companies}) — Stage 6 and 7 will
   be recomputed and manual corrections replayed." Shown before upload (whenever the picker is on such a month).
5. Failed result rows show `result.userMessage || result.error` (`data-testid="import-error"`).
6. Drop-zone hint "multiple files supported (one per month)" → "multiple files supported (all for the month selected
   above)" — see Q1.
No backend change (the server's unused `overwrite` read at L188 stays — backend untouched by scope).

## 3. Files
- `frontend/src/pages/Import.jsx` — source commit.
- `frontend/dist/*` — `flock /tmp/vite.lock npm run build --prefix frontend`, own commit.
- `backend/scripts/import-month-check.py` — new browser check (pattern salary-register-report-check.py).
- `docs/ux-bulk/prs/P1-17/PLAN.md`, `PROGRESS.md`; `CLAUDE.md` Last Session entry.

## 4. Verify plan
- jest before: **96 suites / 1537 tests pass** (this tree). Again after.
- Script (Chromium, built dist, scratch DB from schema, real hr login, port 3117). Fictional EESL .xls built in the
  script with the parser.test.js layout (fictional codes T17xx, fictional names, Sep 2026 range), written as .xls.
  1. No "Overwrite" checkbox / text anywhere on the page.
  2. Picker on Oct 2026, upload the Sep file → POST body has month=10 year=2026; result row shows the server's
     "You selected 10/2026 …" text; toast says failed; DB counts (monthly_imports, attendance_raw,
     attendance_processed) unchanged.
  3. Picker on Sep 2026, no warning yet; upload → success; rows written; month line shows Sep 2026.
  4. Still on Sep 2026 → re-import warning visible naming the company; upload again → success (re-import path), counts
     consistent (no duplicates in attendance_processed).
  5. Switch to Aug 2026 → warning gone.
  6. 390px width: warning + month line visible, no page overflow from them; 0 page/console errors; API ≥ 400 none
     (the refusal is a 200 with success:false).
- `--base` on a fresh origin/main build: checkbox present; wrong-month upload imports silently (counts grow).

## 5. Questions for the planner
- **Q1 multi-month batch.** The drop zone says "multiple files supported (one per month)". Once month is sent, only
  the file matching the selected month imports; the others are refused with the server's message. Proposed: accept
  that (it is the point of P-8) and change the hint text as in §2.6. Alternative: send no month when >1 file is
  selected (keeps batch, loses the check). I propose the former.
- **Q2 history freshness.** `getImportHistory` has no `no-cache`; after an import, `refetchHistory()` may get the
  server's 5 s cached copy, so the re-import warning can appear only after ~5 s / next refetch. Fixing needs `fresh` in
  api.js (outside "only if it drops fields"). Proposed: leave api.js alone, report as found-not-fixed; the check
  waits for the warning (react-query refetch on window focus / remount). OK?
- **Q3** Warning matches month+year across ALL companies in history (the file carries both sheets/companies, and the
  route ignores the top-bar company). OK?

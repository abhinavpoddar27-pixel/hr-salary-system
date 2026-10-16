# F151 — PROGRESS (branch fix/n-money2-followups, from origin/main b0ed242)

## RESUME
Read PLAN.md + this file, then `git log --oneline origin/main..HEAD`. State: BUILT, verified, pushed. Frontend only.

## Rulings (planner, 16 Oct 2026)
- Q1 add `Reverted` to statusMap `salary_change` — one line (builder A edits `bulk_batch` in the same file).
- Q2 F-6 moved to N-PF (fix/pf-ceiling-approval). This PR = F-2 + F-3 only.
- Q3 no extra onError toast on single finance approve — the global interceptor already shows one toast.

## Done
- F-2 `utils/statusMap.js` +1 line (`Reverted`, tone orange); `pages/SalaryInput.jsx` history cell +1 `StatusBadge` line + import.
  The other three hard-coded spans are unchanged.
- F-3 `pages/ExtraDutyGrants.jsx` `bulkFinApproveMut.onSuccess`: "Approved N" / "Approved N · Skipped M (not HR-approved or
  already decided)" / info toast "Nothing approved · Skipped M (…)" when N = 0.
- Check script `backend/scripts/n-money2-followups-check.py`.

## Verified
- jest 121 / 2172 green (no backend change).
- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PORT=3502 python3 backend/scripts/n-money2-followups-check.py` 16/16 twice
  (built dist, scratch DB, fictional T9501–T9508, real finance login): Reverted pill (orange) in history, other statuses
  unchanged; bulk approve of 4 with 2 decided elsewhere after page load → "Approved 2 · Skipped 2 (…)", DB right; all
  skipped → "Nothing approved · Skipped 1 (…)"; single approve refused 409 → exactly 1 toast with the server reason;
  390 px; 0 page / console errors; 0 unexpected API ≥ 400. `--base` on origin/main 7/7: empty status cell,
  "2 grants approved".
- frontend build OK (dist not committed).

## Not tested
Railway; Safari/Firefox.

## CLAUDE.md entry
## Last Session — 2026-10-16 (F151: N-MONEY2 follow-ups — Reverted badge, bulk ED approve says what it skipped)
**Branch `fix/n-money2-followups`, NOT merged.** Frontend only. Plan + log: `docs/ux-bulk/prs/F151/PLAN.md`, `PROGRESS.md`.
Findings F-2, F-3 from #151 (F-6 moved to N-PF). Rulings Q1–Q3 (16 Oct).
- **F-2:** Salary Input → Change History showed an empty status for a request set to 'Reverted' (N-23 gross revert). Now an
  orange "Reverted" pill via StatusBadge; `statusMap.salary_change` gains `Reverted`.
- **F-3:** Extra Duty bulk finance approve ignored the server's `skipped` list. Toast now "Approved N · Skipped M (not
  HR-approved or already decided)", or an info toast "Nothing approved · Skipped M (…)". Single approve unchanged (the global
  interceptor already gives one toast per failure).
- **Fragile:** the old three status spans in SalaryInput history are still hand-written — a fifth status needs a line there too.
- **Verified:** `backend/scripts/n-money2-followups-check.py` 16/16 ×2, `--base` 7/7; jest 121/2172 unchanged.
- **Not tested:** Railway; Safari/Firefox.

# PR-9 — person drill-down: every day of the month (plan item G10)

Branch `feat/attendance-review-person-days` (from main fa43014). Read only — no table written, no schema change, no
protected file.

## What
- Service `personMonthDays(db, code, month, year, { releaseDays, prevReleaseDays, config })` → `{ code, name, month, year,
  basis, rule_version, release_days, person, days[], totals, engine, consistent }`. One entry per calendar day: status, in /
  out (final), `times_from` machine | gate_register | missing, shift used (name, start–end, hours, mode) or
  `not_assessed_reason`, late / early minutes as measured, `late` / `early` = `counted` | `excused:<reason>` | `none`, notes.
- Inputs: the month's stored run (final, else draft) → its config snapshot + confirmed release days; else rules in force +
  detected release days (as Trends). Previous month's release days = its run's.
- Route `GET /api/analytics/attendance-review/person/:code/days?month&year` (admin; 400 bad month / code; 404 no attendance).
- UI: person history window → each month row has an expand control → day table (scrolls in its own box).

## Reused SQL vs JS
- **Reused SQL:** the engine's own `IMPORT_BASE` / `MASTER_BASE` + the `PERSON_MONTH_TAIL` CTE chain (pl → w → x → y → z)
  up to its aggregate SELECT, sliced off at runtime (`DAY_TAIL_CUT`) and joined per day. So isl / exc / fhl / lng / exl /
  ise / short are the engine's own expressions (stayed late, full hours, D-6, release day, Sunday, misread, MP-2 dates
  taken out, gate pass, out not verified, half day, not-assessed modes).
- **Reused JS:** missedOutPlan, loadPersonMonth, remeasureRows, buildPeople, applyExclusions, applyMissedOut — person-level
  steps (left out, loader, early-exempt / contract loader, shift-fit on/off, MP-2 counts) come from the engine itself.
- **Re-implemented in JS:** `remeasureDays` (per-day copy of `remeasureRows` for one code). Keep both in step.
- Per-day verdict labels (which excuse) are a reading of the engine's flags; the counted set is the engine's.

## Progress
- [x] service personMonthDays + personMonthInputs (exported first)
- [ ] route
- [ ] jest (invariant on both bases, every excuse kind, 400/404/403, nothing written)
- [ ] api.js + UI
- [ ] browser check + older scripts
- [ ] self-debug / user simulation / v2

## Results
(pending)

## Fragile
- `DAY_TAIL_CUT` slices `PERSON_MONTH_TAIL` at `\nSELECT c AS code, ym, COUNT(*)` — if that SELECT line changes, the
  function throws (loud, not wrong).
- `remeasureDays` mirrors `remeasureRows` by hand.

## Session note (for CLAUDE.md, folded in by the planner)
(pending)

## Resume
Read this file + `git log --oneline fa43014..`; continue at the first unticked line.

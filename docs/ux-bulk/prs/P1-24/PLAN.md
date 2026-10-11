# P1-24 — PLAN (Phase 0)
Branch `fix/misspunch-stray-zero` · base origin/main 18bef07 (+ c11ae44 PROMPT.md) · Finding O-3 · MASTER_PLAN §6 P1-24.
Status: **Phase 0 ready — waiting for "go". No source file touched.**

## 1. Re-grep (FACT)
`grep -n '&&' frontend/src/pages/MissPunch.jsx` → 31 hits. Classified below (React renders a falsy NUMBER `0` as text;
`false`, `null`, `undefined`, `''` render nothing).

### The bug (only JSX-child guard whose left side can be the number 0)
| Line | Expression | Left side type | Renders "0"? |
|---|---|---|---|
| L537–539 | `{rec.miss_punch_resolved && (status === 'pending' \|\| …) && canFinance && (<div>✓ Approve ✕ Reject</div>)}` | `miss_punch_resolved` = SQLite INTEGER 0/1 from `GET /attendance/miss-punches` | **YES** — every unresolved row (resolved = 0) prints `0` in the Action cell, right after the Correct button (HR) or alone (finance/viewer) |

### Checked, safe (no change)
| Line | Expression | Why safe |
|---|---|---|
| L110, L111, L156, L221, L223 | plain JS (filter, consts) | not JSX children |
| L242 | `selected.size > 0 &&` | comparison → boolean |
| L251 | `autoStage6 && autoStage6.hasImport &&` | object/null; `hasImport: !!mi` (leaveTriggers.js L233) → boolean |
| L356, L604, L642 | `calendarEmployee &&` / `bulkModal &&` / `finRejectId &&` | object/null, boolean, row id (≥ 1, never 0) or null |
| L422 | `editId !== rec.id && toggle(...)` | onClick handler, not rendered |
| L424–427, L451, L454 | inside `clsx(...)` | className args — PROMPT: leave them (clsx drops 0) |
| L430 | `!rec.miss_punch_resolved &&` | negation → boolean |
| L503, L564, L565 | `rec.miss_punch_finance_notes &&`, `rec.correction_source &&`, `rec.correction_remark &&` | TEXT columns: string / NULL; `''` renders nothing |
| L532 | `(!rec.miss_punch_resolved \|\| status === 'rejected') && canHR &&` | `\|\|` of booleans → boolean |
| L545, L550, L572, L588 | `=== 'approved'`, `isExpanded(id)`, `editId === rec.id`, `allResolved` | booleans |

Also checked: no other numeric `{x && …}` in the file (e.g. counts) — summary cards print numbers directly, not via `&&`.

## 2. Fix (smallest change, one line)
L537: `{rec.miss_punch_resolved` → `{!!rec.miss_punch_resolved`. Logic unchanged (truthiness identical), only the
rendered value for 0 becomes `false` (nothing). No other line touched. P1-09 banner block (L215–225, L588–) untouched.

## 3. Files
- `frontend/src/pages/MissPunch.jsx` (1 line) — source commit.
- `frontend/dist/*` — rebuilt, own commit (`npm run build --prefix frontend`; retry after a minute if "Killed").
- `backend/scripts/misspunch-stray-zero-check.py` — new browser check (pattern: salary-register-report-check.py).
- `docs/ux-bulk/prs/P1-24/PLAN.md`, `PROGRESS.md`; `CLAUDE.md` Last Session entry.

## 4. Verify plan
- jest full suite before (base) and after (branch): record suites/tests (no backend change → identical).
- `misspunch-stray-zero-check.py` (Chromium, PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DB, built dist, port 3124,
  real logins hr + finance, fictional employees T24xx): seed miss-punch rows with resolved 0 (pending), resolved 1 +
  finance pending, resolved 1 + finance rejected, resolved 1 + approved. Assert per Action cell: no text node equal to
  "0" (hr and finance); Correct present for resolved-0 rows (hr); Approve/Reject present for resolved-1 + pending rows
  (finance); Re-resolve on rejected (hr); "Finalised" on approved; 0 page/console errors, 0 API ≥ 400.
- `--base` on an origin/main 18bef07 worktree dist (built under /tmp): the "0" is present on resolved-0 rows.
- Self-debug + user simulation (happy: HR corrects a row; edge: finance view of an unresolved row, empty month).

## 5. Questions for the planner
None blocking. Note: the "0" shows for EVERY role on unresolved rows (not only beside Correct) — the one-line fix
covers all roles.

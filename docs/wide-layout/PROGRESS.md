# Wide layout — PROGRESS (single source of truth)

> **Rule for every session (chat or Claude Code):** read this file first. After every checkpoint
> (CP) is finished, update the CP table + the RESUME block BEFORE starting the next one, and commit
> it. After a context compaction, re-read this file and continue from the first CP not marked DONE.
> Do not trust memory of earlier turns over this file. If this file and the code disagree, the code
> wins — fix this file.

## RESUME (5 lines — read first)
1. Branch `feat/wide-layout`, repo `/home/claude/hr-salary-system`. Frontend display only. Owner merges via GitHub web UI.
2. Current checkpoint: **CP-6 (merge origin/main 909c803 into the branch, rebuild dist, re-run checks)**.
3. Done: CP-0…CP-5. Owner has seen the before/after renders and approved the layout (10 Oct 2026, 16:19 IST).
4. Checks: `npm run build --prefix frontend` → `python3 backend/scripts/wide-layout-check.py .` (must be 47/47) → `python3 backend/scripts/wide-layout-render.py . /home/claude/renders/after` (0 page errors).
5. Never push to main. Never touch backend/, salaryComputation.js, dayCalculation.js, schema.js, payroll.js.

## Checkpoints
| CP | What | Status | Evidence |
|----|------|--------|----------|
| CP-0 | Diagnose: 9 pages capped by `max-w-screen-xl` (1280px); Stage 7 register 25 cols × px-4 padding; scrollbar after last row; sticky thead dead | DONE | grep of pages/*.jsx; Sep 2026 prod column counts (Late/Early/LWP/OD 0 of 211) |
| CP-1 | Owner rulings captured (below) | DONE | chat 10 Oct 14:36 IST |
| CP-2 | Render harness + BEFORE screenshots | DONE | commit 22c2c24; /home/claude/renders/before (60 PNG, 0 errors) |
| CP-3 | Phase 0 plan → reviewed → GO | DONE | coordinator GO with answers 1–6 + X1/X2/X3 |
| CP-4 | Build: 9 pages + Stage 7 rework + dist | DONE | commits 66bbc71, 4acc820, 50696d1 |
| CP-5 | Verify: 47/47 checks (re-run independently), AFTER renders, owner review page | DONE | wide-layout-check.py 47/47; review artifact published; owner approved |
| CP-6 | Merge origin/main (909c803, PR #77 touched LoanImport.jsx + dist) → resolve → rebuild dist on merged tree → re-run check + render | TODO | |
| CP-7 | CLAUDE.md "Last Session" entry for this work + this file marked complete; commit | TODO | |
| CP-8 | Push `feat/wide-layout`; verify `git rev-parse HEAD` == `git rev-parse origin/feat/wide-layout` | TODO | |
| CP-9 | Owner opens PR in GitHub UI and merges; Railway deploys | OWNER | |
| CP-10 | Post-deploy check on production (list below) | OWNER + chat | |

## Owner rulings (binding)
- All 9 pages lose the 1280px cap (`max-w-screen-xl` → `w-full min-w-0`); cap only elements that look broken when wide.
- Every register column stays individually visible — no merging of leave or recovery columns.
- Default view: Everything ≥ 768px, Review below. Remembered in localStorage key `salreg.view.v1` (try/catch).
- Totals row: Earned total = "Total Gross" card; Take Home total (held excluded, tooltip) = Take Home card. Gross column summed, no card. Leave-day sums kept; Days blank.
- Stat cards auto-fit. Rows with 3+ badges may wrap to 2 lines. Pinning from 768px up only.
- Hold reason: truncated in the Employee pill + full in tooltip + full in drill-down.
- X1 stray "0" in register header fixed; X2 drill-down sticky to the visible width (ResizeObserver); X3 header buttons wrap on phones.
- ₹0 keeps its text, rendered light grey (`.salreg-mute`). Existing "–" stays "–".
- Never touch backend, compute, API calls, mutations, finalise/stale gating, sort/filter logic, downloads.

## Files changed (vs 2cd0b26)
- `frontend/src/pages/SalaryComputation.jsx` (+836/−381), `frontend/src/index.css` (+45, scoped `.salreg` block)
- 1–2 lines each: DailyMIS, LoanDetail, Loans, MissPunch, NightShift, SalaryAdvance, SalaryInput, ShiftVerification; `components/loans/LoanPolicy.jsx`, `components/loans/LoanImport.jsx`
- New scripts: `backend/scripts/wide-layout-render.py`, `backend/scripts/wide-layout-check.py`
- `frontend/dist/*` rebuilt (own commit). No backend app file changed.

## CP-6 procedure (merge)
1. `git fetch --depth=200 origin main feat/wide-layout` (clone is shallow).
2. `git merge origin/main` — expected conflicts: `frontend/dist/**` only, maybe `LoanImport.jsx`.
3. Source conflict in `LoanImport.jsx`: keep main's bulk-confirm changes AND this branch's one-line `max-w-xl` cap on the approve-note input.
4. dist conflicts: never hand-merge. `git checkout --theirs frontend/dist` is NOT enough — delete `frontend/dist`, run `npm run build --prefix frontend`, `git add -A frontend/dist`.
5. Re-run check (47/47) and render (0 page errors). Commit the merge.

## Post-deploy checks (CP-10)
- Stage 7, All companies, September 2026: totals row Earned = Total Gross card; Take Home = Take Home card.
- Scroll the register right: Employee stays left; Net / Take Home / status / buttons stay right.
- Expand a row: full breakdown readable without scrolling sideways.
- Switch Review / Statutory / Everything, reload → choice kept.
- Unrelated pages unchanged in behaviour: Miss Punch correct a punch, Loans import screen (PR #77 bulk confirm), Salary Input edit.
- Hard refresh (⌘⇧R) first — the browser may hold the old bundle.

## Found, not fixed (out of scope)
- Miss Punch: stray "0" next to Correct (`rec.miss_punch_resolved && …`). One-line follow-up.
- At 390px the main area still scrolls sideways on 6 pages (wide tables) — belongs to the mobile project.
- Not tested: Safari/Firefox (sticky inside overflow), real production data, finance-role Release button inside a pinned column, blocked browser storage.

## Change log
- 10 Oct 2026 — CP-0…CP-5 done in one chat session (Opus agents for harness + build).
- 10 Oct 2026 16:2x IST — file rewritten as the checkpoint document; CP-6 opened (main moved to 909c803).

# HANDOFF — Wide layout (9 pages full width + Stage 7 register rework)
**Date:** Sat 10 Oct 2026, ~16:50 IST · **Project:** HR Salary System (Indriyan Beverages / Asian Lakto Ind. Ltd.)
**Status in one line:** Built, verified, merged to main as PR #78 (`d11a6c7`). Two things are open: the owner's browser check on Railway (CP-10), and a small docs PR (`docs/wide-layout-cp9`).
**Companion data file:** `HANDOFF_wide_layout_10Oct2026.xlsx` (reference totals, column map, pin offsets, checks, files).

---

## 1. Re-entry block (read this first in a new session)
```
Repo:        /home/claude/hr-salary-system   (shallow clone — fetch with explicit refspecs)
main:        a5aec9a  (= #79 ED finance-review UX, on top of #78 wide layout d11a6c7)
Checkpoint:  docs/wide-layout/PROGRESS.md  → RESUME block. Project copy: claude/wide-layout-progress.md
Current CP:  CP-10 — owner's post-deploy browser check on Railway (list in §9)
Open PR:     docs/wide-layout-cp9 (a86caeb) — PROGRESS.md CP-9 DONE + fixes the stale CLAUDE.md "NOT merged" line
             https://github.com/abhinavpoddar27-pixel/hr-salary-system/pull/new/docs/wide-layout-cp9
Checks:      npm run build --prefix frontend
             python3 backend/scripts/wide-layout-check.py .                         → must be 47/47
             PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 backend/scripts/wide-layout-render.py . /home/claude/renders/after
                                                                                     → 0 page errors
Rules:       never push to main; merge in the GitHub web UI only; rebuild + commit frontend/dist after any frontend edit;
             do not touch salaryComputation.js, dayCalculation.js, schema.js, payroll.js, or any backend app file for this work.
Next:        (1) Abhinav runs the §9 checks and reports. (2) Merge the docs PR.
             (3) Optional: one-line Miss Punch stray-"0" fix as its own PR.
```

## 2. Context — the problem
- Abhinav: Stage 7 (Salary Computation) "the entire page is cut and hidden, while the screen is empty". Optimise desktop now. Mobile is a separate, later project.
- **FACT (diagnosis, CP-0):**
  - 9 pages were wrapped in Tailwind `max-w-screen-xl`, a 1280px cap. On a wide monitor the right side was empty while content was cut off.
  - The Stage 7 register had 25 columns with `px-4` padding. Its horizontal scrollbar sat after the last row, so on 200+ rows you could not reach it.
  - The sticky `<thead>` did not work because the table was not inside its own scroll container.
  - Production September 2026 column usage: Late / Early / LWP / OD were 0 in all 211 rows. Those columns were wasting width.
- The 9 pages:
  - Stage 7 (`SalaryComputation.jsx`)
  - DailyMIS
  - LoanDetail
  - Loans
  - MissPunch
  - NightShift
  - SalaryAdvance
  - SalaryInput
  - ShiftVerification (Stage 3)
  - Plus two components under Loans: `LoanPolicy.jsx` and `LoanImport.jsx`.

## 3. How we got here (chronology, 10 Oct 2026)
1. Ideation in chat. Abhinav's four rulings (14:36 IST):
   1. All pages, and render before/after so nothing breaks.
   2. Every register column stays individually visible.
   3. Default view: Everything on desktop, Review on mobile.
   4. Build with Claude Code agents on Opus, with planning in chat.
2. A render harness was built and the BEFORE screenshots taken: 60 PNGs, 0 errors (`22c2c24`).
3. Phase 0 plan was written by the agent, reviewed by me, and given GO. Answers 1–6 were settled, plus three extra fixes, X1/X2/X3.
4. Build commits:
   - `66bbc71` — the 9 pages and the Stage 7 register as its own scroll window
   - `4acc820` — check script and user simulation
   - `50696d1` — dist rebuild
5. Verification: 47/47 checks and AFTER renders. A review page was published as an artifact (https://claude.ai/artifact/SmzPbsQkwmhD8MSn9aamkf). Abhinav approved at 16:19 IST.
6. Abhinav asked for a proper checkpoint document before building further, to survive auto-compaction. `docs/wide-layout/PROGRESS.md` was created (`d3353f2`) with CP-0…CP-10 and a RESUME block.
7. Main moved twice:
   - First to `909c803` (#77 loan import bulk confirm).
   - Then to `02e1115` (#76 ED return-to-HR).
   - Merged in `2b442ec`. Only dist conflicted, and dist was deleted and rebuilt, never hand-merged.
   - `LoanImport.jsx` auto-merged: main's bulk confirm is kept, plus our one-line `max-w-xl` cap.
   - After the merge: 47/47, renders 0 errors.
8. Other commits:
   - `f24ea82` — CLAUDE.md "Last Session" entry (CP-7).
   - `9039600` — CP-8 pushed. The stop hook reported "no remote branch"; that was a false alarm from the shallow clone, fixed with an explicit fetch refspec plus branch config.
9. PR #78 was opened from the compare link, and Abhinav merged it (`d11a6c7`). #79 merged after it but touched only `ExtraDutyGrants.jsx` and a script.
10. "merged, check now":
    - Verified with git (§7).
    - Pulled production reference totals (§8).
    - Recorded CP-9 DONE on the branch `docs/wide-layout-cp9` (`a86caeb`, pushed; the same false stop-hook alarm was fixed the same way).
    - Updated the project doc copy.

## 4. Decisions (binding owner rulings)
- **Page width:**
  - All 9 pages: `max-w-screen-xl` → `w-full min-w-0`.
  - Only elements that look broken when wide get a cap:
    - LoanPolicy input `max-w-xl`
    - LoanImport approve-note `max-w-xl`
    - MissPunch EditRow remark `max-w-xl`
    - SalaryInput Current/Proposed grid `max-w-3xl`
- **Every register column stays individually visible.** No merging of leave or recovery columns. The views only hide columns per view; "Everything" shows all 25.
- **Views:**
  - Review — 11 columns: Employee, Dept, Days, Gross, Earned, OT / ED, Ded, Net, Take Home, status, actions
  - Statutory — 14 columns: Review + PF, ESI, LWF.
  - Everything — 25 columns.
  - Default: Everything at ≥ 768px, Review below 768px.
  - The choice is remembered in localStorage key `salreg.view.v1`. Reads and writes are wrapped in try/catch; blocked storage falls back to the default.
- **Pinning (≥ 768px only):**
  - Employee pinned left (w 280).
  - Pinned right: Net, Take Home, status, actions.
- **Header:** sticky header inside the register's own scroll window (`md:max-h-[calc(100vh-9rem)]`).
- **Totals row** ("Totals — N shown"):
  - Earned total = Total Gross card (all rows).
  - Take Home total excludes held rows (`salary_held`), with a tooltip, and matches the Take Home card.
  - Gross column is summed but has no card.
  - Leave-day sums are kept; Days is blank.
- **Zero display:** ₹0 keeps its text but is shown light grey (`.salreg-mute`). An existing "–" stays "–".
- **Hold reason:** truncated in the Employee pill, full text in the tooltip and in the drill-down.
- **Stat cards:** auto-fit grid. Rows with 3+ badges may wrap to 2 lines.
- **Checklist:** passed items fold away ("N of M checks passed — show").
- **Extra fixes:**
  - X1: the stray "0" in the register header is fixed.
  - X2: the drill-down sticks to the visible width (ResizeObserver).
  - X3: header buttons wrap on phones.
- **Never touched:** backend, compute, API calls, mutations, finalise/stale gating, sort/filter logic, downloads.

## 5. Proposals made but NOT accepted / not done
- **Miss Punch stray "0" next to Correct** (`rec.miss_punch_resolved && …` renders 0). Found, not fixed. Offered as a one-line separate PR; awaiting a yes.
- **Mobile pass:** at 390px, 6 pages still scroll sideways because of wide tables. This belongs to the separate mobile project.
- **Separate desktop and mobile versions:** discussed during ideation. The decision was one responsive page, with views and pins switching at 768px rather than two separate pages.

## 6. Landmines (fragile — read before touching Stage 7)
1. **`.salreg` scoped CSS exists for a reason.** `.table-compact td` colour beats Tailwind `text-*` on a `<td>`. The ₹0 grey goes through `.salreg-mute` / `.salreg-mute-soft` in `index.css`, not through Tailwind classes. "Fixing" it with Tailwind will silently do nothing.
2. **The `COLS` array is the single source** for `<th>`, `<td>`, tfoot and the drill-down colSpan. A new register column is added to `COLS` ONLY. This replaces the older CLAUDE.md rule "header / body / tfoot / DrillDownRow 25 cells" from the LWF entry.
3. **Pinned right offsets are hard-coded widths:**
   - actions w 104, right 0
   - status w 120, right 104
   - Take Home w 104, right 224
   - Net w 96, right 328
   - If any pinned width changes, every offset to its left must change too.
4. **Sticky needs `border-separate border-spacing-0`** on the table, and the register must stay its own `overflow-auto` container. Collapse borders or remove the container and the pins and header stop sticking.
5. **localStorage `salreg.view.v1`:** keep the try/catch. Blocked storage (private window, DLP) must fall back to the default, not crash the page.
6. **Drill-down width** follows the scroll container via ResizeObserver. If the container changes, check that the expanded row still fits the visible width.
7. **Card vs totals definitions must stay in lockstep.**
   - Card: `takeHome = Σ (take_home || total_payable || net_salary)` over rows with `!salary_held`; `gross = Σ gross_earned` over all rows.
   - Totals row: uses the same `takeHomeOf()` and the same held filter.
   - If one changes, change both.
8. **Shallow clone:** the remote-tracking ref for a new branch isn't created automatically. The stop hook then says "no remote branch" even after a successful push. Fix:
   ```
   git config --add remote.origin.fetch '+refs/heads/<b>:refs/remotes/origin/<b>'
   git fetch
   git config branch.<b>.remote origin
   git config branch.<b>.merge refs/heads/<b>
   ```
9. **dist conflicts:** never hand-merge. Delete `frontend/dist`, run `npm run build --prefix frontend`, then `git add -A frontend/dist`.
10. **Browser cache:** Railway serves the committed dist; the browser may hold the old bundle. Always ⌘⇧R before judging the page.

## 7. Key data / evidence
- **Merge check (FACT, git, 10 Oct 16:4x IST):**
  - `git merge-base --is-ancestor 9039600 origin/main` → true.
  - The merge commit on main is `d11a6c7`, "Merge pull request #78 … feat/wide-layout".
  - main's `frontend/dist/assets/SalaryComputation-DN_J8H6V.js` contains `salreg.view.v1`.
  - `git grep max-w-screen-xl origin/main -- frontend/src` → no matches.
  - `git diff --stat d11a6c7 origin/main -- frontend/src backend` → only `ExtraDutyGrants.jsx` and `backend/scripts/ed-finance-review-ux-check.py`. #79 cannot have affected this work.
- **Files changed by the build (vs 2cd0b26):**
  - `pages/SalaryComputation.jsx` (+836/−381)
  - `index.css` (+45, `.salreg` block)
  - 1–2 lines each: DailyMIS (L181), NightShift (L62), SalaryAdvance (L171), ShiftVerification (L153), LoanDetail (L171), Loans, MissPunch (L58 cap), SalaryInput (L270 cap), `components/loans/LoanPolicy.jsx` (L114), `components/loans/LoanImport.jsx` (L395)
  - new: `backend/scripts/wide-layout-render.py`, `backend/scripts/wide-layout-check.py`
  - `frontend/dist` rebuilt
  - No backend app file changed.
- **Verification:**
  - `wide-layout-check.py` 47/47 before and after the merge. It covers column counts per view, pins, sticky rows, totals vs cards, persistence, X1/X2/X3, no page-level horizontal scroll, and a user simulation.
  - Render harness: 9 pages × 2560/1440/390. The scratch DB has 64 fictional employees with a real Stage 6/7 run for Sep 2026. Results: 60 PNGs, 0 page errors, 0 console errors, 0 API ≥ 400; the wrapper is 100% of main at 2560.
- **Renders on disk:** `/home/claude/renders/before`, `/home/claude/renders/after`, `/home/claude/renders/after-merge`. These are ephemeral container paths and are lost when the container is reclaimed. The review artifact keeps a copy.

## 8. Production reference numbers (FACT, HR SQL Console, read-only, 10 Oct 2026)
September 2026, `salary_computations`. Held = `salary_held` (the screen's own definition).

| Scope | Rows | Held | Earned total (= Total Gross card) | Take Home, held excluded (= Take Home card) |
|---|---|---|---|---|
| All companies | 211 | 19 | ₹37,43,496.73 | ₹29,16,651.09 |
| Asian Lakto Ind Ltd | 197 | 16* | ₹36,47,213.41 | see note |
| blank company label | 14 | 3* | ₹96,283.32 | see note |

\* The per-company split was pulled with a stricter held definition (`salary_held=1 AND hold_released=0`), so its held counts and take-home do not match the screen's rule. Use only the All-companies row for the CP-10 comparison. The per-company Earned totals are unaffected because they don't depend on the held rule.

INFERENCE: the 14 rows with a blank `company` label are the same mixed-label pattern seen elsewhere this week (`monthly_imports` labels). Not investigated here and not this project's scope.

## 9. Unverified state — the CP-10 browser check (owner)
| | |
|---|---|
| **Surface** | Browser, the Railway app, logged in as admin or finance |
| **Preflight** | Hard refresh (⌘⇧R) on any page |
| **Action** | Run the six checks below |
| **Expected** | Everything below as described |
| **Verify** | The two totals equal ₹37,43,496.73 and ₹29,16,651.09 |
| **Undo** | Not needed — display only. A rollback would be reverting PR #78 in the GitHub UI. |
| **Return** | "ok", or the step number plus what you saw |

1. Stage 7 → All companies → September 2026. The totals row shows Earned = Total Gross card (₹37,43,496.73) and Take Home = Take Home card (₹29,16,651.09).
2. Scroll the register right. Employee stays on the left; Net, Take Home, status and the buttons stay on the right. The header stays at the top while scrolling down.
3. Expand any row. The full breakdown is readable without scrolling sideways.
4. Switch to Review, then reload. It is still Review. Switch back to Everything.
5. Miss Punch: correct a punch. Loans → Import: the bulk confirm buttons are present. Salary Input: an edit works. All should behave as before.
6. Optional: a finance login sees the Release button inside the pinned action column on a held row.

**Never tested:**
- Railway itself
- Safari and Firefox (sticky inside overflow behaves differently)
- real production data in the page (the scratch DB only)
- the finance Release button inside the pinned column
- blocked browser storage
- the Loans → Import tab in the harness (checked only by grepping the bundle)

## 10. Open questions
- Should the one-line Miss Punch stray-"0" fix go ahead as its own PR?
- When does the mobile project start? It covers the 6 pages that scroll sideways at 390px; the Stage 7 Review view is already the phone default.

## 11. Next actions (in order)
1. **Abhinav:** run the §9 check and send back "ok" or the step plus what was seen.
2. **Abhinav:** merge PR `docs/wide-layout-cp9` in the GitHub UI. It marks CP-9 done, records the reference totals and corrects the CLAUDE.md line.
3. **Chat:** after the check passes, mark CP-10 DONE in `PROGRESS.md` (another docs-only PR) and in the project copy, and close the wide-layout project.
4. **Optional:** Miss Punch "0" fix (one line, its own branch, rebuild dist, PR).
5. **Later:** the mobile project.

## 12. Links
- PR #78 (merged): from https://github.com/abhinavpoddar27-pixel/hr-salary-system/compare/main...feat/wide-layout
- Docs PR (open): https://github.com/abhinavpoddar27-pixel/hr-salary-system/pull/new/docs/wide-layout-cp9
- Review artifact (before/after renders): https://claude.ai/artifact/SmzPbsQkwmhD8MSn9aamkf
- Checkpoint doc: `docs/wide-layout/PROGRESS.md`; project copy `claude/wide-layout-progress.md`

# CC PROMPT — Contractor Report (PR-2, read-only) — branch `feat/contractor-report`

> Verbatim copy of the owner's prompt for this PR, kept in-repo so any future
> session (or a context compaction) can recover the full spec. The visual /
> behaviour prototype referenced below is deliberately NOT committed: it
> embeds real employee names.

## RESUME BLOCK (read first, every time, including after a context compaction)
1. If `docs/progress/contractor-report-pr2.md` exists: read it, continue from its NEXT line. Do not redo DONE steps.
2. After EVERY small step (a file created, a query run, a test passing), update that file: STATE, DONE, NEXT, RULINGS, NUMBERS. Commit it with the phase commit.
3. Never skip a STOP gate. A STOP means: print the gate summary, then wait for the owner to type `go`.

## GOAL
Add a read-only **Contractor Report** page to the HR app, matching the approved prototype at `~/Downloads/contractor-report-prototype.html` (open it and read its HTML/CSS/JS as the visual and behaviour spec). **Do NOT copy the prototype into the repo** — it embeds real employee names.
Owner: Abhinav (admin). Stack: Node/Express + better-sqlite3 backend, React/Vite/Tailwind frontend, Railway serves the committed `frontend/dist/`.

## IN SCOPE
Page `/workforce/contractor-report`, title "Contractor Report", sidebar child under **Workforce** after "Contractor Management". Tabs:
1. **Day Report** — date nav (‹ select ›); toggle **By contractor / By department**. Contractor rows: ☀ Day, ☾ Night, Biometric, Daily wage, Total, DW cost, Flags; expandable to employees (Code, Name, Role, Shift, Status, Joined, flags) and DW entries (Record, Department normalised + "as typed", Heads, Rate, Amount, Status, Gate ref). Department rows: DW departments + "Area not recorded · <role>" buckets for biometric workers, contractor chips, expandable.
2. **Daily Wage Register** — one row per date: DW heads, DW cost, DW department chips, biometric day, biometric night, total heads, man-days, both-source flags. Row click → Day Report.
3. **Grid View** (interactive) — employee × date grid for one contractor (default Meera). Cell click → selection panel (person, date, status, shift, role, pre-joining flag, gang's day: day/night/DW heads + departments, "Open day report" button). Name click → month summary. Date header or footer count click → gang's day. Arrow keys move selected cell, Enter opens day report. Column hover highlight. Search (name/code), Sort (Department/role [grouped rows], Name, Code, Days worked, Night shifts, Joining date), Shift filter (All / Worked any night / Day only), "Only flagged". Night cells purple like AttendanceRegister (`bg-purple-50 text-purple-700`); pre-joining = red ring; footer rows ☀ day heads, ☾ night heads, DW heads (red when both sources). Row end: day count, night count, man-days, payroll days, ✓/≠ tie.
4. **Commission** — PREVIEW ONLY, finance/admin only (hide tab + reject API for other roles). Man-days by contractor (day/night/total), DW heads, a client-side rate input (default blank, validated ≥0, inline error), date-wise table for the selected contractor. Banner: "Preview — rates are not saved. The commission engine is a later release." Nothing persisted.
5. **Exceptions** (count badge) — sections: both sources same contractor same day (with max double pay), two DW records one contractor one day, punched before joining date, biometric ≠ payroll days, punching after exit date, no joining date, DW entries not approved, test entries to void. Rows with a date → Day Report.
Top: month + contractor selects; 6 stat cards (Biometric man-days, Day shift, Night shift, DW worker-days, DW cost, Both-source days). Respect the header company selector (store `selectedCompany`) for biometric workers; show a yellow banner with the % of man-days whose employee company is not a valid company.
Light theme only, using the app's existing classes: `section-title`, `section-subtitle`, `card`, `card-header`, `card-body`, `table-compact`, `stat-card border-l-4`, `badge-*`, `label`, `select`, `input`, `btn-secondary`, `btn-ghost`, DailyMIS segmented control (`flex gap-1 bg-slate-100 rounded-xl p-1 w-fit`, active `bg-white text-blue-700 shadow-sm`).

## OUT OF SCOPE (later PRs — do not start them)
Commission rates table/engine/snapshots · Excel export · Stage 7 hook · finalize freeze · merging DW contractor records · voiding test rows · fixing exit dates / joining dates · contractor master + assignment history · naming daily wagers at gate. **No DB writes. No schema changes. No new npm dependencies** (propose at the gate if truly needed).

## DO NOT MODIFY
`salaryComputation.js`, `dayCalculation.js`, `schema.js`, `payroll.js`, `exportFormats.js`, all daily-wage routes/pages/services, `utils/employeeClassification.js`, DailyMIS and AttendanceRegister pages (reference only), existing tables/columns, `package.json` dependencies. Allowed edits to existing files are ONLY: one route-mount line in the Express app file, one `<Route>` in the React router file, one nav child in the sidebar items array. Everything else is new files.

## OWNER RULINGS (locked)
- Population: employees whose `employment_type` contains "contract" (case-insensitive). Excluded departments: SECURITY, BISLERI WORKERS. Read the flag `is_contractor` nowhere.
- Present weights on `COALESCE(status_final,status_original)`: P=1, WOP=1, ½P=0.5, WO½P=0.5, everything else 0. Ignore rows with `is_night_out_only=1`. Heads = rows with weight>0.
- Night shift = `is_night_shift=1`; night is counted on the attendance date (in-time date).
- Payroll man-days exclude dates before `date_of_joining` (when set). Do NOT clip by `date_of_exit` (payroll doesn't) — flag instead.
- DW counted only when `status IN ('approved','paid')`. Test contractors RAJESH KUMAR, SURESH SINGH are excluded everywhere except "Test entries to void".
- Contractor aliases (match on `UPPER(TRIM(name))`), display name in brackets:
  biometric dept → MEERA, MRREA → [Meera]; PAPPU CONT [Pappu]; PARIKSHAN PASWAN [Parikshan Paswan]; KULDEEP CONT [Kuldeep]; MANPREET CON [Manpreet]; MOTI LAL CON [Moti Lal]; RANJIT CONT [Ranjit]; RAJENDRA CONT [Rajendra]; DAVINDER CONT [Davinder]; JIWAN CONT [Jiwan Lal]; SAJAN [Sajan]; AMAR [Amar]; DEFAULT [Unmapped (DEFAULT)].
  DW contractor → MEERA CONT, MEERA CONTRACTOR, MEERA DAILY WAGE [Meera]; PAPPU, PAPPU CONT [Pappu]; JIWAN LAL CONT [Jiwan Lal]; SAJAN CONT [Sajan]; CHOTTU CONT [Chottu]; JAVED PAINTER (SHABBIR) [Javed painter]; DHANRAJ (FOR LIFTTER), JITENDER FLOOR LIFTER, SANJAY FLOOR LIFTER [Floor lifters]; SAJJAN+JIWAN LAL (12-H) [Sajan + Jiwan Lal (12-h)] (compare it against Sajan AND Jiwan Lal biometric for both-source).
  Unknown names: show under their own name with a grey "not mapped" badge — never drop them.
- DW department normaliser (on the typed text, in this order): starts "utility" → Utility; contains "zeera" → Zeera 400 ml line; contains "night" → Production · night; "paint" → Painting; "store" → Store; "godown" → Godown; "prod" → Production; "housekeeping" → Housekeeping; "etp" → ETP; "mistri" → Maintenance (mistri); else the trimmed text. Always keep the typed text too.
- Role from `designation`: LODING/LOADING → Loading; SUPERVISOR → Supervisor; HELPER → Helper; S.GUARD/GUARD → Guard; SWEEPER → Sweeper; blank → No designation; else title-case. Biometric contract workers have NO work department in the data — show "Area not recorded · <role>".
- Both-source max double pay for a contractor-day = `min(bio_heads, dw_heads) × (dw_cost / dw_heads)`.
- Tie-out = payroll man-days vs `day_calculations.total_payable_days` for the same employee/month (only when a row exists).
- Put all maps/rules in ONE config file so a later PR can replace them with a master table.

## PHASES
- **Phase 0** — setup, read, plan → STOP.
- **Phase 1** — prove the numbers on production (read-only) against ACCEPTANCE → STOP.
- **Phase 2** — backend: config + pure service + 3 GET routes + jest tests → STOP.
- **Phase 3** — frontend: page + nav + route + committed `dist` + user simulation → STOP.
- **Phase 4** — code review, DO-NOT-MODIFY diff check, push. Owner merges via GitHub web UI.

## ACCEPTANCE (live data as of 19 Sep 2026)
| Check | Expected |
|---|---|
| April: biometric heads / day / night | 2,278 / 1,951 / 327 |
| April: payroll man-days vs Σ day_calculations (same workers) | 2,238 = 2,238, tie-out mismatches 0 |
| April: DW heads / DW cost | 699 / ₹4,44,930 |
| April: both-source days / max double pay | 21 (all Pappu) / ₹22,736 |
| April: two-DW-record days | 1 — 4 Apr Pappu: PAPPU 12×₹600 + PAPPU CONT 2×₹650 |
| April: pre-joining | 3 workers; 60285 = 21 days |
| May: biometric heads / day / night | 2,590 / 2,197 / 393 |
| May: man-days / day / night | 2,587.5 / 2,195 / 392.5 |
| May: DW heads / DW cost | 827 / ₹5,13,670 |
| May: both-source | 5 days, all Meera (8, 9, 13, 14, 23 May), ₹12,000 |
| May: tie-out mismatches | 1 — 60298: 19 vs 22 |
| 23 May | biometric 105 (88 day / 17 night), DW 53, total 158; Meera 71 (65/6) + 10 |
| 9 May DW departments | Utility 21, Zeera 400 ml line 13, Production · night 13, Godown 1 |

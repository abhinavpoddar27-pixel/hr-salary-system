# CC PROMPT — Contractor Report 2.1 — branch `feat/contractor-report-2-1`

## RESUME BLOCK (read first, every time, including after compaction)
1. If `docs/progress/contractor-report-2-1.md` exists: read it and continue from NEXT. Never redo DONE steps.
2. After EVERY small step, update that file (STATE, DONE, NEXT, RULINGS, NUMBERS) and commit it with the phase commit.
3. At a STOP, print the gate summary and wait for the owner to type `go`.

## CONTEXT
The read-only Contractor Report (PR-2, `docs/prompts/contractor-report-pr2.md`, `docs/progress/contractor-report-pr2.md`) is live on main. Read both files first — every rule and ruling in them still holds unless changed below. Same stack, same house patterns, same test locations, same dist-commit rule.

## CHANGES (owner rulings, 19 Sep 2026)
**A. Grid View shows people who worked.** Default list = employees with at least one day of weight > 0 (P, WOP, ½P, WO½P) in the selected month, whatever their current status. Add a checkbox "Show people with no punch this month (N)", off by default; when on, those rows appear greyed at the bottom under a group row "No punch this month". Title reads "<Contractor> · <Month> · X worked · Y no punch". Display only.
**B. New Exceptions section: "Active on roster, no punch for 30+ days".** Employees in the report population with `status = 'Active'` whose last present day (weight > 0, any date) is more than 30 days before today, or who never punched. Columns: code, name, contractor, joined, last punch (or "never"), days since. Sorted by days since, descending. Labelled "as of today" and independent of the month selector. Flag only — HR marks people Left in Employees; this PR writes nothing.
**C. Payroll tie-out uses payroll's own status rule.** Stage 6 ignores an HR miss-punch resolution until Finance approves it (`effectiveStatusForDay` in `dayCalculation.js`). The report reads `status_final`, so every correction awaiting Finance shows up as a false mismatch.
- For the "Biometric days don't match payroll days" comparison only, compute payroll-view man-days with the same rule. Import `effectiveStatusForDay` if it is exported and pure; otherwise mirror the rule in `contractorReportConfig.js` with a comment naming the source function and a unit test. Never modify `dayCalculation.js`.
- Split the section in two: **"HR corrections waiting for Finance"** (code, name, contractor, date, punched as, HR marked as, correction source, `miss_punch_finance_status`) and **"Biometric days don't match payroll days"** (only the unexplained remainder).
- Grid View: a day with a correction awaiting Finance gets a dashed amber outline; the selection panel says "Punched <orig>; HR marked <final> from <source>; Finance review pending — payroll still pays this day".
- Heads and man-days everywhere else keep using `status_final`.

## OUT OF SCOPE
Writes of any kind, schema changes, new dependencies, marking anyone Left, exit-date or joining-date clean-up, commission, Excel.

## DO NOT MODIFY
Everything on the PR-2 DO-NOT-MODIFY list, plus `server.js`, `App.jsx` and `Sidebar.jsx` (no new routes or nav this time). Only the Contractor Report config, service, route, tests and its frontend components change.

## PHASE 0 — plan (then STOP)
Preflight: clean tree; `git fetch && git checkout main && git pull`; confirm the PR-2 squash commit is on main; SQL Console MCP `SELECT 1`. Then `git checkout -b feat/contractor-report-2-1`, copy this prompt to `docs/prompts/contractor-report-2-1.md`, create the PROGRESS file. Read `effectiveStatusForDay` (read only) and say whether it is exported and pure. Print the plan: files, the exact rule for C, and the new payload fields.
**STOP.**

## PHASE 1 — prove the numbers on production (read-only)
Run the SQL for A, B and C for September 2026 (to date), May and April, and compare with ACCEPTANCE. Attendance is imported daily, so September numbers may drift. Accept drift only if you can show its cause (new punches, a Finance approval, a Stage 6 rerun); otherwise STOP and report expected vs actual. April and May must match exactly. If everything matches or drift is explained, continue without stopping.

## PHASE 2 — build, test, simulate (then STOP)
Backend and frontend changes; unit tests for A, B, C (including a correction awaiting Finance, an approved correction, and a never-punched employee); full backend suite with the known baseline (3 TDS + flaky protectedWrite) unchanged; rebuild and commit `frontend/dist`. Self-debug pass: re-read, run, fix. Browser user-simulation pass: grid toggle on/off, a gang with nobody working this month, clicking a pending-correction cell, the new Exceptions sections, and April/May regression on the PR-2 acceptance numbers. Use the testing and frontend-design skills if available.
**STOP with results.**

## PHASE 3 — ship
Run the code-review skill on the diff and fix findings. DO-NOT-MODIFY diff and lockfile diff must be empty. Push `feat/contractor-report-2-1` (explicit permission for this branch only; never main), verify `HEAD == origin/feat/contractor-report-2-1`, write the PR description to `docs/progress`, print the PR link, and STOP. Do not merge.

## ACCEPTANCE (chat-verified 19 Sep 2026; Stage 6 for September last ran 19 Sep 07:11 UTC)
| Check | Expected |
|---|---|
| Sept: the 10 current "mismatches" | 0 unexplained; all move to "waiting for Finance" |
| Sept: pending correction days for those 10 | 11 days — 10026 on 1 and 7 Sep; 10008, 10024, 10039, 10040, 10043, 10046, 60294 on 7 Sep; 60170 on 9 Sep; 60231 on 1 Sep |
| Sept: why the gap is exactly 1 or 2 days | each gap = that person's count of P/WOP→A corrections with finance status `pending` |
| Sept: company-wide P/WOP→A corrections pending Finance | 20 (information only) |
| May: unexplained mismatches | exactly 1 — 60298 RANI 19 vs 22 (unchanged) |
| April: unexplained mismatches | 0 |
| PR-2 acceptance (April/May, 13 rows) | unchanged |
| Active contract employees (excl. SECURITY, BISLERI WORKERS) | 320 |
| No punch for 30+ days (as of 19 Sep) | 231, including 7 never punched |
| Gangs with no September punch at all | Moti Lal 18, Ranjit 12, Pappu 10, Davinder 7, Rajendra 4, Sajan 3, Jiwan Lal 3, Sonu 1, Amar 1 |
| Meera, September grid (Active only) | 51 worked (incl. the MRREA-typo worker) · 124 no punch |

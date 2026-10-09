# Leave switchover 2026 — Claude Code build prompt

You are working in `hr-salary-system` (Node/Express + **SQLite via better-sqlite3**, React/Vite; Railway serves the **committed** `frontend/dist`). Branch: `feat/leave-switchover-2026` from latest `origin/main`. Feature branch only — never push to `main`; the owner merges in the GitHub web UI.

## 0. Progress discipline (do this first, keep doing it)
Create `docs/leave-switchover-2026/PROGRESS.md` before any code. After **every** small step (each anchor read, each commit, each test run) append: what was done, file:line, test counts, what is next. Copy the RESUME block (§9) and the rulings (§2) into it verbatim. After a context compaction, read PROGRESS.md first and continue from "Next".

## 1. Why
The owner has ruled that 98 working employees currently typed `SILP`/`Worker` are Permanent staff, and that leave policy changes. Today the leave engine (`backend/src/services/leaveEngine.js`) gives CL/EL only to `employment_type='Permanent'` (`LEAVE_ELIGIBLE_TYPES`, :40), uses 1 EL per 20 days and 7 CL. Automation is installed but OFF and has never applied. This PR prepares the data and code so the owner can apply 2026 balances through the app. **This PR never applies balances and never switches automation on** — the owner does that in the UI afterwards.

## 2. Owner rulings (final — do not reopen)
- R-A **Retype**: the 98 codes in `docs/leave-switchover-2026/permanent-codes.json` become `employment_type='Permanent'`. Change a row only if `status='Active'` AND its current type equals `old_type` in the file (case-insensitive); otherwise skip and report. No other employee is touched. Salary is unaffected (salary only distinguishes contractor vs non-contractor via `isContractorForPayroll`) — prove this in tests.
- R-B **EL** = 1 per **21** days worked, rounded **down**, nothing until **180** days worked in the calendar year (`el_days_per_leave=21`, `el_eligibility_days=180`). Days worked = present + 0.5×half + worked-on-weekly-off + EL taken (unchanged R1).
- R-C **CL** = **4** for a full year (`cl_entitlement_base=4`, `cl_annual_entitlement=4`), pro-rated by effective joining **quarter**: Jan–Mar 4 · Apr–Jun 3 · Jul–Sep 2 · Oct–Dec 1. Keep the existing effective-month rule (DOJ day>1 → next month; Dec mid-month → 0). Formula: `eff>12 ? 0 : Math.ceil(base*(13-eff)/12)`.
- R-D **CL taken outside the app counts as CL used, never as days worked.** EL taken outside counts as days worked (existing behaviour).
- R-E **Outside-system leave** is uploaded by the owner through the existing grants upload, extended with an optional `Leave Type` column (EL default, CL allowed) and a `Days` column (alias of `EL Days`).
- R-F **Hand credits superseded**: `leave_transactions` ids **1** (19954 EL Credit 10), **3** (23700 EL Credit 9), **2** (23700 CL Credit 3) were HR's manual accrual estimates; the engine now computes accrual. Neutralise each with an offsetting `Debit` row (same employee/type/month/year, same days, reason `Superseded by computed accrual — leave switchover 2026 (offsets txn #N)`). Never delete or edit the originals. Leave every other transaction row alone.
- R-G **CL openings**: for every Active Permanent employee (after retype) with a 2026 `leave_balances` CL row, set `opening` = new entitlement; set 2026 EL `opening` = 0. Do not touch `used`/`balance` (the engine recomputes them). Do not create rows (the engine inserts missing rows with the computed opening). Other years untouched.
- R-H Negative balances are left visible (engine is deliberately not floored); report them. CL and EL still lapse 31 Dec. Sales are excluded (no change).

## 3. Scope — five changes
1. `backend/src/services/phase5Features.js` `computeClEntitlement`: quarterly formula per R-C; default base when none passed = 4; update the doc comment and the commented examples. `initCLOpening` (~:191-192) hard-codes 7 — make it read `cl_entitlement_base` and use `computeClEntitlement` for both branches.
2. `backend/src/services/leaveEngine.js` `computeLeavePlan` (~:300-306): `extWorked` must add only rows where `leave_type='EL' AND mode='leave_taken'` (R-D). Grep for any other place that sums external grants into days worked.
3. `backend/src/routes/phase5.js` grants upload (`validateGrantRow` ~:402, insert ~:466): accept `leave type` (EL|CL, default EL) and `days` (fallback `el days`); store `leave_type` from the row; duplicate check keys on leave_type too; error text says "Days". Update `LeaveAutomationTab.jsx` (~:476) help text to list the new columns.
4. New `backend/src/services/leaveSwitchover2026.js` + 2 admin routes in `phase5.js`:
   - `GET /api/features/leave-switchover-2026/preview` → runs every R-A/R-F/R-G/policy change **inside a transaction**, calls `computeLeavePlan(db,{year:2026})`, captures the result, then **rolls back**. Returns: retyped / skipped (with reason), policy before→after, CL openings changed (count + rows), offsets to add, and per-employee plan summary (code, name, dept, days worked, eligible, EL earned/used/external/balance, CL opening/used/external/balance, total, reasons), plus totals and the list of negative balances.
   - `POST /api/features/leave-switchover-2026/apply` body `{confirm:"SWITCHOVER 2026", note}` → refuse if `policy_config.leave_switchover_2026_v1` exists or phrase differs; **first** `await db.backup(<DATA_DIR>/backups/pre-leave-switchover-<ISO>.db)` (create dir; abort on failure); then one transaction doing R-A, policy keys, R-F, R-G, an `audit_log` row per changed employee type / policy key / opening, and the guard key. Return the same shape as preview plus `backup_path`. It must **not** call `applyLeavePlan` and must **not** touch `leave_automation_enabled`.
   - Frontend: a "2026 switchover" card at the top of `LeaveAutomationTab.jsx` (admin only): Preview button → summary tiles + table (filterable, CSV download); Apply button → modal requiring the typed phrase. After apply, show "Next: Preview → Apply in this tab, then turn Automation ON". Rebuild and **commit `frontend/dist`**.
5. Docs: CLAUDE.md Section 0 entry; `docs/leave-automation/OPEN_ITEMS.md` add the rulings above; update HOW_IT_WORKS switch-on steps.

## 4. DO NOT MODIFY
`salaryComputation.js`, `dayCalculation.js`, `schema.js`, `payroll.js`, `recompute.js`, `leaveBalanceGuard.js`, `applyLeavePlan` (no floor, no opening overwrite), `partitionTransactions`, any sales file, any year ≠ 2026 data, `leave_automation_enabled`. No schema change. No new npm dependency.

## 5. Phase 0 gate (mandatory)
Read every anchor above with `sed -n`, confirm line numbers on current `main`, list exact files/functions you will change and the commit plan, write it to PROGRESS.md, then **STOP and wait for the owner's "go"**.

## 6. Commits (one concern each)
1 `feat(leave): CL entitlement 4 by joining quarter` · 2 `fix(leave): CL taken outside the app never counts as days worked` · 3 `feat(leave): grants upload accepts Leave Type and Days` · 4 `feat(leave): 2026 switchover preview + apply` · 5 `feat(ui): switchover card` + dist · 6 docs.

## 7. Verification (all must pass before you report)
- Unit tests: update `slRemoval.test.js` CL expectations; new tests for quarterly table (all 12 months + mid-month + Dec rollover + null DOJ), extWorked EL-only, upload with CL rows / missing type / `EL Days` legacy header / CL duplicate, switchover preview = rollback (row counts and md5 of `leave_balances`, `employees`, `leave_transactions`, `policy_config` identical before/after preview), apply guard + phrase + idempotency refusal, offsets net to zero per (employee, type), retype skips wrong-type and non-Active rows.
- **Salary-neutral proof**: on a fixture with one SILP and one Worker employee, run Stage 6+7 before and after retype; every `salary_computations` money column identical.
- Simulation script `backend/scripts/leave-switchover-simulation.js`: build a fixture DB that mirrors production shape (types, stale CL openings 7/12 with used 12, the 12 `leave_transactions` rows, grants file rows), run upload → preview → apply → `recomputeLeaves` apply; give those fixture employees the real Jan–Sep attendance totals below and assert final balances: 14686 260 days, no leave → EL 12, CL 4 · 17575 228.5 days, Jul leave 9 (CL 4 + EL 5) → EL 11−5 = 6, CL 0 · 23540 156 days, Jul leave 9 (CL 4 + EL 5) → EL −5, CL 0 · 19954 214 days, Aug leave 10 (CL 4 + EL 6) + txn #1 credit 10 and its offset → EL 10−6 = 4, CL 0. EL taken adds to days worked; recompute your expected values from that rule and record them in PROGRESS.md.
- Full backend suite green (TDS baseline excepted, documented); run 3 times.
- Drift query returns 0 rows above ₹1 on the fixture:
  `SELECT employee_code, ABS(net_salary-(gross_earned-total_deductions)) d FROM salary_computations WHERE d>1;`
- Self-review with the `engineering:code-review` skill on the full diff; fix findings; then a v2 pass (re-run everything). Use `engineering:testing-strategy` when designing the fixture.

## 8. Report
Branch + SHA (local == origin), commits, test counts before/after, simulation output, what is fragile, what was not tested. Then stop. Do not open or merge the PR.

## 9. RESUME block (copy into PROGRESS.md)
> Leave switchover 2026 on `feat/leave-switchover-2026`. Read `docs/leave-switchover-2026/PROGRESS.md` §Next first. Rulings R-A…R-H in §2 of PROMPT.md are final. Five changes (§3), DO-NOT-MODIFY (§4), Phase 0 gate already passed only if PROGRESS.md says "GO received". Never apply balances, never switch automation on, never push to main.

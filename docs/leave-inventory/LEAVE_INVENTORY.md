# LEAVE INVENTORY — read-only audit

**Branch** `docs/leave-inventory` · **Base** `origin/main@3806a6d` (2026-06-03) · **Audited** 2026-09-16
**Method** four parallel read-only Explore agents (data model / backend / frontend / history) + orchestrator spot-verification. No source file, no DB, no server was touched. Live production data was **not** reachable (see §8).
**Tagging** every claim is **FACT** (with `file:line`, SHA or command output), **INFERENCE**, or **OPINION**. Where code and docs disagree, **code wins** and the disagreement is logged as a finding.

---

## 1. Executive summary

1. **Leave is fully built and fully shipped** — 6 tables, 34 routes, 15 UI surfaces, all present in `frontend/dist` (35/35 probes). Nothing is half-deployed. **FACT**
2. **But the engine has never been proven to run.** EL/CL accrual has exactly **one** call site (`routes/phase5.js:38`); nothing schedules it — not Stage 7 finalize, not `monthEndScheduler`, not `jobQueue`, not boot. **FACT**
3. **And it has no UI.** `accrueLeaves` ships in the bundle with **zero callers**; `init-cl-opening` and `year-end-lapse` have none either. The annual grant and annual lapse are curl-only. **FACT**
4. **The entitlement rule is contradicted three ways inside shipped code:** `computeClEntitlement` = **7** DOJ-pro-rated, while `employees.js:302`/`:942` hard-code **12** and `schema.js:633` seeds a `cl_annual_entitlement='12'` key that **nothing reads**. **FACT**
5. **Three independent engines write leave and disagree on the core rule** — `leaves.js` (guarded), `financeAudit.js:552` (unguarded, credits payable for CL where Stage 6 does not), `employeePortal.js:57` (no validation at all). **FACT**
6. **Two live authorization holes:** `POST /api/features/accrue-leaves` has no role guard beneath a comment saying balance-mutating endpoints need one; and `/leave-management` is ungated in sidebar, route and router — a `viewer` can approve leave and adjust balances. **FACT**
7. **SL was abolished at the validation layer only.** The consumption branch (`dayCalculation.js:464-466`), the `sl_used` column, the Day-Calc `SL (Sick Leave)` dropdown and the SL payslip line are all still live and shipped. **FACT**
8. **The policy itself was never written down.** The 2026-04-16 session's CLAUDE.md entry was never merged (`796f34e`, stranded on an unmerged branch), leaving a hole in the session log exactly where the leave decision lives. **FACT**

**One-line verdict (OPINION):** the leave module is not unfinished — it is *unoperated, unguarded and undocumented*, and the highest-value fixes are cheap.

---

## 2. Rule matrix per leave type

Every **data** cell is `PENDING` — see §8. Status compares **spec** (the only sourced spec is commit messages + code docblocks; there is no leave spec in `docs/`) against **code**.

| Leave type | Spec (source) | Code (file:line) | Data | Status |
|---|---|---|---|---|
| **CL — entitlement** | 7/yr, DOJ pro-rated 7/6/5/4/3/2 (`2e09606` commit msg) | `phase5Features.js:27-39` → `7 - floor((effMonth-1)/2)` | PENDING | **MATCH** |
| **CL — entitlement (2nd path)** | same | `employees.js:302` hard-codes `12` on employee create | PENDING | **DRIFT** |
| **CL — entitlement (3rd path)** | same | `employees.js:942` hard-codes `12` on bulk import, for 2025 *and* 2026 | PENDING | **DRIFT** |
| **CL — config key** | — | `schema.js:633` seeds `cl_annual_entitlement='12'`; **zero readers** repo-wide | PENDING | **DRIFT (dead config)** |
| **CL — grant cadence** | one-time DOJ seed, not monthly drip (`2e09606`) | `phase5Features.js:220-259`, `accrued` hardcoded 0 | PENDING | **MATCH** |
| **CL — pay effect** | informed but unpaid | `dayCalculation.js:461-463` → `clUsed++` **and** `unpaidLeaveDays++`; payable unchanged | PENDING | **MATCH** |
| **CL — pay effect (finance path)** | same | `financeAudit.js:628-634` credits `total_payable_days + 1` for CL | PENDING | **DRIFT — engines disagree** |
| **EL — accrual rate** | `floor(paid_days_ytd/20) × rate`, rate default 1 (`phase5Features.js` docblock; `d7c35b5`) | `phase5Features.js:193-197`, `el_accrual_rate` @ `schema.js:632` | PENDING | **MATCH** |
| **EL — eligibility floor** | 180 days from DOJ | `phase5Features.js:185-191`, `el_eligibility_days` @ `schema.js:1617` | PENDING | **MATCH** |
| **EL — pay effect** | restores payable | `dayCalculation.js:458-460` → `daysAbsent--`, no `unpaidLeaveDays` | PENDING | **MATCH** |
| **EL — accrual trigger** | monthly | **nothing schedules it**; one manual call site `phase5.js:38` | PENDING | **MISSING (operational)** |
| **LWP** | unpaid | `dayCalculation.js:467-470` → `lwpUsed++` + `unpaidLeaveDays++` | PENDING | **MATCH** |
| **LWP — deduction** | none; pro-rating handles it | `salaryComputation.js:608` `lopDeduction = 0` hardcoded | PENDING | **MATCH** (but see §11 G-14) |
| **OD / comp-off — approval** | HR create → Finance approve | `compensatoryOff.js:68` (HR) → `:212`/`:272` (Finance) | PENDING | **MATCH** |
| **OD — pay effect** | restores one absent day | `dayCalculation.js:424-439`, only if genuinely absent (`:433`) | PENDING | **MATCH** |
| **OD — double-count guard** | `is_applied_to_salary` prevents Stage-7 double count (`compensatoryOff.js:9-11`) | column exists `schema.js:1561-1562`; **never read or written** | PENDING | **MISSING (comment false)** |
| **Short leave / gate pass — quota** | 2 per employee per calendar month | `short-leaves.js:127-136`, hardcoded `2`, force-breachable | PENDING | **MATCH** |
| **Short leave — pay effect** | exemption only, never a deduction | `earlyExitDetection.js:73-96`; no payable effect | PENDING | **MATCH** |
| **Short leave — payslip column** | gate-pass days | `short_leave_days` = `daysHalfPresent` (`dayCalculation.js:329`, `:608`) — **not** gate-pass data | PENDING | **DRIFT (name collision)** |
| **SL — abolished** | removed from UI + write paths (`28c6029`) | validation blocks: `leaves.js:354`,`:479`, `financeAudit.js:562` | PENDING | **MATCH (partial)** |
| **SL — consumption branch** | should be gone | `dayCalculation.js:464-466` **live**; `sl_used` written `:646,:684,:720` | PENDING | **DRIFT** |
| **SL — frontend** | should be gone | `DayCalculation.jsx:585` live `SL (Sick Leave)` option; `Settings.jsx:320` `sl_per_year`; `payslipPdf.js:269` SL line | PENDING | **DRIFT** |
| **SL — DB constraint** | — | no CHECK on any `leave_type` column (`schema.js:100,113,406,1582`) | PENDING | **MISSING** |
| **Accrual eligibility** | Permanent only | `phase5Features.js:12` `LEAVE_ELIGIBLE_TYPES=['Permanent']`, contractor skip `:129`,`:336` | PENDING | **MATCH** |
| **Contractors — leave** | excluded | `dayCalculation.js:294-356` returns before the leave block; all leave counters literal 0 | PENDING | **MATCH** |
| **Contractors — gate pass** | (unstated) | `short-leaves.js` has **no** contractor gate | PENDING | **DRIFT vs. sibling modules** |
| **Deduction order** | CL → EL → LOP (`README.md:132`) | Sunday-rule fallback, `dayCalculation.js:220-275` | PENDING | **MATCH** |
| **Year-end lapse** | both CL and EL lapse to 0 | `phase5Features.js:394-450` | PENDING | **MATCH (never triggered — no UI)** |
| **Sales earned leave** | manual entry (`sales_salary_module_design.md:622`) | `salesSalaryComputation.js:264` → `const earnedLeaveDays = 0;` permanently | PENDING | **MISSING (stub)** |

---

## 3. Data model

Full detail: **`parts/01-data-model.md`**. Summary:

**Six core leave tables**, all created unconditionally in `schema.js`:

| Table | schema.js | UNIQUE | Indexes |
|---|---|---|---|
| `leave_balances` | 96-106 | `(employee_id, year, leave_type)` :105 | none |
| `leave_transactions` | 108-122 | **none** | `idx_leave_transactions_employee` :124 |
| `leave_applications` | 402-417 (+`hr_remark` :1613) | **none** | **none** |
| `leave_accrual_ledger` | 1576-1595 | `(employee_code, year, month, leave_type)` :1593 | `idx_accrual_ledger_employee` :1596 |
| `compensatory_off_requests` | 1543-1566 | `(employee_code, start_date, month, year, company)` :1564 | :1567, :1568 |
| `short_leaves` | 1623-1649 | `(employee_code, date, leave_type)` :1647 | :1650, :1651 |

Plus `holidays` (64-72, **no UNIQUE on date, no index at all**), `holiday_audit_log` (1002-1018), and the early-exit trio (1656-1736).

**Leave columns on shared tables** — `day_calculations`: `cl_used`/`el_used`/`sl_used`/`lop_days` are base columns (243-246); `od_days`/`short_leave_days`/`uninformed_absent` are migrations (1601-1603). `salary_computations`: **all** leave columns are migrations — `cl_days`/`el_days`/`lwp_days`/`od_days`/`short_leave_days`/`uninformed_absent_days` (1605-1610).

**policy_config leave keys** (3):

| key | seeded | line | read by |
|---|---|---|---|
| `el_accrual_rate` | `'1'` | 632 | `phase5Features.js:76` ✅ |
| `el_eligibility_days` | `'180'` | 1617 | `phase5Features.js:77` ✅ |
| `cl_annual_entitlement` | `'12'` | 633 | **NOTHING** ❌ |

**Notable:** no `leave_types` master table; every `leave_type` is unconstrained free TEXT. No schema-level backfill for leave exists. `schemaReference.js` (the NL→SQL prompt) omits 5 of 6 leave tables and every leave-day column.

---

## 4. Backend

Full detail: **`parts/02-backend.md`**. **34 leave routes** across 6 routers, all mounted with `requireAuth` only; finer gates are router-local.

| Router | Mount | Routes | Role gate |
|---|---|---|---|
| `leaves.js` | `/api/leaves` (server.js:206) | 15 | **none anywhere in the file** |
| `phase5.js` | **`/api/features`** (server.js:212) | 3 | 2 of 3 `requireHrOrAdmin`; `accrue-leaves` **unguarded** |
| `compensatoryOff.js` | `/api/comp-off` (:219) | 6 | HR / Finance / HrFinance, per route |
| `short-leaves.js` | `/api/short-leaves` (:221) | 5 | HR write / HrFinance read |
| `payroll.js` | `/api/payroll` (:198) | leave-consuming | — |
| others | financeAudit, reports, employees, employeePortal | leave-touching | mixed |

**Direct answers to the audit's questions:**

- **(a) Is accrual automatic? NO.** One call site: `routes/phase5.js:38`. Verified negative at Stage 7 finalize (`payroll.js:1031-1077`), `monthEndScheduler` (single cron `30 3 * * *` → `checkPipelineStatus`), `jobQueue` (types `salary_compute`/`day_calculate` only), and boot (`server.js:339-349`). **Note:** the endpoint is at `/api/features/accrue-leaves`, not `/api/phase5/…` as the prompt assumed.
- **(b) How Stage 6 consumes leave.** `calculateDays`' `leaveBalances` argument is **dead** — documented "unused" at `dayCalculation.js:126` and referenced nowhere in the body, yet `payroll.js:95-99` runs a per-employee SELECT to supply it. Real input is `options.approvedLeaves` / `options.approvedCompOff`, fetched by `payroll.js:196-211` from `leave_applications` (`status='Approved'`, overlapping month) and `compensatory_off_requests` (`finance_status='approved'`). Mechanics at `:424-472`: OD first (only on a genuinely absent day), then leaves — **EL restores payable; CL/SL/LWP only reclassify**. Stage 6 applies **no balance check and no cap**.
- **(c) Contractors excluded?** Yes, structurally — `dayCalculation.js:294-356` returns *before* the leave block, so all leave counters are literal 0. Also gated in `phase5Features.js:129`/`:336` and `compensatoryOff.js:98-103`. **Exception: `short-leaves.js` has no contractor gate.**
- **(d) Downstream.** Payslip emits a display-only `leaveSummary` (`salaryComputation.js:1089-1097`); salary math is display-only by explicit comment (`:792-794`); PF ECR derives NCP from payable days without reading leave (`exportFormats.js:40-50`); `reports.js:445` is the only consumer of `leave_accrual_ledger`; the pattern engine reads balances and **Pending** applications (`flightRiskPatterns.js:113-124`); **Daily MIS reads nothing** (0 hits — the frontend calls `/leaves/on-leave-today` directly); `employeePortal.js:47-74` is an unvalidated write path; **Sales is entirely disconnected** (`earnedLeaveDays = 0` permanently).
- **(e) Comp-off lifecycle.** HR create → Finance approve → Stage 6 converts to a payable day. It never becomes a salary line; the money effect is indirect. `is_applied_to_salary` is advertised as the double-count guard and is **never read or written**.
- **(f) Short leave.** Quota 2/month, force-breachable, **zero pay impact** — it can only *avoid* an early-exit deduction.
- **(g) SL residue.** 15+ live backend sites, headlined by the working consumption branch at `dayCalculation.js:464-466`.

**Scripts.** `reseed-leave-balances-2026.js` — one-shot, guard `reseed_2026_v1`, dry-run by default; its `DELETE FROM leave_balances WHERE year=?` is **unscoped by employee type**. `phase5-simulation.js` — temp-DB harness that does *not* exercise leave. `investigate-manoj.js` — nominally read-only but calls `getDb()`, which runs `initSchema()` against production.

---

## 5. Frontend + dist status

Full detail: **`parts/03-frontend.md`**. **13 surfaces**, all shipping.

**DIST: CLEAN.** 35/35 unique probe strings resolve in `frontend/dist/` (build 2026-09-15 14:18, 76 assets), with a validated negative control. No stale-build finding. *(Mtime comparison was impossible — every `src` file carries the identical checkout mtime — so this rests entirely on content-grep.)*

| Surface | Writes leave? | Ships |
|---|---|---|
| `LeaveManagement.jsx` — 6 tabs (Applications / Balances / Register / Adjustments / Comp Off / Gate Passes) | yes | ✅ |
| `GatePasses.jsx` | yes | ✅ |
| `DayCalculation.jsx` — leave cols + Apply-Leave modal | **yes (incl. SL)** | ✅ |
| `SalaryComputation.jsx` — CL/EL/LWP/OD/SL columns | no | ✅ |
| `EmployeeProfile.jsx` — Leave Register tab | no | ✅ |
| `DailyMIS.jsx` — On Leave Today | no | ✅ |
| `Reports.jsx` — Leave Reports + xlsx | no | ✅ |
| `payslipPdf.js` — Leave Summary block | no | ✅ |
| `Settings.jsx` — holidays + `cl/el/sl_per_year` | policy only | ✅ |
| `FinanceAudit.jsx` — Comp Off / OD tab | yes | ✅ |
| `CalendarView.jsx` | **renders no leave states at all** | ✅ |
| `Employees.jsx` | **no leave UI** (2 dead imports) | ✅ |
| Sales pages | **no leave UI** (`onDragLeave` only) | n/a |

**Role gates.** `permissions.js` is **decorative on both sides** — `requirePermission` is applied to no route, and `getUserPermissions` has zero frontend consumers. Every real gate is a hardcoded role literal. Consequences: `/leave-management` is ungated end-to-end; HR gets a guaranteed 403 on opening Finance Audit (badge query fires on mount); viewer/supervisor see Comp Off and Gate Pass tabs that cannot load.

**No UI exists for:** EL accrual trigger, year-end lapse, CL opening init, accrual-ledger viewing, bulk adjust, leave cancel, holiday edit. All ship as dead bytes in `index-C6lX4phT.js`.

---

## 6. Pipeline flow (Stage 6 → 7 → finalize → payslip/reports)

```
leave_applications (status='Approved')  ─┐
compensatory_off_requests (approved)    ─┤
                                         ▼
  payroll.js:196-211  fetch, pass as options.approvedLeaves / approvedCompOff
                      (leave_balances also fetched at :95-99 → DEAD ARG)
                                         ▼
STAGE 6  dayCalculation.js:424-472
   contractors: return at :294-356 — all leave counters literal 0
   OD  :424-439  daysAbsent-- , daysPresent++ , odDays++   (only if truly absent)
   EL  :458-460  daysAbsent--                              → RESTORES PAYABLE
   CL  :461-463  clUsed++ , unpaidLeaveDays++              → payable unchanged
   SL  :464-466  slUsed++ , unpaidLeaveDays++              → STILL LIVE
   LWP :467-470  lwpUsed++ , unpaidLeaveDays++
   finalPayable = max(0, base − totalAbsences + WOP + grants)   :514-519
                                         ▼
   day_calculations: cl_used, el_used, sl_used, lop_days, od_days,
                     short_leave_days(=daysHalfPresent), uninformed_absent   :603-609
                                         ▼
STAGE 7  salaryComputation.js
   leave is DISPLAY-ONLY — explicit comment :792-794
   lopDeduction = 0 hardcoded :608, still summed into totalDeductions :697
   copies → cl_days, el_days, lwp_days, od_days, short_leave_days,
            uninformed_absent_days   :795-800
                                         ▼
FINALIZE  payroll.js:1031-1077 — signoff + ED + miss-punch checks only.
          NO leave write. NO accrual. ← the gap
                                         ▼
   payslip  salaryComputation.js:1089-1097 → leaveSummary {cl,el,lwp,od,shortLeave,uninformedAbsent}
   PF ECR   exportFormats.js:40-50 → NCP from payable days, no leave read
   reports  reports.js:445 → the ONLY consumer of leave_accrual_ledger

SEPARATE, UNSCHEDULED, OFF TO THE SIDE:
   phase5Features.runLeaveAccrual  ← one call site, routes/phase5.js:38, NO ROLE GUARD, NO UI
   phase5Features.initCLOpening    ← HR-gated, NO UI
   phase5Features.yearEndLapse     ← HR-gated, NO UI

THREE PARALLEL WRITE ENGINES THAT DISAGREE:
   leaves.js            balance-checked, hr_remark required, finalized-month locked
   financeAudit.js:552  UNGUARDED; credits payable+1 for CL (Stage 6 does not); allows balance −1
   employeePortal.js:57 NO validation of any kind; accepts any leave_type incl. SL
```

---

## 7. Timeline

Full detail: **`parts/04-history.md`**. ⚠️ The repo is a **shallow clone** (5 grafts, depth 119) — naive `git log -- <file>` birth dates and all `--is-ancestor` checks are false. Everything below is content-verified against `origin/main`.

| Date | SHA | What | Status |
|---|---|---|---|
| 2026-03-16 | `5491559` | Leave Mgmt v0 — `leaves.js` + `LeaveManagement.jsx` | SHIPPED |
| 2026-03-18 | `bf0886b` | Accrual engine — `phase5Features.js` + `phase5.js` | SHIPPED |
| 2026-03-21 | `67998e8` | Leave Register tab | SHIPPED |
| 2026-04-03 | `9806be8` | Warn on negative balance at approval | SHIPPED |
| 2026-04-10 | `3c5e32f`…`ee12805` | Gate pass / short leave / early exit (EED-1…11) | SHIPPED |
| 2026-04-11 | `12f19b3`, `2dc36e6`, `e09c3ea` | Gate-pass polish; nav promotion; **PR #7 merged** | SHIPPED |
| 2026-04-12 | `5d873c1` | Pattern-engine leave detectors | SHIPPED |
| 2026-04-15 | `b7d215b`…`731b5f5` | **Leave Phases 1-4** — schema, day-calc, Stage 7, frontend | SHIPPED (Phase 2 **defective**) |
| **2026-04-16** | `2e09606` | **POLICY: permanent-only accrual; CL = 7 DOJ-pro-rated** | SHIPPED |
| **2026-04-16** | `5f36f48` | `initCLOpening` idempotent — guard `cl_seed_<year>_v1` | SHIPPED |
| **2026-04-16** | `28c6029` | **POLICY: SL abolished** (UI + write paths; history preserved) | SHIPPED |
| 2026-04-16 | `d929690`, `d7c35b5`, `f2099c0` | Export helper; 2026 reseed script; leave column colours (incl. `SL=slate`) | SHIPPED / reseed **never confirmed run** |
| 2026-04-16 | `796f34e` | **The 21-line CLAUDE.md policy handoff** | ❌ **NEVER MERGED** — stranded on `origin/claude/session-start-MEzoy` |
| *Apr 16 → May 11* | — | *26-day silent Stage-6 outage* | — |
| 2026-05-11 | `8da6904`, `6b89b53` | **Incident:** `duty_days` column doesn't exist → Stage 6 failing for **all 447 employees**, masked by try/catch | SHIPPED |
| 2026-05-23 | `d15cb61`, `c9a4c4e` | Repo-wide audit-attribution sweep — **last touch of any leave file** | SHIPPED |
| 2026-06-03 → 2026-09-16 | — | **~3.5 months, zero leave commits** | — |

**Shape (INFERENCE):** three bursts then silence. The Apr 15 rebuild was corrected the very next day by a 5-commit policy rewrite — and then the subsystem froze. `compensatoryOff.js` and the reseed script have never been modified since birth; `GatePasses.jsx` was touched once, the day after it was created.

**Unmerged branches:** 85 of 120 remotes are unmerged; exactly **one** touches a leave path, and only a `frontend/dist` artifact. **There is no in-flight leave work anywhere** — every gap below is a real gap, not work in progress.

---

## 8. Live state

**PENDING — not attempted.** Full detail and 11 paste-ready queries: **`parts/05-live.md`**.

Four independent blockers, all verified: `SQL_CONSOLE_URL` unset · `${#SQL_CONSOLE_API_KEY}` = 0 · `find . -name '*.db'` → 0 files · `sqlite3` not installed · `backups/` holds only a 0-byte `.gitkeep`. Per CLAUDE.md §9.2 those credentials are machine-local to Abhinav's Mac (`launchctl setenv`) and do not reach a web container. The prompt instructs skipping in that case, so **no query was run and no HTTP call was made**.

*(A publicly accessible read-only MCP bridge is documented at CLAUDE.md §9.3/§10 and could answer all eleven queries without credentials. It was deliberately not used: the prompt gates this step on the env vars, and its "No POST/PUT/DELETE calls" rule forbids POST, which is the MCP transport.)*

**Consequently unanswered — all of these are data questions, not code questions:**
- Has EL accrual **ever** run in production, and for which months? *(Query Q3 — the single most important unknown in this audit.)*
- Do `leave_balances` rows exist for 2026, for how many employees, and are any negative?
- Are the Stage-6/Stage-7 leave columns populated or all zero?
- Was `reseed-leave-balances-2026.js` ever executed? *(guard row `reseed_2026_v1`)*
- Do ledger closing balances reconcile against `leave_balances`?

---

## 9. Decisions found

All sourced from commit messages and code docblocks — **none from CLAUDE.md**, which contains no statement of the CL rule, EL rate, EL eligibility or the SL decision (`grep "2026-04-16" CLAUDE.md` → 0 hits).

| # | Decision | Source |
|---|---|---|
| D-1 | **SL abolished**, new model is permanent-only CL+EL | `28c6029` commit msg |
| D-2 | **CL = 7**, DOJ pro-rated 7/6/5/4/3/2; one-time seed, not monthly drip | `2e09606`; `phase5Features.js:27-39` |
| D-3 | EL = `floor(paid_days_ytd/20) × rate(1)` past a 180-day floor | `phase5Features.js` docblock; `d7c35b5` |
| D-4 | Accrual restricted to `LEAVE_ELIGIBLE_TYPES = ['Permanent']` | `2e09606`; `phase5Features.js:12` |
| D-5 | CL seeding idempotent via `policy_config` guard `cl_seed_<year>_v1` | `5f36f48` |
| D-6 | Year-end lapse: **both** CL and EL lapse to 0 | `phase5Features.js:390-450` |
| D-7 | Deduction order CL → EL → LOP | `README.md:132`; `CLAUDE.md:1431` |
| D-8 | Grandfather clamp: `new_balance = max(0, entitlement − used)` | `d7c35b5` |
| D-9 | Historical SL data deliberately **retained** (reports still render it) | `28c6029`; `796f34e` |
| D-10 | Gate-pass quota 2/month, force-breachable | `CLAUDE.md:1631`; `short-leaves.js:127` |
| D-11 | Sales EL is **manual**, disconnected from `leave_balances` | `sales_salary_module_design.md:622,795` |

---

## 10. Planned but never built

| # | Promised | Source | Reality |
|---|---|---|---|
| P-1 | 2026 reseed executed in production | `d7c35b5` | No commit/log/doc records an `--execute-after-review` run. **UNCONFIRMED** |
| P-2 | Railway smoke tests for SL removal (2 tests) | `796f34e` — blocked by HTTP 403 from sandbox, handed to user | Never recorded as run |
| P-3 | Post-seed verification checklist (5 items) | `796f34e` "Next session should" | The next session was about daily wage. **Never done** |
| P-4 | Delete the vestigial `employees.js:302/942` CL=12 writes | `796f34e` "worth a future cleanup" | **Still present** |
| P-5 | `cl_annual_entitlement` ever read | `schema.js:633` | **Zero readers** |
| P-6 | `LEAVE_ELIGIBLE_TYPES` case/whitespace guard | `796f34e` | Never added — `'permanent'` silently drops out of accrual |
| P-7 | Cosmetic purge of historical SL rows | `796f34e` — deferred to "a separate explicit DELETE prompt" | Deferred **by design** |
| P-8 | `hasApprovedLeave()` silent-catch fix | `docs/BACKEND_AUDIT_2026.md:70` | **KNOWN BUG, OPEN** |
| P-9 | `is_applied_to_salary` as Stage-7 double-count guard | `compensatoryOff.js:9-11` | Column exists, **never read or written** |
| P-10 | Sales earned-leave entry ("future Phase 3.5+") | `salesSalaryComputation.js:264` | Permanently `0`; ships as a populated-looking Excel column |
| P-11 | Leave unit tests | — | `src/__tests__/` has **no** leave test; `phase5Features.js:656-668` holds commented-out assertions |

---

## 11. Gaps & landmines

Ordered by consequence. Each states what actually goes wrong.

| # | Gap | Evidence | **Consequence in plain words** |
|---|---|---|---|
| **G-1** | `POST /api/features/accrue-leaves` has **no role guard**, sitting directly beneath a comment saying balance-mutating endpoints need HR-or-admin | `phase5.js:33` vs `:23`, `:51`, `:76` — *orchestrator-verified* | **Any logged-in user — including an employee-portal login — can rewrite every employee's leave balance for any month.** |
| **G-2** | Accrual has one call site and nothing schedules it; no UI calls it | `phase5.js:38`; `accrueLeaves` 0 callers | **If nobody remembers to curl it, EL simply never accrues. The ledger has no rows and nobody is told.** |
| **G-3** | `/leave-management` ungated in sidebar, route and router | `Sidebar.jsx:50`, `App.jsx:188`, `server.js:206`, `leaves.js` (no role check) — *orchestrator-verified* | **A viewer or supervisor can approve leave and credit/debit balances.** |
| **G-4** | Three write engines disagree: `financeAudit.js:552` is unguarded and credits `payable+1` for CL where Stage 6 does not | `financeAudit.js:628-634` vs `dayCalculation.js:461-463` | **The same CL day is worth one extra paid day or not, depending on which screen was used — and the finance patch is wiped by the next Stage 6 run.** |
| **G-5** | `employeePortal.js:57` bypasses every rule — no balance check, no remark, no finalized-month lock, no type whitelist | `employeePortal.js:57-65` | **An employee can self-file unlimited leave of any type, including SL, into a locked month.** |
| **G-6** | CL = 12 hard-coded on two employee-creation paths vs. policy 7 | `employees.js:302`, `:942` vs `phase5Features.js:27-39` | **Every newly created employee starts with 12 CL and is never corrected — `ON CONFLICT DO NOTHING` means the policy seed won't overwrite it.** |
| **G-7** | `cl_annual_entitlement='12'` is seeded and read by nothing | `schema.js:633`; 1 grep hit | **An admin who edits it in Settings expects the entitlement to change. Nothing happens.** |
| **G-8** | SL abolished at validation layer only; consumption branch live; no DB CHECK | `dayCalculation.js:464-466`; `DayCalculation.jsx:585`; `schema.js:100,113,406,1582` | **SL is still selectable in Day Calc and still processed end-to-end. An abolished leave type keeps affecting pay.** |
| **G-9** | `missPunch.js:125-126` writes `status_final = leaveType` with no validation; Stage 6 has no branch for those statuses | `dayCalculation.js:263-285` ghost catch-all `:284` | **Converting a miss punch to leave silently counts the day ABSENT — it costs the employee a day.** |
| **G-10** | Stage 6 consumes approved leave with no balance check and no cap | `dayCalculation.js:442-472` | **A 30-day EL application restores 30 absences regardless of balance, if it entered via a bypass (G-5, G-4).** |
| **G-11** | EL accrual chains off the previous month's ledger row; skipped months restart the YTD chain at 0 | `phase5Features.js:169-181, :199-200` | **Running June without May yields a silently wrong, lower EL entitlement that looks authoritative.** |
| **G-12** | Two definitions of "leave used in month M" — accrual attributes whole applications to `start_date`'s month; Stage 6 expands day-by-day | `phase5Features.js:147,156` vs `dayCalculation.js:444-451` | **Cross-month and weekend-spanning leave makes the ledger and the day-calc disagree, and the annual summary mixes both.** |
| **G-13** | `/adjust` and `/bulk-adjust` have no floor and hardcode the current year | `leaves.js:381-385`, `:366`, `:489` | **A debit can push a balance negative — the exact state the submit/approve checks exist to prevent — and prior-year adjustment is impossible.** |
| **G-14** | `payroll.js:1083-1105` writes a *late-coming* penalty into `day_calculations.lop_days`, which the payslip labels **LWP** | `salaryComputation.js:797`, `:1093` | **A punctuality penalty appears on the payslip as leave-without-pay. An employee querying it will be told the wrong reason.** |
| **G-15** | `short_leave_days` on the payslip is `daysHalfPresent`, not gate-pass data | `dayCalculation.js:329`, `:608` vs `short_leaves` | **The payslip "Short Leave" figure and the gate-pass quota screen show different numbers for the same words.** |
| **G-16** | `is_applied_to_salary` advertised as the double-count guard; never read or written | `schema.js:1561-1562`; `compensatoryOff.js:9-11` | **A safety net that exists only in a comment. Harmless today (UPSERT is idempotent) but relied upon in writing.** |
| **G-17** | `employeePortal.js:71` orders by `created_at`, a column `leave_applications` does not have | `:71` vs `schema.js:402-417` — *orchestrator-verified* | **Employee leave history throws `SQLITE_ERROR: no such column` — the portal page is likely broken.** |
| **G-18** | `CalendarView.jsx` renders no leave states at all | `:9-22`, `:162-167` | **The one screen a manager would open to see who's on leave shows leave days as unstyled blanks.** |
| **G-19** | `permissions.js` enforced nowhere on either side | `requirePermission` 0 routes; `getUserPermissions` 0 consumers | **A permission table that documents intent the code does not implement — worse than having none, because it reads as protection.** |
| **G-20** | HR is shown the Finance Audit comp-off tab, whose badge query fires on mount | `FinanceAudit.jsx:1310`, `:1326` vs `compensatoryOff.js:188` | **HR gets a 403 just by opening Finance Audit.** |
| **G-21** | `reseed-leave-balances-2026.js` DELETEs all 2026 balances unscoped by employee type, then reinserts only permanents | `:259`, `:290` | **Non-permanent 2026 balances are destroyed, not migrated. Irreversible; the one-shot guard is hand-deletable.** |
| **G-22** | `investigate-manoj.js` calls `getDb()` → `initSchema()` against production | `:13-15`; `db.js:26` | **A script described as read-only applies migrations to the live DB.** |
| **G-23** | 2026 holiday reseed is a destructive DELETE gated on a sentinel row, not a migration flag | `schema.js:1021-1032` | **Delete one LOHRI row and the next boot silently wipes and rewrites every System-added 2026 holiday.** |
| **G-24** | `schemaReference.js` omits 5 of 6 leave tables and every leave-day column | `parts/01` §F | **Any English→SQL question about leave silently queries the wrong or a nonexistent column.** |
| **G-25** | No leave test coverage at all | `src/__tests__/` | **Every rule above is unprotected against the next refactor.** |
| **G-26** | Silent catches around leave turn schema drift into invisible payroll failure | `8da6904` (447 employees, 26 days); `BACKEND_AUDIT_2026.md:70` | **This already happened once and went unnoticed for nearly a month. The pattern is still in place.** |
| **G-27** | The policy is undocumented — the 2026-04-16 CLAUDE.md entry was never merged | `796f34e` on `origin/claude/session-start-MEzoy` | **The next person to touch leave will re-derive or contradict a policy that was decided correctly five months ago.** |
| **G-28** | `CLAUDE.md:1420` still documents "A → CL/EL/**SL**" | vs `leaves.js:354` | **The canonical context file teaches a rule the code rejects.** |
| **G-29** | `leave_applications` and `leave_transactions` have no UNIQUE; `leave_applications` and `holidays` have no index at all | `schema.js:108-122`, `402-417`, `64-72` | **Nothing prevents duplicate or overlapping applications, and listing queries full-scan as the table grows.** |
| **G-30** | No contractor gate on gate passes, unlike every sibling module | `short-leaves.js:44` | **Contractors can be issued gate passes, inconsistent with the stated contractor policy.** |

---

## 12. Needs chat confirmation

Past claude.ai chats are unreachable from here. `2e09606`, `d7c35b5` and `f2099c0` all cite an "Apr 16 2026 session" whose reasoning lived in chat, not git.

1. Was **CL = 7** a new policy, or a correction of a mis-implemented 12? The surviving 12s suggest 12 was the original intent.
2. Who decided **SL was abolished**, and what was the effective date for employees? Git has no policy doc, date or approver.
3. Was `reseed-leave-balances-2026.js` ever actually run with `--execute-after-review`? *(A live read of `policy_config` guard `reseed_2026_v1` settles this.)*
4. Were the two Railway smoke tests for SL removal (P-2) ever performed?
5. Was omitting the 2026-04-16 entry from CLAUDE.md deliberate or accidental? *(Looks accidental — the branch was simply never merged.)*
6. Is `cl_annual_entitlement='12'` intended for future use, or dead config to delete?
7. Should historical SL rows eventually be purged? `796f34e` deferred this to a prompt that never came.
8. Was the **26-day Stage-6 outage** (Apr 15 → May 11) noticed by HR, or only found during the May 11 investigation? April payroll impact is unknown from git.
9. **What is "LEAFS"?** Zero hits across all refs — possibly another system, a prior chat's term, or a typo.
10. Is the **Sales earned-leave** column meant to be wired up, or should it be removed from the HR Excel export while it is permanently 0?

---

## 13. Open questions for Abhinav

Each answerable in one line.

1. **CL entitlement is 7 or 12?** (Code says both — `phase5Features` 7, `employees.js` 12.)
2. **Should `accrue-leaves` be HR/admin-only?** (Today any logged-in user can run it.)
3. **Who should see Leave Management?** (Today: everyone, including viewer.)
4. **Is SL truly abolished — should the Day Calc `SL (Sick Leave)` option be removed?**
5. **Who runs EL accrual each month, and on what date?** (Nothing schedules it.)
6. **Should accrual be automated** (cron / Stage-7 finalize), or stay a deliberate manual step?
7. **Was the 2026 reseed executed?** (Yes/no settles several downstream questions.)
8. **Should the employee portal be able to file leave at all?** (Today it bypasses every rule.)
9. **Should `financeAudit` apply-leave credit a payable day for CL?** (It does; Stage 6 does not.)
10. **Is the late-coming penalty landing in `lop_days` intended?** (It shows on payslips as LWP.)
11. **Should Sales get real earned leave, or should the column be dropped from the export?**
12. **May I merge the stranded `796f34e` policy note into CLAUDE.md?**

---

## 14. Next steps

**OPINION throughout.** One fix = one commit. Ordered by consequence-per-unit-risk. Nothing here has been done — this audit wrote only inside `docs/leave-inventory/`.

| # | Fix | Target file | DO NOT MODIFY |
|---|---|---|---|
| **N-1** | Add `requireHrOrAdmin` to `POST /accrue-leaves` (its two siblings already have it; the helper is defined 10 lines above) | `backend/src/routes/phase5.js:33` | everything else; do not touch `phase5Features.js` |
| **N-2** | Recover the stranded policy note into CLAUDE.md — text already written and accurate | `CLAUDE.md` (from `796f34e`) | all code |
| **N-3** | Fix the portal crash: `ORDER BY created_at` → `applied_at` | `backend/src/routes/employeePortal.js:71` | `schema.js`, `leaves.js` |
| **N-4** | Resolve CL 7-vs-12: delete the two hard-coded `12` seeds, route all CL seeding through `initCLOpening` | `backend/src/routes/employees.js:302, :942` | `phase5Features.js`, `schema.js` |
| **N-5** | Either delete `cl_annual_entitlement` or make `computeClEntitlement` read it (default 7) — decide with N-4 | `backend/src/database/schema.js:633` **or** `phase5Features.js:27` | the other one |
| **N-6** | Gate `/leave-management`: sidebar flag + router-level role check | `frontend/src/components/layout/Sidebar.jsx:50`, `backend/src/routes/leaves.js` (top) | `permissions.js` until N-12 |
| **N-7** | Add `requireFinanceOrAdmin` to `POST /corrections/apply-leave` (middleware already imported at `:17`) | `backend/src/routes/financeAudit.js:552` | `dayCalculation.js` |
| **N-8** | Make the finance apply-leave path agree with Stage 6 on CL (no `payable+1`) | `backend/src/routes/financeAudit.js:628-634` | `dayCalculation.js` — Stage 6 is canonical |
| **N-9** | Validate `leave_type` in the employee portal, or disable self-filing | `backend/src/routes/employeePortal.js:57` | `leaves.js` |
| **N-10** | Finish the SL removal: drop the consumption branch and the Day Calc option | `backend/src/services/dayCalculation.js:464-466`, `frontend/src/pages/DayCalculation.jsx:585` | `sl_used` column and all historical/report rendering — retention is deliberate (D-9) |
| **N-11** | Add a CHECK constraint on `leave_type`, or a shared validator module | `backend/src/database/schema.js` | requires a table rebuild — plan carefully |
| **N-12** | Either enforce `permissions.js` or delete it | `backend/src/middleware/roles.js` + mounts | all leave logic |
| **N-13** | Update `schemaReference.js` with the 5 missing leave tables + leave-day columns | `backend/src/config/schemaReference.js` | `schema.js` |
| **N-14** | Add leave unit tests (start with `computeClEntitlement` — cases already written, commented out) | new `backend/src/__tests__/leave.test.js` | `phase5Features.js` |
| **N-15** | Build a minimal accrual UI, or schedule it — pick one; today it is neither | `frontend/src/pages/LeaveManagement.jsx` **or** `monthEndScheduler.js` | needs the §13 Q5/Q6 answer first |

**Do not start any of these before answering §13 Q1 (CL 7 or 12) and Q4 (SL truly gone).** N-4, N-5 and N-10 all branch on those two answers.

Repo-wide **DO NOT MODIFY** for any follow-up, per the audit's own constraints and CLAUDE.md §8: `salaryComputation.js`, `dayCalculation.js`, `schema.js`, `payroll.js`, `phase5Features.js`, `leaves.js`, `compensatoryOff.js` and anything under `frontend/` may only be touched by a prompt that names them explicitly and states what downstream consumers were checked first.

---

## 15. Sources

**Parts** (full detail, this directory): `parts/01-data-model.md` · `parts/02-backend.md` · `parts/03-frontend.md` · `parts/04-history.md` · `parts/05-live.md` (PENDING)
**Also here:** `PROMPT.md` (governing prompt, verbatim) · `PROGRESS.md` (step log + findings) · `leave_items.csv`

**Primary code read:** `backend/src/database/schema.js`, `db.js`, `config/permissions.js`, `config/schemaReference.js`, `server.js`; routes `leaves.js`, `phase5.js`, `compensatoryOff.js`, `short-leaves.js`, `payroll.js`, `financeAudit.js`, `employees.js`, `employeePortal.js`, `reports.js`, `attendance.js`, `import.js`, `early-exits.js`, `early-exit-deductions.js`, `sales.js`, `settings.js`; services `phase5Features.js`, `dayCalculation.js`, `salaryComputation.js`, `salesSalaryComputation.js`, `exportFormats.js`, `salesExportFormats.js`, `financeRedFlags.js`, `behavioralPatterns.js`, `earlyExitDetection.js`, `missPunch.js`, `jobQueue.js`, `monthEndScheduler.js`, `protectedWrite.js`, `patternEngine/*`; scripts `reseed-leave-balances-2026.js`, `phase5-simulation.js`, `investigate-manoj.js`, `seed-test-data.js`; frontend `LeaveManagement.jsx`, `GatePasses.jsx`, `DayCalculation.jsx`, `SalaryComputation.jsx`, `EmployeeProfile.jsx`, `DailyMIS.jsx`, `Reports.jsx`, `Settings.jsx`, `FinanceAudit.jsx`, `Employees.jsx`, `CalendarView.jsx`, `App.jsx`, `Sidebar.jsx`, `api.js`, `payslipPdf.js`, `abbreviations.js`, `pages/Sales/*`; plus `frontend/dist/assets/*` (content-grep only).

**Docs read:** `CLAUDE.md`, `README.md`, `docs/BACKEND_AUDIT_2026.md`, `docs/cowork-fix-verification-prompt.md`, `docs/bug-reporter-*.md`, `sales_salary_module_design.md`, `sales_consolidated_design.md`.

**Git:** `git log --all` keyword sweep (53 hits), per-file histories, `git branch -r --no-merged origin/main` (85 of 120), `git show origin/main:<file>` content verification. ⚠️ shallow clone — see `parts/04` caveat.

**Not reachable:** production database (§8); past claude.ai chats (§12).

---

### VERIFY — orchestrator spot-checks

The three parts transcribed from agents that lacked a `Write` tool were not taken on trust. Eight cited `file:line` references were independently re-opened by the orchestrator. **8/8 confirmed verbatim:**

| # | Reference | Claim | Result |
|---|---|---|---|
| 1 | `schema.js:633` | seeds `cl_annual_entitlement='12'` | ✅ exact |
| 2 | `phase5Features.js:27-39` | `computeClEntitlement` returns 7, `7 - floor((effMonth-1)/2)` | ✅ exact |
| 3 | `server.js:212` | phase5 router mounts at `/api/features`, not `/api/phase5` | ✅ exact |
| 4 | `dayCalculation.js:464-466` | live `else if (leaveType === 'SL')` branch | ✅ exact |
| 5 | `leaves.js:354` | `"Must be CL or EL. SL is no longer supported."` | ✅ exact |
| 6 | `phase5.js:23/33/51/76` | `accrue-leaves` unguarded; siblings have `requireHrOrAdmin` | ✅ exact — and the guard helper's own comment sits directly above |
| 7 | `employeePortal.js:71` | `ORDER BY created_at` on a table with no such column | ✅ exact (column absent in `schema.js:402-417`) |
| 8 | `Sidebar.jsx:50` | Leave Management nav entry carries no gate flag | ✅ exact |

**Checklist:** all 15 sections filled or explicitly PENDING ✅ · 5+ refs re-verified ✅ (8 done) · `leave_items.csv` ≥ 40 rows ✅ · `git diff --stat origin/main` touches only `docs/leave-inventory/**` (+ CLAUDE.md at handoff) ✅

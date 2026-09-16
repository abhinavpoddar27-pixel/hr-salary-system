# PROGRESS — Leave Inventory read-only audit

Branch: `docs/leave-inventory` (from `origin/main` @ 3806a6d)
Started: 2026-09-16

---

## DONE

### Step 0 — plan gate (complete, awaiting "go")
- `git status --porcelain --untracked-files=no | wc -l` → **0** (clean tree). FACT.
- `git fetch --all --prune --quiet` → ok. Remote branch count: **120**. FACT.
- `git switch -c docs/leave-inventory origin/main` → created, tracking origin/main, HEAD = `3806a6d`. FACT.
- `docs/leave-inventory/PROMPT.md` written (verbatim prompt).
- `docs/leave-inventory/PROGRESS.md` (this file) created.
- `docs/leave-inventory/parts/` created (empty).
- Env check: `SQL_CONSOLE_URL` **NOT SET**; `${#SQL_CONSOLE_API_KEY}` = **0**. FACT.
  → Live-data step (parts/05-live.md) will be marked **PENDING**, not attempted.
- Pre-scan: candidate file list built (see FINDINGS below).

---

## NEXT

**Awaiting user "go".** On "go":
1. Launch 4 parallel Explore subagents → `parts/01-data-model.md`, `parts/02-backend.md`,
   `parts/03-frontend.md`, `parts/04-history.md`. Commit after each lands.
2. `parts/05-live.md` → write PENDING stub (SQL env vars unset).
3. Assemble `LEAVE_INVENTORY.md` (15 sections) + `leave_items.csv` (UTF-8 BOM, >=40 rows).
4. VERIFY: sections filled/PENDING, re-open 5 random file:line refs, CSV row count,
   `git diff --stat origin/main` touches only `docs/leave-inventory/**` (+ CLAUDE.md).
5. SHIP: `/session-handoff`, commit, `git push -u origin docs/leave-inventory`,
   confirm local HEAD == remote. **No PR.**

---

## FINDINGS (running log)

### F-000 (Step 0) — branch-name conflict with session policy
The session's standing instruction names `claude/fervent-clarke-xlaf2w` as the designated
development branch. This prompt explicitly instructs `docs/leave-inventory` and an explicit
`git push -u origin docs/leave-inventory`. Treating the prompt as the explicit permission.
Tag: FACT (instruction text) / OPINION (resolution).

### F-001 (Step 0) — SQL Console unreachable from this session
`SQL_CONSOLE_URL` unset and `SQL_CONSOLE_API_KEY` length 0 in this remote container.
CLAUDE.md Section 9.2 states these are set via macOS `launchctl setenv` on Abhinav's local
machine — they do not propagate to Claude Code on the web. Section 8 (live state) will be
PENDING; every data-side claim in the rule matrix will be marked PENDING rather than guessed.
Tag: FACT.

### F-002 (Step 0) — only ONE unmerged remote branch touches a leave file, and only a dist artifact
`git branch -r --no-merged origin/main` (120 remotes) filtered to leave-ish paths yields:
- `origin/claude/wire-salary-structure-creation-oGCDA` → `frontend/dist/assets/LeaveManagement-VCYAVQjI.js` only.
No unmerged branch adds leave *source*. INFERENCE: there is no in-flight leave work parked on a branch.
Tag: FACT (git output) / INFERENCE (conclusion).

### F-003 (Step 0) — `docs/` contains no leave spec
`ls docs/` → BACKEND_AUDIT_2026.md, bug-reporter-plan-v3.md, bug-reporter-prompts-steps-4-13.md,
cowork-fix-verification-prompt.md. No leave design doc. The "7 CL pro-rated by DOJ" spec the
prompt references is therefore **not in the repo** — it must come from chat/CLAUDE.md.
Will be logged under "Needs chat confirmation". Tag: FACT.

### F-004 (Step 0) — pre-scan file inventory (to be read by subagents)
Backend, leave-matching (grep -ilE 'leave|comp.?off|gate.?pass|short.?leave|accrual'), 45 files:
  routes: leaves.js, compensatoryOff.js, short-leaves.js, phase5.js, payroll.js, attendance.js,
          employees.js, employeePortal.js, financeAudit.js, early-exits.js,
          early-exit-deductions.js, analytics.js, reports.js, sales.js, settings.js, import.js,
          ai.js, sqlConsole.js, usage-logs.js
  services: phase5Features.js, dayCalculation.js, salaryComputation.js, salesSalaryComputation.js,
            dailyMIS.js, employeeProfileService.js, exportFormats.js, salesExportFormats.js,
            financeRedFlags.js, behavioralPatterns.js, earlyExitDetection.js, missPunch.js,
            jobQueue.js, protectedWrite.js, sarvamBatchPoller.js,
            patternEngine/{index,individualPatterns,flightRiskPatterns}.js
  db/config: database/schema.js, database/db.js, config/permissions.js, config/schemaReference.js,
             server.js
  scripts: backend/scripts/{reseed-leave-balances-2026.js, phase5-simulation.js,
           investigate-manoj.js}, backend/src/scripts/seedSessionData.js
Frontend src, 26 files:
  pages: LeaveManagement.jsx, DailyMIS.jsx, DayCalculation.jsx, SalaryComputation.jsx,
         EmployeeProfile.jsx, Employees.jsx, FinanceAudit.jsx, Settings.jsx, Reports.jsx,
         MissPunch.jsx, Loans.jsx, Sales/SalesUpload.jsx, Sales/SalesTaDaUpload.jsx
  components: GatePasses.jsx, EarlyExitDetection.jsx, FinanceEarlyExitApprovals.jsx,
              layout/Sidebar.jsx, pipeline/PipelineProgress.jsx, ui/CalendarView.jsx, ui/Tooltip.jsx
  utils/other: App.jsx, utils/api.js, utils/payslipPdf.js, utils/salesPayslipPdf.js,
               utils/abbreviations.js, hooks/useNewBugReportCount.js
Tag: FACT (grep output).

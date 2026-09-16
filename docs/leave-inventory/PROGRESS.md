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


### Step 1 — parallel Explore subagents LAUNCHED (in flight)
Four read-only Explore agents dispatched in one batch:
1. data model  → `parts/01-data-model.md`
2. backend     → `parts/02-backend.md`
3. frontend    → `parts/03-frontend.md`
4. history     → `parts/04-history.md`
Each is scoped to write exactly one file and forbidden from touching source, DB or servers.

### Step 2 — `parts/05-live.md` written as PENDING (commit 3a4c709)
Live verification is **impossible from this container**, confirmed four ways:
`SQL_CONSOLE_URL` unset, `${#SQL_CONSOLE_API_KEY}`=0, `find . -name '*.db'` → 0 files,
`which sqlite3` → not installed, `backups/` holds only a 0-byte `.gitkeep`. FACT.
Skipped per the prompt's explicit instruction rather than improvised around. The file
records the blockers and carries 11 paste-ready read-only queries (Q1–Q11) so the gap
closes in one sitting. Q3 (accrual ledger by year×month) is flagged as the single most
important unanswered question in the audit.

---

## NEXT

1. **Await the four subagents**, then commit each `parts/0N-*.md` as it lands.
2. Cross-read the four parts for contradictions (esp. code-vs-CLAUDE.md; **code wins**).
3. Assemble `LEAVE_INVENTORY.md` (15 sections) + `leave_items.csv` (UTF-8 BOM, >=40 rows).
   Every data-side cell → `PENDING` (see F-001 / L-001).
4. VERIFY: all sections filled-or-PENDING; re-open 5 random `file:line` refs and confirm;
   CSV row count >= 40; `git diff --stat origin/main` touches only `docs/leave-inventory/**`
   (+ CLAUDE.md at the very end).
5. SHIP: `/session-handoff`, commit, `git push -u origin docs/leave-inventory`,
   confirm local HEAD == remote HEAD. **No PR.**

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

### F-005 (Step 2) — no live data path exists from Claude Code on the web
Beyond the unset env vars: there is no local `.db` anywhere in the repo, no `sqlite3` binary
installed, and `backups/` contains only a 0-byte `.gitkeep`. So even a "read the dev DB"
fallback is unavailable. Consequence: this audit can establish what the code *would* do, never
what production *contains*. The headline question — has EL accrual ever actually run? — is a
data question and stays open. Tag: FACT (command output) / INFERENCE (consequence).

### F-006 (Step 2) — a public read-only MCP endpoint exists but was deliberately not used
CLAUDE.md §9.3 + §10 document `https://hr-salary-system-production.up.railway.app/mcp` as
publicly accessible and read-only (auth removed 2026-05-02; upstream 403s all writes). It could
answer Q1–Q11 without credentials. Not used, because (a) the prompt gates this step on the env
vars specifically and (b) the prompt's "No POST/PUT/DELETE calls" rule forbids POST, which is
the MCP tool-call transport — even though the rule's intent is plainly "no writes".
Raising it rather than silently bypassing. Tag: FACT (docs) / OPINION (the judgement call).

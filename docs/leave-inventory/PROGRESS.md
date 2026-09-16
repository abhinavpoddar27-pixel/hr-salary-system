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


### Step 3 — four Explore subagents returned (all four)
**None of the four had a `Write` tool** (read-only Explore agents). Each handed its report back
as text; the orchestrator transcribed all four verbatim into `parts/`. The backend agent's report
exceeded the message limit and was persisted by the harness to a tool-results file, then extracted
from the fenced block. Provenance notes were appended to each transcribed part.
- `parts/01-data-model.md` (549 lines) — commit with part 04
- `parts/02-backend.md` (322 lines) — own commit
- `parts/03-frontend.md` (376 lines) — own commit
- `parts/04-history.md` (360 lines) — commit with part 01

### Step 4 — orchestrator spot-verification, 8/8 CONFIRMED
Because three parts were transcribed rather than written by their author, eight cited
`file:line` refs were independently re-opened. All eight matched verbatim:
`schema.js:633` · `phase5Features.js:27-39` · `server.js:212` · `dayCalculation.js:464-466` ·
`leaves.js:354` · `phase5.js:23/33/51/76` · `employeePortal.js:71` · `Sidebar.jsx:50`.
Two upgraded from agent-claim to orchestrator-verified FACT: the unguarded `accrue-leaves`
endpoint (G-1) and the `ORDER BY created_at` portal crash (G-17).

### Step 5 — deliverables assembled
- `LEAVE_INVENTORY.md` (413 lines, all 15 sections filled or explicitly PENDING)
- `leave_items.csv` (76 data rows, 7 columns, UTF-8 BOM verified by byte check)
- `git diff --name-only --cached origin/main` → touches **only** `docs/leave-inventory/**`. Scope clean.

---

## NEXT

**Audit complete.** Remaining: `/session-handoff` (CLAUDE.md Section 0), final commit,
`git push -u origin docs/leave-inventory`, confirm local HEAD == remote HEAD. **No PR.**

If this is resumed later, the open work is NOT more auditing — it is §13 of
`LEAVE_INVENTORY.md` (12 one-line questions for Abhinav) and §14 (15 sequenced fixes,
each naming its target file and a DO-NOT-MODIFY list). Do not start N-4, N-5 or N-10
before Q1 (CL 7 or 12) and Q4 (is SL truly gone) are answered.

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

### F-007 (Step 3) — all four Explore agents lacked a Write tool
Every subagent reported the same blocker and returned its file content as text. Cost: four
verbatim transcriptions plus one extraction from a harness-persisted tool-result file. Mitigated
by the 8-point spot-check in Step 4 rather than trusting the transcription blind.
**For future audit prompts: spawn these as `general-purpose` agents, or have the orchestrator
write every part file itself.** Tag: FACT (agent reports) / OPINION (the recommendation).

### F-008 (Step 4) — the two highest-severity findings are orchestrator-verified, not agent-claimed
G-1 (`POST /api/features/accrue-leaves` has no role guard, while its two siblings do and the
guard helper's own comment sits ten lines above saying balance-mutating endpoints need it) and
G-17 (`employeePortal.js:71` orders by a column `leave_applications` does not have) were both
re-opened and confirmed directly. Neither rests on a subagent's word. Tag: FACT.

### F-009 (Step 5) — the audit's headline is operational, not structural
Leave is fully built and fully deployed (35/35 dist probes). What is missing is that nothing
runs it, nothing guards it, and nobody wrote the policy down. The single most valuable follow-up
is also the cheapest: recover commit `796f34e` into CLAUDE.md — the text is already written and
already correct. Tag: INFERENCE (synthesis) / OPINION (the priority call).

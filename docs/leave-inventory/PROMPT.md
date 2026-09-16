# ORIGINAL PROMPT (verbatim) — Leave Inventory read-only audit

LEAVE INVENTORY — READ-ONLY AUDIT. Goal: one file, docs/leave-inventory/LEAVE_INVENTORY.md, mapping everything built for leave management (EL, CL, LWP, OD/comp-off, short leave/gate pass, removed SL, sales earned leave), comparing spec, code and live data.

STEP 0 (plan gate — then STOP and wait for "go"):
- git status --porcelain --untracked-files=no | wc -l   → must be 0, else stop and list the dirty files
- git fetch --all --prune --quiet && git switch -c docs/leave-inventory origin/main
- Save this whole prompt to docs/leave-inventory/PROMPT.md, and create docs/leave-inventory/PROGRESS.md (DONE / NEXT / FINDINGS). Update PROGRESS.md and commit after EVERY step. After a context compaction: re-read PROMPT.md and PROGRESS.md, then continue from NEXT.
- Report: remote branch count, whether SQL_CONSOLE_URL is set and SQL_CONSOLE_API_KEY length is non-zero (echo ${#SQL_CONSOLE_API_KEY} — never the value), and the files you plan to read.

RULES
- Read-only. Write only inside docs/leave-inventory/ (plus CLAUDE.md Section 0 at the very end). DO NOT MODIFY salaryComputation.js, dayCalculation.js, schema.js, payroll.js, phase5Features.js, leaves.js, compensatoryOff.js, anything in frontend/ (incl. dist), or any DB state. No POST/PUT/DELETE calls. Never run backend/scripts/reseed-leave-balances-2026.js or any /api/phase5/* route.
- No brain-mcp reads. No names/phone/PAN/Aadhaar/bank data in the output — employee codes and counts only.
- Tag every claim FACT (with file:line, commit SHA or query result), INFERENCE or OPINION. When code and docs disagree, code wins — log the disagreement as a finding.
- Past claude.ai chats are not reachable from here. Use CLAUDE.md session logs, docs/, commit messages and PR titles as the decision record, and list anything you could not confirm under "Needs chat confirmation".

AFTER "go" — run 4 PARALLEL Explore subagents. Each writes docs/leave-inventory/parts/0N-*.md:
1. Data model: every leave table, column, index, safeAddColumn and policy_config key, with schema.js line numbers. Leads: leave_balances, leave_accrual_ledger, leave_applications, leave_transactions, compensatory_off_requests, short_leaves, holidays; day_calculations cl_used/el_used/lop_days/od_days/short_leave_days/uninformed_absent; salary_computations cl_days/el_days/lwp_days/od_days; policy_config el_accrual_rate, el_eligibility_days, and cl_annual_entitlement=12 (the spec says 7 CL, pro-rated by DOJ — is that key read anywhere?).
2. Backend: every leave route (method | path | mount | role guard | file:line | reads/writes). Every function touching leave (runLeaveAccrual, initCLOpening, yearEndLapse, computeClEntitlement, …) and ALL of its callers. Answer directly: does anything call runLeaveAccrual automatically (Stage 7 finalize, monthEndScheduler, jobQueue), or only POST /api/phase5/accrue-leaves? How does day calc consume approved CL/EL/LWP/OD, and are contractors excluded? What do payslip, reports, exports, financeAudit, the pattern engine, Daily MIS, employeePortal and sales do with leave? What does each leave script do?
3. Frontend: LeaveManagement.jsx and its tabs, the EmployeeProfile leave tab, the DailyMIS on-leave section, Gate Passes, leave columns in SalaryComputation, payslipPdf, Settings. For each: App.jsx route, Sidebar entry, permissions.js roles, and the api.js calls. Grep a unique string from each feature in frontend/dist to confirm it actually ships.
4. History: git log --all -i -E --grep='leave|\bEL\b|\bCL\b|LEAFS|accrual|comp.?off|short.?leave|gate.?pass' --format='%h|%ad|%D|%s' --date=short. Also git log --all on leaves.js, phase5Features.js, compensatoryOff.js, LeaveManagement.jsx and the reseed script. From git branch -r --no-merged origin/main, list the branches that touch leave files and what they add. Pull every leave mention from CLAUDE.md and docs/, with line numbers. Build one dated timeline.

THEN, if the SQL env vars are set, use /sql-query (one SQLite statement per call; save each query and its result to parts/05-live.md):
- row counts per leave table
- leave_balances by year × type (count, negatives, zeros, avg)
- leave_accrual_ledger by year × month × type (rows, accrued, used, lapsed, first/last created_at) → did EL accrual ever run, and for which months?
- leave_applications by type × status
- compensatory_off_requests by finance_status × is_applied_to_salary
- short_leaves by month
- 2026 monthly sums of the leave columns in day_calculations and salary_computations
- policy_config leave keys
- active non-contractor employees with no 2026 CL row
- ledger closing balance vs leave_balances mismatches
If the vars are not set, skip this step and mark it PENDING.

FINAL FILE — LEAVE_INVENTORY.md, sections:
1 Executive summary (≤8 lines: what exists / is live / is dormant / is broken)
2 Rule matrix per leave type: spec (source) | code (file:line) | data | MATCH / DRIFT / MISSING
3 Data model  4 Backend  5 Frontend + dist status  6 Pipeline flow (Stage 6 → 7 → finalize → payslip/reports)
7 Timeline  8 Live state  9 Decisions found  10 Planned but never built
11 Gaps & landmines, each with its plain-words consequence
12 Needs chat confirmation  13 Open questions for Abhinav (numbered, answerable in one line)
14 Next steps (OPINION; one fix = one commit; each names the target file and a DO NOT MODIFY list)
15 Sources
Also write leave_items.csv (area,item,type,location,status,evidence,tag), UTF-8 with BOM.

VERIFY:
- every section is filled or marked PENDING
- re-open 5 random file:line refs and confirm them
- the CSV has >=40 rows
- git diff --stat origin/main touches only docs/leave-inventory/** (and CLAUDE.md)
SHIP:
- run /session-handoff, commit, git push -u origin docs/leave-inventory
- confirm git rev-parse HEAD == git rev-parse origin/docs/leave-inventory
- do NOT open or merge a PR

REPLY WITH ONLY:
- branch + SHA (local = remote yes/no)
- counts: tables / routes / functions / pages / leave commits / unmerged leave branches
- top 5 gaps
- the "needs chat confirmation" list
- open questions

# P1-04 — Stage 6 run with a company selected cuts rows → always run for All companies
Base: origin/main 2d96842 · Branch: fix/stage6-company-scope-guard · Worktree: /home/claude/wt-p1-04
Master plan: `git show origin/docs/ux-bulk-master-plan:docs/ux-bulk/MASTER_PLAN.md` §6 P1-04, §10–§12 · Finding P-2
Ruling: **Q4 = always run for All companies, with a one-line note on screen** (plan recommendation; planner default,
owner may override).

## Diagnostics already done by the planner
- Code: `pages/DayCalculation.jsx` L111 `calculateDays({ month, year, company: selectedCompany })`. `day_calculations` is
  UNIQUE(code, month, year) — a run filtered to one company label rewrites whole-month rows from a partial attendance
  set (same mechanism as the 10 Oct nightly-sweep bug fixed in `services/jobQueue.js`; see CLAUDE.md "Nightly sweep
  corrupted Stage 6"). CLAUDE.md already warns: "run Stage 6 with All companies or it cuts rows".
- Production: 109 Stage 6 runs in 90 days (body not logged, so how many had a company is unknown).
- Backend (`payroll.js`, `recompute.js`) is DO-NOT-MODIFY → fix is frontend only.

## Phase 0 — plan only
1. Clean tree on fix/stage6-company-scope-guard at 2d96842. 2. Read DayCalculation.jsx calcMutation, the header
   (~L245–262), and what `calculateDays` in utils/api.js sends; check `/api/payroll/calculate-days` treats `company:''`
   / omitted as all companies (read only). 3. PLAN.md + PROGRESS.md, commit, push, STOP.

## Scope (smallest change)
- calcMutation sends `company: ''` (all companies) regardless of the top-bar filter. The register list view keeps
  filtering by company as today (L50 untouched).
- Under the Run button, one line when a company is selected: "Day calculation always runs for all companies, so no
  employee's days are cut. The list below still shows {company} only." (design:ux-copy may tighten it).
- Success toast unchanged except it may say "all companies".

## Targets
frontend/src/pages/DayCalculation.jsx → calcMutation + the header block only.

## Verify
- jest: unchanged backend → full suite count identical. Browser check `backend/scripts/stage6-all-companies-check.py`:
  scratch DB with fictional employees in TWO companies, attendance for both; select company A in the top bar; click Run;
  assert the POST body has company '' (request interception), both companies' rows exist after the run with full
  payable days, the note is visible only when a company is selected, list still filtered to A; 0 page/console errors.
- `--base`: on main the POST carries company A (record once).

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-04/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" on 10 Oct 2026 ("run through so we finish"). The PLANNER approves your Phase 0:
  finish Phase 0 (PLAN.md + PROGRESS.md committed + pushed), then STOP and report. The planner replies "go" or corrections.

## DO NOT MODIFY
Global (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, Stage 7 register
(SalaryComputation.jsx .salreg/COLS/pins), ED finance-review flow, loans engine. Plus everything outside Targets.

## Build rules
- One finding = this PR only. Repo is PUBLIC: fictional test data only, no real names/codes/money anywhere.
- Work ONLY in your worktree. backend/node_modules + frontend/node_modules are symlinks to the main repo (do not commit them).
- Frontend edit → `npm run build --prefix frontend`; commit frontend/dist in its own commit.
- Browser checks: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DB, real logins, built dist, port 3104 only.
  Pattern: backend/scripts/salary-register-report-check.py. Prove the bug once with `--base` on a main build.
- jest full suite before and after (record suites/tests).
- Self-debug pass + user-simulation pass (happy path + ≥1 edge) before hand-off.

## Hand-off
CLAUDE.md "Last Session" entry at the top (house style: branch, bug, fix, fragile, verified, not tested, found-not-fixed).
Commit messages end with the session attribution lines. Push; verify HEAD == origin/<branch>. Do NOT open/merge a PR.
Report: built / caught / tested (counts) / not tested (why) / final SHA / new findings.

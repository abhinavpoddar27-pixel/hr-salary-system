# STATUTORY FLAGS + LWF — PROGRESS

## RESUME BLOCK (read this first after any compaction or new session)
1. Read this file top to bottom, then `docs/statutory-flags/BUILD_PLAN.md` §1 (rulings) and §3 (landmines).
2. Current PR = the first row below that is not DONE. Its implementation plan is
   `docs/statutory-flags/IMPL_PR<N>.md` (written by the planning session).
3. `git status` + `git log --oneline -5` on the PR branch; compare with LAST STEP below.
4. Continue from NEXT STEP. Update this file after every small step (state, done, next) and commit it.

## PR STATUS
- PR-1 feat/statutory-flags — BUILD: Phase 0 done (rebased on d1ad7bf), waiting for "go"; STEP 1 next
- PR-2 feat/lwf-deduction — NOT STARTED
- PR-3 feat/statutory-filing — NOT STARTED

## LAST STEP
PR-1 Phase 0 done (10 Oct 2026, build agent, local only, nothing pushed).
- Fetched origin/main = d1ad7bf (no change since the plan's drift note). Rebased the 3 docs commits onto it:
  clean, no conflicts. New base d1ad7bf; branch head after rebase d2060ea (+ this PROGRESS commit).
- Drift 1d4221c..d1ad7bf on IMPL FILES: only `backend/server.js` (+2, lines added after old 364, inside
  app.listen) and `backend/src/database/schema.js` (+26, lines added after old 3527, loan_adjustments).
  Every line range cited in IMPL_PR1 lies above both insertion points → no cited range moved (re-checked:
  schema 816–821 reset, 2944 sales backfill; salaryComputation 301–308; financeAudit 1809 LEAST;
  server.js 231 mount anchor; the 11 structure-insert sites at the review's line numbers).
  All other FILES (employees.js, salary-input.js, sales.js, financeAudit.js, financeRedFlags.js,
  salaryComputation.js, App.jsx, Sidebar.jsx, api.js, Employees.jsx, SalaryInput.jsx,
  SalesEmployeeMaster.jsx, __tests__/helpers) unchanged.
- Drift on DO NOT MODIFY: payroll.js +8 (hold-release loan guard), routes/loans.js, services/loans/**
  (stage7/close/adjustments/ledger/reconcile/notify/states/index/closeScheduler), backend/scripts
  (+loans-close-simulation.js). None is edited by PR-1. T12 (loans) must be written against the
  PR-6 stage7.js (posted-month freeze / loan_adjustments), not the PR-5 shape.
- Test baseline on the rebased tree (Node v22.22.0; CI uses 20): `npx jest` → 42 suites / 769 tests,
  ALL PASS, 2 consecutive runs. No known-red tests remain (tdsCalculation and protectedWrite were fixed
  in the leave PR-0). Every failure from here on is NEW.
- `frontend npm run build` OK (15 s, only the usual chunk-size warning); rebuilt dist is byte-identical
  to the committed dist (git status clean after build).

## NEXT STEP
Wait for the reviewer's "go" (or a /goal line). Then STEP 1: schema additions (lwf columns ×4, sales
esi_number/uan, statutory_flag_batches + partial unique index, flags-off trigger after the columns).
Tests T8a, T13.

## OWNER RULINGS ADDED DURING THE BUILD
(record date + ruling; BUILD_PLAN §1 holds the original set)
- 10 Oct 2026 (owner): every Claude Code session runs Opus 5.5 — from a terminal: `--model claude-opus-5-5 --effort ultracode`; this replaces the `opusplan` / `opus` flags in RUNBOOK T1/T2. Resume line: `caffeinate -i claude --continue --permission-mode auto --model claude-opus-5-5 --effort ultracode`.
- 10 Oct 2026 (owner): PR-1 is run from the claude.ai project chat's cloud Claude Code workspace: a separate planning agent, the chat's review, then a separate build agent. Plan files come from this repo or the claude.ai Project, never from ~/Downloads. The owner still merges only in the GitHub web UI.
- 10 Oct 2026 (owner, on the planner's advice): helper agents may read, search and run tests in parallel, but STEPs stay strictly in order and only one agent edits files at a time; salaryComputation.js, schema.js and payroll.js are edited only by the main build agent.
- 10 Oct 2026: the repo was confirmed PUBLIC (GitHub API, raw file 200). Nothing on this branch is pushed until the owner makes it private (T0 prerequisite). Build and commit locally; push is the last step.

## DECISIONS TAKEN BY CLAUDE CODE (safest option, owner to review)
(none)

## FILES TOUCHED
(none)

## TEST STATUS
Baseline on d1ad7bf (rebased PR-1 branch, 10 Oct 2026): 42 suites / 769 tests, 0 failures, 2 clean runs.
(The older "tdsCalculation 3 red / protectedWrite flaky" note is obsolete — both were fixed before d1ad7bf.)
Frontend build: OK, dist reproduces byte-identical.

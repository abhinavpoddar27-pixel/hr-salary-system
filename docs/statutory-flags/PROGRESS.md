# STATUTORY FLAGS + LWF — PROGRESS

## RESUME BLOCK (read this first after any compaction or new session)
1. Read this file top to bottom, then `docs/statutory-flags/BUILD_PLAN.md` §1 (rulings) and §3 (landmines).
2. Current PR = the first row below that is not DONE. Its implementation plan is
   `docs/statutory-flags/IMPL_PR<N>.md` (written by the planning session).
3. `git status` + `git log --oneline -5` on the PR branch; compare with LAST STEP below.
4. Continue from NEXT STEP. Update this file after every small step (state, done, next) and commit it.

## PR STATUS
- PR-1 feat/statutory-flags — BUILD IN PROGRESS (go received 10 Oct 2026); see LAST STEP
- PR-2 feat/lwf-deduction — NOT STARTED
- PR-3 feat/statutory-filing — NOT STARTED

## LAST STEP
STEP 1 done — commit eca75e2 `feat(statutory): lwf columns, batch table, new-employee flags-off trigger`.
Tests: statutorySchema.test.js T8a (3) + T13 (4) green; full suite 43 suites / 776 tests green.
(Phase 0: rebased on d1ad7bf, drift nil on FILES ranges, baseline 42/769 all green — see commit dd1d849.)

## NEXT STEP
STEP 2: remove the startup reset (schema.js 816–821 → shifted +0, block is above the STEP 1 insert),
add `withLiveDefaults(db)` to the fixture, T8 (initSchema twice → uploaded flags intact).

## OWNER RULINGS ADDED DURING THE BUILD
(record date + ruling; BUILD_PLAN §1 holds the original set)
- 10 Oct 2026 (owner): every Claude Code session runs Opus 5.5 — from a terminal: `--model claude-opus-5-5 --effort ultracode`; this replaces the `opusplan` / `opus` flags in RUNBOOK T1/T2. Resume line: `caffeinate -i claude --continue --permission-mode auto --model claude-opus-5-5 --effort ultracode`.
- 10 Oct 2026 (owner): PR-1 is run from the claude.ai project chat's cloud Claude Code workspace: a separate planning agent, the chat's review, then a separate build agent. Plan files come from this repo or the claude.ai Project, never from ~/Downloads. The owner still merges only in the GitHub web UI.
- 10 Oct 2026 (owner, on the planner's advice): helper agents may read, search and run tests in parallel, but STEPs stay strictly in order and only one agent edits files at a time; salaryComputation.js, schema.js and payroll.js are edited only by the main build agent.
- 10 Oct 2026: the repo was confirmed PUBLIC (GitHub API, raw file 200). Nothing on this branch is pushed until the owner makes it private (T0 prerequisite). Build and commit locally; push is the last step.

## DECISIONS TAKEN BY CLAUDE CODE (safest option, owner to review)
(none)

## FILES TOUCHED
- backend/src/database/schema.js (STEP 1)
- backend/src/__tests__/helpers/statutoryFixture.js (new, STEP 1)
- backend/src/__tests__/statutorySchema.test.js (new, STEP 1)

## FRAGILE-FILE EDITS (before / after)
- STEP 1 schema.js — BEFORE (lines 2214–2218 on d1ad7bf):
    safeCreateIndex('...idx_sales_salary_structures_emp ON sales_salary_structures(employee_id, effective_from)');
    <blank>
    // ── Sales Salary Module — Phase 2 (holidays + upload + monthly input) ─
  AFTER: same two anchor lines, with a new block between them (≈50 lines): 4× safeAddColumn lwf_applicable
  INTEGER DEFAULT 0 (employees, salary_structures, sales_employees, sales_salary_structures);
  safeAddColumn sales_employees.esi_number TEXT, .uan TEXT; CREATE TABLE IF NOT EXISTS statutory_flag_batches
  (id, scope CHECK plant|sales, effective_month, file_name, file_sha256, row_count, changed_count,
  status DEFAULT 'applying', applied_by, applied_at, summary_json, undo_json); partial unique index
  uniq_statutory_flag_batches_applied ON (scope, effective_month, file_sha256) WHERE status='applied';
  DROP TRIGGER IF EXISTS employees_statutory_default_off + CREATE TRIGGER … AFTER INSERT ON employees
  FOR EACH ROW BEGIN UPDATE employees SET pf_applicable=0, esi_applicable=0, lwf_applicable=0 WHERE id=NEW.id; END
  (in try/catch with console.error). No existing line edited.

## TEST STATUS
Baseline on d1ad7bf (rebased PR-1 branch, 10 Oct 2026): 42 suites / 769 tests, 0 failures, 2 clean runs.
After STEP 1: 43 / 776, 0 failures.
(The older "tdsCalculation 3 red / protectedWrite flaky" note is obsolete — both were fixed before d1ad7bf.)
Frontend build: OK, dist reproduces byte-identical.

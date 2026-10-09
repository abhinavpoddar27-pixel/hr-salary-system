# STATUTORY FLAGS + LWF — PROGRESS

## RESUME BLOCK (read this first after any compaction or new session)
1. Read this file top to bottom, then `docs/statutory-flags/BUILD_PLAN.md` §1 (rulings) and §3 (landmines).
2. Current PR = the first row below that is not DONE. Its implementation plan is
   `docs/statutory-flags/IMPL_PR<N>.md` (written by the planning session).
3. `git status` + `git log --oneline -5` on the PR branch; compare with LAST STEP below.
4. Continue from NEXT STEP. Update this file after every small step (state, done, next) and commit it.

## PR STATUS
- PR-1 feat/statutory-flags — PLANNED (IMPL_PR1.md), build not started
- PR-2 feat/lwf-deduction — NOT STARTED
- PR-3 feat/statutory-filing — NOT STARTED

## LAST STEP
PR-1 plan written: docs/statutory-flags/IMPL_PR1.md (separate planning agent on base 1d4221c, reviewed by the chat; binding REVIEW CORRECTIONS C1–C6 at the end of the file; errata E1–E15, new landmines N1–N11).

## NEXT STEP
Build session for PR-1 (PROMPT_BUILD.md Phase 0): rebase onto latest origin/main (was d1ad7bf), print FILES / DO NOT MODIFY / STEPS, stop for go.

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
Baseline on main: tdsCalculation 3 red (known), protectedWrite flaky (known).

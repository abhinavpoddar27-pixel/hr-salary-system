# P1-24 — Miss Punch: stray "0" rendered next to the Correct button
Base: origin/main 18bef07 · Branch: fix/misspunch-stray-zero · Worktree: /home/claude/wt-p1-24
Master plan: §6 P1-24 · Finding O-3

## Diagnostics already done by the planner
- `pages/MissPunch.jsx`: a JSX expression of the form `{rec.miss_punch_resolved && …}` (or another numeric `&&`)
  renders the number 0 when the value is 0 (React prints 0, not nothing). P1-09 (#97) already edited this file
  (banner) — do not touch that part.

## Phase 0 — plan only
grep every `&&` in JSX children of MissPunch.jsx whose left side can be a number; list them. PLAN.md + PROGRESS.md,
commit, push, STOP.

## Scope (smallest change)
Make each such guard boolean (`!!x &&` or `x ? … : null`). className arrays (`[x && 'cls'].filter(Boolean)`) are fine
— leave them. No other change.

## Targets
frontend/src/pages/MissPunch.jsx only.

## Verify
Browser check `backend/scripts/misspunch-stray-zero-check.py`: rows with resolved 0 and 1, finance and hr views; no
text node equal to "0" next to the action buttons; 0 errors. `--base`: the "0" is present.

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-24/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" on 10 Oct 2026 ("run through so we finish"). The PLANNER approves your Phase 0:
  finish Phase 0 (PLAN.md + PROGRESS.md committed + pushed), then STOP and report. The planner replies "go" or corrections.

## DO NOT MODIFY
Global (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, Stage 7 register
(SalaryComputation.jsx .salreg/COLS/pins), ED finance-review flow, loans engine. Plus everything outside Targets.

## Build rules
- One finding = this PR only. Repo is PUBLIC: fictional test data only, no real names/codes/money anywhere.
- Work ONLY in your worktree. backend/node_modules + frontend/node_modules are symlinks to the main repo (do not commit them).
- Frontend edit → `npm run build --prefix frontend`; commit frontend/dist in its own commit.
- Browser checks: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DB, real logins, built dist, port 3124 only.
  Pattern: backend/scripts/salary-register-report-check.py. Prove the bug once with `--base` on a main build.
- jest full suite before and after (record suites/tests).
- Self-debug pass + user-simulation pass (happy path + ≥1 edge) before hand-off.

## Hand-off
CLAUDE.md "Last Session" entry at the top (house style: branch, bug, fix, fragile, verified, not tested, found-not-fixed).
Commit messages end with the session attribution lines. Push; verify HEAD == origin/<branch>. Do NOT open/merge a PR.
Report: built / caught / tested (counts) / not tested (why) / final SHA / new findings.

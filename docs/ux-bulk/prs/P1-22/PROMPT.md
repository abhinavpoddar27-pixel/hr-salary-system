# P1-22 — Salary change approver can't see all components
Base: origin/main 868f5389 · Branch: fix/salary-change-approver-view · Worktree: /home/claude/wt-p1-22 · Port: 3122
Master plan: docs/ux-bulk/MASTER_PLAN.md §6 + §9 row for P1-22 (on branch docs/ux-bulk-progress-10oct — read with: git -C /home/claude/wt-docs show HEAD:docs/ux-bulk/MASTER_PLAN.md)

## Finding F-2 (High) — money-adjacent, read-only UI
Salary Input → pending salary change cards (`pages/SalaryInput.jsx` ~L270–280): the approver sees only Basic/DA/HRA,
not all components, and no effective date — finance approves blind. P1-23 (#106, merged) added the self-approval note on
these cards; keep it.
## Scope
Each pending card shows all five components (Basic, DA, HRA, Conveyance, Other) and gross, old → new, changed values
highlighted, plus the effective date the approval will use (if the screen sends none, show "effective today" — that is
what the server does; do NOT add effectiveFrom sending in this PR, note it). Read `routes/salary-input.js` to see the
exact old/new JSON shape (`old_structure` / `new_structure`). Display only — no route change.
## Targets
frontend/src/pages/SalaryInput.jsx.
## Verify
Playwright (hr raises via API, finance views): all five components + gross old → new, changed ones highlighted, a
request with only gross changed and one with components changed; legacy rows with missing JSON don't crash; 390px;
0 errors. `--base`: Conveyance/Other missing.


## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-22/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" on 10 Oct 2026 ("run through so we finish"). The PLANNER approves your Phase 0:
  finish Phase 0 (PLAN.md + PROGRESS.md committed + pushed), then STOP and report. The planner replies "go" or corrections.

## DO NOT MODIFY
Global (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, Stage 7 register
(SalaryComputation.jsx .salreg/COLS/pins), ED finance-review flow, loans engine. Plus everything outside Targets.

## Build rules
- One finding = this PR only. Repo is PUBLIC: fictional test data only, no real names/codes/money anywhere.
- Work ONLY in your worktree. backend/node_modules + frontend/node_modules are symlinks to the main repo (do not commit them).
- Frontend edit → `npm run build --prefix frontend`; commit frontend/dist in its own commit.
- Browser checks: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DB, real logins, built dist, port 3122 only.
  Pattern: backend/scripts/salary-register-report-check.py. Prove the bug once with `--base` on a main build.
- jest full suite before and after (record suites/tests).
- Self-debug pass + user-simulation pass (happy path + ≥1 edge) before hand-off.

## Hand-off
CLAUDE.md "Last Session" entry at the top (house style: branch, bug, fix, fragile, verified, not tested, found-not-fixed).
Commit messages end with the session attribution lines. Push; verify HEAD == origin/<branch>. Do NOT open/merge a PR.
Report: built / caught / tested (counts) / not tested (why) / final SHA / new findings.
- Parallel builders share this machine: wrap EVERY frontend build as `flock /tmp/vite.lock npm run build --prefix frontend`
  and every FULL jest run as `flock /tmp/jest.lock npx jest` (single test files need no lock). Never `pkill` broadly —
  kill only PIDs you started. Use only your port.

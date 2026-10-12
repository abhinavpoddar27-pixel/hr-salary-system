# P3-PG PROGRESS

## RESUME
Branch fix/payroll-stage-role-guard, worktree /home/claude/wt-pg, port 3402. Read PLAN.md. Owned: payroll.js (guard lines
+ local helper only on the 3 routes), new payrollStageRoleGuard.test.js, new scripts/payroll-stage-guard-check.js, this dir.
Do NOT edit CLAUDE.md, roles.js, frontend, P2-11 files.

## Steps
- [x] Phase 0: read head_pg.md, common_rules.md, P2-11 entry + PLAN; read payroll.js routes, roles.js, jwtApiHarness,
      P2-11 tests/script (do not list these routes), frontend callers. PLAN.md written.
- [x] Planner "go" (12 Oct)
- [x] jest baseline: 115 suites / 2040 tests, all pass
- [x] Guard lines in payroll.js (helper + 3 insertions; `git diff origin/main -- backend/src/routes/payroll.js` = 4 lines)
- [x] payrollStageRoleGuard.test.js 20/20; on 8abee969 13 fail (every refused-role case: got 200), 7 controls pass
- [x] payroll-stage-guard-check.js 21/21 (port 3402); --base on an 8abee969 worktree 7/7 (viewer runs Stage 6, supervisor Stage 7, viewer finalises)
- [x] merge origin/main (already up to date at 8abee969); full jest after: 116 suites / 2060 tests, all pass; pushed

## Rulings
Q1 local one-line helper in payroll.js (P2-11 pattern). Q2 403 text 'HR, finance or admin access required'.
Q3 hr stays on finalise (hr+finance+admin on all three). Diff in payroll.js = helper + 3 guard insertions only.
UI-button finding → planner's register.

## CLAUDE.md entry
## Last Session — 2026-10-12 (P3-PG: payroll Stage 6 / Stage 7 / finalise role guard)
**Branch `fix/payroll-stage-role-guard`, NOT merged. MONEY / PROTECTED-FILE PR (owner approved the payroll.js edit 12 Oct);
independent review before PR.** Plan + log: `docs/ux-bulk/prs/P3-PG/PLAN.md`, `PROGRESS.md`. Closes the P2-11 owner list.
- **Bug:** POST /api/payroll/calculate-days, /compute-salary and /finalise sat behind requireAuth only → any logged-in role
  (viewer, supervisor, employee login) could run Stage 6 / Stage 7 for a whole month or finalise a signed-off month.
- **Fix (payroll.js, 4 lines):** local one-line `requireHrFinanceOrAdmin` (P2-11 pattern; roles.js has no export for it) on
  the three routes → 403 `{success:false, error:'HR, finance or admin access required'}` before the handler. Rulings Q1–Q3:
  hr + finance + admin on all three (90-day callers were exactly these). Stale override still admin only; finance sign-off
  gate unchanged (its own 403 carries `requiresFinanceApproval`).
- **Fragile:** a user whose stored role normalises to viewer (blank / unknown label) is now refused. The Stage 6/7 buttons are
  still shown to every role in the UI (planner register) — a refused role sees a 403 toast.
- **Verified:** new `payrollStageRoleGuard.test.js` 20 (real requireAuth + JWTs; refused calls leave day_calculations,
  salary_computations, monthly_imports, audit_log, notifications, loan_deductions byte-identical; 13 fail on 8abee969).
  `node backend/scripts/payroll-stage-guard-check.js` (real server.js, port 3402, real logins) 21/21; `--base` 7/7.
  jest 115/2040 → 116/2060.
- **Not tested:** Railway; browser (no frontend change).

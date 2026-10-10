# P1-10 — Night Shift "Undo" actually rejects the pairing — relabel + confirm + aria
Base: origin/main 3d20021 · Branch: fix/nightshift-undo-relabel · Worktree: /home/claude/wt-p1-10
Master plan: §6 P1-10 · Finding P-6

## Diagnostics already done by the planner
- `pages/NightShift.jsx` ~L185–200: on a confirmed low/medium-confidence pair the "Undo" button calls
  `rejectMutation` (it does NOT return the pair to Pending — it rejects it). The pending-row "✕" also rejects, with no
  label or confirm. Read what reject does server-side (routes/attendance.js night-shifts reject — read only) and state
  the consequence in plain words in PLAN (e.g. the IN and OUT are no longer treated as one shift).

## Phase 0 — plan only
Read both buttons, the mutations and the reject route. PLAN.md + PROGRESS.md, commit, push, STOP.

## Scope (smallest change)
- "Undo" → "Reject pairing"; "✕" gets aria-label + title "Reject pairing".
- Both open a confirm (use the existing ConfirmDialog/Modal component already in the codebase, not window.confirm)
  that names the employee, the dates and the consequence. Cancel does nothing.
- No backend change; no change to Confirm.

## Targets
frontend/src/pages/NightShift.jsx → those two buttons + a confirm state. Nothing else.

## Verify
Browser check `backend/scripts/nightshift-reject-confirm-check.py`: fictional pairs (one pending, one confirmed
medium); click ✕ → confirm shows → Cancel → pair unchanged in DB; Reject → is_rejected=1; same for the relabelled
button; aria-label present; 0 errors. `--base`: one click rejects with no confirm.

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-10/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Owner gave a programme-level "go" on 10 Oct 2026 ("run through so we finish"). The PLANNER approves your Phase 0:
  finish Phase 0 (PLAN.md + PROGRESS.md committed + pushed), then STOP and report. The planner replies "go" or corrections.

## DO NOT MODIFY
Global (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js, Stage 7 register
(SalaryComputation.jsx .salreg/COLS/pins), ED finance-review flow, loans engine. Plus everything outside Targets.

## Build rules
- One finding = this PR only. Repo is PUBLIC: fictional test data only, no real names/codes/money anywhere.
- Work ONLY in your worktree. backend/node_modules + frontend/node_modules are symlinks to the main repo (do not commit them).
- Frontend edit → `npm run build --prefix frontend`; commit frontend/dist in its own commit.
- Browser checks: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DB, real logins, built dist, port 3110 only.
  Pattern: backend/scripts/salary-register-report-check.py. Prove the bug once with `--base` on a main build.
- jest full suite before and after (record suites/tests).
- Self-debug pass + user-simulation pass (happy path + ≥1 edge) before hand-off.

## Hand-off
CLAUDE.md "Last Session" entry at the top (house style: branch, bug, fix, fragile, verified, not tested, found-not-fixed).
Commit messages end with the session attribution lines. Push; verify HEAD == origin/<branch>. Do NOT open/merge a PR.
Report: built / caught / tested (counts) / not tested (why) / final SHA / new findings.

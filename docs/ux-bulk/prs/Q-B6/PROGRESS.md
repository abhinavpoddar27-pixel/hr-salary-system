# Q-B6 — PROGRESS

**State:** Phase 0 done (plan only). Waiting for planner rulings Q1–Q7. No code written.
Branch `fix/bulk-revision-preapproved-flags` off main b2badcab. MONEY PR. Port 3503.

## Done
- Read: salaryComputation.js L738–739 + L1043–1077 (flag UPSERT never resets finance_approved), schema.js
  salary_manual_flags, financeAudit.js grossRequestForFlag / decideManualFlag / approve-flag / bulk-approve /
  salary-manual-flags list / readiness-check, salaryChange.approveSalaryChange, salary-input approve route,
  bulk/kinds/salaryRevision.js (applyRow → approveSalaryChange, undo guards), bulkSchema.js, financeRedFlags gross_changed.
- Production counts (read-only): see PLAN §2 — 116 pending GROSS flags Mar–Aug 2026, all but Feb's 3 match an approved
  single-path request; 0 bulk batches in production; 19 flags land in a month earlier than the approval.
- PLAN.md written: recommended option (b) stamp-on-read helper `services/grossFlagPreapproval.js`.

## Next
- Planner rulings Q1–Q7 → Phase 1 build.

## Rulings
- (none yet)

## RESUME
Read docs/ux-bulk/prs/Q-B6/PLAN.md. Phase 0 only — do not code until the planner says "go" with rulings.
Worktree /home/claude/wt-qb6, node_modules are symlinks (stage files by name).

## CLAUDE.md entry
(filled in Phase 3)

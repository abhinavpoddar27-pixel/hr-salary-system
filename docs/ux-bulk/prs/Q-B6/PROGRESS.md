# Q-B6 — PROGRESS

**State:** Phase 1 build in progress (rulings received 22 Oct). Service + routes + UI + jest done; full suite + browser check next.
Branch `fix/bulk-revision-preapproved-flags` off main b2badcab. MONEY PR. Port 3503.

## Done
- Read: salaryComputation.js L738–739 + L1043–1077 (flag UPSERT never resets finance_approved), schema.js
  salary_manual_flags, financeAudit.js grossRequestForFlag / decideManualFlag / approve-flag / bulk-approve /
  salary-manual-flags list / readiness-check, salaryChange.approveSalaryChange, salary-input approve route,
  bulk/kinds/salaryRevision.js (applyRow → approveSalaryChange, undo guards), bulkSchema.js, financeRedFlags gross_changed.
- Production counts (read-only): see PLAN §2 — 116 pending GROSS flags Mar–Aug 2026, all but Feb's 3 match an approved
  single-path request; 0 bulk batches in production; 19 flags land in a month earlier than the approval.
- PLAN.md written: recommended option (b) stamp-on-read helper `services/grossFlagPreapproval.js`.

## Done (Phase 1)
- `backend/src/services/grossFlagPreapproval.js` (new): grossRequestForFlag (moved), syncGrossFlagPreapprovals, preapprovalInfo.
- `backend/src/routes/financeAudit.js`: import, local copy of grossRequestForFlag removed, sync call at the top of
  GET /salary-manual-flags and GET /readiness-check, list rows carry `preapproved`.
- `frontend/src/pages/FinanceAudit.jsx`: note under the Approved badge (`flag-preapproved-<id>`).
- `backend/src/__tests__/grossFlagPreapproval.test.js` 16/16; on origin/main's route 8 fail (the stamp tests), 8 controls pass.

## Next
- Full jest suite under flock; frontend build; Playwright check script (port 3503) + --base.

## Rulings (22 Oct 2026, planner/owner)
- Option (b) stamp-on-read. Q1 OWNER: all finance-approved salary change requests (single + bulk), one helper.
- Q2 stamp whenever either reader runs, any role (records the original approver only). Q3 no protected-file edit.
- Q4 withdraw an auto-approval when the flag no longer matches its request (audit row). Q5 show the note on the row.
- Q6 OWNER: backlog included (Mar–Aug stamped; never a finalised month; Feb's 3 unmatched stay pending). Q7 later (register).
- Keep: approver named and not the requester; finance reject of a stamped flag still reverts gross as today.
- Do not open a PR; independent review follows.

## RESUME
Read docs/ux-bulk/prs/Q-B6/PLAN.md. Phase 0 only — do not code until the planner says "go" with rulings.
Worktree /home/claude/wt-qb6, node_modules are symlinks (stage files by name).

## CLAUDE.md entry
(filled in Phase 3)

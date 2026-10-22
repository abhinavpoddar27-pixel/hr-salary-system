# Q-B6 — PROGRESS

**State:** Phases 1–3 done. Built, verified, pushed. NO PR (planner opens after the independent MONEY review).
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

- Self-debug: a flag finance set back to pending by hand (status CLEAR) would have been re-stamped → guarded
  (latest finance_approvals row manual and not WITHDRAWN → leave it) + test.
- Verified: new suite 17/17 (8 stamp tests fail on origin/main's route); related suites 105/105; full jest 131 suites /
  2326 tests. `backend/scripts/gross-flag-preapproval-check.py` (Chromium, built dist, scratch DB, finance + hr, port 3503)
  28/28; `--base` on an origin/main worktree 5/5 (all pending, readiness 5); fix-mode against origin/main 16 pass / 12 fail.
  Regression interventions-reject-all-check 56/56. Drift query (Sep 2026, jest scratch DB after real Stage 7) = 0.
- Production expectation (read-only, latest-request rule): first read stamps Mar 1, Apr 26 of 30, May 3, Jun 1, Jul 2,
  Aug 79 = 112; Feb 3 + Apr 4 stay pending.

## Next
- Independent review (planner). Register Q7 (Finance Verification gross_changed note).

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
## Last Session — 2026-10-22 (Q-B6: gross flags already approved through a salary change request are not asked again)
**Branch `fix/bulk-revision-preapproved-flags`, NOT merged. MONEY PR — independent review before PR.** Plan + log: `docs/ux-bulk/prs/Q-B6/PLAN.md`, `PROGRESS.md`.
Rulings 22 Oct: option (b) stamp-on-read; Q1 all approved requests (single + bulk); Q2 any reader role; Q3 no protected file;
Q4 withdraw on mismatch; Q5 note on the row; Q6 backlog included (never a finalised month); Q7 later.
- **Bug:** finance approves a salary change (Salary Input / Employee Master request, or a bulk salary revision — both via
  `salaryChange.approveSalaryChange`), then Stage 7 raises a pending GROSS_STRUCTURE_CHANGE flag and Manual Interventions +
  readiness (UNAPPROVED_MANUAL_FLAGS blocker) ask finance again. Prod: 116 such pending flags Mar–Aug 2026; 0 bulk batches yet.
- **Fix:** new `services/grossFlagPreapproval.js` — `grossRequestForFlag` moved here unchanged (decideManualFlag imports it),
  `syncGrossFlagPreapprovals(db, month, year)` run at the top of GET /finance-audit/salary-manual-flags and /readiness-check
  (try/catch, never breaks a read). Pending gross flag + latest approved gross request with new gross ±₹1, approver a named
  person ≠ requester, month not finalised → finance_approved 1, approved_by = the request's approver, finance_approvals row
  `[auto req #N batch #B] …`, audit FLAG_PREAPPROVED (changed_by 'system'). An auto-stamped flag that no longer matches its
  request → back to pending (finance_approvals WITHDRAWN + audit FLAG_PREAPPROVAL_WITHDRAWN), re-stamped if a newer eligible
  request matches. Hand decisions (approve / reject / CLEAR) never touched. List rows carry `preapproved` → Manual
  Interventions shows "With bulk batch #B / With request #N · approved by X" (`flag-preapproved-<id>`). salaryComputation.js,
  payroll.js, schema.js untouched; no schema change.
- **Fragile:** (1) Stage 7's flag UPSERT keeps finance_approved when values change — the withdraw guard covers auto-stamps only;
  hand approvals keep the old behaviour. (2) Auto rows are recognised by the `[auto req #` prefix on finance_approvals.comments —
  keep the tag. (3) The GET readers write (idempotent). (4) Match = LATEST approved gross-changing request (same rule as N-23).
- **Verified:** grossFlagPreapproval.test.js 17 (real Stage 7 + routes + real bulk approve; re-run keeps the stamp, value
  change withdraws, finalised month untouched, self-approved not stamped, reject still reverts); jest 131/2326;
  gross-flag-preapproval-check.py 28/28, --base 5/5; drift 0. **Not tested:** Railway; production data.
- **Register:** Q7 — Finance Verification `gross_changed` warning could say "approved in request #N".

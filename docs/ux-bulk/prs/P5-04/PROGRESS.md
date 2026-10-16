# P5-04 — PROGRESS (MONEY PR)
Branch `feat/bulk-salary-revision` (on feat/bulk-approval-stage 70d98cb + origin/fix/pf-ceiling-approval c6c2fec) · port 3504 · Builder A2

## RESUME
Read PLAN.md (FINAL DESIGN at the bottom), then this file, then `git log --oneline 70d98cb..HEAD`. Rulings below are binding.

## State
**Phase 3 HAND-OFF — built, verified, pushed. MONEY PR: waiting for the planner's independent review.**

## Rulings (planner, 16 Oct 2026)
- Q-B1 Salary Input header button → inline panel SalaryRevisionBulk.jsx (not a Modal) + BulkBatchList.
- Q-B2 % mode rounds new gross to ₹1 (`REVISION_GROSS_ROUND`).
- Q-B3 default effective date = 1st of next IST month; warn on any other day.
- Q-B4 conveyance kept exactly as the single approve path (N-17 `resolveApproval`).
- Q-B5 past dates allowed with a "re-run Stage 7" note; a finalised month on/after the date → error row.
- Q-B6 Stage 7 GROSS_STRUCTURE_CHANGE flags after apply left as is (follow-up below).
- Q-B7 split helpers → services/salarySplit.js; approve body → services/salaryChange.js `approveSalaryChange()`; thin route.
- Q-B8 pending single-path request → error row at preview/submit; at approve the re-plan refuses (batch stays submitted).
- Q6 second person decides (engine). R3 all-or-nothing, R5 ≤ 50 + auto-split, R8 never twice.

## Baseline → after
jest 123 suites / 2202 → 124 / 2218, all green (new bulkSalaryRevision.test.js 16). Named suites unchanged and green:
pfCeilingApproval, moneyPermissionBatch4, salaryFlagRevertAndApprove, salaryChangeSelfApproval, employeeBankColumns,
statutoryWriters. One test line changed on purpose: statutoryWriterGuard T10b sanity list names services/salaryChange.js
(the structure INSERT moved there; the scan still covers every file).

## Done
1. Final design in PLAN.md (1257cc0).
2. Moves (aa6693a): salarySplit.js (verbatim + `buildRevisionStructure`), salaryChange.js (helpers verbatim + `approveSalaryChange`,
   N-PF `requestedCeiling` included); PUT /salary-input/approve/:id = thin call, same status codes + JSON bodies.
3. Kind `kinds/salaryRevision.js` registered in engine KINDS (2db5390).
4. jest bulkSalaryRevision 16/16.
5. UI: `components/bulk/SalaryRevisionBulk.jsx` (paste / Excel upload, gross or % mode, check table with every component old →
   new, Δ / month, chips, leave out problem rows, ₹ total, send bar with batch split, result screen) + SalaryInput header
   "+ Bulk revision" (hr/admin) + BulkBatchList kind salary-revision (undo for finance/admin). `bulkSubmit` already in bulkApi.js.
6. `backend/scripts/bulk-salary-revision-check.py` 42/42; `--base` (origin/main b0ed242 build) 2/2. Regressions:
   bulk-approval-check 36/36, bulk-ed-check 50/50, pf-ceiling-approval-check 38/38. Drift query 0 rows.
7. Self-debug fixes (v2): (a) pasted "27,500" was split on the comma → separator is tab, else spaces/semicolons, comma only
   when nothing else; (b) "Recent bulk batches" did not show a new batch until reload → onSent invalidates ['bulk-batches'];
   (c) the header button was not clickable at 390 px → header wraps; (d) preview rows are mapped back to their input by the
   server-echoed `input` (repeated codes are merged, so position matching was wrong).

## Next
Planner independent review (MONEY). Then PR.

## Found / follow-up (not fixed)
- Q-B6: after a bulk revision, Stage 7 raises a GROSS_STRUCTURE_CHANGE manual flag per person — finance approves twice (R8).
- BulkBatchList "View rows" uses extra-duty wording ("created / replaced system entry") for every kind (P5-01's file).
- `raiseRequest` in employees.js still builds new_structure inline; `buildRevisionStructure` is the same object (parity test
  pins it). Switch raiseRequest to it on the next edit of that range.
- Plant compute reads gross from employees.gross_salary for every month (pre-existing): approving a revision then
  re-running an EARLIER month's Stage 7 pays that month at the new gross. Same as the single path.

## CLAUDE.md entry
## Last Session — 2026-10-16 (P5-04: bulk salary revision — first approval kind on the bulk engine)
**Branch `feat/bulk-salary-revision` (on feat/bulk-approval-stage + fix/pf-ceiling-approval), NOT merged. MONEY PR —
independent review before PR.** Plan + log: `docs/ux-bulk/prs/P5-04/PLAN.md`, `PROGRESS.md`. MASTER_PLAN §6 P5-04, §7.4 B3.
Rulings Q-B1…Q-B8 (16 Oct), Q6, R3, R5, R8.
- **Moves (no behaviour change):** split helpers `employees.js` → `services/salarySplit.js` (+ `buildRevisionStructure` = the
  object Employee Master's `raiseRequest` builds); approve helpers + body `salary-input.js` → `services/salaryChange.js`
  `approveSalaryChange(db, {id, actor, approvedBy, effectiveFrom})` → `{ok, effectiveFrom, gross, keptComponents, sameDate}` or
  `{ok:false, status, body}`; PUT /salary-input/approve/:id is a thin call with the same replies (N-17, N-MONEY2 percents,
  N-PF ceiling, R10 flags, STRUCTURE_DATED_LATER, SELF_APPROVAL unchanged).
- **Kind `salary-revision`** (`services/bulk/kinds/salaryRevision.js`, requiresApproval; hr/admin send, finance/admin decide):
  rows code + new gross OR % (rounded to ₹1) + optional own date; common effective date (default 1st of next IST month).
  Errors: not found / not active / both-or-neither / gross ≤ 0 / % outside −50…+100 / bad date / a finalised month on or after
  the date / later-dated structure / a Pending salary_change_request (Q-B8). Skipped: same gross. Warnings: no structure (50/20
  default), > 25 %, not the 1st, conveyance kept. Note (not a state): "Stage 7 already computed — re-run". Submit writes no
  salary table. Approve (engine IMMEDIATE txn): per row INSERT a Pending request (requested_by = batch creator, reason "Salary
  revision — bulk batch #N") → `approveSalaryChange` (approved_by = finance) → 3 audit rows stage `SALARY_REVISION_BULK`
  (request status, employees.gross_salary, salary_structures) — this path only. money_total = Σ Δ monthly gross.
  Undo (finance/admin, reason): blocked if request not Approved / a later request / gross or structure row changed / a
  later-dated structure / a finalised month ≥ effective / Stage 7 rows for months ≥ effective differ from the approve-time
  fingerprint; restores the structure (delete, or same-date row every column) + employees.gross_salary/updated_at, request → 'Reverted'.
- **UI:** Salary Input header "+ Bulk revision" (hr/admin) → inline `components/bulk/SalaryRevisionBulk.jsx` (paste or Excel,
  gross / % mode, check table with Basic/DA/HRA/Conv./Special/Other old → new, Δ/month, ₹ total, "Send N to finance (batches)")
  + `BulkBatchList kind="salary-revision"` (undo finance/admin). Finance decides in Finance Verification → Bulk batches
  (reviewColumns show every component).
- **Fragile:** (1) the kind echoes each row's input in its preview `input` — the panel sends exactly that; keep `displayExtra`.
  (2) `buildRevisionStructure` must stay equal to `raiseRequest`'s object (parity test). (3) Stage 7 rows are NOT in the plan
  hash on purpose — a Stage 7 run between send and approve does not refuse the batch. (4) After apply, Stage 7 raises a
  GROSS_STRUCTURE_CHANGE flag per person (Q-B6, follow-up). (5) statutoryWriterGuard T10b names services/salaryChange.js.
- **Verified:** jest 123/2202 → 124/2218 (new bulkSalaryRevision.test.js 16 incl. parity vs the single path on the same DB,
  Q-B8 conflict 409 nothing written, mid-batch throw → nothing incl. audit, undo restore + blocks). `backend/scripts/
  bulk-salary-revision-check.py` (Chromium, built dist, scratch DB, real hr/finance/admin logins, fictional T9501–T9506, port 3504)
  42/42 — paste incl. a % row + a conflict row left out, ₹7,500 total, double click → 1 batch, 390 px, finance sees every
  component + approves, structures/gross/requests/audit, undo, re-send, admin self-approval 403, Stage 6+7 pays the new gross,
  undo after Stage 7 refused, drift 0, 0 page/console errors. `--base` on b0ed242 2/2. Regressions bulk-approval 36/36,
  bulk-ed 50/50, pf-ceiling-approval 38/38.
- **Not tested:** Railway; production data; Excel upload in the browser (paste path only); Safari/Firefox.

# P5-01 — PROGRESS
Branch `feat/bulk-approval-stage` · base origin/main b0ed242 · port 3501 · Builder A

## RESUME
Read PLAN.md, then this file. State line below says where we are. Rulings are binding.

## State
**Phase 3 HAND-OFF — built, verified (v2), pushed. Waiting for the planner's independent review.**

## Rulings (planner, 16 Oct 2026)
- Q-A1 Return = batch kept as history; creator re-checks and submits a NEW batch.
- Q-A2 Undo of an applied approval-kind batch = finance/admin with reason; ED stays hr/admin.
- Q-A3 Add 3 lines to statusMap.js bulk_batch (submitted/returned/rejected) — bulk_batch only.
- Q-A4 No withdraw this PR (registered).
- Q-A5 "Bulk batches (N)" tab last on Finance Verification — OK.

## Baseline → after
jest 121 suites / 2172 tests → 122 / 2188 → after review fixes 122 / 2190 (all green; bulkApproval.test.js 18). bulkExtraDuty.test.js 22/22 UNMODIFIED.

## Done
- [x] Phase 0 plan (1e8c39b)
- [x] Step 1 schema columns (bulkSchema.js, ALTER-if-missing, 9 cols + index)
- [x] Step 2 engine submit/approve/decide + kind hooks (ED defaults byte-identical)
- [x] Step 3 routes per-route gates (ED 403 bodies identical)
- [x] Step 4 test kind (BULK_TEST_KINDS=1 only) + bulkApproval.test.js 16/16; bulkExtraDuty 22/22 unmodified
- [x] Step 5 frontend (bulkApi +5, BulkApprovalQueue, FV tab ~10 lines, BulkBatchList note + canUndo, statusMap +3); vite build clean
- [x] Step 6 `backend/scripts/bulk-approval-check.py` 36/36 (twice); `--base` on b0ed242 build 3/3; ED regression `bulk-ed-check.py` 50/50
- [x] Self-review fixes (v2): (1) default `rowFromInput` (engine no longer requires the hook); (2) finance queue asks `approval=1` so
      admin's queue never lists extra-duty batches (+ test); (3) on a server refusal at Approve the confirm dialog stayed open over the
      red banner (caught by the check script) — it now closes and the banner names the rows; a network failure keeps it open.

## Independent review (SHIP WITH FIXES) — applied 16 Oct
- F1 (Medium): GET /batches with no visible kind for a read role (admin's `?approval=1` queue when no approval kind is
  registered, i.e. production before P5-04) answered 403 → Finance Verification toasted on every load. Now 200 `[]`.
  jest: admin/finance/hr with no visible kinds → 200 [] (fails on the pre-fix route); viewer still 403. With P5-04 merged,
  salary-revision is an approval kind, so the badge lists it.
- F2 (Low, recorded as intended): finance GET /batches without `kind` is 200 (was 403 on P3-01) — it lists approval kinds
  only; extra-duty batches stay hidden from finance (`?kind=extra-duty` → 403, tested).
- F3 (Low, planner ruling Q6): the creator of an approval-kind batch cannot undo it → 403 SELF_APPROVAL (admin included).
  ED undo unchanged. Test added.
- F4 (Low): approve / decide check `.changes === 1` on the status UPDATE, else 409 BULK_NOT_SUBMITTED (rolls back).
- F5 (Low): engine comment — an approval kind's inputOf and rowFromInput must mirror exactly.
- Verified: bulkApproval 16 → 18 + bulkExtraDuty 22 green; full jest 122 / 2190 (was 2188); bulk-approval-check.py 36/36.

## Next
Planner independent review. Then P5-04 when the planner says N-PF is ready.

## CLAUDE.md entry
## Last Session — 2026-10-16 (P5-01: bulk engine approval stage + finance "Bulk batches" queue)
**Branch `feat/bulk-approval-stage`, NOT merged.** Plan + log: `docs/ux-bulk/prs/P5-01/PLAN.md`, `PROGRESS.md`. MASTER_PLAN §6 P5-01,
§7.2. Rulings R3, R4, Q6 (second person always, admin too), planner Q-A1…Q-A5 (16 Oct).
- **Engine (`services/bulk/engine.js`):** kinds may set `requiresApproval: true` → `POST /api/bulk/:kind/submit` saves ONE group as ONE
  batch `status='submitted'` (same re-plan + hash + error-row refusal + 50 cap as apply), stores full `input_json` per row, applies
  NOTHING, audit `BULK_SUBMIT`, one finance notification (link `/finance-verification?tab=bulk`). `apply` on an approval kind → 409
  `BULK_NEEDS_APPROVAL`; `submit` on a direct kind → 409 `BULK_NO_APPROVAL_STAGE`. `POST /batches/:id/approve` (finance/admin) = ONE
  IMMEDIATE txn: approver = creator → 403 `SELF_APPROVAL` (trimmed, case-insensitive, admin included); rows rebuilt from `input_json`,
  re-planned, hash vs the stored plan_hash → any change 409 `BULK_PLAN_CHANGED` / `BULK_ROW_ERROR` ("Return it so they check again"),
  nothing written, batch stays submitted; else `applyRow` per row with ctx `{user: approver, requestedBy: creator}`, batch → `applied`
  (approved_by/at, applied_at), audit `BULK_APPROVE`. `/reject` (reason ≥ 5) → `rejected`; `/return` (note ≥ 5) → `returned`, kept as
  history — the creator sends a NEW batch (Q-A1). No withdraw (Q-A4). Undo unchanged; for approval kinds undo = finance/admin with reason (Q-A2).
- **Kind hooks (all optional; defaults = the ED expressions, so ED is byte-identical):** `requiresApproval`, `roles {create, approve}`
  (default hr+admin / finance+admin), `hashRow`, `inputOf`, `rowFromInput`, `displayExtra`, `moneyTotal` (→ `bulk_batches.money_total`),
  `reviewColumns` (finance row view: key/label/type text|money|date|pct), `label`, `noun`, `nothingToSave`.
- **Schema (`bulkSchema.js`, ALTER-if-missing):** bulk_batches + submitted_by/at, approved_by/at, decided_by/at, reject_reason,
  return_note, money_total; index (status, kind). schema.js untouched.
- **Routes (`routes/bulk.js`):** the global `router.use(requireHrOrAdmin)` is replaced by per-route gates; ED's 403 bodies identical.
  Lists: a role sees kinds it creates, or approval kinds it decides; `?approval=1` = approval kinds only (finance queue);
  `?status=a,b`, `?sinceDays=` filters.
- **UI:** Finance Verification → new last tab "Bulk batches (N waiting)" (finance/admin, deep link `?tab=bulk`) =
  `components/bulk/BulkApprovalQueue.jsx` on ReviewQueue: chips Waiting / Returned / Rejected / Approved (decided ones for 30 days),
  kind, sent by, when, rows, change / month ₹ (fmtINR), Open → rows with the kind's columns + messages; Approve (confirm with ₹ total) /
  Return (note) / Reject (reason); own batches disabled with "another finance user decides it"; a refusal shows a red banner naming the
  rows. `BulkBatchList` shows the return / reject note under the batch; new props `whatLabel`, `canUndo`. statusMap bulk_batch +
  submitted "Waiting for finance" / returned / rejected. Calls in `utils/bulkApi.js` (api.js untouched).
- **Test-only kind `kinds/testApproval.js`:** registered ONLY when `BULK_TEST_KINDS=1` (jest + check script); its own table
  `bulk_test_target` is created on first use — never on Railway.
- **Fragile:** (1) approve re-plans from `input_json` — an approval kind MUST store everything its `rowFromInput` needs. (2) Decision
  notifications go to `roles.create` minus admin (hr today). (3) A batch refused at approve stays `submitted` until finance returns or
  rejects it. (4) `logAudit` is inside the txn only because getDb() is the same connection (a rolled-back approve leaves no audit — tested).
- **Verified:** jest 121/2172 → 122/2188 (new `bulkApproval.test.js` 16: submit writes nothing, apply refused, self-approval 403 incl.
  admin + case/space variant, role guard per route × role, plan changed → 409 nothing written, mid-batch throw (row 37/40) → nothing
  incl. audit, reject/return reason ≥ 5, decided batch not approvable, concurrent double approve → one 200 + one 409, 51 refused, 109 →
  3 batches one group, undo finance/admin + blocked when moved on, lists/visibility/detail columns, admin queue = approval kinds only).
  bulkExtraDuty 22/22 unmodified. `backend/scripts/bulk-approval-check.py` (Chromium, built dist, scratch DB, real finance/admin/hr
  logins, server restarted for the login limiter, port 3501) 36/36 ×2; `--base` on b0ed242 3/3 (no /submit, no tab). ED regression
  `bulk-ed-check.py` 50/50.
- **Not tested:** Railway; Safari/Firefox; a real approval kind (first one is P5-04); the creator's "send a new batch" path in a browser
  (the test kind has no panel — API only).

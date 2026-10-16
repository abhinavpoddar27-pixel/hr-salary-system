# P5-01 — PROGRESS
Branch `feat/bulk-approval-stage` · base origin/main b0ed242 · port 3501 · Builder A

## RESUME
Read PLAN.md, then this file. State line below says where we are. Rulings are binding.

## State
Phase 1 BUILD in progress.

## Rulings (planner, 16 Oct 2026)
- Q-A1 Return = batch kept as history; creator re-checks and submits a NEW batch.
- Q-A2 Undo of an applied approval-kind batch = finance/admin with reason; ED stays hr/admin.
- Q-A3 Add 3 lines to statusMap.js bulk_batch (submitted/returned/rejected) — bulk_batch only.
- Q-A4 No withdraw this PR (registered).
- Q-A5 "Bulk batches (N)" tab last on Finance Verification — OK.

## Baseline
jest 121 suites / 2172 tests, all green (b0ed242).

## Done
- [x] Phase 0 plan (1e8c39b)
- [x] Step 1 schema columns (bulkSchema.js, ALTER-if-missing, 9 cols + index)
- [x] Step 2 engine submit/approve/decide + kind hooks (ED defaults byte-identical)
- [x] Step 3 routes per-route gates (ED 403 bodies identical)
- [x] Step 4 test kind (BULK_TEST_KINDS=1 only) + bulkApproval.test.js 16/16; bulkExtraDuty 22/22 unmodified
- [x] Step 5 frontend (bulkApi +5, BulkApprovalQueue, FV tab ~10 lines, BulkBatchList note + canUndo, statusMap +3); vite build clean
- [ ] Step 6 Playwright check + verify + v2

## Next
Step 6 Playwright check script backend/scripts/bulk-approval-check.py.

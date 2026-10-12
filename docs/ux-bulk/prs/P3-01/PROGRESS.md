# P3-01 PROGRESS
## RESUME
Branch feat/bulk-ed-grant (base 8abee969), worktree /home/claude/wt-p3-01, port 3401. Read PLAN.md. Phase 0 done;
BUILT, merged origin/main (up to date), pushed. Waiting for independent review; do NOT open the PR. Never commit frontend/dist; never edit CLAUDE.md; only owned files.

## Steps
- [x] Phase 0: read code + prod counts (read-only); PLAN.md written
- [x] go received 12 Oct: Q-A yes (HR_BULK_CREATE per row + summary), Q-B hr/admin only, Q-C picker 'Has left' line; result screen names saved/refused batches, refused batch re-check + save alone
- [x] jest baseline 115 suites / 2040 tests (all pass)
- [x] bulkSchema.js + schema.js one line
- [x] createGrant.js extraction + route (ED tests 55/55); parity test in bulk test file (pending)
- [x] engine.js + kinds/extraDuty.js + routes/bulk.js + server.js mount
- [x] bulkExtraDuty.test.js 20 tests (incl. parity vs verbatim 8abee969 handler; mutation of audit text makes it fail); ED suites 55 unchanged
- [x] frontend: bulkApi, ExtraDutyBulkGrant, CopyFromDate, BulkBatchList, page (F-11, btn-warning) — builds clean
- [x] bulk-ed-check.py 45/45 (drift unchanged); --base on 8abee969 build 2/2; regression ed-finance-review-ux 25/25, ed-return-browser 16/16, ui-components 64/64
- [x] self-debug + user sim + v2 (draft cleared after a full save; copy-from-date waits for the employee list; draft-restore check) — check 48/48
- [x] merge origin/main (already up to date at 8abee969); full jest 115/2040 → 116/2060 all pass
- [ ] independent review (planner)

## Rulings
R1–R6, Q1 (offer HR approve, ticked), Q2 (auto-split) — final (owner).

## CLAUDE.md entry
## Last Session — 2026-10-12 (P3-01: bulk engine + Extra Duty bulk grant + HR queue pending-only)
**Branch `feat/bulk-ed-grant`, NOT merged. MONEY-ADJACENT — independent review before PR.** Plan + log:
`docs/ux-bulk/prs/P3-01/PLAN.md`, `PROGRESS.md`. Findings B0b, B1, F-11. Owner rulings R1–R6, Q1 (offer "Also approve as
HR", ticked), Q2 (auto-split ≤ 50); planner Q-A (one HR_BULK_CREATE audit per bulk grant), Q-B (hr/admin only), Q-C
(pasted Left codes stay in PeoplePicker's "Has left" line).
- **Engine (generic):** `database/bulkSchema.js` (`bulk_batches`, `bulk_rows`; schema.js = one line), `services/bulk/engine.js`
  (preview → groups of ≤ 50 each with a plan hash; apply = ONE group = ONE batch in ONE IMMEDIATE txn: re-plan, refuse on
  hash change `BULK_PLAN_CHANGED` / error row `BULK_ROW_ERROR` / > 50 `BULK_ROW_LIMIT`, all-or-nothing; skipped rows stored
  not applied; summary audit `BULK_CREATE`; undo whole batch or nothing → `BULK_UNDO_BLOCKED` with rows, audit `BULK_UNDO`),
  `routes/bulk.js` at `/api/bulk` (preview, apply, batches, batch, undo, extra-duty/people?date, extra-duty/employees).
- **ED kind** (`services/bulk/kinds/extraDuty.js`): month from the date, company from the master ('null'/blank → '' + note),
  errors: not found / not active / month finalised (month-wide, like /finalise) / bad duty; skipped: existing grant; update:
  untouched BIOMETRIC_AUTO (replaced in place, link kept, HR_UPGRADE_AUTO audit). Writes via `services/extraDuty/createGrant.js
  writeGrant()` — extracted from POST /extra-duty-grants (route output byte-identical; parity test vs the verbatim 8abee969
  handler). "Also approve as HR" = same write as HR approve, by the saving user, audit HR_BULK_CREATE_APPROVE. Undo allowed only
  while finance_status UNREVIEWED, not processed, month open, and status/approval/fields equal what the batch wrote; restores a
  replaced system entry byte-identical.
- **UI:** ED page "+ Bulk Grant" → inline panel `components/bulk/ExtraDutyBulkGrant.jsx` (set once · PeoplePicker paste/tick +
  `CopyFromDate` · check table with chips, per-row days, remove, "Leave out N rows with problems" · save bar "Save 109 grants
  (3 batches: 50 + 50 + 9)"); result screen names saved and refused batches, Undo per batch, "Check these N again" re-checks a
  refused batch and saves it alone. Draft kept with useDraft; common values remembered (localStorage `ed_bulk_defaults_v1`).
  `BulkBatchList` (recent batches, View rows, Undo with reason). **F-11:** HR Queue tab = PENDING only + ReviewQueue bar "HR
  Approve (N)" (existing `/bulk-approve`). Flag-for-Review submit now `<Button variant="warning">`. Helpers in `utils/bulkApi.js`.
- **Fragile:** (1) The panel is inline, NOT a Modal — useConfirm dialogs (save confirm, undo prompt) must not open inside a Modal.
  (2) Plan hash = code, duty, state, action + fingerprint of employee and existing grant; a change to planRow's fingerprint makes
  every open preview stale (harmless: "check again"). (3) Kind interface: normaliseCommon/Rows/Options, periodOf, describe,
  context, planRow, applyRow, undoable, undoRow — later kinds plug in via engine KINDS. (4) logAudit is inside the batch txn
  only because getDb() is the same connection (a rolled-back batch leaves no audit rows — tested). (5) Cross-batch saves are
  NOT atomic by ruling Q2. (6) useConfirm dialogs ignore clicks in their first 300 ms — scripts must wait.
- **Verified:** jest 115/2040 → 116/2060 (new bulkExtraDuty.test.js 20: parse/merge, unknown/Left/finalised/bad duty,
  skipped, BIOMETRIC_AUTO upgrade + undo byte-identical, 51 refused, 109 → 50/50/9 three batches one group, hash mismatch +
  duty change refused, error row refused, mid-batch throw → nothing incl. audit, HR-approve on/off, undo refused after finance
  review / HR edit / HR approve / processed / finalised, reason required, roles viewer+finance 403 / no token 401, reads, parity;
  a changed audit text makes parity fail). ED suites 55/55 unchanged. `backend/scripts/bulk-ed-check.py` (Chromium, built
  dist, scratch DB, hr + finance, fictional T5xxx, port 3401) 48/48 — paste 60 (1 left in "Has left", 1 repeat, 1 already
  granted, 1 system entry, 1 at 0.5) → 58 rows → "Save 57 grants (2 batches: 50 + 7)" → DB + finance queue 57 → draft survives
  reload → undo batch 2 → undo refused after finance review → copy-from-date 40 + paste 20, data changed → "1 of 2 batches
  saved · 1 refused" → re-check → saved alone → single New Grant works → HR Queue pending only + bulk approve → 390 px → drift
  unchanged, 0 page errors, only the two intended 409s. `--base` on 8abee969 2/2 (no Bulk button; HR Queue shows non-pending).
  Regression: ed-finance-review-ux 25/25, ed-return-browser 16/16, ui-components 64/64.
- **Not tested:** Railway; production data; Safari/Firefox; two people saving the same date at once from two machines (server
  hash + IMMEDIATE txn is the guard, jest covers the changed-data path).
- **Found, not fixed:** single "+ New Grant" still takes company from the top-bar filter and does not check active/finalised
  (unchanged by design); ED page header row does not wrap at 390 px (pre-existing).

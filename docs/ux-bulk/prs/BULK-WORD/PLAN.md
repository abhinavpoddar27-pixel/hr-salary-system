# BULK-WORD — Recent bulk batches list: wording and actions per kind (PLAN, Phase 0)

Branch `fix/bulk-batch-list-wording` off main `b2badcab`. Check-script port 3502.

## 1. What the list is today
`frontend/src/components/bulk/BulkBatchList.jsx` (P3-01, #155; P5-01 additions) is used in two places:
- `pages/ExtraDutyGrants.jsx:272` — `<BulkBatchList kind="extra-duty" month year onChanged>` (HR/admin).
- `pages/SalaryInput.jsx:174` — `<BulkBatchList kind="salary-revision" whatLabel="Revision" canUndo={canFinance} />`,
  shown only inside the "+ Bulk revision" panel, which only `canHR` can open. **No month/year passed.**

`undoBatchWithReason` (same file) is also called by `ExtraDutyBulkGrant.jsx:176` (ED result screen) — it passes
no `requiresApproval`, so it takes the ED wording.

## 2. What the server returns (no change needed)
`GET /api/bulk/batches` and `/batches/:id` → `engine.shapeBatch()` (services/bulk/engine.js ~L395): per batch
`kind`, `status`, `requiresApproval`, `kindLabel` ('salary revision' / 'extra-duty' — ED has no `label`),
`summary` (= kind `describe`), `applyCount`, `skippedCount`, `createdBy/At`, `submittedBy/At`, `approvedBy/At`,
`decidedBy/At`, `rejectReason`, `returnNote`, `undoneBy/At/Reason`, `moneyTotal`. `/batches/:id` adds `rows`
(`code, state, action, messages, undone` + the kind's display: salary revision has `name, effectiveFrom, oldGross,
newGross, delta, pct, old_*/new_*`) and `columns` (salary revision `reviewColumns`).
Statuses actually written: ED `applied` → `undone`; salary revision `submitted` → `applied` (approve applies at once)
| `returned` | `rejected`; `applied` → `undone`. `approved` is in `BATCH_STATUSES` but never written.
The kind's `noun` ('revisions') is NOT in the batch row — the frontend will keep its own small per-kind word map
(keyed on `b.kind`, fallback on `requiresApproval`), so no server change is needed.

## 3. Problems found (salary-revision batches; ED stays byte-identical)
| # | Where | Today | Problem |
|---|---|---|---|
| W1 | header "Saved" | created time | a submitted revision batch is *sent*, not saved |
| W2 | header "Saved rows" | applyCount | for a submitted/returned/rejected batch nothing is saved; count = revisions in the batch |
| W3 | row view action text | `update` → "replaced system entry", else "created" | ED words. Revision `update` = same-date structure updated, `create` = new structure row; and while submitted / returned / rejected **nothing was applied** — the text says "created" |
| W4 | row view | name only | revision rows carry old → new gross; not shown (the reason a reviewer opens rows) |
| W5 | status badge `applied` | "Applied" | for an approval kind it means finance approved and it was applied; no approver shown |
| W6 | status `approved` | not in statusMap | would show raw "approved" (never written today — defensive) |
| W7 | Undo prompt | "Reverses the N row(s) this approved batch applied. Refused if anything has moved on since." | generic; should say salary changes go back to the old gross/structure and when it is refused (later change, payroll finalised, Stage 7 computed with the new pay) |
| W8 | Undo toast | "N row(s) reversed" | → "N salary change(s) reversed" |
| W9 | empty text | "No bulk batches for this month yet" | SalaryInput passes no month → the list is all recent batches; wording is wrong |
| W10 | submitted batch | no line | nothing says it is waiting; a note "Sent by X on …, waiting for finance" helps (badge already says "Waiting for finance") |
| W11 | Undo visibility | `canUndo={canFinance}` but the panel opens only for `canHR` | **finance never sees this list**; only admin can undo a revision batch from the app (prod: 1 admin, 1 finance, 4 hr). SalaryInput.jsx is not owned → Q3 |

ED path: ED batches render exactly as today (same headers, words, prompt, toasts).

## 4. Smallest change (frontend only)
- `BulkBatchList.jsx`: a local `WORDS` map per kind — `{ when: 'Saved'|'Sent', rows: 'Saved rows'|'Revisions',
  noun: 'grant(s)'|'salary change(s)', empty, rowText(r, b), undoMessage(b), undoToast(n) }`; ED entry = today's
  exact strings; salary-revision entry; any other approval kind falls back to a generic approval entry
  (`requiresApproval`). `undoBatchWithReason(batch)` picks words via the same helper (ED result-screen call
  unchanged → ED words).
- Row view (revision): `CODE Name · ₹old → ₹new from DD-MM-YYYY · <state word>` where state word =
  `left as is` (skipped) / `waiting for finance` (submitted) / `not applied` (returned, rejected) /
  `applied` / `undone`. Money via `fmtINR`, date via `fmtDate`.
- Status `applied` on an approval kind: badge stays from statusMap; add a title "Approved by X on …" (and keep the
  undo title). Optional label override — see Q1.
- Submitted batch: one grey note line "Sent by X on … — waiting for finance to decide" (Q2).
- `statusMap.js` `bulk_batch`: add `approved: { label: 'Approved', tone: 'green' }` only. (BulkApprovalQueue also
  reads this domain — no existing label changes.)
- No `bulkApi.js` change needed.

## 5. NOT touched
Backend (engine, routes, kinds), BulkApprovalQueue.jsx, SalaryRevisionBulk.jsx, ExtraDutyBulkGrant.jsx,
ExtraDutyGrants.jsx, SalaryInput.jsx (unless Q3 says yes), every DO-NOT-MODIFY file. No money logic.

## 6. Tests / verification
- `backend/scripts/bulk-word-check.py` (Chromium, built dist, scratch DB, `BULK_TEST_KINDS` not needed, port 3502):
  seed fictional employees (T95xx); hr saves an ED bulk grant → ED list text identical to today (headers, "created",
  undo prompt text); hr sends a salary-revision batch → list shows "Sent", "Revisions", "waiting for finance",
  row view old → new gross; finance approves (API) → admin sees "Approved by", row text "applied", Undo prompt with
  the revision wording, undo → toast "salary change(s) reversed", status Undone; a returned and a rejected batch show
  "not applied" + the note; empty list text; 390 px; 0 page errors / console errors / API ≥ 400.
- `--base` on origin/main: revision rows say "created", headers "Saved rows", generic undo text → check fails.
- jest: no backend change; run the full suite once for the record. Frontend build under `flock /tmp/vite.lock`.

## 7. Risks
- The per-kind map duplicates the server's `noun` by hand; a new kind falls back to generic approval words.
- Row-view gross numbers come from `resolved_json` written at submit and re-written at approve — for an undone batch
  they show what was applied (correct), for a returned one what was sent.

## 8. Questions
- **Q1** On a salary-revision batch, should the `applied` badge read **"Approved"** (component override, ED keeps
  "Applied", queue unchanged) — or keep "Applied" everywhere and only add the "Approved by X" tooltip?
- **Q2** Add the one-line "Sent by X on … — waiting for finance" note under submitted batches, or is the badge enough?
- **Q3** (W11) Finance cannot reach this list on Salary Input (panel is HR-only), so only admin can undo a revision
  batch. Fix in this PR by letting SalaryInput render `<BulkBatchList kind="salary-revision">` for finance outside the
  panel (adds SalaryInput.jsx to owned files, 1–3 lines) — or register it as a follow-up / leave by design?
- **Q4** Row view for revisions: show old → new gross + effective date (plan) — OK to show ₹ in this HR/finance/admin
  list?
- **Q5** Remove the dead statusMap entries `draft`, `previewed`, `pending_approval`, `partially_applied`, `failed`
  (never written), or leave them (plan: leave; only add `approved`)?

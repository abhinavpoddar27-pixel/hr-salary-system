# BULK-WORD — PROGRESS

## State
Phase 3 (hand-off) done. Branch `fix/bulk-batch-list-wording`, frontend only. NOT merged. No PR is opened from this session.

## Rulings (planner, 22 Oct 2026)
- Q1: yes. On a salary-revision batch the `applied` badge reads "Approved", with an "Approved by X on …" tooltip.
  This is done in the component only; ED and the approval queue are unchanged.
- Q2: yes. One line under a submitted batch: "Sent by X on … — waiting for finance to decide".
- Q3: yes. Finance and admin see the batch list on Salary Input outside the HR panel. SalaryInput.jsx is added to the
  owned files.
- Q4: yes. The row view shows ₹ old → new via fmtINR, plus the effective date via fmtDate.
- Q5: dead statusMap entries are left as they are; only `approved` was added.

## Done
- Phase 0: PLAN.md (commit 4c3c852c).
- `BulkBatchList.jsx`: added a `KIND_WORDS` map (extra-duty = the exact P3-01 strings, salary-revision, plus a
  generic approval fallback) and an exported `batchWords(batch)`. The per-kind words cover the headers (Sent / Revisions),
  empty text, row text (waiting for finance / not applied / applied / undone / left as is), revision ₹ old → new from date,
  undo prompt and toast. Added a `BatchStatus` pill (Approved label + tooltip) and the waiting line.
  `undoBatchWithReason` uses batchWords; the ED result-screen call passes no kind, so it gets the ED words.
- `statusMap.js` bulk_batch: `approved: Approved / green` (defensive; the server never writes it today).
- `SalaryInput.jsx`: `<BulkBatchList kind="salary-revision">` renders when `showBulk || canFinance`. HR still sees it
  only in the panel; finance and admin see it always (one list, never two).
- New `backend/scripts/bulk-word-check.py` (port 3502).

## Verified
- `bulk-word-check.py` 40/40. `--base` on a b2badcab build 8/8 (finance sees no list, "Saved rows", "created",
  no ₹), so the fix checks would fail on main.
- Regression: bulk-ed-check 50/50, bulk-salary-revision-check 44/44, bulk-approval-check 36/36.
- jest 130 suites / 2309 (no backend change). Frontend build clean.

## RESUME
Worktree /home/claude/wt-batchword. Everything is built and verified; only the planner's merge is left.
Never `git add -A`. Port 3502.

## CLAUDE.md entry
## Last Session — 2026-10-22 (BULK-WORD: recent bulk batches list words per kind; finance sees revision batches)
**Branch `fix/bulk-batch-list-wording`, NOT merged.** Frontend only. Plan + log: `docs/ux-bulk/prs/BULK-WORD/PLAN.md`,
`PROGRESS.md`. Rulings Q1–Q5 (22 Oct).
- **Bug:** BulkBatchList (P3-01) used Extra Duty words for salary-revision batches (P5-04). The row view said
  "created" while a batch was still waiting, returned or rejected, and showed no gross. Headers read "Saved" /
  "Saved rows", the undo prompt and toast were generic, and the empty text said "for this month" on a list with no
  month. The list sat inside HR's panel, but only finance could undo (`canUndo={canFinance}`), so in practice only
  admin could undo a revision batch.
- **Fix:** `KIND_WORDS` + `batchWords(batch)` in BulkBatchList.jsx (ED strings byte-identical; unknown approval kinds use
  the old generic wording). Salary revision: Sent / Revisions; row "₹old → ₹new from DD-Mon-YYYY · waiting for finance |
  not applied | applied | undone"; "Approved" pill (status applied) + "Approved by X on …" tooltip; "Sent by X on … —
  waiting for finance to decide" line; undo prompt names the old gross/structure and the refusal reasons (later change,
  finalised month, Stage 7 with the new pay); toast "N salary change(s) reversed". statusMap bulk_batch + `approved`.
  SalaryInput: list shown for finance/admin outside the panel (`showBulk || canFinance`).
- **Fragile:** the per-kind words duplicate the server kind's `noun`/`label` by hand. A new bulk kind falls back to ED
  words (direct) or the generic approval words, so add it to `KIND_WORDS`. The revision row state comes from the BATCH
  status, not the row. The "Approved" label is a component override: the approval queue still shows "Applied".
- **Verified:** `backend/scripts/bulk-word-check.py` 40/40 (Chromium, built dist, scratch DB, hr + finance, fictional
  T9501–T9506, port 3502). It covers finance's list without the panel, empty text, headers, the waiting line,
  ₹ rows, returned/rejected "not applied", Approved + tooltip, undo prompt/toast + gross restored, 390 px, hr with no
  list until the panel opens and no Undo, the ED list's wording unchanged, 0 page/console errors, 0 API ≥ 400, drift 0.
  `--base` on b2badcab 8/8. bulk-ed 50/50, bulk-salary-revision 44/44, bulk-approval 36/36; jest 130/2309.
- **Not tested:** Railway; Safari/Firefox; admin in the browser (same gate as finance, and admin can open both the panel
  and the list, which renders once).

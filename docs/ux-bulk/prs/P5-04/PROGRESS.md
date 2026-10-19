# P5-04 — PROGRESS (MONEY PR)
Branch `feat/bulk-salary-revision` (on feat/bulk-approval-stage 70d98cb + origin/fix/pf-ceiling-approval c6c2fec) · port 3504 · Builder A2

## RESUME
Read PLAN.md (FINAL DESIGN at the bottom), then this file, then `git log --oneline 70d98cb..HEAD`. Rulings below are binding.

## State
**Phase 3 HAND-OFF — Q-EM rule change built, verified, pushed (17 Oct). main 892f7f7 merged in. MONEY PR: planner review.**

## Rulings (planner, 16 Oct 2026)
- Q-B1 Salary Input header button → inline panel SalaryRevisionBulk.jsx (not a Modal) + BulkBatchList.
- Q-B2 % mode rounds new gross to ₹1 (`REVISION_GROSS_ROUND`).
- ~~Q-B3 default = 1st of next IST month~~ — SUPERSEDED by H1 (below).
- Q-B4 conveyance kept exactly as the single approve path (N-17 `resolveApproval`).
- Q-B5 past dates allowed with a "re-run Stage 7" note; a finalised month on/after the date → error row.
- Q-B6 Stage 7 GROSS_STRUCTURE_CHANGE flags after apply left as is (follow-up below).
- Q-B7 split helpers → services/salarySplit.js; approve body → services/salaryChange.js `approveSalaryChange()`; thin route.
- Q-B8 pending single-path request → error row at preview/submit; at approve the re-plan refuses (batch stays submitted).
- **H1 (planner ruling after independent review, supersedes Q-B3):** Stage 7 pays employees.gross_salary for every month it
  computes, whatever the structure's date. (a) Error row "Effective month must be the first open payroll month (<Mon YYYY>) —
  the app cannot hold a salary change for a later month" when the effective month is later than the first unfinalised month
  with data (monthly_imports row or salary_computations rows); re-checked at approve by the re-plan. (b) Default effective date
  = 1st of that month (fallback 1st of the current IST month), served by `GET /api/bulk/salary-revision/defaults` (hr/admin).
  (c) Undo fingerprint = this person's Stage 7 rows in EVERY unfinalised month. (d) Not-the-1st warning says pay follows the
  gross for every month computed after approval; the "re-run Stage 7 for <Mon>" note stays.
- **L3:** a comma-only pasted line "T9501,22,000" = code + one amount (first comma splits, the rest's commas stripped).
- **Q-EM (owner, 17 Oct 2026, narrows H1):** a month is open ONLY with Stage 7 rows (salary_computations) and not finalised
  (monthly_imports.is_finalised=1 for that year/month). Import-only months are ignored. None open → 1st of current IST month.
  Same definition as the H1c undo fingerprint (`stage7Rows`, unchanged). Owner will finalise Feb–Sep 2026 in the app.
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

## P5-01 review fixes merged (16 Oct)
origin/feat/bulk-approval-stage f684bac (F1–F5) merged in (no rebase). F3: the batch creator cannot undo their own
salary-revision batch (403 SELF_APPROVAL) — the tests and the check script already undo as a second person. F1: with
salary-revision registered, the finance/admin queue lists it. After merge: bulkSalaryRevision + bulkApproval +
bulkExtraDuty 56/56; full jest 124 / 2220 green; bulk-salary-revision-check.py 42/42.

## Review fixes H1 + L3 (16 Oct)
- kind: `firstOpenMonth(db)`, `defaultEffectiveFrom(db)`, ctx.firstOpen check in planRow, `stage7Rows` over every unfinalised
  month (undo), `stage7RowsFrom` for the re-run note; reworded not-the-1st warning. Engine `prepare` passes the db to
  `normaliseCommon(common, db)` (other kinds ignore the 2nd arg). Route `GET /bulk/salary-revision/defaults` (hr/admin).
- UI: date filled from /defaults (a restored draft keeps its own), line "First open payroll month: <Mon-YYYY> — the date
  can't be later", reworded not-the-1st warning. Parser moved to `frontend/src/utils/revisionParse.js` (pure) with
  `backend/scripts/salary-revision-parse-check.mjs` 11/11 (L3 cases incl. lakh commas).
- jest bulkSalaryRevision 16 → 23 (H1 a: later month refused, Stage-7-only month counts, finalised months don't, re-checked at
  approve → 409 naming only the late row; b: defaults endpoint + preview default + finance 403; c: undo blocked by an October
  re-run and by a row added in an earlier month; d: wording). Named suites + bulk suites 172/172. Full jest 124 / 2227.
  bulk-salary-revision-check.py 44/44 (new: default = first open month Nov 2026, December date refused, comma-only paste).

## Production fact (counts only, read-only, 16 Oct — superseded by Q-EM: now Feb 2026)
monthly_imports has NO finalised month since Jan 2026: Feb–Oct 2026 are all unfinalised with Stage 7 rows (also Apr–May and
Jul–Dec 2025 unfinalised, import rows only, no Stage 7 rows). So on production today the first open payroll month is
**Apr 2025**: the default date would be 01-04-2025 and any later date is refused. Until earlier months are finalised (or the
rule is scoped, e.g. to months with Stage 7 rows / the last N months), HR cannot use the bulk revision for a current date.
Planner / owner decision — not changed here.

## Q-EM (17 Oct)
1. `git merge origin/main` (892f7f7, 22 behind) — clean, no conflicts; pushed 9734d06.
2. `firstOpenMonth(db)` = earliest (year, month) in salary_computations with no finalised monthly_imports row; the
   monthly_imports-only UNION branch removed. Doc comments updated; no copy mentioned imports.
3. Tests: existing H1 tests now seed a Stage 7 row where they relied on an import-only month; new Q-EM (a) import-only
   2025 months ignored, (b) Feb–Sep finalised + Oct Stage 7 → Oct 2026, 1 Nov refused / 1 Oct allowed, (c) nothing open →
   current IST month. bulkSalaryRevision 23 → 26. Named suites + statutoryWriterGuard + bulkApproval + bulkExtraDuty 10
   suites / 226 green. Full jest 126 suites / 2256 green.
4. Check script scratch data: Apr 2025 import-only (ignored), Oct 2026 finalised with a Stage 7 row, Nov 2026 Stage 7 row
   (zero-money placeholder T9599) → first open Nov 2026. bulk-salary-revision-check 44/44, salary-revision-parse-check 11/11,
   bulk-approval-check 36/36, bulk-ed-check 50/50, drift (Nov 2026) 0 of 7 rows.
5. Production read-only: new SQL returns **Feb 2026** (Feb–Oct 2026 each have Stage 7 rows, none finalised).

## Next
Planner review of Q-EM. Owner finalises Feb–Sep 2026 → first open month becomes Oct 2026. Then PR.

## Found / follow-up (not fixed)
- Q-B6: after a bulk revision, Stage 7 raises a GROSS_STRUCTURE_CHANGE manual flag per person — finance approves twice (R8).
- BulkBatchList "View rows" uses extra-duty wording ("created / replaced system entry") for every kind (P5-01's file).
- `raiseRequest` in employees.js still builds new_structure inline; `buildRevisionStructure` is the same object (parity test
  pins it). Switch raiseRequest to it on the next edit of that range.
- Plant compute reads gross from employees.gross_salary for every month (pre-existing): approving a revision then
  re-running an EARLIER month's Stage 7 pays that month at the new gross. Same as the single path.

## CLAUDE.md entry
## Last Session — 2026-10-17 (P5-04: bulk salary revision — first approval kind on the bulk engine)
**Branch `feat/bulk-salary-revision` (on feat/bulk-approval-stage + fix/pf-ceiling-approval), NOT merged. MONEY PR —
independent review before PR.** Plan + log: `docs/ux-bulk/prs/P5-04/PLAN.md`, `PROGRESS.md`. MASTER_PLAN §6 P5-04, §7.4 B3.
Rulings Q-B1…Q-B8 (16 Oct), Q6, R3, R5, R8.
- **Moves (no behaviour change):** split helpers `employees.js` → `services/salarySplit.js` (+ `buildRevisionStructure` = the
  object Employee Master's `raiseRequest` builds); approve helpers + body `salary-input.js` → `services/salaryChange.js`
  `approveSalaryChange(db, {id, actor, approvedBy, effectiveFrom})` → `{ok, effectiveFrom, gross, keptComponents, sameDate}` or
  `{ok:false, status, body}`; PUT /salary-input/approve/:id is a thin call with the same replies (N-17, N-MONEY2 percents,
  N-PF ceiling, R10 flags, STRUCTURE_DATED_LATER, SELF_APPROVAL unchanged).
- **Kind `salary-revision`** (`services/bulk/kinds/salaryRevision.js`, requiresApproval; hr/admin send, finance/admin decide):
  rows code + new gross OR % (rounded to ₹1) + optional own date; common effective date (H1 + Q-EM: default 1st of the first
  open payroll month = earliest month with Stage 7 rows that is not finalised — import-only months ignored; none → 1st of IST month, from `GET /api/bulk/salary-revision/defaults`;
  a later month is an error row, because Stage 7 pays the master gross for every month it computes).
  Errors: not found / not active / both-or-neither / gross ≤ 0 / % outside −50…+100 / bad date / a finalised month on or after
  the date / later-dated structure / a Pending salary_change_request (Q-B8). Skipped: same gross. Warnings: no structure (50/20
  default), > 25 %, not the 1st, conveyance kept. Note (not a state): "Stage 7 already computed — re-run". Submit writes no
  salary table. Approve (engine IMMEDIATE txn): per row INSERT a Pending request (requested_by = batch creator, reason "Salary
  revision — bulk batch #N") → `approveSalaryChange` (approved_by = finance) → 3 audit rows stage `SALARY_REVISION_BULK`
  (request status, employees.gross_salary, salary_structures) — this path only. money_total = Σ Δ monthly gross.
  Undo (finance/admin other than the batch creator, reason): blocked if request not Approved / a later request / gross or
  structure row changed / a later-dated structure / a finalised month ≥ effective / this person's Stage 7 rows in ANY
  unfinalised month differ from the approve-time fingerprint; restores the structure (delete, or same-date row every column) + employees.gross_salary/updated_at, request → 'Reverted'.
- **UI:** Salary Input header "+ Bulk revision" (hr/admin) → inline `components/bulk/SalaryRevisionBulk.jsx` (paste or Excel,
  gross / % mode, check table with Basic/DA/HRA/Conv./Special/Other old → new, Δ/month, ₹ total, "Send N to finance (batches)")
  + `BulkBatchList kind="salary-revision"` (undo finance/admin). Finance decides in Finance Verification → Bulk batches
  (reviewColumns show every component).
- **Fragile:** (1) the kind echoes each row's input in its preview `input` — the panel sends exactly that; keep `displayExtra`.
  (2) `buildRevisionStructure` must stay equal to `raiseRequest`'s object (parity test). (3) Stage 7 rows are NOT in the plan
  hash on purpose — a Stage 7 run between send and approve does not refuse the batch. (4) After apply, Stage 7 raises a
  GROSS_STRUCTURE_CHANGE flag per person (Q-B6, follow-up). (5) statutoryWriterGuard T10b names services/salaryChange.js.
- **Verified:** jest 123/2202 → 126/2256 (after P5-01 review fixes + H1/L3 + Q-EM + main 892f7f7; new bulkSalaryRevision.test.js 26 incl. parity vs the single path on the same DB,
  Q-B8 conflict 409 nothing written, mid-batch throw → nothing incl. audit, undo restore + blocks). `backend/scripts/
  bulk-salary-revision-check.py` 44/44 (Chromium, built dist, scratch DB, real hr/finance/admin logins, fictional T9501–T9506, port 3504)
  44/44 — default = first open month, a later date refused, paste incl. a % row + a conflict row left out, ₹7,500 total, double click → 1 batch, 390 px, finance sees every
  component + approves, structures/gross/requests/audit, undo, re-send, admin self-approval 403, Stage 6+7 pays the new gross,
  undo after Stage 7 refused, drift 0, 0 page/console errors. `--base` on b0ed242 2/2. Regressions bulk-approval 36/36,
  bulk-ed 50/50, pf-ceiling-approval 38/38.
- **Production (Q-EM, 17 Oct):** first open payroll month is Feb 2026 today (Feb–Oct 2026 have Stage 7 rows, none finalised);
  owner will finalise Feb–Sep in the app → Oct 2026. Until then any date after Feb 2026 is refused.
- **Not tested:** Railway; production data; Excel upload in the browser (paste path only); Safari/Firefox.

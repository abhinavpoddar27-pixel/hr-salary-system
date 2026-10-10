# STATUTORY FLAGS + LWF — PROGRESS

## RESUME BLOCK (read this first after any compaction or new session)
1. Read this file top to bottom, then `docs/statutory-flags/BUILD_PLAN.md` §1 (rulings) and §3 (landmines).
2. Current PR = the first row below that is not DONE. Its implementation plan is
   `docs/statutory-flags/IMPL_PR<N>.md` (written by the planning session).
3. `git status` + `git log --oneline -5` on the PR branch; compare with LAST STEP below.
4. Continue from NEXT STEP. Update this file after every small step (state, done, next) and commit it.

## PR STATUS
- PR-1 feat/statutory-flags — BUILT LOCALLY — awaiting push (repo public). Independent review of a4eb3d1 (SHIP WITH FIXES) addressed: fixes 1–4 committed. Reviewer re-check: SHIP; FIX 5 added. Code head cec4fe0 (+ this commit on top), base d1ad7bf (origin/main unchanged), 49 suites / 890 tests green, sim 68/68.
- PR-2 feat/lwf-deduction — NOT STARTED
- PR-3 feat/statutory-filing — NOT STARTED

## STEPS DONE
- Phase 0 — dd1d849 (rebased on d1ad7bf; baseline 42/769 green)
- STEP 1 — eca75e2
- STEP 2 — 1aef14d
- STEP 3 — d7ce444 `feat(statutory): flag file parser and planner`. statutoryFlagsService.test.js 20 tests (parse ×6, lookups ×3, plan ×11 incl. T7, T15, T17-plan, malformed date). Parser uses SheetJS raw:true (formatted text turned a 12-digit UAN into '1.00012E+11' — caught while writing the parser).
- STEP 4 — 867c515 `feat(statutory): apply with freeze/effective rows and undo file`. applyFlagChanges (immediate txn; batch row first; re-plan inside; freeze S copy of latest w/ its own flags; E rows updated in place or copy of forE; later rows updated; master flags + numbers; audit on the passed handle with stage statutory_upload remark batch:<id>), buildUndoWorkbook, listBatches, sha256. 19 new tests: T1, T2, T3 (×2: only 2026-08-24 / only 2026-09-06 — real Stage 7, August byte-identical), T4, T5 (+numbers), T6 (×3), T10a (+missing batch), T14 (×2), T16, T17, row-error isolation, master-only diff, audit rows. Decision D-1 below.
- STEP 5 — 2207bf4 `feat(statutory): /api/statutory-flags preview/apply/batches`. Router-level requireAdmin; multer memoryStorage 2 MB, .xlsx/.xls/.csv; preview returns plan + sha256 + canApply; apply requires expectedSha256 (409 HASH_MISMATCH / DUPLICATE_BATCH, 400 BLOCKED); GET /batches and undo-file send Cache-Control no-store (N7). server.js: one mount line after contractor-report (line 232). statutoryFlagsApi.test.js 12 tests via jwtApiHarness (real requireAuth + JWTs): 401 ×4, hr/finance/viewer 403 ×4 each with counts unchanged, admin preview/apply/dup/batches/undo, .txt 400, >2 MB 400, bad scope/month/column 400, BLOCKED 400. server.js boots on a temp DATA_DIR with the mount present.
- STEP 6 — 4a4c71b `fix(statutory): employee master writers preserve flags (R10)`. employees.js: sync helper no longer reads/writes pf/esi (pt + gross only); its create path takes flags from carryFlags and lists lwf; POST / structure insert explicit 0,0,0; PUT /:code drops pf/esi from allowedFields, sync gets gross+pt only, basic/da insert uses carryFlags; PUT /:code/salary master UPDATE + same-gross UPDATE stop writing pf/esi, newStructure JSON drops pf/esi, INSERT (was DEFAULT 1) uses carryFlags + lwf; bulk-import requireAdmin, ON CONFLICT no longer sets pf/esi, insertSalary 0,0,0 + lwf, drift-repair sync gross+pt only, file pf/esi ignored; integrity-check/fix requireAdmin, fix syncs gross(+pt) only, flag-only mismatch → 'skipped' + flagMismatch:true. Every response that saw pf/esi/lwf in the body returns ignoredFields. statutoryWriters.test.js 17 tests (T9a ×9, C4 ×2, T8b ×2 on withLiveDefaults, guards ×3 roles + 1): 14 of 17 FAIL on the pre-STEP-6 employees.js (verified by swapping the file).
- STEP 7 — f1450bf `fix(statutory): salary approval carries in-force flags; auto-create lists lwf`. salary-input.js: approve validates effectiveFrom ^\d{4}-\d{2}-\d{2}$ (else 400); INSERT carries pf/esi/lwf/pt + basic/da/hra_percent + pf_wage_ceiling from structureForDate(effectiveFrom) read inside the txn (JSON flags ignored); master UPDATE writes gross only; request-change strips pf/esi/lwf from newStructure and returns ignoredFields. salaryComputation.js 303–307 only (auto-create lists lwf_applicable from employee.lwf_applicable). UPSERT counts BEFORE and AFTER: plant 56 cols / 56 placeholders / 56 params / 53 SET; sales 45/45/45/42 (unchanged). Tests: T9b ×3, T11b (May 15 back-dated approval; June–Aug unchanged, Sep ON; 2026-5-15 and 15/05/2026 → 400), auto-create ×2, T12 statutoryLoans.test.js (PR-6 shape: Aug posted at the real loan close → August re-run byte-identical, ledger untouched, 0 loan_adjustments; Sep PF+ESI on, loan capped by the headroom, identity holds, reconcile ok). 5 of 7 new tests FAIL on the pre-STEP-7 files (swap-verified).
- STEP 8 — 7604d0c `fix(statutory): sales structure writers carry in-force flags`. sales.js: UPDATABLE_FIELDS gains lwf_applicable (create path only); PUT /employees/:code skips pf/esi/lwf and returns ignoredFields; versionSalesStructureForGross takes pf/esi/lwf from carryFlags('sales', id, F) read before any write (components/pt/ceiling/notes still from the current row), lwf added to INSERT + ON CONFLICT SET; POST /employees create adds lwf to structure INSERT/SET (master via UPDATABLE_FIELDS); POST /employees/:code/structures validates ^\d{4}-(0[1-9]|1[0-2])$, ignores body flags, lists pf/esi/lwf from carryFlags(effective_from), returns ignoredFields. schema.js sales backfill INSERT lists lwf_applicable = 0 (inert in production: migration already ran). Tests: T9c ×4, T11 (back-dated 2026-05 gross edit after upload: May–Aug PF/ESI unchanged, gross arrears still apply, Sep ON), T18 ×3 (C3). 7 of 8 new tests FAIL on the pre-STEP-8 sales.js.
- STEP 9 — 0d90f34 `test(statutory): structure-insert guard`. statutoryWriterGuard.test.js (9 tests): T10b scans every .js under backend/src (tests excluded), multi-line, for INSERT [OR x] INTO (sales_)salary_structures; each column list must name pf/esi/lwf; exemption list = exactly 3 (sales.js router.post /employees/:code/structures → T18; the two statutoryFlags.js copyStructure literals → T5 / T1), each must match exactly one site and its test title must exist. C1a: no INSERT without a column list (+ scanner self-check). C1b: any pf/esi/lwf assignment in UPDATE … SET or ON CONFLICT DO UPDATE SET on employees / salary_structures / sales_employees / sales_salary_structures fails unless on the pinned allowlist of exactly 5 (statutoryFlags.js service; schema.js trigger body; schema.js sales backfill ON CONFLICT; sales.js versionSalesStructureForGross ON CONFLICT; sales.js POST /employees create ON CONFLICT), no entry stale; dynamic SET builders (employees allowedFields, sales PUT loop) checked too. Run against origin/main d1ad7bf source: 4 of 9 fail, naming 10 INSERT sites + the 4 reset UPDATEs + 4 flag-writing UPDATEs — i.e. it catches every site PR-1 fixed.
- STEP 10 — 8eb238b `fix(statutory): crosscheck and red flags read the in-force structure (L19)`. financeAudit.js /statutory-crosscheck (only lines 1805–1821 + the pf response object): LEAST → scalar MIN; ss joined via COALESCE(in-effect for printf('%04d-%02d-01', sc.year, sc.month) ORDER BY effective_from DESC, id DESC, latest); pf.expectedEmployeeTotal added (additive; match unchanged). financeRedFlags.js compliance_gap: same in-force join; the ESI arm also requires sc.gross_salary <= 21000 (R1). statutoryReaders.test.js 3 tests (R1: 200 for Aug + Sep, expected 0 for Aug, 1440 for Sep; R2: no false flag in Aug after upload, a real Sep gap still flagged, ESI above ₹21k not flagged) — all 3 FAIL on the pre-STEP-10 files.
- STEP 11 — fa8c91a `feat(statutory): admin upload page`. NEW frontend/src/pages/StatutoryFlags.jsx (admin-only; scope + month (default 2026-09) + file; Preview → totals, blocking list, already-applied notice, per-row before→after flags, numbers, warnings/errors, 'changed only' filter; Apply → confirm quoting counts → apply with expectedSha256; batch history + undo-file download (blob, no-cache); no file kept). App.jsx lazy route /admin/statutory-flags after record-history; Sidebar.jsx adminOnly item after Record History; utils/api.js statutoryFlagsPreview/Apply (multipart), statutoryFlagsBatches (no-cache, N7), statutoryFlagsUndoFile (blob). npm run build OK; frontend/dist committed in the same commit (StatutoryFlags-*.js chunk; index bundle contains 'statutory-flags').
- STEP 12 — 8cddb6b `fix(statutory): flags read-only in master screens (L4)`. Employees.jsx SalaryModal: pf/esi removed from form state + payload (the L4 bug — emp.salary_structures?.pf_applicable ?? 1 — is gone), PF/ESI/LWF render read-only live from emp.*, link 'Change via Statutory Flags'; pt now read from salaryStructure. SalaryInput.jsx: pf/esi removed from editForm/openEdit (request JSON carries no flags), PF/ESI/LWF read-only from the row + link; backend salary-input GET /all adds ss.lwf_applicable (read-only, additive). Sales/SalesEmployeeMaster.jsx: pf/esi out of emptyForm; payload deletes pf/esi/lwf (create sends none → new employees start 0; edit sends none); PF/ESI/LWF read-only from the row + link. Bundle grep: old Employees chunk had 'salary_structures)==null?void 0:T.pf_applicable' / '.esi_applicable'; new bundle has 0. 'Change via Statutory Flags' present in all three chunks. dist committed in the same commit.
- STEP 13 — no new commit needed: a clean `npm run build` after 8cddb6b reproduces frontend/dist byte-identically (git status clean); the dist bundle contains 'statutory-flags' (5 chunks; index bundle has the '/admin/statutory-flags' route). All 13 STEPS done.
- PHASE 2 (self-debug) — 42d4980. Re-read every source hunk d1ad7bf..HEAD against IMPL_PR1 + BUILD_PLAN §3. DO NOT MODIFY files: 0 diff lines (import.js, payroll.js, dayCalculation.js, salesSalaryComputation.js, loans/**, recompute.js, leave files, phase5.js, exportFormats, salesExportFormats, payslipPdf, schemaReference, recordHistory, scripts, register pages, middleware, taDaChangeRequest, employeeProfileService, EmployeeQuickView); salaryComputation.js hunk @@ -300,11 only; financeAudit.js crosscheck hunks only; no data files in the diff. Caught + fixed: (1) preview totals did not tell the owner how many structure rows the apply will write (RUNBOOK V10 must be checked against the preview — E14) → planFlagChanges now returns per-row planned {freezeRow, effectiveRow, rowsUpdatedAtE, laterRowsUpdated} and totals; the confirm dialog shows them; test asserts preview == apply counts. (2) integrity-fix still synced pt from the master in my STEP 6 version — IMPL says 'fix syncs gross only' → now gross only, a pt-only mismatch is reported/skipped (+test). (3) sales company matching was exact-string → case/spacing-insensitive (UNIQUE(code, company) keeps it unambiguous) (+test). Deploy simulation (scratch script, old d1ad7bf schema DB with flags 1/1, then new initSchema ×2): master + structure flags intact, structure count unchanged, trigger + batch table present, a new insert lands 0/0/0, integrity ok. Full suite twice: 49 / 877, 0 failures.
- PHASE 3 (user simulation) — docs/statutory-flags/sim/run.py (+ seed.js): boots the REAL server.js (NODE_ENV=production, built dist) on a throwaway temp DATA_DIR (bootstrap sales-master import pre-skipped so the DB is 100% synthetic), real logins admin/hr/finance, real Stage 6/7 + sales compute over HTTP, the admin page + Employees salary modal in Chromium. 58/58 checks: hr preview 403; preview 7 rows / 5 matched / 1 unmatched / 2 row errors (unmatched code; no-structure zero-gross employee); preview writes nothing; preview planned rows (4 freeze / 4 effective / 0 at E / 2 later) == apply counts; re-apply → 409; same content new bytes → 0 changes / 0 inserts; plant AUGUST recompute byte-identical (every column); Sep PF+ESI on (incl. only-2026-09-06 employee and April+Oct employee); held salary stays held with ESI computed; employee not in file unchanged; zero-gross employee still no row; Oct row carries the new flags; HR PUT /salary with flags → ignoredFields, master unchanged; sales: preview (3 changed, 1 number, 3 freeze / 2 effective / 1 at E / 1 later), apply, AUGUST byte-identical, Sep ESI on for all 3, ESI number written; plant + sales drift queries 0 rows; undo file re-applied → no new rows, Sep back to pre-upload amounts, Aug still identical, drift 0; crosscheck 200; server restart → flags survive the boot (no reset); browser: page renders, batch history, preview row, confirm quotes planned rows, apply writes a batch, salary modal shows real flags read-only + link, sales master lists rows, 0 page errors, 0 API 4xx/5xx. Caught by the sim: the throwaway DB had loaded the repo's sales_master_import.sql bootstrap (167 rows) on first boot — sim now pre-marks that migration done so it stays synthetic (no product change; noted for the owner — OPEN_ITEMS Security already flags that file).
- PHASE 4 (local only) — origin/main re-fetched: still d1ad7bf, so no rebase was needed (C5: 0 conflicts, 0 resolved hunks); final full jest 49 / 877 green; node --check clean on all 10 touched backend files; CLAUDE.md Section 0 entry prepended (bd8c559). NOT PUSHED (C6: repo public). Code head before this PROGRESS commit: bd8c55957d16504423266ae9c687bcc31fbd7d05.
- REVIEW FIX 1 — e88d3d2 `fix(statutory): refuse structure writes shadowed by later rows; same-date updates in place` (review M1 + minor 4). New statutoryFlags.structureDatedAfter(db, scope, empId, date). sales versionSalesStructureForGross throws (err.statutory → PUT /employees/:code 409 STRUCTURE_DATED_LATER, txn rolls back incl. master + audit); sales POST /employees/:code/structures → 409 when a later row exists, same date → supplied columns updated in place on that row (flags kept, 200 updatedInPlace); plant salary-input approve → 409 inside the txn (request stays Pending), same date → gross + components UPDATE in place (flags/pt/percents/ceiling kept; no same-date twin). employees.js inserts only run with no structure → unchanged. Tests: T11 ×3, T11b ×3 rewritten (back-dated → 409 with every month May–Oct byte-identical and rows/master/audit unchanged; same-date + later-dated assert gross + components), T18 +2 (409, same-date in place); first T18 case now has no later row. 5 of the new tests FAIL on the pre-fix routes (swap-verified). Suite 49 / 883. Note found while testing: plant compute takes the stated gross from employees.gross_salary for EVERY month (salaryComputation.js 'Priority: employees.gross_salary'), so any approval re-grosses earlier months on a re-run — pre-existing, not touched (DO-NOT-MODIFY money logic); OPEN for the owner.
- REVIEW FIX 2 — e5ceaef `fix(statutory): never write a number duplicated in the file or already held by another employee` (review minor 2). planFlagChanges pre-counts every non-blank ESI number / UAN across the file (spaces stripped, as the write does); a number on ≥2 rows → warning on every such row ('repeated on rows … of this file — not written for any of them'), written for none; flags + other unique numbers still apply. DB conflict (held by another employee): already warned + not written (T7) — unchanged, now also tested for sales. 2 tests (plant 3-row repeat incl. a spaced variant; sales in-file repeat + held-by-other); both FAIL on the pre-fix service. Suite 49 / 885.
- REVIEW FIX 3 — 9278f9a `fix(statutory): same company normalisation in parser and matcher` (review minor 3). One shared normCompany (trim, collapse spaces, lower case) used by parseFlagFile's repeat key and matchEmployee; two sales rows for one code whose company differs only in case/spacing → blocking 'repeats row N', nothing applied. 1 test (lower-case + extra-space variants; apply refused, structures unchanged, 0 batches); FAILS on the pre-fix service. Suite 49 / 886.
- REVIEW FIX 4 — 5e2bb64 `docs(statutory): state the undo file's exact limits` (review minor 1). Mechanism unchanged. Wording 'Restores the flags that were in force at the effective month onto that month, later rows and the master. A later-dated row that had different flags before this batch is set to the effective-month value. Added ESI numbers / UANs and the extra structure rows stay.' in RUNBOOK.md T4 Undo, StatutoryFlags.jsx (header comment; UNDO_LIMITS constant shown in the confirm dialog and under batch history, data-testid undo-limits) and the buildUndoWorkbook comment. D-4 now reads with this limit. frontend/dist rebuilt + committed in the same commit (clean build of the previous source reproduced dist byte-identically first). Suite 49 / 886.
- REVIEW PHASE 2 — 0d805b2. Re-read every hunk a4eb3d1..HEAD (salary-input.js approve, sales.js versionSalesStructureForGross / PUT / POST /structures, statutoryFlags.js structureDatedAfter / normCompany / file-duplicate numbers / undo comment, StatutoryFlags.jsx UNDO_LIMITS) against IMPL_PR1 + BUILD_PLAN §3: no DO-NOT-MODIFY file touched (salaryComputation.js, schema.js, payroll.js unchanged since a4eb3d1); flags never written by the new paths (plant same-date UPDATE lists gross + components only; sales same-date UPDATE from `optional`, no flag). Caught: the new dynamic same-date SET in POST /structures was not covered by the guard → statutoryWriterGuard asserts its `optional` list names no flag (injecting 'esi_applicable' fails the suite). Noted for the owner in OPEN_ITEMS: plant compute reads gross from employees.gross_salary for every month (pre-existing). UPSERT counts unchanged: plant 56/56/56/53, sales 45/45/45/42 (reviewer's adv3.js). node --check clean on 10 backend files. Full jest twice: 49 / 886, 0 failures.
- REVIEW SIM — 8d5f82e. docs/statutory-flags/sim/run.py re-run on a throwaway temp DATA_DIR (synthetic, sales bootstrap skipped) + 10 new checks: sales back-dated gross edit 2026-05 after the upload → 409, nothing written (structures, master gross, audit_log), Sep + Oct pay unchanged; plant HR gross change → pending; back-dated approval 2026-08-15 → 409, request Pending, rows + master unchanged, Sep pay unchanged; same-date approval 2026-09-01 → one row at that date updated in place with its own flags, Sep pays the new gross + split; drift 0 rows both; confirm dialog states the undo limits. seed.js adds an Oct sales upload. 68/68. A clean `npm run build` reproduces frontend/dist byte-identically.
- REVIEW PHASE 4 (local only) — git fetch origin main: still d1ad7bf → no rebase (C5: 0 conflicts). CLAUDE.md Section 0 entry updated (923dad3). NOT PUSHED (C6: repo public). Code head before this PROGRESS commit: 923dad3f84c50bbd6ab14b3200e6281c35ec1b8d.
- REVIEW FIX 5 — cec4fe0 `fix(statutory): strict structure dates from requests (month 01–12, real calendar day)` (reviewer re-check, verdict SHIP). With the 409 STRUCTURE_DATED_LATER, a bogus later-dated row would block every honest edit. sales PUT /employees/:code effective_from and POST /employees/:code/structures share SALES_MONTH_RE ^\d{4}-(0[1-9]|1[0-2])$ (PUT was ^\d{4}-\d{2}$); sales POST /employees create rejects a doj whose month is not 01–12 (it dates the auto-created structure); plant approve requires a real calendar date (isCalendarDate: month 01–12, day valid for the month, leap years). 4 tests (plant 6 bad dates → 400 with rows/master/audit unchanged and request Pending, 2028-02-29 accepted; sales PUT + POST /structures 2026-13/2026-00/2026-5 → 400 nothing written; create doj month 13/00 → 400 nothing created); 3 of 4 FAIL on the previous routes. Suite 49 / 890. OPEN_ITEMS: added the same-gross split-edit / latest-row item (follow-up PR).

## LAST STEP
REVIEW FIX 5 — cec4fe0 (strict structure dates from requests) + OPEN_ITEMS split-edit item. Suite 49 / 890. NOT PUSHED.

## NEXT STEP
None for the build agent. Owner: confirm the 10 Oct planner ruling (structure writes dated before a later row → 409; same date → in place); decide OPEN_ITEMS 'plant compute gross source'. Then:

OWNER: (1) make the repo private (GitHub → Settings → General → Danger Zone); (2) from a clone of this branch: git push -u origin feat/statutory-flags; check git rev-parse HEAD == git rev-parse origin/feat/statutory-flags; (3) open https://github.com/abhinavpoddar27-pixel/hr-salary-system/compare/main...feat/statutory-flags in the GitHub UI and merge there; (4) RUNBOOK T4/T5 only after PR-2 is live too. Before pushing, fetch + rebase again if main moved (C5).

## OWNER RULINGS ADDED DURING THE BUILD
(record date + ruling; BUILD_PLAN §1 holds the original set)
- 10 Oct 2026 (owner): every Claude Code session runs Opus 5.5 — from a terminal: `--model claude-opus-5-5 --effort ultracode`; this replaces the `opusplan` / `opus` flags in RUNBOOK T1/T2. Resume line: `caffeinate -i claude --continue --permission-mode auto --model claude-opus-5-5 --effort ultracode`.
- 10 Oct 2026 (owner): PR-1 is run from the claude.ai project chat's cloud Claude Code workspace: a separate planning agent, the chat's review, then a separate build agent. Plan files come from this repo or the claude.ai Project, never from ~/Downloads. The owner still merges only in the GitHub web UI.
- 10 Oct 2026 (owner, on the planner's advice): helper agents may read, search and run tests in parallel, but STEPs stay strictly in order and only one agent edits files at a time; salaryComputation.js, schema.js and payroll.js are edited only by the main build agent.
- 10 Oct 2026: the repo was confirmed PUBLIC (GitHub API, raw file 200). Nothing on this branch is pushed until the owner makes it private (T0 prerequisite). Build and commit locally; push is the last step.
- 10 Oct 2026 (planner, after independent review; owner to confirm): in every writer that can insert a structure row for an existing employee (sales versionSalesStructureForGross / PUT /sales/employees/:code, sales POST /sales/employees/:code/structures, plant salary-input approve; employees.js inserts only fire when no structure exists): (a) if any structure row for that employee is dated AFTER the new row's date → refuse with 409 {error: 'A salary structure dated <latest date> already exists; date this change on or after <latest date>.'}, nothing written (whole request rolls back, master included); (b) if a row exists dated EXACTLY at the new date → update that row's gross/components in place and keep that row's own flags; (c) new date after every existing row (the normal case) → unchanged.

## DECISIONS TAKEN BY CLAUDE CODE (safest option, owner to review)
- D-1 (STEP 4) Structure rows are touched only when a structure actually needs new flags (forE or a row >= E
  differs from the file). A difference on the employee master alone updates the master and writes no freeze /
  effective rows — fewer rows, same compute result (compute reads flags from structures only).
- D-2 (STEP 4) A file whose rows contain a Y/N cell that is neither Y/N/yes/no/1/0/true/false is BLOCKED as a whole
  (never guessed). §4.2 lists only missing column / repeated code as blocking; an unreadable flag is treated the same.
- D-3 (STEP 4) Copies made by the upload stamp sales `created_by = 'statutory_upload batch:<id>'` (plant has no
  created_by column). Every other column is copied verbatim (PRAGMA list minus id/created_at/updated_at).
- D-5 (STEP 12) salary-input GET /all also returns ss.lwf_applicable (one read-only column) so the
  read-only LWF box in SalaryInput.jsx shows the real value. Not in the IMPL file list; additive read.
- D-6 (PHASE 2) integrity-fix repairs gross only (pt included in 'reported, not written'), per IMPL
  'fix syncs gross only'. Sales company match in the upload ignores case/spacing.
- D-4 (STEP 4) The undo file carries the flags that were IN FORCE AT E before the batch (what September compute
  used), not the master's flags; numbers are left blank (blank = unchanged, per §4.2). Not a full restore (review
  minor 1, wording fixed in REVIEW FIX 4): a later row whose flags differed before the batch ends at the E value.

## FILES TOUCHED
- backend/src/database/schema.js (STEP 1)
- backend/src/__tests__/helpers/statutoryFixture.js (new, STEP 1)
- backend/src/__tests__/statutorySchema.test.js (new, STEP 1; T8 added STEP 2)
- statutoryFixture.js: withLiveDefaults(db) + dflt() (STEP 2)
- backend/src/services/statutoryFlags.js (new, STEP 3)
- backend/src/__tests__/statutoryFlagsService.test.js (new, STEP 3)
- backend/src/routes/statutoryFlags.js (new, STEP 5)
- backend/server.js (STEP 5, +1 mount line)
- backend/src/__tests__/statutoryFlagsApi.test.js (new, STEP 5)
- backend/src/routes/employees.js (STEP 6)
- backend/src/__tests__/statutoryWriters.test.js (new, STEP 6)
- backend/src/routes/salary-input.js (STEP 7)
- backend/src/services/salaryComputation.js (STEP 7, lines 303–307 only)
- backend/src/__tests__/statutoryLoans.test.js (new, STEP 7)
- backend/src/routes/sales.js (STEP 8)
- backend/src/database/schema.js (STEP 8 — sales backfill INSERT)
- backend/src/__tests__/statutoryWriterGuard.test.js (new, STEP 9)
- backend/src/routes/financeAudit.js (STEP 10, crosscheck only)
- backend/src/services/financeRedFlags.js (STEP 10, compliance_gap only)
- backend/src/__tests__/statutoryReaders.test.js (new, STEP 10)
- frontend/src/pages/StatutoryFlags.jsx (new, STEP 11)
- frontend/src/App.jsx, frontend/src/components/layout/Sidebar.jsx, frontend/src/utils/api.js (STEP 11)
- frontend/dist (rebuilt STEP 11)
- frontend/src/pages/Employees.jsx, SalaryInput.jsx, Sales/SalesEmployeeMaster.jsx (STEP 12)
- backend/src/routes/salary-input.js GET /all (+ss.lwf_applicable, STEP 12)
- docs/statutory-flags/sim/run.py, seed.js (new, PHASE 3; review checks added)
- REVIEW FIXES: backend/src/services/statutoryFlags.js, routes/sales.js, routes/salary-input.js, __tests__/statutoryWriters.test.js, statutoryFlagsService.test.js, statutoryWriterGuard.test.js, frontend/src/pages/StatutoryFlags.jsx (+ dist), docs/statutory-flags/RUNBOOK.md, OPEN_ITEMS.md, CLAUDE.md

## FRAGILE-FILE EDITS (before / after)
- STEP 1 schema.js — BEFORE (lines 2214–2218 on d1ad7bf):
    safeCreateIndex('...idx_sales_salary_structures_emp ON sales_salary_structures(employee_id, effective_from)');
    <blank>
    // ── Sales Salary Module — Phase 2 (holidays + upload + monthly input) ─
  AFTER: same two anchor lines, with a new block between them (≈50 lines): 4× safeAddColumn lwf_applicable
  INTEGER DEFAULT 0 (employees, salary_structures, sales_employees, sales_salary_structures);
  safeAddColumn sales_employees.esi_number TEXT, .uan TEXT; CREATE TABLE IF NOT EXISTS statutory_flag_batches
  (id, scope CHECK plant|sales, effective_month, file_name, file_sha256, row_count, changed_count,
  status DEFAULT 'applying', applied_by, applied_at, summary_json, undo_json); partial unique index
  uniq_statutory_flag_batches_applied ON (scope, effective_month, file_sha256) WHERE status='applied';
  DROP TRIGGER IF EXISTS employees_statutory_default_off + CREATE TRIGGER … AFTER INSERT ON employees
  FOR EACH ROW BEGIN UPDATE employees SET pf_applicable=0, esi_applicable=0, lwf_applicable=0 WHERE id=NEW.id; END
  (in try/catch with console.error). No existing line edited.
- STEP 2 schema.js — BEFORE (lines 816–821 on d1ad7bf):
    // PF/ESI: disabled by default — set all existing records to 0 unless explicitly set via master import
    // This runs idempotently on every startup but only affects defaults
    db.prepare("UPDATE employees SET pf_applicable = 0 WHERE pf_applicable = 1 AND (uan IS NULL OR uan = '') AND (pf_number IS NULL OR pf_number = '')").run();
    db.prepare("UPDATE employees SET esi_applicable = 0 WHERE esi_applicable = 1 AND (esi_number IS NULL OR esi_number = '')").run();
    db.prepare("UPDATE salary_structures SET pf_applicable = 0 WHERE pf_applicable = 1 AND employee_id IN (SELECT id FROM employees WHERE (uan IS NULL OR uan = '') AND (pf_number IS NULL OR pf_number = ''))").run();
    db.prepare("UPDATE salary_structures SET esi_applicable = 0 WHERE esi_applicable = 1 AND employee_id IN (SELECT id FROM employees WHERE (esi_number IS NULL OR esi_number = ''))").run();
  AFTER: a 6-line comment only (reset removed (L2); trigger + upload now own the flags). No other line edited.
- STEP 7 salaryComputation.js — BEFORE (lines 301–308 on d1ad7bf):
        db.prepare(`INSERT OR REPLACE INTO salary_structures
          (employee_id, effective_from, gross_salary, basic, da, hra, special_allowance, other_allowances,
           basic_percent, hra_percent, da_percent, pf_applicable, esi_applicable, pt_applicable, pf_wage_ceiling)
          VALUES (?, '2025-01-01', ?, ?, 0, ?, 0, 0, ?, ?, 0, ?, ?, ?, 15000)`).run(
            employee.id, gross, basic, hra,
            basicPct, hraPct,
            employee.pf_applicable || 0, employee.esi_applicable || 0, employee.pt_applicable ?? 1
        );
  AFTER:
        db.prepare(`INSERT OR REPLACE INTO salary_structures
          (employee_id, effective_from, gross_salary, basic, da, hra, special_allowance, other_allowances,
           basic_percent, hra_percent, da_percent, pf_applicable, esi_applicable, lwf_applicable, pt_applicable, pf_wage_ceiling)
          VALUES (?, '2025-01-01', ?, ?, 0, ?, 0, 0, ?, ?, 0, ?, ?, ?, ?, 15000)`).run(
            employee.id, gross, basic, hra,
            basicPct, hraPct,
            employee.pf_applicable || 0, employee.esi_applicable || 0, employee.lwf_applicable || 0, employee.pt_applicable ?? 1
        );
  (git diff -U0: hunks @@ -303,2 +303,2 @@ and @@ -307 +307 @@ only.)
  UPSERT (saveSalaryComputation / saveSalesSalaryComputation) not touched: before = after = plant 56/56/56/53, sales 45/45/45/42.
- STEP 8 schema.js — BEFORE (sales backfill upsertStruct, ~line 2944 on d1ad7bf):
        INSERT INTO sales_salary_structures
          (employee_id, effective_from, basic, hra, cca, conveyance,
           gross_salary, pf_applicable, esi_applicable, pt_applicable, created_by)
        VALUES (?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?)
  AFTER:
        INSERT INTO sales_salary_structures
          (employee_id, effective_from, basic, hra, cca, conveyance,
           gross_salary, pf_applicable, esi_applicable, lwf_applicable, pt_applicable, created_by)
        VALUES (?, ?, ?, 0, 0, 0, ?, ?, ?, 0, ?, ?)
  (.run(...) args unchanged — the literal 0 adds no parameter; ON CONFLICT SET unchanged.)

## TEST STATUS
Baseline on d1ad7bf (rebased PR-1 branch, 10 Oct 2026): 42 suites / 769 tests, 0 failures, 2 clean runs.
After STEP 1: 43 / 776, 0 failures.
After STEP 2: 43 / 779, 0 failures.
(The older "tdsCalculation 3 red / protectedWrite flaky" note is obsolete — both were fixed before d1ad7bf.)
Frontend build: OK, dist reproduces byte-identical.
After STEP 3: 44 / 799, 0 failures.
After STEP 4: 44 / 818, 0 failures.
After STEP 5: 45 / 830, 0 failures.
After STEP 6: 46 / 847, 0 failures.
After STEP 7: 47 / 854, 0 failures.
After STEP 8: 47 / 862, 0 failures.
After STEP 9: 48 / 871, 0 failures.
After STEP 10: 49 / 874, 0 failures.
After STEP 11: backend unchanged (49 / 874); frontend build OK.
After STEP 12: backend 49 / 874 unchanged; frontend build OK.
After PHASE 2: 49 / 877, 0 failures, 2 clean runs.
PHASE 3 sim: 58/58.
After REVIEW FIX 1: 49 / 883, 0 failures.
After REVIEW FIX 2: 49 / 885, 0 failures.
After REVIEW FIX 3: 49 / 886, 0 failures.
After REVIEW FIX 4: 49 / 886, 0 failures; frontend build OK.
After REVIEW PHASE 2: 49 / 886, 0 failures, 2 clean runs. Review sim: 68/68.
After REVIEW FIX 5: 49 / 890, 0 failures.

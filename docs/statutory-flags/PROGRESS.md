# STATUTORY FLAGS + LWF — PROGRESS

## RESUME BLOCK (read this first after any compaction or new session)
1. Read this file top to bottom, then `docs/statutory-flags/BUILD_PLAN.md` §1 (rulings) and §3 (landmines).
2. Current PR = the first row below that is not DONE. Its implementation plan is
   `docs/statutory-flags/IMPL_PR<N>.md` (written by the planning session).
3. `git status` + `git log --oneline -5` on the PR branch; compare with LAST STEP below.
4. Continue from NEXT STEP. Update this file after every small step (state, done, next) and commit it.

## PR STATUS
- PR-1 feat/statutory-flags — DONE: merged #65 (8b9561d). T4/T5 applied 10 Oct 10:59 IST (batches 1 and 2): V1 24/6/118, V6 57/0/139, V10 248/270.
- PR-2 feat/lwf-deduction — DONE: merged #70 (ad96604) 11:11 IST. Plant September recomputed 11:17 IST: LWF 113 / ₹565 / ₹2,260; ESI 23 / ₹2,469.06 / ₹10,699.18; PF 6 / ₹9,762.86. V3/V5/V12 0 rows; V11 only the 5 known March–May rows. Against the snapshot: 113 rows exactly −₹5, 98 identical.
- PR-2b feat/lwf-sales — BUILT locally (base ad96604, no drift): STEPs 0–5 + C3 + C4 + CLAUDE.md; suite 65 / 1076 twice; NOT pushed (the chat reviews and pushes). Plan `docs/statutory-flags/IMPL_PR2b.md`. Live before HR computes October sales (close 25 Oct).
- PR-3 feat/statutory-filing — BUILDING (base origin/feat/lwf-sales dcad556 = PR #73, still open). Plan `docs/statutory-flags/IMPL_PR3.md` (REVIEW CORRECTIONS C1–C7 binding). Not pushed (the chat reviews and pushes).

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
- MERGE origin/main — 66f34d6 `Merge origin/main (f4b3b2f: loans PR-6b + PR-7) into feat/statutory-flags` (owner decision: open the PR now; merge, not rebase). Kept 9e0f266 (coordinator's docs-only commit: per-person amounts/age out of BUILD_PLAN/OPEN_ITEMS/RUNBOOK). Resolved hunks:
  - CLAUDE.md (1 conflict, top of Section 0): both sides prepended entries. Kept all, newest first: statutory flags PR-1, then main's Loans PR-6b and Loans PR-7, then the shared older entries. Script check: 0 lines of either side missing.
  - frontend/dist (212 rename/content conflicts): took origin/main's dist wholesale, then rebuilt from the merged source — 322a75d `build(frontend): rebuild dist after merging main` (bundle has both the undo-limits text and the Mark Left outstanding text; a second clean build reproduces it byte-identically).
  - backend/src/routes/employees.js, frontend/src/pages/Employees.jsx, frontend/src/utils/api.js: auto-merged by git, no conflict hunks. main changed only PUT /:code/mark-left (consolidateForExit, notifyAlerts, `loans` in the reply), Employees.jsx MarkLeftLoans, api.js loan close/reversal helpers; PR-1's flag rules sit in other handlers/components — both behaviours kept, nothing hand-edited.
  - No fragile file (salaryComputation.js, schema.js, payroll.js, dayCalculation.js) changed on main; main's loans code writes no pf/esi/lwf (grep + guard). UPSERT counts unchanged 56/56/56/53, 45/45/45/42.
  After the merge: jest 51 / 915 twice (main added 2 suites / 25 tests), statutoryWriterGuard 9/9, node --check clean (employees.js, loans.js, sales.js, salary-input.js, statutoryFlags.js, loans/exit.js), sim 68/68 on a throwaway DB.

- PR-2 PHASE 0 — 4363d64 `Merge origin/main (66c6a08: loans PR-8 + PR-9) into feat/lwf-deduction`. Drift: main moved 8b9561d -> 66c6a08 (loans PR-8 sales borrowers + PR-9 reports). No conflicts. IMPL_PR2 files touched on main: schema.js (+1 policy line at ~3692, outside every LWF site), headroom.js (comment only), financeAudit.js, SalaryComputation.jsx, payslipPdf.js (STEP 4/6 cited line numbers shift — re-locate by anchor text); salaryComputation.js and payroll.js unchanged on main; salesSalaryComputation.js changed (PR-2b file, not touched here). Baseline after the merge: 60 suites / 1004 tests green (was 51 / 915 on 8b9561d; main added 9 suites / 89 tests).
- PR-2 STEP 1 — 0a2f12a `feat(lwf): LWF columns, policy keys 5/20, AI cache trigger includes LWF`. lwfSchema.test.js S1–S4 (7 tests; 7/7 fail on the previous schema.js, swap-verified).
- PR-2 STEP 2 — 93302ab `feat(lwf): plant Stage 7 LWF ₹5/₹20 (flagged, earned gross > 0), counted in the loan headroom`. salaryComputation.js edits 1–4 exactly as IMPL_PR2 (LWF after the ESI block, before planStage7Loans; lwf_employee in the loan salary object; + lwfEmployee in totalDeductions before the cap; lwfEmployee/lwfEmployer returned); UPSERT 56/56/56/53 → 58/58/58/55. generatePayslipData NOT done here — moved with its test O1 to STEP 4 (as the plan lists it). headroom.js: 'lwf_employee' appended to plant + sales PRIOR_DEDUCTION_COMPONENTS (sales inert: the sales salary object has no lwf_employee → 0). lwfPlant.test.js P1–P10 = 18 tests (14 fail on the pre-STEP-2 files, swap-verified; the 4 that pass are flag-off / zero-gross / zero-attendance, which assert unchanged behaviour). P9 adds a control DB (same people, no upload): the unflagged colleague's September row is identical in every column; the flagged employee's row differs ONLY in lwf_employee, lwf_employer, total_deductions (+5), net_salary, total_payable, take_home (−5). P10: two DBs (LWF on/off, PF+ESI on, ₹6,000 advance) → loan_recovery 2645 vs 2650, ledger provisional = loan_recovery, reconcileLoan ok. T12 (statutoryLoans.test.js, N3): asserts lwf_employee 5 and adds it to `before`; the unedited T12 fails by exactly ₹5 on the new code. No runtime invariant sums the deduction components (driftMonitor/close/financeRedFlags checked) — only the docs SQL + sim scripts (N2, STEP 7).
- PR-2 STEP 4 — a90f488 `feat(lwf): LWF on the plant payslip, register totals, finance report, AI prompt`. generatePayslipData: 'LWF (Employee)' deductions line (after Early Exit; filtered when 0) + lwfEmployer; payroll.js /salary-register totals totalLWFEmployee/totalLWFEmployer only (no other payroll.js line in this step); financeAudit.js /report SELECT + row map (re-located by anchor: main changed this file); ai.js prompt line + `lwf` summary key; schemaReference.js. lwfOutputs.test.js O1 ×3 (payslip unit + GET /payslip/:code) + O5 ×2 (/finance-audit/report, /salary-register totals incl. held) via real JWT auth — 5/5 fail on the previous sources (swap-verified).
- PR-2 STEP 5 — e4e48ad `feat(lwf): LWF columns in the payroll register and salary slip summary Excel`. payroll.js — ONLY the two Excel handlers. BEFORE/AFTER: register HEADERS `… 'ESI(EE)', 'ESI(ER)', 'PT', 'TDS', …` (37) → `… 'ESI(EE)', 'ESI(ER)', 'LWF(EE)', 'LWF(ER)', 'PT', 'TDS', …` (39); NUM_COLS = HEADERS.length (comment 37 → 39); data row + totals row + `!cols` (+2 × wch 8 after the four PF/ESI widths) at the same position; SUMMARY sheet + 'LWF (Employee)' / 'LWF (Employer)' rows; CTC label/amount + LWF(ER). Slip summary: inline 19-element header + `SUMMARY_COLS = 19` → `SUMMARY_HEADER` (20, 'LWF' after 'ESI') + `SUMMARY_COLS = SUMMARY_HEADER.length`; data row / reducer `lwf` / totals / `!cols` (+1 × wch 8); `CAUTION_COLS = [15, 16, 17]` → `['TOT DED','NET PAYABLE','TAKE HOME'].map(h => SUMMARY_HEADER.indexOf(h))` = [16, 17, 18] (L15). O3 ×2 in lwfOutputs.test.js (header = data = totals = `!cols` = 39 / 20, every post-insert column still aligned with the DB row, LWF 5/20 and totals 10/40, CTC, held-row comments on exactly cols 16/17/18) — both fail on the pre-STEP-5 payroll.js. Test note: SheetJS only reads `!cols` back with `cellStyles: true`.
- PR-2 STEP 6 — 13d1e35 `feat(lwf): LWF column + totals in Stage 7; employer LWF on payslip`. SalaryComputation.jsx: LWF th/td after ESI (sortable, '—' when 0, employer share in tooltip), tfoot total, drill-down 'LWF (Emp)'/'LWF (Empr)', payslip modal '| Employer LWF' only when > 0. DrillDownRow colSpan 22 → 25 = real body-row cell count (rows had 24 cells before LWF; header + tfoot had 23 — D-8). payslipPdf.js: `wlf` from the 'LWF' deductions line; employer line + '| Employer LWF' only when > 0. FinanceAudit.jsx: LWF line in the report row detail when > 0. dist rebuilt + committed in the same commit. Proof: bundle grep 'LWF (Emp)', 'LWF (Empr)', 'lwf_employee', colSpan:25 (SalaryComputation-D-Vfju47.js); 'Employer LWF' + includes("LWF") (payslipPdf-CnuA1dGI.js); lwfEmployee (FinanceAudit-DEqbdIQB.js). Payslip HTML byte check vs origin/main (backend/scripts/loans-payslip-html-check.mjs, run from a scratchpad copy because the script assumes a pre-PR-9 base that lacks the export; base import path also made `.js`): 77/77 — a payslip without LWF renders byte-identical HTML; a flagged one shows both lines.
- PR-2 STEP 7 — b702d50 `docs(lwf): component check includes LWF`. Clean `rm -rf frontend/dist && npm run build` reproduces the committed dist byte-identically (git status clean → no dist commit). VERIFY.sql + V11 (10 components + lwf_employee within ₹1; expect only the 5 known capped rows) + V12 (September LWF rule; expect 0 rows). docs/loans/PROGRESS.md §2: both sums + COALESCE(lwf_employee,0) (N2) + note (sim scripts' componentShort stays 10-component; their employees are unflagged). V11/V12 run on the C4 sim DB — see C4.
- PR-2 C3 (byte-identical for the unflagged, mandatory) — `git worktree add <scratch>/base 66c6a08` (backend/node_modules symlinked); `node backend/scripts/loans-stage7-simulation.js --dump` in both trees (script options unchanged on main): 210 rows each, python3 comparison ignoring lwf_employee/lwf_employer → **0 differences**; lwf_* = 0 on every branch row; drift 0, component-short 0 both. Extra (headroom.js sales array): `loans-sales-simulation.js --dump` both trees → 232 rows, **0 differences**, lwf_* all 0. Full-mode stage7 simulation on the branch (5 loans, re-run, reimport): ALL CHECKS PASSED, drift 0, component-short 0.
- PR-2 C4 (simulation) — 62d9318 `test(lwf): PR-2 simulation - synthetic mirror of the plant September run`. docs/statutory-flags/sim/run_pr2.py + seed_pr2.js (PR-1 harness pattern: real server.js on a throwaway DATA_DIR, real logins, real upload preview → apply effective 2026-09, real Stage 6/7 over HTTP, HTTP outputs; no browser). Branch 25/25: N = 8 flagged with pay (incl. held F08, contractor F07) → 40 / 160; Z01 flagged zero-gross → row saved, 0/0; Z02 flagged, no Sep attendance → no row; U01–U05 unflagged 0/0; August re-run after the upload byte-identical; V5 drift / V11 / V12 (SQL read from VERIFY.sql) 0 rows; payslip, register totals (finance login), finance report, register Excel (39), slip Excel (20, held comments on 16/17/18). `--base` on the 66c6a08 worktree: 8/8; dump comparison → every unflagged row identical in every column (Aug + Sep, 6 Sep + 15 Aug rows), flagged Sep rows differ ONLY in total_deductions +5 and net_salary / total_payable / take_home −5.
- PR-2 FINAL — full jest twice: 63 / 1036, 0 failures (baseline after merging main 60 / 1004; +3 suites / +32 tests). node --check clean on the 7 touched backend files. DO-NOT-MODIFY diff vs 66c6a08: 0 files (dayCalculation, statutoryFlags service/route, stage7, recompute, exportFormats, all PR-2b sales files, scripts, structure writers). UPSERT plant 58/58/58/55, sales 45/45/45/42. CLAUDE.md Section 0 entry prepended. NOT pushed (the coordinator pushes, C5).

- PR-2b PHASE 0 + STEP 0 — branch `feat/lwf-sales` = origin/main ad96604 (`git fetch`; `git log ad96604..origin/main` empty → no drift, no merge). Baseline jest 64 suites / 1047 tests green. Base worktree `<scratch>/base` at ad96604 (backend + frontend node_modules symlinked): `loans-sales-simulation.js --dump` 232 rows, md5 9a42643837639876b6c3c76eeb48afd0 (= the planner's prototype); `loans-stage7-simulation.js --dump` 210 rows, md5 27287253ee75da0df643340a696e8bce. Plan copied to `docs/statutory-flags/IMPL_PR2b.md` (REVIEW CORRECTIONS C1–C5 binding).

- PR-2b STEP 0 — 1601698 `docs(statutory): PR-2b plan; PR-1 and PR-2 done in production`.
- PR-2b STEP 1 — a099ed3 `feat(lwf): sales LWF ₹5/₹20 (flagged, earned gross > 0) in total_deductions and the loan headroom`. salesSalaryComputation.js exactly as IMPL_PR2b: LWF block after the ESI `}` (getPolicyNumber + `>= 0`, E7); `lwf_employee: lwfEmployee` in the loan salary object; `+ lwfEmployee` in total_deductions (comment updated); `lwf_employee`/`lwf_employer` in the return object. UPSERT (static parser, base vs branch): sales **45/45/45/42 → 47/47/47/44** (cols / placeholders / params / SET; both columns appended last; params `comp.lwf_employee || 0`, `comp.lwf_employer || 0`); plant 58/58/58/55 unchanged. Tests: lwfSales.test.js 21 (Q1 ×2, Q2 ×4, C5/N5 pin, Q3 ×5, Q4 ×5 + route compute over a paid+NEFT row, Q5 ×2, M1 pin) — **15 of 21 FAIL on the ad96604 file** (swap-verified); the 6 that pass assert unchanged behaviour (flag off, 0 days, zero gross, policy '0', headroom unit, M1 pin). salesLoanFixture SALES_SHORT_SQL + `COALESCE(lwf_employee,0)` (N6; scripts' componentShort stays 7-term). Proof: sales `--dump` on the branch 232 rows, md5 9a42643837639876b6c3c76eeb48afd0 = base. Neighbour suites loansSales*/statutory*/lwf* 17 / 233 green. `node --check` clean.

- PR-2b STEP 2 — 3fa385d `feat(lwf): sales salary edit keeps LWF in the total and the loan re-plan; register totals`. sales.js `git diff -U0` hunks @@ 2943 (register totals + lwf_employee / lwf_employer), @@ 3010 (PUT loan salary object + `lwf_employee: existing.lwf_employee || 0`), @@ 3015/3020 (rebuild comment + `(existing.lwf_employee || 0)` in fixedDeductions) — nothing else in sales.js. Tests: Q6 ×5 (flagged no-loan edit other 100 → total = PF + ESI + 5 + 100, recompute = same row; loan edit other 9000 → loan 995, total 10000, net 10000, compute → same row, same ledger row, no new loan events, reconcile ok; unflagged edit = old formula; paid → 409, row unchanged; register totals 5×N / 20×N). Proof: dropping ONLY the 3010 term → Q6 loan test fails with loan 1000 / total 10005 / net 9995 (= the prototype); whole ad96604 sales.js → 3 of 5 Q6 fail (the 2 that pass pin unchanged behaviour). Suite file 26/26. Decision D-9 (test harness): one file-level startJwtApi (a second one in the same file gets getDb's closed singleton). `node --check` clean.

- PR-2b STEP 3 — db3019e `feat(lwf): LWF on the sales payslip and the sales register Excel (39 columns)`. generateSalesPayslipData: `{ label: 'LWF (Employee)', amount: comp.lwf_employee }` after Loan EMI (the existing filter drops 0) + `lwfEmployer: comp.lwf_employer || 0` after netSalary (API only, E6 — SalesPayslip.jsx / salesPayslipPdf.js map `deductions` generically, not edited). salesExportFormats.js generateSalesExcel only: header `'ESI Employee', 'LWF Employee', 'PT'` (38 → 39, index 25), data cell `round2(r.lwf_employee)`, `!cols` `{ wch: 8 }` after the PF/ESI `{ wch: 10 }`s (39 entries), JSON totals lwf_employee / lwf_employer. NEFT / TA-DA generators untouched. Tests O2 (function + GET /api/sales/payslip/:code; unflagged → no line, lwfEmployer 0; deductions sum = total) + O4 ×2 (real download route read with `cellStyles: true`: header = every row = `!cols` = width = 39, 18 header→DB-column checks per row; JSON preview + /salary-register totals 10 / 40 for N = 2) — all 3 FAIL with the pre-step files (STEP 1 service + ad96604 export file). Nothing else reads the sales Excel (grep: tests, scripts, sims). loansSales*/loansReports* 8 / 84 green. `node --check` clean.

- PR-2b STEP 4 — 62d80ec `feat(lwf): LWF column and total in the sales salary register`. Before editing, a clean `npm run build` of 18ff118 reproduced the committed dist byte-identically (0 changes), so the environment is deterministic. SalesSalaryCompute.jsx: `min-w-[1480px]` → `min-w-[1540px]`; LWF th after ESI (title explains employer share); td `fmtINR(r.lwf_employee)` with `title` "Employer LWF: …"; tfoot `colSpan={3}` → `colSpan={2}` + LWF total td (`totals.lwf_employee`, employer total in title) + empty td under TDS. Cell count by script: header 21 = body 21 = tfoot 21 (was 20). dist rebuilt and committed in the same commit (80 paths). Proof: `SalesSalaryCompute-PJwJp7me.js` contains `lwf_employee` ×2, `Employer LWF` ×2, `min-w-[1540px]`, `children:"LWF"`; `rm -rf frontend/dist && npm run build` after the commit → git status clean (byte-identical). Not done: a browser pass of the page (bundle grep only, same as PR-2).

- PR-2b STEP 5 — 87d4f08 `docs(lwf): sales component and LWF rule checks; PR-2b simulation`. VERIFY.sql (C3 numbering): V12 now reads `COALESCE((SELECT CAST(value AS REAL) FROM policy_config WHERE key='lwf_employee_amount'),5)` / employer 20 (M6); V13 sales component check (7 components + LWF(EE), every month, within ₹1 — run on production BEFORE deploy as the baseline); V14 sales LWF rule for one cycle month (V7's join, policy amounts; literal 10 / '2026-10', change both to 9 / '2026-09' for 6A). All six of V5/V8/V11–V14 prepare and run on a fresh schema. OPEN_ITEMS: N3, N5 (C5), N9, N10. sim/seed_pr2b.js + run_pr2b.py (below).
- PR-2b C3 (byte-identical for the unflagged, mandatory) — worktree `<scratch>/base` at ad96604 (node_modules symlinked). On the final branch code: `loans-sales-simulation.js --dump` 232 rows, md5 **9a42643837639876b6c3c76eeb48afd0 = base** (a second base run gives the same md5 → deterministic); `loans-stage7-simulation.js --dump` 210 rows, md5 **27287253ee75da0df643340a696e8bce = base** (drift 0, component-short 0). Full `loans-sales-simulation.js` on the branch: PASS (1125 non-borrower rows identical; its 7-term componentShort stays valid — N6).
- PR-2b C4 (simulation) — `python3 docs/statutory-flags/sim/run_pr2b.py <repo>`: real server.js on a throwaway DATA_DIR (sales bootstrap skipped), real logins, sales compute over HTTP Aug + Sep BEFORE the upload; Sep holds (F04, U03), NEFT export (download), F05 → reviewed → finalized → paid; the real sales statutory upload (preview → apply, 2026-09: LWF Y for F01–F06/Z01/Z02, ESI Y for F02/U01); Aug re-run, Sep re-run (6A shape), Oct (first live month); HR edits; payslip; register totals; Excel. **Branch 54/54**: N = 6 flagged with pay → 30 / 120 in Sep and Oct; Z01 (0 days) row saved 0/0; Z02 (zero-gross) excluded; Aug re-run byte-identical; F05 paid + NEFT kept, net −5, `finalizedRecomputeWarnings` = [F05 paid −5] only; every NEFT stamp kept; F04 held charged; U02/U03 identical in every column; LWF-only reps differ only in lwf_*/total/net; F02 / U01 only add the ESI lines; F06 loan 3334 unchanged where the cap does not bind; edits F06 other 9000 → loan 995 / total 10000 (ledger 995), F01 → 105, U02 → 100, paid Sep row → 409; Oct compute after the edits reproduces the edited rows; payslip F01 LWF 5 + lwfEmployer 20, U02 no line; register + Excel JSON totals 30 / 120; Excel 39 everywhere, LWF at 25; V8 (Aug/Sep/Oct) / V13 / V14 (as written for Oct + rewritten for Sep) 0 rows. **`--base` on ad96604: 23/23**; `--compare branch base`: **18 unflagged rows identical in every column, 12 flagged rows differ only by the LWF lines** (total +5 / net −5; F06 Oct: loan 1000 → 995 with total and net equal). Negative control: a 1-paisa change on an unflagged row and an ESI change on a flagged row are both reported. Payslip HTML: scratch copy of `backend/scripts/loans-payslip-html-check.mjs` vs ad96604 + 2 sales LWF fixtures → **107/107** (the LWF line renders once with 5.00; no employer LWF printed; unflagged payslips byte-identical — renderers unchanged).
- PR-2b FINAL — full jest twice: **65 suites / 1076 tests, 0 failures** (baseline 64 / 1047; + lwfSales.test.js 29). `node --check` clean: salesSalaryComputation.js, sales.js, salesExportFormats.js. DO-NOT-MODIFY diff vs ad96604: 0 files (dayCalculation, salaryComputation, schema, payroll, loans/*, recompute, statutory flags service/route/guard, exportFormats, settings, employeeProfileService, EmployeeQuickView, sales/plant payslip renderers, cycleUtil, sundayRule, driftMonitor, TA/DA, backend/scripts). No xlsx/csv/db in the diff. sales.js: the 3 planned hunks only. UPSERT sales 47/47/47/44, plant 58/58/58/55. CLAUDE.md Section 0 entry prepended. Code head before this PROGRESS commit: 87d4f08.

- PR-3 PHASE 0 + STEP 0 — `git fetch origin`: PR #73 (feat/lwf-sales, dcad556) still OPEN (GitHub REST: merged=false) → C1: branch
  `feat/statutory-filing` from `origin/feat/lwf-sales` dcad556 (upstream unset; never pushed). Drift: origin/main moved ad96604 → 3a7630f
  (#71 leave employee search: `frontend/src/components/shared/EmployeeSearchSelect.jsx`, `pages/LeaveManagement.jsx`, `utils/api.js` +11 lines,
  `frontend/dist`). None of PR-3's backend FILES / DO NOT MODIFY files moved. `utils/api.js` + `frontend/dist` are on PR-3's FILES list → they
  merge (api.js) / rebuild (dist) when #73 and PR-3 land on main; nothing to do on this branch. Baseline jest on dcad556: **65 suites / 1076
  tests**, 0 failures. Base worktree `<scratch>/base` moved to dcad556 (backend + frontend node_modules symlinked) for filing_identity.js.
  Plan copied to `docs/statutory-flags/IMPL_PR3.md`.

## LAST STEP
PR-3 STEP 0 (plan copied, PR-3 BUILDING, Phase 0 recorded).

## NEXT STEP
PR-3 STEP 1 (export ESI/UAN rules). Carried from PR-2b: run VERIFY V13 on production before PR-2b deploys; do NOT recompute sales September until D3 is answered.

## OWNER RULINGS ADDED DURING THE BUILD
(record date + ruling; BUILD_PLAN §1 holds the original set)
- 10 Oct 2026 (owner): every Claude Code session runs Opus 5.5 — from a terminal: `--model claude-opus-5-5 --effort ultracode`; this replaces the `opusplan` / `opus` flags in RUNBOOK T1/T2. Resume line: `caffeinate -i claude --continue --permission-mode auto --model claude-opus-5-5 --effort ultracode`.
- 10 Oct 2026 (owner): PR-1 is run from the claude.ai project chat's cloud Claude Code workspace: a separate planning agent, the chat's review, then a separate build agent. Plan files come from this repo or the claude.ai Project, never from ~/Downloads. The owner still merges only in the GitHub web UI.
- 10 Oct 2026 (owner, on the planner's advice): helper agents may read, search and run tests in parallel, but STEPs stay strictly in order and only one agent edits files at a time; salaryComputation.js, schema.js and payroll.js are edited only by the main build agent.
- 10 Oct 2026: the repo was confirmed PUBLIC (GitHub API, raw file 200). Nothing on this branch is pushed until the owner makes it private (T0 prerequisite). Build and commit locally; push is the last step.
- 10 Oct 2026 08:53 (owner): keep the repo public and open the PR now (supersedes the line above); push access granted to the coordinator, who pushes. Merge origin/main into the branch (not rebase).
- 10 Oct 2026 (planner, after independent review; owner to confirm): in every writer that can insert a structure row for an existing employee (sales versionSalesStructureForGross / PUT /sales/employees/:code, sales POST /sales/employees/:code/structures, plant salary-input approve; employees.js inserts only fire when no structure exists): (a) if any structure row for that employee is dated AFTER the new row's date → refuse with 409 {error: 'A salary structure dated <latest date> already exists; date this change on or after <latest date>.'}, nothing written (whole request rolls back, master included); (b) if a row exists dated EXACTLY at the new date → update that row's gross/components in place and keep that row's own flags; (c) new date after every existing row (the normal case) → unchanged.

- 10 Oct 2026 10:00 (planner): PR-2 split — plant LWF ships first (today's plant September release); sales LWF moves to PR-2b before the 25 Oct sales close. Loan headroom (headroom.js) counts LWF for both payrolls now (sales rows stay 0 until PR-2b).

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
- D-7 (PR-2 STEP 1) The AI-cache trigger DROP + CREATE runs inside one db.transaction() (plan: plain db.exec), so a
  failed CREATE rolls the DROP back and the cache never runs without its trigger. Same SQL otherwise.
- D-8 (PR-2 STEP 6) Employer LWF is shown on the payslip modal / PDF only when > 0 (plan: always), so every
  payslip without LWF stays byte-identical (verified 77/77). Stage 7 table: the header and tfoot were one cell short
  of the body rows (status + actions = 2 cells, 1 header cell) — one empty trailing th + tfoot colSpan 2 added so
  header, body, tfoot and the DrillDownRow colSpan are all 25.
- D-9 (PR-2b STEP 2) lwfSales.test.js uses ONE file-level `startJwtApi` for every route test (Q4 route, Q6, O2/O4),
  isolated by company + month: `getDb()` is a per-module singleton, so a second harness in the same file got the closed
  handle. Test-only; no product code.
- D-10 (PR-2b STEP 5) The plan's "PR-2's scratch copy of the payslip HTML check" was never committed; recreated in the
  scratchpad (the committed script still fails against a post-PR-9 base with 'Duplicate export', as PR-2 found) and
  run vs ad96604 with 2 sales LWF fixtures (107/107). `backend/scripts/*` stays untouched (DO NOT MODIFY). The C4 sim goes
  beyond the plan's "Aug + Sep" by also computing October so V14 runs exactly as written; sales sheet uploads are seeded
  in SQL (as salesLoanFixture.setUpload / the PR-8 sales sim do), the statutory upload goes through the real route.
  OPEN_ITEMS also records N9 (plan named N3 + N10; C5 added N5).
- D-4 (STEP 4) The undo file carries the flags that were IN FORCE AT E before the batch (what September compute
  used), not the master's flags; numbers are left blank (blank = unchanged, per §4.2). Not a full restore (review
  minor 1, wording fixed in REVIEW FIX 4): a later row whose flags differed before the batch ends at the E value.

## FILES TOUCHED
- PR-2: backend/src/database/schema.js (STEP 1), backend/src/__tests__/lwfSchema.test.js (new, STEP 1)
- PR-2: backend/src/services/salaryComputation.js, backend/src/services/loans/headroom.js, backend/src/__tests__/lwfPlant.test.js (new), backend/src/__tests__/statutoryLoans.test.js (T12) (STEP 2)
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
- PR-2 STEP 4: salaryComputation.js (generatePayslipData), routes/payroll.js (/salary-register totals), routes/financeAudit.js (/report), routes/ai.js, config/schemaReference.js, __tests__/lwfOutputs.test.js (new)
- PR-2 STEP 5: routes/payroll.js (two Excel handlers), __tests__/lwfOutputs.test.js (O3)
- PR-2 STEP 6: frontend/src/pages/SalaryComputation.jsx, frontend/src/utils/payslipPdf.js, frontend/src/pages/FinanceAudit.jsx, frontend/dist
- PR-2 STEP 7: docs/statutory-flags/VERIFY.sql (V11, V12), docs/loans/PROGRESS.md (§2)
- PR-2 C4: docs/statutory-flags/sim/run_pr2.py, seed_pr2.js (new); CLAUDE.md (Section 0 entry)
- PR-2b STEP 0: docs/statutory-flags/IMPL_PR2b.md (new), PROGRESS.md
- PR-2b STEP 1: backend/src/services/salesSalaryComputation.js (compute + save), backend/src/__tests__/lwfSales.test.js (new), backend/src/__tests__/helpers/salesLoanFixture.js (SALES_SHORT_SQL)
- PR-2b STEP 2: backend/src/routes/sales.js (3 hunks), lwfSales.test.js (Q6)
- PR-2b STEP 3: salesSalaryComputation.js (generateSalesPayslipData), backend/src/services/salesExportFormats.js (generateSalesExcel), lwfSales.test.js (O2, O4)
- PR-2b STEP 4: frontend/src/pages/Sales/SalesSalaryCompute.jsx, frontend/dist
- PR-2b STEP 5: docs/statutory-flags/VERIFY.sql (V12, V13, V14), OPEN_ITEMS.md, sim/run_pr2b.py + seed_pr2b.js (new); CLAUDE.md (Section 0 entry)

## FRAGILE-FILE EDITS (before / after)
- PR-2 STEP 2 salaryComputation.js (lines on 66c6a08 = 8b9561d, file unchanged on main) —
  (1) after 583 (ESI block `}`), NEW:
        const lwfAmt = (k, d) => { const v = parseFloat(getPolicyValue(db, k, d)); return Number.isFinite(v) && v >= 0 ? v : d; };
        const lwfOn = !!salStruct.lwf_applicable && grossEarned > 0;
        const lwfEmployee = lwfOn ? Math.round(lwfAmt('lwf_employee_amount', 5) * 100) / 100 : 0;
        const lwfEmployer = lwfOn ? Math.round(lwfAmt('lwf_employer_amount', 20) * 100) / 100 : 0;
  (2) 691 BEFORE `late_coming_deduction: lateComingDeduction, early_exit_deduction: earlyExitDeduction,`
          AFTER  `late_coming_deduction: lateComingDeduction, early_exit_deduction: earlyExitDeduction, lwf_employee: lwfEmployee,`
  (3) 697 BEFORE `… + loanRecovery + lateComingDeduction + earlyExitDeduction;`  AFTER `… + earlyExitDeduction + lwfEmployee;` (cap unchanged)
  (4) 807 BEFORE `esiEmployee, esiEmployer,`  AFTER `esiEmployee, esiEmployer, lwfEmployee, lwfEmployer,`
  UPSERT (saveSalaryComputation): column `lwf_employee, lwf_employer,` after `early_exit_deduction,`; placeholders `?, ?,` after the
  early-exit `?,`; SET `lwf_employee = excluded.lwf_employee, lwf_employer = excluded.lwf_employer,` after early_exit; params
  `comp.lwfEmployee || 0, comp.lwfEmployer || 0,` after `comp.earlyExitDeduction || 0,`.
  UPSERT counts BEFORE plant 56 cols / 56 placeholders / 56 params / 53 SET → AFTER 58 / 58 / 58 / 55 (counted by script + P7 static test).
  Sales UPSERT untouched: 45 / 45 / 45 / 42 before and after.
  headroom.js 30/32: `'early_exit_deduction']` → `'early_exit_deduction', 'lwf_employee']`; `'other_deductions']` → `'other_deductions', 'lwf_employee']`.
- PR-2 STEP 1 schema.js (lines on 66c6a08) — BEFORE 1705–1735:
    safeAddColumn('salary_computations', 'early_exit_deduction', 'REAL DEFAULT 0');
    … ai_explanation / ai_explanation_at safeAddColumn …
    try { db.exec(`CREATE TRIGGER IF NOT EXISTS invalidate_salary_ai_cache AFTER UPDATE OF <29 columns … salary_held,
          hold_reason, gross_changed> ON salary_computations FOR EACH ROW WHEN NEW.ai_explanation IS NOT NULL BEGIN … END;`); }
  AFTER: after the early_exit_deduction line: safeAddColumn salary_computations lwf_employee / lwf_employer REAL DEFAULT 0;
    insertPolicyIfMissing lwf_employee_amount '5', lwf_employer_amount '20'. Trigger: db.transaction(() => { DROP TRIGGER
    IF EXISTS invalidate_salary_ai_cache; CREATE TRIGGER invalidate_salary_ai_cache AFTER UPDATE OF <same 29>,
    lwf_employee, lwf_employer ON salary_computations … (WHEN/BEGIN body unchanged) })(). After cycle_end_date (~2578):
    safeAddColumn sales_salary_computations lwf_employee / lwf_employer REAL DEFAULT 0. Force-reset list untouched.
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
After MERGE origin/main f4b3b2f: 51 / 915, 0 failures, 2 clean runs; guard 9/9; sim 68/68.
PR-2 baseline after merging origin/main 66c6a08: 60 / 1004, 0 failures.
PR-2 STEP 1: lwfSchema 7/7 (+ statutorySchema, loansSchema green).
PR-2 STEP 2: lwfPlant 18/18, T12 green; full suite 62 / 1029, 0 failures (= baseline 60 / 1004 + 2 suites / 25 tests).
PR-2 STEP 4: lwfOutputs 5/5; suites touching STEP 4 files 8 / 142 green.
PR-2 STEP 5: lwfOutputs 7/7 (+ holdReleaseRoute, manualDeductionsRetired green).
PR-2 STEP 6: npm run build OK; payslip HTML byte check 77/77.
PR-2 STEP 7: dist clean rebuild byte-identical.
PR-2 C4 sim: branch 25/25, base 8/8 + dump comparison clean. PR-2 final: 63 / 1036, 0 failures, 2 clean runs.
PR-2b baseline on ad96604: 64 / 1047, 0 failures.
PR-2b STEP 1: lwfSales 21/21 (15 fail on the old file); loansSales*/statutory*/lwf* 17 / 233.
PR-2b STEP 2: lwfSales 26/26 (Q6 3 of 5 fail on the old sales.js; dropping only the loan-object term fails the loan case).
PR-2b STEP 3: lwfSales 29/29 (O2/O4 3/3 fail on the pre-step files); loansSales*/loansReports* 8 / 84.
PR-2b STEP 4: npm run build OK; clean rebuild byte-identical.
PR-2b C3: sales + plant --dump md5 = base. C4 sim: branch 54/54, base 23/23, compare clean. Payslip HTML 107/107.
PR-2b final: 65 / 1076, 0 failures, 2 clean runs.
PR-3 baseline on dcad556 (origin/feat/lwf-sales): 65 / 1076, 0 failures.

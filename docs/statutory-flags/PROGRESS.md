# STATUTORY FLAGS + LWF — PROGRESS

## RESUME BLOCK (read this first after any compaction or new session)
1. Read this file top to bottom, then `docs/statutory-flags/BUILD_PLAN.md` §1 (rulings) and §3 (landmines).
2. Current PR = the first row below that is not DONE. Its implementation plan is
   `docs/statutory-flags/IMPL_PR<N>.md` (written by the planning session).
3. `git status` + `git log --oneline -5` on the PR branch; compare with LAST STEP below.
4. Continue from NEXT STEP. Update this file after every small step (state, done, next) and commit it.

## PR STATUS
- PR-1 feat/statutory-flags — BUILD IN PROGRESS (go received 10 Oct 2026); see LAST STEP
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

## LAST STEP
STEP 10 — 8eb238b `fix(statutory): crosscheck and red flags read the in-force structure (L19)`. financeAudit.js /statutory-crosscheck (only lines 1805–1821 + the pf response object): LEAST → scalar MIN; ss joined via COALESCE(in-effect for printf('%04d-%02d-01', sc.year, sc.month) ORDER BY effective_from DESC, id DESC, latest); pf.expectedEmployeeTotal added (additive; match unchanged). financeRedFlags.js compliance_gap: same in-force join; the ESI arm also requires sc.gross_salary <= 21000 (R1). statutoryReaders.test.js 3 tests (R1: 200 for Aug + Sep, expected 0 for Aug, 1440 for Sep; R2: no false flag in Aug after upload, a real Sep gap still flagged, ESI above ₹21k not flagged) — all 3 FAIL on the pre-STEP-10 files.

## NEXT STEP
STEP 11: admin page frontend/src/pages/StatutoryFlags.jsx + App.jsx lazy route /admin/statutory-flags (after line 214) + Sidebar.jsx adminOnly item after Record History (182) + utils/api.js (preview/apply multipart, batches fresh no-cache, undo file blob). Test: npm run build; commit frontend/dist in the same step.

## OWNER RULINGS ADDED DURING THE BUILD
(record date + ruling; BUILD_PLAN §1 holds the original set)
- 10 Oct 2026 (owner): every Claude Code session runs Opus 5.5 — from a terminal: `--model claude-opus-5-5 --effort ultracode`; this replaces the `opusplan` / `opus` flags in RUNBOOK T1/T2. Resume line: `caffeinate -i claude --continue --permission-mode auto --model claude-opus-5-5 --effort ultracode`.
- 10 Oct 2026 (owner): PR-1 is run from the claude.ai project chat's cloud Claude Code workspace: a separate planning agent, the chat's review, then a separate build agent. Plan files come from this repo or the claude.ai Project, never from ~/Downloads. The owner still merges only in the GitHub web UI.
- 10 Oct 2026 (owner, on the planner's advice): helper agents may read, search and run tests in parallel, but STEPs stay strictly in order and only one agent edits files at a time; salaryComputation.js, schema.js and payroll.js are edited only by the main build agent.
- 10 Oct 2026: the repo was confirmed PUBLIC (GitHub API, raw file 200). Nothing on this branch is pushed until the owner makes it private (T0 prerequisite). Build and commit locally; push is the last step.

## DECISIONS TAKEN BY CLAUDE CODE (safest option, owner to review)
- D-1 (STEP 4) Structure rows are touched only when a structure actually needs new flags (forE or a row >= E
  differs from the file). A difference on the employee master alone updates the master and writes no freeze /
  effective rows — fewer rows, same compute result (compute reads flags from structures only).
- D-2 (STEP 4) A file whose rows contain a Y/N cell that is neither Y/N/yes/no/1/0/true/false is BLOCKED as a whole
  (never guessed). §4.2 lists only missing column / repeated code as blocking; an unreadable flag is treated the same.
- D-3 (STEP 4) Copies made by the upload stamp sales `created_by = 'statutory_upload batch:<id>'` (plant has no
  created_by column). Every other column is copied verbatim (PRAGMA list minus id/created_at/updated_at).
- D-4 (STEP 4) The undo file carries the flags that were IN FORCE AT E before the batch (what September compute
  used), not the master's flags; numbers are left blank (blank = unchanged, per §4.2).

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

## Section 0: Last Session
- **Date:** 2026-04-29
- **Branch:** `claude/session-start-akL0j` at `ccc9ad9` (no code changes this session — production-data-correction attempt blocked at discovery phase; last functional commit still `e7496e7` from 2026-04-28)
- **Last commit:** `ccc9ad9` docs: session handoff 2026-04-28 (this session prepends a new entry on top)
- **Files changed this session:** `CLAUDE.md` only — Section 0 prepend documenting the blocked migration. Zero source-code changes; zero schema changes; zero database writes.
- **What was attempted:** Production data correction to migrate Indriyan Beverages sales data from Mar 2026 cycle → Feb 2026 cycle. A coordinator file ("Sales feb attendance") was uploaded today and the system attributed it to month=3,year=2026 when it should have been month=2,year=2026. No NEFT exported, no payments — clean rollback should be possible. Plan was a 7-step approval-gated SQL migration with backups + audit log entry. **The migration was blocked at Step 1 (Discovery)** because production schema and data state differ from CLAUDE.md's documented state in three material ways. Execution path agreed with user: Option 1 (Railway CLI shell + sqlite3) for the destructive UPDATE/INSERT/CREATE phase since the Admin Query Tool is SELECT-only.
- **What's fragile / blocking:**
  - **Production schema differs from CLAUDE.md docs.** Step 1.3-fix returned `no such column: neft_exported_at` on `sales_salary_computations`. CLAUDE.md (the 2026-04-21 Phase 4 Sales Module entry) explicitly says `safeAddColumn('sales_salary_computations', 'neft_exported_at', 'TEXT')` was added. **Either Phase 4 was not deployed to production, or the safeAddColumn migration didn't fire.** Same fragility applies to `payslip_generated_at`. This must be resolved before any UPSERT on `sales_salary_computations` runs — touching the column list via UPDATE is fine (we're only changing month/year), but it means the Phase 4 paid-status guardrail and audit stamps are not actually enforced in production. Verify by checking which migration flags are in `policy_config` and re-running `safeAddColumn` if needed.
  - **`sales_uploads` lookup mismatch.** Step 1.1-fix-B (`SELECT * FROM sales_uploads WHERE month=3 AND year=2026 AND company='Indriyan Beverages Pvt Ltd'`) returned **0 rows**, despite `sales_monthly_input` having 346 rows for the same filter (split across `upload_id=1` and `upload_id=2`). Two possible causes, both blocking: (a) Admin Query Tool's "Generated SQL" preview shows the company string truncated to `'Indriyan Beverages'` (no "Pvt Ltd") — this might be a display quirk OR a real query rewrite, AND (b) `sales_uploads.company` may store a different string than `sales_monthly_input.company` (e.g. `'Indriyan Beverages'` without suffix). If (b) is real, the migration UPDATEs need different WHERE clauses per table, AND the FK linkage between monthly_input and uploads is brittle. **Resolve first** with `SELECT DISTINCT company FROM sales_uploads;` and `SELECT id, month, year, company FROM sales_uploads WHERE id IN (1, 2);`.
  - **Two uploads exist for the same cycle.** `sales_monthly_input` Step 1.2-fix returned: upload_id=1 → 175 rows (166 distinct employees + 4 NULL employee_codes — i.e., low-confidence/unmatched parser rows, plus 5 duplicate employees in the same upload), upload_id=2 → 171 rows (167 distinct, 0 NULLs, 4 duplicates). Both `sales_uploads` rows must be migrated together. Original prompt's Step 5.6 (update `attendance_period_start/end`) is **unexecutable** anyway because those columns don't exist on `sales_uploads` (cycle dates are derived at read-time via `deriveCycle(month, year)` in `cycleUtil.js`, not stored). Drop Step 5.6 entirely from the plan.
  - **TA/DA tables MUST be migrated alongside salary tables** (user approved this scope expansion). `sales_ta_da_monthly_inputs` has 168 Mar 2026 Indriyan rows; `sales_ta_da_computations` has 168 (65 computed + 100 partial + 3 flag_for_review, all with `neft_exported=0` and `paid_count=0`). Phase α auto-trigger inside `POST /sales/compute` populated these. If we only migrate salary tables, the TA/DA register on Feb 2026 will be empty while Mar 2026 holds orphaned rows — split-brain.
  - **Original prompt's expected schema (`sales_diwali_ledger`, `sales_payslips`) does not exist in production.** Confirmed via `sqlite_master` enumeration. `sales_diwali_ledger` was dropped in the Q5 reversal hotfix on 2026-04-21 (gated migration `migration_drop_sales_diwali_ledger_v1` per CLAUDE.md). `sales_payslips` was never a real table — payslips render on-the-fly. The actual cycle-keyed sales tables are exactly 5: `sales_uploads`, `sales_monthly_input`, `sales_salary_computations`, `sales_ta_da_monthly_inputs`, `sales_ta_da_computations`.
- **Confirmed clean:**
  - No NEFT exports for Mar 2026 Indriyan in `sales_ta_da_computations` (all status groups: `neft_exported=0`).
  - No paid rows in `sales_ta_da_computations` (`paid_count=0` across `computed`/`partial`/`flag_for_review`).
  - `sales_salary_computations` Step 1.3 partial result: 164 rows, total_gross_monthly=42,50,733, total_gross_earned=38,08,882 (cut off in screenshot but visible). Paid/NEFT count for salary computations is **unverified** because the Step 1.3-fix query errored on the missing column; need an alternate query that uses only `status='paid'` (no `neft_exported_at` reference).
  - No `sales_%approv%` tables exist (Step 1.6 returned 0 rows).
  - 1 informational `audit_log` entry mentions Mar 2026 sales (will not be modified).
- **Unfinished work:**
  - Migration NOT executed. Steps 2 (collision check on Feb 2026), 3 (UNIQUE constraint discovery), 4 (backup tables), 5 (transactional UPDATEs + audit log entry), 6 (post-migration verification), 7 (UI smoke test) all PENDING.
  - Open questions list above must be resolved before any destructive operation runs.
  - User has chosen Option 1 (Railway CLI + sqlite3) as the execution path for Steps 4–5. They will need `railway login` + `railway link` working when next session resumes.
- **Known issues remaining (carried from prior sessions):**
  - Phase 4 fix E (block excess `days_given` validation) — final fix in 5-fix Phase 4 sequence, prompt not yet sent.
  - Smart "most-recent-cycle-with-data" default endpoint for the cycle picker — deferred follow-up.
  - URL persistence for cycle picker on Sales pages — not implemented; matches plant convention.
  - Phase 3 feature branch `claude/sales-phase3-tada-compute-nqe1h` still on origin awaiting deletion after smoke test.
  - All other items from the 2026-04-28 entry remain.
- **Next session should:** **(a) Resolve the three blockers above before re-attempting migration.** Run these queries in the Admin Query Tool: (1) `SELECT DISTINCT company FROM sales_uploads;` to learn the exact stored value, (2) `SELECT id, month, year, company FROM sales_uploads WHERE id IN (1,2);` to learn what the upload_id FK references, (3) `SELECT name FROM pragma_table_info('sales_salary_computations') WHERE name IN ('neft_exported_at','payslip_generated_at');` to confirm the missing-column situation. (4) `SELECT key FROM policy_config WHERE key LIKE 'migration_%';` to inventory which migrations have run. **(b)** If `neft_exported_at` is genuinely missing in production, decide whether to (i) ship the Phase 4 schema migration via Railway redeploy + restart so it runs through `safeAddColumn`, OR (ii) skip Phase 4 paid-guardrail concerns for this migration and patch later. **(c)** Once schema and company-string mysteries are resolved, rewrite the migration plan with corrected column names + WHERE clauses + the 5-table scope (incl. TA/DA), and write a Node migration script under `scripts/migrate_indriyan_mar_to_feb_2026.js` (committed to this branch) as a safer alternative to direct sqlite3 — the script can assert pre/post row counts in-code and rollback automatically on mismatch. **(d)** Brief HR not to use Sales Compute / Upload pages during the migration window.

---

## Section 0: Previous Session
- **Date:** 2026-04-28
- **Branch:** `main` at `e7496e7` (Phase 4 fixes A–D shipped; feature branch `claude/apply-hard-verification-rule-X0Tc3` retained on origin as recovery point)
- **Last commit:** `e7496e7` build(frontend): rebuild dist after sales upload cycle picker (Phase 4 fix D)
- **Files changed this session:**
  - `backend/src/routes/sales.js` — applied `requireAdmin` to POST/PUT/DELETE `/holidays` (fix A); flipped `/upload` cycle precedence to body-wins with parser-fallback + `console.warn` on fallback (fix D)
  - `frontend/src/pages/Sales/SalesEmployeeMaster.jsx` — auto-assign code on create: removed Code field on New form, kept read-only on Edit, success toast surfaces assigned `S###` (Bug Fix #1, pre-Phase-4)
  - `frontend/src/pages/Sales/SalesHolidayMaster.jsx` — gated Add/Edit/Delete buttons behind `isAdmin(user)`, added amber non-admin info banner (fix A)
  - `frontend/src/pages/Sales/SalesSalaryCompute.jsx` — split single "Gross ₹" column into "Gross ₹" (stated, `r.gross_monthly`) + "Earned ₹" (`r.gross_earned`); added `useDateSelector`+`<DateSelector>` cycle picker in both pre/post-compute branches (fixes B + C)
  - `frontend/src/pages/Sales/SalesUpload.jsx` — added `<CompanyFilter>`+`<DateSelector>` to UploadView header; subtitle rewritten to reflect picker-primary precedence (fix D)
  - `frontend/src/utils/api.js` — `salesTaDaNeftPreview` (Phase 3 step 5c-ii); `salesTaDaUpload` multipart helper (Phase 3 step 6); `salesTaDaEmployeeDetail`+`salesTaDaInputsPatch` already in but used widely this session
  - `frontend/src/utils/taDaClassLabels.js` — fixed `ratesForClass(1)` → `[da_rate]`; fixed `ratesForClass(5)` → all 4 fields; added new `labelForRate(key, classNum)` helper for class-aware labels (Bug Fix #2)
  - `frontend/dist/*` — rebuilt 7 times (one per source-commit batch + the merge-commits)
  - `CLAUDE.md` — this canonical Section 0 prepended on top of the 2026-04-27 entry
- **What was fixed/built:** Six independent fixes shipped to main, each with its own ff-merge commit and HARD VERIFICATION (commit SHA + origin SHA confirmed match before declaring done). Two bug fixes from earlier in the day (Sales employee code auto-assign at `160dab2`, TA/DA Request modal class-aware rate fields at `cfe7b4d`); then four Phase 4 fixes: A `7b90509` Sales Holiday Master locked to admin-only writes; B `7a474a6` salary register Gross/Earned split into two columns; C `2a538f4` salary register cycle picker (allows HR to navigate past cycles); D `0a76c4c` upload page cycle picker + backend body-wins precedence override.
- **What's fragile:**
  - **Backend `/sales/upload` cycle precedence flipped 2026-04-28.** `req.body.month/year/company` now wins over parser-detected. Range validation is hardcoded `month ∈ [1,12]`, `year ∈ [2024,2030]`. If a curl-style consumer passes invalid body values, handler silently falls back to parser — observable only via `[sales-upload]` console.warn in server log. If anyone refactors and accidentally restores parser-first, HR's explicit picker is silently ignored again.
  - **Cross-page cycle context is shared via `useAppStore.selectedMonth/selectedYear`.** Salary Register, Upload, and any future sales page using `useDateSelector({syncToStore:true})` write to the same global slot. Plant pages (Stage 7 SalaryComputation, etc.) ALSO sync to this slot — picking Mar 2026 on a sales page leaves plant pages on Mar 2026 too. Documented but easy to forget.
  - **Default cycle is "calendar month from store"** (current calendar default if first load). Smart "most recent cycle with computed data" default was deferred — needs a new backend endpoint (`GET /api/sales/most-recent-cycle?company=X`) and an auto-init effect.
  - **`SalesHolidayMaster.jsx` admin gate is UI-only safety net** — backend `requireAdmin` is the real enforcement. If frontend gate is bypassed (e.g., a future refactor accidentally drops the conditional), the backend still 403s with "Admin access required". Audit trail via `writeAuditP2()` (existing convention) writes `actionType: 'create'/'update'/'delete'` — NOT prompt-spec `'holiday_change'/'holiday_delete'` (kept consistent with rest of sales codebase).
  - **`gross_monthly` totals on register are computed client-side** via `rows.reduce(...)` inline — not in the backend `totals` object. If row paging is ever introduced, this will under-count. Today register endpoint returns all rows with no pagination, so it's correct.
  - **Audit trail for Sales Holiday writes is via `writeAuditP2`** — existing helper that uses `actionType: 'create'/'update'/'delete'`. Diverges from the prompt's illustrative `'holiday_change'/'holiday_delete'` strings; preserved existing convention. Filter audit_log by `table_name='sales_holidays'` to find holiday changes.
  - **Auto-assign code SQL** (`SUBSTR(code, 2)` + `CAST(... AS INTEGER)`) assumes single-letter prefix and integer body. Format is `'S' + n.padStart(3,'0')` for n<1000, then unpadded. Past 999 the format widens silently. If a future code format breaks the prefix assumption (e.g., 'SLS-001' with hyphens), the SQL silently re-issues from S001 — would crash on UNIQUE collision but with confusing error. Document the format invariant in CLAUDE.md.
  - **TA/DA Request modal `ratesForClass(1)` is now `['da_rate']` only.** Existing Class 1 employees with non-NULL values in `da_outstation_rate`/`ta_rate_primary`/`ta_rate_secondary` (legacy data from before fix shipped) will only be cleaned when HR submits a fresh change request that gets approved. No data migration was performed.
- **Unfinished work:**
  - **Phase 4 fix E** (block excess `days_given` validation) — final fix in the 5-fix Phase 4 sequence, prompt not yet sent. Each Phase 4 fix shipped independently per design.
  - **CLAUDE.md Section 0** for the 2 pre-Phase-4 bug fixes (Sales employee code auto-assign at `160dab2`, TA/DA conditional rate fields at `cfe7b4d`) was promised but never appended. The 2026-04-27 handoff entry covers Phase 3 only — these 2 fixes from earlier today are documented in this entry retroactively.
- **Known issues remaining:**
  - Phase 4 fix E (excess days validation) pending — separate ticket.
  - "Most-recent-cycle-with-data" default for the cycle picker — needs new backend endpoint, deferred follow-up.
  - URL persistence for cycle picker (e.g. `?month=3&year=2026` on Sales pages) — not implemented; matches plant convention. Refresh resets to global-store value.
  - `RATE_FIELD_LABELS` is still imported in `SalesTaDaApprovals.jsx:15` but unused (dead import). Trivial cleanup, low priority.
  - Phase 3 feature branch `claude/sales-phase3-tada-compute-nqe1h` still on origin awaiting production smoke test — delete after smoke passes.
  - Most master employees still have NULL `ifsc` → NEFT export excludes them with `X-Missing-Bank-Details` warning. By-design behavior.
- **Next session should:** (a) Production smoke test of fixes A through D on Railway: confirm HR can no longer see Add/Edit/Delete on Sales Holidays, admin can; verify Salary Register shows Gross + Earned columns with cycle picker; verify Upload page picker is visible and writes month/year to multipart form; verify cross-page cycle context syncs. (b) If smoke passes cleanly, ship Phase 4 fix E (block excess `days_given` validation) — final fix in the sequence. (c) Optional: append a one-line entry per fix to CLAUDE.md if you want individual-fix-level granularity in the doc rather than this rolled-up entry. (d) Optional: smart "most recent cycle with data" default endpoint for the picker.

---

## Section 0: Previous Session
- **Date:** 2026-04-27
- **Branch:** `main` (Phase 3 feature branch `claude/sales-phase3-tada-compute-nqe1h` retained as recovery point — NOT deleted)
- **Last commit:** `1d79d99` docs: Phase 3 session handoff (TA/DA compute + register + upload shipped)
- **Files changed this session:**
  - `frontend/src/pages/Sales/SalesTaDaRegister.jsx` — NEW (970 lines). Built across 4 split commits (5c-i skeleton → 5c-ii recompute+NEFT modals → 5c-iii Edit Inputs modal → 5c-iv Detail modal + per-employee recompute). Split was deliberate to dodge stream-timeout crashes that killed earlier attempts.
  - `frontend/src/pages/Sales/SalesTaDaUpload.jsx` — NEW (554 lines). 4 class tabs, client-side template generation via SheetJS, drag-drop, client-side parser preview, three-branch result handling (success / partial / parser_error).
  - `frontend/src/utils/cycleUtil.js` — NEW. Single source of truth for `cycleSubtitle()` — extracted from 3 inline duplicates in SalesSalaryCompute.jsx, SalesTaDaRegister.jsx, SalesTaDaUpload.jsx.
  - `frontend/src/utils/api.js` — added 6 helpers: `salesTaDaCompute`, `salesTaDaRegister`, `salesTaDaEmployeeDetail`, `salesTaDaInputsPatch`, `salesTaDaNeftPreview`, `salesTaDaUpload` (multipart). Excel/NEFT URL builders pre-existed from 5a.
  - `frontend/src/pages/Sales/SalesSalaryCompute.jsx` — replaced inline `cycleSubtitle` with import from cycleUtil.
  - `frontend/src/App.jsx` — 2 lazy imports + 2 routes for `/sales/ta-da-register` and `/sales/ta-da-upload`.
  - `frontend/src/components/layout/Sidebar.jsx` — 2 entries added to Sales section, gated `salesAllowed: true` (HR + admin only).
  - `frontend/dist/*` — rebuilt 4 times (separate commits, one per source-commit batch).
  - `CLAUDE.md` — Phase 3 narrative block prepended (commit `1d79d99`); this canonical Section 0 prepended on top of that.
- **What was fixed/built:** Completed Phase 3 frontend (Register page + Upload page + sidebar wiring + cycleUtil extract). Then merged feature branch into main via non-ff merge commit `75c1324` after a `git merge-tree` pre-check confirmed zero conflicts vs the one main-tip commit (`a978613` — unrelated OT-payable fix). Origin/main now at `1d79d99`.
- **What's fragile:**
  - **Phase 3 pages are unrouted at HR-test-time only on the feature branch's history**: the 12 Phase 3 commits in linear order have the routes wired only at step 7 (`c0bac2e`). If anyone bisects this range to debug a different bug, commits before `c0bac2e` will not surface the new pages even though the source files exist. Not a runtime issue — just a bisect gotcha.
  - **NEFT preview-then-download race**: `NeftConfirmModal` calls `salesTaDaNeftPreview` (download=false), then on Confirm opens `salesTaDaNeftDownloadUrl(...)` in a new tab via `window.open`. Backend stamps `neft_exported_at` synchronously when the URL is hit; if the user closes the tab before the download finishes, the stamp is still set. Same fragility as plant NEFT — not a regression, but document if HR reports "marked exported but I don't have the file".
  - **`cycleSubtitle` is now in 4 places' awareness**: cycleUtil.js (canonical), and 3 page files that import it. Backend has its own `deriveCycle` in `backend/src/services/cycleUtil.js`. If the (M-1)-26 → M-25 rule ever changes, BOTH frontend cycleUtil.js AND backend cycleUtil.js must update in lockstep. There's no automated cross-check.
  - **Edit Inputs modal cross-field validation** (in_city + outstation ≤ days_worked) reads `target.days_worked_at_compute` from the register row. If the register row is stale (e.g. someone PATCHed inputs in another tab and the register hasn't refetched), the validation could permit a sum that the server then rejects. The server is source-of-truth so the worst case is a 400 toast — but HR may be confused.
  - **Sidebar gate for new pages is `salesAllowed: true`** (HR + admin). Finance does NOT see Register or Upload — by design. If finance ever needs to view the register, the gate has to widen to `hrFinanceOrAdmin` AND the backend `requirePermission('sales-tada-compute')` has to widen too (or add a read-only `sales-tada-view` permission). Currently a deliberate restriction.
  - **The non-ff merge `75c1324` puts `a978613` (OT-payable fix) inside the Phase 3 commit range when viewed via `git log --oneline`**. It's correct topologically (second-parent ancestor) but visually surprising — looks like a Phase 3 commit at first glance.
- **Unfinished work:** None for Phase 3. All 7 steps shipped, merged, and pushed.
- **Known issues remaining:**
  - Production smoke test on Railway not yet performed (login → navigate to Register → click around).
  - No real Feb 2026 PAYABLE sheet from HR yet — without it, no ground-truth E2E validation of compute correctness.
  - Most master employees have NULL `ifsc` → NEFT export excludes them with `X-Missing-Bank-Details` warning header. HR must fill IFSC via Sales Employee Master before NEFT can include them. By-design behavior, not a bug.
  - `MONTHS` constant is now triplicated across `SalesTaDaRegister.jsx`, `SalesTaDaUpload.jsx`, `SalesSalaryCompute.jsx` (separate from the cycleUtil's own MONTHS). Low-priority follow-up extract.
  - Phase 3 feature branch `claude/sales-phase3-tada-compute-nqe1h` retained on origin as recovery point — delete only after production smoke test passes cleanly.
- **Next session should:** Run a production smoke test on Railway against `1d79d99`: (a) login as HR, navigate to Sales → TA/DA Register, verify cycle subtitle reads correctly for the current month/year, verify table renders even if empty, click Recompute → confirm → verify it doesn't 500; (b) Sales → TA/DA Upload, click each of the 4 class tabs, download the empty template for each, verify filename format `TADA_Class{N}_Template_{MMM}_{YYYY}.xlsx`; (c) NEFT preview button — verify the missing-bank-details list surfaces. If smoke passes, delete the feature branch and start Phase 4 planning (real Feb 2026 PAYABLE sheet validation + Master IFSC fill-in workflow).

---

## Last session: 2026-04-27 — Phase 3 (TA/DA Compute + Register + Upload) shipped

**Status:** Phase 3 complete. Merged to main. Production deploy on Railway in progress (or live, depending on Railway lag).

**What was built:**
- TA/DA compute engine (backend/src/services/salesTaDaComputation.js) — 5 class formulas, α/β phase logic, idempotent recompute, careful preservation rules
- 8 API endpoints under /api/sales/ta-da/* — compute, register (paginated + filters + totals), employee detail, inputs PATCH, class-template upload, Excel/NEFT/payslip exports
- Phase α auto-trigger inside POST /api/sales/compute — TA/DA recomputes after salary compute, isolated in try/catch so TA/DA failure never blocks salary
- Upload parser (backend/src/services/salesTaDaUploadParser.js) — class-aware header detection, all-or-nothing semantics, per-row validation
- Register page (frontend/src/pages/Sales/SalesTaDaRegister.jsx, 970 lines) — table, filters, exports, 4 modals (Recompute, NEFT confirm, Edit Inputs, Detail)
- Upload page (frontend/src/pages/Sales/SalesTaDaUpload.jsx, 554 lines) — 4 class tabs, client-side template generation, drag-drop, parser preview, three-branch result handling
- Routes wired in App.jsx, sidebar entries gated by salesAllowed (HR + admin only)
- Shared util frontend/src/utils/cycleUtil.js — extracted cycleSubtitle from 3 inline duplicates

**Critical preservation rules (do not widen):**
- Phase α re-run preserves ONLY input fields (in_city_days, outstation_days, total_km, bike_km, car_km, notes, source, source_detail) when existing source IN ('upload', 'manual'). Outputs in sales_ta_da_computations are ALWAYS fully recomputed — every snapshot column re-read fresh, every amount re-computed using current class formulas and rates.
- Only audit-trail metadata (neft_exported_at, neft_exported_by, paid_at) carries forward across recomputes.
- Class change between α and β: re-snapshot at compute time. Old amounts overwritten with new class's formula. computation_notes records the change.

**Decisions locked during build:**
- All-or-nothing template uploads (reject entire upload if any row errors)
- POST /sales/ta-da/compute supports ?employeeCode=X for per-row recompute
- NEFT mixed-case names (no .toUpperCase) — matches plant generateBankFile convention
- Partial-failure HTTP status: 200 with success:false (NOT 207) — frontend-friendly
- Holidays NOT added for TA/DA (different from salary semantics — design doc §11)
- Sidebar gate for new pages: salesAllowed (HR + admin only). Finance reaches exports via direct URL or via TA/DA Approvals page.

**Known caveats for HR:**
- Most master employees have NULL ifsc → NEFT export excludes them with X-Missing-Bank-Details warning header. HR must fill IFSC for affected employees via Sales Employee Master before NEFT can include them. This is by-design behavior, not a bug.
- "Recompute Cycle" button is intentionally protected by a confirmation modal because it overwrites all computation rows in the cycle (preserving input fields for source IN upload/manual, but recomputing all outputs).
- Phase α status outcomes per class: Class 0 → flag_for_review; Class 1 → computed (auto, no inputs needed); Classes 2/3/4/5 → partial (until Phase β inputs received via PATCH or upload).

**Files for reference / authoritative spec:**
- docs/sales_consolidated_design.md (in repo) — full spec for cycle rule + 5-class TA/DA model + workflow
- frontend/src/utils/taDaClassLabels.js — class labels + status badge classes (single source of truth for UI labels)
- frontend/src/utils/cycleUtil.js — cycleSubtitle helper (shared)

**Operational lessons from this build:**
1. Push verification after every commit is non-negotiable. We had two phantom-commit losses (commits committed locally but never pushed despite the session reporting otherwise). Fix: enforce git push origin <branch> + git rev-parse origin/<branch> + SHA match before proceeding to next step.
2. Stream-timeout crashes happened repeatedly on file-creation operations of large files (compute engine, register page, parser file). Workaround: split large files into smaller per-turn commits. Register page was split into 5c-i (skeleton) → 5c-ii (modals) → 5c-iii (Edit modal) → 5c-iv (Detail modal). Each turn smaller = lower timeout risk.
3. Model selector vigilance: Claude Code occasionally drops to <synthetic> or 1M variants mid-session, both of which had higher crash rates today. Always check the bottom-right model picker and confirm "Opus 4.7" before sending file-creation prompts.
4. Per-step HARD VERIFICATION RULE saved Phase 3 from joining its lost predecessor. Apply it to every multi-commit phase going forward.

**Remaining for Phase 4:**
- E2E test against the real Feb 2026 PAYABLE sheet (HR has not yet uploaded this — without it, no ground truth for compute correctness validation against expected payable amounts)
- Bug triage from production smoke test (login, navigate to Register, click around)
- Master IFSC fill-in workflow (touchpoint: HR opens Sales Employee Master → edit individual employee → bank details fields → save → re-verify NEFT export)
- Optional: extract MONTHS constant to shared util (currently triplicated, low priority)

---

## Section 0: Previous Session
- **Date:** 2026-04-25
- **Branch:** `main` (fast-forwarded to `141200a` via `claude/sales-cycle-ta-da-migration-WSdAZ` → main → `claude/sales-phase2` → main; both feature branches merged)
- **Last commit:** `141200a` Add files via upload (corrected `sales_master_import.sql` — schema-aligned)
- **Files changed this session (across 3 sub-tasks: Phase 1, Phase 1b, Phase 2):**
  - `backend/src/services/cycleUtil.js` — NEW. `deriveCycle(month, year)` returns `{start, end, lengthDays}` for the 26→25 sales salary cycle. UTC-int arithmetic, no locale dependency. Inline smoke tests cover Feb/Mar 2026, Jan year-rollover, Mar 2024 leap-year, dateInCycle boundaries.
  - `backend/src/services/sundayRule.js` — added `calculateSundayCreditFromCycle()` wrapper that derives totalSundays/workingDays from cycle dates and delegates to existing `calculateSundayCredit()`. Tier logic byte-unchanged.
  - `backend/src/services/salesSalaryComputation.js` — `computeSalesEmployee()` signature gained `cycleStart`/`cycleEnd` params (required); internals swapped month-bounds → cycle-bounds for calendarDays/Sunday count/holiday filter; UPSERT extended 43→45 columns (added `cycle_start_date`, `cycle_end_date`); ON CONFLICT updates 42 mutable cols + computed_at.
  - `backend/src/services/taDaChangeRequest.js` — NEW. Service layer for the TA/DA workflow. Exports: `createRequest`, `approveRequest`, `rejectRequest`, `cancelRequest`, `listRequests`, `getRequestsByEmployee`, `getRequestById`, `countPending`. Enforces self-approval guard, supersede-previous-pending in single txn, already-resolved guard, approve atomicity (sales_employees + request flip in one txn).
  - `backend/src/middleware/roles.js` — added `requirePermission(...perms)` factory (OR-semantics). Reuses `normalizeRole` + `hasPermission`. Existing exports unchanged.
  - `backend/src/routes/sales.js` — 8 new TA/DA endpoints registered BEFORE `router.use(requireHrOrAdmin)` (line ~25) so finance can reach approve/reject. Each route carries its own `requirePermission(...)` gate. Existing routes after the gate are byte-identical. `POST /compute` calls `deriveCycle(month, year)` and threads `cycleStart`/`cycleEnd` into the compute call.
  - `backend/src/database/schema.js` — three migration blocks added: (1) Phase 1 — 9 TA/DA columns on `sales_employees` + 2 cycle columns on `sales_salary_computations` + 3 TA/DA tables (change_requests / monthly_inputs / computations) + 5 indexes + cycle backfill (gated `migration_sales_cycle_backfill_v1`); (2) Phase 1b — DROP+CREATE rebuild of the 3 TA/DA tables to match design doc §2.4/§2.5/§2.6 (gated `migration_tada_schema_v2_done`, safety-checks empty tables before drop, foreign_keys=OFF/ON wrap); (3) Phase 2 — bootstrap master-data import from `/sales_master_import.sql` (gated `migration_sales_master_import_v1`).
  - `backend/src/config/permissions.js` — 4 new permissions registered: HR gets `sales-tada-request`/`sales-tada-compute`/`sales-tada-payable-export`; finance gets `sales-tada-approve`/`sales-tada-payable-export`.
  - `frontend/src/utils/api.js` — 8 helpers: `salesTaDaRequestsList`, `salesTaDaRequestsPendingCount`, `salesTaDaRequestsByEmployee`, `salesTaDaRequestGet`, `salesTaDaRequestCreate`, `salesTaDaRequestApprove`, `salesTaDaRequestReject`, `salesTaDaRequestCancel`.
  - `frontend/src/utils/taDaClassLabels.js` — NEW. Class labels (0–5), `classLabel()`, `ratesForClass()` (which rate fields are relevant per class — drives modal show/hide), `RATE_FIELD_LABELS`, `STATUS_BADGE`, `relativeTime()` helper.
  - `frontend/src/pages/Sales/SalesEmployeeMaster.jsx` — added "TA/DA" column with class label + amber "Pending" pill, "Request TA/DA" + "History" row actions, `TaDaRequestModal` component (class dropdown, rate inputs that show/hide via `ratesForClass()`, mandatory reason textarea), `TaDaHistoryModal` (chronological list, status badges, old→new diff per row, "Cancel my request" button visible only to original requester for pending rows).
  - `frontend/src/pages/Sales/SalesTaDaApprovals.jsx` — NEW. Route `/sales/ta-da-approvals`. Lists requests with status filter dropdown. One-line `ChangeSummary` collapses to `FullDiffTable` on expand. Approve via `ConfirmDialog`; Reject via modal with required `rejection_reason`. Self-approve buttons disabled with tooltip when current user is the requester. Backend 403/409 surfaced via toast + auto-refresh.
  - `frontend/src/pages/Sales/SalesSalaryCompute.jsx` — added `cycleSubtitle()` helper rendering "Cycle: Jan 26, 2026 – Feb 25, 2026 (31 days)" beneath the existing month/year subtitle in both pre-compute and post-compute views. Client-side JS kept in lockstep with backend `deriveCycle()`.
  - `frontend/src/components/layout/Sidebar.jsx` — Phase 2 navigation pivot: parent "Sales" gate widened from `salesAllowed` (hr+admin) to `hrFinanceOrAdmin`; existing 4 children carry their own `salesAllowed` so finance only sees the new entry; new child "TA/DA Approvals" with `tadaApprover` (finance+admin) gate and `<TaDaPendingBadge>` polling `/pending-count` every 60s.
  - `frontend/src/App.jsx` — lazy-import + route for `/sales/ta-da-approvals`.
  - `frontend/dist/*` — rebuilt via `npm run build`. New chunks: `SalesTaDaApprovals-*.js`, `taDaClassLabels-*.js`. Other chunks rotated due to hash changes.
- **What was fixed/built:** Three connected sub-tasks shipped this session.
  (1) **Phase 1 — Sales Cycle Refactor + TA/DA Schema** (5 commits, merged to main at `352fee2`). Switched sales salary compute from calendar-month to a 26→25 cycle (`(M-1)-26 … M-25`). Pure-function `cycleUtil.js` exports `deriveCycle`/`cycleLengthDays`/`countSundaysInCycle`/`dateInCycle`. Plant pipeline byte-untouched. Added the TA/DA Phase 1 schema (9 cols on `sales_employees`, 2 cols on `sales_salary_computations`, 3 new tables, 5 indexes, idempotent cycle backfill). Permissions registered.
  (2) **Phase 1b — TA/DA schema patch** (1 commit, merged at `352fee2` via fast-forward). Rebuild the 3 TA/DA tables to match the canonical design doc — column renames (`requested_*`→`new_*`, `prev_*`→`old_*`, `reviewed_*`→`resolved_*`, `days_local`→`in_city_days`, `km_primary`/`km_secondary`→`total_km`/`bike_km`/`car_km`), source enum CHECK on monthly_inputs, status enum on computations rewritten to `computed/partial/flag_for_review/paid` (load-bearing for the eventual two-phase compute model). Safety check refused to drop if any table had rows; all empty per Phase 1 verification, so DROP+CREATE was clean.
  (3) **Phase 2 — TA/DA Module 1 (Rates + Approval Workflow) + Master Data Load** (4 commits, merged to main at `1b35d8e` via rebase + fast-forward push). Backend service + 8 endpoints with self-approval guard, supersede-in-single-txn, 409-on-already-resolved, approve atomicity. Frontend: TA/DA block on employee master with pending pill + request/history modals, dedicated approvals queue page with diff table and confirm/reject flow, navbar pending-count badge polling every 60s. Master-data bootstrap migration loads `/sales_master_import.sql` (idempotent, skips silently if file missing). Initial SQL file uploaded by user had column name drift (`city`/`is_active`/`basic_monthly`/etc); user regenerated the file (`141200a` on main) and the migration now imports 167 rows cleanly: class distribution 1=65, 3=77, 4=23, 5=2, plus 167 matching `sales_salary_structures` rows tagged with the bootstrap sentinel.
- **What's fragile:**
  - **`computeSalesEmployee` signature** is now strictly `cycleStart`/`cycleEnd` required. Any future caller that forgets to call `deriveCycle()` first gets `{success: false, error: 'cycleStart and cycleEnd are required (Phase 1 cycle refactor)'}`. The single existing call site (`backend/src/routes/sales.js:907`) is correct; if a Phase-3 cron/scheduler is added, mind this contract.
  - **Sales router gate ordering** in `backend/src/routes/sales.js`: TA/DA routes are registered BEFORE `router.use(requireHrOrAdmin)` (line ~25). If a future PR refactors this file or moves the `router.use(...)` line, the 7 finance-facing endpoints will silently start 403'ing. Comment block at the top of the TA/DA section warns about this; preserve it.
  - **`requirePermission` is OR-semantics** — read endpoints accept either `sales-tada-approve` OR `sales-tada-request`. If a future role is added (e.g. "auditor") that should see requests but not act, that role just needs one of those permissions in `permissions.js`. The middleware is in `backend/src/middleware/roles.js`.
  - **Sidebar pivot** widens the parent "Sales" gate from HR+admin to HR+finance+admin. Finance now sees the parent, but the 4 existing children carry their own `salesAllowed` gate so finance sees only the "TA/DA Approvals" child. Net effect for HR/admin: zero new visible items. For finance: new section with one child. If a future PR adds a child to the Sales section without thinking about role gating, finance might see HR-only screens.
  - **Self-approval guard layering**: HR users hit the permission gate ("Requires one of: sales-tada-approve") before the service-layer self-approval check ("cannot resolve your own request"). The service-layer message only fires for admin (the only role with both create + approve permissions). Both are 403 — semantically correct but the error string differs. Tests cover both layers.
  - **Cycle-aware backfill migration** writes `cycle_start_date`/`cycle_end_date` on existing `sales_salary_computations` rows by re-running `deriveCycle(month, year)` from those rows' month/year. If a row has historically wrong month/year values, the backfill stamps a bogus cycle. Sandbox had 0 rows to backfill so this didn't matter; flag for production verification post-deploy.
  - **`sales_master_import.sql` placement** is sensitive: migration uses `path.join(__dirname, '..', '..', '..', 'sales_master_import.sql')` to resolve to repo root from `backend/src/database/`. Any change to the directory depth of `db.js` or `schema.js` breaks the path. Migration safely skips on file-not-found.
  - **Phase 1b TA/DA tables: status CHECK on `sales_ta_da_computations`** is `('computed','partial','flag_for_review','paid')` — load-bearing for Phase 3's two-phase compute model. The Phase 1 status enum (`computed/reviewed/approved/rejected/paid`) is GONE; any code that tries to insert with those old values will hit a CHECK violation. Validation tested all 7 cases (4 NEW pass, 3 OLD fail).
  - **`sales_employees` Phase 2 master rows** all have `status='Active'` and `ta_da_class` set per the SQL; the bootstrap sentinel `ta_da_updated_by='master_import_2026-04-24'` is the canonical filter for "imported as part of initial batch" — don't change this string in the SQL or migration without also updating consumers.
  - **`sales_salary_structures` master rows** tagged `created_by='master_import_2026-04-24'` parallel the employees. 167 rows, one per master employee. Phase 3 compute will read these via `getLatestStructure()` (which orders by `effective_from DESC`).
  - **Pre-existing schema warning** still appears on every boot, unchanged: `[MIGRATION] miss-punch finance queue backfill failed: no such column: miss_punch_finance_status`. Loud-but-harmless; the migration block is in try/catch. Out of scope for this session, log for cleanup later.
- **Unfinished work:** None for the 3 sub-tasks shipped. Phase 3 (TA/DA monthly compute pipeline + UI) is the next logical step but explicitly out of scope here.
- **Known issues remaining:**
  - Pre-existing: `[MIGRATION] miss-punch finance queue backfill failed` log on every boot — unrelated, see above.
  - Pre-existing: 5 npm vulnerabilities in backend deps (2 moderate, 3 high) surfaced by `npm install` — out of scope.
  - Pre-existing: html2pdf chunk is 982 kB, exceeds Vite's chunk-size warning threshold — out of scope.
  - Pre-existing: `SalesEmployeeMaster.jsx` still has a "Bulk Import" disabled placeholder button labelled "coming in Phase 2" — Phase 2 shipped the master-data bootstrap via SQL migration not via this button, so the placeholder is misleading. Trivial cleanup for next session.
  - Sandbox DB has 0 user rows; Phase 2 API tests used a header-stub middleware to simulate roles. Production deploy needs real HR + finance users to exercise the JWT-gated path end-to-end.
- **Next session should:** (a) Verify on Railway with real auth that (i) HR can submit a TA/DA change request from `/sales/employees`, (ii) finance can approve via `/sales/ta-da-approvals` and the employee row updates immediately, (iii) the navbar badge increments/decrements correctly with 60s polling, (iv) the cycle subtitle on `/sales/compute` reads "Jan 26, 2026 – Feb 25, 2026 (31 days)" for selectedMonth=2/year=2026. (b) Verify on Railway that the master-data migration ran cleanly post-deploy: 167 employees + 167 structures with the bootstrap sentinel, migration flag set. (c) Decide whether to address the pre-existing `miss-punch finance queue` migration warning. (d) Begin Phase 3 (TA/DA monthly compute pipeline) — read `sales_consolidated_design.md` §3 / §4 / §5 (now committed at repo root) for the spec.

---

## Section 0: Previous Session
- **Date:** 2026-04-23
- **Branch:** `claude/fix-verify-button-punches-O1DPi` (pushed; fast-forwarded to `origin/main` at `aed502f`)
- **Last commit:** `aed502f` feat(stage-5): Pre-Biometric Activation ED grants for new joiners
- **Files changed this session:**
  - `backend/src/routes/extraDutyGrants.js` — new `POST /pba` endpoint (atomic placeholder+grant insert, validates DOJ/first-punch window, remarks≥10, duty_days∈{0.5,1.0}); extended `POST /:id/finance-reject` to revert PBA placeholder `attendance_processed` back to `status_final='A'` when a `PRE_BIOMETRIC_ACTIVATION` grant is rejected (wrapped in txn with the grant update).
  - `backend/src/routes/attendance.js` — `GET /register` now returns top-level `pba_window: { doj, first_punch_date, company }` when `employeeCode` is supplied; omitted otherwise.
  - `backend/src/routes/payroll.js` — both `approvedGrants` SELECTs (inside the protected 138–190 block) filter `grant_type != 'PRE_BIOMETRIC_ACTIVATION'` so PBA days flow through `daysPresent` via the placeholder, not through `manualExtraDutyDays`/`financeEDDays` (Option B, authorized).
  - `frontend/src/pages/AttendanceRegister.jsx` — new `PBAGrantModal` component (date readonly, duty_days radio 1/0.5, remarks textarea w/ 10-char counter); grid cells that are empty AND inside the PBA window render indigo w/ "+ ED" label and are clickable; new `pbaMutation` invalidates the per-employee register query on success.
  - `frontend/src/pages/FinanceVerification.jsx` — added "Review" button (before existing Verify/Flag) on `unverified_miss_punches` red-flag cards; switches tab to `misspunch` + `scrollIntoView` on `#miss-punch-emp-${employee_code}`; added that `id` anchor to the Miss Punch Review `<tr>`. Other red-flag types and all other buttons unchanged.
  - `frontend/src/utils/api.js` — new `createPBAGrant(data)` helper.
  - `frontend/dist/*` — rebuilt via `npm run build`.
- **What was fixed/built:** Two bugs shipped. (1) Finance Verification → Red Flags: the Verify button on `unverified_miss_punches` cards wrote to `finance_audit_status` but the detector queries `attendance_processed.miss_punch_finance_status`, so cards reappeared on refresh. Added a Review button that jumps to the correct Miss Punch Review tab. (2) Stage 5 Corrections: new-joiner days between DOJ and first biometric punch had no `attendance_processed` rows → cells unclickable. Added `PRE_BIOMETRIC_ACTIVATION` grant type that atomically creates a placeholder P/½P row + a PENDING grant, routed through the existing HR→Finance dual-approval flow. Finance rejection reverts the placeholder to 'A'.
- **What's fragile:**
  - The PBA revert block in `extraDutyGrants.js POST /:id/finance-reject` only fires when BOTH `grant_type='PRE_BIOMETRIC_ACTIVATION'` AND `linked_attendance_id IS NOT NULL`. Any future code path that creates a PBA grant without stamping `linked_attendance_id` will leak a phantom P-day that never reverts on rejection. The new POST /pba always stamps it — but it's a correctness coupling to remember.
  - `payroll.js:153-160` and `payroll.js:185-192` both gained `AND grant_type != 'PRE_BIOMETRIC_ACTIVATION'`. If a future grant_type is added that ALSO flows through a placeholder `attendance_processed` row, the same exclusion must be applied — otherwise `financeEDDays` will double-count. This is inside the "DO NOT MODIFY" lines 138-190 range per the original task spec; touched only because the Phase 3 expected output required it (Option B was explicitly approved).
  - PBA modal uses `pbaWindow.company` from the register response; falls back to `selectedCompany` from Zustand. If both are null (employee has no company on record AND global filter is "All"), the backend returns 400 "Missing required fields". Rare but possible for brand-new employees not fully onboarded.
  - Scroll-to-row on the Finance Verification Review button uses `setTimeout(100ms)` before `scrollIntoView` — because the Miss Punch Review query is `enabled: activeTab === 'misspunch'` so it only fires after the tab switch. 100ms may be tight on slow networks; the `?.` chain makes it a no-op if the row isn't mounted (user has to scroll manually). Acceptable for v1.
  - The `#miss-punch-emp-${employee_code}` anchor lands on the FIRST `<tr>` for that employee when they have multiple miss punches in the same month. Harmless — `getElementById` returns first match — but worth knowing if someone wants to scroll to a SPECIFIC punch later.
- **Unfinished work:** Phase 3 + Phase 4 validation SQL (sanity queries on `attendance_processed` + `day_calculations` + `salary_computations` drift) is printed in the task spec but was NOT run — requires a real new-joiner test case on Railway. Must be executed post-deploy before declaring Stage-5 PBA workflow production-ready.
- **Known issues remaining:**
  - Pre-existing: `SalesSalaryCompute.jsx:28` `ALLOWED_MOVES` drift vs backend `ALLOWED_STATUS_MOVES` in `sales.js:842` (missing `hold → finalized`). Sales Phase 5 cleanup.
  - Pre-existing: `sales_diwali_ledger` reversal design doc still not committed; Q5-reversal rewrite pending.
  - Pre-existing: bulk payslip download (`GET /payroll/payslips/bulk`) returns 403 by policy — disabled intentionally.
  - Pre-existing: 10 npm audit vulnerabilities (5 moderate, 4 high, 1 critical) in frontend deps — surfaced by `npm install` this session.
- **Next session should:** (a) run the Phase 3 + Phase 4 validation SQL on Railway with a real pre-biometric-activation new joiner (seed PBA grant → HR approve → Finance approve → calculate-days → verify `days_present` includes the PBA date, `finance_ed_days` does NOT, drift=0 on `salary_computations`); (b) test the Finance Verification Review button UX — verify `unverified_miss_punches` cards show three buttons, Review switches tab + scrolls, `returning_employee` cards still show only 2 buttons; (c) HR demo: click a frozen April 1-12 cell for ROHIT TARIYAL (23738) and confirm the PBA modal opens with the date pre-filled; (d) if HR reports "+ ED" cells aren't appearing, check `employees.date_of_joining` is set for that employee — the PBA window is null when DOJ is missing.

---

## Section 0: Previous Session
- **Date:** 2026-04-21
- **Branch:** `claude/sales-module-phase-4-w4Spu` (pushed; not yet merged to `origin/main`)
- **Task:** Sales Salary Module Phase 4 — Excel + NEFT exports, payslip PDF, paid-status guardrail.
- **Phase 4 delivered:**
  - **Schema (additive only):** `safeAddColumn('sales_salary_computations', 'neft_exported_at', 'TEXT')` and `safeAddColumn('sales_salary_computations', 'payslip_generated_at', 'TEXT')`. Both are write-once-per-action audit stamps — never minted by `computeSalesEmployee`; only the NEFT export endpoint and the GET `/payslip/:code` handler mint them.
  - **`salesSalaryComputation.js` UPSERT** extended from 41 columns → 43 (INSERT list + placeholders + ON CONFLICT UPDATE + param list all lined up; grep-verified 43=43=43). `computeSalesEmployee` now pre-reads `neft_exported_at`/`payslip_generated_at` from the prior row and carries them forward so recompute never wipes an audit stamp. Confirmed via smoke: row flipped to `paid` → recomputed → stamps preserved.
  - **`backend/src/services/salesExportFormats.js` (new):** `generateSalesExcel(db, month, year, company)` and `generateSalesNEFT(db, month, year, company)`. Uses existing `xlsx@0.18.5` community build — no new deps. Excel output: 38-column layout matching HR's Feb 2026 sheet format (Code → IFSC), frozen header row via `!freeze` + `!views`, column widths via `!cols`. Cell-level styling (bold, fills, number formats) intentionally omitted — community SheetJS doesn't render those reliably. NEFT CSV header is **byte-identical** to plant's `generateBankFile` so the same bank upload pipeline accepts both. Filename prefixes: `Sales_Salary_Register_*` and `Sales_Bank_Salary_*`. NEFT filter: `net_salary > 0 AND status != 'hold'` (sales' equivalent of plant's `salary_held = 0`). Return object includes `eligibleIds[]` which the route consumes to stamp `neft_exported_at` in the same txn.
  - **`backend/src/routes/sales.js`:** 2 new endpoints appended at the end (inherit Phase 1's router-level `requireHrOrAdmin`):
    - `GET /api/sales/export/salary-register?month&year&company[&download=true]` — JSON preview (rowCount, totals, employees[]) without `download=true`, streams XLSX buffer with Content-Disposition when `download=true`.
    - `GET /api/sales/export/bank-neft?month&year&company[&download=true]` — JSON preview (with `missing[]` surfacing employees lacking bank details) without `download=true`, streams CSV + stamps `neft_exported_at` for every row in `eligibleIds[]` when `download=true`. Stamp + file gen wrapped in a single `db.transaction` so partial failure doesn't half-write the audit flag. Writes an audit_log row (`action_type='neft_export'`).
  - **Paid guardrail on existing `PUT /salary/:id/status`:** after transition validation, if the target is `paid` and the row's `neft_exported_at` is NULL, returns 400 with `'Cannot mark paid: NEFT file has not been exported for this employee yet. Export Bank NEFT first.'` Smoke-tested: 400 before NEFT export → 200 after.
  - **Payslip audit stamp on existing `GET /payslip/:code`:** after the payload is assembled successfully, fires a best-effort `UPDATE ... SET payslip_generated_at = datetime('now')` in a try/catch so audit failure never breaks payslip delivery.
  - **`permissions.js`:** appended `'sales-exports'` to the `hr` array (admin inherits via `*`). Finance role unchanged — Phase 4 is HR-initiated, finance has no export rights.
  - **`frontend/src/utils/salesPayslipPdf.js` (new):** client-side PDF renderer. Mirrors plant's `payslipPdf.js` pattern — builds an HTML string off-DOM, uses `html2pdf.js` (existing frontend dep, already pulled in by plant payslip) to produce a downloadable PDF. Layout: company header + "SALARY SLIP — Month Year", 6-cell identity block (Code/Name/Designation/Manager/HQ/CityOfOperation/DOJ), 8-cell days block (Days Given/Paid Sundays/Holidays/Earned Leave/Total Days/Calendar Days/Earned Ratio), side-by-side Earnings + Deductions tables (zero-amount rows filtered out), big green Net Salary callout, optional bank details block, footer with generation/computed/finalized timestamps. **Watermark:** `position:absolute; transform:rotate(-30deg); color:rgba(220,38,38,0.18); z-index:10` saying "NOT VALID · DRAFT" overlaid when `status NOT IN ('finalized', 'paid')`. Filename: `Payslip_<code>_<Month>_<Year>.pdf`.
  - **`frontend/src/utils/api.js`:** 2 helpers — `salesExportExcel(params, download=false)` and `salesExportNEFT(params, download=false)`. Both auto-switch between JSON preview mode and `responseType:'blob'` download mode.
  - **`frontend/src/pages/Sales/SalesSalaryCompute.jsx`:** the 2 previously-disabled "Export Excel" / "Export Bank NEFT" buttons are wired up. NEFT flow: preview-first → if `missing[]` non-empty, open a modal listing employees with missing bank details and ask to confirm exclusion → on confirm, fetch download blob, invalidate the register query so `neft_exported_at` propagates. New inline "✓ NEFT sent" chip next to the status dropdown when `neft_exported_at` is set. The "paid" `<option>` in the status dropdown is `disabled={paidBlocked}` with "(export NEFT first)" suffix when the row hasn't been exported — mirrors the backend guardrail.
  - **`frontend/src/pages/Sales/SalesPayslip.jsx`:** "Print / Save PDF" button replaced with "Download PDF" (calls `downloadSalesPayslipPDF(d)` from the new util). On-screen diagonal "NOT VALID · DRAFT" watermark added (same gate: status NOT IN finalized/paid). Small rose-coloured "DRAFT — not valid" badge appears next to the status pill in the top bar when draft. `useState(pdfBusy)` hoisted above the early returns to respect the Rules of Hooks.
- **What was verified (Phase 4):**
  - Precondition re-check post-build: 6 sales tables intact (no `sales_diwali_ledger`), `diwali_recovery` kept dead, hotfix flag `migration_drop_sales_diwali_ledger_v1=1` intact, 2 new columns present.
  - **Plant NEFT regression:** pre-build md5 of `/api/reports/bank-salary-file?month=3&year=2026&company=Asian%20Lakto%20Ind%20Ltd&download=true` is `ab039504dadedf05c9579c861959ba89`. Post-build md5 **identical** — plant code is untouched (`git diff backend/src/services/exportFormats.js backend/src/routes/reports.js` = empty).
  - Excel export: seeded 1 sales employee + 1 structure + 1 matched upload + 1 monthly_input (days=25, gross=20k), ran Phase 3 compute → `POST /export/salary-register?download=true` returned valid `.xlsx` (`file` reports "Microsoft Excel 2007+"), parsed with xlsx → **38 columns match the spec exactly**: Code, Name, HQ, State, Reporting Manager, Designation, Days Given, Paid Sundays, Gazetted Holidays, Earned Leave, Total Days, Calendar Days, Earned Ratio, Basic (M), HRA (M), CCA (M), Conveyance (M), Gross (M), Basic (E), HRA (E), CCA (E), Conveyance (E), Gross (E), PF Employee, ESI Employee, PT, TDS, Advance Recovery, Loan Recovery, Other Deductions, Total Deductions, Diwali Bonus, Incentive, Net Salary, Status, Bank Name, Account Number, IFSC. Data row values match the Phase 3 compute output (earned ratio 29/30 = 0.9667, basic_earned = 10000 × 0.9667 = 9666.67, gross_earned = 19333.33, PF = 1160, net = 18173.33).
  - NEFT export: `GET /export/bank-neft?download=true` returned CSV with header **byte-identical** to plant: `Sr No,Beneficiary Name,Account Number,IFSC Code,Date of Joining,Amount,Narration`. Narration: `SALARY APR 2026` (correct uppercase MMM YYYY). DOJ: `15/01/2025` (correct DD/MM/YYYY). Amount: `18173.33` (2-decimal). After the call, `SELECT neft_exported_at FROM sales_salary_computations WHERE employee_code='P4SMOKE'` returned `'2026-04-21 16:43:51'`.
  - Paid guardrail: moved row computed → reviewed → finalized. Before NEFT export: `PUT /salary/1/status {"status":"paid"}` returned HTTP 400 with exact error `Cannot mark paid: NEFT file has not been exported for this employee yet. Export Bank NEFT first.`. After NEFT export: same PUT returned HTTP 200, status flipped to `paid`. audit_log row written.
  - Payslip GET side-effect: hit `/sales/payslip/P4SMOKE?month=4&year=2026&company=...` → `payslip_generated_at='2026-04-21 16:44:12'` stamped. The pre-read + carry-forward path tested next.
  - **UPSERT completeness (recompute preservation):** BEFORE recompute: `(neft_exported_at='2026-04-21 16:43:51', payslip_generated_at='2026-04-21 16:44:12', status='paid')`. Ran `POST /sales/compute` (which normally would wipe unspecified columns in the UPSERT). AFTER recompute: stamps unchanged — **preserved**. UPSERT column list count = placeholder count = param count = 43 (grep-verified).
  - Permission gate: finance JWT → 403 `HR or admin access required` on both `/api/sales/export/salary-register` and `/api/sales/export/bank-neft`.
  - Frontend build: clean, 5 Sales chunks emitted (SalesEmployeeMaster, SalesHolidayMaster, SalesUpload, SalesSalaryCompute, SalesPayslip). `salesPayslipPdf.js` inlined into SalesPayslip chunk (grep confirms "NOT VALID" string present in the bundle). html2pdf.js and jspdf already split into shared chunks by the plant — no new deps.
- **What's fragile (Phase 4):**
  - **Excel styling**: community `xlsx@0.18.5` doesn't render cell `cell.s` styles, so bold headers and ₹ currency format on money columns won't show up even though the values are correct. HR will see plain numbers with a frozen header row + sized columns. If HR asks for coloured/bold headers, switch to `xlsx-js-style` (a community fork that ships with style support) OR upgrade to SheetJS Pro — both require a dep bump so held out.
  - **NEFT stamp is permissive**: `neft_exported_at` stamps on every `?download=true` call — there's no "already-exported" check. Re-exporting the same month/company overwrites the timestamp. Intended for idempotent re-runs (bank lost the file, HR re-downloads), but means the audit trail is "last export time" not "first". If HR wants first-export immutability, guard with `WHERE neft_exported_at IS NULL` in the UPDATE and let re-downloads skip the stamp.
  - **Paid guardrail ≠ atomic with NEFT download**: `neft_exported_at` is stamped when the CSV is generated on the backend, NOT when the browser finishes the download. If the CSV is generated but the network drops before the browser saves the file, `neft_exported_at` is still set — HR could mark paid without actually having the bank file on disk. In practice the file is small and dropped downloads are rare; the "rows marked as NEFT-exported" toast + register refresh give HR a visual signal. A Phase 5+ fix would be a two-step endpoint: generate → HR confirms receipt → stamp.
  - **Watermark render is a DOM overlay** (`position:absolute; transform:rotate`). html2pdf renders at 2× scale; on very tall payslips where the `.relative` container is taller than the viewport, the watermark doesn't tile — it stays centred on the container. Acceptable for v1 (single-page payslips).
  - **Frontend PDF generation depends on html2pdf.js + html2canvas**: if the browser strips dynamic image capture (some corporate DLP proxies do), the PDF will come out blank. No server-side fallback. Same fragility as plant payslip PDF.
  - **`ALLOWED_STATUS_MOVES` mismatch in frontend vs backend**: the register UI's client-side `ALLOWED_MOVES` const at `SalesSalaryCompute.jsx:28` was copied from Phase 3 and does NOT include `hold → finalized` even though the backend (`sales.js:842`) does. Pre-existing — not a Phase 4 regression. Trivial Phase 5 sync.
  - **`payslip_generated_at` stamp fires on every GET**, so "last viewed" is what it actually measures — not "last PDF download". Close enough for audit but misleadingly named. Rename to `payslip_last_viewed_at` is a drop-in future migration.
- **What STAYS (untouched):**
  - Plant routes/services: `reports.js`, `exportFormats.js`, `salaryComputation.js`, `dayCalculation.js`, `payroll.js`, `import.js`, `attendance.js`, `employees.js`, `financeAudit.js` — **byte-identical diff** vs HEAD.
  - Phase 1/2/3/hotfix sales code: `computeSalesEmployee` math unchanged, `generateSalesPayslipData` unchanged, `salesCoordinatorParser.js` unchanged, `sundayRule.js` unchanged. Only `saveSalesSalaryComputation` extended (additively) with 2 new columns in INSERT + ON CONFLICT.
  - `package.json` (both backend + frontend) — no new deps.
- **Sandbox notes:** DB at repo-root `data/hr_system.db` (not `backend/data/hr_system.db` — documented quirk in CLAUDE.md §2). Finance login rate-limited during testing — worked around with server restart. Plant NEFT baseline captured post-precondition (empty DB produces header-only CSV; md5 is of that canonical empty-data shape).
- **Frontend visual smoke:** NOT executed (sandbox can't open browser). Needs manual verification on Railway: (a) Export Excel button downloads `.xlsx` with 38 columns, (b) Export NEFT opens the missing-bank-details modal when applicable, (c) "✓ NEFT sent" chip appears after successful NEFT, (d) Paid option in dropdown is disabled with "(export NEFT first)" suffix before NEFT export, (e) Download PDF renders the watermark for computed/reviewed rows and omits it for finalized/paid.
- **Next session (Phase 5) should:** (a) sync the frontend `ALLOWED_MOVES` table in `SalesSalaryCompute.jsx:28` with the backend `ALLOWED_STATUS_MOVES` in `sales.js:842` — they've drifted by one transition; (b) start Phase 5 plant-sales cross-cutting: extract plant Sunday rule inline block in `dayCalculation.js:486–504` to call the shared `sundayRule.js` module (shipped in Phase 3 but plant still has the old inline copy); (c) capture the plant March 2026 `day_calculations` snapshot to disk (design §11 prerequisite); (d) implement the two pending `sales_salary_divisor_mode` options (`'26'`, `'30'`); (e) surface `finalizedRecomputeWarnings[]` as a top-of-register banner (Phase 3 gap, still open); (f) clean up the "Bulk Import" placeholder in `SalesEmployeeMaster.jsx`.

---

## Section 0: Previous Session
- **Date:** 2026-04-21
- **Branch:** `claude/fix-bug-reporter-data-exposure-9XFJl` (pushed to `origin/main` at `3e222b5`)
- **Last commit:** `3e222b5` security(auth): remove hardcoded JWT_SECRET fallback
- **Task:** Incident response — Bug Reporter data exposure containment (6 commits) + JWT_SECRET hardening (1 commit). Repo was public 2026-04-12 through 2026-04-21 (~9 days) with production SQLite DB + backup committed.
- **Files changed this session:**
  - `backend/src/services/backupScheduler.js` — gated cron behind `BACKUP_CRON_ENABLED` env var (default disabled). Was auto-committing SQLite DB to GitHub nightly.
  - `backend/.env.example` — documented new `BACKUP_CRON_ENABLED=false` var.
  - `.gitignore` — added `backend/data/*` rules (existing `data/*` rules didn't match the real DB path).
  - `backend/data/hr-salary.db` / `hr_salary.db` / `hr_system.db` / `hr_system.db-shm` / `hr_system.db-wal` — untracked via `git rm --cached` (files preserved on disk, hr_system.db remains 1.13MB production DB).
  - `backups/hr_salary_2026-04-11_17-42.db` — untracked via `git rm --cached` (file preserved on disk).
  - `backend/src/database/schema.js` — deleted dead `bug_report_sarvam_webhook_secret` seed block (real source is `process.env.SARVAM_WEBHOOK_SECRET`). Unused `const crypto = require('crypto')` left as-is for minimal diff.
  - `backend/src/middleware/auth.js` — removed hardcoded JWT_SECRET fallback string. Now throws at module load if env var is unset.
  - `CLAUDE.md` — corrected Bug Reporter Section 0 after audit found fabricated tables (claimed 3, reality: 1) + invented retry counter. Added Section 8 rule requiring /ship report claims to cite verifying commands.
- **What was fixed/built:** Technical containment of a 9-day PII exposure. Cron no longer auto-commits the DB; new DB files are properly ignored; previously tracked DB files untracked (still on disk for production use); dead webhook secret seed removed; JWT_SECRET fallback removed so misconfigured deploys fail fast. CLAUDE.md corrected to match actual shipped Bug Reporter schema, and a new Section 8 rule prevents the fabrication pattern that caused the prior mis-documentation.
- **What's fragile:**
  - `backend/src/database/schema.js` line 1 still has `const crypto = require('crypto')` — now unused after seed removal. Harmless but will lint-warn if a linter runs. Leave alone unless doing a broader cleanup pass.
  - Git history (before `cecc87b`) still contains the leaked SQLite DB blobs + the old `hr-system-dev-secret-change-in-production` JWT fallback. This session did NOT rewrite history (BFG is a separate task with its own maintenance window). Anyone who cloned/forked during the public window has the data.
  - `BACKUP_CRON_ENABLED` default is `false` — Railway must set this to `true` if/when the backup destination is moved off public GitHub. Re-enabling without moving the destination re-introduces the PII leak.
  - The sandbox DB at `backend/data/hr_system.db` had NO `bug_report_sarvam_webhook_secret` row to delete — production may still have that row. Must run `DELETE FROM policy_config WHERE key='bug_report_sarvam_webhook_secret';` on production DB out of band.
  - Any dev env that silently relied on the JWT fallback string will now refuse to boot. Confirm every environment has `JWT_SECRET` set before redeploying.
- **Unfinished work:** The auth commit (`d1ceed8`, locally) was rebased onto an updated `origin/main` and landed as `3e222b5`. No unpushed work remains. Design doc `sales_salary_module_design.md` is now committed (came in via merge) — the deferred Q5-reversal rewrites from the prior session still need to be applied to it (task belongs to the Sales/Phase 4 track, not this session).
- **Known issues remaining (requires out-of-session human action):**
  - Rotate all potentially exposed credentials: `ANTHROPIC_API_KEY`, `SARVAM_API_KEY`, `SARVAM_WEBHOOK_SECRET`, `JWT_SECRET`, admin/hr/finance/viewer passwords.
  - Decide on git history rewrite (BFG Repo-Cleaner) to scrub the leaked DB blobs and old JWT fallback string from history — separate maintenance window.
  - Disclosure to company leadership.
  - Run the `DELETE FROM policy_config WHERE key='bug_report_sarvam_webhook_secret';` on production DB.
- **Next session should:** (a) verify on Railway that `JWT_SECRET` is set and the app boots after this deploy — the fallback is GONE, so a missing env var now crashes at module load with `[auth] JWT_SECRET env var is required and must not be empty`. (b) verify `BACKUP_CRON_ENABLED` is unset or explicitly `false` (it should be — don't re-enable until the backup destination is non-public). (c) confirm the production DB had the `bug_report_sarvam_webhook_secret` row deleted out of band. (d) when Abhinav is ready, plan the BFG history rewrite as a separate task with a rollback plan.

---

## Section 0: Previous Session
- **Date:** 2026-04-21
- **Branch:** `claude/session-start-hook-jv0KJ` (pushed; not yet merged to `origin/main`)
- **Task:** Phase 3 Hotfix — Diwali policy reversal (Q5 reversed).
- **Hotfix commit:** (this session, pending at report time)
- **Why:** After Phase 3 shipped, HR clarified the actual Diwali policy. The prior model (rolling monthly deduction → ledger → Oct/Nov payout) was incorrect. Real policy: Diwali is a one-off bonus paid in Oct/Nov via the regular salary run. NO monthly deduction, NO ledger, NO accrual. Q5 in the design doc is reversed.
- **What changed:**
  - **Schema:** `sales_diwali_ledger` table + `idx_sales_diwali_ledger_emp` index deleted from the `CREATE` block. Idempotent one-time migration added (gated on `policy_config` key `migration_drop_sales_diwali_ledger_v1`): runs `DROP TABLE IF EXISTS sales_diwali_ledger` once, writes the flag, silent on subsequent boots. `diwali_recovery` column on `sales_salary_computations` is **kept dead** (for UPSERT completeness) — never read, always written as 0.
  - **`salesSalaryComputation.js`:** removed `diwali_recovery` from the pre-read SELECT. `diwaliRecovery` is now a hard-coded `0`. Step 6 `total_deductions` formula now excludes the diwali term: `PF_e + ESI_e + PT + TDS + advance + loan + other`. Step 7 unchanged in shape: `net_salary = gross_earned + diwali_bonus + incentive_amount − total_deductions`. Deleted `writeDiwaliAccrualRow` + `recomputeDiwaliLedgerCascade` helpers. Dropped `'Diwali Recovery'` from payslip deductions array. Module exports slimmed 5 → 3 (`computeSalesEmployee`, `saveSalesSalaryComputation`, `generateSalesPayslipData`).
  - **`sales.js`:** removed `writeDiwaliAccrualRow`/`recomputeDiwaliLedgerCascade` imports. Deleted the ledger-write block inside `POST /compute` (both branches + unconditional cascade call) and the parallel block inside `PUT /salary/:id`. `GET /sales/diwali-ledger` endpoint deleted entirely. `PUT /salary/:id` allowlist swapped: `diwali_recovery` removed, `diwali_bonus` added (HR now enters the Oct/Nov bonus via this path — this was a gap in Phase 3: the allowlist didn't include it). Register totals reducer swapped `diwali_recovery` → `diwali_bonus`. `total_deductions` rebuild drops the diwali term.
  - **`permissions.js`:** `'sales-diwali-ledger'` removed from hr array.
  - **`api.js`:** `salesDiwaliLedger` helper deleted.
  - **`SalesSalaryCompute.jsx`:** `DiwaliLedgerModal` component, "Diwali Accrual Report" button, `showDiwali` state, modal render block all deleted. The editable register column previously labelled "Diwali Ded" (pointing at `diwali_recovery`) is now "Diwali Bonus" (pointing at `diwali_bonus`). Footer total uses `totals.diwali_bonus`. Recompute confirm dialog text updated ("diwali" → "diwali bonus").
  - **`CLAUDE.md`:** this entry (new). Previous Phase 3 entry preserved below with a one-line correction note prepended — history intact.
- **What STAYS (untouched):**
  - `diwali_bonus` column on `sales_salary_computations` — the surviving Diwali path, HR-entered in Oct/Nov, preserved across recompute via existing pre-read pattern.
  - `+ diwali_bonus` term in Step 7 net_salary formula — preserved.
  - `diwali_recovery` column — left dead in schema, UPSERT still writes 0 to it (column kept for UPSERT completeness; SQLite can't cleanly drop columns without a table rebuild and the risk is higher than the reward). Can be dropped in a future cleanup phase.
  - All Phase 1 + Phase 2 code: employees, structures, holidays, uploads, parser, matcher.
  - All plant code: no touches.
  - Phase 3 non-Diwali code: `sundayRule.js`, `incentive_amount` plumbing, status state machine, upload supersede, holiday-delete finalized-guard, `finalizedRecomputeWarnings[]`.
- **What was verified (hotfix):**
  - Pre-condition row counts: `sales_diwali_ledger=0`, computations with `diwali_recovery>0`: 0 rows (dev DB was clean; no data thrown away).
  - Schema: 6 sales tables post-migration (was 7), `sales_diwali_ledger` absent, both `diwali_bonus` + `diwali_recovery` columns still on `sales_salary_computations`, `idx_sales_diwali_ledger_emp` absent from indexes, `migration_drop_sales_diwali_ledger_v1='1'` set in `policy_config`.
  - Idempotent re-deploy: second restart silent (no `[MIGRATION] Dropped …` log), table not recreated, flag unchanged.
  - Compute regression: seeded 1 employee + 1 structure + 1 `matched` upload + 1 monthly_input row (days=25, gross=20000). `POST /compute` → row written with `diwali_recovery=0`, `diwali_bonus=0`, `total_deductions=0` (no PF/ESI/TDS/adv/loan/other), `net_salary=20000` (= gross). Math reproduces by hand. No diwali_recovery term anywhere in the sum.
  - Diwali bonus path: `PUT /salary/1 {"diwali_bonus": 5000}` → net_salary 20000 → 25000 (delta = exactly 5000). Re-running `POST /compute` preserved the 5000 bonus and re-emitted `net_salary=25000` — HR-entered carry-forward for `diwali_bonus` intact.
  - Dead allowlist: `PUT /salary/1 {"diwali_recovery": 999}` → response `{"message":"No updates"}`, `diwali_recovery` stayed 0, `net_salary` unchanged. Allowlist validator cleanly rejects the key.
  - Removed endpoint: `GET /sales/diwali-ledger` → 404.
  - Dead-ref sweep: `grep` for `sales_diwali_ledger|salesDiwaliLedger|diwali-ledger|recomputeDiwaliLedgerCascade|writeDiwaliAccrualRow|sales-diwali-ledger` across `backend/src frontend/src` returns 6 hits, all inside the schema.js migration block + its comments. Zero dead code.
  - Plant regression: employees/salary_structures/salary_computations/day_calculations/attendance_processed/monthly_imports/holidays = 0/0/0/0/0/0/20, unchanged from Phase 3 baseline. Plant exports identical (`salaryComputation.js → [computeEmployeeSalary, saveSalaryComputation, generatePayslipData]`, `dayCalculation.js → [calculateDays, saveDayCalculation, getMonthDates, getDayOfWeek, WEEKLY_OFF_LENIENCY, effectiveStatusForDay]`).
  - Permission gate: finance → `POST /sales/compute` returns 403 (still gated on `'sales-compute'` permission; the removed `'sales-diwali-ledger'` was never checked by any route, so no regression).
  - Frontend build: clean, 5 Sales chunks emitted (SalesEmployeeMaster, SalesHolidayMaster, SalesUpload, SalesSalaryCompute, SalesPayslip).
- **Frontend visual smoke:** NOT executed (sandbox can't open browser). Manual on Railway: confirm "Diwali Accrual Report" button is gone, "Diwali Ded" column is gone, "Diwali Bonus" column appears in the same slot, editing it in October bumps the row's net.
- **What's fragile (hotfix):**
  - Design doc `sales_salary_module_design.md` is NOT in the repo (it was uncommitted in a prior session and got cleaned up before Phase 3's commit). The prompt asked for §4A/§6.5/§6.7/§9/§13/§14 rewrites but there's nothing to patch. **Deferred:** when the doc is re-committed, the Q5-reversal rewrite must be applied before anyone reads the doc as spec.
  - `diwali_recovery` is dead-alive. Any future dev who sees a `DEFAULT 0` column and decides to "use" it will break the Q5 reversal. The column is flagged in the service module header and CLAUDE.md, but a schema-level comment would be safer when someone has time for a table rebuild migration.
  - The register swap "Diwali Ded → Diwali Bonus" reuses the same cell slot (same amber background, same width). If HR's muscle memory from a week of Phase 3 has them typing a deduction amount there, they'll accidentally create a bonus. Low risk given the short window, but mention it when rolling out.
  - `PUT /salary/:id` quietly drops unknown body keys with a "No updates" response. That's good protective behaviour here but means that if someone writes a typo like `diwalibonus`, there's no feedback. Consider a strict-mode validator in a future pass.
- **Next session (Phase 4) should:** (a) resume Phase 4 exports (Excel + NEFT buttons on register), now that the foundation is clean; (b) commit the design doc at repo root with Q5 reversal applied + other pending spec rewrites; (c) consider a SQLite table-rebuild migration to truly drop `diwali_recovery` once Abhinav signs off it's never coming back; (d) implement `sales_salary_divisor_mode='26'` / `'30'` options; (e) surface `finalizedRecomputeWarnings[]` as a register banner; (f) clean up the "Bulk Import" placeholder in `SalesEmployeeMaster.jsx`.

---

## Section 0: Previous Session
- **CORRECTION:** the `sales_diwali_ledger` feature shipped in this Phase 3 entry was REVERSED in a same-week hotfix on 2026-04-21; see the Phase 3 Hotfix entry above. The original entry below is preserved for history.
- **Date:** 2026-04-20
- **Branch:** `claude/session-start-hook-jv0KJ` (pushed; not yet merged to `origin/main`)
- **Task:** Sales Salary Module Phase 3 — compute engine + register UI + payslip.
- **Phase 1 commit:** `78df719` feat(sales): Phase 1 — schema + employee master + sidebar entry
- **Phase 2 commit:** `57714be` feat(sales): Phase 2 — holiday master + coordinator sheet upload + matcher
- **Phase 3 commit:** `310237b` feat(sales): Phase 3 — compute engine + register UI + payslip
- **Phase 3 delivered:**
  - Tables: `sales_salary_computations` (43 columns — the 8 pro-rated earning buckets + `ot_amount`/`incentive_amount`/`diwali_bonus`/`diwali_recovery`/`other_deductions` + pf/esi/pt/tds + `status` state machine + `hold_reason` + `finalized_at`/`finalized_by`; `incentive_amount` reserved per §4A Q6, HR-entered in v1; `UNIQUE(employee_code, month, year, company)`), `sales_diwali_ledger` (14 cols; `entry_type` IN `'accrual'|'payout'|'adjustment'`; `UNIQUE(employee_code, company, month, year, entry_type)` so recompute overwrites the accrual row without creating duplicates).
  - 3 indexes: `idx_sales_comp_month_year_company`, `idx_sales_comp_status`, `idx_sales_diwali_emp_company`.
  - 2 new `policy_config` keys (seeded via `INSERT OR IGNORE`): `sales_leniency='2'` (3-tier Sunday rule leniency days), `sales_salary_divisor_mode='calendar'` (v1 only implements calendar-days mode; `'26'` / `'30'` hooks deferred to Phase 4).
  - New module `backend/src/services/sundayRule.js` — pure function `calculateSundayCredit({effectivePresent, workingDays, totalSundays, leniency})`. Verbatim port of plant's 3-tier formula (`dayCalculation.js:486–504`). Returns `{paidSundays, unpaidSundays, tier, threshold, daysPerWeeklyOff, note}`. No DB, no I/O, shared between plant and sales so any future tweak happens in one place.
  - New service `backend/src/services/salesSalaryComputation.js`: exports `computeSalesEmployee`, `saveSalesSalaryComputation`, `generateSalesPayslipData`, `recomputeDiwaliLedgerCascade`, `writeDiwaliAccrualRow`. Pre-reads `incentive_amount`, `diwali_recovery`, `other_deductions`, `hold_reason`, `status`, `finalized_at`, `finalized_by`, `diwali_bonus` from the previous row (if any) BEFORE the UPSERT so HR-entered values and lifecycle fields survive recompute. PF base = `min(basic_earned, pfCeiling)` (sales has no DA column — flagged below). UPSERT explicitly listed 37 `= excluded.*` assignments matching the 37 mutable columns (grep-verified).
  - 6 new endpoints on `sales.js` (all inherit Phase 1's `requireHrOrAdmin`):
    - `POST /sales/compute` — picks the latest `status IN ('matched','computed')` upload via `ORDER BY uploaded_at DESC LIMIT 1` (supersede per Phase 2 Q2 — no auto-`'superseded'` flip). Per-employee transaction so one bad row doesn't roll back the batch. Stamps the winning upload `status='computed'`. Reports `finalizedRecomputeWarnings[]` for rows where recomputed `net_salary` drifted > ₹1 on a `finalized`/`paid` row.
    - `GET /sales/salary-register` — returns rows + a totals object (gross/earned/ot/incentive/diwali/deductions/net).
    - `PUT /sales/salary/:id` — inline edit of `incentive_amount` / `diwali_recovery` / `other_deductions` / `hold_reason`. Rebuilds `total_deductions` and `net_salary` server-side. Blocks edits on `finalized`/`paid` rows (move to `hold` first). Calls `recomputeDiwaliLedgerCascade` when `diwali_recovery` changes.
    - `PUT /sales/salary/:id/status` — state machine via `ALLOWED_STATUS_MOVES` map: `computed→reviewed|hold`, `reviewed→computed|finalized|hold`, `finalized→paid|hold`, `hold→computed|reviewed|finalized`, `paid` is terminal. 400 on illegal transition. Writes `finalized_at`/`finalized_by` on `→finalized`.
    - `GET /sales/diwali-ledger` — per-employee YTD summary with running balance.
    - `GET /sales/payslip/:code` — structured payslip data (earnings/deductions breakdown, bank, employee, period).
  - Modified `DELETE /sales/holidays/:id` — added finalized-computation guard per Phase 3 deferred decision: if any `sales_salary_computations` row with `status='finalized'` exists for the same (company, month-of-holiday, year-of-holiday), return 409 with blocker list. Holidays can still be deleted when the impacted month is `computed`/`reviewed`/`hold`/`paid` — only `finalized` blocks.
  - `permissions.js` — appended `'sales-compute'`, `'sales-register'`, `'sales-diwali-ledger'` to `hr` array.
  - `frontend/src/pages/Sales/SalesSalaryCompute.jsx` — dual-mode page. Pre-compute: big Compute button + last-uploaded summary. Post-compute: sortable register with `EditRowCell` component (inline edit of incentive/diwali/other), totals row, per-row status pill, action menu for status transitions, Diwali-ledger drilldown modal, Excel/NEFT export placeholders (disabled with "Phase 4" tooltip). Recompute confirmation dialog when any `reviewed`/`finalized`/`paid` rows exist.
  - `frontend/src/pages/Sales/SalesPayslip.jsx` — React Query, `useParams`/`useSearchParams` routing, earnings/deductions side-by-side, net callout, bank details, `window.print()` with `print:hidden` on top bar.
  - `App.jsx` — 2 lazy imports + 2 routes (`/sales/compute`, `/sales/payslip/:code`).
  - `Sidebar.jsx` — added "Compute Salaries" child under Sales.
  - `api.js` — 6 helpers: `salesCompute`, `salesSalaryRegister`, `salesSalaryUpdate`, `salesSalaryStatusUpdate`, `salesDiwaliLedger`, `salesPayslip`.
- **What was verified (Phase 3):**
  - Schema: 7 sales_ tables (2 Phase 1 + 3 Phase 2 + 2 Phase 3), 8 sales indexes, 2 new policy_config rows, HR role has 3 new permissions appended.
  - `sundayRule.js` pure function test: tier1 case (eff=24, wd=26, sundays=4, len=2 → paid=4, tier1_full), tier2 case (eff=18, wd=26 → paid=2, tier2_proportional — `daysPerWeeklyOff=6.5`, so eff>6.5 qualifies for proportional), tier3 case (eff=3 → paid=0, tier3_none). **Note:** prompt expected tier3 for eff=18; kept plant semantics as ground truth — flagged in Questions for Abhinav.
  - End-to-end compute: seeded 2 employees + 1 structure + 1 holiday + 1 uploaded/matched upload → POST `/sales/compute` → 1 row written with `status='computed'`, `basic_earned`/`hra_earned` correctly pro-rated, PF on basic only.
  - Recompute idempotency: after HR sets incentive=500, diwali_recovery=3000, other_deductions=200 → recompute preserved all three and produced identical net_salary=15950 (drift check: 0 rows).
  - Diwali cascade: Feb accrual=3000 → Mar accrual=5000 → running_balance 3000,8000 ✓. Edit Feb to 4000 → Mar cascaded to 9000 ✓.
  - Status state machine: all 12 legal transitions accepted; 4 illegal transitions (e.g. `paid→computed`, `computed→finalized`, `computed→paid`) correctly 400-rejected.
  - Upload supersede: uploaded v2 fixture with `sheet_days_given=20`, ran compute → compute correctly read v2 (payable_days reflected 20, not v1's 25). v1 upload remained `status='matched'` (NOT auto-superseded) per Phase 2 Q2.
  - Holiday delete guard: Finalized Feb row → Feb holiday DELETE returned 409 with blocker list. Moved row to `hold` → DELETE succeeded.
  - `finalizedRecomputeWarnings[]`: finalized Feb row, edited salary_structure (gross 20k→22k), recomputed → endpoint returned warning array populated, finalized row's net_salary updated (recomputed), HR can review before finalizing again.
  - Plant regression: 7 plant tables (employees/salary_structures/salary_computations/day_calculations/attendance_processed/monthly_imports/holidays) row counts unchanged (0/0/0/0/0/0/20). Plant exports identical: `salaryComputation.js` → `['computeEmployeeSalary','saveSalaryComputation','generatePayslipData']`, `dayCalculation.js` → `['calculateDays','saveDayCalculation','getMonthDates','getDayOfWeek','WEEKLY_OFF_LENIENCY','effectiveStatusForDay']`.
  - Frontend build: clean, 5 Sales chunks emitted (SalesEmployeeMaster, SalesHolidayMaster, SalesUpload, SalesSalaryCompute, SalesPayslip).
- **What's fragile (Phase 3):**
  - `sundayRule.js` is now shared between plant (`dayCalculation.js`) and sales (`salesSalaryComputation.js`) — but plant still has the inline 3-tier block intact; we did NOT refactor plant to call the new module. If someone later refactors plant to use `sundayRule.js`, verify the plant's `effectivePresent` computation (which includes leave + half-day logic) matches what the pure function expects — same formula, different input assembly.
  - `recomputeDiwaliLedgerCascade` walks forward month-by-month. If the ledger grows past ~12 months per employee, the cascade becomes O(N) per edit — cheap for current scale but worth revisiting when Phase 4 adds multi-year payout logic.
  - Compute reads the latest `status IN ('matched','computed')` upload per `(month, year, company)` — earlier uploads are NOT auto-flipped to `'superseded'`. If HR rolls back (deletes the latest upload), compute will transparently pick the next-newest — but they may not realise which upload fed the salary. Phase 4 may want a "show source upload" link on the register.
  - `finalizedRecomputeWarnings[]` is surfaced in the compute response JSON but the UI does NOT yet render them as a banner — HR has to inspect the network payload or check the status column for drift. Low-risk cosmetic gap for Phase 4.
  - PF base uses `min(basic_earned, pfCeiling)` only — sales has NO `da` column. If HR later introduces a DA bucket for sales (unlikely per design doc, but possible), the PF base formula needs `min(basic_earned + da_earned, ceiling)` and a schema migration.
  - Only `sales_salary_divisor_mode='calendar'` is implemented. `'26'` and `'30'` modes read the policy_config row but fall through to calendar with no warning — change the key manually and compute will silently stay on calendar. Document when Phase 4 ships the other modes.
  - `incentive_amount` is HR-entered via `PUT /sales/salary/:id`. Per §4A Q6 a future auto-compute source (e.g. sales target table) may be added. The column and UPSERT preservation are already in place; only the compute path needs extending.
- **Pre-existing quirk (not fixed this session):** `SalesEmployeeMaster.jsx` "Bulk Import" placeholder button still points to "Phase 2" tooltip — superseded by Phase 2's dedicated `/sales/upload` page. Trivial Phase-4 cleanup.
- **Questions for Abhinav (surfaced during build):**
  1. **Sunday rule tier expectation** — prompt expected eff=18, wd=26, totalSundays=4, leniency=2 to produce tier3 (zero Sundays paid). Plant's formula puts it in tier2 (proportional: `floor(18/6.5)=2` paid Sundays) because `daysPerWeeklyOff = (workingDays - leniency) / totalSundays = 24/4 = 6` and eff=18 > 6, so tier2 fires. Kept plant semantics as ground truth for parity. Abhinav to confirm this is intended behaviour or whether the prompt's tier3 expectation should become the new rule (and migrate the plant alongside).
  2. **PF base without DA** — sales has no `da` column in `sales_salary_structures`. Current PF base = `min(basic_earned, pfCeiling)`. Intended? If sales reps ever get a DA bucket, schema + compute both need touching.
  3. **Divisor mode 26 / 30** — only `calendar` implemented. OK to ship v1 with just calendar? If yes, Phase 4 item.
- **Sandbox notes:** `better-sqlite3@9.6.0` headers pre-cached at `$HOME/.cache/node-gyp/22.22.2/` (same as Phase 1/2). Port 3001 dev server managed via `fuser -k 3001/tcp` + subshell daemonize to avoid zombie-process issues.
- **Next session (Phase 4) should:** (a) wire the Excel + NEFT export buttons on the register (currently disabled placeholders); (b) implement the two pending `sales_salary_divisor_mode` options (`'26'`, `'30'`) and document in `policy_config`; (c) surface `finalizedRecomputeWarnings[]` as a top-of-register warning banner; (d) auto-supersede old uploads (or keep the current "latest wins silently" depending on Abhinav's Phase 2 Q2 ratification); (e) clean up the "Bulk Import" placeholder in `SalesEmployeeMaster.jsx`; (f) start Phase 5 (plant March 2026 `day_calculations` snapshot prerequisite).

---

## Section 0: Previous Session
- **Date:** 2026-04-20
- **Branch:** `claude/session-start-hook-jv0KJ` (pushed; not yet merged to `origin/main`)
- **Task:** Sales Salary Module Phase 1 + Phase 2.
- **Phase 1 commit:** `78df719` feat(sales): Phase 1 — schema + employee master + sidebar entry
- **Phase 2 commit:** `57714be` feat(sales): Phase 2 — holiday master + coordinator sheet upload + matcher
- **Phase 1 delivered:**
  - Tables: `sales_employees`, `sales_salary_structures` (per-company `UNIQUE(code, company)` per §4A Q2; manual `status` transitions only per §4A Q3; no `auto_inactive`/`inactive_since`).
  - 7 CRUD endpoints on new `backend/src/routes/sales.js` — employees list/get/create/update/mark-left + structures history/create. Router-level `requireHrOrAdmin`; every `:code` endpoint demands `?company=X` (400 if missing).
  - `frontend/src/pages/Sales/SalesEmployeeMaster.jsx` — list/filter/create/edit/mark-left. Bank fields required at form level. Bulk import placeholder disabled ("coming in Phase 2" tooltip — now superseded by Phase 2's real upload page but left as-is; trivial Phase-3 cleanup).
  - `permissions.js` — `'sales-employees'` appended to `hr`.
  - 2 bugs caught and fixed during build: `POST /employees` and `POST /.../structures` were passing explicit `null` for fields the caller omitted, which clobbered SQLite `DEFAULT` values (`status='Active'`, `pf/esi/pt_applicable=0`). Fixed by building INSERT column lists from only the supplied fields.
  - **Phase 1 frontend visual smoke was NOT executed** (sandbox couldn't open browser). `SalesEmployeeMaster.jsx` should be exercised manually on Railway preview — covered incidentally during Phase 2's upload smoke where an employee was seeded via the page's underlying endpoints.
- **Phase 2 delivered:**
  - Tables: `sales_holidays` (UNIQUE(holiday_date, company)), `sales_uploads` (UNIQUE(month, year, company, file_hash); status enum `uploaded/matched/computed/finalized/superseded`), `sales_monthly_input` (FK → sales_uploads; match_confidence enum `exact/high/medium/low/unmatched/manual`). **Q4 applied** — NO `sheet_working_days_ai`, NO `sheet_working_days_manual` columns. Only `sheet_days_given` captured (authoritative).
  - Indexes: `idx_sales_holidays_company_year`, `idx_sales_uploads_my_company`, `idx_sales_monthly_input_upload`, `idx_sales_monthly_input_match`.
  - New service `backend/src/services/salesCoordinatorParser.js`: SheetJS-based, dynamic header detection (scans rows 0–10 for cells containing both "Sales Person Name" AND "Day's Given"), NO hardcoded row numbers. Exports `parseSalesCoordinatorFile(filePath)` + three pure normalizers (`normalizeName`, `normalizeManager`, `normalizeCity`) — reused by the upload route matcher, so the employee master and the sheet row see the same canonical form. `CITY_TYPO_MAP` at top of file seeded with `GHAZIYABAD→GHAZIABAD` and `MUZAFARNAGAR→MUZAFFARNAGAR`; one-line additions as HR flags more. Classifier explicitly drops "Working Days as Per AI" and "Working Days Manual" even when present in the sheet (Q4).
  - 8 new endpoints on `sales.js` (all inherit Phase 1's `requireHrOrAdmin`): 4 holiday CRUD (`GET/POST/PUT/DELETE /sales/holidays[/:id]`) + 4 upload/matching (`POST /sales/upload`, `GET /:uploadId/preview`, `PUT /:uploadId/match/:rowId`, `POST /:uploadId/confirm`). Multer instance dedicated to sales uploads at `backend/uploads/sales/`, 10MB limit, .xls/.xlsx only. SHA-256 file hash for dedup → 409 with `existingUploadId` payload if same (month, year, company, hash) re-uploaded; no re-parse of the collision.
  - **Matching algorithm** (runs inside `POST /sales/upload`, not in the parser): tiered, **same-company only** per §4A Q2.
    - Tier 1 Exact: `punch_no` equality when both sheet + master have a non-empty value → confidence `'exact'`, method `'punch_no'`.
    - Tier 2 High: `normalizeName + normalizeManager + normalizeCity` equality (requires sheet manager AND sheet city both present) → `'high'` / `'name+manager+city'`.
    - Tier 3 Medium: `normalizeName + normalizeCity` equality (requires sheet city) → `'medium'` / `'name+city'`.
    - Tier 4 Low: `normalizeName` match with ≥2 candidates (ambiguous) → `'low'`, `employee_code=NULL`, HR resolves on preview. Single-name-match that didn't line up on manager+city is also surfaced as low with method `'name_only_one_candidate'`.
    - Tier 5 Unmatched: no name match → `'unmatched'`, `employee_code=NULL`.
    - HR manual link via `PUT /match/:rowId` → confidence `'manual'`, method `'hr_manual'`. Cross-company manual matches are rejected with 400 (row.company must equal body.company).
  - Confirm endpoint (`POST /:uploadId/confirm`) validates all rows have `employee_code IS NOT NULL` — 400 with `unmatchedCount` if any NULL. On success flips `sales_uploads.status='matched'`.
  - `permissions.js` — appended `'sales-holidays'` and `'sales-upload'` to `hr` array.
  - `frontend/src/pages/Sales/SalesHolidayMaster.jsx` — list/create/edit/delete; states multi-select chips (empty list = "All"); year dropdown (prev/current/next2); company-required guard renders an amber info banner when no company selected.
  - `frontend/src/pages/Sales/SalesUpload.jsx` — two views (UploadView / PreviewView) swapped via local state. UploadView: native drag-drop + click-to-browse, 10MB client guard, 409 collision UI with "Open existing upload" button. PreviewView: 3 tabs (Matched / Low / Unmatched) with counts, inline `EmployeePicker` (react-query-backed, 2-char minimum) on low/unmatched rows, "Confirm Matches" disabled until low+unmatched both empty, status badge, and a locked read-only mode when status ≠ 'uploaded'.
  - `App.jsx` — 2 lazy imports + 2 routes (`/sales/holidays`, `/sales/upload`).
  - `Sidebar.jsx` — 2 children added under existing "Sales" section (`salesAllowed: true` gate from Phase 1 covers them): "Sales Holidays", "Upload Sheet".
  - `api.js` — 8 helpers: `salesHolidaysList/Create/Update/Delete`, `salesUploadFile/Preview/Match/Confirm`.
- **What was verified (Phase 2):**
  - Schema: 5 sales_ tables, Q4 columns absent from `sales_monthly_input`, 7 sales indexes (3 Phase 1 + 4 Phase 2).
  - Holiday API: create, list-filtered-by-year, missing-company-400, duplicate-409, cross-company same-date-201, PUT update (name + states + gazetted), DELETE, 404 on non-existent, list-after-delete=0.
  - Parser unit test (fixture `/tmp/phase2_fixture.xlsx` built in-memory via SheetJS `aoa_to_sheet`): 4 data rows → 3 kept (empty-name row dropped, TOTAL subtotal dropped). No Q4 keys in output. All 3 normalizers verified (manager prefix strip, name UPPER+collapse, city typo lookup).
  - Upload flow: parse → match → preview. RAVI auto-matched via Tier 2 high (name+manager+city). PRIYA and AYUSH tier-5 unmatched (not in master). 409 on identical file re-upload. Seeded PRIYA+AYUSH via Phase 1 endpoint, manually linked via PUT match → confidence='manual'. Cross-company manual match correctly rejected (400). Confirm-with-unmatched-present correctly 400's. Confirm after all matched → status='matched', `matched_rows=3`.
  - Permission gate: finance role → 403 on both `/sales/holidays` and `/sales/upload`.
  - Plant regression: employees/salary_structures/salary_computations/day_calculations/attendance_processed/monthly_imports/holidays counts unchanged (0, 0, 0, 0, 0, 0, 20).
  - Frontend build: clean, 3 Sales chunks emitted (SalesEmployeeMaster, SalesHolidayMaster, SalesUpload).
- **What's fragile (Phase 2):**
  - `CITY_TYPO_MAP` is a static object in `salesCoordinatorParser.js`. HR edits require a code change + redeploy — no admin UI. Keep it small; when it grows past ~10 entries, move to a `policy_config`-backed lookup.
  - Matching is **same-company only** per §4A Q2. A sales rep who works for both companies has two codes and two sheet rows — no cross-company dedup. If HR later ratifies global uniqueness, the matcher is one-line stricter, no data migration needed (but frontend picker would need to drop the company filter).
  - `sales_uploads.filename` stores the original upload filename (design §6.3). The multer-generated disk path under `backend/uploads/sales/` is NOT stored. Phase 3 compute doesn't need the file (it reads `sales_monthly_input`), but any future "download original sheet" feature requires adding a `disk_path` column and backfilling from the multer filenames.
  - Parser month/year extraction tries filename regex first, then scans the first 5 rows of the detected sheet. If both fail and the caller doesn't pass `month`/`year` in the multipart body, the upload returns 400 — there's no "guess from today". This is intentional (a wrong month silently reused on compute would be worse than a loud 400).
  - Confirmed uploads are LOCKED: `PUT /match/:rowId` does NOT check status, but the frontend PreviewView hides the picker once `status !== 'uploaded'`. If a future admin CLI or re-open flow lets HR revise a confirmed upload, add a status guard on the match endpoint.
- **Pre-existing quirk (not fixed this session):** `SalesEmployeeMaster.jsx` still has a "Bulk Import" placeholder button saying "coming in Phase 2". Phase 2 shipped the upload under a different page (`/sales/upload`), not a button on the master page. Low-priority Phase 3 cleanup: delete the button, or change the tooltip to "use Sales → Upload Sheet" and link it.
- **Sandbox notes:** `better-sqlite3@9.6.0` native build required pre-caching Node headers at `$HOME/.cache/node-gyp/22.22.2/` (nodejs.org headers returned 503 on first attempt; explicit curl to retry worked). No `bcrypt` module available to Python, so the viewer-403 test from the prompt spec was substituted with the finance-403 test (same gate, proves non-hr/admin blocked).
- **Questions for Abhinav (surfaced during build):**
  1. **Holiday delete irreversibility** — Phase 2 does a hard `DELETE`. If Phase 3 compute has already read a holiday and produced a salary row, is it OK to remove the holiday retroactively (affecting future recomputes only), or should we soft-delete (`deleted_at`) and exclude from compute queries? Decision deferred to Phase 3.
  2. **`sales_uploads.filename` collision on different hashes** — current scheme allows "salary_feb_2026.xlsx" to be uploaded twice in the same month if the bytes differ (e.g. HR fixed a typo). That's probably desired (supersedes workflow), but the design doc has `status='superseded'` for exactly this — should the second upload auto-supersede the first, or should HR explicitly choose? Current behaviour: both persist, latest wins by uploaded_at, no auto-supersede. Revisit in Phase 3/4.
- **Next session (Phase 3) should:** (a) build `sundayRule.js` shared module + `salesSalaryComputation.js` engine. (b) add `sales_salary_computations` + `sales_diwali_ledger` tables with the `incentive_amount` reservation per §4A Q6. (c) surface the compute action on `SalesUpload.jsx` status='matched' uploads. (d) capture the plant March 2026 `day_calculations` snapshot to disk (Phase 5 prerequisite per §11). (e) resolve the 2 Phase 2 questions above before any compute runs.

---

## Section 0: Previous Session
- **Date:** 2026-04-20 (entry corrected 2026-04-21 after audit — see note below)
- **Branch:** `claude/bug-reporter-steps-1-3-JR97x` (pushed to `origin/main` at `6f5114f`)
- **Last commit:** `6f5114f` feat(bug-reporter): frontend — modal, components, admin inbox (step 12/13)
- **Task:** Bug Reporter end-to-end — voice/screenshot/typed bug capture for HR, Sarvam audio→English pipeline, Claude extraction, admin inbox. Steps 1–13 of a 13-step plan.
- **Correction note (2026-04-21):** Post-ship audit found the original Section 0 entry had fabricated claims about extra tables (`bug_report_actions`, `bug_report_analysis_runs`) and a retry-counter mechanism that were never implemented. The entry below is the corrected version.

Files created (backend, 7):
- `backend/src/routes/bugReports.js`
- `backend/src/middleware/uploadBugReport.js`
- `backend/src/services/bugReportStorage.js`
- `backend/src/services/bugReportAnalyzer.js`
- `backend/src/services/bugReportResurrect.js`
- `backend/src/services/sarvamWebhookVerify.js`
- `backend/src/services/sarvamBatchPoller.js`
- `backend/src/services/sarvamTranscription.js` (verify existence)

Files created (frontend, 12):
- `frontend/src/utils/apiContextBuffer.js`
- `frontend/src/utils/copyTicketSummary.js`
- `frontend/src/hooks/useNewBugReportCount.js`
- `frontend/src/api/bugReports.js`
- `frontend/src/components/BugReporter/ScreenshotInput.jsx`
- `frontend/src/components/BugReporter/AudioUploader.jsx`
- `frontend/src/components/BugReporter/VoiceRecorder.jsx`
- `frontend/src/components/BugReporter/AutoContextPreview.jsx`
- `frontend/src/components/BugReporter/BugReportButton.jsx`
- `frontend/src/components/BugReporter/BugReportModal.jsx`
- `frontend/src/pages/admin/BugReportsInbox.jsx`
- `frontend/src/pages/admin/BugReportDetail.jsx`

Files modified:
- `backend/server.js` — mount `/api/bug-reports`, boot poller/resurrect
- `backend/src/database/schema.js` — add `bug_reports` table + policy_config seeds
- `frontend/src/store/appStore.js` — `bugReportModalOpen` state + actions
- `frontend/src/utils/api.js` — `installContextBufferInterceptors(api)`
- `frontend/src/components/layout/Sidebar.jsx` — admin "Bug Reports" entry
- `frontend/src/App.jsx` — lazy imports, `/admin/bug-reports` routes, modal in Layout

Schema additions (verify via `.schema`):
- ONE new table: `bug_reports` (with CHECK constraints per plan v3 §3)
- THREE `policy_config` seeds:
  - `bug_report_extraction_prompt` — full extraction prompt text, hot-swappable
  - `bug_report_extraction_prompt_version` — version tag for tracking prompt iterations
  - `bug_report_known_pages_json` — JSON array of page names

Resurrect behavior (`bugReportResurrect.js`, on boot):
- Bucket A: `claude_run_status='pending' AND transcription_status='success'` → re-run Claude extraction
- Bucket B: `transcription_status='pending' AND sarvam_job_id IS NULL` → re-run transcription
- Bucket C (batch jobs with `sarvam_job_id`): left to `sarvamBatchPoller`
- 24-hour cutoff — rows older than 24h are not resurrected.
- NO retry counter. NO analysis-runs audit table.

Status vocabulary:
- `transcription_status`: `pending | rest_sync | batch_queued | batch_polling | success | failed | skipped`
- `claude_run_status`: `pending | success | failed | skipped`
- `admin_status`: `new | triaged | in_progress | resolved | wont_fix | duplicate`

Webhook secret:
- Active source: `process.env.SARVAM_WEBHOOK_SECRET` (set in Railway env)
- The previously-seeded policy_config row `bug_report_sarvam_webhook_secret` was dead code; removed 2026-04-21.

What's fragile:
- Sarvam webhook signature verification (three layers: HMAC + per-report token + idempotency). Never remove any layer.
- Webhook route mounted outside `requireAuth` but inside signature middleware — if refactoring routes, verify this ordering.
- iOS Safari `MediaRecorder` compatibility (needs real-device test before declaring iOS support done).
- Disk-vs-DB path consistency — no enforcer; if a row's `screenshot_path` or `audio_path` points to a missing file, the admin inbox will 404 on the media serve endpoints.

What's dormant (known, not a bug):
- `bug_report_actions`, `bug_report_analysis_runs`: mentioned in earlier drafts, never implemented. Do NOT assume they exist.

---

## Section 0: Previous Session
- **Date:** 2026-04-20
- **Branch:** `claude/session-start-y317N` (pushed to `origin/main`)
- **Last commit:** `bdf1790` fix(daily-wage): replace time-overlap duplicate check with gate-ref uniqueness
- **Task:** Daily wage multiple-entries-per-day bug. HR could not create a second entry for the same contractor on the same date when time windows overlapped. Duplicate rule changed from time-window overlap → `(contractor_id, entry_date, LOWER(TRIM(gate_entry_reference)))`.
- **Files modified:**
  - `backend/src/routes/dailyWage.js` — `validateEntryRow()` duplicate SELECT (lines 364–381) and `POST /entries/check-duplicates` (lines 447–463) both rewritten to key on normalised gate_entry_reference (TRIM + LOWER, comparison-only — stored value stays raw). Check-duplicates endpoint now requires `gate_entry_reference` (400 if missing) and wraps results in `{ success, data: { duplicates } }`. Note: the previous `status != 'rejected'` filter was dropped; rejected rows now also block re-use of their gate ref.
  - `backend/src/database/schema.js` — added defensive expression UNIQUE index `idx_dw_entries_unique_gate` on `(contractor_id, entry_date, LOWER(TRIM(gate_entry_reference)))` wrapped in try/catch so legacy collisions log-but-don't-crash server boot.
  - `frontend/src/pages/DailyWageEntry.jsx` — pre-save duplicate-check payload updated (drops in/out times, adds gate_entry_reference); response path adjusted for new wrapped shape (`dupRes?.data?.data?.duplicates`); dialog copy at lines 345 & 350 reworded to reference Gate Entry Reference. Line 347 (`Time: X — Y`) preserved for useful context.
  - `frontend/dist/*` — rebuilt via `npm run build`.
- **What was fixed:** HR can now create multiple daily wage entries for the same contractor on the same date as long as each has a distinct gate_entry_reference. Same gate ref (even with different time windows, even with whitespace/case variants) is now rejected by both app-level validation AND a DB-level UNIQUE expression index — defense-in-depth. Verified via 9 curl tests (happy path, the bug fix scenario, true duplicates, normalisation, 400-on-missing, edit-flow regression, index presence, direct-INSERT bypass).
- **Breaking change:** `POST /dailyWage/entries/check-duplicates` request contract changed — now requires `gate_entry_reference` instead of `in_time`/`out_time`. Any external caller (none found in repo) must adapt.
- **What's fragile:**
  - `idx_dw_entries_unique_gate` is an EXPRESSION index using `LOWER(TRIM(...))`. Any future migration that rebuilds `dw_entries` (e.g. ALTER-via-copy) MUST recreate this index with the identical expression, or app-level validation (TRIM+LOWER) and DB-level enforcement will disagree — dropping silently to app-only checks.
  - The `status != 'rejected'` exemption was removed. If HR workflow relied on re-entering after rejection with the same gate ref, they'll now have to delete the rejected row first or use a different ref.
- **Pre-existing quirk (not touched, logged for future pass):** `backend/server.js` logs `DATA_DIR` as `backend/data/` but `backend/src/database/db.js` resolves the actual DB to repo-root `data/hr_system.db` (via `__dirname + '../../../data'`). Both paths have stale `.db` files. Sandbox testing confirmed the real DB path is the repo-root one.
- **Sandbox notes:** dev backend binds to port 3001 (not 3000); `sqlite3` CLI not installed — used Python `sqlite3` module for ad-hoc queries.
- **Known follow-up:** No soft warning yet for "3rd+ entry same contractor same day" — hold until HR reports confusion, then decide between a confirmation-dialog-only path or a configurable per-contractor daily cap.
- **Next session should:** Verify on Railway that (a) existing prod rows don't collide with the new UNIQUE index on first deploy — if they do, the boot log will print `[SCHEMA] Could not create UNIQUE index idx_dw_entries_unique_gate …`, and a manual dedup via the admin Query Tool is needed before restart; (b) HR can now enter two entries with identical times and different gate refs without hitting the 409.

---

## Section 0: Previous Session
- **Date:** 2026-04-15
- **Branch:** `claude/session-start-FyzhO` (pushed to `origin/main` at `18fc12a`)
- **Last commit:** `18fc12a` refactor: extract shared shift metric utility with variant-aware night timings
- **Task:** Shift Night Variant Architecture + Shared Metric Utility + Night Pair Dissolution (plus two fixes earlier the same session, both now on main: (a) UNIQUE constraint crash on `attendance_processed` reimport — commit `a80c1b0`; (b) Salary Explainer AI prompt missing calculation chain — commit `22e2509`).
- **Files created:**
  - `backend/src/utils/shiftMetrics.js` — pure function `calcShiftMetrics({ inTime, outTime, statusOriginal, shift, otThresholdHours })`. Single source of truth for late/early/OT/left-late/actualHours computation. No DB access, no side effects. Returns `{ isNight, isLate, lateBy, isEarly, earlyBy, isOT, otMinutes, isLeftLate, leftLateMinutes, actualHours, shiftId, shiftName }`. Variant-aware: shifts with `night_start_time`/`night_end_time` (12HR, DAY, NIGHT, DUBLE) use those for evening punches; shifts without (10HR, 9HR, HK7:30, GEN) treat evening punches as day-window overtime.
- **Files modified:**
  - `backend/src/database/schema.js` — two `safeAddColumn('shifts', 'night_start_time'/'night_end_time', 'TEXT')` calls; one-time migration gated by policy_config key `migration_shift_night_variants_v1` populates `'20:00'`/`'08:00'` for the four shifts that need night variants.
  - `backend/src/routes/settings.js` — POST `/shifts` and PUT `/shifts/:id` accept optional `nightStartTime` / `nightEndTime`; PUT uses "only overwrite if provided" pattern (`undefined` → keep existing value, `''` → `NULL`).
  - `backend/src/routes/import.js` — removed the inline ~110-line shift-metric calculation block from `postTxn`; replaced with a single call to `calcShiftMetrics`. Removed `defaultNightShift` lookup. Employee's assigned shift is now always used — no global NIGHT fallback.
  - `backend/src/routes/attendance.js` — `POST /recalculate-metrics` rewritten identically: uses shared utility, and the UPDATE now includes the 4 previously-missing fields (`is_early_departure`, `early_by_minutes`, `is_overtime`, `overtime_minutes`). `is_night_shift` changed from one-way CASE to DIRECT assignment so corrections can flip night→day. `shift_id` / `shift_detected` still use COALESCE to preserve HR manual overrides.
  - `backend/src/services/missPunch.js` — deleted the private `recalcShiftMetrics` helper (~119 lines) added in `50cdd54`; `resolveMissPunch()` now calls the shared utility, does DIRECT assignment for `shift_id` / `is_night_shift` / `shift_detected`, and — when a correction flips an evening punch to a day-time punch — dissolves the `night_shift_pairs` row (`is_rejected=1, is_confirmed=0`), clears `is_night_out_only`/`night_pair_date`/`night_pair_confidence` on the OTHER record, and re-flags that OTHER record as a miss punch (`NO_PUNCH` / `MISSING_IN` / `MISSING_OUT` / `NIGHT_UNPAIRED`) when its IN/OUT is incomplete.
- **What was fixed/built:**
  1. **Shared metric utility** — the calculation formula previously existed in 3 call sites (import, recalculate-metrics, miss-punch resolution), with subtle drift (e.g. miss-punch didn't set `is_early_departure`/`is_overtime`). Now all three call the same pure function — guaranteed identical output.
  2. **Variant-aware shift timings** — removed the hard-coded global NIGHT fallback. An employee on 12HR punching at 20:15 uses `night_start_time=20:00` from their own shift row (15-min late), not some separate NIGHT shift. A 10HR employee punching at 20:00 is no longer misclassified as a shift change — it's day-window overtime.
  3. **Night detection threshold** — lowered from `inH >= 19` to `inH >= 18` (matches plant reality for 12HR shifts that start at 20:00; a 19:45 punch was previously misclassified as day).
  4. **Gap 1** (is_night_shift flip): corrections can now switch a record back to `is_night_shift=0` (was one-way-only via CASE).
  5. **Gap 2** (shift reassignment on correction): `shift_id` is now directly reassigned when a night punch is corrected to a day punch and the employee's assigned shift is day.
  6. **Gap 3** (night pair dissolution): when a miss-punch resolution flips an evening punch to a day punch, the `night_shift_pairs` row is marked rejected and the OTHER record is reopened for Stage 6 (no longer suppressed via `is_night_out_only`), re-flagged as a miss punch if its IN/OUT is incomplete.
  7. **Gap 4** (recalculate-metrics completeness): attendance.js `POST /recalculate-metrics` now writes all 6 metric pairs including `is_early_departure` and `is_overtime`, not just late/left-late.
- **What's fragile:**
  - The `night_start_time`/`night_end_time` columns are nullable. Shifts left empty will use day timings for evening punches — treating them as overtime, not a shift change. If HR adds a new shift code that needs night variants, they must populate those columns via Settings → Shifts.
  - The night-pair dissolution block only fires when `m.isNight === 0` for the corrected record. If a correction preserves night status but changes the shift (e.g. 12HR night → 10HR night — not a real scenario today), the pair is NOT dissolved. Acceptable because the 3 current night-variant shifts share the same 20:00/08:00 timings.
  - If `policy_config` lacks an `ot_threshold_hours` row, all three call sites fall back to 12. Change this value in one place (policy_config) — not hard-coded anywhere.
  - Variant detection uses `shift.night_start_time` truthy check. Migration only ran for 12HR/DAY/NIGHT/DUBLE. If a legacy shift code (e.g. RSS, ABD) also acted as a rotator, HR needs to populate the columns manually.
- **Unfinished work:** None for this task.
- **Known issues remaining:** Pre-existing — `EmployeeProfile.jsx` AI Review "Regenerate" button shown even after error. `DeptAnalytics.jsx` overtime tab field names not tested against real production data. Part 2 mobile-responsive pass (6 files + 2 judgment calls) still queued from earlier session.
- **Next session should:** Verify on Railway with real data that (a) 12HR employees punching 20:15 are marked 15-min late (not 12h late from comparing to day 08:00 start), (b) 10HR employees punching 20:00 stay as day overtime (not shift-changed), (c) a corrected night→day flip dissolves the night pair and re-flags the next-day OUT-only record. Sanity SQL: `SELECT code, night_start_time, night_end_time FROM shifts WHERE code IN ('12HR','10HR','9HR','DAY','NIGHT','DUBLE');`

---

## Section 0: Previous Session
- **Date:** 2026-04-14 (impl) + 2026-04-15 (rebase/push/verify)
- **Branch:** `claude/session-start-BGRNn` (pushed to `origin/main` at commit `c0ec4fa`)
- **Last commit:** `c0ec4fa` feat: Salary Explainer — AI-powered slide-over panel
- **Task:** Salary Explainer — AI-powered slide-over panel accessible from any page
- **Files created:**
  - `backend/src/routes/ai.js` — new route with two endpoints: `POST /api/ai/explain-salary` (role-gated to admin/hr/finance; gathers employee/day-calc/salary/prev-month/late-deductions/loans/corrections data, calls Anthropic, caches narrative in `salary_computations.ai_explanation`, graceful fallback on missing/failed API) and `GET /api/ai/employee-search?q=...` (autocomplete, top 10 active employees by code/name)
  - `frontend/src/components/SalaryExplainer.jsx` — slide-over panel (right side, `w-96` desktop / full-width mobile). Debounced employee autocomplete, month/year pickers defaulting from Zustand, Ctrl+Shift+E shortcut, Esc to close, parses AI response into SUMMARY/EARNINGS/DEDUCTIONS/CHANGES/FLAGS sections, always renders a "Quick Numbers" structured card so output is useful even when the AI narrative is unavailable, floating trigger button (`fixed bottom-16 right-4 z-40`) stacked above the `?` AbbreviationLegend button. Role-gated: hidden for viewer/employee
- **Files modified:**
  - `backend/server.js` — 1 line: mount `/api/ai` route after `/api/query-tool`
  - `backend/src/database/schema.js` — 2 `safeAddColumn` calls (`salary_computations.ai_explanation TEXT`, `ai_explanation_at TEXT`) + a trigger `invalidate_salary_ai_cache` that nulls both columns whenever any salary column (payable_days, gross_salary, basic_earned … net_salary, late_coming_deduction, early_exit_deduction, ed_pay, take_home, etc.) is updated. The trigger uses `AFTER UPDATE OF <cols>` + `WHEN NEW.ai_explanation IS NOT NULL` so it fires only when there's actually a cache to invalidate and never on cache-writes themselves
  - `frontend/src/store/appStore.js` — 4 lines: `salaryExplainerOpen` state + `toggleSalaryExplainer`/`openSalaryExplainer`/`closeSalaryExplainer` actions
  - `frontend/src/App.jsx` — import `SalaryExplainer` + render it inside `<Layout>` after `<AbbreviationLegend />` so it mounts on every authenticated page
  - `frontend/src/components/layout/Sidebar.jsx` — added "Salary Explainer" nav item (`action: 'salaryExplainer'`, `hrFinanceOrAdmin: true`), extended `NavItem` to support action items and the new role gate, wired `openSalaryExplainer` from the store into a `handleAction` callback
  - `frontend/src/utils/api.js` — added `searchEmployeesForAI(q)` and `explainSalary(data)` helpers
  - `frontend/dist/*` — rebuilt via `npm run build --prefix frontend`
- **What was fixed/built:** HR can now open a right-side slide-over from any page, search by employee code/name, pick a month, and get a plain-language salary breakdown (or, if `ANTHROPIC_API_KEY` is missing/rate-limited, the same structured numbers in the "Quick Numbers" fallback card). Cache is automatic: first lookup calls Anthropic, repeat lookups return instantly; cache auto-invalidates on any salary recomputation via the new schema trigger. End-to-end verified locally: fallback, 404 on unknown employee, 400 on missing params, "no salary data" message on future month, 403 on viewer role, and trigger-based cache invalidation all pass. Salary drift query clean.
- **New env var:** `ANTHROPIC_API_KEY` — set on Railway. Backend logs a warning on startup if missing, but does NOT crash — explainer returns `{explanation: null, data_summary: {...}}` so the UI still shows structured numbers.
- **What's fragile:** (1) Anthropic API model name hard-coded to `claude-sonnet-4-20250514` — switch to `claude-sonnet-4-5` or `claude-sonnet-4-6` if/when HR wants the newer reasoning. (2) Cache invalidation relies on the trigger firing — if a future schema migration replaces `salary_computations` or any listed watched column, the trigger silently stops working (narrative will never go stale, appearing fresh after recompute). Re-create the trigger after such migrations. (3) `audit_log.employee_code` filter in the corrections query assumes that column is populated; old audit rows may have NULL — those corrections won't appear in the prompt but won't crash the endpoint.
- **Known issues remaining:** None new. Pre-existing: `EmployeeProfile.jsx` AI Review "Regenerate" button shown even after error. `DeptAnalytics.jsx` overtime tab field names not tested against real production data.
- **Post-commit work (2026-04-15):** (1) Rebased `claude/session-start-BGRNn` onto `origin/main` (`50cdd54..c0ec4fa`) — conflict in `CLAUDE.md` Section 0 resolved by preserving both the shift-metrics fix and the Salary Explainer entries. (2) Pushed rebased branch to `origin/main` (fast-forward) and force-pushed the session branch. (3) Verified static wiring: `App.jsx:7` imports, `App.jsx:82` renders inside `<Layout>`; `Sidebar.jsx:80` has nav entry with `action: 'salaryExplainer'` + `hrFinanceOrAdmin: true`; `Sidebar.jsx:197` handler calls `openSalaryExplainer()`; `appStore.js:91-94` state + 3 actions present; `SalaryExplainer.jsx:303` gate uses `normalizeRole(user?.role)` ∈ `[admin,hr,finance]`. (4) Verified built bundle `index-c8xAOPFv.js` contains both `salaryExplainerOpen` and `hrFinanceOrAdmin` identifiers — the whole component is statically imported (not lazy) so it's always in the app chunk. Diagnostic "not visible on screen" report from the user was checked against all 4 hypothesised causes (role mismatch, parent overflow, z-index stacking, action-handler wiring) — all four are correctly handled in the current code; no fix applied. If it's actually invisible in production, it's a cache/deploy issue (hard refresh) or a genuine role-not-in-[admin,hr,finance] situation — `localStorage.hr_user` will tell.
- **Next session should:** (a) Verify the Salary Explainer end-to-end on Railway with real production data + a valid `ANTHROPIC_API_KEY` — confirm the narrative reads naturally, the cache returns `cached: true` on second lookup, and recomputing Stage 7 for that employee invalidates the cache. If the user still reports "button not visible" after a hard refresh, check `localStorage.hr_user`'s `role` field and walk the gate at `SalaryExplainer.jsx:303` in DevTools. (b) Resume the Part 2 mobile-responsive pass queued from the previous session (Compliance/Alerts/Settings/SalaryComputation/DayCalculation/Employees — 6 files and 2 judgment calls, already documented in the prior Section 0 block below).

---

## Section 0: Previous Session (Same Day — Shift Metrics Fix)
- **Date:** 2026-04-14
- **Branch:** `claude/session-start-fM5iz`
- **Fixed:** `resolveMissPunch()` now recalculates all 6 shift metrics (late, early,
  OT, left-late) after correcting IN/OUT times. Previously these stayed frozen
  from the original import calculation, causing stale `late_count` in
  `day_calculations` and analytics (real case: Nandini 60131 Apr 2026 — 163-min
  stale late flag after correcting IN from 10:43 → 07:55). Added private helper
  `recalcShiftMetrics()` in `missPunch.js`. `bulkResolveMissPunches()` gets the
  fix for free (calls `resolveMissPunch` internally). Leave-conversion path
  (`convertToLeave=true`) skips the recalc — no shift-metric meaning there.
- **Files changed:** `backend/src/services/missPunch.js` (only file)
- **Fragile:** The shift metric logic now exists in 3 places: `import.js`
  post-processing, `attendance.js` `recalculate-metrics`, and `missPunch.js`
  `recalcShiftMetrics()`. If the formula changes (e.g. grace period logic), all
  3 must be updated. Future refactor candidate: extract to a shared utility.

---

## Section 0: Previous Session
- **Date:** 2026-04-14
- **Branch:** `claude/session-start-9ihVA` (pushed to `origin/main` and to branch)
- **Last commit:** `efa311d` feat: mobile-friendly responsive pass - Reports, Compliance, Alerts, Settings, pipeline pages
- **Files changed this session:**
  - `frontend/src/pages/Reports.jsx` — wrapper `p-4 md:p-6`, controls `flex-wrap`, sidebar+content stack on mobile (`flex-col md:flex-row`), report nav buttons horizontally-scrollable on mobile, 6 stat grids made responsive (2-col/3-col/4-col across breakpoints)
  - `frontend/src/pages/Compliance.jsx` — wrapper `p-4 md:p-6`, controls group `flex-wrap`, 2 stat grids `grid-cols-2 md:grid-cols-4`
  - `frontend/src/pages/Alerts.jsx` — wrapper `p-4 md:p-6`, controls `flex-wrap`, summary cards grid `grid-cols-2 sm:grid-cols-3 md:grid-cols-5`
  - `frontend/src/pages/Settings.jsx` — 2 wrapper paddings (admin-gate + main) `p-4 md:p-6`, holiday form grid `grid-cols-2 sm:grid-cols-3 md:grid-cols-5`
  - `frontend/src/pages/SalaryComputation.jsx` — wrapper `p-4 md:p-6`, controls `flex-wrap`, salary register table `min-w-[1200px]` for horizontal scroll on mobile
  - `frontend/src/pages/DayCalculation.jsx` — wrapper `p-4 md:p-6`, controls `flex-wrap`, register table `min-w-[1100px]`, late-deduction input row wraps
  - `frontend/src/pages/Employees.jsx` — wrapper `p-4 md:p-6`, header stacked on mobile (`flex-col sm:flex-row`), employee table `min-w-[900px]`
  - `frontend/dist/*` — rebuilt via `npm run build` (vite output refreshed)
- **What was fixed/built:** Mobile-friendly responsive pass — Part 1 of N. Applied Tailwind `md:`/`sm:` breakpoints to 7 pages so the app is usable on phones (page padding, flex-wrap controls, responsive stat grids, `min-w-[N]` on wide data tables inside `overflow-x-auto`). Pure CSS/className only — no logic, state, API, or backend touched. Desktop layout fully preserved. Build clean, pushed to `origin/main` and `origin/claude/session-start-9ihVA`.
- **What's fragile:** None — additive className changes only. BUT Part 2 of the pass was started (state reported in Phase 0) then interrupted before edits — expectation is next session picks up from the Phase 0 report (see Unfinished work).
- **Unfinished work:** Part 2 pass was scoped but not executed this session. Remaining items per Phase 0 state report:
  - `Compliance.jsx`: wrapper `space-y-4 md:space-y-6`; header row mobile stack + merge Generate button into controls; line 367 `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`
  - `Alerts.jsx`: header `justify-between` mobile stack; filter row (line 147) add `flex-wrap`
  - `Settings.jsx`: lines 79 + 710 header rows mobile stack; lines 121 + 718 `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`
  - `SalaryComputation.jsx`: header (line 268) `flex-col sm:flex-row` stack
  - `DayCalculation.jsx`: header (line 205) `flex-col sm:flex-row` stack; line 546 3-pill leave balance grid — open question (leave alone vs. add `sm:grid-cols-3` no-op)
  - `Employees.jsx`: line 517 drilldown `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`; filter search input `w-full sm:w-auto sm:flex-1`
  - Two pending judgment calls raised to user in Phase 0 report: (1) DayCalc line 546 apply or skip; (2) Alerts line 124 `gap-3` → `gap-4` per spec letter or keep as `gap-3`
- **Known issues remaining:** None new. Pre-existing: `EmployeeProfile.jsx` AI Review "Regenerate" button shown even after error. `DeptAnalytics.jsx` overtime tab field names not tested against real production data. Local `main` branch still diverges from `origin/main` — always push via `git push origin claude/session-branch:main`.
- **Next session should:** Resume Part 2 pass — apply the 6 remaining file edits listed in Unfinished work, resolve the two judgment calls (DayCalc line 546, Alerts gap), run `npm run build`, commit, push `claude/session-start-9ihVA:main`. Queue table from prior handoff has more pages to pass through after this (Dashboard already done per prior session note; remaining: verify and extend to any additional pages HR surfaces as unusable on mobile).

---

## Section 0: Previous Session
- **Date:** 2026-04-13
- **Branch:** `claude/session-start-SFwgo` (pushed to `origin/main`)
- **Last commit:** `8d24ac0` feat: early exit employee summary view with grouped analysis
- **Files changed this session:**
  - `backend/src/routes/early-exits.js` — added `GET /employee-summary` endpoint: groups exits by employee across a date range, prev-period trend, habitual flag, per-employee incidents array from GROUP_CONCAT
  - `frontend/src/utils/api.js` — added `getEarlyExitEmployeeSummary` export
  - `frontend/src/components/EarlyExitDetection.jsx` — added "By Employee" / "All Incidents" view toggle (default: employee); employee summary table with HABITUAL badge, colour-coded exit count, sortable columns, click-to-expand incident sub-table; existing incidents table unchanged except wrapped in viewMode guard
- **What was fixed/built:** Early Exit grouped analysis view — replaces the unusable 3800-row flat list with an employee-grouped table that identifies repeat offenders at a glance. Previous period comparison and habitual offender flagging built into the backend endpoint. Build clean, pushed to main.
- **What's fragile:** `empDisplayRows` memo uses `empSort.sortKey` / `empSort.sortDir` as dependencies directly from the `useSortable` return object — if `useSortable` is ever refactored to return a single object ref these deps will silently stop triggering re-sorts. `GROUP_CONCAT` order within SQLite is not guaranteed — incident sub-table rows may appear unsorted by date on some SQLite versions.
- **Unfinished work:** None for this feature.
- **Known issues remaining:** `EmployeeProfile.jsx` AI Review "Regenerate" button shown even after an error (pre-existing). `DeptAnalytics.jsx` overtime tab field names not tested against real production data (pre-existing).
- **Next session should:** Test the employee summary view against real production data on Railway; verify HABITUAL thresholds (≥5 exits OR ≥3 exits + avg ≥60 min) feel right with actual data; consider adding "Export" button to the employee summary view if HR requests it.

---

## Section 0: Previous Session
- **Date:** 2026-04-13
- **Branch:** `claude/session-start-ObkfF` (pushed to `origin/main`)
- **Last commit:** `f4bffca` fix: AI review response parsing and display
- **Files changed this session:**
  - `frontend/src/pages/DeptAnalytics.jsx` — new page: 5-tab dept/org analytics (health ranking + bar chart, OT Gini, night burden, inequality, org trends, punctuality histogram, costs, alerts); recharts LineChart + BarChart; date range picker defaulting 6mo
  - `frontend/src/pages/EmployeeProfile.jsx` — new page: searchable employee dropdown, identity card, 5 tabs (overview KPIs+streaks+chart+dept-vs-org, attendance detail+monthly table, salary snake_case fields+bar chart, patterns with severity badges, AI review with section cards + narrative fallback)
  - `backend/src/services/deptAnalyticsService.js` — new: `computeDepartmentAnalytics(db, startDate, endDate)` — health scores, OT Gini, night burden, attendance inequality
  - `backend/src/services/orgMetricsService.js` — new: `computeOrgMetrics(db, startDate, endDate)` — 6 independent sections: utilization, punctuality curve, absenteeism cost, contractor gap, coordinated absence alerts, stability index
  - `backend/src/routes/analytics.js` — added `GET /department-dashboard` and `GET /org-metrics` endpoints; imports for both new services
  - `frontend/src/App.jsx` — lazy imports + routes for `/dept-analytics` and `/employee-profile`
  - `frontend/src/components/layout/Sidebar.jsx` — added "Employee Profile" and "Dept Analytics" nav items
  - `backend/src/config/permissions.js` — added `dept-analytics` and `employee-profile` to hr + finance roles
- **What was fixed/built:** Full Employee Intelligence Profile page (5 tabs, AI review via Claude API with section parsing) and Department/Org Analytics page (5 tabs: health ranking, OT concentration, org trends, absenteeism costs, alerts). Three bug fixes: pattern cards used wrong field names (`label`/`detail` not `name`/`description`), salary table used camelCase but API returns snake_case, AI review stored only `sections` discarding `narrative` fallback.
- **What's fragile:** `orgMetricsService.js` Section B (punctuality curve) falls back to `09:00` shift start when `employees.shift_id` is null — employees without a shift assignment will skew the arrival offset distribution. `deptAnalyticsService.js` health score uses `avgHours / 9` ratio — if standard shift is 10h or 12h this underscores hours-based component.
- **Unfinished work:** `DeptAnalytics.jsx` overtime tab uses `deptData.otConcentration/nightShiftBurden/attendanceInequality` but these fields come from `deptAnalyticsService` — not tested against real data; confirm field names match if backend is changed.
- **Known issues remaining:** `EmployeeProfile.jsx` AI Review "Regenerate" button is shown even after an error — minor UX issue. Local `main` branch still diverged from `origin/main`; always push via `git push origin claude/session-branch:main`.
- **Next session should:** Test Employee Profile and Dept Analytics against real production data on Railway; fix any field-name mismatches found; consider adding `employee-profile` link from the Employees master page per-row.

---

## Section 0: Also This Session (Finance Approval Wiring Fixes)
- **Date:** 2026-04-13
- **Branch:** `claude/session-start-Sc3cc` (pushed to `origin/main`)
- **Last commit:** `2de9157` fix: gate gross_salary changes behind finance approval flow
- **Files changed this session:**
  - `backend/src/routes/financeAudit.js` — imported `syncSalaryStructureFromEmployee`; added GROSS_STRUCTURE_CHANGE revert block in `PUT /approve-flag/:flagId` — on rejection: archives to `finance_rejections`, reverts `employees.gross_salary` + `salary_structures` to pre-change value, writes audit log
  - `backend/src/routes/employees.js` — exported `syncSalaryStructureFromEmployee` as named export; added `requireHrOrAdmin` middleware; rewrote `PUT /:code/salary` to gate gross changes through `salary_change_requests` approval flow; banking/statutory fields still apply immediately; same-gross component updates still apply directly
  - `frontend/src/pages/Employees.jsx` — `updateMutation.onSuccess` checks `data.pendingApproval`, shows 5-second "Salary change submitted for finance approval" toast vs plain "Salary structure saved"
- **What was fixed/built:** Two finance approval wiring fixes. (1) Rejecting a GROSS_STRUCTURE_CHANGE flag now reverts `employees.gross_salary` + `salary_structures` to the pre-change value. (2) `PUT /employees/:code/salary` now routes gross changes through `salary_change_requests` (pending → finance approve/reject) instead of writing directly — Stage 7 no longer reflects unapproved salary changes.
- **What's fragile:** GROSS_STRUCTURE_CHANGE revert only fires on NEW rejections; already-rejected flags before this deploy are NOT retroactively reverted (manual fix needed via Employee Master). The duplicate-pending guard silently drops a second gross-change submission if one is already pending.
- **Unfinished work:** Stale PAWAN KUMAR (19222) has `employees.gross_salary = 84502` instead of `84500` — Abhinav must manually set it back to 84500 via Employee Master and re-run Stage 7.
- **Known issues remaining:** Local `main` branch diverged from `origin/main` — always push via `git push origin claude/session-branch:main`.
- **Next session should:** Verify the salary approval gate works end-to-end in production (change gross → pending toast → Salary Input page shows pending → finance approve → Stage 7 picks up new gross).

---

## Section 0: Previous Session
- **Date:** 2026-04-12
- **Branch:** `claude/session-start-DL0k6` (pushed to `origin/main` via fast-forward)
- **Last commit:** `2542b49` feat: AI-powered qualitative employee review via Claude API
- **Files changed that session:**
  - `backend/src/services/employeeProfileService.js` — new: `computeProfileRange()` returning 13 sections (employee, kpis, streaks, arrivalDeparture, regularityScore, behavioralPatterns, monthlyBreakdown, departmentComparison, salaryHistory, corrections, leaveUsage, patternAnalysis, meta)
  - `backend/src/routes/analytics.js` — added `GET /employee/:code/profile-range` and `POST /employee/:code/ai-review` routes
  - `backend/src/services/aiReviewService.js` — new: `generateAIReview()` calling Anthropic API; `buildReviewPayload()`, `parseSections()`, `callClaudeAPI()`
  - `backend/src/services/patternEngine/index.js` — new orchestrator: runs 23 detectors, computes flightRisk/engagement/reliability composite scores
  - `backend/src/services/patternEngine/individualPatterns.js` — new: 8 detectors (sandwich leave, ghost hours, absence clustering, break drift, miss-punch escalation, half-day addiction, LIFO, post-leave slump)
  - `backend/src/services/patternEngine/flightRiskPatterns.js` — new: 4 detectors (disengagement cascade, sudden leave burn, OT cliff, attendance entropy)
  - `backend/src/services/patternEngine/anomalyPatterns.js` — new: 4 detectors (buddy punching, OT gaming, coordinated absence, clock-edge punching)
  - `backend/src/services/patternEngine/temporalPatterns.js` — new: 3 detectors (payday proximity, seasonal pattern, day-of-month hotspot)
  - `backend/src/services/patternEngine/shiftPatterns.js` — new: 2 detectors (night shift fatigue, shift transition shock)
  - `backend/src/services/patternEngine/contractorPatterns.js` — new: 2 detectors (contractor instability, contractor OT exploitation with Factories Act check)
  - `.env.example` — added `ANTHROPIC_API_KEY` entry with Railway deployment note
- **What was fixed/built:** Full Employee Intelligence backend — 13-section profile endpoint, 23-pattern behavioral engine, and AI narrative review via Claude API. All three features pushed to `origin/main`. Railway already has `ANTHROPIC_API_KEY` set so the AI review endpoint is live in production.
- **What's fragile:** `employeeProfileService.js` Section I (salary history) has a try/catch fallback for older DBs missing `take_home`/`ed_pay` columns — if a DB is very old the totals may exclude these fields silently. Pattern engine's `detectLIFO` and `detectCoordinatedAbsence` make per-date DB queries capped at 30/20 samples to avoid N+1 slowness — very large date ranges still do O(30) queries each.
- **Unfinished work:** `frontend/src/pages/EmployeeProfile.jsx` — NOT created. Phase 4a + 4b frontend was planned (plan file at `/root/.claude/plans/recursive-popping-dove.md`) but interrupted before implementation. App.jsx, Sidebar.jsx, and permissions.js also not yet modified for this page.
- **Known issues remaining:** Local `main` branch has diverged from `origin/main` (51 vs 71 different commits) — always push via `git push origin claude/session-branch:main` rather than checking out local main.
- **Next session should:** Implement `frontend/src/pages/EmployeeProfile.jsx` per the approved plan at `/root/.claude/plans/recursive-popping-dove.md` — create the page, wire App.jsx route, add Sidebar.jsx nav item, add `employee-profile` to permissions.js for hr+finance, build dist, commit and push.

---

## Section 0: Recent Changes
**2026-04-12 | Branch: claude/fix-early-exit-deduction-gh1DU | Early Exit Deduction Amount Fix**

Files modified:
- `frontend/src/components/EarlyExitDetection.jsx` — 3 changes: (1) added `getEmployee` import, (2) replaced broken `detection.daily_gross_at_time`-based `dailyGross` (always 0) with a `getEmployee()` query to fetch actual `gross_salary`, then compute `dailyRate = gross / daysInDetMonth`; `halfDayAmount`/`fullDayAmount` now 2-decimal floats; (3) dropdown labels updated to show `Math.round(amount)` display

What was broken: `early_exit_detections` table has no `gross_salary` column; the range-report query also doesn't join `employees`. So `detection.daily_gross_at_time` was always `undefined` → `computedAmount = 0` → `0 || undefined = undefined` → backend rejected with "deduction_amount is required for non-warning deductions" → zero rows ever inserted into `early_exit_deductions`.

What was fixed: `getEmployee(detection.employee_code)` fetches current gross; daily rate computed from detection date's actual month. Submit payload now sends the correct `deduction_amount` (e.g., ₹214.29 for Half-Day, ₹428.57 for Full-Day on gross 12000 / Feb 28 days).

What's fragile: The salary pipeline integration in `salaryComputation.js` for `earlyExitDeduction` is already coded (see Section 5) but was untested because `early_exit_deductions` had zero rows. Now that deductions can be created, the pipeline will pick them up on next Stage 7 compute after finance approval. Verify Stage 7 shows the early_exit_deduction column correctly once real deductions exist.

Notes:
- `deduction_amount: computedAmount || undefined` in the submit payload is intentional — passes `undefined` for `warning` type (backend ignores amount for warnings) and the computed float for half_day/full_day/custom
- Detection date's month (not selectedMonth prop) is used for days-in-month, matching the backend's `daysInMonth(detection.date)` calculation
- Pending: none for this task

---

**2026-04-12 | Branch: claude/admin-sql-query-tool-L9lm8 | Admin SQL Query Tool**

Files created:
- `backend/src/config/schemaReference.js` — static schema reference text sent to Anthropic API for English→SQL translation
- `backend/src/routes/queryTool.js` — admin-only route: POST /run (natural language + raw SQL), GET /saved (5 diagnostic queries), SELECT-only validation, 100-row limit
- `frontend/src/pages/QueryTool.jsx` — admin-only page at /admin/query-tool: English + SQL tabs, saved query buttons, sortable results table, CSV export

Files modified:
- `backend/server.js` — 1 line: mount `/api/query-tool` route
- `frontend/src/App.jsx` — 2 lines: lazy import + Route entry for /admin/query-tool
- `frontend/src/components/layout/Sidebar.jsx` — 1 line: "Query Tool" nav item with `adminOnly: true`

Notes:
- Natural language mode requires ANTHROPIC_API_KEY env var (not set locally — Railway only)
- Raw SQL paste mode works without API key
- Admin-only: backend middleware checks `req.user.role === 'admin'`, returns 403 for non-admin
- SQL validation blocks INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/TRUNCATE/REPLACE/ATTACH/DETACH/PRAGMA/VACUUM/REINDEX
- 5 saved diagnostic queries: drift check, payable days > 31, zero deductions, stuck ED grants, present vs payable gap
- Pending: none

---

**2026-04-12 | Branch: claude/wire-notifications-end-to-end-5zVTq | Tier 3.4 — Notifications End-to-End**

Files modified:
- `backend/server.js` — removed duplicate `/api/notifications` route mount (was mounted twice at lines 197 and 204; second mount deleted)
- `backend/src/routes/payroll.js` — 3 `createNotification()` trigger-points added: `DAY_CALC_COMPLETE` (hr, after calculate-days), `SALARY_COMPUTED` (finance, after compute-salary), `SALARY_HELD` (hr, per-employee, iterates `held` array after compute-salary)
- `backend/src/routes/financeVerification.js` — `FINANCE_SIGNOFF` (admin) trigger added after `POST /signoff` succeeds with `status='approved'`; gated so rejection does not fire
- `backend/src/routes/extraDutyGrants.js` — `ED_GRANT_APPROVED` (hr) trigger added after `POST /:id/finance-approve`
- `backend/src/routes/lateComing.js` — `LATE_DED_APPROVED` (hr) trigger added after `PUT /finance-review/:id` when `status='approved'`
- `frontend/src/components/layout/NotificationBell.jsx` — fully rewritten: SVG bell icon (no emoji/library), manual `useState` + `useEffect` + `setInterval` polling every 60s (replaces React Query), `useRef`-based click-outside handler, coloured left-border by type (red for urgencies, green for completions, grey for others), relative timestamps ("X min/hour/day ago"), unread dot + bold title, mark-one-read + mark-all-read, navigate-on-click via `useNavigate`, loading state on first fetch only

Notes:
- All `createNotification()` calls wrapped in `try/catch` — notification failure never crashes a route
- `createNotification()` imported inline via `require('../services/monthEndScheduler')` inside each try block
- Role filtering: HR sees `role_target IN ('hr', 'all')`; Finance sees `finance+all`; Admin sees everything. Fallback query (no `role_target` column) returns all 50 for old DBs
- FINANCE_SIGNOFF fires only on approval — `status === 'approved'` guard prevents false positive on rejection
- SALARY_HELD fires per-employee (one row per held salary) — HR can address each hold individually
- `financeVerification.js` is mounted at `/api/finance-verify` (not `/api/finance-audit`); signoff endpoint is here, not in `financeAudit.js`
- Pending: none for this task

---

**2026-04-12 | Branch: claude/abbreviation-legend-HLrmz | Tier 3.5 — Abbreviation Legend**

Files modified:
- `frontend/src/utils/abbreviations.js` — added named `ABBREVIATIONS` export (7 categories, 30+ entries); internal dict renamed to `_dict`; all 3 helpers (`getAbbreviation`, `getPageAbbreviations`, `getAllAbbreviations`) preserved — `Tooltip.jsx` and all existing per-page usages continue to work
- `frontend/src/components/ui/AbbreviationLegend.jsx` — full rewrite: global floating `?` button (fixed bottom-right, `z-50`), searchable modal with real-time category filtering, keyboard shortcut (`?` key outside inputs), ESC + overlay click to close; `keys` prop guard (`keys.length > 0 → return null`) makes the 12 existing per-page usages silently become no-ops
- `frontend/src/App.jsx` — 1 import line + 1 JSX line: `<AbbreviationLegend />` added as last child inside the `Layout` wrapper function

Pending: none

Notes:
- Legend only visible on authenticated pages (inside `Layout`), not on `/login`
- Keyboard shortcut: press `?` anywhere outside an input/textarea to toggle the modal
- Search filters live across all 7 categories simultaneously; "No results for X" shown when nothing matches
- Per-page collapsible panels (12 pages) silently become no-ops via the `keys` prop guard — no page files modified

---

**2026-04-12 | Branch: claude/request-id-middleware-HLqLt | Tier 3.3 — Request-ID Middleware**

Files created:
- `backend/src/middleware/requestId.js` — stamps every `/api` request with `req-xxxxxxxx` (8 hex chars from uuid v4); sets `x-request-id` response header; logs arrival (`→`) and completion (`←`) with method/path/status/duration. Health endpoint excluded from logging.

Files modified:
- `backend/server.js` — `require('./src/middleware/requestId')` + `app.use('/api', requestIdMiddleware)` inserted after cache-control block, before usage logger
- `backend/src/services/salaryComputation.js` — `computeEmployeeSalary()` signature extended with `requestId = ''` (6th param); `const RID = ...` at top; `[salary]` prefixes replaced with `${RID}` in existing warns; 5 checkpoint logs added: dayCalc lookup, earnedRatio, PF/ESI, totalDeductions/net/takeHome, salary-held
- `backend/src/services/dayCalculation.js` — `calculateDays()` signature extended with `requestId = ''` (9th param); `const RID = ...` at top; `[DayCalc]` prefix in integrity-warning log replaced with `${RID}`
- `backend/src/routes/payroll.js` — `POST /calculate-days` and `POST /compute-salary` pass `req.requestId` as last arg to respective service calls; before/after loop logs added with employee counts
- `frontend/src/utils/api.js` — axios error interceptor reads `err.response?.headers?.['x-request-id']` and `console.error`s the Trace ID alongside endpoint URL and HTTP status

Notes:
- `req.requestId` is available in ALL route handlers (set before auth middleware runs)
- Salary computation emits one RID-prefixed trace block per employee — grep by `req-xxxxxxxx` to isolate a single computation run from concurrent traffic
- Health endpoint (`/health`) is excluded from req-ID logging to prevent noise in production monitoring
- Pending: none for this task

---

# HR Intelligence & Salary Processing Platform
- Stack: React (Vite) + Tailwind frontend, Node.js/Express backend, SQLite (better-sqlite3, WAL mode)
- Companies: Indriyan Beverages, Asian Lakto Ind. Ltd. (global company filter)
- Data source: EESL biometric attendance XLS (uploaded monthly)
- Pipeline: 7-stage attendance-to-salary processing
- Deployment: Railway | GitHub: abhinavpoddar27-pixel/hr-salary-system

## Section 0: Last Session
- Date: 2026-04-11
- Branch: `claude/nightly-db-backup-git-xKhvM`
- Task: Tier 3.2 — Nightly DB backup scheduler with git push
- Files changed:
  - `backend/src/services/backupScheduler.js` (created)
  - `backend/server.js` (+2 lines: require + `initBackupScheduler()`)
  - `.gitignore` (+1 entry: `backups/*.db`)
  - `backups/.gitkeep` (new directory placeholder)
- Pending: none for this task
- Notes: Backup cron runs at 23:30 daily via `node-cron`. Copies
  `backend/data/hr_system.db` → `backups/hr_salary_YYYY-MM-DD_HH-MM.db`,
  enforces a rolling 7-file window, then runs
  `git add -f backups/ && git commit --allow-empty && git push origin HEAD`.
  `git add -f` is required because `backups/*.db` is in `.gitignore` (manual
  workflow blocks .db adds; only cron is allowed to commit them). Each git
  step is wrapped in its own try/catch — push failure logs and continues, it
  never crashes the server. The whole cron callback is wrapped in a top-level
  try/catch. Tested: single run, double run, and 10→7 rolling window cleanup.
  No temporary test call remains in `initBackupScheduler()`.

## Section 2: Directory Map
```
backend/
├── server.js                                  Express bootstrap, auth seeding, route mounting
├── src/
│   ├── database/
│   │   ├── schema.js                          43 tables, all CREATE TABLE definitions, migrations
│   │   └── db.js                              better-sqlite3 wrapper, logAudit() helper
│   ├── middleware/auth.js                     JWT verify, requireAuth, requireAdmin
│   ├── middleware/requestId.js               Request-ID stamp, x-request-id header, arrival/completion logging
│   ├── config/permissions.js                  Role → page access matrix
│   ├── utils/employeeClassification.js        isContractor() — dept keywords + flag
│   ├── utils/pagination.js                    Server-side pagination helper
│   ├── routes/
│   │   ├── auth.js              Login, JWT, user CRUD, permissions
│   │   ├── import.js            Stage 1: EESL XLS upload, parse, deduplication
│   │   ├── attendance.js        Stages 2-5: miss-punch, shift-check, night-shift, corrections
│   │   ├── payroll.js           Stages 6-7: day calc, salary compute, finalise, payslip
│   │   ├── employees.js         Employee CRUD, salary structure, leave balances
│   │   ├── salary-input.js      Manual salary inputs (loans, deductions, advances)
│   │   ├── advance.js           Salary advance calc, mark-paid, recovery
│   │   ├── loans.js             Loan disbursal, EMI tracking, recovery
│   │   ├── leaves.js            Leave applications, approve/reject, balance check
│   │   ├── reports.js           Bank NEFT, PF ECR, ESI returns, month-end exports
│   │   ├── financeAudit.js      16 endpoints: report, corrections, manual flags, bias
│   │   ├── financeVerification.js  11 endpoints: red flag review, signoff workflow
│   │   ├── extraDutyGrants.js   Dual HR+Finance approval for overnight shifts
│   │   ├── settings.js          Shifts, holidays, policy_config, companies
│   │   ├── analytics.js         Workforce + attendance analytics
│   │   ├── compliance.js        PF/ESI/PT compliance dashboard
│   │   ├── notifications.js     User notification CRUD
│   │   ├── jobs.js              Background job queue
│   │   ├── taxDeclarations.js   FY tax declarations for TDS auto-calc
│   │   ├── employeePortal.js    Employee self-service API
│   │   ├── daily-mis.js         Daily attendance MIS dashboard
│   │   ├── lifecycle.js         Hire/exit lifecycle events
│   │   ├── sessionAnalytics.js  User session tracking
│   │   ├── usage-logs.js        Admin usage audit
│   │   ├── phase5.js            Leave accrual, shift roster, attrition
│   │   ├── lateComing.js        Late Coming: analytics, deductions, finance approval (Phase 1+2)
│   │   ├── short-leaves.js     Gate pass / short leave CRUD, quota check
│   │   ├── early-exits.js      Early exit detection trigger, list, summary, analytics
│   │   ├── early-exit-deductions.js  HR deduction submit/revise + finance approve/reject
│   │   └── analytics.js         Workforce analytics
│   └── services/
│       ├── earlyExitDetection.js     Detect employees who punched out before shift end
│       ├── parser.js                 EESL XLS parsing — dynamic column detection
│       ├── missPunch.js              Stage 2: detect missing IN/OUT, NIGHT_UNPAIRED
│       ├── nightShift.js             Stage 4: pair IN day D + OUT day D+1
│       ├── dayCalculation.js         Stage 6: payable days, Sunday rule, contractor mode
│       ├── salaryComputation.js      Stage 7: earned salary, deductions, net
│       ├── advanceCalculation.js     Salary advance eligibility (50% rule)
│       ├── loanService.js            Loan EMI generation
│       ├── tdsCalculation.js         Indian tax slabs FY 2025-26
│       ├── financeRedFlags.js        8 red flag detectors for finance review
│       ├── jobQueue.js               SQLite-backed background job worker
│       ├── monthEndScheduler.js      node-cron pipeline status notifications
│       ├── analytics.js              Workforce analytics calculations
│       ├── dailyMIS.js               Daily MIS report generation
│       ├── exportFormats.js          PF ECR, ESI, NEFT, bank file generators
│       ├── behavioralPatterns.js     Late/absenteeism pattern detection
│       └── phase5Features.js         Leave accrual, attrition risk

frontend/
├── src/
│   ├── App.jsx                       Routes, Layout, RequireAuth wrapper
│   ├── main.jsx                      React entry
│   ├── store/appStore.js             Zustand global store (user, company, sidebar)
│   ├── pages/
│   │   ├── Login.jsx                 Auth
│   │   ├── Dashboard.jsx             Overview
│   │   ├── DailyMIS.jsx              Daily MIS
│   │   ├── Import.jsx                Stage 1
│   │   ├── MissPunch.jsx             Stage 2
│   │   ├── ShiftVerification.jsx     Stage 3
│   │   ├── NightShift.jsx            Stage 4
│   │   ├── AttendanceRegister.jsx    Stage 5 (corrections)
│   │   ├── DayCalculation.jsx        Stage 6
│   │   ├── SalaryComputation.jsx     Stage 7
│   │   ├── Employees.jsx             Employee master
│   │   ├── SalaryInput.jsx           Manual salary inputs
│   │   ├── SalaryAdvance.jsx         Advance management
│   │   ├── Loans.jsx                 Loans management
│   │   ├── LeaveManagement.jsx       Leaves
│   │   ├── Reports.jsx               Bank, PF, ESI exports
│   │   ├── FinanceAudit.jsx          Finance audit (7 tabs)
│   │   ├── FinanceVerification.jsx   Finance red flag verify + signoff
│   │   ├── ExtraDutyGrants.jsx       Dual-approval overnight grants
│   │   ├── Settings.jsx              Shifts, holidays, policy, users
│   │   ├── Compliance.jsx            PF/ESI compliance
│   │   ├── Analytics.jsx             Attendance analytics
│   │   ├── WorkforceAnalytics.jsx    Workforce metrics
│   │   ├── SessionAnalytics.jsx      User session analytics
│   │   └── Alerts.jsx                System alerts
│   ├── components/
│   │   ├── layout/{Sidebar,Header,NotificationBell}.jsx
│   │   ├── pipeline/PipelineProgress.jsx
│   │   ├── shared/CompanyFilter.jsx
│   │   ├── common/{DataTable,DateSelector,StatCard}.jsx
│   │   ├── GatePasses.jsx                     Gate pass tab (Leave Management)
│   │   ├── EarlyExitDetection.jsx             Early exit detection tab (Analytics)
│   │   ├── FinanceEarlyExitApprovals.jsx      Finance approval tab (Finance Audit)
│   │   └── ui/{Modal,ConfirmDialog,Tooltip,CalendarView,...}.jsx
│   ├── hooks/
│   │   ├── useDateSelector.js        Month/year picker with store sync
│   │   ├── useExpandableRows.js
│   │   └── useInactivityTimeout.js
│   └── utils/{api,formatters,abbreviations,payslipPdf,sessionTracker}.js
```

## Section 3: Pipeline Stage Dependency Map

## Sales Pipeline Stage 1: Holiday master + Coordinator sheet upload (Phase 2)
- Route: `backend/src/routes/sales.js` → `GET/POST/PUT/DELETE /sales/holidays`, `POST /sales/upload`, `GET /sales/upload/:uploadId/preview`, `PUT /sales/upload/:uploadId/match/:rowId`, `POST /sales/upload/:uploadId/confirm`
- Service: `backend/src/services/salesCoordinatorParser.js` → `parseSalesCoordinatorFile()`, `normalizeName()`, `normalizeManager()`, `normalizeCity()`, `CITY_TYPO_MAP`
- Tables read: `sales_employees` (tier matcher), `sales_uploads` (dedup via file_hash)
- Tables written: `sales_uploads` (one row per file; status='uploaded' → 'matched'), `sales_monthly_input` (one row per parsed sheet row, with `employee_code` NULL on low/unmatched and `match_confidence` + `match_method` on every row), `sales_holidays` (CRUD)
- Input contract: multipart upload at `POST /sales/upload` — single .xls/.xlsx file ≤10MB, field name `file`, optional `company`/`month`/`year` body (used only if parser can't detect them). Holiday master: `{holiday_date, holiday_name, company, applicable_states?, is_gazetted?}`.
- Output contract: upload returns `{uploadId, totalRows, matchedRows, unmatchedRows, month, year, company, filename}`. Preview returns `{upload, matched[], low[], unmatched[]}` with each row enriched by `resolved_employee` when linked. Confirm transitions `status='matched'` — required before Phase 3 compute.
- Downstream consumers: **Phase 3** salary compute reads confirmed `sales_monthly_input` rows joined with `sales_employees` + latest `sales_salary_structures`. `sales_holidays` feeds Step 3 (gazetted holiday credit) of the Phase 3 compute.
- Business rules (matcher): see Phase 2 entry in Section 0 for the 5-tier algorithm. Same-company only per §4A Q2. HR manual link sets `match_confidence='manual'`, `match_method='hr_manual'`.
- Business rules (parser): Dynamic header detection (rows 0–10); NO hardcoded row numbers. Q4 columns ("Working Days as Per AI", "Working Days Manual") explicitly dropped even when present in the sheet — only `sheet_days_given` is authoritative. Subtotal rows (name starts with "TOTAL" or "SUBTOTAL") skipped. Non-numeric `Day's Given` skipped.
- Edge cases: file_hash collision → 409 with `existingUploadId` (no re-parse); parser detects month/year from filename regex OR first-5-rows scan — falls back to multipart body; cross-company manual match rejected; confirm with any NULL `employee_code` rejected.

## Sales Pipeline Stage 2: Compute Engine + Register + Payslip (Phase 3 + Q5 reversal hotfix)
- Route: `backend/src/routes/sales.js` → `POST /sales/compute`, `GET /sales/salary-register`, `PUT /sales/salary/:id`, `PUT /sales/salary/:id/status`, `GET /sales/payslip/:code`. Also modified: `DELETE /sales/holidays/:id` (finalized-computation guard). `GET /sales/diwali-ledger` was removed in the Q5 reversal hotfix (2026-04-21).
- Service: `backend/src/services/salesSalaryComputation.js` → `computeSalesEmployee()`, `saveSalesSalaryComputation()`, `generateSalesPayslipData()`; shared `backend/src/services/sundayRule.js` → `calculateSundayCredit()`. (Ledger helpers `recomputeDiwaliLedgerCascade` / `writeDiwaliAccrualRow` deleted in the hotfix.)
- Tables read: `sales_monthly_input` (latest confirmed upload per month/year/company via `ORDER BY uploaded_at DESC LIMIT 1` where `status IN ('matched','computed')`), `sales_employees`, `sales_salary_structures` (most recent `effective_from <= month-end`), `sales_holidays`, `sales_salary_computations` (pre-read for HR-entered field preservation on recompute), `policy_config` (sales_leniency, sales_salary_divisor_mode, pf_ceiling, pf/esi rates).
- Tables written: `sales_salary_computations` (UPSERT on UNIQUE(employee_code, month, year, company)), `sales_uploads` (winning upload flipped to `status='computed'`). `sales_diwali_ledger` no longer exists post-hotfix — dropped by idempotent migration gated on `policy_config` key `migration_drop_sales_diwali_ledger_v1`.
- Input contract: `POST /sales/compute` body `{month, year, company}`. Requires at least one `status IN ('matched','computed')` upload for the period. Employee gate: matched sheet row exists AND `sales_employees.status='Active'` at period start.
- Output contract: compute response `{totalProcessed, computed, skipped, errors[], finalizedRecomputeWarnings[]}`. Register response `{rows[], totals{gross,earned,ot,incentive,diwali,deductions,net}}`. Payslip response full slip object (employee, period, days, earnings[], totalEarnings, deductions[], totalDeductions, netSalary, status, bank, computedAt, finalizedAt, finalizedBy).
- Downstream consumers: `SalesPayslip.jsx` (print view), `SalesSalaryCompute.jsx` register UI; Phase 4 will add Excel/NEFT exports (currently disabled placeholders).
- Business rules (Sunday): `sundayRule.calculateSundayCredit()` — shared pure function, 3 tiers (tier1_full: eff ≥ workingDays-leniency; tier2_proportional: eff > daysPerWeeklyOff; tier3_none). `daysPerWeeklyOff = (workingDays - leniency) / totalSundays`.
- Business rules (gazetted holiday credit): paid only if employee is Active on that date AND the applicable_states filter matches (or is NULL = all states). Counted in `gazetted_holidays_paid`, flows into `total_days` earned.
- Business rules (divisor): only `sales_salary_divisor_mode='calendar'` implemented in v1 — `earned_ratio = total_days / calendar_days`, capped at 1.0. `'26'`/`'30'` hooks read but silently fall back to calendar (Phase 4).
- Business rules (earnings): basic/hra/conveyance/medical/special/travel/washing/mobile × earnedRatio. OT/Incentive/Diwali stay outside earnedRatio (OT auto from sheet_ot, Incentive HR-entered per §4A Q6, Diwali_bonus HR-entered).
- Business rules (PF): `min(basic_earned, pf_ceiling)` × pf_rate, only if `salStruct.pf_applicable=1`. Sales has NO `da` column — PF base is basic_earned alone. (See §4A Q2 in Phase 3 notes.)
- Business rules (ESI): `grossEarned × esi_rate` only if `gross_salary <= 21000` AND `salStruct.esi_applicable=1`.
- Business rules (Professional Tax): DISABLED (same as plant, April 2026). Column retained but always 0.
- Business rules (Diwali — post-hotfix Q5 reversal): one-off bonus paid via `diwali_bonus` column in Oct/Nov through the regular salary run. HR enters the amount on the register (`PUT /salary/:id {"diwali_bonus": N}`); Step 7 adds it directly into `net_salary`. NO monthly deduction, NO ledger, NO accrual cascade. `diwali_recovery` column kept dead for UPSERT completeness — always written as 0, never read.
- Business rules (status state machine): `ALLOWED_STATUS_MOVES` = {`computed`: [`reviewed`, `hold`], `reviewed`: [`computed`, `finalized`, `hold`], `finalized`: [`paid`, `hold`], `hold`: [`computed`, `reviewed`, `finalized`], `paid`: []}. 400 on illegal transitions. `→finalized` stamps `finalized_at`/`finalized_by`. `paid` is terminal.
- Business rules (finalized-row edit guard): `PUT /sales/salary/:id` rejects edits to incentive/diwali/other/hold_reason when `status IN ('finalized','paid')`. HR must move row → `hold` first.
- Business rules (finalized-row recompute): Not blocked, but writes to `finalizedRecomputeWarnings[]` in response when net_salary drifts > ₹1. UI does NOT yet surface the array (Phase 4 cosmetic gap).
- Business rules (recompute idempotency): pre-read `incentive_amount`, `diwali_recovery`, `other_deductions`, `hold_reason`, `status`, `finalized_at`, `finalized_by`, `diwali_bonus` before the UPSERT so HR-entered fields survive. UPSERT has 37 `= excluded.*` assignments (one per mutable column; grep-verified).
- Business rules (upload supersede): latest `status IN ('matched','computed')` upload wins. Earlier uploads remain `'matched'` / `'computed'` — NOT auto-flipped to `'superseded'` per Phase 2 Q2. Compute stamps the winner `'computed'` (no-op if it's already computed).
- Business rules (holiday delete guard): `DELETE /sales/holidays/:id` returns 409 when any `sales_salary_computations` row with `status='finalized'` exists for the same (company, month, year) as the holiday date. Holidays in `computed`/`reviewed`/`hold`/`paid` months CAN be deleted.
- Edge cases: recompute with edited salary_structure (gross change) on finalized rows → warnings reported, row still updated; deleted holiday in `hold` month → allowed; upload v2 supersedes v1 silently; no confirmed upload for period → `POST /compute` returns 400.

## Sales Pipeline Stage 3: Exports + Payslip PDF + Paid Guardrail (Phase 4)
- Route: `backend/src/routes/sales.js` → `GET /sales/export/salary-register`, `GET /sales/export/bank-neft`. Modified existing: `PUT /sales/salary/:id/status` (paid guardrail), `GET /sales/payslip/:code` (audit stamp side-effect).
- Service: `backend/src/services/salesExportFormats.js` → `generateSalesExcel()`, `generateSalesNEFT()`. Uses existing `xlsx@0.18.5`. Frontend payslip PDF at `frontend/src/utils/salesPayslipPdf.js → downloadSalesPayslipPDF()` using `html2pdf.js`.
- Tables read: `sales_salary_computations` joined with `sales_employees` (HQ / State / Reporting Manager / Designation / DOJ / bank fields).
- Tables written: `sales_salary_computations` — 2 new stamp columns (`neft_exported_at`, `payslip_generated_at`), both pre-read + carried forward in the UPSERT so recompute preserves them.
- Input contract: `month`, `year`, `company` query params on each export; `download=true` switches preview JSON → binary download. Payslip GET unchanged (code + same 3 query params).
- Output contract:
  - **Excel**: 38-column salary register XLSX. Frozen header row, column widths set. Cell styling not applied (community SheetJS limitation). Filename `Sales_Salary_Register_<MMM>_<YYYY>_<Company_Underscored>.xlsx`.
  - **NEFT CSV**: header byte-identical to plant `generateBankFile` (`Sr No,Beneficiary Name,Account Number,IFSC Code,Date of Joining,Amount,Narration`). Narration `SALARY <MMM> <YYYY>` uppercase. DOJ as `DD/MM/YYYY`. Amount 2-decimal. Filename `Sales_Bank_Salary_<MMM>_<YYYY>_<Company_Underscored>.csv`. Filter: `net_salary > 0 AND status != 'hold'`. Rows missing `account_no` or `ifsc` are surfaced in the `missing[]` JSON preview and excluded from the download.
  - **Payslip PDF**: rendered client-side from the existing `GET /sales/payslip/:code` JSON payload. Layout per design §10 (identity block + days block + earnings/deductions tables + net callout + bank details + footer). "NOT VALID · DRAFT" watermark overlaid diagonally when `status NOT IN ('finalized', 'paid')`.
- Downstream consumers: none — Phase 4 endpoints are terminal. The paid-status downstream (bank reconciliation, settlement) is out of scope.
- Business rules:
  - **Paid guardrail** (`PUT /salary/:id/status`): if target status = `paid` and `neft_exported_at IS NULL`, return 400 with explicit error. Mirrors Phase 3's transition matrix (finalized → paid is already allowed) but adds a second gate.
  - **NEFT stamp side-effect** (`GET /export/bank-neft?download=true`): stamps `neft_exported_at = datetime('now')` for every row in the exported CSV. Transactional with file generation — partial failure rolls back both. Audit log row written (`action_type='neft_export'`).
  - **Payslip stamp side-effect** (`GET /payslip/:code`): stamps `payslip_generated_at = datetime('now')` after successful payload assembly. Best-effort try/catch — audit failure never breaks payslip delivery.
  - **Recompute preservation**: `computeSalesEmployee` pre-reads both stamps from the prior row and carries them forward in the compute result. UPSERT column list extended from 41 → 43 columns; INSERT + placeholders + ON CONFLICT UPDATE + param list all match 43 = 43 = 43 (grep-verified).
  - **Permission**: router-level `requireHrOrAdmin` gates all `/api/sales/*` endpoints including Phase 4. Finance role → 403 on exports. `'sales-exports'` added to HR permission array (admin inherits via `*`).
  - **Excel styling**: intentionally minimal (column widths + frozen first row via `!freeze`/`!views`). Community SheetJS doesn't reliably render bold/fill/currency styles; upgrading to `xlsx-js-style` or SheetJS Pro deferred.
- Edge cases:
  - NEFT export with 0 eligible rows (all on `hold` or all `net_salary=0`): returns header-only CSV, no rows stamped, `totals.count=0`.
  - NEFT export with some rows missing bank details: `missing[]` populated in preview, excluded from CSV, still counted when computing `totals.missingCount`. HR confirms exclusion in the frontend modal before the download fires.
  - Plant NEFT regression: the sales NEFT file has a distinct filename prefix (`Sales_`) and reads from `sales_salary_computations` only — never touches plant's `salary_computations` table. Plant `GET /api/reports/bank-salary-file` → byte-identical md5 before + after Phase 4 build (confirmed `ab039504dadedf05c9579c861959ba89`).
  - Recompute on a `paid` row with a prior NEFT stamp: stamps preserved; `net_salary` recomputes to the current value (may drift — surfaced in `finalizedRecomputeWarnings[]` if > ₹1 drift).
  - Payslip GET on a row with `status='computed'` (draft): JSON payload unchanged; the frontend renders a diagonal "NOT VALID · DRAFT" watermark both on-screen and in the PDF.

## Stage 1: Import (EESL biometric upload)
- Route: `backend/src/routes/import.js` → `POST /upload`, `GET /history`, `GET /summary/:month/:year`, `POST /reconciliation/*`
- Service: `backend/src/services/parser.js` → `parseEESLFile()`, `findLandmarks()`, `parseSheet()`, `normalizeTime()`
- Tables read: `employees` (lookup by code for company fallback), `monthly_imports`
- Tables written: `monthly_imports` (one row per file), `attendance_raw` (~9000 rows/month), `attendance_processed` (deduped, status_original set)
- Input contract: EESL .xls file uploaded via multipart; valid month/year extracted from sheet
- Output contract: `attendance_processed` row per (employee_code, date) with `in_time_original`, `out_time_original`, `status_original`, `is_night_out_only` flags. Auto-detects night shifts (in_time >= 19:00 OR < 6:00).
- Downstream consumers: Stages 2-7 ALL read `attendance_processed`
- Business rules: dynamic column scanning for "Emp. Name" header (handles format variations), company fallback from employee master if EESL company column empty, dedup on (employee_code, date)
- Edge cases: month boundary handling, empty company column, multi-sheet files

## Stage 2: Miss Punch Detection
- Route: `backend/src/routes/attendance.js` → `GET /miss-punches`, `POST /miss-punches/:id/resolve`, `POST /miss-punches/bulk-resolve`
- Service: `backend/src/services/missPunch.js` → `detectMissPunches()`, `applyMissPunchFlags()`
- Tables read: `attendance_processed`
- Tables written: `attendance_processed` (sets `is_miss_punch=1`, `miss_punch_type`, `miss_punch_status`)
- Input contract: Stage 1 complete (attendance_processed populated)
- Output contract: Records flagged as MISSING_IN, MISSING_OUT, NIGHT_UNPAIRED, NO_PUNCH
- Downstream consumers: Stage 6 day calculation reads status_final
- Business rules: Detects ~145 cases/month. Manual resolution updates status_final and in_time_final/out_time_final
- Edge cases: Night shift unpaired, weekly off worked

## Stage 3: Shift Check
- Route: `backend/src/routes/attendance.js` → `GET /shift-mismatches`, `PUT /record/:id`
- Service: Inline in attendance.js
- Tables read: `attendance_processed`, `shifts`, `employees`
- Tables written: `attendance_processed` (shift_id, shift_detected)
- Input contract: Stage 2 complete (miss punches resolved)
- Output contract: Each record has shift assigned (auto from punch time or manual override)
- Downstream consumers: Stage 4 night shift pairing, Stage 6 day calc
- Business rules: Auto-detect night shift if in_time >= 19:00 or < 06:00

## Stage 4: Night Shift Pairing
- Route: `backend/src/routes/attendance.js` → `GET /night-shifts`, `POST /night-shifts/:id/confirm`, `POST /night-shifts/:id/reject`
- Service: `backend/src/services/nightShift.js` → `pairNightShifts()`, `applyPairingToDb()`
- Tables read: `attendance_processed`
- Tables written: `night_shift_pairs`, `attendance_processed` (sets `is_night_out_only=1` on the OUT-only record so it's not double-counted)
- Input contract: Stage 3 complete
- Output contract: Pairs of IN day D with OUT day D+1 form a single shift
- Downstream consumers: Stage 6 day calc (skips records with is_night_out_only=1)
- Business rules: ~190 pairs/month. IN >= 18:00 day D + OUT <= 12:00 day D+1
- Edge cases: Cross-month boundary (Dec 31 → Jan 1)

## Stage 5: Manual Corrections
- Route: `backend/src/routes/attendance.js` → `PUT /record/:id`, `POST /miss-punches/:id/resolve`; `backend/src/routes/financeAudit.js` → `POST /day-correction`, `POST /punch-correction`, `POST /corrections/apply-leave`, `POST /corrections/mark-present`
- Service: Inline + financeAudit.js
- Tables read: `attendance_processed`, `day_corrections`, `punch_corrections`
- Tables written: `day_corrections` (audit trail), `punch_corrections` (audit trail), `attendance_processed` (status_final updated), `manual_attendance_flags`
- Input contract: Stages 1-4 complete
- Output contract: Final attendance state ready for day calculation
- Downstream consumers: Stage 6 day calc reads `status_final`
- Business rules: Every correction logged with reason + user
- Edge cases: Apply leave (A → CL/EL/SL with balance check), mark present with evidence

## Stage 6: Day Calculation
- Route: `backend/src/routes/payroll.js` → `POST /calculate-days`, `GET /day-calculations`, `GET /day-calculations/:code`, `PUT /day-calculations/:code/late-deduction`
- Service: `backend/src/services/dayCalculation.js` → `calculateDays(empCode, month, year, company, records, leaveBalances, holidays, options)`, `saveDayCalculation()`
- Tables read: `attendance_processed`, `holidays`, `leave_balances`, `employees`, `extra_duty_grants` (manual grants with both approvals)
- Tables written: `day_calculations` (one row per employee per month per company)
- Input contract: Stages 1-5 complete; `is_contractor` flag set on employee; `employees.date_of_joining` set for new joiners
- Output contract: `day_calculations` row with: total_payable_days, days_present, days_half_present, days_wop, days_absent, paid_sundays, paid_holidays, lop_days, ot_hours, extra_duty_days, holiday_duty_days, week_breakdown (JSON), date_of_joining, holidays_before_doj, is_mid_month_joiner, finance_ed_days (display-only count of finance-approved ED grants minus WOP overlap)
- Downstream consumers: Stage 7 salary computation, Finance Audit, Reports
- Business rules:
  - Sunday rule (permanent only): worked >=6 Mon-Sat → paid Sunday; 4-5 → CL/EL fallback or LOP if shortage <=1.5; <4 → unpaid Sunday
  - WOP days (worked on Sunday) → always paid
  - Half-day (½P) = 0.5 working day
  - Contractor mode: payable = present + WOP + halfPresent (no Sunday eligibility, no CL/EL)
  - LOP waived if total worked days >= total working days OR rawPayableDays >= calendar days
  - Manual extra duty grants added when both HR + Finance approved
  - **DOJ-based holiday eligibility (April 2026)**: pre-DOJ dates are skipped in
    the attendance loop (no absent), pre-DOJ holidays are excluded from
    `paidHolidays` (counted in `holidaysBeforeDOJ`), pre-DOJ weekly offs are
    excluded from `totalWeeklyOffs`, and `totalCalendarDays`/`totalWorkingDays`
    are scoped to DOJ→month-end. `dateOfJoining` is threaded via
    `options.dateOfJoining` (`null` ⇒ legacy / no filtering, all backward compat).
    `is_mid_month_joiner=1` flags rows for finance review.
- Edge cases: Cross-month night shifts, holidays on Sundays, partial weeks at month boundary, mid-month joiners (pre-DOJ days never counted), DOJ-on-holiday (eligible), DOJ-on-weekly-off (weekly off counts), returning employees (DOJ in past ⇒ no-op)

## Stage 7: Salary Computation
- Route: `backend/src/routes/payroll.js` → `POST /compute-salary`, `GET /salary-register`, `POST /finalise`, `GET /payslip/:code`, `GET /salary-slip-excel`
- Service: `backend/src/services/salaryComputation.js` → `computeEmployeeSalary()`, `saveSalaryComputation()`, `generatePayslipData()`, `getAdvanceRecovery()`, `getLoanDeductions()`
- Tables read: `day_calculations`, `salary_structures`, `employees`, `salary_advances`, `loan_repayments`, `tax_declarations`, `policy_config`, `extra_duty_grants` (April 2026 — for `ed_pay` bucket), `attendance_processed` (for WOP overlap detection)
- Tables written: `salary_computations` (one row per employee per month per company; includes new `ed_days`/`ed_pay`/`take_home`/`late_coming_deduction`), `salary_manual_flags` (auto-populated for finance audit), `salary_advances` (marked recovered), `late_coming_deductions` (is_applied_to_salary flag flipped after compute)
- Input contract: Stage 6 complete; salary_structures populated; `employees.gross_salary` set
- Output contract: salary_computations row with: gross_salary, gross_earned, basic/da/hra/conveyance/other_allowances_earned, ot_pay, holiday_duty_pay, ed_days, ed_pay, take_home, pf_employee/employer, esi_employee/employer, professional_tax, tds, advance_recovery, loan_recovery, lop_deduction, total_deductions, net_salary, total_payable, salary_held, hold_reason, finance_remark
- Downstream consumers: Finance Audit, Finance Verify, Payslip PDF, Bank NEFT export, PF ECR, ESI returns
- Business rules:
  - divisor = 26 (from policy_config.salary_divisor) — used for BASE salary pro-rata when payableDays ≤ 26
  - **Hybrid divisor** (April 2026 fix): `effectiveDivisor = payableDays > 26 ? calendarDays : 26`,
    `earnedRatio = min(payableDays / effectiveDivisor, 1.0)`. Matches HR's calc:
    Amit ₹24,000 × 28/31 = ₹21,677; Preeti ₹24,700 × 28/31 = ₹22,310; Sonu 31/31 = full;
    SONU 70059 20/26 = ₹10,769.
  - Base components (basic/da/hra/conv/other) × earnedRatio — capped so never exceed monthly gross
  - Component scaling: if `salary_structures` component sum ≠ stated gross, scale components
    proportionally to honour stated gross (preserves existing ratios)
  - OT / extra duty rate uses CALENDAR DAYS not divisor: `grossMonthly / calendarDays`
    (Sundays do NOT inflate the OT per-day rate)
  - otPay = otDays × (grossMonthly / calendarDays) + otHours × (grossMonthly / (calendarDays × 8)) × otRate
  - holidayDutyPay uses calendar-day rate too
  - grossEarned = (sum of base components capped at grossMonthly) + otPay + holidayDutyPay
  - PF: 12% of min(basic+da, 15000 ceiling), only if pf_applicable
  - ESI: 0.75% employee / 3.25% employer of grossEarned, only if grossMonthly <= 21000
  - **Professional Tax: DISABLED** (per HR directive April 2026) — always 0
  - LOP: pro-rating handles it (no separate deduction)
  - Auto-hold: payable_days < 5 OR 7+ end-of-month consecutive absent days
  - Finance sign-off gate blocks finalisation
- Edge cases: SILP/contract employees skip pf_applicable check, gross changed flag, returning employees

## Consumer: Finance Audit
- Route: `backend/src/routes/financeAudit.js` → 16 endpoints (`/report`, `/day-correction`, `/punch-correction`, `/corrections/:code`, `/corrections-summary`, `/corrections/apply-leave`, `/corrections/mark-present`, `/manual-flags`, `/salary-manual-flags`, `/approve-flag/:id`, `/bulk-approve`, `/readiness-check`, `/variance-report`, `/statutory-crosscheck`)
- Tables read: `salary_computations`, `day_calculations`, `day_corrections`, `punch_corrections`, `manual_attendance_flags`, `salary_manual_flags`, `finance_approvals`, `audit_log`
- What it produces: 7-tab UI (Readiness, Manual Interventions, Variance, Statutory, Report, Attendance Flags, Corrections Summary)
- Sensitivity: Any change to salary_computations columns or day_calculations columns breaks report queries

## Consumer: Finance Verification
- Route: `backend/src/routes/financeVerification.js` → 11 endpoints (`/dashboard`, `/employees`, `/employee/:code`, `/red-flags`, `/status`, `/bulk-verify`, `/comment`, `/comments`, `/comment/:id/resolve`, `/signoff`, `/signoff-status`)
- Service: `backend/src/services/financeRedFlags.js` → `detectRedFlags()` with 9 detectors (incl. `doj_holiday_exclusion` for mid-month joiners)
- Tables read: `salary_computations`, `day_calculations`, `salary_advances`, `salary_structures`, `employees`, `finance_audit_status`, `finance_audit_comments`
- Tables written: `finance_audit_status`, `finance_audit_comments`, `finance_month_signoff`
- What it produces: 3-tab dashboard (Audit Dashboard, Employee Review, Red Flags) + sign-off workflow
- Sensitivity: Red flag detection queries assume specific column names on salary_computations

## Consumer: Payslip PDF
- Route: `backend/src/routes/payroll.js` → `GET /payslip/:code`, `GET /payslips/bulk`, `GET /salary-slip-excel`
- Service: `salaryComputation.js → generatePayslipData()`; `frontend/src/utils/payslipPdf.js`
- Tables read: `salary_computations`, `day_calculations`, `employees`, `salary_structures`, `company_config`
- What it produces: Individual PDF per employee + bulk Excel salary slip (4 per page)
- Sensitivity: Field name changes in salary_computations break PDF rendering

## Consumer: Salary Advance
- Route: `backend/src/routes/advance.js` → `GET /`, `POST /calculate`, `PUT /:id/mark-paid`, `GET /recovery`, `PUT /:id/set-remark`
- Service: `backend/src/services/advanceCalculation.js → calculateAdvances()`
- Tables read: `attendance_processed` (1st-15th working days), `employees`, `salary_structures`
- Tables written: `salary_advances`
- What it produces: Mid-month advance eligibility (50% of pro-rata salary if 15+ working days in 1st half)
- Sensitivity: Stage 7 reads `salary_advances` for recovery — schema must remain stable

## Consumer: Loans
- Route: `backend/src/routes/loans.js` → `GET /`, `POST /`, `POST /:id/disburse`, `POST /:id/recover`, `GET /monthly-recovery/:month/:year`
- Service: `backend/src/services/loanService.js`
- Tables read/written: `loans`, `loan_repayments`
- What it produces: EMI schedules; Stage 7 reads pending EMIs for the month
- Sensitivity: `loan_repayments` schema feeds salary computation deductions

## Consumer: Reports / Exports
- Route: `backend/src/routes/reports.js` → `GET /pf-ecr`, `GET /esi-return`, `GET /bank-neft`, `GET /attendance-summary`
- Service: `backend/src/services/exportFormats.js`
- Tables read: `salary_computations`, `employees`, `salary_structures`
- What it produces: PF ECR text file, ESI return CSV, Bank NEFT CSV, monthly attendance summary
- Sensitivity: Any column rename in salary_computations breaks exports

## Consumer: Analytics + Compliance + Daily MIS
- Routes: `analytics.js`, `compliance.js` (in settings.js), `daily-mis.js`
- Tables read: `attendance_processed`, `day_calculations`, `salary_computations`, `employees`
- Sensitivity: Read-only consumers; column changes break dashboard widgets

## Section 4: Database Schema Summary
- Total tables: **48** (in `backend/src/database/schema.js`) — +1 late_coming_deductions, +4 early exit (April 2026)
- Attendance: `attendance_raw`, `attendance_processed` (now with `is_left_late`/`left_late_minutes` for late coming tracking + `is_early_departure`/`early_by_minutes` for early exit), `night_shift_pairs`, `monthly_imports`, `manual_attendance_flags`, `day_corrections`, `punch_corrections`
- Employee/salary: `employees`, `salary_structures`, `salary_computations` (now with `early_exit_deduction`), `salary_advances`, `salary_change_requests`, `salary_manual_flags`, `loans`, `loan_repayments`, `tax_declarations`, `extra_duty_grants`, `late_coming_deductions`, `short_leaves` (NEW, April 2026), `early_exit_detections` (NEW), `early_exit_deductions` (NEW), `early_exit_deduction_audit` (NEW)
- Processing: `day_calculations`, `holidays`, `holiday_audit_log`, `shifts` (now with `duration_hours` + seeded 12HR/10HR/9HR rows), `shift_roster`, `leave_balances`, `leave_transactions`, `leave_applications`
- Audit: `audit_log`, `usage_logs`, `finance_audit_status`, `finance_audit_comments`, `finance_month_signoff`, `finance_approvals`
- System: `users`, `policy_config`, `company_config`, `notifications`, `compliance_items`, `alerts`, `employee_documents`, `employee_lifecycle`, `monthly_dept_stats`, `monthly_employee_stats`, `session_events`, `session_daily_summary`
- **Critical UNIQUE constraints**:
  - `employees(code)`, `shifts(code)`
  - `day_calculations(employee_code, month, year, company)` ← prevents duplicate stage-6 runs
  - `salary_computations(employee_code, month, year, company)` ← prevents duplicate stage-7 runs
  - `salary_advances(employee_code, month, year)`
  - `attendance_processed(employee_code, date)` (unique index, post-dedup migration)
  - `monthly_imports(month, year, company)`
  - `salary_manual_flags(employee_code, month, year, flag_type)`
  - `tax_declarations(employee_code, financial_year)`
  - `finance_audit_status(employee_code, month, year)`
  - `finance_month_signoff(month, year, company)`
  - `extra_duty_grants(employee_code, grant_date, month, year)`
- **FK pattern**: `employee_id INTEGER REFERENCES employees(id)` on most child tables. Pipeline tables also use `employee_code` as the join key.
- **Composite key pattern**: `(employee_code, month, year, company)` is the universal join key across day_calculations, salary_computations, leave_balances. Drives every monthly query.
- **JSON in TEXT columns**: `day_calculations.week_breakdown` (Sunday rule per-week JSON), `salary_change_requests.old_structure`/`new_structure`, `holiday_audit_log.old_values`/`new_values`, `salary_manual_flags` notes

## Section 5: Salary Calculation Engine
- File: `backend/src/services/salaryComputation.js`
- **Salary divisor: 26** — used for base salary pro-rata ONLY. Never change.
- **earnedRatio formula** (hybrid divisor): `effectiveDivisor = payableDays > 26 ? calendarDays : 26`,
  `earnedRatio = min(payableDays / effectiveDivisor, 1.0)`. Under-26 days prorate on
  divisor 26; over-26 days prorate on calendar days of the month. Applied to both
  contractor and permanent paths.
- **Component scaling** (April 2026): If `salary_structures` components exist but don't
  sum to the stated gross (`employees.gross_salary` or `salary_structures.gross_salary`),
  components are scaled by `scaleFactor = statedGross / rawComponentSum` so the sum
  matches stated gross while preserving ratios. If no components exist, fall back to
  percentage-based derivation from `basic_percent`/`hra_percent`.
- **OT / Extra Duty rate** (April 2026): Uses CALENDAR DAYS, not divisor.
  `otPerDayRate = grossMonthly / calendarDays` — Sundays don't inflate the rate.
  `otPay = otDays × otPerDayRate + otHours × (grossMonthly / (calendarDays × 8)) × otRate`.
  `otDays = dayCalc.extra_duty_days` (pure punch-based, since the ED-integration overhaul).
  Finance-approved grants now flow into a SEPARATE `ed_pay` bucket — see ED Integration below.
- **Extra Duty (ED) Integration** (April 2026): `ed_pay` is a NEW bucket, separate from
  `ot_pay`. Sourced from `extra_duty_grants` rows with `status='APPROVED' AND
  finance_status='FINANCE_APPROVED'`, MINUS any grant whose `grant_date` overlaps with a
  WOP/WO½P attendance day (anti-double-counting — those days are already paid via punch OT).
  Same per-day rate (`gross / calendarDays`). Persisted in `salary_computations.ed_days`,
  `ed_pay`, `take_home`. ED is NOT part of `gross_earned` (deductions don't apply to it).
  - `take_home = total_payable + ed_pay = net_salary + ot_pay + holiday_duty_pay + ed_pay`
  - `total_payable` is unchanged (existing exports stay stable); new reports use `take_home`
  - Stage 6 also persists `day_calculations.finance_ed_days` for the UI breakdown
  - Contractors get zero ED (same gate as OT)
- **Holiday Duty Pay**: Also uses calendar-day rate.
- **Professional Tax: DISABLED** (April 2026, HR directive). Hard-coded to 0 regardless of
  gross or pt_applicable flag. Column/row removed from Stage 7 UI, payslip PDF, Excel export.
  `calcProfessionalTax()` helper retained for backward compat but never invoked.
- **Pro-rated components**: basic, da, hra, conveyance, other_allowances (× earnedRatio)
- **Independent components**: `otPay = otDays × otPerDayRate + otHours × otHourlyRate × otRate` where
  `otPerDayRate = grossMonthly / calendarDays` and `otHourlyRate = grossMonthly / (calendarDays × 8)`;
  `holidayDutyPay = holidayDutyDays × otPerDayRate`. Uncapped, NOT gated on workedFullMonth.
  `otDays = dayCalc.extra_duty_days` (pure biometric overflow). Finance-approved
  grants now feed `ed_pay` separately, with date-level anti-double-counting against
  WOP/WO½P attendance days.
- **Extra Duty Pay (ED, April 2026)**: `edPay = edDays × otPerDayRate` where
  `edDays = sum(extra_duty_grants.duty_days WHERE status='APPROVED' AND
  finance_status='FINANCE_APPROVED' AND grant_date NOT IN (WOP/WO½P dates))`.
  Capped at calendarDays. Excluded from `grossEarned`/PF/ESI. Not paid for contractors.
  `take_home = total_payable + ed_pay`.
- **grossEarned formula**: `min(baseEarned, grossMonthly) + otPay + holidayDutyPay`
- **PF**: 12% of `min(basic + da, 15000)` for both employee and employer. EPS split: `min(pfWageBase × 0.0833, 1250)`. Rates from `policy_config`. Gated by `salStruct.pf_applicable`.
- **ESI**: 0.75% employee / 3.25% employer of `grossEarned`, only if `grossMonthly <= 21000` threshold. Gated by `salStruct.esi_applicable`.
- **Professional Tax**: **DISABLED** (April 2026). Always 0. `calcProfessionalTax()` helper retained but never invoked.
- **TDS**: Auto-calculated from `tax_declarations` table; falls back to manually entered TDS preserved across recomputations.
- **LOP**: NOT a separate deduction — pro-rating handles missed days via earnedRatio (line 338).
- **Early Exit Deduction** (April 2026): Finance-approved deductions for leaving before shift end.
  Summed from `early_exit_deductions` where `finance_status='approved'` and `deduction_type != 'warning'`.
  Stored as rupee amount (not days × rate). Contractors excluded. `salary_applied` flag prevents
  double-counting on recompute (same pattern as late coming). Column: `salary_computations.early_exit_deduction`.
- **Net salary formula**: `Math.max(0, grossEarned - totalDeductions)`. totalDeductions = pf + esi + tds + advance + lop + other + loan + lateComingDeduction + earlyExitDeduction (PT always 0).
- **Take-home formula** (April 2026 ED integration): `take_home = net_salary + ot_pay + holiday_duty_pay + ed_pay` (= `total_payable + ed_pay`). New ED bucket sits OUTSIDE deductions and the existing total_payable, so older bank/PF/ESI exports stay stable while the take-home figure on payslips and the OT&ED Payable register reflects everything the employee actually receives.
- **Rounding**: `Math.round(x * 100) / 100` everywhere (2 decimal precision).
- **Salary hold logic**: Auto-hold if (a) `rawPayableDays < 5`, OR (b) 7+ consecutive absent days at month-end (unless approved leave exists). Hold reason stored in `salary_computations.hold_reason`.
- **Finance gate**: `POST /finalise` blocked unless `finance_month_signoff.status = 'approved'` AND no unreviewed extra_duty_grants.

## Section 6: Shared State & Cross-Cutting Dependencies
- **Employee model**: `code` (string, unique business key), `id` (integer FK target), `name`, `department`, `company`, `status` (Active/Left/Exited), `is_contractor`, `gross_salary`, `date_of_joining`, `was_left_returned`. Used across all pipeline stages and consumers.
- **Company filter**: Passed as `?company=X` query param on every endpoint. SQL queries use `WHERE company = ?` with optional fallthrough. RBAC restricts via `users.allowed_companies`.
- **Month/year context**: URL query params + Zustand store sync via `useDateSelector({ syncToStore: true })`. Stored in `useAppStore.selectedMonth/selectedYear`.
- **State management**: **Zustand** (`frontend/src/store/appStore.js`). Single store for: user, isAuthenticated, selectedCompany, selectedMonth, selectedYear, sidebarCollapsed, alertCount. No Redux, no Context API.
- **Authentication**: `backend/src/middleware/auth.js` (`requireAuth`, `requireAdmin`, `getCompanyFilter`). JWT issued by `routes/auth.js`. Token in httpOnly cookie + Bearer header. 12h expiry, sliding refresh via heartbeat.
- **Audit logging**: `backend/src/database/db.js` exports `logAudit(table, recordId, field, oldValue, newValue, user, reason)` writing to `audit_log` table. Called from corrections, status changes, finance approvals.
- **EESL parser**: `backend/src/services/parser.js` — handles EESL format variations via dynamic landmark scanning (`findLandmarks()` line 93). Company column may be empty → falls back to employee master lookup. Status codes: P, A, WO, WOP, ½P, HP, NH, ED.

## Section 7: Known Gotchas & Domain Rules
- **Salary overcalculation**: Without `Math.min(earnedRatio, 1.0)`, employees working 28-31 days produce ratio > 1.0 and inflate all base components by 8-19%. Cap applied uniformly to both contractor and permanent paths. OT/holiday duty are legitimately uncapped but use calendar-day rate, not divisor.
- **Component mismatch**: `salary_structures` components (basic+da+hra+conv+other) may not sum to the stated gross_salary. When mismatched, salaryComputation.js scales components by `scaleFactor = statedGross / rawComponentSum` to honour the stated gross. Diagnostic query: `SELECT e.code, e.name, COALESCE(e.gross_salary, ss.gross_salary, 0) AS stated, (basic+da+hra+conveyance+other_allowances) AS sum FROM employees e LEFT JOIN salary_structures ss ON ss.employee_id=e.id WHERE e.status='Active' AND ABS(stated - sum) > 1`.
- **Mark Left preservation**: Manual "Mark Left" actions (via `PUT /employees/:code/mark-left`) set `auto_inactive=0` AND `inactive_since=exit_date` so reimports do NOT resurrect them. Four code paths respect this: (1) import.js auto-reactivation checks `auto_inactive=1` before reactivating, (2) `POST /reconciliation/add-to-master` preserves Left status via CASE WHEN, (3) `POST /bulk-import` preserves Left via CASE WHEN, (4) auto-detect-Left in import.js only marks auto_inactive=1 (never touches manual marks).
- **Sunday rule complexity**: 3-tier in `dayCalculation.js` (lines 220-275). ≥6 worked → paid. 4-5 → CL/EL fallback or LOP (if shortage <=1.5). <4 → unpaid. WOP days (employee actually worked the Sunday) are ALWAYS paid regardless of Mon-Sat count.
- **Night shift pairing**: IN ≥ 18:00 day D + OUT ≤ 12:00 day D+1 → single shift. ~190 cases/month. Stage 4 sets `is_night_out_only=1` on the OUT record so Stage 6 doesn't double-count.
- **EESL format variations**: Column positions vary between companies/months. Parser scans for "Emp. Name" header to detect column index dynamically. Company column may be empty → fallback to employee master.
- **Miss punches**: ~145/month. MUST be resolved before Stage 6 or absent count is inflated. NIGHT_UNPAIRED edge case requires Stage 4 first.
- **Decimal precision**: Working days are fractional (0.5 for half days). Use `Math.round(x * 100) / 100` consistently. Never `Math.floor` or `parseInt`.
- **PF/ESI threshold crossings**: Wages crossing ₹15,000 (PF) or ₹21,000 (ESI) mid-year change applicability. Salary computation reads `pf_applicable`/`esi_applicable` from latest salary_structure each month — manual override needed if threshold crossed.
- **Contractor vs permanent paths**: Contractor mode skips Sunday eligibility entirely. `is_contractor` flag on `employees` table OR department-keyword detection in `utils/employeeClassification.js`. COM. HELPER is NOT contractor (permanent staff). MANPREET CON IS contractor.
- **SQLite WAL mode**: Concurrent reads OK, writes serialized. Bulk operations use transactions (`db.transaction()`) for atomicity.
- **Railway deployment**: `DATA_DIR` and `UPLOADS_DIR` env vars control file paths. Production uses persistent volume mount. SQLite file MUST live in persistent volume, not container fs.
- **Salary advance recovery loop**: `getAdvanceRecovery()` resets `recovered=0` flag before query so re-runs find advances; ON CONFLICT UPDATE on `salary_computations` includes `advance_recovery` so the value persists.
- **Holiday duty pay**: National holidays (Mar 4 etc) auto-detected. If employee works the holiday, paid extra at per_day_rate. Tracked separately from OT.
- **Early exit detection**: Runs after attendance import (POST /api/early-exits/detect). If detection is not triggered, `is_early_departure` stays 0 and deductions cannot be created. Gate passes in `short_leaves` provide exemption or reduce flagged minutes. Detection is idempotent (UPSERT on employee_code+date).
- **Gate pass quota**: 2 per employee per calendar month. Breachable with `force_quota_breach: true`. Cancelled gate passes don't count toward quota. Cancellation blocked after employee punches out.

## Late Coming Management System (April 2026 — Phase 1 + Phase 2 complete)
- **Three canonical shifts** seeded in `shifts` table: `12HR` (08:00–20:00, 12h),
  `10HR` (09:00–19:00, 10h), `9HR` (09:30–18:30, 9h). All shifts have
  `grace_minutes=9` per plant policy (including legacy DAY/NIGHT/GEN).
- **Grace period policy**: 9 minutes for ALL shifts. HR cannot change grace —
  the `PUT /api/settings/shifts/:id` endpoint gates `grace_minutes` writes
  behind `req.user.role === 'admin'`. HR can edit `start_time` + `duration_hours`,
  and `end_time` is auto-derived server-side (`calcEndTime()` helper in settings.js).
- **New columns on `attendance_processed`**: `is_left_late` (INTEGER 0/1),
  `left_late_minutes` (INTEGER). Calculated alongside late-arrival detection
  in `import.js` post-processing + `attendance.js POST /recalculate-metrics`.
  Threshold: 20+ minutes past shift end time. Overnight shifts handle end-time
  wraparound correctly. These columns are PURELY ADDITIVE — the late-arrival
  logic, status fields, and all downstream pipeline stages are untouched.
- **New table `late_coming_deductions`** (April 2026): HR-initiated discretionary
  deductions with finance review queue. Columns: `employee_code`, `month`, `year`,
  `company`, `late_count`, `deduction_days` (0.5–5), `remark` (NOT NULL),
  `applied_by`, `applied_at`, `finance_status` ('pending' | 'approved' |
  'rejected'), `finance_reviewed_by`, `finance_reviewed_at`, `finance_remark`,
  `is_applied_to_salary`, `applied_to_salary_at`. UNIQUE constraint:
  `(employee_code, month, year, company, applied_at)`. Indexed on
  `(employee_code, month, year)` and `finance_status`.
- **New routes file `backend/src/routes/lateComing.js`** mounted at `/api/late-coming`:
  - `GET /analytics` — per-employee late coming with trend vs last month (params: month, year, company, shiftCode)
  - `GET /department-summary` — per-department rollup with trend + worst offender
  - `GET /daily-detail` — late arrivals for a specific date (used by Daily MIS)
  - `GET /employee-history` — N-month late coming history incl. deductions
  - `POST /deduction` — HR applies deduction (requires HR or admin role; validates days in [0.5, 5] and non-empty remark)
  - `GET /deductions` — list deductions filtered by status (pending/approved/rejected/all)
  - `GET /export` — xlsx download (HR/finance/admin)
  - `GET /finance-pending` (Phase 2) — pending deductions enriched with 6-month history + current-month stats (HR/finance/admin)
  - `PUT /finance-review/:id` (Phase 2) — finance approve/reject single deduction; writes `finance_approvals` + `audit_log`
  - `PUT /finance-bulk-review` (Phase 2) — same, transactional for multiple ids
- **New route on `daily-mis.js`**: `GET /late-coming-summary` returns today's
  late arrivals with MTD counts, trend, department breakdown, and "left late
  yesterday" flag.
- **Frontend additions**:
  - Analytics → Punctuality tab: new "Late Coming Management" section with
    summary cards, shift/dept filters, Excel export, department summary,
    employee detail table with trend arrows, `LateComingDeductionModal`
    (HR-only), and a "Pending Deductions" sub-table.
  - Daily MIS → `LateComingTodaySection` (between Worker Type Breakdown and
    sub-tabs): department chips, per-employee late minutes + MTD + trend +
    "Stayed X min late yesterday" badge.
  - Employee Master: shift dropdown on edit modal (driven by real shifts from
    `/settings/shifts`), checkbox column + "Assign Shift" toolbar +
    `BulkShiftModal` (HR/admin only).
  - Settings → Shifts: end_time field is read-only (auto-calculated from
    start + duration), grace_minutes disabled for non-admin.
  - Sidebar: new top-level "Late Coming" entry linking to `/analytics/punctuality`.
- **Permissions**: `late-coming` page added to `hr` and `finance` roles in
  `backend/src/config/permissions.js`. HR has full access (view + deduction);
  finance can view analytics, plus approve/reject deductions and review them
  from the Finance Audit → Late Coming tab.
- **Employee shift audit**: every shift change on `employees` (via PUT /:code
  or PUT /bulk-shift) writes an `audit_log` row with `field_name='shift_assignment'`,
  `action_type='shift_change'`, and `changed_by` set to the actual username.
- **New API endpoint `PUT /api/employees/bulk-shift`** (HR/admin): body
  `{ employeeCodes: [...], shiftId, shiftCode }`. Transactional update + one
  audit row per employee. Declared BEFORE `PUT /:code` in the router so Express
  doesn't interpret "bulk-shift" as an employee code.
- **Phase 2 (April 2026) — shipped**. Closes the loop from HR-initiated
  deduction to salary impact:
  - **Finance approval endpoints** on `lateComing.js`:
    - `GET /finance-pending` — pending deductions enriched with current-month
      stats + 6-month history + left-late totals (single round-trip for the
      review UI).
    - `PUT /finance-review/:id` — approve/reject a single deduction
      (`finance` or `admin` role). Mandatory remark on rejection. Writes to
      `finance_approvals` and `audit_log` (`action_type='finance_review'`,
      `field_name='finance_status'`, `old_value='pending'`).
    - `PUT /finance-bulk-review` — same logic for multiple rows, transactional.
  - **New column**: `salary_computations.late_coming_deduction REAL DEFAULT 0`
    (migrated via `safeAddColumn`). Persisted alongside PF/ESI/TDS/etc.
  - **Salary pipeline integration** in `salaryComputation.js`:
    - Top of `computeEmployeeSalary()` resets `is_applied_to_salary=0` for
      approved rows so every recompute re-reads them.
    - After TDS/advance/loan derivation, SUMs `deduction_days` of approved &
      unapplied rows and multiplies by `otPerDayRateDisplay = gross /
      calendarDays` (same rate as OT/ED/holiday duty). Gated on `!isContract`
      — contractors mirror the OT/ED exclusion rule.
    - `lateComingDeduction` is added into `totalDeductions`. `net_salary`
      math is unchanged — the new bucket just joins the existing sum.
    - `saveSalaryComputation()` INSERT + ON CONFLICT UPDATE + parameter list
      were extended with the new column (same pattern as `advance_recovery`).
    - After the INSERT the function flips `is_applied_to_salary=1` on the
      matching rows and writes a `logAudit()` entry
      (`action_type='applied_to_salary'`, `stage='salary_compute'`).
    - `generatePayslipData()` surfaces a new `Late Coming Deduction` line
      item in `payslip.deductions` (auto-filtered when zero).
  - **Stage 6 (DayCalculation.jsx)**: `GET /api/payroll/day-calculations`
    now returns `finance_approved_late_days` + `finance_late_remark` via
    subqueries. The day calc detail panel shows a "★ Finance-approved late
    deduction" info row with the remark directly below.
  - **Stage 7 (SalaryComputation.jsx)**: new "Late" column between Loan and
    Ded in the salary register table (amber highlight when > 0). Drill-down
    deductions list shows "Late Coming" as a separate line item. tfoot
    column totals include the new bucket.
  - **Finance Audit → new "Late Coming" tab** (`FinanceAudit.jsx →
    LateComingAuditTab`): summary KPI cards (Pending / Approved / Rejected /
    Total Days), expandable pending table revealing 6-month history per
    employee + Approve/Reject buttons + bulk-action toolbar, history table
    of already-reviewed deductions for the month. Tab badge shows the pending
    count.
  - **Finance Audit → Report tab**: `/finance-audit/report` now joins
    `late_coming_deductions` (sum of approved days + status) and the UI
    shows a new "Late Ded" column (amber highlight) between Gross and Net.
  - **Month-end checklist** (`/payroll/month-end-checklist`): two new items
    — `late-deductions-pending` (WARNING) and `late-deductions-unapplied`
    (WARNING, links to `/pipeline/salary`). If neither is present the
    checklist shows an OK "All late coming deductions reviewed" row.
  - **Readiness check** (`/finance-audit/readiness-check`): mirrors the two
    checklist items as WARNINGs (`LATE_DEDUCTIONS_PENDING`,
    `LATE_DEDUCTIONS_UNAPPLIED`). Not blockers — they reduce the readiness
    score but don't prevent finalisation.
  - **Finance red flag detector** `late_deduction_high` (WARNING) in
    `financeRedFlags.js`: surfaces employees whose approved deduction days
    exceed 2 for the month.
  - **Employee profile → new "Late Coming" tab**: 12-month history with
    trend arrows, summary cards (late this/last month, left-late count),
    and a full deduction history table showing status badges and the
    "applied to salary" flag.
  - **Analytics → Punctuality → view toggle**: new Employees/Departments
    toggle. Department view renders a report sorted by total late
    instances with top 5 latecomers per row and an expandable employee
    list per department.
  - **Bulk payslip download disabled**: `GET /payroll/payslips/bulk`
    returns HTTP 403 with a policy error message. The Stage 7 Bulk PDF
    button, its handler, and the `getBulkPayslips` import were removed
    from `SalaryComputation.jsx`. Individual payslip generation
    (`/payslip/:code`) remains functional for internal review.
  - **Audit trail**: every state transition is logged —
    `deduction_applied` (HR), `finance_review` (finance approve/reject),
    `applied_to_salary` (Stage 7 compute), `shift_change` (employee
    shift assignment). All write to `audit_log` with `stage='late_coming'`
    or `stage='salary_compute'`.

## Early Exit Detection & Gate Pass Management (April 2026)
- **4 new tables**: `short_leaves` (gate pass records), `early_exit_detections`
  (per-employee per-date detection results), `early_exit_deductions` (HR-initiated,
  finance-approved deductions), `early_exit_deduction_audit` (state transition log).
- **New routes**: `short-leaves.js` (5 endpoints at `/api/short-leaves`),
  `early-exits.js` (5 endpoints at `/api/early-exits`),
  `early-exit-deductions.js` (8 endpoints at `/api/early-exit-deductions`).
- **Detection service**: `earlyExitDetection.js` — compares punch-out time against
  shift end_time. Gate passes provide full exemption (left after authorized time)
  or partial credit (overage = authorized - punchOut). Upserts into
  `early_exit_detections` with UNIQUE(employee_code, date). Updates
  `attendance_processed.is_early_departure` and `early_by_minutes`.
- **Deduction flow**: HR submits deduction (warning/half_day/full_day/custom) →
  finance approves or rejects → approved deductions feed into Stage 7 salary
  computation via `early_exit_deduction` column on `salary_computations`.
  `salary_applied` flag prevents double-counting (same pattern as late coming).
- **Salary impact**: `earlyExitDeduction` added to `totalDeductions` in
  `computeEmployeeSalary()`. Contractors excluded (mirrors OT/ED gate). UPSERT
  includes `early_exit_deduction = excluded.early_exit_deduction` for safe recompute.
- **Frontend**: Gate Passes tab in Leave Management, Early Exit tab in Analytics,
  Early Exit Deductions tab in Finance Audit, Early Exits card in Daily MIS.
- **Permissions**: `early-exit` added to `hr` and `finance` roles.

## Early Exit Date Range Report (April 2026)
- **No schema changes** — all new endpoints read from the existing
  `early_exit_detections` table which already caches one row per
  employee/date with shift/punch/minutes metadata.
- **New endpoints** on `backend/src/routes/early-exits.js` (mounted at both
  `/api/early-exits` and alias `/api/early-exit`):
  - `GET /range-report` — arbitrary date range (startDate, endDate YYYY-MM-DD;
    optional company, employeeCode, department, minMinutes). Validates
    `startDate <= endDate` and enforces 90-day max. LEFT JOINs `short_leaves`
    so gate-pass context is returned alongside each row. Response includes
    row data plus a `summary` object with totalIncidents, uniqueEmployees,
    avgMinutesEarly, totalFlaggedMinutes, withGatePass / withoutGatePass,
    and dateRange `{ start, end, days }`. Exempted rows are still returned
    in `data` but excluded from the "non-exempt" aggregates.
  - `GET /mtd-summary` — per-employee MTD counts for a month/year with
    previous-month comparison. Uses the same `trendLabel()` helper as
    `lateComing.js` (up/down/stable with 10% relative threshold). Returns
    a `totals` block for header KPI cards and a per-employee `data` array.
  - `GET /department-summary` — per-department rollup for month/year with
    employee_count, total_incidents, prev_incidents, avg_minutes_early,
    trend and `worst_offender` (same shape as late coming's dept summary).
  - `GET /export` — XLSX via SheetJS. Sheet 1 "Summary" (date range +
    filter criteria + aggregates) and Sheet 2 "Early Exit Details" (all
    filtered rows). Column widths are pre-sized. Filename format:
    `EarlyExitReport_STARTDATE_to_ENDDATE.xlsx`. All filters that apply to
    `range-report` also apply to export.
  - All four endpoints gated by `requireHrFinanceOrAdmin`, so HR, Finance
    and Admin roles can read and export. The existing single-day
    `POST /detect` endpoint is unchanged (backwards compatible).
- **Frontend — `EarlyExitDetection.jsx` redesign**:
  - Mirrors Late Coming layout: header + KPI cards grid + department
    breakdown cards + filter toolbar + sortable detail table.
  - MTD KPI cards: Early Exits (MTD) with trend arrow vs last month,
    Unique Employees, Avg Minutes Early (range-scoped), With Gate Pass.
  - Department breakdown card grid (top 6 departments) shows total exits,
    employee count, avg minutes early, trend arrow, worst offender.
  - Date range picker with preset buttons: Today / This Week / This Month
    (default) / Last Month / Last 3 Months / Custom. Selecting a preset
    highlights it; manual date edits switch to "custom". 90-day inline
    validation prevents the query from firing.
  - Client-side filters stack: employee search (code or name), department
    dropdown (populated from result set), min-minutes numeric input.
    Sortable column headers use the `useSortable` helper copied from
    Analytics.jsx.
  - "Export Excel" button calls `GET /early-exits/export` with the
    currently-active filters so the XLSX matches what's on screen. Button
    is disabled during the download and when the range is invalid.
  - Empty state: friendly icon + message when no rows match the range.
  - Detail panel / HR deduction workflow / finance-approval modal from the
    previous version is preserved unchanged (no pipeline impact).
- **API helpers** in `frontend/src/utils/api.js`:
  `getEarlyExitRangeReport`, `getEarlyExitMtdSummary`,
  `getEarlyExitDeptSummary`, `exportEarlyExitReport`
  (the last returns `responseType: 'blob'` for XLSX download).

## Section 8: Rules for Claude Code Sessions
- Before changing ANY pipeline stage: ALWAYS read every downstream stage's service file AND every consumer (finance audit, payslips, exports, analytics) that reads this stage's output tables.
- Before changing salary computation: read dayCalculation.js (input) AND every route/component that displays salary data (payroll.js, financeAudit.js, salary-advance, payslip PDF).
- Use subagents for codebase exploration. Keep the main context window clean for implementation.
- Never change database schema without checking all routes that query the affected table. SQLite has no runtime schema validation — broken queries fail silently with NULL.
- After changing any pipeline stage: verify the stage's output table schema hasn't changed in a way that breaks downstream consumers.
- Financial calculations: always verify rounding, check for divide-by-zero on salary divisor, and ensure earned ratio is capped at 1.0 for base components.
- Run lint before marking any task complete.
- Update this CLAUDE.md file after completing any major feature or pipeline change.
- **Use curl for all API/endpoint diagnostic and verification queries** — never build a UI/HTML page for tests that can be done with curl. Start the backend server, run curl commands, check headers and response bodies directly. This applies to this project and any other project where curl can reach the server.
- **Every /ship report's table/file/column claims must come from grep/find/sqlite3 queries executed in the current session, not from plan memory.** Quote the exact command that produced each claim. A /ship report that names tables, columns, or status values without citing the command that verified their existence is invalid. Precedent: 2026-04-20 Bug Reporter /ship report claimed 3 tables (reality: 1) and an invented retry subsystem; corrected 2026-04-21 after audit.

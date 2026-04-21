## Section 0: Last Session
(Corrected 2026-04-21 after audit found previous entry had fabricated
 claims about tables and retry mechanism.)

Bug Reporter (shipped 2026-04-20, steps 1-13)

Files created (backend, 7):
- backend/src/routes/bugReports.js
- backend/src/middleware/uploadBugReport.js
- backend/src/services/bugReportStorage.js
- backend/src/services/bugReportAnalyzer.js
- backend/src/services/bugReportResurrect.js
- backend/src/services/sarvamWebhookVerify.js
- backend/src/services/sarvamBatchPoller.js
- backend/src/services/sarvamTranscription.js  (if this file exists — verify)

Files created (frontend, 12):
- frontend/src/utils/apiContextBuffer.js
- frontend/src/utils/copyTicketSummary.js
- frontend/src/hooks/useNewBugReportCount.js
- frontend/src/api/bugReports.js
- frontend/src/components/BugReporter/ScreenshotInput.jsx
- frontend/src/components/BugReporter/AudioUploader.jsx
- frontend/src/components/BugReporter/VoiceRecorder.jsx
- frontend/src/components/BugReporter/AutoContextPreview.jsx
- frontend/src/components/BugReporter/BugReportButton.jsx
- frontend/src/components/BugReporter/BugReportModal.jsx
- frontend/src/pages/admin/BugReportsInbox.jsx
- frontend/src/pages/admin/BugReportDetail.jsx

Files modified:
- backend/server.js — mount /api/bug-reports, boot poller/resurrect
- backend/src/database/schema.js — add bug_reports table + policy_config seeds
- frontend/src/store/appStore.js — bugReportModalOpen state + actions
- frontend/src/utils/api.js — installContextBufferInterceptors(api)
- frontend/src/components/layout/Sidebar.jsx — admin "Bug Reports" entry
- frontend/src/App.jsx — lazy imports, /admin/bug-reports routes, modal in Layout

Schema additions (verify via .schema):
ONE new table: bug_reports (with CHECK constraints per plan v3 §3)
THREE policy_config seeds:
- bug_report_extraction_prompt       (full extraction prompt text, hot-swappable)
- bug_report_extraction_prompt_version  (version tag for tracking prompt iterations)
- bug_report_known_pages_json        (JSON array of page names)

Resurrect behavior (bugReportResurrect.js, on boot):
Bucket A: claude_run_status='pending' AND transcription_status='success'
  → re-run Claude extraction
Bucket B: transcription_status='pending' AND sarvam_job_id IS NULL
  → re-run transcription
Bucket C (batch jobs with sarvam_job_id): left to sarvamBatchPoller
24-hour cutoff — rows older than 24h are not resurrected.
NO retry counter. NO analysis-runs audit table.

Status vocabulary:
transcription_status: pending | rest_sync | batch_queued | batch_polling |
                      success | failed | skipped
claude_run_status:    pending | success | failed | skipped
admin_status:         new | triaged | in_progress | resolved | wont_fix | duplicate

Webhook secret:
Active source: process.env.SARVAM_WEBHOOK_SECRET (set in Railway env)
The previously-seeded policy_config row bug_report_sarvam_webhook_secret
was dead code; removed 2026-04-21.

What's fragile:
- Sarvam webhook signature verification (three layers: HMAC + per-report
  token + idempotency). Never remove any layer.
- Webhook route mounted outside requireAuth but inside signature middleware —
  if refactoring routes, verify this ordering.
- iOS Safari MediaRecorder compatibility (needs real-device test before
  declaring iOS support done).
- Disk-vs-DB path consistency — no enforcer; if a row's screenshot_path or
  audio_path points to a missing file, the admin inbox will 404 on the
  media serve endpoints.

What's dormant (known, not a bug):
- bug_report_actions, bug_report_analysis_runs: mentioned in earlier
  drafts, never implemented. Do NOT assume they exist.

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

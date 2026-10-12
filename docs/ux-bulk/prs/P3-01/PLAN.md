# P3-01 — Phase 0 plan: shared bulk engine + Extra Duty bulk grant (+ F-11 HR queue tab)
Branch `feat/bulk-ed-grant` on origin/main `8abee969` · port 3401 · MONEY-ADJACENT (independent review before PR)
Spec: MASTER_PLAN §6 P3, §7.2–7.6, finding F-11; `bulk-pr1-plan.md` (dist/CLAUDE.md lines overridden by b4_plan_note).
Owner rulings R1–R6 + Q1 (HR-approve offered, ticked) + Q2 (auto-split 50/50/9) are final.

## 1. Facts this plan rests on (read-only)
- FACT (code) `POST /api/extra-duty-grants` (routes/extraDutyGrants.js L159–243): IMMEDIATE txn → find by
  (code, date, month, year) → INSERT, or upgrade an untouched BIOMETRIC_AUTO row in place, or 409 (`conflict` / `pba_conflict`).
  Audit only on the upgrade path (`HR_UPGRADE_AUTO`, written AFTER the txn); a plain create writes NO audit row.
  No employee-active check, no finalised-month check, company = what the client sends (top-bar company).
- FACT (code) HR approve = `status='APPROVED', approved_by, approved_at` + audit `HR_APPROVE` / `HR_BULK_APPROVE`.
  `POST /extra-duty-grants/bulk-approve` exists (hr/admin) but has no frontend caller and no api.js helper.
- FACT (code) payroll.js `/finalise` sets `monthly_imports.is_finalised=1` for the WHOLE month (all labels) →
  finalised check = `isMonthFinalized(db, null, m, y)` (leaveTriggers.js; company-agnostic on purpose, labels are dirty).
- FACT (code) `logAudit()` uses the shared `getDb()` connection → inside `db.transaction` it is part of the txn.
- FACT (node) better-sqlite3: a `.immediate()` txn function called inside another txn becomes a SAVEPOINT; an outer
  throw rolls everything back (checked in this worktree).
- FACT (prod, counts) employees: 783 Active / 446 Left (no other status). ED 2026: 2,293 BIOMETRIC_AUTO, 1,539 Gate
  Register, 30 Production Office; types OVERNIGHT_STAY / OTHER only. Finalised months: Jun 2025, Jan 2026. No bulk_* tables.
- FACT (code) PeoplePicker (P2-07) handles paste + tick + search; it reports "Has left" for pasted Left/Exited codes and
  does not add them unless `allowLeft` + toggle. ReviewQueue (P2-06) gives chips, selection and the fixed bulk bar.
- FACT (code) GET /api/employees returns salary-structure columns + a last-present aggregate over attendance → too heavy
  (and more data than needed) for the picker; bulk gets its own light list.

## 2. Backend
### 2.1 `backend/src/database/bulkSchema.js` (new) — `initBulkSchema(db)`
`bulk_batches` (id, kind, company, month, year, source, status ['applied','undone' used now; draft/submitted/approved/
rejected/returned reserved, CHECK lists all], plan_hash, row_count, ok_count, warn_count, error_count, skipped_count,
options_json, group_id, group_index, group_size, created_by, created_at, applied_at, undone_by, undone_at, undo_reason,
note) and `bulk_rows` (id, batch_id FK, row_no, row_key, input_json, resolved_json, state ['ok','warning','error','skipped'],
action ['create','update','noop','conflict'], messages_json, before_json, after_json, target_table, target_id, undone).
Indexes: (kind, created_at), (status), (group_id), (batch_id, row_no), UNIQUE (batch_id, row_key).
CREATE … IF NOT EXISTS only; idempotent. `schema.js`: ONE line at the end of initSchema → `require('./bulkSchema').initBulkSchema(db);`

### 2.2 `backend/src/services/extraDuty/createGrant.js` (new) — extracted, no behaviour change
- `writeGrant(db, input, user)` — the body of today's txn (find → insert | upgrade | conflict | pba_conflict), NO txn of its
  own, returns `{kind, id?, row?, old?}`. Same SQL text, same defaults (`grant_type||OVERNIGHT_STAY`, `duty_days||1`, `''`s).
- `upgradeAuditRemark(employee_code, grant_date, old, dutyDays, grantType)` — the exact HR_UPGRADE_AUTO remark string.
- `findExisting(db, code, date, month, year)`.
Route POST / becomes: same 400 check, same `emp` lookup, `db.transaction(() => writeGrant(...)).immediate()`, same
UNIQUE catch, same 409 bodies (incl. `returnHint`), same post-txn `logAudit(... 'HR_UPGRADE_AUTO' ...)` with
`req.user?.username`, same `{success, id}`. Proof: extraDutyGrantsCollision/Return/legacy tests unchanged and green +
a new jest test that diffs responses + audit args of the old handler (copied verbatim into the test) vs the new one on
twin DBs for create / upgrade / conflict / pba_conflict / missing fields.

### 2.3 `backend/src/services/bulk/engine.js` (new, generic)
Kind registry `{ 'extra-duty': require('./kinds/extraDuty') }`. Constants `BULK_MAX_ROWS = 50`.
- `preview(db, kind, {common, rows}, user)` → kind.normaliseCommon (400 `BULK_BAD_COMMON` with field messages) →
  kind.normaliseRows (merge duplicate codes, message "listed twice — kept once") → `kind.planRow` per row →
  `groups` = applicable rows (ok + warning) in order, chunks of ≤ 50, each with its own `planHash` (sha256 of canonical
  JSON: kind, common, each row's code/duty/state/action + fingerprint of the row it touches: id, status, finance_status,
  verification_source, duty_days, is_processed, requested_at; + employee status/company). Returns
  `{rows:[{rowNo, code, name, department, company, dutyDays, state, action, messages[]}], counts, groups:[{index, rowNos, planHash}]}`.
  Nothing written.
- `apply(db, kind, {common, rows, planHash, groupId, groupIndex, groupSize, options}, user)` → 400 `BULK_ROW_LIMIT` if
  rows > 50 or 0; then ONE `db.transaction(...).immediate()`: re-plan the same rows → hash → mismatch or any row now
  `error` → throw → 409 `BULK_PLAN_CHANGED` ("Data changed since you checked — check again", nothing written).
  Insert bulk_batches (status 'applied'), per row: skipped rows stored as `skipped` with reason (not applied);
  ok/warning rows → `kind.applyRow` → bulk_rows with before/after/target_id; summary audit row (`table_name='bulk_batches'`,
  stage `BULK_CREATE`, remark "kind, date, created N, replaced M, skipped K, HR-approved yes/no, group i/n"). Any throw
  rolls back the whole batch (R3). Returns `{batchId, counts}`.
- `undo(db, batchId, reason, user)` → reason ≥ 5 chars; ONE IMMEDIATE txn: batch must be `applied`; `kind.undoable` on
  every applied row → any blocked → 409 `BULK_UNDO_BLOCKED` + `[{code, reason}]`, nothing changed; else `kind.undoRow`
  each, mark rows `undone`, batch → `undone` (+ undone_by/at/reason), summary audit `BULK_UNDO`.
- `listBatches(db, {kind, month, year, limit})` (no input_json), `getBatch(db, id)` (batch + rows with display fields).

### 2.4 `backend/src/services/bulk/kinds/extraDuty.js` (new)
- Common: `grant_date` YYYY-MM-DD real date (month/year derived), `grant_type` ∈ {OVERNIGHT_STAY, EXTENDED_SHIFT, OTHER}
  (PRE_BIOMETRIC_ACTIVATION refused), `duty_days` ∈ {0.5,1,1.5,2} (default 1), `verification_source` ∈ {Gate Register,
  Production Office, Supervisor Confirmed, Other}, `reference_number` ≤ 100, `remarks` ≤ 500 (trimmed).
- Row: `{code, duty_days?}` (per-row override, same set). Codes are text; exact match, then case-insensitive.
- planRow → error: "not found in the employee master" · "not active (Left, left on DD-MM-YYYY)" · "month is finalised —
  payroll is closed for Mon YYYY". skipped: existing manual grant same person+date → "already granted (HR: …, finance: …)".
  warning/update: untouched BIOMETRIC_AUTO → "will replace the system entry for this date". warning: blank/'null'
  company in master → "no company in the master — saved without one". ok/create otherwise. Company always from the
  master (never typed).
- applyRow → `writeGrant()` (same function as the single route; conflict/pba_conflict here = plan changed → throw);
  upgrade writes the same `HR_UPGRADE_AUTO` audit row (inside the txn). Create writes one audit row per grant
  (stage `HR_BULK_CREATE`, remark "code date: N day(s) TYPE, batch #id") — see Q-A. If `options.hrApprove` (Q1, default
  ticked in UI): `UPDATE … SET status='APPROVED', approved_by=<saving user>, approved_at=now WHERE id=? AND status='PENDING'`
  + audit `HR_BULK_CREATE_APPROVE` (same fields as HR_APPROVE). Finance flow untouched (finance_status stays UNREVIEWED).
  before_json = full existing row (upgrade) or null; after_json = full row after write.
- undoable(row): grant exists; `finance_status='UNREVIEWED'`; `is_processed=0`; month not finalised; HR status equal to
  after_json (PENDING, or APPROVED with the same approved_by/approved_at when the batch approved it); duty_days /
  grant_type / verification_source / reference / remarks unchanged (an HR edit = moved on). Reasons in plain words.
- undoRow: create → DELETE the grant; update → restore every column from before_json (back to BIOMETRIC_AUTO). Audit
  per row `BULK_UNDO` (field `id` / `verification_source`).
- Helpers: `peopleOnDate(db, date)` (manual, non-REJECTED, not finance-rejected grants on that date → codes),
  `employeesLite(db)` (code, name, department, company, status — Active + Left, no salary/PII).

### 2.5 `backend/src/routes/bulk.js` (new) — mounted `app.use('/api/bulk', requireAuth, require('./src/routes/bulk'))`
All `requireHrOrAdmin` (same roles as single create; viewer / finance / supervisor → 403):
`POST /:kind/preview` · `POST /:kind/apply` · `GET /batches?kind&month&year` · `GET /batches/:id` · `POST /batches/:id/undo`
· `GET /extra-duty/people?date=` · `GET /extra-duty/employees`. Unknown kind → 404. Kind-specific GETs registered before
`/:kind/...`. Engine errors map: `{ok:false, status, code, error, rows?}`.

## 3. Frontend
- `utils/bulkApi.js` (new): bulkPreview, bulkApply, getBulkBatches, getBulkBatch, undoBulkBatch, getEdPeopleOnDate,
  getEdEmployeesLite, hrBulkApproveGrants (→ existing `POST /extra-duty-grants/bulk-approve`). Imports default `api`;
  reads with `Cache-Control: no-cache`. api.js untouched.
- `components/bulk/ExtraDutyBulkGrant.jsx` (new) — panel opened by "+ Bulk Grant":
  1 Set once (date with weekday in words, type, duty days, source, reference, remark; remembered in localStorage,
  try/catch). 2 Add people: `<PeoplePicker employees={lite list} />` (paste + tick + search; pasted Left codes are reported
  "Has left" by the picker) + `<CopyFromDate>`. Picked codes + common kept with `useDraft` (survives reload).
  3 Check: preview table (ScrollTable + StatusBadge, chips All/Ready/Will replace/Already granted/Errors with counts),
  per-row duty days select + remove, "Leave out N error rows". Any edit re-runs preview (debounced); Save disabled
  while stale or while errors are left in. 4 Save bar: "Save 109 grants (3 batches: 50 + 50 + 9)" + ☑ "Also approve as
  HR — rows go straight to finance review" (ticked) + Cancel. Batches applied one after another; result shows each
  batch's counts + Undo; if batch k fails (plan changed), batches before it stay saved and the screen says so and
  re-checks the rest.
- `components/bulk/CopyFromDate.jsx` (new): date input (default: none) → "Add N people granted on DD-MM-YYYY".
- `components/bulk/BulkBatchList.jsx` (new, generic): recent batches (who, when, date, counts, status), "View rows",
  "Undo" → `promptDialog` reason (≥ 5 chars) → 409 shows the blocked rows.
- `pages/ExtraDutyGrants.jsx`: "+ Bulk Grant" button (canHR) next to "+ New Grant" → panel; `<BulkBatchList kind="extra-duty">`
  under the list (canHR); **F-11** HR Queue tab reads `getExtraDutyGrants(month, year, {status:'PENDING'})` and its
  ReviewQueue is `selectable` for canHR with one action "HR Approve (N)" (eligible `status==='PENDING'`, confirm text) →
  `hrBulkApproveGrants`; All Grants / Finance Review unchanged; Flag-for-Review submit → `<Button variant="warning">`.
  Single "+ New Grant" untouched.

## 4. NOT touched
salaryComputation.js, dayCalculation.js, payroll.js, recompute.js, ED approve/reject/finance-*/return/edit/PBA routes,
finance review tab behaviour, utils/api.js, parseCodes.js, PeoplePicker, ReviewQueue, useDraft, useConfirm, ui/*,
CLAUDE.md, frontend/dist. schema.js = one line.

## 5. Tests
- jest `bulkExtraDuty.test.js` (real JWT harness, real routers `/api/bulk` + `/api/extra-duty-grants`, fictional
  T-codes): common validation; duplicate merged; unknown / Left / finalised month / date-month errors; existing grant
  skipped; BIOMETRIC_AUTO upgrade (same id, linked_attendance_id kept, HR_UPGRADE_AUTO audit) + undo restores it
  byte-identical; 51 rows → 400; 109 → preview groups 50/50/9 and three applies → 3 batches with one group_id; hash
  mismatch (row changed between preview and apply) → 409, nothing written; error row in apply → 409; all-or-nothing
  (forced throw on row 30 → 0 rows written, no batch); HR-approve on → APPROVED by saver + audit / off → PENDING;
  undo refused after finance review / HR edit / processed / finalised, allowed when untouched; undo twice → 409;
  role guard viewer + finance 403 (preview, apply, undo, lists); summary audit rows.
- jest `createGrantParity` cases inside the same file: old handler (verbatim copy) vs new route on twin DBs.
- Existing `extraDutyGrants*.test.js` + `legacyExtraDutyGrantRetired.test.js` unchanged and green. Full suite before/after.
- `backend/scripts/bulk-ed-check.py` (Chromium, built dist, scratch DB, port 3401, real hr + finance logins, fictional
  data): paste 60 codes incl. 1 Left (picker "Has left: 1"), 1 repeated, 1 already granted (skipped), 1 set to 0.5 →
  counts → "Save 58 grants (2 batches)" → DB rows + 2 batches → finance tab shows them (HR-approved) → undo batch 2 →
  its rows gone, batch 1 kept → single "+ New Grant" still creates → HR Queue shows only PENDING + bulk approve works →
  Flag submit styled → 390 px → 0 page/console errors, 0 API ≥ 400 except intended. `--base` on an 8abee969 build:
  no Bulk button, HR tab shows non-pending rows. Re-run `ed-finance-review-ux-check.py` + `ed-return-browser-check.py`.
- Drift query on the scratch DB before/after (expected identical — grants move pay only after both approvals + Stage 6/7).

## 6. Risks
- R-1 Route extraction drift → parity test against the verbatim old handler.
- R-2 Partial save across batches (batch 2 refused after batch 1 saved) — by ruling Q2 each batch stands alone; UI
  states which saved and offers re-check; undo per batch.
- R-3 Undo after HR approval by the batch: allowed only while approved_by/at still equal what the batch wrote.
- R-4 Company: master labels dirty; we write the master value verbatim (blank → '' + warning), same as the
  finance list joins today. Single route still uses the top-bar company (unchanged).
- R-5 HR Queue now hides APPROVED/REJECTED rows — those stay on All Grants (as the finding asks).
- R-6 Shared machine: build under `/tmp/vite.lock`, full jest under `/tmp/jest.lock`, kill only own PIDs.

## 7. Questions for the planner
- Q-A Per-row audit on bulk-created grants (`HR_BULK_CREATE`) although the single create writes none. Recommend YES
  (traceable per grant; single route unchanged). OK?
- Q-B Batch list / batch detail readable by finance too (read-only), or hr/admin only? Recommend hr/admin only for now.
- Q-C Pasted Left codes: rely on PeoplePicker's "Has left" line (they never reach the preview) — the server still refuses
  them (jest). OK, or should they appear as error rows in the preview (needs `allowLeft` + toggle in the picker)?

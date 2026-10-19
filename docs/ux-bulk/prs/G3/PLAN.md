# G3 — employee document Delete: auditable soft delete

Branch `fix/doc-delete-audit` off origin/main 892f7f73 · worktree /home/claude/wt-g3-stage · port 3505 · Phase 0 (plan only).

## 1. What happens today (re-grepped on 892f7f73)
- `backend/src/routes/employees.js` L1046–1058 `DELETE /api/employees/documents/:id` (requireHrOrAdmin, P2-11):
  `fs.unlinkSync(doc.file_path)` then `DELETE FROM employee_documents WHERE id = ?`. **No audit_log row, no who/when,
  file gone from disk.** The only trace left is the `usage_logs` request line (path + username, no file/employee detail).
- L990–997 `GET /:code/documents` — `SELECT *` (no filter). L1002–1025 upload (requireHrOrAdmin) — no audit row either.
  L1030–1041 download — any logged-in role, by id.
- Table `employee_documents` (schema.js L348–360): id, employee_id, employee_code, document_type, file_name, file_path,
  file_size, mime_type, uploaded_by, remarks, created_at. No soft-delete columns.
- Files live in `DOCS_DIR` (env, default `backend/uploads/documents/<code>/`), gitignored.
- Frontend `pages/Employees.jsx` L423–437 delete mutation + double-click ref, L742–765 Delete button + P6-06 red
  ConfirmDialog. **Its copy says "The file is deleted from the server for good — this cannot be undone"** — becomes
  false after this PR, so the message text must change (the red confirm itself stays).
- `backend/scripts/destructive-confirms-check.py` (P6-06) A3 asserts that copy ("cannot be undone") and that the row
  count drops to 1 and the file is gone — those 2 asserts would fail after this PR.
- `backendRouteGuards.test.js` L45: DELETE /documents/999999 hr → not 403 (still 404 after this PR — unchanged).

## 2. Production (read-only, 17 Oct, counts only)
- `employee_documents` = **0 rows**; `audit_log` rows with table_name='employee_documents' = 0 (audit_log total 51,364).
- usage_logs: no document delete in the window looked at (feature effectively unused) → no back-fill, no migration of data.
- users by role: admin 1, finance 1, hr 4, viewer 1.

## 3. Smallest change
**Backend — soft delete + one audit row, in one transaction**
1. NEW `backend/src/database/employeeDocsSchema.js` → `ensureEmployeeDocsSoftDelete(db)`: PRAGMA table_info check,
   then nullable additive `ALTER TABLE employee_documents ADD COLUMN deleted_at TEXT`, `deleted_by TEXT`
   (+ `CREATE INDEX IF NOT EXISTS idx_employee_documents_code_live ON employee_documents(employee_code, deleted_at)`).
   Idempotent; memoised per db handle (WeakSet) so it runs once per process / per test DB. **schema.js untouched**
   (no init line — see Q1).
2. `employees.js` document block only (L986–1058):
   - each of the 4 document routes calls `ensureEmployeeDocsSoftDelete(db)` first.
   - GET list: `WHERE employee_code = ? AND deleted_at IS NULL`.
   - DELETE: look up `WHERE id = ? AND deleted_at IS NULL` (missing or already deleted → 404 "Document not found");
     in `db.transaction`: `UPDATE employee_documents SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ? AND
     deleted_at IS NULL` + `INSERT INTO audit_log (table_name, record_id, field_name, old_value, new_value, changed_by,
     stage, remark, employee_code, action_type)` = ('employee_documents', id, 'deleted_at', '', <timestamp>,
     username, 'employee_documents', 'Document removed: <type> · <file_name> (file kept on server)', employee_code,
     'document_delete'). Same 10-column insert the file already uses (L370, L536). **File is NOT unlinked.**
     Response unchanged shape `{ success: true, message: 'Document removed' }`.
   - download: `deleted_at IS NULL` too → a removed document returns 404 for every role (Q3).
   - (Q2) upload writes one `document_upload` audit row in the same way, so the trail shows add + remove.
   - The row then shows up in the existing admin Record History (`/api/admin/record-history`, by table+id or by
     employee_code) and Finance Audit `corrections/:code` audit trail with no change there.

**Frontend — copy only (`pages/Employees.jsx`, the P6-06 confirm message + success toast; red confirm kept)**
- Message: "{type} for {name} ({code}). It is removed from this list and a record of who removed it is kept. The file
  stays on the server — ask admin if it is needed again." Button stays "Delete document" (red). Toast "Document removed".
- `data-testid="confirm-delete-doc"` kept.

## 4. NOT touched
schema.js, payroll.js, salaryComputation.js, dayCalculation.js, recompute.js, SalaryComputation.jsx, CLAUDE.md,
every other route in employees.js, Employees.jsx outside the 2 copy strings, api.js, ConfirmDialog.jsx, logAudit in db.js
(its 8-column form has no employee_code/action_type, so the direct insert is used — same as L370/L536).
No restore endpoint / no "show removed" UI (Q4). No file purge job.

## 5. Tests
- NEW `backend/src/__tests__/employeeDocumentSoftDelete.test.js` (jwtApiHarness, real requireAuth + JWTs, temp DOCS_DIR,
  fictional code T95xx): hr DELETE → 200; row kept with deleted_at set + deleted_by='hr1'; file still on disk; exactly 1
  audit_log row (table, record_id, employee_code, action_type, changed_by, remark names type+file); GET list hides it,
  other document still listed; download → 404; second DELETE → 404 and still 1 audit row; viewer DELETE → 403, 0 writes;
  admin DELETE works; ensure helper runs twice = no-op; a DB built by initSchema() alone gets the columns on first call.
  (Q2 yes) upload → 1 `document_upload` row. Expect most to FAIL on 892f7f73 (file unlinked, no audit row).
- Full jest suite under `flock /tmp/jest.lock` (before = after + new suite).
- Browser: NEW `backend/scripts/doc-delete-audit-check.py` (built dist, scratch DB, port 3505, real hr + admin logins,
  restart per role): hr opens profile → Documents → Delete → red confirm with the new copy → confirm once → row gone from
  the list, DB row kept with deleted_by, file on disk, 1 audit row, 0 page errors, 0 API ≥ 400; edge: Cancel sends nothing;
  390 px width. `--base` on 892f7f73 must FAIL (no audit row, file gone).
- P6-06 script A3: update the 2 asserts (copy + "row + file gone" → "row hidden, file kept") — Q5.

## 6. Verification
jest new + full; `flock /tmp/vite.lock npm run build --prefix frontend`; doc-delete-audit-check.py + --base;
destructive-confirms-check.py re-run green. No money path → no drift query needed (no salary table touched).

## 7. Risks
- **Storage persistence (finding, not fixed):** with DOCS_DIR unset, files sit in the container's `backend/uploads/documents`;
  on Railway that is ephemeral unless a volume is mounted there, so "file kept on server" may not survive a redeploy.
  Prod has 0 documents so nothing is at risk today, but the owner should confirm DOCS_DIR points at the volume (Q6).
- Soft-deleted files keep using disk (10 MB max each; 0 today).
- Runtime ALTER on first document call: one-time, nullable, same pattern as bulkSchema/safeAddColumn — no lock issue at
  this size.
- `GET /:code/documents` and download stay readable by any logged-in role (pre-existing; not in scope — Q7).

## 8. Questions (recommended answer in **bold**)
- Q1. Column add path: lazy memoised `ensureEmployeeDocsSoftDelete` called from the document routes (schema.js untouched),
  or one owner-approved line in initSchema like bulkSchema? **Lazy, schema.js untouched.**
- Q2. Also write a `document_upload` audit row on upload? **Yes** (3 lines, same insert; trail is useless with only removes).
- Q3. Removed document download: 404 for everyone, or still downloadable by admin? **404 for everyone** (hidden means
  hidden; recovery is an admin DB action until a restore UI is asked for).
- Q4. Restore / "show removed" UI now? **No** — register as follow-up; prod has 0 documents.
- Q5. May I edit the 2 A3 asserts in `backend/scripts/destructive-confirms-check.py` (P6-06's script) so it stays green?
  **Yes**, only those lines.
- Q6. Owner check of Railway `DOCS_DIR` / volume — add to the post-deploy seven-field block? **Yes**, as a read-only check.
- Q7. Guard GET list/download to roles that can open the Employees page? **No — out of scope**, register it.

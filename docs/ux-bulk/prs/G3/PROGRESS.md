# G3 PROGRESS

## RESUME
Branch fix/doc-delete-audit (base origin/main 892f7f73), worktree /home/claude/wt-g3-stage, port 3505. Builder E.
Read /home/claude/kit/common_rules.md, then PLAN.md + this file.
State: BUILD DONE + VERIFIED — pushed; hand-off sent. Nothing open.

## Planner rulings (17 Oct 2026)
Q1 lazy helper, schema.js untouched · Q2 upload writes an audit row · Q3 removed document → 404 for every role ·
Q4 restore screen → register · Q5 update only the 2 A3 asserts in destructive-confirms-check.py · Q6 owner post-deploy
task includes a read-only DOCS_DIR volume check · Q7 register.

## Steps
- [x] P0 re-grep employees.js document routes, schema, Employees.jsx P6-06 confirm, tests/scripts touching documents
- [x] P0 prod counts: employee_documents 0, doc audit rows 0
- [x] P0 PLAN.md + PROGRESS.md pushed
- [x] B1 employeeDocsSchema.js helper
- [x] B2 employees.js document block: list filter, soft delete + audit (txn), download 404, (Q2) upload audit
- [x] B3 Employees.jsx confirm copy + toast
- [x] B4 employeeDocumentSoftDelete.test.js + full jest
- [x] B5 build + doc-delete-audit-check.py + --base; P6-06 script A3 asserts (Q5)
- [x] B6 self-debug → v2 → re-run all; hand-off

## Found while testing
- After Delete (and after Upload) the documents list kept showing the old copy for up to 5 s: server GET max-age=5 and
  `getEmployeeDocuments` sent no no-cache, so refetch got the browser's copy. Reproduced on base 892f7f73 too.
  Fixed: `fresh` on that read in `utils/api.js` (1 line).

## Verified
- jest new `employeeDocumentSoftDelete.test.js` 8 (5 fail on 892f7f73's route; the 3 that pass are controls: live doc,
  role guard, unknown id). backendRouteGuards 291 unchanged. Full jest 126 suites / 2238 pass.
- `backend/scripts/doc-delete-audit-check.py` (Chromium, built dist, scratch DB + DOCS_DIR, hr + finance, T9561, port 3505)
  22/22 twice. `--base` on 892f7f73: row hard-deleted, file gone, no audit row (and the stale list).
- `destructive-confirms-check.py` (P6-06) 115/115 with the 2 updated A3 asserts.

## CLAUDE.md entry
## Last Session — 2026-10-17 (G3: employee document delete is a soft delete with an audit trail)
**Branch `fix/doc-delete-audit`.** Plan + log: `docs/ux-bulk/prs/G3/PLAN.md`, `PROGRESS.md`. Rulings Q1–Q7 (17 Oct).
- **Bug:** `DELETE /api/employees/documents/:id` unlinked the file and deleted the row — no audit row, no way back.
  Upload wrote no audit row either. Prod: 0 document rows, 0 doc audit rows.
- **Fix:** `database/employeeDocsSchema.js` `ensureEmployeeDocsSoftDelete(db)` (lazy, once per handle, schema.js untouched):
  nullable `deleted_at`, `deleted_by` + index `(employee_code, deleted_at)`. DELETE = one txn: UPDATE … WHERE deleted_at
  IS NULL + audit_log row (`table_name employee_documents`, field `deleted_at`, stage `employee_documents`, action
  `document_delete`, remark "Document removed: <type> · <file> (file kept on server)", employee_code); file kept; reply
  "Document removed"; already removed → 404. List and download hide removed rows (download 404 for every role). Upload =
  same txn + `document_upload` audit row. Employees.jsx: P6-06 red confirm kept, text "It is removed from this list and a
  record of who removed it is kept. The file stays on the server — ask admin if it is needed again.", toast "Document
  removed". `getEmployeeDocuments` sends no-cache.
- **Fragile:** any new reader of employee_documents must add `deleted_at IS NULL` (and call the helper first on a fresh
  DB). Files of removed documents stay in DOCS_DIR forever (no restore screen — register Q4). Files live in DOCS_DIR —
  if that is not on the Railway volume they vanish on redeploy (owner check Q6).
- **Verified:** jest 126/2238 (new suite 8, 5 fail on base); check 22/22, `--base` hard delete; P6-06 115/115.
- **Not tested:** Railway; Safari/Firefox; a real Railway DOCS_DIR path.

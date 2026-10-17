# N-13 — PROGRESS

## State
Phase 1–3 done (re-scoped build). Hand-off. MONEY PR — independent review next.

## Rulings
- 16 Oct (original): finance reviews new salaries after — **superseded**.
- 17 Oct owner re-scope "Close the API gap": (1) POST /employees refuses salary fields → 400 SALARY_VIA_SALARY_INPUT,
  empty values allowed; (2) bulk-import gross → salary_change_requests (requested_by importer, finance decides,
  SELF_APPROVAL), equal gross → no request, per-row report; no new table / tab / queue; reuse raiseRequest where it lives.

## Done
- `backend/src/routes/employees.js`: `CREATE_SALARY_KEYS` + `createSalaryKeys()` guard at the top of POST /; structure
  INSERT on create removed. `raiseSalaryChangeRequest()` extracted from PUT /:code/salary `raiseRequest` (same replies).
  bulk-import: gross 0 on new rows, no gross ON CONFLICT, no structure INSERT / sync; per-row request via the helper;
  response `results.rows` + `requestsRaised / salaryUnchanged / salaryAlreadyPending` (`salaryCreated` removed, no reader).
- New `backend/src/__tests__/newEmployeeSalaryGate.test.js` 26 (21 fail on origin/main; 5 controls pass).
- New `backend/scripts/new-employee-salary-gate-check.js` (real server.js, port 3502, real admin/hr/finance logins) 26/26;
  `--base` on an origin/main worktree: 18 fail → check catches the old behaviour.
- Tests changed on purpose:
  - `statutoryWriters.test.js` T9a "bulk-import upsert of an existing employee…": master gross now stays 15000 and a
    Pending request with new_gross 17000 and no flags exists (was: master 17000 written directly).
  - `statutoryWriters.test.js` T9a "bulk-import of a NEW employee…": no structure at import; after finance approves the
    request the structure row carries flags 0 (flag coverage kept, moved to the approval writer).
  - `statutoryWriters.test.js` T8b "POST /employees with basic > 0…": create now sends flags only; salary goes
    PUT /:code/salary → finance approve; same assertions on master/structure flags + Stage 7 PF/ESI 0.
  - `statutoryWriterGuard.test.js` T10b sanity: structure INSERT sites ≥ 12 → ≥ 11 (two writers deleted; scan finds 11).
- Full jest under flock: 125/2230 → 126/2256, all pass. Drift query on the check's scratch DB: 0.
- Production (read-only): bulk-import 1 call ever (17 Mar 2026) — 977 employees + 919 structures created that day,
  all with gross, none through a request (requests start 13 Apr). POST /employees 14 calls; usage_logs.details holds
  only {status, duration}, so salary keys in those bodies cannot be told from logs; 0 structures of the create shape.

## Next
- Independent review (planner).

## RESUME
Branch feat/n13-new-salary-review, worktree /home/claude/wt-n13. Read PLAN.md "Re-scope 17 Oct 2026" first.
Run: `cd backend && flock /tmp/jest.lock npx jest src/__tests__/newEmployeeSalaryGate.test.js` and
`node backend/scripts/new-employee-salary-gate-check.js`.

## CLAUDE.md entry
## Last Session — 2026-10-17 (N-13: salary never set on employee create; bulk-import gross goes to finance)
**Branch `feat/n13-new-salary-review`, NOT merged. MONEY PR — independent review before PR.** Plan + log:
`docs/ux-bulk/prs/N-13/PLAN.md` ("Re-scope 17 Oct 2026"), `PROGRESS.md`. Owner ruling 17 Oct "Close the API gap".
- **Before:** `POST /api/employees` took basic/da/hra/conveyance/otherAllowances and inserted a `salary_structures` row
  (Stage 7 paid the component sum) with no request or audit; `POST /employees/bulk-import` (admin) wrote the file's gross
  straight into `employees.gross_salary` + a structure (or re-synced it) — no finance step.
- **Now:** POST / with any salary key holding a real value → 400 `SALARY_VIA_SALARY_INPUT` ("Create the employee first,
  then set salary in Salary Input (finance approves it)."), `fields`, nothing written; undefined/null/''/0 = not sent.
  Bulk-import keeps importing employee fields; gross is never written — a different gross raises ONE Pending
  `salary_change_requests` row (requested_by = importer, reason "Salary from employee bulk import"); equal → none;
  pending already → none. Reply `results.rows[] {code, employee, salary: request_raised|unchanged|already_pending|no_gross}`.
  Finance approves in Salary Input; the importer gets 403 SELF_APPROVAL. Shared `raiseSalaryChangeRequest()` in
  employees.js (PUT /:code/salary uses it; replies unchanged).
- **Fragile:** (1) a new salary key spelling must be added to `CREATE_SALARY_KEYS`. (2) A bulk-imported new employee has
  gross 0 and no structure until finance approves. (3) Bulk re-import no longer repairs a drifted structure gross
  (GET /:code self-heal and integrity-fix still do). (4) `salaryCreated` is gone from the bulk-import reply.
- **Verified:** jest 125/2230 → 126/2256 (new `newEmployeeSalaryGate.test.js` 26, 21 fail on origin/main);
  statutoryWriters ×3 + statutoryWriterGuard ×1 changed on purpose. `node backend/scripts/new-employee-salary-gate-check.js`
  (real server.js, port 3502, real logins) 26/26; `--base` on origin/main 18 fail. Drift 0.
- **Not tested:** Railway; production data; browser (no frontend change).

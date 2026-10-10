# P1-25 — PLAN (Phase 0)

Branch `fix/employee-edit-no-direct-gross` · base origin/main 0ea1409 · MONEY PR → independent review.
Finding N-12 (P1-23 review). Spec: `PROMPT.md`.

## What the code does today (FACT — read in this worktree)
- `backend/src/routes/employees.js` `PUT /:code` (L393–530): no route guard (router sits behind `requireAuth` only).
  `gross_salary` is in `allowedFields` (L417) → written straight to `employees.gross_salary`; then L483–489 call
  `syncSalaryStructureFromEmployee(db, emp.id, { gross_salary, pt_applicable })`, which rescales the latest
  `salary_structures` row (or creates one). No `salary_change_requests` row, no finance step, no `audit_log` row for gross.
  Plant Stage 7 reads `employees.gross_salary` → next compute pays the new figure.
- The only existing check is P4's exit refusal (L404–407: `isExit`, 400 before any write; resending the current exit
  status passes). That is the pattern to mirror.
- `PUT /:code/salary` (L569, `requireHrOrAdmin`): gross change (`|new − current| > 0.01`, new > 0) → `salary_change_requests`
  Pending row, current salary unchanged; same gross → component update. This is the one allowed path (P1-23, on its own
  branch, adds maker-checker on the decide side in `salary-input.js` — no file overlap with this PR).

## Who sends gross through PUT /:code (FACT — grep)
- Frontend: `updateEmployee` (`utils/api.js:85`) has ONE caller, `Employees.jsx` `EditEmployeeModal` (L229). Its form state
  (L198–213) has code, name, department, designation, company, date_of_joining, employment_type, shift_code,
  default_shift_id, weekly_off_day, phone, email, aadhar, pan — **no `gross_salary`**. The gross input lives in
  `SalaryModal` (L43–107) which calls `updateSalaryStructure` → `PUT /:code/salary`.
  ⇒ **No frontend change.** (The prompt's rule: frontend only if the edit form sends gross.)
- Backend scripts / sims: none call `PUT /api/employees/:code` with gross (`docs/statutory-flags/sim/run.py` uses `/salary`).
- Existing jest tests that DO send gross / non-hr roles to `PUT /:code` (they will change behaviour — see Q1/Q2):
  1. `statutoryWriters.test.js:52` (T9a) — admin changes gross 15000 → 16000 with flags in the body, expects 200 and gross 16000.
  2. `statutoryWriters.test.js:197` (T8b) — admin sets gross NULL → 12000 to reach the sync "create structure" path.
  3. `markLeftRoleGuard.test.js:128` — `view1` / `fin1` sending status Left expect 400; with the route guard they get 403.

## Decision
(a) **Refuse a changed gross on `PUT /:code`** for every role (admin included — the approval flow is the one path; P1-23
ruling Q6: a second person always decides). Placed right after the P4 exit check, before any write, whole edit refused:
```js
// P1-25: gross changes only through Salary → request a change (finance approves).
if (updates.gross_salary !== undefined) {
  const next = Number(updates.gross_salary);
  const cur  = Number(emp.gross_salary) || 0;
  if (!Number.isFinite(next) || Math.abs(next - cur) > 0.01) {
    return res.status(400).json({ success: false, code: 'GROSS_CHANGE_NEEDS_APPROVAL',
      error: 'Change salary through Salary → request a change (finance approves)' });
  }
}
```
- Numeric compare with the same 0.01 tolerance as `PUT /:code/salary`; `"15000"` vs 15000 passes; NULL gross = 0, so
  resending `0`/`null`/`""` on an employee with no gross passes (no change) — `Number(null)=0`, `Number("")=0`.
- Unparseable (`"abc"`, `NaN`) → refused (today it would write garbage into the column).
- NULL/0 → X (first gross for an EESL-created employee) **is a change → refused**. Justification: the UI already sends a
  first gross through `/salary` (new > 0, current 0 → Pending request), so this closes no workflow.
- Resending the same gross still runs the existing sync (same value → no money change); left untouched ("nothing else").

(b) **`requireHrOrAdmin` on `PUT /:code` only**, as route middleware (403 before the lookup, same order as Mark Left).
Justification: prod callers in 90 days are hr 139× / admin 5× and no other role (planner FACT); the single UI caller is
the Edit modal, already shown only where HR/admin edit. Finance/viewer/supervisor/employee lose a write path they never
used. Every other route in the file is unchanged (P2-11).

Not done (out of scope, P2-11): POST /employees (accepts gross on create), bulk-set-contractor, documents, bulk-import.
No audit row added for the refusal (nothing is written).

## Files
- `backend/src/routes/employees.js` — `PUT /:code` only: `requireHrOrAdmin` in the route signature + the gross block (~10 lines).
- New `backend/src/__tests__/employeeEditGrossGuard.test.js` (jwtApiHarness, real JWTs, fictional codes).
- Existing tests adjusted (needs planner OK — Q1/Q2): `statutoryWriters.test.js` (T9a, T8b), `markLeftRoleGuard.test.js` (view1/fin1).
- New `backend/scripts/employee-edit-gross-guard-check.js` — HTTP (curl-style) script against a real `server.js` on a
  scratch DB, port 3125, real logins; `--base` runs against an origin/main worktree to show the bug (no frontend change ⇒
  no browser check, per PROMPT).
- `CLAUDE.md` Last Session entry; this PLAN + PROGRESS.
- No frontend file, no dist rebuild. DO-NOT-MODIFY files untouched (`git diff --stat` check on salaryComputation.js etc.).

## Tests — `employeeEditGrossGuard.test.js`
Users: hr1 (hr), boss (admin), fin1 (finance), view1 (viewer), sup1 (supervisor), emp1 (employee). Fictional codes T25xx.
1. hr changes gross 15000 → 16000 (+ name) → 400 `GROSS_CHANGE_NEEDS_APPROVAL`; employees row, salary_structures rows,
   salary_change_requests count, audit_log count all unchanged (name not written either).
2. admin same → 400, nothing written.
3. hr resends same gross (15000, and "15000.00" string) + name change → 200; name changed; gross 15000; structures unchanged.
4. hr edits other fields only (designation, phone, shift) → 200.
5. Employee with NULL gross: hr sends 0 / null → 200; sends 12000 → 400.
6. hr sends gross "abc" → 400.
7. viewer / finance / supervisor / employee → 403 on a plain name edit; nothing written. No token → 401.
8. Missing employee as hr → 404; as viewer → 403 (guard first, like Mark Left).
9. `PUT /:code/salary` as hr with a new gross → 200 `pendingApproval:true`, one Pending `salary_change_requests` row,
   `employees.gross_salary` unchanged.
10. P4 exit refusal still works for hr (400 "Use Mark Left").
Run against origin/main code to prove tests 1, 2, 5(12000), 6, 7 fail there. Full suite before/after (record suites/tests).

## Verify script — `backend/scripts/employee-edit-gross-guard-check.js`
Boots `server.js` on a scratch `DATA_DIR`, port 3125, seeds fictional users (hr, admin, finance, viewer) + 2 employees,
logs in via `/api/auth/login`, then: hr Edit-modal-shaped body (exact keys the modal sends) → 200; hr gross change → 400,
DB unchanged; hr `/salary` gross change → Pending request; finance/viewer `PUT /:code` → 403; `/api/version` up.
`--base <dir>` points at an origin/main worktree: expects hr gross change → 200 and DB gross moved (bug shown) and
viewer edit → 200. Only processes it started are stopped (own PID).

## Risks / fragile
- Any future screen that puts gross in the Edit modal will get a 400 — the error text points to the salary request.
- Sales has its own `PUT /api/sales/employees/:code` gross path (versioned structures, different flow) — not touched.
- POST /employees still takes `gross_salary` on create with no approval (initial salary) — P2-11 / question Q3.

## Questions for the planner
- **Q1.** OK to edit the two `statutoryWriters.test.js` cases? T9a: resend the same gross (15000) instead of 16000 and
  assert gross stays 15000 (flags-ignored intent kept). T8b: seed `gross_salary = 12000` in the DB, then PUT the same
  12000 so the sync create path still runs (intent kept).
- **Q2.** OK to change `markLeftRoleGuard.test.js` view1 / fin1 Left cases from 400 to 403 (still "nothing written")?
  The hr/admin cases keep 400 "Use Mark Left".
- **Q3.** Refuse NULL/0 → first gross on `PUT /:code` too (my plan: yes, the UI already routes it through `/salary`)?
- **Q4.** Admin included in the refusal (my plan: yes — no admin bypass, per Q6 of P1-23)?

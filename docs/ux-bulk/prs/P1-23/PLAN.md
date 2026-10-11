# P1-23 — PLAN (Phase 0)
Branch `fix/salary-change-no-self-approval` · base origin/main 18bef07 · Finding F-3 · Owner ruling Q6 (11 Oct 2026): a
second person always decides, admin included. MONEY PR → independent review before PR.

## 1. What the code does today (read, not assumed)
- `POST /api/salary-input/request-change` (requireHrOrAdmin) stores `requested_by = req.user?.username || 'admin'`.
- `PUT /api/employees/:code/salary` (employees.js ~l.612–664) is the SECOND writer of `salary_change_requests`
  (gross change via Employee Master); same `requested_by` rule. It only INSERTs — nothing to change there.
- `PUT /api/salary-input/approve/:id` (requireFinanceOrAdmin): reads the Pending row (404 if none), parses JSON,
  employee lookup (404), validates `effectiveFrom` (400), then ONE transaction writes salary_structures +
  employees.gross_salary + the request status. Never compares the approver with `requested_by`.
- `PUT /api/salary-input/reject/:id` (requireFinanceOrAdmin): reason required (400), reads the Pending row (404),
  inserts `finance_rejections`, flips status. Never compares the rejecter with `requested_by`.
- grep `salary_change_requests` / `salary-input/approve`: approve + reject in salary-input.js are the ONLY paths that
  decide/apply a request. `approveSalaryChange` in `frontend/src/utils/api.js` is exported but imported nowhere;
  SalaryInput.jsx calls `api.put` directly. (FinanceAudit's GROSS_STRUCTURE_CHANGE is `salary_manual_flags`, a
  different table — out of scope, see §6.)
- `SalaryInput.jsx` ~l.252–268: pending card shows "Requested by {req.requested_by}"; when `canFinance` it renders
  Approve (mutate) + Reject (opens reason modal), else "Awaiting Finance approval". No requester check.
- Hole: role `admin` passes both requireHrOrAdmin and requireFinanceOrAdmin → can raise and approve their own change.
  Production (planner, counts only): 2 approved rows decided by their own requester.

## 2. Change — backend (`routes/salary-input.js`, guard lines only)
One small helper near the top of the file:
```js
const sameUser = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const SELF_APPROVAL = { success: false, code: 'SELF_APPROVAL',
  error: 'You raised this request — another finance or admin user must decide it.' };
```
- approve: right after the Pending-row read / 404 and BEFORE the JSON parse, employee lookup, effectiveFrom check and the
  transaction: `if (sameUser(req.user?.username, request.requested_by)) return res.status(403).json(SELF_APPROVAL);`
- reject: right after the Pending-row read / 404 and BEFORE the `finance_rejections` insert — same line.
- Order kept: role 403 (middleware) → reject's reason 400 → 404 not found/processed → 403 SELF_APPROVAL → existing logic.
- Compare on `req.user.username` (the value request-change stored), not the `'admin'`/`'finance'` fallbacks. Empty /
  NULL `requested_by` or missing username → `sameUser` false → no block (legacy rows unaffected; there is no
  unauthenticated path — router is behind requireAuth).
- Nothing in the apply logic, the transaction, finance_rejections payload, or response bodies of the success paths moves.
  No schema change.

## 3. Change — frontend (`pages/SalaryInput.jsx`, buttons only)
- In the pending card, `const own = sameUser(user?.username, req.requested_by)` (same trim/lower-case compare, inline).
- `canFinance && own` → Approve and Reject rendered `disabled`, `title` = the SELF_APPROVAL text, plus a small line under
  them: "You raised this request — another finance or admin user must decide it." `canFinance && !own` → unchanged.
  `!canFinance` → unchanged ("Awaiting Finance approval").
- If the backend 403 still arrives (stale list), the existing `onError` toast shows the server message — check it does;
  if it shows a generic text, map `err.response.data.error` (one line, same mutation).
- `npm run build --prefix frontend`; dist in its own commit.

## 4. Verify
- jest `backend/src/__tests__/salaryChangeSelfApproval.test.js`, real JWTs via `helpers/jwtApiHarness` (users: admin `boss`,
  admin `boss2`, finance `fin1`, hr `hr1`; fictional employee T97xx, fictional money):
  1. boss raises (request-change) → boss approve 403 `SELF_APPROVAL`; row still Pending; salary_structures row count +
     employees.gross_salary unchanged; no finance_rejections row.
  2. boss reject own → 403; still Pending; no finance_rejections row.
  3. case/space variant: requested_by ' BOSS ' row (direct insert) → boss approve 403.
  4. boss2 approves boss's request → 200, structure applied, approved_by = boss2.
  5. fin1 approves / rejects a boss request → 200 (reject archives).
  6. hr1 raises → hr1 approve 403 from the role guard (existing message kept, not SELF_APPROVAL).
  7. Employee-Master path: boss changes gross via `PUT /api/employees/:code/salary` → boss approve 403 (proves both writers).
  8. legacy row with NULL requested_by → finance approves 200.
  Sanity: the new tests fail on 18bef07 (approve/reject return 200).
- Full suite before (18bef07) and after; record suites/tests.
- Browser `backend/scripts/salary-change-self-approval-check.py` (pattern: salary-register-report-check.py; scratch DB,
  port 3123, built dist, real logins, PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers): admin A raises a change → A sees
  Approve/Reject disabled + reason text; admin B logs in, approves → toast, card gone, history shows Approved by B;
  0 page/console errors, 0 API ≥ 400 (except the deliberate API 403 probe by A, asserted). Also 390px. `--base` on an
  18bef07 worktree build: A's Approve is enabled and the approval succeeds (bug proved).
- Self-debug + user-simulation pass; CLAUDE.md Last Session entry; push; HEAD == origin.

## 5. Files
backend/src/routes/salary-input.js (helper + 2 guard lines), frontend/src/pages/SalaryInput.jsx (buttons), frontend/dist,
backend/src/__tests__/salaryChangeSelfApproval.test.js (new), backend/scripts/salary-change-self-approval-check.py (new),
docs/ux-bulk/prs/P1-23/{PLAN,PROGRESS}.md, CLAUDE.md. Nothing else.

## 6. Questions / notes for the planner
- Q1: username compare only (no user-id column on the request) — OK? Renaming a user would let them approve an old
  own request; usernames are not renamed in the app today.
- Q2: legacy rows with NULL/empty `requested_by` stay decidable by anyone with the role — OK?
- Q3: also block a REQUESTER from rejecting = withdrawing their own request? Spec says yes (reject guarded). There is no
  separate withdraw for salary changes, so the requester can only ask someone else to reject. Confirm.
- Found, not in scope: FinanceAudit `PUT /approve-flag/:flagId` (GROSS_STRUCTURE_CHANGE, salary_manual_flags) has no
  maker-checker either; `approveSalaryChange` in api.js is dead code (and would send effectiveFrom — the screen never does,
  so approval always uses today's date).

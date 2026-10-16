# P5-01: Phase 0 plan. Bulk engine approval stage, plus a finance "Bulk batches" queue
Branch `feat/bulk-approval-stage` on origin/main `b0ed242` · port 3501 · Builder A · stacked under P5-04 (money)
Spec: MASTER_PLAN §6 P5-01, §7.2 (lifecycle, /submit, /batches/:id/approve|reject|return), §7.5, §7.6.
Rulings: R3 all-or-nothing · R4 undo unchanged · R5 at most 50 rows per batch · Q2 auto-split · Q6 second person always (admin included).
Status: **Phase 0 ready. Waiting for "go". No code written.**

## 1. Facts (read-only)
- FACT (code) `routes/bulk.js` (53 lines) has `router.use(requireHrOrAdmin)` at L13. That one line gates every bulk route, so finance and viewer get 403 everywhere. The test `bulkExtraDuty.test.js` L283–288 relies on this: finance and viewer get 403 on preview, on apply and on `GET /batches?kind=extra-duty`.
- FACT (code) `bulkSchema.js`: `bulk_batches.status` CHECK already allows `draft, submitted, approved, applied, rejected, returned, undone`. The DEFAULT is `'applied'`. The table has **no** columns yet for submitted_by/at, approved_by/at, reject reason or return note. `bulk_rows.input_json` exists. The engine writes it as the ED-specific `{code, duty_days}`.
- FACT (code) `engine.js` has three ED-specific spots in otherwise generic code:
  - `hashGroup` uses `r.code, r.duty`.
  - `displayRow` uses `dutyDays: r.duty`.
  - `insRow` writes `input_json = {code, duty_days}`.

  The audit remark adds `HR-approved`. `KINDS` is a literal map holding only `extra-duty`.
- FACT (code) The self-approval pattern lives at `routes/salary-input.js` L70–75. It is a trimmed, case-insensitive username compare, and an empty name blocks nobody. The 403 body is `{success:false, code:'SELF_APPROVAL', error}`. `financeAudit.js` L1357 has a copy of the same `sameUser`.
- FACT (code) `FinanceVerification.jsx` has five tabs in `tabs[]` (L156–162) and the deep link `?tab=` (L40). Actions are gated by `canFinance(user)`. The page perm is `finance-verification`, which hr and finance already have, so **no new permissions.js key is needed**.
- FACT (code) `ReviewQueue` supports a reason modal (`needsReason`, `minReasonLen`), confirmText(n, ₹total), `moneyOf`, and a row `render(row, api)` that has `api.openAction`. The bulk calls live in `utils/bulkApi.js`, so api.js is not touched.
- FACT (code) `statusMap.js` `bulk_batch` has `draft, previewed, pending_approval, applied, partially_applied, failed, undone`. It has **no** `submitted / returned / rejected`, so those would show as raw grey text. `statusMap.js` is not in my owned list (see Q-A3).
- FACT (prod, read-only) There are 0 rows in `bulk_batches` (nothing applied yet in production), so new columns land on an empty table. There are 2 Pending `salary_change_requests`.

## 2. Change (smallest)
### 2.1 `database/bulkSchema.js`: ALTER-if-missing (PRAGMA table_info), after the CREATEs
Add these `bulk_batches` columns, all nullable TEXT unless stated:
- `submitted_by`, `submitted_at`
- `approved_by`, `approved_at`
- `decided_by`, `decided_at` (reject/return)
- `reject_reason`, `return_note`
- `money_total REAL` (the ₹ total a kind reports at submit; NULL for kinds without one)

Plus one index, `idx_bulk_batches_status_kind (status, kind)`. No CHECK change is needed. `schema.js` is not touched.

### 2.2 `services/bulk/engine.js`
- **Kind interface additions.** Every addition is optional, and its default is today's ED expression, so ED is byte-identical:
  - `requiresApproval` (bool; default false)
  - `roles {create:[…], approve:[…]}` (default create `['hr','admin']`, approve `['finance','admin']`)
  - `hashRow(r)` (default `[r.code, r.duty, state, action, fingerprint]`)
  - `inputOf(r)` (default `{code, duty_days}`)
  - `rowFromInput(json, rowNo)` (rebuilds a normalised row at approval)
  - `displayExtra(r)` (default `{dutyDays: r.duty}`)
  - `moneyTotal(planned)` (₹ total or null)
  - `reviewColumns` (`[{key,label,type:'text'|'money'|'date'|'pct'}]`, used by the finance view)
  - `describe` (exists)
- `apply()` refuses an approval kind with 409 `BULK_NEEDS_APPROVAL` ("This kind is saved for finance approval"). This means a hr client can never skip the stage.
- **New `submit(db, kind, body, user)`.**
  - It runs the same prepare, re-plan, error-row refusal, 50-row cap and plan-hash check as apply, inside one IMMEDIATE txn.
  - It writes the batch as `status='submitted'`, with `submitted_by/at` = user and `money_total`. It writes one `bulk_rows` line per row, with full `input_json` from `inputOf`, the plan state/action/messages and the display. **No applyRow.**
  - Audit: `BULK_SUBMIT`. One notification goes to role `finance`: "Bulk <kind> batch #N (R rows, ₹X) is waiting for your approval", link `/finance-verification?tab=bulk`. It uses `leaveTriggers.notify` (best-effort, same connection).
  - Non-approval kinds get 409 `BULK_NO_APPROVAL_STAGE`.
- **New `approve(db, id, user)`.** One IMMEDIATE txn, all-or-nothing (R3):
  1. Load the batch. It must be `submitted`, else 409 `BULK_NOT_SUBMITTED`.
  2. If `sameUser(user, created_by)`, return 403 `SELF_APPROVAL`, "You saved this batch — ask another finance or admin user to decide it." Nothing is written.
  3. Rebuild the rows from `bulk_rows.input_json` (row order kept, skipped rows kept) and `common_json`.
  4. **Re-plan** against today's data. Any error row, or a hash ≠ `batch.plan_hash`, returns 409 `BULK_PLAN_CHANGED` / `BULK_ROW_ERROR` with the fresh rows (plain reasons). Nothing is written and the batch stays `submitted`, so finance can Return it.
  5. Run `applyRow` for each applicable row, with ctx `{batchId, user: approver, requestedBy: created_by, options}`.
  6. Update each `bulk_rows` line (before/after/target/state).
  7. Set the batch to `status='applied'`, `approved_by/at`, `applied_at`. The `approved` state is never persisted on its own, because approve and apply are one atomic step.
  8. Audit: `BULK_APPROVE`, with counts and the ₹ total.
- **New `reject(db, id, reason, user)`.** The reason must be at least 5 chars (`BULK_REASON_REQUIRED`). The batch must be submitted, and the self check applies. Sets `status='rejected'`, `reject_reason`, `decided_by/at`. Audit: `BULK_REJECT`. One notification goes to the creator's role (`kind.roles.create[0]`).
- **New `returnBatch(db, id, note, user)`.** Same as reject, but sets `status='returned'` and `return_note`. Audit: `BULK_RETURN`. The creator re-submits by checking the rows again in the kind's panel, which creates a new batch. The returned one stays as a record.
- `undo()`: unchanged (R4). Still `status==='applied'` only.
- `listBatches({kind,status,…, kinds})` takes an allowed-kinds list from the route. `shapeBatch` adds the new fields, `moneyTotal` and `requiresApproval`.
- `getBatch` adds `columns: kind.reviewColumns`.
- `KINDS`: `'extra-duty'`, plus `'test-approval'` **only when `process.env.BULK_TEST_KINDS === '1'`** (see §5).

### 2.3 `routes/bulk.js`: per-route role gates (the global `router.use` is removed)
- Helper `gate(kindName, side)`. An unknown kind returns 404 (as today, from the engine). A role not in `kind.roles[side]` returns 403 with the **same body as `requireHrOrAdmin` for ED** (`'HR or admin access required'`), so the ED tests stay byte-identical. For an approval kind the message names its roles.
- Route roles:

| Route | Roles |
|---|---|
| `/extra-duty/employees`, `/extra-duty/people` | `requireHrOrAdmin` per route (unchanged) |
| `/:kind/preview`, `/:kind/apply`, `/:kind/submit` | `kind.roles.create` |
| `/batches/:id/approve`, `/reject`, `/return` | `requireFinanceOrAdmin` + the kind's `roles.approve` |
| `/batches/:id/undo` | `kind.roles.create` of the batch's kind (ED: hr/admin, as today; see Q-A2 for approval kinds) |

- `GET /batches`: the visible kinds for a role are the kinds where role ∈ create, or role ∈ approve when the kind requires approval. If the asked-for kind is not visible, or there is no visible kind at all, the route returns 403 (finance on `extra-duty` still gets 403).
- `GET /batches/:id`: same visibility rule, applied to the batch's kind.

### 2.4 Frontend
- `utils/bulkApi.js`:
  - `bulkSubmit(kind, data)`
  - `getBulkQueue()`, which is `GET /bulk/batches?status=submitted`, fresh
  - `approveBulkBatch(id)`
  - `rejectBulkBatch(id, reason)`
  - `returnBulkBatch(id, note)`
- New `components/bulk/BulkApprovalQueue.jsx`. It is built on `ReviewQueue`:
  - Chips: All / Waiting / Returned / Rejected (the last two cover the last 30 days, so finance sees what it sent back).
  - Columns: # · Kind · Saved by · When (fmtIstDateTime) · Rows · ₹ total (fmtINR, lakh) · What (summary) · Open.
  - **Open** expands the batch rows using `columns` from the server (generic renderer: money via fmtINR, dates via fmtDate). It also shows the plain messages per row.
  - Actions:
    - Approve: confirm "Approve and apply N batch(es), ₹X?".
    - Reject: reason ≥ 5, "Why are you rejecting it?".
    - Return: note ≥ 5, "What should they fix?".

    They are eligible only when `status==='submitted' && createdBy ≠ me`. Own batches show "You saved this — another finance user decides it" and their box is disabled.
  - On a 409 PLAN_CHANGED the dialog shows "Data changed since it was saved — return it so they check again" plus the changed rows.
  - Queries invalidated: `['bulk-queue']`, `['bulk-batches']`, `['bulk-batch']`.
- `FinanceVerification.jsx`: **tab only**. This is +1 import, +1 tabs entry `{id:'bulk', label:'Bulk batches (N)'}` shown when `canAct`, +1 deep link `?tab=bulk`, and +1 render line `{activeTab==='bulk' && <BulkApprovalQueue/>}`. The waiting count comes from a small `useQuery` inside the page (`enabled: canAct`). That is about 8 lines.
- `BulkBatchList.jsx`: for `returned` / `rejected` it adds a line under the row: "Returned by fin1 on 17-Oct-2026: <note>" / "Rejected by …: <reason>". `submitted` shows "Waiting for finance". The ED header and cells are unchanged. A `whatLabel` prop defaults to "Grant".

## 3. NOT touched
- schema.js, payroll.js, salaryComputation.js, dayCalculation.js, recompute.js
- api.js (builder C), employees.js, SalaryInput.jsx, ExtraDutyGrants.jsx (builder B)
- CLAUDE.md, the ED finance-review flow, loans
- ExtraDutyBulkGrant.jsx: it keeps calling `bulkApply`

The existing ED test file keeps passing **unmodified**. It is the byte-identical proof.

## 4. Tests (jest, new `__tests__/bulkApproval.test.js`; real routers + real JWTs via jwtApiHarness; fictional T95xx)
Users: hr1, hr2, fin1, fin2, admin1, admin2, view1. Every case below runs against the test-only kind.
1. Submit → `submitted`. Nothing applied (target table empty), audit `BULK_SUBMIT`, one finance notification.
2. `apply` on an approval kind → 409 `BULK_NEEDS_APPROVAL`.
3. Approve by fin1 → `applied`. Target rows written, `approved_by=fin1`, audit `BULK_APPROVE`, and the applyRow ctx carries `requestedBy=hr1`.
4. Self-approval refused for hr-created-by-admin1 → admin1 approve/reject/return gets 403 `SELF_APPROVAL`, nothing written, case-insensitive. admin2 succeeds.
5. Role guard:
   - hr / viewer → approve/reject/return get 403.
   - finance → submit/preview on a kind whose create roles exclude finance get 403.
   - viewer → `GET /batches` gets 403.
6. Plan changed between submit and approve (the target fingerprint is mutated) → 409 `BULK_PLAN_CHANGED`. The batch stays submitted and 0 rows are written.
7. All-or-nothing: the test kind throws on row 37 of 40 at approval → 0 rows written, batch stays submitted.
8. Reject needs ≥ 5 chars (4 → 400). Reject → `rejected` + reason. Return → `returned` + note. Approving a rejected or returned batch → 409.
9. Cap: 51 applicable rows → `BULK_ROW_LIMIT`. Preview of 109 → 3 groups. Submitting each group makes 3 batches with the same group_id.
10. Undo after approval follows the kind's `undoable` (allowed / blocked). Undo of a `submitted` batch → 409.
11. `GET /batches?status=submitted` as finance → only approval kinds. `kind=extra-duty` as finance → 403 (unchanged).
12. Double approve (two calls) → the second gets 409 `BULK_NOT_SUBMITTED`. Nothing is applied twice (IMMEDIATE).

Full suite before and after, reds listed. `bulkExtraDuty.test.js` must stay green untouched.

## 5. Test-only kind (how it never reaches production)
- File `services/bulk/kinds/testApproval.js`. It is registered in `KINDS` only when `BULK_TEST_KINDS === '1'`. Jest sets the variable at the top of the test file, before the require. The Playwright script sets it on its scratch server. Railway never sets it.
- The kind writes to its own table, `bulk_test_target`, which it creates with `CREATE TABLE IF NOT EXISTS` in `context()`. That code only runs when the kind is registered, so production gets no new table.
- Rows: code + `amount`. It has a ₹ total and roles `create:['hr','admin']`, `approve:['finance','admin']`.
- Its `undoable()` returns false when the target row has been edited. Its `applyRow` throws when `amount === 13013` (used by the rollback test).

## 6. Checks
- `flock /tmp/jest.lock npx jest --silent` (full suite).
- `flock /tmp/vite.lock npm run build --prefix frontend`.
- `backend/scripts/bulk-approval-check.py`: built dist, scratch DB, `BULK_TEST_KINDS=1`, real logins. It submits through the API, because the test kind has no panel.
  - fin1 sees "Bulk batches (1)" → opens it → sees the rows and the ₹ total in lakh → Return with a note.
  - hr1 sees the note in BulkBatchList.
  - A second batch is approved by fin1 → status Applied.
  - Edge case: admin1 creates a batch → admin1's Approve box is disabled with the reason, and a direct API approve gets 403.
  - Edge case: plan changed → plain message.
  - Also checked: 390 px, 0 page errors, 0 unexpected ≥ 400.
  - `--base` mode: the tab is missing / `/submit` gets 404 on main.
  - ED regression: re-run `backend/scripts/` ED bulk check (P3-01's script) unchanged.

## 7. Risks
- ED byte-identical: protected by the default hooks plus the untouched ED test file plus the P3-01 Playwright script. I will diff `hashGroup` output for an ED fixture before and after the change.
- Re-plan at approval can legitimately fail days later, because the data moved. That is the right outcome (R3). The UX gives the "Return" path, not a silent partial.
- Role gate restructuring could open a route. Test 5 covers every route × role.
- A notification failure must not roll back the batch. `notify` is already try/catch.

## 8. Questions for the planner
- **Q-A1** Return = new batch on re-submit (returned batch kept as history), not editing the returned batch in place. OK?
- **Q-A2** Who may **undo** an applied approval-kind batch? Proposal: finance/admin (the side that approved), not the creator, because undo reverses a finance decision. For ED it stays hr/admin.
- **Q-A3** Need 3 lines in `frontend/src/utils/statusMap.js` (`bulk_batch.submitted` "Waiting for finance" amber, `returned` "Returned" orange, `rejected` "Rejected" red). The file is not in my list. May I add them? Otherwise I pass a local label override.
- **Q-A4** Should the creator be able to **withdraw** a submitted batch? Proposal: not in this PR.
- **Q-A5** Tab label "Bulk batches (N)" placed last, after Held Salaries. OK?

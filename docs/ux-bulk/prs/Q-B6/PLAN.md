# Q-B6 — a gross change finance already approved is not asked again in Manual Interventions (PLAN, Phase 0)

Branch `fix/bulk-revision-preapproved-flags` off main b2badcab. MONEY PR. Port 3503. No code yet.

## 1. What happens today (read, line numbers at b2badcab)

1. **Approval writes the change.** Bulk salary revision (`services/bulk/kinds/salaryRevision.js` `applyRow`, L222)
   inserts a `salary_change_requests` row (requested_by = batch creator, reason "Salary revision — bulk batch #B…")
   and approves it through `services/salaryChange.js approveSalaryChange` (L103) — the SAME function as
   `PUT /api/salary-input/approve/:id` (`routes/salary-input.js` L145). It sets `employees.gross_salary`,
   the structure row, and the request to Approved with `approved_by` = the finance/admin approver.
2. **Stage 7 raises the flag.** `salaryComputation.js` (PROTECTED) L738–739: `grossChanged` = master gross ≠ the
   SAVED previous month's `salary_computations.gross_salary`. L1074–1077 `populateManualFlags` UPSERTs
   `GROSS_STRUCTURE_CHANGE` (`system_value` = previous month gross, `manual_value` = new gross).
   The UPSERT's ON CONFLICT updates values / changed_at / notes only — it **never resets `finance_approved`**
   (good for us: a stamped approval survives every re-run; see risk R3 for the down side).
3. **Finance is asked again.** Two server readers only (grep of `finance_approved` / `salary_manual_flags`):
   - `GET /api/finance-audit/salary-manual-flags` (`routes/financeAudit.js` L1190) — Manual Interventions tab,
     Dashboard action item. Pending = `finance_approved = 0`.
   - `GET /api/finance-audit/readiness-check` (L1561, count at L1579) — BLOCKER `UNAPPROVED_MANUAL_FLAGS`.
   Finance Verification does NOT read this table: its red flag `gross_changed` (`financeRedFlags.js` L46) is a
   warning from `salary_computations.gross_changed` and does not block sign-off.
4. **Decision code.** `decideManualFlag` (L1390) — self-approval check via `grossRequestForFlag` (L1365: the
   employee's LATEST approved gross-changing request, new_gross = flag manual_value ± ₹1), GROSS_MOVED_SINCE on
   reject, revert of gross + request → 'Reverted' on reject.

**The single path has the same double ask.** A single approved change (Salary Input / Employee Master request)
also gets a pending flag at the next Stage 7 — production shows this is in fact the whole backlog (§2).

## 2. Production, read-only, counts only (22 Oct 2026)

| 2026 month | GROSS flags | pending | approved | rejected | pending that match an approved request (new gross ±₹1, approver ≠ requester) |
|---|---|---|---|---|---|
| Feb | 3 | 3 | 0 | 0 | 0 |
| Mar | 2 | 1 | 0 | 1 | 1 |
| Apr | 30 | 30 | 0 | 0 | 30 |
| May | 3 | 3 | 0 | 0 | 3 |
| Jun | 1 | 1 | 0 | 0 | 1 |
| Jul | 2 | 2 | 0 | 0 | 2 |
| Aug | 79 | 79 | 0 | 0 | 79 |
| Sep | 1 | 0 | 1 | 0 | 0 |

- Bulk salary-revision batches in production: **0** (no request carries "bulk batch #"). Every match today is a
  single-path approval.
- Of 121 flags, 113 match the LATEST approved request. Flag month vs approval month: 99 same month,
  **19 flagged in a month EARLIER than the approval** (Stage 7 pays the master gross for any month it re-runs),
  7 flags were written before the request was approved. ⇒ the month a flag lands in cannot be predicted at
  approval time.
- No 2026 month has `monthly_imports.is_finalised = 1`.

## 3. Options

- **(a) Pre-write an approved flag at approval time.** Rejected: the flag month is not predictable (19/113 land in
  an earlier month; an earlier open month re-run after approval also flags), so we would write approved rows for
  months Stage 7 never flags (they would show a change that did not happen) and miss the month it does flag.
- **(b-virtual) Readers treat a matched flag as approved, nothing written.** Works, but `finance_approved` stays 0
  in the table, so SQL Console / any future reader disagrees with the screen, and the trail is only implicit.
- **(c) Protected-file fix** — `salaryComputation.js` L1074–1077: when the new flag matches an approved request,
  INSERT it with `finance_approved = 1`. Cleanest single point, but needs owner approval for a protected file;
  and it would still need the same match helper. Listed as Q3, not recommended.
- **(b) RECOMMENDED — "stamp on read", persisted.** A new non-protected helper stamps matched pending flags as
  approved (with the original approver and an audit row) right before the two readers read. Smallest, no
  protected file, no schema change, works whatever month the flag lands in, idempotent.

## 4. Recommended change (option b)

**New `backend/src/services/grossFlagPreapproval.js`**
- `grossRequestForFlag(db, flag)` MOVED here from `financeAudit.js` unchanged (financeAudit imports it — one copy;
  decideManualFlag's self-approval and revert keep using the same function).
- `preapproveGrossFlags(db, { month, year })` — one `db.transaction`:
  for each `GROSS_STRUCTURE_CHANGE` flag of the month with `finance_approved = 0`:
  1. `req = grossRequestForFlag(db, flag)` (latest approved gross request, new gross = flag new gross ± ₹1);
  2. eligible only if `req.approved_by` is a person, `!sameUser(req.approved_by, req.requested_by)`, the month is
     not finalised, and (scope per **Q1**) the request belongs to a bulk batch: a `bulk_rows` row with
     `target_table='salary_change_requests' AND target_id = req.id AND undone = 0`;
  3. `UPDATE salary_manual_flags SET finance_approved = 1, approved_by = <req.approved_by>, approved_at = now
     WHERE id = ? AND finance_approved = 0`;
  4. `finance_approvals` row: status APPROVED, reviewed_by = req.approved_by, comments
     `[auto req #N] Approved with salary change request #N (bulk batch #B) by <approver> on <date> — not asked again`;
  5. `logAudit('salary_manual_flags', id, 'finance_approved', '0', '1', 'FLAG_PREAPPROVED', remark naming request,
     batch, approver, old→new gross, 'system')`.
  - **Stale guard (Q4):** a flag whose latest `finance_approvals` row is `[auto req #N]` but whose current match is
    no longer request N (gross moved again, request Reverted, batch undone) → set back to `finance_approved = 0`
    + audit `FLAG_PREAPPROVAL_WITHDRAWN`. Needed because Stage 7's UPSERT keeps an approval when values change.
  - Returns `{ stamped, withdrawn }`. Wrapped by callers in try/catch — a stamping failure never breaks the read.
- **Call sites (both in `routes/financeAudit.js`, 1 line each):** top of `GET /salary-manual-flags` and of
  `GET /readiness-check`. Rows returned by the list get `preapproved: {request_id, batch_id, approved_by}` (from
  the finance_approvals tag) so the screen can say why.
- **UI (`frontend/src/pages/FinanceAudit.jsx`, Manual Interventions row, display only):** under the Approved badge
  "With bulk batch #B · approved by X" (testid `flag-preapproved`). Q5.

**Not touched:** salaryComputation.js, payroll.js, schema.js, dayCalculation.js, recompute.js, the bulk engine,
salaryRevision.js, salaryChange.js, decideManualFlag's logic (only its import), readiness BLOCKER rule itself,
Finance Verification.

## 5. Tests / verification
- New jest `grossFlagPreapproval.test.js` (real `computeEmployeeSalary` + `saveSalaryComputation` on a scratch DB):
  bulk batch approved → Stage 7 → list shows approved by the batch approver, readiness count excludes it;
  2nd read writes nothing (idempotent, one audit row); flag in an EARLIER open month than approval also stamped;
  single-path request (not bulk) NOT stamped (or stamped, per Q1); approver = requester legacy row not stamped;
  flag new gross ≠ request → not stamped; rejected (-1) flag untouched; finalised month untouched; stale guard
  (gross re-approved to another value → withdrawn, then re-stamped by the new request if eligible); finance
  REJECT of a stamped flag still reverts gross + request → 'Reverted'; bulk undo before Stage 7 → nothing to stamp;
  viewer GET → still 200. Each core test fails on b2badcab.
- Existing: salaryFlagRevertAndApprove, bulkSalaryRevision, bulkApproval, full suite under `flock`.
- Browser `backend/scripts/bulk-revision-flags-check.py` (port 3503, hr creates batch, finance approves, Stage 7
  via API, finance opens Manual Interventions + Readiness; 390 px; `--base` shows pending + blocker).
- Drift query 0 on the scratch DB.

## 6. Risks
- R1 GET writes: the readers become writers (idempotent, attributed to the original approver). Readiness has no
  role guard, so any role opening Finance Audit can trigger the stamp — the result is the same whoever reads (Q2).
- R2 Match = latest approved request ±₹1 (same rule decideManualFlag already trusts). Two approvals in one month
  (A then B): flag prev→B is stamped for B only; A was also finance-approved, so nothing un-approved slips through.
- R3 Stage 7's UPSERT keeps `finance_approved` when values change (pre-existing, also true for hand approvals) —
  the stale guard covers auto-stamps only; hand approvals keep today's behaviour.
- R4 Backlog: if Q1 = all approved requests, the first read after deploy stamps ~116 historic pending flags
  (Mar–Aug) — Aug's 79 at once.

## 7. Questions
- **Q1 Scope.** Bulk batches only (as asked; 0 in production today), or every finance-approved salary change
  request (single path too — this is the whole 116-flag backlog)? Recommend: all approved requests, same helper.
- **Q2 Where to stamp.** On read of the two Finance Audit endpoints (recommended), or only when a finance/admin
  user reads (viewer/HR reads skip the stamp and see pending)?
- **Q3** Do you prefer the protected-file fix instead (salaryComputation.js L1074–1077 insert with
  finance_approved = 1 when matched — owner approval needed)? Recommend no.
- **Q4 Stale guard** — withdraw an auto-approval when the flag no longer matches its request? Recommend yes.
- **Q5** Show "With bulk batch #B · approved by X" (or "With request #N") on the Manual Interventions row? Recommend yes.
- **Q6 Backlog (if Q1 = all).** Stamp historic flags in Mar–Aug too, or only months after a cut-off (e.g. flags
  of Oct 2026 onwards / requests approved after deploy)?
- **Q7** Also annotate Finance Verification's `gross_changed` warning ("approved in request #N")? Recommend later.

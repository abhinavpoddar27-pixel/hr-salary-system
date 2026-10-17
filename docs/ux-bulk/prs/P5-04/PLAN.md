# P5-04: Phase 0 plan (light). Salary revision batch, the first approval kind
Branch `feat/bulk-salary-revision` (worktree `/home/claude/wt-p5-04`), stacked on `feat/bulk-approval-stage` (P5-01). This is a **MONEY PR**: the planner reviews it independently before hand-off.
Spec: MASTER_PLAN §6 P5-04, §7.4 B3.

Rulings that apply:
- Owner, 16 Oct: salary revision is the first approval kind.
- Q6: a second person always decides.
- R3: all-or-nothing.
- R5 + Q2: at most 50 rows per batch, with auto-split.
- R8: never enter the same thing twice.
- R10: flags only change through the statutory upload.

Status: **light Phase 0 (data model, extraction, line ranges, UI placement, questions). A full Phase 0 comes after P5-01 is approved and builder B's salary PR has merged. No code written.**

## 1. Facts
- FACT (code, the single path today):
  1. `PUT /employees/:code/salary` (employees.js L726–880) raises a `salary_change_requests` row through `raiseRequest`. Its `new_structure` holds `{gross_salary, ...splitAmounts(gross, split), basic/hra/da_percent, pt_applicable, pf_wage_ceiling}`. The split comes from `resolveSplit(body, storedSplit(latest structure))`. Those helpers sit at employees.js **L645–724**, which is outside B's 726–880 range.
  2. Finance then runs `PUT /salary-input/approve/:id` (salary-input.js **L209–318**). It is a transaction that does the following:
     - Refuses `STRUCTURE_DATED_LATER`.
     - Runs `resolveApproval` (N-17): a component the request does not name keeps the value in force, which is how conveyance is kept.
     - Updates the row with the same date, or else inserts a new row. The new row carries flags, pt and pf_ceiling from the row in force, and the percents from the request.
     - Syncs `employees.gross_salary`.
     - Sets the request to Approved.

     Helpers used: L7–75 (`isCalendarDate`, `COMPONENT_KEYS`, `resolveApproval`, `requestedPercents`, `istToday`, `sameUser`, `SELF_APPROVAL`).
  3. **No audit_log rows** are written by either step. This is the §3.2 gap.
- FACT (code) Stage 7 reads the structure with `effective_from <= YYYY-MM-01` of the month it computes. A mid-month effective date therefore pays from the next month. A re-run also re-reads `employees.gross_salary` (CLAUDE.md fragile note). `salary_computations` has **no computed-at column**.
- FACT (prod, read-only counts):
  - 2 Pending salary_change_requests right now. The peak was 76–77 on one day (the increment cycle), so 2 batches under the 50 cap.
  - 384 Active employees have a structure, all with employees.gross = the latest structure's gross.
  - 47 latest structures have conveyance > 0, and 37 of those carry conveyance on top of the split.
  - 198 have basic+da+hra+special+other ≠ gross; 163 when conveyance is counted.
  - 231 latest rows are dated on a day other than the 1st.

## 2. Data model (no new table)
- One `bulk_batches` row per ≤ 50 people, kind `salary-revision`, `requiresApproval: true`. `money_total` = Σ Δ monthly gross (P5-01 column).
- `bulk_rows.input_json` = `{code, new_gross | pct, effective_from}`. `resolved_json` (display) = old/new for basic, da, hra, special_allowance, other_allowances, plus kept conveyance, old/new gross, Δ.
- **Nothing is written to salary tables at submit.** A `salary_change_requests` row is created **only at approval**, inside the batch transaction:
  1. INSERT a Pending request (`requested_by` = batch creator, `reason` = "Salary revision — bulk batch #N").
  2. Call the extracted approve function with `approvedBy` = finance user and `effectiveFrom` = the row's date.

  The request therefore never shows in Salary Input's Pending list, so nobody can decide it twice (R8).
- Per-row audit, all inside the transaction:
  - `salary_change_requests.status` Pending→Approved, stage `SALARY_REVISION_APPROVE`.
  - `employees.gross_salary` old→new.
  - Plus the engine summary row `BULK_APPROVE`.
- `after_json` = `{requestId, structureId, sameDateUpdate, structBefore, structAfter, empGrossBefore}`. Undo needs these.

## 3. Logic: extract, don't copy
- **New `services/salarySplit.js`**: moved verbatim from employees.js L645–724: `DEFAULT_SPLIT`, `readSplitNum`, `numOr`, `storedSplit`, `resolveSplit`, `r2`, `splitAmounts`, `splitUnchanged`. In employees.js, L645–724 is replaced by one `require` destructure. No line in 726–880 changes. New `buildRevisionStructure(currentStruct, newGross)` returns the exact object `raiseRequest` builds today (default split when there is no structure). `raiseRequest` could call it in a later PR; I won't touch it now, because it is in B's range.
- **New `services/salaryChange.js`**: moved from salary-input.js L7–75 (the helpers above), plus `approveSalaryChange(db, {id, approvedBy, effectiveFrom})`. This is the body of L209–318 without req/res. It returns `{ok, effectiveFrom, gross, keptComponents}` or `{ok:false, status, code, error, latestDate?}`, and it opens its own `db.transaction`, which becomes a savepoint inside the engine's IMMEDIATE transaction.

  salary-input.js after the change:
  - L7–75 → one require.
  - L209–318 → about 12 lines: the role guard stays as the route middleware, then the call, then the **same** status codes and JSON bodies.
  - `pending-changes` keeps calling the moved `resolveApproval`.

  Parity is proven by `salaryChangeSelfApproval.test.js`, `salaryFlagRevertAndApprove.test.js` and the P1-22 check script, run unmodified.
- The kind `kinds/salaryRevision.js` uses these steps:

  | Step | Logic used |
  |---|---|
  | Split | `storedSplit(latest)` |
  | Gross | `newGross = new_gross` or `round(oldGross × (1 + pct/100))` (rounding: Q-B2) |
  | Preview (old vs new, five components) | `buildRevisionStructure` |
  | Kept conveyance | `resolveApproval(newStructure, structureForDate(effectiveFrom))` |
  | Apply | `approveSalaryChange` |

  No formula is written twice.

## 4. Row checks (planRow)
| Kind of check | Result |
|---|---|
| Errors | Code not found / not plant · not Active · both or neither of new gross and % · gross ≤ 0 · % outside −50…+100 · bad effective date · effective month finalised · `structureDatedAfter` (a later structure exists) · **pending salary_change_request** (conflict, "already waiting for finance (request #id)") |
| Skipped | New gross = old gross ("no change") |
| Warnings | No structure on record (created with the 50/20 default) · change > 25% · conveyance kept on top of the split (the new components + conveyance ≠ gross: today's behaviour, shown in plain words) |
| Merge | A duplicate code is merged |

The fingerprint covers: employee status + gross; latest structure id/updated_at/effective_from; pending request id; finalised flag.

## 5. Undo (R4)
Undo is allowed only while **all** of these hold for every row:
- The request is still Approved, and no later request for that employee is Approved.
- `employees.gross_salary` = the applied gross.
- The structure row equals `structAfter` (whole row), and no later-dated structure exists.
- No month ≥ the effective month is finalised.
- **Stage 7 has not used the period.** Proposal: at approve, store the `salary_computations` gross/net fingerprint for months ≥ effective. Undo is blocked if any row was added or changed since. There is no computed_at column, so this is the reliable signal.

What undo does:
- Deletes the inserted structure row, or restores `structBefore` for a same-date update.
- Restores `employees.gross_salary`.
- Sets the request to `'Reverted'`. That status already exists (N-23).
- Writes audit rows.

## 6. UI
- New `components/bulk/SalaryRevisionBulk.jsx`, an inline panel like ED's:
  1. Effective date (common, overridable per row) and mode (new gross / % increase).
  2. Paste/upload rows: code + value [+ date]. It uses `parseCodes` for codes and accepts xlsx via the existing `xlsx` dependency, parsed client-side.
  3. Check table: old → new Basic/DA/HRA/Special/Other, kept Conveyance, Gross, Δ/month, chips, "leave out rows with problems". Total Δ in lakh via `fmtINR`.
  4. Save bar "Send 76 revisions to finance (2 batches: 50 + 26)".

  `BulkBatchList kind="salary-revision"` sits under it.
- **Mount (proposal):** a "+ Bulk revision" button on the Salary Input page header, hr/admin only. That is about 4 lines in `SalaryInput.jsx`, which builder B owns (see Q-B1).
- Finance: the P5-01 "Bulk batches" tab renders the kind's `reviewColumns`: all five components old→new, gross, Δ and the ₹ total in the confirm dialog.

## 7. Line ranges I need outside my files (for planner + builder B)
| File | Lines | Change |
|---|---|---|
| `backend/src/routes/employees.js` | **645–724** only | Replace with `const {…} = require('../services/salarySplit')`. 726–880 untouched. |
| `backend/src/routes/salary-input.js` | **7–75** | Replace with one require from `services/salaryChange`. |
| `backend/src/routes/salary-input.js` | **209–318** | Handler body becomes a call to `approveSalaryChange`. Same responses. **B is editing this handler**, so I rebase onto B's merged version and extract **after** it lands. |
| `frontend/src/pages/SalaryInput.jsx` | Header area, ~4 lines | Import + button + mount. B owns the file; done after B merges. |

## 8. Tests
- `bulkSalaryRevision.test.js`, using real JWTs and fictional T95xx:
  - Paste parsing.
  - Each error/skip/warn.
  - % and gross modes plus rounding.
  - 51 → `BULK_ROW_LIMIT`; 109 → 3 batches.
  - Submit writes no salary table.
  - Approve by fin1:
    - Structures + gross + request Approved by fin1, requested_by hr1.
    - Audit rows.
    - Flags / pt / pf_ceiling carried (R10).
    - Byte-identical to approving the same request through `PUT /salary-input/approve/:id` on a twin DB.
  - Pending-request conflict at preview and at approval: `BULK_PLAN_CHANGED`, nothing written.
  - Mid-batch throw → nothing written.
  - Self-approval → 403.
  - `STRUCTURE_DATED_LATER` → error row.
  - Undo allowed, then blocked after a Stage 7 run, after a later change, and when the month is finalised.
  - Drift query = 0.
- `salarySplit` / `salaryChange` parity: the existing employees + salary-input suites, unmodified.
- `backend/scripts/bulk-salary-revision-check.py`:
  1. hr pastes 60 rows → 2 batches.
  2. fin1 opens the tab and sees the five components + the ₹ lakh total, then approves.
  3. Stage 7 for the month gives new pay; drift 0.
  4. Edge case: a pending single request → conflict row; undo blocked after Stage 7.
  5. 390 px; `--base`.

## 9. Open questions
- **Q-B1** Mount point: a button on Salary Input (B's file, after B merges), or its own route `/salary-input/bulk-revision` (App.jsx + Sidebar + Guard; the `salary-input` perm already exists)? Recommendation: the button on Salary Input.
- **Q-B2** % mode rounding: round the new gross to the nearest ₹1? Recommendation: yes.
- **Q-B3** Effective date default: the 1st of next month (IST)? A mid-month date pays from the month after (Stage 7 reads the structure at the 1st). Should the screen warn on a non-1st date? Recommendation: default to the 1st and warn otherwise.
- **Q-B4** Conveyance (37 active people carry it on top of the split): keep it (as the single path does). The other choice is to fold it into the new split. Recommendation: keep it, shown as "kept" in the preview.
- **Q-B5** Past effective dates (a month already computed but not finalised): allow them with a warning "re-run Stage 7 for <month>", or refuse? Recommendation: allow with a warning.
- **Q-B6** Stage 7 will then raise a `GROSS_STRUCTURE_CHANGE` manual flag per person. Finance approves again in Finance Audit, which is today's behaviour for single approvals too. Leave it, or auto-mark flags that a batch already approved? Recommendation: leave it this PR and record it as a follow-up. It is an R8 concern.
- **Q-B7** May I make the employees.js L645–724 move (§7)? If not, the fallback is a new `salarySplit.js` plus a parity test pinning the copy in employees.js until B's file is free. That is weaker.
- **Q-B8** While a batch is `submitted`, the single Salary Input / Employee Master path can still raise a request for the same person. That shows up at approval as a conflict, and the whole batch is refused (R3; finance returns it). Accept? Blocking it in the single path needs employees.js 726–880 (B's range).

---
## FINAL DESIGN (16 Oct 2026, after planner rulings Q-B1…Q-B8 — supersedes the open questions above)
- **Moves (Q-B7):** `services/salarySplit.js` ← employees.js `DEFAULT_SPLIT…splitUnchanged` verbatim (+ new `buildRevisionStructure`
  = the object `raiseRequest` builds); employees.js imports them, handler bytes unchanged. `services/salaryChange.js` ← salary-input.js
  helpers (isCalendarDate, COMPONENT_KEYS, resolveApproval, requestedPercents, requestedCeiling, istToday, sameUser, SELF_APPROVAL)
  + `approveSalaryChange(db, {id, actor, approvedBy, effectiveFrom})` = the approve body (incl. N-PF requestedCeiling) returning
  `{ok, effectiveFrom, gross, keptComponents}` or `{ok:false, status, body}` with the SAME JSON; the route is a thin call.
- **Kind `salary-revision`** (requiresApproval; roles default hr/admin create, finance/admin approve). Common `{effective_from, reason}`
  (default 1st of next IST month); rows `{code, new_gross | pct, effective_from?}`. `REVISION_GROSS_ROUND = 1` (Q-B2).
  planRow errors: not found / not Active / both-or-neither / gross ≤ 0 / % outside −50…+100 / bad date / month finalised (Q-B5) /
  later-dated structure / pending salary_change_request (Q-B8). Skipped: same gross. Warnings: no structure (default 50/20), change
  > 25 %, not the 1st (Q-B3), Stage 7 already ran for the month (re-run it, Q-B5), conveyance kept on top (Q-B4).
- **Approve (engine txn):** per row INSERT a Pending request (requested_by = batch creator) then `approveSalaryChange` (approver =
  finance user, effectiveFrom = row date); audit rows stage `SALARY_REVISION_BULK` (request status, employees.gross_salary, structure).
  after_json keeps structAfter, sameDate flag, structBefore, empBefore (gross + updated_at) and a Stage 7 fingerprint (salary_computations
  rows of that employee for months ≥ effective).
- **Undo (finance/admin, reason):** blocked if request not Approved / later request / gross or structure row changed / later-dated
  structure / a month ≥ effective finalised / Stage 7 fingerprint differs. Restores structure (delete or same-date restore, every column)
  + employees.gross_salary/updated_at; request → 'Reverted'; audit.
- **UI:** SalaryInput header button "+ Bulk revision" (hr/admin) → inline `components/bulk/SalaryRevisionBulk.jsx` + `BulkBatchList
  kind="salary-revision" canUndo={finance}`; finance decides in Finance Verification → Bulk batches (reviewColumns: every component).
- Q-B6 GROSS_STRUCTURE_CHANGE flags left as is (follow-up). No schema change.

## Q-EM ruling (owner, 17 Oct 2026 — narrows H1's "open month" definition)
The owner will finalise Feb–Sep 2026 in the app. A month counts as **open** ONLY if it has `salary_computations` (Stage 7)
rows AND is not finalised (no `monthly_imports` row with `is_finalised = 1` for that year/month). Import-only months with no
Stage 7 rows are ignored (production has Apr–May + Jul–Dec 2025 like this; they can never pay anything). No open month →
1st of the current IST month. `firstOpenMonth(db)` is now:
```sql
SELECT s.year, s.month FROM salary_computations s
 WHERE NOT EXISTS (SELECT 1 FROM monthly_imports f WHERE f.year=s.year AND f.month=s.month AND f.is_finalised=1)
 GROUP BY s.year, s.month ORDER BY s.year, s.month LIMIT 1
```
H1a refusal, H1b default, H1d wording unchanged. H1c undo fingerprint (`stage7Rows`) already used exactly this definition
(Stage 7 rows, not finalised) — unchanged. No user-facing copy mentioned imports, so no copy change.
Production (read-only, 17 Oct): returns **Feb 2026** today; after Feb–Sep are finalised it will be Oct 2026.

# N-PF — PF wage ceiling change at the same gross needs finance approval (MONEY)
Branch `fix/pf-ceiling-approval` off origin/main b0ed242. Owner ruling 16 Oct 2026: a ceiling change at the same gross
goes to finance approval like the N-19 split change (PR #151), not a direct write. Phase 0 — no code yet.

## What the code does today (FACT, read in full)
- `backend/src/routes/employees.js` PUT `/:code/salary` (l.743-875): same gross → if `pf_wage_ceiling` was sent and
  differs from the latest row → `UPDATE salary_structures SET pf_wage_ceiling` on the latest row, no audit row
  (l.840-845); then `splitUnchanged` → `structureUnchanged` reply, else `raiseRequest` (N-19). `splitUnchanged`
  ignores the ceiling. No structure on record + default split → a row is created directly with the sent ceiling.
- `raiseRequest` already puts `pf_wage_ceiling: split.pfCeiling` into `new_structure` JSON (every Employee Master
  request since N-19) and the full current row into `old_structure` JSON.
- `backend/src/routes/salary-input.js` PUT `/approve/:id`: insert path carries the in-force row's ceiling
  (`carry('pf_wage_ceiling', 15000)`, l.289) — the request's ceiling is ignored; same-date update path keeps the row's own.
- Finance screen = `frontend/src/pages/SalaryInput.jsx` → Pending tab (`change-table`, l.282-394). It shows components +
  gross only. (FinanceVerification.jsx does not show salary change requests — grep: only SalaryInput.jsx reads
  `/salary-input/pending-changes`.)

## IMPORTANT finding for the planner/owner (FACT)
Plant Stage 7 (`services/salaryComputation.js` l.349, l.572) caps PF with the **policy** value
`policy_config.pf_wage_ceiling` (15000), NOT the per-employee `salary_structures.pf_wage_ceiling`. The per-employee
column is read only by the Finance Audit PF cross-check (`financeAudit.js` l.1943) and the Employee Master window.
Sales uses its own `pf_wage_ceiling_override`. So (INFERENCE) a per-employee ceiling change today moves no pay — it
moves the Finance Audit "expected PF" figure only. The ruling is still worth doing (the column is money-shaped and
someone will wire it into compute), but nobody should expect a pay effect from this PR. Wiring compute to the
per-employee column = salaryComputation.js (protected) → out of scope; listed as Q1.

## Production (read-only counts, 16 Oct 2026)
- salary_structures: 1580 rows, **0** with a ceiling ≠ 15000 (0 employees). Policy ceiling = 15000.
- Ceiling-only changes in the last 90 days: **not countable** — the direct write leaves no audit_log row (0 audit rows
  with a ceiling field, ever). Proxy: 0 rows differ from 15000 now, so no change has stuck.
- salary_change_requests: 301 (291 Approved, 2 Pending, 8 Rejected); 264 carry a `pf_wage_ceiling` key, **0** with a
  value ≠ 15000; 0 same-gross requests. → the approval rule below changes nothing for existing rows.

## Smallest change
No schema change. The ceiling rides in the existing `new_structure` JSON (already there); the "was" value is the
`old_structure` JSON snapshot (also already there).

1. employees.js PUT `/:code/salary`, same-gross branch only:
   - delete the direct UPDATE (l.840-845);
   - `ceilingChanged` = ceiling sent AND differs (±0.01) from the stored one (latest row, or 15000 when no row);
   - `structureUnchanged` only when split unchanged AND NOT ceilingChanged;
   - else one `raiseRequest` (existing builder → one-Pending rule, `already pending` reply unchanged). Reason/message
     by what changed: ceiling only → "PF wage ceiling change via Employee Master (gross unchanged)" /
     "PF wage ceiling change submitted for finance approval. Current ceiling unchanged until approved."; split +
     ceiling → "Salary split and PF wage ceiling change …"; split only → unchanged text.
   - No structure on record: default split + ceiling 15000 → direct create (as today); default split + other ceiling
     → request (same rule as N-19 R2).
   - Gross-change branch: untouched (its request already carries the ceiling → one request for gross + ceiling).
2. salary-input.js PUT `/approve/:id` (only): `requestedCeiling(newStructure, oldStructure)` → the request's
   `pf_wage_ceiling` when present, a number ≥ 0, AND different (±0.01) from `old_structure.pf_wage_ceiling`
   (missing → 15000). Insert path: requested ceiling wins over `carry(...)`. Same-date update path: written when
   requested. Otherwise unchanged (old requests with ceiling = snapshot = 15000 keep carrying the in-force value).
   Self-approval (P1-23/Q6), statutory "dated later" refusal, transaction: all unchanged. Reject handler: no change.
3. SalaryInput.jsx Pending card: one extra row in `change-table` "PF wage ceiling" Current → Proposed (old =
   old_structure value or 15000, new = new_structure value), shown only when it changes, amber like other changed rows,
   `data-component="pf_wage_ceiling"`. Plus the history badge is PR2 (F-2) — different hunk of the same file.

## NOT touched
schema.js, salaryComputation.js, payroll.js, pending-changes/all-changes GETs, request-change POST (Salary Input page
sends no ceiling → carries), pt_applicable (stays direct), api.js, CLAUDE.md, FinanceVerification.jsx.

## Tests — new `backend/src/__tests__/pfCeilingApproval.test.js` (fictional T95xx)
1 ceiling-only at same gross → pendingApproval, structure row unchanged, request new_structure ceiling 21000.
2 second ceiling-only save while pending → "already pending", nothing written. 3 ceiling + split → ONE request.
4 ceiling + gross → ONE request; approval writes gross AND ceiling. 5 approve ceiling-only (other finance user) →
new row today, ceiling 21000, components/percents/flags unchanged. 6 requester (hr/admin) approving own → 403 SELF_APPROVAL,
admin included. 7 reject → ceiling unchanged. 8 untouched save (ceiling same) → structureUnchanged. 9 no structure +
default split + ceiling 15000 → direct create; + 21000 → request. 10 legacy request (ceiling = snapshot) → approval
carries the in-force ceiling (control). 11 same-date update path writes the requested ceiling. 12 negative ceiling → 400.
Existing test that changes ON PURPOSE: `moneyPermissionBatch4.test.js` l.157 "PF wage ceiling (statutory) is still
written directly" — needs your OK (not in my owned files); I would flip it to expect pendingApproval.

## Checks
jest full suite before/after; frontend build; `backend/scripts/pf-ceiling-approval-check.py` (port 3502, built dist,
scratch DB, real logins hr → finance → admin, restart between roles): hr saves ceiling-only → toast "submitted for
finance approval", row unchanged; finance Pending card shows "PF wage ceiling ₹15,000 → ₹21,000"; approve → reopen
window shows 21000; hr approving own refused; edge: ceiling + split → one card with both; 390 px; 0 page errors;
0 unexpected ≥ 400; `--base` on origin/main: ceiling written at once, no card. Drift query (§10.7) on the scratch DB
after a Stage 7 run, and production read-only after deploy (unchanged by construction — compute ignores the column).

## Risks
- R1 HR loses the instant ceiling save (intended). With 0 non-15000 rows today, impact is nil now.
- R2 Approve compares with the request-time snapshot, not the approval-time value; safe because only one Pending
  per employee and the ceiling now changes only through approval (the bulk import INSERT and Stage 7 auto-create write
  15000 on new rows only).
- R3 Builder A may extract from the approve handler later — my diff there is ~6 lines (one helper + two uses).

## Questions
- Q1 Compute ignores the per-employee ceiling (finding above). Leave as is (this PR = governance only), or register a
  follow-up to make Stage 7 use it (salaryComputation.js, protected)?
- Q2 OK to change the one existing test in moneyPermissionBatch4.test.js (l.157)?
- Q3 OK that the PF-ceiling row on the Pending card lives in SalaryInput.jsx (also my PR2 file, different hunk)?
- Q4 Should a ceiling approval also write an audit_log row (stage e.g. FINANCE_PF_CEILING)? The approval itself is
  recorded on the request (approved_by/at); I would not add one unless asked.

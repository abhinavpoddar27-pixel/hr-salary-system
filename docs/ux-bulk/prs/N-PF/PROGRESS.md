# N-PF — PROGRESS (branch fix/pf-ceiling-approval, from origin/main b0ed242)

## RESUME
Read PLAN.md + this file, then `git log --oneline origin/main..HEAD`. State: BUILT, verified, pushed. Nothing left but
planner review. Port 3502. Base build for `--base`: /home/claude/wt-npf-base (detached origin/main, dist built).

## Rulings (planner, 16 Oct 2026)
- Q1 governance only; salaryComputation.js NOT touched (planner registers "Stage 7 ignores per-employee ceiling").
- Q2 moneyPermissionBatch4.test.js "PF wage ceiling (statutory) is still written directly" flipped on purpose →
  now expects a pending request and the stored ceiling unchanged.
- Q3 SalaryInput.jsx shared with F151 (different hunk) — OK.
- Q4 no audit_log row on ceiling approval; the request records it (approved_by / approved_at).
- F151-Q2: F-6 MOVED here — `alreadyPending: true` on the "already pending" reply + Employees.jsx toast reads it.

## Done
0. Phase 0 plan — fea1cb6
1. Code — employees.js PUT /:code/salary, salary-input.js approve, SalaryInput.jsx ceiling row, Employees.jsx toast (F-6)
2. Tests — pfCeilingApproval.test.js (14) + flipped N-19 test
3. Check script — backend/scripts/pf-ceiling-approval-check.py

## What changed (exact)
- **PUT /employees/:code/salary, same gross:** direct `UPDATE salary_structures SET pf_wage_ceiling` removed.
  `ceilingChanged` = resolved ceiling ≠ stored (latest row, else 15000) by > 0.01 (blank / left out = stored).
  Same split + same ceiling → `structureUnchanged` (as before). Ceiling only → request "PF wage ceiling change …";
  split + ceiling → ONE request "Salary split and PF wage ceiling change …"; split only → unchanged text.
  No structure: default 50/20 + ceiling 15000 → direct create (as before); another ceiling → request.
  Gross-change path untouched (its request already carried the ceiling → one request for gross + ceiling).
  "Already pending" reply gains `alreadyPending: true` (message unchanged).
- **PUT /salary-input/approve/:id:** `requestedCeiling(new_structure, old_structure)` = the request's ceiling when it
  is a number ≥ 0 AND differs from the request's own snapshot (missing → 15000), else null. Insert path: requested
  ceiling wins over the carried in-force one; same-date update path: written in place. Self-approval, dated-later
  refusal, transaction, reject handler: unchanged. Older requests (264 in prod, all ceiling = snapshot = 15000) keep
  carrying the in-force value. Exported for the test.
- **SalaryInput.jsx Pending card:** "PF wage ceiling" Current → Proposed row (amber, ▲/▼, `data-component=pf_wage_ceiling`)
  only when the request changes it — same rule as the server (`ceilingChange` helper mirrors `requestedCeiling`).
- **Employees.jsx (F-6):** `alreadyPending` → info toast with the server's message; a new request → success toast with the
  server's message (gross / split / ceiling wording); fallback texts kept.

## Verified
- jest full suite: origin/main 121 suites / 2172 → branch 122 / 2186, all green. New tests on origin/main: 10 of 14 fail
  (the 4 that pass are controls: untouched save, blank ceiling, negative 400, echoed-snapshot carry).
- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PORT=3502 python3 backend/scripts/pf-ceiling-approval-check.py` 38/38 twice
  (built dist, scratch DB, fictional T9501–T9504 "Test Person A–D", real logins hr → finance (1440 + 390 px) → admin + hr,
  server restarted between batches): ceiling-only → request, row unchanged, success toast; second save → info toast
  "already pending", nothing new; split + ceiling → one request; gross only → "Salary change submitted…"; finance card
  ₹15,000 → ₹21,000 amber ▲, gross-only card has no ceiling row; approve in UI → ceiling 21000, gross 20000; admin's own
  request Approve disabled + note; hr window reopens with 21000; 390 px no sideways scroll; 0 page / console errors,
  0 API ≥ 400. `--base` (APP_ROOT=/home/claude/wt-npf-base) 4/4: ceiling written at once, no request, second save says
  "submitted".
- frontend build OK (dist not committed).
- Drift (§10.7) on a scratch DB, Stage 6 + 7 for Sep 2026, fictional T9581 (ceiling 21000) / T9582 (15000) / T9583 (0):
  3 rows, drift 0 for all. (PF was 1,800 / 1,200 / 1,800 — compute uses the policy ceiling 15000, see finding.)

## Not tested
Railway; production data (0 non-15000 ceilings, 0 same-gross requests — no live effect expected); Safari/Firefox.

## Finding (planner registers with the owner)
Plant Stage 7 caps PF with `policy_config.pf_wage_ceiling`, not `salary_structures.pf_wage_ceiling`
(salaryComputation.js l.349/572). The per-employee column moves only the Finance Audit PF cross-check (financeAudit.js
l.1943) and the window. This PR is governance only.

## CLAUDE.md entry
## Last Session — 2026-10-16 (N-PF: PF wage ceiling change at the same gross needs finance approval; F-6)
**Branch `fix/pf-ceiling-approval`, NOT merged. MONEY PR.** Plan + log: `docs/ux-bulk/prs/N-PF/PLAN.md`, `PROGRESS.md`.
Owner ruling 16 Oct 2026; planner rulings Q1–Q4 + F-6 moved here.
- **Before:** `PUT /employees/:code/salary` wrote `salary_structures.pf_wage_ceiling` straight onto the latest row at the
  same gross — no request, no approval, no audit row (prod: 0 rows ≠ 15000, so nothing changed this way yet).
- **Now:** a changed ceiling raises a `salary_change_requests` row like the N-19 split change (one pending per employee,
  P1-23 / Q6 self-approval rule); ceiling + split or ceiling + gross = ONE request. No schema change: the ceiling rides in
  `new_structure` JSON, the old value is the `old_structure` snapshot. `PUT /salary-input/approve/:id` writes the
  requested ceiling only when it differs from that snapshot (`requestedCeiling`), else carries the in-force one as before.
  Salary Input Pending card shows "PF wage ceiling ₹old → ₹new". **F-6:** "already pending" reply carries
  `alreadyPending: true`; Employee Master shows it as an info toast and shows the server's own message for new requests.
- **Fragile:** (1) `ceilingChange` in SalaryInput.jsx mirrors `requestedCeiling` in salary-input.js by hand — change both.
  (2) Approval compares with the request-time snapshot; safe only because the ceiling now changes only through approval
  (bulk import / Stage 7 auto-create write 15000 on NEW rows only). (3) Stage 7 ignores the per-employee ceiling (uses the
  policy value) — this PR is governance only; follow-up registered.
- **Verified:** jest 121/2172 → 122/2186 (new `pfCeilingApproval.test.js` 14, 10 fail on b0ed242; N-19 direct-write test
  flipped on purpose). `backend/scripts/pf-ceiling-approval-check.py` 38/38 ×2, `--base` 4/4. Drift 0 on scratch DB.
- **Not tested:** Railway; production data; Safari/Firefox.

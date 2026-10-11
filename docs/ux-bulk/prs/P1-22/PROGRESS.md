# P1-22 PROGRESS
## RESUME
Branch fix/salary-change-approver-view · worktree /home/claude/wt-p1-22 · port 3122 · read PLAN.md first.
DONE — handed off. Never redo a ticked step.

## Steps
- [x] 0.1 Read PROMPT, SalaryInput.jsx pending card, salary-input.js routes, employees.js writer
- [x] 0.2 PLAN.md written (diagnosis, fix, verify, Q1–Q3, found-not-fixed)
- [x] 0.3 Planner "go" (11 Oct 2026)
- [x] 1 jest baseline: 96 suites / 1537
- [x] 2 Edit SalaryInput.jsx (componentRows + table + effective note + 390px)
- [x] 3 Build dist (flock), own commit
- [x] 4 `backend/scripts/salary-change-approver-view-check.py` 57/57; `--base` on 868f5389 build 9/9
- [x] 5 jest after 96 / 1537; self-debug + user simulation (finance approve in the UI after the view → applied)
- [x] 6 CLAUDE.md entry, push, verify HEAD == origin

## Rulings
- Q1: Proposed gross = stored req.new_gross.
- Q2: missing proposed key → ₹0 highlighted + row note "not in this request — approval sets it to 0".
- Q3: Special allowance row only when non-zero on either side.
- F-a (Employee Master approval zeroes conveyance) logged prominently as a MONEY finding.

## CLAUDE.md entry (moved here 11 Oct 2026 — feature PRs no longer edit CLAUDE.md)
## Last Session — 2026-10-11 (P1-22: salary change approver could not see every component)
**Branch `fix/salary-change-approver-view` (on origin/main 868f5389), NOT merged.** Frontend only (`pages/SalaryInput.jsx`,
Pending Approvals cards). Plan + log: `docs/ux-bulk/prs/P1-22/PLAN.md`, `PROGRESS.md`. Finding F-2. Rulings Q1–Q3 (11 Oct).
- **Bug:** a pending salary change card showed only Basic / DA / HRA + gross, old and new. Conveyance and Other
  allowances never showed, nothing marked what changed, and no effective date — finance approved blind.
- **Fix (display only, no route change):** each card has a Component | Current | Proposed table: Basic, DA, HRA,
  Conveyance, Other allowances always; Special allowance only when non-zero on either side (Q3); Gross = stored
  `old_gross` → `new_gross` (Q1). Proposed = what `PUT /approve/:id` writes (`parseFloat(x) || 0`): a component missing
  from the request shows ₹0, highlighted, with "not in this request — approval sets it to 0" (Q2). Changed rows amber
  + ▲/▼ (`data-changed`). No old structure → "—" + "No current structure on record". Line "Effective from: the day it is
  approved (today, DD Mon YYYY)" — the screen still sends no `effectiveFrom` (by scope). P1-23 self-approval UI
  untouched. dist rebuilt (own commit).
- **MONEY FINDING (F-a, not fixed):** an Employee Master salary request (`PUT /employees/:code/salary`) stores no
  `conveyance` key, so approving it writes conveyance 0 — an employee on conveyance loses it with no one asking for
  that. The card now shows it (₹X → ₹0 + note). Likewise a Salary Input request carries no `special_allowance`, so its
  approval zeroes a non-zero special allowance.
- **Fragile:** `componentRows()` mirrors the approve route's parse rule by hand — change both. The effective line uses
  the browser's date; the server uses the UTC date (F-b).
- **Verified:** `backend/scripts/salary-change-approver-view-check.py` (Chromium, built dist, scratch DB, port 3122, hr
  raises via API incl. Employee Master, fictional T2201–T2207 incl. 3 legacy rows NULL / bad JSON / `{}`) 57/57 — rows,
  changed set, values, notes, effective line, hr view, 390px no sideways scroll, approve still applies, 0 page/console
  errors, 0 API ≥ 400. `--base` on an 868f5389 build 9/9: Conveyance/Other absent, no effective date.
  jest 96 suites / 1537 before and after.
- **Not tested:** Railway; Safari/Firefox; production rows.
- **Found, not fixed:** F-a above (money). F-b `effectiveFrom` default is the UTC date — an approval 00:00–05:30 IST is
  dated the previous day. F-c `POST /request-change` `new_gross` leaves out special_allowance, approve includes it.

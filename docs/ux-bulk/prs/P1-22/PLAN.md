# P1-22 PLAN — Salary change approver can't see all components (Finding F-2)

Base: origin/main 868f5389 · Branch fix/salary-change-approver-view · Port 3122 · Target: `frontend/src/pages/SalaryInput.jsx` only.

## 1. Diagnosis (read, not guessed)
- Pending card (`SalaryInput.jsx` L255–298) prints only `Basic | DA | HRA` for Current and Proposed, plus gross.
  Conveyance and Other allowances are never shown, nothing is highlighted, and there is no effective date.
- Data shape (`routes/salary-input.js` GET /pending-changes L109–127): `old_structure` / `new_structure` are
  JSON-parsed server side; unparseable → `{}`; a stored NULL parses to `null` (UI already does `|| {}`).
  - `old_structure` = the whole latest `salary_structures` row (`SELECT *`) or `{}` when the employee had none.
    Keys: basic, da, hra, conveyance, other_allowances, special_allowance, gross_salary, effective_from, …
  - `new_structure` has TWO writers:
    1. Salary Input "Request change" (`POST /request-change`): exactly the form's 5 keys
       basic/da/hra/conveyance/other_allowances. `new_gross` = sum of the 5.
    2. Employee Master (`PUT /employees/:code/salary`, employees.js ~L665): gross_salary, basic, da, hra,
       **special_allowance**, other_allowances, percents, pt_applicable, pf_wage_ceiling — **no `conveyance` key**.
- Approve (`PUT /approve/:id` L158+): the screen sends NO body, so `effectiveFrom = new Date().toISOString().split('T')[0]`
  = today's **UTC** date. Each component = `parseFloat(new_structure.x) || 0` — a missing key is written as **0**
  (so an Employee-Master request sets conveyance to 0 on approval). Gross written = `new_structure.gross_salary`
  if present, else sum of the 5 + special_allowance.

## 2. Fix (display only — no route change, no effectiveFrom sending)
In the pending card, replace the two one-line summaries with a small old → new table (one row per component):
- Rows: Basic, DA, HRA, Conveyance, Other allowances — always shown. Special allowance row shown only when
  either side is non-zero (Employee Master requests carry it and approval writes it). Then **Gross** (bold).
- Columns: Component | Current | Proposed. Proposed value = what approval writes (`parseFloat(x) || 0`), so a
  missing proposed key reads ₹0 (true to the server), not "—".
- Current value: `old_structure[x]`; if the old structure is empty/missing (no prior structure, legacy row) the cell
  shows "—" and the card shows "No current structure on record".
- Changed (|old − new| > 0.005, missing old counts as 0) → row highlighted (amber background + bold proposed +
  small ▲/▼ arrow), `data-changed="1"` for the check script.
- Gross: Current = `req.old_gross`, Proposed = `req.new_gross` (as stored, unchanged behaviour). Highlighted when
  they differ.
- Effective date line under the table: "Effective from: the day it is approved (today, <DD Mon YYYY>)" — because
  the screen sends no date and the server uses today. `data-testid="effective-note"`.
- Self-approval note / buttons from P1-23 untouched. History tab untouched.
- Phone (390px): table inside `overflow-x-auto`, card layout `flex-wrap` so buttons don't push the table off-screen.
- Pure helper `componentRows(os, ns)` inside the file (module level).

## 3. Verify
- `backend/scripts/salary-change-approver-view-check.py` (Chromium, built dist, scratch DB, port 3122, fictional
  T22xx employees): hr raises via API (a) a components change (conveyance + other changed), (b) gross-only change
  via Employee Master path (if hr can call it on a fictional employee; gross only → proposed comps recalculated),
  (c) an unchanged-component request; plus SQL-seeded legacy rows with NULL / bad JSON / `{}` old structure.
  finance views Pending: all five rows + gross per card, changed rows marked exactly as expected, effective note,
  legacy cards render without crash, 390px no page overflow, 0 page/console errors, 0 API ≥ 400.
- `--base` on a main build: Conveyance/Other rows absent, no effective note.
- jest full suite before/after (frontend-only change → counts identical).

## 4. Questions for the planner
- Q1. Gross "Proposed": show `req.new_gross` (stored, what the card shows today) — or the gross approval will
  actually write (`new_structure.gross_salary` or sum incl. special)? For Salary-Input requests these are equal;
  for Employee Master they are equal too (new_gross = newGross = gross_salary). Proposal: keep `req.new_gross`.
- Q2. Missing proposed key (Employee-Master requests have no `conveyance`): show ₹0 highlighted (what approval
  writes — proposal) or "—"? Proposal: ₹0, because finance must see that approval zeroes conveyance.
- Q3. Special allowance row: show only when non-zero on either side (proposal) or never (strictly "five")?

## 5. Found, not fixed (will log)
- F-a Employee Master request has no `conveyance` key → approval writes conveyance 0 even if it was non-zero.
- F-b `effectiveFrom` default is the UTC date — an approval between 00:00 and 05:30 IST is dated yesterday.
- F-c `POST /request-change` new_gross ignores special_allowance while approve includes it.

# P1-19 PLAN — Sales Mark Left always uses today's date (finding S-3)
Branch `fix/sales-mark-left-date` · base 868f5389 (+ prompt commit 0400cacc) · port 3119

## 1. Diagnosis (read, not guessed)
- `frontend/src/pages/Sales/SalesEmployeeMaster.jsx`
  - L657–665 `markLeftMut`: `markSalesEmployeeLeft(code, company, {})` — empty body, no date ever sent.
  - L810–819: `ConfirmDialog` with text "…with today as DOL", no input (ConfirmDialog takes no children).
- `frontend/src/utils/api.js` L601 `markSalesEmployeeLeft(code, company, data)` already forwards a body — no change.
- `backend/src/routes/sales.js` L1681–1736 `PUT /employees/:code/mark-left?company=X`:
  `const dol = body.dol || new Date().toISOString().split('T')[0]` → **the route already accepts `dol`** (and `reason`).
  `dol` is written to `sales_employees.dol`, passed to `flagSalesBorrowerForExit` (loan final payroll = the sales
  cycle containing `dol`, Loans PR-8 Q4) and into the audit remark. So the bug is frontend-only: nobody sends `dol`.
- Consequence today: every sales leaver gets the click date as DOL; a rep who left last month gets the wrong DOL and,
  if they have a loan, the wrong final payroll cycle.
- List rows come from `SELECT * FROM sales_employees`, so `doj` is on the row for the DOJ check.

## 2. Fix (frontend only, one file)
Replace the Mark Left `ConfirmDialog` with a small local `MarkLeftDialog` (built on the existing `Modal`, same file):
- Required "Leaving date" `<input type="date">`, **default empty**, `max` = today (local date, IST browser),
  `min` = row `doj` when it is a valid YYYY-MM-DD.
- Mark Left button disabled until valid; hint under the field says why:
  empty → "Pick the leaving date"; after today → "Leaving date can't be in the future";
  before DOJ → "Leaving date can't be before the joining date (DD-MM-YYYY)".
  Validation is in JS (not just input min/max — typed dates bypass those).
- Text: "{name} ({code}) will be set to Left with this leaving date. Any open loan is recovered from the
  final salary of that cycle. This cannot be undone here (edit the row to reopen)."
- Mutation sends `{ dol }` (existing body key). Cancel / ✕ / backdrop / Esc → nothing sent, state reset
  (open always starts empty). In-flight: button disabled while `markLeftMut.isPending` (no double submit).
- dist rebuilt in its own commit.
No backend change, no api.js change.

## 3. Verify
- `backend/scripts/sales-mark-left-date-check.py` (Chromium, built dist, scratch DB, real hr login, fictional S9xx
  reps in a fictional company row, port 3119): past date → PUT body `{dol}` and DB `dol` = that date + audit remark;
  empty → disabled + hint; future → disabled + hint; before DOJ → disabled + hint; Cancel/backdrop → 0 PUT, DB unchanged;
  reopen → empty; 390px; 0 page/console errors, 0 API ≥ 400.
- `--base` on an 868f5389 build: no date field, DB dol = today regardless.
- jest full suite before and after (frontend-only change, counts should be equal).

## 4. Questions for the planner
- Q1 Server-side validation: the route accepts any `dol` string (bad format, future, before DOJ) from an API caller.
  Plan: leave the route untouched (Targets = the page only) and list as found-not-fixed. OK?
- Q2 Reason: the route also accepts `reason` (goes into the audit remark). Add an optional "Reason" box to the dialog,
  or keep scope to the date only? Plan: date only.
- Q3 "Today" for `max`: browser local date (IST for users). Backend default uses UTC — irrelevant once the UI always
  sends a date. OK?

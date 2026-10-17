# STAGE-BTN PROGRESS

## RESUME
Branch fix/stage67-button-roles (base origin/main 892f7f73), worktree /home/claude/wt-stage67 (node_modules symlinked from
/home/claude/hr-salary-system), port 3505. Builder E. State: BUILT, checks green, committed + pushed. Waiting for planner review.

## Planner rulings (coordinator GO)
- Q1 shared helper in utils/role.js (`canRunPayroll` = admin / hr / finance).
- Q2 hide the button + one plain line saying who can.
- Q3 F1 F2 F3 F5 F6, incl. the decide buttons in FinanceEarlyExitApprovals.jsx.
- Q4 gate the `/comp-off/pending` badge read to finance/admin.
- Q5 Stage 6/7 buttons only; SalaryComputation.jsx `.salreg` / COLS / pins / computation untouched; payroll.js untouched.
- Collision note: builder C (FRESH-2) edits FinanceAudit.jsx + FinanceEarlyExitApprovals.jsx (onSuccess invalidation + api.js).
  My hunks there are render conditions, props, one import name and the badge query `enabled` only.

## Steps
- [x] P0 worktree, re-grep, prod counts, PLAN.md
- [x] B1 utils/role.js `canRunPayroll`
- [x] B2 DayCalculation.jsx: Run + stale-banner Recalculate only for canRun; else `stage6-run-refused` line
- [x] B3 SalaryComputation.jsx: Compute / Finalise / stale-banner Compute only for canRun; else `stage7-run-refused` line
- [x] B4 FinanceAudit.jsx: Manual Interventions (F1) decide + tick only finance/admin, hr "Awaiting finance";
      Late Coming (F3) bulk bar, boxes, Approve/Reject only canReverse (now via `canFinance`), hr "Awaiting finance";
      Leave Requests (F5) decide only finance/admin; comp-off badge read `enabled: canFinance(user)` (Q4);
      FinanceEarlyExitApprovals (F6) pending table `showActions = canDecide` + plain line for others
- [x] B5 build + new check + --base + regressions + jest
- [x] B6 self-debug (below)

## Verified
- `backend/scripts/stage-buttons-roles-check.py` (Chromium, built dist, scratch DB, fictional T9581–T9584, port 3505): **32/32**.
  viewer (permissions read forced to 500 → app fails open, the only way a refused role reaches the pages): Stage 6 + 7 show the
  refused line, no Run / Compute / Finalise, 0 write POSTs; 390 px line fits. hr: Stage 6 Run present and still works (1 POST,
  200); Finance Audit: no Approve/Reject/Verify/boxes on Interventions, Late Coming, Leave Requests, Early Exit; "Awaiting
  finance" shown; 0 `/comp-off/pending` calls; 0 page errors; 390 px late row reads "Awaiting finance". finance: every button
  present; one late-coming Approve → Submit → 200, DB row approved.
- `--base` on 892f7f73 build: **11/11** (old behaviour reproduced: buttons shown to viewer/hr, comp-off 403 for hr).
- Regressions: `role-gaps-check.py` 36/36 (one assertion updated on purpose: hr makes NO `/comp-off/pending` call, was "gets
  the 403" — ruling Q4 removes that call); `interventions-reject-all-check.py` 56/56; `wide-layout-check.py` 47/47.
- jest (flock): 125 suites / 2230 tests before and after (no backend change).

## Self-debug caught
- Viewer checks read the page before it rendered → wait for the refused line / Run button and `stage7-actions`.
- "0 POSTs" counted the login and session-analytics POSTs → excluded.
- Finance Approve timed out: the remark modal's button is "Submit", not "Approve" → click Approve, wait for the dialog, Submit.
- Viewer's fail-open Stage 6/7 page reads (`/features/salary-stale`, `/finance-audit/leave-requests`) answer 403 —
  pre-existing, printed as a note, not a failure (register item).
- Diff review of FinanceAudit.jsx / FinanceEarlyExitApprovals.jsx: only render conditions, props, the `canFinance` import and
  the badge `enabled`; no import reorder, no reformat, no moved code.

## Not tested
Railway; Safari/Firefox; admin in the browser (same gate as finance); real production data.

## Register (found, not fixed)
- Viewer on fail-open: Stage 6/7 page reads `/features/salary-stale` and `/finance-audit/leave-requests` 403.

## CLAUDE.md entry
## Last Session — 2026-10-17 (STAGE-BTN: Stage 6/7/finalise and finance-only buttons hidden from roles the server refuses)
**Branch `fix/stage67-button-roles`, NOT merged.** Frontend only. Plan + log: `docs/ux-bulk/prs/STAGE-BTN/PLAN.md`, `PROGRESS.md`.
- **Before:** Stage 6 Run / Recalculate and Stage 7 Compute / Finalise showed for every role (server: hr/finance/admin, P3-PG);
  Finance Audit showed Approve/Reject/ticks on Interventions, Late Coming, Leave Requests and Early Exit to hr (server: finance/admin)
  → 403 toasts; the comp-off tab badge called `/comp-off/pending` for every role → hr 403 on each load.
- **Now:** `utils/role.js canRunPayroll`; refused roles see one line ("Only HR, finance or admin can …") instead of the buttons;
  hr sees "Awaiting finance" on Finance Audit rows; FinanceEarlyExitApprovals pending table `showActions = canFinance(user)`;
  comp-off badge read `enabled: canFinance(user)`. Register / `.salreg` / COLS / pins and payroll.js untouched.
- **Fragile:** the UI gates mirror server roles by hand — change both. Stage 6/7 pages are route-guarded (P2-10), so the
  refused line only shows when permissions fail open.
- **Verified:** stage-buttons-roles-check 32/32, `--base` 11/11; role-gaps 36/36 (comp-off assert updated), interventions 56/56,
  wide-layout 47/47; jest 125/2230 before = after. **Not tested:** Railway; Safari/Firefox; admin in the browser.

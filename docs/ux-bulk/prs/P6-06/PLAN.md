# P6-06 — confirmations for destructive actions (findings D-6, H-10)

Branch `feat/destructive-confirms` on origin/main b0ed242 · worktree /home/claude/wt-p6-06 · port 3503 · Phase 0 (plan only).

## 1. The five actions (re-grepped on b0ed242)
| # | Action | File:line | Server route (what it does) | Reversible in the app? | Owner |
|---|---|---|---|---|---|
| A1 | DW contractor **Deactivate** | `pages/DailyWageContractors.jsx` L276 (handler) / L464 (button) | `PUT /daily-wage/contractors/:id/deactivate` (hr/admin) — `is_active=0`; new entries and edits of draft entries for that contractor are refused (`dailyWage.js` L547, L708) | Yes — Reactivate | **mine** |
| A2 | DW **rate approve** | `DailyWageContractors.jsx` L293 / L539 | `PUT /daily-wage/rates/:id/approve` (finance/admin) — sets the contractor's current wage + commission rate at once | No undo (only a new proposal + approval) | **mine** |
| A3 | Employee **document Delete** | `pages/Employees.jsx` L732 (inside `EmployeeProfileModal`) | `DELETE /employees/documents/:id` (hr/admin) — deletes the file from disk + the row | **No — permanent** | **builder B** (Employees.jsx) — NOT touched, see Q1 |
| A4 | Outside-grant **Remove** (leave given outside the system) | `components/leave/LeaveAutomationTab.jsx` L298–304 | `DELETE /features/leave-external-grants/:id` (admin) — soft delete `is_active=0` + audit | No undo in the UI; a re-upload of the same row is still blocked by the soft-deleted row (CLAUDE.md OI-15) | **mine** |
| A5 | **Leave automation** toggle | `LeaveAutomationTab.jsx` L185–191 | `POST /features/leave-automation/settings` (admin) — org-wide; ON = balances recomputed and written whenever attendance/approvals change | Yes — toggle back (but writes made while ON stay) | **mine** |

Owned files: `frontend/src/pages/DailyWageContractors.jsx`, `frontend/src/components/leave/LeaveAutomationTab.jsx`,
`docs/ux-bulk/prs/P6-06/**`, `backend/scripts/destructive-confirms-check.py`.

## 2. Other one-click irreversible actions found on the same pages (NOT fixed without a ruling — Q2)
- E1 `LeaveAutomationTab` L192–198 **"Automatic day calculation"** toggle — org-wide, same one-click pattern as A5 (runs Stage 6 by itself).
- E2 `LeaveAutomationTab` L269–275 **"There is none"** — records that no leave was given outside the system; unblocks writing balances; no undo in the UI.
- E3 `LeaveAutomationTab` L340–346 change-flag **"Clear"** — no undo (route `cleared_at` set, `WHERE cleared_at IS NULL`).
- Already confirmed (no change): DW rate Reject (reason modal), Leave recompute Apply (type `APPLY <year>`), switchover card (type phrase), outside-grant upload Commit (preview step). DW Reactivate is a restore, not destructive.

## 3. Smallest change (frontend only)
Use the P2-01 `components/ui/ConfirmDialog.jsx` directly (not `useConfirm`): it is the only one that takes `busy`, and the
dialog must stay open while the request runs. Pattern per page: one local `confirmState` ({kind, target}) → render
`<ConfirmDialog variant="danger" busy={mut.isPending} …>` while set; Confirm calls `mut.mutate`; `onSuccess` clears it;
`onError` keeps it open (existing error toast). Cancel / Esc / backdrop → clear, nothing sent (ConfirmDialog ignores them while busy).
Focus: Cancel first on danger (P2-01 rule); headless Dialog returns focus to the opener on close.
Copy (plain words, concrete object, design:ux-copy pass in build):
- A1 title "Deactivate {contractor_name}?" — "New daily-wage entries for this contractor will be refused, and draft entries can no longer be edited. You can reactivate later." Button "Deactivate".
- A2 title "Approve the rate change for {name}?" — "Wage {fmtINR2 old} → {new}, commission {old} → {new}, total per worker {old} → {new}. Effective date on the request: {fmtDate}. The new rates apply to every entry saved from now on. This cannot be undone here — a further change needs a new request." Button "Approve rates", variant **warning** (amber, approve is not delete; first focus Confirm per P2-01 — Q3).
- A4 title "Remove this outside-the-system grant?" — "{code} · {type} · {days} day(s) · {Month YYYY} · {how given}. Balances recomputed after this will no longer count it. This cannot be undone here, and the same row cannot be uploaded again." Button "Remove grant".
- A5 ON: "Turn leave automation on?" — "From now on earned and casual leave balances are recalculated and saved for every employee whenever attendance or an approval changes. A finalized month is never changed." OFF: "Turn leave automation off?" — "Balances stop updating until it is turned back on." Button "Turn on" / "Turn off". Checkbox stays at its server value until the save succeeds (it is already controlled by `status`).
Destructive buttons use ConfirmDialog's red danger style. No new component, no api.js / backend change.

## 4. NOT touched
Employees.jsx (A3 — builder B), FinanceVerification.jsx, components/bulk/**, SalaryInput.jsx, ExtraDutyGrants.jsx, ConfirmDialog.jsx,
useConfirm.jsx, api.js, any backend file, CLAUDE.md, schema.js.

## 5. Production (read-only counts, 16 Oct)
dw_contractors 15 (0 inactive) · dw_rate_history pending 1 · employee_documents 0 · leave_external_grants 44 active / 0 removed ·
leave_automation_enabled toggled 5× (all 9 Oct, on → off → on within a minute — the misclick pattern this guards against).

## 6. Tests / checks
`backend/scripts/destructive-confirms-check.py` (Chromium, built dist, scratch DB, fictional "TEST GANG ALPHA" + T95xx, port 3503;
hr for A1, finance for A2, admin for A4/A5; server restart between role batches for the login limiter):
per action — click opens dialog with the concrete text; Cancel, Esc, backdrop → 0 requests + DB unchanged; Confirm → exactly 1
request (double-click too), DB effect, dialog closes, toast; busy: route delayed via page.route → buttons disabled, Esc ignored;
failure (500 forced) → dialog stays, 1 toast; first focus = Cancel; 390 px; 0 page errors, 0 unexpected API ≥ 400.
`--base` on b0ed242: one click sends the request with no dialog (each of A1, A2, A4, A5).
jest full suite before/after (no backend change expected); `npm run build`. Regression: `ui-dialog-confirm-check.py`,
`dw-drafts-visible-check.py`, `ist-today-remaining-check.py` (touches DW Contractors).

## 7. Risks
- Rate approve: the server applies the new rates immediately and ignores `effective_date` (server gap G1); the copy says so plainly.
- Focus return when the opener disappears (Deactivate → row now shows Reactivate): focus falls to body — acceptable, noted.
- Leave tab sits inside LeaveManagement, not inside a Modal — no Modal-in-Modal issue.

## 8. Server gaps found (report only, not fixed)
- G1 `PUT /daily-wage/rates/:id/approve` sets current rates at once; `effective_date` is stored but never applied.
- G2 the same route has no maker-checker (a finance/admin user can approve their own proposal; HR proposes, so low risk).
- G3 `DELETE /employees/documents/:id` hard-deletes the file and writes no audit row.
- G4 `DELETE /leave-external-grants/:id` soft delete still blocks re-upload of the same row (OI-15).

## 9. Questions
- Q1 A3 (document delete) is in Employees.jsx = builder B's file. Hand it to builder B, or let me make that one hunk after B lands?
- Q2 Include E1 (auto day-calc toggle), E2 ("There is none"), E3 (flag Clear)? Recommend E1 + E2 (same file, same pattern, org-wide); E3 skip.
- Q3 Rate approve: amber `warning` (P2-01 rule → first focus on Confirm, like Early Exit Approve) or red `danger` (first focus on Cancel)? Recommend amber, matching P2-01's Approve convention.
- Q4 Rate approve copy states "effective date is not applied separately" (G1) — OK to show that to finance?

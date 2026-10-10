# P1-05 — PLAN (Phase 0)
Base origin/main 18bef07 · Branch `fix/stage6-leave-form-reset` · Finding P-3 · Spec: `PROMPT.md` (this folder)

## What the code does today (read, not changed) — `frontend/src/pages/DayCalculation.jsx`
- L153 `leaveModal` state (`{ code, name, days_absent }` or null); L154 `leaveForm` state
  `{ leave_type: 'CL', date: '', reason: '' }`.
- **Every place the window opens / closes:**
  | # | Where | Line | Effect on `leaveForm` today |
  |---|---|---|---|
  | O1 | "Apply Leave" button in the Absent cell (only open site) | L453 | **none** — opens with whatever was typed last |
  | C1 | `<Modal onClose>` — covers ✕ (Modal.jsx L54), Esc (Modal.jsx L25) and backdrop click (Modal.jsx L45) | L590 | **none** |
  | C2 | Cancel button | L728 | **none** |
  | C3 | `leaveCorrectionMutation.onSuccess` (after submit) | L200–201 | reset (the only reset) |
- So: type a date/type/reason for employee A, close by Cancel / ✕ / Esc / backdrop, open for B → B's window shows
  A's date, leave type and reason, and "Send to finance" / "Apply Leave" is enabled (reason non-empty). One click
  sends a leave for B on A's date with A's reason.
- Not touched: the Withdraw button inside the window (does not close it), the balance query (keyed on
  `leaveModal.code`, already per-employee), the HR→finance request flow, the P1-04 parts (calcMutation + header).

## Change (smallest; `DayCalculation.jsx` only, the open/close handlers)
1. One constant next to the state: `const EMPTY_LEAVE_FORM = { leave_type: 'CL', date: '', reason: '' }`;
   `useState(EMPTY_LEAVE_FORM)` (same initial value as today).
2. Two small functions:
   - `openLeaveModal(row)` → `setLeaveForm(EMPTY_LEAVE_FORM); setLeaveModal({ code, name, days_absent })`.
   - `closeLeaveModal()` → `setLeaveModal(null); setLeaveForm(EMPTY_LEAVE_FORM)`.
3. O1 calls `openLeaveModal(...)` (keeps `e.stopPropagation()`); C1 `onClose={closeLeaveModal}`; C2
   `onClick={closeLeaveModal}`; C3 success path → `closeLeaveModal()` (same behaviour as today, one place).
- Reset on BOTH open and close: close covers every dismiss path, open is the belt-and-braces guard for any future
  open path that skips close. No other state, no backend, no api.js. Then `npm run build --prefix frontend`,
  dist in its own commit.

## Verify
- `backend/scripts/stage6-leave-form-reset-check.py` (pattern `salary-register-report-check.py` / P1-10 script):
  scratch DB, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, built dist, **port 3105**, real **hr** login (hr path =
  "Send to finance" → `leave_applications` row `status='Pending Finance'`), fictional employees T9501 / T9502
  (fictional names), Sep 2026, each with absent days + Stage 6 rows + a leave balance so "Apply Leave" shows.
  - For each dismiss path (Cancel, ✕, Esc, backdrop): open A, set type EL / a date / reason "test A <path>",
    dismiss; open B → type = CL, date empty, reason empty, submit button disabled.
  - Reopen A after a dismiss → also empty (open reset).
  - Submit for B (EL, B's absent date, reason "test B") → exactly one new Pending Finance row, employee B,
    B's date, EL, reason "test B"; no row for A; window closes; reopen B → empty.
  - 390px pass; 0 page errors, 0 console errors, 0 API ≥ 400.
  - `--base` on an origin/main 18bef07 dist (worktree under /tmp, `APP_ROOT`): B's window shows A's values (bug proven).
- jest full suite before (18bef07) and after (branch); expected identical (no backend change).
- Self-debug + user simulation: happy path; edge — HR types, closes, reopens the SAME employee (empty, by design);
  edge — submit fails (400) → window stays open with values kept (unchanged; reset only on success/close).

## Fragile / notes
- A future second "Apply Leave" opener must call `openLeaveModal`, a future close path `closeLeaveModal`.
- Behaviour change worth stating: reopening the same employee after closing no longer keeps a half-typed draft
  (spec: reset on open AND close).

## Questions for the planner
1. Reset also on reopen of the SAME employee (spec reading: yes, always reset on open)? Default: yes.
2. OK to route the success path through `closeLeaveModal()` (identical effect, one reset place)? Default: yes.
3. If a submit is in flight and HR closes the window, a late error toast still shows — leave as is? Default: yes.

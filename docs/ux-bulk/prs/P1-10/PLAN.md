# P1-10 — PLAN (Phase 0)
Base origin/main 3d20021 · Branch `fix/nightshift-undo-relabel` · Finding P-6 · Spec: `PROMPT.md` (this folder)

## What the code does today (read, not changed)
- `frontend/src/pages/NightShift.jsx`
  - L46–49 `rejectMutation` → `rejectNightShift(id)` → `POST /api/attendance/night-shifts/:id/reject`;
    success toast "Pairing rejected — record moved to Miss Punches".
  - L191–196 pending row (not confirmed, not rejected): `✓ Confirm` + `✕`. `✕` = `rejectMutation.mutate(pair.id)`,
    no label, no title, no aria-label, no confirm.
  - L197–199 confirmed row with confidence ≠ high: button labelled **"Undo"** = the SAME `rejectMutation.mutate`.
    It does NOT put the pair back to Pending; it rejects it. (High-confidence confirmed pairs show no button.)
  - Both buttons sit inside a `<tr onClick={() => toggle(pair.id)}>` with no `stopPropagation`, so a click also
    expands/collapses the row's drill-down.
- `backend/src/routes/attendance.js` L249–270 reject route (one click, irreversible from the UI):
  1. `night_shift_pairs`: `is_rejected = 1, is_confirmed = 0`.
  2. IN-day attendance row: `is_night_shift = 0, night_pair_date = NULL, out_time_final = NULL,
     is_miss_punch = 1, miss_punch_type = 'MISSING_OUT', miss_punch_resolved = 0`.
  3. OUT-day attendance row: `is_night_out_only = 0, is_night_shift = 0, night_pair_date = NULL`.
- **Consequence in plain words:** the IN on day D and the OUT on day D+1 are no longer treated as one night shift.
  The IN day loses its OUT time and goes back to Miss Punches as "Missing OUT" (needs fixing again before Stage 6);
  the next-morning OUT stands on its own as a separate day. There is no button to undo a rejection: the row stays
  struck through as "Rejected". (The confirm route sets `is_rejected = 0` but restores none of the attendance
  fields, and the UI never offers it on a rejected row.)

## Change (frontend only, `NightShift.jsx`, nothing else in src)
1. `import ConfirmDialog from '../components/ui/ConfirmDialog'` (existing component, same pattern as
   LeaveManagement.jsx L1030 cancel-leave confirm).
2. New state `const [rejectTarget, setRejectTarget] = useState(null)` (the pair object).
3. Pending-row `✕`: `onClick={(e) => { e.stopPropagation(); setRejectTarget(pair) }}`,
   `aria-label="Reject pairing"`, `title="Reject pairing"`. Visible glyph stays `✕` (spec only adds aria/title).
4. Confirmed-row "Undo" → text **"Reject pairing"**, same onClick as 3, same `aria-label`/`title`.
5. One `ConfirmDialog` rendered when `rejectTarget` is set:
   - title: "Reject this night-shift pairing?"
   - message: `<name> (<code>) — IN <fmtDate(in_date)> <in_time>, OUT <fmtDate(out_date)> <out_time>.
     These two punches will no longer count as one night shift. <in date> goes back to Miss Punches as
     "Missing OUT" and must be fixed again; the <out date> punch stands on its own. This cannot be undone here.`
     (+ for a confirmed pair: "This pair was confirmed earlier.")
   - confirmText "Reject pairing" (→ "Rejecting…" while pending), cancelText "Keep pairing", variant danger.
   - onConfirm → `rejectMutation.mutate(rejectTarget.id, { onSettled: () => setRejectTarget(null) })`;
     onCancel → `setRejectTarget(null)` (nothing sent).
6. `stopPropagation` on the two reject buttons only (so opening the dialog does not also toggle the drill-down).
   `✓ Confirm` untouched (spec: no change to Confirm).
- No backend change, no api.js change, no new component. Then `npm run build --prefix frontend`, dist in its own commit.

## Verify
- `backend/scripts/nightshift-reject-confirm-check.py` (pattern: `salary-register-report-check.py`): scratch DB,
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, built dist, port **3110**, real hr login, fictional employees
  (T96xx codes, fictional names), month Sep 2026: pair A pending/medium, pair B confirmed/medium, pair C confirmed/high
  + the IN/OUT `attendance_processed` rows each pair points at.
  - ✕ on A: aria-label + title = "Reject pairing"; click → dialog visible, names employee + both dates + "Missing OUT";
    Cancel → dialog gone, 0 POST /reject sent, DB A `is_rejected=0`, attendance rows unchanged; click again → Reject →
    DB A `is_rejected=1`, IN row `miss_punch_type='MISSING_OUT'`, status cell "Rejected".
  - B: no "Undo" text anywhere; button "Reject pairing" with aria-label; Cancel → unchanged; Reject → `is_rejected=1`.
  - C (high, confirmed): no reject button (unchanged behaviour).
  - Drill-down not toggled by the reject click; 0 page errors, 0 console errors, 0 API ≥ 400; 390px pass.
  - `--base` on an origin/main 3d20021 dist (worktree under /tmp): "Undo" text present; one click on ✕ sends the
    POST and `is_rejected=1` with no dialog (proves the bug).
- jest full suite before (3d20021) and after (branch) — counts recorded; expected identical (no backend change).
- Self-debug + user simulation (HR rejects a wrong pair, HR changes mind and cancels; edge: double-click Reject while
  pending — button text "Rejecting…", second POST harmless since route is idempotent).

## Fragile / notes
- The dialog message describes the backend reject route; if that route changes (e.g. starts restoring the OUT time),
  the wording must change with it.
- `ConfirmDialog` has no Escape handling and no focus trap (existing component, not changed here).

## Found, not fixed (report only)
- F-a: no way back from a rejection — confirm route sets `is_rejected=0` but restores none of the attendance fields;
  UI hides all actions on rejected rows. A real "un-reject" needs a backend change.
- F-b: the reject IN-row revert sets `out_time_final = NULL` but leaves `actual_hours` and shift metrics as they were.
- F-c: confirm/reject routes have no role guard beyond requireAuth (any logged-in role, incl. viewer, can reject).
- F-d: re-import (`applyPairingToDb`, INSERT OR REPLACE) may re-create a rejected pair as pending — unverified.

## Questions for the planner
1. OK to add `stopPropagation` on the two reject buttons (inside Targets; stops the row drill-down toggling when the
   dialog opens)? Default if no answer: yes.
2. Keep the visible `✕` glyph on the pending row (spec: aria/title only) — or show text "Reject"? Default: keep `✕`.
3. Wording "This cannot be undone here" — OK? (True today: no UI path back.)

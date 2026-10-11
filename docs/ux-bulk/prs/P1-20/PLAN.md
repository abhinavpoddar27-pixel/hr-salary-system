# P1-20 — Plan (Phase 0)
Branch `fix/leave-form-type-and-dates` on origin/main 868f5389 · Finding H-7 (Med) · Target: `frontend/src/pages/LeaveManagement.jsx`, `ApplyLeaveModal` only.

## 1. Diagnosis (read on 868f5389)
- **Comp Off offered:** `LEAVE_TYPES` (L31–36) = CL, EL, LWP, `'Comp Off'`. The Apply Leave select (L141) renders all four.
  `POST /api/leaves` (`routes/leaves.js` L105) accepts exactly `['CL','EL','LWP']` → Comp Off → 400
  "Invalid leave_type. Must be CL or EL. SL is no longer supported." (message also wrong about LWP — server text, not touched).
- **End before start:** `calcDays` (L79–84) returns `Math.max(1, diff)`, so end < start shows **1 day**; the submit
  button (L182) checks only that both dates are filled. The server has no end ≥ start check either, so the row is saved
  as a 1-day leave with a reversed range.
- `LEAVE_TYPES` is ALSO used by the Applications tab type filter (L544). Prod (read-only, counts only): 77 leave rows,
  types CL/EL only, 0 Comp Off, 0 rows with end < start → nothing historic to keep visible in the filter.
- Comp-off has its own tab (`CompOffTab`, own calcDays/form) — not touched.

## 2. Fix (frontend only, one component + one constant)
1. New `APPLY_LEAVE_TYPES = LEAVE_TYPES.filter(t => ['CL','EL','LWP'].includes(t.value))` with a comment pointing at
   `routes/leaves.js` (the accepted list). Apply Leave select uses it. The Applications filter keeps `LEAVE_TYPES`
   unchanged (out of scope; see Q1).
2. `dateRangeInvalid = start_date && end_date && end_date < start_date` (ISO strings compare correctly).
   - Hint under the date row: "End date must be on or after the start date." (red, `data-testid="leave-date-hint"`).
   - Submit disabled while invalid.
   - `handleDateChange` recomputes `days` only for a valid range (`diff` ≥ 1 by construction); on an invalid range
     `days` is left as it was (it cannot be submitted anyway). `calcDays` keeps its `Math.max(1, …)` floor as a safety.
   - End-date input gets `min={form.start_date}` (picker help; typed values still caught by the guard).
3. Balance check, HR remark rule, camelCase body, EmployeeSearchSelect, the manual Days field (half-day 0.5) — unchanged.
4. dist rebuilt in its own commit (`flock /tmp/vite.lock`).

## 3. Verify
- `backend/scripts/leave-form-type-dates-check.py` (Chromium, built dist, scratch DB, real hr login, fictional
  T96xx employees with CL/EL balances, port 3120): type options = exactly CL/EL/LWP (no Comp Off); end < start →
  hint shown + submit disabled + no POST; fix end → hint gone, days = range length; valid CL submit → 1 `Pending`
  row with right dates/days; same-day range = 1 day; LWP submits; 390 px; 0 page/console errors, 0 API ≥ 400.
- `--base` on an 868f5389 build: Comp Off option present and its submit → 400; end < start submits (row saved, days 1).
- jest full suite before/after (`flock /tmp/jest.lock`) — no backend change, counts must match.

## 4. Fragile
- The accepted type list is now written in two places (server L105, `APPLY_LEAVE_TYPES`) — change both.
- The guard is UI-only; an API caller can still send end < start (see found-not-fixed).

## 5. Questions for the planner
- **Q1:** Also drop "Compensatory Off" from the Applications tab type filter (L544)? It can never match a row (0 ever).
  Default: leave it (outside "Apply Leave form only").
- **Q2:** On end < start, keep the Days field at its last value (default) or blank it? Default: keep; submit is blocked anyway.

## 6. Found, not fixed
- F-a `POST /api/leaves` has no end ≥ start check (server out of scope).
- F-b The 400 text says "Must be CL or EL" though LWP is allowed (same as noted in P1-05).
- F-c The Days field is free-editable and not checked against the date range (e.g. 5 days for a 2-day range) — pre-existing.

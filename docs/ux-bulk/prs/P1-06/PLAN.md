# P1-06 — PLAN (Phase 0)
Branch `fix/leave-rejection-reason` · base origin/main 2d96842 (+ 385bd50 PROMPT.md) · Finding H-3.
Status: **Phase 0 ready — waiting for "go". No source file touched.**

## 1. Re-grep (FACT — line numbers drifted from the prompt)
`grep -n -i "reject" frontend/src/pages/LeaveManagement.jsx` · `sed -n 350,382p backend/src/routes/leaves.js`
- Mutation `reject` L427–436: `rejectLeave(id, { rejection_reason: reason, rejected_by: actor })`.
- `utils/api.js` L244: `rejectLeave = (id, data) => api.put(/leaves/${id}/reject, data)` — passes the body through untouched.
- Route `PUT /api/leaves/:id/reject` (leaves.js L356–381): `const { reason } = req.body` → stores `reason || ''` in
  `leave_applications.rejection_reason`; `approved_by` = `req.user.username` (so the client's `rejected_by` is ignored
  anyway). → every rejection from the screen stores `''`. Role gate L14–23: hr/admin + finance (DECISION_PATH).
- Reject modal L673–695: textarea, no validation; Confirm disabled only while pending.
- List rows L573–653: "Reason" column (L597) = the employee's leave reason `l.reason`; status pill L599; Actions
  shows "by {approved_by}" only for Approved; drill-down L640 "Leave Details" grid shows `l.reason`, status, applied.
  The rejection reason is never rendered anywhere.
- List API `GET /api/leaves` (L53) = `SELECT la.*` → `rejection_reason` (schema `leave_applications.rejection_reason
  TEXT`, schema.js L379) and `approved_by` ARE already returned. No backend change needed to display.
- Separate flow, not touched: `rejectLeaveRequest` (api.js L372, finance-audit leave-requests) already sends `reason`.

## 2. Production / Sentry (FACT)
- Planner: 1 rejected leave ever, empty reason. Sentry (org asian-lakto-industries-ltd, "leaves reject", 90 d): 0 issues
  — expected, the bug is silent (200 OK, empty string stored).

## 3. Change (frontend only, `pages/LeaveManagement.jsx`)
1. Mutation body → `{ reason }` (drop `rejection_reason` / `rejected_by`; server takes the actor from the JWT).
   Send `reason.trim()`.
2. Modal: label "Reason for rejection (required)", hint "At least 5 characters — the employee and finance will see it."
   with a live count; Confirm disabled while `reject.isPending || rejectReason.trim().length < 5`; onClick guard repeats
   the check (no Enter-key bypass — it is a textarea, Enter adds a newline).
3. Rejected rows: under the status pill a small red line "by {approved_by}" + truncated reason with full text in `title`
   (mirrors the Approved "by X" pattern); drill-down grid gets `Rejection reason:` (col-span-2, full text) when
   status = Rejected. Old rows with empty reason show "—" (not hidden, so the gap is visible).
- Route unchanged: it already reads `reason`. No server-side minimum is added (prompt: prefer no backend change); the
  5-char rule is a UI rule only — noted as fragile.
- dist rebuilt, own commit.

## 4. Verify
- jest full suite before (main) and after (branch), record suites/tests.
- New `backend/src/__tests__/leaveRejectReason.test.js` (jwtApiHarness, real JWTs, fictional T96xx employee):
  (a) hr `PUT /:id/reject {reason}` → row Rejected, `rejection_reason` = text, approved_by = hr user;
  (b) finance can reject with reason; (c) the OLD body `{rejection_reason}` → stored '' (pins the route contract the
  frontend now matches — documents why the key matters); (d) viewer → 403.
- Browser `backend/scripts/leave-reject-reason-check.py` (pattern salary-register-report-check.py; scratch DB, real hr
  login, built dist, port 3106, PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers): open Pending leave → Reject → 4 chars /
  spaces-only → Confirm disabled; 5+ chars → enabled → submit → row Rejected, reason visible in row + drill-down, DB
  value == typed (trimmed) text; 0 page/console errors, 0 API ≥ 400; 390px. `--base` on a 2d96842 dist (worktree in
  /tmp): Confirm enabled with any text, DB reason ''.
- Self-debug + user simulation (happy path; edge: whitespace-only, reopen modal clears text, finance role).

## 5. NOT touched
Backend routes/services/schema, api.js, finance-audit leave-request flow, every DO-NOT-MODIFY file, other tabs.

## 6. Found, not fixed (report)
- F-a `PUT /:id/reject` returns `success: true` even when nothing changed (row not Pending / unknown id) — no `changes`
  check; also no audit_log row for a rejection.
- F-b Route accepts an empty reason (server has no minimum) — an API caller can still store ''.

## 7. Questions for the planner
1. OK to show the rejection reason in the row (under the status pill) as well as the drill-down, or drill-down only?
2. Server-side minimum (F-b): leave for a later PR as planned?

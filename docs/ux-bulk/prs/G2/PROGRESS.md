# G2 PROGRESS
State: BUILT — handed off for independent review. Stacked on G1 (`fix/dw-rate-effective-date`).
Rulings (17 Oct 2026): G2-Q1 block self-reject too · G2-Q2 Withdraw → register · G2-Q3 "admin cannot propose" →
register · G2-Q4 owner task notes the other finance/admin user decides the admin-raised production request ·
stays stacked on G1.

## Done
- `routes/dailyWage.js`: `sameUser()` (trimmed, case-insensitive; empty/NULL never matches) + `SELF_APPROVAL` body.
  Guard in `PUT /rates/:id/approve` and `/reject` after the 404 and "already decided" 400, before any write →
  403 `{success:false, code:'SELF_APPROVAL', error:'You raised this request — ask another finance or admin user to decide it.'}`.
- `DailyWageContractors.jsx` Rate Approvals: on the user's own request Approve + Reject disabled, tooltip + note
  `data-testid="dw-rate-self-note"` ("You raised this request — another finance or admin user must decide it.").
  `isOwnRequest` mirrors the server's `sameUser` by hand.
- `dwRateMakerChecker.test.js` 9 (real JWTs): own approve / reject 403 with rate_history, contractor, entries and
  audit count unchanged; case/space variant; second admin approves (G1 re-price runs); finance decides hr requests;
  hr still role-403; empty/NULL proposer decidable; 404 and already-decided 400 come first; route-proposed change.
  4 fail on G1 HEAD 7fd7b4af (the self tests), 5 controls pass.
- `backend/scripts/dw-rate-maker-checker-check.py` 28/28 (Chromium, built dist, scratch DB, admin + admin2 created via
  POST /auth/users + finance, port 3504); `--base` on the G1 build 4/4 (admin approves own request).
- Regression on this branch: G1 check 28/28, destructive-confirms 115/115, full jest 127 suites / 2249.

## Register (not built, by ruling)
- Withdraw: the proposer cannot withdraw a pending rate change (G2-Q2).
- Admin can still propose a rate change (no ADMIN_CANNOT_RAISE here) — the second person rule is what protects it (G2-Q3).

## RESUME
Worktree /home/claude/wt-dw-rates2, branch fix/dw-rate-maker-checker on fix/dw-rate-effective-date. Port 3504.
If G1 changes: `git rebase fix/dw-rate-effective-date`, re-run the two check scripts + jest.

## CLAUDE.md entry
**G2 — DW rate change: the requester never decides it.** Branch `fix/dw-rate-maker-checker` (stacked on G1). MONEY.
- `PUT /api/daily-wage/rates/:id/approve` and `/reject` refuse 403 `SELF_APPROVAL` when the deciding user is the
  proposer (trimmed, case-insensitive; admin included; empty proposer stays decidable). Checked after 404 / already-decided,
  before any write. Rate Approvals card: own request → buttons disabled + note `dw-rate-self-note`.
- **Fragile:** compare is on username (renaming a user unlocks their old requests); UI `isOwnRequest` mirrors server
  `sameUser` by hand — change both. No Withdraw; admin can still propose (register).
- **Verified:** dwRateMakerChecker.test.js 9 (4 fail on G1); check script 28/28, `--base` 4/4; jest 127/2249.
- **Not tested:** Railway; production data; Safari/Firefox.
- **Production:** the one pending rate change was proposed by an admin — the OTHER finance/admin user must decide it.

# G2 — DW rate change: the requester can never decide their own request (MONEY)
Branch `fix/dw-rate-maker-checker`, stacked on G1 `fix/dw-rate-effective-date` (37be58c4, on origin/main 892f7f73) ·
worktree /home/claude/wt-dw-rates2 · port 3504 · Builder D. Merge G1 first.
Status: **Phase 0 ready. Waiting for "go". No code written.**

## 1. Facts (re-grepped)
- FACT `routes/dailyWage.js` L160 `POST /contractors/:id/rates` is `requireHrOrAdmin`, stores `proposed_by = req.user.username`.
  L201 `PUT /rates/:id/approve` and L231 `/reject` are `requireFinanceOrAdmin` and never compare the decider with `proposed_by`.
  → **admin passes both guards and can propose AND approve their own rate change.** HR cannot approve (role 403), finance cannot propose.
- FACT the house pattern (P1-23 / P5-01): `salary-input.js` L84 `sameUser = (a,b) => !!a && !!b && trim+lowercase equal`;
  403 `{success:false, code:'SELF_APPROVAL', error:'You raised this request — ask another finance or admin user to decide it.'}`;
  check sits after the 404 / not-pending checks and BEFORE any write; empty requester = nobody blocked. Same copy in
  `financeAudit.js` L1357.
- FACT UI `DailyWageContractors.jsx` `RateApprovals` shows Approve + Reject to every `canFinance` user (L583–590 area).
  `GET /rates/pending` returns `proposed_by`.

## 2. Production (read-only, counts only, 17 Oct)
- Rate changes ever: 1 (pending). Decided by their own proposer: **0** (none decided yet).
- **The pending request was proposed by an admin user.** Users with finance/admin role: 2 → after G2 exactly 1 other user can
  decide it (the proposer cannot). Empty `proposed_by`: 0.

## 3. Smallest change
- `backend/src/routes/dailyWage.js`: local `sameUser` (same one-liner as salary-input.js — no shared helper exists; roles.js
  not touched) + `SELF_APPROVAL` body; one guard line in `PUT /rates/:id/approve` and (Q1) `PUT /rates/:id/reject`, right after
  the pending check, before G1's transaction / the reject UPDATE. Admin included (Q6 house ruling). Nothing else changes.
- `frontend/src/pages/DailyWageContractors.jsx` `RateApprovals`: when `sameUser(user, r.proposed_by)` → Approve/Reject disabled,
  tooltip + line "You raised this request — another finance or admin user must decide it." (`data-testid="dw-rate-self-note"`).
  Mirrors the server by hand (server is the gate), same as SalaryInput P1-23.

## 4. NOT touched
G1's pricing logic, roles.js, salary-input.js, schema.js, any other route, CLAUDE.md.

## 5. Tests / verification
- New `backend/src/__tests__/dwRateMakerChecker.test.js` (real router + real requireAuth/JWT): admin proposes → same admin
  approve 403 SELF_APPROVAL and reject 403 (Q1), nothing written (`dw_rate_history`, `dw_contractors`, `dw_entries`, `dw_audit_log`
  byte-identical); case/space variant (" Admin ") still 403; second admin approves 200; finance approves an hr proposal 200;
  hr approve still role-403; empty `proposed_by` decidable; 404 before the self check; already-decided 400 before the self check.
  Self tests must fail on G1 HEAD.
- `backend/scripts/dw-rate-maker-checker-check.py` (Chromium, built dist, scratch DB, admin + admin2 + finance logins, port 3504):
  own card buttons disabled + note, forced click sends nothing, API probe 403, other admin approves, 390 px, 0 page errors.
  `--base` on G1 HEAD: admin approves own request.
- Full jest under flock; frontend build; G1 check script re-run.

## 6. Risks
- Username compare (no user id on the row): renaming a user unlocks their old requests — same as P1-23.
- If only one finance/admin user exists, an admin-raised change can never be decided — prod has 2, so OK; HR should raise
  rate changes (the normal path).

## 7. Questions
- **G2-Q1** Block self-REJECT too (P1-23 blocks both)? *Recommended: yes — same rule both ways.*
- **G2-Q2** Add a "Withdraw" for the requester (a self-reject alternative)? *Recommended: no, out of scope; register it.*
- **G2-Q3** Should admin be barred from PROPOSING rate changes (HR raises, finance/admin decide — like Loans ADMIN_CANNOT_RAISE)?
  *Recommended: no — not asked; the self check is enough. Register it.*
- **G2-Q4** The pending production request was raised by an admin: fine for the other finance/admin user to decide it after
  deploy? *Recommended: yes; owner tells that user.*

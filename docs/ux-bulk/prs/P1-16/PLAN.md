# P1-16 — PLAN (Phase 0)
Branch `fix/interventions-reject-all-confirm` · base origin/main 868f5389 · Finding F-10 (Med).
Status: **Phase 0 ready — waiting for "go". No code written.**

## 1. What the code does today (FACT, `frontend/src/pages/FinanceAudit.jsx`, `ManualInterventionsTab` L684–861)
- L781–787: when `selected.size > 0` two buttons appear. **Reject All** (L785) calls
  `bulkMut.mutate({ flagIds: [...selected], status: 'REJECTED' })` straight away — no confirm, no reason. Approve All (L784) same.
- L728–729: `approvableFiltered = filtered.filter(f => !isLive(f))` — live punch/day corrections (`pc-`/`dc-` ids) cannot be selected.
- L737–740 `selectAll`: compares `selected.size === approvableFiltered.length` and selects `approvableFiltered`.
- L795 header checkbox: `checked={selected.size === filtered.length && filtered.length > 0}` — compares against `filtered`
  (which INCLUDES live rows). With any live row on screen the box can never show checked even when every selectable row
  is ticked; and the toggle logic (L739) uses a different array from the checked state. No indeterminate state.
- `selected` is never cleared when the type/status filter or the month/company changes → ids ticked under one filter stay
  in the set while hidden; "N selected" and Reject All then act on rows the user cannot see.
- `approvableFiltered` includes rows of EVERY status (pending / approved / rejected) → the header box also ticks
  already-approved rows, and Reject All flips them to rejected (single-row buttons exist only on pending rows, L837).
- Single-row Reject (L716–723 + comment modal L846–855) already asks for comments but does not require them (out of scope).

## 2. Server (FACT, `backend/src/routes/financeAudit.js`)
- `PUT /api/finance-audit/bulk-approve` (L1416–1440) reads `{ flagIds, status, comments }` → writes
  `salary_manual_flags.finance_approved/approved_by/approved_at` and one `finance_approvals` row per id with
  `comments || ''`. **So the reason key is `comments`** — no server change needed for the reason.
- Router is behind `requireAuth` only (server.js L212); bulk-approve and approve-flag have no finance/admin guard
  (pre-existing; P2-11 class).
- **Important divergence:** the single `PUT /approve-flag/:id` (L1341–1409), on REJECTED + `GROSS_STRUCTURE_CHANGE`, archives
  to `finance_rejections` and REVERTS `employees.gross_salary` + `salary_structures` to the old gross, and writes `audit_log`.
  The bulk route does **none** of that (no revert, no audit_log). Today, bulk-rejecting a gross-change flag marks it
  rejected while the new gross stays in force and is paid by Stage 7. See Q1.

## 3. Change (frontend only, Interventions tab only)
1. **Selectable set** = `filtered` rows that are not live AND pending (`finance_approved === 0`) → `selectable`.
   Per-row checkbox shown only on selectable rows (others show "—" like live rows). (Q2)
2. **Header checkbox** computed from exactly `selectable`: `checked = selectable.length > 0 && every selectable id is selected`;
   `indeterminate` (via ref) when some but not all; click toggles all-of-`selectable` on/off; disabled when `selectable` is empty.
3. **Selection hygiene:** clear `selected` when filterType / filterStatus / month / year / company changes; bulk buttons act on
   `selected ∩ selectable` only (belt and braces).
4. **Reject All** opens a Modal: "Reject N flag(s)?" + list summary (count by flag type), a required reason textarea
   (trimmed ≥ 5 chars, live counter, Confirm disabled until valid), "Cancel" sends nothing. Confirm →
   `bulkMut.mutate({ flagIds, status: 'REJECTED', comments: reason.trim() })`. Modal closes + reason resets on success,
   on Cancel/✕/Esc/backdrop; a failed request keeps the window and shows the error toast (bulkMut gets `onError`).
   Double-click guard: Confirm disabled while `bulkMut.isPending`.
5. Approve All unchanged (Q3).
6. Rebuild dist in its own commit.

## 4. Questions for the planner
- **Q1 (money):** bulk reject of a `GROSS_STRUCTURE_CHANGE` flag skips the revert the single route does. Options:
  (a) **recommended for this PR** — frontend: if the Reject All selection contains any GROSS_STRUCTURE_CHANGE rows, the modal
  lists them and leaves them OUT of the bulk call ("reject these one by one — rejecting reverts the gross"), with a count line;
  log the server gap as a finding. (b) server change: make bulk-approve run the same revert per flag (shares code with
  approve-flag) — larger, touches money path. (c) leave as is (just note it). I recommend (a).
- **Q2:** restrict selection to PENDING rows (my plan) — or keep allowing approved/rejected rows to be re-decided in bulk?
  Today it allows it; single-row buttons don't.
- **Q3:** add the same confirm (no reason) to Approve All? Prompt scope is Reject All only; I will leave Approve All as is unless told.

## 5. Verify
- `backend/scripts/interventions-reject-all-check.py` (Chromium, built dist, scratch DB, real finance login, port 3116,
  fictional T96xx rows of MANUAL_TDS / SALARY_HELD / MANUAL_OTHER_DEDUCTION [+ GROSS_STRUCTURE_CHANGE per Q1] + one live
  punch correction): header box states (none / some → indeterminate / all → checked) on All, Pending, and a type filter;
  live and non-pending rows not selectable; filter change clears selection; Reject All → modal names count; 4 chars →
  Confirm disabled; Cancel → 0 PUTs, DB unchanged; valid reason → 1 PUT body `comments` = trimmed reason, DB
  `finance_approved = -1` and `finance_approvals.comments` = reason for exactly the ticked rows, others untouched;
  390 px; 0 page/console errors, 0 API ≥ 400.
- `--base` on an 868f5389 worktree build: one click rejects, `finance_approvals.comments = ''`; header box unchecked with all ticked.
- jest full suite before/after (flock).

## 6. NOT touched
Backend (unless Q1 = b), every other tab, Approve All (unless Q3), single-row approve/reject modal, all DO-NOT-MODIFY files.

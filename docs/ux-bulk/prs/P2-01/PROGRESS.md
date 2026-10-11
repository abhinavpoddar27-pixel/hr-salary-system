# P2-01 PROGRESS

## RESUME
Branch feat/ui-dialog-confirm (base 80934af4), worktree /home/claude/wt-p2-01, port 3201. Read PROMPT.md + PLAN.md.
Phase 0 approved (go 11 Oct). BUILD DONE — merged origin/main, pushed. Only open item: 2 existing test scripts (below).

## Steps
- [x] P0.1 Read Modal / ConfirmDialog / callers / 7 pages; headlessui 1.7.19 installed
- [x] P0.2 jest baseline: 105 suites / 1649 tests pass
- [x] P0.3 PLAN.md written (8 native calls found, PayableOT has none)
- [x] B1 Modal.jsx on headless Dialog
- [x] B2 ConfirmDialog.jsx on headless Dialog
- [x] B3 hooks/useConfirm.jsx
- [x] B4 migrate Settings, LeaveManagement, GatePasses, FinanceEarlyExitApprovals, Reports, SqlConsole
- [x] B5 local build + check script 111/111 (×2) + harness 19/19; --base 3/3
- [x] B6 regression: nightshift 44/44, stage6 leave reset 53/53, leave reject 29/29, sales NEFT 40/40; gate-pass-quota FAILS at L192 (accepts a native confirm — script not owned); jest 105/1649 before = after
- [x] B7 merged origin/main (clean); after merge: jest 107/1669, check 111/111, harness 19/19

## Owner / planner rulings
Planner "go" (11 Oct): Q1 the 8 calls in 6 files (AttendanceReviewTab out). Q2 focus Cancel on destructive (red/danger)
confirms, Confirm on non-destructive ones. Q3 variants/titles as listed. Q4 ship busy, unit-level/harness check only.
Q5 keep SqlConsole flow exactly. Keep SAME props + outer classes (P2-ED builder relies on them).

## CLAUDE.md entry
## Last Session — 2026-10-11 (P2-01: Modal + ConfirmDialog on headlessui Dialog; useConfirm; 8 native dialogs migrated)
**Branch `feat/ui-dialog-confirm`, NOT merged.** Frontend only. Plan + log: `docs/ux-bulk/prs/P2-01/PLAN.md`, `PROGRESS.md`. Finding X-10.
- **What:** `components/ui/Modal.jsx` and `ConfirmDialog.jsx` rebuilt on `@headlessui/react` Dialog (already a dependency),
  SAME props and outer classes (`fixed inset-0 z-50 …`, `h3` title) — every caller unchanged. Focus trap (Tab/Shift-Tab),
  Esc + outside click close, scroll lock, focus back to the opener, `role="dialog"`. New optional props: Modal `busy`;
  ConfirmDialog `busy`, `children`, `showCancel`, `initialFocus`. Modal opens with focus on the panel (never on ✕);
  ConfirmDialog focuses Cancel on `danger`, Confirm otherwise (planner Q2). Esc now cancels a ConfirmDialog (was a no-op).
- **New `hooks/useConfirm.jsx`:** `confirmDialog` / `promptDialog` / `alertDialog` (promises) + `useConfirm()`. Self-mounting
  (`#hr-dialog-root`, own React root) — no provider, App.jsx/main.jsx untouched. One dialog at a time (queue); a dialog
  ignores answers in its first 300 ms and answers once (a double click cannot answer the next dialog).
- **Migrated (dialog calls only, same action + arguments):** Settings holiday Remove, Leave comp-off Cancel, GatePasses
  Cancel, FinanceEarlyExitApprovals Approve (amber), Reports ECR/ESI "download without them", SqlConsole restore prompt +
  2 alerts (flow unchanged, Q5). PayableOT had none (8 calls, not 10). AttendanceReviewTab left alone.
- **Fragile:** (1) Dialogs render in a portal at the end of <body>; the page behind is inert while open. (2) A click
  anywhere outside the panel (a toast too) closes a Modal. (3) Never raise a useConfirm dialog from INSIDE an open Modal
  (separate root → the Modal sees it as an outside click and closes). (4) Busy is shipped but no page passes it yet.
- **Verified:** `backend/scripts/ui-dialog-confirm-check.py` (Chromium, built dist, scratch DB, admin/hr/finance, T96xx,
  port 3201) 111/111 ×2 — each migrated dialog: text, first focus, Tab/Shift-Tab inside, Esc/Cancel/backdrop = 0
  requests, OK = 1 request with the same body + DB effect, no native dialog; 6 Modal callers (Apply Leave, Create Gate
  Pass, Reject Early Exit, Employee Profile, Request loan, Sales New employee) ✕/Esc/backdrop + Tab trap + focus return;
  390 px. `--base` on 80934af4 3/3 (native confirm fires; Tab leaves the old Modal). Harness
  `backend/scripts/ui-dialog-busy-harness-check.py` (frontend/test-harness, own vite config) 19/19: busy, focus per
  variant, queue, double click. Regression: nightshift 44/44, stage6 leave reset 53/53, leave reject 29/29, sales NEFT
  40/40. jest 105/1649 before = after; after merging main 107/1669.
- **Not tested:** Railway; Safari/Firefox; screen reader.
- **Broken by design, not fixed (not my files):** `backend/scripts/gate-pass-quota-browser-check.py` L192 and
  `docs/statutory-flags/sim/run_pr3.py` L261/264 wait for a NATIVE confirm — they must click the new dialog instead.
- **Found, not fixed:** SQL Console write txns (preview/restore, 60 s TTL) run on the app's SHARED DB connection — any
  app write made while a preview is open is rolled back with it (seen: an early-exit approve answered 200 and vanished).

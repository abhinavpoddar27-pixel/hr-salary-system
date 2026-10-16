# P6-06 PROGRESS

## RESUME
Branch feat/destructive-confirms (base b0ed242), worktree /home/claude/wt-p6-06, port 3503. Read PLAN.md + this file.
State: BUILD DONE, verified, pushed. Nothing open on this branch.

## Planner rulings (16 Oct 2026)
- Q1: A3 (document delete) done here. ONLY the document-delete lines of Employees.jsx touched (import, the delete mutation
  block, the Delete button, the confirm under the documents table). Builder B edits the salary-save toast lines in the same file;
  planner merge-checks both.
- Q2: E1 (Automatic day calculation toggle) + E2 ("There is none") included. E3 (flag Clear) skipped.
- Q3: rate approve amber (`warning`; first focus on Confirm per P2-01).
- Q4: copy says "New rates apply from today. The effective date on the request (DD-Mon-YYYY) is recorded but not used yet."
- G1–G4 (server gaps) registered by the planner, not fixed here.

## Steps
- [x] B1 DailyWageContractors: A1 Deactivate (danger) + A2 rate Approve (amber, old→new wage/commission/total in ₹)
- [x] B2 LeaveAutomationTab: A4 grant Remove, A5 Leave automation on/off, E1 Automatic day calculation on/off, E2 "There is none"
- [x] B3 Employees.jsx: A3 document Delete (ConfirmDialog inside the profile Modal — Esc closes only the confirm)
- [x] B4 build + destructive-confirms-check.py 115/115 ×2 (v1 + v2); --base on b0ed242 4/4
- [x] B5 jest 121/2172 before = after; regression ui-dialog-confirm 111/111, dw-drafts-visible 37/37, ist-today-remaining 24/24
- [x] B6 self-review v2: E2 title no longer names the year (the flag is not per year); re-ran everything; push

## CLAUDE.md entry
## Last Session — 2026-10-16 (P6-06: destructive actions ask first — DW deactivate / rate approve, document delete, leave automation)
**Branch `feat/destructive-confirms`, NOT merged.** Frontend only. Plan + log: `docs/ux-bulk/prs/P6-06/PLAN.md`, `PROGRESS.md`.
Findings D-6, H-10. Rulings Q1–Q4 (16 Oct): A3 done here (document-delete lines only); E1 + E2 in, E3 out; rate approve amber;
plain "effective date not used yet" line. Prod (counts): 15 contractors (0 inactive), 1 pending rate change, 0 documents,
44 active outside grants; leave automation switched on/off/on 5× within a minute on 9 Oct.
- **Before:** one click, no question: DW contractor Deactivate, DW rate Approve (new rates live at once), employee document
  Delete (file removed from disk, no audit row), outside-the-system grant Remove (soft delete; the row can't be uploaded again),
  Leave automation and Automatic day calculation switches (org-wide), "There is none" (unblocks writing balances).
- **Now:** each opens the P2-01 `ConfirmDialog` naming the object (contractor; old → new wage / commission / total per worker
  in ₹ + effective date; file + type + employee; code · type · days · month · how given) and saying what happens, with
  "cannot be undone here" where true. `busy` while the request runs (buttons disabled, Esc/backdrop ignored); closes on success;
  stays open on failure with the existing toast; Cancel/Esc/backdrop send nothing; a `useRef` in-flight guard keeps a double
  click to one request. Danger = red + first focus Cancel; rate approve amber + first focus Confirm. The switch checkbox stays at
  the server value until the save succeeds. testids `confirm-deactivate`, `confirm-approve-rate`, `confirm-delete-doc`,
  `leave-auto-confirm`.
- **Fragile:** (1) the document confirm sits INSIDE the profile Modal (one headless Dialog nested in another) — it is a
  ConfirmDialog, not a useConfirm dialog (that one must never open inside a Modal, P2-01 note). (2) The rate-approve text says
  the effective date is not used — true until G1 is fixed; change the text with it. (3) Copy mirrors the server routes
  (deactivate refuses new entries + draft edits; grant remove blocks re-upload) — change both together.
- **Verified:** `backend/scripts/destructive-confirms-check.py` (Chromium, built dist, scratch DB, hr / finance / admin with a
  server restart per role, fictional TEST GANG ALPHA/BETA + T9501, port 3503) 115/115 twice — per action: dialog text, first
  focus, Cancel / Esc / backdrop = 0 requests + DB unchanged, busy (held request) = all buttons disabled + Esc ignored, forced
  500 = dialog stays + one toast, double-click Confirm = 1 request + DB effect, profile window stays open around A3, 390 px,
  0 page errors, 0 API ≥ 400. `--base` on b0ed242 4/4: one click sends with no dialog (deactivate, document delete, rate
  approve, automation switch). jest 121/2172 before = after. Regression: ui-dialog-confirm 111/111, dw-drafts-visible 37/37,
  ist-today-remaining 24/24.
- **Not tested:** Railway; Safari/Firefox; screen reader.
- **Found, not fixed (planner register G1–G4):** G1 rate approve applies the rates at once and never uses `effective_date`;
  G2 rate approve has no maker-checker; G3 document delete is a hard delete with no audit row; G4 a removed outside grant still
  blocks re-uploading the same row (OI-15). E3 change-flag "Clear" still one click (ruling: skip).

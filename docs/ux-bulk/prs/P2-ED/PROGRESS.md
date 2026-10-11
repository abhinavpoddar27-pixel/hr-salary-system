# P2-ED — PROGRESS

## RESUME
Branch feat/ed-shared-components (base 80934af4, origin/main fa430144 merged in), worktree /home/claude/wt-p2-ed,
port 3204. State: DONE — pushed, waiting for planner/PR. Do not redo ticked steps.

## Steps
- [x] Phase 0: read code, baseline (ED checks 25/25 + 16/16 on origin/main; jest 105 / 1649), PLAN.md
- [x] Planner "go" + rulings
- [x] Button / IconButton / statusMap / StatusBadge
- [x] ScrollTable
- [x] ReviewQueue
- [x] ED page adoption
- [x] Test-only harness `frontend/ui-harness/` + `backend/scripts/ui-components-check.py` 64/64; `--base` 4/5 (header scrolls away on main)
- [x] Merge origin/main (fa430144, no conflict on owned files); after merge: ED checks 25/25 + 16/16, component check 64/64,
      jest 107 / 1669 (one run showed 1 failure in a suite outside this PR, not reproduced on the next full run)
- [x] Push + verify

## Owner / planner rulings
- 11 Oct planner "go": Q1 keep raw uppercase ED labels. Q2 scroll window OK (70vh). Q3 ReviewQueue owns the reason modal;
  single-row return via api.openAction. Q4 (b) separate Vite test page built only by the check script. Q5 use current
  Modal/ConfirmDialog via existing props.

## CLAUDE.md entry
## Last Session — 2026-10-11 (P2-04/05/06: Button, IconButton, StatusBadge, ScrollTable, ReviewQueue; Extra Duty page adopts them)
**Branch `feat/ed-shared-components`, NOT merged.** Frontend only. Plan + log: `docs/ux-bulk/prs/P2-ED/PLAN.md`, `PROGRESS.md`.
- **New:** `components/ui/Button.jsx` (primary/secondary/ghost/danger/success/warning + `link` with `tone` for small row
  actions; `size`; `busy` + `busyLabel` → disabled + aria-busy; type=button default), `IconButton.jsx` (`label` required →
  aria-label + title; missing → "?" + console.error), `utils/statusMap.js` (one map: ed_hr, ed_finance, miss_punch, leave,
  salary_change, loan, loan_instalment, dw, bulk_batch — labels copied from the screens that show them; only ED adopts),
  `StatusBadge.jsx` (`xs` = the old ED pill), `ScrollTable.jsx` (own overflow-auto + max-h window, border-separate, every
  `th` sticky + opaque; sortable headers are buttons with aria-sort; opt-in chevron expand button + detail row),
  `components/bulk/ReviewQueue.jsx` (extracted from the ED finance tab, #79 behaviour: chips with counts, client order,
  header box = rows eligible for any action, on "all" only `allFilterActions`; selection clears on filter change / success;
  fixed bar; reason modal; optional `confirmText(n,total)` via ConfirmDialog; optional `moneyOf` ₹ total).
- **ED page:** one `columns` list; all three tabs render `<ReviewQueue key={activeTab}>` (HR/All: `filters=null`, not
  selectable, server order). Single-row "↩ Return to HR" opens the queue's reason modal via `api.openAction`. Pills via
  StatusBadge (raw upper-case labels kept, ruling Q1). Visible change by ruling Q2: the list scrolls in a 70vh window and
  its header sticks. Mutations/toasts unchanged.
- **Fragile:** the ED check scripts depend on `data-testid` fin-filters/select-all/bulk-bar, `data-filter`, `tr[data-fin]`
  (page passes it via `rowProps`), and button names. Flagged/rejected row tint comes from the page's `rowProps` (all tabs).
  The flag modal button still uses `btn-warning`, a class index.css does not define (pre-existing; left as is for zero
  change; `<Button variant="warning">` is styled). ScrollTable expand rows add a `<tr>` — tables counted by `tbody tr`
  must not turn expand on.
- **Verified:** ED checks unchanged 25/25 + 16/16 (before and after); new `backend/scripts/ui-components-check.py`
  64/64 (Part A: test-only harness `frontend/ui-harness/` built into a scratch dir — every variant, busy, IconButton rule,
  48 badges, sticky header, keyboard sort Enter/Space, keyboard chevron, ReviewQueue chips/order/selection/bar total/
  confirm/reason/Esc/Clear, 390 px; Part B: real ED page — header in view after scrolling, pill text, Space on header box,
  All Grants tab return modal, 390 px, 0 errors); `--base` on 80934af4: header scrolls away (th top −4142). jest 105/1649 →
  107/1669 after merging main.
- **Not tested:** Railway; Safari/Firefox (sticky th in a border-separate table); real production data.
- **Found, not fixed:** `btn-warning` undefined in index.css → ED "Flag for Review" submit button renders unstyled.

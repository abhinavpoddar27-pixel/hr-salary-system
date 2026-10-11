# P2-01 — PLAN (Phase 0)

Base origin/main 80934af4 · branch feat/ui-dialog-confirm · port 3201 · finding X-10.

## 1. What is there today (read, not changed)
- `@headlessui/react` 1.7.19 is installed (frontend/package.json `^1.7.18`) but imported nowhere yet. No new dependency.
- `components/ui/Modal.jsx`: props `open=true, onClose, title, children, size`; own Esc listener on `document`; backdrop
  click closes; body scroll lock; no focus trap; no busy. Exports `ModalBody`, `ModalFooter`. 23 files import it.
  Prop audit over every `<Modal`: only `open`, `onClose`, `title`, `size` — plus `show=` on 5 callers, which Modal
  IGNORES today (all 5 are already wrapped in a conditional or `if (!show) return null`, so they work by mounting).
- `components/ui/ConfirmDialog.jsx`: props `title, message, confirmText, cancelText, onConfirm, onCancel, variant`;
  always mounted by its caller when shown (no `open` prop); backdrop click = onCancel; NO Esc; no focus trap; no busy.
  7 callers (LoanImport, SalesHolidayMaster, SalesSalaryCompute ×2, SalesTaDaApprovals, NightShift,
  SalaryComputation, LeaveManagement). All messages are strings.
- Existing browser checks find dialogs by `div.fixed.inset-0(.z-50)` + an `h3` title (nightshift-reject-confirm,
  stage6-leave-form-reset, gate-pass-quota, sales-neft-confirm, …). The rebuild keeps that outer class and the `h3`.

## 2. Native dialog calls in scope — 8 found, not 10
| File | Line | Call | Action after OK (unchanged) |
|---|---|---|---|
| pages/Settings.jsx | 273 | `window.confirm('Remove this holiday?')` | `deleteMutation.mutate(h.id)` |
| pages/LeaveManagement.jsx | 1458 | `window.confirm('Cancel this pending comp-off request?')` | `deleteMutation.mutate(r.id)` |
| components/GatePasses.jsx | 149 | `confirm('Cancel this gate pass?')` | `cancelMut.mutate({id, reason:'Cancelled by HR'})` |
| components/FinanceEarlyExitApprovals.jsx | 128 | `confirm('Approve this deduction?')` | `approveMut.mutate(r.id)` |
| pages/Reports.jsx | 303 | `window.confirm(<multi-line ECR/ESI missing list>)` | proceeds to download, else `return` |
| pages/SqlConsole.jsx | 340 | `window.prompt('Restore snapshot — describe why (≥10 characters):','')` | null → return |
| pages/SqlConsole.jsx | 346 | `window.alert('Restore aborted: remark must be at least 10 characters.')` | return |
| pages/SqlConsole.jsx | 360 | `window.alert('Restore failed: …')` | (catch branch) |
**PayableOT.jsx has none** (removed by 3b8bca0d "retire legacy extra-duty grant"); GatePasses has one, not two.
Out of scope, left alone: `components/attendanceReview/AttendanceReviewTab.jsx` (owner workstream).

## 3. Smallest change
### 3a. Modal.jsx (same props + optional `busy`)
- `Dialog` (headlessui) with `as="div"`, `open={open}`, `onClose={busy ? noop : (onClose || noop)}`,
  className `fixed inset-0 z-50 …` (same classes as today), backdrop div (`aria-hidden`) + `Dialog.Panel` holding the
  same header (`Dialog.Title as="h3"`, same classes) / close ✕ (gets `aria-label="Close"`, disabled while busy) / scroll body.
- Headless gives: focus trap (Tab/Shift-Tab cycle), Esc, outside-click close, body scroll lock, inert/aria-hidden on the rest,
  restore focus to the opener on close. Own `document` Esc listener + manual scroll lock removed (headless does both).
- Initial focus = the panel itself (`tabIndex={-1}`, `initialFocus={panelRef}`) so opening never lands on ✕ (Enter
  would close) and a title-less modal with no focusable child does not log the FocusTrap warning. An input with
  `autoFocus` inside still wins (headless keeps focus already inside the trap) — checked in the build.
- `show` stays ignored (unchanged behaviour). `ModalBody` / `ModalFooter` unchanged.
### 3b. ConfirmDialog.jsx (same props + optional `busy`, `children`, `showCancel`)
- Same headless `Dialog`, outer `fixed inset-0 z-50 flex items-center justify-center p-4`, `h3` title, message `<p>`.
- Esc / backdrop → `onCancel` (backdrop already did; Esc is NEW for the 7 existing callers — intended by X-10).
- `busy` disables both buttons and blocks Esc/backdrop. `children` (additive) renders under the message (used by the
  prompt). `showCancel=false` hides Cancel (used by alert). Initial focus = Cancel (safe default; see Q2).
### 3c. new hooks/useConfirm.jsx — self-mounting, NO provider (App.jsx/main.jsx untouched)
- Module-level host: on first call creates `<div id="hr-dialog-root">` on `document.body` and a `createRoot` once;
  one queue, one dialog at a time.
- Exports: `confirmDialog(opts) → Promise<boolean>`, `promptDialog(opts) → Promise<string|null>` (text input inside
  ConfirmDialog `children`; Cancel/Esc → null), `alertDialog(opts) → Promise<void>` (OK only), and
  `useConfirm()` returning `{ confirm, prompt, alert }` (stable functions; the hook is a thin wrapper, usable from
  `useCallback` code without deps). String messages render with `whitespace-pre-line` so Reports' `\n` lines survive.
- Separate React root ⇒ no router/react-query context inside the dialog — fine, it only shows text + buttons.
### 3d. The 6 pages — dialog calls only
`if (window.confirm(x)) A` → `if (await confirmDialog({ title, message: x, confirmText, variant })) A` inside an
async onClick. Same action, same arguments. Reports: `const ok = await confirmDialog(...)`. SqlConsole: prompt →
`await promptDialog(...)`, both alerts → `await alertDialog(...)`, same flow order (prompt → length check → alert).
Variant: `danger` (red) for Remove holiday / Cancel comp-off / Cancel gate pass / Reports "download without them";
`warning` (amber) for Approve deduction (see Q3).

## 4. Tests
- jest baseline (before any change): **105 suites / 1649 tests pass** (`flock /tmp/jest.lock npx jest`). No frontend
  tests exist; re-run full suite after.
- New `backend/scripts/ui-dialog-confirm-check.py` (Chromium, local built dist, scratch DB, real logins, fictional
  T96xx data, port 3201):
  1. Each of the 8 migrated calls: dialog opens with the text; Cancel/Esc/backdrop → 0 API calls + DB unchanged;
     OK → the same request as before (method + URL + body captured) + DB effect. Reports: Cancel → no download, OK →
     download. SqlConsole (needs SQL_CONSOLE_ENABLED + admin + a committed protected write to restore): prompt
     Cancel → no POST; <10 chars → alert text, no POST; valid → POST restore with trimmed remark; failed restore → alert.
  2. No native dialog ever fires (`page.on('dialog')` count = 0).
  3. Esc closes; Tab/Shift-Tab stay inside (focus never leaves the panel over 15 presses); focus returns to the opener.
  4. busy: ConfirmDialog/Modal with busy ignore Esc/backdrop (exercised via a page that passes busy? none do today →
     covered by the hook's own dialogs only if used; otherwise a tiny harness route is NOT added — see Q4).
  5. Six existing Modal callers open/close (✕, Esc, backdrop) on different pages: LeaveManagement Apply Leave,
     GatePasses Create, Employees Edit, DayCalculation Apply Leave, SalaryInput, FinanceAudit (one modal); plus
     ConfirmDialog caller NightShift reject.
  6. 390px viewport: dialogs fit, buttons reachable. 0 page errors, 0 console errors, 0 API ≥ 400 (except intended).
  7. `--base` on an origin/main build: native dialog fires (count > 0), Tab escapes the Modal.
- Regression: re-run existing checks that touch dialogs: nightshift-reject-confirm-check, stage6-leave-form-reset-check,
  gate-pass-quota-browser-check, leave-reject-reason-check, sales-neft-confirm-check.

## 5. Risks
- **Portal**: headless Dialog renders in a portal at the end of `<body>`. Selectors still match (same classes/h3);
  React events still bubble through the React tree as before (a modal inside a clickable row behaves as today).
- **Outside click**: anything clicked outside the panel closes the dialog — a react-hot-toast click while a Modal is open
  now closes it (rare). No component inside a Modal uses its own portal today (grep createPortal/Portal = 0).
- **Inert rest of page**: while open, the page behind is aria-hidden/inert — tests that clicked behind an open modal would
  fail (none known).
- **Separate root for useConfirm**: if a migrated confirm were ever raised FROM inside an open Modal, the Modal would see the
  confirm click as outside and close. None of the 8 sites is inside a Modal.
- **Esc on existing ConfirmDialog callers** now cancels (was a no-op) — intended, no action is taken on cancel.
- **Autofocus**: modals whose child uses `autoFocus` keep it; others now focus the panel instead of nothing.
- **Sync → async onClick**: confirm now awaits; a second click while the dialog is open hits the backdrop (dialog is modal), so
  no double submit path is added.

## 6. Questions for the planner
1. PayableOT has no native call any more (8 calls in 6 files, not 10 in 7). Proceed with the 8?
2. ConfirmDialog initial focus on **Cancel** (Enter = cancel, safest for destructive actions) — or on Confirm (native
   confirm's default)? Plan: Cancel.
3. Variants: danger for the 4 cancel/remove/download-without; warning (amber) for "Approve this deduction?" — OK? Titles
   I will add: "Remove holiday?", "Cancel comp-off request?", "Cancel gate pass?", "Approve deduction?",
   "Download without these employees?", "Restore snapshot", "Restore aborted", "Restore failed".
4. `busy` is added to both components but no existing caller passes it (callers outside my files are not touched). Test it
   only through the hook dialogs (which don't need busy) — i.e. busy is shipped untested in a browser unless you want a
   caller wired (would need another file). OK to ship busy covered by code reading + one component-level jsdom-free
   check inside the Playwright run via a migrated site? Plan: leave untested in browser, note it.
5. SqlConsole prompt: keep the exact flow (accept any text, then alert "<10 chars") rather than disabling OK under 10
   chars — keeps "do not change what any action does". OK?

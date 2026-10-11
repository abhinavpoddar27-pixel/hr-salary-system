# P2-ED — PLAN (P2-04 Button/IconButton/StatusBadge · P2-05 ScrollTable · P2-06 ReviewQueue; ED page adopts)

Base origin/main 80934af4 · branch feat/ed-shared-components · port 3204 · frontend only, no backend file.

## 0. What I read (FACT)
- `pages/ExtraDutyGrants.jsx` (456 lines). Finance-tab behaviour from #79 lives in L84–125 (filter/counts/order/
  selection), L225–241 (chips + hint), L243–320 (table incl. select column, row tint, `data-fin`), L322–341 (fixed bar),
  L402–416 (Return-to-HR reason modal, min 5 chars after trim). Status pills: `hrBadge` / `finBadge` maps L162–163.
- `index.css`: `.btn-*` and `.badge-*` classes exist (components layer); `.table-compact thead` is already `sticky top-0`
  but the ED table sits in `.card overflow-x-auto`, so the header never sticks (P-16). `.table-compact th` background is
  translucent (`bg-slate-50/80`). I do not own index.css → all ScrollTable styling is Tailwind utilities in the JSX.
- P2-01 (headlessui Modal, `useConfirm`) is NOT on main. ReviewQueue uses the current `components/ui/Modal.jsx`
  (same props P2-01 promises to keep), so it picks up P2-01 automatically when that merges.
- Check scripts depend on: `[data-testid=fin-filters]`, `[data-filter=<id>]` chip text `Label (n)`,
  `[data-testid=select-all]` (checkbox, disabled when nothing selectable), `[data-testid=bulk-bar]` + its `Clear`
  button, `tbody tr` count + `tr[data-fin]`, `tbody input[type=checkbox]`, button accessible names
  `Bulk Approve (n)`, `↩ Return to HR (n)`, `↩ Return to HR`, `✓ Approve`, `Approve`, `✎ Edit`, `Save`,
  `Return to HR` (exact, modal submit), placeholder `What should HR correct?…`, toast texts, finance badge text
  `UNREVIEWED`, and a scan of every `<select>` on the page for the month picker.
- Baseline (origin/main build, port 3204): `ed-finance-review-ux-check.py` **25/25**, `ed-return-browser-check.py`
  **16/16**. jest baseline: **105 suites / 1649 tests** pass.

## 1. Files (all owned / new)
| File | Change |
|---|---|
| `components/ui/Button.jsx` (new) | `<Button variant=primary\|secondary\|ghost\|danger\|warning\|success size=sm\|md busy busyLabel>`; maps to existing `.btn-*` classes (+`.btn-sm`); `busy` → disabled + `aria-busy` + busyLabel; `type="button"` default; forwards rest props/ref. Also `variant="link"` with `tone` for the small inline row-action buttons (`text-green-600 hover:bg-green-50 px-1.5 py-0.5 rounded text-[10px] font-medium`) so the ED row buttons keep their exact look. |
| `components/ui/IconButton.jsx` (new) | `<IconButton label icon …>`; `label` required (dev `console.error` + falls back to rendering label text visibly if missing); sets `aria-label` + `title`; icon `aria-hidden`. Not used for ED text buttons (would change their accessible names). |
| `utils/statusMap.js` (new) | `STATUS_MAP[domain][status] = {label, tone}`; tones → classes in `TONE_CLASSES`; `statusInfo(domain, s)` with fallback `{label: s ?? '—', tone:'gray'}`. Domains: `ed_hr`, `ed_finance`, `miss_punch`, `leave`, `salary_change`, `loan`, `loan_instalment`, `dw`, `bulk_batch`. ED labels = exactly what the page shows today (`PENDING`, `APPROVED`, `REJECTED`; finance `UNREVIEWED`, `APPROVED`, `FLAGGED`, `REJECTED`). Other domains: labels copied from the page that shows them today (loans from `loanUi.js`, leave/miss punch/salary change/DW from their pages) — map only, no adoption. |
| `components/ui/StatusBadge.jsx` (new) | `<StatusBadge domain status size="xs"\|"sm">`; `xs` = today's ED pill (`text-[10px] px-1.5 py-0.5 rounded-full` + tone colours) so the ED badges render identically. `data-status` attribute. |
| `components/ui/ScrollTable.jsx` (new) | Own `overflow-auto` container (`max-h` prop, default `max-h-[70vh]`), table `table-compact w-full border-separate border-spacing-0`, sticky thead with opaque `bg-slate-50` on `th` (utility `[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-slate-50`, sticky on th not thead so it works in separate-border tables). Column API `columns=[{key, header, render(row), className, sortable, sortValue}]`, `rows`, `rowKey`, `rowProps(row)`, `emptyText`, optional `renderExpanded(row)` → a chevron `<button aria-expanded aria-label="Show details for …">` column + an extra `<tr>` (opt-in; ED does NOT use it, so `tbody tr` counts don't change), sortable headers render `<button>` with `aria-sort` on th. Also `leadingColumn` slot (header + cell) for the select checkbox. |
| `components/bulk/ReviewQueue.jsx` (new) | See §2. |
| `pages/ExtraDutyGrants.jsx` | Define `columns` once; HR Queue / All Grants tabs render `<ScrollTable>`; Finance Review tab renders `<ReviewQueue>` (which renders ScrollTable). Row action buttons → `<Button variant="link" tone=…>` (same text), header/modal buttons → `<Button>`, pills → `<StatusBadge>`. All the finance selection state/handlers (L84–125, L322–341, return modal) move into ReviewQueue; mutations, toasts, HR modals stay in the page. |

## 2. ReviewQueue API (smallest generalisation of #79)
```
<ReviewQueue
  rows statusOf={g => g.finance_status} rowKey="id"
  filters={[{id:'all',label:'All'},{id:'UNREVIEWED',label:'Unreviewed'},{id:'FINANCE_FLAGGED',label:'Flagged',tone:'amber',rowClass:'bg-amber-50'},
            {id:'FINANCE_REJECTED',label:'Rejected',tone:'red',rowClass:'bg-red-50/60'},{id:'FINANCE_APPROVED',label:'Approved'}]}
  order={{UNREVIEWED:0,FINANCE_FLAGGED:1,FINANCE_REJECTED:2,FINANCE_APPROVED:3}}
  selectable={canFinance} allFilterActions={['approve']}
  actions={[
    {id:'approve', label:n=>`Bulk Approve (${n})`, variant:'primary', eligible:row=>…UNREVIEWED, busy:bulkMut.isPending, busyLabel:'Approving...', run:ids=>bulkMut.mutateAsync(ids)},
    {id:'return', label:n=>`↩ Return to HR (${n})`, variant:'secondary', eligible:isReturnable, needsReason:true, minReasonLen:5,
     reasonTitle:n=>n===1?'Return Grant to HR':`Return ${n} Grants to HR`, reasonIntro, reasonPlaceholder, submitLabel:'Return to HR', submitBusyLabel:'Returning...',
     run:(ids,reason)=>finReturnMut.mutateAsync({ids,reason})} ]}
  confirmText={undefined /* optional per action: (n,total)=>string, shown in a ConfirmDialog before run; ED passes none */}
  moneyOf={undefined /* optional: bar shows "₹ total of selected"; ED passes none */}
  columns={columns} rowProps={g=>({'data-fin':g.finance_status})}
  filtersTestId="fin-filters" filterHint={(counts,filter)=>…} emptyText emptyFilterText
/>
```
- Behaviour kept byte-for-byte: counts (`all` = rows.length, unknown statuses only in All), client order (stable sort
  by rank, unknown = 9), header box = every row in the view eligible for ANY action, except on `all` = rows eligible for
  `allFilterActions` only; header disabled when that set is empty; header title text unchanged; row checkbox disabled
  when the row is eligible for no action; selection clears on filter change and on a successful run; tab change
  unmounts the queue (same reset as today's `setActiveTab` handler); fixed bar `N selected` (N = all selected ids, as
  today) + one button per action with ≥1 eligible selected + `Clear`; page bottom padding while the bar shows
  (rendered as a spacer `h-20` inside the queue instead of `pb-24` on the page root — same visual space).
- Single-row "↩ Return to HR" (page row action) opens the SAME reason modal: column `render(row, api)` receives
  `api.openAction('return', [row.id])`. Success → modal closes, selection clears (today's `finReturnMut.onSuccess`
  clears selection for single returns too). Error → modal stays, selection kept (as today).
- Toasts stay in the page mutations (texts unchanged).

## 3. Smallest change / zero behaviour change argument
Same DOM text, same accessible names, same test ids, same `tbody tr` count, same select elements (none added), same
modal wording, same API calls in the same order. Visible differences, by design of P2-05: (a) the ED list now scrolls
inside its own window (max-h 70vh) with a header that sticks; (b) th background opaque instead of 80 %. Nothing else.

## 4. Tests
1. The two ED scripts UNCHANGED: 25/25 and 16/16 on the branch build (PORT=3204).
2. New `backend/scripts/ui-components-check.py` (Chromium, built dist, scratch DB, real finance + hr logins): a hidden
   dev-only harness is NOT added to the app; instead the check drives the ED page: StatusBadge colours/labels per
   status, Button busy state (bulk approve in flight → disabled + "Approving..."), ScrollTable header stays in view
   after scrolling the window (`th` boundingBox top == container top), thead `th` opaque, keyboard: Tab to header
   checkbox + Space selects, Tab to chips + Enter filters, Esc closes reason modal; 390 px: no page-level horizontal
   scroll (table scrolls inside), bar visible; 0 page/console errors, 0 API ≥ 400.
   Chevron-expand + sortable-header keyboard (P2-05) are not used on ED → covered by a jest-free render check: a tiny
   Vite-built test page is NOT possible without touching App.jsx (not owned) → **question Q4**.
3. `--base` on an origin/main build for the new check: sticky-header assertion fails (proves P-16 on ED).
4. jest full suite before/after (frontend-only change; expect identical).

## 5. Risks
- R1 Accessible-name drift if a text button becomes an IconButton → only text buttons via `<Button>`; names asserted.
- R2 `.table-compact tbody tr:nth-child(even) td` background can hide the row tint on even rows — same as today (td bg
  wins today too); unchanged.
- R3 Nested scroll container: Playwright auto-scrolls; the 22-row return flow and 405-row order read use DOM, not
  viewport — fine. Fixed bar is outside the scroll window.
- R4 P2-01 lands later and changes Modal internals: ReviewQueue only uses `<Modal onClose title>` — same props.
- R5 Other builders (P2-07 PeoplePicker etc.) will import Button/IconButton — API frozen after this PR; documented in
  JSDoc at top of each file.
- R6 `statusMap` labels for non-ED domains are not adopted, so a wrong label is harmless now but would be copied later
  → each domain notes its source file.

## 6. Questions for the planner
- **Q1** ED pill labels: keep today's raw uppercase (`UNREVIEWED`, `FLAGGED`…) for zero change (my default), or use
  friendlier labels in statusMap and accept a visible change? (ed-return check reads `UNREVIEWED` case-insensitively,
  so either passes.)
- **Q2** The ED list moving into a max-h scroll window (P2-05 adoption) is a visible layout change on the ED page — OK
  under "zero behaviour change" (behaviour = actions/data), default `max-h-[70vh]`?
- **Q3** ReviewQueue owns the reason modal, and the page's single-row "↩ Return to HR" opens it via `api.openAction`
  (no duplicate modal). OK?
- **Q4** Chevron-expand + sortable headers have no adopter in this PR (ED has neither). Verify them how? Options:
  (a) adopt sortable headers on ED Grant Date / Employee (a small new feature — breaks "zero change");
  (b) a standalone Vite entry `frontend/scripts/ui-harness.html` built only by the check script (new file, not in the
  app bundle) — my preference; (c) defer verification to the first adopter (P3-01 bulk preview).
- **Q5** `confirmText(n,total)` per action: ED passes none (no confirm today). Should the ConfirmDialog use the
  current `components/ui/ConfirmDialog.jsx` (not owned, read-only use) until P2-01? (default yes)

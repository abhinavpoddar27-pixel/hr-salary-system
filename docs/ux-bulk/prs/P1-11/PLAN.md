# P1-11 — PLAN (Phase 0)
Branch `fix/dashboard-failed-call-not-all-clear` · base origin/main 3d20021 (+ f67fef2 PROMPT.md) · Finding H-4.
Status: **Phase 0 ready — waiting for "go". No source file touched.**

## 1. Re-read (FACT, `frontend/src/pages/Dashboard.jsx` at 3d20021)
- `fetchFinanceDashboard` L66–110: `Promise.all` of 7 calls (L83–89), each `.then(r => r.data).catch(() => ({ success: false }))`.
  Runs only for admin/finance on the "finance" view (L112–116).
- Action counts built at L97–102: `heldSalaries` (salary-register `totals.heldCount`), `manualFlags`
  (`/finance-audit/salary-manual-flags` `summary.pendingCount`), `lateDeductions` (`/late-coming/deductions?status=pending`
  `data.length`), `missPunchFinance` (`/attendance/miss-punches` `summary.financePending`). Every failure → `0`.
- **Admin** "Pending Actions" list L165–189: `count === 0` → green dot + `"{label}: All clear"` (L176–180). ← the bug.
- **Finance role** `renderFinanceWorkbench` L257–338 (same `actions` object): count card shows a green **`0`**
  (L274–281) and the banner sums the four counts → **"All caught up — nothing pending"** (L286–289). Same bug, other role.
  (Planner diagnostics named only the admin list; see Q1.)

## 2. Change (only the action-items code in Dashboard.jsx)
1. In `fetchFinanceDashboard`, record which of the four action sources failed:
   `failed = { heldSalaries: !registerRes.success, manualFlags: !manualFlagsRes.success, lateDeductions: !lateDeductionsRes.success,
   missPunchFinance: !missPunchRes.success }` → stored as `financeData.actionsFailed`. Counts code unchanged.
   (`success !== true` = failed: a 4xx/5xx/network error hits the existing `.catch`; a 200 with `success:false` is also a failure.)
2. New `retryAction(key)` (useCallback): calls ONLY that item's API (same params as the Promise.all line), then
   `setFinanceData(prev => …)` updating `actions[key]` and `actionsFailed[key]` (still failed → stays failed). Per-item
   `retrying[key]` state disables the button and shows "Retrying…". No `setFinanceLoading` → the page never blanks.
   For `heldSalaries` the retry re-reads the salary register and updates only `heldCount` (see Q2).
3. Admin list: failed item → amber dot, text `Couldn't check {label}` (slate-600) + `Retry` button on the right
   (instead of "Review →"). Never "All clear". Non-failed items: byte-identical markup/text.
4. Finance workbench (if Q1 = yes): failed card → amber border, `—` instead of the count, label, `Couldn't check — Retry`
   (card is a `<Link>`; the Retry button `preventDefault` + `stopPropagation` so it doesn't navigate). Banner: if any item
   failed, it never says "All caught up"; it shows amber `"{n} check(s) couldn't load — retry above"` (plus the pending
   count if > 0). `totalPending` sums only non-failed items.
5. `npm run build --prefix frontend` → dist in its own commit.

## 3. NOT touched
Backend; api.js; overview/trend/alerts queries; KPI cards, Department Cost, Readiness checklist (they also degrade silently
when their call fails — see §5); HR view; every other page; DO-NOT-MODIFY list.

## 4. Verify
- jest full suite before (3d20021) and after — no backend change, expect identical counts.
- `backend/scripts/dashboard-failed-call-check.py` (Chromium, built dist, scratch DB, port 3111, fictional data T97xx with
  1 held salary + 1 pending late deduction so real values are non-zero): admin + finance logins.
  For each of the 4 endpoints in turn: `page.route` → 500 → that item shows "Couldn't check …", no "All clear"/green `0`
  for it, the other 3 render their real values; banner not "All caught up"; then unroute → click Retry → real value, Retry
  gone; 0 page errors; console errors only the intercepted 500. Also: no intercept → all 4 normal (control); 390px width.
  `--base` on a 3d20021 worktree dist (built under /tmp): intercepted item shows "All clear" (admin) / green 0 +
  "All caught up" (finance) → proves the bug.
- Self-debug + user simulation (happy path + edge: two calls fail, retry one still failing).

## 5. Seen, not fixed (for the register)
- Salary-register failure also makes Net Payroll "Pending" / "0 employees" and PF/ESI ₹0.0L, indistinguishable from
  "not computed yet". Readiness failure shows score 0 "Not Ready" with an empty checklist. Department Cost silently hidden.
- The finance-view fetch has no error UI at all for the KPI half.

## 6. Questions for the planner
- **Q1:** Fix the finance-role workbench too (same `actions`, shows green 0 + "All caught up")? Recommend **yes** — same
  finding, same block of data, otherwise finance (the main user of this view) keeps the bug.
- **Q2:** Held-salaries Retry: update only the held count (smallest), or also refresh `totals`/`recordCount` so the KPI
  cards recover? Recommend **held count only** (KPI cards are out of scope; full page reload fixes them).
- **Q3:** Treat a HTTP-200 `success:false` as "couldn't check" too? Recommend **yes** (today it also becomes 0).

# FRESH-2 — Finance Audit reads send `fresh`; bare-array invalidations become targeted filters

Branch `fix/finance-audit-fresh-reads` off origin/main 892f7f73 · worktree /home/claude/wt-fresh2 · port 3503 · Phase 0 (plan only).
Register item from FRESH (#170, 16 Oct). Frontend only. No backend change needed (see §5).

## 1. What TanStack Query does with a bare array (FACT — read in the installed source)
Installed `@tanstack/query-core` **5.90.20** (`package.json` asks `^5.25.0`).
- `queryClient.js` L149 `invalidateQueries(filters)` → `queryCache.findAll(filters)` → `queryCache.js` L68–70: an array
  `['x']` has `Object.keys(...).length === 1`, so it goes down the filter path; `utils.js` L21 `matchQuery` destructures
  `{ queryKey, type, exact, predicate, … }` from the array — all `undefined` — so **every query in the cache matches**.
- Then `refetchQueries({ ...['x'], type: 'active' })` refetches **every active query** on screen.
- So the answer is **"invalidates everything"**, not "nothing". Today's user-visible effect: the right data does come back
  (it is refetched along with everything else — the companies list, the tab badges, EmployeeQuickView, …), but
  (a) it is a blast of needless GETs after every click, and (b) inside the 5 s `private, max-age=5` window those refetches
  are served from the browser cache, so the list can still show the pre-action copy. Fixing (a) alone without `fresh`
  would make (b) the only path — hence both fixes ship together.
- Side effect to keep in mind: because bare arrays hit everything, some mutations *accidentally* refreshed keys they
  never named (e.g. comp-off review refreshed Readiness). Converting to exact prefixes must add those keys explicitly
  or it is a regression — mapped below.

## 2. Re-count — reads without `fresh` (FACT, api.js on 892f7f73)
All 10 from the register confirmed; none has `fresh`. No 11th found on this page (`getVarianceReport`,
`getStatutoryCrosscheck` are never re-read after a write on this page — left alone, Q4).
| # | api.js line | Helper | Used on Finance Audit by | Other callers (also get no-cache — harmless) |
|---|---|---|---|---|
| 1 | L366 | `getFinanceReport` | Report tab | — |
| 2 | L369 | `getCorrectionHistory` | Report drill-down (`CorrectionDetail`, staleTime 60 s) | — |
| 3 | L370 | `getCorrectionsSummary` | Corrections tab (admin) | — |
| 4 | L383 | `getSalaryManualFlags` | Manual Interventions tab + parent badge | Dashboard.jsx |
| 5 | L386 | `getReadinessCheck` | Readiness tab | Dashboard.jsx |
| 6 | L496–497 | `getFinancePendingDeductions` | Late Coming tab + badge | — |
| 7 | L599 | `getEarlyExitPendingFinance` | Early Exit (component) + badge (dynamic import) | — |
| 8 | L595 | `getEarlyExitDeductions` | Early Exit approved / rejected sub-tabs (component) | — |
| 9 | L294 | `getCompOffPending` | Comp Off tab + badge | LeaveManagement.jsx |
| 10 | L293 | `getCompOffList` | Comp Off tab (`comp-off-all`) | LeaveManagement.jsx (`comp-off-list`) |
Change: add `...fresh` (object-spread form, as `getLeaveRequests` L375) + one house-style comment line per group.
`fresh` is declared at api.js L166 and read only at call time, so lines above L166 are safe (same note as L78).

## 3. Re-count — bare-array `invalidateQueries([...])` (FACT)
**18 calls in FinanceAudit.jsx** (register said ~16), in 6 mutations. 0 in the components it imports
(`FinanceEarlyExitApprovals.jsx` already uses `{ queryKey }`; EmployeeQuickView / CompanyFilter / DateSelector / Modal /
DrillDownRow / ErrorBoundary / hooks have no invalidations). Separately 18 more bare-array calls exist in 6 other pages
(Settings 7, Employees 3, Compliance 2, FinanceVerification 2, Import 2, WorkforceAnalytics 2) — NOT in scope (Q3).

### Map — each mutation → the keys it must hit (what the write changes, per the route / readiness SQL)
Readiness check (financeAudit.js L1556+) counts: salary_manual_flags, punch_corrections, day_corrections,
late_coming_deductions, early_exit_deductions, compensatory_off_requests, leave_applications, salary_computations.

| Mutation (line) | Today | Becomes `{ queryKey: [prefix] }` for | Why |
|---|---|---|---|
| ManualInterventions `approveMut` (L734, 2 calls) | `['salary-manual-flags']`, `['readiness']` bare | `salary-manual-flags`, `readiness` | flag row + tab badge (same key) + readiness pending count |
| ManualInterventions `bulkMut` (L744, 2 calls) | same | same | same |
| LateComing `reviewMut` (L1079–1082, 4) | `late-finance-pending`, `late-deductions-all`, `readiness`, `month-end-checklist` bare | the same four | pending list + badge, history, readiness, Stage 7 checklist (inactive here, marked stale) — matches `reverseMut` L1105–1108 which is already correct |
| LateComing `bulkMut` (L1091–1094, 4) | same | same | same |
| CompOff `reviewMut` (L1762–1764, 3) | `comp-off-finance-pending`, `comp-off-all`, `comp-off-list` bare | those three **+ `readiness`** | pending + badge, history, Leave Mgmt list (inactive); readiness counts compensatory_off_requests — today refreshed only by accident (Q2) |
| CompOff `bulkMut` (L1773–1775, 3) | same | same **+ `readiness`** | same |

Already-correct object calls (untouched unless a Q says so): ReportTab L89, ManualFlags L485, LateComing reverse L1105–1108,
LeaveRequests L1600–1601, FinanceEarlyExitApprovals L45–46, L56–57.

### Gaps found in already-object calls (NOT bare arrays — fix only if ruled, Q1 / Q2)
- **ReportTab `corrMutation` (L89)** — a day correction writes `day_corrections` (+ audit_log) but only `finance-report`
  is invalidated. Also stale afterwards: `correction-history` (drill-down, staleTime 60 s), `corrections-summary`,
  `salary-manual-flags` (live `dc-` rows, financeAudit.js L1281) + Interventions badge, `readiness` (dayPending).
- **FinanceEarlyExitApprovals approve / reject (L45–46, L56–57)** — do not hit the page badge key
  `early-exit-finance-pending` (staleTime 60 s → badge stays wrong up to 60 s) nor `readiness` (counts early_exit_deductions).

## 4. Smallest change — files, functions, why
1. `frontend/src/utils/api.js` — 10 helpers in §2 gain `...fresh` (params form: `{ params, ...fresh }`; the two
   positional ones keep their params object). No signature change, so no caller changes.
2. `frontend/src/pages/FinanceAudit.jsx` — the 18 calls in §3 become `qc.invalidateQueries({ queryKey: [prefix] })`;
   comp-off mutations add `readiness`. If Q1 = yes: `corrMutation.onSuccess` adds `correction-history`,
   `corrections-summary`, `salary-manual-flags`, `readiness`.
3. If Q2 = yes: `frontend/src/components/FinanceEarlyExitApprovals.jsx` approve/reject add
   `early-exit-finance-pending` + `readiness` (2 + 2 lines).
Nothing else.

## 5. Backend — no change (FACT)
`fresh` = request header `Cache-Control: no-cache`; it makes the browser revalidate instead of using its 5 s copy.
The server has no response cache for these routes (server.js L141–148 only sets the header; grep for in-memory caches in
financeAudit.js / lateComing.js / early-exit-deductions.js / compensatoryOff.js finds none — the only `new Map()` in
compensatoryOff.js L302 is a per-request index). No route can "ignore" it. ETag/304 still returns current data.

## 6. NOT touched
Backend, CLAUDE.md, schema.js, salaryComputation/dayCalculation/payroll.js/recompute, Stage 7 register, ED finance-review
behaviour, loans; FinanceAudit tabs' rendering/copy; `getVarianceReport` / `getStatutoryCrosscheck`; the 18 bare-array
calls in other pages; EmployeeQuickView reads; staleTime values.

## 7. Production read-only counts (HR SQL Console, counts only)
Sep 2026: salary_manual_flags 206 (0 pending), day_corrections 0, late_coming_deductions 32; all-time: late pending 1,
early_exit_deductions 4, compensatory_off_requests 0, day_corrections 2, punch_corrections 0.
→ Comp Off and Early Exit tabs are near-empty in production, so the check script must seed its own fictional rows.

## 8. Tests / verification
- New `backend/scripts/finance-audit-fresh-check.py` (Chromium, built dist, scratch DB, fictional codes T96xx,
  `TEST FRESH2 n`, port 3503), finance login (+ admin for Corrections tab; hr for a 200-empty / read-only pass):
  1. every GET to the 10 endpoints carries `Cache-Control: no-cache`;
  2. Manual Interventions approve → row flips + badge drops at once; re-reads hit `salary-manual-flags` + `readiness`
     and **not** `/settings/companies`, `/finance-audit/report`, `/late-coming/*` (proves the bare-array fix);
  3. Late Coming approve (single + bulk) → pending/history/badge current within 1.5 s; no unrelated GETs;
  4. Comp Off review → pending/history/badge current; readiness re-read;
  5. (Q1) day correction → drill-down history + Interventions badge current without reload;
     (Q2) Early Exit approve → page badge drops at once;
  6. reload < 5 s after an action still shows the new state; 390 px width; 0 page errors, 0 API ≥ 400;
  7. static guard: `grep -c "invalidateQueries(\["` in FinanceAudit.jsx == 0;
  8. `--base` on origin/main: no-cache missing + unrelated GETs fire → check FAILS.
- Regression: `finance-audit-readiness-check.py`, `manual-flags-fresh-check.py`, `fresh-reads-check.py`.
- jest full suite under `/tmp/jest.lock` (no backend change → expect unchanged counts); `vite build` under `/tmp/vite.lock`.

## 9. Risks
- Fewer refetches after a click is the point, but any screen that relied on the "refresh everything" side effect loses
  it — §3 map adds the ones found (readiness for comp-off). Residual risk: a key nobody named. The check script's
  "no unrelated GETs" assertion and the targeted-refresh assertions together bound this.
- No-cache on Dashboard / LeaveManagement callers of 4 shared helpers → a few more 200s instead of browser-cache hits;
  negligible at ~265–300 employees.
- `fresh` referenced before its `const` line in api.js — safe (called after module load), as already done at L79/L83.

## 10. Questions
- **Q1** Day correction on the Report tab invalidates only `finance-report`. Also invalidate `correction-history`,
  `corrections-summary`, `salary-manual-flags`, `readiness`? **Recommended: yes** (4 lines, same file, same theme).
- **Q2** `FinanceEarlyExitApprovals.jsx` approve/reject miss the page badge `early-exit-finance-pending` and `readiness`.
  Add them (and add `readiness` to comp-off mutations, which today only refresh it by accident)?
  **Recommended: yes** — otherwise converting the bare arrays regresses comp-off → Readiness.
- **Q3** The 18 bare-array calls in 6 other pages (Settings 7, Employees 3, Compliance 2, FinanceVerification 2,
  Import 2, WorkforceAnalytics 2): **Recommended: not in this PR** — register as FRESH-3 (different pages, different owners
  of the keys, needs its own map).
- **Q4** `getVarianceReport` / `getStatutoryCrosscheck` are not re-read after a write on this page. **Recommended: leave
  without `fresh`.**
- **Q5** Late Coming queries use staleTime 30 s / badge 60 s; with targeted invalidation that is fine (invalidate marks
  them stale). **Recommended: no staleTime changes.**

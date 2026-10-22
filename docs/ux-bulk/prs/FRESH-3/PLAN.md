# FRESH-3 — the last 18 bare-array `invalidateQueries([...])` calls become targeted filters (+ `fresh` on the reads they refresh)

Branch `fix/fresh3-prefix-invalidation` off main b2badcab · worktree /home/claude/wt-fresh3 · port 3501 · Phase 0 (plan only).
Register item from FRESH-2 (#174) §3 ("18 more bare-array calls in 6 other pages — not in scope"). Frontend only.

## 1. Why (FACT — same mechanism as FRESH-2 §1)
`@tanstack/react-query` 5.90.20 (package.json `^5.25.0`). `invalidateQueries(['x'])` passes the array as the *filters*
object; `matchQuery` destructures `{ queryKey, … }` from it → all `undefined` → **every query in the cache matches** and every
active query refetches. So today each of these clicks refreshes the whole screen (companies list, sidebar badges, etc.), and
because server.js L142–148 answers every GET with `private, max-age=5` (no server-side cache; express `etag: true`), the
targeted read itself can come back from the browser's pre-action copy inside 5 s. Both halves ship together, as in FRESH-2.

## 2. Re-grep (FACT, b2badcab) — whole of `frontend/src`
`grep -rnE "(invalidateQueries|refetchQueries|resetQueries|removeQueries)\(\s*\[" frontend/src` → **exactly 18**, all in the 6 pages.
Multi-line form (`invalidateQueries(` then newline) → 0. Variable form (`invalidateQueries(someVar)`) → 0
(Import.jsx L286 already passes `{ queryKey: k }`). So **no out-of-scope bare-array call remains** after this PR.
224 calls in the repo already use the object form.

| # | File:line | Mutation | Today (bare) | Query it is meant to refresh (useQuery key) |
|---|---|---|---|---|
| 1 | Settings.jsx:53 | Shifts `createMutation` | `['shifts']` | `['shifts']` L48 (also ShiftVerification L86, Employees L267/L961) |
| 2 | Settings.jsx:57 | Shifts `updateMutation` | `['shifts']` | same |
| 3 | Settings.jsx:202 | Holidays `createMutation` | `['holidays', selectedYear]` | `['holidays', selectedYear]` L194 |
| 4 | Settings.jsx:206 | Holidays `deleteMutation` | same | same |
| 5 | Settings.jsx:302 | Policy `updateMutation` | `['policy']` | `['policy']` L290 |
| 6 | Settings.jsx:686 | Users `createMutation` | `['users']` | `['users']` L676 |
| 7 | Settings.jsx:696 | Users `updateMutation` | `['users']` | same |
| 8 | Employees.jsx:122 | SalaryForm `updateMutation` | `['employee-detail', code]` | `['employee-detail', code]` L87 (salary window) + L396 (drill-down) |
| 9 | Employees.jsx:273 | EmployeeForm `saveMutation` (create/edit) | `['employees']` | `['employees', company, status]` L956 |
| 10 | Employees.jsx:980 | `bulkShiftMutation` | `['employees']` | same |
| 11 | Compliance.jsx:130 | `generateMutation` | `['compliance', year]` | `['compliance', year, company]` L106 (prefix match) |
| 12 | Compliance.jsx:135 | `updateMutation` | `['compliance', year]` | same |
| 13 | FinanceVerification.jsx:86 | `bulkMut` (bulk verify) | `['fin-dash']` | `['fin-dash', m, y]` L58 |
| 14 | FinanceVerification.jsx:86 | `bulkMut` | `['fin-emps']` | `['fin-emps', m, y, search, status]` L60 |
| 15 | Import.jsx:47 | dept corrections (async handler) | `['reconciliation']` | `['reconciliation', m, y, company]` L23 |
| 16 | Import.jsx:68 | add-to-master (async handler) | `['reconciliation']` | same |
| 17 | WorkforceAnalytics.jsx:330 | `detectMutation` | `['org-overview']` | `['org-overview', …]` L66, L496 (+ Dashboard L33, Analytics L124) |
| 18 | WorkforceAnalytics.jsx:331 | `detectMutation` | `['headcount-trend']` | `['headcount-trend', …]` L59 (+ Dashboard L39) |

Every bare array above is already a valid prefix of its useQuery key, so the conversion is mechanical:
`qc.invalidateQueries(X)` → `qc.invalidateQueries({ queryKey: X })` — same prefix, no widening. (#13/#14 match what the
single `verifyMut` L70 already does.)

## 3. Keys that today refresh only *by accident* (the "refresh everything" side effect) — need a ruling
Converting removes these; each is a key the write really changes, shown on the same screen or one click away.
- **A. EmployeeForm edit (#9)** — the Edit modal also opens from the drill-down ("Edit Details"), whose key is
  `['employee-detail', code]` (L396, `getEmployee`, no `fresh`). After a save the open drill-down would keep the old
  name/department/shift. Add `{ queryKey: ['employee-detail', code] }` when editing (Q1). A typed new department is listed by
  `['departments']` (staleTime 300 s) — add `['departments']` too? (Q1b)
- **B. bulkShiftMutation (#10)** — shift shows in the drill-down (L548/L599). Add `{ queryKey: ['employee-detail'] }` prefix (Q2).
- **C. SalaryForm (#8)** — the list shows `gross_salary` (L1198) and the export. A gross change goes to finance approval (list
  unchanged), but a direct-save path (bank/statutory, same-gross no-op) does not touch list columns either. Leave as is (Q3: add `['employees']` or not).
- **D. Import add-to-master / dept corrections (#15/#16)** — both write `employees`; Employee Master (`['employees']`, `['departments']`) is
  inactive here but cached up to 30 s (main.jsx global staleTime 30 000) → navigating there inside 30 s shows the old list.
  Add `['employees']` + `['departments']` (Q4).
- **E. WorkforceAnalytics detectMutation (#17/#18)** — marks employees inactive; `['attrition']` (L311, same tab) and
  `['employees']` change too. `inactive-employees` is refreshed by its own `refetchInactive()`. Add `['attrition']`? (Q5)
  `reactivateMutation` L337 (not bare — only `refetchInactive()`) also changes org-overview / headcount — out of scope unless ruled (Q5b).
- **F. Shifts (#1/#2)** — `['shifts']` prefix already reaches ShiftVerification + Employees. Nothing more.
- **G. Policy (#5)** — no other page has a `['policy']` key; consumers of policy values are server-side. Nothing more.

## 4. `fresh` — which reads must send no-cache (FACT, api.js on b2badcab; `fresh` declared L166, read at call time)
A helper needs `fresh` when it is re-read within 5 s of a write on these pages. None of these has it today:
| Helper (api.js line) | Re-read after | Other callers (also get no-cache — harmless) |
|---|---|---|
| `getShifts` L352 | #1, #2 | ShiftVerification, Employees (form + list) |
| `getHolidays` L355 | #3, #4 | — (verify in Phase 1 by grep) |
| `getPolicyConfig` L358 | #5 | grep in Phase 1 |
| `getUsers` L55 | #6, #7 | — |
| `getEmployees` L88 | #9, #10, (D) | Many pages (pickers etc.) → ~1,229-row list revalidated instead of browser copy; ETag gives 304 when unchanged (Q6) |
| `getEmployee` L89 | (A), (B), #8 drill-down | other callers (EmployeeProfile etc.) |
| `getComplianceItems` L362 | #11, #12 | — |
| `getImportReconciliation` L344 | #15, #16 | — |
| `getOrgOverview` L126–136 (one line: the final `api.get`) | #17 | Dashboard, Analytics |
| `getHeadcountTrend` L137 | #18 | Dashboard |
| `getInactiveEmployees` L237 | `refetchInactive()` after detect / reactivate | — |
| (if Q1b/Q4) `getDepartments` L97 | (A), (D) | — |
| (if Q5) `getAttritionData` (line to confirm) | (E) | — |
Already `fresh`: `getFinanceAuditDashboard` L399, `getFinanceAuditEmployees` L400 (P1-15), `getImportHistory` L61,
`getEmployeeDocuments` L99. The SalaryForm query (Employees L88) sends no-cache inline — untouched.
Change form: add `...fresh` / `fresh` exactly as the neighbouring fresh helpers do; one house-style comment per group.
Only these helper lines in api.js are edited.

## 5. Smallest change — files
1. 6 pages: the 18 calls → `{ queryKey: [...] }` (same prefix), plus the extra keys the planner rules in §3.
2. `frontend/src/utils/api.js`: the helper lines in §4 (11 base + ruled extras). No signature change → no caller change.
3. New `backend/scripts/fresh3-check.py` (Phase 2).
Nothing else. No backend change (server has no response cache; `no-cache` → revalidate, 200/304 with current data).

## 6. NOT touched
Backend, CLAUDE.md, schema.js, salaryComputation/dayCalculation/payroll.js/recompute, Stage 7 register, ED finance review,
loans; page copy/layout; staleTime values; `refetch()` calls (refetchDocs, refetchInactive) other than via their helper's `fresh`;
FinanceAudit.jsx (done in FRESH-2); any object-form invalidation already present (e.g. Employees L889–892, FinanceVerification L70/L90/L105–139).

## 7. Production read-only counts (HR SQL Console, counts only)
users 7, shifts 8, 2026 holidays 10, compliance_items 24, employees 1,229 (389 Active).
Writes in the last 90 days (usage_logs, POST/PUT/DELETE): employees-other 209, employee salary 158, users 5, bulk-shift 5,
policy 1; shifts / holidays / compliance / bulk-verify / reconciliation / detect-inactive 0 → those screens are rare; the check
script seeds its own fictional data (T95xx codes, `TEST FRESH3 n`).

## 8. Tests / verification (Phase 2)
`backend/scripts/fresh3-check.py` (Chromium, built dist, scratch DB, port 3501; admin for Settings, hr for Employees/Import/
Workforce, finance for FinanceVerification; server restart per role for the login limiter):
1. Per mutation (shift create/edit, holiday add/remove, policy save, user create/edit, employee edit from drill-down, bulk shift,
   compliance generate/update, bulk verify, recon dept fix + add-to-master, detect inactive): the changed row shows within 1.5 s
   **even when the action happens < 5 s after the list loaded**; the re-read carries `Cache-Control: no-cache`.
2. **No unrelated GETs** after each action (e.g. no `/settings/companies`, `/notifications`, `/auth/permissions` refetch) — proves the bare-array fix.
3. Ruled extras (§3) refresh (drill-down after edit / bulk shift; Employee Master current after Import add-to-master).
4. 390 px on one page; 0 page errors; 0 API ≥ 400 except intended.
5. Static guard: `grep -rcE "(invalidateQueries|refetchQueries)\(\s*\[" frontend/src` == 0.
6. `--base` on origin/main: unrelated GETs fire and/or stale read inside 5 s → check FAILS.
Regression: `fresh-reads-check.py`, `finance-audit-fresh-check.py` (FRESH-2), `permissions-nav-check.py` (Settings/Employees pages).
jest full suite under `/tmp/jest.lock` (no backend change → counts unchanged); `vite build` under `/tmp/vite.lock`.

## 9. Risks
- Losing an accidental refresh nobody named — §3 lists the ones found; the "no unrelated GETs" + targeted assertions bound it.
- `getEmployees` no-cache affects every page that lists employees (one more revalidation per mount; 304 when unchanged). Q6.
- `['employee-detail', code]` is shared by two different queryFns (salary window L88, drill-down L396) — existing; invalidating
  the key refetches whichever is mounted. Not changed.
- The 5 Settings/Import mutations have zero production writes in 90 days → low exposure, but also little real-use evidence.

## 10. Questions
- **Q1** EmployeeForm edit: also invalidate `['employee-detail', code]` so an open drill-down shows the edit? (recommend yes)
  **Q1b** and `['departments']` (a newly typed department)? (recommend yes)
- **Q2** Bulk shift: also invalidate the `['employee-detail']` prefix? (recommend yes)
- **Q3** SalaryForm save: keep only `['employee-detail', code]` (recommend), or also `['employees']`?
- **Q4** Import add-to-master / dept corrections: also `['employees']` + `['departments']`? (recommend yes)
- **Q5** Detect inactive: also `['attrition']`? (recommend yes) **Q5b** Reactivate (not a bare call): add org-overview /
  headcount-trend / attrition too, or leave out of scope? (recommend leave — register it)
- **Q6** OK to add `fresh` to `getEmployees` (shared, ~1,229 rows) — or instead only invalidate and accept the ≤ 5 s window on
  that list? (recommend add `fresh`; ETag makes unchanged reads cheap)
- **Q7** OK that `getShifts`, `getEmployee`, `getOrgOverview`, `getHeadcountTrend` gain `fresh` for every caller (Dashboard,
  Analytics, ShiftVerification, EmployeeProfile)? (recommend yes, harmless)

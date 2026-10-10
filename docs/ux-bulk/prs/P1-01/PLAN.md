# P1-01 — PLAN (Phase 0)
Branch `fix/finance-audit-readiness-nav` · base origin/main a5aec9a · Finding F-5 · Rulings R11.
Status: **Phase 0 ready — waiting for "go". No code written.**

## 1. Re-grep (FACT, `grep -n "setActiveTab\|navigate\|ReadinessTab" frontend/src/pages/FinanceAudit.jsx`)
- L604 `function ReadinessTab()` — no props.
- L633 `() => setActiveTab('interventions')`, L634 `() => navigate('/finance-verify?tab=redflags&filter=salary_held')`,
  L635 `() => navigate('/pipeline/salary')` — neither identifier is declared in ReadinessTab's scope.
- L1269 `const navigate = useNavigate()`, L1272 `const [activeTab, setActiveTab] = useState(...)` — both inside `FinanceAudit()`.
- L1367 `{activeTab === 'readiness' && <ReadinessTab />}` — rendered with no props.
- `useNavigate` is already imported (L3). Any click on a card that has an action → uncaught ReferenceError (event handler, so NOT caught by the ErrorBoundary — the card silently does nothing; confirmed in step 6).

## 2. Which cards are clickable today (FACT, backend `routes/financeAudit.js` readiness blockers)
| Blocker type | Action branch | Target |
|---|---|---|
| UNAPPROVED_MANUAL_FLAGS | tab switch | Interventions tab |
| HELD_SALARIES_UNREVIEWED | `includes('HELD')` | `/finance-verify?tab=redflags&filter=salary_held` |
| SALARY_NOT_COMPUTED, DAY_CALC_WITHOUT_SALARY | `includes('SALARY')` | `/pipeline/salary` |
| NO_ATTENDANCE_DATA, MISSING_DAY_CALCULATIONS, CHECK_ERROR | none | not clickable |

## 3. Route check (FACT, `frontend/src/App.jsx`)
- `/pipeline/salary` — exists (L184, Stage 7). OK.
- `/finance-verify` — **does NOT exist.** The page route is `/finance-verification` (L199). `/finance-verify` is only the
  backend API prefix. Unknown paths hit `path="*"` → `<Navigate to="/" replace />` (L230), so after the crash fix the HELD
  card would silently land on the Dashboard.
- FinanceVerification **does** read the query params: `tab=redflags` → its `flags` tab (L34); `filter` → `flagCategory`
  initial state (L40); `salary_held` is a real red-flag type (`financeRedFlags.js` L69). So
  `/finance-verification?tab=redflags&filter=salary_held` would open Red Flags pre-filtered to held salaries.

## 4. Change (smallest)
File: `frontend/src/pages/FinanceAudit.jsx` only.
- L604 `function ReadinessTab()` → `function ReadinessTab({ onTab, navigate })`.
- L633 `setActiveTab('interventions')` → `onTab('interventions')`.
- L1367 `<ReadinessTab />` → `<ReadinessTab onTab={setActiveTab} navigate={navigate} />`.
- Pending ruling Q1: L634 path `/finance-verify` → `/finance-verification` (one string).
**Why props, not `useNavigate()` inside:** the tab switch must change the PARENT's `activeTab` state (it lives in
`FinanceAudit`), so a prop is needed for `onTab` anyway; passing the parent's `navigate` alongside keeps one pattern and
one source, and matches how `ReportTab` already receives parent callbacks (`onClearHighlight`).

## 5. NOT touched
Every other tab component, backend, api.js, App.jsx, Sidebar.jsx, FinanceVerification.jsx, global DO-NOT-MODIFY list.
No copy, layout or styling change. Card markup, "Click to review →" text and the action-null rule unchanged.

## 6. Other tab components (FACT, scope scan of every top-level function in FinanceAudit.jsx)
Only `ReadinessTab` uses a parent-scope identifier it doesn't receive. ReportTab, CorrectionDetail, CorrectionsSummaryTab,
ManualFlagsTab, ManualInterventionsTab, VarianceTab, StatutoryTab, LateComingAuditTab, LeaveRequestsTab (month/year via
props), CompOffAuditTab, KPI, MiniStat: clean. No new register findings from this check.

## 7. Tests / verification
- `npm run build --prefix frontend` clean; dist in its own commit.
- `cd backend && npx jest` — reds before/after (only parked TDS allowed).
- New `backend/scripts/finance-audit-readiness-check.py` (pattern: `ed-finance-review-ux-check.py`,
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, scratch DB, fictional data seeding an UNAPPROVED_MANUAL_FLAGS blocker,
  a HELD_SALARIES_UNREVIEWED blocker, and a SALARY_NOT_COMPUTED/DAY_CALC_WITHOUT_SALARY blocker; finance + admin logins):
  1. manual-flags card → Interventions tab active, 0 page errors;
  2. HELD card → URL = `/finance-verification?tab=redflags&filter=salary_held` (if Q1 = fix) and Red Flags tab active,
     0 page errors;
  3. SALARY card → URL `/pipeline/salary`, 0 page errors;
  4. no-action blocker → no cursor-pointer, no "Click to review", click does nothing, 0 errors;
  5. reload `/finance-audit?tab=readiness` → renders, 0 console errors, 0 API ≥ 400.
- Bug proof: same script against the origin/main dist → page error `setActiveTab is not defined` on step 1 (recorded once).

## 8. Risks
- Low. Display/navigation only, no money path, no drift query.
- If Q1 is answered "leave path", step 2 asserts the redirect to `/` and the HELD card stays functionally broken (no crash).
- A blocker type containing both HELD and SALARY resolves to HELD (order unchanged).

## 9. Questions for the planner
- **Q1:** fix the HELD target `/finance-verify` → `/finance-verification` in this PR (one string, existing route, already
  reads tab/filter)? OPINION: yes — otherwise the crash fix makes the card a silent jump to Dashboard. The scope says "do not
  invent routes"; this uses an existing one.

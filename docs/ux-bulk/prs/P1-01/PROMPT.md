# P1-01 — Finance Audit: Readiness card click crashes the page
Base: origin/main a5aec9a · Branch: fix/finance-audit-readiness-nav (already created, this file committed on it)
Master plan: docs/ux-bulk/MASTER_PLAN.md §6 P1-01, §10, §11, §12 (on branch docs/ux-bulk-master-plan until merged)
Finding: F-5 · Rulings: R11 (Phase 0 gate, never push to main)

## RESUME (re-read after any compaction)
- Progress file: docs/ux-bulk/prs/P1-01/PROGRESS.md — update after EVERY small step (state, done, next, rulings).
- Current phase: 0 plan (STOP at the end of Phase 0 and wait for "go").

## Diagnostics already done by the planner (counts only)
- Code: `ReadinessTab()` (FinanceAudit.jsx ~L604) calls `setActiveTab(...)` AND `navigate(...)` (~L633–635);
  neither exists in its scope — both live in the parent `FinanceAudit()` (~L1269, L1272). `<ReadinessTab />` is
  rendered with no props (~L1367). Any click on a clickable blocker card → ReferenceError → ErrorBoundary.
- Sentry: 0 issues match (frontend errors are not reported to Sentry today — that is P2-09, out of scope).
- Production: readiness endpoint called 821 times in 90 days (finance 187, admin 41, hr 38, viewer 555).
  salary_manual_flags unapproved: Aug 2026 = 265, Sep 2026 = 206 → the UNAPPROVED_MANUAL_FLAGS blocker is live,
  so finance hits this crash on the card that matters most.

## Phase 0 — plan only (STOP at the end)
1. `git status` clean on fix/finance-audit-readiness-nav; `git log -1` = the commit adding this file on a5aec9a.
2. Re-grep: `grep -n "setActiveTab\|navigate\|ReadinessTab" frontend/src/pages/FinanceAudit.jsx`. Read the whole
   ReadinessTab function and the parent tab bar. Check whether any OTHER tab component uses setActiveTab/navigate
   without receiving it (list them; fix only ReadinessTab — others go to the register as new findings).
3. Write docs/ux-bulk/prs/P1-01/PLAN.md: files (path + function + why), the exact smallest change, what is NOT
   touched, tests, verification, risks, questions. Create PROGRESS.md with a RESUME block.
4. Commit PLAN.md + PROGRESS.md (no code). STOP. Report "Phase 0 ready". Do not write code.

## Scope (smallest change)
- Pass the parent's tab setter and navigate into ReadinessTab as props:
  `<ReadinessTab onTab={setActiveTab} navigate={navigate} />` and `function ReadinessTab({ onTab, navigate })`,
  replacing `setActiveTab('interventions')` with `onTab('interventions')`. (Or call `useNavigate()` inside
  ReadinessTab — pick ONE and say why in PLAN.md; prefer the props form so the tab switch stays in parent state.)
- Verify the two navigate targets exist as routes in App.jsx (`/finance-verify` with `?tab=redflags`, `/pipeline/salary`).
  If a target route does not exist, report it — do not invent routes.
- No other behaviour, copy or layout change.

## Targets
- frontend/src/pages/FinanceAudit.jsx → ReadinessTab (~L604–640) and its render site (~L1367). Nothing else.

## DO NOT MODIFY
Global list (MASTER_PLAN §10.4): salaryComputation.js, dayCalculation.js, schema.js, payroll.js, recompute.js,
Stage 7 register (SalaryComputation.jsx .salreg/COLS/pins), ED finance-review flow (#79), loans engine.
PR-specific: every other tab component in FinanceAudit.jsx, all backend files, api.js, App.jsx, Sidebar.jsx.

## Build rules
- One finding = this PR only. Fictional test data only (repo is PUBLIC: no real names/codes/money anywhere).
- After the frontend edit: `npm run build --prefix frontend`; commit frontend/dist in its own commit.
- Skills: engineering:testing-strategy for the check plan; engineering:debug only if the fix doesn't behave.

## Verify (MASTER_PLAN §11)
- `npm run build --prefix frontend` clean. `cd backend && npx jest` — list reds before/after (only parked TDS allowed).
- Browser check script `backend/scripts/finance-audit-readiness-check.py` (pattern: ed-finance-review-ux-check.py;
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers; scratch DB, fictional data seeded so the readiness check returns an
  UNAPPROVED_MANUAL_FLAGS blocker and a SALARY/HELD blocker; real finance + admin logins against the built dist):
  - happy: click the manual-flags card → Interventions tab active, 0 page errors;
  - click a SALARY / HELD card → URL changes to the expected route, 0 page errors;
  - edge: a blocker with no action → not clickable, no "Click to review" text, no error;
  - edge: reload Finance Audit with `?tab=readiness` → renders; 0 console errors, 0 API ≥ 400 (except intended).
- Prove the bug: the same script against the origin/main dist must show the page error (run once, record result).
- Self-debug + user simulation + v2 before hand-off. No drift query needed (display only, no money path).

## Hand-off
- CLAUDE.md "Last Session" entry at the top (house style: branch, what, files, fragile, verified, not tested, open).
- Commit (message ends with the session attribution lines), push the branch, verify HEAD == origin/<branch>.
  Do NOT open or merge a PR. Report: built / caught / tested / not tested (why) / final status / compare link
  https://github.com/abhinavpoddar27-pixel/hr-salary-system/compare/main...fix/finance-audit-readiness-nav

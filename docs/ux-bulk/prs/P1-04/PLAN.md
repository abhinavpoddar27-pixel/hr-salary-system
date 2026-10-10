# P1-04 — Phase 0 plan: Stage 6 always runs for all companies

Branch `fix/stage6-company-scope-guard` @ e0cdf50 (= origin/main 2d96842 + PROMPT.md). Finding P-2. Ruling Q4.

## What the code does today (read, not changed)
- `frontend/src/pages/DayCalculation.jsx` L110–119: `calcMutation` posts
  `calculateDays({ month, year, company: selectedCompany })`. Both Run buttons use it: the header
  "▶ Run Day Calculation" (L254–260) and the stale-banner "Recalculate Days" (L280–286).
- `utils/api.js` L97: `calculateDays = (data) => api.post('/payroll/calculate-days', data)` — body passed through as is.
- `routes/payroll.js` L14–40 → `recomputeDays(db, { company, … })`. `services/recompute.js`: every company filter is
  `${company ? 'AND … company = ?' : ''}` with `.filter(Boolean)` on the args, so `company: ''` (or omitted) = no
  filter = every employee with attendance that month, full attendance set. `calculateDays(…, company || '', …)` and
  `saveDayCalculation` → `normalizeCompany('')` resolves the row's company from the employee master (same path HR's
  "All Companies" run and the fixed nightly sweep already use). Stage stamp unscoped → `stage_6_done=1` on every label
  of the month (already the all-companies behaviour).
- `selectedCompany` default is `''`; the CompanyFilter "All Companies" option is `value=""`.
- The bug: with a company selected, attendance is read for that label only, but `day_calculations` is
  UNIQUE(code, month, year) — an employee whose month spans two labels (e.g. 'Asian Lakto Ind Ltd' + 'Default') gets
  the whole-month row rewritten from a partial set (payable days cut).

## Change (frontend only, Targets = DayCalculation.jsx calcMutation + header block)
1. `calcMutation.mutationFn` → `calculateDays({ month, year, company: '' })`. Comment says why (UNIQUE key, link to
   P-2). List query (L49–50), staleness query, leave-requests query untouched — they keep the top-bar filter.
2. Under the header Run button, only when `selectedCompany` is set, one muted line:
   "Day calculation always runs for all companies, so no employee's days are cut. The list below still shows
   {selectedCompany} only." Layout: wrap the button + note in a small right-aligned column (`flex flex-col items-end`)
   so the header row is otherwise unchanged; note `text-xs text-slate-500 max-w-xs text-right`.
3. Success toast: `Day calculation complete for N employees (all companies)`. Error toast unchanged.
- No backend change, no api.js change (the explicit `''` in the body is what the check intercepts).
- dist rebuilt in its own commit.

## Verify
- jest baseline (before): **85 suites / 1377 tests**, all pass. After: must be identical (no backend change).
- New `backend/scripts/stage6-all-companies-check.py` (pattern: salary-register-report-check.py), port 3104,
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, scratch DATA_DIR, built dist, real hr login, fictional data only
  (codes T96xx, "TEST EMP n"):
  - Seed: company A = 'Asian Lakto Ind Ltd', company B = 'Indriyan Beverages' (confirm exact canonical names from
    `CANONICAL_COMPANIES` at build). Employees: 2 in A, 2 in B, plus 1 in A whose September attendance is split
    across labels A + 'Default' (the cut case). Full-month P attendance for all, a `monthly_imports` row per label.
  - Select A in the top bar (via the CompanyFilter select), click Run, intercept `POST /api/payroll/calculate-days`.
  - Asserts: body.company == '' ; response 200; every seeded employee (A and B) has a `day_calculations` row; the split
    employee's `total_payable_days` = full month (not the A-only share); B employees' rows exist with full days;
    note visible with A selected and contains the company name; note hidden with All Companies; list rows shown are
    A only; toast text; 0 page errors, 0 console errors, 0 API ≥ 400; 390px phone: note visible, no sideways scroll
    introduced by the header.
  - `--base` (APP_ROOT = an origin/main worktree, built): record body.company == A and the split employee cut
    (payable < full month), B rows absent. Run once.
- Self-debug + user simulation: happy path (A selected), All Companies selected (no note, body ''), stale banner
  "Recalculate Days" button also sends '' (edge), restricted user auto-set company (see Q1).

## Risks / fragile
- An employee whose master company is non-canonical and whose rows were previously stamped from the attendance label
  may move to a different company tag on the all-companies run (normalizeCompany falls back to master / existing
  salary row). That is today's "All Companies" behaviour, not new — but the filtered list could show a different set
  after the first run. Will note it, not fix.
- Runtime: an all-companies run processes every employee (~580) instead of one company's; it's the run HR is already
  told to use, measured fine in prod.

## Questions for the planner
- **Q1 — company-restricted users.** A user with `allowedCompanies = [A]` gets `selectedCompany = A` auto-set at login.
  `/calculate-days` has no company restriction server-side, so after this change their run recomputes company B's
  employees too. Accept (plan default: yes — it's the correct, non-destructive result and the route already allows
  it), or should the note say so / should restricted users be left on their own company? I'll go with "accept, same
  note" unless told otherwise.
- **Q2 — copy.** Use the PROMPT line verbatim (no design:ux-copy pass) — OK?

# P1-21 — PLAN (Phase 0)
Branch `fix/reports-bulk-payslips-403` · base origin/main 868f5389 (+ e20f1a78 PROMPT.md) · Finding H-9 (Med) · Port 3121.
Status: **Phase 0 ready — waiting for "go". No source file touched.**

## 1. Diagnosis (FACT — commands run in this worktree)
`grep -n -i "bulk\|payslip" frontend/src/pages/Reports.jsx`
- L9 import `getBulkPayslips` (from utils/api.js); L22 import `downloadBulkPayslipsPDF` (from utils/payslipPdf.js).
- L264 `const [bulkPdfLoading, setBulkPdfLoading] = useState(false)`.
- L316–330 `handleBulkPayslips()` → `getBulkPayslips(month, year, companyFilter)` → `GET /api/payroll/payslips/bulk`.
- L342 REPORTS entry `{ id: 'payslips', label: 'Payslips (Bulk PDF)', desc: 'Download all employee payslips' }`.
- L1013–1033 `activeReport === 'payslips'` block: "Download All Payslips (PDF)" button + "Generate a single PDF…" card.

`sed -n 850,865p backend/src/routes/payroll.js` — the route returns **403 always** ("Bulk payslip download is disabled per
company policy", April 2026). So every click → 403 → toast "Failed to generate payslips". Button can never work.

`grep -rn "getBulkPayslips\|payslips/bulk" frontend/src backend/src`
- `getBulkPayslips` (api.js L330): only caller is Reports.jsx → becomes dead → **remove** (allowed by Targets).
- `downloadBulkPayslipsPDF` (payslipPdf.js L334): only caller is Reports.jsx → becomes a dead export. payslipPdf.js is NOT
  in Targets → **left in place** (see Q2). `downloadPayslipPDF` (single) is used by SalaryComputation.jsx — untouched.
- Backend test `manualDeductionsRetired.test.js` T4 pins the 403 on the route — untouched (route not changed).

Individual payslips remain available in Stage 7 (`SalaryComputation.jsx` → `getPayslip` / `downloadPayslipPDF`).

## 2. Fix (Reports.jsx + api.js only)
1. Remove `getBulkPayslips` from the L9 import and the `downloadBulkPayslipsPDF` import (L22).
2. Remove `bulkPdfLoading` state (L264) and `handleBulkPayslips()` (L316–330).
3. Keep the `payslips` tab (so anyone who looks for it finds the reason) — relabel:
   `{ id: 'payslips', label: 'Payslips', desc: 'Bulk download disabled — use Stage 7' }`.
4. Replace the L1013–1033 block body: header "Payslips — {Month} {Year}" + a plain info card
   (`data-testid="bulk-payslips-disabled-note"`): "Bulk payslips are disabled by company policy. Download individual
   payslips from Stage 7 (Salary Computation) — open an employee's payslip there." with a `<Link to="/pipeline/salary">`
   "Open Stage 7". No button, no request.
5. api.js: delete the `getBulkPayslips` export (L330) — grep confirms no other importer.
6. `flock /tmp/vite.lock npm run build --prefix frontend`; dist in its own commit.
Not touched: payroll.js route, Stage 7, payslipPdf.js, every DO-NOT-MODIFY file.

## 3. Verify
- jest full suite before + after (`flock /tmp/jest.lock npx jest`), counts recorded; no backend change expected.
- New `backend/scripts/reports-bulk-payslips-check.py` (Chromium, built dist, scratch DB, port 3121, real hr + finance
  logins, fictional data): open Reports → Payslips tab for each role: note visible, no "Download All Payslips" button,
  0 requests to `/payslips/bulk`, "Open Stage 7" link navigates to /pipeline/salary, other tabs still open (attendance,
  salary), 390px phone pass, 0 page/console errors, 0 API ≥ 400.
- `--base` on an origin/main dist (worktree under /tmp): click the button → request to /payslips/bulk → 403 + error toast.
- Grep the built Reports chunk: no `payslips/bulk`, note text present.
- Self-debug + user-simulation (hr opens Payslips tab, reads note, follows link, downloads one payslip in Stage 7 —
  edge: finance role, phone width).

## 4. Questions for the planner
- Q1: Keep the Payslips tab with the note (my plan) or drop the tab entirely? Keeping it explains the policy to anyone
  who used to click it; dropping it is smaller. Default: keep + note.
- Q2: `downloadBulkPayslipsPDF` in `utils/payslipPdf.js` becomes a dead export. Leave it (outside Targets) — or remove it
  here? Default: leave, note as found-not-fixed.
- Q3: "Open Stage 7" link — OK to add (react-router `Link`, already used in the app)? Default: yes.

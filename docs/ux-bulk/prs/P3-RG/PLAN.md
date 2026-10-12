# P3-RG — role gaps: tax declaration reads + manual-flag Verify for HR; FinanceAudit `f.verified`

Branch `fix/role-gaps-taxdecl-verify` (on origin/main 8abee969) · Port 3406 · Phase 0 (plan only).

## 1. Findings confirmed in code

### F1 — tax declaration GETs readable by any logged-in role
`server.js:216` mounts `/api/tax-declarations` behind `requireAuth` only. In `routes/taxDeclarations.js`:
| Route | Guard today | What it returns |
|---|---|---|
| `GET /:employeeCode` (L8) | none | full `tax_declarations` row (regime, 80C, 80D, HRA exemption, other exemptions, estimated TDS) |
| `PUT /:employeeCode` (L17) | `requireHrFinanceOrAdmin` (P2-11) | — |
| `GET /:employeeCode/calculate` (L41) | none | projected TDS **and reads the person's latest gross** — same gap, leaks salary-derived numbers |

So viewer / supervisor / employee-portal login can read anyone's declaration and projected TDS.

**Callers today (grep, whole repo):** no frontend page or helper calls `/tax-declarations` (no hit in `frontend/src`,
`utils/api.js`); `routes/employeePortal.js` has no tax read; no script calls it. Readers of the table are only
`tdsCalculation.js` and `salesSalaryComputation.js` (services, not HTTP). → No portal flow depends on the GETs, so no
"employee reads own" exception is needed (pending the usage_logs count below).

### F2 — HR sees "Verify" on Finance Audit → Attendance Flags
`PUT /finance-audit/manual-flags/:id/verify` is `requireFinanceOrAdmin` (P2-11 Q6). `ManualFlagsTab` (FinanceAudit.jsx
L450–576) renders the Verify button for every role that can open the page (hr has `finance-audit` in permissions.js) →
HR clicks → 403 → "Failed to verify flag" toast.

### F3 — `f.verified` is not a column
`schema.js:1170` `manual_attendance_flags` has `finance_verified INTEGER DEFAULT 0`, `verified_by`, `verified_at` — no
`verified`. Route `GET /manual-flags` is `SELECT *`. So `f.verified` is always `undefined`; the screen currently works
only through the `|| !!f.verified_by` fallback (L475, L512, and the tab badge L1441 in the parent component).
Writers keep the pair in step today: verify sets `finance_verified=1 + verified_by`; re-mark (mark-present upsert
L1086) sets `finance_verified=0 + verified_by=NULL`. So display is right on rows written by current code; a row with
`finance_verified=1` and `verified_by` NULL (legacy / hand edit) would show as unverified with a live Verify button.

## 2. Smallest change

**Backend (`routes/taxDeclarations.js`, guard lines only):** add the existing local `requireHrFinanceOrAdmin` to
`GET /:employeeCode` and `GET /:employeeCode/calculate`. Same 403 body as the PUT. No other line changes.
(Hit before any DB read, so unknown codes also answer 403 for refused roles.)

**Frontend (`pages/FinanceAudit.jsx`):**
- `ManualFlagsTab`: `const { selectedCompany, user } = useAppStore()`; `canVerify = ['finance','admin'].includes(normalizeRole(user?.role))`
  (`utils/role.js` normalizeRole — same as SalaryExplainer; import added). Actions cell: Verify button / inline remark
  editor only when `canVerify`; HR sees status only (an unverified row's Actions cell shows "Awaiting finance", grey).
- One helper `isFlagVerified(f) = Number(f.finance_verified) === 1 || !!f.verified_by` used at L475 (count), L512 (row)
  and L1441 (tab badge in the parent FinanceAudit component — same file, outside the tab; **Q1**). Drops `f.verified`.

## 3. Tests
- NEW `backend/src/__tests__/taxDeclarationReadGuard.test.js` via `helpers/jwtApiHarness` (real requireAuth + JWTs):
  both GETs × {admin, hr, finance, "Finance Team", "HR Manager"} → 200 with the seeded fictional row (T9xxx) /
  TDS object; × {viewer, supervisor, employee (own code), blank role} → 403 with the standard body; no token → 401;
  PUT unchanged (hr 200, viewer 403); unknown code as viewer → 403 (not 200 null). Prove failing on 8abee969 first.
- `backendRouteGuards.test.js` only covers the PUT — untouched.
- NEW `backend/scripts/role-gaps-check.py` (Chromium, built dist, scratch DB, port 3406, hr + finance logins, fictional
  T97xx flags): hr → Attendance Flags shows rows + status, 0 Verify buttons, 0 PUT /verify requests, 0 console errors,
  0 API ≥ 400; finance → Verify → remark → OK → row verified, counts move; a seeded row with `finance_verified=1,
  verified_by NULL` shows verified for both roles and no Verify; badge = unverified count; API probe: viewer GET
  /tax-declarations → 403; 390 px. `--base` on an 8abee969 build: hr sees Verify, click → 403; legacy row shows
  unverified.
- Full jest before/after under `flock /tmp/jest.lock`.

## 4. Risks
- If any external caller (Excel macro, script) reads `/tax-declarations` with a viewer/employee login it starts getting
  403. Grep found none; usage_logs count requested below.
- Employee portal: if a self-service tax screen is planned later it needs its own `/portal/...` route (not this one).
- normalizeRole on the frontend vs. raw compare elsewhere in the file (L1036 lowercases) — new code uses normalizeRole
  so "Finance Team" users still get Verify.

## 5. Read-only SQL for the planner (counts only)
```sql
-- A. Who has called the tax declaration endpoints (90 d / all time), by role
SELECT u.role, ul.method, COUNT(*) AS calls, MIN(ul.created_at) AS first_at, MAX(ul.created_at) AS last_at
FROM usage_logs ul LEFT JOIN users u ON u.username = ul.username
WHERE ul.path LIKE '/api/tax-declarations%'
GROUP BY u.role, ul.method;
-- (if usage_logs column names differ: SELECT * FROM usage_logs LIMIT 1 first — column list only)

-- B. Declaration rows exist at all?
SELECT COUNT(*) AS rows, COUNT(DISTINCT employee_code) AS people FROM tax_declarations;

-- C. Flag rows where the two "verified" signals disagree
SELECT
  SUM(CASE WHEN finance_verified = 1 AND (verified_by IS NULL OR verified_by = '') THEN 1 ELSE 0 END) AS verified_no_name,
  SUM(CASE WHEN COALESCE(finance_verified,0) = 0 AND verified_by IS NOT NULL AND verified_by <> '' THEN 1 ELSE 0 END) AS name_not_verified,
  COUNT(*) AS total
FROM manual_attendance_flags;

-- D. Who has called the manual-flag verify route, by role (expect hr 403s)
SELECT u.role, COUNT(*) AS calls FROM usage_logs ul LEFT JOIN users u ON u.username = ul.username
WHERE ul.path LIKE '/api/finance-audit/manual-flags/%/verify' GROUP BY u.role;
```

## 6. Questions
- **Q1** The tab badge (L1441) lives in the parent `FinanceAudit()` component, not the flags tab. OK to change that one
  line to the shared helper (same file I own; outside "flags tab lines")? Default: yes.
- **Q2** If query C shows rows with `verified_by` set but `finance_verified = 0`: treat as verified (keep the
  `|| verified_by` fallback, my default) or trust `finance_verified` only?
- **Q3** HR Actions cell for an unverified row: "Awaiting finance" text (default) or empty "—"?
- **Q4** Usage_logs A: if any employee-role login has read its OWN code, keep a self-read exception
  (`req.user.employeeCode === :code`)? Default: no exception unless A shows such calls.

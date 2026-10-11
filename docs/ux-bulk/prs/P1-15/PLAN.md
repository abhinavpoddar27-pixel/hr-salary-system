# P1-15 — PLAN (Phase 0)
Branch `fix/finverify-flag-reason` · base origin/main 868f5389 (+ d7fb87b2 PROMPT.md) · Finding F-12 (Med).
Status: **Phase 0 ready — waiting for "go". No source file touched.**

## 1. Re-grep (FACT)
`grep -n "flag\|Flag\|signoff\|Approve" frontend/src/pages/FinanceVerification.jsx` · `cat backend/src/routes/financeVerification.js`
- Employee Review tab L288: ⚠ button → `verifyMut.mutate({..., status:'flagged', flagReason:'Flagged for review'})` — fixed text, no prompt.
- Red Flags tab L352: "Flag" → `flagReason: f.description, flagCategory: f.type` — auto text from the detector, no prompt either.
- `verifyMut` L56: no `onError` (a 403/500 shows only the global handler).
- Dashboard L240: "Sign Off Month" opens the modal L542–563; **Approve L552 is only disabled while pending** — always clickable.
- Employee rows show a "Flagged" pill; `flag_reason` is returned by `GET /employees` (`fas.flag_reason`) but never rendered.
- Server `POST /status` (L124): stores `flagReason || null` — no minimum, no required reason.
- **Server `POST /signoff` (L184–190) ALREADY refuses approve**: `COUNT(*) FROM finance_audit_status WHERE month=? AND year=?
  AND status IN ('flagged','rejected')` > 0 → 400 "Cannot approve — N employee(s) still flagged/rejected…". Not company-scoped.
  → UI gate mirrors this rule exactly: **N = dash.summary.flagged + dash.summary.rejected** (dashboard counts the same
  table, same month/year, no company filter). No server change needed for the gate.
- Today the user clicks Approve and gets the 400 toast — the gate is server-side only; the screen does not say why up front.

## 2. Production (FACT, read-only SQL Console)
- `finance_audit_status`: 107 verified (Mar–Apr 2026), 11 flagged (Mar 2026) — all 11 reasons are red-flag descriptions
  (salary-hold / previously-Left); **0 rows with 'Flagged for review'** (the Employee-tab ⚠ was never used in prod).
- `finance_month_signoff`: 0 rows ever. Mar 2026 has 11 flagged → server would refuse Approve today.

## 3. Change (frontend only, `pages/FinanceVerification.jsx`)
1. New `FlagReasonModal` state `{ employeeCode, name, category, defaultReason }`. Both Flag buttons open it instead of
   mutating directly:
   - Employee tab ⚠: empty textarea.
   - Red Flags card "Flag": textarea **pre-filled with `f.description`** (editable), `flagCategory: f.type` kept (Q1).
   Confirm "Flag employee" disabled until `reason.trim().length >= 5` (const `FLAG_REASON_MIN = 5`, mirrors P1-06),
   live count + hint; sends `flagReason: reason.trim()`. Modal resets on every open/close; closes on success only.
2. `verifyMut`: add `onError` toast with server message; success invalidates with `{ queryKey: [...] }` objects.
3. Show the stored reason: under the "Flagged" pill a small amber line, truncated, full text in `title` (Q2).
4. Sign-off gate: `openFlags = (dash?.summary.flagged || 0) + (dash?.summary.rejected || 0)`.
   Modal Approve `disabled={signoffMut.isPending || !dash || openFlags > 0}`, label stays "Approve", a line above
   it: "N still flagged — verify or resolve them before approving." (wording "flagged" covers flagged+rejected; the
   count is the server's). Reject path unchanged. "Sign Off Month" button keeps opening the modal (Reject must stay
   reachable). Dashboard data not loaded → Approve disabled.
5. Freshness: `GET /finance-verify/dashboard` and `/employees` answer with the server's `max-age=5`; after Verify the
   refetch can get the pre-change count for ~5 s, so Approve would stay disabled (or enabled after a Flag). Send `fresh`
   (no-cache) on `getFinanceAuditDashboard` + `getFinanceAuditEmployees` in `utils/api.js` (2 lines; same fix as P1-08 /
   leave pages) — Q3, api.js is in Targets "only if a param is missing"; this is a header, so asking.
- dist rebuilt, own commit. Backend untouched.

## 4. Verify
- jest full suite before + after (record suites/tests). No backend change → no new jest test unless Q4 says server min.
- Browser `backend/scripts/finverify-flag-reason-check.py` (pattern salary-register-report-check.py; scratch DB, fictional
  T95xx employees + salary_computations for one month, real finance login, built dist, port 3115,
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers):
  employee ⚠ → modal, 0/4 chars/spaces → disabled, 5+ → flag → DB flag_reason == trimmed text, row shows reason;
  red-flag card Flag → pre-filled description editable → DB stores edited text + flag_category; Cancel → no POST;
  Sign Off modal: Approve disabled + "1 still flagged"; Verify that employee → Approve enabled → approve → 200, signoff row;
  rejected-status row (seeded) also blocks; 390px; 0 page/console errors, 0 API ≥ 400.
  `--base` on a 868f5389 build: ⚠ posts 'Flagged for review' with no dialog; Approve enabled while flagged (click → 400).
- Self-debug + user simulation (happy path; edges: reopen clears text, whitespace-only, dash still loading).

## 5. NOT touched
Backend routes/services/schema, bulk-verify, miss-punch tab, held tab, ReleaseHoldModal, every DO-NOT-MODIFY file.

## 6. Found, not fixed (report)
- F-a `POST /status` has no server-side reason minimum (API caller can still flag with no reason) — UI rule only.
- F-b Server sign-off gate and dashboard are month-wide, not company-scoped; `finance_month_signoff` is keyed on company
  but `/signoff-status` reads by month/year only (LIMIT-less `.get` picks any row).
- F-c No per-employee "rejected" action exists in the UI, yet the server counts `rejected` rows as blocking.
- F-d `bulk-verify` filter 'no-red-flags' does not touch already-flagged rows; flagged rows need one-by-one Verify.

## 7. Questions for the planner
1. Red-flag card Flag: open the same reason dialog pre-filled with the detector description (editable) — OK? (Alternative:
   leave it one-click since it already carries a specific reason.)
2. Show the stored flag reason in the Employee Review row — OK?
3. Add `fresh` (no-cache) to `getFinanceAuditDashboard` + `getFinanceAuditEmployees` in api.js — OK?
4. Server-side 5-char minimum on `POST /status` for status=flagged (F-a): leave for later as in P1-06?

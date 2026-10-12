# P3-RG PROGRESS

## RESUME
Branch fix/role-gaps-taxdecl-verify · worktree /home/claude/wt-rg · port 3406. Read PLAN.md. Phase 0 done → waiting for planner "go".
Owned: backend/src/routes/taxDeclarations.js (guard lines), frontend/src/pages/FinanceAudit.jsx (flags lines),
NEW taxDeclarationReadGuard.test.js, backend/scripts/role-gaps-check.py, this folder.

## Steps
- [x] Phase 0: code read, PLAN.md written (SQL A–D + Q1–Q4 for planner)
- [x] planner go + SQL answers
- [x] jest baseline 115 suites / 2040 tests
- [x] test file written, 9 of 25 fail on 8abee969
- [x] backend guards (25/25 + route guards 291 green)
- [x] FinanceAudit canVerify + isFlagVerified (+ stale-after-verify fix inside the tab)
- [x] build + role-gaps-check.py 36/36 x2; --base on 8abee969 6/6
- [x] jest after 116 suites / 2065 tests; self-debug caught the stale list after Verify (v2)
- [x] merge origin/main (already up to date), push, report

## Rulings
Planner 12 Oct: GO. SQL A = 0 calls ever to /api/tax-declarations*; C = 0 disagreeing flag rows; D = 0 verify calls.
Q1 yes (parent badge uses helper). Q2 keep verified_by fallback. Q3 "Awaiting finance". Q4 no self-read exception.

## CLAUDE.md entry
## Last Session — 2026-10-12 (P3-RG: tax declaration reads role-guarded; HR sees flag status only; finance_verified read)
**Branch `fix/role-gaps-taxdecl-verify`, NOT merged.** Plan + log: `docs/ux-bulk/prs/P3-RG/PLAN.md`, `PROGRESS.md`.
Follow-ups from P2-11 / P2-03. Rulings Q1–Q4 (12 Oct): badge uses the helper; keep the verified_by fallback;
HR text "Awaiting finance"; no self-read exception. Prod (counts): 0 calls ever to /api/tax-declarations*, 0 calls to
manual-flag verify, 0 flag rows where finance_verified and verified_by disagree.
- **Bug 1:** `GET /api/tax-declarations/:code` and `GET /:code/calculate` (projected TDS, reads latest gross) had no
  role guard → viewer / supervisor / employee login could read anyone's. Now the file's `requireHrFinanceOrAdmin`
  (same 403 body as the PUT, runs before the lookup). No app/portal caller exists.
- **Bug 2:** Finance Audit → Attendance Flags showed Verify to HR; the route is finance+admin (P2-11 Q6) → 403 toast.
  Now `canVerify` (normalizeRole finance/admin); HR sees "Awaiting finance" (`data-testid="flag-awaiting-finance"`).
- **Bug 3:** the tab read `f.verified` (no such column; it is `finance_verified`). One helper `isFlagVerified(f)` =
  `finance_verified === 1 || verified_by` for the row, the Unverified/Verified KPIs and the tab badge.
- **Found while testing (fixed in the tab):** after Verify the row and badge stayed unverified for ~5 s (list GET is
  max-age=5, `getManualAttendanceFlags` sends no no-cache). The mutation now marks the row in the react-query cache
  from the 200 and re-reads the server after 6 s. Cleaner fix later: `fresh` on that read in api.js (not owned).
- **Fragile:** the cache patch mirrors the fields the verify route writes (finance_verified, verified_by,
  finance_remarks) — change both together.
- **Verified:** new `taxDeclarationReadGuard.test.js` 25 (real JWTs; 9 fail on 8abee969); full jest 115/2040 → 116/2065.
  `backend/scripts/role-gaps-check.py` (Chromium, built dist, scratch DB, hr + finance, fictional T97xx, port 3406)
  36/36 twice — API viewer/employee 403, hr/finance 200 on both GETs; hr 0 Verify, Awaiting finance ×2, legacy
  finance_verified=1 row ✓, KPIs + badge, 0 PUTs, 390 px; finance verify → DB row, 1 PUT, row ✓ at once, badge 1, still
  ✓ after the re-read; 0 page errors. `--base` on 8abee969 6/6: viewer/employee read 200, hr sees Verify → 403, legacy
  row unverified.
- **Not tested:** Railway; Safari/Firefox; admin in the browser (same gate as finance).
- **Found, not fixed:** Finance Audit's parent component calls `GET /comp-off/pending` (finance+admin only) for the
  tab badge for every role → HR gets one 403 + console error on every Finance Audit load (pre-existing; outside
  owned lines).

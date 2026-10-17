# FRESH — getManualAttendanceFlags reads fresh (register item from P3-RG)

Branch `fix/manual-flags-fresh` on origin/main b0ed242 · worktree /home/claude/wt-fresh · port 3503 · Phase 0 (plan only).

## 1. What is there now (FACT, read on b0ed242)
- `frontend/src/utils/api.js` L380 `getManualAttendanceFlags` sends no `fresh` (server.js GETs are `private, max-age=5`).
- **But the page no longer calls it.** 9e7cd18 (merged, after #160) added a local copy in `FinanceAudit.jsx` L454–458,
  `getManualAttendanceFlagsFresh` = same GET with `Cache-Control: no-cache`, used by the tab (L469–473) and the tab
  badge (L1460–1464, same query key). `getManualAttendanceFlags` in api.js has 0 callers.
- The #160 workaround is still there too: `verifyMutation.onSuccess` (L476–493) patches the row in the cache from the
  200, then `setTimeout(… invalidateQueries(['manual-flags']), 6000)`.
- So the user-visible bug in the register ("stale row up to 5 s after Verify") is already fixed on main; what is left
  is the duplicate helper and the now-pointless 6 s timer.

## 2. Smallest change (decision for Phase 0: keep the instant cache patch, remove the timer)
1. `api.js` L380: add `...fresh` to `getManualAttendanceFlags` (+ one comment line, house style).
2. `FinanceAudit.jsx` (Attendance Flags tab lines only): import `getManualAttendanceFlags`; delete the local
   `getManualAttendanceFlagsFresh` + its comment (L454–458); point both queries (L471, L1462) at the api.js helper —
   same URL, same params, same header, same query key → identical requests.
3. Replace the `setTimeout(…, 6000)` with an immediate `queryClient.invalidateQueries({ queryKey: ['manual-flags'] })`
   right after the cache patch. Why keep the patch: the row flips with no flicker before the refetch lands. Why drop
   the timer: the refetch is no-cache now, so a re-read at once is correct; the timer also fired after the tab was left
   (no cleanup on unmount). Update the stale comment.
The `import api` default import stays only if still used elsewhere in the file (it is not after step 2 — check at build;
remove the import line if unused). No backend change.

## 3. NOT touched
Every other FinanceAudit tab, other api.js lines, backend, CLAUDE.md, schema.js.

## 4. Other reads used right after a write on Finance Audit tabs that lack `fresh` (listed, NOT fixed — Q2)
| Tab | Write | Read refetched (api.js) | fresh? |
|---|---|---|---|
| Report | day correction (L84–91) | `getFinanceReport` L366 | no |
| Report drill-down | correction | `getCorrectionHistory` L369 | no |
| Corrections Summary | (corrections) | `getCorrectionsSummary` L370 | no |
| Manual Interventions | approve-flag / bulk-approve (L739–751) | `getSalaryManualFlags` L382 (+ parent badge L1450) | no |
| Readiness | invalidated by the above | `getReadinessCheck` L385 | no |
| Late Coming | finance review / bulk / reverse | `getFinancePendingDeductions` L495 | no (`getLateComingDeductions` has it) |
| Early Exit (`FinanceEarlyExitApprovals.jsx`) | approve / reject | `getEarlyExitPendingFinance` L598, `getEarlyExitDeductions` L594 | no |
| Comp Off / OD | review / bulk | `getCompOffPending` L294, `getCompOffList` L293 | no |
| Leave Requests | approve / reject | `getLeaveRequests` | yes |
Also seen: L741, L751, L1086–1101, L1769–1782 use the bare-array form `invalidateQueries([...])`, which react-query v5
does not read as a key filter (N-FRESH found it invalidates everything) — same fix pattern as N-FRESH (`{ queryKey }`).

## 5. Tests / checks
`backend/scripts/manual-flags-fresh-check.py` (Chromium, built dist, scratch DB, finance + hr, fictional T95xx flags,
port 3503; copied from `attendance-flags-verify-role-check.py`): both GETs to `/finance-audit/manual-flags` carry
`Cache-Control: no-cache`; Verify → row ✓ + badge −1 at once; exactly one re-read within 1 s of the PUT and none at ~6 s;
reload < 5 s later still verified; leaving the tab within 6 s fires no late request; HR still sees "Awaiting finance";
390 px; 0 page errors / 0 API ≥ 400 (except the known HR `/comp-off/pending` 403). `--base` on b0ed242: re-read arrives at
~6 s. Regression: `role-gaps-check.py`, `attendance-flags-verify-role-check.py`. jest full suite (no backend change); `npm run build`.

## 6. Risks
- Low. Same request as today; only the timing of the re-read changes. The cache patch still mirrors the verify route's
  fields (finance_verified, verified_by, finance_remarks) — fragile note from P3-RG stays.

## 7. Questions
- Q1 OK to delete the local helper and use the api.js one (the line in api.js otherwise stays dead)?
- Q2 Fix any of the §4 reads now (api.js `fresh` + the bare-array invalidations)? Recommend a separate small PR: they span
  Report / Interventions / Late / Early Exit / Comp-off tabs and FinanceEarlyExitApprovals.jsx, outside this PR's lines.

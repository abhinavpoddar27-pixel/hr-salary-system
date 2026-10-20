# PROGRESS — UI/UX + Bulk input programme
**Master plan:** `docs/ux-bulk/MASTER_PLAN.md` · **Builder template:** `docs/ux-bulk/PROMPT_TEMPLATE.md` · **Project mirror:** `claude/ux-bulk/PROGRESS.md`
**Rule:** update this file after every PR state change (planner) and every small build step (builder, in the PR's own `prs/<PR-ID>/PROGRESS.md`). Repo is public: no names, codes, bank/PAN or per-person money here.

---

## RESUME (read first after any compaction)
```
Programme:   UI/UX improvement + bulk input, HR Salary System (Indriyan / Asian Lakto)
Base:        origin/main a5aec9a (10 Oct 2026). Re-check: git fetch origin; git log -1 origin/main
Plan:        docs/ux-bulk/MASTER_PLAN.md (§5.2 = PR order, §6 = specs, §7 = bulk design, §14 = open questions)
Current PR:  27 merged (batch 2 #126–#131 all merged 11 Oct). Open: #132 docs (CLAUDE.md notes). Process: file ownership + integration worktree + no dist/CLAUDE.md in feature PRs; if GitHub 'checking mergeability' stalls > 1 min, merge main into the branch to restart it. Next: batch 3 (P2 foundations).
Asked, not answered: Q1 Q2 Q3 (P3-01/P5-02), Q4 (P1-04) — re-ask before those PRs
Open Qs:     Q1 Q2 (needed by P3-01) · Q4 (P1-04) · Q5 (P1-07) · Q6 (P1-23) · Q10 (one-PR rule) — ask when the PR needs them
Roles:       planner = new chat; builder = Claude Code agent session reading prs/<PR-ID>/PROMPT.md; Abhinav says "go" and merges in GitHub UI
Gates:       Phase 0 plan → "go" → build → self-debug + user sim + v2 → independent review (High/money PRs) → push branch → Abhinav merges → owner post-deploy check → DONE
Never:       push to main · touch fragile files without approval · commit PII · batch findings · skip dist rebuild
```

---

## Owner rulings log (append-only; mirror into MASTER_PLAN §2)
| Date | ID | Ruling |
|---|---|---|
| 10 Oct 2026 | R2 | Finance approves bulk edits to sensitive employee-master fields (reading pending Q3) |
| 10 Oct 2026 | R3 | All-or-nothing per batch, with "leave out error rows" |
| 10 Oct 2026 | R4 | Undo until payroll/reviewer has used the rows |
| 10 Oct 2026 | R5 | Max 50 rows per batch |
| 10 Oct 2026 | R6 | ED bulk: plain paste and tick, simple |
| 10 Oct 2026 | R7 | Start bulk with Extra Duty |
| 10 Oct 2026 | R12 | P1-02: drop the blank monthly Basic/HRA CSV columns (no backend change to the shared endpoint) |
| 10 Oct 2026 | R13 | Held-row marking in Reports → Salary Register is a later separate PR (N-4), not part of P1-02 |
| 10 Oct 2026 | R8 | Save employee time; never make people re-enter the same thing |
| 16 Oct 2026 | B5-scope | Batch 5 = P5-01 + first approval kind, P6-06, FRESH, #151 follow-ups, docs fold #150–#153 |
| 16 Oct 2026 | B5-kind | First approval kind = bulk salary revision (P5-04), money PR |
| 16 Oct 2026 | N-PF | PF wage ceiling change at the same gross needs finance approval |
| 17 Oct 2026 | Q-EM | First open payroll month = earliest month with Stage 7 rows and not finalised (import-only months ignored); owner finalises Feb–Sep 2026 in the app |
| 17 Oct 2026 | N-13 | Re-scoped: create refuses salary fields; bulk employee import raises finance requests (no review queue) |
| 17 Oct 2026 | G1-Q1 | Back-dated DW rate change re-prices drafts only (hr_entered / needs_correction); anything with finance or paid keeps its rate |
| 17 Oct 2026 | B6-review | Second independent money reviews skipped; owner chose merge, then check |

## Answers to open questions (fill as answered)
| Q | Answer | Date |
|---|---|---|
| Q1 | — | |
| Q2 | — | |
| Q3 | — | |
| Q4 | — | |
| Q5 | — | |
| Q6 | — | |
| Q7 | — | |
| Q8 | — | |
| Q9 | — | |
| Q10 | — | |
| Q11 | — | |
| Q12 | C (planner default, owner may override): keep current rows + exclude paid + confirm with count/₹/not-finalized; finalized-only moves to P6-03 | 10 Oct 2026 |

---

## PR tracker
Status values: `todo` · `plan` (Phase 0 written, waiting for go) · `build` · `review` · `pushed` (branch pushed, PR to open) · `merged` · `verified` (owner post-deploy check ok) · `parked`.

| PR-ID | Title | Status | Branch | PR # | Merged SHA | Verified | Notes |
|---|---|---|---|---|---|---|---|
| P0-1 | Owner CP-10 browser check of #78 | todo | — | — | — | — | owner |
| P0-2 | Merge docs PRs (wide-layout-cp9, attendance-review-handoff, ux-bulk-master-plan) | todo | — | — | — | — | owner |
| P0-3 | Triage 6 `new` bug reports | todo | — | — | — | — | owner |
| P1-01 | Finance Audit Readiness click crash | merged | fix/finance-audit-readiness-nav | #81 | 96ee482 | pending owner check | Phase 0 done; go 10 Oct 19:04 incl. held-card link fix to /finance-verification (owner OK) |
| P1-02 | Salary Register ₹0 | merged | fix/salary-register-report-fields | #83 | cc58076 | pending owner check | go 10 Oct 20:17; rulings R12/R13 |
| P1-03 | Sales NEFT excludes paid rows + always confirm | merged #86 | fix/sales-neft-finalized-only | | | | Q12=C; jest 86/1388 merged tree; check 40/40; review SHIP (Low-1,3 fixed) |
| P1-04 | Stage 6 company-scope guard | merged #90 | fix/stage6-company-scope-guard | | | | Q4 default (always all companies); check 28/28, base 4/4 |
| P1-05 | Stage 6 Apply Leave form reset | merged #104 | | | | | |
| P1-06 | Leave rejection reason dropped + require | merged #91 | fix/leave-rejection-reason | | | | check 29/29; jest +5 |
| P1-07 | Retire Payable OT grant tab + endpoint | merged #109 | | | | | Q5, fragile payroll.js |
| P1-08 | Stage 5 grid not refreshed after save | merged #92 | fix/stage5-grid-refresh | | | | +calendar + no-cache; check 34/34 |
| P1-09 | Miss Punch banner based on filter | merged #97 | fix/misspunch-all-resolved-banner | | | | pending+financePending; check 33/33 |
| P1-10 | Night Shift Undo → Reject pairing + confirm | merged #98 | fix/nightshift-undo-relabel | | | | check 44/44 |
| P1-11 | Dashboard All clear on failed call | merged #99 | fix/dashboard-failed-call-not-all-clear | | | | admin + finance views; check 66/66 |
| P1-12 | Sidebar/Header hook order | merged #100 | fix/sidebar-header-hook-order | | | | 6/6 switches crash on main; check 58/58 |
| P1-13 | Finance Verify company filter | MERGED #126| | | | | |
| P1-14 | Bank columns + salary split | MERGED #127| | | | | |
| P1-15 | Finance Verify flag reason + Approve gate | MERGED #112 | | | | | |
| P1-16 | Interventions Reject All | MERGED #113 | | | | | |
| P1-17 | Import overwrite checkbox + month | MERGED #114 | | | | | |
| P1-18 | DW drafts invisible | MERGED #128| | | | | |
| P1-19 | Sales Mark Left date | MERGED #115 | | | | | |
| P1-20 | Leave form Comp Off + date order | MERGED #116 | | | | | |
| P1-21 | Bulk payslips 403 | MERGED #117 | | | | | |
| P1-22 | Salary change approver view | MERGED #118 | | | | | |
| P1-23 | Salary change self-approval | merged #106 | | | | | Q6 |
| P1-25 | Employee edit cannot change salary (N-12) | merged #107 | | | | | |
| P1-24 | Miss Punch stray "0" | merged #105 | | | | | |
| P2-01 | Modal/Confirm on headlessui + useConfirm | todo | | | | | |
| P2-02 | Toast dedup | todo | | | | | |
| P2-03 | Formatters + IST today + DateSelector | todo | | | | | |
| P2-04 | Button / IconButton / StatusBadge | todo | | | | | |
| P2-05 | Scroll-window table pattern | todo | | | | | |
| P2-06 | ReviewQueue extraction | todo | | | | | |
| P2-07 | PeoplePicker + parseCodes | todo | | | | | |
| P2-08 | Timeout modal + return path + useDraft | todo | | | | | |
| P2-09 | ErrorBoundary → Sentry | todo | | | | | |
| P2-10 | Permissions for nav + routes | todo | | | | | |
| P2-11 | Backend guards on unguarded writes | todo | | | | | Q9 |
| P3-01 | Bulk engine + ED bulk grant | todo | | | | | Q1, Q2; fragile schema.js one line |
| P4-01 | Pipeline real status | todo | | | | | |
| P4-02 | Stage links | todo | | | | | |
| P4-03 | Waiting-for-you panel | todo | | | | | |
| P4-04 | DW finance counts | todo | | | | | |
| P4-05 | Sales compute blockers + upload next step | todo | | | | | |
| P4-06 | Alerts revive/remove | todo | | | | | Q7 |
| P4-07 | Loans disburse tile | todo | | | | | |
| P5-01 | Bulk approval stage | todo | | | | | |
| P5-02 | Employee master bulk edit | todo | | | | | Q3, Q11 |
| P5-03 | New joiners bulk | todo | | | | | |
| P5-04 | Salary revision batch | todo | | | | | |
| P6-01 | Miss Punch finance bulk | todo | | | | | |
| P6-02 | DW finance review confirm | todo | | | | | |
| P6-03 | Sales finalise bulk | todo | | | | | |
| P6-04 | TA/DA approvals bulk | todo | | | | | |
| P6-05 | Salary Advance gate/confirm/undo | todo | | | | | |
| P6-06 | Destructive-action confirms | todo | | | | | |
| P6-07 | Remove debug banners | todo | | | | | |
| P7-01 | Shift roster batch | todo | | | | | |
| P7-02 | Miss punch / Stage 5 grid | todo | | | | | |
| P7-03 | Sales grids/uploads | todo | | | | | |
| P7-04 | Later bulk kinds | todo | | | | | |
| P8-01 | Nav regroup | todo | | | | | Q8 |
| P8-02 | Collapsed sidebar | todo | | | | | |
| P8-03 | One company + month control | todo | | | | | |
| P8-04 | Titles, breadcrumbs, Ctrl+K | todo | | | | | |
| P8-05 | One employee record | todo | | | | | |
| P8-06 | 404 + branding | todo | | | | | |
| P9-xx | Design debt (per register) | todo | | | | | one per finding |

---

## New findings (from builds; add to MASTER_PLAN §9 when the plan PR is next touched)
| ID | Found in | Finding | Proposed PR |
|---|---|---|---|
| N-1 | P1-02 | Reports → Audit Trail reads `created_at` (column is `changed_at`) → blank timestamps; endpoint ignores month/year (last 1,000 rows of all time) | new P1 |
| N-2 | P1-02 | Reports → PF / ESI Statement endpoints ignore `company` (both companies mixed) | new P1 |
| N-3 | P1-02 | Reports → Bank Transfer Sheet has no `salary_held = 0` filter (total includes held salaries) | new P1, money-adjacent |
| N-4 | P1-02 | Reports → Salary Register: held rows not marked; LWF/loan only inside Ded. | P9 or with P1-02 if owner says |
| N-5 | P1-03 review | Sales NEFT: preview and download can differ if a row changes while the confirm is open (Low-2); a repeat download within 5 s can come from the browser cache | later PR (money-adjacent) |
| N-6 | P1-06 | Leave reject route: success on a no-op, no audit row, no server-side minimum | later PR |
| N-7 | P1-04 | `getDayCalculations` list has no no-cache → list stale ≤ 5 s after a Stage 6 run | later PR (one line) |
| N-9 | P1-04/08/09/10 | Lists not refetched fresh after an action (server 5 s GET cache, no `fresh`): day-calculations, miss-punches, night-shifts — one cross-cutting PR "fresh reads after mutation" | later PR |
| N-12 | P1-25 | PUT /employees/:code changed gross with no approval and no role guard — FIXED by P1-25 | done |
| N-13 | P1-25 | POST /employees sets gross on create with no approval (P2-11 role-guard PR) | later PR |
| N-14 | P1-23 | approve-flag has no maker-checker; salary-change approvals send no effectiveFrom; SalaryInput lists not no-cache | later PR |
| N-15 | P1-09 | finance gets 403 from leave-automation/status on every Miss Punch visit | later PR (one line) |
| N-16 | P1-16 | MONEY: PUT /finance-audit/bulk-approve rejects GROSS_STRUCTURE_CHANGE without reverting gross (single route does); no finance_rejections/audit row; bulk-approve + approve-flag have no finance/admin role guard | next money PR |
| N-17 | P1-22 | MONEY: approving an Employee Master salary request zeroes conveyance (request has none); Salary Input request zeroes special allowance; effective date = UTC day | next money PR |
| N-18 | P1-15/19/20 | Server-side gaps: flag reason no minimum; sign-off ignores company; Sales mark-left accepts any dol; leaves accept end < start | later PR |
| N-10 | P1-11 | Dashboard KPI/readiness/dept table look like "nothing yet" on failure; salary-manual-flags returns success:true on DB error | later PR |
| N-11 | P1-10/P1-12 | Night-shift reject irreversible + no role guard (→P2-11); no ESLint rules-of-hooks | later |
| N-8 | P1-08 | Stage 5 editor: miss-punch cell stays red after edit; failed save has no page-level error | later PR |

## Session log (newest first; one line per meaningful event)
- 11 Oct 2026 ~11:40 IST — 7 builders (P1-15/16/17/19/20/21/22) built in parallel, planner approved Phase 0s, re-ran all checks on merged trees (32/56/38/40/28/33/57 all pass) → PRs #112–#118, CI green, mergeable.
- 11 Oct 2026 10:16 IST — P1-07 #109 merged (legacy Payable OT grant → 410, tab removed; built by planner directly). Next batch of 7 launched.
- 11 Oct 2026 09:02 IST — #105 #106 #107 merged by owner (re-synced #106/#107 after each merge, CI green). Q5 explained to owner, awaiting yes/no.
- 11 Oct 2026 00:43 IST — all 8 P1 PRs merged (#86 #90 #91 #92 #97 #98 #99 #100); each merge forced a dist/CLAUDE.md re-sync of the rest (done by planner, CI green each time). main = 18bef07.
- 11 Oct 2026 ~00:30 IST — P1-09/10/11/12 built in parallel (planner approved Phase 0s) → PRs #97–#100. All 8 open branches synced with main (dist rebuilt, jest 87–88 suites green). Planner mod `ux-bulk-control` written (pane + /ux-status + status line).
- 10 Oct 2026 ~23:30 IST — P1-03 built (review SHIP, Low-1 double-click guard + Low-3 copy fixed; Low-2 preview/download race → register) → PR #86. P1-04/P1-06/P1-08 built in parallel worktrees, planner approved Phase 0s under owner's programme go → PRs #90 #91 #92. All four synced with main (dist rebuilt, jest green).
- 10 Oct 2026 20:37 IST — P1-02 merged by owner (#83, cc58076).
- 10 Oct 2026 ~20:45 IST — PR #83 had a conflict with main (#82 attendance-review merged): CLAUDE.md only, both entries kept; dist rebuild identical; jest 83/1360 green; pushed 8eba920; GitHub CI all green; Railway PR-preview status 'Deployment cancelled' (preview infra, not code) — noted on the PR.
- 10 Oct 2026 ~20:50 IST — P1-03 Phase 0 PLAN @9d1a332: generateSalesNEFT excludes paid + new preview totals; modal always shown; sales.js unchanged; Jul–Sep files would be byte-identical (0 paid rows).
- 10 Oct 2026 20:29 IST — Owner: "why do I need to ask every time" → planner now opens PRs itself (via REST) and sends the link; P1-02 PR #83 opened. P1-03 started with Q12=C default.
- 10 Oct 2026 ~20:45 IST — P1-03 diagnostics: Sentry 0; sales Jul–Sep 0 finalized rows (Jul 224 computed/10 reviewed, Aug 247/2, Sep 215/0; holds 9/6/15); NEFT exported for 189 Jul + 187 Sep rows that were NOT finalized; last finalize 2 Jun (231). 7 NEFT downloads ever. Plan's finalized-only rule conflicts with live workflow → asked owner (Q12) before writing the prompt.
- 10 Oct 2026 ~20:40 IST — P1-02 built + pushed @3d6c7fa: Reports.jsx +10/−14; check 58/58 (planner re-ran: 58/58), --base 6/6 shows ₹0; jest 81/1332 before+after.
- 10 Oct 2026 20:17 IST — Owner go on P1-02 with both recommendations (R12, R13). P1-02 builder resumed; P1-03 diagnostics started in a separate worktree.
- 10 Oct 2026 ~19:50 IST — P1-02 diagnostics (prod Sep 211 rows/19 held; endpoint shared with Stage 7, 1,526 calls/90d → no backend change). PROMPT 5.3 KB → builder Phase 0 → PLAN @55337b2; 4 new findings N-1…N-4 logged.
- 10 Oct 2026 19:34 IST — P1-01 merged by owner (#81, 96ee482). Post-deploy check sent; P1-02 diagnostics started.
- 10 Oct 2026 ~19:30 IST — P1-01 built + pushed @1e8363b: 4 lines in FinanceAudit.jsx + held-card link; check script 31/31 (planner re-ran independently: 31/31), origin/main 5/5 shows the crash; jest 81/1332 green before+after. Low/non-money → no independent review. Next: P1-02 Phase 0 after owner merges or says continue.
- 10 Oct 2026 19:04 IST — Owner "go" on P1-01 (with the held-card link fix). Builder resumed for build → verify → push. Q1–Q4 asked, no answer yet.
- 10 Oct 2026 ~19:30 IST — Planner session start: origin/main a5aec9a; 3 docs branches NOT merged and have no PR open; push access OK after add_repo; open PRs #59 (leave), #42 (server.js), #8 (stale Apr, touches salaryComputation.js — close?). No collision with FinanceAudit.jsx. P1-01 diagnostics (Sentry 0 — frontend not reported; readiness 821 calls/90d; 265 Aug + 206 Sep unapproved manual flags). PROMPT.md 34/35 → builder Phase 0 → PLAN.md @619e28d.
- 10 Oct 2026 ~19:00 IST — Master plan v1 written (branch `docs/ux-bulk-master-plan`). Audit + bulk ideation + PR-1 plan folded in. No code changed.

- 11 Oct 2026 ~16:05 IST — #120 merged: dist out of git, CLAUDE.md edits only via docs PRs. Production verified serving the Railway-built bundle. #116–#118 given one final sync (dist dropped, CLAUDE.md entries moved to their PROGRESS.md); green + clean.
- 11 Oct 2026 ~16:30 IST — #116, #117, #118 merged back to back with no re-sync (new process working). Batch P1-15…P1-22 complete.

## Batch 2 (11 Oct 2026 ~16:45 IST) — file ownership to prevent conflicts
| Build | Branch | Owned files |
|---|---|---|
| P1-13 | fix/finverify-company-scope | FinanceVerification.jsx, routes/financeVerification.js, (financeRedFlags.js), api.js finance-verification block only |
| P1-14 ★ | fix/employee-bank-columns | Employees.jsx, routes/employees.js, (exportFormats.js read path) |
| P1-18 | fix/dw-drafts-visible | DailyWageBatchImport.jsx, DailyWageRecords.jsx |
| N-REP (N-1/2/3) | fix/reports-company-held-audit | routes/reports.js, Reports.jsx |
| N-MONEY ★ (N-16/17) | fix/salary-flag-reject-revert | routes/financeAudit.js (approve-flag, bulk-approve), routes/salary-input.js (approve) |
| N-FRESH (N-7/9/15) | fix/fresh-reads-after-actions | api.js 3 read helpers only, DayCalculation.jsx, MissPunch.jsx, NightShift.jsx |
Rule: a builder touching a file it does not own STOPS and asks. Before each PR the planner runs `git merge-tree` of every
open branch against main AND against each other; any overlap is fixed before the PR goes up.
- 11 Oct 2026 ~17:50 IST — batch 2 built (6 parallel builders, file ownership), money reviews SHIP WITH FIXES applied, integration tree green, PRs #126–#131 open.
### New findings (batch 2)
| N-19 | P1-14 | PUT /employees/:code/salary same-gross split change rewrites components with no finance approval; `parseFloat(x)||50` turns 0% basic into 50% | later money PR |
| N-20 | P1-13 | 2 months in 2026 finalised with 0 sign-off rows ever (pre-gate or another path) | owner check |
| N-21 | P1-14 | 114 active employees have an account but no IFSC in either pair → never in NEFT; 321/434 empty strings in account_number/ifsc_code | owner data repair |
| N-22 | N-MONEY | 43 employees had conveyance wiped to 0 by approved salary changes; 1 Mar-2026 gross flag bulk-rejected, never reverted | owner data repair |
| N-23 | N-MONEY review | approve-flag / bulk-approve have no maker-checker; a revert leaves the salary_change_request Approved; Stage 7 re-run needed after revert | later |
| N-24 | N-FRESH | floating Salary Explainer button covers row buttons at the bottom of long tables | later UI |
- 11 Oct 2026 ~20:50 IST — batch 2 fully merged (#126–#131). #132 docs PR folds 9 CLAUDE.md entries.

## Batch 3 (12 Oct 2026) — 7 PRs, integration-tested together, merge in any order
Base main fa430144. No shared files. Combined tree: jest 109/1963, build OK, every batch check green (errorboundary needs a fake-DSN build: `VITE_SENTRY_DSN=https://public@o0.ingest.invalid/1`; that same build makes other checks see a console error, so build without it for them).

| ID | PR | Branch | Result |
|---|---|---|---|
| P2-01 Dialog + useConfirm | #133 | feat/ui-dialog-confirm | 111/111, CI green, clean |
| P2-03 IST today | #134 | feat/formatters-ist-today | 26/26 + unit 24/24, clean |
| P2-ED shared components | #135 | feat/ed-shared-components | 64/64, ED 25/25 + 16/16, clean |
| P2-07 PeoplePicker + parseCodes | #136 | feat/people-picker-parse-codes | 40/40, aria 9/9, clean |
| P2-08 timeout dialog + drafts | #137 | feat/timeout-modal-drafts | 57/57, clean |
| P2-09 ErrorBoundary → Sentry | #138 | feat/errorboundary-sentry | 36/36, clean |
| P2-11 route guards (35 routes) | #139 | fix/backend-route-guards | jest 291 new, 22/22, clean |

After merge: one docs PR folds the 7 "## CLAUDE.md entry" blocks from each branch's PROGRESS.md.

### Owner items (batch 3)
- Railway `VITE_SENTRY_DSN` malformed → frontend events dropped (task in P2-09 PROGRESS).
- payroll.js calculate-days / compute-salary / finalise have no role guard (protected file; suggest hr/finance/admin).
- Data repairs pending: 43 employees with conveyance wiped; 1 unreverted Mar-2026 flag; 114 without IFSC; 2 months finalised with no sign-off.

### New findings (batch 3)
- More UTC "today" sites: GatePasses:206, DailyWageContractors:161, Employees:857/1008, useDateSelector:21, EmployeeProfile, DailyWageFinanceReview:58, DeptAnalytics, DailyMIS:1026.
- FinanceAudit reads `f.verified` (field name check needed).
- ED `btn-warning` class does not exist.
- SQL Console writes share the app DB connection — other app writes during an open preview are rolled back with it.
- GET /api/tax-declarations/:code has no role check.
- POST /employees accepts gross on create (P2-11 noted; = earlier P2-11 follow-up).
- HR still sees the manual-flag Verify button, which now answers 403.
- Login limit 5 per 15 min is not configurable.

### Batch 3 close-out (12 Oct 2026 ~00:40 IST)
- #133–#139 all MERGED. #140 MERGED: statutoryWriters T9b built "today" in UTC while the route stamps IST (since #130) → failed nightly 00:00–05:30 IST; test now uses IST. Full suite run inside that window: only T9b failed, so no other date-boundary test.
- #141 MERGED: CLAUDE.md entries for batch 3.
- Lesson: run the full jest once between 00:00–05:30 IST in the integration step when a batch touches date handling.

## Batch 4 (12 Oct 2026) — PRs #155–#160, ALL MERGED 12 Oct (docs fold #162; symlink cleanup #161)
| PR | ID | Branch | Review | Checks |
|---|---|---|---|---|
| #155 | P3-01 bulk engine + ED bulk grant + F-11 | feat/bulk-ed-grant | SHIP WITH FIXES → F1 (undo compares whole row), F2 (save guard), F3 (text) applied | jest +22, bulk-ed 50/50 |
| #156 | P3-PG payroll Stage 6/7/finalise guard | fix/payroll-stage-role-guard | SHIP | jest 20, script 21/21 |
| #157 | P2-10 + P8-06 permissions, 404, name/version | feat/permissions-nav-guard | — | nav 80/80, hooks 58/58 |
| #158 | P2-02 toast dedup | fix/toast-dedup | — | 29/29 + unit 10/10 |
| #159 | P3-IST remaining IST "today" | fix/ist-today-remaining | — | 24/24 |
| #160 | P3-RG tax-decl read guard, Verify hidden for HR, f.verified | fix/role-gaps-taxdecl-verify | — | jest 25, 36/36 |
Integration (all 6 on 8abee969): jest 119/2120, build clean, all batch-4 checks + regressions (ED review 25, dialogs 111, fresh reads 39, reports 55, timeout 57) pass. No shared file.

### Rulings (12 Oct)
- Owner: Q1 P3-01 "Also approve as HR" offered, ticked. Q2 auto-split 50+50+9. Payroll guard hr/finance/admin (usage 90 d: only those roles). P2-10 viewer/supervisor follow the matrix (5 / 2 items); /settings admin only.
- Planner: P3-01 one HR_BULK_CREATE audit row per grant; bulk routes HR/admin only; Left codes stay in the picker's "Has left" line. P2-10 fail-open with amber note; name "HR & Salary System"; version v<pkg> · <sha>. P2-02 page text wins, 1.5 s window. P3-IST JS month rollover kept; backend fallbacks → register. P3-RG no employee self-read (0 calls ever).

### New register items
- Stage 6/7 Run/Compute/Finalise buttons visible to roles the server now refuses (UI hide).
- Server reads open to viewer (salary register etc. readable by API).
- Supervisor Daily MIS → 403 on /leaves/on-leave-today; HR Finance Audit → 403 on /comp-off/pending (badge).
- getManualAttendanceFlags lacks `fresh` (P3-RG works around).
- P3-IST-BE: 36 backend UTC "today" lines in 11 routes; money one = new salary structure effective_from (employees.js:317/580).
- Browser-clock month/year defaults: appStore.js:57-58, SalaryExplainer, LoanImport, LoanActionModals, SalesHolidayMaster, ContractorReport; loanUi.js own IST copy; minusMonthsIso duplicated (EmployeeProfile, DeptAnalytics) → formatters.js.
- Single "+ New Grant" takes company from the top-bar filter, no active / finalised-month check.

### Batch 4 close-out
- All six merged 12 Oct. #159 stalled because commit 571e6bd5 (#155) committed two node_modules symlinks (planner's `git add -A`); main deploy was unaffected. #161 untracks them and ignores node_modules as file or dir. #162 folds CLAUDE.md entries + the staging rule.

## Batch 5 (16 Oct 2026) — PRs #166–#171, ALL MERGED 16 Oct
| PR | ID | Branch | Review | Checks |
|---|---|---|---|---|
| #166 | P5-01 bulk engine approval stage + Bulk batches queue | feat/bulk-approval-stage | SHIP WITH FIXES (F1–F5 applied) | bulkApproval 18, check 36/36 |
| #167 | N-PF PF ceiling change → finance approval | fix/pf-ceiling-approval | SHIP (4 Lows registered) | pfCeilingApproval 14, check 38/38 |
| #168 | F151 Reverted badge, ED approve skipped toast | fix/n-money2-followups | — | 16/16 |
| #169 | P6-06 confirms before destructive actions | feat/destructive-confirms | — | 115/115 |
| #170 | FRESH manual flags no-cache, immediate re-read | fix/manual-flags-fresh | — | 20/20 |
| #171 | docs fold #150–#153 | docs/claude-md-batch4b | — | — |

## Batch 6 (17–19 Oct 2026) — PRs #172–#178, ALL MERGED 19 Oct (main b2badcab)
| PR | ID | Branch | Review | Checks |
|---|---|---|---|---|
| #172 | P5-04 bulk salary revision (money) | feat/bulk-salary-revision | review 1 SHIP WITH FIXES (H1/M2/L3 fixed); review 2 skipped by owner | bulkSalaryRevision 26, check 44/44, parse 11/11 |
| #173 | N-13 salary only via approval (money) | feat/n13-new-salary-review | skipped by owner | newEmployeeSalaryGate 26, HTTP 26/26 |
| #174 | FRESH-2 Finance Audit no-cache + prefix invalidation | fix/finance-audit-fresh-reads | — | 38/38 |
| #175 | G1 DW rate from effective date, drafts re-priced (money) | fix/dw-rate-effective-date | skipped by owner | dwRateEffectiveDate 10, 28/28 |
| #176 | G2 DW rate proposer cannot decide | fix/dw-rate-maker-checker | — | dwRateMakerChecker 9, 28/28 |
| #177 | G3 document soft delete + audit | fix/doc-delete-audit | — | 8 tests, 22/22 |
| #178 | STAGE-BTN hide refused buttons; comp-off badge finance only | fix/stage67-button-roles | — | 32/32 |
Merge: one employees.js conflict (#172 vs #173) resolved by keeping main's salarySplit helpers + N-13's raiseSalaryChangeRequest. Post-merge on b2badcab (19 Oct): jest 130/2309, build clean, 13 check scripts 0 failures. Production: running b2badcab; bulk_batches columns present; employee_documents soft-delete columns added on first documents use (0 rows); drift = the 1 known Feb 2026 row; first open payroll month = Feb 2026 (only Jan finalised).

### New register items (batches 5–6)
- FRESH-3: 18 bare-array invalidateQueries on Settings 7, Employees 3, Compliance 2, FinanceVerification 2, Import 2, WorkforceAnalytics 2.
- PF-S7: Stage 7 caps PF with the policy ceiling, not per-employee pf_wage_ceiling.
- N-PF lows: non-numeric/huge ceiling, gross 0 with split/ceiling says "updated", already-pending drops new values.
- Q-B6: after a bulk revision Stage 7 raises GROSS_STRUCTURE_CHANGE flags → finance approves twice.
- BulkBatchList "View rows" uses ED wording for every kind.
- G2: requester Withdraw; admin can still propose DW rate changes.
- G3: no restore screen for removed documents; documents list/download reads not role-guarded; DOCS_DIR persistence unverified.
- N-13b: bulk employee import still creates employee rows without finance review (gross now goes through requests).
- Fail-open viewer on Stage 6/7 reads /features/salary-stale and /finance-audit/leave-requests → 403 (pre-existing).

### Owner items after batch 6
- Finalise Feb–Sep 2026 (sign-off → Finalise; irreversible) so P5-04 accepts Oct dates.
- The one pending DW rate change (effective 10 Apr, raised by admin) must be decided by the other finance/admin user; re-prices 1 draft.
- Railway: confirm DOCS_DIR is on a persistent volume.


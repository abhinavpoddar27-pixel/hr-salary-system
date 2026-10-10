# PROGRESS — UI/UX + Bulk input programme
**Master plan:** `docs/ux-bulk/MASTER_PLAN.md` · **Builder template:** `docs/ux-bulk/PROMPT_TEMPLATE.md` · **Project mirror:** `claude/ux-bulk/PROGRESS.md`
**Rule:** update this file after every PR state change (planner) and every small build step (builder, in the PR's own `prs/<PR-ID>/PROGRESS.md`). Repo is public: no names, codes, bank/PAN or per-person money here.

---

## RESUME (read first after any compaction)
```
Programme:   UI/UX improvement + bulk input, HR Salary System (Indriyan / Asian Lakto)
Base:        origin/main a5aec9a (10 Oct 2026). Re-check: git fetch origin; git log -1 origin/main
Plan:        docs/ux-bulk/MASTER_PLAN.md (§5.2 = PR order, §6 = specs, §7 = bulk design, §14 = open questions)
Current PR:  ALL 8 MERGED 11 Oct 00:10–00:43 IST: P1-03 #86, P1-04 #90, P1-06 #91, P1-08 #92, P1-09 #97, P1-10 #98, P1-11 #99, P1-12 #100 (main 18bef07). Owner post-deploy checks pending → verified. Next: P1-05 (DayCalculation leave form reset), P1-24 (Miss Punch stray 0), P1-13/15/16/17/19/20/21/22; N-9 fresh-reads PR. Owner Qs pending: Q5 (P1-07), Q6 (P1-23). Lesson: merge-time conflicts are only frontend/dist + CLAUDE.md top — re-sync after each merge (scratchpad syncfast.sh, builds one at a time — parallel vite builds OOM).
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
| P1-05 | Stage 6 Apply Leave form reset | todo | | | | | |
| P1-06 | Leave rejection reason dropped + require | merged #91 | fix/leave-rejection-reason | | | | check 29/29; jest +5 |
| P1-07 | Retire Payable OT grant tab + endpoint | todo | | | | | Q5, fragile payroll.js |
| P1-08 | Stage 5 grid not refreshed after save | merged #92 | fix/stage5-grid-refresh | | | | +calendar + no-cache; check 34/34 |
| P1-09 | Miss Punch banner based on filter | merged #97 | fix/misspunch-all-resolved-banner | | | | pending+financePending; check 33/33 |
| P1-10 | Night Shift Undo → Reject pairing + confirm | merged #98 | fix/nightshift-undo-relabel | | | | check 44/44 |
| P1-11 | Dashboard All clear on failed call | merged #99 | fix/dashboard-failed-call-not-all-clear | | | | admin + finance views; check 66/66 |
| P1-12 | Sidebar/Header hook order | merged #100 | fix/sidebar-header-hook-order | | | | 6/6 switches crash on main; check 58/58 |
| P1-13 | Finance Verify company filter | todo | | | | | |
| P1-14 | Bank columns + salary split | todo | | | | | |
| P1-15 | Finance Verify flag reason + Approve gate | todo | | | | | |
| P1-16 | Interventions Reject All | todo | | | | | |
| P1-17 | Import overwrite checkbox + month | todo | | | | | |
| P1-18 | DW drafts invisible | todo | | | | | |
| P1-19 | Sales Mark Left date | todo | | | | | |
| P1-20 | Leave form Comp Off + date order | todo | | | | | |
| P1-21 | Bulk payslips 403 | todo | | | | | |
| P1-22 | Salary change approver view | todo | | | | | |
| P1-23 | Salary change self-approval | todo | | | | | Q6 |
| P1-24 | Miss Punch stray "0" | todo | | | | | |
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
| N-10 | P1-11 | Dashboard KPI/readiness/dept table look like "nothing yet" on failure; salary-manual-flags returns success:true on DB error | later PR |
| N-11 | P1-10/P1-12 | Night-shift reject irreversible + no role guard (→P2-11); no ESLint rules-of-hooks | later |
| N-8 | P1-08 | Stage 5 editor: miss-punch cell stays red after edit; failed save has no page-level error | later PR |

## Session log (newest first; one line per meaningful event)
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

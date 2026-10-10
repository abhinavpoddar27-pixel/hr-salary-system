# PROGRESS — UI/UX + Bulk input programme
**Master plan:** `docs/ux-bulk/MASTER_PLAN.md` · **Builder template:** `docs/ux-bulk/PROMPT_TEMPLATE.md` · **Project mirror:** `claude/ux-bulk/PROGRESS.md`
**Rule:** update this file after every PR state change (planner) and every small build step (builder, in the PR's own `prs/<PR-ID>/PROGRESS.md`). Repo is public: no names, codes, bank/PAN or per-person money here.

---

## RESUME (read first after any compaction)
```
Programme:   UI/UX improvement + bulk input, HR Salary System (Indriyan / Asian Lakto)
Base:        origin/main a5aec9a (10 Oct 2026). Re-check: git fetch origin; git log -1 origin/main
Plan:        docs/ux-bulk/MASTER_PLAN.md (§5.2 = PR order, §6 = specs, §7 = bulk design, §14 = open questions)
Current PR:  P1-01 — phase `pushed` @1e8363b (owner: open PR in GitHub UI + merge, then post-deploy check). Was: `build` (go 10 Oct 19:04 IST incl. /finance-verify → /finance-verification link fix). Builder progress: docs/ux-bulk/prs/P1-01/PROGRESS.md on fix/finance-audit-readiness-nav
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

---

## PR tracker
Status values: `todo` · `plan` (Phase 0 written, waiting for go) · `build` · `review` · `pushed` (branch pushed, PR to open) · `merged` · `verified` (owner post-deploy check ok) · `parked`.

| PR-ID | Title | Status | Branch | PR # | Merged SHA | Verified | Notes |
|---|---|---|---|---|---|---|---|
| P0-1 | Owner CP-10 browser check of #78 | todo | — | — | — | — | owner |
| P0-2 | Merge docs PRs (wide-layout-cp9, attendance-review-handoff, ux-bulk-master-plan) | todo | — | — | — | — | owner |
| P0-3 | Triage 6 `new` bug reports | todo | — | — | — | — | owner |
| P1-01 | Finance Audit Readiness click crash | pushed | fix/finance-audit-readiness-nav | — | — | — | Phase 0 done; go 10 Oct 19:04 incl. held-card link fix to /finance-verification (owner OK) |
| P1-02 | Salary Register ₹0 | todo | | | | | |
| P1-03 | Sales NEFT unfinalised rows + confirm | todo | | | | | |
| P1-04 | Stage 6 company-scope guard | todo | | | | | Q4 |
| P1-05 | Stage 6 Apply Leave form reset | todo | | | | | |
| P1-06 | Leave rejection reason | todo | | | | | |
| P1-07 | Retire Payable OT grant tab + endpoint | todo | | | | | Q5, fragile payroll.js |
| P1-08 | Stage 5 grid refresh | todo | | | | | |
| P1-09 | Miss Punch "all resolved" banner | todo | | | | | |
| P1-10 | Night Shift Undo = reject | todo | | | | | |
| P1-11 | Dashboard "All clear" on failure | todo | | | | | |
| P1-12 | Sidebar/Header hooks crash | todo | | | | | |
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

## Session log (newest first; one line per meaningful event)
- 10 Oct 2026 ~19:30 IST — P1-01 built + pushed @1e8363b: 4 lines in FinanceAudit.jsx + held-card link; check script 31/31 (planner re-ran independently: 31/31), origin/main 5/5 shows the crash; jest 81/1332 green before+after. Low/non-money → no independent review. Next: P1-02 Phase 0 after owner merges or says continue.
- 10 Oct 2026 19:04 IST — Owner "go" on P1-01 (with the held-card link fix). Builder resumed for build → verify → push. Q1–Q4 asked, no answer yet.
- 10 Oct 2026 ~19:30 IST — Planner session start: origin/main a5aec9a; 3 docs branches NOT merged and have no PR open; push access OK after add_repo; open PRs #59 (leave), #42 (server.js), #8 (stale Apr, touches salaryComputation.js — close?). No collision with FinanceAudit.jsx. P1-01 diagnostics (Sentry 0 — frontend not reported; readiness 821 calls/90d; 265 Aug + 206 Sep unapproved manual flags). PROMPT.md 34/35 → builder Phase 0 → PLAN.md @619e28d.
- 10 Oct 2026 ~19:00 IST — Master plan v1 written (branch `docs/ux-bulk-master-plan`). Audit + bulk ideation + PR-1 plan folded in. No code changed.

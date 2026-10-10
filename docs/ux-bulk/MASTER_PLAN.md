# MASTER PLAN — UI/UX improvement + Bulk input (HR Salary System)
**Version:** v1 · **Written:** Sat 10 Oct 2026, ~19:00 IST · **Base:** `origin/main a5aec9a` (after #78 wide layout, #79 ED finance-review UX)
**Owner:** Abhinav Poddar (sole decision-maker) · **Planner:** the new Claude chat · **Builder:** Claude Code agent sessions
**Companion files:** `docs/ux-bulk/PROGRESS.md` (live tracker + RESUME block) · `docs/ux-bulk/PROMPT_TEMPLATE.md` (builder prompt skeleton) · `docs/ux-bulk/REGISTER.xlsx` is in the Claude Project only (`claude/ux-bulk/REGISTER.xlsx`)
**Repo is PUBLIC.** This file and everything committed must carry **no employee names, codes, bank/PAN data or per-person money**. Aggregates only. Personal data lives in the private Claude Project or the database.

Tags used everywhere: **FACT** (checked in code or production, read-only) · **INFERENCE** (reasoned, not proven) · **OPINION** (recommendation) · **[V]** re-verified by hand · **[A]** found by an audit agent in code, not re-checked.

---

## Contents
0. How to use this document
1. Context and goals
2. Owner rulings (binding)
3. Evidence base (production + code)
4. Guiding principles (incl. "never enter the same thing twice")
5. The roadmap — phases and PR list
6. Phase specs (P0 → P9) — every PR with scope, files, DO NOT MODIFY, tests, acceptance
7. Bulk system design (engine + UI kit + per-kind specs)
8. UX foundations that bulk depends on (what must exist first and why)
9. Full findings register (all ~100 items)
10. Working rules for builders (non-negotiable)
11. Verification protocol
12. Landmines
13. Parallel work streams and collision rules
14. Open questions (ask before the PR that needs them)
15. Glossary of IDs

---

## 0. How to use this document
- The **planner chat** owns this plan. It decides the next PR, writes the builder prompt into `docs/ux-bulk/prs/<PR-ID>/PROMPT.md`, launches a Claude Code builder session on it, reviews the Phase 0 plan, relays it to Abhinav for "go", supervises the build, verifies independently, and updates `PROGRESS.md`.
- **Order is fixed by §5** unless Abhinav changes it. A PR does not start until its "Depends on" PRs are merged.
- **One finding = one PR** (project rule — batching once caused a 26-commit regression chain). The only exception is §10 rule 2.
- Every PR has a Phase 0 gate: the builder lists files, STOPS, and waits for Abhinav's "go".
- After any context compaction, the planner re-reads `PROGRESS.md` → RESUME block first, then this file's relevant section. Never rely on chat memory.
- When a PR finishes, the planner updates: `PROGRESS.md` (repo), the project mirror `claude/ux-bulk/PROGRESS.md`, the register row status, and CLAUDE.md's "Last Session" entry (builder does this inside the PR).

---

## 1. Context and goals
**System.** Payroll + HR app for Indriyan Beverages Pvt Ltd and Asian Lakto Ind Ltd (Ludhiana). React (Vite, Tailwind, react-query, zustand) frontend; Node/Express backend; **SQLite via better-sqlite3** (not PostgreSQL, despite older docs); Railway serves the committed `frontend/dist`. Plant payroll is a 7-stage monthly pipeline (Import → Miss Punch → Shift Check → Night Shift → Corrections → Day Calc → Salary). Sales payroll runs 26th–25th from coordinator Excel uploads. Roles: admin, hr, finance, viewer, supervisor.

**Users (FACT, last 30 days):** 6 active people — 3 HR, 1 finance, 1 admin, 1 viewer. Design for HR clerks first, finance second.

**Goal 1 — UI/UX.** Remove screens that show false states or do something other than their label; make "what do I do next" obvious; one approval pattern; a consistent shell; pay down design-system debt.
**Goal 2 — Bulk input.** Replace one-by-one keying in the highest-volume manual flows with bulk forms, spreadsheet grids, file uploads and "apply to selected", all through one shared batch engine — **without making anyone enter the same thing twice**.
**Order (owner):** first make sure the UI/UX that bulk entry depends on exists and works; then build bulk on top.

**Out of scope:** mobile optimisation (separate project; at 390 px six pages still scroll sideways — known), salary/day-calculation formula changes, the attendance-review Analytics tab (its own stream, §13).

---

## 2. Owner rulings (binding unless Abhinav changes them)
| # | Date | Ruling |
|---|---|---|
| R1 | 10 Oct 2026 | Desktop first; mobile is a separate later project. Stage 7 wide-layout rulings (#78) stand: every register column stays individually visible; views Review/Statutory/Everything; pins; sticky header; totals = cards. |
| R2 | 10 Oct 2026 | Bulk edits to **sensitive employee-master fields are approved by finance**. Reading pending confirmation (Q3): sensitive = bank details, statutory numbers (PAN/UAN/ESI no.), status/Left, salary; shift, punch no., department, designation apply directly. |
| R3 | 10 Oct 2026 | Failure policy: **all-or-nothing per batch**, with "leave out error rows" before saving. |
| R4 | 10 Oct 2026 | Undo: allowed **until payroll or a reviewer has used the rows**. |
| R5 | 10 Oct 2026 | **Maximum 50 rows per batch.** (Q2: may one screen save 109 rows as 3 batches automatically?) |
| R6 | 10 Oct 2026 | Extra duty bulk: **plain paste and tick, simple and easy** — no biometric "suggested people". |
| R7 | 10 Oct 2026 | Start bulk with **Extra Duty bulk grant**. |
| R8 | 10 Oct 2026 | Standing goal: the build must **save employee time and never make people enter the same thing again and again**. |
| R9 | 8 Oct 2026 | Only finance may reopen a finance-rejected ED grant ("Return to HR"); HR cannot override a finance rejection. |
| R10 | standing | Statutory PF/ESI/LWF flags change by upload only (statutory-flags project). Bulk master edit must not offer these fields. |
| R11 | standing | Never push to main; merge in the GitHub web UI only; Phase 0 gate on every build; fragile files untouched without explicit approval (§10). |

---

## 3. Evidence base
### 3.1 Production usage (FACT, 10 Jul – 10 Oct 2026, page views / distinct users)
Dashboard 1147/6 · Login 916/6 · Stage 7 571/5 · Employees 553/4 · Miss Punch 446/5 · Corrections 445/4 · Extra Duty 334/4 · Sales Employees 324/3 · TA/DA Register 229/3 · Stage 6 206/4 · Sales Compute 198/3 · Import 144/4 · Salary Advance 138/4 · Finance Verify 121/5 · Punctuality 105/5 · Daily MIS 104/3 · Leave 99/5 · Reports 89/3 · Finance Audit 70/6 · Salary Input 59/3 · Shift Check 57/4 · Employee Profile 55/4. Everything else < 55.
- Login views (916) ≈ sessions (950): nearly every session starts at the login screen → session expiry is felt daily (INFERENCE from the ratio).
- Only client-side error class ever recorded: Finance Audit, 35× `setActiveTab is not defined` (F-5).
- `alerts` table: 0 rows, ever (H-6).
- Bug-report inbox: 6 reports still `new` since May; some submitted twice.

### 3.2 Manual keying volume (FACT, audit_log + source tables, 10 Jul – 10 Oct unless stated)
| Flow | Volume | Shape |
|---|---|---|
| Extra duty — Gate Register grants | 943 manual (Jun–Sep, ≈235/month) + 763 BIOMETRIC_AUTO + 30 Production Office | Same date/type for many people. One date in Sep: 109 grants, all identical except the person (1 type, 1 duty-days value, 1 reference, 2 remark texts, 2 companies); created one at a time — 109 distinct timestamps over 54 distinct minutes, ~3¾ h, one user. 102 of those 109 people were also granted on an earlier date that month. 2 of the 109 were not Active in the master. |
| ED HR approval | 915 of 973 manual grants approved by the same user who created them | The HR "approve" is mostly a second click on one's own entry |
| Miss punch HR resolution (Stage 2) | 1,022 edits on 788 records, 1 user | IN/OUT per row; finance side already bulk (923 bulk approvals) |
| Employee master edits | 642 field edits on 299 employees, 3 users | shift_assignment 581 (233 in one day), status 108 (51 in one day), salary_structure 59, created 54 (17 in one day), punch_no 44, bank fields 23 |
| Salary change requests | 155 (76 on one day — increment cycle) | One per employee; **no audit_log rows** for these requests |
| Sales TA/DA inputs | 666 edits on 109 records | Number grid |
| Stage 5 corrections | 272 edits on 64 records | Several days per person; new-joiner backfill (open bug report) |
| Sales master | 256 edits on 103 records | Same as employee master |
| Sales incentive / bonus / other ded | 98 edits on 74 rows | Saves on blur, no audit found |
| Employee creation | 65 new (17 in one day) | Full record per person |

### 3.3 Code facts the plan relies on
- `getDb()` (`backend/src/database/db.js:7`) returns a single shared better-sqlite3 connection → `logAudit()` called inside `db.transaction(...)` **is** part of that transaction. (Corrects an earlier note; no transaction-bound audit helper is needed.) `logAudit` swallows its own errors.
- `isMonthFinalized(db, company, month, year)` exists in `services/leaveTriggers.js:54` (reads `monthly_imports.is_finalised`).
- ED single create `POST /api/extra-duty-grants` (`routes/extraDutyGrants.js` ~L159): IMMEDIATE transaction; inserts, or upgrades an untouched BIOMETRIC_AUTO row in place; 409 with `returnHint` otherwise; PBA conflict refused. It does **not** check that the employee exists / is Active, nor finalised month. HR bulk approve exists (`/bulk-approve`), finance bulk approve/return exist (#76/#79).
- Best existing bulk pattern: `services/loans/importer.js` (staged batch, per-row state, `bulkPlan` eligible vs skipped with reasons, `inTxn` rollback on `ok:false`, self-approval refusal, sha256 + row-key idempotency). Statutory flags add the preview-hash handshake + re-plan inside the transaction + undo file. Sales templates add a master-snapshot hash.
- File parsing: SheetJS `xlsx` 0.18.5 front and back. No generated template has dropdowns/validation today.
- Shared UI that exists but is **unused**: `DataTable` (0 imports), `EmptyState` (0), `OnboardingWizard` (0); `@headlessui/react` installed, 0 imports. `ConfirmDialog` used in 6 files; native `confirm()` ×7, `prompt` ×1, `alert` ×2.
- Month/year persist globally via `useDateSelector({syncToStore:true})` on 22 pages; 4 pages keep their own month (ContractorReport, DailyWageReports, StatutoryFlags, QueryTool). Company: Header has a hard-coded dropdown; `CompanyFilter` (API list) is on 30 pages; both write the same store key.
- Unguarded write routes (no role check beyond login): `attendance.js` writes, `advance.js`, `import.js`, parts of `payroll.js` (incl. legacy `grant-extra-duty`), `lifecycle.js`, `employees.js` bulk-set-contractor (~L1071). Viewer write protection is UI-only (known, "Option B deferred").
- Recompute triggers: `queueLeaveRecalc` is debounced/merged; `checkAutoStage6` can auto-fire Stage 6; recompute sets `salary_stale`; TA/DA recomputes per row; finalised-month writes raise `leave_change_flags`.

---

## 4. Guiding principles
### 4.1 Never enter the same thing twice (R8) — applies to every bulk and form PR
1. **Set once:** common fields (date, type, days, source, reference, remark, effective date) are entered once per batch, not per row.
2. **Remember:** the last values used per kind are remembered per browser (`localStorage` key `bulk.<kind>.defaults.v1`, try/catch, safe default if blocked).
3. **Derive, don't ask:** company, department, name, month (from date), current values — always from the master/DB. Never type a name to identify a person; code or pick.
4. **Reuse earlier work:** "copy people from an earlier date", "start from last batch", "export current values → edit → re-upload (only changed cells apply)".
5. **Paste anything:** paste codes from Excel/gate register with any separator; extra columns and names on the line are ignored; duplicates merged; unknown tokens listed, not silently dropped.
6. **Fix in place:** errors are corrected in the preview (edit cell, change days, remove row) — never by re-pasting or re-uploading.
7. **Skip known duplicates automatically** with the existing record shown, instead of failing the batch.
8. **Keep drafts:** an unsaved batch survives navigation, refresh and the session-timeout re-login (`sessionStorage` draft + return path; warn before leaving).
9. **One step where the same person does two:** offer "save and approve as HR" where the creator is the approver (Q1), never across a maker-checker boundary (finance stays separate).
10. **Bulk the follow-up too:** after saving, the user lands on a list filtered to exactly those rows, with bulk actions available.

### 4.2 UX principles
- The screen never shows a state that isn't true (no fake ticks, no "All clear" on failure, no "resolved" based on a filter).
- Every disabled button says why; every destructive action confirms in plain words with counts and ₹ where money moves; reasons are required for rejects.
- Every queue shows counts per state and is reachable in one click from where the work is announced.
- One component per concept: one modal/confirm, one status badge, one review queue, one employee picker, one money/date formatter, one company control, one month control.
- Plain language in all user-facing text (no table/column names, no "snapshot hash").
- Money in Indian notation (₹, lakh, crore; `fmtINR`), dates DD-MMM-YYYY (`fmtDate`), "today" computed in IST.

### 4.3 Engineering principles
- Bulk calls the **same** write logic as the single-record path (extract to a service function once; both callers use it). No second copy of business rules.
- Smallest possible change; fragile files untouched; dist rebuilt after frontend changes.
- Each PR independently revertible.

---

## 5. Roadmap
### 5.1 Phases
| Phase | Name | Purpose | Gate to next |
|---|---|---|---|
| P0 | Housekeeping | Close open items so the base is clean | Items done or consciously parked |
| P1 | Truth bugs | Screens that lie or misfire (Batch A) — small, high value; several are bulk prerequisites | P1-must items merged (marked ★) |
| P2 | Bulk foundations (UX + guards) | Shared UI kit, review queue, picker/paste, drafts + timeout, permissions, backend guards | All P2 merged |
| P3 | Bulk engine + ED bulk (B1) | First bulk kind end to end | Owner check passes on Railway |
| P4 | "What next" workflow | Real pipeline status, waiting-for-you counts, links, queue counts | — |
| P5 | Master + salary bulk (B2, B2b, B3) | Batch approval stage (finance), master bulk edit, new joiners, salary revision | — |
| P6 | One approval pattern | ReviewQueue adopted across Miss Punch, DW, Sales, TA/DA; status vocabulary | — |
| P7 | More bulk kinds (B4–B6) | Shift roster, miss punch/Stage 5 grid, sales grids/uploads | — |
| P8 | Shell | Nav regroup, single company control, titles, search, 404, branding | — |
| P9 | Design debt | Formatting, buttons, a11y, remaining polish — continuous, done when a page is touched | — |

### 5.2 PR list (in order). "★" = prerequisite for bulk. IDs are permanent.
| PR-ID | Title | Findings | Depends on | Size |
|---|---|---|---|---|
| **P0-1** | Owner CP-10 browser check of #78 on Railway (no code) | wide-layout handoff §9 | — | owner |
| P0-2 | Merge open docs PRs: `docs/wide-layout-cp9`, `docs/attendance-review-handoff`, `docs/ux-bulk-master-plan` | — | — | owner |
| P0-3 | Triage the 6 `new` bug reports (close the ED one fixed by #76) — admin UI, no code | O-1 | — | owner |
| **P1-01** | Finance Audit Readiness click crash (`setActiveTab` not defined) | F-5 | — | S |
| P1-02 | Salary Register report shows ₹0 (wrong field names) | H-1 | — | S |
| P1-03 | Sales NEFT file includes unfinalised rows; add confirm with count + ₹ | S-1 | — | S |
| P1-04 | Stage 6 run with a company selected cuts rows — guard (needs Q4) | P-2 | — | S |
| P1-05 | Stage 6 Apply Leave form keeps previous employee's values | P-3 | — | S |
| P1-06 | Leave rejection reason dropped (`reason` vs `rejection_reason`) + require it | H-3 | — | S |
| **P1-07** ★ | Remove Payable OT "Grant Extra Duty" tab; retire `payroll.js` grant-extra-duty endpoint (410) — needs Q5 + fragile-file approval | F-1 | — | S |
| P1-08 | Stage 5 grid not refreshed after save | P-4 | — | S |
| P1-09 | Miss Punch "all resolved" banner based on filter | P-5 | — | S |
| P1-10 | Night Shift "Undo" actually rejects; relabel + confirm + aria | P-6 | — | S |
| P1-11 | Dashboard shows "All clear" when a call fails | H-4 | — | S |
| **P1-12** ★ | Sidebar/Header hooks after early returns (crash risk) | X-1 | — | S |
| P1-13 | Finance Verify company filter ignored at sign-off | F-4 | — | M |
| **P1-14** ★ | Employee bank edit writes the wrong column pair; salary split reset on save | H-2 | — | M |
| P1-15 | Finance Verify flag reason fixed text; Approve enabled while flagged | F-12 | — | S |
| P1-16 | Interventions Reject All — no reason/confirm; header checkbox mismatch | F-10 | — | S |
| P1-17 | Import: dead "Overwrite" checkbox; month not sent | P-7, P-8 | — | S |
| P1-18 | Daily wage imported drafts invisible — "Submit all" + Draft/Needs-correction cards | D-1 | — | S |
| P1-19 | Sales Mark Left always uses today's date | S-3 | — | S |
| P1-20 | Leave form offers Comp Off (refused) and accepts end < start | H-7 | — | S |
| P1-21 | Bulk payslips button always 403 | H-9 | — | S |
| **P1-22** ★ | Salary change approver can't see all components | F-2 | — | S |
| **P1-23** ★ | Salary change self-approval (requester = approver) — needs Q6 | F-3 | — | S |
| P1-24 | Miss Punch stray "0" next to Correct | O-3 | — | S |
| **P2-01** ★ | Modal + ConfirmDialog on headlessui Dialog (focus trap, Esc, busy) + `useConfirm()`; migrate the 10 native confirm/prompt/alert calls | X-10 | P1 done | M |
| **P2-02** ★ | Toast dedup: API interceptor vs page `onError` double toasts | X-17 | — | S |
| **P2-03** ★ | Formatters: `fmtINR`/`fmtDate` usage rule for new code; `todayIST()`; fix `FinanceAudit:525` locale; DateSelector month-mode presets + dynamic years | X-11 (part), X-14, D-11, P-17 | — | S |
| **P2-04** ★ | `<Button variant>` + `<IconButton label>` (label required); `<StatusBadge>` with one status→label/colour map | X-13 (part), F-9 (part) | P2-01 | M |
| **P2-05** ★ | Table pattern: scroll-window container with working sticky header (generalise the `.salreg` approach) + keyboard-accessible row expand/sort | P-16, P-15 (pattern) | — | M |
| **P2-06** ★ | `<ReviewQueue>` extracted from ExtraDutyGrants finance tab (#79): filter chips with counts, select scoped to filter, fixed bottom bar, reason modal; ED finance tab re-pointed to it with zero behaviour change | F-9, U-RQ | P2-01, P2-04 | M |
| **P2-07** ★ | `<PeoplePicker>` (grouped by department, search, tick dept) + `parseCodes()` paste parser + `<EmployeeSearchSelect>` a11y fix | U-PP, H-15 (part) | P2-04 | M |
| **P2-08** ★ | Session timeout → modal with countdown "Stay signed in"; return path after re-login; `useDraft()` hook (sessionStorage + beforeunload warning) | X-3, U-DR | P2-01 | S–M |
| **P2-09** ★ | ErrorBoundary → Sentry + plain message + "Report bug" | X-4 | — | S |
| **P2-10** ★ | Permissions source: fetch `/auth/permissions`; nav + routes + Header Settings gated by one function | X-2, X-8 | P1-12 | M |
| **P2-11** ★ | Backend role guards on unguarded write routes (attendance, advance, import, payroll legacy, lifecycle, employees bulk-set-contractor) — check production usage per route first | B0a, F-6 (part) | — | M |
| **P3-01** ★ | Bulk engine core (`bulk_batches`, `bulk_rows`, preview/apply/undo/list) + **ED bulk grant** (B1) + ED HR-queue tab fix | B0b, B1, F-11 | P2-01…P2-08, P1-07 | L |
| P4-01 | Pipeline progress from real stage status + blocker counts | P-1 | P2-04 | M |
| P4-02 | "Proceed to Stage X" / "waiting on N" become links | P-12 | — | S |
| P4-03 | "Waiting for you" panel per role on Dashboard (incl. bulk batches awaiting finance); HR dashboard renders once | F-8, H-8 | P3-01 | M–L |
| P4-04 | DW finance queue counts up front | D-2 | P2-06 | S |
| P4-05 | Sales compute shows blockers before first compute; Upload confirm explains disable + "Go to Compute" | S-4, S-6 | — | S |
| P4-06 | Alerts — revive or remove (Q7); bell "View all" link | H-6, H-17 | — | M |
| P4-07 | Loans: "Approved — to disburse" tile for finance | F-18 | — | S |
| **P5-01** | Bulk engine: approval stage (`submitted → approved → applied`, finance approver, self-approval refused) + batch queue via ReviewQueue | B2 (stage) | P3-01 | M |
| P5-02 | Employee master bulk edit (export → edit → re-upload; selection action "set field for N") — direct fields apply, sensitive fields go to finance (R2) | B2 | P5-01, P1-14 | L |
| P5-03 | New joiners bulk create (template + duplicate checks; normal create path) | B2b | P5-01 | M |
| P5-04 | Salary revision batch (code + new gross or %; effective date; finance approves with full component view; audit added) | B3 | P5-01, P1-22, P1-23 | M |
| P6-01 | Miss Punch finance bulk approve via ReviewQueue; don't dim finance's own rows | P-13 | P2-06 | M |
| P6-02 | DW finance review: confirm with ₹ total, select-all on top, sticky bar | D-3 | P2-06 | S |
| P6-03 | Sales finalise in bulk (checkboxes, search, status filter, sticky bar) | S-2 | P2-06 | M |
| P6-04 | TA/DA approvals: counts + bulk | S-7 | P2-06 | M |
| P6-05 | Salary Advance: role gate, confirm, undo; select-all scoped; one window label from policy | F-6, F-7 | P2-11 | M |
| P6-06 | Confirmations for destructive actions (contractor deactivate, rate approve, document delete, outside-grant remove, Leave Automation toggle) | D-6, H-10 | P2-01 | S |
| P6-07 | Remove debug role banners for non-admins | F-14 | — | S |
| P7-01 | Shift roster: one server batch replacing frontend Promise.all; selection action + upload | B4, P-11 (part) | P3-01 | S–M |
| P7-02 | Miss punch + Stage 5 grid (`<BulkGrid>`; fill shift default times; new-joiner backfill) | B5, P-14 | P3-01 | M |
| P7-03 | Sales: TA/DA grid (and make TA/DA upload all-or-nothing), sales master bulk edit, incentive/bonus upload with reason + audit | B6, S-5 | P5-01 | M |
| P7-04 | Later kinds: leave bulk apply, Mark Left in bulk (leaving date per row), late/early decision batches | B7 | P5-01 | M each |
| P8-01 | Nav regroup into sections; remove duplicate "Late Coming"; unique icons; rename Finance Audit/Verify pair (Q8) | X-5 | P2-10 | M |
| P8-02 | Collapsed sidebar: labels + flyout groups | X-6 | P8-01 | S |
| P8-03 | One company control (Header, API list) + one month control everywhere | X-7, H-12, D-10, S-10 (part) | — | M |
| P8-04 | `document.title` per page; breadcrumbs from nav tree; Ctrl+K palette (pages + employee lookup) | X-9 | P8-01 | M |
| P8-05 | One employee record: name links everywhere; QuickView "Open record"; Intel `?code=`; Left employees findable | H-11, H-5 | — | M |
| P8-06 | 404 page; one product name + build version | X-15, X-16 | — | S |
| P9-xx | Design debt items (register rows tagged P9), each its own small PR when the page is next touched | see §9 | — | S each |

### 5.3 Critical path to the first bulk feature
P1-07, P1-12, P1-14* → P2-01 → P2-02 → P2-03 → P2-04 → P2-05 → P2-06 → P2-07 → P2-08 → (P2-09, P2-10, P2-11 in parallel planning, sequential merging) → **P3-01**.
(*P1-14 is needed before P5-02, not before P3-01; listed early because bank data is money-critical.)
OPINION: P1-01…P1-06 go first anyway — each is under an hour and removes a live false screen.

---

## 6. Phase specs
Each PR spec lists: **Scope · Files (known) · DO NOT MODIFY · Tests · Acceptance · Rulings needed**. "Global DO NOT MODIFY" (§10) always applies on top. Line numbers are from `a5aec9a`; builders re-grep before editing.

### P0 — Housekeeping
- **P0-1 CP-10 check (owner, seven-field):** Surface: browser, Railway app, admin or finance login. Preflight: ⌘⇧R. Action: Stage 7 → All companies → September 2026; check totals row Earned = Total Gross card and Take Home = Take Home card; scroll right (pins stay), scroll down (header stays); expand a row; switch to Review, reload, still Review; Miss Punch correct a punch; Loans → Import bulk confirm buttons present; Salary Input edit works. Expected: all as described (reference totals are in the private wide-layout handoff). Verify: the two totals match. Undo: none (display only; rollback = revert #78 in GitHub UI). Return: "ok" or step number + what was seen.
- **P0-2:** open PRs in the GitHub web UI for `docs/wide-layout-cp9`, `docs/attendance-review-handoff`, `docs/ux-bulk-master-plan`; merge (docs only).
- **P0-3:** Admin → Bug Reports: set the 21 Sep ED report to resolved (fixed by #76); duplicates → duplicate; others → triaged with a note. No code.

### P1 — Truth bugs (each its own PR; diagnostics first per project bug workflow: Sentry → classify → 2–3 production queries → fix)
| PR | Scope (smallest change) | Files | Tests / acceptance |
|---|---|---|---|
| P1-01 | Pass `onNavigate` (or `setActiveTab` + `navigate`) into `ReadinessTab` as props | `pages/FinanceAudit.jsx` (~L604–640, L1265–1272) | Playwright: click every readiness card → navigates, 0 page errors. Sentry: the error stops after deploy. |
| P1-02 | Map Salary Register columns to `gross_earned`, `pf_employee`, `esi_employee`, `net_salary`; remove PT column; same in CSV | `pages/Reports.jsx` (~L573–627) | Report totals equal Stage 7 totals for Sep 2026 (scratch DB); CSV columns non-empty. |
| P1-03 | NEFT export filters `status = 'finalized'` (check exact status value in code); frontend always confirms "N rows · ₹X" | `services/salesExportFormats.js` (~L173–180), `pages/Sales/SalesSalaryCompute.jsx` (~L238) | jest: computed/reviewed rows excluded; held excluded; confirm shown even with no missing bank rows. |
| P1-04 | Stage 6 run: per Q4 either always send `company:''` or block with explanation; add confirm | `pages/DayCalculation.jsx` (~L111, L254) | Drift query unchanged; with a company selected the run either covers all rows or refuses with the message. |
| P1-05 | Reset `leaveForm` whenever the modal opens and on cancel | `pages/DayCalculation.jsx` (~L150, L579, L717) | Playwright: open A, type, cancel, open B → empty form. |
| P1-06 | Send `reason`; require ≥ 5 chars; show reason in the list | `pages/LeaveManagement.jsx` (~L423, L657) | jest/route: reason stored; empty refused client-side. |
| P1-07 | Remove the Payable OT "Grant Extra Duty" tab → link to Extra Duty → New Grant; `payroll.js` grant-extra-duty + revoke return 410 (mirror the manual-deductions retirement) | `pages/PayableOT.jsx` (~L393–441), `routes/payroll.js` (~L1651–1735) ⚠ fragile — needs explicit approval | Production query first: any `day_corrections` rows of this type in the last 90 days? jest: 410; drift query unchanged. |
| P1-08 | Invalidate `['attendance-register']` on correction success | `pages/AttendanceRegister.jsx` (~L303–310) | Playwright: save → grid shows new status without reload. |
| P1-09 | Banner from `summary.hrPending + summary.financePending === 0` | `pages/MissPunch.jsx` (~L216–218, L581) | Playwright: filter to Approved with pending elsewhere → no banner. |
| P1-10 | Relabel "Reject pairing"; confirm naming the consequence; aria-label on ✕ | `pages/NightShift.jsx` (~L193–198) | Playwright: confirm appears; cancel does nothing. |
| P1-11 | Track failed calls; show "Couldn't load — retry" instead of "All clear" | `pages/Dashboard.jsx` (~L83–101, L180) | Simulate 500 → message, not "All clear". |
| P1-12 | Move every hook above early returns in `NavItem`; lift Header store selector to top | `components/layout/Sidebar.jsx` (~L204–222), `Header.jsx` (~L46) | Playwright: change role between renders (mock `/auth/me`) → no crash. |
| P1-13 | Pass company through finance-verification calls and SQL, or hide the filter (smallest correct option decided at Phase 0) | `utils/api.js` (~L388–439), `pages/FinanceVerification.jsx`, `routes/financeVerification.js` (~L198–210) | Counts per company match SQL; sign-off scoped or filter hidden. |
| P1-14 | Write bank edits to one canonical pair (decide at Phase 0 with a production query of both columns; today 0 active rows differ — FACT); read salary split from `salaryStructure` key | `pages/Employees.jsx` (~L56–71), `routes/employees.js` (~L569–600), `services/exportFormats.js` (~L155) read path unchanged unless needed | jest: edit → NEFT export shows the new account; split preserved on save. Never echo account values in logs/tests (fictional data only). |
| P1-15 | Flag asks for a reason; Approve disabled with "N still flagged" | `pages/FinanceVerification.jsx` (~L288) | Playwright. |
| P1-16 | Reject All requires reason + confirm; header checkbox compares the same array it selects | `pages/FinanceAudit.jsx` (~L739–855) | Playwright. |
| P1-17 | Remove the dead checkbox; warn "month already imported — Stage 6/7 will be recomputed"; append month/year to FormData so the server's month check fires | `pages/Import.jsx` (~L232–234, L310–313) | Upload with wrong month → server refusal shown. |
| P1-18 | Import done screen "N drafts created — Submit all now"; Draft + Needs-correction cards on Records | `pages/DailyWageBatchImport.jsx`, `pages/DailyWageRecords.jsx` | Playwright. |
| P1-19 | Required leaving-date field in Mark Left dialog | `pages/Sales/SalesEmployeeMaster.jsx` (~L659, L811) | Route stores chosen date. |
| P1-20 | Remove Comp Off option; validate end ≥ start | `pages/LeaveManagement.jsx` (~L31, L75–80) | Playwright. |
| P1-21 | Hide bulk payslips or show "disabled by policy" | `pages/Reports.jsx` (~L342, L1022) | No 403 on click. |
| P1-22 | Approver view: all five components old → new, changed highlighted, effective date | `pages/SalaryInput.jsx` (~L270–280) | Playwright. |
| P1-23 | Refuse approve when approver = requester (per Q6); button disabled with reason | `routes/salary-input.js` (~L148, L256), `pages/SalaryInput.jsx` | jest. |
| P1-24 | `rec.miss_punch_resolved && …` → boolean guard | `pages/MissPunch.jsx` | Render check: no stray 0. |

### P2 — Bulk foundations (why each is needed for bulk is in §8)
- **P2-01 Modal/Confirm.** New `components/ui/Modal.jsx` + `ConfirmDialog.jsx` on headlessui `Dialog` (keep the same props so existing callers keep working), `useConfirm()` returning a promise; busy state disables buttons; Esc/overlay close except while busy. Migrate the 10 native calls (PayableOT, Settings, LeaveManagement, GatePasses ×2, FinanceEarlyExitApprovals, Reports, SqlConsole prompt/alert ×3). DO NOT change any action's behaviour. Tests: Playwright opens each migrated confirm; keyboard Esc/Tab trap.
- **P2-02 Toast dedup.** Interceptor marks errors it toasted (`error.__toasted = true`) and pages skip toasting those, or pages opt out per call — choose the smallest at Phase 0. Bulk preview must show row errors in the table, never as toasts.
- **P2-03 Formatters.** Add `todayIST()`, `toIstDateInput()`; DateSelector month mode shows This/Last Month only; `YEAR_OPTIONS` from current year −2…+1; fix `FinanceAudit:525`; DW Entry/Payments "today" use `todayIST()`. Lint rule (eslint `no-restricted-syntax`) for `toLocaleString`/`toLocaleDateString` in **new** files only (`components/bulk/**`) — wider migration is P9.
- **P2-04 Button/IconButton/StatusBadge.** `components/ui/Button.jsx` (variants primary/secondary/ghost/danger, sizes, `busy`), `IconButton` (required `label` → aria-label + title), `StatusBadge` (`utils/statusMap.js`: one map for ED, miss punch, leave, salary change, loans, DW, bulk batch states). Adopt only in new bulk components + ED page in this PR.
- **P2-05 Table pattern.** `components/ui/ScrollTable.jsx` (or CSS utility `.scroll-window`) giving its own `overflow-auto` container with `max-h`, `border-separate border-spacing-0`, sticky `thead`; row expand via a `<button>` chevron; sortable headers as buttons. Do not touch Stage 7 (`.salreg`). Adopt in bulk preview + ED list only.
- **P2-06 ReviewQueue.** Extract from `ExtraDutyGrants.jsx` finance tab (#79 behaviour is the spec: chips with counts All/Unreviewed/Flagged/Rejected/Approved; client order; header box selects every selectable row in the current filter, on "All" unreviewed only; selection clears on filter/tab change; fixed bottom bar "N selected · actions · Clear"; tinted rejected rows). Props: rows, statusOf, filters, actions[{label, variant, needsReason, minReasonLen, confirmText(n, total)}], money column for ₹ totals. Re-point ED finance tab with **zero** behaviour change — prove with `backend/scripts/ed-finance-review-ux-check.py` 25/25 still passing.
- **P2-07 PeoplePicker + parseCodes.** `utils/parseCodes.js`: split on newline/comma/tab/semicolon/space; take tokens matching the employee-code pattern (derive from master: codes are text; keep leading zeros); ignore other tokens but report them; dedupe; preserve order. `components/bulk/PeoplePicker.jsx`: active employees (option to include Left with a warning badge) grouped by department, largest first; search by name/code/department (case-insensitive, partial); "tick whole department"; selected tray with count and remove. Fix `EmployeeSearchSelect` `aria-activedescendant`. Unit tests for parser (Excel column paste, CSV, mixed text, duplicates, leading zeros).
- **P2-08 Timeout + drafts.** Replace the 13-min toast with a modal countdown ("You'll be signed out in 2:00 — Stay signed in"); on forced logout save `returnTo` (path + query) and restore after login; `hooks/useDraft(key)` stores JSON in sessionStorage (try/catch), restores on mount with "Draft restored · Discard", and registers `beforeunload` while dirty. Bulk panels use it from P3-01.
- **P2-09 ErrorBoundary.** `Sentry.captureException` in `componentDidCatch`; plain message with page name; "Report bug" opens BugReporter; raw error behind "details".
- **P2-10 Permissions.** Load `/auth/permissions` once (react-query, cached); `can(permKey)` helper; tag nav items and routes; route guard renders "You don't have access" instead of a 403 page; hide Header "Settings" for non-admins. Verify role matrix in Playwright for all five roles.
- **P2-11 Backend guards.** Phase 0 must first query `usage_logs` for each unguarded route: which roles actually call it in the last 90 days (FACT before change). Add `requireHrOrAdmin`/`requireFinanceOrAdmin`/`roleIn` per route matching current legitimate callers; never lock out a role that uses it today without Abhinav's ruling. jest: viewer/supervisor get 403 on writes; hr/finance flows unchanged (run the full suite).

### P3 — Bulk engine + Extra Duty bulk grant (PR P3-01)
Full plan already written: project doc `claude/bulk-pr1-plan.md` (same content as §7.1–7.3 + §7.5 here). Summary of the PR:
- **New:** `backend/src/database/bulkSchema.js`; `backend/src/services/bulk/engine.js`; `backend/src/services/bulk/kinds/extraDuty.js`; `backend/src/services/extraDuty/createGrant.js` (extracted single-create logic, no behaviour change); `backend/src/routes/bulk.js`; `frontend/src/components/bulk/ExtraDutyBulkGrant.jsx`, `BulkBatchList.jsx`, `CopyFromDate.jsx`; tests `backend/src/__tests__/bulkExtraDuty.test.js`; `backend/scripts/bulk-ed-check.py`; `docs/ux-bulk/prs/P3-01/PROGRESS.md`.
- **Changed:** `schema.js` ⚠ one line calling `initBulkSchema(db)` (explicit approval); `routes/extraDutyGrants.js` POST / calls `createGrant()`; HR Queue tab filters PENDING and gets HR bulk bar via ReviewQueue (F-11); `server.js` mounts `/api/bulk`; `utils/api.js`; `pages/ExtraDutyGrants.jsx` (+ Bulk Grant button, recent batches); dist; CLAUDE.md.
- **DO NOT MODIFY:** salaryComputation.js, dayCalculation.js, payroll.js, recompute.js, ED approve/reject/finance/return/edit/PBA routes, finance review UI behaviour, Stage 7.
- **Tests/acceptance:** see §7.6 + §11.
- **Rulings needed:** Q1, Q2.

### P4 — "What next" workflow
- **P4-01** Pipeline status from `monthly_imports.stage_N_done` + backlog counts (miss punches pending HR/finance, unpaired night shifts, Stage 6 stale, Stage 7 stale/finalised) via one new read endpoint `GET /api/pipeline/status?month&year&company` (read-only). Pills show done/active/blocked with counts; click → that page/queue. Remove hard-coded `stageStatus` props page by page.
- **P4-03** `GET /api/inbox/summary` (read-only, role-aware counts with deep links): finance — miss punch approvals, ED unreviewed/flagged, salary changes pending, bulk batches awaiting approval, loans to disburse, early exit, comp-off, late coming, DW review, TA/DA; HR — drafts, returned ED, leave requests, current stage blocker, bulk batches returned. Dashboard panel per role; each count failing shows "Couldn't load".
- Others per §5.2.

### P5 — Master + salary bulk
- **P5-01 Approval stage** in the engine: kinds flagged `requiresApproval` (or per-row `needsApproval` for mixed batches) save as `submitted`; finance approves/rejects/returns the batch in a ReviewQueue ("Bulk batches" tab on Finance Verify or the new inbox); apply happens at approval inside the transaction with re-plan + hash; approver ≠ creator enforced (like loans `SELF_APPROVAL`). Rejection requires a reason; return sends back to the creator as `draft` with the note.
- **P5-02 Employee master bulk edit:** Mode C "Export current values" (chosen fields, filtered set) → edit in Excel → upload → preview shows only changed cells old → new → direct fields apply on save; sensitive fields (R2) create one finance-approval batch; salary changes become `salary_change_requests` (existing path; one pending per employee → conflict rows). Selection action on Employees list: "Set shift / department / designation / punch no. for N selected". Status → Left only via Mark Left rules with leaving date per row. Field allowlist excludes PF/ESI/LWF flags (R10). Bank fields write the canonical pair from P1-14.
- **P5-03 New joiners:** template with mandatory fields and dropdowns (department, designation, shift, company, employment type, contractor group), duplicate checks (code, punch no., UAN), normal create path (salary structure + leave balances), pending finance approval only if salary/bank included per R2.
- **P5-04 Salary revision:** upload/grid of code + new gross **or** % increase + effective date (+ optional component overrides); preview old vs new five components, Δ monthly per row and total ₹ (lakh notation); finance approves batch; writes `salary_change_requests` through the existing approve path; adds audit rows (the gap in §3.2).

### P6–P9
Per §5.2 table and §9 register.

---

## 7. Bulk system design
### 7.1 Three entry modes + selection action
| Mode | When | Examples |
|---|---|---|
| A. Quick batch form — set common fields once, add many people | Same values for many people; paper source | ED gate register, leave for a festival, Mark Left batch |
| B. Spreadsheet grid — paste a block from Excel or type with Tab/Enter; per-cell validation; code autocomplete | Different values per row, clerk typing | Miss punch IN/OUT, Stage 5, TA/DA, incentives, salary revision |
| C. File upload — template → fill offline → upload → preview → save | Data comes from someone else/another system | New joiners, increment sheet, bonus sheet, shift roster, master export-edit-reupload |
| + Selection action — tick rows in any list → "Set X for N" | Same change to an existing set | Shift for 233 people, department, status |
All modes produce a **batch** handled by one engine.

### 7.2 Engine
**Tables** (`bulkSchema.js`, CREATE TABLE IF NOT EXISTS):
- `bulk_batches`: id, kind, company, month, year, source (`form`|`grid`|`file`|`selection`), file_name, file_sha256, template_hash, status (`draft`,`submitted`,`approved`,`applied`,`rejected`,`returned`,`undone`), plan_hash, row_count, ok_count, warn_count, error_count, skipped_count, created_by, created_at, submitted_by/at, approved_by/at, applied_at, undone_by/at, reject_reason, note, group_id (links batches saved together from one screen, Q2).
- `bulk_rows`: id, batch_id, row_no, row_key (unique per live batch), input_json, resolved_json, state (`ok`,`warning`,`error`,`skipped`), action (`create`,`update`,`noop`,`conflict`), messages_json (plain-language reasons), before_json, after_json, target_table, target_id.
- Indexes: (kind, created_at), (status), (batch_id, row_no), unique (batch_id, row_key).

**Lifecycle:** `draft → (validated preview) → submitted → approved → applied → undone`, with `returned`/`rejected` from submitted. Kinds without approval go draft → applied directly (preview still mandatory).

**API** (`routes/bulk.js`, mounted `/api/bulk`):
| Method + path | Body / query | Returns |
|---|---|---|
| POST `/:kind/preview` | `{ common, rows[] }` or multipart file | `{ planHash, rows:[{rowNo, state, action, messages[], display}], counts, groups:[[rowNos≤50]] }` |
| POST `/:kind/apply` | `{ common, rows[], planHash, groupId? }` (≤ 50 rows) | `{ batchId, counts }` or 409 `BULK_PLAN_CHANGED` / 400 `BULK_ROW_LIMIT` |
| POST `/:kind/submit` | same as apply for approval kinds | `{ batchId, status:'submitted' }` |
| POST `/batches/:id/approve` · `/reject` · `/return` | `{ reason? }` | status; approve applies inside txn with re-plan |
| POST `/batches/:id/undo` | `{ reason }` | `{ undone }` or 409 `BULK_UNDO_BLOCKED` + rows that moved on |
| GET `/batches?kind&status&month&year` | | list (no input_json) |
| GET `/batches/:id` | | batch + rows (sensitive fields redacted for roles that can't edit them) |
| GET `/:kind/template` | | .xlsx (ExcelJS) with dropdowns + Read me + hidden template hash |
| GET `/:kind/export?filters` | | current values for export-edit-reupload (P5-02) |
| kind-specific read helpers, e.g. GET `/extra-duty/people?date=` | | for "copy from earlier date" |

**Kind interface** (`services/bulk/kinds/<kind>.js`): `name`, `roles {create, approve}`, `requiresApproval(row|common)`, `columns[]` (key, label, type, required, enum source, lookup), `parse(input)`, `validateRow(db, row, common, ctx)`, `planRow(db, row, common, ctx)` → `{state, action, messages, before, display}`, `applyRow(db, row, plan, ctx)` → `{targetTable, targetId, after}`, `undoable(db, appliedRow)` → `{ok, reason}`, `undoRow(db, appliedRow)`, `afterApply(db, periods, ctx)` (triggers once per period + one summary notification), `template()`.

**Rules:**
- Preview is mandatory; apply re-plans **inside one IMMEDIATE transaction** and refuses on plan-hash mismatch ("data changed since you checked — check again").
- 50 rows per batch (R5); larger lists split into groups of ≤ 50 at preview (Q2) — each group its own batch with a shared `group_id`.
- All-or-nothing per batch (R3); user may set error rows to `skipped` before saving; skipped rows stay visible in the batch with reasons.
- No network calls or file parsing inside the transaction. Parse and pre-validate first.
- Audit: the single-path audit rows per row + one summary `audit_log` row per batch action (`stage = 'BULK_<ACTION>'`, `table_name='bulk_batches'`, remark with kind, counts, batch id). logAudit is inside the txn (shared connection).
- Undo (R4): only if `undoable()` true for every applied row (e.g. ED: HR status unchanged since the batch, `finance_status='UNREVIEWED'`, `is_processed=0`, month not finalised); else refuse and list rows. Created rows deleted; updated rows restored from `before_json`. Reason required.
- Finalised month: rows refused with a plain message (or routed to `leave_change_flags` where that path exists).
- Approver ≠ creator for approval kinds.
- PII: `input_json` sensitive fields (bank, PAN, UAN, ESI no.) are redacted after apply (keep last 4 only); GET batch redacts for roles without edit rights. Never log values.
- SQLite is synchronous: keep each apply under ~1 s; 50-row cap protects this.

### 7.3 UI kit (`frontend/src/components/bulk/`)
- `BulkPanel` — shell with steps (1 Set once · 2 Add people/rows · 3 Check · 4 Save · Result), draft via `useDraft`, defaults via localStorage.
- `PasteBox` — textarea + "Add" → `parseCodes()`; shows "Added N · Already in list M · Not recognised: …".
- `PeoplePicker` (P2-07), `CopyFromDate` (pick a date → add its people).
- `PreviewTable` — ScrollTable + StatusBadge chips (All/Ready/Warnings/Errors/Skipped/No change with counts), per-row inline edit of the editable columns, remove row, mark error rows skipped, plain-language reasons, "Download rows with problems (.xlsx)".
- `SaveBar` — fixed bottom: "Save 109 grants (3 batches: 50 + 50 + 9)" + options (e.g. "Also approve as HR") + Cancel; busy state.
- `ResultPanel` — counts, link to filtered list, Undo for each batch.
- `BulkBatchList` — recent batches per kind: who, when, period, counts, status badge, Undo / View; reused by every kind.
- `BulkGrid` (P7) — spreadsheet entry: paste block, Tab/Enter navigation, autocomplete code cell, fill-down, column default, cell error tooltips, undo last change, sticky header, keyboard-only operable.
- `TemplateUpload` (P5) — keyboard-reachable drop zone, accepted types listed, wrong-type message, template-hash check ("This template is older than the current master — download a fresh one").
- Copy rules: plain words, numbers with units, ₹ via `fmtINR`, dates via `fmtDate` + weekday where a date is chosen ("23-Sep-2026, Wed").

### 7.4 Per-kind specs
**B1 Extra duty bulk grant (P3-01)**
- Common: date (required) · type (Overnight Stay / Extended Shift / Other; default last used) · duty days (0.5/1/1.5/2; default 1) · source (Gate Register / Production Office / Supervisor Confirmed / Other) · reference no. · remark. Month/year from the date; company from each employee's master record.
- Add people: paste, tick (PeoplePicker), copy from an earlier date (lists people granted that date in the same month by default; option for previous month).
- Row checks: code exists · Active (else error "not active — left on <date>") · date in month · month not finalised · duty days allowed · existing grant same person/date → `skipped` "already granted (HR: approved, finance: unreviewed)" · untouched BIOMETRIC_AUTO → `warning`/`update` "will replace the system entry" · PBA type not offered · duplicate code in list merged.
- Per-row: change duty days; remove.
- Save: groups of ≤ 50; option "Also approve as HR" (Q1) → rows saved `APPROVED` by the creator with audit stage `HR_BULK_CREATE_APPROVE`; finance queue unchanged.
- After save: ED list filtered to the batch rows; HR Queue tab (now PENDING only) has the ReviewQueue bulk bar.
- Undo per batch per §7.2.
- Time target (INFERENCE): a 109-person date in a few minutes (pick date → copy earlier date → paste 7 more → save).

**B2 Employee master bulk edit (P5-02)** — fields: direct = default shift, punch no., department, designation, contractor group, reporting manager; approval (finance) = bank name/account/IFSC (canonical pair), PAN, UAN, ESI number, status/Left (with leaving date), salary (via salary change request); excluded = PF/ESI/LWF flags (R10), code, company (needs its own ruling). Export → edit → re-upload (only changed cells), plus selection action. Duplicate punch no./UAN checks. Template hash detects stale exports.

**B2b New joiners (P5-03)** — template mandatory: code, name, father's name, DOB, gender, DOJ, company, department, designation, employment type, shift, gross or structure; optional bank/statutory (→ finance approval per R2). Uses the single create path (salary structure + leave balances).

**B3 Salary revision (P5-04)** — code + (new gross | % increase) + effective date (+ component overrides); components derived by the same rule as the single salary edit; conflict if a pending request exists; finance approves the batch seeing all five components and the ₹ total change; audit rows added.

**B4 Shift roster (P7-01)** — selection action "Set shift for N" + upload (code, shift, from date); one server call; one audit summary + per-row audit as today.

**B5 Miss punch / Stage 5 grid (P7-02)** — unresolved rows pre-loaded; type IN/OUT or "fill shift default times for selected"; required time + reason (P-14); new-joiner backfill from DOJ (open bug report); goes through existing resolve/correction services; finance side unchanged.

**B6 Sales (P7-03)** — TA/DA input grid (all-or-nothing), sales master bulk edit (as B2, sales tables, `account_no` column), incentive / bonus / other-ded upload with reason + audit; finalised rows refused.

**B7 Later** — leave bulk apply (festival/mass CL; leave rules from the leave engine), Mark Left batch (leaving date per row, loans exit hooks), late/early decision batches (finance).

### 7.5 Where batches appear
- Each kind's page: "+ Bulk …" button and "Recent bulk batches".
- Finance: "Bulk batches awaiting approval" in the inbox (P4-03) and Finance Verify tab (P5-01).
- Admin: all batches (read-only list) for audit.

### 7.6 Bulk test matrix (every kind)
Parser (paste formats, leading zeros, duplicates, junk) · each validation error · duplicate/skip · update path · 50-row cap (51 refused) · plan hash mismatch · all-or-nothing rollback on a mid-batch failure · skipped rows not applied · undo allowed/blocked · role guard (403 for wrong roles) · self-approval refused (approval kinds) · finalised month refused · audit rows (per row + summary) · triggers fired once per period · notification once per batch · single-record path unchanged (its existing tests green) · Playwright happy path + one edge case on built dist · 0 page errors · drift query unchanged.

---

## 8. UX foundations that bulk depends on (the "first make sure UI/UX supports bulk" requirement)
| Bulk need | Foundation PR | Why it must exist first |
|---|---|---|
| Confirm "Save 109 grants (3 batches)" / undo with reason, keyboard-safe | P2-01 | Native confirm can't show counts/₹ or take a reason; current Modal has no focus trap |
| Row errors shown in the table, not 20 toasts | P2-02 | Interceptor + page both toast today → error storms in bulk |
| Dates in words, IST "today", ₹ formatting | P2-03 | Bulk previews are where DD-MM vs MM-DD and UTC-today mistakes would silently land |
| Status chips, labelled icon buttons | P2-04 | Preview/queue states need one vocabulary; icon-only buttons fail a11y |
| Preview tables with sticky headers that work | P2-05 | 50-row previews scroll; today's sticky headers likely don't stick outside Stage 7 |
| Approve/return batches, HR bulk approve | P2-06 | One ReviewQueue instead of a third bespoke implementation |
| Paste codes, tick by department | P2-07 | Core of mode A; reused by every people-based kind |
| Don't lose a half-built batch | P2-08 | Logout every ~15 min idle loses typed work today |
| Crashes reported, not silent | P2-09 | Bulk code paths must surface errors to Sentry |
| Only the right roles see bulk actions | P2-10 | Nav/routes don't follow permissions today |
| Bulk can't inherit open write routes | P2-11 | Several write routes have no role guard |
| Bulk ED doesn't race the legacy grant path | P1-07 | Two ways to grant ED, one outside maker-checker |
| Master bulk writes the right bank columns | P1-14 | Bank edits miss the NEFT file today |
| Salary batch approver sees everything; no self-approval | P1-22, P1-23 | Finance approves blind today |

---

## 9. Full findings register
Columns: ID · Sev (High/Med/Low) · Eff (S < 1 h, M ≈ half-day, L > 1 day) · Where · Problem → Fix · PR · Tag. Severity: High = misleads or risks a wrong money action / blocks work; Med = regular slowdown; Low = polish.

### 9.1 Payroll pipeline (P-)
| ID | Sev | Eff | Where | Problem → Fix | PR | Tag |
|---|---|---|---|---|---|---|
| P-1 | High | M | PipelineProgress.jsx:23; each page's stageStatus | Hard-coded stage ticks show stages done that never ran → real status + blocker counts | P4-01 | A |
| P-2 | High | S | DayCalculation.jsx:111,254 | Stage 6 with a company selected cuts rows silently → guard/confirm (Q4) | P1-04 | V |
| P-3 | High | S | DayCalculation.jsx:150,579,717 | Apply Leave modal keeps previous values → reset on open/cancel | P1-05 | V |
| P-4 | High | S | AttendanceRegister.jsx:303-310 | Grid not refreshed after save → invalidate query | P1-08 | A |
| P-5 | High | S | MissPunch.jsx:216-218,581 | "All resolved" from filtered list → use summary counts | P1-09 | A |
| P-6 | High | S | NightShift.jsx:193-198 | "Undo" rejects pairing, no confirm → relabel + confirm + aria | P1-10 | A |
| P-7 | Med | S | Import.jsx:310-313 | Overwrite checkbox does nothing → remove + warn on re-import | P1-17 | A |
| P-8 | Med | S | Import.jsx:232-234 | Month not sent → server month check never fires → send month/year | P1-17 | A |
| P-9 | Med | S | Import.jsx:218-222 | Rejected file types silently ignored → toast | P9 | A |
| P-10 | Med | S | AttendanceRegister.jsx:163 | Night-OUT-only days hidden → show muted | P9 | A |
| P-11 | Med | M | ShiftVerification.jsx:117,175,44,136 | Silent 500-row cap; pill click applies + expands; N parallel requests → paginate/say "500 of N"; bulk endpoint (B4) | P7-01 / P9 | A |
| P-12 | Med | S | MissPunch.jsx:587, NightShift.jsx:245, Import.jsx:435 | "Proceed"/"waiting on N" are text → links | P4-02 | A |
| P-13 | Med | M | MissPunch.jsx:417,530-537 | Finance approves one by one; own rows dimmed → ReviewQueue bulk | P6-01 | A |
| P-14 | Med | S | MissPunch.jsx:33-74,597-628; AttendanceRegister.jsx:21-58 | Blank times saveable; optional remark; "Mark as Leave (Absent)" label → require time + reason; relabel | P7-02 | A |
| P-15 | Med | M | all stage tables | tr/th onClick not keyboard; controls toggle row → button chevrons, stopPropagation | P2-05 (pattern) / P9 | A |
| P-16 | Med | M | index.css:163 + overflow wrappers | Sticky headers likely don't stick (INFERENCE) → scroll-window pattern | P2-05 | A |
| P-17 | Low | S | DateSelector.jsx:109-114,36,92 | Month-mode presets identical; UTC today | P2-03 | A |
| P-18 | Low | S | Import/NightShift selectors; DayCalculation.jsx:786 | Selector order inconsistent; ₹/day basis wording; Sunday CL wording contradicts tooltip | P9 | A |
| P-19 | Low | S | AttendanceRegister.jsx:312-313 | Recalculate ignores company, no confirm | P9 | A |
| P-20 | Low | S | Import.jsx:118-124 | "Add all N to master" without confirm | P9 | A |

### 9.2 Payroll adjuncts + finance (F-)
| ID | Sev | Eff | Where | Problem → Fix | PR | Tag |
|---|---|---|---|---|---|---|
| F-1 | High | S | PayableOT.jsx:393-441; payroll.js:1657-1722 | Legacy grant writes day_corrections as finance-verified, no role guard; INFERENCE: pays nothing → remove tab, retire endpoint (Q5) | P1-07 | V (code) |
| F-2 | High | S | SalaryInput.jsx:270-280 | Approver sees Basic/DA/HRA only → all five components + effective date | P1-22 | A |
| F-3 | High | S | salary-input.js:54,148 | No requester ≠ approver check (INFERENCE) → refuse self-approval (Q6) | P1-23 | A |
| F-4 | High | M | api.js:388-439; FinanceVerification.jsx:142; financeVerification.js:198-210 | Company filter ignored incl. sign-off | P1-13 | A |
| F-5 | High | S | FinanceAudit.jsx:604-640 | Readiness click crash (35 prod errors) | P1-01 | V (prod) |
| F-6 | Med | M | SalaryAdvance.jsx:342,245; advance.js:62-170 | Any role can Mark Paid; no confirm/undo; select-all ignores filter | P6-05 + P2-11 | A |
| F-7 | Med | S | SalaryAdvance.jsx:194,283,363 | Window described as 1–15 and 1–20; layout drift | P6-05 | A |
| F-8 | Med | L | finance pages | Pending work in six places; held salaries in four | P4-03 | A |
| F-9 | Med | M | ED/late/comp-off/flags/salary input/loans | Approval interactions + status words/colours differ | P2-04, P2-06, P6 | A |
| F-10 | Med | S | FinanceAudit.jsx:739-855 | Reject All no reason/confirm; checkbox mismatch | P1-16 | A |
| F-11 | Med | S | ExtraDutyGrants.jsx:89,213 | HR Queue tab = All Grants; no HR bulk approve | P3-01 | A |
| F-12 | Med | S | FinanceVerification.jsx:288 | Fixed flag text; Approve enabled while flagged | P1-15 | A |
| F-13 | Med | S | SalaryInput.jsx:118,199,389 | Edit shown to all roles; "admin approval" wording; empty submit | P9 | A |
| F-14 | Low | S | ExtraDutyGrants.jsx:192-202; HeldSalariesRegister.jsx:161-167; FinanceVerification.jsx:393-398,479-481 | Debug role banners to all users | P6-07 | A |
| F-15 | Low | S | FinanceEarlyExitApprovals l.120,189; ED l.285; held history l.253; miss punch l.441; late l.1047-1050 | Raw ₹ and ISO dates | P9 | A |
| F-16 | Low | S | Held release report l.280-301 | Month/year as plain numbers → DateSelector | P9 | A |
| F-17 | Low | M | SalaryAdvance, SalaryInput; FinanceAudit l.824 | Clickable rows not keyboard; unlabelled checkboxes; dynamic Tailwind class likely purged (INFERENCE) | P9 | A |
| F-18 | Low | S | Loans.jsx:71 | No "Approved — to disburse" tile for finance | P4-07 | A |

### 9.3 HR core + reporting (H-)
| ID | Sev | Eff | Where | Problem → Fix | PR | Tag |
|---|---|---|---|---|---|---|
| H-1 | High | S | Reports.jsx:573-627 | Salary Register ₹0 (fields don't exist) | P1-02 | V |
| H-2 | High | M | Employees.jsx:56-71; employees.js:588-596; exportFormats.js:155 | Bank edit writes bank_account/ifsc, NEFT reads account_number first; split reset (0 active rows affected today) | P1-14 | V (code+prod) |
| H-3 | High | S | LeaveManagement.jsx:423; leaves.js:298 | Rejection reason dropped | P1-06 | V |
| H-4 | High | S | Dashboard.jsx:83-101,180 | Failed call shows "All clear" | P1-11 | A |
| H-5 | High | S | EmployeeProfile.jsx:41,58 | Intel link ignores ?code=; Left employees unsearchable | P8-05 | A |
| H-6 | High | M | Alerts.jsx:10-27 | Alerts never generated (0 rows ever); severity/type names mismatch; company ignored (Q7) | P4-06 | V (prod) |
| H-7 | Med | S | LeaveManagement.jsx:31,75-80 | Comp Off offered but refused; end < start = 1 day | P1-20 | A |
| H-8 | Med | M | Dashboard.jsx:584-585 | HR dashboard rendered twice; no action queue | P4-03 | A |
| H-9 | Med | S | Reports.jsx:342,1022 | Bulk payslips always 403 | P1-21 | A |
| H-10 | Med | S | Employees.jsx:693; LeaveAutomationTab.jsx:298,185-198 | Delete/remove/org-wide toggle with no confirm | P6-06 | A |
| H-11 | Med | M | Employees.jsx:1097,1160-1161; EmployeeQuickView | Employee record split across 3 views; no "Open record" | P8-05 | A |
| H-12 | Med | M | Header.jsx:44-52; LeaveManagement.jsx:682; Compliance.jsx:106; StatutoryFlags.jsx:28 | Multiple company controls; month ignored; hard-coded default month | P8-03 | A |
| H-13 | Med | S | Leave + employee forms | No required markers; free-text company; component total ≠ gross saveable; PAN/IFSC unchecked | P9 | A |
| H-14 | Low | M | EmployeeProfile:179,286; StatutoryFlags:302; LeaveManagement:574-575; Alerts:59 | Three date formats | P9 | A |
| H-15 | Low | S | Employees.jsx:1163; Alerts.jsx:34; drill-downs | Unlabelled ₹ button; div/row clicks not keyboard; colour-only meaning | P9 / P2-07 | A |
| H-16 | Low | S | Reports.jsx:60-72 | 14 ungrouped reports; filenames lack company; no UTF-8 BOM | P9 | A |
| H-17 | Low | S | NotificationBell.jsx:155 | "View all notifications" opens Alerts | P4-06 | A |
| H-18 | Low | S | Employees.jsx:927 | Code search case-sensitive | P9 | A |

### 9.4 Daily wage (D-)
| ID | Sev | Eff | Where | Problem → Fix | PR | Tag |
|---|---|---|---|---|---|---|
| D-1 | High | S | DailyWageBatchImport.jsx:105-110; DailyWageRecords.jsx:117-123 | Imported drafts invisible; no Draft card | P1-18 | A |
| D-2 | High | S | DailyWageFinanceReview.jsx:36,43,50 | Tab counts only load when clicked | P4-04 | A |
| D-3 | High | S | DailyWageFinanceReview.jsx:173-180,207-212 | Bulk approve no confirm/₹; select-all below list | P6-02 | A |
| D-4 | Med | M | DW local fmt(); raw dates; FinanceReview.jsx:234 | No ₹, ISO dates, status words differ | P9 | A |
| D-5 | Med | M | DailyWageBatchImport.jsx:236,191 | Preview shows ✓ before validation; re-upload needed after errors | P9 (or move to engine later) | A |
| D-6 | Med | S | DailyWageContractors.jsx:275,538 | Deactivate/rate approve without confirm | P6-06 | A |
| D-7 | Med | S | DailyWagePayments.jsx:111-131 | Print window likely popup-blocked (INFERENCE) | P9 | A |
| D-8 | Med | M | DailyWageEntry.jsx:282 | Department free text | P9 | A |
| D-9 | Med | S | DailyWageEntry.jsx:208; Records.jsx:199; Payments.jsx:323 | Div dropdown, row clicks not keyboard | P9 | A |
| D-10 | Low | S | DailyWageReports.jsx:66; ContractorReport.jsx:148-156 | Own month pickers, hard-coded years | P8-03 | A |
| D-11 | Low | S | Entry.jsx:67; Payments.jsx:26 | "Today" in UTC | P2-03 | A |
| D-12 | Low | S | dailyWage.js:843-855,1005-1016 | Finance lists ignore company (INFERENCE that it matters) | P9 | A |

### 9.5 Sales (S-)
| ID | Sev | Eff | Where | Problem → Fix | PR | Tag |
|---|---|---|---|---|---|---|
| S-1 | High | S | salesExportFormats.js:173-180; SalesSalaryCompute.jsx:238 | NEFT includes unfinalised rows; no confirm | P1-03 | V |
| S-2 | High | M | SalesSalaryCompute.jsx:540-559,602-614 | Finalise one by one; no search/filter | P6-03 | A |
| S-3 | High | S | SalesEmployeeMaster.jsx:659,811-816 | Mark Left always today | P1-19 | A |
| S-4 | High | S | SalesSalaryCompute.jsx:264-304,350 | Readiness hidden before first compute | P4-05 | A |
| S-5 | Med | S | SalesSalaryCompute.jsx:74-78,91,171-177 | Money edits save on blur silently, no reason | P7-03 | A |
| S-6 | Med | S | SalesUpload.jsx:572,583-584,636-641 | Confirm disabled without reason; no "Go to Compute" | P4-05 | A |
| S-7 | Med | M | SalesTaDaApprovals.jsx:205-208 | No counts, no bulk | P6-04 | A |
| S-8 | Med | S | SalesUpload.jsx:124,165; TaDaRegister; SalesSalaryCompute.jsx:55,58 | Developer jargon in errors | P9 | A |
| S-9 | Med | S | SalesEmployeeMaster.jsx:688-706 | No search; dead "Bulk Import" button | P9 (replaced by P7-03) | A |
| S-10 | Low | M | TaDaUpload:45; TaDaRegister:49; SalesUpload:276; TaDaApprovals:314; Compute:62 | Own pickers, raw dates, lowercase statuses | P8-03 / P9 | A |
| S-11 | Low | S | Sidebar.jsx:170-171 | TA/DA Register listed before Upload | P8-01 | A |
| S-12 | Low | S | SalesUpload.jsx:302-312,403-413 | Dropzones not keyboard reachable | P9 | A |

### 9.6 Shell + design system (X-)
| ID | Sev | Eff | Where | Problem → Fix | PR | Tag |
|---|---|---|---|---|---|---|
| X-1 | High | S | Sidebar.jsx:204-222; Header.jsx:46 | Hooks after early returns → crash risk | P1-12 | V (pattern) |
| X-2 | High | M | Sidebar.jsx:87-195; App.jsx:176-229 | Nav/routes ignore permissions | P2-10 | A |
| X-3 | High | S | useInactivityTimeout.js:29-33,75-82 | Toast then hard logout; typed work lost | P2-08 | A |
| X-4 | Med | S | ErrorBoundary.jsx:17-19 | Raw error, no Sentry | P2-09 | A |
| X-5 | Med | M | Sidebar.jsx:88-183 | ~25 top-level items, duplicate icons/destinations | P8-01 | A |
| X-6 | Med | S | Sidebar.jsx:236,266,279-290 | Collapsed mode unusable | P8-02 | A |
| X-7 | Med | S | Header.jsx:44-52 + CompanyFilter ×30 | Two company dropdowns | P8-03 | A |
| X-8 | Med | S | Header.jsx:86-90 | Settings shown to all roles | P2-10 | A |
| X-9 | Med | M | index.html:7; App.jsx:84-104 | Same tab title; no breadcrumbs/search | P8-04 | A |
| X-10 | Med | M | 10 native dialogs; Modal/ConfirmDialog a11y; 22 custom overlays | Dialog fragmentation | P2-01 | A |
| X-11 | Med | L | repo-wide | ₹/date formatting inconsistent (fmtINR 326 vs toLocaleString 66 vs '₹'+ 70; fmtDate 29 vs toLocaleDateString 27) | P2-03 (new code) / P9 | A |
| X-12 | Low | M | DataTable, EmptyState, OnboardingWizard 0 imports; 74 "Loading…" | Unused kit | P9 | A |
| X-13 | Low | M | 627 buttons, 26 styles, 17 labelled; 295 emoji icons | Button/IconButton | P2-04 / P9 | A |
| X-14 | Low | S | DateSelector.jsx:109-116; formatters.js:86 | Month presets; hard-coded years | P2-03 | A |
| X-15 | Low | S | App.jsx:230 | Unknown URL → silent redirect | P8-06 | A |
| X-16 | Low | S | Login, Sidebar, index.html | Three product names; hard-coded version | P8-06 | A |
| X-17 | Low | S | utils/api.js:42 | Double error toasts | P2-02 | A |

### 9.7 Ops / process (O-) and new UI components (U-)
| ID | Sev | Eff | Item | PR | Tag |
|---|---|---|---|---|---|
| O-1 | Med | S | 6 bug reports `new` since May; duplicates → triage; show "Report #N received" after submit | P0-3 / P9 | FACT |
| O-2 | Low | S | Duplicate bug submissions (INFERENCE: no clear confirmation) | P9 | INF |
| O-3 | Low | S | Miss Punch stray "0" next to Correct | P1-24 | FACT (known) |
| O-4 | — | — | 390 px: 6 pages scroll sideways → mobile project | out of scope | FACT |
| U-RQ | — | M | ReviewQueue component | P2-06 | — |
| U-PP | — | M | PeoplePicker + parseCodes | P2-07 | — |
| U-DR | — | S | useDraft + return path | P2-08 | — |

### 9.8 Bulk items (B-)
| ID | Item | PR |
|---|---|---|
| B0a | Backend role guards on unguarded writes | P2-11 |
| B0b | Engine core | P3-01 |
| B1 | Extra duty bulk grant | P3-01 |
| B2 | Approval stage + master bulk edit | P5-01, P5-02 |
| B2b | New joiners | P5-03 |
| B3 | Salary revision | P5-04 |
| B4 | Shift roster | P7-01 |
| B5 | Miss punch + Stage 5 grid | P7-02 |
| B6 | Sales grids/uploads | P7-03 |
| B7 | Leave bulk, Mark Left batch, late/early decisions | P7-04 |

---

## 10. Working rules for builders (non-negotiable)
1. **Phase 0 gate:** list files to change + why + test plan; STOP; wait for Abhinav's "go" relayed by the planner. Bypassing is a hard violation.
2. **One finding = one PR = one branch.** Exception only with Abhinav's explicit OK: two Low polish findings in the same file.
3. **Branches:** `fix/<short>` or `feat/<short>` or `docs/<short>` off the latest `origin/main`. Never push to main. Abhinav merges in the GitHub web UI. After push: `git rev-parse HEAD` must equal `git rev-parse origin/<branch>`.
4. **Global DO NOT MODIFY** unless the PR names it and Abhinav approved it at Phase 0: `backend/src/services/salaryComputation.js`, `backend/src/services/dayCalculation.js`, `backend/src/database/schema.js`, `backend/src/routes/payroll.js`, `backend/src/services/recompute.js`; Stage 7 register (`SalaryComputation.jsx` `.salreg`, `COLS`, pin offsets); ED finance-review behaviour (#79); loans engine.
5. **Frontend:** after any `frontend/src` change run `npm run build --prefix frontend` and commit `frontend/dist`. Never hand-merge dist conflicts: delete dist, rebuild, `git add -A frontend/dist`.
6. **UPSERT completeness:** any `ON CONFLICT DO UPDATE SET` must include every INSERT column.
7. **Money/day changes:** end with the drift sanity query on the scratch DB (and production read-only after deploy): `SELECT employee_code, net_salary, gross_earned, total_deductions, ABS(net_salary-(gross_earned-total_deductions)) AS drift FROM salary_computations WHERE month=? AND year=? ORDER BY drift DESC LIMIT 20` — drift > 1 for anyone → STOP. (Check exact column names; `employee_code` vs `code` per schema.)
8. **Public repo:** fictional test data only; no names/codes/bank/PAN/salaries of real people in commits, tests, fixtures, PR text or logs.
9. **SQLite:** better-sqlite3, synchronous; SQLite syntax; keep transactions short.
10. **Same logic for single and bulk:** extract, don't copy.
11. **Smallest change;** no refactors outside scope; name what is NOT being touched in the plan.
12. **Progress discipline:** update `docs/ux-bulk/prs/<PR-ID>/PROGRESS.md` after every small step (state, done, next, rulings, RESUME block). Commit it with the work.
13. **CLAUDE.md:** add a "Last Session" entry at the top in the existing style (branch, what, files, fragile, verified, not tested, still open).
14. **Plain-language UI copy;** ₹ via fmtINR; dates via fmtDate; IST today.
15. **Self-debug + user simulation + v2** before handing over (owner preference): re-read code, run it, fix; simulate happy path + at least one edge case; re-run; report what was built, caught, tested, final status; state anything untestable and why.

---

## 11. Verification protocol (per PR)
1. `npm run build --prefix frontend` clean.
2. `cd backend && npx jest` — full suite; parked TDS failures are the only allowed reds (list them before/after to prove no new reds).
3. PR-specific jest tests (real routes via the existing test helpers).
4. Playwright check script on the **built dist** with a scratch DB seeded with fictional, production-shaped data (pattern: `backend/scripts/wide-layout-render.py`, `ed-finance-review-ux-check.py`): real logins per role, happy path + edge case, 0 page errors, 0 console errors, 0 unexpected API ≥ 400. Environment note: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` in the cloud workspace.
5. Regression: existing check scripts touching the same page still pass (e.g. `wide-layout-check.py` 47/47 for Stage 7, `ed-finance-review-ux-check.py` 25/25 for ED).
6. Money/day PRs: drift query.
7. **Independent review:** for High-severity or money PRs, a separate agent that did not write the code reviews the diff against the plan (engineering:code-review style) before push.
8. **Owner post-deploy check** in the seven-field format (Surface · Preflight · Action · Expected · Verify · Undo · Return), including one unrelated item that must be unchanged.

---

## 12. Landmines
1. `.salreg` scoped CSS (Stage 7): `.table-compact td` colour beats Tailwind on td; ₹0 grey goes through `.salreg-mute`. `COLS` is the single source for th/td/tfoot/drill-down colSpan. Pinned right offsets are fixed widths (actions 104@0, status 120@104, Take Home 104@224, Net 96@328). Sticky needs `border-separate border-spacing-0` and its own `overflow-auto` container.
2. Card vs totals definitions on Stage 7 must stay in lockstep (take-home excludes held rows).
3. Shallow clones: new branch remote-tracking refs aren't created automatically → stop hook says "no remote branch" after a successful push. Fix: `git config --add remote.origin.fetch '+refs/heads/<b>:refs/remotes/origin/<b>'; git fetch; git config branch.<b>.remote origin; git config branch.<b>.merge refs/heads/<b>`.
4. Push access from the cloud workspace: on 10 Oct the first push was refused ("not in this session's authorized repository set"). Fix that worked: attach the repo to the session with push access (`add_repo` owner `abhinavpoddar27-pixel`, repo `hr-salary-system`, access `push`), then `git fetch origin main` and push. `gh auth status` failing is separate and not needed for pushing.
5. Browser cache: Railway serves committed dist; always ⌘⇧R before judging.
6. ED uniqueness `(employee_code, grant_date, month, year)` incl. BIOMETRIC_AUTO rows written by `recompute.js` (INSERT OR IGNORE). Late coming uniqueness includes `applied_at` (re-upload duplicates). One pending salary change per employee. Sales codes unique per company only.
7. Stage 6 must run for All companies (known rule) — company-scoped runs cut rows.
8. `checkAutoStage6` can auto-fire Stage 6; bulk must coalesce triggers per period.
9. Dates in files: Excel serials vs text; DD-MM silently read as MM-DD; codes with leading zeros read as numbers; CSV BOM/CRLF from Excel-on-Mac. Normalise and show dates in words in previews.
10. Company labels are dirty in master data (literal 'null', blanks, case variants — known) → bulk must take company from the master record and flag blanks, never trust a typed value.
11. `localStorage` / `sessionStorage` may be blocked (private window/DLP) → try/catch with safe defaults.
12. The attendance-review stream also adds tables to `schema.js` and touches `api.js`/Sidebar/Analytics → see §13.
13. Viewer write protection was UI-only → P2-11 changes behaviour for some roles; production usage check first.
14. TDS tests are intentionally red (parked).

---

## 13. Parallel work streams and collision rules
| Stream | Branch/doc | Touches | Rule |
|---|---|---|---|
| Attendance Review → Analytics tab | `docs/attendance-review-handoff`; private docs `claude/attendance-review/*` | schema.js (2 tables), analytics routes, Analytics page, maybe Sidebar/api.js | Never build both on overlapping files at once. Before starting a PR, `git fetch` and check open branches touching the same files; rebase on main after the other merges. Each schema.js change is its own approved one-liner. |
| Wide layout close-out | `docs/wide-layout-cp9` | docs only | Merge first (P0-2). |
| Statutory flags | merged/ongoing per `statutory-flags/*` | statutory upload, employee master flags | Bulk master edit excludes PF/ESI/LWF (R10). |
| Loans | merged PRs up to #77 | loans pages/engine | Don't touch loans engine; Loans UI items (F-18) are display only. |
| Mobile | not started | all pages | Out of scope; don't regress narrow widths (keep "no page-level horizontal scroll" checks). |

---

## 14. Open questions (ask before the PR that needs them; record answers in §2 + PROGRESS.md)
| Q | Needed by | Question | Recommendation |
|---|---|---|---|
| Q1 | P3-01 | Offer "Also approve as HR" when saving an ED bulk batch? Default ticked or unticked? (915/973 approvals are by the creator.) | Offer it, default ticked; finance check unchanged |
| Q2 | P3-01 | 50-row cap: may one screen save a 109-person list as 3 batches (50+50+9) automatically, each undoable separately? | Yes — cap per batch, one screen |
| Q3 | P5-02 | Ruling R2 reading: finance approves sensitive fields only (bank, statutory numbers, status/Left, salary); shift/punch/department/designation apply directly? | Yes as read |
| Q4 | P1-04 | Stage 6: always run for All companies, or block when a company is selected? | Always All companies, with a one-line note on screen |
| Q5 | P1-07 | Remove Payable OT "Grant Extra Duty" tab and retire the endpoint? | Yes (after a production usage query) |
| Q6 | P1-23 | May the admin approve a salary change they requested? | No — second person always |
| Q7 | P4-06 | Alerts: revive (scheduled generation, fixed names) or remove? | Remove page + link unless there's a use for it now; revive later via the inbox |
| Q8 | P8-01 | Nav sections + one name for Finance Audit + Finance Verify | Sections: Daily · Payroll · Finance · People · Analytics · Daily Wage · Sales · Admin; name "Finance Review" |
| Q9 | P2-11 | Any role that currently writes through an unguarded route and must keep doing so? (answered from usage_logs first) | Decide per route after the query |
| Q10 | all | May two Low polish findings in the same file share one PR? | Yes for Low only |
| Q11 | P5-02 | Can company be changed in bulk master edit? | No — separate ruling |

---

## 15. Glossary of IDs
P- pipeline · F- payroll adjuncts/finance · H- HR core/reporting · D- daily wage · S- sales · X- shell/design system · O- ops/process · U- new UI components · B- bulk items · R- owner rulings · Q- open questions · Pn-xx PR IDs (phase-number).

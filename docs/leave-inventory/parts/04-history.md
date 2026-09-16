# 04 — Leave History

> Read-only audit, branch `docs/leave-inventory` @ `252b023`, base `origin/main` @ `3806a6d` (2026-06-03).

## ⚠️ METHOD CAVEAT — READ FIRST
**The repo is a SHALLOW clone.** `git rev-parse --is-shallow-repository` → `true`; `.git/shallow` holds 5 graft points (`0b7cb0a`, `4f66535`, `7f7703a`, `da399bf`, `de44c65`); `git rev-list --count origin/main` = 119 (reaches back only to ~2026-04-30). Two consequences, both of which produce **false history**:

1. **`git log -- <file>` reports the 5 graft commits as if they CREATED every file.** `git show 4f66535 -- backend/src/routes/leaves.js` renders as `new file mode 100644 ... @@ -0,0 +1,660 @@` even though that commit's message is about a Sales register banner and says *"No backend touched."* Any per-file "birth date" of 2026-04-30 / 2026-05-01 below is a **graft artifact, not a real birth**. FACT.
2. **`git merge-base --is-ancestor <sha> origin/main` returns false for every pre-2026-04-30 commit**, so all April leave commits *appear* unmerged. They are not. Re-verified by **content** against `origin/main`'s tree (`git cat-file -e`, `git show origin/main:<file>`). FACT.

All "SHIPPED" marks below are content-verified against `origin/main`, never ancestry-verified.

---

## A. Commit sweep

`git log --all -i -E --grep='leave|\bEL\b|\bCL\b|LEAFS|accrual|comp.?off|short.?leave|gate.?pass' --format='%h|%ad|%D|%s' --date=short` → **53 hits**. `LEAFS` → **0 hits** across all refs (searched, confirmed empty). FACT.

### A.1 Genuine leave commits (subject-line matches)

| SHA | Date | Subject |
|---|---|---|
| `5491559` | 2026-03-16 | Phase 5-7: Loans, Employee Docs, **Leave Mgmt**, Notifications |
| `bf0886b` | 2026-03-18 | Phase 5: **Leave accrual**, shift roster, compliance alerts, bulk PDF, attrition risk |
| `67998e8` | 2026-03-21 | 6-feature enhancement: … **Leave Register** … |
| `9806be8` | 2026-04-03 | fix: QW-7 warn on negative **leave balance** during approval |
| `3c5e32f` | 2026-04-10 | feat: EED-1 — Schema: 4 new tables + early_exit_deduction |
| `66decf0` | 2026-04-10 | feat: EED-2 — Backend: **short leave / gate pass** routes |
| `da3501c` | 2026-04-10 | feat: EED-3 — Backend: early exit detection service |
| `f7adb83` | 2026-04-10 | feat: EED-7 — Frontend: **Gate Passes** tab in Leave Management |
| `d2fca36` | 2026-04-10 | feat: EED-9 — Finance Approval in Finance Audit |
| `68b8e17` | 2026-04-10 | feat: EED-10 — Daily MIS early exits card |
| `ee12805` | 2026-04-10 | feat: EED-11 — CLAUDE.md update |
| `12f19b3` | 2026-04-11 | fix(**gate-passes**): B3/B7 empty-state + disabled button helper text |
| `2dc36e6` | 2026-04-11 | fix(sidebar): DEF-01 promote **Leave Management** to top-level nav |
| `e09c3ea` | 2026-04-11 | **Merge PR #7** from …/claude/early-exit-**gate-pass**-QGmJK |
| `b7d215b` | 2026-04-15 | feat: **Leave Management Phase 1** — schema + backend foundation |
| `a64ea49` | 2026-04-15 | feat: **Leave Management Phase 2** — day calculation leave integration |
| `76236f9` | 2026-04-15 | feat: **Leave Management Phase 3** — Stage 7 + Finance + Reports + Payslip |
| `731b5f5` | 2026-04-15 | feat: **Leave Management Phase 4** — frontend + intelligence detectors |
| `2e09606` | 2026-04-16 | fix(**leaves**): **accrual** permanent-only + DOJ-based **CL** pro-ration |
| `5f36f48` | 2026-04-16 | fix(**leaves**): guard initCLOpening against destructive re-runs |
| `28c6029` | 2026-04-16 | feat(**leaves**): **remove SL** from UI and write paths |
| `d929690` | 2026-04-16 | chore(**leaves**): export computeClEntitlement from phase5Features |
| `d7c35b5` | 2026-04-16 | feat(**leaves**): add 2026 **leave_balances reseed** script (dry-run + execute) |
| `f2099c0` | 2026-04-16 | fix: salary register **leave column headers** now color-coded |
| `8da6904` | 2026-05-11 | fix(payroll): drop non-existent duty_days from **compensatory_off** SELECT |
| `6b89b53` | 2026-05-11 | **Merge PR #25** from …/fix/**comp-off**-duty-days-column |

**Not caught by the sweep but load-bearing:** `796f34e|2026-04-16|docs: session handoff 2026-04-16` — the sole prose record of the Apr-2026 leave policy decision. Its *subject* contains no keyword; found only via `git log --all -S "'SL'"`. FACT. **This is the single most important artifact in this report (see §D.4, §E).**

### A.2 Body-only matches (subject not about leave)
`git log --grep` searches the full message. These 27 matched on the **body**, not the subject — verified by re-grepping each subject line (all 27 returned an empty keyword set): `c9a4c4e`, `d15cb61`, `965d40d`, `d58fa58`, `a9d55c0`, `86229e2`, `352fee2`, `687bfff`, `b627256`, `310237b`, `50cdd54`, `8d24ac0`, `5d873c1`, `dd444a8`, `adfb145`, `6c93bc6`, `0674574`, `634a3ce`, `ad74acf`, `f27d781`, `c9a2df3`, `3f11ea7`, `315a0bd`, `d8ea428`, `0d1807d`, `5f39571`, `0c089fe`. FACT.

Of these, **genuinely leave-adjacent** (peripheral, not policy): `a9d55c0` (reimport recompute re-runs the leave/comp-off day-calc loop), `634a3ce` + `ad74acf` + `c9a2df3` (contractor split — contractors excluded from CL/EL), `5d873c1` + `dd444a8` (pattern-engine leave detectors: sandwich leave, post-leave slump, sudden leave burn), `c9a4c4e` + `d15cb61` (audit attribution touching `short-leaves.js`). INFERENCE.

### A.3 True false positives
| SHA | Why it matched | Verdict |
|---|---|---|
| `b627256`, `310237b`, `352fee2`, `687bfff` | **"accrual"** = *Diwali* accrual ledger (Sales module), unrelated to leave | FALSE POSITIVE |
| `d58fa58`, `965d40d`, `86229e2`, `50cdd54`, `adfb145`, `0c089fe`, `5f39571`, `315a0bd`, `d8ea428`, `0d1807d` | **"leave"/"leaves"** used as the English verb ("…leaves a regression", "…leaves the row") | FALSE POSITIVE |
| `8d24ac0`, `68b8e17`, `d2fca36`, `6c93bc6`, `0674574`, `f27d781`, `3f11ea7` | "gate pass"/"early exit" context only — adjacent module, no leave-balance logic | BORDERLINE |

OPINION: the `\bCL\b` / `\bEL\b` arms of the regex contributed **zero** unique true positives; every CL/EL commit also said "leave". The `-i` flag makes `\bCL\b`/`\bEL\b` dangerously broad in principle, but produced no noise here in practice.

---

## B. Per-file history

Birth dates marked **(graft)** are artifacts — see the Method Caveat. All 8 files **exist on disk at HEAD and in `origin/main`'s tree**. FACT.

| File | Real first commit | Last touched | Real commits | Gap to today (2026-09-16) |
|---|---|---|---|---|
| `backend/src/routes/leaves.js` | `5491559` 2026-03-16 | `d15cb61` **2026-05-23** | 6 real (+3 graft) | **~3.8 months** |
| `backend/src/services/phase5Features.js` | `bf0886b` 2026-03-18 | `d929690` **2026-04-16** | 5 real (+3 graft) | **~5 months** |
| `backend/src/routes/compensatoryOff.js` | `b7d215b` 2026-04-15 | `b7d215b` **2026-04-15** | **1 real** (+3 graft) | **~5 months — never modified since birth** |
| `backend/src/routes/short-leaves.js` | `66decf0` 2026-04-10 | `c9a4c4e` **2026-05-23** | 2 real (+3 graft) | ~3.8 months |
| `backend/src/routes/phase5.js` | `bf0886b` 2026-03-18 | `5f36f48` **2026-04-16** | 3 real (+3 graft) | ~5 months |
| `frontend/src/pages/LeaveManagement.jsx` | `5491559` 2026-03-16 | `28c6029` **2026-04-16** | 7 real (+3 graft) | ~5 months |
| `frontend/src/components/GatePasses.jsx` | `f7adb83` 2026-04-10 | `12f19b3` **2026-04-11** | 2 real (+3 graft) | **~5 months — touched once, the day after birth** |
| `backend/scripts/reseed-leave-balances-2026.js` | `d7c35b5` 2026-04-16 | `d7c35b5` **2026-04-16** | **1 real** (+3 graft) | ~5 months — born and never touched |

**Signal (INFERENCE):** the entire leave subsystem went quiet on **2026-04-16**. The only later touches are (a) `8da6904` 2026-05-11, an *incident fix* in `payroll.js`/`jobQueue.js`/`import.js` (not in a leave file), and (b) `d15cb61`/`c9a4c4e` 2026-05-23, a *repo-wide* audit-attribution sweep that touched `leaves.js` and `short-leaves.js` incidentally. **No intentional leave feature work has happened in ~5 months** while the repo moved on to Sales, SQL Console, bug-reporter, record-history and audit-attribution.

---

## C. Unmerged branches touching leave

`git branch -r --no-merged origin/main` → **85 branches** (of 120 remotes). Three-dot diffs **do** work (`git merge-base origin/main origin/fix/comp-off-duty-days-column` → `8da6904`, exit 0) — so this scan is trustworthy despite the shallow clone. FACT.

Filtering each branch's `git diff --name-only origin/main...<branch>` through `grep -iE 'leave|comp.?off|short-leaves|phase5|accrual|gate'`:

| Branch | Leave-ish paths | Source? |
|---|---|---|
| `origin/claude/wire-salary-structure-creation-oGCDA` | `frontend/dist/assets/LeaveManagement-VCYAVQjI.js` (1 file) | **dist artifact ONLY — zero source** |

**All other 84 unmerged branches touch no leave path at all.** FACT.

**INFERENCE: there is no in-flight, parked, or abandoned leave work anywhere in the repo.** Whatever exists is on `main`; whatever is missing was never started. This independently reproduces finding F-002 already recorded in `docs/leave-inventory/PROGRESS.md`.

---

## D. Doc mentions

### D.1 `CLAUDE.md` — 62 regex hits, but almost all noise
`grep -n -iE 'leave|comp.?off|accrual|gate.?pass|short.?leave|\bCL\b|\bEL\b|LWP|\bSL\b' CLAUDE.md` → 62 lines. Manual triage:

**(a) Shipped-feature descriptions (architecture reference, lines 1185-1835):**
- `CLAUDE.md:1217` — `leaves.js  Leave applications, approve/reject, balance check`
- `CLAUDE.md:1233` — `phase5.js  Leave accrual, shift roster, attrition`
- `CLAUDE.md:1235` — `short-leaves.js  Gate pass / short leave CRUD, quota check`
- `CLAUDE.md:1256` — `phase5Features.js  Leave accrual, attrition risk`
- `CLAUDE.md:1278`, `1294` — `LeaveManagement.jsx`, `GatePasses.jsx`
- `CLAUDE.md:1527-1528` — table inventory: `short_leaves (NEW, April 2026)`, `leave_balances`, `leave_transactions`, `leave_applications`
- `CLAUDE.md:1770-1791` — `## Early Exit Detection & Gate Pass Management (April 2026)`, the one real leave-adjacent section header
- `CLAUDE.md:1793` — `## Early Exit Date Range Report (April 2026)`

**(b) Rules stated:**
- `CLAUDE.md:1431` — *"Sunday rule (permanent only): worked >=6 Mon-Sat → paid Sunday; 4-5 → **CL/EL fallback** or LOP if shortage <=1.5; <4 → unpaid Sunday"*
- `CLAUDE.md:1434` — *"Contractor mode: payable = present + WOP + halfPresent (no Sunday eligibility, **no CL/EL**)"*
- `CLAUDE.md:1619` — Sunday rule 3-tier, `dayCalculation.js` lines 220-275
- `CLAUDE.md:1595` — *"**LOP**: NOT a separate deduction — pro-rating handles missed days via earnedRatio (line 338)"*
- `CLAUDE.md:1603` — salary auto-hold *"unless approved leave exists"*
- `CLAUDE.md:1631` — *"**Gate pass quota**: 2 per employee per calendar month. Breachable with `force_quota_breach: true`. Cancelled gate passes don't count toward quota."*
- `CLAUDE.md:1630` — *"Gate passes in `short_leaves` provide exemption or reduce flagged minutes. Detection is idempotent."*
- `CLAUDE.md:1544` — composite key `(employee_code, month, year, company)` spans `leave_balances`

**(c) STALE / CONTRADICTED claim — the important one:**
- **`CLAUDE.md:1420`** — *"Edge cases: Apply leave (A → **CL/EL/SL** with balance check)"*
  → **Directly contradicted by shipped code.** `origin/main:backend/src/routes/leaves.js:354` returns `Invalid leave_type. Must be CL or EL. SL is no longer supported.` FACT. CLAUDE.md was never updated after `28c6029`.

**(d) Pure false positives (~40 of 62):** "leave" as a verb (`:54`, `:265`, `:367`, `:611`, `:973`, `:1867`, `:1903`, `:2064`), "accrual" meaning *Diwali* (`:631`, `:634`, `:635`, `:638`, `:655`, `:678`, `:682`, `:702`, `:1321`, `:1334`), "Earned Leave" as a *Sales payslip column* (`:563`, `:570`, `:795`), `\bEL\b`/`\bCL\b` inside unrelated tokens (`:108`, `:252`, `:283`, `:545`).

### D.2 `README.md` — 3 hits
- `README.md:62` — `dayCalculation.js  ← Sunday rule + leave adjustment`
- `README.md:94` — `| 6 | **Day Calc** | Apply Sunday rule + **CL/EL deduction logic** |`
- `README.md:132` — *"**≥ 4 working days** → Deduct from **CL, then EL, then LOP** (if shortage ≤ 1.5 days)"* ← the clearest statement of **deduction ORDER** anywhere in the docs. FACT.

README says **CL/EL only** — consistent with post-SL-removal reality. INFERENCE: README was either written after Apr 16 or never mentioned SL.

### D.3 `docs/` — no leave spec exists
| File | Hits | Nature |
|---|---|---|
| `docs/BACKEND_AUDIT_2026.md` | 5 | 4 are "leave" the verb; **1 real**: `:70` — *"`hasApprovedLeave()` (`catch { return false }` — wrong-direction default for a salary hold)"* — a **known bug**, tagged FACT in that doc |
| `docs/bug-reporter-plan-v3.md` | 1 | verb, FP |
| `docs/bug-reporter-prompts-steps-4-13.md` | 6 | all verb, FP |
| `docs/cowork-fix-verification-prompt.md` | 8 | **real** — manual QA script for PR #7: `:21` DEF-01 nav promotion, `:31` *"5 tabs visible (Applications, Leave Balances, Leave Register, Adjustments, **Gate Passes**)"*, `:112`, `:119` |
| `docs/leave-inventory/PROGRESS.md` | 24 | this audit's own notes |
| `docs/leave-inventory/PROMPT.md` | 26 | this audit's own prompt |
| `sales_consolidated_design.md` | **0** | — |
| `sales_salary_module_design.md` | 19 | 17 Diwali-accrual FPs; **2 real**: `:381` `earned_leave_days REAL DEFAULT 0`, `:622` + `:795` *"total_days = days_given + paidSundays + gazettedHolidays + **EL (manual)**"* — sales EL is **manually entered**, not accrued. FACT. |

**FACT: `docs/` contains NO leave design document, NO policy spec, NO entitlement table.**

### D.4 ⭐ ANSWER: does CLAUDE.md state the CL rule / EL rate / EL eligibility / SL decision?

**NO. Not one of the four. Searched exhaustively — 0 hits for all of them.** FACT.

- `grep -n "2026-04-16" CLAUDE.md` → **0 hits**
- `grep -n -iE "SL (abolish|removed|no longer)|abolish" CLAUDE.md` → **0 hits**
- `git show origin/main:CLAUDE.md | grep -n "2026-04-16"` → **0 hits** (never reached main either)
- No line states `7`, `12`, `el_accrual_rate`, `el_eligibility_days`, or `computeClEntitlement`.

**Root cause — a documented session-log GAP.** CLAUDE.md uses a rolling `## Section 0: Previous Session` stack. `grep -n '^\- \*\*Date:\*\*' CLAUDE.md` shows the stack running …`:783` 2026-04-20, `:856` **2026-04-20**, `:878` **2026-04-15**… — it jumps **straight from 04-20 to 04-15**. The **2026-04-16 entry is absent.** FACT.

That entry **does exist** — as `796f34e`, a 21-line CLAUDE.md insert, stranded on the **unmerged** branch `origin/claude/session-start-MEzoy` and nowhere else. It is the only place the Apr-2026 leave policy is written down in prose. **Every policy quote in §G comes from a commit message, not from CLAUDE.md.**

OPINION: this is the highest-value finding in this report. The team's canonical context file has a hole exactly where the leave policy decision lives, which is very likely why this audit was commissioned at all.

---

## E. Removals — especially SL

**SL removal is REAL, SHIPPED, and fully sourced.** The prompt's hypothesis is confirmed.

### E.1 The commit
`28c6029 | 2026-04-16 | feat(leaves): remove SL from UI and write paths`, message verbatim:

> Drop SL column from Leave Balances register UI
> Remove SL from GET /balances SELECT and /balances/:code response
> Reject SL in POST /adjust and finance-audit apply-leave validators
> Remove SL from /approve balance-decrement logic
> Remove Sick Leave option from leave application/adjustment forms
> Update TOTAL column math to CL + EL only
>
> **Historical SL data preserved:**
> leave_balances table schema unchanged (column not dropped)
> Existing SL rows in leave_balances/transactions/applications untouched
> Reports and historical leave views still render SL records
>
> **Rationale: SL abolished per Apr 2026 policy. New leave model is permanent-only CL+EL** (see commit 2e09606 for accrual logic).

Diffstat (source only; the rest is 62 re-hashed `frontend/dist` chunks):
```
backend/src/routes/employees.js     |  5 ++---
backend/src/routes/financeAudit.js  |  4 ++--
backend/src/routes/leaves.js        | 26 +++++++++++++++-------
frontend/src/pages/LeaveManagement.jsx  (per 796f34e: 7 surgical edits)
```

### E.2 Verified landed in `origin/main` (content, not ancestry)
- `origin/main:backend/src/routes/leaves.js:354` → `error: \`Invalid leave_type. Must be CL or EL. SL is no longer supported.\`` FACT
- `origin/main:backend/src/routes/leaves.js:479` → same message in the bulk path. FACT
- `origin/main:frontend/src/pages/LeaveManagement.jsx` → grep for `'SL'|"SL"|Sick` → **0 hits**. FACT
- Only 3 `SL` strings survive in `leaves.js`, all of them **rejection messages or a historical comment** (`:175` *"If the leave was already Approved and was CL / EL / SL, the consumed…"*). FACT
- **Schema NOT changed** — `leave_type TEXT NOT NULL` with no CHECK constraint at `schema.js:100/113/406/1582`. Nothing at the DB level prevents an SL row. FACT → INFERENCE: SL is blocked at the **application layer only**; any direct SQL write (incl. the SQL Console write path) can still insert SL.

### E.3 Other removals
- `d7c35b5` (reseed script) states: *"**SL: abolished, 2026 SL rows deleted across all employees**"* and *"Historical (year != 2026): untouched across all tables"*. **PLANNED — script exists, execution unconfirmed** (it is dry-run by default and requires `--execute-after-review`; the governing prompt forbids running it).
- `git log --all --diff-filter=D -- '*leave*' '*Leave*'` → 14 hits, but **all are `frontend/dist/assets/LeaveManagement-*.js` chunk rotations**, not source deletions. FACT.
- **No leave source file has ever been deleted.** FACT.

---

## F. ⭐ THE TIMELINE

Merged chronology: commits + CLAUDE.md session-log entries. "SHIPPED" = content-verified in `origin/main`.

| DATE | SHA | WHAT CHANGED | SOURCE | STATUS |
|---|---|---|---|---|
| 2026-03-16 | `21a359e` | Initial commit — platform bootstrap | commit msg | SHIPPED |
| 2026-03-16 | `5491559` | **Leave Mgmt v0** born: `leaves.js` + `LeaveManagement.jsx` first appear | commit msg | SHIPPED |
| 2026-03-18 | `bf0886b` | **Leave accrual engine born**: `phase5Features.js` + `phase5.js` | commit msg | SHIPPED |
| 2026-03-21 | `67998e8` | Leave Register tab added | commit msg | SHIPPED |
| 2026-04-03 | `9806be8` | QW-7: warn on negative leave balance at approval | commit msg | SHIPPED |
| 2026-04-10 | `3c5e32f` | EED-1: `short_leaves` + 3 early-exit tables | commit msg; `CLAUDE.md:1527,1771` | SHIPPED |
| 2026-04-10 | `66decf0` | EED-2: `short-leaves.js` — gate pass CRUD + quota | commit msg; `CLAUDE.md:1235,1774` | SHIPPED |
| 2026-04-10 | `da3501c` | EED-3: early-exit detection service | commit msg | SHIPPED |
| 2026-04-10 | `f7adb83` | EED-7: **`GatePasses.jsx` born** — tab in Leave Management | commit msg; `CLAUDE.md:1294` | SHIPPED |
| 2026-04-10 | `d2fca36`/`68b8e17`/`ee12805` | EED-9/10/11: finance approval, Daily MIS card, CLAUDE.md update | commit msgs | SHIPPED |
| 2026-04-11 | `12f19b3` | Gate-pass B3/B7 empty-state + helper text (**last-ever GatePasses.jsx edit**) | commit msg | SHIPPED |
| 2026-04-11 | `2dc36e6` | DEF-01: Leave Management promoted to top-level nav | commit msg; `docs/cowork-fix-verification-prompt.md:21,29` | SHIPPED |
| 2026-04-11 | `e09c3ea` | **Merge PR #7** — early-exit / gate-pass | PR title | SHIPPED |
| 2026-04-12 | `5d873c1` | Pattern engine: sandwich-leave, post-leave-slump, sudden-leave-burn detectors | `CLAUDE.md:1043-1044` | SHIPPED |
| 2026-04-15 | `b7d215b` | **Leave Phase 1** — schema + backend foundation; **`compensatoryOff.js` born** | commit msg | SHIPPED |
| 2026-04-15 | `a64ea49` | **Leave Phase 2** — day-calc leave integration ⚠️ *introduced the `duty_days` bug* | commit msg; later `8da6904` | SHIPPED (**defective**) |
| 2026-04-15 | `76236f9` | **Leave Phase 3** — Stage 7 + Finance + Reports + Payslip | commit msg | SHIPPED |
| 2026-04-15 | `731b5f5` | **Leave Phase 4** — frontend + intelligence detectors | commit msg | SHIPPED |
| **2026-04-16** | `2e09606` | **⭐ POLICY: accrual restricted to `['Permanent']`; `computeClEntitlement()` = DOJ pro-ration 7/6/5/4/3/2** | commit msg | SHIPPED |
| **2026-04-16** | `5f36f48` | `initCLOpening` made idempotent — `ON CONFLICT DO NOTHING` + `policy_config` guard `cl_seed_<year>_v1` | commit msg | SHIPPED |
| **2026-04-16** | `28c6029` | **⭐ POLICY: SL abolished** — removed from UI + all write paths; historical rows preserved | commit msg | SHIPPED |
| 2026-04-16 | `d929690` | Export `computeClEntitlement` for reuse by reseed script | commit msg | SHIPPED |
| 2026-04-16 | `d7c35b5` | **2026 reseed script** (dry-run default, `--execute-after-review`, guard `reseed_2026_v1`) | commit msg | SHIPPED (code) / **UNCONFIRMED (ever executed)** |
| 2026-04-16 | `f2099c0` | Salary-register leave headers color-coded — **CL=amber, EL=green, LWP=orange, OD=blue, SL=slate, UA=red** | commit msg | SHIPPED (**SL still colored, same day SL was removed**) |
| 2026-04-16 | `796f34e` | **⭐ The 21-line CLAUDE.md policy handoff** | commit diff | **NEVER MERGED** — stranded on `origin/claude/session-start-MEzoy`; absent from `origin/main:CLAUDE.md` |
| *2026-04-16 → 2026-05-11* | — | *(26-day silent outage, see next row)* | — | — |
| 2026-05-11 | `8da6904` | **INCIDENT FIX**: `duty_days` doesn't exist on `compensatory_off_requests` → *"Stage 6 day-calculation failing silently for **ALL 447 employees** (0 OK, 447 failed)"* | commit msg | SHIPPED |
| 2026-05-11 | `6b89b53` | **Merge PR #25** — comp-off duty_days column | PR title | SHIPPED |
| 2026-05-23 | `d15cb61`, `c9a4c4e` | Repo-wide audit-attribution sweep; incidentally touched `leaves.js` + `short-leaves.js` (**last touch of any leave file**) | commit msgs | SHIPPED |
| 2026-06-03 | `3806a6d` | `origin/main` tip (PR #41, unrelated to leave) | — | SHIPPED |
| **2026-06-03 → 2026-09-16** | — | **~3.5 months: zero leave commits** | absence of hits | — |
| 2026-09-16 | `252b023` | This read-only leave inventory audit opens | commit msg | IN PROGRESS |

**Shape (INFERENCE):** three bursts, then silence. (1) **Mar 16-21** — leave CRUD + accrual scaffolding. (2) **Apr 10-11** — gate pass / short leave / early exit, shipped via PR #7. (3) **Apr 15-16** — a 4-phase rebuild followed, *the very next day*, by a 5-commit policy correction that redefined the leave model (permanent-only, CL=7 DOJ-pro-rated, SL abolished). Then **nothing intentional for 5 months**, punctuated only by a May 11 production incident whose root cause was planted in the Apr 15 burst and ran undetected for 26 days. The Apr-16 policy work was never written into CLAUDE.md.

---

## G. Decisions found (quoted, with source)

**D-1 — SL abolished.** `28c6029`: *"**Rationale: SL abolished per Apr 2026 policy. New leave model is permanent-only CL+EL** (see commit 2e09606 for accrual logic)."* FACT. Enforced at `origin/main:leaves.js:354,479`.

**D-2 — CL entitlement = 7, pro-rated by DOJ (NOT 12).** `2e09606`: *"Add computeClEntitlement() helper: **7/6/5/4/3/2 by effective join month**. Mid-month joiners: DOJ day > 1 rolls to next month (Mar 25 -> Apr bucket). Pre-year and null-DOJ joiners treated as Jan (full 7 CL). **CL is now one-time DOJ-based seed per year (not monthly drip)**."*
Code, `origin/main:backend/src/services/phase5Features.js:22-38`:
> `*   Jan-Feb=7, Mar-Apr=6, May-Jun=5, Jul-Aug=4, Sep-Oct=3, Nov-Dec=2`
> `* Formula: 7 - floor((effectiveMonth - 1) / 2)`
> `return Math.max(0, 7 - Math.floor((effectiveMonth - 1) / 2));`
FACT.

**D-3 — ⚠️ The 7-vs-12 conflict is REAL and still live in `origin/main`.** Three sites still assert 12:
- `origin/main:backend/src/database/schema.js:633` → `['cl_annual_entitlement', '12', 'CL days per year']`
- `origin/main:backend/src/routes/employees.js:302` → `…VALUES(…)` .run(…, `type === 'CL' ? 12 : 0`, `type === 'CL' ? 12 : 0`) — single-employee create
- `origin/main:backend/src/routes/employees.js:942` → `insertLeave.run(empRow.id, year, 'CL', 12, 12)` — bulk import
**`git grep -n "cl_annual_entitlement" origin/main -- backend frontend` returns exactly ONE hit — the seed at `schema.js:633`. The key is written and never read.** FACT.
`796f34e` already knew: *"the two `employees.js` writes use **hard-coded `opening=12` for CL with no DOJ-based pro-ration**; they're **vestigial paths** HR likely doesn't hit post-bulk-import. Worth a future cleanup to delete entirely and route all CL seeding through `initCLOpening`."* → **Never cleaned up.** FACT.

**D-4 — EL accrual rate and eligibility.** `origin/main:backend/src/services/phase5Features.js` docblock:
> *"**EL**: Paid-days-driven. The employee must be past their DOJ-based eligibility floor (`policy_config.el_eligibility_days`, **default 180**). Earned = **floor(paid_days_ytd / 20) × rate** (`policy_config.el_accrual_rate`, **default 1**). This month's accrual is delta vs the running earned total."*
Implementation: `const elRate = _getPolicyNumber(db, 'el_accrual_rate', 1); const elEligibilityDays = _getPolicyNumber(db, 'el_eligibility_days', 180);` FACT.
Corroborated by `d7c35b5`: *"EL: recomputed from day_calculations Jan-Apr 2026 (**1 per 20 present days**)"*. FACT.

**D-5 — Accrual eligibility = Permanent only.** `2e09606`: *"Add **LEAVE_ELIGIBLE_TYPES config (currently ['Permanent'])**. Filter runLeaveAccrual employee SQL by employment_type."* Plus `CLAUDE.md:1434`: *"Contractor mode: … no CL/EL"*. FACT.

**D-6 — CL seeding is idempotent-by-guard.** `5f36f48`: *"Add once-per-year policy_config guard (key: **`cl_seed_<year>_v1`**) that short-circuits the function on re-run and returns `alreadyCompleted:true`."* Known limitation, self-documented in `796f34e`: *"a re-run with a different `depMonth` arg has **no effect** … HR must manually delete the guard row first."* FACT.

**D-7 — Grandfather clamp for over-entitled employees.** `d7c35b5`: *"CL usage preservation with grandfather clamp: `new_balance = max(0, new_entitlement - existing_used)`"* — and the commit names **one** expected grandfather case (employee code `23152`), who *"used 12 under old policy, new entitlement 7, new balance clamped to 0."* FACT. (Code only, per audit rules.)

**D-8 — Year-end lapse: both CL and EL lapse.** `origin/main:phase5Features.js:390` → *"Year-end lapse: both CL and EL lapse. The remaining balance at month 12 is…"* FACT.

**D-9 — Deduction order CL → EL → LOP.** `README.md:132`: *"**≥ 4 working days** → Deduct from CL, then EL, then LOP (if shortage ≤ 1.5 days)"*; `CLAUDE.md:1431` agrees. FACT.

**D-10 — Historical SL data deliberately retained.** `28c6029`: *"leave_balances table schema unchanged (column not dropped) / Existing SL rows … untouched / Reports and historical leave views still render SL records."* Restated in `796f34e` as a known-issue: *"SalaryComputation/DailyMIS/DayCalculation/Reports/Settings/EmployeeProfile/payslipPdf **still render SL in historical contexts — intentional (audit history)**."* FACT.

**D-11 — Sales EL is manual, not accrued.** `sales_salary_module_design.md:622,795`: *"total_days = days_given + paidSundays + gazettedHolidays + **EL (manual)**"*. FACT. The sales module has its own `earned_leave_days` column (`:381`) disconnected from `leave_balances`.

---

## H. Planned-but-unbuilt candidates
*(All flagged: **claimed in docs, code presence to be cross-checked** with agents 1-3.)*

| # | Claim | Source | Note |
|---|---|---|---|
| H-1 | 2026 reseed **executed** in production | `d7c35b5` | Script is dry-run by default; **no commit, log or doc records an `--execute-after-review` run**. Guard `reseed_2026_v1` in `policy_config` would prove it — a live-DB question. UNCONFIRMED. |
| H-2 | Railway smoke tests for SL removal | `796f34e`: *"(b) Railway production smoke tests (Test 1: GET /balances response, Test 2: POST /adjust with SL → 400) — spec'd in task but **couldn't run from sandbox (HTTP 403 to Railway)**. Must be run by user after deploy."* | No later commit/doc records them running. **PLANNED-ONLY.** |
| H-3 | Post-seed verification checklist (5 items incl. `SELECT key,value FROM policy_config WHERE key LIKE 'cl_seed_%'`) | `796f34e` "Next session should" | The "next session" (2026-04-20, `CLAUDE.md:856`) was about **daily wage**, not leave. **Never done.** |
| H-4 | `employees.js:302/942` hard-coded CL=12 cleanup | `796f34e` *"Worth a future cleanup to delete entirely"* | **Still present in `origin/main`.** FACT (verified by grep). |
| H-5 | `cl_annual_entitlement` policy key ever read | `schema.js:633` seeds `'12'` | **Zero readers.** Dead config that contradicts shipped code. FACT. |
| H-6 | `LEAVE_ELIGIBLE_TYPES` case/whitespace guard | `796f34e` *"string-exact match — if HR ever types `'permanent'` or `' Permanent '` … that employee **silently drops out of accrual**. No trim/case-insensitive guard."* | Never added. |
| H-7 | Cosmetic purge of historical SL rows | `796f34e` *"If HR later wants a cosmetic purge, that's a separate explicit DELETE prompt."* | Explicitly deferred. **PLANNED-ONLY, by design.** |
| H-8 | `hasApprovedLeave()` silent-catch fix | `docs/BACKEND_AUDIT_2026.md:70` — *"`catch { return false }` — **wrong-direction default for a salary hold**"* | Audit doc flags it as FACT; no fix commit found. **KNOWN BUG, OPEN.** |
| H-9 | SL still color-coded in salary register | `f2099c0` (2026-04-16) sets `SL=slate` | Shipped the **same day** SL was abolished. |
| H-10 | `CLAUDE.md:1420` "A → CL/EL/**SL**" | `CLAUDE.md:1420` | **Doc contradicts code.** Not a plan — a stale claim. Needs a doc fix. |

---

## I. Findings

1. **FACT** — The repo is a **shallow clone** (`.git/shallow`, 5 grafts; `origin/main` depth 119). `git log -- <file>` and `merge-base --is-ancestor` both produce **false results** for pre-2026-04-30 history. Every conclusion here is content-verified against `origin/main`'s tree.
2. **FACT** — **SL was abolished on 2026-04-16** by `28c6029`, with the rationale in the commit message: *"SL abolished per Apr 2026 policy. New leave model is permanent-only CL+EL."* Verified live in `origin/main:leaves.js:354,479`; zero `SL` in `LeaveManagement.jsx`.
3. **FACT** — **CL = 7, pro-rated by DOJ** (`7 - floor((effectiveMonth-1)/2)` → 7/6/5/4/3/2), `phase5Features.js:22-38`. **NOT 12.**
4. **FACT** — **The 7-vs-12 conflict is unresolved in shipped code**: `schema.js:633` seeds `cl_annual_entitlement='12'` (never read — one grep hit, the seed itself) and `employees.js:302` + `:942` hard-code CL opening = 12. `796f34e` called these "vestigial" in April and they were never removed.
5. **FACT** — **EL = `floor(paid_days_ytd / 20) × el_accrual_rate` (default 1), gated by `el_eligibility_days` (default 180)**; CL/EL both lapse at year end (`phase5Features.js:390`); accrual is restricted to `LEAVE_ELIGIBLE_TYPES = ['Permanent']`.
6. **FACT** — **CLAUDE.md nowhere states the CL rule, the EL rate, EL eligibility, or the SL decision.** `grep "2026-04-16"` → 0 hits; `grep -iE "abolish"` → 0 hits. The session-log stack skips **straight from 2026-04-20 (`:856`) to 2026-04-15 (`:878`)**.
7. **FACT** — The missing entry exists as `796f34e` (21 lines, 2026-04-16), stranded on the **unmerged** branch `origin/claude/session-start-MEzoy`. It never reached `origin/main:CLAUDE.md`. It is the **only prose record** of the policy and contains the fragility list, the known issues, and the verification checklist.
8. **OPINION** — Finding 7 is the headline. The leave policy was decided, implemented and shipped correctly, then the *memory* of it was lost. Recovering `796f34e` into CLAUDE.md is the single highest-value, lowest-risk follow-up — the text is already written and already accurate.
9. **FACT** — **No unmerged branch adds leave source.** 85 unmerged branches; exactly one (`origin/claude/wire-salary-structure-creation-oGCDA`) touches a leave path, and only the `frontend/dist/assets/LeaveManagement-VCYAVQjI.js` build artifact. Three-dot diffs verified working.
10. **INFERENCE** — Therefore **no in-flight leave work exists**. Every gap agents 1-3 find is a genuine gap, not work-in-progress.
11. **FACT** — **The leave subsystem has been frozen since 2026-04-16** (~5 months). `compensatoryOff.js` and `reseed-leave-balances-2026.js` have **never been modified since birth**; `GatePasses.jsx` was touched once, the day after it was created. The only later edits were an incident fix (May 11) and a repo-wide audit sweep (May 23).
12. **FACT** — **Leave Phase 2 (`a64ea49`) shipped a latent production-breaking bug**: it SELECTed `duty_days` from `compensatory_off_requests`, a column that does not exist. Per `8da6904`: *"Stage 6 day-calculation failing silently for **ALL 447 employees** ('0 OK, 447 failed)"*, masked by a per-employee `try/catch`. **Undetected for 26 days** (Apr 15 → May 11).
13. **OPINION** — Finding 12 plus `BACKEND_AUDIT_2026.md:70` (`hasApprovedLeave()` → `catch { return false }`) show a repeated pattern: **silent catches around leave logic turn schema drift into invisible payroll failure.** Worth calling out as a class of risk, not two isolated bugs.
14. **FACT** — **SL is blocked at the application layer only.** `leave_type` is `TEXT NOT NULL` with **no CHECK constraint** (`schema.js:100,113,406,1582`). Direct SQL (including the admin SQL Console write path) can still insert SL rows.
15. **FACT** — `CLAUDE.md:1420` still documents *"Apply leave (A → CL/EL/**SL** with balance check)"*, directly contradicted by `leaves.js:354`. Doc lag, unfixed for 5 months.
16. **FACT** — `f2099c0` (2026-04-16) color-coded **six** leave columns including `SL=slate` — shipped the same day SL was removed from Leave Management.
17. **FACT** — **`docs/` contains no leave spec.** The CL/EL/SL policy exists *only* in commit messages and in `phase5Features.js` docblocks. `sales_consolidated_design.md` has zero leave mentions.
18. **FACT** — Sales runs a **parallel, disconnected** leave concept: `earned_leave_days` (`sales_salary_module_design.md:381`), **manually entered** (`:622`, `:795`), with no link to `leave_balances`.
19. **FACT** — `LEAFS` returns **0 hits** across all refs. Whatever that term refers to, it is not in this repo's git history.
20. **INFERENCE** — The `\bCL\b`/`\bEL\b`/`LEAFS` arms of the sweep regex contributed no unique true positives; ~40 of 62 CLAUDE.md hits and ~10 of 53 commit hits are "leave"-the-verb or Diwali-"accrual" noise. A future sweep should use `leave_|leaves\.js|leave management|comp.?off|gate.?pass|accrual` instead.

---

## Needs chat confirmation
*(Past claude.ai chats are not reachable from this session. `2e09606` cites "Apr 16 2026 session", `d7c35b5` cites "Apr 16 2026 leave balances diagnosis + policy decision session", and `f2099c0` carries a session URL — the reasoning behind these decisions lived in chat, not in git.)*

1. **Was CL=7 a new policy or a correction of a mis-implemented 12?** `2e09606` states the rule but never says what it replaced. The surviving `12`s (schema + `employees.js` ×2) suggest 12 was the *original* intent.
2. **Who decided SL was abolished, and when did it take effect for employees?** The commit says *"per Apr 2026 policy"* — git has no policy document, no effective date, no approver.
3. **Was `reseed-leave-balances-2026.js` ever actually run with `--execute-after-review`?** Nothing in git records an execution. (A live `policy_config` read of guard row `reseed_2026_v1` would settle it.)
4. **Were the two Railway smoke tests (H-2) ever performed?** `796f34e` says they were blocked by HTTP 403 from the sandbox and handed to the user.
5. **Was omitting the 2026-04-16 entry from CLAUDE.md deliberate or an accident?** The handoff commit exists but its branch was never merged — looks accidental, but only the chat would confirm.
6. **Is the `cl_annual_entitlement='12'` key intended for future use, or is it dead config to delete?**
7. **Should historical SL rows eventually be purged?** `796f34e` explicitly defers this to *"a separate explicit DELETE prompt"* that never came.
8. **Was the 26-day Stage-6 outage (Apr 15 → May 11) noticed by HR, or only found during the May 11 OT/ED investigation?** `8da6904` implies the latter; impact on April payroll is unknown from git.
9. **What is "LEAFS"?** Zero hits in this repo. Possibly a term from a prior chat, another system, or a typo.

---

## Provenance note (added by orchestrator, not the agent)

This file was produced by the history Explore subagent, which ran without `Write` in its toolset
and handed its report back as text. The orchestrator transcribed it verbatim. The shallow-clone
caveat at the top of this file is the most important methodological note in the whole audit —
it invalidates naive `git log -- <file>` birth dates and all ancestry checks against `origin/main`.

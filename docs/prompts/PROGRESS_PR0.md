# PROGRESS — PR-0 (leave safety floor + CI truth)

Branch: `fix/leave-safety-and-ci` (base `origin/main` @ `977e0b3`)
Full prompt: `docs/prompts/PR0_SAFETY.md`

Every claim is tagged **FACT** (file:line or command output), **INFERENCE**, or **OPINION**.

---

## OWNER RULINGS

- Leave eligibility stays **permanent employees only** — do not widen the engine filter.
- CL pro-rata openings corrected by a **separate one-off script**, not here.
- **SL is abolished.**
- **Finalized months are never recalculated.**
- **Stage 7 salary never recomputes automatically.**
- Do **not** repair employee 23725's data. Code only.

---

## HARD RULES

- DO NOT MODIFY: `services/salaryComputation.js`, `services/dayCalculation.js`,
  `database/schema.js`, `routes/payroll.js`. No schema changes.
- No leave-engine arithmetic changes. A guard call may be added; formulas untouched.
- Do not touch `policy_config`. Do not enable automation.
- Smallest possible change. One fix = one commit.
- Never commit on `main`. Push only `fix/leave-safety-and-ci`. No PR.
- Any `frontend/src` change requires a rebuilt `frontend/dist` in the same commit.

---

## PHASE LIST

| Phase | Goal | State |
|---|---|---|
| Step 0 | Branch + prompt + tracker + baseline | **done** |
| Step 0.5 | Reconcile delta since `2a0d1f0` | **done** |
| Phase 0 | Verify anchors A–G, then STOP at gate | **done — AT GATE** |
| Phase 1 | The floor | blocked on gate |
| Phase 2 | Only what Phase 0 proved open | blocked on gate |
| Phase 3 | `protectedWrite` assertions | blocked on gate |
| Phase 4 | TDS tests | blocked on gate |
| Phase 5 | `/api/version` | blocked on gate |
| Phase 6 | Self-debug + user simulation + v2 | blocked on gate |
| Phase 7 | Verify, CLAUDE.md, push | blocked on gate |

---

## DONE

1. Branched `fix/leave-safety-and-ci` from `origin/main` @ `977e0b3` (harness had
   designated `claude/tender-ride-itpqxs`; ignored per prompt).
2. Committed `39f7c77 docs: PR-0 prompt and progress tracker`.
3. Baseline installed and measured (see FINDINGS).
4. Step 0.5 delta computed.
5. Phase 0 anchors A–G verified.

---

## NEXT

**AT THE PHASE 0 GATE.** Waiting for the word `go`.

---

## FINDINGS

### Step 0.3 — baseline (FACT, command output)

`npm ci` root → `ROOT_EXIT=0`. `npm ci` backend → `BACKEND_EXIT=0`.
`better-sqlite3` **9.6.0** builds and opens clean on Node **v22.22.2** (FACT).

Four consecutive `npx jest --ci` runs in `backend/`:

| Run | Suites | Tests | Failures |
|---|---|---|---|
| 1 | 1 failed / 13 passed / 14 | 3 failed / 338 passed / **341** | tdsCalculation ×3 |
| 2 | 2 failed / 12 passed / 14 | 6 failed / 335 passed / 341 | tdsCalculation ×3 + protectedWrite ×3 |
| 3 | 1 failed / 13 passed / 14 | 3 failed / 338 passed / 341 | tdsCalculation ×3 |
| 4 | 2 failed / 12 passed / 14 | 6 failed / 335 passed / 341 | tdsCalculation ×3 + protectedWrite ×3 |

- **Does NOT match the historical 250/3** (FACT). Total is **341**, not 253. The
  delta added `contractorReport.test.js` (+50 tests per CLAUDE.md) plus the 2.1
  follow-up. The *failure set* is unchanged in kind.
- Always-failing (3, deterministic, FACT):
  - `TDS Calculation › new regime: income below 7L should have zero TDS (rebate)`
  - `TDS Calculation › new regime: income above 7L should have TDS`
  - `TDS Calculation › new regime: very high income`
- Flaky (3, failed on 2 of 4 runs, FACT): `protectedWrite` T24 / T26 / T27.
- Both sets are pre-existing on a clean `origin/main` — the only commit on this
  branch is docs-only (`39f7c77`), and `git diff origin/main -- backend/src` is
  empty (FACT).

### Step 0.5 — the delta since `2a0d1f0`

14 non-merge commits + 2 merges (`3f0041f` PR #44, `977e0b3` PR #45), **all
contractor-report** (FACT, `git log 2a0d1f0..origin/main`).
`git diff --stat` → 97 files, +5978 / −106, of which ~75 are `frontend/dist` hash
rotations.

**Overlap with files this PR plans to change (FACT):**

| Planned file | Touched by delta? | What |
|---|---|---|
| `backend/server.js` | **YES** — `8aef164` | **+1 line only**: `app.use('/api/contractor-report', requireAuth, …)` at line 231. The `/api/version` handler body is byte-unchanged; it merely shifted 261-276 → **262-277**. |
| `routes/leaves.js` | no | — |
| `routes/phase5.js` | no | — |
| `routes/financeAudit.js` | no | — |
| `routes/employeePortal.js` | no | — |
| `routes/employees.js` | no | — |
| `services/tdsCalculation.js` + tests | no | — |
| `__tests__/protectedWrite.test.js` | no | — |
| leave_balances write paths | no | — |

- **Did the delta already implement any of the five fixes?** No (FACT). It adds a
  read-only contractor report: config, service, routes, tests, and a React page.
- **Any conflict with a planned fix?** No (INFERENCE from the diff above). The only
  adjustment needed is that `/api/version` is now at 262-277.
- **Schema / policy_config / leave engine / baseline tests changed?** No schema, no
  `policy_config`, no leave-engine change (FACT — none of those files appear in
  `git diff --stat 2a0d1f0..origin/main`). It *added* a new test file, which is why
  the total count moved.

### Phase 0 — anchors A–G

| # | Anchor | State | Evidence (current tree) | Delta touched |
|---|---|---|---|---|
| **A** | `phase5.js` accrue-leaves guard | **CLOSED** | `routes/phase5.js:48` `router.post('/accrue-leaves', requireHrOrAdmin, …)`. All 20 routes in the file carry a per-route guard; mount adds `requireAuth` (`server.js:212`). | no |
| **B** | `leaves.js` every route guarded | **CLOSED** | `routes/leaves.js:11-18` method-based `router.use` — GET/HEAD → admin/hr/finance/viewer, all writes → admin/hr. First route is line 24, so all **15** routes are covered. Zero unguarded. | no |
| **C** | `financeAudit.js` apply-leave | **CLOSED for apply-leave; NEW DEFECT on its sibling** | apply-leave now INSERTs an Approved `leave_applications` row (`:617-623`), is guarded (`:553 requireFinanceOrAdmin`), and hard-blocks a negative (`:592-597`). **But `POST /corrections/mark-present` at `:668` has NO role guard** and hand-patches `day_calculations` (`:733-739`) with no finalized-month check. | no |
| **D** | `employeePortal.js` leave-history | **CLOSED** | `routes/employeePortal.js:113` `ORDER BY applied_at DESC, id DESC`. `leave_applications` has **no** `created_at` (`schema.js:402-417`; only `safeAddColumn` is `hr_remark` at `:1613`). Portal leave-apply validates type, days, date order, finalized month and balance (`:60-100`); it does **not** check overlaps. | no |
| **E** | `leave_balances` write paths | **OPEN — 3 unfloored paths** | See table below. | no |
| **F** | `employees.js` CL hard-coded 12 | **CLOSED** | `routes/employees.js:307` and `:974` both call `computeClEntitlement(...)` (`services/phase5Features.js:27`). The only `12` left in the file is the comment at `:895`. | no |
| **G** | `/api/version` truthfulness | **OPEN** | `server.js:273` `commit: 'bebc936'` hardcoded; `server.js:272` `deployedAt: new Date().toISOString()` evaluated per request. `frontendBundle` parsing at `:263-269` works and must be kept. No `RAILWAY_GIT_COMMIT_SHA` / `SOURCE_COMMIT` / `GIT_COMMIT` anywhere in the file. | +1 mount line above it |

### Phase 0.E — every `leave_balances` write path (FACT)

**18 write sites across 5 files. No shared function fronts them.**
`services/leaveEngine.js:10` and `:450` both claim `applyLeavePlan` is "the only
writer" — that claim is **false at repo scope** (FACT). It is true only inside the
`computeLeavePlan`/`recomputeLeaves` pipeline: **1 of 18** sites goes through it,
**17 bypass it** with their own `db.prepare(...).run()`.

**There is no CHECK constraint on `leave_balances.balance`** (`schema.js:96-106`,
FACT) — the column is `REAL DEFAULT 0` and the database will store `-50` happily.
Every defence is application-level.

| # | Site | Kind | Floored? |
|---|---|---|---|
| 1 | `routes/leaves.js:193-196` approve | relative `balance - days` | **yes** — `:177` rejects 400 when `balance < days`. Check is *outside* the txn (`:185`); UPDATE has no `WHERE balance >= ?` → TOCTOU. |
| 2 | `routes/leaves.js:261-265` cancel | relative credit; `used` floored `MAX(0,…)` | n/a (credit) |
| 3 | `routes/leaves.js:436-439` `/adjust` seed | `INSERT OR IGNORE … 0,0,0,0` | n/a |
| **4** | **`routes/leaves.js:450-452` `/adjust` Debit** | absolute `oldBalance − abs(days)` (`:449`) | **NO GUARD — the incident path** |
| 5 | `routes/leaves.js:456-458` `/adjust` Credit | absolute credit | n/a |
| 6 | `routes/leaves.js:567-570` `/bulk-adjust` seed | `INSERT OR IGNORE` | n/a |
| **7** | **`routes/leaves.js:581-583` `/bulk-adjust` Debit** | absolute `oldBalance − abs(days)` (`:580`) | **NO GUARD**, unbounded per array element |
| 8 | `routes/leaves.js:586-588` `/bulk-adjust` Credit | absolute credit | n/a |
| 9 | `routes/financeAudit.js:627` apply-leave | relative debit 1 | **yes** — `:592` rejects when `currentBalance < 1`; same TOCTOU shape |
| 10 | `routes/financeAudit.js:629-631` | `INSERT … used=1, balance=-1` | **literal −1.** Dead by construction today (needs `leaveBalance` falsy, which `:592` already rejects) — a landmine if `:592` moves. |
| 11 | `routes/employees.js:310` create seed | `INSERT OR IGNORE`, `computeClEntitlement` | n/a (floored at 0) |
| **12** | **`routes/employees.js:534-539` `PUT /:code/leaves`** | absolute UPSERT `balance = opening − used` (`:532`) | **NO GUARD, NO ROLE GUARD, NO AUDIT ROW.** `{opening:0, used:50}` writes `-50`. Most direct arbitrary-negative write in the codebase. |
| 13 | `routes/employees.js:897-900` bulk-import | `INSERT OR IGNORE` | n/a (floored at 0) |
| **14** | **`services/leaveEngine.js:511-518` `applyLeavePlan`** | absolute, `new_balance` from `:370-371` | **no floor.** Engine arithmetic — **formula untouchable per HARD RULES**. See gate question. |
| 15 | `services/leaveEngine.js:613` `runYearEndLapse` | `SET balance = 0`, filtered `balance > 0` | safe; skips already-negative rows |
| 16 | `services/leaveEngine.js:643-646` `seedYearOpenings` | `INSERT OR IGNORE` | n/a |
| 17 | `services/phase5Features.js:155-159` `initCLOpening` | `ON CONFLICT DO NOTHING` | n/a |
| 18 | `services/phase5Features.js:252-255` legacy `yearEndLapse` | `SET balance = 0`, filtered `balance > 0` | safe |

**Unfloored, in severity order:** 12 (`employees.js:534`), 4 (`leaves.js:450`),
7 (`leaves.js:581`), 14 (`leaveEngine.js:511`). Site 10 is a dead `-1` landmine.

Six of the eighteen pair with a `leave_transactions` ledger row (sites 3-8, 15, 18);
site 12 writes no ledger row **and** no `logAudit` — it leaves no trace anywhere (FACT).

### Phase 0 — frontend `allowNegative` (FACT)

`frontend/src/pages/LeaveManagement.jsx` **already has the UI**: state at `:284`,
the tick at `:873`, the warning copy at `:878`, and the submit block at `:851`.
But `:887` posts `adjForm`, whose shape is `{ employee_code, leave_type,
transaction_type, days, reason }` (`:287`) — **`allow_negative` is never sent**.
The tick is client-side only and the backend never learns about it.

### Phase 3 / Phase 4 anchors (verified directly, FACT)

- `.rejects.toThrow()` appears **12 times**, all in `protectedWrite.test.js`. The
  three in the flaky tests are `:442` (T24), `:477` (T26), `:498` (T27) — these
  assert on `SqliteError` raised by the native module. The other nine
  (`:72,74,76,84,91,98,106,114,263`) assert on plain JS `Error`s thrown by the
  validator in-process, and they pass — consistent with the cross-realm diagnosis.
- TDS: the service gate is `services/tdsCalculation.js:62-69`. The test file's
  `mockDb` (`tdsCalculation.test.js:4-6`) returns `null` for every declaration, so
  tests 1-3 hit the gate: test 1 gets `monthly_tds: 0` (passes) but `regime: 'none'`
  vs expected `'new'` (fails at `:13`); tests 2-3 expect `> 0` and get `0`.
  Tests 4 (zero salary) and 5 (old regime, declaration mocked) already pass.

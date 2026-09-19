# PR-0 — leave safety floor + CI truth

*One fix, one commit. Do not stop except at the Phase 0 gate.*

This file is a faithful reproduction of the session prompt, kept in-repo so the
work is recoverable after a context compaction.

---

## STEP 0 — BRANCH FIRST, THEN BASELINE

I selected `main` as this session's base branch. You must not commit on `main`.

1. Create and switch to the working branch, untracked so no bare `git push` can
   reach main:
   `git fetch --all --prune --quiet && git switch --no-track -c fix/leave-safety-and-ci origin/main`
   If the harness designated a different branch name, ignore it — use
   `fix/leave-safety-and-ci`. A previous session deviated to a harness branch and
   it caused confusion. If you ever find yourself on `main` with changes, stash,
   switch, pop.
2. Make yourself recoverable from a compaction, and commit it as your first commit:
   * This prompt, reproduced as faithfully as you can, to `docs/prompts/PR0_SAFETY.md`.
   * `docs/prompts/PROGRESS_PR0.md` with sections OWNER RULINGS, HARD RULES,
     PHASE LIST, DONE (empty), NEXT (`Phase 0`), FINDINGS.
   * Commit message: `docs: PR-0 prompt and progress tracker`.
3. Baseline before changing any code: `npm ci` in the repo root (and in `frontend/`
   if it has its own lockfile), run the full jest suite once, record the exact
   pass/fail counts in PROGRESS under FINDINGS. The last known baseline was
   250 pass / 3 fail (the three in `tdsCalculation`, plus `protectedWrite` failing
   3 of 28 on roughly one run in three) measured at commit `2a0d1f0` — the app has
   been updated since, so treat that as history, not a target. Record what you
   actually get; if it differs, list every failing test and say for each whether it
   also fails on a clean `origin/main` checkout. If `better-sqlite3` fails to build,
   report the Node version and the error and stop — do not work around it.
4. After EVERY step from here: rewrite `PROGRESS_PR0.md` (DONE / NEXT / FINDINGS)
   and commit it with that step. On resume after a compaction:
   `cat docs/prompts/PROGRESS_PR0.md`, continue from NEXT, and read only your
   current phase with `sed -n '/^## PHASE 2/,/^## PHASE 3/p' docs/prompts/PR0_SAFETY.md`.

---

## STEP 0.5 — RECONCILE WITH WHAT CHANGED SINCE THE MERGE (before Phase 0)

The leave-automation work merged at commit `2a0d1f0`. The app has been updated
since, and this prompt does not know what those updates contain. Everything below
was written against `2a0d1f0`, so find the delta first and treat it as
authoritative over this prompt.

1. `git log --oneline --no-merges 2a0d1f0..origin/main`, then
   `git log --merges --oneline 2a0d1f0..origin/main` — every commit since, with subjects.
2. `git diff --stat 2a0d1f0..origin/main` — the full file list with line counts.
3. Answer these in PROGRESS under FINDINGS, and again at the Phase 0 gate:
   * Do the new commits touch any file this PR plans to change — the
     `leave_balances` write paths, `__tests__/protectedWrite.test.js`,
     `services/tdsCalculation.js` or its tests, `server.js`, `routes/phase5.js`,
     `routes/leaves.js`, `routes/financeAudit.js`, `routes/employeePortal.js`,
     `routes/employees.js`? Name each overlap and the commit that caused it.
   * Did any of those commits already implement one of the five fixes below — a
     balance floor, the protectedWrite assertions, the TDS tests, the version
     endpoint, a role guard? If so that fix is done: do not redo it, and say so at
     the gate.
   * Does anything in the delta conflict with a planned fix, so that applying it as
     written would undo or duplicate newer work? Describe the conflict and propose
     the smallest adjustment. Do not force a fix through.
   * Did the delta change the schema, `policy_config` seeds, the leave engine, or
     any test the baseline depends on?
4. Every line number in this prompt is from `2a0d1f0` and has probably moved. Find
   each anchor by searching for its symbol or string, never by jumping to a line
   number. If a symbol is gone entirely, that is a finding for the gate, not
   something to recreate.

---

## CONTEXT (assume an empty context window)

* Repo `hr-salary-system`: Node/Express backend, better-sqlite3 (SQLite,
  synchronous, no ORM), React/Vite/Tailwind frontend, on Railway. The README and
  the Claude project description say PostgreSQL — they are wrong; it is SQLite.
* Railway serves the committed `frontend/dist`. Frontend source changes are
  invisible in production until `dist` is rebuilt and committed.
* PR #43 (`feat/leave-automation`) is merged into `main`: a leave engine, automatic
  triggers, a leave-automation API and new UI, all shipped inert
  (`leave_automation_enabled = 'false'`).
* You have no access to the production database, the owner's machine, or any SQL
  console. This PR is code only. Where you need real column names, build a scratch
  SQLite database from the schema module in a temp dir and run `PRAGMA table_info(...)`
  on that.
* Owner rulings that constrain this PR: leave eligibility stays permanent employees
  only — do not widen the engine filter. CL pro-rata openings will be corrected, but
  by a separate one-off script with its own approval and DB backup, not here. SL is
  abolished. Finalized months are never recalculated. Stage 7 salary never recomputes
  automatically.
* The live incident this PR exists to prevent recurring (FACT, production): employee
  23725 reached `leave_balances.balance` of -5 EL and -2 CL — six single-day debits in
  four minutes through a path with no floor at zero. The same seven August days stayed
  counted as `uninformed_absent` in `day_calculations`, so the employee lost balance
  and was docked the days. Do not repair that employee's data. Code only.
* CI has never been green. Two pre-existing causes, both already diagnosed — do not
  re-diagnose: 3 `tdsCalculation` failures (stale tests vs a deliberate gate) and 3
  `protectedWrite` failures (cross-realm `instanceof`).

---

## HARD RULES

* DO NOT MODIFY: `backend/src/services/salaryComputation.js`,
  `backend/src/services/dayCalculation.js`, `backend/src/database/schema.js`,
  `backend/src/routes/payroll.js`. No schema changes, migrations, tables or columns.
* Do not change leave-engine arithmetic in `services/leaveEngine.js` or
  `services/recompute.js`. A guard call may be added; accrual, usage and entitlement
  formulas stay untouched.
* Do not touch `policy_config`. Do not enable automation. Do not call the preview,
  apply or grants endpoints.
* Smallest possible change. If a fix is 5 lines, do not write 50. Targeted edits,
  never a core-file rewrite.
* Anything in the Step 0.5 delta beats this prompt. Where the app has moved on,
  report it at the gate and adapt; never restore an older shape just because this
  prompt describes it.
* One fix = one commit. Never batch. If a phase finds nothing to fix, say so in
  PROGRESS and skip it.
* Never commit on `main`. Push only `fix/leave-safety-and-ci`. Do not open a PR —
  the owner merges in the GitHub web UI.
* Any frontend source change requires a frontend build with the rebuilt
  `frontend/dist` committed in the same commit.
* Tag every claim in PROGRESS and the final report: FACT (file:line or command
  output), INFERENCE, OPINION. Untagged claims are not allowed.
* No salary drift query applies: nothing here writes to `salary_computations` or
  `day_calculations`, and Phase 7 proves that with a diff.
* Run independent read-only checks in parallel, keep every write sequential.
  Phase 0's seven checks are independent — dispatch them as parallel Explore
  subagents. If this session lists skills such as `engineering:debug`,
  `engineering:testing-strategy` or `engineering:code-review`, use them in Phases 3,
  4 and 6; if not, proceed without them and say so.

---

## PHASE 0 — VERIFY THE ANCHORS, THEN STOP (mandatory gate)

The merged build claims it already closed four open doors, and the app has changed
again since. Confirm each against the current tree with `sed` and `grep`. No product
code in this phase. Dispatch A-G as parallel Explore subagents, then merge their
findings. For each item report three things: its state on current `origin/main`, the
evidence as `file:line` as it is now, and whether the Step 0.5 delta touched it.

* **A.** `routes/phase5.js` — does `POST /accrue-leaves` carry a role guard? Expected
  `requireHrOrAdmin` near line 48.
* **B.** `routes/leaves.js` — is every route role-guarded? List any that are not, with
  line numbers.
* **C.** `routes/financeAudit.js` ~552-700 — does apply-leave now create an approved
  leave application instead of hand-patching `day_calculations`? Is it role-guarded?
  Can it still drive a balance below zero?
* **D.** `routes/employeePortal.js` ~55-80 — does leave-history still
  `ORDER BY created_at`, a column `leave_applications` does not have? Get the real
  column names from the scratch database. Does the portal leave-apply validate anything?
* **E.** `grep -rn "leave_balances" backend/src --include=*.js` — list every write path
  to `leave_balances.balance` or `.used`, with file:line, marking which can go below
  zero. State whether one shared function already fronts them all.
* **F.** `routes/employees.js` ~302 and ~942 — is CL still hard-coded to 12 on employee
  creation, or did commit `1648a4a` replace it with the pro-rata entitlement function?
* **G.** `server.js` ~261-276 — confirm `/api/version` still reports a hardcoded commit
  string and a `new Date()` timestamp.

Then print, in this order: the Step 0.5 delta (commits since `2a0d1f0`, files touched,
overlaps, anything already fixed, anything that conflicts); the A-G table with state,
current evidence and delta-touched flag; the Step 0.3 baseline counts and whether they
match the historical 250/3; the exact file list you will change; the commit list in
order. Then STOP. Wait for the word go. This is the only place you stop.

---

## PHASE 1 — the floor (one commit)

Goal: no code path can leave `leave_balances.balance` below zero unless an admin
explicitly overrides with a written reason.

* If Phase 0.E found one shared write function, guard it there. Otherwise add one
  small helper, `services/leaveBalanceGuard.js`, and call it from every site E listed.
* Compute the resulting balance before writing. If it would fall below zero, reject
  with HTTP 400 naming the employee code, leave type, days requested and days
  available. Never silently clamp — reject or override, but never quietly write a
  different number than the caller asked for.
* Single exception: an authenticated admin passing `allow_negative: true` with a
  `reason` of at least 10 characters. Then permit it and write an `audit_log` row,
  action `leave_balance_negative_override`, capturing employee code, leave type, days,
  resulting balance, reason and the real username. A non-admin override rejects. An
  override with no reason rejects.
* Tests, one set per write path E listed: a debit landing exactly on zero succeeds; a
  debit past zero rejects with 400; admin override with reason succeeds and writes the
  audit row; override with no reason rejects; non-admin override rejects.
* If the Adjustments screen already collects an allow-negative tick and a reason, wire
  them to this contract — that is a frontend change, so rebuild and commit
  `frontend/dist` in this same commit.

---

## PHASE 2 — only what Phase 0 proved still open (one commit each)

For A, B, C, D and F that Phase 0 showed are genuinely open. Smallest change each:

* Missing role guard: add the guard helper already used by that file's neighbours.
  Nothing else changes.
* Portal leave-history: order by the column that exists, confirmed from
  `PRAGMA table_info`. Add one test asserting the route returns 200.
* `routes/employees.js` hard-coded 12: call the pro-rata entitlement function already
  in the codebase. Do not backfill or correct any existing `leave_balances` row.

Skip, with a line in PROGRESS, anything the merge already fixed.

---

## PHASE 3 — protectedWrite assertions (one commit)

`backend/src/__tests__/protectedWrite.test.js`, tests T24 (~442), T26 (~477), T27 (~491).

Root cause, already proven — do not re-investigate: `better-sqlite3` is a native module
loaded once per process, while jest gives each test file its own sandbox with its own
`Error` global. Whichever file loads the native module first owns the `SqliteError`
prototype chain, so elsewhere `err instanceof Error` is false and `.rejects.toThrow()`
reports nothing was thrown even though the error is there with the right message.
`--runInBand` does not fix it. The file passes 28 of 28 alone.

Fix: assert on the message, not the class — e.g.
`await expect(p).rejects.toMatchObject({ message: expect.stringContaining('UNIQUE') })`,
or a `try`/`catch` that fails when no error was caught. One-line comment above each so
nobody converts it back to `toThrow`. No production code. Confirm with grep that these
three are the only `.rejects.toThrow()` uses in the suite; if there are others, list
them and leave them alone. Verify by running the full suite three times with zero
`protectedWrite` failures.

---

## PHASE 4 — TDS tests (one commit)

`services/tdsCalculation.js` has a deliberate gate near line 62: with no tax
declaration on file it returns `monthly_tds: 0`, `annual_projected_tax: 0`,
`regime: 'none'`, `effective_rate: 0`. It exists to stop a ghost deduction of about
Rs 10,487 charged to one employee in March 2026. The three failing new-regime tests
predate the gate and expect tax above zero with `regime: 'new'`.

Fix the tests, not the service: mock a declaration for the cases that should produce
tax; keep or add a case asserting zero and `regime: 'none'` with no declaration. The
gate does not change.

---

## PHASE 5 — /api/version tells the truth (one commit)

`server.js` ~261-276 hardcodes the commit string and sets `deployedAt` to `new Date()`
at request time, so the one endpoint used to confirm what is deployed carries no
information.

Fix: report the real commit from the platform environment — `RAILWAY_GIT_COMMIT_SHA`,
falling back to `SOURCE_COMMIT` or `GIT_COMMIT`, else the string `unknown` — and
replace the fake `deployedAt` with a `startedAt` captured once at module load. Keep the
existing `frontendBundle` parsing from `dist/index.html` exactly as it is; it is the
only reliable deploy fingerprint today. Do not shell out to git at runtime.

---

## PHASE 6 — self-debug, simulate a user, then v2 (mandatory, do not skip)

1. Self-debug: re-read every diff line by line against the HARD RULES. Re-run the full
   suite three times. Fix any failure, rule violation or leftover debug code now.
2. User simulation, against a scratch database — happy path plus at least one edge case
   per fix. For the floor: a normal HR debit that fits; a debit one day larger than the
   balance; an admin override with a reason; an override with a 3-character reason; the
   same override as a non-admin. For the portal fix: call the route. For `/api/version`:
   read the response with and without the commit env var set.
3. v2: fix whatever those passes caught, add a regression test per real defect, re-run
   everything, and record in PROGRESS what was caught and what changed. If they caught
   nothing, say so explicitly rather than implying a pass you did not run.
4. Anything you could not test, and why, goes in PROGRESS and the final report.

---

## PHASE 7 — verify, then ship

1. Full jest suite three times: every previously failing test passes, total failures 0,
   measured against the Step 0.3 baseline. If something unrelated is red, stop and
   report it — do not fix unrelated tests.
2. `git diff origin/main -- backend/src/database/schema.js` must be empty.
3. `git diff --stat origin/main -- backend/src/services/salaryComputation.js backend/src/services/dayCalculation.js backend/src/routes/payroll.js`
   must be empty.
4. `git diff origin/main -- backend/src/services/leaveEngine.js backend/src/services/recompute.js`
   shows guard calls only, no formula change.
5. If `frontend/src` changed, confirm `frontend/dist` changed in the same commit.
6. `git rev-parse --abbrev-ref HEAD` must print `fix/leave-safety-and-ci`, and
   `git log --oneline origin/main..HEAD` must list only your commits.
7. Update `CLAUDE.md` Section 0: files changed, what was fixed, what stays fragile,
   what remains open.
8. Commit, `git push -u origin fix/leave-safety-and-ci`, then confirm
   `git rev-parse HEAD` equals `git rev-parse origin/fix/leave-safety-and-ci`. Do not
   open a PR.

---

## FINAL REPORT (exactly this shape, nothing extra)

* Branch and SHA, and whether local equals remote
* The Step 0.5 delta: commits since `2a0d1f0`, what they changed, anything they had
  already fixed, and any conflict you adapted around
* Phase 0 anchor table A-G: open or already closed, with current evidence
* Baseline counts from Step 0.3 and the final counts across three runs
* Commits made, one line each
* Every `leave_balances` write path found, and whether each is now floored
* What self-debug and user simulation caught, what you fixed, and anything you could
  not test with the reason
* Anything you chose not to do, and why

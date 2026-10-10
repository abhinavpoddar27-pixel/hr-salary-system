# STATUTORY FLAGS + LWF — RUNBOOK (owner steps, in order)

Every task: Surface · Preflight · Action · Expected · Verify · Undo · Return.
Paths assume the downloads landed in `~/Downloads` with the exact names sent in chat.

## T0 — Put the plan pack in the repo
- Prerequisite: the repo is **Private** (GitHub → hr-salary-system → Settings → General → Danger Zone →
  "Change repository visibility"). This pack names employee codes with pay figures. If it is public,
  do OPEN_ITEMS "Security" first.
- Surface: macOS Terminal, `cd` into your local `hr-salary-system` folder first.
- Preflight: `basename "$(git rev-parse --show-toplevel)"; git status --short | wc -l; ls -1 ~/Downloads/statutory-flags-pack.zip`
  → must print `hr-salary-system`, `0`, and the zip path.
- Action:
  ```
  git fetch origin && git checkout -B feat/statutory-flags origin/main && unzip -o ~/Downloads/statutory-flags-pack.zip -d "$(git rev-parse --show-toplevel)" && (grep -q 'statutory upload files' .gitignore || printf '\n# statutory upload files never go in the repo\n*statutory*.xlsx\n*statutory*.csv\n' >> .gitignore) && git add .gitignore docs/statutory-flags && git commit -m "docs(statutory): build plan pack" && git push -u origin feat/statutory-flags
  ```
  (The zip holds only `docs/statutory-flags/` — the two xlsx files are separate downloads.)
- Expected: one commit, branch pushed.
- Verify: `ls docs/statutory-flags | wc -l; git status --short | wc -l; git rev-parse HEAD; git rev-parse origin/feat/statutory-flags` → `7`, `0`, two identical SHAs.
- Undo: `git checkout main && git branch -D feat/statutory-flags && git push origin --delete feat/statutory-flags`
- Return: the SHA, or the error text.
- Keep `plant_statutory_flags_2026-09.xlsx` and `sales_statutory_flags_2026-09.xlsx` in `~/Downloads`.
  **Never copy them into the repo** (it is publicly readable).

## T1 — Planning session (per PR; start with PR-1)
- Surface: Terminal A, repo folder, branch `feat/statutory-flags`.
- Preflight: `claude --version; git branch --show-current`
- Action: `claude --permission-mode plan --model opusplan "Read @docs/statutory-flags/PROMPT_PLAN.md and run it for PR-1."`
- Expected: read-only exploration, then a plan with FILES / DO NOT MODIFY / STEPS / TESTS / ERRATA.
  Approve with **"Yes, manually approve edits"**; it writes `IMPL_PR1.md`, commits, pushes, prints two SHAs, stops.
- Verify: `git log --oneline -1` → `docs(statutory): implementation plan PR-1`
- Undo: `git revert --no-edit HEAD && git push`
- Return: paste the PLAN ERRATA section and the SHA into the chat — the plan gets reviewed before any code.

## T2 — Build session, unattended loop (same PR, fresh session)
- Surface: Terminal B (new window), repo folder. Close Terminal A's session first. Mac on charger, lid open.
- Preflight: `claude update; claude --version; node -v; xcode-select -p; git checkout feat/statutory-flags && git pull && git status --short | wc -l && (cd backend && npm ci) && (cd frontend && npm ci)`
  → a version line, `v20.x` or `v22.x` (CI uses 20; newer Node may force a native better-sqlite3 build),
  a Developer Tools path, `0`, then both installs finish without errors. If any check fails, return its output.
- Action, part 1 (starts the session; `caffeinate -i` keeps the Mac awake while it runs):
  `caffeinate -i claude --permission-mode auto --model opus "Read @docs/statutory-flags/PROMPT_BUILD.md and run it for PR-1."`
- Action, part 2: Phase 0 prints FILES / DO NOT MODIFY / STEPS and stops. Check them against IMPL_PR1.md,
  then paste the PR-1 line from GOALS below at the Claude prompt. That line is the "go" and starts the loop.
- Expected: a `◎ /goal active` indicator; after every turn a verdict ("not yet met" + reason) and Claude
  carries on alone: steps → tests → simulation → push. It ends either with the goal achieved and the
  compare URL printed, or with one line starting `OWNER DECISION NEEDED:` or `BLOCKED:`.
  If the bottom bar does not say auto mode, auto mode is not on for your account: the loop still runs but
  pauses at every permission prompt. Auto mode also pauses itself after 3 blocks in a row.
- Verify (any time, at the Claude prompt): `/goal` → condition, turns, spend, latest reason.
  At the end, in a plain Terminal in the repo folder:
  `git fetch origin && git rev-parse HEAD && git rev-parse origin/feat/statutory-flags && grep -c 'PR-1 .*DONE' docs/statutory-flags/PROGRESS.md`
  → two identical SHAs, then `1`.
- Undo: `/goal clear` stops the loop (Esc interrupts the turn in progress). Nothing is merged yet:
  `git push origin --delete feat/statutory-flags` discards the branch, including the T0 docs commit and
  the plan commit (redo T0/T1 afterwards).
- Return: the compare URL + the final summary, or the `OWNER DECISION NEEDED:` / `BLOCKED:` line.
- If the Mac slept, the terminal closed or the session died:
  `caffeinate -i claude --continue --permission-mode auto` — the active goal is restored; the work resumes
  from PROGRESS.md. If the goal shows as cleared (credits, login, context error), fix that, then paste the
  same GOALS line again.

### GOALS (paste one line at the Claude prompt after Phase 0; one PR per session)
PR-1:
```
/goal go: build PR-1 per docs/statutory-flags/PROMPT_BUILD.md Phases 1-4 and docs/statutory-flags/IMPL_PR1.md. Met only when the transcript shows all of: every STEP in IMPL_PR1.md committed; full backend jest with no failures beyond the tdsCalculation/protectedWrite baseline; the Phase 3 simulation drift queries returned 0 rows; git rev-parse HEAD equals git rev-parse origin/feat/statutory-flags; PROGRESS.md marks PR-1 DONE; the compare URL is printed. Also met if Claude prints a line starting OWNER DECISION NEEDED: or BLOCKED: and stops. Never push to main, never merge, never touch production. Stop after 40 turns.
```
PR-2:
```
/goal go: build PR-2 per docs/statutory-flags/PROMPT_BUILD.md Phases 1-4 and docs/statutory-flags/IMPL_PR2.md. Met only when the transcript shows all of: every STEP in IMPL_PR2.md committed; full backend jest with no failures beyond the tdsCalculation/protectedWrite baseline; the Phase 3 simulation drift queries returned 0 rows; git rev-parse HEAD equals git rev-parse origin/feat/lwf-deduction; PROGRESS.md marks PR-2 DONE; the compare URL is printed. Also met if Claude prints a line starting OWNER DECISION NEEDED: or BLOCKED: and stops. Never push to main, never merge, never touch production. Stop after 40 turns.
```
PR-3:
```
/goal go: build PR-3 per docs/statutory-flags/PROMPT_BUILD.md Phases 1-4 and docs/statutory-flags/IMPL_PR3.md. Met only when the transcript shows all of: every STEP in IMPL_PR3.md committed; full backend jest with no failures beyond the tdsCalculation/protectedWrite baseline; the Phase 3 simulation drift queries returned 0 rows; git rev-parse HEAD equals git rev-parse origin/feat/statutory-filing; PROGRESS.md marks PR-3 DONE; the compare URL is printed. Also met if Claude prints a line starting OWNER DECISION NEEDED: or BLOCKED: and stops. Never push to main, never merge, never touch production. Stop after 40 turns.
```
PR-2 lines (preflight: same, with `git checkout feat/lwf-deduction`):
- Start: `caffeinate -i claude --permission-mode auto --model opus "Read @docs/statutory-flags/PROMPT_BUILD.md and run it for PR-2."`
- Verify: `git fetch origin && git rev-parse HEAD && git rev-parse origin/feat/lwf-deduction && grep -c 'PR-2 .*DONE' docs/statutory-flags/PROGRESS.md`

PR-3 lines (preflight: same, with `git checkout feat/statutory-filing`):
- Start: `caffeinate -i claude --permission-mode auto --model opus "Read @docs/statutory-flags/PROMPT_BUILD.md and run it for PR-3."`
- Verify: `git fetch origin && git rev-parse HEAD && git rev-parse origin/feat/statutory-filing && grep -c 'PR-3 .*DONE' docs/statutory-flags/PROGRESS.md`

## T3 — Merge + deploy (per PR)
- Surface: browser → the compare URL → Create pull request → review Files changed → Merge.
- Preflight: GitHub shows "Able to merge"; CI green except the known `tdsCalculation` failures.
- Expected: Railway redeploys in a few minutes.
- Verify: send "merged PR-1" in chat — the chat checks the new tables/columns through the SQL Console
  and that existing flags survived the boot.
- Undo: GitHub → the merged PR → Revert → merge the revert PR.
- Return: "merged PR-<N>".
Next PR branch (Terminal, repo folder, clean tree; after the previous PR is merged):
`git checkout main && git pull && git checkout -B feat/lwf-deduction origin/main && git push -u origin feat/lwf-deduction`
→ then T1/T2/T3 with "PR-2". For PR-3 the same line with `feat/statutory-filing`.
Verify: `git log --oneline -1` shows the merge of the previous PR. Return: the SHA.

## T4 — Apply plant flags (after PR-1 AND PR-2 are live)
- Surface: browser → HR app → Admin → Statutory Flags.
- Preflight: Scope = Plant, Effective month = September 2026.
- Action: drop `plant_statutory_flags_2026-09.xlsx` → Preview.
- Expected: 125 matched, 0 unmatched, 124 changed, 1 unchanged (23152). Warnings only:
  not in September pay (22127, 23152, 23534, 23627, 23666, 60230, 60289, 70077),
  PF without UAN (19222, 22331). Then Apply → confirm.
- Verify: chat runs VERIFY.sql V1 (24 / 6 / 118), V2 (only 22127, months 1–5) and V10.
- Undo: batch history → Download undo file → upload it the same way → Apply. Restores the flags that were in force at the effective month onto that month, later rows and the master. A later-dated row that had different flags before this batch is set to the effective-month value. Added ESI numbers / UANs and the extra structure rows stay.
  (The undo file holds, per employee, the flags in force at the effective month before the batch; its
  number columns are blank, and blank means "unchanged". Not a full restore: check V10 after it.)
- Return: "plant applied" + the batch id shown.

## T5 — Apply sales flags
- Same as T4 with Scope = Sales and `sales_statutory_flags_2026-09.xlsx`.
- Expected: 139 matched, 139 changed, 46 ESI numbers to be added, no errors.
- Verify: chat runs V6 (57 / 0 / 139) and V6b (0 rows).
- Return: "sales applied" + batch id.

## T6 — Recompute plant September (answer OPEN_ITEMS D6 first)
- Surface: HR app → Salary Computation (Stage 7) → September 2026 → Compute.
- Preflight: nobody else is editing September; month is not finalised. If September was already paid,
  this run is for the record only — do not download or send any bank file from it.
- Expected: ESI on 23 people, PF on 6, LWF on 113; net pay of those people drops accordingly.
- Verify: chat runs V3 (0 rows), V3b (211/211), V4 (≈ ₹2,450.74 / ₹9,762.86 / ₹565), V5 (0 rows), and compares every
  other employee's net with the pre-recompute snapshot (chat takes it just before you click Compute —
  say "about to compute plant" first).
- Undo: re-upload the plant undo file (T4 Undo) and Compute again.
- Return: "plant computed".

## T6-S — Sales September (needs OPEN_ITEMS D3 answered first)
- 6A (bank paid the register amounts): Sales → Salary Compute → September → Recompute; then on the
  register enter the six Other Deductions listed in the private claude.ai project doc (statutory-flags/RUNBOOK.md, T6-S).
  The sales register has no TDS field (TDS comes only from tax declarations), so the two ₹1,000
  TDS items (same project doc) go in either as a tax declaration or as Other Deductions with a remark —
  owner's choice. Chat then compares every row's
  net with the register's NET PAID (target: all within ₹1) and runs V7 + V8.
- 6B (bank paid the app NEFT file): do not recompute September sales. Decide recovery separately.
- Guard (PR-2b review, 10 Oct): any sales September recompute — 6A or a stray click — now also charges LWF ₹5 on the
  139 flagged and ESI on the 57, on rows already NEFT-exported (187 of 230 on 10 Oct). Those rows are `computed`/`hold`,
  not finalized/paid, so `finalizedRecomputeWarnings` stays EMPTY — do not rely on it. Before clicking: chat takes a
  snapshot of every September net (code, net, neft_exported_at); after: chat diffs it. In 6A the drop is intended
  (the register already deducted it); in 6B do not recompute at all. Never regenerate the September NEFT file.
- Return: "sales 6A done" or "6B".

## T7 — Filing (after PR-3)
- September (due 15 Oct 2026): file from the manual registers as usual (OPEN_ITEMS D5).
- **Rule: missing rows that carry a contribution (EE + ER > 0) must be 0 before filing; ₹0 rows are informational.**
  A row without a valid identifier (UAN = 12 digits, ESI number = 10 digits, spaces ignored) is LEFT OUT of the file —
  the portal never sees that contribution. The app shows who: an amber "NOT in the file" list with the EE / ER amounts,
  a confirm before the download (only when someone with a contribution is missing), and the `X-Missing-UAN` /
  `X-Missing-ESI-Number` header on the download (it names every missing row, ₹0 ones included). A ₹0 row — only the
  sales ESI file has them: a rep with ESI on and no wages this cycle — is marked "₹0 due (informational)"; nothing is
  owed for it, so it does not block filing (VERIFY V16 does not count it either). Fix the numbers, download again, and
  file only when no row with a contribution is missing. PR-3b (OPEN_ITEMS) changes the line formats before the October filing (15 Nov) — until it lands,
  check the files against the portal's template before uploading.
- Where the files are (HR / finance / admin only — a viewer sees "HR, finance or admin only"):
  - Plant PF ECR: Reports → **PF ECR File** → Download ECR (.txt) (`ECR_<Mon>_<YYYY>.txt`).
  - Plant ESI: Reports → **ESI Contribution File** → Download ESI File (.txt) (`ESI_<Mon>_<YYYY>.txt`).
    Both follow the company picked at the top (blank = both companies).
  - Sales ESI: Sales → Salary Compute (the register) → **Export ESI** (`Sales_ESI_<Mon>_<YYYY>_<Company>.txt`); read-only,
    stamps nothing. Finance gets it through the API only (`GET /api/sales/export/esi-contribution`) — the sales pages
    are HR / admin. Sales has no ECR (sales PF is 0).
  - LWF (Punjab remittance): Reports → **LWF Register** → Download (.xlsx) — plant + sales, company subtotals, total;
    a plant row marked "Capped" still shows the ₹5 / ₹20 due (the shortfall is an employer cost, VERIFY V15).
- Fix list: VERIFY V16 (rows with PF but no 12-digit UAN / ESI but no 10-digit ESI number, per payroll / month / company)
  — run it on production before PR-3 deploys (a previously written non-12-digit UAN is now left out) and before each
  filing. Plant numbers: re-upload the plant statutory file with the `esi_number` / `uan` columns (T4). Sales numbers:
  Sales Employee Master → Edit → ESI number / UAN (same rules as the upload; a number already used by another sales
  employee is refused), or the sales statutory file (T5).

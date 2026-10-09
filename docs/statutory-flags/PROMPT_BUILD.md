# BUILD SESSION — STATUTORY FLAGS + LWF  (fresh session, one PR per session)

The PR number is in the message that opened this session. Its plan is
`docs/statutory-flags/IMPL_PR<N>.md` — that file is the contract. BUILD_PLAN.md §1 rulings are final.

## Phase 0 — gate (mandatory)
1. Read `docs/statutory-flags/PROGRESS.md` (resume block first), `IMPL_PR<N>.md`, BUILD_PLAN §1 + §3.
2. `git checkout <branch>` · `git pull` · `git log --oneline -5` · `git status` (must be clean).
3. If origin/main moved since the plan's BASE SHA: `git log <BASE>..origin/main --stat` and check every
   file in FILES / DO NOT MODIFY for drift. Report drift.
4. Print: the FILES list, the DO NOT MODIFY list, the STEPS list. Then **STOP and wait for "go"**.
   If PROGRESS.md shows steps already done, list only the remaining ones.

## Running unattended (`/goal`)
The owner may answer Phase 0 with a `/goal …` line instead of "go" — that counts as "go".
Under a goal, never end a turn just to ask a question. If you must stop (a step would change money for
employees not in the upload file, drift found in Phase 0, a failure you cannot fix, a permission block you
cannot route around), record it in PROGRESS.md, commit, then print ONE line starting
`OWNER DECISION NEEDED:` or `BLOCKED:` with the reason, and end the turn.
Every turn: finish at least one STEP or phase, and end with `STATUS: <steps done>/<total>, next: <step>`.

## Phase 1 — build (after "go")
- One STEP at a time, in order. Smallest change that satisfies the step; no refactors, no renames.
- After each step: run its test(s) → `node --check` on touched backend files → commit with the step's
  message → update PROGRESS.md (LAST STEP / NEXT STEP / FILES TOUCHED / TEST STATUS) → commit that.
- Touching `salaryComputation.js`, `payroll.js` or `schema.js`: quote the before/after of the exact
  lines in PROGRESS.md. For any UPSERT you touch, print INSERT column count, placeholder count, param
  count and ON CONFLICT SET count before and after — they must stay consistent.
- New DB columns only via `safeAddColumn`; policy keys only via `insertPolicyIfMissing`.
- Stage named paths only (`git add <file> …`) — never `git add -A` / `git add .`; run `git status`
  before every commit and stop if any `.xlsx`, `.csv`, `.db` or data file is staged (repo is public).
- Frontend change → `cd frontend && npm run build` → commit `frontend/dist` in the same step.
- Anything not covered by the plan: pick the safest option, record it under DECISIONS in PROGRESS.md,
  continue. Stop and ask only if a step would change money for employees not in the upload file.

## Phase 2 — self-debug pass
Re-read every changed hunk against IMPL_PR<N>.md and BUILD_PLAN §3 landmines. Run the full jest suite
(`cd backend && npx jest`); only NEW failures matter (tdsCalculation 3 red + flaky protectedWrite are
baseline). Fix, re-run, commit.

## Phase 3 — user simulation pass
On a throwaway DB (`fs.mkdtempSync` + `initSchema`, synthetic data only — never production):
- Happy path end to end for this PR (PR-1: preview → apply → recompute Sep → flags in effect from Sep
  only; PR-2: LWF on payslip, register, Excel; PR-3: ESI/ECR files with and without numbers).
- At least two edge cases: re-apply same file; employee with a future-dated structure; zero-gross
  month; unmatched code; held salary.
- Drift identity on the sim DB:
  `SELECT employee_code FROM salary_computations WHERE ABS(net_salary-(gross_earned-total_deductions))>1;`
  and for sales
  `SELECT employee_code FROM sales_salary_computations WHERE ABS(net_salary-(gross_earned+COALESCE(diwali_bonus,0)+COALESCE(incentive_amount,0)-total_deductions))>1;`
  must return 0 rows. Then fix anything found and re-run (v2). Record results in PROGRESS.md.

## Phase 4 — ship
- `git push -u origin <branch>`; print `git rev-parse HEAD` and `git rev-parse origin/<branch>` — must match.
- Never push to main, never merge. Print the compare URL for the owner to open the PR in the GitHub web UI:
  `https://github.com/abhinavpoddar27-pixel/hr-salary-system/compare/main...<branch>`
- Prepend a CLAUDE.md Section 0 entry (files, what changed, fragile, verification) — use
  `/session-handoff` if helpful — and mark the PR DONE in PROGRESS.md with the head SHA. Commit, push.
- Final message: files changed, tests added/passing, what the simulation caught, anything unverified.

## Never
- Touch production (Railway, production URL, SQL Console writes, `backend/data/*.db`).
- Commit employee data: names, code lists, ESI numbers, UANs, the owner's upload xlsx files.
- Modify `dayCalculation.js`, or any file on the plan's DO NOT MODIFY list.
- Batch two PRs in one session.

# P1-23 — PROGRESS

## RESUME (re-read after any compaction)
- Branch `fix/salary-change-no-self-approval` (base origin/main 18bef07). Never push to main; no PR open/merge.
- Spec `docs/ux-bulk/prs/P1-23/PROMPT.md`; plan `PLAN.md`. Touch ONLY salary-input.js guard lines + SalaryInput.jsx buttons
  (+ new test, new check script, dist, docs, CLAUDE.md). Fictional data only (repo public).
- Current phase: **Build (go received 11 Oct 2026).**

## Steps
| # | Step | Status | Result / sha |
|---|---|---|---|
| 0 | Phase 0 plan + progress | done | 3807d5c |
| 1 | jest baseline on 18bef07 | done | worktree /tmp/claude-0/p123-base: 89 suites / 1430 pass, 0 red |
| 2 | backend guard (approve + reject) | done | salary-input.js +12 lines (helper + 2 guard lines) |
| 3 | jest salaryChangeSelfApproval.test.js (fails on base, passes on branch) | done | branch 9/9; on 18bef07 4 fail (the 4 self-block tests) / 5 pass |
| 4 | SalaryInput.jsx buttons | done | +18/−1; reason text + title; existing class only (max-w-xs) so no CSS churn |
| 5 | dist rebuild (own commit) | done | 02d48a1 (carries the one-word class tweak too); vs fresh 18bef07 build only SalaryInput chunk differs (hash-normalised); rest = Vite filename cascade |
| 6 | browser check script + run (branch) | done | backend/scripts/salary-change-self-approval-check.py 36/36 (admin locked + API 403, admin2 approves, finance rejects, hr unchanged, 390px), 0 page/console errors |
| 7 | `--base` run on 18bef07 worktree | done | 3/3: admin approves own request, gross applied — bug proved |
| 8 | full jest after | todo | |
| 9 | self-debug + user simulation | todo | |
| 10 | CLAUDE.md Last Session entry | todo | |
| 11 | final push + HEAD == origin | todo | |

## Rulings
- Q6 (owner, 11 Oct 2026): second person always decides, admin included.
- Planner go (11 Oct 2026): Q1 username compare OK; Q2 empty requested_by stays decidable; Q3 requester can neither approve
  nor reject; text = "ask another finance or admin user". Out-of-scope items → CLAUDE.md "found, not fixed". MONEY PR: stop
  after build + checks for independent review.

# P1-13 PROGRESS
## RESUME
Branch fix/finverify-company-scope · worktree /home/claude/wt-p1-13 · port 3113. Read PLAN.md. Phase 0 done, GO received (rulings below).
## Steps
- [x] Phase 0: code read, prod counts, PLAN.md written (11 Oct 2026)
- [ ] jest baseline (flock)
- [x] backend sign-off scope fix + jest (new test 9/9; 6 fail on c942563f). Baseline jest 99/1566
- [ ] frontend note + modal line
- [ ] build + Playwright check + --base
- [ ] merge origin/main, re-run, push
## Owner/planner rulings
- 11 Oct: Option B. Q2 delete NULL-company rows for that month in the same txn. Q3 yes (latest row wins; payroll gate re-locks via upsert). Do NOT touch api.js. Owned: FinanceVerification.jsx + routes/financeVerification.js. Test copies the payroll gate query text verbatim.
## CLAUDE.md entry
(to write at the end)

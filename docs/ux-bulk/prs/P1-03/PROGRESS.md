# P1-03 — PROGRESS

## RESUME (read first after any compaction)
- Worktree /home/claude/wt-p1-03 · branch fix/sales-neft-finalized-only · base 96ee482. Work ONLY here.
- Prompt: docs/ux-bulk/prs/P1-03/PROMPT.md · Plan: docs/ux-bulk/prs/P1-03/PLAN.md
- **Next step:** see first unticked box below.
- Done steps are not redone. Update + commit + push this file after every small step.

## Owner rulings
- Q12 = C (10 Oct 2026): keep computed/reviewed/finalized eligible, exclude paid, always confirm with counts.
- GO 10 Oct 2026. Q1 YES: `no-cache` on the NEFT preview call in utils/api.js. Q2 NO: no held count in the modal. Q3 copy as in PLAN.

## Steps
- [x] P0.1 worktree clean, branch on 96ee482
- [x] P0.2 re-grep + read generateSalesNEFT, bank-neft route, NEFT handlers/modal, status set
- [x] P0.3 PLAN.md + PROGRESS.md written, committed, pushed — STOP (Phase 0 gate)
- [x] P1.1 jest baseline: 81 suites / 1332 pass (worktree: backend node_modules symlinked, frontend npm ci)
- [x] P1.2 generateSalesNEFT: NOT IN (hold,paid) + totals byStatus/notFinalized/alreadyExported/excludedPaid/excludedPaidAmount
- [x] P1.3 salesNeftEligibility.test.js: 8/8 pass; on the 96ee482 service 6 of 8 fail (the 2 that pass: no-paid byte identity, finance 403)
- [x] P1.4 frontend: modal always shown (title "Download bank (NEFT) file?", summary N people · ₹X, conditional lines), missing table only when missing; preview call no-cache (Q1)
- [x] P1.5 dist rebuilt, own commit (api.js is in the index chunk, so chunk hashes rotate widely)
- [ ] P1.6 plant bank md5 + browser check + --base run
- [ ] P1.7 self-debug, v2, CLAUDE.md Last Session, push

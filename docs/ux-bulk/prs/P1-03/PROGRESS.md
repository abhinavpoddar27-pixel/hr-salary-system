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
- [x] P1.6 checks:
  - plant bank file md5 on a scratch DB (30 fictional rows): 96ee482 = branch = 1569dc36…; sales NEFT with no paid rows
    96ee482 = branch = a5d61f12… (byte-identical).
  - `backend/scripts/sales-neft-confirm-check.py` (port 3103, built dist, hr login): 37/37 (two more clean runs at 36/36
    before the no-cache check was added). Base run on a 96ee482 archive (`git archive`, committed dist): 5/5 — Nov file
    downloads with no confirm, paid row in the file and re-stamped.
  - jest after: 82 suites / 1340 pass (baseline 81 / 1332; +8 new).
- [x] P1.7 self-debug + user simulation (cancel, lost-file re-open, month with no missing bank, phone): caught 2 harness
  bugs (company cleared at login → pick it in the page; month store rewritten → pick month in the page), 0 app bugs;
  CLAUDE.md Last Session entry; pushed. DONE — planner opens the PR.

## Review fixes (reviewer: SHIP with Low-1 + Low-3; Low-2 preview/download race → register, NOT done here)
- [x] R1 Low-1: `useRef` in-flight guard in `downloadNEFT` (early return if running; cleared in finally)
- [x] R2 Low-3: button "Download NEFT (N people)"; duplicate "Total to export: ₹…" line removed
- [x] R3 dist rebuilt (own commit)
- [ ] R4 browser check + double-click check (exactly 1 audit row), jest new file, push

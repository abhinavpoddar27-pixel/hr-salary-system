# P1-03 — Sales NEFT: exclude paid rows + always confirm with count, ₹ and status mix
Base: origin/main 96ee482 · Branch: fix/sales-neft-finalized-only · Worktree: /home/claude/wt-p1-03 (work ONLY here)
Master plan: `git show origin/docs/ux-bulk-master-plan:docs/ux-bulk/MASTER_PLAN.md` §6 P1-03, §10, §11, §12
Finding: S-1 · Rulings: R11; **Q12 = C** (10 Oct 2026): keep today's eligible statuses (computed/reviewed/finalized),
EXCLUDE `paid`, always confirm with counts; "finalized only" is deferred to P6-03 (bulk finalize). MONEY PR → an
independent reviewer reads the diff before push.

## RESUME (re-read after any compaction)
- Progress: docs/ux-bulk/prs/P1-03/PROGRESS.md — update + commit + push after EVERY small step. Never redo a ticked step.
- Current phase: 0 plan (STOP at the end of Phase 0 and wait for "go").

## Diagnostics already done by the planner (counts only)
- Code: `services/salesExportFormats.js generateSalesNEFT` (~L171) filters `net_salary > 0 AND status != 'hold'` →
  `paid` rows are included again on any re-download (double-payment risk). `routes/sales.js` ~L3296 stamps
  `neft_exported_at` on download. `SalesSalaryCompute.jsx` ~L220 downloads WITHOUT any confirm when no bank details
  are missing.
- Production: sales Jul–Sep 2026 have 0 finalized and 0 paid rows (Jul 224 computed/10 reviewed, Aug 247/2,
  Sep 215/0; holds 9/6/15). Rows already NEFT-stamped: Jul 189, Sep 187. Last finalize ever: 2 Jun. 7 NEFT downloads
  ever. Sentry: 0 issues. → "finalized only" would empty October's file; hence Q12 = C.

## Phase 0 — plan only (STOP at the end)
1. `cd /home/claude/wt-p1-03`; `git status` clean; branch fix/sales-neft-finalized-only on 96ee482.
2. Re-grep the targets; read generateSalesNEFT, the bank-neft route, the NEFT handlers + modal in SalesSalaryCompute.jsx,
   and the status set (`ALLOWED_STATUS_MOVES` in sales.js). Confirm the exact status strings.
3. Write PLAN.md (files, function, exact change, untouched list, tests, risks, questions) + PROGRESS.md with RESUME.
   Commit + push. STOP.

## Scope (smallest change)
- generateSalesNEFT: eligible = `net_salary > 0 AND status NOT IN ('hold','paid')`. Add to the returned preview
  `totals.byStatus` {computed, reviewed, finalized} counts and `totals.alreadyExported` (rows with neft_exported_at set,
  still included — a lost-file re-download must keep working) and `totals.excludedPaid`. CSV bytes/header/line format,
  filename and the stamping logic unchanged.
- SalesSalaryCompute.jsx: ALWAYS show the confirm modal before download (today it is skipped when nothing is missing):
  "N rows · ₹X · M not finalized · K already in an earlier NEFT file · P paid rows left out", plus the existing
  missing-bank list when present. Plain-language copy (design:ux-copy). Download button unchanged in behaviour.
- No status-workflow change, no schema change, no change to the plant bank file.

## Targets
- backend/src/services/salesExportFormats.js → generateSalesNEFT only
- backend/src/routes/sales.js → bank-neft route ONLY if the preview payload needs passing through (prefer no change)
- frontend/src/pages/Sales/SalesSalaryCompute.jsx → handleExportNEFTPreview / downloadNEFT / NEFT modal only

## DO NOT MODIFY
Global (MASTER_PLAN §10.4) + salesSalaryComputation.js, plant exportFormats.js (generateBankFile), generateSalesExcel,
the status state machine, every other route in sales.js, the register table, loans engine.

## Build rules
- One finding only. Fictional data only (PUBLIC repo). dist rebuilt, own commit. Same port rule: use 3103.
- Skills: engineering:testing-strategy (test plan), design:ux-copy (modal text).

## Verify (MASTER_PLAN §11)
- jest full suite before/after + NEW `salesNeftEligibility.test.js`: paid excluded; hold excluded; net 0 excluded;
  computed/reviewed/finalized included; byStatus/alreadyExported/excludedPaid correct; CSV header byte-identical;
  stamping touches exactly the written rows; paid rows' neft_exported_at untouched.
- Plant bank file byte-identical before/after on a scratch DB (md5).
- Browser check `backend/scripts/sales-neft-confirm-check.py` (built dist, hr login, fictional sales month with
  computed + reviewed + finalized + paid + hold + missing-bank rows): confirm ALWAYS appears with the right numbers;
  Cancel downloads nothing and stamps nothing; Download gives a CSV whose rows = N; 0 page/console errors.
- `--base` run on a main build: shows the paid row included and no confirm (record once).
- Self-debug + user simulation + v2.

## Hand-off
- CLAUDE.md "Last Session" entry at the top. Commit (attribution lines), push, HEAD == origin. No PR open/merge
  (the planner opens it). Report built / caught / tested (counts) / not tested / SHA / new findings.

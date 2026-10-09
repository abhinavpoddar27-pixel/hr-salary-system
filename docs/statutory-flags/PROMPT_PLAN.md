# PLANNING SESSION — STATUTORY FLAGS + LWF  (run once per PR, in plan mode)

The PR number is in the message that opened this session (PR-1, PR-2 or PR-3).
You are planning only. Do not edit source files. Owner rulings in BUILD_PLAN.md §1 are final.

## Read first
- `docs/statutory-flags/PROGRESS.md` (resume block) · `BUILD_PLAN.md` (whole) · `OPEN_ITEMS.md`
- `CLAUDE.md` Section 0 (latest entries), Section 5 (salary engine), Section 7–8 (rules)
- Follow the `/ship` command's Phase A + B discipline (`.claude/commands/ship.md`): context load,
  then a read-only subagent sweep of every file this PR touches.

## Do
1. `git fetch origin && git log origin/main -1` — record the SHA you planned against.
2. For every file/line BUILD_PLAN cites for this PR: open it on origin/main, confirm or correct the
   line numbers and the behaviour described. List every correction under "PLAN ERRATA".
3. Hunt for anything BUILD_PLAN missed: other writers of `pf_applicable/esi_applicable` (grep both
   names across backend + frontend), other readers of the computation tables that need LWF (PR-2),
   other places that rebuild `total_deductions`, other `effective_from` writers.
4. Produce the implementation plan with these sections, compact (target ≤ 12 KB):
   - SCOPE (one paragraph) · BASE SHA
   - FILES: path → function/lines → exact change (one line each). Mark fragile files.
   - DO NOT MODIFY: every file not in FILES that a reader might be tempted to touch, with the reason.
     Always includes `dayCalculation.js`.
   - STEPS: ordered small steps (≤ ~150 changed lines each), each with its commit message and the
     test that proves it. Schema first, then service, then routes, then UI, then dist.
   - TESTS: concrete jest cases (from BUILD_PLAN §6 + anything new you found), fixture approach.
   - VERIFICATION: the drift identity SQL, UPSERT column counts before/after, `node --check` list.
   - RISKS + ROLLBACK: what can go wrong in production and the exact revert.
   - PLAN ERRATA + NEW LANDMINES.
5. Present the plan and wait. When the owner approves (pick the option that keeps edits on manual
   approval — wording varies by Claude Code version; with `opusplan` these writes run on Sonnet):
   - `git checkout -b <branch from BUILD_PLAN §5> origin/main` (if it exists, check it out instead)
   - write the plan to `docs/statutory-flags/IMPL_PR<N>.md`
   - update `PROGRESS.md` (LAST STEP = plan written, NEXT STEP = build session, plus errata)
   - commit only those two files: `docs(statutory): implementation plan PR-<N>`; push the branch
   - print `git rev-parse HEAD` and `git rev-parse origin/<branch>` (must match), then STOP.
   Do not start building in this session.

## Rules
- Never touch production: no Railway, no production URL, no SQL Console writes.
- Never commit employee data (names, codes lists, ESI numbers, UANs, the upload xlsx files).
- If BUILD_PLAN is wrong about something, say so plainly with file:line evidence; do not quietly
  plan around it.

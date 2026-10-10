# Builder prompt template (copy to `docs/ux-bulk/prs/<PR-ID>/PROMPT.md`, fill, keep ≤ 6 KB)
The planner writes one of these per PR. The builder (a Claude Code session) is told only:
"Read docs/ux-bulk/prs/<PR-ID>/PROMPT.md and follow it exactly."
Long detail lives in MASTER_PLAN.md; reference sections instead of pasting them.

---
```
# <PR-ID> — <title>
Base: origin/main <sha> · Branch: <fix|feat|docs>/<short> · Master plan: docs/ux-bulk/MASTER_PLAN.md §6 <PR-ID>, §10, §11, §12
Findings: <IDs> · Rulings that apply: <R#, Q# answers>

## RESUME (re-read after any compaction)
- Progress file: docs/ux-bulk/prs/<PR-ID>/PROGRESS.md — update after EVERY small step (state, done, next, rulings).
- Current phase: <0 plan | 1 build | 2 verify | 3 hand-off>

## Phase 0 — plan only (STOP at the end)
1. git fetch origin; checkout -b <branch> origin/main; confirm base sha.
2. Re-grep every target below (line numbers drift). Read the files in full.
3. Diagnostics first for bugs: Sentry (org asian-lakto-industries-ltd, project hr-salary-backend) and 2–3 read-only
   production queries via the HR SQL Console MCP. Paste counts only (no names/codes — public repo).
4. Write docs/ux-bulk/prs/<PR-ID>/PLAN.md: files to change (path + function + why), smallest change, what is
   NOT touched, tests to add, verification steps, risks, questions.
5. STOP. Report "Phase 0 ready" and wait for "go". Do not write code.

## Scope (smallest change)
<bullets from MASTER_PLAN §6>

## Targets
<file → function/approx lines>

## DO NOT MODIFY
Global list (MASTER_PLAN §10.4) + <PR-specific>.

## Build rules
- One finding = this PR only. Fictional test data only. ₹ via fmtINR, dates via fmtDate, today via todayIST (after P2-03).
- Frontend change → npm run build --prefix frontend; commit frontend/dist (never hand-merge dist).
- UPSERT completeness; money/day changes end with the drift query (MASTER_PLAN §10.7).
- Skills to use: <e.g. frontend-design + design:ux-copy for UI copy; design:accessibility-review for a11y;
  engineering:testing-strategy for the test plan; engineering:code-review for the independent review>.

## Verify (MASTER_PLAN §11)
- npm run build --prefix frontend · cd backend && npx jest (list reds before/after; only parked TDS allowed)
- New tests: <list> · Playwright: <script name> happy path + edge case on built dist, 0 page errors
- Regression scripts: <names> · drift query: <yes/no>
- Self-debug + user simulation + v2 before hand-off.

## Hand-off
- Update CLAUDE.md "Last Session" (top) in the house style.
- Commit (message ends with the session's attribution lines), push branch, verify HEAD == origin/<branch>
  (shallow-clone fix in MASTER_PLAN §12.3 if the stop hook says "no remote branch").
- Report: built / caught / tested / not tested (why) / final status / compare link for the PR /
  owner post-deploy check in seven-field form (Surface · Preflight · Action · Expected · Verify · Undo · Return).
```

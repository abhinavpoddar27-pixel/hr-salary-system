# PROGRESS — PR-0 (leave safety floor + CI truth)

Branch: `fix/leave-safety-and-ci` (base `origin/main`)
Full prompt: `docs/prompts/PR0_SAFETY.md`

Every claim below is tagged **FACT** (file:line or command output), **INFERENCE**, or
**OPINION**. Untagged claims are not allowed.

---

## OWNER RULINGS

- Leave eligibility stays **permanent employees only** — do not widen the engine filter.
- CL pro-rata openings will be corrected by a **separate one-off script** with its own
  approval and DB backup, not here.
- **SL is abolished.**
- **Finalized months are never recalculated.**
- **Stage 7 salary never recomputes automatically.**
- Do **not** repair employee 23725's data. Code only.

---

## HARD RULES

- DO NOT MODIFY: `backend/src/services/salaryComputation.js`,
  `backend/src/services/dayCalculation.js`, `backend/src/database/schema.js`,
  `backend/src/routes/payroll.js`. No schema changes, migrations, tables or columns.
- No leave-engine arithmetic changes in `services/leaveEngine.js` /
  `services/recompute.js`. A guard call may be added; formulas stay untouched.
- Do not touch `policy_config`. Do not enable automation. Do not call preview/apply/
  grants endpoints.
- Smallest possible change. Targeted edits, never a core-file rewrite.
- Step 0.5 delta beats this prompt wherever they disagree.
- One fix = one commit. Never batch.
- Never commit on `main`. Push only `fix/leave-safety-and-ci`. Do not open a PR.
- Any `frontend/src` change requires a rebuilt `frontend/dist` in the same commit.

---

## PHASE LIST

| Phase | Goal | State |
|---|---|---|
| Step 0 | Branch + prompt + tracker + baseline | in progress |
| Step 0.5 | Reconcile delta since `2a0d1f0` | pending |
| Phase 0 | Verify anchors A–G, then STOP at gate | pending |
| Phase 1 | The floor — no negative `leave_balances.balance` | pending |
| Phase 2 | Only what Phase 0 proved still open (A,B,C,D,F) | pending |
| Phase 3 | `protectedWrite` assertions | pending |
| Phase 4 | TDS tests | pending |
| Phase 5 | `/api/version` tells the truth | pending |
| Phase 6 | Self-debug + user simulation + v2 | pending |
| Phase 7 | Verify, update CLAUDE.md, push | pending |

---

## DONE

*(empty)*

---

## NEXT

`Phase 0` — but Step 0.3 (baseline) and Step 0.5 (delta) run first.

---

## FINDINGS

*(empty — baseline and delta to be recorded here)*

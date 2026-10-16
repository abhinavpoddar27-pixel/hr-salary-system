# P5-04 — PROGRESS (MONEY PR)
Branch `feat/bulk-salary-revision` (on feat/bulk-approval-stage 70d98cb + origin/fix/pf-ceiling-approval c6c2fec) · port 3504 · Builder A2

## RESUME
Read PLAN.md (FINAL DESIGN at the bottom), then this file, then `git log --oneline 70d98cb..HEAD`. Rulings below are binding.

## State
Step 4 of 6 done (backend complete, UI next).

## Rulings (planner, 16 Oct 2026)
- Q-B1 Salary Input header button → inline panel SalaryRevisionBulk.jsx (not a Modal) + BulkBatchList.
- Q-B2 % mode rounds new gross to ₹1 (REVISION_GROSS_ROUND).
- Q-B3 default effective date = 1st of next IST month; warn on any other day.
- Q-B4 conveyance kept exactly as the single approve path (N-17).
- Q-B5 past dates allowed with a "re-run Stage 7" warning; a finalised month is refused (error row).
- Q-B6 Stage 7 GROSS_STRUCTURE_CHANGE flags after apply left as is (follow-up).
- Q-B7 split helpers → services/salarySplit.js; approve body → services/salaryChange.js approveSalaryChange(); thin route.
- Q-B8 a pending single-path request → error row at preview/submit; at approve the re-plan refuses (batch stays submitted).
- Q6 second person decides (engine). R3 all-or-nothing, R5 ≤ 50 + auto-split, R8 never twice.

## Baseline
jest 123 suites / 2202 tests, all green (f370a6c).

## Done
1. Final design in PLAN.md (1257cc0).
2. Moves: `services/salarySplit.js` (verbatim + `buildRevisionStructure`), employees.js imports; `services/salaryChange.js` (helpers
   verbatim + `approveSalaryChange`), PUT /salary-input/approve/:id = thin call, same responses. The 5 named suites + statutoryWriters +
   salaryChangeApprover: 151/151 unchanged. Full jest: 1 red = `statutoryWriterGuard` T10b sanity list named `routes/salary-input.js` as a
   file holding a structure INSERT — the INSERT moved, so the list now names `services/salaryChange.js` (the scan itself still covers every
   file; one line changed in the test, on purpose).

3. Kind `services/bulk/kinds/salaryRevision.js` registered in engine KINDS. The "Stage 7 already computed" line is a NOTE
   (message only, not a warning state) so a Stage 7 run between send and approve does not refuse the batch; the undo
   fingerprint is taken at approval. A finalised month ON OR AFTER the effective month is an error row (no retro change).
4. `bulkSalaryRevision.test.js` 16/16 (modes + ₹1 rounding, errors/skip/warn, finalised + re-run note, roles, 51 → 50+1,
   submit writes nothing, approve → structures/gross/requests/audit + R10 carry, parity vs single path, same-date update,
   self-approval, Q-B8 conflict → 409 nothing written, mid-batch throw → nothing incl. audit, later-dated row, undo
   restore byte-identical + Reverted, undo blocked by Stage 7 / later change / finalised).

## Next
5. UI (SalaryRevisionBulk.jsx + SalaryInput header + bulkApi). 6. check script + full verify.

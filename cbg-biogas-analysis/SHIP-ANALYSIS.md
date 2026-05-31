# /ship — adapted for an analysis/TEA build (6-phase quality gate)

Run this gate before any deliverable is declared done. It is the analytical analogue of the
code /ship skill: instead of "does the code run + not regress," it asks "is every number
sourced, does the model close, and does changing a driver propagate correctly?"

## Phase 1 — Context Load
- Re-read CLAUDE.md (identity, the 3 models, assumption-dependency map, gotchas, tiering).
- Confirm the deliverable in hand maps to a lens/section and to the verdict. If a fact doesn't
  move the investment decision, cut it.

## Phase 2 — Plan (subagent)
- Fan out exploration via `deep-research` across the 6 threads (policy / feedstock / capex /
  digestate / carbon / competitive). Synthesise, don't dump.
- Record the "which of 3 models" reasoning as ADR-001 with explicit trade-offs.

## Phase 3 — Build + sanity-lint
- Build/extend the model from `model/drivers.py` (single source of truth — no magic numbers
  inline). Then run the lint checks:
  - **Unit check:** every formula's units cancel to the stated output unit. Guard ₹/kg vs
    ₹/scm vs ₹/MMBTU and m³ biogas vs m³ CH₄ vs kg CBG.
  - **Mass/energy balance closes:** tonnes feedstock × VS × yield → m³ CH₄ → kg CBG;
    in == out within tolerance. Digestate mass ≈ feedstock − biogas mass.
  - **No impossible signs:** no negative cash where impossible, PLF ∈ (0,1], earned ratios capped.
  - **Caps:** earned/pro-rata ratios ≤ 1.0; subsidy ≤ 100% of capex; DSCR computed, not assumed.

## Phase 4 — Test downstream (propagation)
- Perturb ONE driver, confirm it propagates to every consumer it's supposed to (per the
  assumption-dependency map) and to NONE it shouldn't. Examples:
  - D1 feedstock +40% → opex↑ → IRR↓, breakeven-feed unchanged-as-output but IRR/payback move.
  - D6 PLF↓ → both revenue↓ and unit-opex↑ (the coupling must fire).
  - D8 digestate→0 → revenue line drops, Stress scenario reflects it.

## Phase 5 — Assumption-Dependency Audit (the heart of the gate)
- Trace EVERY output number back to a driver, and EVERY driver back to a source tier.
- Confirm each formula's inputs against its consumers (no orphan/dead drivers; no consumer
  reading a stale value).
- Sensitivity ranges sane (no ±300% nonsense bands; ranges justified by sources).
- Cross-check model output against ≥2 published real-plant economics (the 400 kg/day ~₹1.65 cr
  and 5,000 kg/day ~₹16 cr capex benchmarks + the ₹62–72/kg price band) — flag any >25% divergence.
- Every [FACT] cites a T1/T2 source; every [INFERENCE] states its basis; [OPINION] is labelled.

## Phase 6 — GO / NO-GO verdict report
- Per-model GO / NO-GO / CONDITIONAL-GO with exact preconditions.
- Single biggest walk-away reason + single condition that flips it to buy.
- Decision tree + explicit opportunity-cost statement vs the reader's alt capital uses.

## Mandatory close (every build): self-debug + user-simulation
1. **Self-debug:** actually run cbg_model.py; fix every error. Confirm .xlsx opens and formulas
   compute; confirm .docx validates (validate.py) and opens; confirm charts render.
2. **User-simulation:**
   - Happy path: open xlsx, set feedstock = ₹1,200/t → IRR updates sanely, verdict logic holds.
   - Edge 1 (stress corner): digestate = 0 AND PLF = 55% together → coherent (likely negative)
     result, no crash, reflected in Stress scenario.
   - Edge 2 (frontier): OMC price = band bottom AND feedstock = band top → breakeven frontier flags it.
3. Fix, re-run, confirm.
4. Report: what was built, what self-debug caught, what was tested (happy + 2 edges), final status.
   If something genuinely can't be tested, say why.

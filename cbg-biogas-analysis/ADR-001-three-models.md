# ADR-001 — "CBG bottling and sale" is three different businesses; evaluate them separately

- Status: Accepted (Phase 1)
- Date: 2026-05-31
- Decision owner: analysis (for the capital allocator)

## Context
The request — "biowaste / cow-dung-to-CBG capture, upgrading, bottling and sale" — hides a
terminology trap. "Bottling and sale" in the Indian CBG context maps to ≥3 structurally
different businesses with different customers, regulation, capex shape, margin pool, and risk.
Collapsing them produces a model that is internally incoherent (e.g. a pipeline-injection capex
stack priced against a cylinder-logistics revenue line). A second axis — dung-only vs
dung-anchored co-digestion — further changes the risk profile.

## Decision
Treat the opportunity as **three distinct business models**, modelled and recommended on
separately, never blended into a single IRR:

- **M1 — CGD pipeline injection (SATAT model).** Upgrade to >90% CH₄, compress, sell to
  OMC/CGD entities. Volume path; policy-favoured; near-monopsony buyer; **no take-or-pay**.
- **M2 — Bottled / cascade CBG.** Fill high-pressure cascades/composite cylinders, truck to
  off-grid industrial/commercial users. The literal "bottling" business; logistics-dominated
  opex; better unit realisation; PESO-regulated; avoids OMC dependence.
- **M3 — Captive / behind-the-fence displacement.** Burn CBG at the reader's own beverage plant,
  monetised as avoided PNG/LPG/furnace-oil cost (not a sale). Evaluated explicitly because the
  reader operates a process plant; hypothesised as the only defensible *standalone* model.

Cross-cutting feedstock sub-axis kept explicit per model: **dung-only** vs **dung-anchored
co-digestion** (press mud / napier / mandi waste / poultry litter).

## Options considered
1. Single blended "CBG business" model — **rejected**: incoherent capex/revenue coupling, hides
   that M1 and M2 sell to different buyers under different law; would average away the decision.
2. Only model SATAT/M1 (the "default" everyone means) — **rejected**: ignores that M3 may be the
   only model that clears the reader's hurdle, and that M2 sidesteps OMC monopsony risk.
3. Three separate models, then a ranked cross-model verdict — **chosen**.

## Consequences / trade-offs
- (+) Each model gets the right capex stack (pipeline tie-in for M1; bottling skid + cascade
  fleet for M2; tie-in to existing plant fuel header for M3) and the right revenue logic
  (₹/kg sale vs avoided-cost).
- (+) Risk is attributed correctly: M1 carries offtake/monopsony + no-take-or-pay risk; M2 carries
  logistics + PESO + customer-acquisition risk; M3 carries feedstock + own-plant-demand-match risk.
- (−) More build effort: up to 9 cells (3 scales × 3 models). Mitigation: fully build the
  highest-signal cells (M3 at the reader's plant scale; M1 at ~2,000 & ~5,000 kg/day; M2 at a
  scale where cascade logistics is sane) and parameterise the rest so they're reachable.
- (−) The reader must hold three verdicts in mind, not one. Mitigation: a single ranked decision
  tree in Phase 6 collapses them into one actionable path.

## Follow-ups feeding the model
- Confirm M1 no-take-or-pay and whether CBO converts to enforced offtake at the plant gate.
- Confirm M2 legal path (who may fill/sell cascades; PESO/transport rules).
- Get the reader's actual plant PNG/LPG/FO spend (₹/yr) and fuel price — the M3 revenue driver D13.

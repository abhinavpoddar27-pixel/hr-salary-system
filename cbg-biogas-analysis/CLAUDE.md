# CLAUDE.md — CBG / Cow-Dung Biogas Viability Analysis (India)

## Identity (what this is)
- Decision-grade techno-economic + policy + strategic evaluation of a cow-dung-to-Compressed-Biogas (CBG) business in India, 10–15 yr horizon.
- Reader: capital allocator running an FMCG/beverage manufacturing group in North India (Ludhiana), financially literate, 20%+ CAGR mandate, prefers capital-light high-conviction bets. Already owns a process plant that burns PNG/LPG/furnace-oil.
- The decision it informs: deploy real capital — or not — into one of three structurally different "CBG" businesses, or walk away. Verdict required, no hedging.
- Standalone research. Does NOT use or touch the HR-salary repo this container was cloned from.
- All material claims tagged [FACT] / [INFERENCE] / [OPINION]. Indian notation (₹, lakh, crore).

## The three businesses (NEVER collapse these — see ADR-001)
- **M1 — CGD pipeline injection (SATAT):** sell upgraded CBG (>90% CH₄) to OMCs/CGD. Volume path, policy-favoured. ⚠️ NO take-or-pay. OMC is near-monopsony buyer.
- **M2 — Bottled/cascade CBG:** fill high-pressure cylinder cascades, truck to off-grid industrial/commercial users. The literal "bottling" business. Logistics-heavy, better realisation, avoids OMC dependence. PESO-regulated.
- **M3 — Captive displacement:** burn CBG behind-the-fence at the reader's own beverage plant, monetised as avoided PNG/LPG/FO cost. Likely the only defensible *standalone* model (mirrors the plastic-pyrolysis verdict). Must be evaluated explicitly.
- Feedstock axis crosses all three: **dung-only** vs **dung-anchored co-digestion** (press mud / napier / mandi waste / poultry litter). Different risk profiles — keep separate.

## Directory map
```
cbg-biogas-analysis/
├── CLAUDE.md            ← this file (context + assumption-dependency map)
├── PLAN.md              ← execution plan + verification note
├── SHIP-ANALYSIS.md     ← /ship adapted for analysis (6-phase quality gate)
├── ADR-001-three-models.md   ← (Phase 1) the business-model decision record
├── model/
│   ├── cbg_model.py     ← parameterised techno-economic engine (3 scales × 3 models)
│   ├── drivers.py       ← single source of truth for all driver assumptions
│   ├── scenarios.py     ← Tailwind / Base / Stress + Monte-Carlo
│   └── cbg_model.xlsx   ← editable output: Input | Driver | Scenario | Sensitivity sheets
├── charts/             ← tornado, scenario-IRR, breakeven-frontier, MC-IRR
├── report/
│   ├── main.md → main.docx   ← full evaluation, 8 lenses + red-team + verdict
│   └── executive-verdict.md  ← the one-pager he reads first
└── sources/
    └── citations.md    ← Tier-1 sources, dated + "could-not-reconfirm" list
```

## Assumption-Dependency Map (THE analytical analogue of a code data-flow map)
Rule: in a TEA model the dangerous bugs are invisible *driver → output* chains. Every driver
below lists (→) what it feeds and (⇄) what it couples to. Change one, check the chain.
Authoritative values live ONLY in `model/drivers.py`. Tier = source tier to confirm in Phase 1.

| # | Driver | Unit | Feeds (→ outputs) | Couples (⇄ other drivers) | Tier |
|---|--------|------|-------------------|---------------------------|------|
| D1 | Feedstock gate price | ₹/tonne | opex(dominant) → IRR, payback, breakeven-feed | ⇄ D2 (radius↑⇒price↑), D7 (mix), D6 (shortage⇒PLF↓), dung opp-cost floor | T2/T3 field |
| D2 | Dung availability / collection radius | km, t/day | max plant scale, logistics opex, PLF ceiling | ⇄ D1, D6 | T2 |
| D3 | CH₄ / biogas yield | m³/t VS, kg CBG/t | CBG kg/day → revenue (all models) | ⇄ D7 (mix lifts yield), D6, digester tech | T1 (IS 16087) |
| D4 | OMC / CBG sale price | ₹/kg | revenue M1; reference for M2/M3 | ⇄ NG price linkage, CBO enforcement (D9) | T1 (PPAC/OMC) |
| D5 | Capex intensity | ₹/(kg/day) | depreciation, debt, equity-IRR | ⇄ scale, upgrading tech (PSA/scrub/membrane/amine), pipeline tie-in (M1) vs bottling skid (M2) | T1/T2 |
| D6 | Plant Load Factor (PLF) | % | revenue AND unit-opex (the silent killer) | ⇄ D1,D2,D7, O&M, digester stability | T1 papers |
| D7 | Co-digestion mix | % shares | lifts D3; changes D1; supply-contract risk | ⇄ D1,D3 | T2 |
| D8 | Digestate / FOM realisation | ₹/tonne | revenue line — model honestly + ZERO-case | ⇄ D9 (FOM/MDA policy undefined) | T1 policy / T3 price |
| D9 | Policy state (CBO enforce, subsidy, MDA) | flags/% | net-capex (subsidy→equity-IRR, DSCR); offtake reality; D8 | ⇄ D4,D8 | T1 gazette |
| D10 | Capital subsidy / VGF | % of capex | net capex → equity-IRR, DSCR | ⇄ D9, scale eligibility | T1 |
| D11 | Cost of debt / WACC | % | NPV, DSCR, breakeven frontier | ⇄ D10, leverage | T1/T2 |
| D12 | Carbon credit price | ₹/tCO₂e | speculative revenue (tag [INFERENCE]) | ⇄ CCTS maturity (D9) | T2/T3 |
| D13 | Avoided-energy price (M3 only) | ₹/scm, ₹/kg | M3 revenue = displaced PNG/LPG/FO spend | ⇄ NG/LPG market, plant fuel mix | T1/reader data |

Top-4 IRR drivers for Monte-Carlo (hypothesis, confirm via tornado): **D1, D4, D6, D5.**

## Domain gotchas (verify ALL live in Phase 1 — sector moved hard in last 18 mo)
- [VERIFY] OMC CBG price is **calorific-value-linked, not flat**; current band widely cited ~₹62–72/kg — re-confirm.
- [VERIFY] **NO take-or-pay** under SATAT. CBO mandatory blending (1%→3%→4%→5%, FY25-26→FY28-29) is an obligation on CGD *entities at aggregate level* — confirm whether it converts to *enforced offtake at the plant gate*. This distinction is the whole investment case.
- [VERIFY] Digestate/FOM offtake policy remains **under-defined**; MDA support ₹/tonne exists but the revenue may not clear. Always run a ZERO-digestate downside.
- [VERIFY] GST/excise on CBG + FOM reclassification changed recently — confirm current treatment.
- [VERIFY] Unit traps: ₹/kg vs ₹/scm vs ₹/MMBTU; m³ biogas vs m³ CH₄ vs kg CBG (≈ density 0.74–0.78 kg/scm, ~18 kg CBG/MT dung per IS 16087). Guard every formula.
- [VERIFY] Capex benchmarks for cross-check: ~400 kg/day ≈ ₹1.65 cr; ~5,000 kg/day ≈ ₹16 cr. Provisional only.
- SATAT 5,000-plant target massively undershot — diagnose real failure modes (feedstock squeeze, PLF, no-offtake), not the brochure.
- Reader's hurdle: contrast likely CBG project IRR (<20%, long payback, ops-heavy) vs his 20%+ mandate. State opportunity cost explicitly.

## Source-tiering (enforced on every claim)
- **T1 (cite directly):** MoPNG/PPAC/MNRE notifications, SATAT/IOCL docs, CBO gazette, GOBARdhan, PNGRB, CEA, peer-reviewed TEA papers, OMC pricing circulars, bank CBG-scheme docs.
- **T2 (use, flag as estimate):** consultancy/DPR vendors, IMARC/Coherent market reports, trade press.
- **T3 (corroborate or discard):** blogs, LinkedIn, promoter marketing.
- Recency rule: re-confirm policy + price live as of session date (today: 2026-05-31). Maintain a "could-not-reconfirm" list in sources/citations.md.

## Tooling notes (this environment)
- Branded skills named in the prompt (`data:*`, `xlsx`, `docx`, `engineering:architecture`, `operations:*`, `brightdata-plugin:*`, `/oem-eval`) are NOT installed here. Substitutes:
  - Research/fan-out + adversarial verify → `deep-research` skill (covers the parallel policy/feedstock/capex/digestate/carbon/competitive exploration).
  - .xlsx → `openpyxl`; .docx → `python-docx` (+ a validate.py opener check); charts → `matplotlib`.
  - ADR/risk-assessment/vendor-review/OEM-eval → handwritten markdown following those formats.
- Secrets: if any live data feed needs a key, use Infisical (`infisical run --env=dev -- <cmd>`). No `.env`, no hardcoded keys in prompts/output.
- Python deps install fine (`pip install numpy openpyxl python-docx matplotlib` confirmed; numpy 2.4.6).

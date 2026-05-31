# Phase 1 Framing Memo — what the research changes before we model

## Benchmark reconciliation (the prompt's three "facts" vs reality)
| Prompt benchmark | Research verdict |
|---|---|
| 400 kg/day ≈ ₹1.65 cr | Really a **~1 TPD** figure; 400 kg/day exact not independently sourced. Treat ₹1.65 cr as ~1 TPD. |
| 5,000 kg/day ≈ ₹16 cr | **Too low ~30–45%.** Consensus ₹20–25 cr; T1 parliamentary cross-check ~₹25 cr. Use **₹22–25 cr**. |
| OMC price ₹62–72/kg | Updated: **~₹77.4/kg ex-GST (₹1,478/MMBTU)**, Jun 2025, = **85% of avg CNG retail, CNG-linked, no floor**. |

## Six structural findings that drive model design
1. **Scale floor:** sub-10 TPD CBG plants are "largely non-viable unless heavily subsidised"; 15–20+ TPD optimal. **All three prompt scales (0.4/2/5 TPD) sit below the floor.** → ADD a 10 TPD and ~15 TPD (≈100 TPD-feed) scale so M1 gets a fair shot. Keep 0.4/2/5 to *show* they fail.
2. **The margin vise:** after the administered base rate only ~₹500–700 left per tonne of dung to cover feedstock + debt + profit; **dung >₹1,000–1,500/t mathematically erases viability** — and NDDB ₹1/kg + the press-mud spiral (₹100→₹500–600/t) are already pushing there. D1 is THE sensitivity.
3. **M2 (bottled) is structurally penalised:** retail/bottling capex ≈ **2× (small) to 5× (mid)** of injection, PLUS 250-bar vs 3–5-bar compression, PLUS the dominant-and-undocumented cascade logistics opex. Hypothesis: **M2 is the worst model unless a high-realisation niche customer exists.**
4. **No demand security for one plant:** no take-or-pay (SATAT); CBO is aggregate-on-CGD-entities, not plant-gate; the *only* take-or-pay is one you negotiate with a CGD as a DPI-subsidy precondition (M1-route). Offtake risk is real and uninsurable by policy.
5. **FOM is upside, not base:** ₹1,000–1,500/t base near the MDA floor, but a real Surat plant runs at **2.9% capacity** citing no FOM demand. **Zero-FOM downside is realistic, not pessimistic-for-effect.** Carbon = optionality only, exclude from base.
6. **External IRR anchor (SBI Caps):** 6 TPD CBG → **5–7% IRR**; 100 TPD-feed → 13–16%; 200 TPD-feed → 19–21%. Promoter DPRs claim 18–22% but **>70% of early plants missed forecasts.** → The model is *right* if small/mid plants land sub-WACC and only large + injection clears 15%. If our Base shows 20%+ without a policy tailwind, re-audit (per verification note).

## What this does to the three models (pre-build hypothesis)
- **M1 (SATAT injection):** only plausibly bankable at **≥10–15 TPD** with a signed CGD GSA carrying ≥50% ToP (which also unlocks the DPI pipeline subsidy). Even then, equity IRR likely low-teens, ops-heavy, sub the reader's 20% hurdle.
- **M2 (bottled cascade):** likely **NO-GO** as a standalone for this reader — 2–5× capex + logistics + customer-acquisition, with no policy support. Only survives as a *fallback offtake* when M1's OMC won't lift.
- **M3 (captive at the beverage plant):** the structurally cleanest — avoids OMC monopsony, offtake risk, and bottling logistics entirely; value = avoided PNG/LPG/FO spend. **But gated on (a) the plant's actual annual fuel spend [reader input — driver D13], and (b) dung available <10–15 km at <₹1,000–1,500/t.** Mirrors the plastic-pyrolysis "captive is the one defensible angle" verdict.

## Open input needed from the reader (does not block the build — parameterised)
- **D13:** the beverage plant's current PNG/LPG/furnace-oil **annual spend (₹/yr)** and **unit fuel price (₹/scm or ₹/kg)**. The M3 verdict is conditional on this; the xlsx will expose it as an editable cell with a sensitivity, and I'll state the breakeven fuel-spend in the verdict.

## Model build decisions (Phase 2)
- Scales modelled: **0.4, 2, 5, 10, ~15 TPD CBG** (0.4/2/5 to demonstrate sub-floor failure; 10/15 for the real M1 case).
- Upgrading tech default: **membrane** (lowest capex/parasitic small-mid); amine only at large scale if purity demands.
- Base PLF **50%** (yr2-3), with a yr-1 30–40% ramp; nameplate discounted 40–60%.
- Yield **~15 kg CBG/t fresh dung** (verify basis), CH₄ 60%, density 0.75 kg/scm.
- Price **₹77/kg** administered (M1); M3 uses avoided-cost; M2 uses a niche realisation + logistics deduction.
- FOM **₹1,250/t base, ₹0 downside**; carbon excluded from base.
- Capex intensity **₹40–50k/kg-day**, +2–5× for M2; D:E 75:25; debt ~10.5%; subsidy per MNRE caps (₹4 cr/4,800 kg-day, cap ₹10 cr) + DPI pipeline for M1.

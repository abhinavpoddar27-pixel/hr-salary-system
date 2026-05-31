# Execution Plan — CBG Viability Analysis

## Approval gate
Phase 0 (this scaffold) → **STOP for your approval** → then Phases 1–6. No lenses begin until you sign off.

## Phase sequence

**Phase 1 — Framing + live verification (deep-research fan-out)**
- Resolve the terminology trap → ADR-001 (the 3 models, kept separate).
- `deep-research` across 6 parallel threads, each producing dated T1/T2 citations into sources/citations.md:
  1. Policy/regulatory (SATAT tenure & pricing formula, no-take-or-pay confirm, CBO enforcement-at-gate?, DPI/Synchro/Uniform-Base-Price, MNRE/GOBARdhan/state-NorthIndia subsidies, FOM/MDA policy, PESO for M2, CCTS/carbon).
  2. Feedstock economics (dung/animal/day, collectable fraction, radius, observed SATAT-driven feedstock price spiral, dung opportunity cost, co-digestion supply risk, IS 16087 yield).
  3. Capex (3 scales; upgrading tech compare: water-scrub vs PSA vs membrane vs amine; bottling skid; pipeline tie-in).
  4. Opex + digestate realisation.
  5. Carbon (CCTS status — real vs speculative).
  6. Competitive/strategic (operator failure modes from commissioned-plant data; who captures margin).
- Output: framing memo + populated citations + "could-not-reconfirm" list.

**Phase 2 — Build the model**
- model/drivers.py (single source of truth) → cbg_model.py (3 scales × 3 models; build the prioritised cells, justify which) → cbg_model.xlsx (Input | Driver | Scenario | Sensitivity, drivers editable).
- Capex/opex/revenue stacks per model; outputs: project IRR, equity IRR, NPV, payback, DSCR, breakeven CBG price, breakeven feedstock price, PLF-breakeven. Base case at realistic PLF (60–75%), not nameplate.

**Phase 3 — Sensitivity / scenario / Monte-Carlo**
- Tornado (D1,D4,D6,D5,D8,D10,D11). Three scenarios: Policy-Tailwind / Base / Stress (feed +40%, PLF 55%, zero digestate, OMC gaps). Monte-Carlo on top-4 drivers → P10/P50/P90 IRR. Breakeven frontier (feed × OMC at WACC).
- Charts: tornado, scenario-IRR bars, breakeven frontier, MC-IRR distribution.

**Phase 4 — The 8 lenses** (each ends with 3-bullet "so-what for the verdict"):
Policy/Reg · Feedstock · Techno-economic · Sensitivity · Competitive(Porter+value-chain) · Long-term/macro · ESG/optics · Execution/ops (incl. honest read on solo-leader bandwidth).

**Phase 5 — Red-team** (mandatory): strongest "value trap" case vs strongest steel-man to proceed; cite failure-mode evidence honestly.

**Phase 6 — Verdict + assembly**
- Per-model GO/NO-GO/CONDITIONAL-GO + exact preconditions + biggest walk-away + the one flip condition + decision tree + opportunity-cost statement.
- Assemble report/main.docx (TOC, headings, tables, embedded charts, FACT/INFERENCE/OPINION as styled inline labels) + executive-verdict.md (one-pager) + sources appendix.
- Run SHIP-ANALYSIS.md full gate incl. self-debug + user-simulation close.

## Deliverables checklist
- [x] Phase 0: .claudeignore, CLAUDE.md (+ assumption-dependency map), SHIP-ANALYSIS.md, PLAN.md (this), verification note (below)
- [ ] ADR-001 three-models
- [ ] sources/citations.md (T1 dated + could-not-reconfirm)
- [ ] model/*.py + cbg_model.xlsx (editable drivers)
- [ ] charts/*.png (tornado, scenario, frontier, MC)
- [ ] report/main.docx (8 lenses + red-team + verdict)
- [ ] report/executive-verdict.md (one-pager)

## Verification note — how I'll know the model is right
1. **External cross-check (≥2 real plants):** model capex/IRR must land within ~25% of published
   400 kg/day (~₹1.65 cr) and 5,000 kg/day (~₹16 cr) economics, and revenue must reconcile to the
   ₹62–72/kg OMC band. ALL THREE benchmarks treated as [TO VERIFY IN PHASE 1] — not trusted as fixed.
2. **Internal closure:** mass/energy balance closes (feedstock→CH₄→kg CBG; digestate mass balance);
   units cancel everywhere (the ₹/kg–₹/scm–₹/MMBTU and biogas–CH₄–CBG traps); no impossible signs.
3. **Propagation:** perturbing any single driver moves exactly the outputs the dependency map says
   it should — verified in SHIP Phase 4.
4. **Source discipline:** every [FACT] → T1/T2 citation; sensitivity bands justified, not arbitrary.
5. **Sanity vs reader's hurdle:** if Base-case equity IRR clears 20% with no policy tailwind, treat
   that as a red flag to re-audit, not a win — it contradicts the sector's documented reality.

"""
drivers.py — SINGLE SOURCE OF TRUTH for every assumption in the CBG model.
No magic numbers anywhere else. Each value carries a short provenance + tier comment.
See ../sources/citations.md for full sourcing and ../CLAUDE.md for the dependency map (D1..D13).

Units are stated on every field. Guard the three unit traps:
  ₹/kg vs ₹/scm vs ₹/MMBTU  ·  m³ biogas vs m³ CH4 vs kg CBG.
"""
from dataclasses import dataclass, field
from typing import Dict

# ---------------------------------------------------------------------------
# Physical / conversion constants  (Thread 2, T1/T2)
# ---------------------------------------------------------------------------
CH4_DENSITY_KG_PER_M3 = 0.716     # CH4 at STP [FACT][T1]
CBG_DENSITY_KG_PER_SCM = 0.75     # CBG (>=90% CH4) ~0.74-0.78 [FACT][T1/T2]
CBG_ENERGY_MJ_PER_KG   = 50.0     # ~ natural-gas-equivalent; CBG ~52 MJ/kg HHV [INFERENCE][T2]
CH4_FRACTION_RAW_BIOGAS = 0.60    # 55-65%, use 60% [FACT][T1]
CH4_UPGRADE_RECOVERY    = 0.92    # membrane recovery 0.88-0.95 [FACT][T1 MDPI 2025]

# ---------------------------------------------------------------------------
# Feedstock catalogue: yield (kg CBG / tonne fresh) + gate price (₹/tonne)
# Yields are FRESH-WEIGHT planning figures (Thread 2/3). Dung deliberately low.
# ---------------------------------------------------------------------------
FEEDSTOCKS: Dict[str, dict] = {
    # name        kg CBG / t fresh      ₹/tonne delivered          provenance
    "dung":       {"yield_kg_per_t": 15.0, "price_rs_per_t": 1250.0},  # [INF] ~14-18 kg/t; NDDB ₹1/kg→spiral toward ₹1.25-2k [T2]
    "press_mud":  {"yield_kg_per_t": 40.0, "price_rs_per_t":  550.0},  # 25 t→1 t CBG; ₹500-600/t, SEASONAL Oct-Apr [T2]
    "napier":     {"yield_kg_per_t": 85.0, "price_rs_per_t": 1500.0},  # energy crop; ties up land [T3, flag]
    "poultry":    {"yield_kg_per_t": 55.0, "price_rs_per_t":  800.0},  # high yield, NH3/H2S corrosion → minority [T3]
}

# Default recipe per the framing memo: dung-anchored co-digestion (50/50 dung+press mud)
DEFAULT_MIX: Dict[str, float] = {"dung": 0.50, "press_mud": 0.50}

# ---------------------------------------------------------------------------
# The driver set (D1..D13). Base-case values. Scenarios override these.
# ---------------------------------------------------------------------------
@dataclass
class Drivers:
    # --- D6 plant load factor (the silent killer) ---
    plf: float = 0.50                      # realized yr2-3 well-run; 30-40% yr1 [FACT][T2 REGlobal]
    operating_basis_days: int = 365        # PLF already embeds downtime → use 365×PLF (NO extra ×330) to avoid double-count
    yr1_plf_ramp: float = 0.35             # year-1 ramp PLF [INFERENCE]

    # --- D2 feedstock availability / logistics ---
    collectable_dung_kg_per_animal_day: float = 5.0   # dairy-anchored; 3 scattered [FACT/INF][T2]
    collection_radius_km_max: float = 15.0            # wet-dung economical radius [FACT heuristic][T2]
    availability_security_multiple: float = 4.0       # need ~4× requirement in radius [FACT][T2]
    cattle_density_per_km2: float = 80.0              # rural N-India order-of-magnitude [INFERENCE — VERIFY]

    # --- D4 / D13 price of output by model ---
    cbg_price_rs_per_kg_M1: float = 77.0   # SATAT ₹1,478/MMBTU ≈ ₹77.4/kg, 85% of CNG, CNG-linked NO FLOOR [FACT][T2]
    cbg_realisation_rs_per_kg_M2: float = 90.0   # bottled niche realisation (better than OMC) [INFERENCE — VERIFY]
    avoided_fuel_rs_per_kg_cbg_M3: float = 60.0  # M3 avoided PNG/LPG/FO value per kg CBG [READER INPUT D13 — placeholder]

    # --- D8 digestate / FOM ---
    fom_t_per_t_feedstock: float = 0.30    # solid FOM fraction of fresh feed [INFERENCE — conservative]
    fom_price_rs_per_t: float = 1250.0     # ₹500-4500/t range; base near MDA floor [FACT][T1 IBA/CSE]
    fom_revenue_clears: bool = True        # set False for the realistic ZERO-FOM downside (Surat 2.9% PLF) [FACT][T2]

    # --- D12 carbon (excluded from base) ---
    carbon_price_rs_per_tco2e: float = 0.0 # SPECULATIVE; market not live; base = 0 [OPINION][T2]
    carbon_tco2e_per_t_cbg: float = 2.5    # ~2-3 VER/t CBG [T3, flag] — only used if price>0

    # --- D5 capex ---
    capex_intensity_rs_per_kgday: float = 45000.0   # ₹40-50k/kg-day at ~5 TPD [INFERENCE][T1 cross-check ₹25cr@5TPD]
    small_scale_capex_penalty: float = 1.25         # <2 TPD worse per kg (diseconomy) [INFERENCE]
    bottling_capex_multiplier_M2: float = 3.0       # retail/bottling 2× small–5× mid vs injection [FACT][T1 Std Cttee]
    aggregation_capex_share: float = 0.20           # 10-30% of project cost [FACT][T2 CBEII]
    aggregation_reinvest_years: tuple = (5, 10)     # re-invested every 5-6 yrs [FACT]

    # --- opex ---
    feedstock_share_of_opex: float = 0.40           # 30-50%, dominant [FACT][T2]  (cross-check only)
    # Opex split so that LOW PLF RAISES UNIT COST (D6 coupling): fixed costs spread over less output.
    fixed_opex_pct_of_capex: float = 0.05           # O&M + fixed manpower, PLF-INDEPENDENT [INFERENCE][T2]
    variable_opex_rs_per_kg: float = 4.0            # power/consumables, scales with output [INFERENCE][T2/T3]
    logistics_opex_rs_per_kg_M2: float = 15.0       # cascade trucking (dominant, undocumented) [INFERENCE — VERIFY]

    # --- D10 subsidy / D11 financing ---
    mnre_cfa_rs_per_4800kgday: float = 4.0e7        # ₹4 cr per 4,800 kg/day, new plants [FACT][T1 MNRE]
    mnre_cfa_cap_rs: float = 1.0e8                  # cap ₹10 cr/project [FACT][T1]
    dpi_pipeline_support_rs_M1: float = 9.95e7      # ~₹9.95 cr/project grid-connectivity (M1 only) [FACT][T1 PNGRB]
    include_dpi_subsidy: bool = False               # base OFF; DPI needs signed CGD GSA w/ >=50% ToP → Tailwind only [FACT]
    subsidy_cap_pct_of_gross: float = 0.30          # realistic stack 20-35% of project [FACT][T2]
    debt_share: float = 0.75                        # tightened from 95:5 to 75:25 [FACT][T2]
    cost_of_debt: float = 0.105                     # MCLR-linked ~10.5% [INFERENCE — VERIFY]
    debt_tenor_years: int = 11                      # 10-12 yr [FACT][T1 IREDA]
    cost_of_equity: float = 0.18                    # reader's ~20% hurdle, slight haircut for ESG [OPINION]
    tax_rate: float = 0.25                          # 25% corporate [FACT]
    project_life_years: int = 15                    # = offtake tenor [FACT][T1]
    depreciation_years: int = 15                    # straight-line, simplification [INFERENCE]

    mix: Dict[str, float] = field(default_factory=lambda: dict(DEFAULT_MIX))

    @property
    def wacc(self) -> float:
        return self.debt_share * self.cost_of_debt * (1 - self.tax_rate) \
             + (1 - self.debt_share) * self.cost_of_equity


# Plant scales to evaluate, by CBG OUTPUT (TPD). 0.4/2/5 demonstrate sub-floor failure;
# 10/15 are the real M1 candidates (viability floor ~10 TPD per Thread 2/4).
SCALES_TPD_CBG = [0.4, 2.0, 5.0, 10.0, 15.0]

"""
cbg_model.py — parameterised techno-economic engine for the India CBG decision.
Three business models (M1 SATAT-injection / M2 bottled-cascade / M3 captive-displacement)
× plant scales (drivers.SCALES_TPD_CBG). All numbers come from drivers.py.

Outputs per (scale, model): project IRR, equity IRR, NPV@WACC, payback, min DSCR,
breakeven CBG price, breakeven dung price, implied dung-animal count & feasible-radius flag.

SHIP sanity-lint (run with --selftest): unit-chain reconciliation, mass-balance closure,
sign/cap guards, and a propagation check (perturb one driver → expected output moves).
"""
from __future__ import annotations
import math, copy, sys
from dataclasses import replace
from drivers import (Drivers, FEEDSTOCKS, SCALES_TPD_CBG,
                     CH4_DENSITY_KG_PER_M3, CBG_DENSITY_KG_PER_SCM,
                     CH4_FRACTION_RAW_BIOGAS, CH4_UPGRADE_RECOVERY)

MODELS = ("M1_injection", "M2_bottled", "M3_captive")

# ---------------------------------------------------------------------------
# Finance helpers (no numpy_financial dependency — implement IRR by bisection)
# ---------------------------------------------------------------------------
def npv(rate: float, cashflows: list[float]) -> float:
    return sum(cf / (1.0 + rate) ** t for t, cf in enumerate(cashflows))

def irr(cashflows: list[float]) -> float | None:
    """Bisection IRR in (-0.99, 5.0). Returns None if no sign change / no root."""
    if not any(cf > 0 for cf in cashflows) or not any(cf < 0 for cf in cashflows):
        return None
    lo, hi = -0.9899, 5.0
    f_lo, f_hi = npv(lo, cashflows), npv(hi, cashflows)
    if f_lo * f_hi > 0:
        return None  # no IRR in range (e.g. never recovers capital → effectively < -99%)
    for _ in range(200):
        mid = (lo + hi) / 2.0
        f_mid = npv(mid, cashflows)
        if abs(f_mid) < 1.0:
            return mid
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return (lo + hi) / 2.0

# ---------------------------------------------------------------------------
# Mass / energy balance  (D3, D7, D6)
# ---------------------------------------------------------------------------
def weighted_yield_kg_per_t(mix: dict) -> float:
    assert abs(sum(mix.values()) - 1.0) < 1e-6, f"mix shares must sum to 1.0, got {sum(mix.values())}"
    return sum(share * FEEDSTOCKS[name]["yield_kg_per_t"] for name, share in mix.items())

def feedstock_blended_price(mix: dict) -> float:
    return sum(share * FEEDSTOCKS[name]["price_rs_per_t"] for name, share in mix.items())

def mass_energy_balance(scale_tpd_cbg: float, d: Drivers) -> dict:
    """From a CBG OUTPUT target, derive nameplate feedstock throughput, biogas/CH4,
    digestate, and the implied dung-animal count + collection-radius feasibility."""
    cbg_nameplate_kgday = scale_tpd_cbg * 1000.0
    wy = weighted_yield_kg_per_t(d.mix)                       # kg CBG / t fresh feed
    feedstock_tpd = cbg_nameplate_kgday / wy                  # t fresh feed / day (nameplate)

    # --- unit-chain reconciliation (diagnostic): rebuild dung CBG via the biogas path ---
    # 30 m3 biogas/t fresh dung × CH4% × CH4 density × upgrade recovery → kg CBG/t
    dung_recon = 30.0 * CH4_FRACTION_RAW_BIOGAS * CH4_DENSITY_KG_PER_M3 * CH4_UPGRADE_RECOVERY
    unit_chain_ok = 9.0 <= dung_recon <= 20.0                 # must bracket the ~15 kg/t planning figure

    # --- dung-availability constraint (D2) ---
    dung_tpd = feedstock_tpd * d.mix.get("dung", 0.0)
    animals_required = (dung_tpd * 1000.0) / d.collectable_dung_kg_per_animal_day \
                        if d.mix.get("dung", 0.0) > 0 else 0.0
    animals_required *= d.availability_security_multiple      # need ~4× in radius for security
    radius_area_km2 = math.pi * d.collection_radius_km_max ** 2
    animals_available_in_radius = radius_area_km2 * d.cattle_density_per_km2
    dung_feasible = animals_required <= animals_available_in_radius

    # --- mass-balance closure ---
    cbg_mass_tpd = cbg_nameplate_kgday / 1000.0
    fom_tpd = feedstock_tpd * d.fom_t_per_t_feedstock
    assert cbg_mass_tpd < feedstock_tpd, "gas mass out cannot exceed feed mass in"
    assert fom_tpd < feedstock_tpd, "FOM out cannot exceed feed mass in"
    assert 0.0 < d.plf <= 1.0, "PLF must be in (0,1]"

    return dict(
        cbg_nameplate_kgday=cbg_nameplate_kgday, weighted_yield=wy, feedstock_tpd=feedstock_tpd,
        dung_tpd=dung_tpd, animals_required=animals_required,
        animals_available_in_radius=animals_available_in_radius, dung_feasible=dung_feasible,
        fom_tpd=fom_tpd, dung_recon_kg_per_t=dung_recon, unit_chain_ok=unit_chain_ok,
    )

# ---------------------------------------------------------------------------
# Capex (D5, D10)
# ---------------------------------------------------------------------------
def capex(scale_tpd_cbg: float, model: str, d: Drivers) -> dict:
    cbg_kgday = scale_tpd_cbg * 1000.0
    gross = cbg_kgday * d.capex_intensity_rs_per_kgday
    if scale_tpd_cbg < 2.0:
        gross *= d.small_scale_capex_penalty                  # diseconomy of small scale
    if model == "M2_bottled":
        gross *= d.bottling_capex_multiplier_M2               # 2-5× injection [FACT]

    # Subsidy: MNRE CFA (scaled, capped) + DPI pipeline (M1 only). Capped at 60% of gross (realism).
    mnre = min(d.mnre_cfa_rs_per_4800kgday * (cbg_kgday / 4800.0), d.mnre_cfa_cap_rs)
    dpi = d.dpi_pipeline_support_rs_M1 if (model == "M1_injection" and d.include_dpi_subsidy) else 0.0
    subsidy = min(mnre + dpi, d.subsidy_cap_pct_of_gross * gross)
    net = gross - subsidy
    return dict(gross=gross, subsidy=subsidy, net=net,
                debt=net * d.debt_share, equity=net * (1 - d.debt_share))

# ---------------------------------------------------------------------------
# Annual revenue & opex (D1, D4, D8, D12, D13, D6 coupling)
# ---------------------------------------------------------------------------
def annual_flows(scale_tpd_cbg: float, model: str, d: Drivers, mb: dict, cx: dict, plf: float,
                 dung_price_override: float | None = None, cbg_price_override: float | None = None) -> dict:
    cbg_kg_yr = mb["cbg_nameplate_kgday"] * d.operating_basis_days * plf       # D6 → output
    feed_t_yr = mb["feedstock_tpd"] * d.operating_basis_days * plf             # D6 → feedstock too

    # feedstock cost (allow dung price override for breakeven solving)
    price_per_t = 0.0
    for name, share in d.mix.items():
        if name == "dung" and dung_price_override is not None:
            p = dung_price_override                                  # absolute override (breakeven solver)
        else:
            p = FEEDSTOCKS[name]["price_rs_per_t"] * d.feedstock_price_multiplier  # global shock lever
        price_per_t += share * p
    feedstock_cost = feed_t_yr * price_per_t

    fixed_opex = d.fixed_opex_pct_of_capex * cx["gross"]                       # PLF-INDEPENDENT (raises unit cost at low PLF)
    variable_opex = cbg_kg_yr * d.variable_opex_rs_per_kg
    logistics = cbg_kg_yr * d.logistics_opex_rs_per_kg_M2 if model == "M2_bottled" else 0.0
    opex = feedstock_cost + fixed_opex + variable_opex + logistics

    # revenue by model
    if model == "M1_injection":
        unit = cbg_price_override if cbg_price_override is not None else d.cbg_price_rs_per_kg_M1
    elif model == "M2_bottled":
        unit = cbg_price_override if cbg_price_override is not None else d.cbg_realisation_rs_per_kg_M2
    else:  # M3_captive
        unit = cbg_price_override if cbg_price_override is not None else d.avoided_fuel_rs_per_kg_cbg_M3
    cbg_rev = cbg_kg_yr * unit

    fom_rev = (feed_t_yr * d.fom_t_per_t_feedstock * d.fom_price_rs_per_t) if d.fom_revenue_clears else 0.0
    carbon_rev = (cbg_kg_yr / 1000.0) * d.carbon_tco2e_per_t_cbg * d.carbon_price_rs_per_tco2e
    revenue = cbg_rev + fom_rev + carbon_rev

    return dict(cbg_kg_yr=cbg_kg_yr, feed_t_yr=feed_t_yr, feedstock_cost=feedstock_cost,
                fixed_opex=fixed_opex, variable_opex=variable_opex, logistics=logistics,
                opex=opex, cbg_rev=cbg_rev, fom_rev=fom_rev, carbon_rev=carbon_rev, revenue=revenue)

# ---------------------------------------------------------------------------
# Full 15-yr cashflow → IRR/NPV/DSCR/payback
# ---------------------------------------------------------------------------
def project_financials(scale_tpd_cbg: float, model: str, d: Drivers,
                       dung_price_override=None, cbg_price_override=None) -> dict:
    mb = mass_energy_balance(scale_tpd_cbg, d)
    cx = capex(scale_tpd_cbg, model, d)
    dep = cx["net"] / d.depreciation_years
    n = d.project_life_years

    unlev = [-cx["net"]]      # project (unlevered) cashflow, yr0 = -net capex
    equity_cf = [-cx["equity"]]
    dscr_list = []
    # debt amortisation: straight-line principal over tenor
    principal_per_yr = cx["debt"] / d.debt_tenor_years
    balance = cx["debt"]

    for yr in range(1, n + 1):
        plf = d.yr1_plf_ramp if yr == 1 else d.plf
        f = annual_flows(scale_tpd_cbg, model, d, mb, cx, plf, dung_price_override, cbg_price_override)
        ebit = f["revenue"] - f["opex"] - dep
        tax_unlev = max(0.0, ebit) * d.tax_rate
        reinvest = d.aggregation_capex_share * cx["gross"] if yr in d.aggregation_reinvest_years else 0.0
        unlev.append(ebit * (1 - d.tax_rate) + dep - reinvest)

        interest = balance * d.cost_of_debt
        principal = principal_per_yr if yr <= d.debt_tenor_years else 0.0
        ebt = ebit - interest
        tax_lev = max(0.0, ebt) * d.tax_rate
        pat = ebt - tax_lev
        equity_cf.append(pat + dep - principal - reinvest)
        if principal + interest > 0:
            dscr_list.append((pat + dep + interest) / (interest + principal))
        balance -= principal

    proj_irr = irr(unlev)
    eq_irr = irr(equity_cf)
    proj_npv = npv(d.wacc, unlev)
    # payback (unlevered, simple)
    cum, payback = 0.0, None
    for t, cf in enumerate(unlev):
        cum += cf
        if cum >= 0 and payback is None and t > 0:
            payback = t
    return dict(mb=mb, cx=cx, unlev=unlev, equity_cf=equity_cf,
                proj_irr=proj_irr, eq_irr=eq_irr, npv=proj_npv,
                min_dscr=(min(dscr_list) if dscr_list else None),
                payback=payback, wacc=d.wacc)

# ---------------------------------------------------------------------------
# Breakeven solvers (bisection on NPV=0)
# ---------------------------------------------------------------------------
def _solve_breakeven(scale, model, d, key, lo, hi):
    def f(x):
        kw = {key: x}
        return project_financials(scale, model, d, **kw)["npv"]
    flo, fhi = f(lo), f(hi)
    if flo * fhi > 0:
        return None
    for _ in range(80):
        mid = (lo + hi) / 2.0
        fm = f(mid)
        if abs(fm) < 1e4:
            return mid
        if flo * fm < 0:
            hi, fhi = mid, fm
        else:
            lo, flo = mid, fm
    return (lo + hi) / 2.0

def breakeven_cbg_price(scale, model, d):
    return _solve_breakeven(scale, model, d, "cbg_price_override", 1.0, 300.0)

def breakeven_dung_price(scale, model, d):
    # higher dung price LOWERS npv → search downward
    return _solve_breakeven(scale, model, d, "dung_price_override", 0.0, 20000.0)

# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------
def cr(x):  # ₹ → ₹ crore string
    return "n/a" if x is None else f"{x/1e7:,.2f}"

def pct(x):
    return "n/a" if x is None else f"{x*100:,.1f}%"

def run_table():
    d = Drivers()
    print(f"\nBase-case drivers: PLF={d.plf}, mix={d.mix}, CBG₹/kg(M1)={d.cbg_price_rs_per_kg_M1}, "
          f"WACC={pct(d.wacc)}, FOM clears={d.fom_revenue_clears}\n")
    hdr = f"{'scale(TPD)':>9} {'model':>13} {'netCapex(cr)':>12} {'projIRR':>8} {'eqIRR':>8} {'NPV(cr)':>9} {'minDSCR':>8} {'payback':>8} {'dungOK':>7}"
    print(hdr); print("-" * len(hdr))
    for scale in SCALES_TPD_CBG:
        for model in MODELS:
            r = project_financials(scale, model, d)
            dscr_s = f"{r['min_dscr']:.2f}" if r['min_dscr'] else "n/a"
            pay_s = (str(r['payback']) + "y") if r['payback'] else ">15y"
            dung_s = "Y" if r['mb']['dung_feasible'] else "NO"
            print(f"{scale:>9} {model:>13} {cr(r['cx']['net']):>12} {pct(r['proj_irr']):>8} "
                  f"{pct(r['eq_irr']):>8} {cr(r['npv']):>9} {dscr_s:>8} {pay_s:>8} {dung_s:>7}")
    # dung-availability detail at 5 TPD (the headline infeasibility)
    print("\nDung-availability constraint (default 50% dung mix):")
    for scale in SCALES_TPD_CBG:
        mb = mass_energy_balance(scale, d)
        print(f"  {scale:>4} TPD CBG → {mb['feedstock_tpd']:7.0f} t feed/day, "
              f"{mb['dung_tpd']:6.0f} t dung/day → {mb['animals_required']:,.0f} cattle needed "
              f"(in radius: {mb['animals_available_in_radius']:,.0f}) "
              f"{'FEASIBLE' if mb['dung_feasible'] else '*** INFEASIBLE ***'}")

# ---------------------------------------------------------------------------
# SHIP self-test: unit chain, mass balance, caps, propagation
# ---------------------------------------------------------------------------
def selftest():
    d = Drivers()
    ok = True
    mb = mass_energy_balance(5.0, d)
    print(f"[unit-chain] dung CBG via biogas path = {mb['dung_recon_kg_per_t']:.2f} kg/t "
          f"(planning 15) → {'OK' if mb['unit_chain_ok'] else 'FAIL'}")
    ok &= mb["unit_chain_ok"]
    print(f"[mass-balance] feed {mb['feedstock_tpd']:.1f} t/d > CBG {mb['cbg_nameplate_kgday']/1000:.2f} t/d "
          f"and FOM {mb['fom_tpd']:.1f} t/d → {'OK' if mb['feedstock_tpd']>mb['fom_tpd'] else 'FAIL'}")

    # propagation 1: feedstock +40% must LOWER project IRR
    base = project_financials(5.0, "M1_injection", d)
    d_feed = copy.deepcopy(d); FEEDSTOCKS["dung"]["price_rs_per_t"] *= 1.4
    hi = project_financials(5.0, "M1_injection", d_feed)
    FEEDSTOCKS["dung"]["price_rs_per_t"] /= 1.4  # restore
    moved = (hi["npv"] < base["npv"])
    print(f"[propagation D1] dung +40% → NPV {cr(base['npv'])}→{cr(hi['npv'])} cr "
          f"(must fall) → {'OK' if moved else 'FAIL'}"); ok &= moved

    # propagation 2: PLF down must LOWER NPV AND raise unit opex (fixed cost spread)
    d_lo = replace(d, plf=0.30)
    lo = project_financials(5.0, "M1_injection", d_lo)
    f_base = annual_flows(5.0, "M1_injection", d, base["mb"], base["cx"], d.plf)
    f_lo = annual_flows(5.0, "M1_injection", d_lo, lo["mb"], lo["cx"], d_lo.plf)
    unit_base = f_base["opex"] / f_base["cbg_kg_yr"]; unit_lo = f_lo["opex"] / f_lo["cbg_kg_yr"]
    coup = (lo["npv"] < base["npv"]) and (unit_lo > unit_base)
    print(f"[propagation D6] PLF 0.5→0.3: NPV {cr(base['npv'])}→{cr(lo['npv'])} cr, "
          f"unit opex ₹{unit_base:.1f}→₹{unit_lo:.1f}/kg (must rise) → {'OK' if coup else 'FAIL'}"); ok &= coup

    # propagation 3: FOM→0 must LOWER NPV
    d_nofom = replace(d, fom_revenue_clears=False)
    nf = project_financials(5.0, "M1_injection", d_nofom)
    print(f"[propagation D8] FOM→0 → NPV {cr(base['npv'])}→{cr(nf['npv'])} cr (must fall) "
          f"→ {'OK' if nf['npv']<base['npv'] else 'FAIL'}"); ok &= (nf["npv"] < base["npv"])

    print(f"\nSELFTEST {'PASSED' if ok else 'FAILED'}")
    return ok

if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(0 if selftest() else 1)
    run_table()

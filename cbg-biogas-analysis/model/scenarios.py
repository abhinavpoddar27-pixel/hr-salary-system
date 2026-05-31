"""
scenarios.py — Tailwind / Base / Stress named scenarios, tornado sensitivity,
Monte-Carlo IRR (P10/P50/P90), and the dung×CBG-price breakeven frontier.
Reference case: M1 (SATAT injection) @ 5 TPD CBG — the canonical SATAT target scale.
Run:  python3 scenarios.py
"""
from __future__ import annotations
import random
from dataclasses import replace
from drivers import Drivers
from cbg_model import project_financials, pct, cr

REF_SCALE = 5.0
REF_MODEL = "M1_injection"

# ---------------------------------------------------------------------------
# Named scenarios (override base drivers)
# ---------------------------------------------------------------------------
def scenario_drivers():
    base = Drivers()  # PLF 0.50, dung ₹1250, FOM ₹1250 clears, CBG ₹77, no DPI
    tailwind = replace(base, plf=0.70, include_dpi_subsidy=True, fom_price_rs_per_t=1500.0,
                       cbg_price_rs_per_kg_M1=85.0, feedstock_price_multiplier=0.85)  # dung eases to ~₹1060
    stress = replace(base, plf=0.45, fom_revenue_clears=False, cbg_price_rs_per_kg_M1=70.0,
                     feedstock_price_multiplier=1.40)  # feedstock +40%, zero FOM, OMC-gap price haircut
    return {"Tailwind": tailwind, "Base": base, "Stress": stress}

def run_scenarios(scale=REF_SCALE, model=REF_MODEL):
    out = {}
    for name, d in scenario_drivers().items():
        r = project_financials(scale, model, d)
        out[name] = r
    return out

# ---------------------------------------------------------------------------
# Tornado: swing each driver low/high, measure equity-IRR & NPV impact
# ---------------------------------------------------------------------------
TORNADO_SPEC = {
    # driver-label : (apply_low, apply_high)  where each maps base Drivers -> Drivers
    "Dung/feed price (+/-40%)": (lambda d: replace(d, feedstock_price_multiplier=0.6),
                                 lambda d: replace(d, feedstock_price_multiplier=1.4)),
    "CBG price ₹65-90/kg":      (lambda d: replace(d, cbg_price_rs_per_kg_M1=65.0),
                                 lambda d: replace(d, cbg_price_rs_per_kg_M1=90.0)),
    "PLF 0.35-0.70":            (lambda d: replace(d, plf=0.35),
                                 lambda d: replace(d, plf=0.70)),
    "Capex ₹40k-55k/kgday":     (lambda d: replace(d, capex_intensity_rs_per_kgday=40000.0),
                                 lambda d: replace(d, capex_intensity_rs_per_kgday=55000.0)),
    "FOM ₹0-1500/t":            (lambda d: replace(d, fom_revenue_clears=False),
                                 lambda d: replace(d, fom_price_rs_per_t=1500.0)),
    "Subsidy 20-35% / DPI":     (lambda d: replace(d, subsidy_cap_pct_of_gross=0.20),
                                 lambda d: replace(d, subsidy_cap_pct_of_gross=0.35, include_dpi_subsidy=True)),
    "Cost of debt 9-13%":       (lambda d: replace(d, cost_of_debt=0.09),
                                 lambda d: replace(d, cost_of_debt=0.13)),
}

def tornado(scale=REF_SCALE, model=REF_MODEL):
    base = Drivers()
    base_irr = project_financials(scale, model, base)["eq_irr"] or -0.99
    rows = []
    for label, (lo_f, hi_f) in TORNADO_SPEC.items():
        lo = project_financials(scale, model, lo_f(base))["eq_irr"]
        hi = project_financials(scale, model, hi_f(base))["eq_irr"]
        lo = -0.99 if lo is None else lo
        hi = -0.99 if hi is None else hi
        rows.append((label, lo, hi, abs(hi - lo)))
    rows.sort(key=lambda x: x[3], reverse=True)  # widest swing first
    return base_irr, rows

# ---------------------------------------------------------------------------
# Monte-Carlo on the top drivers → P10/P50/P90 equity IRR
# ---------------------------------------------------------------------------
def _tri(lo, mode, hi):
    return random.triangular(lo, hi, mode)

def monte_carlo(n=5000, scale=REF_SCALE, model=REF_MODEL, seed=42):
    random.seed(seed)
    base = Drivers()
    irrs = []
    for _ in range(n):
        d = replace(
            base,
            feedstock_price_multiplier=_tri(0.8, 1.0, 1.6),   # dung ₹1000-2000 around ₹1250
            cbg_price_rs_per_kg_M1=_tri(65, 77, 88),
            plf=_tri(0.35, 0.52, 0.70),
            capex_intensity_rs_per_kgday=_tri(40000, 45000, 56000),
            fom_revenue_clears=(random.random() < 0.5),       # FOM clears ~half the time
        )
        r = project_financials(scale, model, d)
        irr = r["eq_irr"]
        irrs.append(-0.99 if irr is None else irr)
    irrs.sort()
    def p(q): return irrs[int(q * (len(irrs) - 1))]
    wacc = base.wacc
    return dict(
        p10=p(0.10), p50=p(0.50), p90=p(0.90),
        prob_gt_wacc=sum(1 for x in irrs if x > wacc) / len(irrs),
        prob_gt_20=sum(1 for x in irrs if x > 0.20) / len(irrs),
        prob_negative=sum(1 for x in irrs if x < 0) / len(irrs),
        wacc=wacc, all=irrs,
    )

# ---------------------------------------------------------------------------
# Breakeven frontier: grid of dung price × CBG price → project IRR (vs WACC)
# ---------------------------------------------------------------------------
def frontier(scale=REF_SCALE, model=REF_MODEL, dung_lo=800, dung_hi=2600, cbg_lo=55, cbg_hi=95, steps=18):
    base = Drivers()
    dungs = [dung_lo + (dung_hi - dung_lo) * i / (steps - 1) for i in range(steps)]
    cbgs = [cbg_lo + (cbg_hi - cbg_lo) * j / (steps - 1) for j in range(steps)]
    grid = []  # grid[j][i] = project IRR at cbg j, dung i
    for cb in cbgs:
        row = []
        for dg in dungs:
            r = project_financials(scale, model, base, dung_price_override=dg, cbg_price_override=cb)
            irr = r["proj_irr"]
            row.append(-0.5 if irr is None else irr)
        grid.append(row)
    return dungs, cbgs, grid, base.wacc

# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print(f"=== SCENARIOS (M1 injection @ {REF_SCALE} TPD) ===")
    for name, r in run_scenarios().items():
        print(f"  {name:>9}: projIRR {pct(r['proj_irr']):>7} | eqIRR {pct(r['eq_irr']):>7} | "
              f"NPV {cr(r['npv']):>7} cr | minDSCR {r['min_dscr']:.2f}" if r['min_dscr'] else
              f"  {name:>9}: projIRR {pct(r['proj_irr'])} eqIRR {pct(r['eq_irr'])} NPV {cr(r['npv'])} cr")

    print("\n=== TORNADO (equity IRR swing, widest first) ===")
    base_irr, rows = tornado()
    print(f"  base equity IRR = {pct(base_irr)}")
    for label, lo, hi, swing in rows:
        print(f"  {label:>26}: {pct(lo):>7} … {pct(hi):>7}  (swing {swing*100:5.1f} pts)")

    print("\n=== MONTE-CARLO (5,000 draws, equity IRR) ===")
    mc = monte_carlo()
    print(f"  P10 {pct(mc['p10'])} | P50 {pct(mc['p50'])} | P90 {pct(mc['p90'])}  (WACC {pct(mc['wacc'])})")
    print(f"  P(IRR>WACC)={mc['prob_gt_wacc']*100:.0f}%  P(IRR>20%)={mc['prob_gt_20']*100:.0f}%  "
          f"P(IRR<0)={mc['prob_negative']*100:.0f}%")

    print("\n=== BREAKEVEN FRONTIER (project IRR vs WACC) — corners ===")
    dungs, cbgs, grid, wacc = frontier()
    print(f"  WACC={pct(wacc)}. IRR at corners:")
    print(f"    dung ₹{dungs[0]:.0f}/CBG ₹{cbgs[-1]:.0f} (best): {pct(grid[-1][0])}")
    print(f"    dung ₹{dungs[-1]:.0f}/CBG ₹{cbgs[0]:.0f} (worst): {pct(grid[0][-1])}")

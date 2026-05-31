"""
charts.py — render the 4 decision charts to ../charts/*.png (matplotlib Agg, no display).
  1) tornado_irr.png         — equity-IRR swing per driver
  2) scenario_irr.png        — Tailwind/Base/Stress equity IRR vs hurdles
  3) montecarlo_irr.png       — equity-IRR distribution with P10/P50/P90, WACC, 20% hurdle
  4) breakeven_frontier.png   — project IRR over dung×CBG price, WACC contour
Run:  python3 charts.py
"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from drivers import Drivers
import scenarios as S

OUT = os.path.join(os.path.dirname(__file__), "..", "charts")
os.makedirs(OUT, exist_ok=True)
plt.rcParams.update({"figure.dpi": 130, "font.size": 9})

def chart_tornado():
    base_irr, rows = S.tornado()
    labels = [r[0] for r in rows][::-1]
    los = np.array([r[1] for r in rows][::-1]) * 100
    his = np.array([r[2] for r in rows][::-1]) * 100
    b = base_irr * 100
    fig, ax = plt.subplots(figsize=(8, 4.5))
    y = np.arange(len(labels))
    for i in range(len(labels)):
        left, right = min(los[i], his[i]), max(los[i], his[i])
        ax.barh(y[i], right - left, left=left, color="#4C78A8", alpha=.85, height=.62)
    ax.axvline(b, color="#E45756", lw=2, label=f"Base eq-IRR {b:.1f}%")
    ax.axvline(20, color="#54A24B", ls="--", lw=1.5, label="Reader hurdle 20%")
    ax.set_yticks(y); ax.set_yticklabels(labels)
    ax.set_xlabel("Equity IRR (%)"); ax.set_title("Tornado — equity-IRR sensitivity (M1 injection @ 5 TPD)")
    ax.legend(loc="lower right", fontsize=8); ax.grid(axis="x", alpha=.3)
    fig.tight_layout(); fig.savefig(os.path.join(OUT, "tornado_irr.png")); plt.close(fig)

def chart_scenarios():
    res = S.run_scenarios()
    names = ["Tailwind", "Base", "Stress"]
    eq = [(res[n]["eq_irr"] or -.99) * 100 for n in names]
    proj = [(res[n]["proj_irr"] or -.99) * 100 for n in names]
    fig, ax = plt.subplots(figsize=(7, 4.3))
    x = np.arange(len(names)); w = .35
    ax.bar(x - w/2, proj, w, label="Project IRR", color="#72B7B2")
    ax.bar(x + w/2, eq, w, label="Equity IRR", color="#4C78A8")
    ax.axhline(Drivers().wacc * 100, color="#E45756", ls=":", lw=1.5, label=f"WACC {Drivers().wacc*100:.1f}%")
    ax.axhline(20, color="#54A24B", ls="--", lw=1.5, label="Hurdle 20%")
    ax.axhline(0, color="k", lw=.8)
    ax.set_xticks(x); ax.set_xticklabels(names); ax.set_ylabel("IRR (%)")
    ax.set_title("Scenario IRR (M1 injection @ 5 TPD)")
    for xi, v in zip(x - w/2, proj): ax.text(xi, v + (1 if v>=0 else -3), f"{v:.0f}", ha="center", fontsize=8)
    for xi, v in zip(x + w/2, eq): ax.text(xi, v + (1 if v>=0 else -3), f"{v:.0f}", ha="center", fontsize=8)
    ax.legend(fontsize=8); ax.grid(axis="y", alpha=.3)
    fig.tight_layout(); fig.savefig(os.path.join(OUT, "scenario_irr.png")); plt.close(fig)

def chart_montecarlo():
    mc = S.monte_carlo()
    data = np.clip(np.array(mc["all"]) * 100, -60, 80)
    fig, ax = plt.subplots(figsize=(7.5, 4.3))
    ax.hist(data, bins=60, color="#9ECAE9", edgecolor="white")
    for q, c, lbl in [(mc["p10"], "#E45756", "P10"), (mc["p50"], "#4C78A8", "P50"), (mc["p90"], "#54A24B", "P90")]:
        ax.axvline(q*100, color=c, lw=2, label=f"{lbl} {q*100:.1f}%")
    ax.axvline(mc["wacc"]*100, color="k", ls=":", lw=1.5, label=f"WACC {mc['wacc']*100:.1f}%")
    ax.axvline(20, color="#54A24B", ls="--", lw=1.3, label="Hurdle 20%")
    ax.set_xlabel("Equity IRR (%)"); ax.set_ylabel("Frequency")
    ax.set_title(f"Monte-Carlo equity IRR (5,000 draws) — P(IRR>20%)={mc['prob_gt_20']*100:.0f}%, "
                 f"P(IRR<0)={mc['prob_negative']*100:.0f}%")
    ax.legend(fontsize=8); ax.grid(axis="y", alpha=.3)
    fig.tight_layout(); fig.savefig(os.path.join(OUT, "montecarlo_irr.png")); plt.close(fig)

def chart_frontier():
    dungs, cbgs, grid, wacc = S.frontier()
    Z = np.array(grid) * 100
    fig, ax = plt.subplots(figsize=(7.5, 4.6))
    im = ax.imshow(Z, origin="lower", aspect="auto", cmap="RdYlGn",
                   extent=[dungs[0], dungs[-1], cbgs[0], cbgs[-1]], vmin=-30, vmax=30)
    cs = ax.contour(np.array(dungs), np.array(cbgs), Z, levels=[wacc*100, 20],
                    colors=["black", "#222"], linestyles=["-", "--"], linewidths=1.6)
    ax.clabel(cs, fmt={wacc*100: f"WACC {wacc*100:.0f}%", 20.0: "20% hurdle"}, fontsize=8)
    ax.scatter([1250], [77], c="blue", s=40, zorder=5, label="Base (dung ₹1250, CBG ₹77)")
    ax.set_xlabel("Dung gate price (₹/tonne)"); ax.set_ylabel("CBG sale price (₹/kg)")
    ax.set_title("Breakeven frontier — project IRR over feedstock × CBG price (M1 @ 5 TPD)")
    fig.colorbar(im, ax=ax, label="Project IRR (%)"); ax.legend(loc="lower left", fontsize=8)
    fig.tight_layout(); fig.savefig(os.path.join(OUT, "breakeven_frontier.png")); plt.close(fig)

if __name__ == "__main__":
    chart_tornado(); chart_scenarios(); chart_montecarlo(); chart_frontier()
    print("charts written:", sorted(os.listdir(OUT)))

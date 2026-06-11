"""
OPTIQ DSS · Runner  (v3 — with out-of-sample testing)
=======================================================
Run the 6 optimization algorithms using the surrogate model
and any historical plant data as context.

Usage examples:
    # Standard run (uses last 6 rows from the training CSV)
    python runner.py

    # Out-of-sample test on a DIFFERENT date / CSV not used for training
    python runner.py --csv "C:/path/to/data_2023-04.csv"
    python runner.py --csv "C:/path/to/other_data.csv" --timestamp "2023-04-02 08:00"

    # Quick test with just 2 fast algorithms
    python runner.py --algorithms de bayesian

    # Stability analysis (3 random seeds each)
    python runner.py --seeds 3

    # No historical data (use default nominal values)
    python runner.py --no-history

    # Diagnose before running
    python runner.py --diagnose

Output:
    results/comparison.csv          full metrics table
    results/comparison.txt          printable table
    results/plots/pareto_fronts.png
    results/plots/convergence.png
    results/plots/setpoints_comparison.png
    results/plots/summary.png
"""
import os, sys, argparse
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))

from problem import (
    load_historical_context, get_current_historical_context,
    get_nominal_performance, SETPOINTS, NOMINALS, N_VAR,
    BOUNDS_LO, BOUNDS_HI, OptResult, run_diagnostics,
)
from evaluation import full_report, compare_table, stability_score


def run_all(
    algorithms:  list = None,
    n_seeds:     int  = 1,
    verbose:     bool = True,
    use_history: bool = True,
    csv_path:    str  = None,   # None → use problem.py's MBASE_CSV_PATH
    timestamp:   str  = None,   # e.g. "2023-04-02 08:00"
) -> list:

    if algorithms is None:
        algorithms = ['nsga2', 'pso', 'ga', 'de', 'bayesian', 'moead']

    # ── Load historical context ONCE, shared by all algorithms ───────────────
    hist = None
    if use_history:
        print("\n─── Loading historical process context ──────────────────────")
        hist = load_historical_context(csv_path=csv_path, timestamp=timestamp)
        if hist is None:
            print("  ⚠  No history loaded — using default nominal values.")
        print()

    # ── Nominal performance at that historical moment ─────────────────────────
    nom_e, nom_p = get_nominal_performance(hist)

    print("=" * 62)
    print("  DC4 Debutanizer — Setpoint Optimization Study")
    if csv_path:
        print(f"  CSV      : {os.path.basename(csv_path)}")
    if timestamp:
        print(f"  Moment   : {timestamp}")
    print("=" * 62)
    print(f"  Optimising {N_VAR} controller outputs (%):")
    for i, sp in enumerate(SETPOINTS):
        tag_short = sp['tag'].replace(' - Snapshot','')
        print(f"    [{i}] {tag_short:28s} [{sp['min']:.0f}–{sp['max']:.0f}%]  "
              f"nominal={sp['nominal']:.0f}%")
    print(f"\n  Baseline (nominal setpoints):")
    print(f"    Energy = {nom_e:.2f} kg/m³   Purity = {nom_p:.3f}%")
    print("=" * 62 + "\n")

    all_results = []
    seeds = list(range(42, 42 + n_seeds))

    for algo_name in algorithms:
        print(f"▶  {algo_name.upper()} ...")
        seed_results = []

        for seed in seeds:
            try:
                result = _run_one(algo_name, seed=seed,
                                  verbose=verbose and n_seeds == 1)
                seed_results.append(result)
                print(f"   seed={seed} → {result}")
            except ImportError as e:
                print(f"   SKIP {algo_name}: {e}")
                print(f"   Install: pip install pymoo deap optuna scipy")
                break
            except Exception as e:
                import traceback
                print(f"   ERROR {algo_name} seed={seed}: {e}")
                traceback.print_exc()

        if seed_results:
            all_results.append(seed_results[0])
            if len(seed_results) > 1:
                stab = stability_score(seed_results)
                print(f"   Stability: E_std={stab['energy_std']:.4f}  "
                      f"P_std={stab['purity_std']:.3f}")
        print()

    return all_results


def _run_one(algo_name: str, seed: int = 42, verbose: bool = False) -> OptResult:
    """Dispatch to the correct algorithm module."""
    # Historical context is already loaded into problem.py's global cache.
    # All evaluate() calls inside the algos will use it automatically.

    if algo_name == 'nsga2':
        from algorithms.algo_nsga2 import run
        return run(pop_size=50, n_gen=40, seed=seed, verbose=verbose)
    elif algo_name == 'pso':
        from algorithms.algo_pso import run
        return run(n_particles=30, n_iter=100, seed=seed, verbose=verbose)
    elif algo_name == 'ga':
        from algorithms.algo_ga import run
        return run(pop_size=100, n_gen=50, seed=seed, verbose=verbose)
    elif algo_name == 'de':
        from algorithms.algo_de import run
        return run(pop_size=15, max_iter=100, seed=seed, verbose=verbose)
    elif algo_name == 'bayesian':
        from algorithms.algo_bayesian import run
        return run(n_trials=150, seed=seed, verbose=verbose)
    elif algo_name == 'moead':
        from algorithms.algo_moead import run
        return run(pop_size=50, n_gen=40, seed=seed, verbose=verbose)
    else:
        raise ValueError(f"Unknown algorithm: {algo_name}")


def save_results(results: list, out_dir: str = 'results', label: str = ''):
    """Save comparison table, CSV, JSON and all plots."""
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(os.path.join(out_dir, 'plots'), exist_ok=True)

    reports = [full_report(r) for r in results]

    # ── Text table ────────────────────────────────────────────────────────────
    table    = compare_table(reports)
    txt_path = os.path.join(out_dir, 'comparison.txt')
    with open(txt_path, 'w', encoding='utf-8') as f:
        f.write(table)
    print("\n" + table)
    print(f"\n✓ Saved: {txt_path}")

    # ── CSV ───────────────────────────────────────────────────────────────────
    import csv
    csv_path = os.path.join(out_dir, 'comparison.csv')
    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=reports[0].keys())
        writer.writeheader(); writer.writerows(reports)
    print(f"✓ Saved: {csv_path}")

    # ── JSON ──────────────────────────────────────────────────────────────────
    import json
    json_path = os.path.join(out_dir, 'comparison.json')
    with open(json_path, 'w') as f:
        json.dump([r.summary() for r in results], f, indent=2, default=str)
    print(f"✓ Saved: {json_path}")

    # ── Plots ─────────────────────────────────────────────────────────────────
    try:
        _plot_pareto(results, out_dir)
        _plot_convergence(results, out_dir)
        _plot_setpoints(results, out_dir)
        _plot_summary(results, out_dir)
    except Exception as e:
        import traceback
        print(f"  Plot error: {e}"); traceback.print_exc()


def _plot_pareto(results, out_dir):
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    mo = [r for r in results if r.pareto_F is not None]
    if not mo:
        return

    fig, ax = plt.subplots(figsize=(10, 7))
    colors = ['#185FA5','#1D9E75','#BA7517','#A32D2D','#534AB7','#D85A30']

    for i, r in enumerate(mo):
        F = r.pareto_F
        ax.scatter(F[:,0], -F[:,1], s=30, alpha=0.55,
                   color=colors[i % len(colors)], label=r.algorithm)
        ax.scatter(r.best_energy, r.best_purity, s=150, marker='*',
                   color=colors[i % len(colors)],
                   edgecolors='black', lw=0.8, zorder=5)

    nom_e, nom_p = get_nominal_performance()
    ax.scatter(nom_e, nom_p, s=220, marker='X', color='red',
               zorder=6, label='Current operation')
    ax.annotate('Current\noperation', (nom_e, nom_p),
                textcoords='offset points', xytext=(10, 6),
                fontsize=9, color='red')
    ax.axhline(95.0, color='orange', ls='--', lw=1, alpha=0.7, label='Min purity 95%')

    ax.set_xlabel('Energy [kg steam / m³ butane]', fontsize=12)
    ax.set_ylabel('Purity [%]', fontsize=12)
    ax.set_title('Pareto Fronts — DC4 Debutanizer', fontsize=13, fontweight='bold')
    ax.legend(fontsize=9); ax.grid(alpha=0.3)
    plt.tight_layout()
    path = os.path.join(out_dir, 'plots', 'pareto_fronts.png')
    plt.savefig(path, dpi=150); plt.close()
    print(f"✓ Saved: {path}")


def _plot_convergence(results, out_dir):
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    with_conv = [r for r in results if r.convergence]
    if not with_conv: return

    fig, ax = plt.subplots(figsize=(10, 5))
    colors = ['#185FA5','#1D9E75','#BA7517','#A32D2D','#534AB7','#D85A30']

    for i, r in enumerate(with_conv):
        smooth = pd.Series(r.convergence).rolling(5, min_periods=1).mean().values
        ax.plot(smooth, label=r.algorithm[:22],
                color=colors[i % len(colors)], lw=1.8)

    ax.set_xlabel('Iteration / Trial', fontsize=11)
    ax.set_ylabel('Best objective (lower = better)', fontsize=11)
    ax.set_title('Convergence Curves', fontsize=12, fontweight='bold')
    ax.legend(fontsize=9); ax.grid(alpha=0.3)
    plt.tight_layout()
    path = os.path.join(out_dir, 'plots', 'convergence.png')
    plt.savefig(path, dpi=150); plt.close()
    print(f"✓ Saved: {path}")


def _plot_setpoints(results, out_dir):
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(1, N_VAR, figsize=(4 * N_VAR, 5))
    colors = ['#185FA5','#1D9E75','#BA7517','#A32D2D','#534AB7','#D85A30']
    labels = [r.algorithm[:14] for r in results]

    for j, (ax, sp) in enumerate(zip(axes, SETPOINTS)):
        vals = [r.best_setpoints[j] for r in results]
        bars = ax.bar(labels, vals,
                      color=[colors[i % len(colors)] for i in range(len(results))],
                      edgecolor='white', alpha=0.85)
        ax.axhline(sp['nominal'], color='red', ls='--', lw=1.5,
                   label=f"Nominal {sp['nominal']:.0f}%")
        tag_s = sp['tag'].replace(' - Snapshot','').replace('2','')
        ax.set_title(f"{tag_s}\n[{sp['min']:.0f}–{sp['max']:.0f}%]", fontsize=9)
        ax.set_ylabel('%', fontsize=9)
        ax.tick_params(axis='x', rotation=45, labelsize=7)
        ax.set_ylim(sp['min'] * 0.9, sp['max'] * 1.1)
        ax.legend(fontsize=7); ax.grid(axis='y', alpha=0.3)
        for bar, val in zip(bars, vals):
            ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.3,
                    f'{val:.1f}', ha='center', va='bottom', fontsize=7)

    plt.suptitle('Recommended Setpoints vs Nominal Operation',
                 fontsize=12, fontweight='bold', y=1.01)
    plt.tight_layout()
    path = os.path.join(out_dir, 'plots', 'setpoints_comparison.png')
    plt.savefig(path, dpi=150, bbox_inches='tight'); plt.close()
    print(f"✓ Saved: {path}")


def _plot_summary(results, out_dir):
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    nom_e, nom_p = get_nominal_performance()
    labels   = [r.algorithm[:18] for r in results]
    savings  = [(nom_e - r.best_energy) / nom_e * 100 for r in results]
    purities = [r.best_purity for r in results]
    runtimes = [r.runtime_s for r in results]

    fig, axes = plt.subplots(1, 3, figsize=(15, 5))
    fig.suptitle('Optimization Study Summary — DC4 Debutanizer',
                 fontsize=13, fontweight='bold')
    colors = ['#185FA5','#1D9E75','#BA7517','#A32D2D','#534AB7','#D85A30']
    bar_c  = [colors[i % len(colors)] for i in range(len(results))]

    # Energy savings
    axes[0].barh(labels, savings, color=bar_c, edgecolor='white')
    axes[0].axvline(0, color='gray', lw=0.8)
    axes[0].set_xlabel('Energy saving vs current operation (%)')
    axes[0].set_title('Energy savings')
    for i, v in enumerate(savings):
        axes[0].text(max(v,0)+0.2, i, f'{v:.1f}%', va='center', fontsize=9)
    axes[0].grid(axis='x', alpha=0.3)

    # Purity
    axes[1].barh(labels, purities, color=bar_c, edgecolor='white')
    axes[1].axvline(95.0, color='orange', ls='--', lw=1.5, label='Min 95%')
    axes[1].axvline(nom_p, color='red', ls='--', lw=1, label=f'Nominal {nom_p:.1f}%')
    axes[1].set_xlabel('Best purity achieved (%)')
    axes[1].set_title('Purity achieved')
    for i, v in enumerate(purities):
        axes[1].text(v+0.05, i, f'{v:.2f}%', va='center', fontsize=9)
    axes[1].legend(fontsize=8); axes[1].grid(axis='x', alpha=0.3)

    # Runtime
    axes[2].barh(labels, runtimes, color=bar_c, edgecolor='white')
    axes[2].set_xlabel('Runtime (seconds)')
    axes[2].set_title('Computation time')
    for i, v in enumerate(runtimes):
        axes[2].text(v+0.1, i, f'{v:.1f}s', va='center', fontsize=9)
    axes[2].grid(axis='x', alpha=0.3)

    plt.tight_layout()
    path = os.path.join(out_dir, 'plots', 'summary.png')
    plt.savefig(path, dpi=150, bbox_inches='tight'); plt.close()
    print(f"✓ Saved: {path}")


# ── CLI ───────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='DC4 Optimization Study Runner v3',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  python runner.py
  python runner.py --csv data/mbase/data_2023-04.csv
  python runner.py --csv data/mbase/data_2023-04.csv --timestamp "2023-04-02 08:00"
  python runner.py --algorithms de bayesian
  python runner.py --diagnose
        """,
    )
    parser.add_argument('--algorithms', nargs='+',
                        default=['nsga2','pso','ga','de','bayesian','moead'],
                        help='Algorithms to run (default: all 6)')
    parser.add_argument('--seeds',      type=int, default=1,
                        help='Number of random seeds for stability analysis')
    parser.add_argument('--verbose',    action='store_true')
    parser.add_argument('--no-history', action='store_true',
                        help='Skip loading historical CSV — use default nominal values')
    parser.add_argument('--csv',        type=str, default=None,
                        help='Path to a CSV file for historical context '
                             '(can be a DIFFERENT file than the training data)')
    parser.add_argument('--timestamp',  type=str, default=None,
                        help='Load 6 rows BEFORE this moment, e.g. "2023-04-02 08:00"')
    parser.add_argument('--out',        type=str, default='results',
                        help='Output directory (default: results/)')
    parser.add_argument('--diagnose',   action='store_true',
                        help='Run diagnostic only, then exit')
    args = parser.parse_args()

    if args.diagnose:
        run_diagnostics()
        sys.exit(0)

    results = run_all(
        algorithms  = args.algorithms,
        n_seeds     = args.seeds,
        verbose     = args.verbose,
        use_history = not args.no_history,
        csv_path    = args.csv,
        timestamp   = args.timestamp,
    )

    if results:
        save_results(results, out_dir=args.out)
        print("\n✓ Study complete.")
        print(f"  Plots → {args.out}/plots/")
        print(f"  Table → {args.out}/comparison.csv")

        # Print winner
        df = pd.DataFrame([r.summary() for r in results])
        nom_e, _ = get_nominal_performance()
        df['saving_%'] = (nom_e - df['best_energy']) / nom_e * 100
        best = df.loc[df['saving_%'].idxmax()]
        print(f"\n  Best algorithm : {best['algorithm']}")
        print(f"  Energy saving  : {best['saving_%']:.2f}%")
        print(f"  Best purity    : {best['best_purity_pct']:.2f}%")
    else:
        print("\n✗ No results. Install dependencies:")
        print("  pip install pymoo deap optuna scipy matplotlib")
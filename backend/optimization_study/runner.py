"""
OPTIQ DSS · Optimization Algorithm Study Runner
================================================
Runs all 6 algorithms, evaluates them on the DC4 debutanizer problem,
and generates a comparison table + Pareto front plots.

Usage:
    cd optimization_study
    python runner.py

    # Run only specific algorithms:
    python runner.py --algorithms nsga2 pso de

    # Run with multiple seeds for stability analysis:
    python runner.py --seeds 5

Output:
    results/comparison.csv     — full metrics table
    results/comparison.txt     — printable table
    results/plots/pareto_*.png — Pareto front plots
    results/plots/convergence.png
"""
import os
import sys
import time
import argparse
import numpy as np

# Add parent dir to path so we can import from backend if available
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from problem import get_nominal_performance, SETPOINTS, NOMINALS, OptResult
from evaluation import full_report, compare_table, stability_score


def run_all(
    algorithms: list = None,
    n_seeds:    int  = 1,
    verbose:    bool = True,
) -> list:

    if algorithms is None:
        algorithms = ['nsga2', 'pso', 'ga', 'de', 'bayesian', 'moead']

    nominal_e, nominal_p = get_nominal_performance()
    print(f"\n{'='*60}")
    print(f"DC4 Debutanizer Setpoint Optimization Study")
    print(f"{'='*60}")
    print(f"Nominal operation:")
    for i, sp in enumerate(SETPOINTS):
        print(f"  {sp['tag']:20s} = {NOMINALS[i]:.1f} {sp['unit']}")
    print(f"  Energy  = {nominal_e:.4f} kg steam/kg butane")
    print(f"  Purity  = {nominal_p:.2f} %")
    print(f"{'='*60}\n")

    all_results = []
    seeds = list(range(42, 42 + n_seeds))

    for algo_name in algorithms:
        print(f"▶  Running {algo_name.upper()}  (seeds: {seeds})")
        seed_results = []

        for seed in seeds:
            try:
                result = _run_one(algo_name, seed=seed, verbose=verbose and n_seeds == 1)
                seed_results.append(result)
                print(f"   seed={seed} → {result}")
            except ImportError as e:
                print(f"   SKIP {algo_name}: {e}")
                break
            except Exception as e:
                print(f"   ERROR {algo_name} seed={seed}: {e}")
                import traceback; traceback.print_exc()

        if seed_results:
            # Use seed=42 result as representative
            best_result = seed_results[0]
            all_results.append(best_result)

            if len(seed_results) > 1:
                stab = stability_score(seed_results)
                print(f"   Stability: E_std={stab['energy_std']:.5f}  P_std={stab['purity_std']:.3f}")

        print()

    return all_results


def _run_one(algo_name: str, seed: int = 42, verbose: bool = False) -> OptResult:
    """Dispatch to the correct algorithm module."""

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


def save_results(results: list, out_dir: str = 'results'):
    """Save comparison table and CSV."""
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(os.path.join(out_dir, 'plots'), exist_ok=True)

    reports = [full_report(r) for r in results]

    # ── Text table ────────────────────────────────────────────────────────────
    table = compare_table(reports)
    txt_path = os.path.join(out_dir, 'comparison.txt')
    with open(txt_path, 'w',encoding='utf-8') as f:
        f.write(table)
    print("\n" + table)
    print(f"\n✓ Saved: {txt_path}")

    # ── CSV ───────────────────────────────────────────────────────────────────
    try:
        import csv
        csv_path = os.path.join(out_dir, 'comparison.csv')
        with open(csv_path, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=reports[0].keys())
            writer.writeheader()
            writer.writerows(reports)
        print(f"✓ Saved: {csv_path}")
    except Exception as e:
        print(f"  CSV save failed: {e}")

    # ── Plots ─────────────────────────────────────────────────────────────────
    try:
        _plot_pareto(results, out_dir)
        _plot_convergence(results, out_dir)
        _plot_setpoints(results, out_dir)
    except Exception as e:
        print(f"  Plot generation failed (matplotlib may not be installed): {e}")


def _plot_pareto(results: list, out_dir: str):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    mo_results = [r for r in results if r.pareto_F is not None]
    if not mo_results:
        return

    fig, ax = plt.subplots(figsize=(9, 6))
    colors = ['#2196F3', '#FF9800', '#4CAF50', '#E91E63', '#9C27B0', '#00BCD4']

    for i, r in enumerate(mo_results):
        F = r.pareto_F
        # Plot energy vs purity (negate -purity back to purity)
        ax.scatter(
            F[:, 0], -F[:, 1],
            label=r.algorithm, alpha=0.7,
            color=colors[i % len(colors)], s=40,
        )
        # Mark the chosen balanced solution
        ax.scatter(
            r.best_energy, r.best_purity,
            color=colors[i % len(colors)], s=120,
            marker='*', edgecolors='black', linewidths=0.8, zorder=5,
        )

    ax.set_xlabel('Energy consumption (kg steam / kg butane)', fontsize=11)
    ax.set_ylabel('Butane purity (%)', fontsize=11)
    ax.set_title('Pareto Fronts — DC4 Debutanizer Setpoint Optimization', fontsize=12)
    ax.legend(fontsize=9)
    ax.grid(True, alpha=0.3)

    # Add nominal point
    nominal_e, nominal_p = get_nominal_performance()
    ax.scatter(nominal_e, nominal_p, color='red', marker='X', s=150,
               label='Nominal', zorder=6)
    ax.annotate('Nominal', (nominal_e, nominal_p),
                textcoords='offset points', xytext=(8, 4), fontsize=8, color='red')

    path = os.path.join(out_dir, 'plots', 'pareto_fronts.png')
    plt.tight_layout()
    plt.savefig(path, dpi=150)
    plt.close()
    print(f"✓ Saved: {path}")


def _plot_convergence(results: list, out_dir: str):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    results_with_conv = [r for r in results if r.convergence]
    if not results_with_conv:
        return

    fig, ax = plt.subplots(figsize=(9, 5))
    colors = ['#2196F3', '#FF9800', '#4CAF50', '#E91E63', '#9C27B0', '#00BCD4']

    for i, r in enumerate(results_with_conv):
        conv = r.convergence
        ax.plot(range(len(conv)), conv,
                label=r.algorithm, color=colors[i % len(colors)], linewidth=1.8)

    ax.set_xlabel('Iteration / Trial', fontsize=11)
    ax.set_ylabel('Best objective value (lower is better)', fontsize=11)
    ax.set_title('Convergence Curves — DC4 Optimization Study', fontsize=12)
    ax.legend(fontsize=9)
    ax.grid(True, alpha=0.3)

    path = os.path.join(out_dir, 'plots', 'convergence.png')
    plt.tight_layout()
    plt.savefig(path, dpi=150)
    plt.close()
    print(f"✓ Saved: {path}")


def _plot_setpoints(results: list, out_dir: str):
    """Bar chart comparing recommended setpoints from each algorithm."""
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(1, 3, figsize=(14, 5))
    labels    = [r.algorithm[:18] for r in results]
    colors    = ['#2196F3', '#FF9800', '#4CAF50', '#E91E63', '#9C27B0', '#00BCD4']

    for j, (ax, sp) in enumerate(zip(axes, SETPOINTS)):
        values = [r.best_setpoints[j] for r in results]
        bars   = ax.bar(labels, values,
                        color=[colors[i % len(colors)] for i in range(len(results))],
                        edgecolor='black', linewidth=0.5)
        ax.axhline(sp['nominal'], color='red', linestyle='--', linewidth=1.2, label='Nominal')
        ax.set_title(f"{sp['tag']}\n(nominal = {sp['nominal']} {sp['unit']})", fontsize=9)
        ax.set_ylabel(sp['unit'], fontsize=9)
        ax.tick_params(axis='x', rotation=45, labelsize=7)
        ax.legend(fontsize=8)
        ax.set_ylim(sp['min'] * 0.95, sp['max'] * 1.05)
        ax.grid(True, axis='y', alpha=0.3)

        # Add value labels on bars
        for bar, val in zip(bars, values):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.5,
                    f'{val:.1f}', ha='center', va='bottom', fontsize=7)

    plt.suptitle('Recommended Setpoints — All Algorithms', fontsize=12, y=1.01)
    path = os.path.join(out_dir, 'plots', 'setpoints_comparison.png')
    plt.tight_layout()
    plt.savefig(path, dpi=150, bbox_inches='tight')
    plt.close()
    print(f"✓ Saved: {path}")


# ── CLI ───────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='OPTIQ Optimization Study Runner')
    parser.add_argument('--algorithms', nargs='+',
                        default=['nsga2', 'pso', 'ga', 'de', 'bayesian', 'moead'],
                        help='Algorithms to run')
    parser.add_argument('--seeds', type=int, default=1,
                        help='Number of random seeds for stability analysis')
    parser.add_argument('--verbose', action='store_true',
                        help='Verbose output from each algorithm')
    args = parser.parse_args()

    results = run_all(
        algorithms = args.algorithms,
        n_seeds    = args.seeds,
        verbose    = args.verbose,
    )

    if results:
        save_results(results)
        print("\n✓ Study complete.")
        print("  Open results/plots/ to view Pareto fronts and convergence curves.")
        print("  Open results/comparison.csv to view the full metrics table.")
    else:
        print("\n✗ No results generated — check that dependencies are installed.")
        print("  pip install pymoo deap optuna scipy matplotlib")

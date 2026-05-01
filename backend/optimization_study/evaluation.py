"""
OPTIQ Optimization Study · Evaluation Metrics
==============================================
Computes all comparison metrics for the study.

Metrics:
  1. Best energy found          — main optimisation target
  2. Best purity found          — quality objective
  3. Energy savings vs nominal  — practical impact
  4. Runtime (seconds)          — computational cost
  5. n_evaluations              — model calls (cost of the algorithm)
  6. Hypervolume (HV)           — quality of Pareto front (MO algorithms)
  7. Stability (std over seeds) — reliability across random restarts
  8. Convergence speed          — how fast the algorithm reaches 95% of best value
"""
import numpy as np
from typing import List, Dict
from problem import OptResult, get_nominal_performance, SETPOINTS


def hypervolume(F: np.ndarray, ref_point: np.ndarray = None) -> float:
    """
    Compute hypervolume indicator for a 2D Pareto front.
    HV = area dominated by the front relative to a reference point.
    Higher HV = better Pareto front quality.

    F : (n, 2) array of objective values [energy, -purity]
    """
    if F is None or len(F) == 0:
        return 0.0

    if ref_point is None:
        # Reference point slightly worse than the worst solution
        ref_point = F.max(axis=0) * 1.1

    # Filter non-dominated solutions
    def is_dominated(p, others):
        return np.any(np.all(others <= p, axis=1) & np.any(others < p, axis=1))

    nd_mask = [not is_dominated(F[i], np.delete(F, i, axis=0)) for i in range(len(F))]
    nd_F    = F[nd_mask]

    if len(nd_F) == 0:
        return 0.0

    # Sort by first objective
    sorted_F = nd_F[nd_F[:, 0].argsort()]

    hv = 0.0
    prev_x = ref_point[0]
    for i in range(len(sorted_F) - 1, -1, -1):
        height = ref_point[1] - sorted_F[i, 1]
        width  = prev_x - sorted_F[i, 0]
        if height > 0 and width > 0:
            hv    += height * width
        prev_x = sorted_F[i, 0]

    return float(hv)


def convergence_speed(convergence: list, target_fraction: float = 0.95) -> int:
    """
    How many evaluations until the algorithm reaches target_fraction of its best value.
    Returns number of evaluations (lower = faster convergence).
    """
    if not convergence:
        return -1
    best    = min(convergence)
    target  = best + (1 - target_fraction) * (convergence[0] - best)
    for i, v in enumerate(convergence):
        if v <= target:
            return i
    return len(convergence)

# In your evaluation.py
def test_model_sensitivity():
    """Check if model responds to changes"""
    
    test_cases = [
        ([2500, 74, 94], "Low steam"),
        ([3500, 74, 94], "High steam"),
        ([3000, 68, 94], "Cold reflux"),
        ([3000, 80, 94], "Hot reflux"),
        ([3000, 74, 88], "Cold bottom"),
        ([3000, 74, 100], "Hot bottom"),
    ]
    
    results = []
    for sp, label in test_cases:
        e, p = evaluate(np.array(sp))
        results.append((label, e, p))
        print(f"{label:20s}: Steam={sp[0]:.0f}, Reflux={sp[1]:.0f}, Bottom={sp[2]:.0f} → E={e:.4f}, P={p:.2f}%")
    
    # Check variance
    energies = [r[1] for r in results]
    purities = [r[2] for r in results]
    
    print(f"\nEnergy range: {max(energies)-min(energies):.4f} (should be >0.3)")
    print(f"Purity range: {max(purities)-min(purities):.2f}% (should be >1.0%)")
    
    if max(purities)-min(purities) < 0.1:
        print("❌ CRITICAL: Purity is constant! Model is broken.")
    if max(energies)-min(energies) < 0.1:
        print("❌ CRITICAL: Energy is nearly constant! Model is broken.")
def stability_score(results: List[OptResult]) -> Dict[str, float]:
    """
    Run the same algorithm with multiple seeds, measure variance in results.
    Lower std = more stable algorithm.
    """
    energies = [r.best_energy for r in results]
    purities = [r.best_purity for r in results]
    return {
        'energy_mean':    float(np.mean(energies)),
        'energy_std':     float(np.std(energies)),
        'purity_mean':    float(np.mean(purities)),
        'purity_std':     float(np.std(purities)),
        'cv_energy':      float(np.std(energies) / (np.mean(energies) + 1e-9)),  # coefficient of variation
    }


def full_report(result: OptResult) -> Dict:
    """Generate a complete metrics report for one algorithm run."""
    nominal_e, nominal_p = get_nominal_performance()

    report = {
        'algorithm':             result.algorithm,
        'seed':                  result.seed,
        # ── Setpoints ───────────────────────────────────────────────────────
        'steam_kg_h':            round(float(result.best_setpoints[0]), 1),
        'reflux_temp_C':         round(float(result.best_setpoints[1]), 2),
        'bottom_temp_C':         round(float(result.best_setpoints[2]), 2),
        # ── Performance ─────────────────────────────────────────────────────
        'nominal_energy':        round(nominal_e, 4),
        'best_energy':           round(result.best_energy, 4),
        'nominal_purity':        round(nominal_p, 2),
        'best_purity':           round(result.best_purity, 2),
        'energy_savings_pct':    round(result.energy_savings_pct, 2),
        'purity_improvement_pct': round(result.purity_improvement_pct, 3),
        # ── Cost ────────────────────────────────────────────────────────────
        'runtime_s':             round(result.runtime_s, 2),
        'n_evaluations':         result.n_evaluations,
        'evals_per_second':      round(result.n_evaluations / (result.runtime_s + 1e-9), 1),
        # ── Multi-objective quality ──────────────────────────────────────────
        'pareto_solutions':      len(result.pareto_F) if result.pareto_F is not None else 1,
        'hypervolume':           round(
            hypervolume(result.pareto_F) if result.pareto_F is not None else 0.0, 4
        ),
        # ── Convergence ─────────────────────────────────────────────────────
        'convergence_speed_iters': convergence_speed(result.convergence),
    }
    return report


def compare_table(reports: List[Dict]) -> str:
    """Generate a pretty comparison table."""
    if not reports:
        return "No results"

    headers = [
        'Algorithm', 'E_best', 'P_best%', 'E_save%', 'P_improv%',
        'Time(s)', 'Evals', 'Pareto', 'HV',
    ]
    col_w = [28, 8, 8, 8, 10, 8, 6, 7, 8]

    def row(vals):
        return ' | '.join(str(v).ljust(w) for v, w in zip(vals, col_w))

    sep  = '-+-'.join('-' * w for w in col_w)
    lines = [row(headers), sep]

    for r in reports:
        lines.append(row([
            r['algorithm'][:28],
            r['best_energy'],
            r['best_purity'],
            r['energy_savings_pct'],
            r['purity_improvement_pct'],
            r['runtime_s'],
            r['n_evaluations'],
            r['pareto_solutions'],
            r['hypervolume'],
        ]))

    # Highlight best in each column
    lines.append(sep)
    best_e   = min(reports, key=lambda x: x['best_energy'])
    best_p   = max(reports, key=lambda x: x['best_purity'])
    best_hv  = max(reports, key=lambda x: x['hypervolume'])
    fastest  = min(reports, key=lambda x: x['runtime_s'])
    lines.append(f"Best energy  → {best_e['algorithm']}")
    lines.append(f"Best purity  → {best_p['algorithm']}")
    lines.append(f"Best HV      → {best_hv['algorithm']}")
    lines.append(f"Fastest      → {fastest['algorithm']}")

    return '\n'.join(lines)

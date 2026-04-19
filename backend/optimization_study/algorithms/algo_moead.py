"""
OPTIQ Optimization Study · Algorithm 6: MOEA/D
===============================================
Type            : Multi-objective decomposition-based evolutionary algorithm
Library         : pymoo

Key concepts:
  Decomposition : The 2-objective problem is split into N scalar subproblems
                  Each subproblem has a weight vector λ = [w1, w2]
                  where w1 + w2 = 1 (controls energy/purity trade-off emphasis)
  Neighbourhood : Each subproblem cooperates with its T nearest neighbours
                  (measured by distance between weight vectors)
  Tchebycheff   : Fitness for subproblem i = max(w1*|E - z1*|, w2*|P - z2*|)
                  where z* is the ideal (best) point seen so far
  Update        : A new solution replaces a neighbour only if it improves that
                  neighbour's subproblem — targeted, cooperative improvement

Intuition: Instead of evolving everyone together (NSGA-II), MOEA/D says:
"Let's split the trade-off space into zones and specialise. Zone 1 optimises
mostly for energy, zone 10 mostly for purity, zones 2-9 are in between.
Neighbours share information — a solution good for energy might help
its nearest zone (slightly less energy-focused)."

Advantage over NSGA-II: Often better at covering complex-shaped Pareto fronts.
When to choose : When you want a well-distributed set of trade-off solutions,
                 or when NSGA-II gives uneven coverage of the Pareto front.
"""
import time
import numpy as np
from problem import BOUNDS_LO, BOUNDS_HI, N_VAR, evaluate, OptResult


def run(
    pop_size:    int  = 50,
    n_gen:       int  = 40,
    n_neighbors: int  = 15,
    seed:        int  = 42,
    base_readings: list = None,
    verbose:     bool = False,
) -> OptResult:

    try:
        from pymoo.algorithms.moo.moead import MOEAD, Tchebycheff
        from pymoo.core.problem import Problem
        from pymoo.optimize import minimize as pymoo_minimize
        from pymoo.termination import get_termination
        from pymoo.util.ref_dirs import get_reference_directions
    except ImportError:
        raise ImportError("Install pymoo:  pip install pymoo")

    eval_count = [0]

    class _Problem(Problem):
        def __init__(self):
            super().__init__(
                n_var=N_VAR, n_obj=2, n_ieq_constr=0,
                xl=BOUNDS_LO, xu=BOUNDS_HI,
            )
        def _evaluate(self, x, out, *args, **kwargs):
            f1, f2 = [], []
            for sp in x:
                e, p = evaluate(np.array(sp), base_readings)
                f1.append(e)
                f2.append(-p)
                eval_count[0] += 1
            out['F'] = np.column_stack([f1, f2])

    # Generate weight vectors (reference directions) for 2 objectives
    ref_dirs = get_reference_directions('uniform', 2, n_partitions=pop_size - 1)

    t0 = time.perf_counter()

    res = pymoo_minimize(
        _Problem(),
        MOEAD(
            ref_dirs     = ref_dirs,
            n_neighbors  = n_neighbors,
            decomposition = Tchebycheff(),   # fixed
            prob_neighbor_mating = 0.7,
        ),
        get_termination("n_gen", n_gen),
        seed    = seed,
        verbose = verbose,
    )

    runtime = time.perf_counter() - t0

    F = res.F
    X = res.X

    # Best balanced solution
    F_norm   = (F - F.min(0)) / (F.max(0) - F.min(0) + 1e-9)
    best_idx = int(np.argmin(np.linalg.norm(F_norm, axis=1)))

    return OptResult(
        algorithm      = 'MOEA/D (Tchebycheff)',
        best_setpoints = X[best_idx],
        best_energy    = float(F[best_idx, 0]),
        best_purity    = float(-F[best_idx, 1]),
        runtime_s      = runtime,
        n_evaluations  = eval_count[0],
        pareto_F       = F,
        pareto_X       = X,
        seed           = seed,
    )


if __name__ == '__main__':
    print("Running MOEA/D standalone...")
    r = run(pop_size=50, n_gen=40, verbose=True)
    print(r)
    print("Pareto solutions:", len(r.pareto_F))
    from problem import SETPOINTS
    for i, sp in enumerate(SETPOINTS):
        print(f"  {sp['tag']:20s} = {r.best_setpoints[i]:.2f} {sp['unit']}")

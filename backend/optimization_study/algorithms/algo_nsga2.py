"""
OPTIQ Optimization Study · Algorithm 1: NSGA-II
================================================
Type            : Multi-objective evolutionary algorithm
Library         : pymoo
pip install       pymoo

Key concepts:
  Population    : N candidate setpoint triplets, evolved over generations
  Fitness       : (energy, -purity) — 2 objectives evaluated simultaneously
  Selection     : Non-dominated sorting + crowding distance
  Output        : Full Pareto front (trade-off curve between energy and purity)

When to choose : When you want to show operators all trade-off options,
                 not just one answer. Strong theoretical guarantees.
"""
import time
import numpy as np
from problem import BOUNDS_LO, BOUNDS_HI, N_VAR, evaluate, NOMINALS, OptResult


def run(
    pop_size:    int  = 50,
    n_gen:       int  = 40,
    seed:        int  = 42,
    base_readings: list = None,
    verbose:     bool = False,
) -> OptResult:

    try:
        from pymoo.algorithms.moo.nsga2 import NSGA2
        from pymoo.core.problem import Problem
        from pymoo.optimize import minimize as pymoo_minimize
        from pymoo.operators.crossover.sbx import SBX
        from pymoo.operators.mutation.pm import PM
        from pymoo.termination import get_termination
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

    t0 = time.perf_counter()

    res = pymoo_minimize(
        _Problem(),
        NSGA2(
            pop_size=pop_size,
            crossover=SBX(prob=0.9, eta=15),
            mutation=PM(eta=20),
            eliminate_duplicates=True,
        ),
        get_termination("n_gen", n_gen),
        seed=seed,
        verbose=verbose,
    )

    runtime = time.perf_counter() - t0

    F = res.F   # (n, 2)
    X = res.X   # (n, 3)

    # Best balanced solution: closest to ideal point on normalised front
    F_norm   = (F - F.min(0)) / (F.max(0) - F.min(0) + 1e-9)
    best_idx = int(np.argmin(np.linalg.norm(F_norm, axis=1)))

    return OptResult(
        algorithm      = 'NSGA-II',
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
    print("Running NSGA-II standalone...")
    r = run(pop_size=50, n_gen=40, verbose=True)
    print(r)
    print("Pareto front size:", len(r.pareto_F))
    print("Best setpoints:")
    from problem import SETPOINTS
    for i, sp in enumerate(SETPOINTS):
        print(f"  {sp['tag']:20s} = {r.best_setpoints[i]:.2f} {sp['unit']}")

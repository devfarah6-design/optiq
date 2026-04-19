"""
OPTIQ Optimization Study · Algorithm 4: Differential Evolution (DE)
====================================================================
Type            : Single-objective evolutionary algorithm
Library         : scipy (built-in, no extra install)

Key concepts:
  Population    : N candidate setpoint triplets
  Mutation      : For each x, create mutant: m = a + F*(b - c)
                  where a, b, c are random distinct members of population
                  F (mutation factor) controls step size — typically 0.5–1.0
  Crossover     : Trial vector takes genes from mutant OR original:
                  if rand() < CR → take from mutant, else keep from original
                  CR (crossover rate) controls how many genes come from mutant
  Selection     : Greedy — keep trial if better fitness than original (no luck)
  Strategy      : 'best1bin' = mutate from best individual (exploitative)
                  'rand1bin' = mutate from random individual (more exploratory)

Intuition: Very simple. No complex selection, no ranks, no crowding.
Pure survival of fittest with clever mutation strategy.
Consistently one of the most reliable single-objective algorithms.

When to choose : Fast, reliable, minimal tuning. Good benchmark reference.
                 Works well on this problem because bounds are well-defined.
"""
import time
import numpy as np
from scipy.optimize import differential_evolution
from problem import BOUNDS_LO, BOUNDS_HI, N_VAR, scalar_objective, evaluate, OptResult


def run(
    pop_size:   int   = 15,    # population = pop_size * N_VAR individuals
    max_iter:   int   = 100,
    F:          float = 0.8,   # mutation factor [0.5, 1.0]
    CR:         float = 0.9,   # crossover rate [0.7, 1.0]
    strategy:   str   = 'best1bin',
    w_energy:   float = 0.6,
    w_purity:   float = 0.4,
    tol:        float = 1e-6,
    seed:       int   = 42,
    base_readings: list = None,
    verbose:    bool  = False,
) -> OptResult:

    eval_count = [0]
    convergence = []

    def objective(sp):
        val = scalar_objective(np.array(sp), w_energy, w_purity, base_readings)
        eval_count[0] += 1
        return val

    def callback(xk, convergence_val):
        e, p = evaluate(np.array(xk), base_readings)
        convergence.append(float(0.6 * e - 0.4 * p / 100))
        if verbose:
            print(f"  DE callback | E={e:.4f}  P={p:.2f}%")

    bounds = list(zip(BOUNDS_LO, BOUNDS_HI))

    t0 = time.perf_counter()

    result = differential_evolution(
        objective,
        bounds,
        strategy   = strategy,
        maxiter    = max_iter,
        popsize    = pop_size,
        mutation   = F,
        recombination = CR,
        tol        = tol,
        seed       = seed,
        callback   = callback if verbose else None,
        polish     = True,    # final local polish with L-BFGS-B
        disp       = verbose,
    )

    runtime = time.perf_counter() - t0

    best_sp = np.clip(np.array(result.x), BOUNDS_LO, BOUNDS_HI)
    best_e, best_p = evaluate(best_sp, base_readings)

    return OptResult(
        algorithm      = f'Differential Evolution ({strategy})',
        best_setpoints = best_sp,
        best_energy    = best_e,
        best_purity    = best_p,
        runtime_s      = runtime,
        n_evaluations  = eval_count[0],
        convergence    = convergence,
        seed           = seed,
    )


if __name__ == '__main__':
    print("Running Differential Evolution standalone...")
    r = run(max_iter=100, verbose=True)
    print(r)
    from problem import SETPOINTS
    for i, sp in enumerate(SETPOINTS):
        print(f"  {sp['tag']:20s} = {r.best_setpoints[i]:.2f} {sp['unit']}")

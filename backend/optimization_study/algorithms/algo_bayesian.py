"""
OPTIQ Optimization Study · Algorithm 5: Bayesian Optimization (Optuna)
=======================================================================
Type            : Sequential model-based, single-objective
Library         : Optuna
pip install       optuna

Key concepts:
  Surrogate     : A cheap probabilistic model (TPE in Optuna) that approximates
                  the expensive fitness landscape from past evaluations
  Acquisition   : Expected Improvement (EI) — balances exploitation of known good
                  regions vs exploration of uncertain regions
  Sequential    : One trial at a time (not population-based)
  Data-efficient: Finds good solutions with FEWER model evaluations than GA/PSO/DE

How it works step by step:
  1. Run a few random trials to initialize the surrogate
  2. Fit TPE (Tree-structured Parzen Estimator) to past results
  3. Use acquisition function to pick the most promising next point
  4. Evaluate the objective at that point
  5. Update the surrogate with the new data point
  6. Repeat from step 2

Intuition: Instead of blindly exploring like GA/PSO, Bayesian builds a map of
"where good solutions probably are" and probes those regions intelligently.

When to choose : When model evaluation is slow (>1 second per call).
                 With 100 trials it often matches DE/GA using 500+ trials.
                 Also great for hyperparameter tuning.
"""
import time
import logging
import numpy as np
from problem import BOUNDS_LO, BOUNDS_HI, N_VAR, SETPOINTS, scalar_objective, evaluate, OptResult

# Suppress Optuna's verbose logging
logging.getLogger('optuna').setLevel(logging.WARNING)


def run(
    n_trials:   int   = 150,
    w_energy:   float = 0.6,
    w_purity:   float = 0.4,
    seed:       int   = 42,
    base_readings: list = None,
    verbose:    bool  = False,
) -> OptResult:

    try:
        import optuna
        optuna.logging.set_verbosity(optuna.logging.WARNING)
    except ImportError:
        raise ImportError("Install Optuna:  pip install optuna")

    eval_count = [0]
    convergence = []
    best_so_far = [np.inf]

    def objective(trial):
        sp = np.array([
            trial.suggest_float(SETPOINTS[i]['tag'], float(BOUNDS_LO[i]), float(BOUNDS_HI[i]))
            for i in range(N_VAR)
        ])
        val = scalar_objective(sp, w_energy, w_purity, base_readings)
        eval_count[0] += 1

        if val < best_so_far[0]:
            best_so_far[0] = val
        convergence.append(float(best_so_far[0]))

        return val

    t0 = time.perf_counter()

    sampler = optuna.samplers.TPESampler(seed=seed)
    study   = optuna.create_study(direction='minimize', sampler=sampler)
    study.optimize(
        objective,
        n_trials    = n_trials,
        show_progress_bar = verbose,
    )

    runtime = time.perf_counter() - t0

    best_params = study.best_trial.params
    best_sp     = np.array([best_params[sp['tag']] for sp in SETPOINTS])
    best_sp     = np.clip(best_sp, BOUNDS_LO, BOUNDS_HI)
    best_e, best_p = evaluate(best_sp, base_readings)

    if verbose:
        print(f"\n  Bayesian Opt | {n_trials} trials | best value={study.best_value:.5f}")
        for sp, val in zip(SETPOINTS, best_sp):
            print(f"    {sp['tag']:20s} = {val:.2f} {sp['unit']}")

    return OptResult(
        algorithm      = f'Bayesian Opt (TPE, {n_trials} trials)',
        best_setpoints = best_sp,
        best_energy    = best_e,
        best_purity    = best_p,
        runtime_s      = runtime,
        n_evaluations  = eval_count[0],
        convergence    = convergence,
        seed           = seed,
    )


if __name__ == '__main__':
    print("Running Bayesian Optimization standalone...")
    r = run(n_trials=150, verbose=True)
    print(r)
    from problem import SETPOINTS
    for i, sp in enumerate(SETPOINTS):
        print(f"  {sp['tag']:20s} = {r.best_setpoints[i]:.2f} {sp['unit']}")

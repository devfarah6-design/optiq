"""
OPTIQ Optimization Study · Algorithm 3: Genetic Algorithm (DEAP)
=================================================================
Type            : Single-objective evolutionary algorithm
Library         : DEAP
pip install       deap

Key concepts:
  Chromosome    : One individual = [steam_flow, reflux_temp, bottom_temp]
  Gene          : Each setpoint value (real-valued encoding)
  Fitness       : Weighted sum: w_e * energy - w_p * (purity/100)
                  → minimising this = less energy + more purity
  Selection     : Tournament selection (best of k random candidates)
  Crossover     : Simulated Binary Crossover (SBX) — preserves bounds
  Mutation      : Polynomial mutation — small perturbations near current value
  Elitism       : Best individual always survives to next generation

Intuition: Evolution of candidate solutions. Bad solutions die, good ones
reproduce. Each generation the population gets better on average.
Much simpler than NSGA-II — produces one answer, not a Pareto front.

When to choose : You know the priority (e.g., energy more important than purity).
                 Adjust w_energy and w_purity to reflect your preference.
"""
import time
import numpy as np
from problem import BOUNDS_LO, BOUNDS_HI, N_VAR, scalar_objective, evaluate, OptResult


def run(
    pop_size:   int   = 100,
    n_gen:      int   = 50,
    w_energy:   float = 0.6,    # weight on energy (higher = energy more important)
    w_purity:   float = 0.4,    # weight on purity
    cx_prob:    float = 0.7,    # crossover probability
    mut_prob:   float = 0.2,    # mutation probability
    eta_cx:     float = 20.0,   # SBX distribution index
    eta_mut:    float = 20.0,   # polynomial mutation distribution index
    seed:       int   = 42,
    base_readings: list = None,
    verbose:    bool  = False,
) -> OptResult:

    try:
        from deap import base, creator, tools, algorithms
    except ImportError:
        raise ImportError("Install DEAP:  pip install deap")

    import random
    random.seed(seed)
    np.random.seed(seed)

    eval_count = [0]

    # ── DEAP setup ────────────────────────────────────────────────────────────
    # Minimisation problem (negative fitness = minimise)
    if not hasattr(creator, 'FitnessMin'):
        creator.create('FitnessMin', base.Fitness, weights=(-1.0,))
    if not hasattr(creator, 'Individual'):
        creator.create('Individual', list, fitness=creator.FitnessMin)

    toolbox = base.Toolbox()

    # Individual generator: random value in [lo, hi] per variable
    for i in range(N_VAR):
        toolbox.register(
            f'attr_{i}',
            random.uniform,
            float(BOUNDS_LO[i]),
            float(BOUNDS_HI[i]),
        )

    toolbox.register(
        'individual',
        tools.initCycle,
        creator.Individual,
        [getattr(toolbox, f'attr_{i}') for i in range(N_VAR)],
        n=1,
    )
    toolbox.register('population', tools.initRepeat, list, toolbox.individual)

    def evaluate_ind(individual):
        sp = np.clip(np.array(individual), BOUNDS_LO, BOUNDS_HI)
        obj = scalar_objective(sp, w_energy, w_purity, base_readings)
        eval_count[0] += 1
        return (obj,)

    toolbox.register('evaluate', evaluate_ind)
    toolbox.register('mate',   tools.cxSimulatedBinaryBounded,
                     low=BOUNDS_LO.tolist(), up=BOUNDS_HI.tolist(), eta=eta_cx)
    toolbox.register('mutate', tools.mutPolynomialBounded,
                     low=BOUNDS_LO.tolist(), up=BOUNDS_HI.tolist(),
                     eta=eta_mut, indpb=1.0/N_VAR)
    toolbox.register('select', tools.selTournament, tournsize=3)

    # ── Evolution ─────────────────────────────────────────────────────────────
    t0 = time.perf_counter()

    pop = toolbox.population(n=pop_size)

    # Evaluate initial population
    fitnesses = list(map(toolbox.evaluate, pop))
    for ind, fit in zip(pop, fitnesses):
        ind.fitness.values = fit

    hof        = tools.HallOfFame(1)   # tracks best individual ever
    stats      = tools.Statistics(lambda ind: ind.fitness.values)
    stats.register('min', np.min)

    convergence = []

    for gen in range(n_gen):
        offspring = algorithms.varAnd(pop, toolbox, cxpb=cx_prob, mutpb=mut_prob)
        fits      = list(map(toolbox.evaluate, offspring))
        for ind, fit in zip(offspring, fits):
            ind.fitness.values = fit

        pop = toolbox.select(offspring + pop, k=pop_size)
        hof.update(pop)

        best_fit = hof[0].fitness.values[0]
        convergence.append(float(best_fit))

        if verbose and gen % 10 == 0:
            print(f"  GA gen {gen:3d} | best_fitness={best_fit:.5f}")

    runtime = time.perf_counter() - t0

    best_sp = np.clip(np.array(hof[0]), BOUNDS_LO, BOUNDS_HI)
    best_e, best_p = evaluate(best_sp, base_readings)

    return OptResult(
        algorithm      = f'Genetic Algorithm (w_e={w_energy}, w_p={w_purity})',
        best_setpoints = best_sp,
        best_energy    = best_e,
        best_purity    = best_p,
        runtime_s      = runtime,
        n_evaluations  = eval_count[0],
        convergence    = convergence,
        seed           = seed,
    )


if __name__ == '__main__':
    print("Running Genetic Algorithm standalone...")
    r = run(pop_size=100, n_gen=50, verbose=True)
    print(r)
    from problem import SETPOINTS
    for i, sp in enumerate(SETPOINTS):
        print(f"  {sp['tag']:20s} = {r.best_setpoints[i]:.2f} {sp['unit']}")

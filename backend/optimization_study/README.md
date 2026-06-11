# OPTIQ DSS · Optimization Algorithm Study
## DC4 Butane Debutanizer — Setpoint Optimization

---

## Objective

Find the best values for 3 setpoints that simultaneously:
- **Minimise** steam energy consumption (`2FI422.SP`)
- **Maximise** butane product purity
- Stay within safe operating bounds

---

## How to run the study

```bash
# Install dependencies
pip install pymoo deap scikit-optimize optuna scipy numpy pandas matplotlib

# Run all algorithms and compare
cd optimization_study
python runner.py

# Results saved to: results/comparison.csv  +  results/plots/
```

---

## Folder structure

```
optimization_study/
│
├── README.md                  ← this file
├── runner.py                  ← runs all algorithms, generates comparison table
├── problem.py                 ← shared problem definition (bounds, model call)
├── evaluation.py              ← metrics: HV, IGD, time, stability
│
├── algorithms/
│   ├── algo_nsga2.py          ← NSGA-II        (multi-objective, genetic)
│   ├── algo_pso.py            ← PSO            (multi-objective, swarm)
│   ├── algo_ga.py             ← Genetic Algo   (single-objective, DEAP)
│   ├── algo_de.py             ← Differential Evolution  (scipy)
│   ├── algo_bayesian.py       ← Bayesian Opt   (Optuna / Gaussian process)
│   └── algo_moead.py          ← MOEA/D         (decomposition-based MO)
│
└── results/
    ├── comparison.csv         ← generated after running runner.py
    └── plots/                 ← Pareto front plots, convergence curves
```

---

## The 6 algorithms — how each works

### 1. NSGA-II (Non-dominated Sorting Genetic Algorithm II)
**Type:** Multi-objective evolutionary algorithm
**How it works:**
- Maintains a **population** of candidate setpoint combinations
- Each generation: crossover + mutation creates children
- Ranks solutions by **Pareto dominance** (not dominated by others)
- Uses **crowding distance** to keep diversity on the Pareto front
- Returns a full **Pareto front** (all trade-off solutions)

**Fitness function:** Directly the two objectives — `[energy, -purity]`
**Key parameters:** `pop_size=50`, `n_gen=40`
**Best for:** When you need a full trade-off curve to present to operators

---

### 2. PSO (Particle Swarm Optimization)
**Type:** Multi-objective swarm intelligence
**How it works:**
- Population = "particles", each with a position (setpoints) and velocity
- Each particle remembers its personal best and knows the global best
- At each step: `velocity = w*v + c1*(pbest-x) + c2*(gbest-x)`
- Multi-objective version (MOPSO) maintains an external archive of Pareto solutions
- Inspired by birds flocking or fish schooling

**Fitness function:** `[energy, -purity]` — both evaluated simultaneously
**Key parameters:** `n_particles=30`, `n_iter=100`, `w=0.7`, `c1=1.5`, `c2=1.5`
**Best for:** Continuous smooth landscapes — fast convergence

---

### 3. Genetic Algorithm (DEAP — single objective)
**Type:** Single-objective evolutionary algorithm
**How it works:**
- Population of candidate solutions (chromosomes = setpoints)
- **Fitness function** = weighted sum: `f = w1*energy - w2*purity`
- Selection → Crossover → Mutation → Replace worst
- Simpler than NSGA-II but requires choosing weights for objectives
- Good baseline to compare against multi-objective methods

**Fitness function:** `minimize: 0.6*energy - 0.4*(purity/100)`
**Key parameters:** `pop_size=100`, `n_gen=50`, `cxpb=0.7`, `mutpb=0.2`
**Best for:** When you already know the priority (e.g., energy is more important)

---

### 4. Differential Evolution (scipy)
**Type:** Evolutionary algorithm — population-based
**How it works:**
- For each candidate `x`, creates a mutant: `m = a + F*(b - c)` (random members)
- Crossover: trial vector takes some genes from `m`, rest from `x`
- Greedy selection: keep whichever has better fitness
- Very simple, very effective for continuous optimization
- No gradient needed — pure black-box

**Fitness function:** `minimize: 0.6*energy - 0.4*purity` (scalarised)
**Key parameters:** `strategy='best1bin'`, `F=0.8`, `CR=0.9`
**Best for:** Robust, reliable, low-overhead — good reference algorithm

---

### 5. Bayesian Optimization (Optuna)
**Type:** Sequential model-based optimization
**How it works:**
- Builds a **surrogate model** (Gaussian Process) of the fitness landscape
- Uses an **acquisition function** (Expected Improvement) to decide next point
- Very data-efficient: finds good solutions with few model evaluations
- Not population-based — sequential (one trial at a time)

**Fitness function:** `minimize: 0.6*energy - 0.4*purity`
**Key parameters:** `n_trials=100`, `sampler=TPESampler`
**Best for:** When each model evaluation is expensive (slow model)

---

### 6. MOEA/D (Multi-Objective Evolutionary Algorithm by Decomposition)
**Type:** Multi-objective decomposition-based
**How it works:**
- Decomposes multi-objective problem into N scalar subproblems
- Each subproblem has a **weight vector** (e.g., [0.3, 0.7] energy/purity)
- Evolves subproblems cooperatively — each solution updates neighbours
- Often outperforms NSGA-II on complex shapes of Pareto front

**Fitness function:** Tchebycheff decomposition: `max(w_i * |f_i - z_i*|)`
**Key parameters:** `pop_size=50`, `n_neighbors=15`, `n_gen=40`
**Best for:** When Pareto front has complex shape or many objectives

---

## Evaluation metrics

| Metric | What it measures | Better is |
|---|---|---|
| **Runtime (s)** | Total execution time | Lower |
| **Best energy (kg/kg)** | Best energy found | Lower |
| **Best purity (%)** | Best purity found | Higher |
| **HV (Hypervolume)** | Volume of Pareto front dominated — quality of trade-off set | Higher |
| **Energy savings (%)** | vs current nominal operation | Higher |
| **Stability** | Variance across 5 runs with different seeds | Lower |
| **n_evaluations** | Model calls needed | Lower |

---

## How to connect to the system

Once you identify the best algorithm from this study:

1. Copy the algorithm file to `backend/app/optimizer.py`
2. The `optimize()` function signature stays the same — no other changes needed
3. The system will automatically use the new algorithm on the next `/optimize` call

---

## Decision guide

```
Do you need a trade-off curve to show operators?
  YES → NSGA-II or MOEA/D
  NO  → Bayesian, DE, or GA (faster, single answer)

Is the model slow to evaluate (>1s)?
  YES → Bayesian Optimization (most data-efficient)
  NO  → NSGA-II, DE, PSO (all fine)

Do you know the priority between energy and purity?
  YES → GA or DE with fixed weights
  NO  → NSGA-II (let operator choose from Pareto front)

Do you want the algorithm to work online (adapting to live data)?
  Future → Consider MPC or Deep RL (not in this study)
```

"""
OPTIQ Optimization Study · Algorithm 2: PSO (Particle Swarm Optimization)
==========================================================================
Type            : Multi-objective swarm intelligence (MOPSO via pymoo)
Library         : pymoo

Key concepts:
  Particles     : Each particle = one setpoint triplet (position in search space)
  Velocity      : Direction and speed of movement toward better solutions
  pbest         : Each particle's personal best position ever found
  gbest         : Best position found by ANY particle in the swarm
  Update rule   : v(t+1) = w*v(t) + c1*rand*(pbest - x) + c2*rand*(gbest - x)
                  x(t+1) = x(t) + v(t+1)
  Archive       : External set of non-dominated solutions (Pareto front)
  Inertia w     : Controls exploration vs exploitation balance

Intuition: Imagine birds flocking to food. Each bird remembers where it found
the best food (pbest) and knows where the flock's best spot is (gbest).
They balance exploring new areas vs converging on known good spots.

When to choose : Fast convergence on smooth continuous landscapes.
                 Good when setpoints change gradually.
"""
import time
import numpy as np
from problem import BOUNDS_LO, BOUNDS_HI, N_VAR, evaluate, OptResult


def run(
    n_particles: int  = 30,
    n_iter:      int  = 100,
    w:           float = 0.7,    # inertia weight
    c1:          float = 1.5,    # cognitive (personal best) coefficient
    c2:          float = 1.5,    # social (global best) coefficient
    seed:        int  = 42,
    base_readings: list = None,
    verbose:     bool = False,
) -> OptResult:

    # ── Manual MOPSO implementation ───────────────────────────────────────────
    rng = np.random.default_rng(seed)
    eval_count = 0

    # Pareto archive helpers
    def dominates(a_f, b_f):
        """True if a dominates b (lower is better for both objectives)."""
        return (np.all(a_f <= b_f) and np.any(a_f < b_f))

    def update_archive(archive_X, archive_F, x, f):
        """Add (x, f) to archive if non-dominated, remove dominated solutions."""
        for i in range(len(archive_F) - 1, -1, -1):
            if dominates(archive_F[i], f):
                return archive_X, archive_F   # new solution dominated — reject
            if dominates(f, archive_F[i]):
                archive_X = np.delete(archive_X, i, axis=0)
                archive_F = np.delete(archive_F, i, axis=0)
        if len(archive_F) == 0:
            archive_X = x.reshape(1, -1)
            archive_F = f.reshape(1, -1)
        else:
            archive_X = np.vstack([archive_X, x])
            archive_F = np.vstack([archive_F, f])
        return archive_X, archive_F

    def pick_leader(archive_F):
        """
        Select a leader from archive using crowding distance.
        Handles edge cases (single point, all distances zero, all inf)
        and never returns NaN probabilities.
        """
        n = len(archive_F)
        if n == 1:
            return 0

        # Compute crowding distance
        dist = np.zeros(n)
        for obj in range(2):
            sorted_idx = np.argsort(archive_F[:, obj])
            # Extremes get infinite distance (always selected)
            dist[sorted_idx[0]] = np.inf
            dist[sorted_idx[-1]] = np.inf
            f_range = archive_F[sorted_idx[-1], obj] - archive_F[sorted_idx[0], obj] + 1e-9
            for i in range(1, n - 1):
                dist[sorted_idx[i]] += (
                    archive_F[sorted_idx[i+1], obj] - archive_F[sorted_idx[i-1], obj]
                ) / f_range

        # Separate finite and infinite distances
        finite_dist = dist[~np.isinf(dist)]
        # If all distances are zero (or all are infinite), fall back to uniform
        if len(finite_dist) == 0 or np.all(finite_dist == 0):
            probs = np.ones(n) / n
        else:
            # Replace inf with twice the maximum finite distance
            max_finite = np.max(finite_dist) if len(finite_dist) > 0 else 1.0
            dist[np.isinf(dist)] = max_finite * 2.0
            probs = dist / dist.sum()

        return rng.choice(n, p=probs)

    t0 = time.perf_counter()

    # ── Initialise swarm ──────────────────────────────────────────────────────
    pos = rng.uniform(BOUNDS_LO, BOUNDS_HI, size=(n_particles, N_VAR))
    vel = rng.uniform(-(BOUNDS_HI - BOUNDS_LO) * 0.1,
                       (BOUNDS_HI - BOUNDS_LO) * 0.1,
                       size=(n_particles, N_VAR))

    # Evaluate initial positions
    fitness = np.zeros((n_particles, 2))
    for i in range(n_particles):
        e, p = evaluate(pos[i], base_readings)
        fitness[i] = [e, -p]
        eval_count += 1

    pbest_pos = pos.copy()
    pbest_fit = fitness.copy()

    # Build initial archive
    archive_X = np.empty((0, N_VAR))
    archive_F = np.empty((0, 2))
    for i in range(n_particles):
        archive_X, archive_F = update_archive(archive_X, archive_F, pos[i], fitness[i])

    convergence = []

    # ── Main loop ─────────────────────────────────────────────────────────────
    for iteration in range(n_iter):
        for i in range(n_particles):
            # Pick leader from archive
            leader_idx = pick_leader(archive_F)
            gbest = archive_X[leader_idx]

            r1 = rng.random(N_VAR)
            r2 = rng.random(N_VAR)

            # Velocity update
            vel[i] = (
                w  * vel[i]
                + c1 * r1 * (pbest_pos[i] - pos[i])
                + c2 * r2 * (gbest       - pos[i])
            )

            # Clamp velocity
            v_max = (BOUNDS_HI - BOUNDS_LO) * 0.2
            vel[i] = np.clip(vel[i], -v_max, v_max)

            # Position update
            pos[i] = np.clip(pos[i] + vel[i], BOUNDS_LO, BOUNDS_HI)

            # Evaluate
            e, p = evaluate(pos[i], base_readings)
            new_f = np.array([e, -p])
            eval_count += 1

            # Update personal best (using weighted sum for simplicity)
            if (0.5 * new_f[0] + 0.5 * new_f[1]) < (0.5 * pbest_fit[i, 0] + 0.5 * pbest_fit[i, 1]):
                pbest_pos[i] = pos[i].copy()
                pbest_fit[i] = new_f

            # Update archive
            archive_X, archive_F = update_archive(archive_X, archive_F, pos[i], new_f)

        # Track best energy in archive
        best_e = float(archive_F[:, 0].min()) if len(archive_F) > 0 else np.inf
        convergence.append(best_e)

        if verbose and iteration % 20 == 0:
            print(f"  PSO iter {iteration:3d} | archive={len(archive_F):3d} | best_E={best_e:.4f}")

    runtime = time.perf_counter() - t0

    # Pick best balanced solution from archive
    if len(archive_F) > 0:
        F_norm   = (archive_F - archive_F.min(0)) / (archive_F.max(0) - archive_F.min(0) + 1e-9)
        best_idx = int(np.argmin(np.linalg.norm(F_norm, axis=1)))
        best_sp  = archive_X[best_idx]
        best_e   = float(archive_F[best_idx, 0])
        best_p   = float(-archive_F[best_idx, 1])
    else:
        best_sp = np.array([sp['nominal'] for sp in __import__('problem').SETPOINTS])
        best_e, best_p = evaluate(best_sp, base_readings)

    return OptResult(
        algorithm      = 'PSO (MOPSO)',
        best_setpoints = best_sp,
        best_energy    = best_e,
        best_purity    = best_p,
        runtime_s      = runtime,
        n_evaluations  = eval_count,
        pareto_F       = archive_F if len(archive_F) > 0 else None,
        pareto_X       = archive_X if len(archive_X) > 0 else None,
        convergence    = convergence,
        seed           = seed,
    )


if __name__ == '__main__':
    print("Running PSO standalone...")
    r = run(n_particles=30, n_iter=100, verbose=True)
    print(r)
    print("Archive (Pareto front) size:", len(r.pareto_F) if r.pareto_F is not None else 0)
    from problem import SETPOINTS
    for i, sp in enumerate(SETPOINTS):
        print(f"  {sp['tag']:20s} = {r.best_setpoints[i]:.2f} {sp['unit']}")
"""
OPTIQ DSS · Optimiser  (v3 — Differential Evolution)
======================================================
Searches over 4 controller OUTPUT (OP) values to minimise energy
while maintaining purity ≥ 95 % and maximising butane recovery.

Controller variables optimised
-------------------------------
  2TIC403.OP  — Bottom temperature controller output  [20–80 %]
  2FIC419.OP  — Feed flow controller output           [10–90 %]
  2LIC409.OP  — Reflux drum level controller output   [10–90 %]
  2LIC412.OP  — Bottom level controller output        [10–80 %]

Algorithm
---------
Differential Evolution (scipy) — strategy 'best1bin', F=0.8, CR=0.9.
Benchmarked against PSO, GA, Bayesian (TPE), NSGA-II on the XGBoost
surrogate: DE matches GA at energy=614.7 but converges in ~17 s with
only ~2 900 evaluations (GA needs 51 s / 9 600 evals).

Objective (scalarised, minimise)
---------------------------------
  f = W_ENERGY * e/e_ref  -  W_PURITY * p/100  -  W_BUTANE * b/b_ref
  + PURITY_PENALTY * max(0, MIN_PURITY - p)

"I Applied It" simulation
--------------------------
After engineer confirms applying, call `simulate_after_apply()` to roll
the recommended OP values through the lag-based model for 3 steps and
return the expected trajectory [step1, step2, step3].
"""
import logging
import warnings
import numpy as np
from scipy.optimize import differential_evolution
from app.model_loader import model_wrapper
from app import schemas

warnings.filterwarnings('ignore')
logger = logging.getLogger(__name__)

# ── Objective weights ─────────────────────────────────────────────────────────
W_ENERGY       = 0.60   # matches study w_energy that found 614.7 optimum
W_PURITY       = 0.35
W_BUTANE       = 0.05
PURITY_PENALTY = 0.30   # per % below MIN_PURITY
MIN_PURITY     = 95.0   # product spec hard constraint

# ── DE hyper-parameters (tuned from benchmark study) ─────────────────────────
DE_POP_SIZE    = 15     # population = 15 × n_var individuals
DE_MAX_ITER    = 100    # typically converges in < 50 iterations
DE_F           = 0.8    # mutation factor
DE_CR          = 0.9    # crossover rate
DE_STRATEGY    = 'best1bin'   # exploit best; fast convergence on this problem
DE_TOL         = 1e-6
DE_POLISH      = True   # final L-BFGS-B local polish (free accuracy gain)
DE_SEED        = 42


# ── Helpers ───────────────────────────────────────────────────────────────────
def _get_op_bounds() -> tuple:
    """Return (op_cols, bounds_lo, bounds_hi) for the active OP variables."""
    op_disp = model_wrapper.op_display
    op_bnds = model_wrapper.op_bounds
    active  = [d for d in op_disp if d['col'] in (model_wrapper.op_cols or [])]
    if not active:
        active = op_disp
    cols = [d['col'] for d in active]
    lo   = np.array([op_bnds.get(c, (20.0, 80.0))[0] for c in cols])
    hi   = np.array([op_bnds.get(c, (20.0, 80.0))[1] for c in cols])
    return cols, lo, hi


def _op_vector_to_dict(op_vals: np.ndarray, op_cols: list) -> dict:
    return {col: float(v) for col, v in zip(op_cols, op_vals)}


def _current_op_from_readings(base_readings) -> dict:
    """Extract current OP values from live readings, or use nominals."""
    if base_readings and len(base_readings) > 0:
        return model_wrapper._extract_op_from_readings(list(base_readings))
    from app.model_loader import _OP_NOMINALS
    return dict(_OP_NOMINALS)


# ── Main optimise call ────────────────────────────────────────────────────────
def optimize(
    current_state: list,   # kept for API compatibility
    base_readings=None,    # live 33-sensor vector
    n_trials:    int = 0,  # ignored — DE uses DE_MAX_ITER
    seed:        int = DE_SEED,
) -> schemas.OptimizeOut:
    """
    Find optimal controller OP values using Differential Evolution.

    Parameters
    ----------
    current_state   : legacy — kept for API compatibility, not used.
    base_readings   : full live sensor vector from WebSocket (33 values).
    n_trials        : ignored (DE converges in fixed iterations).
    seed            : random seed for reproducibility.
    """
    op_cols, lo, hi = _get_op_bounds()

    # ── Baseline at current operating point ──────────────────────────────────
    current_op_dict = _current_op_from_readings(base_readings)
    ce, cp, cb = model_wrapper.predict_at_op(current_op_dict)
    ce = float(np.clip(ce, 100.0, 3000.0))
    cp = float(np.clip(cp,  80.0,   99.99))
    cb = float(np.clip(cb,   0.5,   10.0))
    current_ops_display = [current_op_dict.get(c, 50.0) for c in op_cols]

    logger.info(
        f'DE Opt start | E={ce:.2f} P={cp:.2f}% B={cb:.3f} '
        f'| pop={DE_POP_SIZE}×{len(op_cols)} max_iter={DE_MAX_ITER}'
    )

    # ── Scalarised objective ──────────────────────────────────────────────────
    def objective(x: np.ndarray) -> float:
        op  = _op_vector_to_dict(x, op_cols)
        e, p, b = model_wrapper.predict_at_op(op)
        cost = (
            W_ENERGY * e / (ce + 1e-9)
            - W_PURITY * p / 100.0
            - W_BUTANE * b / (cb + 1e-9)
        )
        if p < MIN_PURITY:
            cost += PURITY_PENALTY * (MIN_PURITY - p)
        return float(cost)

    bounds = list(zip(lo.tolist(), hi.tolist()))

    result = differential_evolution(
        objective,
        bounds,
        strategy      = DE_STRATEGY,
        maxiter       = DE_MAX_ITER,
        popsize       = DE_POP_SIZE,
        mutation      = DE_F,
        recombination = DE_CR,
        tol           = DE_TOL,
        seed          = seed,
        polish        = DE_POLISH,
        disp          = False,
    )

    best_ops = np.clip(result.x, lo, hi)
    best_op  = _op_vector_to_dict(best_ops, op_cols)
    be, bp, bb = model_wrapper.predict_at_op(best_op)
    be = float(np.clip(be, 100.0, 3000.0))
    bp = float(np.clip(bp,  80.0,   99.99))
    bb = float(np.clip(bb,   0.5,   10.0))

    logger.info(
        f'DE Opt done  | E: {ce:.2f}→{be:.2f}  P: {cp:.2f}→{bp:.2f}%'
        f'  converged={result.success}  nfev={result.nfev}'
    )

    return _build_result(
        current_state, current_ops_display, best_ops.tolist(),
        ce, cp, cb, be, bp, bb,
    )


# ── Result builder ────────────────────────────────────────────────────────────
def _build_result(
    legacy_sp, current_ops, best_ops,
    ce, cp, cb,
    be, bp, bb,
) -> schemas.OptimizeOut:
    es = max(0.0, (ce - be) / (ce + 1e-9) * 100)
    pg = max(0.0, (bp - cp) / (cp + 1e-9) * 100)
    bg = max(0.0, (bb - cb) / (cb + 1e-9) * 100)

    if es > 5 and (pg > 0.3 or bg > 2):
        status = 'optimal'
    elif es > 1 or pg > 0.1 or bg > 1:
        status = 'warning'
    else:
        status = 'critical'

    # No real improvement → keep current OP
    if es < 0.1 and pg < 0.05 and bg < 0.5:
        best_ops = list(current_ops)
        be, bp, bb = ce, cp, cb
        status = 'critical'

    feasibility = float(min(1.0, es / 20.0 + pg / 2.0 + bg / 10.0))

    logger.info(
        f'Opt result | E: {ce:.2f}→{be:.2f} ({es:.1f}% saved) '
        f'P: {cp:.2f}→{bp:.2f}% B: {cb:.3f}→{bb:.3f} | status={status}'
    )

    return schemas.OptimizeOut(
        current_setpoints          = list(current_ops),
        recommended_setpoints      = list(best_ops),
        current_energy             = ce,
        expected_energy            = be,
        energy_savings_percent     = float(es),
        current_purity             = cp,
        expected_purity            = bp,
        purity_improvement_percent = float(pg),
        current_butane             = cb,
        expected_butane            = bb,
        butane_improvement_percent = float(bg),
        status                     = status,
        feasibility_score          = feasibility,
    )


# ── Apply simulation ──────────────────────────────────────────────────────────
def simulate_after_apply(recommended_ops: list) -> list:
    """
    Simulate 3 time steps forward after engineer applies recommended OP values.
    Uses the lag-based model rolling forward.

    Returns
    -------
    list of {step, energy, purity, butane, energy_delta_pct, purity_delta_pct}
    """
    op_cols = model_wrapper.op_cols or [d['col'] for d in model_wrapper.op_display]
    op_dict = {}
    for col, val in zip(op_cols, recommended_ops):
        op_dict[col] = float(val)

    current_e = list(model_wrapper._pred_window)[-1][0]
    current_p = list(model_wrapper._pred_window)[-1][1]

    trajectory = model_wrapper.simulate_trajectory(op_dict, steps=3)

    for step_data in trajectory:
        step_data['energy_delta_pct'] = round(
            (current_e - step_data['energy']) / (current_e + 1e-9) * 100, 2)
        step_data['purity_delta_pct'] = round(
            (step_data['purity'] - current_p) / (current_p + 1e-9) * 100, 2)

    return trajectory

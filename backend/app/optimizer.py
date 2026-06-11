"""
OPTIQ DSS · Optimiser  (v2 — OP controller variables)
=======================================================
Searches over 4 controller OUTPUT (OP) values to minimise energy
while maintaining purity ≥ 95% and maximising butane recovery.

Controller variables optimised
-------------------------------
  2TIC403.OP  — Bottom temperature controller output  [20–80 %]
  2FIC419.OP  — Feed flow controller output           [10–90 %]
  2LIC409.OP  — Reflux drum level controller output   [10–90 %]
  2LIC412.OP  — Bottom level controller output        [10–80 %]

Algorithm
---------
Bayesian Optimisation (Optuna TPE) — persistent study, ~80 trials, ~3–6 s.
Falls back to Differential Evolution (scipy) if Optuna is not installed.

"I Applied It" simulation
--------------------------
After engineer confirms applying, call `simulate_after_apply()` to roll
the recommended OP values through the lag-based model for 3 steps and
return the expected trajectory [step1, step2, step3].
"""
import logging
import warnings
import numpy as np
from app.model_loader import model_wrapper
from app import schemas

warnings.filterwarnings('ignore', module='optuna')
logging.getLogger('optuna').setLevel(logging.ERROR)
logger = logging.getLogger(__name__)

# ── Objective weights ─────────────────────────────────────────────────────────
W_ENERGY = 0.50
W_PURITY = 0.35
W_BUTANE = 0.15

MIN_PURITY = 95.0    # product spec hard constraint

# ── Persistent Bayesian study ─────────────────────────────────────────────────
_study = None


def _get_study():
    global _study
    if _study is not None:
        return _study
    try:
        import optuna
        optuna.logging.set_verbosity(optuna.logging.ERROR)
        _study = optuna.create_study(
            direction='minimize',
            sampler=optuna.samplers.TPESampler(seed=42, n_startup_trials=20),
        )
        logger.info('✓ Bayesian Optimizer ready (Optuna TPE) — OP controller space')
        return _study
    except ImportError:
        logger.warning('Optuna not installed — pip install optuna')
        return None


# ── Helpers ───────────────────────────────────────────────────────────────────
def _get_op_bounds() -> tuple:
    """Return (op_cols, bounds_lo, bounds_hi) for the active OP variables."""
    op_disp = model_wrapper.op_display
    op_bnds = model_wrapper.op_bounds
    # Keep only OP cols that the loaded model actually uses
    active  = [d for d in op_disp if d['col'] in (model_wrapper.op_cols or [])]
    if not active:
        # Fallback: use all 4 standard OP cols
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
    # Fall back to OP nominals
    from app.model_loader import _OP_NOMINALS
    return dict(_OP_NOMINALS)


# ── Main optimise call ────────────────────────────────────────────────────────
def optimize(
    current_state: list,          # kept for API compatibility; ignored (use base_readings)
    base_readings=None,           # live 33-sensor vector
    n_trials:      int   = 80,
    seed:          int   = 42,
) -> schemas.OptimizeOut:
    """
    Find optimal controller OP values using Bayesian Optimisation.

    Parameters
    ----------
    current_state   : legacy parameter — [steam_kg/h, reflux_°C, bottom_°C]
                      Not used for prediction but kept for API compatibility.
    base_readings   : full live sensor vector from WebSocket (33 values)
    n_trials        : Optuna trials to run this call
    """
    op_cols, lo, hi = _get_op_bounds()
    n_var = len(op_cols)

    # ── Baseline at current operating point ──────────────────────────────────
    current_op_dict  = _current_op_from_readings(base_readings)
    current_energy, current_purity, current_butane = model_wrapper.predict_at_op(current_op_dict)
    current_energy = float(np.clip(current_energy, 100.0, 3000.0))
    current_purity = float(np.clip(current_purity,  80.0,   99.99))
    current_butane = float(np.clip(current_butane,   0.5,   10.0))

    # Current OP values (for output — map to display format)
    current_ops_display = [current_op_dict.get(c, 50.0) for c in op_cols]

    logger.info(
        f'Bayesian Opt | current E={current_energy:.2f} '
        f'P={current_purity:.2f}% B={current_butane:.3f} '
        f'| n_trials={n_trials}'
    )

    study = _get_study()
    if study is None:
        return _de_fallback(
            op_cols, lo, hi,
            current_energy, current_purity, current_butane,
            current_ops_display, current_state,
        )

    import optuna

    def objective(trial: optuna.Trial) -> float:
        op_vals = np.array([
            trial.suggest_float(op_cols[i], float(lo[i]), float(hi[i]))
            for i in range(n_var)
        ])
        op_dict = _op_vector_to_dict(op_vals, op_cols)
        e, p, b = model_wrapper.predict_at_op(op_dict)

        obj = (
            W_ENERGY * e / (current_energy + 1e-9)
            - W_PURITY * p / 100.0
            - W_BUTANE * b / (current_butane + 1e-9)
        )
        if p < MIN_PURITY:
            obj += (MIN_PURITY - p) * 0.3
        return obj

    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)

    best       = study.best_trial
    best_vals  = np.clip(
        np.array([best.params[c] for c in op_cols]),
        lo, hi,
    )
    best_op    = _op_vector_to_dict(best_vals, op_cols)
    be, bp, bb = model_wrapper.predict_at_op(best_op)
    be = float(np.clip(be, 100.0, 3000.0))
    bp = float(np.clip(bp,  80.0,   99.99))
    bb = float(np.clip(bb,   0.5,   10.0))

    return _build_result(
        current_state, current_ops_display, best_vals.tolist(),
        current_energy, current_purity, current_butane,
        be, bp, bb,
        n_study_trials=len(study.trials),
    )


def _build_result(
    legacy_sp, current_ops, best_ops,
    ce, cp, cb,
    be, bp, bb,
    n_study_trials=0,
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

    # No real improvement → fallback to current OP
    if es < 0.1 and pg < 0.05 and bg < 0.5:
        best_ops = list(current_ops)
        be, bp, bb = ce, cp, cb
        status = 'critical'

    feasibility = float(min(1.0, es / 20.0 + pg / 2.0 + bg / 10.0))

    logger.info(
        f'Opt result | E: {ce:.2f}→{be:.2f} ({es:.1f}% saved) '
        f'P: {cp:.2f}→{bp:.2f}% B: {cb:.3f}→{bb:.3f} m³/h | status={status}'
    )

    # Map OP values to recommended_setpoints list for schema compatibility
    # (legacy schema uses recommended_setpoints as a generic list)
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


def _de_fallback(op_cols, lo, hi, ce, cp, cb, current_ops_display, legacy_sp):
    """Scipy DE fallback when Optuna not installed."""
    from scipy.optimize import differential_evolution

    def obj(x):
        op = _op_vector_to_dict(x, op_cols)
        e, p, b = model_wrapper.predict_at_op(op)
        return (
            W_ENERGY * e / (ce + 1e-9)
            - W_PURITY * p / 100.0
            - W_BUTANE * b / (cb + 1e-9)
            + (max(0.0, MIN_PURITY - p) * 0.3)
        )

    res      = differential_evolution(obj, list(zip(lo, hi)), maxiter=80, seed=42)
    best_ops = np.clip(res.x, lo, hi)
    best_op  = _op_vector_to_dict(best_ops, op_cols)
    be, bp, bb = model_wrapper.predict_at_op(best_op)
    be = float(np.clip(be, 100.0, 3000.0))
    bp = float(np.clip(bp,  80.0,   99.99))
    bb = float(np.clip(bb,   0.5,   10.0))

    return _build_result(
        legacy_sp, current_ops_display, best_ops.tolist(),
        ce, cp, cb, be, bp, bb,
    )


# ── Apply simulation ──────────────────────────────────────────────────────────
def simulate_after_apply(recommended_ops: list) -> list:
    """
    Simulate 3 time steps forward after engineer applies recommended OP values.
    Uses the lag-based model rolling forward.

    Parameters
    ----------
    recommended_ops : list[float] — same order as model_wrapper.op_cols

    Returns
    -------
    list of {step, energy, purity, butane, energy_delta_pct, purity_delta_pct}
    """
    op_cols  = model_wrapper.op_cols or [d['col'] for d in model_wrapper.op_display]
    op_dict  = {col: float(v) for col, v in zip(op_cols, recommended_ops)
                if len(recommended_ops) > i
                for i, col in enumerate(op_cols)}

    # Simpler version — zip approach
    op_dict = {}
    for col, val in zip(op_cols, recommended_ops):
        op_dict[col] = float(val)

    # Get current baseline before simulation
    current_e = list(model_wrapper._pred_window)[-1][0]
    current_p = list(model_wrapper._pred_window)[-1][1]

    trajectory = model_wrapper.simulate_trajectory(op_dict, steps=3)

    # Annotate with deltas vs pre-apply state
    for step_data in trajectory:
        step_data['energy_delta_pct'] = round(
            (current_e - step_data['energy']) / (current_e + 1e-9) * 100, 2)
        step_data['purity_delta_pct'] = round(
            (step_data['purity'] - current_p) / (current_p + 1e-9) * 100, 2)

    return trajectory

"""
OPTIQ DSS · Multi-Objective Optimiser
Algorithm : Bayesian Optimization (scikit-optimize)
Objectives : minimise energy · maximise purity (weighted sum)
Setpoints  : 2FI422.SP · 2TI1_414.SP · 2TIC403.SP

Advantages over NSGA-II:
  - Much faster (6-10 seconds vs 70+ seconds)
  - Better for expensive black-box functions
  - Built-in exploration/exploitation trade-off
  - Handles constraints naturally
"""
import logging
import numpy as np
from skopt import gp_minimize
from skopt.space import Real
from skopt.utils import use_named_args
from skopt.callbacks import DeltaYStopper, EarlyStopper
from app.model_loader import model_wrapper
from app.alerts import COLUMN_ORDER
from app import schemas

logger = logging.getLogger(__name__)

# ── Setpoint definitions ──────────────────────────────────────────────────────
SETPOINT_DEFS = [
    {
        'sp_tag': '2FI422.SP', 'pv_tag': '2FI422.PV',
        'name': 'Steam flow to reboiler', 'unit': 'kg/h',
        'min': 2500.0, 'max': 3500.0, 'nominal': 3000.0,
    },
    {
        'sp_tag': '2TI1_414.SP', 'pv_tag': '2TI1_414.PV',
        'name': 'Reflux temperature', 'unit': '°C',
        'min': 68.0, 'max': 80.0, 'nominal': 74.0,
    },
    {
        'sp_tag': '2TIC403.SP', 'pv_tag': '2TIC403.PV',
        'name': 'Bottom temperature', 'unit': '°C',
        'min': 88.0, 'max': 100.0, 'nominal': 94.0,
    },
]

# ── Full 33-sensor nominal baseline ──────────────────────────────────────────
_ALL_NOMINALS: dict[str, float] = {
    '2TIC403.PV':       94.0,
    '2TIC403.OP':       52.0,
    '2TI1_428.PV':      94.0,
    '2FI422.PV':      3000.0,
    '2TI1_414.PV':      74.0,
    '2FIC419.PV':       25.0,
    '2FIC419.OP':       48.0,
    '2FI449A.PV':       18.0,
    '2FI431.PV':        12.0,
    '2LIC409.OP':       50.0,
    '2LIC409.PV':       52.0,
    '2LIC412.OP':       48.0,
    '2LIC412.PV':       50.0,
    '2LI410A.PV':       50.0,
    '2PIC409.OP':       45.0,
    '2PIC409.PV':        6.2,
    '2TI1_414.PV_temp': 74.0,
    '2TI1_415.DACA.PV': 76.0,
    '2TI1_416.DACA.PV': 81.0,
    '2TI1_417.PV':      85.0,
    '2TI1_428.PV_temp': 94.2,
    '2TI1_429.PV':      88.0,
    '2TI1_441.DACA.PV': 64.0,
    '2TI1_409.PV':      67.0,
    'FI_FEED.PV':       40.0,
    'TI_FEED.PV':       55.0,
    'TI_CONDENSER.PV':  42.0,
    'FI_COOLING.PV':    85.0,
    'TI_CW_OUT.PV':     35.0,
    'PI_FEED.PV':        8.5,
    'TI_REBOILER.PV':  105.0,
    'FI_STEAM_COND.PV':2950.0,
    'AI_BUTANE_C5.PV':   0.35,
}

_N_FEATURES = max(COLUMN_ORDER.values()) + 1


def _resolve_indices() -> list:
    indices, missing = [], []
    for sp in SETPOINT_DEFS:
        pv = sp['pv_tag']
        if pv not in COLUMN_ORDER:
            missing.append(pv)
        else:
            indices.append(COLUMN_ORDER[pv])
    if missing:
        raise KeyError(
            f"Optimizer: PV tags not in alerts.COLUMN_ORDER: {missing}"
        )
    logger.info(
        "Optimizer setpoint indices: "
        + ", ".join(f"{sp['sp_tag']}→idx{idx}" for sp, idx in zip(SETPOINT_DEFS, indices))
    )
    return indices


_SETPOINT_INDICES: list = _resolve_indices()


def _make_base_readings(base_readings: list | None) -> list:
    """Build a full 33-element reading vector."""
    if base_readings and len(base_readings) >= _N_FEATURES:
        return list(base_readings[:_N_FEATURES])

    readings = [0.0] * _N_FEATURES
    for tag, idx in COLUMN_ORDER.items():
        if idx < _N_FEATURES:
            readings[idx] = _ALL_NOMINALS.get(tag, 0.0)
    return readings


def _build_readings(setpoints: np.ndarray, base: list) -> list:
    """Inject 3 candidate setpoints into a complete baseline vector."""
    readings = list(base)
    while len(readings) < _N_FEATURES:
        readings.append(0.0)
    for idx, val in zip(_SETPOINT_INDICES, setpoints):
        readings[idx] = float(val)
    return readings


def _validate_current_state(current_state: list) -> list:
    """Ensure current_state contains realistic setpoint values."""
    validated = []
    for i, (val, sp) in enumerate(zip(current_state, SETPOINT_DEFS)):
        if val < sp['min'] * 0.9 or val > sp['max'] * 1.1:
            logger.error(
                f"current_state[{i}]={val} is FAR outside bounds "
                f"[{sp['min']}, {sp['max']}] for {sp['sp_tag']}. "
                f"Are you sending a PV value instead of SP?"
            )
            raise ValueError(
                f"Setpoint {sp['sp_tag']} value {val} is outside expected range. "
                f"Expected between {sp['min']} and {sp['max']}. "
                f"Did you accidentally send a PV value instead of SP?"
            )
        elif sp['min'] <= val <= sp['max']:
            validated.append(float(val))
        else:
            logger.warning(
                f"current_state[{i}]={val} outside bounds "
                f"[{sp['min']}, {sp['max']}] for {sp['sp_tag']} — "
                f"using nominal {sp['nominal']}"
            )
            validated.append(sp['nominal'])
    return validated


# ── Bayesian Optimization Objective ───────────────────────────────────────────
def _objective(
    steam: float,
    reflux: float,
    bottom: float,
    base: list,
    current_energy: float,
    w_energy: float = 0.4,
    w_purity: float = 0.6,
) -> float:
    """
    Weighted scalar objective for Bayesian Optimization.
    Lower value is better.
    
    Objective = w_energy * (energy/current_energy) - w_purity * (purity/100)
    """
    setpoints = np.array([steam, reflux, bottom])
    readings = _build_readings(setpoints, base)
    pred = model_wrapper.predict(readings)
    
    energy = pred['energy']
    purity = pred['purity']
    
    # Normalize energy by current value
    normalized_energy = energy / (current_energy + 1e-9)
    
    # Normalize purity (higher is better, so negative for minimization)
    normalized_purity = -purity / 100.0
    
    # Combined objective
    objective = w_energy * normalized_energy + w_purity * normalized_purity
    
    # Penalty for low purity (< 95%)
    if purity < 95.0:
        penalty = (95.0 - purity) * 10.0
        objective += penalty
        logger.debug(f"Purity penalty: {penalty:.2f} for purity={purity:.2f}%")
    
    return objective


# ── Public API ────────────────────────────────────────────────────────────────
def optimize(
    current_state: list,
    base_readings: list | None = None,
    n_calls: int = 80,           # Number of evaluations (replaces pop_size * n_gen)
    initial_point_generator: str = 'sobol',  # Better space coverage
    acq_func: str = 'EI',        # Expected Improvement
    seed: int = 42,
    w_energy: float = 0.4,       # Weight for energy (0.4 = 40%)
    w_purity: float = 0.6,       # Weight for purity (0.6 = 60%)
) -> schemas.OptimizeOut:
    """
    Bayesian Optimization for debutanizer setpoints.
    
    Parameters
    ----------
    current_state : [steam, reflux, bottom] - current setpoints
    base_readings : full 33-sensor reading vector
    n_calls : number of objective evaluations (80 = ~6-10 seconds runtime)
    initial_point_generator : 'sobol', 'lhs', 'random' - how to sample initial points
    acq_func : 'EI' (Expected Improvement), 'PI' (Probability of Improvement), 'LCB' (Lower Confidence Bound)
    w_energy, w_purity : relative importance (should sum to 1.0)
    """
    
    if len(current_state) != 3:
        raise ValueError(f"optimize() expects 3 setpoints, got {len(current_state)}")
    
    # Validate current state
    current_state = _validate_current_state(current_state)
    base = _make_base_readings(base_readings)
    
    # Get current performance for normalization
    current_readings = _build_readings(np.array(current_state), base)
    current_pred = model_wrapper.predict(current_readings)
    current_energy = float(np.clip(current_pred['energy'], 0.5, 5.0))
    current_purity = float(np.clip(current_pred['purity'], 80.0, 99.99))
    
    # Define search space
    space = [
        Real(SETPOINT_DEFS[0]['min'], SETPOINT_DEFS[0]['max'], 
             name='steam', prior='uniform'),
        Real(SETPOINT_DEFS[1]['min'], SETPOINT_DEFS[1]['max'], 
             name='reflux', prior='uniform'),
        Real(SETPOINT_DEFS[2]['min'], SETPOINT_DEFS[2]['max'], 
             name='bottom', prior='uniform'),
    ]
    
    # Create objective with fixed parameters
    @use_named_args(space)
    def objective_wrapper(**params):
        return _objective(
            steam=params['steam'],
            reflux=params['reflux'],
            bottom=params['bottom'],
            base=base,
            current_energy=current_energy,
            w_energy=w_energy,
            w_purity=w_purity,
        )
    
    # Early stopping callbacks
    callbacks = [
        DeltaYStopper(delta=0.001, n_best=5),  # Stop if improvement < 0.001 over 5 iterations
    ]
    
    logger.info(f"Starting Bayesian Optimization with {n_calls} evaluations...")
    logger.info(f"  Weights: Energy={w_energy:.1%}, Purity={w_purity:.1%}")
    logger.info(f"  Current: Energy={current_energy:.4f}, Purity={current_purity:.2f}%")
    
    # Run Bayesian Optimization
    result = gp_minimize(
        func=objective_wrapper,
        dimensions=space,
        n_calls=n_calls,
        n_initial_points=15,                    # Initial random exploration
        initial_point_generator=initial_point_generator,
        acq_func=acq_func,
        acq_optimizer='sampling',
        random_state=seed,
        verbose=False,
        callback=callbacks,
    )
    
    # Extract best solution
    best_setpoints = result.x
    best_energy, best_purity = _evaluate_setpoints(best_setpoints, base)
    
    # Calculate improvements
    energy_savings = max(0.0, (current_energy - best_energy) / (current_energy + 1e-9) * 100)
    purity_improvement = max(0.0, (best_purity - current_purity) / (current_purity + 1e-9) * 100)
    
    # Determine status
    if purity_improvement < 0.1 and energy_savings > 0:
        status = 'warning' if energy_savings > 2 else 'critical'
    elif energy_savings > 5 and purity_improvement > 0.3:
        status = 'optimal'
    elif energy_savings > 2 or purity_improvement > 0.1:
        status = 'warning'
    else:
        status = 'critical'
    
    # Check if we improved at all
    no_improvement = energy_savings <= 0.1 and purity_improvement <= 0.05
    
    logger.info(f"Bayesian Optimization complete after {len(result.x_iters)} evaluations")
    logger.info(f"  Best: Steam={best_setpoints[0]:.1f}, Reflux={best_setpoints[1]:.1f}, Bottom={best_setpoints[2]:.1f}")
    logger.info(f"  Energy: {current_energy:.4f} → {best_energy:.4f} ({energy_savings:.1f}%)")
    logger.info(f"  Purity: {current_purity:.2f}% → {best_purity:.2f}% ({purity_improvement:.2f}%)")
    
    return schemas.OptimizeOut(
        current_setpoints=current_state,
        recommended_setpoints=current_state if no_improvement else best_setpoints,
        current_energy=current_energy,
        expected_energy=current_energy if no_improvement else best_energy,
        current_purity=current_purity,
        expected_purity=current_purity if no_improvement else best_purity,
        energy_savings_percent=0.0 if no_improvement else float(energy_savings),
        purity_improvement_percent=0.0 if no_improvement else float(purity_improvement),
        status='critical' if no_improvement else status,
        feasibility_score=float(1.0 - (95.0 - best_purity) / 5.0 if best_purity < 95 else 1.0),
    )


def _evaluate_setpoints(setpoints: list, base: list) -> tuple:
    """Helper to evaluate a single setpoint combination."""
    readings = _build_readings(np.array(setpoints), base)
    pred = model_wrapper.predict(readings)
    return float(pred['energy']), float(pred['purity'])


# ── Optional: Multi-point optimization for Pareto front approximation ─────────
def optimize_pareto(
    current_state: list,
    base_readings: list | None = None,
    n_calls: int = 150,
    n_points: int = 10,
    seed: int = 42,
) -> list:
    """
    Run multiple Bayesian optimizations with different weights to approximate Pareto front.
    Returns list of optimal points with different trade-offs.
    """
    current_state = _validate_current_state(current_state)
    base = _make_base_readings(base_readings)
    
    results = []
    weight_pairs = [
        (0.2, 0.8),  # Prefer purity
        (0.3, 0.7),
        (0.4, 0.6),  # Balanced
        (0.5, 0.5),
        (0.6, 0.4),
        (0.7, 0.3),
        (0.8, 0.2),  # Prefer energy
    ]
    
    for w_energy, w_purity in weight_pairs:
        logger.info(f"Running optimization with weights: E={w_energy}, P={w_purity}")
        
        result = optimize(
            current_state=current_state,
            base_readings=base_readings,
            n_calls=n_calls // len(weight_pairs),
            w_energy=w_energy,
            w_purity=w_purity,
            seed=seed + int(w_energy * 100),
        )
        
        results.append({
            'weights': (w_energy, w_purity),
            'setpoints': result.recommended_setpoints,
            'energy': result.expected_energy,
            'purity': result.expected_purity,
        })
    
    return results
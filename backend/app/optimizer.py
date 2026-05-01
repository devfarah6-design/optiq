"""
OPTIQ DSS · Multi-Objective Optimiser
Algorithm : Bayesian Optimization (scikit-optimize)
Objectives : minimise energy · maximise purity (weighted sum)
Setpoints  : 2FI422.SP · 2TI1_414.SP · 2TIC403.SP

Fixes applied:
  - base_readings uses ALL 33 nominal values (not zeros) when no live data
  - current_state uses real nominal setpoints as fallback
  - negative savings clamped to 0 with status=critical
  - energy/purity clamped to physically valid ranges before comparison
"""
import logging
import numpy as np
from app.model_loader import model_wrapper
from app.alerts import COLUMN_ORDER
from app import schemas

# Try to import skopt, fallback to scipy if not available
try:
    from skopt import gp_minimize
    from skopt.space import Real
    from skopt.utils import use_named_args
    SKOPT_AVAILABLE = True
except ImportError:
    SKOPT_AVAILABLE = False
    from scipy.optimize import differential_evolution
    logger.warning("scikit-optimize not available, falling back to differential evolution")

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


def _objective(
    setpoints: np.ndarray,
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
    readings = _build_readings(setpoints, base)
    pred = model_wrapper.predict(readings)
    
    energy = pred['energy']
    purity = pred['purity']
    
    # Normalize energy by current value
    normalized_energy = energy / (current_energy + 1e-9)
    
    # Normalized purity (higher is better, so negative for minimization)
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
    n_calls: int = 80,           # Number of evaluations (faster than NSGA-II)
    seed: int = 42,
    w_energy: float = 0.4,       # Weight for energy (40%)
    w_purity: float = 0.6,       # Weight for purity (60%)
) -> schemas.OptimizeOut:
    """Bayesian Optimization for debutanizer setpoints."""
    
    if len(current_state) != 3:
        raise ValueError(f"optimize() expects 3 setpoints, got {len(current_state)}")

    # Validate current state
    current_state = _validate_current_state(current_state)
    base = _make_base_readings(base_readings)
    
    # Get current performance
    current_readings = _build_readings(np.array(current_state), base)
    current_pred = model_wrapper.predict(current_readings)
    current_energy = float(np.clip(current_pred['energy'], 0.5, 5.0))
    current_purity = float(np.clip(current_pred['purity'], 80.0, 99.99))
    
    logger.info(f"Starting Bayesian Optimization with {n_calls} evaluations...")
    logger.info(f"  Weights: Energy={w_energy:.1%}, Purity={w_purity:.1%}")
    logger.info(f"  Current: Energy={current_energy:.4f}, Purity={current_purity:.2f}%")
    
    # Define bounds
    bounds = [
        (SETPOINT_DEFS[0]['min'], SETPOINT_DEFS[0]['max']),  # steam
        (SETPOINT_DEFS[1]['min'], SETPOINT_DEFS[1]['max']),  # reflux
        (SETPOINT_DEFS[2]['min'], SETPOINT_DEFS[2]['max']),  # bottom
    ]
    
    # Objective wrapper
    def objective_wrapper(x):
        return _objective(
            setpoints=np.array(x),
            base=base,
            current_energy=current_energy,
            w_energy=w_energy,
            w_purity=w_purity,
        )
    
    # Try Bayesian Optimization if available, otherwise use differential evolution
    if SKOPT_AVAILABLE:
        # Define search space
        space = [
            Real(SETPOINT_DEFS[0]['min'], SETPOINT_DEFS[0]['max'], name='steam'),
            Real(SETPOINT_DEFS[1]['min'], SETPOINT_DEFS[1]['max'], name='reflux'),
            Real(SETPOINT_DEFS[2]['min'], SETPOINT_DEFS[2]['max'], name='bottom'),
        ]
        
        @use_named_args(space)
        def skopt_objective(**params):
            return _objective(
                setpoints=np.array([params['steam'], params['reflux'], params['bottom']]),
                base=base,
                current_energy=current_energy,
                w_energy=w_energy,
                w_purity=w_purity,
            )
        
        result = gp_minimize(
            func=skopt_objective,
            dimensions=space,
            n_calls=n_calls,
            n_initial_points=15,
            initial_point_generator='sobol',
            acq_func='EI',
            random_state=seed,
            verbose=False,
        )
        
        best_setpoints = result.x
        best_objective = result.fun
        
    else:
        # Fallback to differential evolution (works without extra dependencies)
        logger.info("scikit-optimize not available, using differential evolution")
        result = differential_evolution(
            func=objective_wrapper,
            bounds=bounds,
            maxiter=n_calls // 10,
            popsize=15,
            seed=seed,
            disp=False,
        )
        best_setpoints = result.x
        best_objective = result.fun
    
    # Evaluate best solution
    best_readings = _build_readings(np.array(best_setpoints), base)
    best_pred = model_wrapper.predict(best_readings)
    best_energy = float(np.clip(best_pred['energy'], 0.5, 5.0))
    best_purity = float(np.clip(best_pred['purity'], 80.0, 99.99))
    
    # Calculate improvements
    energy_savings = max(0.0, (current_energy - best_energy) / (current_energy + 1e-9) * 100)
    purity_improvement = max(0.0, (best_purity - current_purity) / (current_purity + 1e-9) * 100)
    
    # Status based on improvements
    if energy_savings > 3 and purity_improvement > 0.2:
        status = 'optimal'
    elif energy_savings > 1 or purity_improvement > 0.1:
        status = 'warning'
    else:
        status = 'critical'
    
    # If no improvement, stay at current setpoints
    no_improvement = energy_savings <= 0.1 and purity_improvement <= 0.05
    
    logger.info(f"Bayesian Optimization complete | "
                f"Energy: {current_energy:.4f}→{best_energy:.4f} ({energy_savings:.1f}%) | "
                f"Purity: {current_purity:.2f}%→{best_purity:.2f}% ({purity_improvement:.2f}%) | "
                f"status={status}")
    
    if no_improvement:
        logger.info("No improvement found - recommending current setpoints")
        return schemas.OptimizeOut(
            current_setpoints=current_state,
            recommended_setpoints=current_state,
            current_energy=current_energy,
            expected_energy=current_energy,
            current_purity=current_purity,
            expected_purity=current_purity,
            energy_savings_percent=0.0,
            purity_improvement_percent=0.0,
            status='critical',
            feasibility_score=1.0,
        )
    
    return schemas.OptimizeOut(
        current_setpoints=current_state,
        recommended_setpoints=best_setpoints,
        current_energy=current_energy,
        expected_energy=best_energy,
        current_purity=current_purity,
        expected_purity=best_purity,
        energy_savings_percent=float(energy_savings),
        purity_improvement_percent=float(purity_improvement),
        status=status,
        feasibility_score=float(1.0 - (95.0 - best_purity) / 5.0 if best_purity < 95 else 1.0),
    )
"""
OPTIQ DSS · Multi-Objective Optimiser
Algorithm : NSGA-II (pymoo)
Objectives : minimise energy · maximise purity
Setpoints  : 2FI422.SP · 2TI1_414.SP · 2TIC403.SP

Fixes applied:
  - base_readings uses ALL 33 nominal values (not zeros) when no live data
  - current_state uses real nominal setpoints as fallback
  - negative savings clamped to 0 with status=critical
  - energy/purity clamped to physically valid ranges before comparison
"""
import logging
import numpy as np
from pymoo.algorithms.moo.nsga2 import NSGA2
from pymoo.core.problem import Problem
from pymoo.optimize import minimize as pymoo_minimize
from pymoo.operators.crossover.sbx import SBX
from pymoo.operators.mutation.pm import PM
from pymoo.termination import get_termination
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


# ── Single Problem Class (SIMPLIFIED for deployment) ─────────────────────────
class DebutanizerProblem(Problem):
    def __init__(self, base: list):
        xl = np.array([sp['min'] for sp in SETPOINT_DEFS])
        xu = np.array([sp['max'] for sp in SETPOINT_DEFS])
        super().__init__(n_var=3, n_obj=2, n_ieq_constr=0, xl=xl, xu=xu)
        self.base = base

    def _evaluate(self, x, out, *args, **kwargs):
        f1, f2 = [], []
        for sp in x:
            r = _build_readings(sp, self.base)
            pred = model_wrapper.predict(r)
            f1.append(pred['energy'])
            f2.append(-pred['purity'])
        out['F'] = np.column_stack([f1, f2])


# ── Public API ────────────────────────────────────────────────────────────────
def optimize(
    current_state: list,
    base_readings: list | None = None,
    pop_size: int = 50,
    n_gen: int = 40,
    seed: int = 42,
) -> schemas.OptimizeOut:
    """Run NSGA-II optimization."""
    
    if len(current_state) != 3:
        raise ValueError(f"optimize() expects 3 setpoints, got {len(current_state)}")

    # Validate current state
    current_state = _validate_current_state(current_state)
    base = _make_base_readings(base_readings)

    # Run optimization
    problem = DebutanizerProblem(base)
    algorithm = NSGA2(
        pop_size=pop_size,
        crossover=SBX(prob=0.9, eta=15),
        mutation=PM(eta=20),
        eliminate_duplicates=True,
    )
    
    result = pymoo_minimize(
        problem,
        algorithm,
        get_termination("n_gen", n_gen),
        seed=seed,
        verbose=False,
    )

    # Get results - SIMPLIFIED: just take first solution (already Pareto optimal)
    F = result.F
    X = result.X
    
    # Normalize objectives and pick best balanced solution
    if len(F) > 1:
        F_norm = (F - F.min(0)) / (F.max(0) - F.min(0) + 1e-9)
        best_idx = int(np.argmin(np.linalg.norm(F_norm, axis=1)))
    else:
        best_idx = 0
    
    best_sp = X[best_idx]
    best_energy = float(F[best_idx, 0])
    best_purity = float(-F[best_idx, 1])

    # Current performance
    current_readings = _build_readings(np.array(current_state), base)
    current_pred = model_wrapper.predict(current_readings)
    current_energy = float(np.clip(current_pred['energy'], 0.5, 5.0))
    current_purity = float(np.clip(current_pred['purity'], 80.0, 99.99))

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

    logger.info(f"Optimization complete: {len(F)} solutions | "
                f"Energy: {current_energy:.4f}→{best_energy:.4f} ({energy_savings:.1f}%) | "
                f"Purity: {current_purity:.2f}%→{best_purity:.2f}% ({purity_improvement:.2f}%) | "
                f"status={status}")

    # If no improvement, stay at current setpoints
    no_improvement = energy_savings <= 0.1 and purity_improvement <= 0.05
    
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
        recommended_setpoints=best_sp.tolist(),
        current_energy=current_energy,
        expected_energy=best_energy,
        current_purity=current_purity,
        expected_purity=best_purity,
        energy_savings_percent=float(energy_savings),
        purity_improvement_percent=float(purity_improvement),
        status=status,
        feasibility_score=0.85,
    )
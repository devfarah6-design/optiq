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
# ALL sensors at nominal values — model gets a realistic operating context.
# Zeros for 30 sensors is out-of-distribution and produces garbage predictions.
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
    """
    Build a full 33-element reading vector.

    Priority:
      1. Use live base_readings from ingestion (best — real process context)
      2. Fall back to ALL_NOMINALS (all 33 sensors at typical values)
         Never use zeros — that's out-of-distribution for the model.
    """
    if base_readings and len(base_readings) >= _N_FEATURES:
        return list(base_readings[:_N_FEATURES])

    # Build from nominals using COLUMN_ORDER
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
    """
    Ensure current_state contains realistic setpoint values.
    Also log if values seem like PVs (off by significant amount)
    """
    validated = []
    for i, (val, sp) in enumerate(zip(current_state, SETPOINT_DEFS)):
        # Check if value is suspiciously different from typical setpoint range
        if val < sp['min'] * 0.9 or val > sp['max'] * 1.1:
            logger.error(
                f"current_state[{i}]={val} is FAR outside bounds "
                f"[{sp['min']}, {sp['max']}] for {sp['sp_tag']}. "
                f"Are you sending a PV value instead of SP?"
            )
            # Don't auto-correct drastically - raise error for debugging
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


# ── pymoo Problem ─────────────────────────────────────────────────────────────
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
# optimizer.py - Complete improved version

def optimize(
    current_state: list,
    base_readings: list | None = None,
    pop_size: int = 100,      # Increased for better exploration
    n_gen: int = 60,          # More generations
    seed: int = 42,
) -> schemas.OptimizeOut:
    """Improved NSGA-II with constraints and better selection"""
    
    if len(current_state) != 3:
        raise ValueError(f"optimize() expects 3 setpoints, got {len(current_state)}")

    # Validate current state
    current_state = _validate_current_state(current_state)
    base = _make_base_readings(base_readings)

    # Define optimization problem with constraints
    class ConstrainedDebutanizerProblem(Problem):
        def __init__(self, base_list: list):
            xl = np.array([sp['min'] for sp in SETPOINT_DEFS])
            xu = np.array([sp['max'] for sp in SETPOINT_DEFS])
            super().__init__(n_var=3, n_obj=2, n_ieq_constr=1, xl=xl, xu=xu)
            self.base = base_list

        def _evaluate(self, x, out, *args, **kwargs):
            f1, f2, constraints = [], [], []
            
            for sp in x:
                r = _build_readings(sp, self.base)
                pred = model_wrapper.predict(r)
                
                # Objectives
                f1.append(pred['energy'])
                f2.append(-pred['purity'])  # Minimize negative purity
                
                # Constraint: purity >= 95% (critical for product quality)
                # G <= 0 means feasible
                constraints.append(95.0 - pred['purity'])
            
            out['F'] = np.column_stack([f1, f2])
            out['G'] = np.column_stack([constraints])

    # Run optimization
    problem = ConstrainedDebutanizerProblem(base)
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

    # Filter feasible solutions (those meeting purity constraint)
    feasible_mask = result.G[:, 0] <= 0 if result.G is not None else np.ones(len(result.F), dtype=bool)
    
    if not np.any(feasible_mask):
        logger.warning("No feasible solutions found - relaxing constraints")
        # Fallback: solutions closest to meeting purity
        feasibility_score = -result.G[:, 0]  # Less negative = closer to feasible
        best_feasible_idx = int(np.argmax(feasibility_score))
    else:
        # Among feasible solutions, find best trade-off
        F_feasible = result.F[feasible_mask]
        X_feasible = result.X[feasible_mask]
        
        # Normalize
        F_norm = (F_feasible - F_feasible.min(0)) / (F_feasible.max(0) - F_feasible.min(0) + 1e-9)
        
        # Weighted selection: 70% purity, 30% energy
        weights = np.array([0.3, 0.7])
        scores = np.sum(F_norm * weights, axis=1)
        best_idx_in_feasible = int(np.argmin(scores))
        
        # Map back to original indices
        feasible_indices = np.where(feasible_mask)[0]
        best_idx = feasible_indices[best_idx_in_feasible]
        
        best_sp = X_feasible[best_idx_in_feasible]
        best_energy = float(F_feasible[best_idx_in_feasible, 0])
        best_purity = float(-F_feasible[best_idx_in_feasible, 1])

    # Current performance
    current_readings = _build_readings(np.array(current_state), base)
    current_pred = model_wrapper.predict(current_readings)
    current_energy = float(np.clip(current_pred['energy'], 0.5, 5.0))
    current_purity = float(np.clip(current_pred['purity'], 80.0, 99.99))

    # Calculate improvements
    energy_savings = max(0.0, (current_energy - best_energy) / (current_energy + 1e-9) * 100)
    purity_improvement = max(0.0, (best_purity - current_purity) / (current_purity + 1e-9) * 100)

    # Status based on realistic thresholds
    if purity_improvement < 0.1:
        status = 'critical'  # Model not responsive
    elif energy_savings > 5 and purity_improvement > 0.2:
        status = 'optimal'
    elif energy_savings > 2 or purity_improvement > 0.1:
        status = 'warning'
    else:
        status = 'critical'

    logger.info(f"Optimization complete: {len(result.F)} solutions, {np.sum(feasible_mask)} feasible | "
                f"Energy: {current_energy:.4f}→{best_energy:.4f} ({energy_savings:.1f}%) | "
                f"Purity: {current_purity:.2f}%→{best_purity:.2f}% ({purity_improvement:.2f}%)")

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
        feasibility_score=float(1.0 - (95.0 - best_purity) / 5.0 if best_purity < 95 else 1.0),
    )
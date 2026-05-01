"""
OPTIQ DSS · Multi-Objective Optimiser
Algorithm : NSGA-II (pymoo)
Objectives : minimise energy · maximise purity
Setpoints  : 2FI422.SP (steam flow) · 2TI1_414.SP (reflux temp) · 2TIC403.SP (bottom temp)

Key fix: setpoint indices are derived automatically from alerts.COLUMN_ORDER,
which is the single source of truth for tag→index mapping.
No manual index guessing. If a tag is missing → clear error on startup.
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
from app.alerts import COLUMN_ORDER           # ← single source of truth
from app import schemas

logger = logging.getLogger(__name__)


# ── Setpoint definitions ──────────────────────────────────────────────────────
# tag     : the PV tag whose index we look up in COLUMN_ORDER
#           (the SP drives the PV, so we inject into the PV position)
# min/max : safe operating bounds — verify against your DC4 P&ID
# nominal : current typical operating value
SETPOINT_DEFS = [
    {
        'sp_tag':  '2FI422.SP',
        'pv_tag':  '2FI422.PV',        # index derived from this
        'name':    'Steam flow to reboiler',
        'unit':    'kg/h',
        'min':     2500.0,
        'max':     3500.0,
        'nominal': 3000.0,
    },
    {
        'sp_tag':  '2TI1_414.SP',
        'pv_tag':  '2TI1_414.PV',
        'name':    'Reflux temperature',
        'unit':    '°C',
        'min':     68.0,
        'max':     80.0,
        'nominal': 74.0,
    },
    {
        'sp_tag':  '2TIC403.SP',
        'pv_tag':  '2TIC403.PV',
        'name':    'Bottom temperature',
        'unit':    '°C',
        'min':     88.0,
        'max':     100.0,
        'nominal': 94.0,
    },
]


def _resolve_indices() -> list[int]:
    """
    Look up each setpoint's injection index from COLUMN_ORDER.
    Called once at startup — raises immediately if any tag is missing
    so you catch the problem before the first /optimize call.
    """
    indices = []
    missing = []
    for sp in SETPOINT_DEFS:
        pv = sp['pv_tag']
        if pv not in COLUMN_ORDER:
            missing.append(pv)
        else:
            indices.append(COLUMN_ORDER[pv])

    if missing:
        raise KeyError(
            f"Optimizer: the following PV tags are in SETPOINT_DEFS but NOT in "
            f"alerts.COLUMN_ORDER — add them to COLUMN_ORDER with the correct "
            f"index from your dataset:\n  {missing}"
        )

    logger.info(
        "Optimizer setpoint indices resolved: "
        + ", ".join(
            f"{sp['sp_tag']}→idx{idx}"
            for sp, idx in zip(SETPOINT_DEFS, indices)
        )
    )
    return indices


# Resolve once at import time — fails fast if something is wrong
_SETPOINT_INDICES: list[int] = _resolve_indices()
_N_FEATURES = max(COLUMN_ORDER.values()) + 1    # total reading vector length


# ── Default nominal readings used when no live context is available ───────────
_NOMINAL_READINGS: list[float] = [0.0] * _N_FEATURES
for _sp, _idx in zip(SETPOINT_DEFS, _SETPOINT_INDICES):
    _NOMINAL_READINGS[_idx] = _sp['nominal']


def _build_readings(setpoints: np.ndarray, base_readings: list | None) -> list:
    """
    Build a full reading vector by injecting the 3 candidate setpoints
    into a base context vector.

    Using a real base (from ingestion) is much better than zeros because
    the other 30 sensors have physically meaningful values that the model
    was trained on. Zeros would push the model into an out-of-distribution
    region and produce unreliable predictions.
    """
    readings = list(base_readings) if base_readings else list(_NOMINAL_READINGS)

    # Ensure the vector is long enough
    while len(readings) < _N_FEATURES:
        readings.append(0.0)

    for idx, val in zip(_SETPOINT_INDICES, setpoints):
        readings[idx] = float(val)

    return readings


# ── pymoo Problem definition ──────────────────────────────────────────────────
class DebutanizerProblem(Problem):
    """
    Decision variables : [steam_flow_kg_h, reflux_temp_C, bottom_temp_C]
    Objectives         : [energy, -purity]   ← pymoo minimises both
    Constraints        : none (bounds handle limits)
    """

    def __init__(self, base_readings: list | None = None):
        xl = np.array([sp['min'] for sp in SETPOINT_DEFS])
        xu = np.array([sp['max'] for sp in SETPOINT_DEFS])
        super().__init__(n_var=3, n_obj=2, n_ieq_constr=0, xl=xl, xu=xu)
        self.base_readings = base_readings

    def _evaluate(self, x, out, *args, **kwargs):
        f1_energy = []
        f2_purity = []

        for setpoints in x:
            readings = _build_readings(setpoints, self.base_readings)
            result   = model_wrapper.predict(readings)
            f1_energy.append(result['energy'])
            f2_purity.append(-result['purity'])   # negate → NSGA-II minimises

        out['F'] = np.column_stack([f1_energy, f2_purity])


# ── Public API ────────────────────────────────────────────────────────────────
def optimize(
    current_state:  list,
    base_readings:  list | None = None,
    pop_size:       int  = 50,
    n_gen:          int  = 40,
    seed:           int  = 42,
) -> schemas.OptimizeOut:
    """
    Run NSGA-II and return the best balanced setpoint recommendation.

    Parameters
    ----------
    current_state  : [steam_flow, reflux_temp, bottom_temp] — current setpoints
    base_readings  : full 33-sensor reading vector from the latest ingestion cycle.
                     Pass this for accurate predictions. Falls back to nominals
                     if not provided (e.g. first call at startup).
    pop_size       : NSGA-II population size (50 is good for 3 variables)
    n_gen          : number of generations (40 ≈ 2 seconds)
    seed           : random seed for reproducibility
    """
    if len(current_state) != 3:
        raise ValueError(
            f"optimize() expects exactly 3 setpoints, got {len(current_state)}"
        )

    problem = DebutanizerProblem(base_readings=base_readings)

    result = pymoo_minimize(
        problem,
        NSGA2(
            pop_size            = pop_size,
            crossover           = SBX(prob=0.9, eta=15),
            mutation            = PM(eta=20),
            eliminate_duplicates= True,
        ),
        get_termination("n_gen", n_gen),
        seed    = seed,
        verbose = False,
    )

    F = result.F   # shape (n_solutions, 2): [energy, -purity]
    X = result.X   # shape (n_solutions, 3): setpoints

    # ── Select best balanced solution from Pareto front ───────────────────────
    # Strategy: closest to the "ideal point" on the normalised front.
    # The ideal point is (0, 0) after normalisation — minimum energy AND
    # maximum purity at the same time (usually impossible, hence the front).
    F_norm   = (F - F.min(0)) / (F.max(0) - F.min(0) + 1e-9)
    best_idx = int(np.argmin(np.linalg.norm(F_norm, axis=1)))

    best_sp     = X[best_idx]
    best_energy = float(F[best_idx, 0])
    best_purity = float(-F[best_idx, 1])    # un-negate

    # ── Current performance (using the same base_readings context) ────────────
    current_readings = _build_readings(np.array(current_state), base_readings)
    current_pred     = model_wrapper.predict(current_readings)
    current_energy   = current_pred['energy']
    current_purity   = current_pred['purity']

    energy_savings      = (current_energy - best_energy)  / (current_energy  + 1e-9) * 100
    purity_improvement  = (best_purity    - current_purity) / (current_purity + 1e-9) * 100

    status = (
        'optimal'  if energy_savings > 3 and purity_improvement > 0.3 else
        'warning'  if energy_savings > 1 else
        'critical'
    )

    logger.info(
        f"NSGA-II | Pareto: {len(F)} solutions | "
        f"Best → {SETPOINT_DEFS[0]['sp_tag']}={best_sp[0]:.1f} {SETPOINT_DEFS[0]['unit']}, "
        f"{SETPOINT_DEFS[1]['sp_tag']}={best_sp[1]:.1f} {SETPOINT_DEFS[1]['unit']}, "
        f"{SETPOINT_DEFS[2]['sp_tag']}={best_sp[2]:.1f} {SETPOINT_DEFS[2]['unit']} | "
        f"E={best_energy:.4f} (save {energy_savings:.1f}%), "
        f"P={best_purity:.2f}% (gain {purity_improvement:.2f}%) | "
        f"status={status}"
    )

    return schemas.OptimizeOut(
        current_setpoints         = list(current_state),
        recommended_setpoints     = best_sp.tolist(),
        current_energy            = float(current_energy),
        expected_energy           = best_energy,
        current_purity            = float(current_purity),
        expected_purity           = best_purity,
        energy_savings_percent    = float(energy_savings),
        purity_improvement_percent= float(purity_improvement),
        status                    = status,
        feasibility_score         = float(1.0 - F_norm[best_idx].mean()),
    )
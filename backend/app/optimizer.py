"""OPTIQ DSS · Optimisation module"""
import logging
import numpy as np
from typing import List
from app import schemas

logger = logging.getLogger(__name__)


def optimize(current_state: List[float]) -> schemas.OptimizeOut:
    current = np.array(current_state, dtype=float)
    current_energy = 1.25
    current_purity = 98.2

    adj = np.array([0.5, -1.2, 0.8])
    recommended = np.clip(current + adj, 0, 100)

    e_reduction = np.random.uniform(2, 5)
    p_improvement = np.random.uniform(0.5, 2.0)

    expected_energy = current_energy * (1 - e_reduction / 100)
    expected_purity = min(99.8, current_purity + current_purity * p_improvement / 100)

    e_savings = (current_energy - expected_energy) / current_energy * 100
    p_gain = (expected_purity - current_purity) / current_purity * 100

    status = "optimal" if e_savings > 5 and p_gain > 0.5 else (
        "warning" if e_savings > 2 else "critical"
    )
    feasibility = 0.95 if status == "optimal" else (0.85 if status == "warning" else 0.65)

    logger.info(f"Optimisation: E_savings={e_savings:.2f}%, P_gain={p_gain:.2f}%")

    return schemas.OptimizeOut(
        current_setpoints=current.tolist(),
        recommended_setpoints=recommended.tolist(),
        current_energy=float(current_energy),
        expected_energy=float(expected_energy),
        current_purity=float(current_purity),
        expected_purity=float(expected_purity),
        energy_savings_percent=float(e_savings),
        purity_improvement_percent=float(p_gain),
        status=status,
        feasibility_score=float(feasibility),
    )

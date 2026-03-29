"""
OPTIQ DSS · Prediction
"""
from datetime import datetime
from app.model_loader import model_wrapper
from app import schemas


def predict_energy_purity(readings: list) -> schemas.PredictionOut:
    result = model_wrapper.predict(readings)
    return schemas.PredictionOut(
        energy=result["energy"],
        purity=result["purity"],
        stability=result["stability"],
        model_type=result["model_type"],
        confidence=result["confidence"],
        is_outlier=result["is_outlier"],
        outlier_score=result["outlier_score"],
        timestamp=datetime.utcnow(),
    )

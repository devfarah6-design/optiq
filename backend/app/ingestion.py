"""OPTIQ DSS · Background data ingestion loop"""
import asyncio
import logging
import numpy as np
from datetime import datetime
from app import models, schemas
from app.prediction import predict_energy_purity
from app.alerts import detect_anomalies
from app.database import SessionLocal
from app.websocket_manager import manager as ws_manager
from app.config import settings

logger = logging.getLogger(__name__)


async def _get_simulated_readings() -> list:
    base = np.random.normal(loc=50, scale=5, size=33)
    base[0:5] += np.random.normal(10, 2)
    base[5:10] += np.random.normal(-5, 1)
    base[15:20] += np.random.normal(2, 3)
    return np.clip(base, 10, 90).tolist()


async def ingestion_loop():
    logger.info("Data ingestion loop started")
    while True:
        try:
            readings = await _get_simulated_readings()
            pred = predict_energy_purity(readings)
            detected = detect_anomalies(readings)

            db = SessionLocal()
            try:
                # Store prediction
                db_pred = models.Prediction(
                    readings=readings,
                    energy=pred.energy,
                    purity=pred.purity,
                    stability=pred.stability,
                    model_type=pred.model_type,
                    confidence=pred.confidence,
                    is_outlier=pred.is_outlier,
                    outlier_score=pred.outlier_score,
                )
                db.add(db_pred)

                # Store alerts
                for a in detected:
                    db.add(models.Alert(
                        alert_type=a["alert_type"],
                        severity=a["severity"],
                        tag_name=a["tag_name"],
                        value=a.get("value"),
                        threshold=a.get("threshold"),
                        z_score=a.get("z_score"),
                        description=a["description"],
                    ))
                db.commit()
            finally:
                db.close()

            # Broadcast over WebSocket
            await ws_manager.broadcast({
                "type": "new_prediction",
                "timestamp": datetime.utcnow().isoformat(),
                "energy": pred.energy,
                "purity": pred.purity,
                "stability": pred.stability,
                "is_outlier": pred.is_outlier,
            })

            for a in detected:
                await ws_manager.broadcast({"type": "new_alert", "alert": a})

        except asyncio.CancelledError:
            logger.info("Ingestion loop cancelled")
            break
        except Exception as e:
            logger.error(f"Ingestion error: {e}", exc_info=True)

        await asyncio.sleep(settings.ingestion_interval_seconds)

"""OPTIQ DSS · Anomaly detection"""
import numpy as np
import logging
from typing import List, Dict, Any
from collections import deque
from app.config import settings

logger = logging.getLogger(__name__)


class AnomalyDetector:
    def __init__(self):
        self.sensor_stats: Dict[int, dict] = {}
        self.history_size = 50

    def _update(self, readings: List[float]):
        for i, v in enumerate(readings):
            if i not in self.sensor_stats:
                self.sensor_stats[i] = {"values": deque(maxlen=self.history_size), "mean": 0.0, "std": 0.0}
            self.sensor_stats[i]["values"].append(v)
            vals = list(self.sensor_stats[i]["values"])
            self.sensor_stats[i]["mean"] = float(np.mean(vals))
            self.sensor_stats[i]["std"] = float(np.std(vals))

    def detect_stuck(self, readings: List[float]) -> List[Dict[str, Any]]:
        self._update(readings)
        alerts = []
        for i, v in enumerate(readings):
            if i in self.sensor_stats and self.sensor_stats[i]["std"] < settings.stuck_sensor_threshold:
                alerts.append({
                    "alert_type": "stuck_sensor", "severity": "warning",
                    "tag_name": f"SENSOR_{i:02d}", "value": float(v),
                    "threshold": float(settings.stuck_sensor_threshold),
                    "z_score": 0.0,
                    "description": f"Sensor {i} stuck (σ={self.sensor_stats[i]['std']:.4f})",
                })
        return alerts

    def detect_outliers(self, readings: List[float]) -> List[Dict[str, Any]]:
        arr = np.array(readings, dtype=float)
        mean, std = arr.mean(), arr.std()
        alerts = []
        for i, v in enumerate(arr):
            z = abs((v - mean) / (std + 1e-6))
            if z > settings.outlier_z_score_threshold:
                alerts.append({
                    "alert_type": "outlier", "severity": "info",
                    "tag_name": f"SENSOR_{i:02d}", "value": float(v),
                    "threshold": float(mean), "z_score": float(z),
                    "description": f"Outlier on sensor {i} (z={z:.2f})",
                })
        return alerts


_detector = AnomalyDetector()


def detect_anomalies(readings: List[float]) -> List[Dict[str, Any]]:
    result = _detector.detect_stuck(readings) + _detector.detect_outliers(readings)
    if result:
        logger.info(f"Detected {len(result)} anomalies")
    return result

"""
OPTIQ DSS · ML Model Loader
Loads the XGBoost model at startup and exposes predict().
Falls back to a simple regression when no model file is found
so the system remains functional during development.
"""
import logging
import os
import numpy as np
from app.config import settings

logger = logging.getLogger(__name__)


class ModelWrapper:
    """
    Wraps the trained XGBoost model.

    Expected model storage
    ──────────────────────
    Option A – single pickle:
        models/best_xgb_model.pkl
        The pickle must contain a dict with keys:
            'energy_model' : fitted XGBRegressor (predicts energy)
            'purity_model' : fitted XGBRegressor (predicts purity)
            'scaler'       : fitted StandardScaler (optional)

    Option B – separate files:
        models/energy_model.pkl
        models/purity_model.pkl
        models/scaler.pkl  (optional)

    The loader tries Option A first, then Option B, then dummy.
    """

    def __init__(self):
        self.energy_model = None
        self.purity_model = None
        self.scaler = None
        self.model_type = "dummy"
        self._load()

    # ── Private loading logic ─────────────────────────────────────────────────
    def _load(self):
        try:
            import joblib
        except ImportError:
            logger.error("joblib not installed – using dummy model")
            self._use_dummy()
            return

        path = settings.model_path

        # Option A: single bundled pickle
        if os.path.isfile(path):
            try:
                bundle = joblib.load(path)
                if isinstance(bundle, dict):
                    self.energy_model = bundle.get("energy_model")
                    self.purity_model = bundle.get("purity_model")
                    self.scaler = bundle.get("scaler")
                else:
                    # Single model – treat as energy predictor
                    self.energy_model = bundle
                self.model_type = "xgboost"
                logger.info(f"✓ Loaded model bundle from {path}")
                return
            except Exception as e:
                logger.error(f"Failed to load {path}: {e}")

        # Option B: separate files
        base_dir = os.path.dirname(path)
        e_path = os.path.join(base_dir, "energy_model.pkl")
        p_path = os.path.join(base_dir, "purity_model.pkl")
        s_path = os.path.join(base_dir, "scaler.pkl")

        if os.path.isfile(e_path) and os.path.isfile(p_path):
            try:
                self.energy_model = joblib.load(e_path)
                self.purity_model = joblib.load(p_path)
                if os.path.isfile(s_path):
                    self.scaler = joblib.load(s_path)
                self.model_type = "xgboost"
                logger.info("✓ Loaded separate model files")
                return
            except Exception as e:
                logger.error(f"Failed to load separate models: {e}")

        logger.warning(
            "⚠ No model file found at configured path. "
            "Using physics-based dummy model. "
            f"Expected: {path}"
        )
        self._use_dummy()

    def _use_dummy(self):
        """Simple physics-inspired fallback – never crashes."""
        self.model_type = "dummy"

    # ── Public API ────────────────────────────────────────────────────────────
    def predict(self, readings: list) -> dict:
        """
        Run inference.

        Parameters
        ----------
        readings : list[float]  – raw sensor readings (any length ≥ 1)

        Returns
        -------
        dict with keys: energy, purity, stability, model_type,
                        confidence, is_outlier, outlier_score
        """
        X = np.array(readings, dtype=float).reshape(1, -1)

        # Apply scaler if present
        if self.scaler is not None:
            try:
                X = self.scaler.transform(X)
            except Exception as e:
                logger.warning(f"Scaler transform failed: {e}")

        if self.model_type == "xgboost":
            energy, purity = self._xgb_predict(X)
        else:
            energy, purity = self._dummy_predict(readings)

        # Outlier detection via simple z-score on readings
        raw = np.array(readings, dtype=float)
        z_scores = np.abs((raw - raw.mean()) / (raw.std() + 1e-6))
        outlier_score = float(z_scores.max())
        is_outlier = outlier_score > 3.5

        return {
            "energy": float(energy),
            "purity": float(purity),
            "stability": float(max(0.0, 1.0 - outlier_score / 10)),
            "model_type": self.model_type,
            "confidence": 0.95 if not is_outlier else 0.60,
            "is_outlier": is_outlier,
            "outlier_score": outlier_score,
        }

    def _xgb_predict(self, X: np.ndarray):
        energy = self.energy_model.predict(X)[0] if self.energy_model else 1.25
        purity = self.purity_model.predict(X)[0] if self.purity_model else 98.2
        return energy, purity

    def _dummy_predict(self, readings: list):
        """Physics-inspired heuristic for when no model is available."""
        r = np.array(readings, dtype=float)
        # Simulate energy as a function of temperature variance
        energy = 1.15 + 0.3 * (np.std(r) / (np.mean(r) + 1e-6))
        # Purity inversely related to outliers
        purity = 99.0 - 0.5 * float(np.abs(r - r.mean()).max() / (r.mean() + 1e-6))
        return np.clip(energy, 0.8, 2.5), np.clip(purity, 85.0, 99.9)


# Module-level singleton – imported by prediction.py
model_wrapper = ModelWrapper()

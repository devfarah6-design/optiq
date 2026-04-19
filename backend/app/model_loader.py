"""
OPTIQ DSS · ML Model Loader
Handles two model types saved by save_models_for_optiq.py:

  XGBoost  →  best_xgb_model.pkl
               keys: model, scaler_X, scaler_Y, feature_names, target_names
               input: flat array (1, n_features)

  GRU      →  best_gru_model.keras  +  best_gru_meta.pkl
               input: sequence (1, n_steps, n_features) — keeps rolling window
"""
import logging
import os
import numpy as np
from collections import deque
from app.config import settings

logger = logging.getLogger(__name__)


class ModelWrapper:

    def __init__(self):
        self.model         = None     # MultiOutputRegressor (XGB) or Keras model (GRU)
        self.scaler_X      = None
        self.scaler_Y      = None
        self.feature_names = []
        self.target_names  = ['Target_Energy', 'Target_Purity_Pct']
        self.n_features    = None
        self.n_steps       = 1        # 1 for XGB, 6 for GRU
        self.model_type    = "dummy"
        self.model_family  = "dummy"

        # Rolling window for GRU (stores last n_steps scaled readings)
        self._window: deque = deque()

        self._load()

    # ── Loading ───────────────────────────────────────────────────────────────
    def _load(self):
        path = settings.model_path

        # ── Try XGBoost pkl ──────────────────────────────────────────────────
        if path.endswith('.pkl') and os.path.isfile(path):
            self._load_xgb(path)
            return

        # ── Try GRU keras + meta ─────────────────────────────────────────────
        if path.endswith('.keras') and os.path.isfile(path):
            meta_path = path.replace('.keras', '_meta.pkl').replace(
                'best_gru_model', 'best_gru_meta')
            # Also try same directory
            if not os.path.isfile(meta_path):
                meta_path = os.path.join(os.path.dirname(path), 'best_gru_meta.pkl')
            self._load_gru(path, meta_path)
            return

        # ── Auto-discover in models/ dir ─────────────────────────────────────
        base_dir = os.path.dirname(path) or 'models'
        xgb_path = os.path.join(base_dir, 'best_xgb_model.pkl')
        gru_path = os.path.join(base_dir, 'best_gru_model.keras')
        gru_meta = os.path.join(base_dir, 'best_gru_meta.pkl')

        if os.path.isfile(xgb_path):
            self._load_xgb(xgb_path)
            return
        if os.path.isfile(gru_path) and os.path.isfile(gru_meta):
            self._load_gru(gru_path, gru_meta)
            return

        logger.warning(
            f"⚠ No model found. Expected:\n"
            f"  XGB: {xgb_path}\n"
            f"  GRU: {gru_path} + {gru_meta}\n"
            f"Using physics-based dummy model."
        )
        self.model_type = "dummy"

    def _load_xgb(self, path: str):
        try:
            import joblib
            bundle = joblib.load(path)

            self.model         = bundle['model']          # MultiOutputRegressor
            self.scaler_X      = bundle.get('scaler_X')
            self.scaler_Y      = bundle.get('scaler_Y')
            self.feature_names = bundle.get('feature_names', [])
            self.target_names  = bundle.get('target_names', self.target_names)
            self.n_features    = bundle.get('n_features', len(self.feature_names))
            self.n_steps       = 1
            self.model_type    = "xgboost"
            self.model_family  = "XGBoost"

            m = bundle.get('metrics', {})
            logger.info(
                f"✓ XGBoost loaded from {path} | "
                f"R² Energy={m.get('R2_Energy','?')} "
                f"R² Purity={m.get('R2_Purity','?')} | "
                f"{self.n_features} features"
            )
        except Exception as e:
            logger.error(f"Failed to load XGBoost model: {e}")
            self.model_type = "dummy"

    def _load_gru(self, weights_path: str, meta_path: str):
        try:
            import joblib
            from tensorflow.keras.models import load_model

            meta = joblib.load(meta_path)
            self.scaler_X      = meta.get('scaler_X')
            self.scaler_Y      = meta.get('scaler_Y')
            self.feature_names = meta.get('feature_names', [])
            self.target_names  = meta.get('target_names', self.target_names)
            self.n_features    = meta.get('n_features', len(self.feature_names))
            self.n_steps       = meta.get('n_steps', 6)

            self.model         = load_model(weights_path)
            self.model_type    = "gru"
            self.model_family  = "GRU"

            # Initialize rolling window with zeros
            self._window = deque(
                [np.zeros(self.n_features)] * self.n_steps,
                maxlen=self.n_steps
            )

            m = meta.get('metrics', {})
            logger.info(
                f"✓ GRU loaded from {weights_path} | "
                f"R² Energy={m.get('R2_Energy','?')} "
                f"R² Purity={m.get('R2_Purity','?')} | "
                f"n_steps={self.n_steps} features={self.n_features}"
            )
        except Exception as e:
            logger.error(f"Failed to load GRU model: {e}")
            self.model_type = "dummy"

    # ── Inference ─────────────────────────────────────────────────────────────
    def predict(self, readings: list) -> dict:
        """
        readings : list[float] — raw sensor values, length = n_features
        Returns  : dict with energy, purity, stability, model_type,
                   confidence, is_outlier, outlier_score
        """
        raw = np.array(readings, dtype=float)

        # ── Outlier detection (always done on raw readings) ──────────────────
        z_scores     = np.abs((raw - raw.mean()) / (raw.std() + 1e-6))
        outlier_score = float(z_scores.max())
        is_outlier   = outlier_score > 3.5

        # ── Predict ──────────────────────────────────────────────────────────
        if self.model_type == "xgboost":
            energy, purity = self._predict_xgb(raw)
        elif self.model_type == "gru":
            energy, purity = self._predict_gru(raw)
        else:
            energy, purity = self._dummy_predict(readings)

        return {
            "energy"       : float(energy),
            "purity"       : float(purity),
            "stability"    : float(max(0.0, 1.0 - outlier_score / 10)),
            "model_type"   : self.model_family,
            "confidence"   : 0.95 if not is_outlier else 0.60,
            "is_outlier"   : is_outlier,
            "outlier_score": outlier_score,
        }

    def _predict_xgb(self, raw: np.ndarray):
        """Flat input: scale → predict → inverse scale."""
        X = raw.reshape(1, -1)

        if self.scaler_X is not None:
            try:
                X = self.scaler_X.transform(X)
            except Exception as e:
                logger.warning(f"scaler_X transform failed: {e}")

        Y_scaled = self.model.predict(X)   # shape (1, 2)

        if self.scaler_Y is not None:
            try:
                Y = self.scaler_Y.inverse_transform(Y_scaled)
            except Exception as e:
                logger.warning(f"scaler_Y inverse failed: {e}")
                Y = Y_scaled
        else:
            Y = Y_scaled

        return Y[0, 0], Y[0, 1]

    def _predict_gru(self, raw: np.ndarray):
        """
        Sequence input: maintain rolling window of last n_steps scaled readings,
        then predict → inverse scale.
        """
        # Scale the new reading
        X_scaled = raw.reshape(1, -1)
        if self.scaler_X is not None:
            try:
                X_scaled = self.scaler_X.transform(X_scaled)
            except Exception as e:
                logger.warning(f"scaler_X transform failed: {e}")

        # Push into rolling window
        self._window.append(X_scaled[0])

        # Stack window → (1, n_steps, n_features)
        seq = np.array(list(self._window), dtype=np.float32)
        seq = seq.reshape(1, self.n_steps, self.n_features)

        Y_scaled = self.model.predict(seq, verbose=0)   # shape (1, 2)

        if self.scaler_Y is not None:
            try:
                Y = self.scaler_Y.inverse_transform(Y_scaled)
            except Exception as e:
                logger.warning(f"scaler_Y inverse failed: {e}")
                Y = Y_scaled
        else:
            Y = Y_scaled

        return Y[0, 0], Y[0, 1]

    def _dummy_predict(self, readings: list):
        """Physics-inspired fallback — varies with input, never crashes."""
        r      = np.array(readings, dtype=float)
        energy = 1.15 + 0.3 * (np.std(r) / (np.mean(r) + 1e-6))
        purity = 99.0 - 0.5 * float(np.abs(r - r.mean()).max() / (r.mean() + 1e-6))
        return np.clip(energy, 0.8, 2.5), np.clip(purity, 85.0, 99.9)


# Module-level singleton
model_wrapper = ModelWrapper()
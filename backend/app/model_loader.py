"""
OPTIQ DSS · ML Model Loader  (v2 — new bundle format)
======================================================
Loads best_xgb_surrogate.pkl produced by 01_rnn_exogenous.ipynb.

New bundle keys
---------------
  model       — MultiOutputRegressor(XGBRegressor)  trained on RAW Y (no scaler_Y)
  sc_X        — StandardScaler fitted on training features
  feat_cols   — list[13]  = 9 lag cols + 4 OP cols
  targets     — ['Target_Energy', 'Target_Purity_Pct', 'Target_Butane_Flow']
  n_lags      — 3
  op_cols     — ['2TIC403.OP - Snapshot', '2FIC419.OP - Snapshot',
                  '2LIC409.OP - Snapshot', '2LIC412.OP - Snapshot']

Feature order in feat_cols:
  [Energy_lag1, Energy_lag2, Energy_lag3,
   Purity_lag1, Purity_lag2, Purity_lag3,
   Butane_lag1, Butane_lag2, Butane_lag3,
   2TIC403.OP - Snapshot, 2FIC419.OP - Snapshot,
   2LIC409.OP - Snapshot, 2LIC412.OP - Snapshot]

Prediction pipeline
-------------------
  1. Maintain rolling window of last N_LAGS (Energy, Purity, Butane) predictions.
  2. Extract OP values from live readings vector via COLUMN_ORDER index map.
  3. Build 13-feature vector, scale with sc_X, predict.
  4. No inverse Y scaling — model predicts raw Y directly.

Baseline state
--------------
  Lag features are initialised at training median values.
  OP features default to nominal operating values.
"""
import logging
import os
import numpy as np
from collections import deque
from app.config import settings

logger = logging.getLogger(__name__)

# ── OP tag mapping: model feat_col name → COLUMN_ORDER tag (no "- Snapshot") ─
# The model was trained on CSV columns that have "- Snapshot" suffix,
# but the live WebSocket data uses the base tag name.
_OP_TAG_MAP = {
    '2TIC403.OP - Snapshot': '2TIC403.OP',
    '2FIC419.OP - Snapshot': '2FIC419.OP',
    '2LIC409.OP - Snapshot': '2LIC409.OP',
    '2LIC412.OP - Snapshot': '2LIC412.OP',
    '2PIC409.OP - Snapshot': '2PIC409.OP',
}

# Default nominal OP values (% output) when live data is unavailable
_OP_NOMINALS = {
    '2TIC403.OP - Snapshot': 52.0,
    '2FIC419.OP - Snapshot': 48.0,
    '2LIC409.OP - Snapshot': 50.0,
    '2LIC412.OP - Snapshot': 48.0,
    '2PIC409.OP - Snapshot': 45.0,
}

# Baseline targets (median from training data)
_TARGET_BASELINE = {
    'Target_Energy':     996.4,
    'Target_Purity_Pct':  98.45,
    'Target_Butane_Flow':  3.17,
}

# Hard physical limits — values outside these are impossible and indicate
# model/feature mismatch.  We clip ALL predictions to these ranges so a
# single bad prediction can never cascade through the lag window.
_ENERGY_RANGE = (100.0,  3000.0)   # kJ/kg  (reasonable steam consumption)
_PURITY_RANGE = ( 60.0,    99.99)  # %mol
_BUTANE_RANGE = (  0.1,    20.0)   # m³/h


class ModelWrapper:

    def __init__(self):
        self.model         = None
        self.sc_X          = None          # StandardScaler for features
        self.feat_cols     = []            # 13 feature column names
        self.op_cols       = []            # OP column names (with "- Snapshot")
        self.n_lags        = 3
        self.target_names  = [
            'Target_Energy',
            'Target_Purity_Pct',
            'Target_Butane_Flow',
        ]
        self.n_features    = 13
        self.model_type    = 'dummy'
        self.model_family  = 'Dummy'

        # Rolling window of (energy, purity, butane) — last n_lags predictions
        # Initialised at median training values
        self._pred_window: deque = deque(
            [(_TARGET_BASELINE['Target_Energy'],
              _TARGET_BASELINE['Target_Purity_Pct'],
              _TARGET_BASELINE['Target_Butane_Flow'])] * 3,
            maxlen=3,
        )

        # Mapping from OP col name → index in live readings vector
        self._op_indices: dict = {}

        # Counter to detect sustained clipping (model stuck at boundary)
        self._clip_streak: int = 0

        self._load()

    # ── Loading ───────────────────────────────────────────────────────────────
    def _load(self):
        path = settings.model_path

        # Prefer explicit path, then fall back to models/ directory
        candidates = [path]
        base_dir   = os.path.dirname(path) or 'models'
        candidates.append(os.path.join(base_dir, 'best_xgb_surrogate.pkl'))

        for p in candidates:
            if p.endswith('.pkl') and os.path.isfile(p):
                self._load_xgb(p)
                return

        logger.warning(
            "⚠ No XGBoost surrogate found. "
            f"Expected: {candidates}\n"
            "Using physics-based dummy model."
        )
        self.model_type = 'dummy'

    def _load_xgb(self, path: str):
        try:
            import joblib
            bundle = joblib.load(path)

            self.model       = bundle['model']
            self.sc_X        = bundle['sc_X']
            self.feat_cols   = bundle['feat_cols']       # list[13]
            self.op_cols     = bundle.get('op_cols', [])
            self.n_lags      = bundle.get('n_lags', 3)

            tgts = bundle.get('targets', self.target_names)
            self.target_names = tgts
            self.n_features   = len(self.feat_cols)
            self.model_type   = 'xgboost'
            self.model_family = 'XGBoost'

            # Build OP index map — maps feat_col → live readings vector index
            self._build_op_indices()

            logger.info(
                f"✓ XGBoost surrogate loaded from {path} | "
                f"{self.n_features} features | {self.n_lags} lags | "
                f"{len(self.op_cols)} OP variables"
            )
        except Exception as e:
            logger.error(f"Failed to load XGBoost model: {e}", exc_info=True)
            self.model_type = 'dummy'

    def _build_op_indices(self):
        """Map OP feature column names to COLUMN_ORDER indices."""
        try:
            from app.alerts import COLUMN_ORDER
            self._op_indices = {}
            for col in self.op_cols:
                base_tag = _OP_TAG_MAP.get(col, col.replace(' - Snapshot', ''))
                if base_tag in COLUMN_ORDER:
                    self._op_indices[col] = COLUMN_ORDER[base_tag]
                else:
                    logger.warning(f"OP tag '{base_tag}' not in COLUMN_ORDER")
        except Exception as e:
            logger.warning(f"Could not build OP indices: {e}")

    # ── Feature vector assembly ────────────────────────────────────────────────
    def _build_feature_vector(self, op_values: dict) -> np.ndarray:
        """
        Build 13-element feature vector:
          [E_lag1, E_lag2, E_lag3,
           P_lag1, P_lag2, P_lag3,
           B_lag1, B_lag2, B_lag3,
           OP1, OP2, OP3, OP4]

        Parameters
        ----------
        op_values : {feat_col_name: float} — current OP values
        """
        # Most recent prediction first (lag1), then lag2, lag3
        window = list(self._pred_window)   # oldest first in deque
        # window[-1] = most recent (lag1), window[-2] = lag2, window[-3] = lag3
        lags_e = [window[-1][0], window[-2][0], window[-3][0]]
        lags_p = [window[-1][1], window[-2][1], window[-3][1]]
        lags_b = [window[-1][2], window[-2][2], window[-3][2]]

        # Assemble vector matching feat_cols order
        fv = np.zeros(len(self.feat_cols), dtype=np.float32)
        for i, col in enumerate(self.feat_cols):
            if col == 'Target_Energy_lag1':     fv[i] = lags_e[0]
            elif col == 'Target_Energy_lag2':   fv[i] = lags_e[1]
            elif col == 'Target_Energy_lag3':   fv[i] = lags_e[2]
            elif col == 'Target_Purity_Pct_lag1':    fv[i] = lags_p[0]
            elif col == 'Target_Purity_Pct_lag2':    fv[i] = lags_p[1]
            elif col == 'Target_Purity_Pct_lag3':    fv[i] = lags_p[2]
            elif col == 'Target_Butane_Flow_lag1':   fv[i] = lags_b[0]
            elif col == 'Target_Butane_Flow_lag2':   fv[i] = lags_b[1]
            elif col == 'Target_Butane_Flow_lag3':   fv[i] = lags_b[2]
            else:
                # OP column
                fv[i] = op_values.get(col, _OP_NOMINALS.get(col, 50.0))
        return fv

    def _extract_op_from_readings(self, readings: list) -> dict:
        """Extract current OP values from live sensor readings vector."""
        op_vals = {}
        for col in self.op_cols:
            idx = self._op_indices.get(col)
            if idx is not None and idx < len(readings):
                op_vals[col] = float(readings[idx])
            else:
                op_vals[col] = _OP_NOMINALS.get(col, 50.0)
        return op_vals

    # ── Public inference ──────────────────────────────────────────────────────
    def predict(self, readings: list) -> dict:
        """
        Predict from live sensor readings vector.

        readings : list[float] — full live sensor vector from WebSocket
        Returns  : dict with energy, purity, butane, model_type, confidence
        """
        # Heal window BEFORE building features — prevents bad-lag cascade
        self._sanitize_window()

        raw = np.array(readings, dtype=float)
        z_scores      = np.abs((raw - raw.mean()) / (raw.std() + 1e-6))
        outlier_score = float(z_scores.max())
        is_outlier    = outlier_score > 3.5

        if self.model_type == 'xgboost':
            energy, purity, butane = self._predict_xgb(readings)
        else:
            energy, purity, butane = self._dummy_predict(readings)

        # Log raw output for diagnosis
        logger.debug(
            f"Model raw output — energy={energy:.2f}, purity={purity:.2f}, butane={butane:.2f} "
            f"| type={self.model_type}"
        )

        # Clip before storing in window (prevents cascade if model extrapolates)
        raw_energy, raw_purity = energy, purity
        energy = float(np.clip(energy, *_ENERGY_RANGE))
        purity = float(np.clip(purity, *_PURITY_RANGE))
        butane = float(np.clip(butane, *_BUTANE_RANGE))

        # Track how many consecutive predictions hit the clip minimum
        clipped_low = (raw_energy < _ENERGY_RANGE[0] * 1.005 or
                       raw_purity < _PURITY_RANGE[0] * 1.005)
        if clipped_low:
            self._clip_streak += 1
            if self._clip_streak >= 3:
                logger.warning(
                    f"⚠ {self._clip_streak} consecutive low-clip predictions — "
                    f"resetting lag window to baseline "
                    f"(raw_energy={raw_energy:.2f}, raw_purity={raw_purity:.2f})"
                )
                self._reset_window()
                self._clip_streak = 0
        else:
            self._clip_streak = 0

        # Update rolling window with this prediction
        self._pred_window.append((energy, purity, butane))

        return {
            'energy'       : float(energy),
            'purity'       : float(purity),
            'butane'       : float(butane),
            'stability'    : float(max(0.0, 1.0 - outlier_score / 10)),
            'model_type'   : self.model_family,
            'confidence'   : 0.95 if not is_outlier else 0.60,
            'is_outlier'   : is_outlier,
            'outlier_score': outlier_score,
        }

    def _reset_window(self):
        """Unconditionally reset lag window to training median baseline."""
        self._pred_window.clear()
        for _ in range(self.n_lags):
            self._pred_window.append((
                _TARGET_BASELINE['Target_Energy'],
                _TARGET_BASELINE['Target_Purity_Pct'],
                _TARGET_BASELINE['Target_Butane_Flow'],
            ))

    def _sanitize_window(self):
        """Reset lag window to baseline if values are out of range OR stuck at clip boundary.
        A value exactly at the clip minimum means a prior prediction was clipped — this is
        not a 'valid' process state and must be treated as corruption."""
        energies = [w[0] for w in self._pred_window]
        purities = [w[1] for w in self._pred_window]

        # Out-of-range check (strict: value must be strictly inside the valid band)
        out_of_range = any(
            not (_ENERGY_RANGE[0] < e < _ENERGY_RANGE[1])
            or not (_PURITY_RANGE[0] < p < _PURITY_RANGE[1])
            or not (_BUTANE_RANGE[0] <= b <= _BUTANE_RANGE[1])
            for e, p, b in self._pred_window
        )

        # Stuck-at-boundary: all lags within 0.5% of the minimum clip value
        energy_stuck = all(e <= _ENERGY_RANGE[0] * 1.005 for e in energies)
        purity_stuck = all(p <= _PURITY_RANGE[0] * 1.005 for p in purities)

        if out_of_range or energy_stuck or purity_stuck:
            reason = ('out-of-range' if out_of_range
                      else f'stuck at clip boundary (energy={energies[0]:.1f}, purity={purities[0]:.1f})')
            logger.warning(f"⚠ Lag window {reason} — resetting to baseline")
            self._reset_window()

    def predict_at_op(self, op_values: dict, update_window: bool = False) -> tuple:
        """
        Predict (energy, purity, butane) for a specific OP configuration.
        Used by the optimizer and apply-simulation.

        op_values       : {feat_col_name: float}
        update_window   : if True, push result into rolling window

        All outputs are clipped to physical limits to prevent cascade failures.
        """
        # Heal the lag window before using it as features
        self._sanitize_window()

        if self.model_type == 'xgboost':
            fv   = self._build_feature_vector(op_values)
            X    = fv.reshape(1, -1)
            if self.sc_X is not None:
                X = self.sc_X.transform(X)
            Y    = self.model.predict(X)[0]
            energy, purity, butane = float(Y[0]), float(Y[1]), float(Y[2])
        else:
            energy = _TARGET_BASELINE['Target_Energy']
            purity = _TARGET_BASELINE['Target_Purity_Pct']
            butane = _TARGET_BASELINE['Target_Butane_Flow']

        # Always clip to physical limits — prevents cascade if model extrapolates
        energy = float(np.clip(energy, *_ENERGY_RANGE))
        purity = float(np.clip(purity, *_PURITY_RANGE))
        butane = float(np.clip(butane, *_BUTANE_RANGE))

        if update_window:
            self._pred_window.append((energy, purity, butane))
        return energy, purity, butane

    def simulate_trajectory(self, op_values: dict, steps: int = 3) -> list:
        """
        Simulate process trajectory after applying recommended OP.
        Rolls predictions forward `steps` time steps.

        Returns list of dicts: [{energy, purity, butane, step}, ...]
        """
        # Save current window state
        saved_window = list(self._pred_window)

        trajectory = []
        for step in range(1, steps + 1):
            e, p, b = self.predict_at_op(op_values, update_window=True)
            trajectory.append({
                'step'  : step,
                'energy': round(e, 4),
                'purity': round(p, 4),
                'butane': round(b, 4),
            })

        # Restore window (simulation should not affect live state)
        self._pred_window.clear()
        for item in saved_window:
            self._pred_window.append(item)

        return trajectory

    def get_current_lag_state(self) -> dict:
        """Return current rolling window state as a snapshot."""
        window = list(self._pred_window)
        return {
            'energy_lag1': window[-1][0], 'energy_lag2': window[-2][0], 'energy_lag3': window[-3][0],
            'purity_lag1': window[-1][1], 'purity_lag2': window[-2][1], 'purity_lag3': window[-3][1],
            'butane_lag1': window[-1][2], 'butane_lag2': window[-2][2], 'butane_lag3': window[-3][2],
        }

    # ── Internal helpers ──────────────────────────────────────────────────────
    def _predict_xgb(self, readings: list):
        op_values = self._extract_op_from_readings(readings)
        return self.predict_at_op(op_values, update_window=False)

    def _dummy_predict(self, readings: list):
        r      = np.array(readings, dtype=float)
        energy = float(np.clip(996.4 + 50 * (np.std(r) / (np.mean(r) + 1e-6)), 600, 1800))
        purity = float(np.clip(98.45 - 0.5 * float(np.abs(r - r.mean()).max() /
                               (r.mean() + 1e-6)), 85.0, 99.9))
        butane = float(np.clip(3.17 * (purity / 98.45), 1.5, 6.0))
        return energy, purity, butane

    @property
    def op_bounds(self) -> dict:
        """Safe OP bounds per controller."""
        return {
            '2TIC403.OP - Snapshot': (20.0, 80.0),
            '2FIC419.OP - Snapshot': (10.0, 90.0),
            '2LIC409.OP - Snapshot': (10.0, 90.0),
            '2LIC412.OP - Snapshot': (10.0, 80.0),
            '2PIC409.OP - Snapshot': (10.0, 80.0),
        }

    @property
    def op_display(self) -> list:
        """Human-readable OP variable descriptions."""
        return [
            {'col': '2TIC403.OP - Snapshot', 'tag': '2TIC403.OP', 'name': 'Bottom temp controller',    'unit': '%'},
            {'col': '2FIC419.OP - Snapshot', 'tag': '2FIC419.OP', 'name': 'Feed flow controller',      'unit': '%'},
            {'col': '2LIC409.OP - Snapshot', 'tag': '2LIC409.OP', 'name': 'Reflux drum level ctrl',    'unit': '%'},
            {'col': '2LIC412.OP - Snapshot', 'tag': '2LIC412.OP', 'name': 'Bottom level controller',   'unit': '%'},
            {'col': '2PIC409.OP - Snapshot', 'tag': '2PIC409.OP', 'name': 'Column pressure controller','unit': '%'},
        ]


# Module-level singleton
model_wrapper = ModelWrapper()

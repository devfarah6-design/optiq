"""
OPTIQ DSS · Shared Problem Definition
All algorithms import this module — single source of truth for bounds,
setpoint indices, model calls, and the objective function.
"""
import sys
import os
import numpy as np
from typing import Tuple, List
from collections import deque

# ── Setpoint bounds ────────────────────────────────────────────────────────────
# Each setpoint: (name, min, max, nominal, unit, index_in_33_readings)
#   INDEX = which column in your DC4 dataset this setpoint corresponds to
#   → run: for i,col in enumerate(df.columns): print(i, col)
#   → then update the indices below

SETPOINTS = [
    {
        'tag':     '2FI422.SP',
        'name':    'Steam flow to reboiler',
        'unit':    'kg/h',
        'min':     2500.0,
        'max':     3500.0,
        'nominal': 3000.0,
        'index':   3,        # ← index in 33-sensor reading (2FI422.PV is at index 3)
    },
    {
        'tag':     '2TI1_414.SP',
        'name':    'Reflux temperature setpoint',
        'unit':    '°C',
        'min':     68.0,
        'max':     80.0,
        'nominal': 74.0,
        'index':   4,        # ← index in 33-sensor reading (2TI1_414.PV is at index 4)
    },
    {
        'tag':     '2TIC403.SP',
        'name':    'Bottom temperature setpoint',
        'unit':    '°C',
        'min':     88.0,
        'max':     100.0,
        'nominal': 94.0,
        'index':   0,        # ← index in 33-sensor reading (2TIC403.PV is at index 0)
    },
]

N_VAR     = len(SETPOINTS)
BOUNDS_LO = np.array([sp['min'] for sp in SETPOINTS])
BOUNDS_HI = np.array([sp['max'] for sp in SETPOINTS])
NOMINALS  = np.array([sp['nominal'] for sp in SETPOINTS])

# Number of features the model expects
N_FEATURES = 33


# ── Local model wrapper (no dependency on app.config) ─────────────────────────
class LocalModelWrapper:
    """
    Standalone model loader – looks for models in ./models/ (same folder as this file).
    Supports XGBoost (.pkl) and GRU (.keras + _meta.pkl).
    Falls back to a physics‑based dummy if no model is found.
    """

    def __init__(self, model_path: str = None):
        # Auto‑detect model in the default location if no path given
        if model_path is None:
            # MODIFIED: models folder is now in the same directory as this file
            base_dir = os.path.join(os.path.dirname(__file__), 'models')
            xgb_path = os.path.join(base_dir, 'best_xgb_model.pkl')
            gru_path = os.path.join(base_dir, 'best_gru_model.keras')
            gru_meta = os.path.join(base_dir, 'best_gru_meta.pkl')

            if os.path.isfile(xgb_path):
                model_path = xgb_path
            elif os.path.isfile(gru_path) and os.path.isfile(gru_meta):
                model_path = gru_path
            else:
                model_path = None

        self.model = None
        self.scaler_X = None
        self.scaler_Y = None
        self.feature_names = []
        self.target_names = ['Target_Energy', 'Target_Purity_Pct']
        self.n_features = N_FEATURES
        self.n_steps = 1
        self.model_type = "dummy"
        self.model_family = "dummy"
        self._window = deque()

        if model_path and os.path.exists(model_path):
            self._load_model(model_path)
        else:
            print("⚠ No model file found – using physics dummy model")

    def _load_model(self, path: str):
        if path.endswith('.pkl'):
            self._load_xgb(path)
        elif path.endswith('.keras'):
            meta_path = path.replace('.keras', '_meta.pkl')
            if not os.path.exists(meta_path):
                meta_path = os.path.join(os.path.dirname(path), 'best_gru_meta.pkl')
            self._load_gru(path, meta_path)
        else:
            print(f"⚠ Unknown model type: {path} – using dummy")

    def _load_xgb(self, path: str):
        try:
            import joblib
            bundle = joblib.load(path)

            self.model = bundle['model']          # MultiOutputRegressor
            self.scaler_X = bundle.get('scaler_X')
            self.scaler_Y = bundle.get('scaler_Y')
            self.feature_names = bundle.get('feature_names', [])
            self.target_names = bundle.get('target_names', self.target_names)
            self.n_features = bundle.get('n_features', len(self.feature_names))
            self.n_steps = 1
            self.model_type = "xgboost"
            self.model_family = "XGBoost"

            m = bundle.get('metrics', {})
            print(f"✓ Loaded XGBoost model from {path} | "
                  f"R² Energy={m.get('R2_Energy','?')} "
                  f"R² Purity={m.get('R2_Purity','?')}")
        except Exception as e:
            print(f"Failed to load XGBoost model: {e} – using dummy")
            self.model_type = "dummy"

    def _load_gru(self, weights_path: str, meta_path: str):
        try:
            import joblib
            from tensorflow.keras.models import load_model

            meta = joblib.load(meta_path)
            self.scaler_X = meta.get('scaler_X')
            self.scaler_Y = meta.get('scaler_Y')
            self.feature_names = meta.get('feature_names', [])
            self.target_names = meta.get('target_names', self.target_names)
            self.n_features = meta.get('n_features', N_FEATURES)
            self.n_steps = meta.get('n_steps', 6)

            self.model = load_model(weights_path)
            self.model_type = "gru"
            self.model_family = "GRU"

            # Initialise rolling window with zeros
            self._window = deque([np.zeros(self.n_features)] * self.n_steps,
                                 maxlen=self.n_steps)

            m = meta.get('metrics', {})
            print(f"✓ Loaded GRU model from {weights_path} | "
                  f"R² Energy={m.get('R2_Energy','?')} "
                  f"R² Purity={m.get('R2_Purity','?')}")
        except Exception as e:
            print(f"Failed to load GRU model: {e} – using dummy")
            self.model_type = "dummy"

    def predict(self, readings: list) -> dict:
        """
        readings : list[float] — raw sensor values, length = n_features
        Returns  : dict with 'energy' and 'purity' keys
        """
        raw = np.array(readings, dtype=float)

        if self.model_type == "xgboost":
            energy, purity = self._predict_xgb(raw)
        elif self.model_type == "gru":
            energy, purity = self._predict_gru(raw)
        else:
            energy, purity = self._dummy_predict(readings)

        return {"energy": float(energy), "purity": float(purity)}

    def _predict_xgb(self, raw: np.ndarray):
        X = raw.reshape(1, -1)
        if self.scaler_X is not None:
            try:
                X = self.scaler_X.transform(X)
            except Exception as e:
                print(f"scaler_X transform failed: {e}")

        Y_scaled = self.model.predict(X)   # shape (1, 2)

        if self.scaler_Y is not None:
            try:
                Y = self.scaler_Y.inverse_transform(Y_scaled)
            except Exception as e:
                print(f"scaler_Y inverse failed: {e}")
                Y = Y_scaled
        else:
            Y = Y_scaled

        return Y[0, 0], Y[0, 1]

    def _predict_gru(self, raw: np.ndarray):
        # Scale the new reading
        X_scaled = raw.reshape(1, -1)
        if self.scaler_X is not None:
            try:
                X_scaled = self.scaler_X.transform(X_scaled)
            except Exception as e:
                print(f"scaler_X transform failed: {e}")

        # Push into rolling window
        self._window.append(X_scaled[0])

        # Build sequence (1, n_steps, n_features)
        seq = np.array(list(self._window), dtype=np.float32)
        seq = seq.reshape(1, self.n_steps, self.n_features)

        Y_scaled = self.model.predict(seq, verbose=0)

        if self.scaler_Y is not None:
            try:
                Y = self.scaler_Y.inverse_transform(Y_scaled)
            except Exception as e:
                print(f"scaler_Y inverse failed: {e}")
                Y = Y_scaled
        else:
            Y = Y_scaled

        return Y[0, 0], Y[0, 1]

    def _dummy_predict(self, readings: list):
        """Physics‑inspired fallback – never crashes."""
        r = np.array(readings, dtype=float)
        energy = 1.15 + 0.3 * (np.std(r) / (np.mean(r) + 1e-6))
        purity = 99.0 - 0.5 * float(np.abs(r - r.mean()).max() / (r.mean() + 1e-6))
        return np.clip(energy, 0.8, 2.5), np.clip(purity, 85.0, 99.9)


# ── Model interface (replaces old app.model_loader) ──────────────────────────
_model_loaded = False
_model = None

def _load_model():
    global _model, _model_loaded
    if _model_loaded:
        return _model

    # MODIFIED: models directory is now inside optimization_study/
    models_dir = os.path.join(os.path.dirname(__file__), 'models')
    xgb_path = os.path.join(models_dir, 'best_xgb_model.pkl')

    try:
        if os.path.exists(xgb_path):
            print(f"✓ Found model at {xgb_path} – loading...")
            _model = LocalModelWrapper(xgb_path)
        else:
            print(f"⚠ Model not found at {xgb_path} – trying auto‑detection")
            _model = LocalModelWrapper()   # auto‑detect (also looks in same folder)
        _model_loaded = True
        print("✓ Using local model (XGBoost/GRU or physics dummy)")
    except Exception as e:
        _model = None
        _model_loaded = True
        print(f"⚠ Failed to initialise local model: {e} – falling back to dummy")
    return _model


# ── Helper: build 33‑element readings vector ─────────────────────────────────
def build_readings(setpoints: np.ndarray, base_readings: list = None) -> list:
    """
    Build a 33-element readings vector by injecting the 3 setpoints
    into a base readings vector.
    """
    if base_readings is None:
        # Use nominals as baseline for all other sensors
        readings = [0.0] * N_FEATURES
        # Fill with typical DC4 operating values
        defaults = {
            0:  94.0,   # 2TIC403.PV
            1:  52.0,   # 2TIC403.OP
            2:  94.0,   # 2TI1_428.PV
            3:  3000.0, # 2FI422.PV
            4:  74.0,   # 2TI1_414.PV
            5:  25.0,   # 2FIC419.PV
            6:  48.0,   # 2FIC419.OP
            7:  18.0,   # 2FI449A.PV
            8:  12.0,   # 2FI431.PV
            9:  50.0,   # 2LIC409.OP
            10: 52.0,   # 2LIC409.PV
            11: 48.0,   # 2LIC412.OP
            12: 50.0,   # 2LIC412.PV
            13: 50.0,   # 2LI410A.PV
            14: 45.0,   # 2PIC409.OP
            15: 6.2,    # 2PIC409.PV
            16: 74.0,   # 2TI1_414.PV_temp
            17: 76.0,   # 2TI1_415.DACA.PV
            18: 81.0,   # 2TI1_416.DACA.PV
            19: 85.0,   # 2TI1_417.PV
            20: 94.2,   # 2TI1_428.PV_temp
            21: 88.0,   # 2TI1_429.PV
            22: 64.0,   # 2TI1_441.DACA.PV
            23: 67.0,   # 2TI1_409.PV
            24: 40.0,   # FI_FEED
            25: 55.0,   # TI_FEED
            26: 42.0,   # TI_CONDENSER
            27: 85.0,   # FI_COOLING
            28: 35.0,   # TI_CW_OUT
            29: 8.5,    # PI_FEED
            30: 105.0,  # TI_REBOILER
            31: 2950.0, # FI_STEAM_COND
            32: 0.35,   # AI_BUTANE_C5
        }
        for idx, val in defaults.items():
            readings[idx] = val
    else:
        readings = list(base_readings)

    # Inject the 3 setpoints
    for i, sp in enumerate(SETPOINTS):
        readings[sp['index']] = float(setpoints[i])

    return readings


def evaluate(setpoints: np.ndarray, base_readings: list = None) -> Tuple[float, float]:
    """
    Core evaluation function used by ALL algorithms.

    Parameters
    ----------
    setpoints : array [steam_flow, reflux_temp, bottom_temp]
    base_readings : optional 33-element context vector

    Returns
    -------
    (energy, purity) — both as floats
    """
    readings = build_readings(setpoints, base_readings)
    model = _load_model()

    if model is not None:
        result = model.predict(readings)
        return float(result['energy']), float(result['purity'])
    else:
        # Physics dummy (in case model loading truly fails)
        e = 1.15 + 0.001 * (setpoints[0] - 3000) / 1000   # steam ↑ → energy ↑
        p = 95.0 + 0.05 * (setpoints[2] - 88)              # bottom temp ↑ → purity ↑
        p -= 0.02 * abs(setpoints[1] - 74)                  # reflux deviation → purity ↓
        return float(np.clip(e, 0.8, 2.5)), float(np.clip(p, 85.0, 99.9))


def scalar_objective(setpoints: np.ndarray,
                      w_energy: float = 0.6,
                      w_purity: float = 0.4,
                      base_readings: list = None) -> float:
    """
    Weighted-sum scalar objective for single-objective algorithms.
    Minimise: w_energy * energy - w_purity * (purity / 100)
    """
    energy, purity = evaluate(setpoints, base_readings)
    return w_energy * energy - w_purity * (purity / 100.0)


def get_nominal_performance() -> Tuple[float, float]:
    """Return energy and purity at nominal setpoints (current operation)."""
    return evaluate(NOMINALS)


# ── Result container ──────────────────────────────────────────────────────────
class OptResult:
    """Unified result object returned by every algorithm."""

    def __init__(
        self,
        algorithm:          str,
        best_setpoints:     np.ndarray,
        best_energy:        float,
        best_purity:        float,
        runtime_s:          float,
        n_evaluations:      int,
        pareto_F:           np.ndarray = None,   # (n_solutions, 2) — MO algorithms only
        pareto_X:           np.ndarray = None,   # (n_solutions, 3)
        convergence:        list       = None,   # best objective per generation
        seed:               int        = 42,
    ):
        self.algorithm      = algorithm
        self.best_setpoints = best_setpoints
        self.best_energy    = best_energy
        self.best_purity    = best_purity
        self.runtime_s      = runtime_s
        self.n_evaluations  = n_evaluations
        self.pareto_F       = pareto_F
        self.pareto_X       = pareto_X
        self.convergence    = convergence or []
        self.seed           = seed

        nominal_e, nominal_p = get_nominal_performance()
        self.energy_savings_pct    = (nominal_e - best_energy) / (nominal_e + 1e-9) * 100
        self.purity_improvement_pct = (best_purity - nominal_p) / (nominal_p + 1e-9) * 100

    def summary(self) -> dict:
        return {
            'algorithm':             self.algorithm,
            'best_steam_kg_h':       round(float(self.best_setpoints[0]), 1),
            'best_reflux_temp_C':    round(float(self.best_setpoints[1]), 2),
            'best_bottom_temp_C':    round(float(self.best_setpoints[2]), 2),
            'best_energy':           round(self.best_energy, 4),
            'best_purity_pct':       round(self.best_purity, 2),
            'energy_savings_pct':    round(self.energy_savings_pct, 2),
            'purity_improvement_pct': round(self.purity_improvement_pct, 3),
            'runtime_s':             round(self.runtime_s, 2),
            'n_evaluations':         self.n_evaluations,
            'pareto_solutions':      len(self.pareto_F) if self.pareto_F is not None else 1,
        }

    def __repr__(self):
        return (
            f"[{self.algorithm}]  "
            f"E={self.best_energy:.4f} kg/kg  "
            f"P={self.best_purity:.2f}%  "
            f"savings={self.energy_savings_pct:.1f}%  "
            f"t={self.runtime_s:.1f}s  "
            f"evals={self.n_evaluations}"
        )
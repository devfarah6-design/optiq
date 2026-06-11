"""
OPTIQ DSS · Problem Definition  (FINAL v3)
============================================
DC4 Butane Debutanizer — Setpoint Optimization

HOW THIS CONNECTS TO YOUR RNN NOTEBOOK
────────────────────────────────────────────────────────────────────
Your RNN notebook (Cell 8) trains XGBoost on RAW (unscaled) features
and saves to:
  data/models/best_xgb_surrogate.pkl

The pkl contains:
  model     → XGBoost MultiOutputRegressor (trained on RAW values)
  feat_cols → exactly 167 column names the model expects
  targets   → ['Target_Energy', 'Target_Purity_Pct', 'Target_Butane']
  n_lags    → 6

This file builds the correct 167-feature input vector for that model
by reading the last 6 rows of real plant data from your CSV.

WHAT WE OPTIMISE (the 5 setpoints):
  2TIC403.OP  bottom temperature controller output  (20–80 %)
  2FIC419.OP  reflux flow controller output         (10–90 %)
  2LIC409.OP  bottom level controller output        (10–90 %)
  2LIC412.OP  condensate level controller output    (10–80 %)
  2PIC409.OP  overhead pressure controller output   (10–80 %)

SETUP — two lines to check:
  Line ~40:  SURROGATE_PATH  → path to best_xgb_surrogate.pkl from your RNN notebook
  Line ~46:  MBASE_CSV_PATH  → path to data_combined_db2.csv
"""

import os
import numpy as np
import pandas as pd
import joblib
import warnings
from typing import Tuple, Optional

warnings.filterwarnings('ignore')

# ══════════════════════════════════════════════════════════════════════════════
# ★ CONFIGURE THESE TWO PATHS  (only things you need to change)
# ══════════════════════════════════════════════════════════════════════════════

# Path to the pkl saved by Cell 8 of your RNN notebook
SURROGATE_PATH = r"C:\Users\A\Downloads\memoir_master2_fract\data\models\best_xgb_surrogate.pkl"

# Path to the CSV used when training the XGBoost (the notebook uses db2, not db1)
MBASE_CSV_PATH = r"C:\Users\A\Downloads\memoir_master2_fract\data\mbase\data_combined_db2.csv"

# ══════════════════════════════════════════════════════════════════════════════
# SETPOINTS  — the 5 controller outputs we optimise (values in %)
# ══════════════════════════════════════════════════════════════════════════════

SETPOINTS = [
    {'tag': '2TIC403.OP - Snapshot', 'name': 'Bottom temp controller',  'unit': '%', 'min': 20.0, 'max': 80.0, 'nominal': 52.0},
    {'tag': '2FIC419.OP - Snapshot', 'name': 'Reflux flow controller',  'unit': '%', 'min': 10.0, 'max': 90.0, 'nominal': 48.0},
    {'tag': '2LIC409.OP - Snapshot', 'name': 'Bottom level controller', 'unit': '%', 'min': 10.0, 'max': 90.0, 'nominal': 50.0},
    {'tag': '2LIC412.OP - Snapshot', 'name': 'Condensate level ctrl',   'unit': '%', 'min': 10.0, 'max': 80.0, 'nominal': 48.0},
    {'tag': '2PIC409.OP - Snapshot', 'name': 'Pressure controller',     'unit': '%', 'min': 10.0, 'max': 80.0, 'nominal': 45.0},
]

N_VAR     = len(SETPOINTS)
BOUNDS_LO = np.array([sp['min']     for sp in SETPOINTS])
BOUNDS_HI = np.array([sp['max']     for sp in SETPOINTS])
NOMINALS  = np.array([sp['nominal'] for sp in SETPOINTS])
SP_TAGS   = [sp['tag'] for sp in SETPOINTS]

# ══════════════════════════════════════════════════════════════════════════════
# SURROGATE MODEL  (lazy-loaded once, cached globally)
# ══════════════════════════════════════════════════════════════════════════════

_bundle       = None
_feat_cols    = None   # list[str] — 167 column names the model expects
_base_cols    = None   # list[str] — 27 unique base columns (before lag suffix)
_curr_op_cols = None   # list[str] — 5 current OP column names
_n_lags       = None   # int       — 6


def _load_surrogate():
    """Load pkl once and cache. Raises FileNotFoundError with a clear message."""
    global _bundle, _feat_cols, _base_cols, _curr_op_cols, _n_lags

    if _bundle is not None:
        return _bundle

    if not os.path.exists(SURROGATE_PATH):
        raise FileNotFoundError(
            f"\n\n  ❌  Surrogate model not found:\n"
            f"      {SURROGATE_PATH}\n\n"
            f"  Fix: open problem.py and update SURROGATE_PATH to the path where\n"
            f"       your RNN notebook (Cell 8) saved best_xgb_surrogate.pkl.\n"
            f"       It should be in:  data/models/best_xgb_surrogate.pkl\n"
        )

    _bundle = joblib.load(SURROGATE_PATH)

    _feat_cols    = _bundle['feat_cols']
    _n_lags       = _bundle['n_lags']
    _curr_op_cols = [c for c in _feat_cols if '_lag' not in c]
    _base_cols    = [c.replace('_lag1', '') for c in _feat_cols if c.endswith('_lag1')]

    print(f"✓ Surrogate loaded  ({len(_feat_cols)} features, {_n_lags} lags)")
    print(f"  Targets : {_bundle['targets']}")
    return _bundle


# ══════════════════════════════════════════════════════════════════════════════
# HISTORICAL CONTEXT  (last 6 rows of real plant data)
# ══════════════════════════════════════════════════════════════════════════════

_hist_cache: Optional[pd.DataFrame] = None


def load_historical_context(csv_path: str = None, timestamp=None) -> Optional[pd.DataFrame]:
    """
    Load the last 6 rows from the mbase CSV as process history.

    The XGBoost was trained on real sensor sequences — without real history
    the lag features are filled with defaults and predictions are less accurate.

    Parameters
    ----------
    csv_path  : path to CSV (defaults to MBASE_CSV_PATH)
    timestamp : if given, load the 6 rows BEFORE this timestamp
                useful for backtesting: optimizer.evaluate_at("2024-04-15 08:00")

    Returns
    -------
    DataFrame with 6 rows, ordered oldest → newest (row[-1] = most recent = lag1)
    Returns None if CSV not found (falls back to defaults).
    """
    global _hist_cache

    _load_surrogate()   # ensure _base_cols is ready

    path = csv_path or MBASE_CSV_PATH
    if not os.path.exists(path):
        print(f"⚠  CSV not found: {path}")
        print("   Using default nominal values for historical context.")
        print("   Update MBASE_CSV_PATH in problem.py for real predictions.")
        return None

    try:
        df = pd.read_csv(path, parse_dates=['Timestamp'])
        df = df.sort_values('Timestamp').reset_index(drop=True)

        if timestamp is not None:
            df = df[df['Timestamp'] < pd.Timestamp(timestamp)]

        window = df.tail(_n_lags).copy().reset_index(drop=True)

        if len(window) == 0:
            print("⚠  CSV loaded but has no valid rows. Using defaults.")
            return None

        ts0 = window['Timestamp'].iloc[0]
        ts1 = window['Timestamp'].iloc[-1]
        print(f"✓ History loaded: {len(window)} rows  [{ts0}  →  {ts1}]")

        _hist_cache = window
        return window

    except Exception as ex:
        print(f"⚠  Failed to read CSV: {ex}")
        return None


def get_current_historical_context() -> Optional[pd.DataFrame]:
    """Return cached history, loading from CSV if not yet done."""
    global _hist_cache
    if _hist_cache is None:
        _hist_cache = load_historical_context()
    return _hist_cache


# ══════════════════════════════════════════════════════════════════════════════
# FEATURE VECTOR BUILDER
# ══════════════════════════════════════════════════════════════════════════════

# Fallback values when a column is missing from the CSV.
# These come from typical steady-state operation and match the training data range.
# Keys = exact base column names (as they appear in the pkl's feat_cols before _lagN)
_FALLBACK_VALUES: dict = {}  # populated lazily from the CSV median


def _get_fallback(base_col: str) -> float:
    """Return a sensible default for a missing column."""
    # Hard-coded process knowledge defaults (in physical units)
    defaults = {
        '2FI431.PV - Snapshot':            12.0,
        '2FIC419.PV - Snapshot':           25.0,
        '2FIC419.OP - Snapshot':           48.0,
        '2LI410A.PV - Snapshot':           50.0,
        '2LIC409.PV - Snapshot':           52.0,
        '2LIC409.OP - Snapshot':           50.0,
        '2LIC412.PV - Snapshot':           50.0,
        '2LIC412.OP - Snapshot':           48.0,
        '2PIC409.PV - Snapshot':            6.2,
        '2PIC409.OP - Snapshot':           45.0,
        '2TI1_409.PV - Snapshot':          67.0,
        '2TI1_414.PV - Snapshot':          74.0,
        '2TI1_414.PV_Dev':                  0.0,
        '2TI1_415.DACA.PV - Snapshot':     76.0,
        '2TI1_416.DACA.PV - Snapshot':     81.0,
        '2TI1_417.PV - Snapshot':          85.0,
        '2TI1_428.PV - Snapshot':          94.2,
        '2TI1_429.PV - Snapshot':          88.0,
        '2TI1_441.DACA.PV - Snapshot':     64.0,
        '2TIC403.PV - Snapshot':           94.0,
        '2TIC403.OP - Snapshot':           52.0,
        '2TIC403.PV_Dev':                   0.0,
        '2FI422.PV_Dev':                    0.0,
        'Row_All_Valid':                     1.0,
        'Hour':                             12.0,
        'DayOfWeek':                         2.0,
        'DayOfMonth':                       15.0,
    }
    return defaults.get(base_col, 0.0)


def build_feature_vector(
    setpoints: np.ndarray,
    historical_rows: Optional[pd.DataFrame] = None,
) -> np.ndarray:
    """
    Build the 167-feature input vector for the XGBoost surrogate.

    Feature layout (exactly matching what Cell 8 of the RNN notebook built):
    ┌────────────────────────────────────────────────────────────┐
    │  lag1 block (27 values): most recent row at t-1            │
    │  lag2 block (27 values): t-2                               │
    │  lag3 block (27 values): t-3                               │
    │  lag4 block (27 values): t-4                               │
    │  lag5 block (27 values): t-5                               │
    │  lag6 block (27 values): oldest row at t-6                 │
    │  current OP ( 5 values): the 5 setpoints we're testing NOW │
    └────────────────────────────────────────────────────────────┘

    Parameters
    ----------
    setpoints       : shape (5,) — [TIC403.OP, FIC419.OP, LIC409.OP, LIC412.OP, PIC409.OP] in %
    historical_rows : DataFrame with up to 6 rows, ordered oldest → newest.
                      Columns should include the base sensor names.
                      If None, uses default nominal values.

    Returns
    -------
    X : np.ndarray shape (1, 167)
    """
    _load_surrogate()

    feat_vec = np.zeros(len(_feat_cols), dtype=np.float64)

    # ── Fill lag blocks from historical data ─────────────────────────────────
    n_avail = len(historical_rows) if historical_rows is not None else 0

    for lag in range(1, _n_lags + 1):
        # lag=1 → most recent row (index = n_avail-1)
        # lag=6 → oldest row     (index = n_avail-6)
        row_idx = n_avail - lag

        for base_col in _base_cols:
            feat_name = f'{base_col}_lag{lag}'
            if feat_name not in _feat_cols:
                continue

            feat_idx = _feat_cols.index(feat_name)

            if row_idx >= 0 and historical_rows is not None:
                # Get value from actual historical row
                row = historical_rows.iloc[row_idx]
                val = row.get(base_col, None) if hasattr(row, 'get') else None
                if val is None or (isinstance(val, float) and np.isnan(val)):
                    val = _get_fallback(base_col)
            else:
                # Not enough history — use default
                val = _get_fallback(base_col)

            feat_vec[feat_idx] = float(val)

    # ── Fill current OP (positions 162–166 in the feature vector) ────────────
    for i, sp_tag in enumerate(SP_TAGS):
        if sp_tag in _feat_cols:
            feat_vec[_feat_cols.index(sp_tag)] = float(setpoints[i])

    return feat_vec.reshape(1, -1)    # shape (1, 167)


# ══════════════════════════════════════════════════════════════════════════════
# CORE EVALUATE  (called by every algorithm file)
# ══════════════════════════════════════════════════════════════════════════════

def evaluate(
    setpoints: np.ndarray,
    historical_rows: Optional[pd.DataFrame] = None,
    base_readings=None,              # ignored — kept for backward compatibility
) -> Tuple[float, float]:
    """
    Evaluate the surrogate model at a given setpoint combination.

    Parameters
    ----------
    setpoints : array (5,) — the 5 OP percentages to test

    Returns
    -------
    (energy, purity) :
        energy  in kg steam / m³ butane  (lower is better, nominal ~700–900)
        purity  in %                      (higher is better, target ≥ 95%)
    """
    bundle = _load_surrogate()
    sp     = np.clip(np.asarray(setpoints, dtype=float), BOUNDS_LO, BOUNDS_HI)

    # Use provided history, fall back to cached global, fall back to defaults
    hist = historical_rows if historical_rows is not None \
           else get_current_historical_context()

    X = build_feature_vector(sp, hist)

    try:
        Y = bundle['model'].predict(X)[0]   # [energy, purity, butane]
    except Exception as ex:
        print(f"  ⚠  Model predict failed: {ex}")
        return 700.0, 97.0

    energy = float(np.clip(Y[0], 10.0, 5000.0))   # wide bounds — don't hide real values
    purity = float(np.clip(Y[1],  0.0,  100.0))
    return energy, purity


def scalar_objective(
    setpoints: np.ndarray,
    w_energy: float = 0.6,
    w_purity: float = 0.4,
    base_readings=None,             # ignored — kept for backward compatibility
) -> float:
    """
    Single-objective weighted sum used by GA, DE, Bayesian.

    Minimise:  w_energy * energy  -  w_purity * (purity / 100)

    With w_energy=0.6 and w_purity=0.4:
      If energy=700 and purity=97%:  obj = 0.6×700 - 0.4×0.97 = 419.61
      Lower = better (less steam per m³ butane, higher purity).
    """
    energy, purity = evaluate(setpoints)
    return w_energy * energy - w_purity * (purity / 100.0)


def get_nominal_performance(historical_rows: Optional[pd.DataFrame] = None) -> Tuple[float, float]:
    """Return energy and purity at current nominal setpoints — the baseline to beat."""
    return evaluate(NOMINALS, historical_rows)


# ══════════════════════════════════════════════════════════════════════════════
# RESULT CONTAINER  (unchanged interface — all algorithm files work with this)
# ══════════════════════════════════════════════════════════════════════════════

class OptResult:
    def __init__(self, algorithm, best_setpoints, best_energy, best_purity,
                 runtime_s, n_evaluations, pareto_F=None, pareto_X=None,
                 convergence=None, seed=42):
        self.algorithm      = algorithm
        self.best_setpoints = np.asarray(best_setpoints)
        self.best_energy    = float(best_energy)
        self.best_purity    = float(best_purity)
        self.runtime_s      = float(runtime_s)
        self.n_evaluations  = int(n_evaluations)
        self.pareto_F       = pareto_F
        self.pareto_X       = pareto_X
        self.convergence    = convergence or []
        self.seed           = seed

        try:
            nom_e, nom_p = get_nominal_performance(get_current_historical_context())
        except Exception:
            nom_e, nom_p = 800.0, 97.0

        self.energy_savings_pct     = (nom_e - best_energy) / (nom_e + 1e-9) * 100.0
        self.purity_improvement_pct = (best_purity - nom_p) / (nom_p + 1e-9) * 100.0

    def summary(self) -> dict:
        d = {'algorithm': self.algorithm}
        for i, sp in enumerate(SETPOINTS):
            d[sp['tag'].replace(' - Snapshot', '')] = round(float(self.best_setpoints[i]), 2)
        d.update({
            'best_energy':            round(self.best_energy,  4),
            'best_purity_pct':        round(self.best_purity,  2),
            'energy_savings_pct':     round(self.energy_savings_pct,     2),
            'purity_improvement_pct': round(self.purity_improvement_pct, 3),
            'runtime_s':              round(self.runtime_s,    2),
            'n_evaluations':          self.n_evaluations,
            'pareto_solutions':       len(self.pareto_F) if self.pareto_F is not None else 1,
        })
        return d

    def __repr__(self):
        sp_str = '  '.join(
            f"{sp['tag'].replace(' - Snapshot','').replace('2','')[:8]}={self.best_setpoints[i]:.1f}%"
            for i, sp in enumerate(SETPOINTS)
        )
        return (
            f"[{self.algorithm[:22]}]  "
            f"E={self.best_energy:.1f}  P={self.best_purity:.2f}%  "
            f"saving={self.energy_savings_pct:.1f}%  "
            f"t={self.runtime_s:.1f}s  evals={self.n_evaluations}"
        )


# ══════════════════════════════════════════════════════════════════════════════
# SELF-TEST  (run this file directly to verify everything works)
# ══════════════════════════════════════════════════════════════════════════════

def run_diagnostics():
    print("\n" + "=" * 60)
    print("  problem.py — Self-diagnostic")
    print("=" * 60)

    print(f"\n[1] Loading surrogate from:")
    print(f"    {SURROGATE_PATH}")
    bundle = _load_surrogate()
    print(f"    Features: {len(_feat_cols)}  Lags: {_n_lags}  Targets: {bundle['targets']}")

    print(f"\n[2] Loading historical context from:")
    print(f"    {MBASE_CSV_PATH}")
    hist = load_historical_context()

    print(f"\n[3] Nominal prediction (setpoints at typical operating values):")
    for i, sp in enumerate(SETPOINTS):
        print(f"    {sp['tag']:38s} = {NOMINALS[i]:5.1f} {sp['unit']}")
    nom_e, nom_p = evaluate(NOMINALS, hist)
    print(f"\n    → Energy = {nom_e:.2f} kg/m³   (baseline to beat)")
    print(f"    → Purity = {nom_p:.3f}%")

    if nom_e < 50 or nom_p < 80:
        print(f"\n  ❌ Values look wrong (E<50 or P<80).")
        print(f"     Check that SURROGATE_PATH points to the pkl from your RNN notebook Cell 8.")
        print(f"     The correct pkl is at:  data/models/best_xgb_surrogate.pkl")
        return

    print(f"\n[4] Sensitivity test — varying TIC403.OP:")
    print(f"    {'TIC403.OP':>12}  {'Energy':>10}  {'Purity':>9}  {'vs nominal'}")
    for v in [20, 35, 52, 65, 80]:
        sp = NOMINALS.copy(); sp[0] = v
        e, p = evaluate(sp, hist)
        delta = nom_e - e
        trend = f"{'↓ SAVE' if delta > 5 else '↑ COST' if delta < -5 else '≈ same':>10} {abs(delta):.1f}"
        print(f"    {v:12.0f}%  {e:10.2f}  {p:8.3f}%  {trend}")

    print(f"\n[5] Quick check of all 5 setpoints (one at a time, rest at nominal):")
    for i, sp in enumerate(SETPOINTS):
        lo_sp = NOMINALS.copy(); lo_sp[i] = sp['min']
        hi_sp = NOMINALS.copy(); hi_sp[i] = sp['max']
        e_lo, _ = evaluate(lo_sp, hist)
        e_hi, _ = evaluate(hi_sp, hist)
        rng = abs(e_lo - e_hi)
        print(f"    {sp['tag'].replace(' - Snapshot',''):30s}  energy range = {rng:.1f}  "
              f"{'✅' if rng > 0.5 else '⚠  low'}")

    print(f"\n{'='*60}")
    print(f"  ✅  Diagnostic complete — ready to run:  python runner.py")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    run_diagnostics()
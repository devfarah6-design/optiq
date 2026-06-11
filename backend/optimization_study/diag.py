"""
diagnose.py  —  Run this BEFORE runner.py to verify everything works.

Usage:
    python diagnose.py

It checks every step in the chain and tells you exactly what to fix.
"""
import os, sys, warnings
import numpy as np
warnings.filterwarnings('ignore')

SEP = "─" * 60

def ok(msg):   print(f"  ✅  {msg}")
def err(msg):  print(f"  ❌  {msg}")
def warn(msg): print(f"  ⚠️   {msg}")
def info(msg): print(f"       {msg}")


print("=" * 60)
print("  DC4 Optimization — Full Diagnostic")
print("=" * 60)


# ══════════════════════════════════════════════════════════════════
# CHECK 1 — Can we import problem.py?
# ══════════════════════════════════════════════════════════════════
print(f"\n[1] Checking problem.py import...")
try:
    import problem as P
    ok(f"problem.py imported from: {P.__file__}")
    info(f"N_VAR     = {P.N_VAR}  (should be 5)")
    info(f"BOUNDS_LO = {P.BOUNDS_LO}")
    info(f"BOUNDS_HI = {P.BOUNDS_HI}")
    info(f"NOMINALS  = {P.NOMINALS}")

    if P.N_VAR == 3:
        err("N_VAR=3 — you are running the OLD problem.py, not the new one.")
        err("Replace problem.py with the corrected version (N_VAR should be 5).")
        sys.exit(1)
    elif P.N_VAR == 5:
        ok("N_VAR=5 — new problem.py is loaded.")
    else:
        warn(f"N_VAR={P.N_VAR} — unexpected value.")
except ImportError as e:
    err(f"Cannot import problem.py: {e}")
    sys.exit(1)

# ══════════════════════════════════════════════════════════════════
# CHECK 2 — Is best_xgb_surrogate.pkl findable?
# ══════════════════════════════════════════════════════════════════
print(f"\n[2] Locating best_xgb_surrogate.pkl...")

THIS_DIR = os.path.dirname(os.path.abspath(__file__))

search_paths = [
    os.path.join(THIS_DIR, 'models', 'best_xgb_surrogate.pkl'),
    os.path.join(THIS_DIR, 'best_xgb_surrogate.pkl'),
    os.path.join(THIS_DIR, '..', 'models', 'best_xgb_surrogate.pkl'),
    os.path.join(THIS_DIR, '..', 'data', 'models', 'best_xgb_surrogate.pkl'),
]

found_pkl = None
for p in search_paths:
    if os.path.exists(p):
        found_pkl = os.path.abspath(p)
        ok(f"Found pkl at: {found_pkl}")
        break
    else:
        info(f"Not found: {p}")

if found_pkl is None:
    err("best_xgb_surrogate.pkl not found in any expected location.")
    err("Place it in one of these locations:")
    for p in search_paths:
        info(f"  {p}")
    err("Then update SURROGATE_PATH in problem.py to match.")
    sys.exit(1)

# Check if problem.py's SURROGATE_PATH matches
info(f"problem.py SURROGATE_PATH = {P.SURROGATE_PATH}")
if not os.path.exists(P.SURROGATE_PATH):
    err(f"problem.py SURROGATE_PATH does not exist!")
    err(f"  Expected : {P.SURROGATE_PATH}")
    err(f"  Found at : {found_pkl}")
    err(f"  Fix: open problem.py and update SURROGATE_PATH to:")
    err(f"       SURROGATE_PATH = r\"{found_pkl}\"")
    sys.exit(1)
else:
    ok(f"problem.py SURROGATE_PATH exists and is valid.")

# ══════════════════════════════════════════════════════════════════
# CHECK 3 — Load and inspect the pkl
# ══════════════════════════════════════════════════════════════════
print(f"\n[3] Loading and inspecting pkl...")
try:
    import joblib
    bundle = joblib.load(found_pkl)
    ok(f"pkl loaded successfully")
    info(f"Keys in bundle: {list(bundle.keys())}")
    info(f"n_lags   = {bundle.get('n_lags', '???')}")
    info(f"targets  = {bundle.get('targets', '???')}")
    fc = bundle.get('feat_cols', [])
    info(f"feat_cols = {len(fc)} features")
    model = bundle.get('model')
    if model is None:
        err("'model' key is missing from pkl bundle!")
        sys.exit(1)
    else:
        ok(f"model type = {type(model).__name__}")
        n_feats = getattr(model.estimators_[0], 'n_features_in_', '?')
        info(f"model expects n_features_in_ = {n_feats}")
        if n_feats != 167:
            warn(f"Expected 167 features, got {n_feats}. This is a different pkl version.")
except Exception as e:
    err(f"Failed to load pkl: {e}")
    sys.exit(1)

# ══════════════════════════════════════════════════════════════════
# CHECK 4 — Test model directly with known-good input
# ══════════════════════════════════════════════════════════════════
print(f"\n[4] Testing model with known-good all-zeros input...")
try:
    X_zeros = np.zeros((1, len(fc)))
    Y = model.predict(X_zeros)[0]
    info(f"All-zeros → Energy={Y[0]:.4f}  Purity={Y[1]:.4f}%  Butane={Y[2]:.4f}")
    if Y[0] < 50:
        warn(f"Energy={Y[0]:.4f} is below 50.0 — model output unusually low")
    elif Y[0] > 100:
        ok(f"Energy={Y[0]:.4f} looks reasonable (expected 450–900 kg/m³)")
    if Y[1] < 80:
        warn(f"Purity={Y[1]:.4f} is below 80% — model output unusually low")
    elif Y[1] > 90:
        ok(f"Purity={Y[1]:.4f}% looks reasonable (expected 95–100%)")
except Exception as e:
    err(f"Model predict failed: {e}")
    sys.exit(1)

# ══════════════════════════════════════════════════════════════════
# CHECK 5 — Test build_feature_vector
# ══════════════════════════════════════════════════════════════════
print(f"\n[5] Testing build_feature_vector with nominal setpoints...")
try:
    X_built = P.build_feature_vector(P.NOMINALS, historical_rows=None)
    info(f"Feature vector shape: {X_built.shape}")
    info(f"Non-zero features: {np.count_nonzero(X_built)} / {X_built.shape[1]}")
    info(f"Min value: {X_built.min():.4f}   Max value: {X_built.max():.4f}")
    if np.isnan(X_built).any():
        err("Feature vector contains NaN values!")
    elif np.isinf(X_built).any():
        err("Feature vector contains Inf values!")
    else:
        ok("Feature vector is clean (no NaN/Inf)")

    Y_built = model.predict(X_built)[0]
    info(f"Prediction → Energy={Y_built[0]:.4f}  Purity={Y_built[1]:.4f}%")

    if Y_built[0] <= 50:
        err(f"Energy = {Y_built[0]:.4f} ≤ 50 → will clip to 50.0 (THIS IS YOUR BUG)")
        err("The feature vector being built is causing wrong model output.")
        err("Most likely: wrong values injected at wrong feature indices.")
    elif Y_built[0] > 50:
        ok(f"Energy = {Y_built[0]:.4f} > 50.0 — will NOT be clipped")

    if Y_built[1] <= 80:
        err(f"Purity = {Y_built[1]:.4f} ≤ 80 → will clip to 80.0 (THIS IS YOUR BUG)")
    elif Y_built[1] > 80:
        ok(f"Purity = {Y_built[1]:.4f}% > 80.0 — will NOT be clipped")

except AttributeError:
    err("build_feature_vector() not found in problem.py — you are using the OLD version!")
    err("Replace problem.py with the new corrected version.")
    sys.exit(1)
except Exception as e:
    import traceback
    err(f"build_feature_vector failed: {e}")
    traceback.print_exc()
    sys.exit(1)

# ══════════════════════════════════════════════════════════════════
# CHECK 6 — Test evaluate() — the function all algorithms call
# ══════════════════════════════════════════════════════════════════
print(f"\n[6] Testing evaluate(NOMINALS)...")
try:
    e, p = P.evaluate(P.NOMINALS)
    info(f"evaluate(NOMINALS) → Energy={e:.4f}  Purity={p:.4f}%")
    if e == 50.0 and p == 80.0:
        err("evaluate() returns CLIPPED values (50.0, 80.0) — model is broken for this input.")
        err("Re-check SURROGATE_PATH in problem.py and run this diagnostic again.")
    elif e > 100 and p > 90:
        ok(f"evaluate() returns reasonable values — model is working correctly!")
    else:
        warn(f"Values look unusual. Energy should be 400–900 kg/m³, Purity should be 95–100%.")
except Exception as e_:
    err(f"evaluate() raised an exception: {e_}")
    import traceback; traceback.print_exc()
    sys.exit(1)

# ══════════════════════════════════════════════════════════════════
# CHECK 7 — Sensitivity test (the key test for thesis)
# ══════════════════════════════════════════════════════════════════
print(f"\n[7] Sensitivity test — varying TIC403.OP (bottom temp controller)...")
nom = P.NOMINALS.copy()
print(f"  {'TIC403.OP':>12}  {'Energy':>10}  {'Purity':>10}  {'Status'}")
print(f"  {'─'*12}  {'─'*10}  {'─'*10}  {'─'*12}")
energies, purities = [], []
for v in [20, 35, 52, 65, 80]:
    sp = nom.copy()
    sp[0] = v   # TIC403.OP is index 0
    e, p = P.evaluate(sp)
    energies.append(e); purities.append(p)
    status = "✅" if e > 100 else "❌ CLIPPED"
    print(f"  {v:12.0f}%  {e:10.2f}  {p:9.3f}%  {status}")

energy_range = max(energies) - min(energies)
purity_range = max(purities) - min(purities)
print()
if energy_range > 20:
    ok(f"Energy range = {energy_range:.2f} — model IS sensitive to TIC403.OP changes")
elif energy_range > 0:
    warn(f"Energy range = {energy_range:.2f} — model has LOW sensitivity (expected >20)")
else:
    err(f"Energy range = 0 — model is NOT responding to setpoint changes!")
    err("This means the lag features dominate and OP changes have no effect.")
    err("Try loading real historical data with load_historical_context().")

# ══════════════════════════════════════════════════════════════════
# CHECK 8 — Historical CSV (optional)
# ══════════════════════════════════════════════════════════════════
print(f"\n[8] Checking historical CSV path...")
csv_path = P.MBASE_CSV_PATH
if os.path.exists(csv_path):
    import pandas as pd
    df = pd.read_csv(csv_path, nrows=3)
    ok(f"CSV found: {csv_path}")
    info(f"Columns: {list(df.columns)[:5]}...")
    info(f"Loading last 6 rows as historical context...")
    hist = P.load_historical_context(csv_path)
    if hist is not None:
        e_hist, p_hist = P.evaluate(P.NOMINALS, hist)
        info(f"With real history: Energy={e_hist:.4f}  Purity={p_hist:.4f}%")
        ok("Historical data loaded and working!")
    else:
        warn("load_historical_context returned None — falling back to defaults")
else:
    warn(f"CSV not found: {csv_path}")
    warn("Update MBASE_CSV_PATH in problem.py to point to data_combined_db1.csv")
    warn("The optimizer will use default nominal values for lag features (still works).")

# ══════════════════════════════════════════════════════════════════
# FINAL SUMMARY
# ══════════════════════════════════════════════════════════════════
print(f"\n{'='*60}")
e_final, p_final = P.evaluate(P.NOMINALS)
if e_final > 100 and p_final > 90:
    print("  ✅  ALL CHECKS PASSED — ready to run:  python runner.py")
else:
    print("  ❌  ISSUES FOUND — fix them before running runner.py")
    print()
    print("  Most common fixes:")
    print("  1. Copy best_xgb_surrogate.pkl into optimization_study/models/")
    print("  2. Make sure problem.py is the NEW version (N_VAR=5, OP setpoints)")
    print("  3. Run:  python diagnose.py  again to confirm fix")
print(f"{'='*60}")
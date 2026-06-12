"""
OPTIQ DSS - Optimiser  (v4 - DE + FOPDT simulation)
"""
import math
import logging
import warnings
import numpy as np
from scipy.optimize import differential_evolution
from app.model_loader import model_wrapper
from app import schemas

warnings.filterwarnings('ignore')
logger = logging.getLogger(__name__)

W_ENERGY         = 0.60
W_PURITY         = 0.35
W_BUTANE         = 0.05
PURITY_PENALTY   = 0.30
MIN_PURITY       = 95.0
MOVE_SUPPRESSION = 0.03

DE_POP_SIZE  = 15
DE_MAX_ITER  = 100
DE_F         = 0.8
DE_CR        = 0.9
DE_STRATEGY  = 'best1bin'
DE_TOL       = 1e-6
DE_POLISH    = True
DE_SEED      = 42

# FOPDT defaults - DC4 Butane Debutanizer
# K=process gain (PV unit/% OP), tau=time constant (s), theta=dead time (s)
# pv_nom=nominal PV at 50% OP. Admin overrides via /config/fopdt
DEFAULT_FOPDT_PARAMS = [
    {"op_tag": "2TIC403.OP", "pv_tag": "2TIC403", "desc": "Bottom temperature controller",
     "unit": "degC", "K": 0.30, "tau": 1200.0, "theta": 180.0, "pv_nom": 94.0},
    {"op_tag": "2FIC419.OP", "pv_tag": "2FIC419", "desc": "Feed flow controller",
     "unit": "kg/h", "K": 10.0, "tau": 120.0,  "theta": 30.0,  "pv_nom": 3420.0},
    {"op_tag": "2LIC409.OP", "pv_tag": "2LIC409", "desc": "Reflux drum level controller",
     "unit": "%",    "K": 0.40, "tau": 360.0,  "theta": 60.0,  "pv_nom": 50.0},
    {"op_tag": "2LIC412.OP", "pv_tag": "2LIC412", "desc": "Bottom level controller",
     "unit": "%",    "K": 0.40, "tau": 600.0,  "theta": 90.0,  "pv_nom": 50.0},
]

DEFAULT_HORIZONS = [300, 900, 1800]  # +5 min, +15 min, +30 min


def _fopdt_settling(t, tau, theta):
    if t <= theta:
        return 0.0
    return 1.0 - math.exp(-(t - theta) / tau)


def _build_fopdt_lookup(fopdt_params, op_cols):
    lookup = {}
    for entry in fopdt_params:
        op_tag = entry.get("op_tag", "")
        for col in op_cols:
            if col == op_tag or op_tag in col or col in op_tag:
                lookup[col] = entry
                break
    return lookup


def _label(t_s):
    if t_s < 60:
        return "+{}s".format(t_s)
    elif t_s < 3600:
        return "+{} min".format(t_s // 60)
    else:
        h = t_s // 3600
        m = (t_s % 3600) // 60
        return "+{}h{:02d}m".format(h, m) if m else "+{}h".format(h)


def _get_op_bounds():
    op_disp = model_wrapper.op_display
    op_bnds = model_wrapper.op_bounds
    active  = [d for d in op_disp if d['col'] in (model_wrapper.op_cols or [])]
    if not active:
        active = op_disp
    cols = [d['col'] for d in active]
    lo   = np.array([op_bnds.get(c, (20.0, 80.0))[0] for c in cols])
    hi   = np.array([op_bnds.get(c, (20.0, 80.0))[1] for c in cols])
    return cols, lo, hi


def _op_vector_to_dict(op_vals, op_cols):
    return {col: float(v) for col, v in zip(op_cols, op_vals)}


def _current_op_from_readings(base_readings):
    if base_readings and len(base_readings) > 0:
        return model_wrapper._extract_op_from_readings(list(base_readings))
    from app.model_loader import _OP_NOMINALS
    return dict(_OP_NOMINALS)


def optimize(current_state, base_readings=None, n_trials=0, seed=DE_SEED):
    """DE optimiser with move suppression penalty."""
    op_cols, lo, hi = _get_op_bounds()

    current_op_dict     = _current_op_from_readings(base_readings)
    ce, cp, cb          = model_wrapper.predict_at_op(current_op_dict)
    ce = float(np.clip(ce, 100.0, 3000.0))
    cp = float(np.clip(cp,  80.0,  99.99))
    cb = float(np.clip(cb,   0.5,  10.0))
    current_ops_display = [current_op_dict.get(c, 50.0) for c in op_cols]
    current_ops_arr     = np.array(current_ops_display)

    logger.info("DE Opt start | E=%.2f P=%.2f%% B=%.3f", ce, cp, cb)

    def objective(x):
        op      = _op_vector_to_dict(x, op_cols)
        e, p, b = model_wrapper.predict_at_op(op)
        cost    = (
            W_ENERGY * e / (ce + 1e-9)
            - W_PURITY * p / 100.0
            - W_BUTANE * b / (cb + 1e-9)
        )
        if p < MIN_PURITY:
            cost += PURITY_PENALTY * (MIN_PURITY - p)
        span  = hi - lo + 1e-9
        delta = (x - current_ops_arr) / span
        cost += MOVE_SUPPRESSION * float(np.sum(delta ** 2)) / len(x)
        return float(cost)

    bounds = list(zip(lo.tolist(), hi.tolist()))
    result = differential_evolution(
        objective, bounds,
        strategy=DE_STRATEGY, maxiter=DE_MAX_ITER, popsize=DE_POP_SIZE,
        mutation=DE_F, recombination=DE_CR, tol=DE_TOL,
        seed=seed, polish=DE_POLISH, disp=False,
    )

    best_ops = np.clip(result.x, lo, hi)
    best_op  = _op_vector_to_dict(best_ops, op_cols)
    be, bp, bb = model_wrapper.predict_at_op(best_op)
    be = float(np.clip(be, 100.0, 3000.0))
    bp = float(np.clip(bp,  80.0,  99.99))
    bb = float(np.clip(bb,   0.5,  10.0))

    logger.info("DE done | E:%.2f->%.2f P:%.2f->%.2f%% nfev=%d", ce, be, cp, bp, result.nfev)
    return _build_result(current_state, current_ops_display, best_ops.tolist(), ce, cp, cb, be, bp, bb)


def _build_result(legacy_sp, current_ops, best_ops, ce, cp, cb, be, bp, bb):
    es = max(0.0, (ce - be) / (ce + 1e-9) * 100)
    pg = max(0.0, (bp - cp) / (cp + 1e-9) * 100)
    bg = max(0.0, (bb - cb) / (cb + 1e-9) * 100)

    if es > 5 and (pg > 0.3 or bg > 2):
        status = 'optimal'
    elif es > 1 or pg > 0.1 or bg > 1:
        status = 'warning'
    else:
        status = 'critical'

    if es < 0.1 and pg < 0.05 and bg < 0.5:
        best_ops = list(current_ops)
        be, bp, bb = ce, cp, cb
        status = 'critical'

    feasibility = float(min(1.0, es / 20.0 + pg / 2.0 + bg / 10.0))
    logger.info("Opt result | E:%.2f->%.2f (%.1f%% saved) P:%.2f->%.2f%% status=%s",
                ce, be, es, cp, bp, status)

    return schemas.OptimizeOut(
        current_setpoints          = list(current_ops),
        recommended_setpoints      = list(best_ops),
        current_energy             = ce,
        expected_energy            = be,
        energy_savings_percent     = float(es),
        current_purity             = cp,
        expected_purity            = bp,
        purity_improvement_percent = float(pg),
        current_butane             = cb,
        expected_butane            = bb,
        butane_improvement_percent = float(bg),
        status                     = status,
        feasibility_score          = feasibility,
    )


def simulate_after_apply(recommended_ops, current_ops=None, fopdt_params=None, horizons=None):
    """
    FOPDT-based post-apply simulation.

    At each time horizon the OP is blended between current and recommended
    using the FOPDT step response fraction. XGBoost predicts energy/purity
    at each intermediate state. DCS-readable PV values are returned so
    engineers can cross-check against their control room display.

    Why this is credible:
      - Uses real process dynamics (tau, theta per controller)
      - Shows a physically meaningful transition, not instant jump
      - Engineers can verify: "Is 2TIC403 at 94.8 degC after 15 min?"
    """
    fp       = fopdt_params or DEFAULT_FOPDT_PARAMS
    hz       = horizons     or DEFAULT_HORIZONS
    op_cols  = model_wrapper.op_cols or [d['col'] for d in model_wrapper.op_display]
    fopdt_lk = _build_fopdt_lookup(fp, op_cols)

    if current_ops and len(current_ops) >= len(op_cols):
        cur_op_dict = {col: float(current_ops[i]) for i, col in enumerate(op_cols)}
    else:
        from app.model_loader import _OP_NOMINALS
        cur_op_dict = dict(_OP_NOMINALS)

    rec_op_dict = {col: float(recommended_ops[i])
                   for i, col in enumerate(op_cols) if i < len(recommended_ops)}

    base_e, base_p, base_b = model_wrapper.predict_at_op(cur_op_dict)
    base_e = float(np.clip(base_e, 100.0, 3000.0))
    base_p = float(np.clip(base_p,  80.0,  99.99))
    base_b = float(np.clip(base_b,   0.5,  10.0))

    results = []
    for step_num, t_s in enumerate(hz, start=1):
        blended_op = {}
        tag_values = {}

        for col in op_cols:
            cur_val  = cur_op_dict.get(col, 50.0)
            rec_val  = rec_op_dict.get(col, cur_val)
            delta    = rec_val - cur_val
            entry    = fopdt_lk.get(col)

            if entry:
                tau      = float(entry.get("tau",   600.0))
                theta    = float(entry.get("theta",  60.0))
                K        = float(entry.get("K",       0.3))
                settling = _fopdt_settling(t_s, tau, theta)
                blended_op[col] = cur_val + delta * settling
                pv_nom   = float(entry.get("pv_nom", 50.0))
                tag_values[entry["pv_tag"]] = round(pv_nom + K * delta * settling, 2)
                tag_values[entry["op_tag"]] = round(blended_op[col], 1)
            else:
                settling        = min(1.0, t_s / 600.0)
                blended_op[col] = cur_val + delta * settling

        e, p, b = model_wrapper.predict_at_op(blended_op)
        e = float(np.clip(e, 100.0, 3000.0))
        p = float(np.clip(p,  80.0,  99.99))
        b = float(np.clip(b,   0.5,  10.0))

        results.append({
            "step":             step_num,
            "time_s":           t_s,
            "label":            _label(t_s),
            "energy":           round(e, 2),
            "purity":           round(p, 2),
            "butane":           round(b, 3),
            "energy_delta_pct": round((base_e - e) / (base_e + 1e-9) * 100, 2),
            "purity_delta_pct": round((p - base_p) / (base_p + 1e-9) * 100, 2),
            "tag_values":       tag_values,
        })

    logger.info("FOPDT sim | %s | E:%.2f->%.2f P:%.2f->%.2f%%",
                [_label(t) for t in hz], base_e, results[-1]["energy"],
                base_p, results[-1]["purity"])
    return results


def check_process_tracking(predicted_trajectory, actual_tag_values, elapsed_s, fopdt_params=None):
    """
    Compare actual live readings to FOPDT-predicted values at elapsed time.

    Call at +5 min, +15 min, +30 min after apply.
    Large deviation = disturbance, valve fault, or FOPDT params need tuning.
    Returns tracking_ok, tracking_score (0-1), deviations per tag, message,
    and suggest_reoptimize flag.
    """
    fp = fopdt_params or DEFAULT_FOPDT_PARAMS

    if not predicted_trajectory:
        return {"tracking_ok": True, "tracking_score": 1.0,
                "worst_deviation_pct": 0.0, "deviations": {},
                "message": "No stored trajectory.", "suggest_reoptimize": False}

    closest = min(predicted_trajectory, key=lambda s: abs(s.get("time_s", 0) - elapsed_s))
    predicted_tags = closest.get("tag_values", {})

    deviations = {}
    scores     = []

    for entry in fp:
        pv_tag = entry.get("pv_tag", "")
        op_tag = entry.get("op_tag", "")

        # Prefer pv_tag; fall back to op_tag if only OP readings are available
        # (e.g. live stream provides 2TIC403.OP but not 2TIC403 PV)
        use_tag = None
        use_predicted_key = None
        if pv_tag in actual_tag_values and pv_tag in predicted_tags:
            use_tag = pv_tag
            use_predicted_key = pv_tag
        elif op_tag in actual_tag_values and op_tag in predicted_tags:
            use_tag = op_tag
            use_predicted_key = op_tag
        elif pv_tag in actual_tag_values and op_tag in predicted_tags:
            # actual has pv, predicted has op key — cross-map via label
            use_tag = pv_tag
            use_predicted_key = op_tag
        elif op_tag in actual_tag_values and pv_tag in predicted_tags:
            use_tag = op_tag
            use_predicted_key = pv_tag
        else:
            continue  # tag genuinely not in either dict

        pred    = float(predicted_tags[use_predicted_key])
        actual  = float(actual_tag_values[use_tag])
        # Use OP span (100%) when comparing OP values, PV span otherwise
        using_op = (use_tag == op_tag)
        span    = 100.0 if using_op else (abs(float(entry.get("K", 1.0)) * 80.0) + 1e-9)
        unit    = "%" if using_op else entry.get("unit", "")
        dev_pct = abs(actual - pred) / span * 100.0
        label   = pv_tag or op_tag   # display key
        deviations[label] = {
            "predicted": round(pred, 2), "actual": round(actual, 2),
            "deviation_pct": round(dev_pct, 1), "unit": unit,
               }
        scores.append(max(0.0, 1.0 - dev_pct / 100.0))

    tracking_score     = float(np.mean(scores)) if scores else 1.0
    worst_dev          = max((d["deviation_pct"] for d in deviations.values()), default=0.0)
    tracking_ok        = worst_dev < 25.0
    suggest_reoptimize = worst_dev > 40.0 or tracking_score < 0.5

    if suggest_reoptimize:
        msg = "Deviation {:.1f}% - process not tracking. Disturbance or valve issue. Re-optimise.".format(worst_dev)
    elif not tracking_ok:
        msg = "Partial tracking ({:.0%}). Monitor closely.".format(tracking_score)
    else:
        msg = "Good tracking ({:.0%}). Process responding within FOPDT envelope.".format(tracking_score)

    logger.info("Tracking | score=%.2f worst=%.1f%% reopt=%s elapsed=%.0fs",
                tracking_score, worst_dev, suggest_reoptimize, elapsed_s)
    return {
        "tracking_ok": tracking_ok, "tracking_score": round(tracking_score, 3),
        "worst_deviation_pct": round(worst_dev, 1), "deviations": deviations,
        "message": msg, "suggest_reoptimize": suggest_reoptimize,
    }

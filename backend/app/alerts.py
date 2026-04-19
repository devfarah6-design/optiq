"""
OPTIQ DSS · Sensor Health Monitor
Process : DC4 Butane Debutanizer Column

COLUMN_ORDER here MUST match DC4_TAG_MAP in ingestion.py — same indices.
Checks: stuck · outlier · drift · limit breach · redundancy · valve saturation

All limits are grounded in industrial butane debutanizer operating knowledge.
→ VERIFY each limit against your DC4 P&ID and operating procedures.
"""
import numpy as np
import logging
from collections import deque
from typing import List, Dict, Any, Optional
from app.config import settings

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
#  TAG INDEX MAP  — must match DC4_TAG_MAP order in ingestion.py
# ─────────────────────────────────────────────────────────────────────────────
COLUMN_ORDER: Dict[str, int] = {
    # Your 24 known DC4 tags
    '2TIC403.PV':           0,
    '2TIC403.OP':           1,
    '2TI1_428.PV':          2,
    '2FI422.PV':            3,
    '2TI1_414.PV':          4,
    '2FIC419.PV':           5,
    '2FIC419.OP':           6,
    '2FI449A.PV':           7,
    '2FI431.PV':            8,
    '2LIC409.OP':           9,
    '2LIC409.PV':           10,
    '2LIC412.OP':           11,
    '2LIC412.PV':           12,
    '2LI410A.PV':           13,
    '2PIC409.OP':           14,
    '2PIC409.PV':           15,
    '2TI1_414.PV_temp':     16,
    '2TI1_415.DACA.PV':     17,
    '2TI1_416.DACA.PV':     18,
    '2TI1_417.PV':          19,
    '2TI1_428.PV_temp':     20,
    '2TI1_429.PV':          21,
    '2TI1_441.DACA.PV':     22,
    '2TI1_409.PV':          23,
    # Additional DC4 tags (matching ingestion.py indices 24-32)
    'FI_FEED.PV':           24,
    'TI_FEED.PV':           25,
    'TI_CONDENSER.PV':      26,
    'FI_COOLING.PV':        27,
    'TI_CW_OUT.PV':         28,
    'PI_FEED.PV':           29,
    'TI_REBOILER.PV':       30,
    'FI_STEAM_COND.PV':     31,
    'AI_BUTANE_C5.PV':      32,
}

INDEX_TO_TAG: Dict[int, str] = {v: k for k, v in COLUMN_ORDER.items()}


# ─────────────────────────────────────────────────────────────────────────────
#  PROCESS LIMITS PER TAG
#  lo_warn/hi_warn  → operator advisory  (severity: warning)
#  lo_alarm/hi_alarm → hard process alarm (severity: critical)
# ─────────────────────────────────────────────────────────────────────────────
PROCESS_LIMITS: Dict[str, Dict] = {

    # ── Bottom temperatures ──────────────────────────────────────────────────
    '2TIC403.PV': {
        'lo_warn': 88.0, 'hi_warn': 100.0, 'lo_alarm': 83.0, 'hi_alarm': 105.0,
        'unit': '°C', 'type': 'temperature',
        'description': 'Bottom temperature (controlled) — key separation quality indicator',
    },
    '2TI1_428.PV': {
        'lo_warn': 88.0, 'hi_warn': 100.0, 'lo_alarm': 83.0, 'hi_alarm': 105.0,
        'unit': '°C', 'type': 'temperature',
        'description': 'Bottom temperature (redundant sensor)',
    },
    '2TI1_428.PV_temp': {
        'lo_warn': 88.0, 'hi_warn': 100.0, 'lo_alarm': 83.0, 'hi_alarm': 105.0,
        'unit': '°C', 'type': 'temperature',
        'description': 'Bottom temperature (redundant alternate)',
    },

    # ── Reflux temperatures ──────────────────────────────────────────────────
    '2TI1_414.PV': {
        'lo_warn': 62.0, 'hi_warn': 78.0, 'lo_alarm': 57.0, 'hi_alarm': 83.0,
        'unit': '°C', 'type': 'temperature',
        'description': 'Reflux temperature — affects L/V ratio and butane purity',
    },
    '2TI1_414.PV_temp': {
        'lo_warn': 62.0, 'hi_warn': 78.0, 'lo_alarm': 57.0, 'hi_alarm': 83.0,
        'unit': '°C', 'type': 'temperature',
        'description': 'Reflux temperature (alternate sensor)',
    },

    # ── Column temperature profile ───────────────────────────────────────────
    '2TI1_415.DACA.PV': {
        'lo_warn': 65.0, 'hi_warn': 86.0, 'lo_alarm': 59.0, 'hi_alarm': 91.0,
        'unit': '°C', 'type': 'temperature',
        'description': 'Column temperature profile — DACA-415 (upper-mid)',
    },
    '2TI1_416.DACA.PV': {
        'lo_warn': 68.0, 'hi_warn': 89.0, 'lo_alarm': 62.0, 'hi_alarm': 94.0,
        'unit': '°C', 'type': 'temperature',
        'description': 'Column temperature profile — DACA-416 (mid)',
    },
    '2TI1_417.PV': {
        'lo_warn': 72.0, 'hi_warn': 93.0, 'lo_alarm': 66.0, 'hi_alarm': 98.0,
        'unit': '°C', 'type': 'temperature',
        'description': 'Column tray temperature — point 417 (lower-mid)',
    },
    '2TI1_429.PV': {
        'lo_warn': 76.0, 'hi_warn': 96.0, 'lo_alarm': 70.0, 'hi_alarm': 101.0,
        'unit': '°C', 'type': 'temperature',
        'description': 'Feed/lower section temperature — point 429',
    },
    '2TI1_441.DACA.PV': {
        'lo_warn': 50.0, 'hi_warn': 72.0, 'lo_alarm': 44.0, 'hi_alarm': 78.0,
        'unit': '°C', 'type': 'temperature',
        'description': 'Overhead line temperature — DACA-441 (before condenser)',
    },
    '2TI1_409.PV': {
        'lo_warn': 55.0, 'hi_warn': 73.0, 'lo_alarm': 49.0, 'hi_alarm': 79.0,
        'unit': '°C', 'type': 'temperature',
        'description': 'Condenser/reflux drum temperature — point 409',
    },

    # ── Steam (energy input) ─────────────────────────────────────────────────
    '2FI422.PV': {
        'lo_warn': 2200.0, 'hi_warn': 3800.0, 'lo_alarm': 1800.0, 'hi_alarm': 4300.0,
        'unit': 'kg/h', 'type': 'flow',
        'description': 'Steam flow to reboiler — main energy input, minimisation target',
    },

    # ── Reflux flow ──────────────────────────────────────────────────────────
    '2FIC419.PV': {
        'lo_warn': 12.0, 'hi_warn': 42.0, 'lo_alarm': 7.0, 'hi_alarm': 48.0,
        'unit': 'm³/h', 'type': 'flow',
        'description': 'Reflux flow rate — controls L/V ratio and separation',
    },

    # ── Product flows ────────────────────────────────────────────────────────
    '2FI449A.PV': {
        'lo_warn': 3.0, 'hi_warn': 38.0, 'lo_alarm': 1.0, 'hi_alarm': 48.0,
        'unit': 'm³/h', 'type': 'flow',
        'description': 'Butane product to storage — overhead product rate',
    },
    '2FI431.PV': {
        'lo_warn': 2.0, 'hi_warn': 30.0, 'lo_alarm': 0.5, 'hi_alarm': 38.0,
        'unit': 'm³/h', 'type': 'flow',
        'description': 'Gasoline (C5+) to storage — bottoms product rate',
    },

    # ── Overhead pressure ────────────────────────────────────────────────────
    '2PIC409.PV': {
        'lo_warn': 4.8, 'hi_warn': 7.6, 'lo_alarm': 4.0, 'hi_alarm': 8.6,
        'unit': 'bar(g)', 'type': 'pressure',
        'description': 'Overhead pressure — controls separation thermodynamics',
    },

    # ── Levels ───────────────────────────────────────────────────────────────
    '2LIC409.PV': {
        'lo_warn': 20.0, 'hi_warn': 80.0, 'lo_alarm': 12.0, 'hi_alarm': 88.0,
        'unit': '%', 'type': 'level',
        'description': 'Column bottom level — critical for reboiler and bottoms pump',
    },
    '2LIC412.PV': {
        'lo_warn': 20.0, 'hi_warn': 80.0, 'lo_alarm': 12.0, 'hi_alarm': 88.0,
        'unit': '%', 'type': 'level',
        'description': 'Condensate pot level — critical for reflux pump NPSH',
    },
    '2LI410A.PV': {
        'lo_warn': 18.0, 'hi_warn': 82.0, 'lo_alarm': 10.0, 'hi_alarm': 90.0,
        'unit': '%', 'type': 'level',
        'description': 'Reflux drum level indicator',
    },

    # ── Controller outputs (valves) ──────────────────────────────────────────
    '2TIC403.OP': {
        'lo_warn': 5.0, 'hi_warn': 95.0, 'lo_alarm': 2.0, 'hi_alarm': 98.0,
        'unit': '%', 'type': 'valve',
        'description': 'Reboiler valve — saturation = loss of bottom temp control',
    },
    '2FIC419.OP': {
        'lo_warn': 5.0, 'hi_warn': 95.0, 'lo_alarm': 2.0, 'hi_alarm': 98.0,
        'unit': '%', 'type': 'valve',
        'description': 'Reflux valve — saturation = loss of reflux flow control',
    },
    '2LIC409.OP': {
        'lo_warn': 5.0, 'hi_warn': 95.0, 'lo_alarm': 2.0, 'hi_alarm': 98.0,
        'unit': '%', 'type': 'valve',
        'description': 'Bottom level valve — saturation = loss of level control',
    },
    '2LIC412.OP': {
        'lo_warn': 5.0, 'hi_warn': 95.0, 'lo_alarm': 2.0, 'hi_alarm': 98.0,
        'unit': '%', 'type': 'valve',
        'description': 'Condensate pot valve — saturation = loss of level control',
    },
    '2PIC409.OP': {
        'lo_warn': 5.0, 'hi_warn': 95.0, 'lo_alarm': 2.0, 'hi_alarm': 98.0,
        'unit': '%', 'type': 'valve',
        'description': 'Overhead pressure valve — saturation = loss of pressure control',
    },

    # ── Additional tags ──────────────────────────────────────────────────────
    'FI_FEED.PV': {
        'lo_warn': 25.0, 'hi_warn': 60.0, 'lo_alarm': 15.0, 'hi_alarm': 70.0,
        'unit': 'm³/h', 'type': 'flow',
        'description': 'Column feed flow rate',
    },
    'TI_FEED.PV': {
        'lo_warn': 40.0, 'hi_warn': 70.0, 'lo_alarm': 35.0, 'hi_alarm': 80.0,
        'unit': '°C', 'type': 'temperature',
        'description': 'Column feed temperature',
    },
    'TI_CONDENSER.PV': {
        'lo_warn': 32.0, 'hi_warn': 52.0, 'lo_alarm': 28.0, 'hi_alarm': 58.0,
        'unit': '°C', 'type': 'temperature',
        'description': 'Condenser outlet temperature',
    },
    'TI_REBOILER.PV': {
        'lo_warn': 98.0, 'hi_warn': 115.0, 'lo_alarm': 93.0, 'hi_alarm': 120.0,
        'unit': '°C', 'type': 'temperature',
        'description': 'Reboiler shell temperature',
    },
    'PI_FEED.PV': {
        'lo_warn': 6.0, 'hi_warn': 11.0, 'lo_alarm': 5.0, 'hi_alarm': 12.5,
        'unit': 'bar(g)', 'type': 'pressure',
        'description': 'Feed pressure',
    },
    'AI_BUTANE_C5.PV': {
        # C5+ in butane product — lower is better (purity quality indicator)
        'lo_warn': 0.0, 'hi_warn': 0.8, 'lo_alarm': 0.0, 'hi_alarm': 1.2,
        'unit': '%mol', 'type': 'quality',
        'description': 'C5+ content in butane product — spec limit typically < 0.5%mol',
    },
}

# ── Redundant sensor pairs: (tag_A, tag_B, max_deviation, unit) ──────────────
REDUNDANT_PAIRS = [
    ('2TIC403.PV',      '2TI1_428.PV',      3.0, '°C'),
    ('2TIC403.PV',      '2TI1_428.PV_temp', 3.0, '°C'),
    ('2TI1_414.PV',     '2TI1_414.PV_temp', 2.0, '°C'),
    ('2LIC409.PV',      '2LI410A.PV',        8.0, '%'),
    ('2LIC412.PV',      '2LI410A.PV',        8.0, '%'),
]

# ── Stuck sensor thresholds by instrument type ────────────────────────────────
STUCK_THRESHOLDS: Dict[str, float] = {
    'temperature': 0.05,
    'flow':        1.0,
    'pressure':    0.005,
    'level':       0.1,
    'valve':       0.2,
    'quality':     0.002,
}


# ─────────────────────────────────────────────────────────────────────────────
class SensorHealthMonitor:

    def __init__(self, history_size: int = 60):
        self.history_size = history_size
        self.history: Dict[str, deque] = {}

    def _hist(self, tag: str) -> deque:
        if tag not in self.history:
            self.history[tag] = deque(maxlen=self.history_size)
        return self.history[tag]

    def _stype(self, tag: str) -> str:
        return PROCESS_LIMITS.get(tag, {}).get('type', 'temperature')

    # ── 1. STUCK ──────────────────────────────────────────────────────────────
    def check_stuck(self, tag: str, value: float) -> Optional[Dict]:
        h = self._hist(tag)
        h.append(value)
        if len(h) < 10:
            return None
        std       = float(np.std(list(h)))
        threshold = STUCK_THRESHOLDS.get(self._stype(tag), 0.05)
        if std < threshold:
            lim = PROCESS_LIMITS.get(tag, {})
            return {
                'alert_type': 'stuck_sensor', 'severity': 'warning',
                'tag_name': tag, 'value': value, 'threshold': threshold, 'z_score': 0.0,
                'description': (
                    f"[STUCK] {tag} frozen at {value:.3f} {lim.get('unit','')} "
                    f"for {len(h)} scans (σ={std:.5f}). "
                    f"Check sensor, transmitter, or wiring."
                ),
            }
        return None

    # ── 2. OUTLIER ────────────────────────────────────────────────────────────
    def check_outlier(self, tag: str, value: float) -> Optional[Dict]:
        h = self._hist(tag)
        if len(h) < 10:
            return None
        vals = list(h)
        mean = float(np.mean(vals))
        std  = float(np.std(vals))
        z    = abs((value - mean) / (std + 1e-9))
        lim  = PROCESS_LIMITS.get(tag, {})
        if z > settings.outlier_z_score_threshold:
            return {
                'alert_type': 'outlier',
                'severity':   'critical' if z > 6.0 else 'warning',
                'tag_name': tag, 'value': value, 'threshold': mean, 'z_score': z,
                'description': (
                    f"[OUTLIER] {tag} = {value:.2f} {lim.get('unit','')} "
                    f"is {z:.1f}σ from mean ({mean:.2f}). "
                    f"{lim.get('description','')}"
                ),
            }
        return None

    # ── 3. DRIFT ──────────────────────────────────────────────────────────────
    def check_drift(self, tag: str, value: float) -> Optional[Dict]:
        h = self._hist(tag)
        if len(h) < 40:
            return None
        vals        = list(h)
        recent      = float(np.mean(vals[-10:]))
        baseline    = float(np.mean(vals[:20]))
        std         = float(np.std(vals))
        shift       = abs(recent - baseline)
        lim         = PROCESS_LIMITS.get(tag, {})
        if shift > 3.0 * std and std > 1e-6:
            return {
                'alert_type': 'drift', 'severity': 'warning',
                'tag_name': tag, 'value': value, 'threshold': baseline,
                'z_score': shift / (std + 1e-9),
                'description': (
                    f"[DRIFT] {tag}: baseline={baseline:.2f} → recent={recent:.2f} "
                    f"{lim.get('unit','')} (shift={shift:.2f}, {shift/(std+1e-9):.1f}σ). "
                    f"Possible fouling or calibration drift."
                ),
            }
        return None

    # ── 4. LIMIT BREACH ───────────────────────────────────────────────────────
    def check_limits(self, tag: str, value: float) -> Optional[Dict]:
        lim = PROCESS_LIMITS.get(tag)
        if lim is None:
            return None
        lo_a, hi_a = lim['lo_alarm'], lim['hi_alarm']
        lo_w, hi_w = lim['lo_warn'],  lim['hi_warn']
        severity = direction = None
        if   value < lo_a: severity, direction = 'critical', f'CRITICALLY LOW  (< {lo_a})'
        elif value > hi_a: severity, direction = 'critical', f'CRITICALLY HIGH (> {hi_a})'
        elif value < lo_w: severity, direction = 'warning',  f'LOW  (< {lo_w})'
        elif value > hi_w: severity, direction = 'warning',  f'HIGH (> {hi_w})'
        if severity:
            return {
                'alert_type': 'limit_breach', 'severity': severity,
                'tag_name': tag, 'value': value,
                'threshold': lo_a if value < lo_w else hi_a, 'z_score': None,
                'description': (
                    f"[LIMIT] {tag} = {value:.2f} {lim['unit']} — {direction} | "
                    f"{lim['description']} | "
                    f"Normal: {lo_w}–{hi_w}  Alarm: {lo_a}–{hi_a} {lim['unit']}"
                ),
            }
        return None

    # ── 5. REDUNDANCY CHECK ───────────────────────────────────────────────────
    def check_redundancy(self, readings_dict: Dict[str, float]) -> List[Dict]:
        alerts = []
        for tag_a, tag_b, max_dev, unit in REDUNDANT_PAIRS:
            va = readings_dict.get(tag_a)
            vb = readings_dict.get(tag_b)
            if va is None or vb is None:
                continue
            dev = abs(va - vb)
            if dev > max_dev:
                alerts.append({
                    'alert_type': 'redundancy_deviation',
                    'severity':   'critical' if dev > max_dev * 2 else 'warning',
                    'tag_name':   f'{tag_a}/{tag_b}',
                    'value':      dev, 'threshold': max_dev, 'z_score': None,
                    'description': (
                        f"[REDUNDANCY] {tag_a}={va:.2f} vs {tag_b}={vb:.2f} {unit} "
                        f"— deviation={dev:.2f} {unit} (max={max_dev}). "
                        f"One sensor may be faulty."
                    ),
                })
        return alerts

    # ── 6. VALVE SATURATION ───────────────────────────────────────────────────
    def check_valve_saturation(self, tag: str, value: float,
                                scans: int = 10) -> Optional[Dict]:
        if PROCESS_LIMITS.get(tag, {}).get('type') != 'valve':
            return None
        h = self._hist(tag)
        if len(h) < scans:
            return None
        recent   = list(h)[-scans:]
        all_low  = all(v < 3.0  for v in recent)
        all_high = all(v > 97.0 for v in recent)
        if all_low or all_high:
            state = 'CLOSED' if all_low else 'OPEN'
            lim   = PROCESS_LIMITS.get(tag, {})
            return {
                'alert_type': 'valve_saturation', 'severity': 'critical',
                'tag_name': tag, 'value': value,
                'threshold': 3.0 if all_low else 97.0, 'z_score': None,
                'description': (
                    f"[VALVE SATURATED] {tag} fully {state} ({value:.1f}%) "
                    f"for {scans}+ scans. {lim.get('description','')}. "
                    f"Controller lost control — manual check required."
                ),
            }
        return None

    # ── RUN ALL CHECKS ────────────────────────────────────────────────────────
    def check_all(self, readings: List[float]) -> List[Dict]:
        all_alerts: List[Dict] = []

        readings_dict = {
            tag: readings[idx]
            for tag, idx in COLUMN_ORDER.items()
            if idx < len(readings)
        }

        for tag, idx in COLUMN_ORDER.items():
            if idx >= len(readings):
                continue
            value = readings[idx]

            for fn in [self.check_stuck, self.check_outlier,
                       self.check_drift,  self.check_limits]:
                alert = fn(tag, value)
                if alert:
                    all_alerts.append(alert)

            v = self.check_valve_saturation(tag, value)
            if v:
                all_alerts.append(v)

        all_alerts.extend(self.check_redundancy(readings_dict))
        return all_alerts


# ── Singleton ─────────────────────────────────────────────────────────────────
_monitor = SensorHealthMonitor(history_size=60)


def detect_anomalies(readings: List[float]) -> List[Dict]:
    """Entry point called by ingestion.py each cycle. Returns [] if healthy."""
    return _monitor.check_all(readings)

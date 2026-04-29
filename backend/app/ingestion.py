"""
OPTIQ DSS · Data Ingestion Loop — DC4 Butane Debutanizer
Simulator produces realistic variation in energy and purity every cycle.
"""
import asyncio
import logging
import numpy as np
from datetime import datetime, timezone
from typing import Optional

from app import models
from app.prediction import predict_energy_purity
from app.alerts import detect_anomalies, COLUMN_ORDER
from app.database import SessionLocal
from app.websocket_manager import manager as ws_manager
from app.config import settings

logger = logging.getLogger(__name__)

# ── DC4 Tag map — 33 tags, indices match COLUMN_ORDER in alerts.py ────────────
# (index, tag, unit, nominal, sigma)
DC4_TAG_MAP = [
    (0,  '2TIC403.PV',       '°C',     94.0,   1.2),
    (1,  '2TIC403.OP',       '%',      52.0,   4.0),
    (2,  '2TI1_428.PV',      '°C',     94.0,   1.3),
    (3,  '2FI422.PV',        'kg/h', 3000.0,  80.0),   # ← large sigma = visible variation
    (4,  '2TI1_414.PV',      '°C',     74.0,   1.0),
    (5,  '2FIC419.PV',       'm³/h',   25.0,   2.0),
    (6,  '2FIC419.OP',       '%',      48.0,   3.5),
    (7,  '2FI449A.PV',       'm³/h',   18.0,   2.0),
    (8,  '2FI431.PV',        'm³/h',   12.0,   1.5),
    (9,  '2LIC409.OP',       '%',      50.0,   4.0),
    (10, '2LIC409.PV',       '%',      52.0,   3.0),
    (11, '2LIC412.OP',       '%',      48.0,   3.5),
    (12, '2LIC412.PV',       '%',      50.0,   3.0),
    (13, '2LI410A.PV',       '%',      50.0,   3.2),
    (14, '2PIC409.OP',       '%',      45.0,   2.5),
    (15, '2PIC409.PV',       'bar(g)',  6.2,   0.12),
    (16, '2TI1_414.PV_temp', '°C',     74.0,   1.1),
    (17, '2TI1_415.DACA.PV', '°C',     76.0,   1.2),
    (18, '2TI1_416.DACA.PV', '°C',     81.0,   1.3),
    (19, '2TI1_417.PV',      '°C',     85.0,   1.4),
    (20, '2TI1_428.PV_temp', '°C',     94.2,   1.3),
    (21, '2TI1_429.PV',      '°C',     88.0,   1.5),
    (22, '2TI1_441.DACA.PV', '°C',     64.0,   1.0),
    (23, '2TI1_409.PV',      '°C',     67.0,   1.1),
    (24, 'FI_FEED.PV',       'm³/h',   40.0,   3.0),
    (25, 'TI_FEED.PV',       '°C',     55.0,   2.0),
    (26, 'TI_CONDENSER.PV',  '°C',     42.0,   1.2),
    (27, 'FI_COOLING.PV',    'm³/h',   85.0,   4.0),
    (28, 'TI_CW_OUT.PV',     '°C',     35.0,   1.5),
    (29, 'PI_FEED.PV',       'bar(g)',  8.5,   0.20),
    (30, 'TI_REBOILER.PV',   '°C',    105.0,   1.8),
    (31, 'FI_STEAM_COND.PV', 'kg/h', 2950.0,  75.0),
    (32, 'AI_BUTANE_C5.PV',  '%mol',   0.35,   0.06),
]

TAG_LIMITS = {
    tag: (nom - 4 * sig, nom + 4 * sig)
    for _, tag, _, nom, sig in DC4_TAG_MAP
}


class DC4Simulator:
    """
    Realistic DC4 debutanizer simulator.
    Uses sinusoidal disturbances + correlated process dynamics to produce
    visible, physically meaningful variation in energy and purity.
    """
    def __init__(self):
        self._step  = 0
        noms        = np.array([n for *_, n, _ in DC4_TAG_MAP])
        self._state = noms.copy()
        self._drift = np.zeros(33)
        # Slow sinusoidal disturbances for realism
        self._disturbance_period_short = 120   # 10 min at 5s scans
        self._disturbance_period_long  = 720   # 1 hour

    async def read(self) -> list:
        self._step += 1
        t = self._step

        # ── 1. Multi-frequency disturbances ───────────────────────────────────
        # Short cycle (10 min): feed composition swing
        short = np.sin(2 * np.pi * t / self._disturbance_period_short)
        # Long cycle (1 hour): ambient temperature / reboiler fouling trend
        long_ = np.sin(2 * np.pi * t / self._disturbance_period_long)
        # Very long (6 hour): production rate change
        vlong = np.sin(2 * np.pi * t / (self._disturbance_period_long * 6))

        # Steam flow varies with production demand (large effect on energy)
        steam_disturbance = 120.0 * short + 60.0 * long_ + 40.0 * vlong
        self._drift[3]  = steam_disturbance    # 2FI422.PV steam flow

        # Bottom temperature follows steam (physics: more steam → higher temp)
        bottom_delta = steam_disturbance * 0.008  # °C per kg/h
        self._drift[0]  = bottom_delta + 1.5 * long_   # 2TIC403.PV
        self._drift[2]  = bottom_delta + 1.4 * long_   # 2TI1_428.PV redundant
        self._drift[20] = bottom_delta + 1.5 * long_   # 2TI1_428.PV_temp

        # Reflux temperature varies inversely (more reflux cooling → lower temp)
        self._drift[4]  = -0.4 * short + 0.8 * long_  # 2TI1_414.PV
        self._drift[16] = -0.4 * short + 0.7 * long_  # alt reflux temp

        # Column temperature profile — gradual gradient variation
        self._drift[17] = self._drift[0] * 0.45 + 0.5 * short  # DACA-415
        self._drift[18] = self._drift[0] * 0.60 + 0.4 * short  # DACA-416
        self._drift[19] = self._drift[0] * 0.78 + 0.3 * short  # point 417
        self._drift[21] = self._drift[0] * 0.88                 # point 429

        # Overhead pressure responds to steam (more vapour load)
        self._drift[15] = steam_disturbance * 0.00012 + 0.05 * long_

        # Reflux flow compensates for column disturbances
        self._drift[5]  = -steam_disturbance * 0.003 + 0.8 * short

        # Ambient cooling affects condenser
        ambient = 3.0 * np.sin(2 * np.pi * t / (24 * 720))  # daily cycle
        self._drift[26] = ambient * 0.8   # condenser temp
        self._drift[28] = ambient * 0.5   # cooling water out

        # Product quality proxy (C5+ in butane) — improves with higher bottom temp
        self._drift[32] = -bottom_delta * 0.005 + 0.01 * short

        # Reboiler and steam condensate follow steam
        self._drift[30] = bottom_delta * 1.1
        self._drift[31] = steam_disturbance * 0.95

        # Levels show slow variations (controller action)
        self._drift[10] = 3.0 * np.sin(2 * np.pi * t / 200)   # bottom level
        self._drift[12] = 2.5 * np.sin(2 * np.pi * t / 250)   # condensate level
        self._drift[13] = 2.5 * np.sin(2 * np.pi * t / 260)   # reflux drum level

        # ── 2. Realistic measurement noise per instrument type ─────────────────
        sigmas = np.array([s for *_, s in DC4_TAG_MAP])
        noise  = np.random.normal(0, sigmas * 0.35)

        # Correlated noise between redundant sensors (should be similar)
        noise[2]  = noise[0] * 0.92 + np.random.normal(0, 0.3)   # 2TI1_428 tracks 2TIC403
        noise[20] = noise[0] * 0.94 + np.random.normal(0, 0.25)  # alt redundant

        # Valve output is inverse of its controlled variable
        noise[1]  = -noise[0]  * 1.1 + np.random.normal(0, 1.0)  # reboiler valve
        noise[6]  = -noise[5]  * 0.9 + np.random.normal(0, 1.0)  # reflux valve
        noise[9]  = -noise[10] * 1.0 + np.random.normal(0, 1.5)  # bottom level valve
        noise[11] = -noise[12] * 0.9 + np.random.normal(0, 1.2)  # condensate valve
        noise[14] = -noise[15] * 12.0 + np.random.normal(0, 0.8) # pressure valve

        # ── 3. First-order lag (process inertia) ──────────────────────────────
        alpha      = 0.60   # smoothing — lower = more lag = slower response
        nominals   = np.array([n for *_, n, _ in DC4_TAG_MAP])
        raw        = nominals + self._drift + noise
        self._state = alpha * self._state + (1 - alpha) * raw

        # ── 4. Clip to physical operating envelope ────────────────────────────
        limits  = np.array([TAG_LIMITS[tag] for _, tag, *_ in DC4_TAG_MAP])
        clipped = np.clip(self._state, limits[:, 0], limits[:, 1])

        return clipped.tolist()

    @property
    def name(self):
        return 'DC4Simulator'


# ── Source factory ────────────────────────────────────────────────────────────
def _build_source():
    mode = getattr(settings, 'data_source', 'simulator').lower().strip()
    if mode == 'simulator':
        return DC4Simulator()
    # OPC-UA / REST / Modbus placeholders — import when needed
    logger.warning(f"Unknown DATA_SOURCE={mode}, using simulator")
    return DC4Simulator()


# ── Ingestion loop ────────────────────────────────────────────────────────────
async def ingestion_loop():
    source     = _build_source()
    fallback   = DC4Simulator()
    fail_count = 0

    logger.info(f"Ingestion loop started | source={source.name} | interval={settings.ingestion_interval_seconds}s")

    while True:
        try:
            # 1. Read
            readings = await source.read() if hasattr(source.read, '__await__') or asyncio.iscoroutinefunction(source.read) else source.read()
            if asyncio.iscoroutine(readings):
                readings = await readings

            if readings is None:
                fail_count += 1
                if fail_count >= 5:
                    logger.error(f"Source failed {fail_count}x — using fallback simulator")
                readings = await fallback.read()
            else:
                if fail_count > 0:
                    logger.info(f"Source recovered after {fail_count} failures")
                fail_count = 0

            # 2. Predict
            pred     = predict_energy_purity(readings)
            detected = detect_anomalies(readings)

            # 3. Persist
            db = SessionLocal()
            try:
                db.add(models.Prediction(
                    readings=readings, energy=pred.energy, purity=pred.purity,
                    stability=pred.stability, model_type=pred.model_type,
                    confidence=pred.confidence, is_outlier=pred.is_outlier,
                    outlier_score=pred.outlier_score,
                ))
                for a in detected:
                    db.add(models.Alert(
                        alert_type=a['alert_type'], severity=a['severity'],
                        tag_name=a['tag_name'], value=a.get('value'),
                        threshold=a.get('threshold'), z_score=a.get('z_score'),
                        description=a['description'],
                    ))
                db.commit()
            finally:
                db.close()

            # 4. Broadcast
            now = datetime.now(timezone.utc).isoformat()
            await ws_manager.broadcast({
                'type':       'new_prediction',
                'timestamp':  now,
                'source':     source.name,
                'energy':     pred.energy,
                'purity':     pred.purity,
                'stability':  pred.stability,
                'is_outlier': pred.is_outlier,
                'model_type': pred.model_type,
                'tags': {
                    tag: round(readings[i], 3)
                    for i, tag, *_ in DC4_TAG_MAP
                    if i < len(readings)
                },
            })
            for a in detected:
                await ws_manager.broadcast({'type': 'new_alert', 'alert': a})

        except asyncio.CancelledError:
            logger.info("Ingestion loop cancelled")
            break
        except Exception as e:
            logger.error(f"Ingestion error: {e}", exc_info=True)

        await asyncio.sleep(settings.ingestion_interval_seconds)
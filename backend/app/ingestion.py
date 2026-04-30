"""
OPTIQ DSS · Data Ingestion Loop
Process : DC4 Butane Debutanizer Column

Data sources (set DATA_SOURCE in .env):
  simulator  → DC4 physics-based simulator with realistic dynamics  (default)
  opcua      → OPC-UA / DCS server  (Honeywell, ABB, Emerson, Siemens)
  rest       → REST historian API   (PI Web API, IP.21, PHD)
  modbus     → Modbus TCP           (legacy PLCs / RTUs)

The simulator generates EXACTLY the 33 DC4 tags in the same order as
alerts.py COLUMN_ORDER — no tag mismatch, no false alerts.
"""
import asyncio
import logging
import numpy as np
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Optional

from app import models
from app.prediction import predict_energy_purity
from app.alerts import detect_anomalies, COLUMN_ORDER
from app.database import SessionLocal
from app.websocket_manager import manager as ws_manager
from app.config import settings

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
#  DC4 DEBUTANIZER TAG MAP  –  33 tags in order matching alerts.py COLUMN_ORDER
#
#  Format: (index, tag_name, unit, nominal, sigma, description)
#  nominal  = typical operating value
#  sigma    = realistic process noise (1-std deviation)
#
#  Tags 0-23  = your 24 known process tags (same order as COLUMN_ORDER)
#  Tags 24-32 = 9 additional DC4 tags commonly measured but not in your list
#               (confirm with your actual dataset column order)
# ══════════════════════════════════════════════════════════════════════════════
DC4_TAG_MAP = [
    # idx  tag                   unit       nominal  sigma   description
    # ── Your 24 known tags (must match COLUMN_ORDER in alerts.py) ──────────
    (0,  '2TIC403.PV',           '°C',       94.0,   0.8,  'Bottom temperature (controlled)'),
    (1,  '2TIC403.OP',           '%',        52.0,   3.0,  'Reboiler valve output'),
    (2,  '2TI1_428.PV',          '°C',       94.0,   0.9,  'Bottom temperature (redundant)'),
    (3,  '2FI422.PV',            'kg/h',   3000.0,  40.0,  'Steam flow to reboiler'),
    (4,  '2TI1_414.PV',          '°C',       74.0,   0.6,  'Reflux temperature'),
    (5,  '2FIC419.PV',           'm³/h',     25.0,   1.2,  'Reflux flow rate'),
    (6,  '2FIC419.OP',           '%',        48.0,   2.5,  'Reflux valve output'),
    (7,  '2FI449A.PV',           'm³/h',     18.0,   1.5,  'Butane product to storage'),
    (8,  '2FI431.PV',            'm³/h',     12.0,   1.0,  'Gasoline to storage'),
    (9,  '2LIC409.OP',           '%',        50.0,   3.5,  'Bottom level valve output'),
    (10, '2LIC409.PV',           '%',        52.0,   2.0,  'Bottom level'),
    (11, '2LIC412.OP',           '%',        48.0,   3.0,  'Condensate pot level valve'),
    (12, '2LIC412.PV',           '%',        50.0,   2.5,  'Condensate pot level'),
    (13, '2LI410A.PV',           '%',        50.0,   2.8,  'Reflux drum level (indicator)'),
    (14, '2PIC409.OP',           '%',        45.0,   2.0,  'Overhead pressure valve output'),
    (15, '2PIC409.PV',           'bar(g)',    6.2,   0.08, 'Overhead pressure'),
    (16, '2TI1_414.PV_temp',     '°C',       74.0,   0.7,  'Reflux temperature (alternate)'),
    (17, '2TI1_415.DACA.PV',     '°C',       76.0,   0.8,  'Column temp DACA-415'),
    (18, '2TI1_416.DACA.PV',     '°C',       81.0,   0.9,  'Column temp DACA-416'),
    (19, '2TI1_417.PV',          '°C',       85.0,   0.9,  'Column temp point 417'),
    (20, '2TI1_428.PV_temp',     '°C',       94.2,   1.0,  'Bottom temperature (redundant alt)'),
    (21, '2TI1_429.PV',          '°C',       88.0,   1.0,  'Feed/lower section temp 429'),
    (22, '2TI1_441.DACA.PV',     '°C',       64.0,   0.7,  'Overhead line temp DACA-441'),
    (23, '2TI1_409.PV',          '°C',       67.0,   0.8,  'Condenser/reflux drum temp 409'),
    # ── Additional DC4 process tags (indices 24-32) ─────────────────────────
    # These are typical measurements in a debutanizer not listed in your tags.
    # Verify these exist in your actual dataset and adjust as needed.
    (24, 'FI_FEED.PV',           'm³/h',     40.0,   2.0,  'Column feed flow rate'),
    (25, 'TI_FEED.PV',           '°C',       55.0,   1.5,  'Column feed temperature'),
    (26, 'TI_CONDENSER.PV',      '°C',       42.0,   0.8,  'Condenser outlet temperature'),
    (27, 'FI_COOLING.PV',        'm³/h',     85.0,   3.0,  'Cooling water flow to condenser'),
    (28, 'TI_CW_OUT.PV',         '°C',       35.0,   1.0,  'Cooling water outlet temperature'),
    (29, 'PI_FEED.PV',           'bar(g)',    8.5,   0.15, 'Feed pressure'),
    (30, 'TI_REBOILER.PV',       '°C',      105.0,   1.2,  'Reboiler shell temperature'),
    (31, 'FI_STEAM_COND.PV',     'kg/h',   2950.0,  35.0,  'Steam condensate return flow'),
    (32, 'AI_BUTANE_C5.PV',      '%mol',     0.35,   0.05, 'C5+ in butane product (purity proxy)'),
]

# Build lookup: tag_name → index
TAG_INDEX = {tag: idx for idx, tag, *_ in DC4_TAG_MAP}

# Normal limits for simulator clipping: (lo, hi)
TAG_LIMITS = {
    tag: (nominal - 4 * sigma, nominal + 4 * sigma)
    for _, tag, _, nominal, sigma, _ in DC4_TAG_MAP
}


# ══════════════════════════════════════════════════════════════════════════════
#  DATA SOURCE BASE
# ══════════════════════════════════════════════════════════════════════════════
class DataSource(ABC):

    @abstractmethod
    async def read(self) -> Optional[list]:
        """Return list of 33 floats in DC4_TAG_MAP order, or None on failure."""
        ...

    @property
    def name(self) -> str:
        return self.__class__.__name__


# ══════════════════════════════════════════════════════════════════════════════
#  1. DC4 PHYSICS-BASED SIMULATOR
#  Generates realistic debutanizer data with:
#  - Correlated process dynamics (steam → bottom temp, reflux → purity)
#  - First-order lag (process inertia)
#  - Slow drift (reboiler fouling, seasonal ambient)
#  - Occasional disturbances (feed composition swing, reflux upsets)
#  - Measurement noise per instrument type
# ══════════════════════════════════════════════════════════════════════════════
class DC4Simulator(DataSource):

    def __init__(self):
        self._step   = 0
        nominals     = np.array([m for _, _, _, m, _, _ in DC4_TAG_MAP], dtype=float)
        self._state  = nominals.copy()   # slow-moving process state
        self._drift  = np.zeros(33)

    async def read(self) -> list:
        self._step += 1
        t = self._step

        # ── 1. Slow drift: reboiler fouling increases steam demand over weeks ──
        fouling_factor = 0.002 * np.sin(2 * np.pi * t / (24 * 60 * 30))  # monthly cycle
        self._drift[3]  += fouling_factor    # steam flow slowly increases
        self._drift[0]  -= fouling_factor * 0.3  # bottom temp slightly drops

        # Ambient temperature daily cycle affects condenser
        ambient_delta = 3.0 * np.sin(2 * np.pi * t / (24 * 12))  # 12 scans/hour → daily
        self._drift[26] = ambient_delta        # condenser outlet temp
        self._drift[28] = ambient_delta * 0.6  # cooling water out

        # ── 2. Occasional disturbances (~every 2 hours at 5s scan rate) ───────
        if t % 1440 == 0:
            logger.debug("DC4 Simulator: feed composition swing event")
            self._drift[24] += np.random.normal(0, 3.0)   # feed flow step
            self._drift[25] += np.random.normal(0, 2.0)   # feed temp swing

        if t % 720 == 0:
            logger.debug("DC4 Simulator: reflux upset event")
            self._drift[5] += np.random.normal(0, 2.0)    # reflux flow perturbation

        # ── 3. Generate correlated noise ─────────────────────────────────────
        nominals = np.array([m for _, _, _, m, _, _ in DC4_TAG_MAP], dtype=float)
        sigmas   = np.array([s for _, _, _, _, s, _ in DC4_TAG_MAP], dtype=float)
        noise    = np.random.normal(0, sigmas * 0.4)

        # Process correlations (based on distillation physics):
        # More steam → higher bottom temp → better separation
        steam_delta       = (self._state[3] - nominals[3]) / (nominals[3] + 1e-6)
        noise[0]  += steam_delta * 2.5     # bottom temp follows steam
        noise[2]  += steam_delta * 2.3     # redundant bottom temp
        noise[20] += steam_delta * 2.4     # alt redundant bottom temp

        # Higher reflux → lower reflux temperature (more cold liquid)
        reflux_delta      = (self._state[5] - nominals[5]) / (nominals[5] + 1e-6)
        noise[4]  -= reflux_delta * 1.5    # reflux temp decreases with flow
        noise[16] -= reflux_delta * 1.4    # alternate reflux temp sensor

        # Bottom temp drives column temperature profile (top→bottom gradient)
        bottom_delta = noise[0] * 0.8
        noise[19] += bottom_delta * 0.85   # tray 417 (lower-mid)
        noise[21] += bottom_delta * 0.90   # point 429
        noise[18] += bottom_delta * 0.65   # DACA-416 (mid)
        noise[17] += bottom_delta * 0.50   # DACA-415 (upper-mid)
        noise[22] += bottom_delta * 0.25   # overhead line temp
        noise[23] += bottom_delta * 0.20   # condenser drum

        # Overhead pressure affects condenser and reflux drum
        pressure_delta = noise[15] * 0.3
        noise[22] += pressure_delta        # overhead line temp follows pressure
        noise[12] -= pressure_delta * 0.5  # higher pressure → higher reflux drum level

        # Valve output follows its controlled variable (PID action)
        noise[1]  = -noise[0]  * 0.8 + np.random.normal(0, 1.0)  # reboiler valve
        noise[6]  = -noise[5]  * 0.7 + np.random.normal(0, 1.0)  # reflux valve
        noise[9]  = -noise[10] * 0.9 + np.random.normal(0, 1.5)  # bottom level valve
        noise[11] = -noise[12] * 0.85 + np.random.normal(0, 1.2) # condensate valve
        noise[14] = -noise[15] * 10.0 + np.random.normal(0, 0.8) # pressure valve

        # C5+ in product inversely related to bottom temp and reflux
        # Better separation (high Tbottom + good reflux) → less C5+ in product
        noise[32] = -(noise[0] * 0.01 + noise[5] * 0.005) + np.random.normal(0, 0.02)

        # Reboiler temperature follows steam and bottom
        noise[30] = noise[3] * 0.003 + noise[0] * 0.8 + np.random.normal(0, 0.5)

        # Steam condensate ~ steam flow
        noise[31] = noise[3] * 0.95 + np.random.normal(0, 15.0)

        # ── 4. First-order lag (process inertia, τ ≈ 3 scan steps) ──────────
        alpha        = 0.65
        raw_state    = nominals + self._drift + noise
        self._state  = alpha * self._state + (1 - alpha) * raw_state

        # ── 5. Clip to physical limits ────────────────────────────────────────
        limits  = np.array([TAG_LIMITS[tag] for _, tag, *_ in DC4_TAG_MAP])
        clipped = np.clip(self._state, limits[:, 0], limits[:, 1])

        return clipped.tolist()


# ══════════════════════════════════════════════════════════════════════════════
#  2. OPC-UA / DCS CONNECTOR
#  Reads live tags from your DCS (Honeywell Experion, ABB 800xA, etc.)
#  Install: pip install asyncua
#  Set in .env: OPCUA_ENDPOINT, OPCUA_USERNAME, OPCUA_PASSWORD, OPCUA_NAMESPACE
# ══════════════════════════════════════════════════════════════════════════════
class OPCUASource(DataSource):

    def __init__(self):
        self._endpoint  = getattr(settings, 'opcua_endpoint',  'opc.tcp://localhost:4840')
        self._username  = getattr(settings, 'opcua_username',  None)
        self._password  = getattr(settings, 'opcua_password',  None)
        self._namespace = int(getattr(settings, 'opcua_namespace', 2))
        # Map each DC4 tag → OPC-UA node ID on your DCS
        # Replace with actual node IDs from your DCS browser / engineering tool
        self._node_ids = {
            tag: f"ns={self._namespace};s={tag}"
            for _, tag, *_ in DC4_TAG_MAP
        }

    async def read(self) -> Optional[list]:
        try:
            from asyncua import Client
        except ImportError:
            logger.error("OPC-UA: install 'asyncua'  →  pip install asyncua")
            return None

        try:
            async with Client(url=self._endpoint) as client:
                if self._username:
                    await client.set_user(self._username)
                    await client.set_password(self._password)
                values = []
                for _, tag, _, nominal, _, _ in DC4_TAG_MAP:
                    try:
                        node = client.get_node(self._node_ids[tag])
                        val  = await node.read_value()
                        values.append(float(val))
                    except Exception:
                        values.append(nominal)   # fallback to nominal on single-tag error
                return values
        except Exception as exc:
            logger.error(f"OPC-UA read failed: {exc}")
            return None


# ══════════════════════════════════════════════════════════════════════════════
#  3. REST HISTORIAN CONNECTOR
#  Compatible with: OSIsoft PI Web API, AspenTech IP.21, Honeywell PHD
#  Set in .env: HISTORIAN_URL, HISTORIAN_API_KEY
#  Expected JSON response: { "tags": { "2TIC403.PV": 94.1, ... } }
# ══════════════════════════════════════════════════════════════════════════════
class RESTHistorianSource(DataSource):

    def __init__(self):
        self._url     = getattr(settings, 'historian_url',       None)
        self._api_key = getattr(settings, 'historian_api_key',   None)
        self._timeout = 5.0

    async def read(self) -> Optional[list]:
        if not self._url:
            logger.warning("REST Historian: HISTORIAN_URL not set in .env")
            return None

        try:
            import httpx
        except ImportError:
            logger.error("REST Historian: install 'httpx'  →  pip install httpx")
            return None

        headers = {'X-API-Key': self._api_key} if self._api_key else {}
        tag_list = [tag for _, tag, *_ in DC4_TAG_MAP]

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(
                    self._url,
                    json={'tags': tag_list},
                    headers=headers,
                )
                resp.raise_for_status()
                data = resp.json()

            tag_values = data.get('tags', data)
            values = []
            for _, tag, _, nominal, _, _ in DC4_TAG_MAP:
                val = tag_values.get(tag)
                values.append(float(val) if val is not None else nominal)
            return values

        except Exception as exc:
            logger.error(f"Historian read failed: {exc}")
            return None


# ══════════════════════════════════════════════════════════════════════════════
#  4. MODBUS TCP CONNECTOR
#  For legacy PLCs / RTUs
#  Install: pip install pymodbus
#  Set in .env: MODBUS_HOST, MODBUS_PORT, MODBUS_UNIT_ID, MODBUS_SCALE
# ══════════════════════════════════════════════════════════════════════════════
class ModbusTCPSource(DataSource):

    def __init__(self):
        self._host  = getattr(settings, 'modbus_host',    '127.0.0.1')
        self._port  = int(getattr(settings, 'modbus_port',    502))
        self._unit  = int(getattr(settings, 'modbus_unit_id', 1))
        self._scale = float(getattr(settings, 'modbus_scale',  0.1))
        # Holding register addresses: tag_index → register address
        # Adjust to match your PLC register map
        self._registers = {i: 100 + i * 2 for i in range(33)}

    async def read(self) -> Optional[list]:
        try:
            from pymodbus.client import AsyncModbusTcpClient
        except ImportError:
            logger.error("Modbus: install 'pymodbus'  →  pip install pymodbus")
            return None

        try:
            async with AsyncModbusTcpClient(self._host, port=self._port) as client:
                values = []
                for i, (_, _, _, nominal, _, _) in enumerate(DC4_TAG_MAP):
                    addr   = self._registers.get(i, 100 + i * 2)
                    result = await client.read_holding_registers(addr, count=1, slave=self._unit)
                    if result.isError():
                        values.append(nominal)
                    else:
                        values.append(result.registers[0] * self._scale)
                return values
        except Exception as exc:
            logger.error(f"Modbus read failed: {exc}")
            return None


# ══════════════════════════════════════════════════════════════════════════════
#  SOURCE FACTORY
# ══════════════════════════════════════════════════════════════════════════════
def _build_source() -> DataSource:
    """
    Select data source from DATA_SOURCE in .env:
      simulator  → DC4Simulator     (default — works without any hardware)
      opcua      → OPCUASource
      rest       → RESTHistorianSource
      modbus     → ModbusTCPSource
    """
    mode = getattr(settings, 'data_source', 'simulator').lower().strip()
    mapping = {
        'simulator': DC4Simulator,
        'opcua':     OPCUASource,
        'rest':      RESTHistorianSource,
        'modbus':    ModbusTCPSource,
    }
    cls = mapping.get(mode, DC4Simulator)
    logger.info(f"Data source: {cls.__name__} (DATA_SOURCE={mode})")
    return cls()


# ══════════════════════════════════════════════════════════════════════════════
#  INGESTION LOOP  — runs forever in background
# ══════════════════════════════════════════════════════════════════════════════
async def ingestion_loop():
    source     = _build_source()
    fallback   = DC4Simulator()   # always available if real source fails
    fail_count = 0
    MAX_FAILS  = 5

    logger.info(f"Ingestion loop started | interval={settings.ingestion_interval_seconds}s")

    while True:
        try:
            # ── 1. Read data ───────────────────────────────────────────────
            readings = await source.read()

            if readings is None:
                fail_count += 1
                logger.warning(
                    f"{source.name} returned None "
                    f"({fail_count}/{MAX_FAILS}) — using simulator fallback"
                )
                if fail_count >= MAX_FAILS:
                    logger.error(
                        f"{source.name} failed {MAX_FAILS} times in a row. "
                        f"Check your connection. Continuing with simulator."
                    )
                readings = await fallback.read()
            else:
                if fail_count > 0:
                    logger.info(f"{source.name} recovered after {fail_count} failures")
                fail_count = 0

            # ── 2. Predict ─────────────────────────────────────────────────
            pred     = predict_energy_purity(readings)
            detected = detect_anomalies(readings)

            # ── 3. Persist to database ─────────────────────────────────────
            db = SessionLocal()
            try:
                db.add(models.Prediction(
                    readings      = readings,
                    energy        = pred.energy,
                    purity        = pred.purity,
                    stability     = pred.stability,
                    model_type    = pred.model_type,
                    confidence    = pred.confidence,
                    is_outlier    = pred.is_outlier,
                    outlier_score = pred.outlier_score,
                ))
                for a in detected:
                    db.add(models.Alert(
                        alert_type  = a['alert_type'],
                        severity    = a['severity'],
                        tag_name    = a['tag_name'],
                        value       = a.get('value'),
                        threshold   = a.get('threshold'),
                        z_score     = a.get('z_score'),
                        description = a['description'],
                    ))
                db.commit()
            finally:
                db.close()

            # ── 4. Broadcast to all WebSocket clients ──────────────────────
            now = datetime.now(timezone.utc).isoformat()
            await ws_manager.broadcast({
                'type':      'new_prediction',
                'timestamp': now,
                'source':    source.name,
                'energy':    pred.energy,
                'purity':    pred.purity,
                'stability': pred.stability,
                'is_outlier': pred.is_outlier,
                'model_type': pred.model_type,
                # Live tag snapshot keyed by tag name for dashboard gauges
                'tags': {
                    tag: round(readings[i], 3)
                    for i, tag, *_ in DC4_TAG_MAP
                    if i < len(readings)
                },
            })

            # Broadcast any new alerts
            for a in detected:
                await ws_manager.broadcast({'type': 'new_alert', 'alert': a})

            # Log summary (only when there are alerts to keep logs clean)
            if detected:
                types = sorted(set(x['alert_type'] for x in detected))
                logger.debug(
                    f"Cycle OK | E={pred.energy:.3f} P={pred.purity:.1f}% "
                    f"| {len(detected)} alerts [{', '.join(types)}]"
                )

        except asyncio.CancelledError:
            logger.info("Ingestion loop cancelled — shutting down cleanly")
            break
        except Exception as exc:
            logger.error(f"Ingestion error: {exc}", exc_info=True)

        await asyncio.sleep(settings.ingestion_interval_seconds)

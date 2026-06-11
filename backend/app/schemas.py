"""
OPTIQ DSS · Pydantic Schemas (request / response models)
"""
from pydantic import BaseModel, Field
from datetime import datetime
from typing import List, Optional, Any, Dict


# ── Auth ──────────────────────────────────────────────────────────────────────
class Token(BaseModel):
    access_token: str
    token_type: str


class UserCreate(BaseModel):
    username:   str = Field(..., min_length=3, max_length=64)
    password:   str = Field(..., min_length=8)
    role:       str = Field("operator", pattern="^(system_admin|company_admin|engineer|operator|viewer|admin)$")
    company_id: Optional[int] = None


class UserOut(BaseModel):
    id:         int
    username:   str
    role:       str
    is_active:  bool
    company_id: Optional[int] = None

    model_config = {"from_attributes": True}


# ── Sensor / Prediction ───────────────────────────────────────────────────────
class SensorReadings(BaseModel):
    readings:   List[float] = Field(..., min_length=1)
    column_tag: str = "DC4"


class PredictionOut(BaseModel):
    energy:        float
    purity:        float
    butane:        float = 0.0
    stability:     float = 0.0
    model_type:    str   = "xgboost"
    confidence:    float = 1.0
    is_outlier:    bool  = False
    outlier_score: float = 0.0
    timestamp:     datetime = Field(default_factory=datetime.utcnow)

    model_config = {"from_attributes": True}


# ── Optimization ──────────────────────────────────────────────────────────────
class OptimizeRequest(BaseModel):
    current_state: List[float] = Field(
        ..., min_length=1,
        description="Current OP setpoints (1–5 values)"
    )
    base_readings: Optional[List[float]] = Field(
        None,
        description="Live 33-sensor vector (optional)"
    )
    column_tag:    str = Field("DC4", description="Which column to optimise")


class OptimizeOut(BaseModel):
    # Stored result ID (for apply-tracking)
    result_id:                   Optional[int] = None

    # Setpoints
    current_setpoints:           List[float]
    recommended_setpoints:       List[float]

    # Energy
    current_energy:              float
    expected_energy:             float
    energy_savings_percent:      float

    # Purity
    current_purity:              float
    expected_purity:             float
    purity_improvement_percent:  float

    # Butane
    current_butane:              float = 0.0
    expected_butane:             float = 0.0
    butane_improvement_percent:  float = 0.0

    # Metadata
    status:                      str
    feasibility_score:           float
    computed_at:                 Optional[datetime] = None
    process_snapshot:            Optional[Dict[str, float]] = None
    sp_config:                   Optional[List[Dict[str, Any]]] = None  # admin SP config attached


# ── Apply recommendation ──────────────────────────────────────────────────────
class SimulationStep(BaseModel):
    step:              int
    energy:            float
    purity:            float
    butane:            float
    energy_delta_pct:  float = 0.0
    purity_delta_pct:  float = 0.0


class ApplyRecommendationOut(BaseModel):
    result_id:           int
    applied_at:          datetime
    applied_by_username: str
    message:             str = "Recommendation confirmed as applied"
    simulation:          list[SimulationStep] = []


# ── Staleness check ───────────────────────────────────────────────────────────
class DriftCheckRequest(BaseModel):
    result_id:        int
    current_readings: Dict[str, float]


class DriftCheckOut(BaseModel):
    result_id:    int
    stale:        bool
    max_drift_pct: float
    drifted_tags: List[str]
    message:      str


# ── Alerts ────────────────────────────────────────────────────────────────────
class AlertOut(BaseModel):
    id:           int
    timestamp:    datetime
    alert_type:   str
    tag_name:     str
    severity:     str
    value:        Optional[float]
    threshold:    Optional[float]
    z_score:      Optional[float]
    description:  str
    acknowledged: bool
    column_tag:   str = "DC4"

    model_config = {"from_attributes": True}


# ── Company Branding ──────────────────────────────────────────────────────────
class CompanyCreate(BaseModel):
    slug:             str = Field(..., min_length=2, max_length=64, pattern="^[a-z0-9-]+$")
    name:             str = Field(..., min_length=2, max_length=128)
    sector:           str = "LNG"
    logo_url:         Optional[str] = None
    primary_color:    str = Field("#00D9FF", pattern="^#[0-9A-Fa-f]{6}$")
    accent_color:     str = Field("#FFD700", pattern="^#[0-9A-Fa-f]{6}$")
    background_color: str = Field("#0D1B2A", pattern="^#[0-9A-Fa-f]{6}$")
    api_endpoint:     Optional[str] = None


class CompanyUpdate(BaseModel):
    name:             Optional[str] = None
    sector:           Optional[str] = None
    logo_url:         Optional[str] = None
    primary_color:    Optional[str] = Field(None, pattern="^#[0-9A-Fa-f]{6}$")
    accent_color:     Optional[str] = Field(None, pattern="^#[0-9A-Fa-f]{6}$")
    background_color: Optional[str] = Field(None, pattern="^#[0-9A-Fa-f]{6}$")
    api_endpoint:     Optional[str] = None
    is_active:        Optional[bool] = None


class CompanyOut(BaseModel):
    id:               int
    slug:             str
    name:             str
    sector:           str
    logo_url:         Optional[str]
    primary_color:    str
    accent_color:     str
    background_color: str
    api_endpoint:     Optional[str]
    is_active:        bool
    created_at:       datetime
    updated_at:       datetime

    model_config = {"from_attributes": True}


# ── Sites ─────────────────────────────────────────────────────────────────────
class SiteCreate(BaseModel):
    company_id:  int
    name:        str = Field(..., min_length=2, max_length=128)
    location:    Optional[str] = None
    description: Optional[str] = None


class SiteUpdate(BaseModel):
    name:        Optional[str] = None
    location:    Optional[str] = None
    description: Optional[str] = None
    is_active:   Optional[bool] = None


class SiteOut(BaseModel):
    id:          int
    company_id:  int
    name:        str
    location:    Optional[str]
    description: Optional[str]
    is_active:   bool
    created_at:  datetime

    model_config = {"from_attributes": True}


# ── Distillation columns ───────────────────────────────────────────────────────
class ColumnCreate(BaseModel):
    site_id:        int
    name:           str = Field(..., min_length=2, max_length=128)
    tag:            str = Field(..., min_length=2, max_length=32)
    sequence_order: int = 1
    description:    Optional[str] = None
    feed_from:      Optional[str] = None
    product_name:   Optional[str] = None
    bottoms_name:   Optional[str] = None
    model_path:     Optional[str] = None
    config:         Optional[Dict[str, Any]] = None


class ColumnUpdate(BaseModel):
    name:           Optional[str] = None
    sequence_order: Optional[int] = None
    description:    Optional[str] = None
    feed_from:      Optional[str] = None
    product_name:   Optional[str] = None
    bottoms_name:   Optional[str] = None
    model_path:     Optional[str] = None
    config:         Optional[Dict[str, Any]] = None
    is_active:      Optional[bool] = None


class ColumnOut(BaseModel):
    id:             int
    site_id:        int
    name:           str
    tag:            str
    sequence_order: int
    description:    Optional[str]
    feed_from:      Optional[str]
    product_name:   Optional[str]
    bottoms_name:   Optional[str]
    model_path:     Optional[str]
    config:         Optional[Dict[str, Any]]
    is_active:      bool
    created_at:     datetime
    updated_at:     datetime

    model_config = {"from_attributes": True}


# ── Optimization Results ──────────────────────────────────────────────────────
class OptimizationResultOut(BaseModel):
    id:                     int
    column_tag:             str
    requested_by_username:  str
    requested_at:           datetime
    current_setpoints:      List[float]
    recommended_setpoints:  List[float]
    current_energy:         float
    expected_energy:        float
    energy_savings_pct:     float
    current_purity:         float
    expected_purity:        float
    purity_improvement_pct: float
    status:                 str
    feasibility_score:      float
    applied:                bool
    applied_at:             Optional[datetime]
    applied_by_username:    Optional[str]

    model_config = {"from_attributes": True}


# ── Audit Log ─────────────────────────────────────────────────────────────────
class AuditLogOut(BaseModel):
    id:          int
    timestamp:   datetime
    username:    Optional[str]
    role:        Optional[str]
    action:      str
    endpoint:    Optional[str]
    detail:      Optional[Any]
    ip_address:  Optional[str]
    status_code: Optional[int]

    model_config = {"from_attributes": True}


# ── Statistics ────────────────────────────────────────────────────────────────
class StatsOut(BaseModel):
    column_tag:          str
    period_hours:        int
    total_predictions:   int
    avg_energy:          float
    min_energy:          float
    max_energy:          float
    avg_purity:          float
    min_purity:          float
    max_purity:          float
    total_optimizations: int
    total_applied:       int
    avg_energy_saving:   float
    total_alerts:        int
    critical_alerts:     int


# ── Setpoint Config (admin-customisable SP values) ───────────────────────────
class SetpointEntry(BaseModel):
    tag:         str
    desc:        str   = ""
    unit:        str   = ""
    nominal:     float = 0.0
    lo:          float = 0.0
    hi:          float = 0.0
    recommended: Optional[float] = None   # admin-set recommended value


class SetpointConfigOut(BaseModel):
    column_tag: str
    setpoints:  List[SetpointEntry]


class SetpointConfigUpdate(BaseModel):
    setpoints: List[SetpointEntry]


# ── App Config (key/value store)

class ConfigSet(BaseModel):
    key:   str
    value: Any
�─────────────────────────
class ConfigSet(BaseModel):
    key:   str
    value: Any


# ── Pareto (legacy) ────
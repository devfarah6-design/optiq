"""
OPTIQ DSS · Pydantic Schemas (request / response models)
"""
from pydantic import BaseModel, Field
from datetime import datetime
from typing import List, Optional, Dict, Any


# ── Auth ──────────────────────────────────────────────────────────────────────
class Token(BaseModel):
    access_token: str
    token_type: str


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)
    password: str = Field(..., min_length=8)
    role: str = Field("operator", pattern="^(admin|operator|viewer)$")


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool
    company_id: Optional[int] = None

    model_config = {"from_attributes": True}


# ── Sensor / Prediction ───────────────────────────────────────────────────────
class SensorReadings(BaseModel):
    readings: List[float] = Field(..., min_length=1)


class PredictionOut(BaseModel):
    energy: float
    purity: float
    stability: float = 0.0
    model_type: str = "xgboost"
    confidence: float = 1.0
    is_outlier: bool = False
    outlier_score: float = 0.0
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"from_attributes": True}


# ── Optimization ──────────────────────────────────────────────────────────────
class OptimizeRequest(BaseModel):
    current_state: List[float] = Field(..., min_length=3, max_length=3)


class OptimizeOut(BaseModel):
    current_setpoints: List[float]
    recommended_setpoints: List[float]
    current_energy: float
    expected_energy: float
    current_purity: float
    expected_purity: float
    energy_savings_percent: float
    purity_improvement_percent: float
    status: str                         # optimal | warning | critical
    feasibility_score: float


# ── Alerts ────────────────────────────────────────────────────────────────────
class AlertOut(BaseModel):
    id: int
    timestamp: datetime
    alert_type: str
    tag_name: str
    severity: str
    value: Optional[float]
    threshold: Optional[float]
    z_score: Optional[float]
    description: str
    acknowledged: bool

    model_config = {"from_attributes": True}


# ── Company Branding ──────────────────────────────────────────────────────────
class CompanyCreate(BaseModel):
    slug: str = Field(..., min_length=2, max_length=64, pattern="^[a-z0-9-]+$")
    name: str = Field(..., min_length=2, max_length=128)
    sector: str = "LNG"
    logo_url: Optional[str] = None
    primary_color: str = Field("#00D9FF", pattern="^#[0-9A-Fa-f]{6}$")
    accent_color: str = Field("#FFD700", pattern="^#[0-9A-Fa-f]{6}$")
    background_color: str = Field("#0D1B2A", pattern="^#[0-9A-Fa-f]{6}$")
    api_endpoint: Optional[str] = None


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    sector: Optional[str] = None
    logo_url: Optional[str] = None
    primary_color: Optional[str] = Field(None, pattern="^#[0-9A-Fa-f]{6}$")
    accent_color: Optional[str] = Field(None, pattern="^#[0-9A-Fa-f]{6}$")
    background_color: Optional[str] = Field(None, pattern="^#[0-9A-Fa-f]{6}$")
    api_endpoint: Optional[str] = None
    is_active: Optional[bool] = None
class ParetoSolution(BaseModel):
    setpoints: List[float]     # [T1, T2, T3]
    energy: float
    purity: float
    gain: float

class ParetoOut(BaseModel):
    solutions: List[ParetoSolution]
    best_index: int            # the recommended balanced solution

class CompanyOut(BaseModel):
    id: int
    slug: str
    name: str
    sector: str
    logo_url: Optional[str]
    primary_color: str
    accent_color: str
    background_color: str
    api_endpoint: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── App Config ────────────────────────────────────────────────────────────────
class ConfigSet(BaseModel):
    key: str
    value: Any

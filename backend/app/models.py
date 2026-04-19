"""
OPTIQ DSS · Database Models
"""
import enum
from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, Float, Boolean,
    Enum, JSON, Text, ForeignKey, DateTime,Sequence
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


# ── Helper ────────────────────────────────────────────────────────────────────
def utcnow() -> datetime:
    """Return current UTC time as a timezone-aware datetime."""
    return datetime.now(timezone.utc)


class UserRole(str, enum.Enum):
    ADMIN    = "admin"
    OPERATOR = "operator"
    VIEWER   = "viewer"


class AlertSeverity(str, enum.Enum):
    INFO     = "info"
    WARNING  = "warning"
    CRITICAL = "critical"


# ── Users ─────────────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id              = Column(Integer, primary_key=True, index=True)
    username        = Column(Text, unique=True, nullable=False, index=True)
    hashed_password = Column(Text, nullable=False)
    role            = Column(Enum(UserRole), default=UserRole.OPERATOR, nullable=False)
    is_active       = Column(Boolean, default=True)
    created_at      = Column(DateTime(timezone=True), default=utcnow)
    company_id      = Column(Integer, ForeignKey("companies.id"), nullable=True)


# ── Company Branding ──────────────────────────────────────────────────────────
class Company(Base):
    __tablename__ = "companies"

    id               = Column(Integer, primary_key=True, index=True)
    slug             = Column(Text, unique=True, nullable=False, index=True)
    name             = Column(Text, nullable=False)
    sector           = Column(Text, default="LNG")
    logo_url         = Column(Text, nullable=True)
    primary_color    = Column(Text, default="#00D9FF")
    accent_color     = Column(Text, default="#FFD700")
    background_color = Column(Text, default="#0D1B2A")
    api_endpoint     = Column(Text, nullable=True)
    is_active        = Column(Boolean, default=True)
    created_at       = Column(DateTime(timezone=True), default=utcnow)
    updated_at       = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    users = relationship("User", backref="company", foreign_keys=[User.company_id])


# ── Predictions ───────────────────────────────────────────────────────────────
prediction_id_seq = Sequence('prediction_id_seq')

class Prediction(Base):
    __tablename__ = "predictions"

    id            = Column(Integer, prediction_id_seq,
                           server_default=prediction_id_seq.next_value(),
                           nullable=False, index=True)
    timestamp     = Column(DateTime(timezone=True), default=utcnow,
                           nullable=False, primary_key=True)
    readings      = Column(JSON, nullable=False)
    energy        = Column(Float, nullable=False)
    purity        = Column(Float, nullable=False)
    stability     = Column(Float, default=0.0)
    model_type    = Column(Text, default="xgboost")
    confidence    = Column(Float, default=1.0)
    is_outlier    = Column(Boolean, default=False)
    outlier_score = Column(Float, default=0.0)


# ── Alerts ────────────────────────────────────────────────────────────────────
class Alert(Base):
    __tablename__ = "alerts"

    id              = Column(Integer, primary_key=True, index=True)
    timestamp       = Column(DateTime(timezone=True), default=utcnow, index=True)
    alert_type      = Column(Text, nullable=False)
    severity        = Column(Enum(AlertSeverity), default=AlertSeverity.INFO)
    tag_name        = Column(Text, nullable=False)
    value           = Column(Float, nullable=True)
    threshold       = Column(Float, nullable=True)
    z_score         = Column(Float, nullable=True)
    description     = Column(Text, nullable=False)
    acknowledged    = Column(Boolean, default=False)
    acknowledged_by = Column(Text, nullable=True)


# ── App Config ────────────────────────────────────────────────────────────────
class AppConfig(Base):
    __tablename__ = "app_config"

    id         = Column(Integer, primary_key=True, index=True)
    key        = Column(Text, unique=True, nullable=False, index=True)
    value      = Column(JSON, nullable=True)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
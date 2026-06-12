"""
OPTIQ DSS · Database Models
"""
import enum
from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, Float, Boolean, String,
    Enum, JSON, Text, ForeignKey, DateTime, Sequence
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ── Roles ──────────────────────────────────────────────────────────────────────
class UserRole(str, enum.Enum):
    SYSTEM_ADMIN  = "system_admin"   # can add/delete companies
    COMPANY_ADMIN = "company_admin"  # can add sites/columns within their company
    ENGINEER      = "engineer"       # can run optimisation, apply recommendations
    OPERATOR      = "operator"       # dashboard + acknowledge alerts
    VIEWER        = "viewer"         # read-only dashboard

    # Legacy alias — kept for backward compat
    ADMIN = "admin"


class AlertSeverity(str, enum.Enum):
    INFO     = "info"
    WARNING  = "warning"
    CRITICAL = "critical"


# ── Companies ──────────────────────────────────────────────────────────────────
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

    sites = relationship("Site", back_populates="company", cascade="all, delete-orphan")


# ── Sites (branches / plants within a company) ────────────────────────────────
class Site(Base):
    __tablename__ = "sites"

    id          = Column(Integer, primary_key=True, index=True)
    company_id  = Column(Integer, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    name        = Column(Text, nullable=False)
    location    = Column(Text, nullable=True)   # city / GPS coords / plant tag
    description = Column(Text, nullable=True)
    is_active   = Column(Boolean, default=True)
    created_at  = Column(DateTime(timezone=True), default=utcnow)

    company = relationship("Company", back_populates="sites")
    columns = relationship("DistillationColumn", back_populates="site", cascade="all, delete-orphan")


# ── Distillation columns ───────────────────────────────────────────────────────
class DistillationColumn(Base):
    """
    Represents one distillation column in the fractionation train.
    sequence_order defines the position in the sequential process chain.
    config stores setpoint definitions, bounds, model path, etc.
    """
    __tablename__ = "distillation_columns"

    id             = Column(Integer, primary_key=True, index=True)
    site_id        = Column(Integer, ForeignKey("sites.id", ondelete="CASCADE"), nullable=False)
    name           = Column(Text, nullable=False)          # e.g. "DC4 Debutanizer"
    tag            = Column(Text, nullable=False)          # e.g. "DC4"
    sequence_order = Column(Integer, default=1)            # position in the train
    description    = Column(Text, nullable=True)
    feed_from      = Column(Text, nullable=True)           # upstream column tag
    product_name   = Column(Text, nullable=True)           # e.g. "Butane"
    bottoms_name   = Column(Text, nullable=True)           # e.g. "C5+"
    model_path     = Column(Text, nullable=True)           # surrogate model file
    config         = Column(JSON, nullable=True)           # setpoints, bounds, tags
    is_active      = Column(Boolean, default=True)
    created_at     = Column(DateTime(timezone=True), default=utcnow)
    updated_at     = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    site = relationship("Site", back_populates="columns")


# ── Users ──────────────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id              = Column(Integer, primary_key=True, index=True)
    username        = Column(Text, unique=True, nullable=False, index=True)
    hashed_password = Column(Text, nullable=False)
    role            = Column(Enum(UserRole, values_callable=lambda obj: [e.value for e in obj]),
                             default=UserRole.OPERATOR, nullable=False)
    is_active       = Column(Boolean, default=True)
    created_at      = Column(DateTime(timezone=True), default=utcnow)
    company_id      = Column(Integer, ForeignKey("companies.id"), nullable=True)

    company = relationship("Company", foreign_keys=[company_id])


# ── Predictions (TimescaleDB hypertable) ──────────────────────────────────────
prediction_id_seq = Sequence('prediction_id_seq')

class Prediction(Base):
    __tablename__ = "predictions"

    id            = Column(Integer, prediction_id_seq,
                           server_default=prediction_id_seq.next_value(),
                           nullable=False, index=True)
    timestamp     = Column(DateTime(timezone=True), default=utcnow,
                           nullable=False, primary_key=True)
    column_tag    = Column(Text, default="DC4")            # which column this prediction is for
    readings      = Column(JSON,    nullable=False)
    energy        = Column(Float,   nullable=False)
    purity        = Column(Float,   nullable=False)
    butane        = Column(Float,   nullable=False, default=0.0)
    stability     = Column(Float,   default=0.0)
    model_type    = Column(Text,    default="xgboost")
    confidence    = Column(Float,   default=1.0)
    is_outlier    = Column(Boolean, default=False)
    outlier_score = Column(Float,   default=0.0)


# ── Optimization Results (stored for apply-tracking + staleness) ──────────────
class OptimizationResult(Base):
    """
    Persisted snapshot of each optimisation call.
    Applied when the engineer clicks "I Applied This".
    """
    __tablename__ = "optimization_results"

    id                    = Column(Integer, primary_key=True, index=True)
    column_tag            = Column(Text, default="DC4")
    requested_by_id       = Column(Integer, ForeignKey("users.id"), nullable=True)
    requested_by_username = Column(Text, nullable=False)
    requested_at          = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    # The process snapshot at recommendation time
    process_snapshot      = Column(JSON, nullable=True)   # dict of tag→value

    # Setpoints
    current_setpoints     = Column(JSON, nullable=False)
    recommended_setpoints = Column(JSON, nullable=False)

    # Predicted improvements
    current_energy        = Column(Float, nullable=False)
    expected_energy       = Column(Float, nullable=False)
    energy_savings_pct    = Column(Float, nullable=False)
    current_purity        = Column(Float, nullable=False)
    expected_purity       = Column(Float, nullable=False)
    purity_improvement_pct = Column(Float, nullable=False)
    status                = Column(Text, default="optimal")
    feasibility_score     = Column(Float, default=1.0)

    # Application tracking ("I Applied This")
    applied               = Column(Boolean, default=False)
    applied_at            = Column(DateTime(timezone=True), nullable=True)
    applied_by_id         = Column(Integer, ForeignKey("users.id"), nullable=True)
    applied_by_username   = Column(Text, nullable=True)

    # FOPDT predicted trajectory — stored on apply so /tracking can compare later
    predicted_trajectory  = Column(JSON, nullable=True)

    requested_by = relationship("User", foreign_keys=[requested_by_id])
    applied_by   = relationship("User", foreign_keys=[applied_by_id])


# ── Alerts ────────────────────────────────────────────────────────────────────
class Alert(Base):
    __tablename__ = "alerts"

    id              = Column(Integer, primary_key=True, index=True)
    timestamp       = Column(DateTime(timezone=True), default=utcnow, index=True)
    column_tag      = Column(Text, default="DC4")
    alert_type      = Column(Text,    nullable=False)
    severity        = Column(Enum(AlertSeverity, values_callable=lambda obj: [e.value for e in obj]),
                             default=AlertSeverity.INFO)
    tag_name        = Column(Text,    nullable=False)
    value           = Column(Float,   nullable=True)
    threshold       = Column(Float,   nullable=True)
    z_score         = Column(Float,   nullable=True)
    description     = Column(Text,    nullable=False)
    acknowledged    = Column(Boolean, default=False)
    acknowledged_by = Column(Text,    nullable=True)


# ── Audit Log ─────────────────────────────────────────────────────────────────
class AuditLog(Base):
    """
    Append-only record of every important action in OPTIQ.
    Written by the audit middleware on every protected endpoint call.
    """
    __tablename__ = "audit_log"

    id          = Column(Integer, primary_key=True, index=True)
    timestamp   = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    user_id     = Column(Integer, ForeignKey("users.id"), nullable=True)
    username    = Column(Text, nullable=True)
    role        = Column(Text, nullable=True)
    action      = Column(Text, nullable=False, index=True)  # e.g. LOGIN, OPTIMIZE, APPLY_RECOMMENDATION
    endpoint    = Column(Text, nullable=True)               # e.g. POST /optimize
    detail      = Column(JSON, nullable=True)               # extra payload (setpoints, column, etc.)
    ip_address  = Column(Text, nullable=True)
    status_code = Column(Integer, nullable=True)            # HTTP response code


# ── App Config ────────────────────────────────────────────────────────────────
class AppConfig(Base):
    __tablename__ = "app_config"

    id         = Column(Integer, primary_key=True, index=True)
    key        = Column(Text, unique=True, nullable=False, index=True)
    value      = Column(JSON, nullable=True)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

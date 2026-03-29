"""
OPTIQ DSS · Database Models
"""
import enum
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime,
    Enum, JSON, Text, ForeignKey
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    OPERATOR = "operator"
    VIEWER = "viewer"


class AlertSeverity(str, enum.Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


# ── Users ─────────────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    hashed_password = Column(String(256), nullable=False)
    role = Column(Enum(UserRole), default=UserRole.OPERATOR, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=True)


# ── Company Branding ──────────────────────────────────────────────────────────
class Company(Base):
    """Multi-tenant company branding configuration."""
    __tablename__ = "companies"

    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String(64), unique=True, nullable=False, index=True)
    name = Column(String(128), nullable=False)
    sector = Column(String(64), default="LNG")

    # Branding
    logo_url = Column(Text, nullable=True)
    primary_color = Column(String(7), default="#00D9FF")   # hex
    accent_color = Column(String(7), default="#FFD700")
    background_color = Column(String(7), default="#0D1B2A")

    # API / integration
    api_endpoint = Column(Text, nullable=True)

    # Metadata
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    users = relationship("User", backref="company", foreign_keys=[User.company_id])


# ── Predictions ───────────────────────────────────────────────────────────────
class Prediction(Base):
    __tablename__ = "predictions"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    readings = Column(JSON, nullable=False)
    energy = Column(Float, nullable=False)
    purity = Column(Float, nullable=False)
    stability = Column(Float, default=0.0)
    model_type = Column(String(32), default="xgboost")
    confidence = Column(Float, default=1.0)
    is_outlier = Column(Boolean, default=False)
    outlier_score = Column(Float, default=0.0)


# ── Alerts ────────────────────────────────────────────────────────────────────
class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    alert_type = Column(String(32), nullable=False)       # stuck_sensor | outlier | drift
    severity = Column(Enum(AlertSeverity), default=AlertSeverity.INFO)
    tag_name = Column(String(64), nullable=False)
    value = Column(Float, nullable=True)
    threshold = Column(Float, nullable=True)
    z_score = Column(Float, nullable=True)
    description = Column(Text, nullable=False)
    acknowledged = Column(Boolean, default=False)
    acknowledged_by = Column(String(64), nullable=True)


# ── App Config (key-value store) ──────────────────────────────────────────────
class AppConfig(Base):
    __tablename__ = "app_config"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(128), unique=True, nullable=False, index=True)
    value = Column(JSON, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

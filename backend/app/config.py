"""
OPTIQ DSS · Configuration
Loads all settings from environment variables / .env file.
"""
import os
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    # ── Database ─────────────────────────────────────────────
    database_url: str = Field(..., alias="DATABASE_URL")
    postgres_user: str = Field("optiq", alias="POSTGRES_USER")
    postgres_password: str = Field("password", alias="POSTGRES_PASSWORD")
    postgres_db: str = Field("optiq_db", alias="POSTGRES_DB")

    # ── Security ─────────────────────────────────────────────
    secret_key: str = Field(..., alias="SECRET_KEY")
    algorithm: str = Field("HS256", alias="ALGORITHM")
    access_token_expire_minutes: int = Field(480, alias="ACCESS_TOKEN_EXPIRE_MINUTES")

    # ── ML Model ─────────────────────────────────────────────
    model_path: str = Field("models/best_xgb_model.pkl", alias="MODEL_PATH")

    # ── Admin credentials (used for initial seed only) ───────
    admin_username: str = Field("admin", alias="ADMIN_USERNAME")
    admin_password: str = Field("oadmin1", alias="ADMIN_PASSWORD")

    # ── Process parameters ────────────────────────────────────
    stuck_sensor_threshold: float = Field(0.01, alias="STUCK_SENSOR_THRESHOLD")
    outlier_z_score_threshold: float = Field(3.5, alias="OUTLIER_Z_SCORE_THRESHOLD")
    ingestion_interval_seconds: int = Field(5, alias="INGESTION_INTERVAL_SECONDS")
    max_history_size: int = Field(200, alias="MAX_HISTORY_SIZE")

    # ── Logging ───────────────────────────────────────────────
    log_level: str = Field("INFO", alias="LOG_LEVEL")
    debug: bool = Field(False, alias="DEBUG")

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "populate_by_name": True,
        "extra": "ignore",
    }


settings = Settings()

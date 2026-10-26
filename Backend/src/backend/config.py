"""Application configuration."""
import tempfile
from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # API
    app_title: str = "Time Series Forecasting API"
    app_version: str = "1.0.0"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # File storage
    upload_dir: Path = Path(tempfile.gettempdir()) / "ts_forecasting" / "uploads"
    max_upload_bytes: int = 50 * 1024 * 1024  # 50 MB

    # Job state
    job_ttl_seconds: int = 3600  # 1 hour

    # Forecasting defaults
    default_validation_split: float = 0.75
    default_validation_horizon: int = 12
    default_forecast_horizon: int = 12
    seed: int = 42

    # Header detection
    header_scan_rows: int = 5

    class Config:
        env_prefix = "TS_"


settings = Settings()

# Ensure upload directory exists
settings.upload_dir.mkdir(parents=True, exist_ok=True)


"""Pydantic schemas for training."""
from typing import Any

from pydantic import BaseModel, Field, field_validator


class TrainingRequest(BaseModel):
    dataset_id: str
    filters: dict[str, list[str]] = Field(default_factory=dict)
    bu_entities: dict[str, list[str]] | None = None  # { "BU": ["entity1", "entity2"] }
    accounts: list[str] | None = None  # ["PL01", ...]
    forecast_horizon: int = Field(default=12, ge=1, le=60)
    validation_split: float = Field(default=0.75, gt=0, lt=1)
    candidate_models: list[str] | None = None  # None = use all available

    @field_validator("forecast_horizon")
    @classmethod
    def horizon_reasonable(cls, v: int) -> int:
        if v < 1 or v > 60:
            raise ValueError("Forecast horizon must be between 1 and 60")
        return v


class CandidateResult(BaseModel):
    model_name: str
    mape: float | None
    mae: float | None
    rmse: float | None
    duration_seconds: float
    status: str  # "OK" | "FAILED" | "SKIPPED"
    error: str | None = None


class JobProgress(BaseModel):
    completed: int
    total: int
    current_model: str
    message: str


class JobStatus(BaseModel):
    job_id: str
    status: str  # "running" | "completed" | "failed"
    stage: str
    progress: JobProgress
    elapsed_seconds: float
    error: str | None = None
    log_tail: list[str] = Field(default_factory=list)


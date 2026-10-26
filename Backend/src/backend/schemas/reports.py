"""Pydantic schemas for reports."""
from typing import Any

from pydantic import BaseModel


class ForecastPoint(BaseModel):
    date: str
    value: float | None
    lower_bound: float | None = None
    upper_bound: float | None = None


class ValidationMetrics(BaseModel):
    start: str
    end: str
    mape: float | None
    mae: float | None
    rmse: float | None


class ValidationPoint(BaseModel):
    date: str
    actual: float | None
    predicted: float | None
    error: float | None


class HistoricalPoint(BaseModel):
    date: str
    value: float | None


class ForecastReportResponse(BaseModel):
    job_id: str
    best_model: str
    selection_metric: str
    validation: ValidationMetrics
    candidate_results: list[dict[str, Any]]
    historical: list[HistoricalPoint]
    validation_series: list[ValidationPoint]
    forecast: list[ForecastPoint]
    warnings: list[str]


class TrendInfo(BaseModel):
    direction: str  # "increasing" | "decreasing" | "stable"
    description: str
    values: list[HistoricalPoint]


class SeasonalityInfo(BaseModel):
    detected: bool
    period: int | None
    description: str
    values: list[HistoricalPoint]


class ACFInfo(BaseModel):
    lags: list[int]
    acf_values: list[float | None]
    description: str


class ExplanationReportResponse(BaseModel):
    job_id: str
    best_model: str
    model_family: str
    why_selected: str
    trend: TrendInfo | None
    seasonality: SeasonalityInfo | None
    acf: ACFInfo | None
    data_warnings: list[str]
    limitations: list[str]


class SegmentResult(BaseModel):
    segment_id: str
    label: str
    best_model: str | None
    mape: float | None
    mae: float | None
    status: str
    forecast_total: float | None
    error: str | None = None


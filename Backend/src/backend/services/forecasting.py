"""
Forecasting service.

Retrains the selected model on all available history and generates
future forecasts.
"""
from __future__ import annotations

import warnings as _warnings
from dataclasses import dataclass, field

import pandas as pd
from darts import TimeSeries

from backend.services.model_registry import create_model


@dataclass
class ForecastResult:
    dates: list[str]        # ISO date strings
    values: list[float | None]
    lower_bounds: list[float | None]
    upper_bounds: list[float | None]
    model_name: str


def generate_forecast(
    model_name: str,
    full_series: TimeSeries,
    horizon: int,
) -> ForecastResult:
    """
    Retrain a fresh instance of model_name on all available history,
    then forecast `horizon` future periods.

    Never uses validation split or previous fitted models.
    """
    with _warnings.catch_warnings():
        _warnings.simplefilter("ignore")
        model = create_model(model_name)
        model.fit(full_series)
        forecast = model.predict(horizon)

    # Extract dates and values
    time_index = pd.DatetimeIndex(forecast.time_index)
    values_arr = forecast.values().flatten()

    dates = [ts.strftime("%Y-%m-%d") for ts in time_index]
    values = [float(v) if not pd.isna(v) else None for v in values_arr]

    return ForecastResult(
        dates=dates,
        values=values,
        lower_bounds=[None] * horizon,
        upper_bounds=[None] * horizon,
        model_name=model_name,
    )


def extract_series_points(ts: TimeSeries) -> list[dict]:
    """Convert a Darts TimeSeries to a list of {date, value} dicts."""
    time_index = pd.DatetimeIndex(ts.time_index)
    values = ts.values().flatten()
    return [
        {
            "date": t.strftime("%Y-%m-%d"),
            "value": float(v) if not pd.isna(v) else None,
        }
        for t, v in zip(time_index, values)
    ]


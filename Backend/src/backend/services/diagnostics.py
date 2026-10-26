"""
Diagnostics service.

Uses statsmodels (STL and seasonal_decompose) and darts.utils.statistics
for robust trend, seasonality, and ACF analysis.
Handles positive, negative, and zero values reliably.
"""
from __future__ import annotations

import warnings as _warnings
from dataclasses import dataclass

import numpy as np
import pandas as pd
from darts import TimeSeries
from darts.utils.statistics import check_seasonality
from statsmodels.tsa.seasonal import STL, seasonal_decompose

from backend.services.forecasting import extract_series_points

MIN_OBS_TREND = 12
MIN_OBS_SEASONALITY = 24
MIN_OBS_ACF = 8


@dataclass
class TrendInfo:
    direction: str   # "increasing" | "decreasing" | "stable"
    description: str
    values: list[dict]   # list of {date, value}


@dataclass
class SeasonalityInfo:
    detected: bool
    period: int | None
    description: str
    values: list[dict]   # seasonal component if available


@dataclass
class ACFInfo:
    lags: list[int]
    acf_values: list[float | None]
    description: str


def analyse_trend(ts: TimeSeries) -> TrendInfo | None:
    """Extract and characterise the trend component using statsmodels STL / seasonal_decompose."""
    if len(ts) < MIN_OBS_TREND:
        return None

    s = ts.to_series()
    trend_vals: np.ndarray | None = None
    trend_points: list[dict] = []

    # 1. Primary: Use statsmodels STL (Loess decomposition)
    if len(s) >= MIN_OBS_SEASONALITY:
        with _warnings.catch_warnings():
            _warnings.simplefilter("ignore")
            try:
                stl = STL(s, period=12, robust=True).fit()
                trend_s = stl.trend
                trend_vals = trend_s.values
                trend_points = [
                    {"date": t.strftime("%Y-%m-%d"), "value": float(v)}
                    for t, v in zip(trend_s.index, trend_vals)
                ]
            except Exception:
                trend_vals = None

    # 2. Secondary fallback: seasonal_decompose
    if trend_vals is None or len(trend_points) < 2:
        with _warnings.catch_warnings():
            _warnings.simplefilter("ignore")
            try:
                decomp = seasonal_decompose(s, model="additive", period=min(12, max(2, len(s) // 2)))
                trend_s = decomp.trend.dropna()
                if len(trend_s) >= 2:
                    trend_vals = trend_s.values
                    trend_points = [
                        {"date": t.strftime("%Y-%m-%d"), "value": float(v)}
                        for t, v in zip(trend_s.index, trend_vals)
                    ]
            except Exception:
                trend_vals = None

    # 3. Tertiary fallback: linear polynomial fit
    if trend_vals is None or len(trend_points) < 2:
        return _linear_trend_fallback(ts)

    first_quarter = trend_vals[: max(1, len(trend_vals) // 4)]
    last_quarter = trend_vals[max(1, 3 * len(trend_vals) // 4):]
    delta = float(np.nanmean(last_quarter) - np.nanmean(first_quarter))
    baseline = float(np.nanmean(np.abs(trend_vals)))
    rel = delta / baseline if baseline != 0 else 0

    if rel > 0.05:
        direction = "increasing"
        desc = f"The series shows an upward trend over the analysed period (approx. {rel * 100:.1f}% change)."
    elif rel < -0.05:
        direction = "decreasing"
        desc = f"The series shows a downward trend over the analysed period (approx. {abs(rel) * 100:.1f}% change)."
    else:
        direction = "stable"
        desc = "The series is broadly stable, with fluctuations around its estimated trend."

    return TrendInfo(
        direction=direction,
        description=desc,
        values=trend_points,
    )


def _linear_trend_fallback(ts: TimeSeries) -> TrendInfo | None:
    """Simple linear regression fallback when decomposition fails."""
    vals = ts.values().flatten()
    n = len(vals)
    if n < 4:
        return None
    x = np.arange(n, dtype=float)
    valid = ~np.isnan(vals)
    if valid.sum() < 4:
        return None
    slope = float(np.polyfit(x[valid], vals[valid], 1)[0])
    mean_abs = float(np.nanmean(np.abs(vals)))
    total_change = slope * n
    rel = total_change / mean_abs if mean_abs != 0 else 0

    if rel > 0.05:
        direction = "increasing"
        desc = f"The series shows an upward trend (linear estimate: {rel * 100:.1f}% total change)."
    elif rel < -0.05:
        direction = "decreasing"
        desc = f"The series shows a downward trend (linear estimate: {abs(rel) * 100:.1f}% total change)."
    else:
        direction = "stable"
        desc = "The series appears broadly stable based on linear trend estimation."

    trend_vals = np.poly1d(np.polyfit(x[valid], vals[valid], 1))(x)
    time_index = pd.DatetimeIndex(ts.time_index)
    trend_points = [
        {"date": t.strftime("%Y-%m-%d"), "value": float(v)}
        for t, v in zip(time_index, trend_vals)
    ]
    return TrendInfo(direction=direction, description=desc, values=trend_points)


def analyse_seasonality(ts: TimeSeries) -> SeasonalityInfo | None:
    """
    Check for annual (m=12) seasonality and extract the seasonal component
    using statsmodels STL and seasonal_decompose.
    """
    if len(ts) < MIN_OBS_SEASONALITY:
        return SeasonalityInfo(
            detected=False,
            period=None,
            description=(
                "Insufficient history to perform a reliable seasonality test "
                f"(need ≥{MIN_OBS_SEASONALITY} observations)."
            ),
            values=[],
        )

    s = ts.to_series()
    period_detected: int | None = None
    is_seasonal = False
    seasonal_values: list[dict] = []

    # 1. Statistical check via Darts check_seasonality
    with _warnings.catch_warnings():
        _warnings.simplefilter("ignore")
        try:
            is_seasonal, period = check_seasonality(ts, m=12, max_lag=24)
            if is_seasonal:
                period_detected = int(period)
        except Exception:
            is_seasonal = False
            period_detected = None

    # 2. Extract seasonal component with statsmodels STL (robust to negative & extreme values)
    with _warnings.catch_warnings():
        _warnings.simplefilter("ignore")
        try:
            stl = STL(s, period=12, robust=True).fit()
            seasonal_s = stl.seasonal
            seasonal_values = [
                {"date": t.strftime("%Y-%m-%d"), "value": float(v)}
                for t, v in zip(seasonal_s.index, seasonal_s.values)
            ]
            # If STL reveals significant annual seasonal amplitude, mark as seasonal
            amp = float(seasonal_s.max() - seasonal_s.min())
            data_range = float(s.max() - s.min())
            if data_range > 0 and (amp / data_range) > 0.05:
                is_seasonal = True
                period_detected = 12
        except Exception:
            # Fallback to classical additive seasonal_decompose
            try:
                decomp = seasonal_decompose(s, model="additive", period=12)
                seasonal_s = decomp.seasonal.dropna()
                seasonal_values = [
                    {"date": t.strftime("%Y-%m-%d"), "value": float(v)}
                    for t, v in zip(seasonal_s.index, seasonal_s.values)
                ]
                is_seasonal = True
                period_detected = 12
            except Exception:
                pass

    if is_seasonal and period_detected:
        desc = (
            f"Annual seasonality detected with a period of {period_detected} observations. "
            "The series repeats a recognisable seasonal pattern each year."
        )
    elif seasonal_values:
        desc = (
            "Seasonal variation extracted via statistical decomposition, "
            "showing cyclical fluctuations around the underlying trend."
        )
    else:
        desc = (
            "No statistically significant annual seasonality was detected. "
            "The series may still have irregular fluctuations."
        )

    return SeasonalityInfo(
        detected=is_seasonal,
        period=period_detected or (12 if seasonal_values else None),
        description=desc,
        values=seasonal_values,
    )


def analyse_acf(ts: TimeSeries, max_lag: int = 24) -> ACFInfo | None:
    """Compute autocorrelation function values."""
    if len(ts) < MIN_OBS_ACF:
        return None

    with _warnings.catch_warnings():
        _warnings.simplefilter("ignore")
        try:
            from statsmodels.tsa.stattools import acf as sm_acf
            vals = ts.values().flatten()
            valid = vals[~np.isnan(vals)]
            if len(valid) < MIN_OBS_ACF:
                return None
            nlags = min(max_lag, len(valid) - 2)
            acf_values, _ = sm_acf(valid, nlags=nlags, alpha=0.05)
            lags = list(range(nlags + 1))
            return ACFInfo(
                lags=lags,
                acf_values=[float(v) if not np.isnan(v) else None for v in acf_values],
                description=(
                    "Autocorrelation function (ACF) showing the correlation between "
                    "the series and its past values at each lag. "
                    "Significant spikes at lag 12 suggest annual seasonality."
                ),
            )
        except Exception:
            return None

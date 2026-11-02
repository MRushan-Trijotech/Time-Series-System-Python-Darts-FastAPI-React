"""
Model registry — mirrors the notebook's candidate model configuration.

Theta and AutoTheta are excluded per user request.
All models are created fresh via factory lambdas (never reused across fits).
"""
from __future__ import annotations

import warnings
from typing import Callable

from darts.models import (
    ARIMA,
    AutoARIMA,
    AutoETS,
    ExponentialSmoothing,
    LinearRegressionModel,
    NaiveSeasonal,
    Prophet,
    RandomForestModel,
)

SEED = 42

# Optional ML models — imported conditionally
try:
    from darts.models import CatBoostModel as _CatBoostModel
    _HAS_CATBOOST = True
except ImportError:
    _HAS_CATBOOST = False

try:
    from darts.models import LightGBMModel as _LightGBMModel
    _HAS_LIGHTGBM = True
except ImportError:
    _HAS_LIGHTGBM = False

try:
    from darts.models import XGBModel as _XGBModel
    _HAS_XGB = True
except ImportError:
    _HAS_XGB = False

# Minimum observations required for a model to run
MODEL_MIN_OBS: dict[str, int] = {
    "NaiveSeasonal": 13,
    "ARIMA": 10,
    "AutoARIMA": 10,
    "ExponentialSmoothing": 8,
    "AutoETS": 8,
    "Prophet": 10,
    "LinearRegressionModel": 25,
    "RandomForestModel": 25,
    "CatBoostModel": 25,
    "LightGBMModel": 25,
    "XGBModel": 25,
}

# Model family description for display
MODEL_FAMILY: dict[str, str] = {
    "NaiveSeasonal": "Baseline",
    "ARIMA": "Statistical",
    "AutoARIMA": "Statistical",
    "ExponentialSmoothing": "Statistical",
    "AutoETS": "Statistical",
    "Prophet": "Statistical",
    "LinearRegressionModel": "Machine Learning",
    "RandomForestModel": "Machine Learning",
    "CatBoostModel": "Machine Learning",
    "LightGBMModel": "Machine Learning",
    "XGBModel": "Machine Learning",
}


def _build_registry() -> dict[str, Callable]:
    registry: dict[str, Callable] = {
        "NaiveSeasonal": lambda: NaiveSeasonal(K=12),
        "ARIMA": lambda: ARIMA(p=2, d=1, q=1),
        "AutoARIMA": lambda: AutoARIMA(
            season_length=12,
            seasonal=True,
            max_p=3,
            max_q=3,
            max_P=1,
            max_Q=1,
        ),
        "ExponentialSmoothing": lambda: ExponentialSmoothing(),
        "AutoETS": lambda: AutoETS(season_length=12),
        "Prophet": lambda: Prophet(
            yearly_seasonality=True,
            weekly_seasonality=False,
            daily_seasonality=False,
            seasonality_mode="additive",
            changepoint_prior_scale=0.05,
        ),
        "LinearRegressionModel": lambda: LinearRegressionModel(
            lags=12,
            output_chunk_length=12,
        ),
        "RandomForestModel": lambda: RandomForestModel(
            lags=12,
            output_chunk_length=12,
            n_estimators=200,
            max_depth=8,
            random_state=SEED,
            n_jobs=-1,
        ),
    }

    if _HAS_CATBOOST:
        registry["CatBoostModel"] = lambda: _CatBoostModel(
            lags=12,
            output_chunk_length=12,
            iterations=300,
            depth=6,
            learning_rate=0.03,
            random_seed=SEED,
            verbose=False,
        )

    if _HAS_LIGHTGBM:
        registry["LightGBMModel"] = lambda: _LightGBMModel(
            lags=12,
            output_chunk_length=12,
            n_estimators=200,
            learning_rate=0.03,
            max_depth=6,
            random_state=SEED,
            verbose=-1,
        )

    if _HAS_XGB:
        registry["XGBModel"] = lambda: _XGBModel(
            lags=12,
            output_chunk_length=12,
            n_estimators=200,
            max_depth=5,
            learning_rate=0.03,
            random_state=SEED,
            verbosity=0,
            n_jobs=-1,
        )

    return registry


CANDIDATE_MODELS: dict[str, Callable] = _build_registry()


def get_available_models() -> dict[str, bool]:
    """Return model_name -> is_available mapping."""
    all_names = list(MODEL_MIN_OBS.keys())
    available: dict[str, bool] = {}
    for name in all_names:
        if name == "CatBoostModel":
            available[name] = _HAS_CATBOOST
        elif name == "LightGBMModel":
            available[name] = _HAS_LIGHTGBM
        elif name == "XGBModel":
            available[name] = _HAS_XGB
        else:
            available[name] = True
    return available


def create_model(name: str):
    """Create a fresh model instance by name."""
    if name not in CANDIDATE_MODELS:
        raise KeyError(f"Unknown model: {name!r}. Available: {list(CANDIDATE_MODELS)}")
    return CANDIDATE_MODELS[name]()


def filter_eligible_models(
    requested: list[str] | None,
    n_train_observations: int,
) -> list[str]:
    """
    Return the subset of requested models that:
    - are available (package installed)
    - have enough training observations
    """
    if requested is None:
        requested = list(CANDIDATE_MODELS.keys())

    available = get_available_models()
    eligible = []
    for name in requested:
        if name not in CANDIDATE_MODELS:
            continue
        if not available.get(name, False):
            continue
        min_obs = MODEL_MIN_OBS.get(name, 10)
        if n_train_observations >= min_obs:
            eligible.append(name)
    return eligible


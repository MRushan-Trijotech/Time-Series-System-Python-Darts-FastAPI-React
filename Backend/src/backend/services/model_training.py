"""
Training and evaluation service.

Runs synchronously — mirrors the notebook pattern exactly.
Candidate models are evaluated one-by-one on the training/validation split.
"""
from __future__ import annotations

import time
import warnings as _warnings
from dataclasses import dataclass, field

import numpy as np
from darts import TimeSeries
from darts.metrics import mae, mape, rmse

from backend.services.model_registry import create_model
from backend.utils.serialization import safe_float


@dataclass
class CandidateResult:
    model_name: str
    mape: float | None
    mae: float | None
    rmse: float | None
    duration_seconds: float
    status: str  # "OK" | "FAILED" | "SKIPPED"
    error: str | None = None


def safe_mape(actual: TimeSeries, predicted: TimeSeries) -> float | None:
    """Return MAPE or None if actuals contain zeros or result is invalid."""
    try:
        val = mape(actual, predicted)
        return safe_float(val)
    except Exception:
        return None


def safe_mae(actual: TimeSeries, predicted: TimeSeries) -> float | None:
    try:
        return safe_float(mae(actual, predicted))
    except Exception:
        return None


def safe_rmse(actual: TimeSeries, predicted: TimeSeries) -> float | None:
    try:
        return safe_float(rmse(actual, predicted))
    except Exception:
        return None


def evaluate_candidates(
    model_names: list[str],
    train_series: TimeSeries,
    validation_series: TimeSeries,
    progress_callback: callable | None = None,
) -> list[CandidateResult]:
    """
    Evaluate each candidate model on train/validation split.
    Runs synchronously, just like the notebook.

    progress_callback(model_name: str, done: int, total: int) is called
    after each evaluation to report progress.
    """
    results: list[CandidateResult] = []
    total = len(model_names)
    val_horizon = len(validation_series)

    with _warnings.catch_warnings():
        _warnings.simplefilter("ignore")

        for i, model_name in enumerate(model_names):
            if progress_callback:
                progress_callback(model_name, i, total)

            start = time.time()
            try:
                model = create_model(model_name)
                model.fit(train_series)
                prediction = model.predict(val_horizon)
                elapsed = time.time() - start

                m_mape = safe_mape(validation_series, prediction)
                m_mae = safe_mae(validation_series, prediction)
                m_rmse = safe_rmse(validation_series, prediction)

                results.append(
                    CandidateResult(
                        model_name=model_name,
                        mape=m_mape,
                        mae=m_mae,
                        rmse=m_rmse,
                        duration_seconds=elapsed,
                        status="OK",
                    )
                )
            except Exception as exc:
                elapsed = time.time() - start
                results.append(
                    CandidateResult(
                        model_name=model_name,
                        mape=None,
                        mae=None,
                        rmse=None,
                        duration_seconds=elapsed,
                        status="FAILED",
                        error=str(exc)[:400],
                    )
                )

    if progress_callback:
        progress_callback("done", total, total)

    return results


def select_best(results: list[CandidateResult]) -> CandidateResult | None:
    """
    Select the candidate with the lowest finite validation MAPE.
    Returns None if no candidate produced a valid MAPE.
    """
    valid = [r for r in results if r.status == "OK" and r.mape is not None]
    if not valid:
        return None
    return min(valid, key=lambda r: r.mape)  # type: ignore[arg-type]


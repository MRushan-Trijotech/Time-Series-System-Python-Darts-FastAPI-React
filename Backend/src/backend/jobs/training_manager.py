"""
Training job manager.

Keeps training simple — no ThreadPoolExecutor complexity.
Training runs in a single background thread per job; the thread updates
job state in-place so the status endpoint can poll it.
"""
from __future__ import annotations

import threading
import time
import uuid
import warnings as _warnings
from dataclasses import dataclass, field
from typing import Any

import pandas as pd
from darts import TimeSeries

from backend.schemas.training import TrainingRequest
from backend.services import (
    diagnostics,
    model_registry,
    model_training,
    series_builder,
)
from backend.services.forecasting import extract_series_points, generate_forecast
from backend.utils.serialization import json_safe


@dataclass
class JobState:
    job_id: str
    status: str = "running"   # "running" | "completed" | "failed"
    stage: str = "initializing"
    progress_completed: int = 0
    progress_total: int = 1
    current_model: str = ""
    elapsed_seconds: float = 0.0
    error: str | None = None
    log_tail: list[str] = field(default_factory=list)
    results: dict[str, Any] | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    _start: float = field(default_factory=time.time, repr=False)

    def log(self, msg: str) -> None:
        with self._lock:
            self.log_tail.append(msg)
            if len(self.log_tail) > 50:
                self.log_tail = self.log_tail[-50:]
            self.elapsed_seconds = time.time() - self._start

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            self.elapsed_seconds = time.time() - self._start
            return {
                "job_id": self.job_id,
                "status": self.status,
                "stage": self.stage,
                "progress": {
                    "completed": self.progress_completed,
                    "total": self.progress_total,
                    "current_model": self.current_model,
                    "message": self.log_tail[-1] if self.log_tail else "",
                },
                "elapsed_seconds": round(self.elapsed_seconds, 1),
                "error": self.error,
                "log_tail": list(self.log_tail[-10:]),
            }


# Global job registry
_jobs: dict[str, JobState] = {}
_jobs_lock = threading.Lock()


def get_job(job_id: str) -> JobState | None:
    with _jobs_lock:
        return _jobs.get(job_id)


def _run_training(
    job: JobState,
    request: TrainingRequest,
    long_df: pd.DataFrame,
    dimension_columns: list[str],
    frequency: str,
) -> None:
    """
    The actual training logic — runs in a background thread.
    Updates job state throughout so the status endpoint reflects real progress.
    """
    try:
        # ── Stage 1: Build aggregate series ──────────────────────────────
        job.stage = "building_series"
        job.log("Building aggregate time series from filtered data…")

        series_result = series_builder.build_aggregate_series(
            long_df=long_df,
            filters=request.filters,
            dimension_columns=dimension_columns,
            frequency=frequency,
            bu_entities=request.bu_entities,
            accounts=request.accounts,
        )
        total_ts = series_result.total_series
        n_obs = len(total_ts)
        job.log(f"Series built: {n_obs} observations ({series_result.date_range_start.date()} → {series_result.date_range_end.date()})")
        for w in series_result.warnings:
            job.log(f"Warning: {w}")

        # ── Stage 2: Train/validation split ──────────────────────────────
        job.stage = "splitting_data"
        job.log(f"Splitting data (validation split={request.validation_split})…")

        train_ts, validation_ts = total_ts.split_before(request.validation_split)
        job.log(f"Train observations: {len(train_ts)}, Validation observations: {len(validation_ts)}")

        # ── Stage 3: Select eligible models ──────────────────────────────
        eligible = model_registry.filter_eligible_models(
            request.candidate_models,
            n_train_observations=len(train_ts),
        )
        skipped = [
            m for m in (request.candidate_models or list(model_registry.CANDIDATE_MODELS))
            if m not in eligible
        ]
        for m in skipped:
            job.log(f"Skipped model '{m}': insufficient training observations or unavailable.")

        job.progress_total = len(eligible) + 2  # +2 for final retrain + forecast
        job.log(f"Evaluating {len(eligible)} candidate models…")

        # ── Stage 4: Evaluate candidates ─────────────────────────────────
        job.stage = "model_evaluation"
        candidate_results: list[model_training.CandidateResult] = []

        def _progress_cb(model_name: str, done: int, total: int) -> None:
            job.current_model = model_name
            job.progress_completed = done
            job.log(f"Evaluating: {model_name} ({done + 1}/{total})…")

        with _warnings.catch_warnings():
            _warnings.simplefilter("ignore")
            candidate_results = model_training.evaluate_candidates(
                model_names=eligible,
                train_series=train_ts,
                validation_series=validation_ts,
                progress_callback=_progress_cb,
            )

        for r in candidate_results:
            if r.status == "OK":
                job.log(
                    f"  {r.model_name}: MAPE={r.mape:.2f}% | MAE={r.mae:,.0f} | "
                    f"RMSE={r.rmse:,.0f} | {r.duration_seconds:.1f}s"
                    if r.mape is not None else
                    f"  {r.model_name}: MAPE=N/A (zero actuals?) | {r.duration_seconds:.1f}s"
                )
            else:
                job.log(f"  {r.model_name}: FAILED — {r.error}")

        # ── Stage 5: Select best model ────────────────────────────────────
        job.stage = "selecting_best_model"
        best = model_training.select_best(candidate_results)
        if best is None:
            raise RuntimeError(
                "No candidate model produced a valid MAPE. "
                "Check the errors above and verify the data does not contain all-zero values."
            )
        job.log(f"Best model selected: {best.model_name} (MAPE={best.mape:.2f}%)")
        job.progress_completed = len(eligible)

        # ── Stage 6: Final retrain on full history ────────────────────────
        job.stage = "final_training"
        job.current_model = best.model_name
        job.log(f"Retraining {best.model_name} on full history ({n_obs} observations)…")

        forecast_result = generate_forecast(
            model_name=best.model_name,
            full_series=total_ts,
            horizon=request.forecast_horizon,
        )
        job.progress_completed = len(eligible) + 1
        job.log(
            f"Forecast generated: {request.forecast_horizon} future periods "
            f"({forecast_result.dates[0]} → {forecast_result.dates[-1]})"
        )

        # ── Stage 7: Diagnostics ─────────────────────────────────────────
        job.stage = "diagnostics"
        job.log("Running trend and seasonality diagnostics…")
        trend_info = diagnostics.analyse_trend(total_ts)
        seasonality_info = diagnostics.analyse_seasonality(total_ts)
        acf_info = diagnostics.analyse_acf(total_ts)

        # ── Stage 8: Assemble results ─────────────────────────────────────
        job.stage = "assembling_results"
        job.log("Assembling report data…")

        historical_points = extract_series_points(total_ts)
        val_train_points = extract_series_points(train_ts)
        val_actual_points = extract_series_points(validation_ts)

        # Validation predictions from best model (using train split)
        with _warnings.catch_warnings():
            _warnings.simplefilter("ignore")
            val_model = model_registry.create_model(best.model_name)
            val_model.fit(train_ts)
            val_pred_ts = val_model.predict(len(validation_ts))

        val_pred_points = extract_series_points(val_pred_ts)
        val_actual_lookup = {p["date"]: p["value"] for p in val_actual_points}
        val_pred_lookup = {p["date"]: p["value"] for p in val_pred_points}
        all_val_dates = sorted(set(val_actual_lookup) | set(val_pred_lookup))
        validation_series = [
            {
                "date": d,
                "actual": val_actual_lookup.get(d),
                "predicted": val_pred_lookup.get(d),
                "error": (
                    (val_pred_lookup.get(d) or 0) - (val_actual_lookup.get(d) or 0)
                    if val_actual_lookup.get(d) is not None and val_pred_lookup.get(d) is not None
                    else None
                ),
            }
            for d in all_val_dates
        ]

        val_start = all_val_dates[0] if all_val_dates else ""
        val_end = all_val_dates[-1] if all_val_dates else ""

        # Model family for explanation
        model_family = model_registry.MODEL_FAMILY.get(best.model_name, "Unknown")
        skipped_model_names = [
            m for m in (request.candidate_models or list(model_registry.CANDIDATE_MODELS))
            if m not in eligible
        ]

        # Add skipped models to candidate_results list
        for m in skipped_model_names:
            candidate_results.append(
                model_training.CandidateResult(
                    model_name=m,
                    mape=None, mae=None, rmse=None,
                    duration_seconds=0.0,
                    status="SKIPPED",
                    error="Insufficient training observations or package not available.",
                )
            )

        results = {
            "forecast_report": {
                "job_id": job.job_id,
                "best_model": best.model_name,
                "selection_metric": "MAPE",
                "validation": {
                    "start": val_start,
                    "end": val_end,
                    "mape": best.mape,
                    "mae": best.mae,
                    "rmse": best.rmse,
                },
                "candidate_results": [
                    {
                        "model_name": r.model_name,
                        "mape": r.mape,
                        "mae": r.mae,
                        "rmse": r.rmse,
                        "duration_seconds": round(r.duration_seconds, 2),
                        "status": r.status,
                        "error": r.error,
                    }
                    for r in sorted(candidate_results, key=lambda r: (r.mape is None, r.mape or 0))
                ],
                "historical": historical_points,
                "validation_series": validation_series,
                "forecast": [
                    {
                        "date": d,
                        "value": v,
                        "lower_bound": None,
                        "upper_bound": None,
                    }
                    for d, v in zip(forecast_result.dates, forecast_result.values)
                ],
                "warnings": series_result.warnings,
            },
            "explanation_report": {
                "job_id": job.job_id,
                "best_model": best.model_name,
                "model_family": model_family,
                "why_selected": (
                    f"{best.model_name} was selected because it achieved the lowest "
                    f"validation MAPE of {best.mape:.2f}% "
                    f"over the validation period ({val_start} to {val_end})."
                    if best.mape is not None else
                    f"{best.model_name} was selected as the best available model."
                ),
                "trend": (
                    {
                        "direction": trend_info.direction,
                        "description": trend_info.description,
                        "values": trend_info.values,
                    }
                    if trend_info else None
                ),
                "seasonality": (
                    {
                        "detected": seasonality_info.detected,
                        "period": seasonality_info.period,
                        "description": seasonality_info.description,
                        "values": seasonality_info.values,
                    }
                    if seasonality_info else None
                ),
                "acf": (
                    {
                        "lags": acf_info.lags,
                        "acf_values": acf_info.acf_values,
                        "description": acf_info.description,
                    }
                    if acf_info else None
                ),
                "data_warnings": series_result.warnings,
                "limitations": [
                    "This forecast uses historical target values only — no external covariates.",
                    "In-memory results: restarting the server clears all jobs.",
                    "Confidence intervals are not yet available for this model selection.",
                ],
            },
        }

        job.results = json_safe(results)
        job.progress_completed = len(eligible) + 2
        job.stage = "completed"
        job.status = "completed"
        job.log("Training completed successfully.")

    except Exception as exc:
        import traceback
        job.error = str(exc)
        job.status = "failed"
        job.stage = "failed"
        job.log(f"ERROR: {exc}")
        # Log full traceback to server stderr (not exposed to client)
        traceback.print_exc()


def submit_job(
    request: TrainingRequest,
    long_df: pd.DataFrame,
    dimension_columns: list[str],
    frequency: str,
) -> str:
    """
    Create a new training job, start it in a background thread, and return the job_id.
    """
    job_id = str(uuid.uuid4())
    job = JobState(job_id=job_id)

    with _jobs_lock:
        _jobs[job_id] = job

    thread = threading.Thread(
        target=_run_training,
        args=(job, request, long_df, dimension_columns, frequency),
        daemon=True,
        name=f"training-{job_id[:8]}",
    )
    thread.start()
    return job_id


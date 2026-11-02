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
    # Entity-wise background training state
    entity_status: str = "pending"  # "pending" | "running" | "completed" | "failed"
    entity_progress_completed: int = 0
    entity_progress_total: int = 0
    entity_current_segment: str = ""
    entity_results: dict[str, Any] | None = None
    entity_error: str | None = None
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
                "entity_training": {
                    "status": self.entity_status,
                    "progress": {
                        "completed": self.entity_progress_completed,
                        "total": self.entity_progress_total,
                        "current_segment": self.entity_current_segment,
                        "percent": (
                            round((self.entity_progress_completed / self.entity_progress_total) * 100, 1)
                            if self.entity_progress_total > 0
                            else 0.0
                        ),
                    },
                    "error": self.entity_error,
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
            train_start=request.train_start,
            train_end=request.train_end,
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

        # Configuration summary for display on reports
        selected_bus = list(request.bu_entities.keys()) if request.bu_entities else (request.filters.get("Business unit") or [])
        config_summary = {
            "business_units": selected_bus,
            "bu_entities": request.bu_entities or {},
            "accounts": request.accounts or [],
            "forecast_horizon": request.forecast_horizon,
            "train_start": str(series_result.date_range_start.date()) if series_result else (request.train_start or ""),
            "train_end": str(series_result.date_range_end.date()) if series_result else (request.train_end or ""),
            "total_observations": n_obs,
        }

        results = {
            "forecast_report": {
                "job_id": job.job_id,
                "configuration": config_summary,
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
                "configuration": config_summary,
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

        # Launch background entity-wise segment training
        entity_thread = threading.Thread(
            target=_run_entity_training,
            args=(job, request, long_df, dimension_columns, frequency, forecast_result.dates),
            daemon=True,
            name=f"entity-training-{job.job_id[:8]}",
        )
        entity_thread.start()

    except Exception as exc:
        import traceback
        job.error = str(exc)
        job.status = "failed"
        job.stage = "failed"
        job.log(f"ERROR: {exc}")
        # Log full traceback to server stderr (not exposed to client)
        traceback.print_exc()


def _run_entity_training(
    job: JobState,
    request: TrainingRequest,
    long_df: pd.DataFrame,
    dimension_columns: list[str],
    frequency: str,
    forecast_dates: list[str],
) -> None:
    """
    Background worker that trains candidate models for each selected Business Unit
    and Legal Entity, selects the best champion model per segment, generates
    forecasts, and computes the monthly hierarchical distribution percentages.
    """
    try:
        job.entity_status = "running"
        bu_col = next((c for c in dimension_columns if "business unit" in c.lower()), "Business unit")
        ent_col = next((c for c in dimension_columns if "legal_entity" in c.lower() or "legal entity" in c.lower()), "SAC_Legal_Entity")

        # Discover Business Units and Entities
        bu_entities: dict[str, list[str]] = {}
        if request.bu_entities:
            for bu, ents in request.bu_entities.items():
                if ents:
                    bu_entities[bu] = list(ents)
                elif bu_col in long_df.columns and ent_col in long_df.columns:
                    sub = long_df[long_df[bu_col] == bu]
                    bu_entities[bu] = sorted(sub[ent_col].dropna().astype(str).unique().tolist())
                else:
                    bu_entities[bu] = []
        elif bu_col in long_df.columns and ent_col in long_df.columns:
            selected_bus = request.filters.get(bu_col) if request.filters else None
            df_filtered = long_df[long_df[bu_col].isin(selected_bus)] if selected_bus else long_df
            for bu in sorted(df_filtered[bu_col].dropna().astype(str).unique().tolist()):
                sub = df_filtered[df_filtered[bu_col] == bu]
                bu_entities[bu] = sorted(sub[ent_col].dropna().astype(str).unique().tolist())

        # Collect all entity segments
        entity_segments: list[tuple[str, str]] = []
        for bu, ents in bu_entities.items():
            for ent in ents:
                entity_segments.append((bu, ent))

        unique_bus = list(bu_entities.keys())
        total_steps = len(entity_segments) + len(unique_bus)
        job.entity_progress_total = max(1, total_steps)
        job.entity_progress_completed = 0

        target_months = [str(d)[:7] for d in forecast_dates]
        entity_results_map: dict[tuple[str, str], dict[str, Any]] = {}

        # ── 1. Train candidate models for each Legal Entity ─────────────
        for bu, ent in entity_segments:
            job.entity_current_segment = f"{bu} • Entity {ent}"
            try:
                # Build series for this single entity
                seg_res = series_builder.build_aggregate_series(
                    long_df=long_df,
                    filters=request.filters,
                    dimension_columns=dimension_columns,
                    frequency=frequency,
                    bu_entities={bu: [ent]},
                    accounts=request.accounts,
                    train_start=request.train_start,
                    train_end=request.train_end,
                )
                seg_ts = seg_res.total_series
                n_seg_obs = len(seg_ts)

                if n_seg_obs < 13:
                    from darts.models import NaiveMean
                    with _warnings.catch_warnings():
                        _warnings.simplefilter("ignore")
                        base_model = NaiveMean()
                        base_model.fit(seg_ts)
                        fc_ts = base_model.predict(request.forecast_horizon)
                        fc_pts = extract_series_points(fc_ts)
                        fc_map = {p["date"][:7]: float(p["value"] or 0.0) for p in fc_pts}
                    entity_results_map[(bu, ent)] = {
                        "best_model": "NaiveMean",
                        "mape": None,
                        "forecast": {m: fc_map.get(m, 0.0) for m in target_months},
                    }
                else:
                    val_size = max(1, min(6, int(n_seg_obs * 0.25)))
                    seg_train_ts = seg_ts[:-val_size]
                    seg_val_ts = seg_ts[-val_size:]

                    eligible_candidates = model_registry.filter_eligible_models(
                        request.candidate_models,
                        n_train_observations=len(seg_train_ts),
                    )
                    if not eligible_candidates:
                        from darts.models import NaiveMean
                        with _warnings.catch_warnings():
                            _warnings.simplefilter("ignore")
                            base_model = NaiveMean()
                            base_model.fit(seg_ts)
                            fc_ts = base_model.predict(request.forecast_horizon)
                            fc_pts = extract_series_points(fc_ts)
                            fc_map = {p["date"][:7]: float(p["value"] or 0.0) for p in fc_pts}
                        entity_results_map[(bu, ent)] = {
                            "best_model": "NaiveMean",
                            "mape": None,
                            "forecast": {m: fc_map.get(m, 0.0) for m in target_months},
                        }
                    else:
                        with _warnings.catch_warnings():
                            _warnings.simplefilter("ignore")
                            c_res = model_training.evaluate_candidates(
                                model_names=eligible_candidates,
                                train_series=seg_train_ts,
                                validation_series=seg_val_ts,
                            )
                        best_cand = model_training.select_best(c_res)
                        best_model_name = best_cand.model_name if best_cand else eligible_candidates[0]
                        best_mape = round(best_cand.mape, 2) if (best_cand and best_cand.mape is not None) else None

                        # Forecast with best model
                        with _warnings.catch_warnings():
                            _warnings.simplefilter("ignore")
                            fc_res = generate_forecast(
                                model_name=best_model_name,
                                full_series=seg_ts,
                                horizon=request.forecast_horizon,
                            )
                            fc_map = {str(d)[:7]: float(v or 0.0) for d, v in zip(fc_res.dates, fc_res.values)}

                        entity_results_map[(bu, ent)] = {
                            "best_model": best_model_name,
                            "mape": best_mape,
                            "forecast": {m: fc_map.get(m, 0.0) for m in target_months},
                        }
            except Exception:
                # Fallback on all zero if no data or series build fails
                entity_results_map[(bu, ent)] = {
                    "best_model": "ConstantZero",
                    "mape": None,
                    "forecast": {m: 0.0 for m in target_months},
                }

            job.entity_progress_completed += 1

        # ── 2. Train / evaluate candidate models for each Business Unit ─
        bu_best_models: dict[str, dict[str, Any]] = {}
        for bu in unique_bus:
            job.entity_current_segment = f"Business Unit {bu}"
            ents = bu_entities.get(bu, [])
            try:
                bu_seg_res = series_builder.build_aggregate_series(
                    long_df=long_df,
                    filters=request.filters,
                    dimension_columns=dimension_columns,
                    frequency=frequency,
                    bu_entities={bu: ents} if ents else None,
                    accounts=request.accounts,
                    train_start=request.train_start,
                    train_end=request.train_end,
                )
                bu_ts = bu_seg_res.total_series
                n_bu_obs = len(bu_ts)
                if n_bu_obs >= 13:
                    val_size = max(1, min(6, int(n_bu_obs * 0.25)))
                    bu_train_ts = bu_ts[:-val_size]
                    bu_val_ts = bu_ts[-val_size:]
                    eligible = model_registry.filter_eligible_models(
                        request.candidate_models,
                        n_train_observations=len(bu_train_ts),
                    )
                    if eligible:
                        with _warnings.catch_warnings():
                            _warnings.simplefilter("ignore")
                            c_res = model_training.evaluate_candidates(
                                model_names=eligible,
                                train_series=bu_train_ts,
                                validation_series=bu_val_ts,
                            )
                        best_cand = model_training.select_best(c_res)
                        bu_best_models[bu] = {
                            "best_model": best_cand.model_name if best_cand else eligible[0],
                            "mape": round(best_cand.mape, 2) if (best_cand and best_cand.mape is not None) else None,
                        }
                    else:
                        bu_best_models[bu] = {"best_model": "NaiveMean", "mape": None}
                else:
                    bu_best_models[bu] = {"best_model": "NaiveMean", "mape": None}
            except Exception:
                bu_best_models[bu] = {"best_model": "NaiveMean", "mape": None}

            job.entity_progress_completed += 1

        # ── 3. Assemble Monthly Hierarchy & Percentage Distribution ────
        hierarchy: list[dict[str, Any]] = []
        for m in target_months:
            # Calculate BU forecasts (sum of its entities)
            bu_forecast_totals: dict[str, float] = {}
            for bu in unique_bus:
                ents = bu_entities.get(bu, [])
                bu_total_m = sum(entity_results_map.get((bu, ent), {}).get("forecast", {}).get(m, 0.0) for ent in ents)
                bu_forecast_totals[bu] = bu_total_m

            # Month total is sum of all BUs
            month_total = sum(bu_forecast_totals.values())

            bu_list: list[dict[str, Any]] = []
            for bu in unique_bus:
                bu_val = bu_forecast_totals[bu]
                bu_pct = (bu_val / month_total * 100.0) if abs(month_total) > 1e-6 else 0.0

                ents = bu_entities.get(bu, [])
                ent_list: list[dict[str, Any]] = []
                for ent in ents:
                    ent_info = entity_results_map.get((bu, ent), {})
                    ent_val = ent_info.get("forecast", {}).get(m, 0.0)
                    ent_pct = (ent_val / month_total * 100.0) if abs(month_total) > 1e-6 else 0.0
                    ent_list.append({
                        "entity": ent,
                        "forecast": round(ent_val, 2),
                        "distribution_pct": round(ent_pct, 2),
                        "best_model": ent_info.get("best_model", "NaiveSeasonal"),
                        "mape": ent_info.get("mape"),
                    })

                bu_info = bu_best_models.get(bu, {"best_model": "NaiveSeasonal", "mape": None})
                bu_list.append({
                    "business_unit": bu,
                    "forecast": round(bu_val, 2),
                    "distribution_pct": round(bu_pct, 2),
                    "best_model": bu_info.get("best_model", "NaiveSeasonal"),
                    "mape": bu_info.get("mape"),
                    "entities": ent_list,
                })

            hierarchy.append({
                "month": m,
                "total_forecast": round(month_total, 2),
                "distribution_pct": 100.0,
                "business_units": bu_list,
            })

        # Resolve target account and description for Story-style reporting
        target_account = request.accounts[0] if request.accounts else "Target"
        desc_col = next((c for c in dimension_columns if "description" in c.lower()), None)
        target_desc = target_account
        if desc_col and desc_col in long_df.columns:
            acc_col = next((c for c in dimension_columns if c.lower() == "account"), "ACCOUNT")
            if acc_col in long_df.columns:
                matches = long_df[long_df[acc_col] == target_account][desc_col].dropna()
                if not matches.empty:
                    target_desc = str(matches.iloc[0])

        entity_forecasts_list = [
            {
                "business_unit": bu,
                "entity": ent,
                "account": target_account,
                "description": target_desc,
                "forecast": entity_results_map.get((bu, ent), {}).get("forecast", {}),
                "best_model": entity_results_map.get((bu, ent), {}).get("best_model", ""),
            }
            for (bu, ent) in entity_segments
        ]

        job.entity_results = json_safe({
            "months": target_months,
            "hierarchy": hierarchy,
            "entity_forecasts": entity_forecasts_list,
            "target_account": target_account,
            "target_description": target_desc,
            "total_segments": len(entity_segments),
            "total_business_units": len(unique_bus),
        })
        job.entity_status = "completed"
        job.log(f"Entity-wise background training completed ({len(entity_segments)} entities across {len(unique_bus)} BUs).")

    except Exception as exc:
        import traceback
        job.entity_status = "failed"
        job.entity_error = str(exc)
        job.log(f"Entity training failed: {exc}")
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


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
    schema_config: dict[str, Any] | None = None,
) -> None:
    """
    The actual training logic — runs in a background thread.
    Updates job state throughout so the status endpoint reflects real progress.
    """
    try:
        # ── Stage 1: Build aggregate series ──────────────────────────────
        job.stage = "building_series"
        job.log("Building aggregate time series from filtered data…")

        target_col = schema_config.get("target_column") if schema_config else None
        if not target_col:
            target_col = next((c for c in dimension_columns if c.lower() == "account"), dimension_columns[0] if dimension_columns else "ACCOUNT")

        series_result = series_builder.build_aggregate_series(
            long_df=long_df,
            filters=request.filters,
            dimension_columns=dimension_columns,
            frequency=frequency,
            bu_entities=request.bu_entities,
            accounts=request.accounts,
            train_start=request.train_start,
            train_end=request.train_end,
            hierarchy_selections=request.hierarchy_selections,
            target_column=target_col,
            target_value=request.target_value,
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
        target_col = schema_config.get("target_column") if schema_config else None
        desc_col = schema_config.get("description_column") if schema_config else None
        if not target_col:
            target_col = next((c for c in dimension_columns if c.lower() == "account"), dimension_columns[0] if dimension_columns else "ACCOUNT")
        if not desc_col:
            desc_col = next((c for c in dimension_columns if "description" in c.lower()), None)

        target_val = request.target_value or (request.accounts[0] if request.accounts else None)
        target_desc = str(target_val or "")
        if desc_col and desc_col in long_df.columns and target_col in long_df.columns and target_val:
            matches = long_df[long_df[target_col].astype(str) == str(target_val)][desc_col].dropna()
            if not matches.empty:
                target_desc = str(matches.iloc[0]).strip()

        hierarchy_levels: list[str] = []
        if schema_config and schema_config.get("hierarchy_columns"):
            hierarchy_levels = [c for c in schema_config["hierarchy_columns"] if c in long_df.columns]
        if not hierarchy_levels:
            bu_c = next((c for c in dimension_columns if "business unit" in c.lower()), None)
            ent_c = next((c for c in dimension_columns if "legal_entity" in c.lower() or "legal entity" in c.lower()), None)
            if bu_c and ent_c and bu_c in long_df.columns and ent_c in long_df.columns:
                hierarchy_levels = [bu_c, ent_c]
            else:
                hierarchy_levels = [c for c in dimension_columns if c != target_col and c != desc_col and c in long_df.columns]

        hierarchy_summary: dict[str, list[str]] = {}
        for h_lvl in hierarchy_levels:
            if request.hierarchy_selections:
                vals = sorted(list({s[h_lvl] for s in request.hierarchy_selections if h_lvl in s and s[h_lvl]}))
                hierarchy_summary[h_lvl] = vals
            elif request.filters and h_lvl in request.filters:
                hierarchy_summary[h_lvl] = request.filters[h_lvl]
            else:
                hierarchy_summary[h_lvl] = []

        config_summary = {
            "hierarchy_levels": hierarchy_levels,
            "hierarchy_summary": hierarchy_summary,
            "target_column": target_col,
            "target_value": target_val,
            "target_description": target_desc,
            "accounts": [target_val] if target_val else (request.accounts or []),
            "forecast_horizon": request.forecast_horizon,
            "train_start": str(series_result.date_range_start.date()) if series_result else (request.train_start or ""),
            "train_end": str(series_result.date_range_end.date()) if series_result else (request.train_end or ""),
            "total_observations": n_obs,
            "business_units": hierarchy_summary.get(hierarchy_levels[0] if hierarchy_levels else "Business unit", []),
            "bu_entities": request.bu_entities or {},
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

        # Launch background segment-wise training
        segment_thread = threading.Thread(
            target=_run_segment_training,
            args=(job, request, long_df, dimension_columns, frequency, forecast_result.dates, schema_config),
            daemon=True,
            name=f"segment-training-{job.job_id[:8]}",
        )
        segment_thread.start()

    except Exception as exc:
        import traceback
        job.error = str(exc)
        job.status = "failed"
        job.stage = "failed"
        job.log(f"ERROR: {exc}")
        # Log full traceback to server stderr (not exposed to client)
        traceback.print_exc()


def _run_segment_training(
    job: JobState,
    request: TrainingRequest,
    long_df: pd.DataFrame,
    dimension_columns: list[str],
    frequency: str,
    forecast_dates: list[str],
    schema_config: dict[str, Any] | None = None,
) -> None:
    """
    Background worker that trains candidate models for each leaf segment
    in the multi-level hierarchy (e.g. BU -> Legal Entity -> Product -> UOM),
    selects champion models, generates forecasts, and computes hierarchical distribution percentages.
    """
    try:
        job.entity_status = "running"

        # 1. Resolve Target Column & Description Column
        target_col = None
        desc_col = None
        if schema_config:
            target_col = schema_config.get("target_column")
            desc_col = schema_config.get("description_column")
        if not target_col:
            target_col = next((c for c in dimension_columns if c.lower() == "account"), dimension_columns[0] if dimension_columns else "ACCOUNT")
        if not desc_col:
            desc_col = next((c for c in dimension_columns if "description" in c.lower()), None)

        # 2. Resolve Target Value & Description
        target_val = request.target_value or (request.accounts[0] if request.accounts else None)
        if not target_val and target_col in long_df.columns:
            non_empty = long_df[target_col].dropna()
            target_val = str(non_empty.iloc[0]).strip() if not non_empty.empty else "Target"
        if not target_val:
            target_val = "Target"

        target_desc = str(target_val)
        if desc_col and desc_col in long_df.columns and target_col in long_df.columns:
            matches = long_df[long_df[target_col].astype(str) == str(target_val)][desc_col].dropna()
            if not matches.empty:
                target_desc = str(matches.iloc[0]).strip()

        # 3. Resolve Hierarchy Levels
        hierarchy_levels: list[str] = []
        if schema_config and schema_config.get("hierarchy_columns"):
            hierarchy_levels = [c for c in schema_config["hierarchy_columns"] if c in long_df.columns]
        if not hierarchy_levels:
            bu_c = next((c for c in dimension_columns if "business unit" in c.lower()), None)
            ent_c = next((c for c in dimension_columns if "legal_entity" in c.lower() or "legal entity" in c.lower()), None)
            if bu_c and ent_c and bu_c in long_df.columns and ent_c in long_df.columns:
                hierarchy_levels = [bu_c, ent_c]
            else:
                hierarchy_levels = [c for c in dimension_columns if c != target_col and c != desc_col and c in long_df.columns]
        if not hierarchy_levels and dimension_columns:
            hierarchy_levels = [dimension_columns[0]]

        # 4. Discover Leaf Segments
        leaf_segments: list[dict[str, str]] = []
        if request.hierarchy_selections:
            for s in request.hierarchy_selections:
                cleaned_seg = {str(k): str(v).strip() for k, v in s.items() if k in long_df.columns}
                if cleaned_seg:
                    leaf_segments.append(cleaned_seg)
        elif request.bu_entities:
            bu_c = hierarchy_levels[0] if hierarchy_levels else "Business unit"
            ent_c = hierarchy_levels[1] if len(hierarchy_levels) > 1 else "SAC_Legal_Entity"
            for bu, ents in request.bu_entities.items():
                if ents:
                    for ent in ents:
                        leaf_segments.append({bu_c: str(bu), ent_c: str(ent)})
                else:
                    leaf_segments.append({bu_c: str(bu)})
        else:
            sub_df = long_df.copy()
            if target_col in sub_df.columns and target_val:
                sub_df = sub_df[sub_df[target_col].astype(str) == str(target_val)]
            if request.filters:
                for col, vals in request.filters.items():
                    if col in sub_df.columns and vals:
                        sub_df = sub_df[sub_df[col].astype(str).isin([str(v) for v in vals])]

            if not sub_df.empty and hierarchy_levels:
                combos = sub_df[hierarchy_levels].dropna().drop_duplicates()
                for _, row in combos.iterrows():
                    leaf_segments.append({col: str(row[col]).strip() for col in hierarchy_levels})

        # Deduplicate leaf segments
        unique_leaf_segments: list[dict[str, str]] = []
        seen_leaves = set()
        for leaf in leaf_segments:
            leaf_key = tuple(sorted(leaf.items()))
            if leaf_key not in seen_leaves:
                seen_leaves.add(leaf_key)
                unique_leaf_segments.append(leaf)
        leaf_segments = unique_leaf_segments

        parent_col = hierarchy_levels[0] if hierarchy_levels else None
        unique_parents: list[str] = []
        if parent_col:
            unique_parents = sorted(list({leaf.get(parent_col, "") for leaf in leaf_segments if leaf.get(parent_col)}))

        total_steps = len(leaf_segments) + (len(unique_parents) if len(hierarchy_levels) > 1 else 0)
        job.entity_progress_total = max(1, total_steps)
        job.entity_progress_completed = 0

        target_months = [str(d)[:7] for d in forecast_dates]
        leaf_results: list[dict[str, Any]] = []

        # ── 5. Train candidate models for each leaf segment ─────────
        for seg in leaf_segments:
            label = " • ".join(str(v) for v in seg.values())
            job.entity_current_segment = label
            try:
                seg_res = series_builder.build_aggregate_series(
                    long_df=long_df,
                    filters=request.filters or {},
                    dimension_columns=dimension_columns,
                    frequency=frequency,
                    hierarchy_selections=[seg],
                    target_column=target_col,
                    target_value=target_val,
                    train_start=request.train_start,
                    train_end=request.train_end,
                )
                seg_ts = seg_res.total_series
                n_seg_obs = len(seg_ts)

                if n_seg_obs < 3:
                    mean_val = float(np.nanmean(seg_ts.values())) if len(seg_ts) > 0 and not np.isnan(np.nanmean(seg_ts.values())) else 0.0
                    final_fc = {m: round(mean_val, 2) for m in target_months}
                    leaf_results.append({
                        "dims": seg,
                        "label": label,
                        "best_model": "NaiveMean",
                        "mape": None,
                        "forecast": final_fc,
                    })
                elif n_seg_obs < 13:
                    from darts.models import NaiveMean
                    with _warnings.catch_warnings():
                        _warnings.simplefilter("ignore")
                        base_model = NaiveMean()
                        base_model.fit(seg_ts)
                        fc_ts = base_model.predict(request.forecast_horizon)
                        fc_pts = extract_series_points(fc_ts)
                        fc_map = {p["date"][:7]: float(p["value"] or 0.0) for p in fc_pts}
                        fc_vals = [float(p["value"] or 0.0) for p in fc_pts]
                        final_fc = {}
                        for idx, m in enumerate(target_months):
                            if m in fc_map:
                                final_fc[m] = round(fc_map[m], 2)
                            elif idx < len(fc_vals):
                                final_fc[m] = round(fc_vals[idx], 2)
                            else:
                                final_fc[m] = round(fc_vals[-1], 2) if fc_vals else 0.0
                    leaf_results.append({
                        "dims": seg,
                        "label": label,
                        "best_model": "NaiveMean",
                        "mape": None,
                        "forecast": final_fc,
                    })
                else:
                    val_size = max(1, min(6, int(n_seg_obs * 0.25)))
                    seg_train_ts = seg_ts[:-val_size]
                    seg_val_ts = seg_ts[-val_size:]
                    eligible = model_registry.filter_eligible_models(
                        request.candidate_models,
                        n_train_observations=len(seg_train_ts),
                    )
                    if not eligible:
                        if n_seg_obs < 3:
                            mean_val = float(np.nanmean(seg_ts.values())) if len(seg_ts) > 0 and not np.isnan(np.nanmean(seg_ts.values())) else 0.0
                            final_fc = {m: round(mean_val, 2) for m in target_months}
                        else:
                            from darts.models import NaiveMean
                            with _warnings.catch_warnings():
                                _warnings.simplefilter("ignore")
                                base_model = NaiveMean()
                                base_model.fit(seg_ts)
                                fc_ts = base_model.predict(request.forecast_horizon)
                                fc_pts = extract_series_points(fc_ts)
                                fc_map = {p["date"][:7]: float(p["value"] or 0.0) for p in fc_pts}
                                fc_vals = [float(p["value"] or 0.0) for p in fc_pts]
                                final_fc = {}
                                for idx, m in enumerate(target_months):
                                    if m in fc_map:
                                        final_fc[m] = round(fc_map[m], 2)
                                    elif idx < len(fc_vals):
                                        final_fc[m] = round(fc_vals[idx], 2)
                                    else:
                                        final_fc[m] = round(fc_vals[-1], 2) if fc_vals else 0.0
                        leaf_results.append({
                            "dims": seg,
                            "label": label,
                            "best_model": "NaiveMean",
                            "mape": None,
                            "forecast": final_fc,
                        })
                    else:
                        with _warnings.catch_warnings():
                            _warnings.simplefilter("ignore")
                            c_res = model_training.evaluate_candidates(
                                model_names=eligible,
                                train_series=seg_train_ts,
                                validation_series=seg_val_ts,
                            )
                        best_cand = model_training.select_best(c_res)
                        best_model_name = best_cand.model_name if best_cand else eligible[0]
                        best_mape = round(best_cand.mape, 2) if (best_cand and best_cand.mape is not None) else None

                        with _warnings.catch_warnings():
                            _warnings.simplefilter("ignore")
                            fc_res = generate_forecast(
                                model_name=best_model_name,
                                full_series=seg_ts,
                                horizon=request.forecast_horizon,
                            )
                            fc_map = {str(d)[:7]: float(v or 0.0) for d, v in zip(fc_res.dates, fc_res.values)}
                            fc_vals = [float(v or 0.0) for v in fc_res.values]
                            final_fc = {}
                            for idx, m in enumerate(target_months):
                                if m in fc_map:
                                    final_fc[m] = round(fc_map[m], 2)
                                elif idx < len(fc_vals):
                                    final_fc[m] = round(fc_vals[idx], 2)
                                else:
                                    final_fc[m] = round(fc_vals[-1], 2) if fc_vals else 0.0

                        leaf_results.append({
                            "dims": seg,
                            "label": label,
                            "best_model": best_model_name,
                            "mape": best_mape,
                            "forecast": final_fc,
                        })
            except Exception as exc:
                job.log(f"Segment '{label}' notice: {exc}")
                leaf_results.append({
                    "dims": seg,
                    "label": label,
                    "best_model": "ConstantZero",
                    "mape": None,
                    "forecast": {m: 0.0 for m in target_months},
                })

            job.entity_progress_completed += 1

        # ── 6. Parent evaluations (if multi-level) ───────────────────
        parent_best_models: dict[str, dict[str, Any]] = {}
        if len(hierarchy_levels) > 1 and parent_col:
            for p in unique_parents:
                job.entity_current_segment = f"{parent_col} {p}"
                try:
                    p_seg_res = series_builder.build_aggregate_series(
                        long_df=long_df,
                        filters=request.filters or {},
                        dimension_columns=dimension_columns,
                        frequency=frequency,
                        hierarchy_selections=[{parent_col: p}],
                        target_column=target_col,
                        target_value=target_val,
                        train_start=request.train_start,
                        train_end=request.train_end,
                    )
                    p_ts = p_seg_res.total_series
                    n_p_obs = len(p_ts)
                    if n_p_obs >= 13:
                        val_size = max(1, min(6, int(n_p_obs * 0.25)))
                        p_train_ts = p_ts[:-val_size]
                        p_val_ts = p_ts[-val_size:]
                        eligible = model_registry.filter_eligible_models(
                            request.candidate_models,
                            n_train_observations=len(p_train_ts),
                        )
                        if eligible:
                            with _warnings.catch_warnings():
                                _warnings.simplefilter("ignore")
                                c_res = model_training.evaluate_candidates(
                                    model_names=eligible,
                                    train_series=p_train_ts,
                                    validation_series=p_val_ts,
                                )
                            best_cand = model_training.select_best(c_res)
                            parent_best_models[p] = {
                                "best_model": best_cand.model_name if best_cand else eligible[0],
                                "mape": round(best_cand.mape, 2) if (best_cand and best_cand.mape is not None) else None,
                            }
                        else:
                            parent_best_models[p] = {"best_model": "NaiveMean", "mape": None}
                    else:
                        parent_best_models[p] = {"best_model": "NaiveMean", "mape": None}
                except Exception:
                    parent_best_models[p] = {"best_model": "NaiveMean", "mape": None}

                job.entity_progress_completed += 1

        # ── 7. Monthly Hierarchy & Percentage Distribution ───────────
        hierarchy: list[dict[str, Any]] = []
        for m in target_months:
            month_total = sum(leaf["forecast"].get(m, 0.0) for leaf in leaf_results)

            if len(hierarchy_levels) > 1 and parent_col:
                parent_list: list[dict[str, Any]] = []
                for p in unique_parents:
                    p_leaves = [l for l in leaf_results if l["dims"].get(parent_col) == p]
                    p_val = sum(l["forecast"].get(m, 0.0) for l in p_leaves)
                    p_pct = (p_val / month_total * 100.0) if abs(month_total) > 1e-6 else 0.0

                    ent_list: list[dict[str, Any]] = []
                    child_col = hierarchy_levels[1]
                    for l in p_leaves:
                        l_val = l["forecast"].get(m, 0.0)
                        l_pct = (l_val / month_total * 100.0) if abs(month_total) > 1e-6 else 0.0
                        ent_list.append({
                            "entity": l["dims"].get(child_col, l["label"]),
                            "name": l["label"],
                            "dims": l["dims"],
                            "forecast": round(l_val, 2),
                            "distribution_pct": round(l_pct, 2),
                            "best_model": l["best_model"],
                            "mape": l["mape"],
                        })

                    p_info = parent_best_models.get(p, {"best_model": "NaiveSeasonal", "mape": None})
                    parent_list.append({
                        "business_unit": p,
                        "name": p,
                        "level_name": parent_col,
                        "forecast": round(p_val, 2),
                        "distribution_pct": round(p_pct, 2),
                        "best_model": p_info.get("best_model", "NaiveSeasonal"),
                        "mape": p_info.get("mape"),
                        "entities": ent_list,
                    })

                hierarchy.append({
                    "month": m,
                    "total_forecast": round(month_total, 2),
                    "distribution_pct": 100.0,
                    "hierarchy_levels": hierarchy_levels,
                    "business_units": parent_list,
                })
            else:
                single_list: list[dict[str, Any]] = []
                for l in leaf_results:
                    l_val = l["forecast"].get(m, 0.0)
                    l_pct = (l_val / month_total * 100.0) if abs(month_total) > 1e-6 else 0.0
                    name = l["dims"].get(hierarchy_levels[0], l["label"]) if hierarchy_levels else l["label"]
                    single_list.append({
                        "business_unit": name,
                        "name": name,
                        "level_name": hierarchy_levels[0] if hierarchy_levels else "Segment",
                        "forecast": round(l_val, 2),
                        "distribution_pct": round(l_pct, 2),
                        "best_model": l["best_model"],
                        "mape": l["mape"],
                        "entities": [{
                            "entity": name,
                            "name": name,
                            "dims": l["dims"],
                            "forecast": round(l_val, 2),
                            "distribution_pct": round(l_pct, 2),
                            "best_model": l["best_model"],
                            "mape": l["mape"],
                        }],
                    })

                hierarchy.append({
                    "month": m,
                    "total_forecast": round(month_total, 2),
                    "distribution_pct": 100.0,
                    "hierarchy_levels": hierarchy_levels,
                    "business_units": single_list,
                })

        # ── 8. Assemble Segment Forecasts List ────────────────────────
        segment_forecasts_list = []
        for l in leaf_results:
            bu_val = l["dims"].get("Business unit") or (l["dims"].get(hierarchy_levels[0]) if hierarchy_levels else "")
            ent_val = l["dims"].get("SAC_Legal_Entity") or (l["dims"].get(hierarchy_levels[1]) if len(hierarchy_levels) > 1 else bu_val)
            segment_forecasts_list.append({
                "business_unit": bu_val,
                "entity": ent_val,
                "dims": l["dims"],
                "account": target_val,
                "description": target_desc,
                "target_account": target_val,
                "target_description": target_desc,
                "forecast": l["forecast"],
                "best_model": l["best_model"],
                "mape": l["mape"],
            })

        job.entity_results = json_safe({
            "months": target_months,
            "hierarchy_levels": hierarchy_levels,
            "target_column": target_col,
            "description_column": desc_col,
            "target_account": target_val,
            "target_description": target_desc,
            "hierarchy": hierarchy,
            "entity_forecasts": segment_forecasts_list,
            "segment_forecasts": segment_forecasts_list,
            "total_segments": len(leaf_results),
            "total_business_units": len(unique_parents) if len(hierarchy_levels) > 1 else len(leaf_results),
        })
        job.entity_status = "completed"
        job.log(f"Segment-wise background training completed ({len(leaf_results)} segments across {len(hierarchy_levels)} hierarchy levels).")

    except Exception as exc:
        import traceback
        job.entity_status = "failed"
        job.entity_error = str(exc)
        job.log(f"Segment training failed: {exc}")
        traceback.print_exc()


_run_entity_training = _run_segment_training


def submit_job(
    request: TrainingRequest,
    long_df: pd.DataFrame,
    dimension_columns: list[str],
    frequency: str,
    schema_config: dict[str, Any] | None = None,
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
        args=(job, request, long_df, dimension_columns, frequency, schema_config),
        daemon=True,
        name=f"training-{job_id[:8]}",
    )
    thread.start()
    return job_id


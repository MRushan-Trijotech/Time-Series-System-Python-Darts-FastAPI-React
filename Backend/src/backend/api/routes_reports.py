"""Report presentation and CSV export routes."""
import csv
import io
from typing import Any

from fastapi import APIRouter, HTTPException, Response, status

from backend.jobs.training_manager import get_job

router = APIRouter(tags=["reports"])


def _get_completed_results(job_id: str) -> dict[str, Any]:
    job = get_job(job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Training job '{job_id}' not found.",
        )
    if job.status == "failed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Job failed: {job.error}",
        )
    if job.status != "completed" or not job.results:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Job is not completed yet.",
        )
    return job.results


@router.get("/reports/{job_id}/forecast")
async def get_forecast_report(job_id: str):
    results = _get_completed_results(job_id)
    return results.get("forecast_report", {})


@router.get("/reports/{job_id}/explanation")
async def get_explanation_report(job_id: str):
    results = _get_completed_results(job_id)
    return results.get("explanation_report", {})


@router.get("/reports/{job_id}/models")
async def get_models_comparison(job_id: str):
    results = _get_completed_results(job_id)
    f_rep = results.get("forecast_report", {})
    return {
        "job_id": job_id,
        "best_model": f_rep.get("best_model"),
        "selection_metric": f_rep.get("selection_metric", "MAPE"),
        "candidate_results": f_rep.get("candidate_results", []),
    }


@router.get("/reports/{job_id}/export/forecast.csv")
async def export_forecast_csv(job_id: str):
    results = _get_completed_results(job_id)
    f_rep = results.get("forecast_report", {})
    forecast_points = f_rep.get("forecast", [])

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Date", "Forecast Value", "Lower Bound", "Upper Bound"])
    for pt in forecast_points:
        writer.writerow([
            pt.get("date", ""),
            pt.get("value", ""),
            pt.get("lower_bound", ""),
            pt.get("upper_bound", ""),
        ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=forecast_{job_id[:8]}.csv"},
    )


@router.get("/reports/{job_id}/export/models.csv")
async def export_models_csv(job_id: str):
    results = _get_completed_results(job_id)
    f_rep = results.get("forecast_report", {})
    candidate_results = f_rep.get("candidate_results", [])

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Model", "Status", "MAPE (%)", "MAE", "RMSE", "Duration (s)", "Error"])
    for r in candidate_results:
        writer.writerow([
            r.get("model_name", ""),
            r.get("status", ""),
            r.get("mape", ""),
            r.get("mae", ""),
            r.get("rmse", ""),
            r.get("duration_seconds", ""),
            r.get("error", "") or "",
        ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=model_comparison_{job_id[:8]}.csv"},
    )


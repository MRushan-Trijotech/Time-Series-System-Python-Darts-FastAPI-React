"""Training job control and status routes."""
from typing import Any

from fastapi import APIRouter, HTTPException, status

from backend.jobs.training_manager import get_job, submit_job
from backend.schemas.training import JobStatus, TrainingRequest
from backend.services.dataset_store import get_dataset
from backend.services.model_registry import CANDIDATE_MODELS, MODEL_FAMILY, MODEL_MIN_OBS, get_available_models

router = APIRouter(tags=["training"])


@router.get("/training/models/available")
async def list_available_models():
    """List candidate forecasting models, their families, and availability."""
    available = get_available_models()
    return {
        "models": [
            {
                "name": name,
                "family": MODEL_FAMILY.get(name, "Statistical"),
                "is_available": available.get(name, True),
                "min_observations": MODEL_MIN_OBS.get(name, 10),
            }
            for name in CANDIDATE_MODELS.keys()
        ]
    }


@router.post("/training")
async def create_training_job(req: TrainingRequest):
    record = get_dataset(req.dataset_id)
    if not record or not record.transform_result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transformed dataset not found. Please upload and transform your data before training.",
        )

    res = record.transform_result
    job_id = submit_job(
        request=req,
        long_df=res.long_df,
        dimension_columns=res.dimension_columns,
        frequency=res.frequency,
        schema_config=record.schema_config,
    )

    return {
        "job_id": job_id,
        "status": "running",
        "message": "Training job started successfully.",
    }


@router.get("/training/{job_id}", response_model=JobStatus)
async def get_training_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Training job '{job_id}' not found.",
        )
    return job.snapshot()


@router.get("/training/{job_id}/results")
async def get_training_results(job_id: str):
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
    if job.status != "completed" or job.results is None:
        raise HTTPException(
            status_code=status.HTTP_202_ACCEPTED,
            detail="Job is still running. Please poll the status endpoint.",
        )
    return job.results


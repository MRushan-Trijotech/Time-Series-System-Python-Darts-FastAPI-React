"""Upload and sheet inspection routes."""
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from backend.config import settings
from backend.schemas.upload import SheetInfo, UploadResponse
from backend.services.dataset_store import get_dataset, save_dataset
from backend.services.excel_reader import list_sheets

router = APIRouter(tags=["upload"])


@router.post("/upload", response_model=UploadResponse)
async def upload_file(file: UploadFile = File(...)):
    filename = file.filename or "uploaded.xlsx"
    ext = Path(filename).suffix.lower()
    if ext not in [".xlsx", ".xls", ".xlsm"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format '{ext}'. Please upload an Excel workbook (.xlsx or .xls).",
        )

    # Save to managed upload dir
    unique_name = f"{uuid.uuid4().hex}_{filename}"
    file_path = settings.upload_dir / unique_name
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save uploaded file: {str(exc)}",
        )

    try:
        sheets = list_sheets(file_path)
    except Exception as exc:
        if file_path.exists():
            file_path.unlink()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to read Excel workbook: {str(exc)}",
        )

    if not sheets:
        if file_path.exists():
            file_path.unlink()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The workbook does not contain any readable sheets.",
        )

    record = save_dataset(filename=filename, file_path=file_path, sheet_names=sheets)
    return UploadResponse(
        dataset_id=record.dataset_id,
        filename=filename,
        sheet_names=sheets,
        message=f"File uploaded successfully. {len(sheets)} sheets found.",
    )


@router.get("/datasets/{dataset_id}/sheets", response_model=SheetInfo)
async def get_sheets(dataset_id: str):
    record = get_dataset(dataset_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found or expired.")
    return SheetInfo(
        sheet_names=record.sheet_names,
        default_sheet=record.sheet_names[0] if record.sheet_names else "",
    )


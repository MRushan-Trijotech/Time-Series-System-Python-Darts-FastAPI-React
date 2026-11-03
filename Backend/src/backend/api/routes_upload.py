"""Upload and sheet inspection routes."""
import shutil
import uuid
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile, status

from backend.config import settings
from backend.schemas.upload import MultiUploadResponse, SheetInfo, UploadResponse, UploadedFileInfo
from backend.services.dataset_store import get_dataset, save_dataset
from backend.services.excel_reader import list_sheets, load_raw_sheet
from backend.services.header_detection import detect_headers

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


@router.post("/upload-multiple", response_model=MultiUploadResponse)
async def upload_multiple_files(files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No files were provided. Please upload at least one Excel workbook.",
        )

    uploaded_infos: list[UploadedFileInfo] = []
    all_dates: set[pd.Timestamp] = set()

    for file in files:
        filename = file.filename or "uploaded.xlsx"
        ext = Path(filename).suffix.lower()
        if ext not in [".xlsx", ".xls", ".xlsm"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported file format '{ext}' in file '{filename}'. Please upload Excel workbooks (.xlsx or .xls).",
            )

        unique_name = f"{uuid.uuid4().hex}_{filename}"
        file_path = settings.upload_dir / unique_name
        try:
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to save uploaded file '{filename}': {str(exc)}",
            )

        try:
            sheets = list_sheets(file_path)
        except Exception as exc:
            if file_path.exists():
                file_path.unlink()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to read Excel workbook '{filename}': {str(exc)}",
            )

        if not sheets:
            if file_path.exists():
                file_path.unlink()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"The workbook '{filename}' does not contain any readable sheets.",
            )

        first_sheet = sheets[0]
        # Scan first 25 rows for lightweight header detection to avoid memory spikes on multi-file uploads
        header_sample_df = load_raw_sheet(file_path, first_sheet, nrows=25)
        detection = detect_headers(header_sample_df, scan_rows=settings.header_scan_rows)
        del header_sample_df

        record = save_dataset(filename=filename, file_path=file_path, sheet_names=sheets)
        record.raw_df = None  # Loaded on-demand during transformation to keep RAM footprint minimal
        record.active_sheet = first_sheet
        record.header_detection = detection

        dim_names = [c.name for c in detection.dimension_columns]
        d_start = detection.date_range_start.strftime("%Y-%m-%d") if detection.date_range_start else None
        d_end = detection.date_range_end.strftime("%Y-%m-%d") if detection.date_range_end else None

        for c in detection.period_columns:
            if c.parsed_date is not None:
                all_dates.add(pd.Timestamp(c.parsed_date))

        uploaded_infos.append(
            UploadedFileInfo(
                dataset_id=record.dataset_id,
                filename=filename,
                sheet_names=sheets,
                dimension_columns=dim_names,
                period_count=len(detection.period_columns),
                date_range_start=d_start,
                date_range_end=d_end,
                header_depth=detection.header_depth,
                dimension_row_index=detection.dimension_row_index,
                period_row_index=detection.period_row_index,
            )
        )

    # Structure Compatibility Detection across all uploaded files
    is_compatible = True
    incompatibility_reason = None
    common_dims: list[str] = []

    if len(uploaded_infos) >= 1:
        base_file = uploaded_infos[0]
        base_dims = list(base_file.dimension_columns)
        base_depth = base_file.header_depth

        for f in uploaded_infos[1:]:
            if f.dimension_columns != base_dims:
                is_compatible = False
                incompatibility_reason = (
                    f"Structural Mismatch: '{f.filename}' has dimension columns {f.dimension_columns}, "
                    f"which does not match '{base_file.filename}' {base_dims}. "
                    f"Files must share the exact same dimension structure to be merged."
                )
                break
            if f.header_depth != base_depth:
                is_compatible = False
                incompatibility_reason = (
                    f"Header Layout Mismatch: '{f.filename}' has a header depth of {f.header_depth} rows "
                    f"while '{base_file.filename}' has {base_depth} rows. "
                    f"Different header layouts cannot be merged."
                )
                break

        if is_compatible:
            common_dims = base_dims

    sorted_dates = sorted(all_dates)
    timeline_start = sorted_dates[0].strftime("%Y-%m") if sorted_dates else None
    timeline_end = sorted_dates[-1].strftime("%Y-%m") if sorted_dates else None

    return MultiUploadResponse(
        files=uploaded_infos,
        is_compatible=is_compatible,
        common_dimensions=common_dims,
        incompatibility_reason=incompatibility_reason,
        unified_timeline_start=timeline_start,
        unified_timeline_end=timeline_end,
        total_months=len(sorted_dates),
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


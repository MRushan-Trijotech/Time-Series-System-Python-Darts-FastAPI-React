"""Dataset inspection, transformation, and metadata endpoints."""
from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException, Query, status

from backend.config import settings
from backend.schemas.dataset import (
    DatasetMetadata,
    DimensionsResponse,
    DimensionValues,
    SeriesPreviewRequest,
    SeriesPreviewResponse,
)
from backend.schemas.upload import (
    ColumnInfo,
    HeaderDetectionResult as HeaderDetectionSchema,
    InspectRequest,
    TransformRequest,
    TransformResponse,
)
from backend.services.data_transformer import transform
from backend.services.dataset_store import get_dataset
from backend.services.excel_reader import load_raw_sheet, raw_preview
from backend.services.header_detection import ColumnMapping, HeaderDetectionResult, detect_headers

router = APIRouter(tags=["data"])


@router.post("/datasets/{dataset_id}/inspect", response_model=HeaderDetectionSchema)
async def inspect_dataset(dataset_id: str, req: InspectRequest):
    record = get_dataset(dataset_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found or expired.")

    if req.sheet_name not in record.sheet_names:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Sheet '{req.sheet_name}' not found. Available sheets: {record.sheet_names}",
        )

    try:
        raw_df = load_raw_sheet(record.file_path, req.sheet_name)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to read sheet '{req.sheet_name}': {str(exc)}",
        )

    detection = detect_headers(raw_df, scan_rows=settings.header_scan_rows)
    record.active_sheet = req.sheet_name
    record.raw_df = raw_df
    record.header_detection = detection

    def _to_info(c: ColumnMapping) -> ColumnInfo:
        return ColumnInfo(
            original_index=c.original_index,
            name=c.name,
            role=c.role,
            parsed_date=c.parsed_date.isoformat() if c.parsed_date else None,
        )

    preview_rows = raw_preview(raw_df, n_rows=8)

    return HeaderDetectionSchema(
        period_row_index=detection.period_row_index,
        dimension_row_index=detection.dimension_row_index,
        header_depth=detection.header_depth,
        dimension_columns=[_to_info(c) for c in detection.dimension_columns],
        period_columns=[_to_info(c) for c in detection.period_columns],
        other_columns=[_to_info(c) for c in detection.columns if c.role == "other"],
        date_range_start=detection.date_range_start.isoformat() if detection.date_range_start else None,
        date_range_end=detection.date_range_end.isoformat() if detection.date_range_end else None,
        frequency=detection.frequency,
        confidence=detection.confidence,
        warnings=detection.warnings,
        raw_preview=preview_rows,
    )


@router.post("/datasets/{dataset_id}/transform", response_model=TransformResponse)
async def transform_dataset(dataset_id: str, req: TransformRequest):
    record = get_dataset(dataset_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found or expired.")

    if record.raw_df is None or record.active_sheet != req.sheet_name:
        try:
            record.raw_df = load_raw_sheet(record.file_path, req.sheet_name)
            record.active_sheet = req.sheet_name
            record.header_detection = detect_headers(record.raw_df, scan_rows=settings.header_scan_rows)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to load worksheet: {str(exc)}",
            )

    detection = record.header_detection
    if detection is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Header detection must be run before transformation.",
        )

    # Apply user overrides if specified
    if req.header_depth is not None and req.header_depth > 0:
        detection.header_depth = req.header_depth

    if req.dimension_column_indices is not None or req.period_column_indices is not None:
        dim_set = set(req.dimension_column_indices or [])
        period_set = set(req.period_column_indices or [])
        for col in detection.columns:
            if col.original_index in dim_set:
                col.role = "dimension"
            elif col.original_index in period_set:
                col.role = "time_period"
            else:
                col.role = "other"

    try:
        res = transform(record.raw_df, detection)
        record.transform_result = res
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Transformation failed: {str(exc)}",
        )

    return TransformResponse(
        dataset_id=dataset_id,
        row_count=res.row_count,
        dimension_columns=res.dimension_columns,
        period_columns=res.period_columns,
        date_range_start=res.date_range_start.isoformat(),
        date_range_end=res.date_range_end.isoformat(),
        frequency=res.frequency,
        missing_value_count=res.missing_value_count,
        duplicate_count=res.duplicate_count,
        warnings=res.warnings,
        preview=res.preview(n=25),
    )


@router.get("/datasets/{dataset_id}/preview")
async def get_preview(dataset_id: str, limit: int = Query(default=25, ge=1, le=100)):
    record = get_dataset(dataset_id)
    if not record or not record.transform_result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transformed dataset not found. Please inspect and transform first.",
        )
    return {
        "dataset_id": dataset_id,
        "rows": record.transform_result.preview(n=limit),
        "total_rows": record.transform_result.row_count,
    }


@router.get("/datasets/{dataset_id}/metadata", response_model=DatasetMetadata)
async def get_metadata(dataset_id: str):
    record = get_dataset(dataset_id)
    if not record or not record.transform_result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transformed dataset not found. Please transform first.",
        )
    res = record.transform_result
    return DatasetMetadata(
        dataset_id=dataset_id,
        filename=record.filename,
        sheet_name=record.active_sheet or "",
        dimension_columns=res.dimension_columns,
        period_columns=res.period_columns,
        date_range_start=res.date_range_start.isoformat(),
        date_range_end=res.date_range_end.isoformat(),
        frequency=res.frequency,
        row_count=res.row_count,
        missing_value_count=res.missing_value_count,
        duplicate_count=res.duplicate_count,
        warnings=res.warnings,
    )


@router.get("/datasets/{dataset_id}/dimensions", response_model=DimensionsResponse)
async def get_dimensions(dataset_id: str):
    record = get_dataset(dataset_id)
    if not record or not record.transform_result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transformed dataset not found.",
        )
    df = record.transform_result.long_df
    dim_cols = record.transform_result.dimension_columns

    dims: list[DimensionValues] = []
    for col in dim_cols:
        unique_vals = (
            df[col]
            .dropna()
            .astype(str)
            .str.strip()
            .loc[lambda s: s != ""]
            .unique()
            .tolist()
        )
        dims.append(DimensionValues(name=col, values=sorted(unique_vals)))

    # Detect key dimension roles case-insensitively
    bu_col = next((c for c in dim_cols if "business unit" in c.lower()), None)
    ent_col = next((c for c in dim_cols if "legal_entity" in c.lower() or "legal entity" in c.lower()), None)
    acc_col = next((c for c in dim_cols if c.lower() == "account"), None)
    desc_col = next((c for c in dim_cols if c.lower() == "description"), None)

    bu_entity_hierarchy: dict[str, list[str]] = {}
    if bu_col and ent_col and bu_col in df.columns and ent_col in df.columns:
        for bu, grp in df.groupby(bu_col, dropna=True):
            bu_str = str(bu).strip()
            if not bu_str:
                continue
            ents = grp[ent_col].dropna().astype(str).str.strip().unique().tolist()
            bu_entity_hierarchy[bu_str] = sorted([e for e in ents if e])

    account_items = []
    if acc_col and acc_col in df.columns:
        cols_to_use = [acc_col]
        if desc_col and desc_col in df.columns:
            cols_to_use.append(desc_col)

        acc_df = df[cols_to_use].dropna(subset=[acc_col]).drop_duplicates().sort_values(acc_col)
        for _, r in acc_df.iterrows():
            a = str(r[acc_col]).strip()
            d = str(r[desc_col]).strip() if desc_col and pd.notna(r[desc_col]) else ""
            lbl = f"{d} ({a})" if d else a
            account_items.append({"account": a, "description": d, "label": lbl})

    # Relations between BU, Entity, and Account for dynamic filtering
    relations = []
    rel_cols = [c for c in [bu_col, ent_col, acc_col] if c and c in df.columns]
    if len(rel_cols) >= 2:
        rel_df = df[rel_cols].dropna().drop_duplicates()
        for _, r in rel_df.iterrows():
            rel_dict: dict[str, str] = {}
            if bu_col:
                rel_dict["bu"] = str(r[bu_col]).strip()
            if ent_col:
                rel_dict["entity"] = str(r[ent_col]).strip()
            if acc_col:
                rel_dict["account"] = str(r[acc_col]).strip()
            relations.append(rel_dict)

    return DimensionsResponse(
        dimensions=dims,
        bu_entity_hierarchy=bu_entity_hierarchy,
        accounts=account_items,
        relations=relations,
    )


@router.post("/datasets/{dataset_id}/series-preview", response_model=SeriesPreviewResponse)
async def series_preview(dataset_id: str, req: SeriesPreviewRequest):
    record = get_dataset(dataset_id)
    if not record or not record.transform_result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transformed dataset not found.",
        )

    df = record.transform_result.long_df.copy()
    dim_cols = record.transform_result.dimension_columns
    warnings: list[str] = []

    bu_col = next((c for c in dim_cols if "business unit" in c.lower()), None)
    ent_col = next((c for c in dim_cols if "legal_entity" in c.lower() or "legal entity" in c.lower()), None)
    acc_col = next((c for c in dim_cols if c.lower() == "account"), None)

    # Hierarchical BU & Legal Entity
    if req.bu_entities and bu_col and ent_col and bu_col in df.columns and ent_col in df.columns:
        masks = []
        for bu, entities in req.bu_entities.items():
            if entities:
                masks.append((df[bu_col] == bu) & (df[ent_col].isin(entities)))
            else:
                masks.append(df[bu_col] == bu)
        if masks:
            comb = masks[0]
            for m in masks[1:]:
                comb = comb | m
            df = df[comb]

    # Accounts
    if req.accounts and acc_col and acc_col in df.columns:
        df = df[df[acc_col].isin(req.accounts)]

    # Other filters
    for dim, vals in req.filters.items():
        if req.bu_entities and dim in [bu_col, ent_col]:
            continue
        if req.accounts and dim in [acc_col, "Description", "description"]:
            continue
        if dim in df.columns and vals:
            df = df[df[dim].isin(vals)]

    if df.empty:
        return SeriesPreviewResponse(
            total_rows=0,
            estimated_series_count=0,
            date_range_start="",
            date_range_end="",
            warnings=["No rows match the selected filters."],
        )

    # Estimate distinct leaf entity series
    active_dims = [d for d in dim_cols if d in df.columns]
    entity_combos = len(df.drop_duplicates(subset=active_dims)) if active_dims else 1

    dates = df["date"].dropna().sort_values()
    d_start = dates.iloc[0].strftime("%Y-%m-%d") if not dates.empty else ""
    d_end = dates.iloc[-1].strftime("%Y-%m-%d") if not dates.empty else ""

    return SeriesPreviewResponse(
        total_rows=len(df),
        estimated_series_count=entity_combos,
        date_range_start=d_start,
        date_range_end=d_end,
        warnings=warnings,
    )


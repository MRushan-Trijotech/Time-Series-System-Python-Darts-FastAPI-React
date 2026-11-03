"""Dataset inspection, transformation, and metadata endpoints."""
import gc
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
    SeriesInfoRequest,
    SeriesInfoResponse,
)
from backend.schemas.upload import (
    ColumnInfo,
    HeaderDetectionResult as HeaderDetectionSchema,
    InspectRequest,
    MergeTransformRequest,
    TransformRequest,
    TransformResponse,
)
from backend.services.data_transformer import TransformResult, transform
from backend.services.dataset_store import get_dataset, save_merged_dataset
from backend.services.excel_reader import load_raw_sheet, raw_preview
from backend.services.header_detection import ColumnMapping, HeaderDetectionResult, detect_headers, parse_period_label

router = APIRouter(tags=["data"])


def _format_date(val: Any) -> str:
    if val is None:
        return ""
    if hasattr(val, "isoformat"):
        return val.isoformat()
    return str(val)


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
            parsed_date=_format_date(c.parsed_date) if c.parsed_date else None,
        )

    preview_rows = raw_preview(raw_df, n_rows=8)

    return HeaderDetectionSchema(
        period_row_index=detection.period_row_index,
        dimension_row_index=detection.dimension_row_index,
        header_depth=detection.header_depth,
        dimension_columns=[_to_info(c) for c in detection.dimension_columns],
        period_columns=[_to_info(c) for c in detection.period_columns],
        other_columns=[_to_info(c) for c in detection.columns if c.role == "other"],
        date_range_start=_format_date(detection.date_range_start) if detection.date_range_start else None,
        date_range_end=_format_date(detection.date_range_end) if detection.date_range_end else None,
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

    # Apply user schema overrides if specified
    if req.schema_config:
        sc = req.schema_config
        record.schema_config = sc.model_dump()
        detection.dimension_row_index = sc.dimension_row_index
        detection.period_row_index = sc.period_row_index
        # header_depth is simply 1 row after dimension_row_index
        detection.header_depth = sc.dimension_row_index + 1

        # Re-evaluate column roles and names from designated dimension and period rows
        if record.raw_df is not None:
            raw_dim_row = record.raw_df.iloc[sc.dimension_row_index] if sc.dimension_row_index < len(record.raw_df) else None
            raw_period_row = record.raw_df.iloc[sc.period_row_index] if sc.period_row_index < len(record.raw_df) else None

            for col in detection.columns:
                c_idx = col.original_index
                dim_val = raw_dim_row.iloc[c_idx] if raw_dim_row is not None and c_idx < len(raw_dim_row) else None
                period_val = raw_period_row.iloc[c_idx] if raw_period_row is not None and c_idx < len(raw_period_row) else None

                parsed_dt = parse_period_label(period_val)
                if parsed_dt:
                    col.role = "time_period"
                    col.parsed_date = parsed_dt
                    col.name = str(period_val).strip()
                elif dim_val is not None and pd.notna(dim_val) and str(dim_val).strip():
                    col.role = "dimension"
                    col.name = str(dim_val).strip()
                else:
                    col.role = "other"

    elif req.header_depth is not None and req.header_depth > 0:
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
        record.raw_df = None  # Free raw excel dataframe from RAM
        gc.collect()
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
        date_range_start=_format_date(res.date_range_start),
        date_range_end=_format_date(res.date_range_end),
        frequency=res.frequency,
        missing_value_count=res.missing_value_count,
        duplicate_count=res.duplicate_count,
        warnings=res.warnings,
        preview=res.preview(n=25),
        schema_config=req.schema_config,
    )


@router.post("/datasets/merge-transform", response_model=TransformResponse)
async def merge_transform_datasets(req: MergeTransformRequest):
    """
    Transforms multiple compatible datasets into long format and merges them into
    a single continuous temporal series along primary dimension columns.
    Enforces strict structure compatibility across all selected files.
    """
    if not req.dataset_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No dataset IDs were provided for merging.",
        )

    records: list[Any] = []
    for d_id in req.dataset_ids:
        rec = get_dataset(d_id)
        if not rec:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Dataset '{d_id}' not found.",
            )
        records.append(rec)

    all_long_dfs: list[pd.DataFrame] = []
    base_dims: list[str] | None = None
    base_depth: int | None = None
    all_period_columns: list[str] = []
    frequency = "M"

    # Process each workbook sequentially and free raw memory immediately to stay within 512MB RAM
    for rec in records:
        sheet = req.sheet_name or rec.active_sheet or (rec.sheet_names[0] if rec.sheet_names else None)
        raw_df = rec.raw_df
        if raw_df is None:
            if sheet and rec.file_path and rec.file_path.exists():
                raw_df = load_raw_sheet(rec.file_path, sheet)
            else:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Dataset '{rec.dataset_id}' sheet not found or workbook file is missing.",
                )

        det = rec.header_detection
        if det is None:
            det = detect_headers(raw_df, scan_rows=settings.header_scan_rows)

        if req.schema_config:
            sc = req.schema_config
            rec.schema_config = sc.model_dump()
            det.dimension_row_index = sc.dimension_row_index
            det.period_row_index = sc.period_row_index
            det.header_depth = sc.dimension_row_index + 1

            raw_dim_row = raw_df.iloc[sc.dimension_row_index] if sc.dimension_row_index < len(raw_df) else None
            raw_period_row = raw_df.iloc[sc.period_row_index] if sc.period_row_index < len(raw_df) else None

            for col in det.columns:
                c_idx = col.original_index
                dim_val = raw_dim_row.iloc[c_idx] if raw_dim_row is not None and c_idx < len(raw_dim_row) else None
                period_val = raw_period_row.iloc[c_idx] if raw_period_row is not None and c_idx < len(raw_period_row) else None

                parsed_dt = parse_period_label(period_val)
                if parsed_dt:
                    col.role = "time_period"
                    col.parsed_date = parsed_dt
                    col.name = str(period_val).strip()
                elif dim_val is not None and pd.notna(dim_val) and str(dim_val).strip():
                    col.role = "dimension"
                    col.name = str(dim_val).strip()
                else:
                    col.role = "other"

        t_res = transform(raw_df, det)
        del raw_df
        rec.raw_df = None
        rec.transform_result = None
        gc.collect()

        # Strict compatibility verification across files
        if base_dims is None:
            base_dims = list(t_res.dimension_columns)
            base_depth = det.header_depth
            frequency = t_res.frequency
        else:
            if t_res.dimension_columns != base_dims:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Cannot merge files with incompatible structure: "
                        f"'{rec.filename}' has dimension columns {t_res.dimension_columns}, "
                        f"which does not match '{records[0].filename}' ({base_dims}). "
                        f"Files must share the exact same dimension structure."
                    ),
                )
            if det.header_depth != base_depth:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Cannot merge files with incompatible header depth: "
                        f"'{rec.filename}' has {det.header_depth} header rows "
                        f"while '{records[0].filename}' has {base_depth} rows."
                    ),
                )

        for p in t_res.period_columns:
            if p not in all_period_columns:
                all_period_columns.append(p)

        all_long_dfs.append(t_res.long_df)

    # Concatenate all long format DataFrames
    merged_long_df = pd.concat(all_long_dfs, ignore_index=True)
    del all_long_dfs
    gc.collect()

    dim_cols = base_dims or []
    merged_long_df = merged_long_df.sort_values(["date"] + dim_cols).reset_index(drop=True)

    dup_cols = ["date"] + dim_cols
    duplicate_count = int(merged_long_df.duplicated(subset=dup_cols).sum())
    warnings: list[str] = []
    if duplicate_count > 0:
        warnings.append(
            f"Merged dataset contains {duplicate_count} duplicate observations across files. Aggregated by sum."
        )
        merged_long_df = (
            merged_long_df.groupby(dup_cols, dropna=False)["value"]
            .sum()
            .reset_index()
        )

    # Enforce memory-lean categorical dtypes and float32 on merged data
    merged_long_df["value"] = pd.to_numeric(merged_long_df["value"], downcast="float")
    for c in dim_cols:
        merged_long_df[c] = merged_long_df[c].astype("category")

    all_dates = sorted(merged_long_df["date"].dropna().unique())
    d_start = pd.Timestamp(all_dates[0]) if all_dates else pd.Timestamp.now()
    d_end = pd.Timestamp(all_dates[-1]) if all_dates else pd.Timestamp.now()

    missing_value_count = int(merged_long_df["value"].isna().sum())

    merged_transform_res = TransformResult(
        long_df=merged_long_df,
        dimension_columns=dim_cols,
        period_columns=all_period_columns,
        date_range_start=d_start,
        date_range_end=d_end,
        frequency=frequency,
        row_count=len(merged_long_df),
        missing_value_count=missing_value_count,
        duplicate_count=duplicate_count,
        warnings=warnings,
    )

    merged_name = f"Merged ({len(records)} files: {', '.join(r.filename for r in records[:2])}{'...' if len(records) > 2 else ''})"
    merged_record = save_merged_dataset(
        filename=merged_name,
        file_path=records[0].file_path,
        transform_result=merged_transform_res,
        schema_config=req.schema_config.model_dump() if req.schema_config else None,
    )

    # Release intermediate dataset copies from RAM since merged dataset takes over
    for r in records:
        r.raw_df = None
        r.transform_result = None
    gc.collect()

    return TransformResponse(
        dataset_id=merged_record.dataset_id,
        row_count=merged_transform_res.row_count,
        dimension_columns=merged_transform_res.dimension_columns,
        period_columns=merged_transform_res.period_columns,
        date_range_start=_format_date(merged_transform_res.date_range_start),
        date_range_end=_format_date(merged_transform_res.date_range_end),
        frequency=merged_transform_res.frequency,
        missing_value_count=merged_transform_res.missing_value_count,
        duplicate_count=merged_transform_res.duplicate_count,
        warnings=merged_transform_res.warnings,
        preview=merged_transform_res.preview(n=25),
        schema_config=req.schema_config,
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
        date_range_start=_format_date(res.date_range_start),
        date_range_end=_format_date(res.date_range_end),
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

    schema_cfg = record.schema_config or {}
    target_col = schema_cfg.get("target_column") or next((c for c in dim_cols if c.lower() == "account"), None) or (dim_cols[0] if dim_cols else "Target")
    desc_col = schema_cfg.get("description_column")
    if not desc_col and next((c for c in dim_cols if c.lower() == "description"), None):
        desc_col = next((c for c in dim_cols if c.lower() == "description"), None)

    configured_hierarchy = schema_cfg.get("hierarchy_columns")
    if configured_hierarchy is None:
        bu_col = next((c for c in dim_cols if "business unit" in c.lower()), None)
        ent_col = next((c for c in dim_cols if "legal_entity" in c.lower() or "legal entity" in c.lower()), None)
        configured_hierarchy = [c for c in [bu_col, ent_col] if c and c in df.columns]

    # Build dynamic multi-level hierarchy tree (supports any number of levels: BU -> Entity -> Product -> UOM)
    # OPTIMIZATION: Extract unique hierarchy combinations first (2k rows instead of 1M rows)
    def _build_tree(sub_df: pd.DataFrame, levels: list[str]) -> list[dict[str, Any]]:
        if not levels or sub_df.empty:
            return []
        current_lvl = levels[0]
        rem_lvls = levels[1:]
        nodes = []
        if current_lvl in sub_df.columns:
            for val, grp in sub_df.groupby(current_lvl, observed=True):
                v_str = str(val).strip()
                if not v_str:
                    continue
                node: dict[str, Any] = {"value": v_str}
                if rem_lvls:
                    node["children"] = _build_tree(grp, rem_lvls)
                nodes.append(node)
        return sorted(nodes, key=lambda n: n["value"])

    valid_hier_cols = [c for c in configured_hierarchy if c in df.columns]
    if valid_hier_cols:
        uniq_hier_df = df[valid_hier_cols].dropna().drop_duplicates()
        hierarchy_tree = _build_tree(uniq_hier_df, valid_hier_cols)
    else:
        hierarchy_tree = []

    # Build targets with optional 1-to-1 description
    target_options = []
    if target_col and target_col in df.columns:
        cols_to_use = [target_col]
        if desc_col and desc_col in df.columns and desc_col != target_col:
            cols_to_use.append(desc_col)

        t_df = df[cols_to_use].dropna(subset=[target_col]).drop_duplicates().sort_values(target_col)
        for _, r in t_df.iterrows():
            val = str(r[target_col]).strip()
            desc = str(r[desc_col]).strip() if desc_col and desc_col in t_df.columns and pd.notna(r[desc_col]) else None
            lbl = f"{desc} ({val})" if desc else val
            target_options.append({"value": val, "description": desc, "label": lbl})

    # Legacy BU & Account mappings for backward compatibility
    bu_col = next((c for c in dim_cols if "business unit" in c.lower()), None)
    ent_col = next((c for c in dim_cols if "legal_entity" in c.lower() or "legal entity" in c.lower()), None)
    acc_col = next((c for c in dim_cols if c.lower() == "account"), None)

    bu_entity_hierarchy: dict[str, list[str]] = {}
    if bu_col and ent_col and bu_col in df.columns and ent_col in df.columns:
        bu_ent_df = df[[bu_col, ent_col]].dropna().drop_duplicates()
        for bu, grp in bu_ent_df.groupby(bu_col, observed=True):
            bu_str = str(bu).strip()
            if not bu_str:
                continue
            ents = grp[ent_col].dropna().astype(str).str.strip().unique().tolist()
            bu_entity_hierarchy[bu_str] = sorted([e for e in ents if e])

    account_items = []
    if acc_col and acc_col in df.columns:
        cols_to_use = [acc_col]
        legacy_desc = next((c for c in dim_cols if c.lower() == "description"), None)
        if legacy_desc and legacy_desc in df.columns:
            cols_to_use.append(legacy_desc)

        acc_df = df[cols_to_use].dropna(subset=[acc_col]).drop_duplicates().sort_values(acc_col)
        for _, r in acc_df.iterrows():
            a = str(r[acc_col]).strip()
            d = str(r[legacy_desc]).strip() if legacy_desc and pd.notna(r[legacy_desc]) else ""
            lbl = f"{d} ({a})" if d else a
            account_items.append({"account": a, "description": d, "label": lbl})

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

    gc.collect()
    return DimensionsResponse(
        dimensions=dims,
        hierarchy_levels=configured_hierarchy,
        hierarchy_tree=hierarchy_tree,
        target_column=target_col,
        description_column=desc_col,
        targets=target_options,
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



@router.post("/datasets/{dataset_id}/series-info", response_model=SeriesInfoResponse)
async def get_series_info(dataset_id: str, req: SeriesInfoRequest):
    """
    Return the aggregate series date range and observation count for the given
    BU / entity / account selection, with missing months filled to 0.
    Used by the Configuration page to show series span and recommend a horizon.
    """
    record = get_dataset(dataset_id)
    if not record or not record.transform_result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transformed dataset not found.",
        )

    df = record.transform_result.long_df
    dim_cols = record.transform_result.dimension_columns
    warnings_out: list[str] = []

    bu_col = next((c for c in dim_cols if "business unit" in c.lower()), None)
    ent_col = next((c for c in dim_cols if "legal_entity" in c.lower() or "legal entity" in c.lower()), None)
    acc_col = next((c for c in dim_cols if c.lower() == "account"), None)

    # 1. OPTIMIZATION: Filter target value FIRST to immediately discard 95-98% of rows!
    schema_cfg = record.schema_config or {}
    target_col = schema_cfg.get("target_column") or acc_col
    if req.target_value and target_col and target_col in df.columns:
        df = df[df[target_col].astype(str) == str(req.target_value)]

    # Account filter (legacy)
    if not req.target_value and req.accounts and acc_col and acc_col in df.columns:
        df = df[df[acc_col].astype(str).isin([str(a) for a in req.accounts])]

    # 2. Fast vectorized multi-level hierarchy filter (O(1) set lookup instead of O(N*M) loop)
    if req.hierarchy_selections:
        sel_df = pd.DataFrame(req.hierarchy_selections).dropna(how="all")
        valid_cols = [c for c in sel_df.columns if c in df.columns]
        if valid_cols:
            sel_df = sel_df[valid_cols].drop_duplicates()
            if len(valid_cols) == 1:
                col = valid_cols[0]
                allowed_vals = set(sel_df[col].astype(str))
                df = df[df[col].astype(str).isin(allowed_vals)]
            else:
                for c in valid_cols:
                    sel_df[c] = sel_df[c].astype(str)
                    df[c] = df[c].astype(str)
                df = df.merge(sel_df, on=valid_cols, how="inner")

    # Hierarchical BU + Legal Entity filter (legacy)
    if not req.hierarchy_selections and req.bu_entities and bu_col and ent_col and bu_col in df.columns and ent_col in df.columns:
        bu_ent_pairs = []
        for bu, entities in req.bu_entities.items():
            if entities:
                for ent in entities:
                    bu_ent_pairs.append({bu_col: str(bu), ent_col: str(ent)})
            else:
                bu_ent_pairs.append({bu_col: str(bu)})
        if bu_ent_pairs:
            p_df = pd.DataFrame(bu_ent_pairs).drop_duplicates()
            if ent_col in p_df.columns and not p_df[ent_col].isna().all():
                df = df.merge(p_df, on=[bu_col, ent_col], how="inner")
            else:
                df = df[df[bu_col].astype(str).isin(set(p_df[bu_col]))]

    # Other filters
    for dim, vals in req.filters.items():
        if req.bu_entities and dim in [bu_col, ent_col]:
            continue
        if req.accounts and dim in [acc_col, "Description", "description"]:
            continue
        if dim in df.columns and vals:
            df = df[df[dim].astype(str).isin([str(v) for v in vals])]

    if df.empty:
        return SeriesInfoResponse(
            n_observations=0,
            date_range_start="",
            date_range_end="",
            recommended_horizon=0,
            warnings=["No data matches the selected filters."],
        )

    # Aggregate by date, fill missing months with 0
    agg = (
        df.groupby("date", dropna=True)["value"]
        .sum(min_count=1)
        .reset_index()
        .sort_values("date")
    )

    # STRICT RULE: Identify observations with real data (not null and not 0)
    valid_points = agg[agg["value"].notna() & (agg["value"] != 0)]
    if valid_points.empty:
        return SeriesInfoResponse(
            n_observations=0,
            date_range_start="",
            date_range_end="",
            recommended_horizon=0,
            warnings=["No historical data available for this target (all values are empty or zero)."],
        )

    # Actual starting and ending months where real observations exist
    first_date = valid_points["date"].min()
    last_date = valid_points["date"].max()

    # Slice strictly between first_date and last_date (in-between gaps filled with 0)
    series_df = agg[(agg["date"] >= first_date) & (agg["date"] <= last_date)].copy()
    series_df["value"] = series_df["value"].fillna(0)

    n_obs = len(series_df)
    d_start = first_date.strftime("%Y-%m-%d")
    d_end = last_date.strftime("%Y-%m-%d")

    # Recommend horizon: if 36 months -> 6, otherwise floor(n_obs / 4), minimum 1, capped at 36
    if n_obs == 36:
        recommended = 6
    else:
        recommended = max(1, min(36, n_obs // 4))

    return SeriesInfoResponse(
        n_observations=n_obs,
        date_range_start=d_start,
        date_range_end=d_end,
        recommended_horizon=recommended,
        warnings=warnings_out,
    )

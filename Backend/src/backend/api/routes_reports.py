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
    writer.writerow(["Period", "Forecasted Value", "Change vs Previous Period", "Change (%)"])

    prev_val: float | None = None
    for idx, pt in enumerate(forecast_points):
        period = str(pt.get("date", ""))[:7]
        raw_val = pt.get("value")
        val = float(raw_val) if raw_val is not None else None

        if val is None:
            val_str = "—"
        elif val >= 0:
            val_str = f"{val:,.2f}"
        else:
            val_str = f"-{abs(val):,.2f}"

        if idx == 0 or prev_val is None:
            writer.writerow([period, val_str, "—", "—"])
        else:
            diff = val - prev_val
            if abs(diff) < 0.005:
                diff_str = "0.00"
            elif diff > 0:
                diff_str = f"+{diff:,.2f}"
            else:
                diff_str = f"-{abs(diff):,.2f}"

            if prev_val != 0:
                pct = (diff / abs(prev_val)) * 100
                if abs(pct) < 0.005:
                    pct_str = "0.00%"
                elif pct > 0:
                    pct_str = f"+{pct:.2f}%"
                else:
                    pct_str = f"{pct:.2f}%"
            else:
                pct_str = "—"

            writer.writerow([period, val_str, diff_str, pct_str])

        prev_val = val

    csv_data = "\ufeff" + output.getvalue()
    return Response(
        content=csv_data.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
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

    csv_data = "\ufeff" + output.getvalue()
    return Response(
        content=csv_data.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=model_comparison_{job_id[:8]}.csv"},
    )


@router.get("/reports/{job_id}/segment-wise")
@router.get("/reports/{job_id}/entity-wise")
async def get_segment_wise_report(job_id: str):
    job = get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job '{job_id}' not found.",
        )

    percent = 0.0
    if job.entity_progress_total > 0:
        percent = round((job.entity_progress_completed / job.entity_progress_total) * 100.0, 1)

    return {
        "job_id": job_id,
        "status": job.entity_status,
        "progress": {
            "completed": job.entity_progress_completed,
            "total": job.entity_progress_total,
            "current_segment": job.entity_current_segment,
            "percent": percent,
        },
        "error": job.entity_error,
        "data": job.entity_results,
    }


def _build_story_export_rows(results: dict[str, Any]) -> tuple[list[str], list[str], list[list[Any]]]:
    """
    Builds the Story-style multi-level header report format:
    Row 0: ['', ..., 'Date', '(all)', Year, Quarter, Month, ...]
    Row 1: [Hierarchy1, Hierarchy2, ..., Target, Description, '', '', ...]
    Data Rows: [h1, h2, ..., target, desc, all_val, year_val, qtr_val, m_val, ...]
    """
    import datetime

    months: list[str] = results.get("months", [])
    entity_forecasts: list[dict[str, Any]] = results.get("segment_forecasts") or results.get("entity_forecasts", [])
    hierarchy_levels: list[str] = results.get("hierarchy_levels") or ["Business unit", "SAC_Legal_Entity"]
    target_col = results.get("target_column") or "ACCOUNT"
    desc_col = results.get("description_column") or "Description"
    target_account = results.get("target_account", "PL")
    target_desc = results.get("target_description", target_account)

    years_dict: dict[int, dict[str, list[tuple[str, str]]]] = {}
    for m in months:
        parts = m.split("-")
        y, mo = int(parts[0]), int(parts[1])
        q = f"Q{(mo - 1) // 3 + 1} ({y})"
        month_label = f"{datetime.date(y, mo, 1).strftime('%b')} ({y})"
        if y not in years_dict:
            years_dict[y] = {}
        if q not in years_dict[y]:
            years_dict[y][q] = []
        years_dict[y][q].append((m, month_label))

    header_dim_cols = list(hierarchy_levels) + [target_col]
    if desc_col and desc_col != target_col:
        header_dim_cols.append(desc_col)

    num_dim_cols = len(header_dim_cols)
    row0: list[str] = [""] * (num_dim_cols - 1) + ["Date", "(all)"]
    row1: list[str] = list(header_dim_cols) + [""]
    col_accessors: list[str] = ["(all)"]

    for y in sorted(years_dict.keys()):
        row0.append(str(y))
        row1.append("")
        col_accessors.append(f"YEAR_{y}")

        for q in sorted(years_dict[y].keys()):
            row0.append(q)
            row1.append("")
            col_accessors.append(f"QTR_{q}")

            for m_iso, m_label in years_dict[y][q]:
                row0.append(m_label)
                row1.append("")
                col_accessors.append(f"MONTH_{m_iso}")

    def compute_vals(fc_map: dict[str, float]) -> list[float]:
        vals: list[float] = []
        for acc in col_accessors:
            if acc == "(all)":
                vals.append(round(sum(fc_map.get(m, 0.0) for m in months), 2))
            elif acc.startswith("YEAR_"):
                y_str = acc.split("_")[1]
                vals.append(round(sum(fc_map.get(m, 0.0) for m in months if m.startswith(y_str)), 2))
            elif acc.startswith("QTR_"):
                q_str = acc.split("_")[1]
                q_months = [m for m in months if f"Q{(int(m.split('-')[1]) - 1) // 3 + 1} ({m.split('-')[0]})" == q_str]
                vals.append(round(sum(fc_map.get(m, 0.0) for m in q_months), 2))
            elif acc.startswith("MONTH_"):
                m_iso = acc.split("_")[1]
                vals.append(round(fc_map.get(m_iso, 0.0), 2))
        return vals

    data_rows: list[list[Any]] = []

    # Calculate Grand Total
    grand_total_fc: dict[str, float] = {m: 0.0 for m in months}
    for item in entity_forecasts:
        fc = item.get("forecast", {})
        for m in months:
            grand_total_fc[m] += fc.get(m, 0.0)

    # 1. Total Row
    total_dim_vals = ["(all)"] * len(hierarchy_levels) + [target_account]
    if desc_col and desc_col != target_col:
        total_dim_vals.append(f"TOTAL {target_desc}")
    data_rows.append(total_dim_vals + compute_vals(grand_total_fc))

    # 2. Group by hierarchy
    if len(hierarchy_levels) > 1:
        parent_col = hierarchy_levels[0]
        parent_items: dict[str, list[dict[str, Any]]] = {}
        for item in entity_forecasts:
            dims = item.get("dims") or {}
            p_val = dims.get(parent_col) or item.get("business_unit") or ""
            if p_val not in parent_items:
                parent_items[p_val] = []
            parent_items[p_val].append(item)

        for p_val in sorted(parent_items.keys()):
            p_sub_fc = {m: 0.0 for m in months}
            for item in parent_items[p_val]:
                for m in months:
                    p_sub_fc[m] += item.get("forecast", {}).get(m, 0.0)

            sub_dims = [p_val] + ["(all)"] * (len(hierarchy_levels) - 1) + [target_account]
            if desc_col and desc_col != target_col:
                sub_dims.append(f"{parent_col} {p_val} Subtotal")
            data_rows.append(sub_dims + compute_vals(p_sub_fc))

            for item in parent_items[p_val]:
                dims = item.get("dims") or {}
                leaf_dims = [dims.get(c, "") for c in hierarchy_levels] + [target_account]
                if desc_col and desc_col != target_col:
                    leaf_dims.append(target_desc)
                data_rows.append(leaf_dims + compute_vals(item.get("forecast", {})))
    else:
        h_col = hierarchy_levels[0] if hierarchy_levels else "Segment"
        for item in entity_forecasts:
            dims = item.get("dims") or {}
            val = dims.get(h_col) or item.get("business_unit") or item.get("entity") or ""
            leaf_dims = [val] + [target_account]
            if desc_col and desc_col != target_col:
                leaf_dims.append(target_desc)
            data_rows.append(leaf_dims + compute_vals(item.get("forecast", {})))

    return row0, row1, data_rows


@router.get("/reports/{job_id}/export/segment-wise.csv")
@router.get("/reports/{job_id}/export/entity-wise.csv")
async def export_segment_wise_csv(job_id: str):
    job = get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job '{job_id}' not found.",
        )

    if job.entity_status != "completed" or not job.entity_results:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Segment-wise report is not completed yet (current status: '{job.entity_status}').",
        )

    row0, row1, data_rows = _build_story_export_rows(job.entity_results)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(row0)
    writer.writerow(row1)
    for row in data_rows:
        writer.writerow(row)

    csv_data = "\ufeff" + output.getvalue()
    return Response(
        content=csv_data.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=segment_wise_forecast_{job_id[:8]}.csv"},
    )


@router.get("/reports/{job_id}/export/segment-wise.xlsx")
@router.get("/reports/{job_id}/export/entity-wise.xlsx")
async def export_segment_wise_xlsx(job_id: str):
    job = get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job '{job_id}' not found.",
        )

    if job.entity_status != "completed" or not job.entity_results:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Segment-wise report is not completed yet (current status: '{job.entity_status}').",
        )

    import openpyxl

    row0, row1, data_rows = _build_story_export_rows(job.entity_results)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Story_Forecast"
    ws.append(row0)
    ws.append(row1)
    for row in data_rows:
        ws.append(row)

    excel_io = io.BytesIO()
    wb.save(excel_io)
    excel_data = excel_io.getvalue()

    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=segment_wise_forecast_{job_id[:8]}.xlsx"},
    )


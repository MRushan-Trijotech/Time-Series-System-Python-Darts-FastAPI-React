"""
Header detection service.

Handles:
  1. The SAC split-row header pattern (period labels in one row, dimensions in another)
  2. Single-row headers
  3. Workbooks where dimension names or period headers are partially populated
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from backend.utils.date_utils import infer_frequency, parse_period_label


@dataclass
class ColumnMapping:
    original_index: int
    name: str
    role: str  # "dimension" | "time_period" | "other"
    parsed_date: pd.Timestamp | None = None


@dataclass
class HeaderDetectionResult:
    period_row_index: int | None
    dimension_row_index: int | None
    header_depth: int
    columns: list[ColumnMapping]
    date_range_start: pd.Timestamp | None
    date_range_end: pd.Timestamp | None
    frequency: str
    confidence: float
    warnings: list[str] = field(default_factory=list)

    @property
    def dimension_columns(self) -> list[ColumnMapping]:
        return [c for c in self.columns if c.role == "dimension"]

    @property
    def period_columns(self) -> list[ColumnMapping]:
        return [c for c in self.columns if c.role == "time_period"]


def _clean_str(val: Any) -> str:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return ""
    return str(val).strip()


def _is_dimension_name(val: Any) -> bool:
    s = _clean_str(val)
    if not s or s.lower() in ("(all)", "date", "none", "nan", "null"):
        return False
    # If it is any recognizable period (monthly, quarterly, or yearly), it's NOT a dimension name
    if parse_period_label(s, allow_quarter=True, allow_year=True) is not None:
        return False
    # Reject pure numbers / floats
    try:
        float(s)
        return False
    except ValueError:
        pass
    return 1 <= len(s) <= 80


def detect_headers(df: pd.DataFrame, scan_rows: int = 5) -> HeaderDetectionResult:
    warnings: list[str] = []
    n_rows, n_cols = df.shape
    n_scan = min(scan_rows, n_rows)

    # 1. Count period labels per row (monthly primary)
    monthly_counts = [0] * n_scan
    dim_counts = [0] * n_scan

    for r in range(n_scan):
        for c in range(n_cols):
            val = df.iloc[r, c]
            if parse_period_label(val, allow_quarter=False, allow_year=False) is not None:
                monthly_counts[r] += 1
            elif _is_dimension_name(val):
                dim_counts[r] += 1

    # Identify primary period row
    period_row_index: int | None = None
    if max(monthly_counts, default=0) > 0:
        period_row_index = monthly_counts.index(max(monthly_counts))
    else:
        # Check quarterly/yearly fallback
        q_counts = [0] * n_scan
        for r in range(n_scan):
            for c in range(n_cols):
                val = df.iloc[r, c]
                if parse_period_label(val, allow_quarter=True, allow_year=True) is not None:
                    q_counts[r] += 1
        if max(q_counts, default=0) > 0:
            period_row_index = q_counts.index(max(q_counts))

    # Identify primary dimension row
    # In split-header workbooks (like Story.xlsx), dimensions are in a row DIFFERENT from period_row
    # But if there's only one header row, both can be in the same row.
    dimension_row_index: int | None = None
    best_dim_count = 0
    for r in range(n_scan):
        count = dim_counts[r]
        if count > best_dim_count:
            best_dim_count = count
            dimension_row_index = r

    # Determine header depth
    used_rows = [r for r in (period_row_index, dimension_row_index) if r is not None]
    header_depth = (max(used_rows) + 1) if used_rows else 1

    # Classify each column
    columns: list[ColumnMapping] = []
    for c in range(n_cols):
        # Check if period_row has a valid period for this column
        p_ts: pd.Timestamp | None = None
        if period_row_index is not None:
            p_ts = parse_period_label(df.iloc[period_row_index, c], allow_quarter=False, allow_year=False)

        if p_ts is not None:
            col_name = _clean_str(df.iloc[period_row_index, c]) or p_ts.strftime("%b (%Y)")
            columns.append(
                ColumnMapping(
                    original_index=c,
                    name=col_name,
                    role="time_period",
                    parsed_date=p_ts,
                )
            )
            continue

        # Check dimension name:
        # Prefer dimension_row_index, then any header row up to header_depth
        dim_name = ""
        if dimension_row_index is not None and _is_dimension_name(df.iloc[dimension_row_index, c]):
            dim_name = _clean_str(df.iloc[dimension_row_index, c])
        else:
            for r in range(header_depth):
                if _is_dimension_name(df.iloc[r, c]):
                    dim_name = _clean_str(df.iloc[r, c])
                    break

        if dim_name:
            columns.append(
                ColumnMapping(
                    original_index=c,
                    name=dim_name,
                    role="dimension",
                    parsed_date=None,
                )
            )
        else:
            raw_cell = _clean_str(df.iloc[0, c]) if n_rows > 0 else ""
            columns.append(
                ColumnMapping(
                    original_index=c,
                    name=raw_cell or f"Col_{c}",
                    role="other",
                    parsed_date=None,
                )
            )

    period_timestamps = sorted(
        [c.parsed_date for c in columns if c.role == "time_period" and c.parsed_date is not None]
    )
    date_start = period_timestamps[0] if period_timestamps else None
    date_end = period_timestamps[-1] if period_timestamps else None
    frequency = infer_frequency(period_timestamps)

    n_periods = len(period_timestamps)
    n_dims = sum(1 for c in columns if c.role == "dimension")

    if n_periods >= 12 and n_dims >= 1:
        confidence = 1.0
    elif n_periods >= 3:
        confidence = 0.7
    else:
        confidence = 0.3
        warnings.append("Few or no period columns detected. Please review column mappings.")

    if n_dims == 0:
        warnings.append("No dimension columns detected. Data will be aggregated as a single series.")

    return HeaderDetectionResult(
        period_row_index=period_row_index,
        dimension_row_index=dimension_row_index,
        header_depth=header_depth,
        columns=columns,
        date_range_start=date_start,
        date_range_end=date_end,
        frequency=frequency,
        confidence=confidence,
        warnings=warnings,
    )

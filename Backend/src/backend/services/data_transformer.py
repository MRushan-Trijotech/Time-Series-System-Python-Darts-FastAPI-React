"""
Data transformation service.

Converts a raw (header=None) Excel DataFrame into a clean long-format
DataFrame suitable for time-series analysis, using the output of
header_detection.detect_headers().
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from backend.services.header_detection import HeaderDetectionResult


@dataclass
class TransformResult:
    long_df: pd.DataFrame           # columns: date, *dim_cols, value
    dimension_columns: list[str]
    period_columns: list[str]       # original label strings
    date_range_start: pd.Timestamp
    date_range_end: pd.Timestamp
    frequency: str
    row_count: int
    missing_value_count: int
    duplicate_count: int
    warnings: list[str] = field(default_factory=list)

    def preview(self, n: int = 20) -> list[dict[str, Any]]:
        """Return first n rows as JSON-safe dicts."""
        out = []
        for _, row in self.long_df.head(n).iterrows():
            record: dict[str, Any] = {}
            for k, v in row.items():
                if isinstance(v, pd.Timestamp):
                    record[str(k)] = v.isoformat()
                elif pd.isna(v):
                    record[str(k)] = None
                else:
                    record[str(k)] = v
            out.append(record)
        return out


def transform(
    raw_df: pd.DataFrame,
    detection: HeaderDetectionResult,
    missing_fill: str = "preserve",  # "preserve" | "zero" | "interpolate"
) -> TransformResult:
    """
    Apply detected header mapping to the raw DataFrame and melt to long format.

    Steps:
    1. Skip the header rows (rows 0..header_depth-1).
    2. Rename columns using the detected mapping.
    3. Keep only DIMENSION and TIME_PERIOD columns.
    4. Convert period columns to numeric (coerce → NaN preserved).
    5. Melt to long format: (date, *dim_cols, value).
    6. Map period labels to timestamps.
    7. Detect duplicates and missing values.
    8. Optionally apply missing-value strategy.
    """
    warnings: list[str] = []

    dim_cols = detection.dimension_columns
    period_cols = detection.period_columns

    if not period_cols:
        raise ValueError(
            "No time-period columns were detected. "
            "Check the workbook layout and try manual correction."
        )

    # Drop header rows
    data_df = raw_df.iloc[detection.header_depth:].copy()
    data_df = data_df.reset_index(drop=True)

    # Build rename map: original_index -> detected name
    rename_map = {
        col.original_index: col.name
        for col in detection.columns
        if col.role in ("dimension", "time_period")
    }
    # Only keep the columns we care about
    keep_indices = [c.original_index for c in dim_cols] + [
        c.original_index for c in period_cols
    ]
    data_df = data_df.iloc[:, keep_indices].copy()
    # Rename by position in keep_indices
    new_names = [detection.columns[i].name for i in keep_indices]
    data_df.columns = new_names

    dim_col_names = [c.name for c in dim_cols]
    period_col_names = [c.name for c in period_cols]

    # Convert dimension columns to string
    for col in dim_col_names:
        data_df[col] = data_df[col].astype("object").where(
            data_df[col].notna(), other=None
        )
        data_df[col] = data_df[col].apply(
            lambda v: str(v).strip() if v is not None else None
        )

    # Drop rows where ALL dimension columns are null (empty rows)
    if dim_col_names:
        all_null_mask = data_df[dim_col_names].isnull().all(axis=1)
        n_dropped = all_null_mask.sum()
        if n_dropped > 0:
            data_df = data_df[~all_null_mask].copy()
            warnings.append(f"Dropped {n_dropped} empty rows (all dimension values null).")

    # Convert period columns to numeric
    for col in period_col_names:
        data_df[col] = pd.to_numeric(data_df[col], errors="coerce")

    # Build date map: period_label -> pd.Timestamp
    date_map: dict[str, pd.Timestamp] = {
        c.name: c.parsed_date
        for c in period_cols
        if c.parsed_date is not None
    }

    # Melt to long format
    long_df = data_df.melt(
        id_vars=dim_col_names,
        value_vars=period_col_names,
        var_name="period_label",
        value_name="value",
    )

    # Map period_label to timestamp
    long_df["date"] = long_df["period_label"].map(date_map)
    long_df = long_df.drop(columns=["period_label"])

    # Drop rows where date could not be resolved
    unresolved = long_df["date"].isna().sum()
    if unresolved > 0:
        long_df = long_df[long_df["date"].notna()].copy()
        warnings.append(
            f"Dropped {unresolved} rows with unresolvable period dates."
        )

    # Reorder columns: date, *dims, value
    long_df = long_df[["date"] + dim_col_names + ["value"]].sort_values(
        ["date"] + dim_col_names
    ).reset_index(drop=True)

    # Missing value count
    missing_value_count = int(long_df["value"].isna().sum())
    if missing_value_count > 0:
        warnings.append(
            f"{missing_value_count} missing target values found. "
            "They are preserved as NaN (not replaced with zero)."
        )

    # Duplicate detection: same entity + date
    dup_cols = ["date"] + dim_col_names
    duplicate_count = int(long_df.duplicated(subset=dup_cols).sum())
    if duplicate_count > 0:
        warnings.append(
            f"{duplicate_count} duplicate observations found "
            "(same entity + date). Aggregating by sum."
        )
        long_df = (
            long_df.groupby(dup_cols, dropna=False)["value"]
            .sum()
            .reset_index()
        )

    # Apply missing-value strategy
    if missing_fill == "zero":
        long_df["value"] = long_df["value"].fillna(0)
        warnings.append("Missing values replaced with zero (user-selected strategy).")
    elif missing_fill == "interpolate":
        long_df = long_df.sort_values(["date"] + dim_col_names)
        long_df["value"] = long_df.groupby(dim_col_names, dropna=False)[
            "value"
        ].transform(lambda s: s.interpolate(method="linear", limit_direction="both"))
        warnings.append("Missing values interpolated (user-selected strategy).")

    timestamps = sorted(date_map.values())

    return TransformResult(
        long_df=long_df,
        dimension_columns=dim_col_names,
        period_columns=period_col_names,
        date_range_start=timestamps[0],
        date_range_end=timestamps[-1],
        frequency=detection.frequency,
        row_count=len(long_df),
        missing_value_count=missing_value_count,
        duplicate_count=duplicate_count,
        warnings=warnings,
    )


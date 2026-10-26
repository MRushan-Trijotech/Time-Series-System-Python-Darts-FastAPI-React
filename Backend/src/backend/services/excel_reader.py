"""Excel workbook reader — raw loading and sheet listing."""
from pathlib import Path
from typing import Any

import pandas as pd


def list_sheets(path: Path) -> list[str]:
    """Return all worksheet names in the workbook."""
    xl = pd.ExcelFile(path, engine="openpyxl")
    return xl.sheet_names


def load_raw_sheet(path: Path, sheet_name: str) -> pd.DataFrame:
    """
    Load a worksheet without assuming any row is a header.
    Returns a DataFrame with integer column indices (0, 1, 2, ...).
    """
    df = pd.read_excel(
        path,
        sheet_name=sheet_name,
        header=None,
        engine="openpyxl",
    )
    return df


def raw_preview(df: pd.DataFrame, n_rows: int = 10) -> list[dict[str, Any]]:
    """Return the first n rows as a list of dicts for JSON serialization."""
    preview = df.head(n_rows).copy()
    # Convert column indices to strings for JSON keys
    preview.columns = [str(c) for c in preview.columns]
    records = []
    for _, row in preview.iterrows():
        record: dict[str, Any] = {}
        for k, v in row.items():
            if pd.isna(v):
                record[k] = None
            elif isinstance(v, float) and v == int(v):
                record[k] = int(v)
            else:
                record[k] = v
        records.append(record)
    return records


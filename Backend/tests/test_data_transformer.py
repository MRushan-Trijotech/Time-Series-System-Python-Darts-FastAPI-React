"""Tests for data transformation and series building."""
import pandas as pd
import pytest

from backend.services.data_transformer import transform
from backend.services.header_detection import detect_headers
from backend.services.series_builder import build_aggregate_series


def test_transform_and_aggregate(synthetic_split_header_df):
    detection = detect_headers(synthetic_split_header_df, scan_rows=3)
    res = transform(synthetic_split_header_df, detection)

    assert res.row_count > 0
    assert "Region" in res.dimension_columns
    assert "Account" in res.dimension_columns
    assert len(res.period_columns) == 3

    series_res = build_aggregate_series(
        res.long_df,
        filters={"Region": ["North"]},
        dimension_columns=res.dimension_columns,
    )
    assert series_res.n_observations == 3
    # Check aggregation sum: North Jan=100, Feb=110, Mar=120
    ts_vals = series_res.total_series.values().flatten().tolist()
    assert ts_vals == [100.0, 110.0, 120.0]


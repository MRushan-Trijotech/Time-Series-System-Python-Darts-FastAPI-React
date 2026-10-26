"""Tests for header detection and date parsing."""
import pandas as pd
import pytest

from backend.services.header_detection import detect_headers
from backend.utils.date_utils import parse_period_label


def test_parse_period_label():
    assert parse_period_label("Jan (2024)") == pd.Timestamp("2024-01-01")
    assert parse_period_label("Dec (2023)") == pd.Timestamp("2023-12-01")
    assert parse_period_label("January 2024") == pd.Timestamp("2024-01-01")
    assert parse_period_label("Q1 (2024)", allow_quarter=True) == pd.Timestamp("2024-01-01")
    assert parse_period_label("1700", allow_year=False) is None
    assert parse_period_label("(all)") is None
    assert parse_period_label("Date") is None
    assert parse_period_label("Business unit") is None


def test_detect_split_headers(synthetic_split_header_df):
    result = detect_headers(synthetic_split_header_df, scan_rows=3)
    assert result.period_row_index == 0
    assert result.dimension_row_index == 1
    assert result.header_depth == 2
    dim_names = [c.name for c in result.dimension_columns]
    assert "Region" in dim_names
    assert "Account" in dim_names
    assert len(result.period_columns) == 3


def test_detect_single_row_headers(synthetic_single_header_df):
    result = detect_headers(synthetic_single_header_df, scan_rows=3)
    assert result.header_depth == 1
    assert len(result.dimension_columns) == 2
    assert len(result.period_columns) == 2


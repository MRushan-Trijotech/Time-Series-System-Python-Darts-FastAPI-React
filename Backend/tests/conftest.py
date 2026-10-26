"""Pytest fixtures for backend tests."""
import pandas as pd
import pytest


@pytest.fixture
def synthetic_split_header_df():
    """
    Creates a DataFrame that reproduces the SAC Story.xlsx split-header pattern:
    Row 0: None, None, Jan (2024), Feb (2024), Mar (2024)
    Row 1: Region, Account, None, None, None
    Row 2: North, Sales, 100, 110, 120
    Row 3: South, Sales, 200, 210, 220
    """
    data = [
        [None, None, "Jan (2024)", "Feb (2024)", "Mar (2024)"],
        ["Region", "Account", None, None, None],
        ["North", "Sales", 100, 110, 120],
        ["South", "Sales", 200, 210, 220],
    ]
    return pd.DataFrame(data)


@pytest.fixture
def synthetic_single_header_df():
    """Single-row header format."""
    data = [
        ["Region", "Account", "Jan (2024)", "Feb (2024)"],
        ["North", "Sales", 150, 160],
        ["South", "Sales", 250, 260],
    ]
    return pd.DataFrame(data)


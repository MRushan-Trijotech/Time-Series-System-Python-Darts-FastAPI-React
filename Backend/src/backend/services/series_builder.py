"""
Series builder service.

Converts a long-format DataFrame into a Darts TimeSeries aggregate
(total series = sum of all filtered rows per date).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd
from darts import TimeSeries


@dataclass
class SeriesBuildResult:
    total_series: TimeSeries
    date_range_start: pd.Timestamp
    date_range_end: pd.Timestamp
    n_observations: int
    warnings: list[str] = field(default_factory=list)


MIN_OBSERVATIONS = 24  # minimum for ML models with lags=12


def build_aggregate_series(
    long_df: pd.DataFrame,
    filters: dict[str, list[str]],
    dimension_columns: list[str],
    frequency: str = "MS",
    bu_entities: dict[str, list[str]] | None = None,
    accounts: list[str] | None = None,
) -> SeriesBuildResult:
    """
    Apply filters to long_df, aggregate values by date (sum),
    and build a monthly Darts TimeSeries.

    Parameters
    ----------
    long_df : long-format DataFrame with columns [date, *dim_cols, value]
    filters : dict of dim_name -> list of allowed values (empty list = all)
    dimension_columns : the detected dimension column names
    frequency : pandas frequency string (default "MS" = month-start)
    bu_entities : dict of Business unit -> list of selected legal entities for that BU
    accounts : list of selected ACCOUNT codes
    """
    warnings: list[str] = []
    df = long_df.copy()

    # Case-insensitive column resolution
    bu_col = next((c for c in dimension_columns if "business unit" in c.lower()), None)
    ent_col = next((c for c in dimension_columns if "legal_entity" in c.lower() or "legal entity" in c.lower()), None)
    acc_col = next((c for c in dimension_columns if c.lower() == "account"), None)

    # 1. Apply exact hierarchical BU + Legal Entity matching if provided
    if bu_entities and bu_col and ent_col and bu_col in df.columns and ent_col in df.columns:
        masks = []
        for bu, entities in bu_entities.items():
            if entities:
                masks.append((df[bu_col] == bu) & (df[ent_col].isin(entities)))
            else:
                masks.append(df[bu_col] == bu)
        if masks:
            comb = masks[0]
            for m in masks[1:]:
                comb = comb | m
            df = df[comb]

    # 2. Apply 1-to-1 Account filtering if provided
    if accounts and acc_col and acc_col in df.columns:
        df = df[df[acc_col].isin(accounts)]

    # 3. Apply any other standard dimension filters
    for dim, allowed in filters.items():
        # Skip if already handled by hierarchical or account filters
        if bu_entities and dim in [bu_col, ent_col]:
            continue
        if accounts and dim in [acc_col, "Description", "description"]:
            continue
        if dim not in df.columns:
            warnings.append(f"Filter dimension '{dim}' not found in data — ignored.")
            continue
        if allowed:  # empty list means "all"
            df = df[df[dim].isin(allowed)]

    if df.empty:
        raise ValueError(
            "No data remains after applying the selected filters. "
            "Check your dimension selections."
        )

    # Aggregate: sum all values per date
    agg = (
        df.groupby("date", dropna=True)["value"]
        .sum(min_count=1)  # NaN if all values are NaN for that date
        .reset_index()
        .sort_values("date")
    )

    missing_dates = int(agg["value"].isna().sum())
    if missing_dates > 0:
        warnings.append(
            f"{missing_dates} dates have no non-null values after aggregation "
            "and will appear as NaN in the series."
        )

    # Drop rows with NaN values (Darts requires no NaN for most models)
    agg_clean = agg.dropna(subset=["value"])

    if len(agg_clean) < 2:
        raise ValueError(
            f"Only {len(agg_clean)} non-null observations after aggregation. "
            "At least 2 are required to form a time series."
        )

    if len(agg_clean) < MIN_OBSERVATIONS:
        warnings.append(
            f"Only {len(agg_clean)} observations available. "
            "ML models requiring lags=12 will be skipped."
        )

    # Build Darts TimeSeries
    ts = TimeSeries.from_dataframe(
        agg_clean,
        time_col="date",
        value_cols="value",
        freq=frequency,
        fill_missing_dates=True,
        fillna_value=None,  # keep NaN explicit
    )

    return SeriesBuildResult(
        total_series=ts,
        date_range_start=agg_clean["date"].min(),
        date_range_end=agg_clean["date"].max(),
        n_observations=len(ts),
        warnings=warnings,
    )


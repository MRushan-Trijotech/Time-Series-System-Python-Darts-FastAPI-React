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
    train_start: str | None = None,
    train_end: str | None = None,
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
    train_start : optional ISO date string to restrict series start (fills missing with 0)
    train_end : optional ISO date string to restrict series end (fills missing with 0)
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

    # STRICT RULE: Identify observations with real data (not null and not 0)
    valid_points = agg[agg["value"].notna() & (agg["value"] != 0)]
    if valid_points.empty:
        raise ValueError(
            "No historical data available for this selection (all values are empty or zero)."
        )

    first_avail = valid_points["date"].min()
    last_avail = valid_points["date"].max()

    eff_start = max(first_avail, pd.Timestamp(train_start)) if train_start else first_avail
    eff_end = min(last_avail, pd.Timestamp(train_end)) if train_end else last_avail

    if eff_start > eff_end:
        raise ValueError(
            f"Selected training range ({train_start} to {train_end}) does not overlap with available data "
            f"({first_avail.strftime('%Y-%m')} to {last_avail.strftime('%Y-%m')})."
        )

    # Slice between eff_start and eff_end; fill in-between gaps with 0
    agg = agg[(agg["date"] >= eff_start) & (agg["date"] <= eff_end)].copy()
    agg["value"] = agg["value"].fillna(0)

    # Drop rows with NaN values (Darts requires no NaN for most models)
    agg_clean = agg.dropna(subset=["value"])

    if len(agg_clean) < 2:
        raise ValueError(
            f"Only {len(agg_clean)} non-null observation(s) after aggregation in the selected range. "
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


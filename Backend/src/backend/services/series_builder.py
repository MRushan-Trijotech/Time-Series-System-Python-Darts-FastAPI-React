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
    filters: dict[str, list[str]] | None = None,
    dimension_columns: list[str] | None = None,
    frequency: str = "MS",
    bu_entities: dict[str, list[str]] | None = None,
    accounts: list[str] | None = None,
    train_start: str | None = None,
    train_end: str | None = None,
    hierarchy_selections: list[dict[str, str]] | None = None,
    target_column: str | None = None,
    target_value: str | None = None,
) -> SeriesBuildResult:
    """
    Apply filters to long_df, aggregate values by date (sum),
    and build a monthly Darts TimeSeries. Supports dynamic multi-level hierarchies
    and target columns as well as legacy BU/Entity/Account mappings.
    """
    warnings: list[str] = []
    df = long_df.copy()
    filters = filters or {}
    dimension_columns = dimension_columns or []

    # 1. Dynamic Target column filtering (do first to instantly shrink row count)
    if target_column and target_value and target_column in df.columns:
        df = df[df[target_column].astype(str) == str(target_value)]

    # 2. Fast vectorized multi-level hierarchy filter
    if hierarchy_selections:
        sel_df = pd.DataFrame(hierarchy_selections).dropna(how="all")
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

    # Case-insensitive column resolution for legacy calls
    bu_col = next((c for c in dimension_columns if "business unit" in c.lower()), None)
    ent_col = next((c for c in dimension_columns if "legal_entity" in c.lower() or "legal entity" in c.lower()), None)
    acc_col = next((c for c in dimension_columns if c.lower() == "account"), None)

    # 3. Apply exact hierarchical BU + Legal Entity matching if provided (legacy)
    if not hierarchy_selections and bu_entities and bu_col and ent_col and bu_col in df.columns and ent_col in df.columns:
        bu_ent_pairs = []
        for bu, entities in bu_entities.items():
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

    # 4. Apply 1-to-1 Account filtering if provided (legacy)
    if not target_value and accounts and acc_col and acc_col in df.columns:
        df = df[df[acc_col].isin(accounts)]
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
    dataset_end = long_df["date"].max() if "date" in long_df.columns and not long_df["date"].empty else last_avail

    eff_start = max(first_avail, pd.Timestamp(train_start)) if train_start else first_avail
    eff_end = pd.Timestamp(train_end) if train_end else max(last_avail, dataset_end)

    if eff_start > eff_end:
        raise ValueError(
            f"Selected training range ({train_start} to {train_end}) does not overlap with available data "
            f"({first_avail.strftime('%Y-%m')} to {last_avail.strftime('%Y-%m')})."
        )

    # Reindex over the complete monthly date range between eff_start and eff_end
    full_date_idx = pd.date_range(eff_start, eff_end, freq=frequency)
    agg = (
        agg.set_index("date")
        .reindex(full_date_idx)
        .fillna(0.0)
        .reset_index()
        .rename(columns={"index": "date"})
    )
    agg["value"] = agg["value"].fillna(0.0)

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


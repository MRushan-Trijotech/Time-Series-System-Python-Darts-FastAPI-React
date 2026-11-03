"""Pydantic schemas for dataset/dimensions."""
from typing import Any

from pydantic import BaseModel


class DimensionValues(BaseModel):
    name: str
    values: list[str]


class DatasetMetadata(BaseModel):
    dataset_id: str
    filename: str
    sheet_name: str
    dimension_columns: list[str]
    period_columns: list[str]
    date_range_start: str
    date_range_end: str
    frequency: str
    row_count: int
    missing_value_count: int
    duplicate_count: int
    warnings: list[str]


class AccountItem(BaseModel):
    account: str
    description: str
    label: str


class TargetOption(BaseModel):
    value: str
    description: str | None = None
    label: str


class HierarchyTreeNode(BaseModel):
    value: str
    children: list["HierarchyTreeNode"] = []


class DimensionsResponse(BaseModel):
    dimensions: list[DimensionValues]
    hierarchy_levels: list[str] = []
    hierarchy_tree: list[dict[str, Any]] = []  # Nested tree of hierarchy nodes
    target_column: str = "ACCOUNT"
    description_column: str | None = "Description"
    targets: list[TargetOption] = []
    # Legacy backward-compatibility fields:
    bu_entity_hierarchy: dict[str, list[str]] = {}
    accounts: list[AccountItem] = []
    relations: list[dict[str, str]] = []


class SeriesPreviewRequest(BaseModel):
    filters: dict[str, list[str]] = {}  # dim_name -> selected values
    bu_entities: dict[str, list[str]] | None = None
    accounts: list[str] | None = None


class SeriesPreviewResponse(BaseModel):
    total_rows: int
    estimated_series_count: int
    date_range_start: str
    date_range_end: str
    warnings: list[str]


class SeriesInfoRequest(BaseModel):
    filters: dict[str, list[str]] = {}
    hierarchy_selections: list[dict[str, str]] | None = None
    target_value: str | None = None
    bu_entities: dict[str, list[str]] | None = None
    accounts: list[str] | None = None


class SeriesInfoResponse(BaseModel):
    n_observations: int
    date_range_start: str
    date_range_end: str
    recommended_horizon: int
    warnings: list[str]


"""Pydantic schemas for upload and inspection."""
from typing import Any

from pydantic import BaseModel, Field


class SheetInfo(BaseModel):
    sheet_names: list[str]
    default_sheet: str


class UploadResponse(BaseModel):
    dataset_id: str
    filename: str
    sheet_names: list[str]
    message: str


class ColumnInfo(BaseModel):
    original_index: int
    name: str
    role: str  # "dimension" | "time_period" | "other"
    parsed_date: str | None = None  # ISO date string for time_period columns


class InspectRequest(BaseModel):
    sheet_name: str


class HeaderDetectionResult(BaseModel):
    period_row_index: int | None
    dimension_row_index: int | None
    header_depth: int  # number of rows consumed as headers
    dimension_columns: list[ColumnInfo]
    period_columns: list[ColumnInfo]
    other_columns: list[ColumnInfo]
    date_range_start: str | None
    date_range_end: str | None
    frequency: str
    confidence: float
    warnings: list[str]
    raw_preview: list[dict[str, Any]]  # first 8 rows of raw sheet


class SchemaMappingConfig(BaseModel):
    period_row_index: int = 0
    dimension_row_index: int = 1
    target_column: str
    description_column: str | None = None
    hierarchy_columns: list[str] = Field(default_factory=list)


class TransformRequest(BaseModel):
    sheet_name: str
    # Optional schema mapping configuration
    schema_config: SchemaMappingConfig | None = None
    # Legacy / manual index overrides
    header_depth: int | None = None
    dimension_column_indices: list[int] | None = None
    period_column_indices: list[int] | None = None


class TransformResponse(BaseModel):
    dataset_id: str
    row_count: int
    dimension_columns: list[str]
    period_columns: list[str]
    date_range_start: str
    date_range_end: str
    frequency: str
    missing_value_count: int
    duplicate_count: int
    warnings: list[str]
    preview: list[dict[str, Any]]
    schema_config: SchemaMappingConfig | None = None


class UploadedFileInfo(BaseModel):
    dataset_id: str
    filename: str
    sheet_names: list[str]
    dimension_columns: list[str]
    period_count: int
    date_range_start: str | None = None
    date_range_end: str | None = None
    header_depth: int
    dimension_row_index: int | None = None
    period_row_index: int | None = None


class MultiUploadResponse(BaseModel):
    files: list[UploadedFileInfo]
    is_compatible: bool
    common_dimensions: list[str] = Field(default_factory=list)
    incompatibility_reason: str | None = None
    unified_timeline_start: str | None = None
    unified_timeline_end: str | None = None
    total_months: int = 0


class MergeTransformRequest(BaseModel):
    dataset_ids: list[str]
    sheet_name: str | None = None
    schema_config: SchemaMappingConfig | None = None



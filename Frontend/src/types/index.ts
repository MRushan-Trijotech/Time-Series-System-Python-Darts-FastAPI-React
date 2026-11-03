export interface ColumnInfo {
  original_index: number
  name: string
  role: 'dimension' | 'time_period' | 'other'
  parsed_date?: string | null
}

export interface HeaderDetectionResult {
  period_row_index: number | null
  dimension_row_index: number | null
  header_depth: number
  dimension_columns: ColumnInfo[]
  period_columns: ColumnInfo[]
  other_columns: ColumnInfo[]
  date_range_start: string | null
  date_range_end: string | null
  frequency: string
  confidence: number
  warnings: string[]
  raw_preview: Record<string, any>[]
}

export interface UploadResponse {
  dataset_id: string
  filename: string
  sheet_names: string[]
  message: string
}

export interface UploadedFileInfo {
  dataset_id: string
  filename: string
  sheet_names: string[]
  dimension_columns: string[]
  period_count: number
  date_range_start?: string | null
  date_range_end?: string | null
  header_depth: number
  dimension_row_index?: number | null
  period_row_index?: number | null
}

export interface MultiUploadResponse {
  files: UploadedFileInfo[]
  is_compatible: boolean
  common_dimensions: string[]
  incompatibility_reason?: string | null
  unified_timeline_start?: string | null
  unified_timeline_end?: string | null
  total_months: number
}

export interface MergeTransformRequest {
  dataset_ids: string[]
  schema_config?: SchemaMappingConfig | null
}

export interface TransformResponse {
  dataset_id: string
  row_count: number
  dimension_columns: string[]
  period_columns: string[]
  date_range_start: string
  date_range_end: string
  frequency: string
  missing_value_count: number
  duplicate_count: number
  warnings: string[]
  preview: Record<string, any>[]
}

export interface DimensionValue {
  name: string
  values: string[]
}

export interface AccountItem {
  account: string
  description: string
  label: string
}

export interface SchemaMappingConfig {
  period_row_index: number
  dimension_row_index: number
  target_column: string
  description_column?: string | null
  hierarchy_columns: string[]
}

export interface TargetOption {
  value: string
  description?: string | null
  label: string
}

export interface HierarchyTreeNode {
  value: string
  children?: HierarchyTreeNode[]
}

export interface DimensionsResponse {
  dimensions: DimensionValue[]
  hierarchy_levels?: string[]
  hierarchy_tree?: HierarchyTreeNode[]
  target_column?: string
  description_column?: string | null
  targets?: TargetOption[]
  bu_entity_hierarchy?: Record<string, string[]>
  accounts?: AccountItem[]
  relations?: Record<string, string>[]
}

export interface CandidateModelInfo {
  name: string
  family: string
  is_available: boolean
  min_observations: number
}

export interface CandidateResult {
  model_name: string
  mape: number | null
  mae: number | null
  rmse: number | null
  duration_seconds: number
  status: 'OK' | 'FAILED' | 'SKIPPED'
  error?: string | null
}

export interface JobProgress {
  completed: number
  total: number
  current_model: string
  message: string
}

export interface JobStatus {
  job_id: string
  status: 'running' | 'completed' | 'failed'
  stage: string
  progress: JobProgress
  elapsed_seconds: number
  error: string | null
  log_tail: string[]
}

export interface HistoricalPoint {
  date: string
  value: number | null
}

export interface ValidationPoint {
  date: string
  actual: number | null
  predicted: number | null
  error: number | null
}

export interface ForecastPoint {
  date: string
  value: number | null
  lower_bound?: number | null
  upper_bound?: number | null
}

export interface ConfigurationSummary {
  hierarchy_levels?: string[]
  hierarchy_summary?: Record<string, string[]>
  target_column?: string
  target_value?: string
  target_description?: string
  business_units: string[]
  bu_entities: Record<string, string[]>
  accounts: string[]
  forecast_horizon: number
  train_start: string
  train_end: string
  total_observations: number
}

export interface ForecastReport {
  job_id: string
  configuration?: ConfigurationSummary
  best_model?: string
  selection_metric?: string
  validation?: {
    start: string
    end: string
    mape: number | null
    mae: number | null
    rmse: number | null
  }
  candidate_results?: CandidateResult[]
  historical: HistoricalPoint[]
  validation_series?: ValidationPoint[]
  forecast: ForecastPoint[]
  warnings?: string[]
}

export interface TrendInfo {
  direction: 'increasing' | 'decreasing' | 'stable'
  description: string
  values: HistoricalPoint[]
}

export interface SeasonalityInfo {
  detected: boolean
  period: number | null
  description: string
  values: HistoricalPoint[]
}

export interface ACFInfo {
  lags: number[]
  acf_values: (number | null)[]
  description: string
}

export interface ExplanationReport {
  job_id: string
  configuration?: ConfigurationSummary
  best_model?: string
  model_family?: string
  why_selected?: string
  trend: TrendInfo | null
  seasonality: SeasonalityInfo | null
  acf: ACFInfo | null
  data_warnings?: string[]
  limitations?: string[]
}

export interface EntityWiseEntity {
  entity: string
  forecast: number
  distribution_pct: number
  best_model: string
  mape: number | null
}

export interface EntityWiseBusinessUnit {
  business_unit: string
  forecast: number
  distribution_pct: number
  best_model: string
  mape: number | null
  entities: EntityWiseEntity[]
}

export interface EntityWiseMonth {
  month: string
  total_forecast: number
  distribution_pct: number
  business_units: EntityWiseBusinessUnit[]
}

export interface EntityForecastItem {
  business_unit: string
  entity: string
  dims?: Record<string, string>
  account: string
  description: string
  target_account?: string
  target_description?: string
  forecast: Record<string, number>
  best_model: string
  mape?: number | null
}

export interface EntityWiseReportData {
  months: string[]
  hierarchy_levels?: string[]
  target_column?: string
  description_column?: string | null
  hierarchy: EntityWiseMonth[]
  entity_forecasts?: EntityForecastItem[]
  segment_forecasts?: EntityForecastItem[]
  target_account?: string
  target_description?: string
  total_segments: number
  total_business_units: number
}

export interface EntityWiseReportResponse {
  job_id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: {
    completed: number
    total: number
    current_segment: string
    percent: number
  }
  error: string | null
  data: EntityWiseReportData | null
}

export type SegmentWiseReportResponse = EntityWiseReportResponse
export type SegmentWiseReportData = EntityWiseReportData
export type SegmentForecastItem = EntityForecastItem


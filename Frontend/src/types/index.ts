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

export interface DimensionsResponse {
  dimensions: DimensionValue[]
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

export interface ForecastReport {
  job_id: string
  best_model: string
  selection_metric: string
  validation: {
    start: string
    end: string
    mape: number | null
    mae: number | null
    rmse: number | null
  }
  candidate_results: CandidateResult[]
  historical: HistoricalPoint[]
  validation_series: ValidationPoint[]
  forecast: ForecastPoint[]
  warnings: string[]
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
  best_model: string
  model_family: string
  why_selected: string
  trend: TrendInfo | null
  seasonality: SeasonalityInfo | null
  acf: ACFInfo | null
  data_warnings: string[]
  limitations: string[]
}


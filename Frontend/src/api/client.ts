import axios from 'axios'
import type {
  CandidateModelInfo,
  DimensionsResponse,
  ExplanationReport,
  ForecastReport,
  HeaderDetectionResult,
  JobStatus,
  TransformResponse,
  UploadResponse,
} from '../types'

export const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Upload & Inspection
export const uploadFile = async (file: File): Promise<UploadResponse> => {
  const formData = new FormData()
  formData.append('file', file)
  const res = await api.post<UploadResponse>('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export const inspectDataset = async (datasetId: string, sheetName: string): Promise<HeaderDetectionResult> => {
  const res = await api.post<HeaderDetectionResult>(`/datasets/${datasetId}/inspect`, {
    sheet_name: sheetName,
  })
  return res.data
}

export const transformDataset = async (
  datasetId: string,
  sheetName: string,
  overrides?: {
    header_depth?: number
    dimension_column_indices?: number[]
    period_column_indices?: number[]
  }
): Promise<TransformResponse> => {
  const res = await api.post<TransformResponse>(`/datasets/${datasetId}/transform`, {
    sheet_name: sheetName,
    ...overrides,
  })
  return res.data
}

export const getDimensions = async (datasetId: string): Promise<DimensionsResponse> => {
  const res = await api.get<DimensionsResponse>(`/datasets/${datasetId}/dimensions`)
  return res.data
}

export const getAvailableModels = async (): Promise<{ models: CandidateModelInfo[] }> => {
  const res = await api.get<{ models: CandidateModelInfo[] }>('/training/models/available')
  return res.data
}

export const startTraining = async (params: {
  dataset_id: string
  filters?: Record<string, string[]>
  bu_entities?: Record<string, string[]>
  accounts?: string[]
  forecast_horizon: number
  validation_split: number
  candidate_models?: string[]
}): Promise<{ job_id: string; status: string }> => {
  const res = await api.post<{ job_id: string; status: string }>('/training', params)
  return res.data
}

export const getJobStatus = async (jobId: string): Promise<JobStatus> => {
  const res = await api.get<JobStatus>(`/training/${jobId}`)
  return res.data
}

export const getForecastReport = async (jobId: string): Promise<ForecastReport> => {
  const res = await api.get<ForecastReport>(`/reports/${jobId}/forecast`)
  return res.data
}

export const getExplanationReport = async (jobId: string): Promise<ExplanationReport> => {
  const res = await api.get<ExplanationReport>(`/reports/${jobId}/explanation`)
  return res.data
}


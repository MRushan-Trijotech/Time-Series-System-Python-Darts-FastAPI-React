import React, { createContext, useContext, useState } from 'react'
import type { TransformResponse } from '../types'

export interface ForecastConfigState {
  hierarchyLevels?: string[]
  hierarchySelections?: Record<string, string[]>
  targetColumn?: string
  businessUnits: string[]
  buEntities: Record<string, string[]>
  targetAccount: string | null
  targetLabel: string | null
  trainStart: string
  trainEnd: string
  forecastHorizon: number
  totalObservations?: number
}

interface SessionContextType {
  datasetId: string | null
  setDatasetId: (id: string | null) => void
  filename: string | null
  setFilename: (name: string | null) => void
  activeSheet: string | null
  setActiveSheet: (sheet: string | null) => void
  sheetNames: string[]
  setSheetNames: (names: string[]) => void
  transformData: TransformResponse | null
  setTransformData: (data: TransformResponse | null) => void
  jobId: string | null
  setJobId: (id: string | null) => void
  jobCompleted: boolean
  setJobCompleted: (done: boolean) => void
  entityStatus: 'idle' | 'pending' | 'running' | 'completed' | 'failed'
  setEntityStatus: (status: 'idle' | 'pending' | 'running' | 'completed' | 'failed') => void
  forecastConfig: ForecastConfigState | null
  setForecastConfig: (config: ForecastConfigState | null) => void
  resetSession: () => void
}

const SessionContext = createContext<SessionContextType | undefined>(undefined)

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [datasetId, setDatasetId] = useState<string | null>(null)
  const [filename, setFilename] = useState<string | null>(null)
  const [activeSheet, setActiveSheet] = useState<string | null>(null)
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [transformData, setTransformData] = useState<TransformResponse | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobCompleted, setJobCompleted] = useState<boolean>(false)
  const [entityStatus, setEntityStatus] = useState<'idle' | 'pending' | 'running' | 'completed' | 'failed'>('idle')
  const [forecastConfig, setForecastConfig] = useState<ForecastConfigState | null>(null)

  const resetSession = () => {
    setDatasetId(null)
    setFilename(null)
    setActiveSheet(null)
    setSheetNames([])
    setTransformData(null)
    setJobId(null)
    setJobCompleted(false)
    setEntityStatus('idle')
    setForecastConfig(null)
  }

  return (
    <SessionContext.Provider
      value={{
        datasetId,
        setDatasetId,
        filename,
        setFilename,
        activeSheet,
        setActiveSheet,
        sheetNames,
        setSheetNames,
        transformData,
        setTransformData,
        jobId,
        setJobId,
        jobCompleted,
        setJobCompleted,
        entityStatus,
        setEntityStatus,
        forecastConfig,
        setForecastConfig,
        resetSession,
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}

export const useSession = () => {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider')
  }
  return context
}


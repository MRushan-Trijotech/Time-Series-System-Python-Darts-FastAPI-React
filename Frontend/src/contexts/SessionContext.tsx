import React, { createContext, useContext, useState } from 'react'
import type { TransformResponse } from '../types'

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

  const resetSession = () => {
    setDatasetId(null)
    setFilename(null)
    setActiveSheet(null)
    setSheetNames([])
    setTransformData(null)
    setJobId(null)
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


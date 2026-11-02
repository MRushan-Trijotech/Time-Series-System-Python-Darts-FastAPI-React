import React from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { SessionProvider } from './contexts/SessionContext'
import { ConfigurationPage } from './pages/ConfigurationPage'
import { DashboardPage } from './pages/DashboardPage'
import { ExplanationReportPage } from './pages/ExplanationReportPage'
import { ForecastReportPage } from './pages/ForecastReportPage'
import { EntityWiseReportPage } from './pages/EntityWiseReportPage'
import { TrainingPage } from './pages/TrainingPage'
import { UploadPage } from './pages/UploadPage'

export const App: React.FC = () => {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/configure" element={<ConfigurationPage />} />
            <Route path="/training" element={<TrainingPage />} />
            <Route path="/report/forecast" element={<ForecastReportPage />} />
            <Route path="/report/explanation" element={<ExplanationReportPage />} />
            <Route path="/report/entity-wise" element={<EntityWiseReportPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  )
}

export default App

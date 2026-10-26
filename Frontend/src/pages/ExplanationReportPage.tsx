import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp,
  RotateCw,
  BarChart2,
  Award,
  Loader2,
  Shield,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getExplanationReport } from '../api/client'
import { useSession } from '../contexts/SessionContext'
import type { ExplanationReport } from '../types'

export const ExplanationReportPage: React.FC = () => {
  const navigate = useNavigate()
  const { jobId } = useSession()

  const [report, setReport] = useState<ExplanationReport | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!jobId) {
      navigate('/configure')
      return
    }

    const loadReport = async () => {
      setIsLoading(true)
      try {
        const data = await getExplanationReport(jobId)
        setReport(data)
      } catch (err: any) {
        setErrorMsg(err.response?.data?.detail || err.message || 'Failed to load explanation report.')
      } finally {
        setIsLoading(false)
      }
    }

    loadReport()
  }, [jobId, navigate])

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        <p className="text-sm text-slate-500">Computing statistical diagnostics and explanations...</p>
      </div>
    )
  }

  if (errorMsg || !report) {
    return (
      <div className="p-6 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 space-y-2">
        <h3 className="font-bold text-sm">Unable to render Explanation Report</h3>
        <p className="text-xs">{errorMsg || 'No explanation data returned.'}</p>
      </div>
    )
  }

  // ACF chart format
  const acfData = report.acf
    ? report.acf.lags.map((lag, i) => ({
        lag: `Lag ${lag}`,
        acf: report.acf?.acf_values[i] ?? 0,
      }))
    : []

  // Trend chart format
  const trendData = (report.trend?.values || []).map((pt) => ({
    date: pt.date.slice(0, 7),
    trend: pt.value,
  }))

  // Seasonality chart format
  const seasonalData = (report.seasonality?.values || []).map((pt) => ({
    date: pt.date.slice(0, 7),
    seasonal: pt.value,
  }))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
          SAP Smart Predict Inspired
        </span>
        <h2 className="text-xl font-bold text-slate-800">Explanation & Diagnostic Report</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Mathematical decomposition of historical patterns, trend trajectory, seasonality detection, and autocorrelation analysis.
        </p>
      </div>

      {/* Model Selection Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-3">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-500" />
            <h3 className="text-sm font-bold text-slate-800">
              Selected Champion Model: {report.best_model}
            </h3>
          </div>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            Family: {report.model_family}
          </span>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">
          {report.why_selected}
        </p>
      </div>

      {/* Diagnostics Grid: Trend and Seasonality */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trend Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Trend Analysis
              </h4>
            </div>

            {report.trend && (
              <span
                className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${
                  report.trend.direction === 'increasing'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : report.trend.direction === 'decreasing'
                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                    : 'bg-slate-100 text-slate-700 border border-slate-200'
                }`}
              >
                {report.trend.direction}
              </span>
            )}
          </div>

          <p className="text-xs text-slate-600">
            {report.trend?.description || 'Trend decomposition could not be computed for this series.'}
          </p>

          {trendData.length > 0 && (
            <div className="h-48 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    tickFormatter={(val: any) => Number(val).toLocaleString()}
                  />
                  <Tooltip
                    formatter={(value: any) => [Number(value).toLocaleString(), 'Estimated Trend']}
                  />
                  <Line
                    type="monotone"
                    dataKey="trend"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Seasonality Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RotateCw className="w-4 h-4 text-purple-600" />
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Seasonality Analysis
              </h4>
            </div>

            {report.seasonality && (
              <span
                className={`px-2 py-0.5 rounded text-xs font-semibold ${
                  report.seasonality.detected
                    ? 'bg-purple-50 text-purple-700 border border-purple-200'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {report.seasonality.detected ? `Detected (Period: ${report.seasonality.period})` : 'Not Significant'}
              </span>
            )}
          </div>

          <p className="text-xs text-slate-600">
            {report.seasonality?.description || 'Seasonality test could not be evaluated.'}
          </p>

          {seasonalData.length > 0 ? (
            <div className="h-48 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={seasonalData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    tickFormatter={(val: any) => Number(val).toLocaleString()}
                  />
                  <Tooltip
                    formatter={(value: any) => [Number(value).toLocaleString(), 'Seasonal Component']}
                  />
                  <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3" />
                  <Line
                    type="monotone"
                    dataKey="seasonal"
                    stroke="#9333ea"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center bg-slate-50 border border-dashed border-slate-200 rounded-lg text-xs text-slate-400">
              No strong seasonal pattern to display.
            </div>
          )}
        </div>
      </div>

      {/* Autocorrelation Card */}
      {report.acf && acfData.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-emerald-600" />
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Autocorrelation Function (ACF) Diagnostics
              </h4>
            </div>
            <span className="text-[11px] text-slate-400">Past target correlation across lags</span>
          </div>

          <p className="text-xs text-slate-600">
            {report.acf.description}
          </p>

          <div className="h-56 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={acfData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="lag" tick={{ fontSize: 10, fill: '#64748b' }} interval={1} />
                <YAxis domain={[-1, 1]} tick={{ fontSize: 10, fill: '#64748b' }} />
                <ReferenceLine y={0} stroke="#64748b" />
                <ReferenceLine y={0.2} stroke="#94a3b8" strokeDasharray="3 3" />
                <ReferenceLine y={-0.2} stroke="#94a3b8" strokeDasharray="3 3" />
                <Tooltip formatter={(value: any) => [Number(value).toFixed(3), 'ACF']} />
                <Bar dataKey="acf" fill="#0d9488" radius={[2, 2, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Integrity & Methodology Notes */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-5 space-y-3 text-xs text-slate-600">
        <div className="flex items-center gap-2 text-slate-800 font-semibold">
          <Shield className="w-4 h-4 text-blue-600" />
          <span>Diagnostic Methodology & Limitations</span>
        </div>
        <ul className="list-disc pl-5 space-y-1 text-slate-500">
          {report.limitations.map((lim, i) => (
            <li key={i}>{lim}</li>
          ))}
          <li>
            Zero actual values in the validation set produce undefined MAPE and are flagged to prevent misleading tournament winners.
          </li>
          <li>
            Decomposition and ACF diagnostics are purely descriptive and do not assert causality.
          </li>
        </ul>
      </div>
    </div>
  )
}
